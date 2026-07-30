import { describe, expect, it } from "vitest";
import { compareChronology, possibleLifeIntervals } from "../lib/chronology";
import type { DateAssertion } from "../lib/types";

const assertion = (id: string, narratorId: string, event: "birth" | "death", yearMin: number, yearMax = yearMin): DateAssertion => ({
  id, narratorId, event, yearMin, yearMax, precision: yearMin === yearMax ? "exact" : "range",
  sourceKey: "ibn-hajar", sourceLabel: "ابن حجر", reference: "موضع تجريبي", reviewStatus: "pending",
});

describe("source-bound chronology", () => {
  it("keeps every asserted date as a separate life possibility", () => {
    const data = [assertion("a-b", "a", "birth", 10), assertion("a-d1", "a", "death", 80), assertion("a-d2", "a", "death", 82)];
    expect(possibleLifeIntervals(data, "a")).toHaveLength(2);
  });

  it("reports overlap without claiming a meeting", () => {
    const data = [assertion("a-b", "a", "birth", 10), assertion("a-d", "a", "death", 80), assertion("b-b", "b", "birth", 60), assertion("b-d", "b", "death", 110)];
    expect(compareChronology(data, "a", "b")).toEqual({ result: "possible", overlapYears: 20, gapYears: null });
  });

  it("reports a gap when every possible interval is separate", () => {
    const data = [assertion("a-b", "a", "birth", 10), assertion("a-d", "a", "death", 40), assertion("b-b", "b", "birth", 55), assertion("b-d", "b", "death", 90)];
    expect(compareChronology(data, "a", "b")).toEqual({ result: "impossible", overlapYears: null, gapYears: 15 });
  });

  it("does not estimate a birth year from a death year", () => {
    const data = [assertion("a-d", "a", "death", 80), assertion("b-b", "b", "birth", 55), assertion("b-d", "b", "death", 90)];
    expect(compareChronology(data, "a", "b").result).toBe("insufficient");
  });
});
