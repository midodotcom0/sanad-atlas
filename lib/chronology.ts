import type { DateAssertion } from "./types";

/**
 * Die einzigen drei Ergebnisse einer automatischen Chronologiepruefung
 * (Projektbeschreibung Abschnitt 7, Z. 233-237). Verbindliches Vokabular des
 * Datenvertrags: `possible | impossible | insufficient`.
 *
 * `compareChronology()` unten ist die **einzige** Chronologieberechnung des
 * Projekts. Eine zweite Rechnung an anderer Stelle -- insbesondere eine, die
 * ein fehlendes Geburtsjahr aus einem Todesjahr ableitet -- ist ein fachlicher
 * Fehler (Abschnitt 7, Z. 239) und wird von `tests/sourceless-dating.test.ts`
 * verboten.
 */
export type ChronologyResult = "possible" | "impossible" | "insufficient";

export interface LifeInterval {
  birthMin: number;
  birthMax: number;
  deathMin: number;
  deathMax: number;
}

/**
 * Lebensintervalle einer Person, ausschliesslich aus belegten Datierungen.
 *
 * Fehlt die Geburts- ODER die Todesangabe, ist das Ergebnis leer. Es wird
 * **nichts** ergaenzt: kein Geburtsjahr aus einem Todesjahr, keine
 * Lebenserwartung, kein Mittelwert ueber widerspruechliche Angaben. Jede
 * genannte Jahresangabe bleibt eine eigene Moeglichkeit mit eigener Quelle.
 */
export function possibleLifeIntervals(assertions: DateAssertion[], narratorId: string): LifeInterval[] {
  const birth = assertions.filter((item) => item.narratorId === narratorId && item.event === "birth");
  const death = assertions.filter((item) => item.narratorId === narratorId && item.event === "death");
  if (!birth.length || !death.length) return [];
  return birth.flatMap((start) => death
    .filter((end) => start.yearMin <= end.yearMax)
    .map((end) => ({ birthMin: start.yearMin, birthMax: start.yearMax, deathMin: end.yearMin, deathMax: end.yearMax })));
}

export function compareChronology(assertions: DateAssertion[], firstId: string, secondId: string) {
  const first = possibleLifeIntervals(assertions, firstId);
  const second = possibleLifeIntervals(assertions, secondId);
  if (!first.length || !second.length) return { result: "insufficient" as ChronologyResult, overlapYears: null, gapYears: null };

  let maximumOverlap = 0;
  let minimumGap = Number.POSITIVE_INFINITY;
  for (const a of first) {
    for (const b of second) {
      const overlap = Math.min(a.deathMax, b.deathMax) - Math.max(a.birthMin, b.birthMin);
      if (overlap >= 0) maximumOverlap = Math.max(maximumOverlap, overlap);
      else minimumGap = Math.min(minimumGap, Math.abs(overlap));
    }
  }
  if (maximumOverlap > 0) return { result: "possible" as ChronologyResult, overlapYears: maximumOverlap, gapYears: null };
  return { result: "impossible" as ChronologyResult, overlapYears: null, gapYears: Number.isFinite(minimumGap) ? minimumGap : null };
}

/**
 * Die konkreten Datierungsbelege, auf denen ein `compareChronology()`-Ergebnis
 * beruht. Damit kann jede angezeigte Chronologieaussage ihre Quellen mitnennen
 * (Abnahmekriterium: keine Datierung ohne Quellenreferenz).
 *
 * Gibt genau dann eine leere Liste zurueck, wenn `compareChronology()` fuer
 * dasselbe Paar `insufficient` liefert -- dann existiert keine Aussage und
 * folglich auch keine Quelle, die zu zeigen waere.
 */
export function chronologyEvidence(assertions: DateAssertion[], firstId: string, secondId: string): DateAssertion[] {
  if (!possibleLifeIntervals(assertions, firstId).length) return [];
  if (!possibleLifeIntervals(assertions, secondId).length) return [];
  return assertions.filter((item) => item.narratorId === firstId || item.narratorId === secondId);
}
