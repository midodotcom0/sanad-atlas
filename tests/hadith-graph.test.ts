import { describe, expect, it } from "vitest";
import { toHadithGraph } from "../lib/hadith-graph";

describe("live hadith graph adapter", () => {
  it("keeps each narrator occurrence separate and reconstructs every chain edge", () => {
    const graph = toHadithGraph({
      hadith: { id: "h1", collection: "bukhari", hadithNumber: 1, chainCount: 2, narratorOccurrenceCount: 4, parser: { confidence: .7, state: "parsed", reviewStatus: "unreviewed" } },
      chains: [
        { chainOrder: 0, rawIsnad: "a b", narratorOccurrences: [{ position: 0, rawSurfaceForm: "أبيه", normalizedSurfaceForm: "ابيه", identityStatus: "unresolved-relative" }, { position: 1, rawSurfaceForm: "مالك", normalizedSurfaceForm: "مالك", identityStatus: "unresolved" }] },
        { chainOrder: 1, rawIsnad: "a b", narratorOccurrences: [{ position: 0, rawSurfaceForm: "أبيه", normalizedSurfaceForm: "ابيه", identityStatus: "unresolved-relative" }, { position: 1, rawSurfaceForm: "يحيى", normalizedSurfaceForm: "يحيي", identityStatus: "unresolved" }] },
      ],
      sourceReferences: [{ sourceWork: "bukhari" }], dataVersion: "v1",
    });
    expect(graph.nodes).toHaveLength(4);
    expect(new Set(graph.nodes.map((node) => node.data.id)).size).toBe(4);
    expect(graph.edges).toHaveLength(2);
    expect(graph.sources).toHaveLength(1);
  });
});
