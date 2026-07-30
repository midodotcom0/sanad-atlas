/**
 * Byte-treuer Port der kanonischen arabischen Normalisierung fuer die
 * SQLite/D1-Build-Pipeline (P3.1).
 *
 * Einzige fachliche Definition bleibt `lib/search.ts` (`normalizeSearchText`);
 * `backend/app/normalize.py` ist Agent 1s bitgleicher Python-Port. Diese Datei
 * ist ein DRITTER Port derselben Definition, keine Neudefinition -- noetig,
 * weil `scripts/build-atlas-db.mjs` als reines Node-Skript ohne TypeScript-
 * Tooling (kein `npm install`, kein `ts-node`/`tsx` in der Sandbox verfuegbar)
 * laufen muss.
 *
 * Nachweis der Gleichheit: `tests/atlas-db-normalize-parity.check.mjs`
 * vergleicht diese Funktion gegen dieselbe Fixture
 * (`public/data/corpus/normalize-fixture.json`), die auch die TS- und
 * Python-Ports absichert. Weicht diese Datei ab, ist sie falsch -- nicht die
 * Fixture.
 *
 * Schritte (Reihenfolge ist Teil des Vertrags, identisch zu lib/search.ts):
 *   1. NFKD
 *   2. Kombinationszeichen entfernen (\p{M})
 *   3. Tatwil (ـ) entfernen
 *   4. أ إ آ ٱ -> ا
 *   5. ى -> ي
 *   6. ة -> ه
 *   7. ؤ -> و
 *   8. ئ -> ي
 *   9. ibn / bin -> b (wortgebunden, case-insensitiv)
 *  10. Whitespace vereinheitlichen, trimmen, kleinschreiben
 */

/** Wortgleich zu NORMALIZE_WHITESPACE_CLASS in lib/search.ts und backend/app/normalize.py. */
export const NORMALIZE_WHITESPACE_CLASS =
  "\\t\\n\\v\\f\\r\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";

/** Muss zu NORMALIZER_VERSION in lib/search.ts und backend/app/normalize.py passen. */
export const NORMALIZER_VERSION = "sanad-normalize-1.0.0";

const WHITESPACE_RUN = new RegExp(`[${NORMALIZE_WHITESPACE_CLASS}]+`, "g");
const WHITESPACE_EDGE = new RegExp(`^[${NORMALIZE_WHITESPACE_CLASS}]+|[${NORMALIZE_WHITESPACE_CLASS}]+$`, "g");

/**
 * Kanonische Suchform. Erzeugt nie eine geprüfte Aussage, nur einen Suchschlüssel.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeSearchText(value) {
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
    .replace(WHITESPACE_RUN, " ")
    .replace(WHITESPACE_EDGE, "")
    .toLowerCase();
}

/** Alias, identisch zur Python-Namensgebung, fuer Code, das von dort portiert wurde. */
export const normalizeArabic = normalizeSearchText;
