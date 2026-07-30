#!/usr/bin/env node
/**
 * Trockenlauf-Nachweis fuer P3.4: "Rollback auf die Vorversion in einem
 * Schritt nachgewiesen."
 *
 * Warum ein Trockenlauf und nicht der echte Deploy? Ohne Cloudflare-
 * Zugangsdaten laesst sich `wrangler d1 execute` nicht ausfuehren; ein Nachweis,
 * der nur in einer Umgebung laeuft, die hier niemand hat, ist kein Nachweis.
 * Dieser Lauf ersetzt daher EINEN Baustein -- das D1-Binding -- durch eine
 * lokale SQLite-Datei und laesst alles andere echt: dieselbe DDL, dasselbe
 * Umschalt-SQL, dieselbe Leselogik des Workers (worker/src/core/release.mjs),
 * derselbe Router (`GET /health`). Was hier gruen ist, ist genau die
 * Versionsumschaltung; was hier NICHT geprueft werden kann, ist das Verhalten
 * von wrangler und D1 selbst (siehe docs/12-LAUFZEIT.md, "Was real erprobt ist").
 *
 * Ausfuehren: node worker/tools/release-dryrun.mjs
 * Exit-Code 0 = Umschaltung und Rollback belegt, sonst 1.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { RELEASE_DDL, readActiveRelease, registerReleaseSql, activateReleaseSql, resetReleaseCache } from "../src/core/release.mjs";
import { createNodeSqliteAdapter } from "../src/adapters/node-sqlite-adapter.mjs";
import { route } from "../src/core/router.mjs";

const { DatabaseSync } = await import("node:sqlite");

const RELEASE_A = {
  releaseId: "turath-aaaa111122223333aaaa+idx-1111111111111111aaaa",
  dataVersion: "turath-aaaa111122223333aaaa",
  indexVersion: "idx-1111111111111111aaaa",
  builtAt: "2026-07-20T00:00:00.000Z",
  note: "Trockenlauf: Vorversion",
};
const RELEASE_B = {
  releaseId: "turath-bbbb444455556666bbbb+idx-2222222222222222bbbb",
  dataVersion: "turath-bbbb444455556666bbbb",
  indexVersion: "idx-2222222222222222bbbb",
  builtAt: "2026-07-30T00:00:00.000Z",
  note: "Trockenlauf: neue Version",
};

const steps = [];
function step(label, fn) {
  steps.push([label, fn]);
}

/** Was der Worker im Betrieb sieht: der Zeiger, gelesen mit der echten Leselogik. */
async function activeVia(adapter) {
  resetReleaseCache();
  return readActiveRelease(adapter);
}

/** Und was ein Aussenstehender sieht: GET /health durch den echten Router. */
async function healthVia(adapter, release) {
  const response = await route(new Request("http://worker.local/health"), {
    db: adapter,
    gate: null,
    registry: { sources: [] },
    dataVersion: release.dataVersion,
    release,
  });
  return JSON.parse(await response.text());
}

const workdir = mkdtempSync(join(tmpdir(), "atlas-release-dryrun-"));
const dbPath = join(workdir, "d1-stellvertreter.db");
const raw = new DatabaseSync(dbPath);
const adapter = createNodeSqliteAdapter(raw);

