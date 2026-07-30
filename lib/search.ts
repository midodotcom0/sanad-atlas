/**
 * Kanonische arabische Normalisierung für Sanad Atlas.
 *
 * Diese Datei ist die EINZIGE fachliche Definition der Normalisierung.
 * Bitgleiche Ports, die synchron gehalten werden müssen:
 *   - `backend/app/normalize.py`            (Python-Referenz für die Forschungs-API)
 *   - `scripts/import-turath-corpus.mjs`    (Importer, schreibt die Prüf-Fixture)
 *
 * Nachgewiesen wird die Gleichheit über
 *   - `public/data/corpus/normalize-fixture.json` (≥ 200 echte Namensformen aus dem Korpus,
 *     erzeugt vom Importer)
 *   - `tests/normalize-parity.test.ts`            (Fixture ↔ diese Datei)
 *   - `tests/normalize-parity-python.py`          (Fixture ↔ backend/app/normalize.py)
 *
 * Leitprinzip aus Abschnitt 6 der Projektbeschreibung: Normalisierung OHNE Verlust des
 * Originaltextes. Diese Funktion erzeugt ausschließlich eine Suchform. Die Rohform bleibt
 * in `rawSurfaceForm` / `rawIsnad` / `rawMatn` erhalten und ist über `spanStart`/`spanEnd`
 * zeichengenau auf die Quelldatei in `.cache/turath` zurückschneidbar.
 *
 * Schritte (Reihenfolge ist Teil des Vertrags):
 *   1. NFKD
 *   2. Kombinationszeichen entfernen (\p{M} — Mn, Mc, Me)
 *   3. Tatwīl (ـ) entfernen
 *   4. أ إ آ ٱ → ا
 *   5. ى → ي
 *   6. ة → ه
 *   7. ؤ → و
 *   8. ئ → ي
 *   9. ibn / bin → b (lateinische Transliteration, wortgebunden, case-insensitiv)
 *  10. Whitespace vereinheitlichen, trimmen, kleinschreiben
 *
 * Schritt 10 verwendet eine EXPLIZITE Whitespace-Klasse statt `\s` und `String.trim()`,
 * weil `\s` in JavaScript und Python unterschiedliche Zeichenmengen abdeckt (JS kennt
 * U+FEFF, Python kennt U+001C–U+001F und U+0085). Ebenso wird `toLowerCase()` statt
 * `toLocaleLowerCase()` benutzt, damit das Ergebnis nicht von der Host-Locale abhängt.
 */

/** Whitespace-Klasse, die in TypeScript und Python identisch definiert ist. */
export const NORMALIZE_WHITESPACE_CLASS =
  "\\t\\n\\v\\f\\r\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";

/** Version des Normalisierungsvertrags. Wandert in `parser.normalizerVersion` und `dataVersion`. */
export const NORMALIZER_VERSION = "sanad-normalize-1.0.0";

const WHITESPACE_RUN = new RegExp(`[${NORMALIZE_WHITESPACE_CLASS}]+`, "g");
const WHITESPACE_EDGE = new RegExp(`^[${NORMALIZE_WHITESPACE_CLASS}]+|[${NORMALIZE_WHITESPACE_CLASS}]+$`, "g");

export function normalizeSearchText(value: string) {
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
