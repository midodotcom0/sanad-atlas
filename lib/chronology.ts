import type { DateAssertion } from "./types";

export type ChronologyResult = "possible" | "impossible" | "insufficient";

export interface LifeInterval {
  birthMin: number;
  birthMax: number;
  deathMin: number;
  deathMax: number;
}

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
