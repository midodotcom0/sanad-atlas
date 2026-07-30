import { describe, expect, it } from "vitest";
import { normalizeMatnColorToken, toMatnFamilyGraph } from "../lib/hadith-graph";
import type { MatnFamily, MatnRoutesPayload } from "../lib/types";

const families: MatnFamily[] = [
  { id: "family-alpha", colorToken: "teal", representativeText: "متن أول", textWithheld: false, hadithIds: ["h1"], reviewStatus: "machine_unreviewed" },
  { id: "family-beta", colorToken: "clay", representativeText: "متن ثان", textWithheld: false, hadithIds: ["h2"], reviewStatus: "machine_unreviewed" },
];

const routes: MatnRoutesPayload = {
  clusterId: "HCL-test",
  nodes: [
    { id: "a", label: "أ", identityStatus: "unresolved", reviewStatus: "machine_unreviewed", isRelativeReference: false },
    { id: "b", label: "ب", identityStatus: "unresolved", reviewStatus: "machine_unreviewed", isRelativeReference: false },
  ],
  edges: [{
    id: "a:b",
    source: "a",
    target: "b",
    evidenceKind: "isnad_link",
    occurrences: [
      { hadithId: "h1", chainOrder: 0, position: 1 },
      { hadithId: "h2", chainOrder: 2, position: 1 },
    ],
    // Der heutige API-Vertrag traegt hier Cluster-Fingerprints. P5.4 darf
    // diese nicht mit den Familien-IDs verwechseln.
    matnFamilies: ["test"],
  }],
  recordCount: 2,
  truncated: false,
};

describe("Matn-Familiengraph (P5.4)", () => {
  it("links route occurrences to families through the real hadithId fields", () => {
    const graph = toMatnFamilyGraph(routes, families);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.map((edge) => edge.data.matnFamilyIds)).toEqual([["family-alpha"], ["family-beta"]]);
    expect(graph.edges.map((edge) => edge.data.matnColorToken)).toEqual(["teal", "clay"]);
  });

  it("keeps shared isnad segments as parallel, family-labelled edges", () => {
    const graph = toMatnFamilyGraph(routes, families);
    expect(new Set(graph.edges.map((edge) => edge.data.id)).size).toBe(2);
    expect(graph.edges.every((edge) => edge.data.source === "a" && edge.data.target === "b")).toBe(true);
    expect(graph.edges.every((edge) => Boolean(edge.data.matnFamilyLabel))).toBe(true);
    expect(graph.nodes.every((node) => node.data.matnFamilyIds?.length === 2)).toBe(true);
  });

  it("uses a deterministic safe token for an unknown payload token", () => {
    const first = normalizeMatnColorToken("family-stable", "not-a-css-token");
    const second = normalizeMatnColorToken("family-stable", "still-not-a-css-token");
    expect(first).toBe(second);
    expect(["teal", "clay", "gold", "ink", "sage"]).toContain(first);
  });

  it("does not drop an evidence edge when an occurrence has no matching family", () => {
    const graph = toMatnFamilyGraph(routes, families.slice(0, 1));
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.some((edge) => edge.data.matnFamilyIds?.length === 0)).toBe(true);
  });
});
