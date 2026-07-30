import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { compareChronology } from "../lib/chronology";
import { dateAssertions, egoEdgeChronology, egoEdges, narrators } from "../lib/mock-data";

/**
 * Regressionssperre fuer Auditbefund B6 / Umsetzungsplan P5.2.
 *
 * Bis zum 30. Juli 2026 enthielt `lib/mock-data.ts` eine zweite, nicht
 * sanktionierte Chronologierechnung (`deathAh >= birthAhMin + 10`) auf 29
 * hartcodierten Geburtsbereichen **ohne jede Quellenangabe**. Ihr Ergebnis
 * erschien als sichtbares `chronologyLabel`. Das verstiess gegen zwei Saetze
 * der Projektbeschreibung:
 *
 *   Abschnitt 14: "keine Beziehung, Datierung oder Bewertung ohne Quellenreferenz"
 *   Abschnitt 7:  "Fehlende Geburtsjahre duerfen nicht heimlich aus Todesjahren
 *                  geschaetzt werden."
 *
 * Diese Datei haelt beides offen: den textlichen Nachweis, dass das Muster weg
 * ist, und den fachlichen Nachweis, dass `compareChronology()` die einzige
 * Chronologiequelle bleibt.
 */

// Wie in tests/mock-data.test.ts: Vitest laeuft aus dem Projektwurzelverzeichnis.
const ROOT = resolve(process.cwd());

/** Nur der Anzeigecode. `lib/chronology.ts` selbst darf und muss rechnen. */
function frontendSourceFiles(): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      if (path === join(ROOT, "lib", "chronology.ts")) continue;
      files.push(path);
    }
  };
  walk(join(ROOT, "lib"));
  walk(join(ROOT, "components"));
  walk(join(ROOT, "app"));
  return files;
}

/**
 * Muster, die eine quellenlose Datierung erzeugen: die alte Tabelle selbst,
 * jede Zuweisung an ein Geburtsfeld und jeder relationale Vergleich auf
 * `deathAh` -- also genau die Bausteine, aus denen die entfernte Rechnung
 * bestand.
 */
const forbiddenPatterns: { pattern: RegExp; why: string }[] = [
  { pattern: /estimatedBirthRange/i, why: "hartcodierte Geburtsbereiche ohne Quelle" },
  { pattern: /birthAhM(?:in|ax)\s*[+\-*/]/, why: "Arithmetik auf einem Geburtsjahr statt Beleg" },
  { pattern: /deathAh\s*[<>]=?/, why: "Chronologievergleich ausserhalb von compareChronology()" },
  { pattern: /birthAhM(?:in|ax)\s*[<>]=?/, why: "Chronologievergleich ausserhalb von compareChronology()" },
  { pattern: /birthAhM(?:in|ax)\s*\]?\s*=[^=]/, why: "Geburtsjahr wird gesetzt statt belegt" },
];

describe("no dating without a source reference", () => {
  it("has no second chronology computation anywhere in lib, components or app", () => {
    const offenders: string[] = [];
    for (const file of frontendSourceFiles()) {
      const text = readFileSync(file, "utf8");
      for (const { pattern, why } of forbiddenPatterns) {
        // Kommentarzeilen dokumentieren die Entfernung und duerfen das Muster nennen.
        const hits = text.split("\n").filter((line) => pattern.test(line) && !/^\s*(\*|\/\/)/.test(line));
        if (hits.length) offenders.push(`${file.slice(ROOT.length + 1)}: ${why} -> ${hits[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("leaves every birth year unset unless a sourced assertion carries it", () => {
    for (const narrator of narrators) {
      const asserted = dateAssertions.some((item) => item.narratorId === narrator.id && item.event === "birth");
      if (asserted) continue;
      expect(narrator.birthAhMin, `${narrator.id} hat ein Geburtsjahr ohne Beleg`).toBeUndefined();
      expect(narrator.birthAhMax, `${narrator.id} hat ein Geburtsjahr ohne Beleg`).toBeUndefined();
    }
  });

  it("gives every date assertion a work, a passage and a review state", () => {
    expect(dateAssertions.length).toBeGreaterThan(0);
    for (const assertion of dateAssertions) {
      expect(assertion.sourceLabel.length).toBeGreaterThan(0);
      expect(assertion.reference.length).toBeGreaterThan(0);
      expect(["reviewed", "pending"]).toContain(assertion.reviewStatus);
    }
  });

  it("derives every displayed edge chronology from compareChronology alone", () => {
    expect(egoEdges.length).toBeGreaterThan(0);
    for (const edge of egoEdges) {
      const expected = compareChronology(dateAssertions, edge.data.source, edge.data.target);
      expect(edge.data.chronologyStatus, `Kante ${edge.data.id} weicht von compareChronology() ab`).toBe(expected.result);
    }
  });

  it("keeps the chronology vocabulary at exactly possible, impossible and insufficient", () => {
    for (const entry of egoEdgeChronology) {
      expect(["possible", "impossible", "insufficient"]).toContain(entry.result);
    }
  });

  it("shows no year unless the label names the sources it rests on", () => {
    for (const entry of egoEdgeChronology) {
      if (entry.result === "insufficient") {
        expect(entry.sourceReferences).toHaveLength(0);
        // Kein Beleg, also auch keine sichtbare Jahreszahl.
        expect(/\d/.test(entry.label), `${entry.edgeId} nennt eine Zahl ohne Beleg`).toBe(false);
        continue;
      }
      expect(entry.sourceReferences.length).toBeGreaterThan(0);
      for (const reference of entry.sourceReferences) {
        expect(reference.reference.length).toBeGreaterThan(0);
        expect(entry.label).toContain(reference.sourceLabel);
      }
    }
  });

  it("never presents a chronological possibility as proof of transmission", () => {
    for (const entry of egoEdgeChronology) {
      if (entry.result !== "possible") continue;
      expect(entry.label).toContain("ليس مثبتا");
    }
  });
});
