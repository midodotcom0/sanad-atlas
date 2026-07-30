/**
 * Aufloesung von Personen-IDs (Umsetzungsplan P4.5), Worker-Seite.
 *
 * Bis P4.5 kannte die Laufzeit genau einen ID-Raum: die Occurrence-Cluster-ID
 * `UNC-<sha1(12)>` aus `backend/app/repository.py:bucket_id()`. Das Schema
 * beschreibt daneben seit Migration 0004 einen zweiten, kanonischen Raum
 * `SA-P-<base32(8)>` mit Revision, Merge, Split und Redirect -- und der war
 * leer. Dieses Modul ist die Stelle, an der beide zusammenkommen.
 *
 * Drei Faelle, mehr gibt es nicht:
 *
 *   `UNC-REL-…`  Positionsgebundene Rueckverweisform („ابيه"). Sie bekommt
 *                NIE eine kanonische ID: sie benennt keine globale Person,
 *                sondern eine Stelle in einer Kette. Aufloesung endet hier.
 *   `UNC-…`      Occurrence-Cluster. Aufloesung ueber `narrator_public_alias`
 *                zur kanonischen Person, danach der Redirect-Kette folgen.
 *   `SA-P-…`     Kanonische ID. Direkt auf `narrator.stable_key`, danach der
 *                Redirect-Kette folgen.
 *
 * **Alte IDs bleiben aufloesbar.** Das ist keine Nebenwirkung, sondern die
 * Bedingung: eine ID, die einmal in einem Zitat stand, darf nicht ins Leere
 * zeigen. Deshalb bleibt die Occurrence-Cluster-ID der Zugriffsweg auf die
 * Vorkommen (`narrator_occurrence.node_id`) auch dann, wenn die Person
 * inzwischen eine kanonische ID und mehrere Revisionen hat, und deshalb
 * bleibt jede absorbierte ID in `narrator_id_redirect` stehen, statt geloescht
 * zu werden.
 *
 * Die Vorwaertsaufloesung nutzt die partiellen UNIQUE-Indizes auf aktiven
 * Alias- und Redirect-Zeilen. Eine abschliessende rekursive Rueckwaertssuche
 * sammelt bei kanonischen Zugriffen alle Oberflaechencluster, die durch
 * aktive Merges zur Zielperson gehoeren.
 */

/** schema.sql: „Aufloesung folgt der Kette ... maximal acht Schritte." */
export const MAX_REDIRECT_HOPS = 8;

const CANONICAL_ID_RE = /^SA-P-[A-Z2-7]{8}$/;
const RELATIVE_ID_RE = /^UNC-REL-[0-9a-f]{12}$/;
const CLUSTER_ID_RE = /^UNC-[0-9a-f]{12}$/;

export function isCanonicalPersonKey(value) {
  return typeof value === "string" && CANONICAL_ID_RE.test(value);
}

export function isRelativeClusterId(value) {
  return typeof value === "string" && RELATIVE_ID_RE.test(value);
}

/**
 * @typedef {object} NarratorRef
 * @property {string} requestedId          unveraendert wie angefragt
 * @property {"relative"|"cluster"|"canonical"|"unknown"} kind
 * @property {string|null} clusterId       Zugriffsweg auf narrator_occurrence.node_id
 * @property {string[]} clusterIds         alle aktiven Cluster der aufgeloesten Person
 * @property {string|null} canonicalId     SA-P-<base32(8)> oder null
 * @property {number|null} revision
 * @property {string[]} redirectPath       durchlaufene absorbierte Schluessel
 * @property {boolean} truncated           true, wenn die Kette laenger als MAX_REDIRECT_HOPS ist
 */

/**
 * Loest eine beliebige Personen-ID auf.
 * @param {{ get: Function, all: Function }} db
 * @param {string} id
 * @returns {Promise<NarratorRef>}
 */
