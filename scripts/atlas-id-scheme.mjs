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
