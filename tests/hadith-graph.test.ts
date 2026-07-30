import { describe, expect, it } from "vitest";
import { toHadithGraph } from "../lib/hadith-graph";
import type { HadithGraphPayload } from "../lib/api-client";

const payload: HadithGraphPayload = {
  hadith: { id: "h1", collection: "bukhari", hadithNumber: 1, chainCount: 2, narratorOccurrenceCount: 5, parser: { confidence: .7, state: "parsed", reviewStatus: "unreviewed" } },
  chains: [
    {
      chainOrder: 0, chainId: "h1#c0", rawIsnad: "a b", spanStart: 0, spanEnd: 40,
      narratorOccurrences: [
        // Relative Namensform: eigener Status plus eigenes Merkmal. Der frueher
        // hier stehende Mischwert "unresolved-relative" ist entfallen, weil er
        // Identitaetsstand und Namensform in einem Feld vermischte.
        { position: 0, rawSurfaceForm: "أَبِيهِ", normalizedSurfaceForm: "ابيه", identityStatus: "unresolved", relativeForm: true, transmissionTerm: "عن", spanStart: 4, spanEnd: 11 },
        { position: 1, rawSurfaceForm: "مَالِك", normalizedSurfaceForm: "مالك", identityStatus: "unresolved", relativeForm: false, transmissionTerm: "حدثنا", spanStart: 18, spanEnd: 24 },
      ],
    },
    {
      chainOrder: 1, chainId: "h1#c1", rawIsnad: "a b", spanStart: 40, spanEnd: 90,
      narratorOccurrences: [
        { position: 0, rawSurfaceForm: "أَبِيهِ", normalizedSurfaceForm: "ابيه", identityStatus: "unresolved", relativeForm: true, spanStart: 44, spanEnd: 51 },
        { position: 1, rawSurfaceForm: "يَحْيَى", normalizedSurfaceForm: "يحيي", identityStatus: "unresolved", spanStart: 58, spanEnd: 66 },
        // Rohform mit Diakritika: `includes("رسول الله")` wuerde hier scheitern.
        { position: 2, rawSurfaceForm: "رَسُولِ اللَّهِ ﷺ", normalizedSurfaceForm: "رسول الله", identityStatus: "unresolved", prophetMention: true, spanStart: 70, spanEnd: 88 },
      ],
    },
  ],
  sourceReferences: [{ sourcePassageId: "p1", work: "bukhari" }],
  dataVersion: "v1",
  confidenceLevel: "unresolved",
  reviewStatus: "machine_unreviewed",
};

describe("live hadith graph adapter", () => {
  it("keeps each narrator occurrence separate and reconstructs every chain edge", () => {
    const graph = toHadithGraph(payload);
    expect(graph.nodes).toHaveLength(5);
    expect(new Set(graph.nodes.map((node) => node.data.id)).size).toBe(5);
    expect(graph.edges).toHaveLength(3);
    expect(graph.sources).toHaveLength(1);
  });

  it("marks the prophet from the importer flag, not from a diacritic-sensitive substring", () => {
    const graph = toHadithGraph(payload);
    const prophetNodes = graph.nodes.filter((node) => node.data.kind === "prophet");
    expect(prophetNodes).toHaveLength(1);
    expect(prophetNodes[0].data.label).toContain("رَسُول");
    expect(graph.nodes.filter((node) => node.classes === "prophet")).toHaveLength(1);
  });

  it("passes the identity status through unchanged and never invents a verified one", () => {
    const graph = toHadithGraph(payload);
    expect(new Set(graph.nodes.map((node) => node.data.status))).toEqual(new Set(["unresolved"]));
    expect(graph.nodes.some((node) => node.data.status === "verified")).toBe(false);
  });

  it("keeps a relative name form bound to its chain position and never global", () => {
    const graph = toHadithGraph(payload);
    const relative = Object.entries(graph.occurrences).filter(([, item]) => item.relativeForm);
    expect(relative).toHaveLength(2);
    // Gleiche Namensform, zwei Ketten, zwei getrennte Knoten und Offsets.
    expect(new Set(relative.map(([id]) => id)).size).toBe(2);
    expect(relative.map(([, item]) => item.chainOrder).sort()).toEqual([0, 1]);
    expect(relative.map(([, item]) => item.spanStart)).toEqual([4, 44]);
  });

  it("labels every chain edge as an isnad link, never as a chronological possibility", () => {
    const graph = toHadithGraph(payload);
    expect(graph.edges.every((edge) => edge.data.evidence === "isnad_link")).toBe(true);
    expect(graph.edges.some((edge) => edge.data.evidence === "chronology_only")).toBe(false);
    // Der Ueberlieferungsbegriff der Stelle wird uebernommen, nicht geraten.
    expect(graph.edges[0].data.verb).toBe("حدثنا");
  });
});

/**
 * P5.6 -- gemeinsame Kettenabschnitte deduplizieren.
 *
 * Zwei Ketten desselben Hadith laufen hier auf ein gemeinsames,
 * Propheten-nahes Stueck zusammen (hohe Positionsnummer) und divergieren erst
 * naeher am Sammler (Position 0). Vorher haette jede Kette dafuer eigene
 * Knoten und Kanten bekommen; jetzt muss der geteilte Abschnitt genau einmal
 * erscheinen, mit einer gestapelten Kante, die beide Ketten ausweist.
 */
