/**
 * Byte-treuer Port der Knoten-ID-Vergabe aus `backend/app/repository.py`
 * (`bucket_id`, `is_relative_reference`, `RELATIVE_REFERENCE_TERMS`).
 *
 * Warum ein Port statt einer eigenen Definition: der Worker muss fuer
 * `/api/v1/narrators/{id}` und `/api/v1/narrators/{id}/relations`
 * *dieselben* Knoten-IDs erzeugen wie die FastAPI-Referenzimplementierung,
 * sonst divergieren Worker- und FastAPI-Antworten genau an der Stelle, die
 * die Contract-Tests (P3.2) pruefen sollen. Die ID wird beim Bau von
 * `atlas.db` einmal je Erzaehlerposition berechnet und in
 * `narrator_occurrence.node_id` sowie `edge_projection` gespeichert, nicht
 * zur Laufzeit im Worker neu berechnet.
 *
 * Nachweis der Gleichheit: `tests/atlas-db-id-scheme.check.mjs` vergleicht
 * diese Funktionen gegen `backend/app/repository.py:bucket_id` /
 * `is_relative_reference`, aufgerufen per `python3 -c ...` fuer dieselben
 * Testvektoren.
 */

import { createHash } from "node:crypto";
import { normalizeSearchText } from "./atlas-normalize.mjs";

/** Wortgleich zu _RELATIVE_REFERENCE_TERMS_RAW in backend/app/repository.py. */
const RELATIVE_REFERENCE_TERMS_RAW = [
  "أبيه", "عمه", "أخيه", "جده", "أمه", "امه", "ابنه", "بنته",
  "جدته", "زوجته", "خاله", "خالته", "عمته", "أخته", "اخته", "جدها",
];

export const RELATIVE_REFERENCE_TERMS = new Set(RELATIVE_REFERENCE_TERMS_RAW.map((term) => normalizeSearchText(term)));

/**
 * True, wenn die Oberflaechenform ein relatives Rueckverweis-Token enthaelt
 * (z. B. "أبيه") -- die Person ist dann nur relativ zum vorherigen Erzaehler
 * in dieser konkreten Kette benannt, nie eine globale Identitaet.
 * @param {string | null | undefined} normalizedForm
 */
export function isRelativeReference(normalizedForm) {
  const tokens = new Set(normalizeSearchText(normalizedForm ?? "").split(" ").filter(Boolean));
  for (const token of tokens) {
    if (RELATIVE_REFERENCE_TERMS.has(token)) return true;
  }
  return false;
}

