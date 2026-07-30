import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChainNarrators } from "../components/panels/chain-narrators";
import type { LiveHadithGraph } from "../lib/hadith-graph";

/**
 * Die رواة-Liste zeigt die Kette in Textreihenfolge. Zwei Regeln sichert dieser
 * Test ab, weil ihr Verlust fachlich falsche Aussagen erzeugen wuerde:
 * eine relative Namensform bekommt keine Personenkarte, und die Liste behauptet
 * nirgends eine festgestellte Identitaet.
 *
 * Ohne konfigurierte Forschungs-API findet kein Nachschlagen statt; genau das
 * macht den Test deterministisch und ohne Netz lauffaehig.
 */

function graph(): LiveHadithGraph {
  const occurrence = (chainOrder: number, position: number, rawSurfaceForm: string, extra = {}) => ({
    chainOrder,
    position,
    rawSurfaceForm,
    normalizedSurfaceForm: rawSurfaceForm,
    identityStatus: "unresolved" as const,
    ...extra,
  });
  return {
    nodes: [],
    edges: [],
    title: "",
    eyebrow: "",
    chainCount: 1,
    occurrenceCount: 4,
    record: {} as LiveHadithGraph["record"],
    sources: [],
    dataVersion: "test",
    occurrences: {
      // Absichtlich in falscher Reihenfolge eingetragen.
      "n-2": occurrence(0, 2, "أبيه", { relativeForm: true }),
      "n-0": occurrence(0, 0, "عبد الله بن يوسف"),
      "n-3": occurrence(0, 3, "النبي صلى الله عليه وسلم", { prophetMention: true }),
      "n-1": occurrence(0, 1, "مالك", { transmissionTerm: "عن" }),
    },
  };
}

describe("رواة-Liste des Sanads", () => {
  it("zeigt die Erzähler in der Reihenfolge des Textes, nicht in Objektreihenfolge", () => {
    render(<ChainNarrators liveGraph={graph()} />);
    const names = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(names[0]).toContain("عبد الله بن يوسف");
    expect(names[1]).toContain("مالك");
    expect(names[2]).toContain("أبيه");
    expect(names[3]).toContain("النبي");
  });

  it("öffnet für eine relative Namensform keine allgemeine Übersetzung", () => {
    render(<ChainNarrators liveGraph={graph()} />);
    const relative = screen.getAllByRole("listitem")[2];
    expect(relative.textContent).toContain("صيغة نسبية");
    expect(relative.textContent).not.toContain("الوفاة");
  });

  it("kennzeichnet die Zuordnung als Namensgleichheit, nicht als festgestellte Identität", () => {
    render(<ChainNarrators liveGraph={graph()} />);
    expect(screen.getAllByText(/اسمية، وليست تعييناً محققاً/).length).toBeGreaterThan(0);
  });

  it("behandelt die Prophetennennung nicht als Erzählereintrag", () => {
    render(<ChainNarrators liveGraph={graph()} />);
    expect(screen.getAllByRole("listitem")[3].textContent).toContain("وليس موضع راوٍ");
  });
});
