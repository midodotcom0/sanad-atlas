import { describe, expect, it } from "vitest";
import { chronologyEvidence, compareChronology, possibleLifeIntervals } from "../lib/chronology";
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

  it("names the assertions a verdict rests on, and none when there is no verdict", () => {
    const complete = [assertion("a-b", "a", "birth", 10), assertion("a-d", "a", "death", 80), assertion("b-b", "b", "birth", 60), assertion("b-d", "b", "death", 110)];
    expect(chronologyEvidence(complete, "a", "b").map((item) => item.id)).toEqual(["a-b", "a-d", "b-b", "b-d"]);
    // Ohne belegtes Geburtsjahr fuer "a" gibt es kein Ergebnis und damit auch
    // keine Quelle, die eine Datierung tragen koennte.
    const incomplete = [assertion("a-d", "a", "death", 80), assertion("b-b", "b", "birth", 60), assertion("b-d", "b", "death", 110)];
    expect(compareChronology(incomplete, "a", "b").result).toBe("insufficient");
    expect(chronologyEvidence(incomplete, "a", "b")).toEqual([]);
  });

  it("returns only the three sanctioned outcomes", () => {
    const data = [assertion("a-b", "a", "birth", 10), assertion("a-d", "a", "death", 40), assertion("b-b", "b", "birth", 55), assertion("b-d", "b", "death", 90)];
    for (const pair of [["a", "b"], ["a", "a"], ["a", "c"], ["c", "d"]] as const) {
      expect(["possible", "impossible", "insufficient"]).toContain(compareChronology(data, pair[0], pair[1]).result);
    }
  });
});