function sha1Hex(text) {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

/**
 * Deterministische, reversible Occurrence-Cluster-ID. Wortgleich zu
 * `bucket_id()` in backend/app/repository.py.
 * @param {string} recordId
 * @param {number} chainOrder
 * @param {number} position
 * @param {string} normalizedForm
 */
export function bucketId(recordId, chainOrder, position, normalizedForm) {
  const canonical = normalizeSearchText(normalizedForm ?? "");
  if (!canonical || isRelativeReference(canonical)) {
    const digest = sha1Hex(`${recordId}:${chainOrder}:${position}:${canonical}`).slice(0, 12);
    return `UNC-REL-${digest}`;
  }
  return "UNC-" + sha1Hex(canonical).slice(0, 12);
}

// ---------------------------------------------------------------------------
// Kanonische Personen-ID  SA-P-<base32(8)>   (Umsetzungsplan P4.5)
// ---------------------------------------------------------------------------
//
// `bucketId()` oben beantwortet die Frage "welche Erzaehlerpositionen tragen
// dieselbe Namensform?". Sie beantwortet NICHT die Frage "welche Person ist
// das?" -- und genau dafuer sieht database/schema.sql `narrator.stable_key`
// im Format SA-P-<base32(8)> plus eine ganzzahlige `revision` vor. Bis heute
// hat kein Laufzeitpfad je eine solche ID erzeugt oder gelesen.
//
// Erzeugung: Port der Postgres-Funktion `sanad_stable_key(prefix, seed)` aus
// database/schema.sql (dort im POSTGRES-ONLY-Block, den der SQLite-Uebersetzer
// ueberspringt -- die Erzeugung muss deshalb ausserhalb der Datenbank
// stattfinden, sonst gaebe es zwei Definitionen). Byte i (i = 0..7) des
// sha256 ueber den Seed, modulo 32, als Index in das Base32-Alphabet.
//
// Seed einer kanonischen Person ist eine unveraenderliche Identitaets-/Ent-
// scheidungs-ID, NICHT ihre Namensform. Ein `UNC-`-Cluster sagt nur, dass
// Vorkommen dieselbe normalisierte Oberflaechenform tragen. Es kann mehrere
// homonyme Personen enthalten und darf deshalb vor einer Identitaetsentscheidung
// weder eine `narrator`-Zeile noch eine oeffentliche SA-P-ID erzeugen.
//
// `canonicalPersonKeyForCluster()` bleibt als expliziter Kompatibilitaetshelfer
// fuer bereits redaktionell als eine Person bestaetigte Cluster erhalten. Der
// Importpfad darf ihn nicht pauschal fuer alle Namenscluster aufrufen.
//
// Die Rueckrichtung (SA-P- -> UNC-) ist nicht rechenbar; sie steht in
// `narrator_public_alias` (database/migrations/0007_canonical_person_ids.sql).
// Autoritativ ist immer die Tabelle: nach einem Merge oder Split verschiebt
// sich die Zuordnung, und dann gilt die gespeicherte, nicht die gerechnete.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const CANONICAL_PERSON_PREFIX = "SA-P-";
export const OCCURRENCE_CLUSTER_PREFIX = "UNC-";
export const RELATIVE_CLUSTER_PREFIX = "UNC-REL-";

/**
 * Port von `sanad_stable_key(prefix, seed)` aus database/schema.sql.
 * @param {string} prefix z. B. "SA-P-"
 * @param {string} seed
 */
export function stableKey(prefix, seed) {
  if (typeof prefix !== "string" || typeof seed !== "string" || seed.length === 0) {
    throw new TypeError("stableKey erwartet nichtleere Strings fuer prefix und seed");
  }
  const digest = createHash("sha256").update(seed, "utf8").digest();
  let out = "";
  for (let i = 0; i < 8; i += 1) out += BASE32_ALPHABET[digest[i] % 32];
  return prefix + out;
}

/** True fuer eine kanonische Personen-ID im Format SA-P-<base32(8)>. */
export function isCanonicalPersonKey(value) {
  return typeof value === "string" && /^SA-P-[A-Z2-7]{8}$/.test(value);
}

/**
 * Mintet eine kanonische Personen-ID aus einem unveraenderlichen Identitaets-
 * Seed, z. B. der UUID der initialen redaktionellen Identitaetsentscheidung.
 * Namen und normalisierte Namenscluster sind dafuer ungeeignet: sie koennen
 * sich aendern und koennen homonyme Personen enthalten.
 */
export function canonicalPersonKey(identitySeed, collisionIndex = 0) {
  if (typeof identitySeed !== "string" || identitySeed.length === 0) {
    throw new TypeError("identitySeed muss ein nichtleerer String sein");
  }
  if (!Number.isSafeInteger(collisionIndex) || collisionIndex < 0) {
    throw new RangeError("collisionIndex muss eine nichtnegative ganze Zahl sein");
  }
  const seed = collisionIndex > 0 ? `${identitySeed}#${collisionIndex}` : identitySeed;
  return stableKey(CANONICAL_PERSON_PREFIX, seed);
}

/**
 * Kanonischer Personenschluessel zu einer Occurrence-Cluster-ID.
 *
 * Gibt `null` fuer positionsgebundene Rueckverweisformen (`UNC-REL-`) zurueck:
 * "ابيه" ist keine globale Person, sondern eine Aussage ueber genau eine
 * Position in genau einer Kette (schema.sql: narrator_occurrence.is_relative_form).
 * Eine kanonische Personen-ID dafuer zu vergeben, waere die Behauptung einer
 * Identitaet, die der Text nicht hergibt.
 *
 * `homonymIndex > 0` wird nur bei einer nachgewiesenen Schluesselkollision
 * verwendet (siehe scripts/atlas-build-lib.mjs, loadCanonicalNarrators()).
 * @param {string} clusterId
 * @param {number} [homonymIndex]
 */
export function canonicalPersonKeyForCluster(clusterId, homonymIndex = 0) {
  if (typeof clusterId !== "string" || !/^UNC-[0-9a-f]{12}$/.test(clusterId)) return null;
  if (clusterId.startsWith(RELATIVE_CLUSTER_PREFIX)) return null;
  return canonicalPersonKey(clusterId, homonymIndex);
}

/**
 * Occurrence-Cluster-ID einer beliebigen normalisierten Namensform -- der
 * Namensteil von `bucketId()` ohne Ketten-/Positionsbezug. Fuer Namen, die
 * nur in einem Rijal-Eintrag vorkommen (Lehrer-/Schuelernennungen, P4.6) und
 * deshalb keine Isnad-Position haben.
 * @param {string} normalizedForm
 */
export function clusterIdForName(normalizedForm) {
  const canonical = normalizeSearchText(normalizedForm ?? "");
  if (!canonical || isRelativeReference(canonical)) return null;
  return OCCURRENCE_CLUSTER_PREFIX + sha1Hex(canonical).slice(0, 12);
}
