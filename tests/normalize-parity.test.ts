import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NORMALIZER_VERSION, normalizeSearchText } from "../lib/search";

/**
 * Property-Test für P1.2: EIN Normalisierer für TypeScript, Python und Importer.
 *
 * `tests/normalize-fixture.json` wird von `scripts/import-turath-corpus.mjs` aus echten
 * Namensformen des Korpus erzeugt (Erzählerpositionen aus Bukhārī/Muslim und Namensköpfe
 * aus den vier Rijāl-Werken). Diese Datei prüft die Fixture gegen `lib/search.ts`,
 * `tests/normalize-parity-python.py` prüft dieselbe Fixture gegen `backend/app/normalize.py`.
 * Beide grün heißt: Importer ≡ TypeScript ≡ Python.
 */

type Fixture = {
  normalizerVersion: string;
  dataVersion: string;
  samples: Array<{ raw: string; normalized: string }>;
};

const fixture: Fixture = JSON.parse(readFileSync(resolve(process.cwd(), "tests/normalize-fixture.json"), "utf8"));

describe("kanonische arabische Normalisierung", () => {
  it("vergleicht mindestens 200 echte Namensformen aus dem Korpus", () => {
    expect(fixture.samples.length).toBeGreaterThanOrEqual(200);
    expect(fixture.normalizerVersion).toBe(NORMALIZER_VERSION);
  });

  it("stimmt für jede Korpusform bitgleich mit der Importer-Ausgabe überein", () => {
    const divergent = fixture.samples.filter((sample) => normalizeSearchText(sample.raw) !== sample.normalized);
    expect(divergent.map((sample) => sample.raw)).toEqual([]);
  });

  it("ist idempotent", () => {
    for (const sample of fixture.samples) {
      expect(normalizeSearchText(sample.normalized)).toBe(sample.normalized);
    }
  });

  it("erhält die Rohform: die Fixture speichert Roh- und Suchform getrennt", () => {
    const withDiacritics = fixture.samples.filter((sample) => sample.raw !== sample.normalized);
    expect(withDiacritics.length).toBeGreaterThan(fixture.samples.length / 2);
  });

  it("setzt die acht vertraglich vereinbarten Zeichenregeln um", () => {
    expect(normalizeSearchText("يَحْيَى")).toBe(normalizeSearchText("يحيي"));
    expect(normalizeSearchText("أإآٱ")).toBe("اااا");
    expect(normalizeSearchText("ى")).toBe("ي");
    expect(normalizeSearchText("ة")).toBe("ه");
    expect(normalizeSearchText("ؤ")).toBe("و");
    expect(normalizeSearchText("ئ")).toBe("ي");
    expect(normalizeSearchText("مـــحمد")).toBe("محمد");
    expect(normalizeSearchText("Yaḥyā ibn Saʿīd")).toContain("yahya");
    expect(normalizeSearchText("Yaḥyā ibn Saʿīd")).toContain(" b ");
    expect(normalizeSearchText("Malik BIN Anas")).toContain(" b ");
  });

  it("ist unabhängig von Host-Locale und Whitespace-Varianten", () => {
    expect(normalizeSearchText("Ibrahim")).toBe("ibrahim");
    expect(normalizeSearchText(" مالك بن　أنس﻿")).toBe("مالك بن انس");
  });
});
