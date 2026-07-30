/**
 * Release-Zeiger (P3.4): welche Datenversion UND welche Indexversion bedient
 * dieser Worker gerade?
 *
 * Ein Release ist immer das PAAR (dataVersion, indexVersion). Der Zeiger liegt
 * in D1 in `atlas_release` (angelegt und mit einer Zeile befuellt von
 * scripts/atlas-build-lib.mjs), NICHT im Workercode und nicht in der statischen
 * Seite. Das ist die ganze Begruendung fuer diese Datei:
 *
 *   - Umschalten und Zurueckrollen sind dadurch EIN UPDATE in D1, kein neuer
 *     Worker-Deploy und kein neuer Pages-Build.
 *   - Datenversion und Indexversion koennen nicht auseinanderlaufen: sie stehen
 *     in derselben Zeile, und ein partieller UNIQUE-Index laesst hoechstens eine
 *     Zeile aktiv sein.
 *
 * Kosten: eine Zeile pro Isolate-Lebensdauer. Der Wert wird im Modulzustand
 * gehalten (ein Isolate bedient viele Anfragen), damit das D1-Zeilenbudget
 * nicht pro Anfrage belastet wird. Ein Rollback greift dadurch nicht in
 * derselben Millisekunde, sondern sobald die Isolates erneuert sind bzw. die
 * TTL unten ablaeuft -- bewusst so, weil die Alternative ein zusaetzlicher
 * Zeilen-Lesevorgang auf JEDER Anfrage waere.
 */

/** Wie lange ein Isolate den Zeiger zwischenspeichert, bevor es erneut liest. */
export const RELEASE_CACHE_TTL_MS = 60_000;

/** @type {{ value: any, readAt: number } | null} */
let cached = null;

/**
 * Liest die aktive Release-Zeile.
 *
 * Rueckfallweg: eine atlas.db aus einem Baulauf VOR P3.4 hat keine
 * `atlas_release`-Tabelle. Dann gilt `atlas_build_info` als Zeiger, mit
 * `indexVersion: null` -- ausdruecklich nicht mit einem erfundenen Wert, damit
 * "unbekannte Indexversion" in der Antwort sichtbar bleibt.
 *
 * @param {{ get(sql: string, ...params: any[]): Promise<any> }} db
 * @returns {Promise<{ releaseId: string, dataVersion: string, indexVersion: string | null, builtAt: string | null, activatedAt: string | null, source: string }>}
 */
export async function readActiveRelease(db) {
  try {
    const row = await db.get(
      "SELECT release_id, data_version, index_version, built_at, activated_at FROM atlas_release WHERE is_active = 1",
    );
    if (row) {
      return {
        releaseId: row.release_id,
        dataVersion: row.data_version,
        indexVersion: row.index_version,
        builtAt: row.built_at ?? null,
        activatedAt: row.activated_at ?? null,
        source: "atlas_release",
      };
    }
  } catch {
    // Tabelle fehlt (aeltere atlas.db) -- unten weiter mit atlas_build_info.
  }

  const info = await db.get("SELECT data_version, index_version, release_id, built_at FROM atlas_build_info WHERE id = 1");
  if (!info) throw new Error("atlas.db enthaelt weder atlas_release noch atlas_build_info -- kein Release-Zeiger vorhanden");
  return {
    releaseId: info.release_id || info.data_version,
    dataVersion: info.data_version,
    indexVersion: info.index_version || null,
    builtAt: info.built_at ?? null,
    activatedAt: null,
    source: "atlas_build_info",
  };
}

/**
 * Wie readActiveRelease(), aber mit Isolate-Zwischenspeicher.
 * @param {{ get(sql: string, ...params: any[]): Promise<any> }} db
 * @param {number} [now]
 */
export async function activeRelease(db, now = Date.now()) {
  if (cached && now - cached.readAt < RELEASE_CACHE_TTL_MS) return cached.value;
  const value = await readActiveRelease(db);
  cached = { value, readAt: now };
  return value;
}

/** Nur fuer Tests und Trockenlaeufe: erzwingt ein erneutes Lesen. */
export function resetReleaseCache() {
  cached = null;
}

// ---------------------------------------------------------------------------
// SQL fuer Registrierung und Umschaltung
// ---------------------------------------------------------------------------
//
// Absichtlich als Zeichenketten und nicht als Codepfad im Worker: der Worker
// ist read-only (er hat keinen Schreibpfad auf D1, und soll keinen bekommen).
// Umgeschaltet wird ausserhalb, mit `wrangler d1 execute --file`, das die
// Anweisungen einer Datei als EINEN Batch ausfuehrt -- deshalb ist die
// Umschaltung unten (deaktivieren + aktivieren) atomar und kann nicht auf
// halbem Weg stehenbleiben.

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** DDL, falls in D1 noch keine Release-Tabelle existiert (idempotent). */
export const RELEASE_DDL = `CREATE TABLE IF NOT EXISTS atlas_release (
  release_id TEXT PRIMARY KEY,
  data_version TEXT NOT NULL,
  index_version TEXT NOT NULL,
  built_at TEXT NOT NULL,
  activated_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS atlas_release_single_active_idx ON atlas_release (is_active) WHERE is_active = 1;`;

/**
 * Registriert ein Release, ohne es zu aktivieren.
 * @param {{ releaseId: string, dataVersion: string, indexVersion: string, builtAt: string, note?: string|null }} release
 */
export function registerReleaseSql(release) {
  return [
    RELEASE_DDL,
    `INSERT OR REPLACE INTO atlas_release (release_id, data_version, index_version, built_at, activated_at, is_active, note)`,
    `VALUES (${sqlString(release.releaseId)}, ${sqlString(release.dataVersion)}, ${sqlString(release.indexVersion)}, ${sqlString(release.builtAt)}, NULL, 0, ${sqlString(release.note ?? null)});`,
  ].join("\n");
}

/**
 * Die Umschaltung: genau zwei Anweisungen, in einem Batch.
 *
 * Die erste ist auf `is_active = 1` eingeschraenkt, damit sie nur die eine
 * aktive Zeile beruehrt statt die gesamte Tabelle zu schreiben (Zeilen-
 * SCHREIBvorgaenge zaehlen bei D1 ebenfalls). Die zweite scheitert mit
 * "no such release", wenn die Zielzeile nicht existiert -- ein Rollback auf ein
 * nie registriertes Release ist damit ein Fehler, keine stille Wirkungslosigkeit.
 *
 * @param {string} releaseId
 * @param {string} activatedAt ISO-8601
 */
export function activateReleaseSql(releaseId, activatedAt) {
  return [
    `UPDATE atlas_release SET is_active = 0 WHERE is_active = 1;`,
    `UPDATE atlas_release SET is_active = 1, activated_at = ${sqlString(activatedAt)} WHERE release_id = ${sqlString(releaseId)};`,
  ].join("\n");
}
