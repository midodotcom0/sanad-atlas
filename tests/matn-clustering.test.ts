import { describe, expect, it } from "vitest";
import { matnSimilarity, shouldSuggestCluster } from "../lib/matn-clustering";

describe("matn cluster suggestions", () => {
  it("recognizes normalized exact texts without hiding editorial status", () => {
    const result = matnSimilarity("إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ", "انما الاعمال بالنيات");
    expect(result.exact).toBe(true);
    expect(result.combined).toBe(1);
    expect(result.status).toBe("machine_suggestion");
    expect(result.needsEditorialApproval).toBe(true);
  });

  it("combines token, character and optional semantic evidence", () => {
    const result = matnSimilarity("إنما الأعمال بالنيات", "إنما العمل بالنية", 0.9);
    expect(result.semanticScore).toBe(0.9);
    expect(result.combined).toBeGreaterThan(0.5);
  });

  it("does not suggest unrelated texts", () => {
    expect(shouldSuggestCluster("إنما الأعمال بالنيات", "الدين النصيحة", 0.1)).toBe(false);
  });
});
