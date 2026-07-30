import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Regressionssperre für Umsetzungsplan P3.3.
 *
 * Bis zum 30. Juli 2026 stand in `components/views/graph-workspace.tsx`:
 *
 *     const nodes = isHadith ? liveGraph?.nodes ?? hadithNodes : egoNodes;
 *
 * Fehlte die Antwort des Workers, zeigte die Ansicht kommentarlos ein
 * Demonstrationscluster — optisch nicht von einem echten Rechercheergebnis zu
 * unterscheiden. Daneben standen `?? 7` und `?? 30` als Kennzahlen und ein
 * fester Hadithtitel als Rückfallwert.
 *
 * Das ist die gefährlichere Hälfte von P3.3: einen fehlenden Import bemerkt man
 * beim Lesen des Codes, einen stillen Rückfall erst, wenn jemand eine erfundene
 * Zahl zitiert. Der Grundsatz lautet deshalb: fehlende Daten werden als fehlend
 * angezeigt, nie durch andere ersetzt.
 *
 * Diese Datei hält zwei Dinge offen:
 *   1. Kein Anzeigecode fällt von Live-Daten still auf Mockdaten zurück.
 *   2. `lib/mock-data` wird unterhalb von `app/` nicht mehr importiert; die
 *      verbleibenden Importe unter `components/` sind namentlich erfasst und
 *      dürfen nur weniger werden, nie mehr (P5.5 löst sie einzeln ab).
 */

const ROOT = resolve(process.cwd());

function sourceFiles(...roots: string[]): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (/\.tsx?$/.test(entry)) files.push(path);
    }
  };
  for (const root of roots) walk(join(ROOT, root));
  return files;
}

const relative = (path: string) => path.slice(ROOT.length + 1);

describe("kein stiller Rückfall auf Demonstrationsdaten", () => {
  it("verbindet Live-Daten nirgends per ?? mit einer Mock-Konstanten", () => {
    // `liveX?.feld ?? mockKonstante` und `liveX ?? mockKonstante` — der
    // Rückfall auf einen Literalwert (?? [], ?? null, ?? 0, ?? "") bleibt
    // erlaubt, weil er nichts vortäuscht.
    const pattern = /live[A-Za-z]*(?:\?\.[A-Za-z]+)?\s*\?\?\s*(?!\[\]|null|""|''|0\b|undefined)[A-Za-z_]/;
    const offenders: string[] = [];
    for (const file of sourceFiles("components", "app")) {
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
        if (pattern.test(line)) offenders.push(`${relative(file)}:${index + 1} — ${line.trim()}`);
      });
    }
    expect(offenders, `Stiller Rückfall von Live- auf Ersatzdaten:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("hält keinen hartcodierten Hadithtitel und keine erfundene Kennzahl als Rückfallwert vor", () => {
    const source = readFileSync(join(ROOT, "components", "views", "graph-workspace.tsx"), "utf8");
    expect(source).not.toContain("حديث إنما الأعمال بالنيات");
    expect(source).not.toContain("عنقود الحديث HCL-0001");
    expect(source).not.toMatch(/liveGraph\?\.(chainCount|occurrenceCount)\s*\?\?\s*\d/);
  });

  it("importiert lib/mock-data nirgends unterhalb von app/", () => {
    const offenders = sourceFiles("app")
      .filter((file) => /from\s+["']@?\/?(\.\.\/)*lib\/mock-data["']/.test(readFileSync(file, "utf8")))
      .map(relative)
      // Die vier Attrappen-Routen unter app/api sind ausdrücklich als
      // Übergangsattrappen gekennzeichnet (app/api/_contract.ts) und liefern
      // origin=machine/unresolved. Sie fallen mit P3.3 weg, sobald der Worker
      // als Datenquelle konfiguriert ist.
      .filter((path) => !path.startsWith("app/api/"));
    expect(offenders, `lib/mock-data unterhalb app/ importiert: ${offenders.join(", ")}`).toEqual([]);
  });

  it("lässt die Zahl der Mock-Importe unter components/ nur sinken", () => {
    // Namentlich erfasst statt nur gezählt: so zeigt ein Fehlschlag sofort,
    // welche Ansicht neu hinzugekommen ist, statt nur dass es eine mehr ist.
    const erlaubt = new Set([
      "components/atlas-shell.tsx",
      "components/panels/detail-panel.tsx",
      "components/panels/narrator-panel.tsx",
      "components/views/compare-view.tsx",
      "components/views/graph-workspace.tsx",
      "components/views/sources-view.tsx",
      "components/views/variants-view.tsx",
    ]);
    const tatsaechlich = sourceFiles("components")
      .filter((file) => /from\s+["']@?\/?(\.\.\/)*lib\/mock-data["']/.test(readFileSync(file, "utf8")))
      .map(relative);
    const neu = tatsaechlich.filter((path) => !erlaubt.has(path));
    expect(neu, `neue Mock-Abhängigkeit in: ${neu.join(", ")}`).toEqual([]);
  });
});
