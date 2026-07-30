import { strict as assert } from "node:assert";
import test from "node:test";
import { parseShamelaCriticisms } from "../scripts/import-shamela-rijal.mjs";
import {
  containsUndecodedShamelaBytes,
  decodeShamelaNarratorMetadata,
  decodeShamelaNarratorText,
} from "../scripts/shamela-rijal-decoder.mjs";

test("S1 byte decoder distinguishes narrator text and metadata separators", () => {
  assert.equal(decodeShamelaNarratorText(Uint8Array.from([104, 116, 67])), "ابن");
  assert.equal(decodeShamelaNarratorMetadata(Uint8Array.from([122, 64, 104, 116, 67])), "ابن");
  assert.equal(containsUndecodedShamelaBytes("راو [01]"), true);
  assert.equal(containsUndecodedShamelaBytes("راو معلوم"), false);
});

test("S1 biography parser keeps each scholar statement and citation separate", () => {
  const biography = [
    "أحمد بن حنبل",
    "ثقة ثبت",
    "تهذيب الكمال (1/ 23)",
    "123",
    "",
    "",
    "إثبات السماع",
    "سمع من الزهري",
    "سير أعلام النبلاء (2/ 45)",
    "456",
  ].join("\n");

  assert.deepEqual(parseShamelaCriticisms(biography), [
    {
      criticName: "أحمد بن حنبل",
      sectionKind: "critic",
      phrase: "ثقة ثبت",
      citedWork: "تهذيب الكمال",
      citedVolume: "1",
      citedPage: "23",
      sourcePageId: 123,
      sequenceNo: 0,
    },
    {
      criticName: "إثبات السماع",
      sectionKind: "hearing_evidence",
      phrase: "سمع من الزهري",
      citedWork: "سير أعلام النبلاء",
      citedVolume: "2",
      citedPage: "45",
      sourcePageId: 456,
      sequenceNo: 1,
    },
  ]);
});
