/**
 * Paritaet der beiden Datumsphrasen-Leser.
 *
 * worker/src/core/hijri-date-phrase.mjs und backend/app/hijri_date_phrase.py
 * muessen dieselbe Phrase gleich lesen -- sonst liefern Worker und
 * FastAPI-Referenz verschiedene Datierungen fuer denselben Eintrag, und der
 * Vertragstest kann das nicht auffangen, weil er nur die gemeinsame
 * Turath-Quelle vergleicht (dort steht das Jahr ausgeschrieben).
 *
 * Dieselbe Bauart wie tests/normalize-parity*: eine Fixture, zwei Laufzeiten.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseHijriYearPhrase } from "../worker/src/core/hijri-date-phrase.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Echte Wortlaute aus dem Shamela-Register plus Grenzfaelle. */
const FIXTURE = [
  ["145، أو: 146هـ، أو: 147هـ، وقيل: 144هـ", "death"],
  ["60هـ، أو: 61هـ", "birth"],
  ["218هـ، وقيل: 217هـ", "death"],
  ["179هـ، وقيل: 178هـ", "death"],
  ["بعد 140هـ", "death"],
  ["نحو ١٢٠هـ", "death"],
  ["قبيل 200هـ", "death"],
  ["ست وثلاثين ومئتين", "death"],
  ["", "death"],
  [null, "birth"],
];

test("jede Angabe der Quelle bleibt eine eigene Aussage", () => {
  const [phrase, kind] = FIXTURE[0];
  const items = parseHijriYearPhrase(phrase, kind).assertions;
  assert.equal(items.length, 4, "vier genannte Jahre, vier Aussagen");
  assert.deepEqual(items.map((item) => item.valueAh), [145, 146, 147, 144]);
  assert.deepEqual(items.map((item) => item.relation), ["primary", "alternative", "alternative", "reported"]);
  // Reihenfolge der Quelle, nicht aufsteigend sortiert.
  assert.ok(items[3].valueAh < items[0].valueAh);
  for (const item of items) {
    assert.equal(item.sourcePhrase, phrase, "jede Aussage bleibt auf den vollen Wortlaut rueckfuehrbar");
    assert.equal(item.evidenceClass, "rijal_statement");
    assert.notEqual(item.reviewStatus, "verified");
  }
});

test("Grenzangaben bleiben Grenzangaben", () => {
  assert.equal(parseHijriYearPhrase("بعد 140هـ", "death").assertions[0].qualifier, "after");
  assert.equal(parseHijriYearPhrase("قبيل 200هـ", "death").assertions[0].qualifier, "shortly_before");
  const circa = parseHijriYearPhrase("نحو ١٢٠هـ", "death").assertions[0];
  assert.equal(circa.qualifier, "circa");
  assert.equal(circa.approximate, true);
  assert.equal(circa.valueAh, 120, "arabisch-indische Ziffern werden gelesen");
});

test("ohne Ziffern im Wortlaut entsteht keine Aussage", () => {
  // Die Turath-Werke schreiben ihre Jahre aus. Hier wird nichts erzeugt --
  // das ausgewertete Einzeljahr steht weiterhin in deathYearCandidate.
  assert.deepEqual(parseHijriYearPhrase("ست وثلاثين ومئتين", "death").assertions, []);
  assert.deepEqual(parseHijriYearPhrase("", "death").assertions, []);
  assert.deepEqual(parseHijriYearPhrase(null, "birth").assertions, []);
});

test("der Python-Port liest jede Phrase gleich", () => {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(root, "backend"))})
from app.hijri_date_phrase import parse_hijri_year_phrase
cases = json.loads(sys.stdin.read())
print(json.dumps([parse_hijri_year_phrase(p, k) for p, k in cases], ensure_ascii=False))
`;
  const result = spawnSync("python3", ["-c", script], {
    input: JSON.stringify(FIXTURE),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  const fromPython = JSON.parse(result.stdout);
  const fromNode = FIXTURE.map(([phrase, kind]) => parseHijriYearPhrase(phrase, kind).assertions);
  assert.deepEqual(fromPython, fromNode, "beide Ports muessen dieselbe Phrase gleich lesen");
});
