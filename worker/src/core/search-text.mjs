/**
 * Textwerkzeuge fuer die Worker-Suche. Normalisierung wird NICHT neu
 * definiert, sondern aus der kanonischen Build-Pipeline-Portierung
 * importiert (`scripts/atlas-normalize.mjs`, ihrerseits ein bitgleicher Port
 * von `lib/search.ts` / `backend/app/normalize.py`, siehe dort fuer den
 * Gleichheitsnachweis). `worker/` und `scripts/` gehoeren beide zu diesem
 * Arbeitspaket; ein relativer Import haelt eine einzige Quelle statt einer
 * vierten Kopie.
 */
export { normalizeSearchText, normalizeArabic, NORMALIZER_VERSION } from "../../../scripts/atlas-normalize.mjs";

/**
 * Baut aus einer normalisierten Suchanfrage eine sichere FTS5-Phrasensuche:
 * die gesamte Anfrage wird als EIN Phrasenliteral in doppelte Anfuehrungs-
 * zeichen gefasst (mit Verdopplung eingebetteter Anfuehrungszeichen). Das
 * verlangt von FTS5 die exakte, zusammenhaengende Wortfolge -- die naechste
 * verfuegbare Annaeherung an Pythons Teilstringtest `wanted in haystack`
 * (siehe hadiths.mjs-Kommentar zur bekannten Abweichung) und macht
 * FTS5-Sonderzeichen (`*`, `:`, `-`, `(`, `)`, ...) in der Nutzereingabe
 * ungefaehrlich.
 * @param {string} rawQuery bereits normalisierte oder rohe Nutzereingabe
 */
export function escapeFtsPhrase(rawQuery) {
  const trimmed = String(rawQuery ?? "").trim();
  if (!trimmed) return '""';
  return `"${trimmed.replace(/"/g, '""')}"`;
}
