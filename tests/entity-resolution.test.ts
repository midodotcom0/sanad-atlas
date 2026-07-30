import { describe, expect, it } from "vitest";
import { rankIdentityCandidates, scoreIdentityCandidate, type IdentityProfile } from "../lib/entity-resolution";

const profile = (id: string, name: string, extra: Partial<IdentityProfile> = {}): IdentityProfile => ({ id, names: [name], teachers: [], students: [], ...extra });

describe("identity candidate scoring", () => {
  it("never turns a relative surface into a global person", () => {
    const result = scoreIdentityCandidate({ surface: "أبيه", previousNarratorIds: [], nextNarratorIds: [] }, profile("p1", "أبيه"));
    expect(result.confidence).toBe(0);
    expect(result.conflictingSignals).toContain("relative-or-anonymous-surface");
  });

  it("uses chain neighbors as evidence while keeping a decision required", () => {
    const candidates = [profile("right", "يحيى بن سعيد", { teachers: ["teacher"], students: ["student"] }), profile("other", "يحيى بن سعيد")];
    const ranked = rankIdentityCandidates({ surface: "يحيى بن سعيد", previousNarratorIds: ["teacher"], nextNarratorIds: ["student"] }, candidates);
    expect(ranked[0].narratorId).toBe("right");
    expect(ranked[0].requiresEditorialDecision).toBe(true);
  });

  it("penalizes a transmission placed after the candidate death", () => {
    const result = scoreIdentityCandidate({ surface: "مالك", previousNarratorIds: [], nextNarratorIds: [], transmissionYear: 220 }, profile("malik", "مالك", { deathYearMax: 179 }));
    expect(result.conflictingSignals).toContain("post-death-transmission");
    expect(result.confidence).toBeLessThan(0.2);
  });
});
