import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const PRODUCTIVE_FILES = [
  "components/atlas-shell.tsx",
  "components/views/graph-workspace.tsx",
  "components/views/compare-view.tsx",
  "components/views/sources-view.tsx",
  "components/panels/narrator-panel.tsx",
  "components/panels/detail-panel.tsx",
];

function routeFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? routeFiles(path) : path.endsWith("route.ts") ? [path] : [];
  });
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

describe("P3.3/P5.5 frontend uses the Worker as its only research source", () => {
  it("has no mock-data import anywhere below app/ or components/", () => {
    const offenders = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "components"))]
      .filter((file) => /from\s+["'][^"']*lib\/mock-data["']/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });

  it("ships no frozen Next API mock routes with the static export", () => {
    expect(routeFiles(join(ROOT, "app", "api"))).toEqual([]);
  });

  it("binds the client to every Worker endpoint needed by these views", () => {
    const client = read("lib/api-client.ts");
    for (const path of [
      "/api/v1/hadiths/",
      "/api/v1/clusters/",
      "/api/v1/rijal/",
      "/api/v1/identity-candidates",
      "/api/v1/narrators/",
      "/relations",
      "/timeline",
      "/paths",
      "/api/v1/narrators/compare",
      "/api/v1/chronology/compare",
      "/api/v1/sources",
    ]) expect(client, `missing client binding for ${path}`).toContain(path);
  });

  it("uses real IDs and visibly reports missing configuration instead of defaulting to yahya", () => {
    const combined = PRODUCTIVE_FILES.map(read).join("\n");
    expect(combined).not.toMatch(/id\s*===\s*["']yahya["']/);
    expect(combined).not.toMatch(/useState\(["']yahya["']\)/);
    expect(combined).toContain("NEXT_PUBLIC_API_URL");
    expect(combined).toContain("لا توجد بيانات بديلة");
  });

  it("labels the current profile pagination limit rather than claiming all occurrences were returned", () => {
    const panel = read("components/panels/narrator-panel.tsx");
    expect(panel).toContain("profile.truncatedOccurrences");
    expect(panel).toContain("أول ٥٠ موضعا فقط");
    expect(panel).toContain("profile.occurrenceCount");
  });
});
