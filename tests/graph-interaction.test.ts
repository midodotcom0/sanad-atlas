import { describe, expect, it } from "vitest";
import { buildKeyboardEdgeItems, classifyEdgeEvidence, describeEdgeEvidence } from "../lib/hadith-graph";
import type { GraphEdge, GraphNode } from "../lib/types";

/**
 * P5.3 -- Kantenklick mit vollstaendiger Belegliste, drei getrennte
 * Evidenzklassen. P5.7 -- Tastaturbedienung fuer Kanten.
 *
 * Cytoscape rendert auf einem `<canvas>` und laeuft in jsdom nicht
 * vollstaendig (siehe Auftrag). Getestet wird deshalb ausschliesslich die
 * reine Logik hinter der Darstellung: Klassenzuordnung, Belegliste und
 * Tastaturreihenfolge -- alles ausgelagert nach `lib/hadith-graph.ts`, damit
 * sowohl `components/atlas-graph.tsx` als auch
 * `components/views/graph-workspace.tsx` dieselbe Quelle verwenden (letztere
 * darf `atlas-graph.tsx` laut `tests/frontend-structure.test.ts` nicht
 * statisch importieren).
 */

function edge(overrides: Partial<GraphEdge["data"]> & { classes?: string }): GraphEdge {
  const { classes, ...data } = overrides;
  return {
    data: { id: "e1", source: "a", target: "b", verb: "عن", evidence: "isnad", collection: "البخاري", count: 1, ...data },
    classes,
  };
}

describe("classifyEdgeEvidence -- three separate evidence kinds (P5.3)", () => {
  it("recognises the canonical EvidenceKind values from live API data unchanged", () => {
    expect(classifyEdgeEvidence(edge({ evidence: "isnad_link", classes: "isnad" }))).toEqual({ kind: "isnad_link", identityUncertain: false });
    expect(classifyEdgeEvidence(edge({ evidence: "rijal_statement" }))).toEqual({ kind: "rijal_statement", identityUncertain: false });
    expect(classifyEdgeEvidence(edge({ evidence: "chronology_only" }))).toEqual({ kind: "chronology_only", identityUncertain: false });
  });

  it("maps the legacy mock-data vocabulary to the contractual evidence kinds", () => {
    expect(classifyEdgeEvidence(edge({ evidence: "isnad", classes: "isnad" }))).toEqual({ kind: "isnad_link", identityUncertain: false });
    expect(classifyEdgeEvidence(edge({ evidence: "biographical", classes: "biographical" }))).toEqual({ kind: "rijal_statement", identityUncertain: false });
  });

  it("separates identity uncertainty (still an isnad link) from a bare chronological possibility", () => {
    // Kettenbeleg mit unklarer Identitaet an dieser Stelle (frueher: `uncertain`-Klasse
    // in `hadithEdges`, Beleg fuer die Kette steht trotzdem).
    const identityUncertainInChain = edge({ evidence: "candidate", classes: "uncertain variant-c" });
    expect(classifyEdgeEvidence(identityUncertainInChain)).toEqual({ kind: "isnad_link", identityUncertain: true });

    // Reine zeitliche Moeglichkeit ohne Isnad- oder Rijal-Beleg (frueher: `candidate`-Klasse
    // ohne `uncertain` in `egoEdges`).
    const chronologyOnly = edge({ evidence: "candidate", classes: "candidate" });
    expect(classifyEdgeEvidence(chronologyOnly)).toEqual({ kind: "chronology_only", identityUncertain: false });

    // Diese beiden Faelle sind fachlich verschieden und duerfen nie dieselbe Klasse liefern.
    expect(classifyEdgeEvidence(identityUncertainInChain).kind).not.toBe(classifyEdgeEvidence(chronologyOnly).kind);
  });

  it("falls back to isnad_link for unrecognised legacy evidence without dropping data", () => {
    expect(classifyEdgeEvidence(edge({ evidence: "", classes: "" }))).toEqual({ kind: "isnad_link", identityUncertain: false });
  });
});

