/**
 * Regressionsschutz für P1.1, P1.3 und P1.4.
 *
 * Ausführen: `node --test tests/import-rijal-fields.check.mjs`
 *
 * Geprüft wird die Ausgabe des Importers, nicht seine internen Funktionen — damit kann der
 * Test ohne Build laufen und deckt genau die Zahlen ab, die im Abnahmebericht stehen.
 * Ohne `.cache/turath-derived` überspringt sich jeder Test selbst.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert";
import test from "node:test";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const derivedDir = resolve(projectRoot, ".cache/turath-derived");
const corpusDir = resolve(projectRoot, "public/data/corpus");
const available = existsSync(derivedDir) && existsSync(resolve(corpusDir, "manifest.json"));
const skip = !available && "kein .cache/turath-derived";

const load = (key) => JSON.parse(readFileSync(resolve(derivedDir, `${key}.json`), "utf8"));
const manifest = () => JSON.parse(readFileSync(resolve(corpusDir, "manifest.json"), "utf8"));
const completeness = () => JSON.parse(readFileSync(resolve(corpusDir, "completeness.json"), "utf8"));
const RIJAL_SOURCES = ["tahdhib", "mizan", "taqrib", "kashif"];

test("nameSurface ist ein Namenskopf, kein 180-Zeichen-Schnitt", { skip }, () => {
  for (const source of RIJAL_SOURCES) {
    const entries = load(source).entries;
    const lengths = entries.map((entry) => entry.nameSurfaceNormalized.length).sort((a, b) => a - b);
    const exactly180 = lengths.filter((length) => length === 180).length;
    const median = lengths[Math.floor(lengths.length / 2)];
    // Signatur des alten Fehlers: 6.642 von 9.247 Tahdhīb-Köpfen waren exakt 180 Zeichen lang.
    assert.ok(exactly180 <= entries.length * 0.005, `${source}: ${exactly180} Köpfe mit exakt 180 Zeichen`);
    assert.ok(median <= 60, `${source}: Median der Kopflänge ist ${median}`);
    assert.ok(lengths.filter((length) => length <= 80).length / entries.length >= 0.8, `${source}: weniger als 80 % der Köpfe <= 80 Zeichen`);
  }
});

test("jeder Namenskopf trägt Extraktionsmethode und Konfidenzband, nie verified", { skip }, () => {
  for (const source of RIJAL_SOURCES) {
    for (const entry of load(source).entries) {
      const field = entry.parser.fields.nameSurface;
      // `title-span-cut` und `boundary-cut` sind gekürzte Köpfe: der Kopf wurde erkannt,
      // aber an einer Grenze beschnitten. Sie bleiben zulässig, müssen die Kürzung aber
      // ausweisen — ein stillschweigend gekürzter Kopf wäre wieder B1.
      assert.ok(["title-span", "title-span-cut", "boundary-cut", "window-fallback"].includes(field.method), `${entry.id}: ${field.method}`);
      assert.ok(["high", "medium", "low"].includes(field.confidenceBand));
      assert.equal(entry.parser.reviewStatus, "unreviewed");
      assert.notEqual(entry.parser.confidenceBand, "verified");
    }
  }
});

test("Todesjahre werden aus arabischen Zahlwörtern gelesen — handgeprüfte Goldpaare", { skip }, () => {
  // Ground truth, von Hand geprüft. Die Werte stehen NICHT im Importer, sondern hier.
  const gold = new Map([
    ["ثلاث وثمانين وميه", 183],
    ["ثمان واربعين ومايتين", 248],
    ["احدي وستين", 61],
    ["سبع عشره", 17],
    ["اثنتين وسبعين ومايتين", 272],
    ["ست وثلاثين ومايتين", 236],
    ["خمس واربعين ومايه", 145],
    ["تسع وستين وميه", 169],
    ["عشرين ومايه", 120],
    ["اربع وميتين", 204],
  ]);
  const seen = new Map();
  for (const source of RIJAL_SOURCES) {
    for (const entry of load(source).entries) {
      for (const assertion of entry.dateAssertions) {
        if (!gold.has(assertion.rawPhrase)) continue;
        seen.set(assertion.rawPhrase, assertion.valueAh);
      }
    }
  }
  assert.ok(seen.size >= 6, `nur ${seen.size} Goldphrasen im Korpus gefunden`);
  for (const [phrase, value] of seen) {
    assert.equal(value, gold.get(phrase), `«${phrase}» wurde als ${value} gelesen, erwartet ${gold.get(phrase)}`);
  }
});

test("ein Jahr ohne Hunderterangabe wird nicht heimlich ergänzt", { skip }, () => {
  let implicit = 0;
  for (const source of RIJAL_SOURCES) {
    for (const entry of load(source).entries) {
      for (const assertion of entry.dateAssertions) {
        assert.equal(typeof assertion.centuryExplicit, "boolean");
        assert.equal(assertion.evidenceClass, "rijal_statement");
        if (assertion.centuryExplicit) {
          assert.ok(!assertion.centuryShared, `${entry.id}: centuryShared neben centuryExplicit`);
          continue;
        }
        // Ein Jahrhundert darf aus derselben Aussage übernommen werden («سبع أو ثمان
        // وعشرين ومائة» = 127 oder 128), aber niemals stillschweigend: die Zeile muss
        // die Spenderphrase nennen, sonst wäre der Wert nicht mehr auf die Quelle
        // zurückführbar.
        if (assertion.centuryShared) {
          assert.equal(typeof assertion.centurySharedFrom, "string", `${entry.id}: centuryShared ohne Spenderphrase`);
          assert.ok(assertion.centurySharedFrom.length > 0, `${entry.id}: leere Spenderphrase`);
          assert.ok(assertion.valueAh >= 100, `${entry.id}: centuryShared, aber ${assertion.valueAh} < 100`);
          continue;
        }
        implicit += 1;
        assert.ok(assertion.valueAh < 100, `${entry.id}: ${assertion.valueAh} ohne ausdrückliches Jahrhundert`);
      }
      // deathYearCandidate führt ausschließlich vollständig angegebene Jahre.
      if (entry.deathYearCandidate === null) continue;
      assert.ok(entry.deathYearCandidate >= 100, `${entry.id}: deathYearCandidate ${entry.deathYearCandidate}`);
      assert.ok(
        entry.dateAssertions.some((item) => item.kind === "death" && item.valueAh === entry.deathYearCandidate),
        `${entry.id}: deathYearCandidate ohne belegende Aussage`,
      );
    }
  }
  assert.ok(implicit > 100, `zu wenige jahrhundertlose Angaben erkannt: ${implicit}`);
});

test("Geburtsjahre werden nie aus Todesjahren geschätzt", { skip }, () => {
  for (const source of RIJAL_SOURCES) {
    for (const entry of load(source).entries) {
      if (entry.birthYearCandidate === null) continue;
      assert.ok(
        entry.dateAssertions.some((item) => item.kind === "birth" && item.valueAh === entry.birthYearCandidate),
        `${entry.id}: Geburtsjahr ohne belegende Aussage`,
      );
    }
  }
});

test("Todesjahr-, Ṭabaqa- und Beziehungsquoten liegen über dem Stand vor dem Umbau", { skip }, () => {
  const rijal = manifest().rijal;
  // Vorher: 24/9.247 Tahdhīb, 16/9.212 Mīzān, 15/8.646 Taqrīb.
  assert.ok(rijal.tahdhib.deathAssertionsDetected > 2000, `Tahdhīb Todesaussagen: ${rijal.tahdhib.deathAssertionsDetected}`);
  assert.ok(rijal.mizan.deathAssertionsDetected > 700, `Mīzān Todesaussagen: ${rijal.mizan.deathAssertionsDetected}`);
  assert.ok(rijal.taqrib.deathAssertionsDetected > 2000, `Taqrīb Todesaussagen: ${rijal.taqrib.deathAssertionsDetected}`);
  // Ṭabaqa ist das eigentliche Signal von Taqrīb, nicht Lehrer-/Schülerlisten.
  assert.ok(rijal.taqrib.tabaqaDetected / rijal.taqrib.entries > 0.85, `Taqrīb Ṭabaqa-Quote zu niedrig`);
  // Vorher: Tahdhīb 7.081 Lehrer- und 2.757 Schülerphrasen.
  assert.ok(rijal.tahdhib.teacherPhrasesDetected > 8500);
  assert.ok(rijal.tahdhib.studentPhrasesDetected > 8000);
  assert.ok(rijal.mizan.studentPhrasesDetected > 4000);
});

test("verworfene Kandidaten sind vollständig in der Review-Queue auffindbar", { skip }, () => {
  const queue = JSON.parse(readFileSync(resolve(corpusDir, "review-queue.json"), "utf8"));
  const queuedIds = new Set(queue.rijalRejectedCandidates.map((item) => item.candidateId));
  let rejected = 0;
  for (const source of RIJAL_SOURCES) {
    const derived = load(source);
    assert.ok(Array.isArray(derived.rejected), `${source}: kein rejected-Array`);
    for (const entry of derived.rejected) {
      rejected += 1;
      assert.ok(entry.rejectReasons.length > 0, `${entry.id}: kein Ablehnungsgrund`);
      assert.ok(queuedIds.has(entry.id), `${entry.id}: nicht in der Review-Queue`);
    }
  }
  assert.equal(rejected, queue.rijalRejectedCandidates.length);
  assert.ok(rejected > 0, "die Queue muss die real verworfenen Kandidaten enthalten");
});

test("jedes nummerierte Vorkommen ist zugeordnet, Reste tragen einen Fehlercode", { skip }, () => {
  const report = completeness();
  for (const [collection, entry] of Object.entries(report.collections)) {
    assert.ok(entry.unparsedOccurrences < 500, `${collection}: ${entry.unparsedOccurrences} nicht parsebare Vorkommen`);
    assert.equal(entry.accountedPercent, 100, `${collection}: accountedPercent ${entry.accountedPercent}`);
    assert.equal(
      entry.occurrencesWithChainAndMatn + entry.attributedReportsWithoutOwnChain + entry.unparsedOccurrences,
      entry.numberedOccurrences,
      `${collection}: Summe der Klassen weicht ab`,
    );
    for (const error of entry.parserErrors) {
      assert.ok(error.errorCode, "Fehler ohne Code");
      assert.ok(error.sourceUrl, "Fehler ohne Quellenverweis");
      assert.equal(typeof error.spanStart, "number", "Fehler ohne Rohtext-Offset");
    }
  }
});

test("Rijāl-Abdeckung steht in completeness.json", { skip }, () => {
  const report = completeness();
  assert.ok(report.rijal, "completeness.json ohne Rijāl-Abschnitt");
  for (const source of RIJAL_SOURCES) {
    const entry = report.rijal[source];
    assert.ok(entry, `${source} fehlt in completeness.rijal`);
    assert.equal(entry.numberedSegments, entry.importedEntries + entry.reviewQueueEntries);
    assert.equal(entry.accountedPercent, 100);
  }
});

test("Parser- und Datenversion sind einheitlich", { skip }, () => {
  const summary = manifest();
  assert.equal(summary.hadithParserVersion, `turath-hadith-parser-${summary.parserVersion}`);
  assert.equal(summary.rijalParserVersion, `turath-rijal-parser-${summary.parserVersion}`);
  assert.ok(summary.dataVersion.startsWith("turath-"));
  assert.equal(summary.normalizerVersion, JSON.parse(readFileSync(resolve(projectRoot, "tests/normalize-fixture.json"), "utf8")).normalizerVersion);
  for (const collection of ["bukhari", "muslim"]) {
    const record = load(collection).records.find((item) => item.chains.length);
    assert.equal(record.parser.version, summary.hadithParserVersion);
    assert.equal(record.parser.normalizerVersion, summary.normalizerVersion);
  }
  for (const source of RIJAL_SOURCES) {
    assert.equal(load(source).entries[0].parser.version, summary.rijalParserVersion);
  }
});

test("jede registrierte Quelle hat einen Registry-Eintrag und umgekehrt", { skip }, () => {
  const registry = JSON.parse(readFileSync(resolve(projectRoot, "data/sources/turath-manifest.json"), "utf8"));
  const registered = new Set(registry.sources.map((source) => source.key));
  const summary = manifest();
  for (const key of [...Object.keys(summary.collections), ...Object.keys(summary.rijal)]) {
    assert.ok(registered.has(key), `${key} ist nicht registriert`);
  }
  for (const source of registry.sources) {
    assert.ok(source.rightsStatus, `${source.key} ohne rightsStatus`);
    assert.ok(Array.isArray(source.publicDerivedFields), `${source.key} ohne publicDerivedFields`);
    assert.ok(existsSync(resolve(derivedDir, `${source.key}.json`)), `${source.key} registriert, aber ohne Ableitung`);
  }
});
