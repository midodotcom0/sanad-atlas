import { describe, expect, it } from "vitest";
import { assertions, hadithEdges, hadithNodes, matnVariants, narrators } from "../lib/mock-data";
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
});