describe("describeEdgeEvidence -- the full evidence list behind a click (P5.3)", () => {
  it("names the evidence kind, the verb, the collection and the raw witness count", () => {
    const description = describeEdgeEvidence(edge({ verb: "حدثنا", collection: "مسلم", count: 7 }));
    expect(description.kind).toBe("isnad_link");
    expect(description.facts.some((fact) => fact.includes("حدثنا"))).toBe(true);
    expect(description.facts.some((fact) => fact.includes("مسلم"))).toBe(true);
    expect(description.facts.some((fact) => fact.includes("7"))).toBe(true);
  });

  it("lists every contributing chain of a stacked edge without losing any of them", () => {
    const description = describeEdgeEvidence(edge({
      contributors: [
        { chainOrder: 0, position: 2, spanStart: 10, spanEnd: 14 },
        { chainOrder: 3, position: 2, spanStart: 40, spanEnd: 44 },
      ],
    }));
    const contributorFact = description.facts.find((fact) => fact.includes("مشتركة"));
    expect(contributorFact).toBeDefined();
    expect(contributorFact).toContain("2");
    // Kettennummern 1-basiert in der Anzeige (chainOrder 0 und 3 -> Kette 1 und 4).
    expect(contributorFact).toContain("1");
    expect(contributorFact).toContain("4");
  });

  it("flags identity-uncertain isnad links explicitly, distinct from a chronology-only note", () => {
    const uncertain = describeEdgeEvidence(edge({ classes: "uncertain" }));
    expect(uncertain.facts.some((fact) => fact.includes("غير محسومة"))).toBe(true);

    const chronologyOnly = describeEdgeEvidence(edge({ evidence: "chronology_only" }));
    expect(chronologyOnly.facts.some((fact) => fact.includes("لا يثبت"))).toBe(true);
  });

  it("never lets a chronological possibility read as proof of an encounter", () => {
    for (const source of ["chronology_only", "candidate"]) {
      const description = describeEdgeEvidence(edge({ evidence: source, classes: source === "candidate" ? "candidate" : undefined }));
      if (description.kind !== "chronology_only") continue;
      expect(description.facts.some((fact) => fact.includes("لا يثبت") && fact.includes("لقاء"))).toBe(true);
    }
  });
});

describe("buildKeyboardEdgeItems -- edges reachable without a mouse (P5.7)", () => {
  const nodes: GraphNode[] = [
    { data: { id: "a", label: "أ", subtitle: "", kind: "later", status: "unresolved" } },
    { data: { id: "b", label: "ب", subtitle: "", kind: "later", status: "unresolved" } },
    { data: { id: "c", label: "ج", subtitle: "", kind: "later", status: "unresolved" } },
  ];
  const edges: GraphEdge[] = [
    edge({ id: "e-ab", source: "a", target: "b" }),
    edge({ id: "e-bc", source: "b", target: "c", evidence: "biographical", classes: "biographical" }),
  ];

  it("returns one keyboard-reachable item per edge, in the same order as supplied", () => {
    const items = buildKeyboardEdgeItems(nodes, edges);
    expect(items.map((item) => item.id)).toEqual(["e-ab", "e-bc"]);
  });

  it("labels each item with both endpoints and the evidence kind, so it stands on its own for a screen reader", () => {
    const items = buildKeyboardEdgeItems(nodes, edges);
    expect(items[0].label).toContain("أ");
    expect(items[0].label).toContain("ب");
    expect(items[0].kind).toBe("isnad_link");
    expect(items[1].kind).toBe("rijal_statement");
  });

  it("falls back to the raw id when an endpoint node is missing from the current view", () => {
    const items = buildKeyboardEdgeItems([], edges);
    expect(items[0].label).toContain("a");
    expect(items[0].label).toContain("b");
  });
});
