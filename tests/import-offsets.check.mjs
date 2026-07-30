/**
 * Abnahmeprüfung für P1.2: jede Erzählerposition ist per Offset auf die Rohdatei in
 * `.cache/turath` zurückschneidbar.
 *
 * Ausführen: `node --test tests/import-offsets.check.mjs`
 *
 * Die Datei trägt die Endung `.check.mjs` statt `.test.mjs`, damit Vitest sie nicht
 * einsammelt — sie benutzt `node:test` und braucht die 61 MB Rohdaten unter `.cache/turath`,
 * die nicht im Repository liegen. Fehlt der Cache, überspringt der Test sich selbst.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert";
import test from "node:test";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = resolve(projectRoot, ".cache/turath");
const derivedDir = resolve(projectRoot, ".cache/turath-derived");
const manifest = JSON.parse(readFileSync(resolve(projectRoot, "data/sources/turath-manifest.json"), "utf8"));
const bookIdOf = Object.fromEntries(manifest.sources.map((source) => [source.key, source.turathBookId]));
const cacheAvailable = existsSync(cacheDir) && existsSync(derivedDir);

const bookCache = new Map();
function loadBook(key) {
  if (!bookCache.has(key)) {
    bookCache.set(key, JSON.parse(readFileSync(resolve(cacheDir, `${bookIdOf[key]}.json`), "utf8")));
  }
  return bookCache.get(key);
}
function loadDerived(key) {
  return JSON.parse(readFileSync(resolve(derivedDir, `${key}.json`), "utf8"));
}
/** Gleichmäßige Stichprobe, damit nicht nur der Dateianfang geprüft wird. */
function sample(items, count) {
  if (items.length <= count) return items;
  return Array.from({ length: count }, (_, index) => items[Math.floor((index * items.length) / count)]);
}

test("Stichprobe von 20 Erzählerpositionen je Sammlung ist auf .cache/turath zurückschneidbar", { skip: !cacheAvailable && "kein .cache/turath" }, () => {
  for (const collection of ["bukhari", "muslim"]) {
    const book = loadBook(collection);
    const records = loadDerived(collection).records.filter((record) => record.chains.length);
    let checked = 0;
    for (const record of sample(records, 20)) {
      const page = book.pages[record.sourcePageId - 1].text;
      for (const chain of record.chains) {
        for (const occurrence of chain.narratorOccurrences) {
          assert.equal(
            page.slice(occurrence.spanStart, occurrence.spanEnd),
            occurrence.rawSurfaceForm,
            `${collection} ${record.id} Position ${occurrence.position} lässt sich nicht zurückschneiden`,
          );
          checked += 1;
        }
      }
    }
    assert.ok(checked >= 20, `${collection}: nur ${checked} Positionen geprüft`);
  }
});

test("alle Erzählerpositionen einer 500er-Stichprobe stimmen zeichengenau", { skip: !cacheAvailable && "kein .cache/turath" }, () => {
  for (const collection of ["bukhari", "muslim"]) {
    const book = loadBook(collection);
    const records = loadDerived(collection).records.filter((record) => record.chains.length);
    for (const record of sample(records, 500)) {
      const page = book.pages[record.sourcePageId - 1].text;
      for (const chain of record.chains) {
        assert.equal(page.slice(chain.spanStart, chain.spanEnd), chain.rawIsnad, `${record.id} Kette ${chain.chainOrder}`);
        for (const occurrence of chain.narratorOccurrences) {
          assert.equal(page.slice(occurrence.spanStart, occurrence.spanEnd), occurrence.rawSurfaceForm, `${record.id}/${occurrence.position}`);
        }
      }
    }
  }
});

test("jede Position trägt die vertraglich vereinbarte Positionsbindung", { skip: !cacheAvailable && "kein .cache/turath" }, () => {
  for (const collection of ["bukhari", "muslim"]) {
    for (const record of sample(loadDerived(collection).records.filter((item) => item.chains.length), 300)) {
      for (const chain of record.chains) {
        assert.equal(chain.chainId, `${record.id}#c${chain.chainOrder}`);
        chain.narratorOccurrences.forEach((occurrence, index) => {
          assert.equal(occurrence.chainId, chain.chainId, "chainId fehlt an der Position");
          assert.equal(occurrence.position, index, "position ist kein fortlaufender Index");
          assert.equal(typeof occurrence.spanStart, "number");
          assert.equal(typeof occurrence.spanEnd, "number");
          assert.ok(occurrence.spanEnd > occurrence.spanStart, "leere Spanne");
          assert.equal(occurrence.evidenceClass, "isnad_link", "Evidenzklasse muss isnad_link sein");
          assert.notEqual(occurrence.reviewStatus, "verified", "maschinelle Verarbeitung darf nie verified setzen");
        });
      }
    }
  }
});

test("relative Namensformen bleiben an ihre Position gebunden und werden nie global", { skip: !cacheAvailable && "kein .cache/turath" }, () => {
  let relatives = 0;
  for (const collection of ["bukhari", "muslim"]) {
    for (const record of loadDerived(collection).records) {
      for (const chain of record.chains) {
        for (const occurrence of chain.narratorOccurrences) {
          if (!occurrence.relativeForm) continue;
          relatives += 1;
          assert.equal(occurrence.identityStatus, "unresolved-relative");
          assert.ok(occurrence.chainId && Number.isInteger(occurrence.position));
        }
      }
    }
  }
  assert.ok(relatives > 500, `zu wenige relative Formen erkannt: ${relatives}`);
});

test("Rijāl-Namensköpfe sind über nameSpan auf die Rohdatei zurückführbar", { skip: !cacheAvailable && "kein .cache/turath" }, () => {
  for (const source of ["tahdhib", "mizan", "taqrib", "kashif"]) {
    const book = loadBook(source);
    const entries = loadDerived(source).entries;
    for (const entry of sample(entries, 40)) {
      assert.ok(entry.nameSpan, `${entry.id} ohne nameSpan`);
      const page = book.pages[entry.nameSpan.sourcePageId - 1].text;
      const slice = page.slice(entry.nameSpan.spanStart, entry.nameSpan.spanEnd);
      assert.ok(slice.length > 0, `${entry.id}: leere Namensspanne`);
      // Der Kopf entsteht aus derselben Spanne, nachdem Fußnotenmarken, Quellensigel und
      // orthografische Glossen entfernt wurden. Er ist deshalb kein zusammenhängender
      // Ausschnitt, wohl aber eine Teilfolge: jedes Wort des Kopfes muss in derselben
      // Reihenfolge in der Rohspanne vorkommen.
      const words = (value) =>
        value
          .replace(/\(\s*\^?\s*[٠-٩0-9]{1,3}\s*\)/g, " ")
          .replace(/[^\p{L}\s]/gu, " ")
          .split(/\s+/)
          .filter(Boolean);
      const headWords = words(entry.nameSurface);
      const spanWords = words(slice);
      assert.ok(headWords.length > 0, `${entry.id}: Kopf ohne Wörter`);
      let cursor = 0;
      for (const word of headWords) {
        const at = spanWords.indexOf(word, cursor);
        assert.ok(at !== -1, `${entry.id}: «${word}» steht nicht in der Rohspanne`);
        cursor = at + 1;
      }
    }
  }
});
