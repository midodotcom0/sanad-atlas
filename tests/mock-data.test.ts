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
    expect(manifest.rijal.tahdhib.entries).toBeGreaterThan(1000);
    expect(manifest.rijal.mizan.entries).toBeGreaterThan(1000);
    expect(manifest.externalDatasets.some((item: { key: string; license: string }) => item.key === "sanadset_650k" && item.license === "CC0-1.0")).toBe(true);
    expect(manifest.provider.redistributionStatus).toBe("requires-edition-level-review");
  });

  it("accounts for every numbered occurrence in the completeness report", () => {
    // P0.3: `coveragePercent` war bis Parserversion 0.4.2 fest `records.length ? 100 : 0`
    // und dieser Test hat den Wert 100 zementiert. Jetzt wird die echte Quote geprüft:
    // sie ist eine gemessene Zahl, jede Klasse summiert sich auf die Gesamtzahl, und
    // `accountedPercent` muss 100 sein, weil kein Datensatz verworfen werden darf.
    const report = JSON.parse(readFileSync(resolve(process.cwd(), "public/data/corpus/completeness.json"), "utf8"));
    type CollectionReport = {
      numberedSegments: number;
      structuralHeadings: number;
      numberedOccurrences: number;
      importedOccurrences: number;
      occurrencesWithChainAndMatn: number;
      attributedReportsWithoutOwnChain: number;
      unparsedOccurrences: number;
      coveragePercent: number;
      accountedPercent: number;
      parserErrors: Array<{ errorCode: string; sourceUrl: string; spanStart: number }>;
    };
    const collections = Object.values(report.collections) as CollectionReport[];
    expect(collections.length).toBeGreaterThanOrEqual(2);
    for (const collection of collections) {
      expect(collection.importedOccurrences).toBe(collection.numberedOccurrences);
      expect(collection.numberedSegments).toBe(collection.numberedOccurrences + collection.structuralHeadings);
      expect(
        collection.occurrencesWithChainAndMatn + collection.attributedReportsWithoutOwnChain + collection.unparsedOccurrences,
      ).toBe(collection.numberedOccurrences);
      expect(collection.coveragePercent).toBe(
        Number(((100 * collection.occurrencesWithChainAndMatn) / collection.numberedOccurrences).toFixed(1)),
      );
      expect(collection.coveragePercent).toBeGreaterThan(90);
      expect(collection.accountedPercent).toBe(100);
      expect(collection.unparsedOccurrences).toBeLessThan(500);
      expect(collection.parserErrors.every((item) => Boolean(item.errorCode && item.sourceUrl))).toBe(true);
    }
  });

  it("reports rijal coverage and never claims a machine field is verified", () => {
    const report = JSON.parse(readFileSync(resolve(process.cwd(), "public/data/corpus/completeness.json"), "utf8"));
    expect(Object.keys(report.rijal).length).toBeGreaterThanOrEqual(3);
    for (const source of Object.values(report.rijal) as Array<{
      numberedSegments: number;
      importedEntries: number;
      reviewQueueEntries: number;
      deathAssertionPercent: number;
      accountedPercent: number;
    }>) {
      expect(source.numberedSegments).toBe(source.importedEntries + source.reviewQueueEntries);
      expect(source.accountedPercent).toBe(100);
      expect(source.deathAssertionPercent).toBeGreaterThan(5);
    }
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "public/data/corpus/manifest.json"), "utf8"));
    expect(manifest.parserVersion).toBeTruthy();
    expect(manifest.hadithParserVersion).toBe(`turath-hadith-parser-${manifest.parserVersion}`);
    expect(manifest.rijalParserVersion).toBe(`turath-rijal-parser-${manifest.parserVersion}`);
    expect(manifest.confidenceThresholds).toEqual({ high: 0.9, medium: 0.7 });
  });
});
