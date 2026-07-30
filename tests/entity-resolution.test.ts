import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEIGHT_PROFILE,
  applyCompetingCandidatesRule,
  assertMachineLevel,
  buildProposal,
  proposeIdentity,
  rankIdentityCandidates,
  scoreIdentityCandidate,
  type IdentityCandidateScore,
  type IdentityProfile,
  type OccurrenceContext,
} from "../lib/entity-resolution";
import type { DateAssertion } from "../lib/types";

/**
 * Abnahme zu P4.2 und P4.3: jedes der neun Signale aus docs/05 ist EINZELN
 * nachgewiesen, jede der drei harten Regeln blockiert nachweisbar, und kein
 * Pfad erzeugt jemals `verified`.
 */

const profile = (id: string, name: string, extra: Partial<IdentityProfile> = {}): IdentityProfile =>
  ({ id, names: [name], teachers: [], students: [], ...extra });

const context = (surface: string, extra: Partial<OccurrenceContext> = {}): OccurrenceContext =>
  ({ surface, citingNarratorIds: [], citedNarratorIds: [], ...extra });

const dated = (narratorId: string, event: "birth" | "death", yearMin: number, yearMax = yearMin): DateAssertion => ({
  id: `${narratorId}-${event}-${yearMin}`,
  narratorId,
  event,
  precision: yearMin === yearMax ? "exact" : "range",
  yearMin,
  yearMax,
  sourceKey: "ibn-hajar",
  sourceLabel: "تهذيب التهذيب",
  reference: "ج١ ص١",
  reviewStatus: "reviewed",
});

const appliedFor = (result: IdentityCandidateScore, signal: string) =>
  result.contributions.find((item) => item.signal === signal)?.applied;

describe("Signal 1 — kanonische Namensaehnlichkeit", () => {
  it("wiegt exakte Gleichheit mit 0,22 statt der frueheren 0,52", () => {
    const result = scoreIdentityCandidate(context("يحيى بن سعيد"), profile("p1", "يحيى بن سعيد"));
    expect(appliedFor(result, "canonicalNameSimilarity")).toBe(DEFAULT_WEIGHT_PROFILE.signals.canonicalNameSimilarity.weight);
    expect(DEFAULT_WEIGHT_PROFILE.signals.canonicalNameSimilarity.weight).toBe(0.22);
    expect(result.matchingSignals).toContain("canonical-name-similarity:exact");
  });

  it("rechnet Teiltreffer nur anteilig an", () => {
    const partial = scoreIdentityCandidate(context("يحيى بن سعيد الانصاري"), profile("p1", "يحيى بن سعيد"));
    const exact = scoreIdentityCandidate(context("يحيى بن سعيد"), profile("p1", "يحيى بن سعيد"));
    const partialApplied = appliedFor(partial, "canonicalNameSimilarity") ?? 0;
    expect(partialApplied).toBeGreaterThan(0);
    expect(partialApplied).toBeLessThan(appliedFor(exact, "canonicalNameSimilarity") ?? 0);
  });
});

describe("Signal 2 — bekannte Namensvariante", () => {
  it("feuert ueber eine hinterlegte Variante statt ueber den Hauptnamen", () => {
    const result = scoreIdentityCandidate(context("ابو سعيد"), profile("p1", "يحيى بن سعيد", { variants: ["ابو سعيد"] }));
    expect(result.matchingSignals).toContain("known-name-variant");
    expect(appliedFor(result, "knownNameVariant")).toBe(0.18);
  });
});

describe("Signal 3 — Lehrer-/Schuelernachbarschaft", () => {
  it("rechnet je belegter Nachbarschaft anteilig an und deckelt auf das Gesamtgewicht", () => {
    const both = scoreIdentityCandidate(
      context("يحيى بن سعيد", { citingNarratorIds: ["student"], citedNarratorIds: ["teacher"] }),
      profile("p1", "يحيى بن سعيد", { teachers: ["teacher"], students: ["student"] }),
    );
    const one = scoreIdentityCandidate(
      context("يحيى بن سعيد", { citedNarratorIds: ["teacher"] }),
      profile("p1", "يحيى بن سعيد", { teachers: ["teacher"], students: [] }),
    );
    expect(appliedFor(one, "teacherStudentNeighbourhood")).toBe(0.11);
    expect(appliedFor(both, "teacherStudentNeighbourhood")).toBe(0.22);
    expect(appliedFor(both, "teacherStudentNeighbourhood")).toBeLessThanOrEqual(
      DEFAULT_WEIGHT_PROFILE.signals.teacherStudentNeighbourhood.weight,
    );
  });

  it("bevorzugt den Kandidaten mit belegter Nachbarschaft, verlangt aber weiter eine Entscheidung", () => {
    const candidates = [
      profile("right", "يحيى بن سعيد", { teachers: ["teacher"], students: ["student"] }),
      profile("other", "يحيى بن سعيد"),
    ];
    const ranked = rankIdentityCandidates(
      context("يحيى بن سعيد", { citingNarratorIds: ["student"], citedNarratorIds: ["teacher"] }),
      candidates,
    );
    expect(ranked[0].narratorId).toBe("right");
    expect(ranked[0].requiresEditorialDecision).toBe(true);
    expect(ranked[0].reviewStatus).toBe("machine_unreviewed");
  });
});