try {
  step("die Release-DDL laedt in einer echten SQLite-Datenbank (dieselbe, die in D1 laeuft)", () => {
    raw.exec(RELEASE_DDL);
    // atlas_build_info gehoert in jede atlas.db (scripts/atlas-build-lib.mjs)
    // und ist der Rueckfallzeiger, wenn keine Release-Zeile aktiv ist. Ohne sie
    // waere der letzte Schritt unten nicht pruefbar.
    raw.exec(`CREATE TABLE atlas_build_info (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data_version TEXT NOT NULL,
      built_at TEXT NOT NULL,
      schema_source TEXT NOT NULL DEFAULT 'database/schema.sql',
      index_version TEXT NOT NULL DEFAULT '',
      release_id TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO atlas_build_info (id, data_version, built_at, index_version, release_id)
    VALUES (1, '${RELEASE_A.dataVersion}', '${RELEASE_A.builtAt}', '${RELEASE_A.indexVersion}', '${RELEASE_A.releaseId}');`);
  });

  step("beide Releases sind registrierbar, ohne dass eines davon aktiv wird", async () => {
    raw.exec(registerReleaseSql(RELEASE_A));
    raw.exec(registerReleaseSql(RELEASE_B));
    const rows = raw.prepare("SELECT count(*) AS n FROM atlas_release").get();
    assert.equal(rows.n, 2, "beide Releases muessen registriert sein");
    const active = raw.prepare("SELECT count(*) AS n FROM atlas_release WHERE is_active = 1").get();
    assert.equal(active.n, 0, "Registrieren darf nichts aktivieren");
  });

  step("Schritt 1: Vorversion A aktivieren -- Worker und /health melden A", async () => {
    raw.exec(activateReleaseSql(RELEASE_A.releaseId, "2026-07-20T12:00:00.000Z"));
    const active = await activeVia(adapter);
    assert.equal(active.releaseId, RELEASE_A.releaseId);
    assert.equal(active.dataVersion, RELEASE_A.dataVersion);
    assert.equal(active.indexVersion, RELEASE_A.indexVersion);
    assert.equal(active.source, "atlas_release", "der Zeiger muss aus atlas_release kommen, nicht aus dem Rueckfallweg");
    const health = await healthVia(adapter, active);
    assert.equal(health.releaseId, RELEASE_A.releaseId);
    assert.equal(health.dataVersion, RELEASE_A.dataVersion);
    assert.equal(health.indexVersion, RELEASE_A.indexVersion);
  });

  step("Schritt 2: neue Version B aktivieren -- EIN Batch, danach melden Worker und /health B", async () => {
    raw.exec(activateReleaseSql(RELEASE_B.releaseId, "2026-07-30T12:00:00.000Z"));
    const active = await activeVia(adapter);
    assert.equal(active.releaseId, RELEASE_B.releaseId);
    assert.equal(active.dataVersion, RELEASE_B.dataVersion, "Datenversion muss mitgeschaltet haben");
    assert.equal(active.indexVersion, RELEASE_B.indexVersion, "Indexversion muss mitgeschaltet haben");
    const health = await healthVia(adapter, active);
    assert.equal(health.releaseId, RELEASE_B.releaseId);
  });

  step("zu keinem Zeitpunkt sind zwei Releases gleichzeitig aktiv (Datenbank erzwingt das)", () => {
    const active = raw.prepare("SELECT count(*) AS n FROM atlas_release WHERE is_active = 1").get();
    assert.equal(active.n, 1);
    assert.throws(
      () => raw.exec(`UPDATE atlas_release SET is_active = 1 WHERE release_id = '${RELEASE_A.releaseId}';`),
      /UNIQUE constraint failed/,
      "der partielle UNIQUE-Index haette ein zweites aktives Release verhindern muessen",
    );
  });

  step("Schritt 3: Rollback auf die Vorversion -- EIN Befehl, Daten- UND Indexversion zurueck auf A", async () => {
    // Genau das, was `node worker/tools/atlas-release.mjs rollback --db <pfad>`
    // ausfuehrt: das Umschalt-SQL des Vorgaengerreleases, ohne Worker-Deploy,
    // ohne Pages-Build, ohne Neuladen von Fachdaten.
    raw.exec(activateReleaseSql(RELEASE_A.releaseId, "2026-07-31T09:00:00.000Z"));
    const active = await activeVia(adapter);
    assert.equal(active.releaseId, RELEASE_A.releaseId, "Rollback muss die Vorversion aktiv machen");
    assert.equal(active.dataVersion, RELEASE_A.dataVersion);
    assert.equal(active.indexVersion, RELEASE_A.indexVersion);
    const health = await healthVia(adapter, active);
    assert.equal(health.releaseId, RELEASE_A.releaseId);
    assert.equal(health.releaseActivatedAt, "2026-07-31T09:00:00.000Z");
  });

  step("ein Rollback auf ein nicht registriertes Release bleibt nicht still wirkungslos", async () => {
    raw.exec(activateReleaseSql("turath-gibt-es-nicht+idx-gibt-es-nicht", "2026-07-31T10:00:00.000Z"));
    const count = raw.prepare("SELECT count(*) AS n FROM atlas_release WHERE is_active = 1").get();
    // Die erste Anweisung deaktiviert, die zweite trifft keine Zeile: der
    // Zustand ist danach "kein aktives Release" -- ein sichtbarer Fehler, kein
    // stillschweigend falsch ausgeliefertes Release. atlas-release.mjs prueft
    // die Registrierung deshalb VOR der Umschaltung.
    assert.equal(count.n, 0, "ein unbekanntes Release darf niemals aktiv werden");
    const active = await activeVia(adapter);
    assert.equal(active.source, "atlas_build_info", "ohne aktive Zeile faellt der Worker sichtbar auf atlas_build_info zurueck");
  });

  let failed = 0;
  for (const [label, fn] of steps) {
    try {
      await fn();
      console.log(`ok   ${label}`);
    } catch (error) {
      failed += 1;
      console.error(`FEHL ${label}`);
      console.error(`     ${String(error?.message ?? error).split("\n")[0]}`);
    }
  }
  console.log("");
  console.log(`Trockenlauf Release-Umschaltung: ${steps.length - failed}/${steps.length} Schritte belegt`);
  if (failed > 0) process.exitCode = 1;
} finally {
  raw.close();
  rmSync(workdir, { recursive: true, force: true });
}
