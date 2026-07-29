import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertions, egoEdges, hadithEdges, hadithNodes, matnVariants, narrators } from "../lib/mock-data";
import { normalizeSearchText } from "../lib/search";

describe("Sanad Atlas mock research fixture", () => {
  it("contains at least thirty narrator identities and a multi-route cluster", () => {
    expect(narrators.length).toBeGreaterThanOrEqual(30);
    expect(hadithNodes.length).toBeGreaterThanOrEqual(20);
    expect(new Set(hadithEdges.map((edge) => edge.data.collection)).size).toBeGreaterThanOrEqual(4);
  });

  it("keeps uncertainty explicit", () => {
    expect(narrators.some((item) => ["medium", "low", "conflict"].includes(item.confidence))).toBe(true);
    expect(hadithEdges.some((edge) => edge.classes?.includes("uncertain"))).toBe(true);
  });

  it("links every matn variant to one or more graph branches", () => {
    expect(matnVariants).toHaveLength(2);
    for (const variant of matnVariants) {
      expect(variant.branchIds.length).toBeGreaterThan(0);
      for (const id of variant.branchIds) expect(hadithNodes.some((node) => node.data.id === id)).toBe(true);
    }
  });

  it("marks all scholarly assertions with an editorial review state", () => {
    expect(assertions.length).toBeGreaterThanOrEqual(5);
    expect(assertions.every((item) => ["pending", "reviewed"].includes(item.status))).toBe(true);
  });

  it("normalizes Arabic variants and transliteration diacritics", () => {
    expect(normalizeSearchText("يَحْيَى")).toBe(normalizeSearchText("يحيي"));
    expect(normalizeSearchText("Yaḥyā ibn Saʿīd")).toContain("yahya");
  });

  it("keeps chronology as a qualified possibility instead of proof of meeting", () => {
    expect(egoEdges.every((edge) => edge.data.chronologyStatus !== undefined)).toBe(true);
    expect(egoEdges.every((edge) => edge.data.chronologyLabel?.includes("ليس مثبتا") || edge.data.chronologyLabel?.includes("غير كافية") || edge.data.chronologyLabel?.includes("تعارض"))).toBe(true);
  });

  it("publishes corpus counts and rights status without redistributing edition files", () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "public/data/corpus/manifest.json"), "utf8"));
    expect(manifest.collections.bukhari.uniqueNumbers).toBe(7124);
    expect(manifest.collections.muslim.records).toBeGreaterThan(5000);
    expect(manifest.rijal.taqrib.entries).toBeGreaterThan(8000);
    expect(manifest.rijal.kashif.entries).toBeGreaterThan(6000);
    expect(manifest.provider.redistributionStatus).toBe("requires-edition-level-review");
  });
});
