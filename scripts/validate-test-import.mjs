/**
 * Vorab-Prüfung für Fremdimporte (`data/test-import.json`).
 *
 * Der Prüfer setzt denselben Vertrag durch, den auch `scripts/import-turath-corpus.mjs`
 * einhält:
 *   1. Ein Import ohne vollständige Herkunftsangabe wird abgelehnt (Abschnitt 10).
 *   2. Jede Erzählerposition ist `{chainId, position, spanStart, spanEnd}` und muss sich
 *      zeichengenau aus dem gespeicherten Rohisnād zurückschneiden lassen (P1.2).
 *   3. Relative Formen (أبيه، عمه، أخيه، جده) bleiben an ihre Position gebunden und werden
 *      nie zu einer globalen Person.
 *   4. Kein Datensatz wird still verworfen; Auffälligkeiten landen in einer Review-Queue.
 *
 * Aufruf: `node scripts/validate-test-import.mjs`
 */

import { readFile } from "node:fs/promises";

const input = new URL("../data/test-import.json", import.meta.url);
const payload = JSON.parse(await readFile(input, "utf8"));
const requiredSourceFields = ["name", "version", "licenseStatus", "retrievedAt", "commercialUse"];
const requiredRecordFields = ["externalId", "collection", "number", "rawIsnad", "matn", "editorialStatus"];
const RELATIVE_FORMS = /^(?:ابيه|ابيها|ابوه|امه|امها|عمه|عمها|عمته|اخيه|اخيها|اختها|جده|جدها|جدته|ابنه|ابنها|شيخه|رجل|شيخ)$/u;

/** Wortgleich zu `lib/search.ts` und `backend/app/normalize.py`. */
const NORMALIZE_WHITESPACE_CLASS =
  "\\t\\n\\v\\f\\r\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";
function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\b(?:ibn|bin)\b/gi, "b")
    .replace(new RegExp(`[${NORMALIZE_WHITESPACE_CLASS}]+`, "g"), " ")
    .replace(new RegExp(`^[${NORMALIZE_WHITESPACE_CLASS}]+|[${NORMALIZE_WHITESPACE_CLASS}]+$`, "g"), "")
    .toLowerCase();
}

for (const field of requiredSourceFields) {
  if (!(field in payload.source)) throw new Error(`Missing source provenance field: ${field}`);
}
if (payload.source.licenseStatus === "unresolved" && payload.source.commercialUse) {
  throw new Error("Commercial import is blocked while license status is unresolved.");
}

const seen = new Set();
const reviewQueue = [];
let occurrenceCount = 0;
let relativeCount = 0;

for (const [index, record] of payload.records.entries()) {
  for (const field of requiredRecordFields) {
    if (!record[field]) throw new Error(`Record ${index} missing ${field}`);
  }
  if (seen.has(record.externalId)) throw new Error(`Duplicate externalId: ${record.externalId}`);
  seen.add(record.externalId);

  const chainId = `${record.externalId}#c0`;
  const separator = "←";
  let cursor = 0;
  record.occurrences = [];
  for (const [position, segment] of record.rawIsnad.split(separator).entries()) {
    const leading = segment.length - segment.trimStart().length;
    const spanStart = cursor + leading;
    const rawSurfaceForm = segment.trim();
    const spanEnd = spanStart + rawSurfaceForm.length;
    cursor += segment.length + separator.length;
    // Abnahme: die Position muss per Offset wieder aus dem Rohisnād zu schneiden sein.
    if (record.rawIsnad.slice(spanStart, spanEnd) !== rawSurfaceForm) {
      throw new Error(`Record ${record.externalId} position ${position}: span does not round-trip`);
    }
    const normalizedSurfaceForm = normalizeSearchText(rawSurfaceForm);
    const relativeForm = RELATIVE_FORMS.test(normalizedSurfaceForm);
    if (relativeForm) relativeCount += 1;
    if (!rawSurfaceForm) {
      reviewQueue.push({ externalId: record.externalId, position, errorCode: "empty-surface-form" });
      continue;
    }
    occurrenceCount += 1;
    record.occurrences.push({
      chainId,
      position,
      rawSurfaceForm,
      normalizedSurfaceForm,
      spanStart,
      spanEnd,
      relativeForm,
      // Relative Formen bleiben an (chainId, position) gebunden, nie an eine globale Person.
      identityStatus: relativeForm ? "unresolved-relative" : "unresolved",
      evidenceClass: "isnad_link",
      reviewStatus: "unreviewed",
    });
  }
}

console.log(`Validated ${payload.records.length} records with complete source provenance.`);
console.log(`Produced ${occurrenceCount} unresolved narrator occurrences for editorial resolution.`);
console.log(`Every occurrence carries {chainId, position, spanStart, spanEnd} and round-trips to rawIsnad.`);
console.log(`Relative surface forms bound to their position: ${relativeCount}.`);
console.log(`Review queue entries (nothing discarded silently): ${reviewQueue.length}.`);
if (reviewQueue.length) console.log(JSON.stringify(reviewQueue, null, 2));