export async function resolveNarratorRef(db, id) {
  const base = { requestedId: id, kind: "unknown", clusterId: null, clusterIds: [], canonicalId: null, revision: null, redirectPath: [], truncated: false };
  if (typeof id !== "string" || id.length === 0) return base;

  if (isRelativeClusterId(id)) {
    // Ende der Aufloesung. Eine relative Form ist an (Kette, Position)
    // gebunden; ein kanonischer Schluessel dafuer waere eine erfundene
    // Identitaet.
    return { ...base, kind: "relative", clusterId: id, clusterIds: [id] };
  }

  let stableKey = null;
  if (isCanonicalPersonKey(id)) {
    stableKey = id;
  } else if (CLUSTER_ID_RE.test(id)) {
    const alias = await db.get(
      `SELECT n.stable_key AS narrator_stable_key
       FROM narrator_public_alias a
       JOIN narrator n ON n.id = a.narrator_id
       WHERE a.alias_key = ? AND a.is_active = 1`,
      id,
    );
    // Keine Aliaszeile: die ID zeigt auf kein registriertes Namenscluster.
    // Die Vorkommensabfrage laeuft trotzdem weiter -- eine UNC-ID ist auch
    // ohne kanonische Person ein gueltiger Zugriffsweg auf
    // narrator_occurrence.node_id (so war es vor P4.5 durchgaengig).
    if (!alias) return { ...base, kind: "cluster", clusterId: id, clusterIds: [id] };
    stableKey = alias.narrator_stable_key;
  } else {
    return base;
  }

  const redirectPath = [];
  let truncated = false;
  let hops = 0;
  // Redirect-Kette. Sie entsteht durch Merges; ein Split nimmt die Zeile nicht
  // heraus, sondern setzt is_active = 0 -- die Historie bleibt lesbar, die
  // Aufloesung folgt ihr nicht mehr.
  for (;;) {
    const redirect = await db.get("SELECT target_stable_key FROM narrator_id_redirect WHERE absorbed_stable_key = ? AND is_active = 1", stableKey);
    if (!redirect) break;
    hops += 1;
    if (hops > MAX_REDIRECT_HOPS) {
      truncated = true;
      break;
    }
    redirectPath.push(stableKey);
    stableKey = redirect.target_stable_key;
  }

  const narrator = await db.get("SELECT stable_key, revision FROM narrator WHERE stable_key = ?", stableKey);
  if (!narrator) {
    // Kanonischer Schluessel ohne Zeile: nicht raten. Wenn die angefragte ID
    // eine Cluster-ID war, bleibt sie als Zugriffsweg gueltig.
    return { ...base, kind: CLUSTER_ID_RE.test(id) ? "cluster" : "unknown", clusterId: CLUSTER_ID_RE.test(id) ? id : null, clusterIds: CLUSTER_ID_RE.test(id) ? [id] : [], redirectPath, truncated };
  }

  // Ein Merge kann mehrere Oberflaechencluster unter derselben kanonischen
  // Person vereinen. Fuer kanonische Zugriffe muessen alle aktiven Aliase der
  // Zielperson UND ihrer (auch transitiv) absorbierten Personen sichtbar sein,
  // sonst verschwinden Vorkommen aus dem Profil. Die angefragte UNC-ID bleibt
  // dabei der primaere Zugriffsweg.
  const clusterAliases = await db.all(
    `WITH RECURSIVE person_keys(stable_key, depth) AS (
       VALUES (?, 0)
       UNION ALL
       SELECT r.absorbed_stable_key, k.depth + 1
       FROM narrator_id_redirect r
       JOIN person_keys k ON r.target_stable_key = k.stable_key
       WHERE r.is_active = 1 AND k.depth < ?
     )
     SELECT DISTINCT a.alias_key
     FROM person_keys k
     JOIN narrator n ON n.stable_key = k.stable_key
     JOIN narrator_public_alias a ON a.narrator_id = n.id
     WHERE a.alias_kind = 'occurrence_cluster' AND a.is_active = 1
     ORDER BY a.alias_key`,
    narrator.stable_key,
    MAX_REDIRECT_HOPS,
  );
  const clusterIds = clusterAliases.map((row) => row.alias_key);
  const requestedClusterId = CLUSTER_ID_RE.test(id) ? id : null;
  return {
    requestedId: id,
    kind: isCanonicalPersonKey(id) ? "canonical" : "cluster",
    clusterId: requestedClusterId ?? clusterIds[0] ?? null,
    clusterIds,
    canonicalId: narrator.stable_key,
    revision: narrator.revision,
    redirectPath,
    truncated,
  };
}