const sharedTailPayload: HadithGraphPayload = {
  hadith: { id: "h2", collection: "bukhari", hadithNumber: 2, chainCount: 2, narratorOccurrenceCount: 6, parser: { confidence: 0.7, state: "parsed", reviewStatus: "unreviewed" } },
  chains: [
    {
      chainOrder: 0, chainId: "h2#c0", rawIsnad: "z o n", spanStart: 0, spanEnd: 30,
      narratorOccurrences: [
        { position: 0, rawSurfaceForm: "زيد", normalizedSurfaceForm: "زيد", identityStatus: "unresolved", transmissionTerm: "عن" },
        { position: 1, rawSurfaceForm: "عمر", normalizedSurfaceForm: "عمر", identityStatus: "unresolved", transmissionTerm: "حدثنا" },
        { position: 2, rawSurfaceForm: "النبي", normalizedSurfaceForm: "النبي", identityStatus: "unresolved", prophetMention: true, transmissionTerm: "عن" },
      ],
    },
    {
      chainOrder: 1, chainId: "h2#c1", rawIsnad: "b o n", spanStart: 30, spanEnd: 60,
      narratorOccurrences: [
        { position: 0, rawSurfaceForm: "بكر", normalizedSurfaceForm: "بكر", identityStatus: "conflict", transmissionTerm: "عن" },
        { position: 1, rawSurfaceForm: "عمر", normalizedSurfaceForm: "عمر", identityStatus: "unresolved", transmissionTerm: "حدثنا" },
        { position: 2, rawSurfaceForm: "النبي", normalizedSurfaceForm: "النبي", identityStatus: "unresolved", prophetMention: true, transmissionTerm: "عن" },
      ],
    },
  ],
  sourceReferences: [{ sourcePassageId: "p2", work: "bukhari" }],
  dataVersion: "v1",
  confidenceLevel: "unresolved",
  reviewStatus: "machine_unreviewed",
};

describe("shared chain segment deduplication (P5.6)", () => {
  it("merges the shared prophet-near tail into single stacked nodes and edges", () => {
    const graph = toHadithGraph(sharedTailPayload);
    // Ohne Zusammenfassung waeren es 6 Knoten und 4 Kanten (3 je Kette bzw. 2 Kanten je Kette).
    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toHaveLength(3);
  });

  it("keeps the divergence point (position 0, before the shared tail) separate per chain", () => {
    const graph = toHadithGraph(sharedTailPayload);
    const zayd = graph.nodes.find((node) => node.data.label === "زيد");
    const bakr = graph.nodes.find((node) => node.data.label === "بكر");
    expect(zayd?.data.id).not.toBe(bakr?.data.id);
    expect(zayd?.data.contributors).toBeUndefined();
    expect(bakr?.data.contributors).toBeUndefined();
  });

  it("stacks the shared edge with a count and a contributor per chain -- no individual evidence is lost", () => {
    const graph = toHadithGraph(sharedTailPayload);
    const prophetNode = graph.nodes.find((node) => node.data.label === "النبي");
    expect(prophetNode?.data.contributors).toHaveLength(2);
    expect(prophetNode?.data.contributors?.map((c) => c.chainOrder).sort()).toEqual([0, 1]);

    const sharedEdge = graph.edges.find((edge) => edge.data.target === prophetNode?.data.id);
    expect(sharedEdge?.data.count).toBe(2);
    expect(sharedEdge?.data.contributors).toHaveLength(2);
    expect(sharedEdge?.data.contributors?.map((c) => c.chainOrder).sort()).toEqual([0, 1]);
    // Jede beitragende Kette bleibt einzeln mit ihrer eigenen Position auffindbar
    // -- die Kante beginnt an "عمر" (Position 1 in beiden Ketten) und endet am
    // gestapelten "النبي"-Knoten.
    expect(sharedEdge?.data.contributors?.every((c) => c.position === 1)).toBe(true);
  });

  it("keeps the most cautious identity status when a merged node's contributors disagree", () => {
    const graph = toHadithGraph(sharedTailPayload);
    // "عمر" ist bei beiden Ketten `unresolved`, wird also unveraendert uebernommen.
    const umar = graph.nodes.find((node) => node.data.label === "عمر");
    expect(umar?.data.status).toBe("unresolved");
  });

  it("never merges a relative name form across chains, even with identical text at the same depth", () => {
    const relativeFormPayload: HadithGraphPayload = {
      hadith: { id: "h3", collection: "muslim", hadithNumber: 3, chainCount: 2, narratorOccurrenceCount: 2, parser: { confidence: 0.6, state: "parsed", reviewStatus: "unreviewed" } },
      chains: [
        { chainOrder: 0, chainId: "h3#c0", rawIsnad: "a", spanStart: 0, spanEnd: 10, narratorOccurrences: [{ position: 0, rawSurfaceForm: "أَبِيهِ", normalizedSurfaceForm: "ابيه", identityStatus: "unresolved", relativeForm: true }] },
        { chainOrder: 1, chainId: "h3#c1", rawIsnad: "a", spanStart: 10, spanEnd: 20, narratorOccurrences: [{ position: 0, rawSurfaceForm: "أَبِيهِ", normalizedSurfaceForm: "ابيه", identityStatus: "unresolved", relativeForm: true }] },
      ],
      sourceReferences: [],
      dataVersion: "v1",
      confidenceLevel: "unresolved",
      reviewStatus: "machine_unreviewed",
    };
    const graph = toHadithGraph(relativeFormPayload);
    expect(graph.nodes).toHaveLength(2);
    expect(new Set(graph.nodes.map((node) => node.data.id)).size).toBe(2);
    expect(graph.nodes.every((node) => node.data.contributors === undefined)).toBe(true);
  });
});
