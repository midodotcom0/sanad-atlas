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