describe("Signal 4 — Chronologie plausibel", () => {
  const assertions = [
    dated("cand", "birth", 60), dated("cand", "death", 140),
    dated("neighbour", "birth", 90), dated("neighbour", "death", 170),
  ];

  it("feuert nur aus compareChronology() und nur bei belegter Ueberlappung", () => {
    const result = scoreIdentityCandidate(
      context("مالك", { dateAssertions: assertions, neighbourChronologyIds: ["neighbour"] }),
      profile("p1", "مالك", { chronologyId: "cand" }),
    );
    expect(result.matchingSignals).toContain("chronology-possible");
    expect(appliedFor(result, "chronologyPlausible")).toBe(0.14);
  });

  it("belohnt und bestraft nicht, wenn die Datenlage nicht ausreicht", () => {
    const result = scoreIdentityCandidate(
      context("مالك", { dateAssertions: [dated("cand", "death", 140)], neighbourChronologyIds: ["neighbour"] }),
      profile("p1", "مالك", { chronologyId: "cand" }),
    );
    expect(result.matchingSignals).not.toContain("chronology-possible");
    expect(result.conflictingSignals).not.toContain("impossible-chronology");
    expect(result.hardBlocks).toHaveLength(0);
  });
});

describe("Signal 5 und 6 — Region/Reise und Buch-/Autor-Muster", () => {
  it("erkennt Region und Reisestation", () => {
    const result = scoreIdentityCandidate(
      context("مالك", { region: "المدينة" }),
      profile("p1", "مالك", { regions: ["المدينة", "مكة"] }),
    );
    expect(result.matchingSignals).toContain("region-or-travel-plausible");
    expect(appliedFor(result, "regionTravelPlausible")).toBe(0.08);
  });

  it("erkennt die Zuordnung zur Sammlung, in der die Position steht", () => {
    const result = scoreIdentityCandidate(
      context("مالك", { collection: "bukhari" }),
      profile("p1", "مالك", { collections: ["bukhari"] }),
    );
    expect(result.matchingSignals).toContain("book-author-pattern");
    expect(appliedFor(result, "bookAuthorPattern")).toBe(0.06);
  });
});

describe("Signal 7 — widersprüchliches Todesjahr", () => {
  it("bestraft eine Ueberlieferung nach dem belegten Todesjahr", () => {
    const result = scoreIdentityCandidate(
      context("مالك", { transmissionYear: 220 }),
      profile("malik", "مالك", { deathYearMax: 179 }),
    );
    expect(result.conflictingSignals).toContain("contradictory-death-year");
    expect(appliedFor(result, "contradictoryDeathYear")).toBe(-0.25);
    expect(result.confidenceScore).toBeLessThan(0.2);
  });

  it("rechnet den Abzug auch bei beiden Teilbefunden nur einmal an", () => {
    const result = scoreIdentityCandidate(
      context("مالك", { transmissionYear: 220, deathYearAssertions: [dated("pos", "death", 300)] }),
      profile("malik", "مالك", { deathYearMax: 179, deathYears: [179] }),
    );
    expect(result.contributions.filter((item) => item.signal === "contradictoryDeathYear")).toHaveLength(1);
  });
});

describe("Harte Regel 1 — unmoegliche Chronologie", () => {
  it("blockiert den Auto-Merge und fuehrt den Kandidaten als conflict mit Begruendung", () => {
    const assertions = [
      dated("cand", "birth", 20), dated("cand", "death", 80),
      dated("neighbour", "birth", 150), dated("neighbour", "death", 210),
    ];
    const occurrence = context("مالك", { dateAssertions: assertions, neighbourChronologyIds: ["neighbour"] });
    const candidate = profile("p1", "مالك", { chronologyId: "cand" });
    const result = scoreIdentityCandidate(occurrence, candidate);

    expect(result.confidenceLevel).toBe("conflict");
    expect(result.hardBlocks.map((block) => block.rule)).toContain("impossible-chronology");
    expect(result.hardBlocks[0].rationale).toMatch(/compareChronology/);

    const proposal = proposeIdentity(occurrence, [candidate]);
    expect(proposal.autoLinkAllowed).toBe(false);
    expect(proposal.confidenceLevel).toBe("conflict");
  });
});

