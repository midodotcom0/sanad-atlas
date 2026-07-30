/**
 * Prueft, dass `scripts/atlas-normalize.mjs` (der dritte Port der kanonischen
 * arabischen Normalisierung, fuer die SQLite-Build-Pipeline) bitgleich zu
 * `lib/search.ts` und `backend/app/normalize.py` ist -- gegen dieselbe
 * Fixture, die `tests/normalize-parity.test.ts` und
 * `tests/normalize-parity-python.py` bereits pruefen.
 *
 * Ausfuehren: `node --test tests/atlas-db-normalize-parity.check.mjs`
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert";
import test from "node:test";
import { normalizeSearchText, NORMALIZER_VERSION } from "../scripts/atlas-normalize.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(projectRoot, "public/data/corpus/normalize-fixture.json");
const available = existsSync(fixturePath);

test("Fixture deckt mindestens 200 echte Korpusformen ab und Versionen stimmen", { skip: !available && "keine normalize-fixture.json" }, () => {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  assert.ok(fixture.samples.length >= 200, `nur ${fixture.samples.length} Samples`);
  assert.equal(fixture.normalizerVersion, NORMALIZER_VERSION);
});

test("atlas-normalize.mjs reproduziert die Importer-Ausgabe bitgleich", { skip: !available && "keine normalize-fixture.json" }, () => {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const divergent = fixture.samples
    .filter((sample) => normalizeSearchText(sample.raw) !== sample.normalized)
    .map((sample) => sample.raw);
  assert.deepEqual(divergent, []);
});

test("Normalisierung ist idempotent", { skip: !available && "keine normalize-fixture.json" }, () => {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  for (const sample of fixture.samples) {
    assert.equal(normalizeSearchText(sample.normalized), sample.normalized);
  }
});

test("Vertragsregeln: Diakritika, Alef-Formen, ta-marbuta, ibn/bin", () => {
  assert.equal(normalizeSearchText("يَحْيَى"), normalizeSearchText("يحيي"));
  assert.equal(normalizeSearchText("أإآٱ"), "اااا");
  assert.equal(normalizeSearchText("ى"), "ي");
  assert.equal(normalizeSearchText("ة"), "ه");
  assert.equal(normalizeSearchText("ؤ"), "و");
  assert.equal(normalizeSearchText("ئ"), "ي");
  assert.equal(normalizeSearchText("مـــحمد"), "محمد");
  assert.ok(normalizeSearchText("Yaḥyā ibn Saʿīd").includes("yahya"));
  assert.ok(normalizeSearchText("Yaḥyā ibn Saʿīd").includes(" b "));
  assert.ok(normalizeSearchText("Malik BIN Anas").includes(" b "));
});

test("Whitespace- und Locale-Unabhaengigkeit", () => {
  assert.equal(normalizeSearchText("Ibrahim"), "ibrahim");
  assert.equal(normalizeSearchText(" مالك بن　أنس﻿"), "مالك بن انس");
  assert.equal(normalizeSearchText(null), "");
  assert.equal(normalizeSearchText(undefined), "");
});
