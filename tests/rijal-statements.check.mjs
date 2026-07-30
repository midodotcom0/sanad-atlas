import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { normalizeSearchText } from "../scripts/atlas-normalize.mjs";
import {
  REJECTION_CODES,
  RIJAL_STATEMENT_VERSION,
  cleanMentionSurface,
  evaluateMention,
  extractRijalStatements,
} from "../scripts/atlas-rijal-statements.mjs";

const SOURCE_KEYS = ["tahdhib", "mizan", "taqrib", "kashif"];
const CORPUS_AVAILABLE = SOURCE_KEYS.every((key) => existsSync(`.cache/turath-derived/${key}.json`));
const NAME_EDGE_PUNCTUATION = /^[ .،؛:\-()[\]]+|[ .،؛:\-()[\]]+$/g;

function corpusInput(entry) {
  return {
    id: entry.id,
    nameSurfaceNormalizedHead: normalizeSearchText(entry.nameSurface ?? "").replace(NAME_EDGE_PUNCTUATION, ""),
    entryText: entry.text ?? "",
    teacherMentions: entry.teacherMentions ?? [],
    studentMentions: entry.studentMentions ?? [],
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

test("bereinigt nur das verbindende Waw von Folgenennungen", () => {
  assert.equal(cleanMentionSurface("وكيع", 0), "وكيع");
  assert.equal(cleanMentionSurface("وحماد بن زيد", 1), "حماد بن زيد");
  assert.equal(cleanMentionSurface("(د) «حماد بن زيد»", 0), "حماد بن زيد");
});

test("erzeugt ausschliesslich quellengebundene Lehrer-zum-Schueler-Kandidaten", () => {
  const entry = {
    id: "entry-1",
    nameSurfaceNormalizedHead: normalizeSearchText("مالك بن أنس"),
    entryText: "روى عن نافع، وروى عنه الشافعي",
    teacherMentions: ["نافع"],
    studentMentions: ["الشافعي"],
  };
  const result = extractRijalStatements(entry);

  assert.equal(result.rejected.length, 0);
  assert.equal(result.accepted.length, 2);
  assert.equal(result.accepted[0].listKind, "teacher");
  assert.equal(result.accepted[0].relationshipType, "teacher");
  assert.equal(result.accepted[0].objectClusterId, result.accepted[1].subjectClusterId);
  for (const item of result.accepted) {
    assert.ok(entry.entryText.includes(item.surface), "jede angenommene Nennung steht wortwoertlich in der Passage");
    assert.deepEqual(
      Object.keys(item).filter((key) => /year|date|chronology/i.test(key)),
      [],
      "das Extraktionsergebnis darf keine Chronologie als Evidenz tragen",
    );
  }
  assert.equal(RIJAL_STATEMENT_VERSION, "rijal-statements-1.1.0");
});

test("weist die belegten False-Positive-Klassen der Vollkorpusprobe ab", () => {
  const cases = [
    ["البخاري ومسلم والنسايي وابن ماجه والمحاملي وابن عياش", REJECTION_CODES.UNSEGMENTED_PHRASE],
    ["هو اكبر منه", REJECTION_CODES.UNSEGMENTED_PHRASE],
    ["ق] بن عرزب الشامي", REJECTION_CODES.UNSEGMENTED_PHRASE],
    ["حماد بن سلمه ومالك", REJECTION_CODES.UNSEGMENTED_PHRASE],
    ["عن ابن عجلان", REJECTION_CODES.UNSEGMENTED_PHRASE],
    ["حدثنا اسماعيل بن ابي اويس", REJECTION_CODES.UNSEGMENTED_PHRASE],
    ["ابنا ابي شيبه", REJECTION_CODES.RELATIVE_FORM],
    ["غيرهما", REJECTION_CODES.NO_PERSON_NAMED],
    ["واخرون", REJECTION_CODES.NO_PERSON_NAMED],
    ["محمد بن مخلد - وهو اخر اصحابه", REJECTION_CODES.UNSEGMENTED_PHRASE],
    ["محمد بن يحيى خ م د", REJECTION_CODES.UNSEGMENTED_PHRASE],
    ["نافع عن ابن عمر في التوديع عند السفر", REJECTION_CODES.UNSEGMENTED_PHRASE],
    ["سوى النسائي", REJECTION_CODES.NO_PERSON_NAMED],
    ["الباقون مع البخاري ايضا بواسطه", REJECTION_CODES.NO_PERSON_NAMED],
  ];
  for (const [surface, code] of cases) {
    const verdict = evaluateMention(surface, 0, `قال ${surface}`);
    assert.equal(verdict.ok, false, surface);
    assert.equal(verdict.code, code, surface);
  }
});

test("jede Zurueckweisung bleibt mit eindeutigem Review-Code sichtbar", () => {
  const entry = {
    id: "entry-review",
    nameSurfaceNormalizedHead: normalizeSearchText("مالك بن أنس"),
    entryText: "مالك بن أنس ذكر نافع وغيرهما وعن ابن عجلان",
    teacherMentions: ["غيرهما", "عن ابن عجلان", "مفقود"],
    studentMentions: ["مالك بن أنس"],
  };
  const result = extractRijalStatements(entry);

  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, 4);
  assert.deepEqual(
    result.rejected.map((item) => item.code),
    [
      REJECTION_CODES.NO_PERSON_NAMED,
      REJECTION_CODES.UNSEGMENTED_PHRASE,
      REJECTION_CODES.PHRASE_NOT_IN_PASSAGE,
      REJECTION_CODES.SELF_REFERENCE,
    ],
  );
  assert.ok(result.rejected.every((item) => item.entryId === entry.id && item.detail && Number.isInteger(item.index)));
});

test("Vollkorpus: jede Rohnennung endet genau einmal als Aussagekandidat oder Review-Fall", { skip: !CORPUS_AVAILABLE }, () => {
  let rawMentions = 0;
  let accepted = 0;
  let rejected = 0;

  for (const source of SOURCE_KEYS) {
    const data = JSON.parse(readFileSync(`.cache/turath-derived/${source}.json`, "utf8"));
    for (const entry of data.entries) {
      const input = corpusInput(entry);
      const result = extractRijalStatements(input);
      rawMentions += input.teacherMentions.length + input.studentMentions.length;
      accepted += result.accepted.length;
      rejected += result.rejected.length;

      for (const item of result.accepted) {
        assert.ok(input.entryText.includes(item.surface), `${source}:${entry.id} ohne wortwoertliche Passage`);
        assert.equal(item.relationshipType, "teacher");
      }
      for (const item of result.rejected) {
        assert.ok(Object.values(REJECTION_CODES).includes(item.code), `${source}:${entry.id} ohne Review-Code`);
      }
    }
  }

  assert.equal(accepted + rejected, rawMentions);
  assert.ok(accepted > 0);
  assert.ok(rejected > 0);
});

test("JS- und Python-Port sind fuer den gesamten aktuellen Rijal-Bestand bytegleich", { skip: !CORPUS_AVAILABLE }, () => {
  const entries = SOURCE_KEYS.flatMap((source) => {
    const data = JSON.parse(readFileSync(`.cache/turath-derived/${source}.json`, "utf8"));
    return data.entries.map(corpusInput);
  });
  const jsDigest = createHash("sha256");
  for (const entry of entries) jsDigest.update(`${canonicalJson(extractRijalStatements(entry))}\n`);

  const python = spawnSync(
    "python3",
    ["-c", String.raw`
import hashlib
import json
import sys

sys.path.insert(0, "backend")
from app.rijal_statements import extract_rijal_statements

digest = hashlib.sha256()
for entry in json.load(sys.stdin):
    result = json.dumps(
        extract_rijal_statements(entry),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    digest.update((result + "\n").encode("utf-8"))
print(digest.hexdigest())
`],
    {
      cwd: process.cwd(),
      input: JSON.stringify(entries),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  assert.equal(python.status, 0, python.stderr);
  assert.equal(python.stdout.trim(), jsDigest.digest("hex"));
});