describe("Harte Regel 2 — expliziter Quellenkonflikt", () => {
  it("blockiert bei belegter Gegenaussage", () => {
    const occurrence = context("مالك", {
      sourceConflicts: [{ candidateId: "p1", sourcePassageId: "SP-1", statement: "ليس هو" }],
    });
    const proposal = proposeIdentity(occurrence, [profile("p1", "مالك")]);
    expect(proposal.autoLinkAllowed).toBe(false);
    expect(proposal.confidenceLevel).toBe("conflict");
    expect(proposal.hardBlocks[0].sourcePassageId).toBe("SP-1");
  });

  it("bleibt wirkungslos, wenn die Behauptung keine Quellenstelle nennt", () => {
    const result = scoreIdentityCandidate(
      context("مالك", { sourceConflicts: [{ candidateId: "p1", sourcePassageId: "" }] }),
      profile("p1", "مالك"),
    );
    expect(result.hardBlocks).toHaveLength(0);
    expect(result.notes).toContain("source-conflict-claim-without-passage-ignored");
  });
});

describe("Harte Regel 3 — konkurrierende starke Kandidaten", () => {
  const strong = (id: string, score: number): IdentityCandidateScore => ({
    narratorId: id,
    confidenceScore: score,
    confidenceLevel: "high",
    matchingSignals: ["canonical-name-similarity:exact"],
    conflictingSignals: [],
    contributions: [],
    hardBlocks: [],
    notes: [],
    requiresEditorialDecision: true,
    origin: "machine",
    reviewStatus: "machine_unreviewed",
    weightProfileVersion: DEFAULT_WEIGHT_PROFILE.weightProfileVersion,
    resolverVersion: DEFAULT_WEIGHT_PROFILE.resolverVersion,
    relativeFormVersion: "test",
  });

  it("setzt beide auf conflict, wenn zwei ab 0,80 weniger als 0,05 auseinanderliegen", () => {
    const candidates = [strong("a", 0.86), strong("b", 0.83)];
    const block = applyCompetingCandidatesRule(candidates);
    expect(block?.rule).toBe("competing-strong-candidates");
    expect(candidates.every((item) => item.confidenceLevel === "conflict")).toBe(true);
    expect(buildProposal(context("مالك"), candidates).autoLinkAllowed).toBe(false);
  });

  it("greift nicht bei ausreichendem Abstand", () => {
    const candidates = [strong("a", 0.92), strong("b", 0.71)];
    expect(applyCompetingCandidatesRule(candidates)).toBeNull();
    expect(candidates[0].confidenceLevel).toBe("high");
  });

  it("greift nicht unterhalb der Mindeststaerke", () => {
    expect(applyCompetingCandidatesRule([strong("a", 0.74), strong("b", 0.73)])).toBeNull();
  });
});

describe("Positionsbindung und maschinelle Zusicherungen", () => {
  it("macht aus einer relativen Form niemals eine globale Person", () => {
    const result = scoreIdentityCandidate(context("أبيه"), profile("p1", "أبيه"));
    expect(result.confidenceScore).toBe(0);
    expect(result.conflictingSignals).toContain("relative-or-anonymous-surface");
  });

  it("erlaubt `verified` auf keinem maschinellen Pfad", () => {
    expect(() => assertMachineLevel("verified")).toThrow();
    const proposal = proposeIdentity(
      context("يحيى بن سعيد", { citingNarratorIds: ["student"], citedNarratorIds: ["teacher"], region: "المدينة", collection: "bukhari" }),
      [profile("p1", "يحيى بن سعيد", { teachers: ["teacher"], students: ["student"], regions: ["المدينة"], collections: ["bukhari"] })],
    );
    expect(proposal.confidenceLevel).not.toBe("verified");
    expect(proposal.candidates.every((item) => item.confidenceLevel !== "verified")).toBe(true);
    expect(proposal.origin).toBe("machine");
    expect(proposal.reviewStatus).toBe("machine_unreviewed");
  });

  it("fuehrt die Gewichtsversion mit, damit ein gespeicherter Score zuordenbar bleibt", () => {
    const proposal = proposeIdentity(context("مالك"), [profile("p1", "مالك")]);
    expect(proposal.weightProfileVersion).toBe("er-weights-v1");
    expect(proposal.resolverVersion).toBe(DEFAULT_WEIGHT_PROFILE.resolverVersion);
    expect(proposal.candidates[0]?.weightProfileVersion).toBe(proposal.weightProfileVersion);
  });

  it("bleibt ohne jeden Kandidaten unresolved statt etwas zu behaupten", () => {
    const proposal = proposeIdentity(context("رجل مجهول"), []);
    expect(proposal.confidenceLevel).toBe("unresolved");
    expect(proposal.best).toBeNull();
    expect(proposal.autoLinkAllowed).toBe(false);
  });
});
