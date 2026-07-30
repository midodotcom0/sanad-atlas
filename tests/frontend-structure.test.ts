import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Strukturgarantie fuer Umsetzungsplan P5.1.
 *
 * Abnahmekriterium: "jede Route buendelt nur die von ihr benoetigten Views."
 * Das laesst sich nicht aus einer gerenderten Seite ablesen, wohl aber aus der
 * Importstruktur, und genau die haelt dieser Test fest:
 *
 *   1. `components/atlas-shell.tsx` enthaelt nur Routing, Zustand und Chrome.
 *   2. Jede Ansicht wird ausschliesslich per `next/dynamic` eingebunden -- ein
 *      statischer Import wuerde sie in das Bundle jeder Route ziehen.
 *   3. `components/atlas-graph.tsx` (und damit Cytoscape) wird nur ueber
 *      `atlas-graph-dynamic.tsx` erreicht, damit `/library`, `/sources` und
 *      `/editor` seinen Modulcode nicht mitbuendeln.
 */

const ROOT = resolve(process.cwd());
const COMPONENTS = join(ROOT, "components");
const shell = readFileSync(join(COMPONENTS, "atlas-shell.tsx"), "utf8");
const occurrencePanel = readFileSync(join(COMPONENTS, "panels", "occurrence-panel.tsx"), "utf8");

function componentFiles(): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(directory, entry.name));
      else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) files.push(join(directory, entry.name));
    }
  };
  walk(COMPONENTS);
  return files;
}

describe("frontend structure", () => {
  it("opens the full narrator card inside the isnad workspace", () => {
    for (const tab of ["البطاقة", "أقوال العلماء", "الشيوخ والتلاميذ", "المصادر"]) {
      expect(occurrencePanel).toContain(tab);
    }
    expect(occurrencePanel).toContain("searchRijalCandidates(occurrence.rawSurfaceForm");
    expect(occurrencePanel).not.toContain("/narrators/lookup");
  });

  it("keeps the shell down to routing, state and chrome", () => {
    // Vor der Aufteilung: 608 Zeilen mit sechs Views und drei Panels.
    expect(shell.split("\n").length).toBeLessThan(220);
    for (const marker of ["function LibraryView", "function EditorView", "function CompareView", "function VariantsView", "function SourcesView", "function NarratorPanel", "function HadithPanel", "function OccurrencePanel"]) {
      expect(shell, `${marker} gehoert nicht mehr in die Shell`).not.toContain(marker);
    }
  });

  it("loads every view and the detail panel through next/dynamic only", () => {
    const viewModules = readdirSync(join(COMPONENTS, "views")).map((name) => name.replace(/\.tsx?$/, ""));
    expect(viewModules.length).toBeGreaterThanOrEqual(6);
    for (const view of viewModules) {
      expect(shell, `${view} muss dynamisch geladen werden`).toContain(`import("./views/${view}")`);
      // Ein statischer Import wuerde die Aufteilung wieder aufheben.
      expect(shell).not.toMatch(new RegExp(`^import[^\\n]*from "\\./views/${view}"`, "m"));
    }
    expect(shell).toContain('import("./panels/detail-panel")');
    expect(shell).not.toMatch(/^import[^\n]*from "\.\/panels\//m);
  });

  it("reaches the cytoscape graph only through the dynamic wrapper", () => {
    const wrapper = join(COMPONENTS, "atlas-graph-dynamic.tsx");
    expect(readFileSync(wrapper, "utf8")).toContain('import("./atlas-graph")');
    for (const file of componentFiles()) {
      if (file === wrapper || file === join(COMPONENTS, "atlas-graph.tsx")) continue;
      const text = readFileSync(file, "utf8");
      const staticImport = /^import\s[^\n]*from\s+"(?:\.\.?\/)+atlas-graph"/m;
      expect(staticImport.test(text), `${file.slice(ROOT.length + 1)} importiert atlas-graph statisch`).toBe(false);
    }
  });

  it("routes every page through the shell without importing a view directly", () => {
    const pages = ["page.tsx", "hadith/page.tsx", "library/page.tsx", "network/page.tsx", "compare/page.tsx", "variants/page.tsx", "sources/page.tsx", "editor/page.tsx", "narrators/yahya/page.tsx"];
    for (const page of pages) {
      const text = readFileSync(join(ROOT, "app", page), "utf8");
      expect(text).toContain("@/components/atlas-shell");
      expect(text, `${page} darf keine Ansicht direkt importieren`).not.toContain("@/components/views/");
    }
  });
});
