/**
 * Sanad-Atlas-Importer für die registrierten Turath-Quellen.
 *
 * Leitprinzipien (Abschnitt 6 und 14 der Projektbeschreibung):
 *   1. Arabische Normalisierung OHNE Verlust des Originaltextes. Jede Rohform bleibt
 *      zeichengenau erhalten und ist über `spanStart`/`spanEnd` auf die Quelldatei in
 *      `.cache/turath/<bookId>.json` zurückschneidbar.
 *   2. Kein Datensatz wird still verworfen. Jedes nummerierte Vorkommen erhält eine Klasse
 *      und, falls unparsebar, einen konkreten Fehlercode. Verworfene Kandidaten wandern in
 *      eine Review-Queue.
 *   3. Maschinelle Verarbeitung setzt NIEMALS `verified`. Konfidenzbänder: high >= 0,90,
 *      medium 0,70-0,89, low < 0,70.
 *
 * Aufruf: `node scripts/import-turath-corpus.mjs` (Rohdaten aus `.cache/turath`)
 *         `node scripts/import-turath-corpus.mjs --fetch` (lädt fehlende Bücher nach)
 *
 * Die Normalisierung in Abschnitt 1 ist eine wortgleiche Kopie von `lib/search.ts`.
 * Beide werden über `public/data/corpus/normalize-fixture.json` und die Tests
 * `tests/normalize-parity.test.ts` bzw. `tests/normalize-parity-python.py` gegen
 * `backend/app/normalize.py` abgeglichen. Weicht eine Kopie ab, schlagen die Tests fehl.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(projectRoot, "data/sources/turath-manifest.json");
const cacheDir = resolve(projectRoot, ".cache/turath");
const outputDir = resolve(projectRoot, ".cache/turath-derived");
const publicOutputDir = resolve(projectRoot, "public/data/corpus");
// Die Normalisierungs-Fixture liegt unter tests/, weil .gitignore public/data/corpus/*.json
// bis auf manifest.json und completeness.json ausschließt. Die Parity-Tests müssen die
// Fixture aber im Repository finden.
const testFixtureDir = resolve(projectRoot, "tests");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const shouldFetch = process.argv.includes("--fetch");

/* ══════════════════════════════════════════════════════════════════════════════
 * 0. Versionen — eine Quelle, damit Parser- und Datenversion nicht divergieren
 * ════════════════════════════════════════════════════════════════════════════ */

const PARSER_VERSION = "1.0.0";
const NORMALIZER_VERSION = "sanad-normalize-1.0.0";
const HADITH_PARSER_VERSION = `turath-hadith-parser-${PARSER_VERSION}`;
const RIJAL_PARSER_VERSION = `turath-rijal-parser-${PARSER_VERSION}`;

/** Konfidenzbänder aus dem Projektvertrag. `verified` ist maschinell unerreichbar. */
function confidenceBand(value) {
  if (value >= 0.9) return "high";
  if (value >= 0.7) return "medium";
  return "low";
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 1. Kanonische Normalisierung — wortgleiche Kopie von lib/search.ts
 * ════════════════════════════════════════════════════════════════════════════ */

const NORMALIZE_WHITESPACE_CLASS =
  "\\t\\n\\v\\f\\r\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";
const WHITESPACE_RUN = new RegExp(`[${NORMALIZE_WHITESPACE_CLASS}]+`, "g");
const WHITESPACE_EDGE = new RegExp(`^[${NORMALIZE_WHITESPACE_CLASS}]+|[${NORMALIZE_WHITESPACE_CLASS}]+$`, "g");

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\b(?:ibn|bin)\b/gi, "b")
    .replace(WHITESPACE_RUN, " ")
    .replace(WHITESPACE_EDGE, "")
    .toLowerCase();
}

// Zeichenmenge identisch zu NORMALIZE_WHITESPACE_CLASS.
const WHITESPACE_SET = new Set([
  "\t", "\n", "\u000b", "\f", "\r", "\u0020", "\u0085", "\u00a0", "\u1680",
  "\u2000", "\u2001", "\u2002", "\u2003", "\u2004", "\u2005", "\u2006", "\u2007",
  "\u2008", "\u2009", "\u200a", "\u2028", "\u2029", "\u202f", "\u205f", "\u3000", "\ufeff",
]);
const LETTER_SUBSTITUTIONS = new Map([
  ["أ", "ا"], ["إ", "ا"], ["آ", "ا"], ["ٱ", "ا"], ["ى", "ي"], ["ة", "ه"], ["ؤ", "و"], ["ئ", "ي"],
]);

/**
 * Zeichenweise Normalisierung mit Rückwärtskarte. Ergebnis ist identisch zu
 * `normalizeSearchText` für arabischen Text (die lateinische ibn/bin-Regel greift in
 * arabischen Isnaden nicht) und liefert zusätzlich für jedes Ausgabezeichen den Index
 * im Eingabetext. Damit bleibt jede Position rückschneidbar.
 */
function normalizeWithMap(input) {
  const chars = [];
  const offsets = [];
  for (let index = 0; index < input.length; index += 1) {
    for (const decomposed of input[index].normalize("NFKD")) {
      if (/\p{M}/u.test(decomposed) || decomposed === "ـ") continue;
      const mapped = LETTER_SUBSTITUTIONS.get(decomposed) ?? decomposed;
      if (WHITESPACE_SET.has(mapped)) {
        if (chars.length && chars[chars.length - 1] === " ") continue;
        chars.push(" ");
        offsets.push(index);
        continue;
      }
      chars.push(mapped.toLowerCase());
      offsets.push(index);
    }
  }
  let from = 0;
  let to = chars.length;
  while (from < to && chars[from] === " ") from += 1;
  while (to > from && chars[to - 1] === " ") to -= 1;
  return { text: chars.slice(from, to).join(""), offsets: offsets.slice(from, to) };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 2. Markup-Entfernung mit Offset-Karte
 * ════════════════════════════════════════════════════════════════════════════ */

/**
 * Entfernt Turath-Markup und liefert für jedes Ausgabezeichen den Index im Rohtext der
 * Cache-Datei. Zusätzlich werden die Bereiche der `data-type="title"`-Spans gemeldet —
 * sie enthalten in Tahdhīb und Mīzān den echten Namenskopf einer Rijāl-Trandslation.
 */
function stripWithMap(raw) {
  const chars = [];
  const offsets = [];
  const titleSpans = [];
  const stack = [];
  let newlineRun = 0;
  const lastChar = () => (chars.length ? chars[chars.length - 1] : "");
  function emit(character, rawIndex) {
    if (character === "\n") {
      newlineRun += 1;
      if (newlineRun > 2) return;
    } else newlineRun = 0;
    if ((character === " " || character === "\t") && (lastChar() === " " || lastChar() === "\t")) return;
    chars.push(character === "\t" ? " " : character);
    offsets.push(rawIndex);
  }
  let index = 0;
  while (index < raw.length) {
    const character = raw[index];
    if (character === "<") {
      const close = raw.indexOf(">", index);
      if (close === -1) {
        emit(character, index);
        index += 1;
        continue;
      }
      const tag = raw.slice(index, close + 1);
      if (/^<span/i.test(tag)) {
        stack.push(/data-type\s*=\s*["']?title/i.test(tag) ? { start: chars.length } : null);
      } else if (/^<\/span/i.test(tag)) {
        const open = stack.pop();
        if (open) titleSpans.push({ start: open.start, end: chars.length });
      } else {
        emit(" ", index);
      }
      index = close + 1;
      continue;
    }
    if (character === "⦗") {
      const end = raw.indexOf("⦘", index);
      if (end !== -1) {
        emit(" ", index);
        index = end + 1;
        continue;
      }
    }
    if (raw.startsWith("&nbsp;", index)) {
      emit(" ", index);
      index += 6;
      continue;
    }
    if (character === "\r") {
      index += 1;
      continue;
    }
    emit(character, index);
    index += 1;
  }
  let from = 0;
  let to = chars.length;
  while (from < to && /\s/.test(chars[from])) from += 1;
  while (to > from && /\s/.test(chars[to - 1])) to -= 1;
  return {
    text: chars.slice(from, to).join(""),
    offsets: offsets.slice(from, to),
    titleSpans: titleSpans
      .map(({ start, end }) => ({ start: start - from, end: end - from }))
      .filter((span) => span.end > 0 && span.start < to - from),
  };
}

function lowerBound(sorted, value) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid] < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Drei Ebenen einer Seite: Rohtext (Cache-Datei), markupfreier Text und Suchform.
 * Alle Spannen werden am Ende in Rohtext-Koordinaten ausgegeben.
 */
function preparePage(rawText) {
  const stripped = stripWithMap(rawText);
  const normalized = normalizeWithMap(stripped.text);
  const normalizedToRaw = normalized.offsets.map((strippedIndex) => stripped.offsets[strippedIndex]);
  return {
    raw: rawText,
    stripped: stripped.text,
    strippedToRaw: stripped.offsets,
    titleSpans: stripped.titleSpans,
    normalized: normalized.text,
    normalizedToStripped: normalized.offsets,
    normalizedToRaw,
    /** Übersetzt eine Spanne der Suchform in eine Spanne des Rohtexts. */
    rawSpan(start, end) {
      if (!normalizedToRaw.length) return null;
      const first = Math.max(0, Math.min(start, normalizedToRaw.length - 1));
      const last = Math.max(first, Math.min(end, normalizedToRaw.length) - 1);
      return { spanStart: normalizedToRaw[first], spanEnd: normalizedToRaw[last] + 1 };
    },
    /** Übersetzt eine Spanne des markupfreien Texts in eine Spanne des Rohtexts. */
    rawSpanFromStripped(start, end) {
      if (!stripped.offsets.length) return null;
      const first = Math.max(0, Math.min(start, stripped.offsets.length - 1));
      const last = Math.max(first, Math.min(end, stripped.offsets.length) - 1);
      return { spanStart: stripped.offsets[first], spanEnd: stripped.offsets[last] + 1 };
    },
    strippedIndexOfRaw(rawIndex) {
      return lowerBound(stripped.offsets, rawIndex);
    },
    normalizedIndexOfStripped(strippedIndex) {
      return lowerBound(normalized.offsets, strippedIndex);
    },
  };
}

/** Prüft, ob eine Rohspanne markupfrei ist — nur dann ist der Ausschnitt wörtlich zitierbar. */
function spanIntegrity(rawText, spanStart, spanEnd) {
  const slice = rawText.slice(spanStart, spanEnd);
  return /[<>⦗⦘]/.test(slice) ? "contains-markup" : "verbatim";
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 3. Arabische Zahlwörter, Ziffern und Datumsaussagen
 * ════════════════════════════════════════════════════════════════════════════ */

const ARABIC_DIGITS = new Map([..."٠١٢٣٤٥٦٧٨٩"].map((digit, index) => [digit, String(index)]));
function toAsciiDigits(value) {
  return String(value).replace(/[٠-٩]/g, (digit) => ARABIC_DIGITS.get(digit));
}

// Die Lexika stehen in normalisierter Form (ة→ه, ى→ي, ئ→ي, أ→ا), weil sie gegen die
// Suchform geprüft werden. "مائة" normalisiert zu "مايه", "مئة" zu "ميه".
const YEAR_UNITS = new Map(Object.entries({
  "واحد": 1, "واحده": 1, "احدي": 1, "احد": 1, "اثنتين": 2, "اثنين": 2, "ثنتين": 2, "اثنتي": 2, "اثني": 2, "ثنتي": 2,
  "ثلاث": 3, "ثلاثه": 3, "اربع": 4, "اربعه": 4, "اربعا": 4, "خمس": 5, "خمسه": 5, "ست": 6, "سته": 6,
  "سبع": 7, "سبعه": 7, "ثمان": 8, "ثمانيه": 8, "ثماني": 8, "ثمانه": 8, "تسع": 9, "تسعه": 9,
}));
const YEAR_TENS = new Map(Object.entries({
  "عشر": 10, "عشره": 10, "عشرين": 20, "عشرون": 20, "ثلاثين": 30, "ثلاثون": 30, "اربعين": 40, "اربعون": 40,
  "خمسين": 50, "خمسون": 50, "ستين": 60, "ستون": 60, "سبعين": 70, "سبعون": 70, "ثمانين": 80, "ثمانون": 80,
  "تسعين": 90, "تسعون": 90,
}));
const YEAR_HUNDREDS = new Map(Object.entries({
  "مايه": 100, "ميه": 100, "مئه": 100, "ماه": 100,
  "مايتين": 200, "ميتين": 200, "مئتين": 200, "مايتي": 200, "ميتي": 200, "مئتي": 200,
  "ثلاثمايه": 300, "ثلاثميه": 300, "اربعمايه": 400, "اربعميه": 400, "خمسمايه": 500, "خمسميه": 500,
  "ستمايه": 600, "ستميه": 600, "سبعمايه": 700, "سبعميه": 700, "ثمانمايه": 800, "ثمانميه": 800,
  "ثمانيمايه": 800, "ثمانيميه": 800, "تسعمايه": 900, "تسعميه": 900,
}));
const YEAR_APPROX = new Set(["بضع", "بضعه", "نيف", "نيفا"]);

/**
 * Liest eine arabisch ausgeschriebene Jahresangabe.
 * "ثلاث وثمانين ومئة" → 183 · "ثلاث وثلاثمائة" → 303 · "ثلاث مائة" → 300
 * Die Unterscheidung liegt am Bindewort: "و" addiert, ohne "و" multipliziert.
 * Fehlt die Hunderterangabe ("إحدى وستين"), bleibt `centuryExplicit` false — das Jahrhundert
 * wird NICHT geraten.
 */
function parseYearWords(tokens) {
  let hundreds = 0;
  let tens = 0;
  let unit = 0;
  let used = 0;
  let sawAny = false;
  let sawHundreds = false;
  let approximate = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const rawToken = tokens[index];
    const token = rawToken === "و" ? "و" : rawToken.replace(/^و/, "");
    if (token === "و" || token === "") {
      if (index === used) used = index + 1;
      continue;
    }
    if (YEAR_APPROX.has(token)) {
      approximate = true;
      sawAny = true;
      used = index + 1;
      continue;
    }
    if (YEAR_HUNDREDS.has(token)) {
      hundreds += YEAR_HUNDREDS.get(token);
      sawHundreds = true;
      sawAny = true;
      used = index + 1;
      continue;
    }
    if (YEAR_UNITS.has(token)) {
      const rawNext = tokens[index + 1];
      const next = rawNext ? rawNext.replace(/^و/, "") : "";
      if (next === "عشر" || next === "عشره") {
        tens = 10;
        unit = YEAR_UNITS.get(token);
        sawAny = true;
        used = index + 2;
        index += 1;
        continue;
      }
      if (rawNext && !rawNext.startsWith("و") && YEAR_HUNDREDS.get(next) === 100 && YEAR_UNITS.get(token) >= 3) {
        hundreds += YEAR_UNITS.get(token) * 100;
        sawHundreds = true;
        sawAny = true;
        used = index + 2;
        index += 1;
        continue;
      }
      if (unit) break;
      unit = YEAR_UNITS.get(token);
      sawAny = true;
      used = index + 1;
      continue;
    }
    if (YEAR_TENS.has(token)) {
      if (tens && tens !== 10) break;
      tens = YEAR_TENS.get(token);
      sawAny = true;
      used = index + 1;
      continue;
    }
    break;
  }
  if (!sawAny) return null;
  const value = hundreds + tens + unit;
  if (value < 1 || value > 1100) return null;
  if (approximate && !tens && !hundreds) return null;
  return { value, centuryExplicit: sawHundreds, tokensUsed: used, approximate };
}

const DATE_VERBS = [
  ["ماتت", "death"], ["مات", "death"], ["توفيت", "death"], ["توفي", "death"], ["وفاته", "death"], ["وفاتها", "death"],
  ["استشهد", "death"], ["قتلته", "death"], ["قتله", "death"], ["قتلت", "death"], ["قتلوه", "death"], ["قتل", "death"],
  ["هلك", "death"], ["ولدت", "birth"], ["ولد", "birth"], ["مولده", "birth"], ["مولدها", "birth"], ["مولد", "birth"],
  ["كان حيا", "alive_in"], ["بقي الي", "alive_in"], ["عاش الي", "alive_in"], ["دفن", "burial"],
];
const DATE_TRIGGER = new RegExp(
  `(?:^|[\\s،؛:.()\\[\\]«»"])و?(${DATE_VERBS.map(([word]) => word).join("|")})(?![ء-ي])`,
  "g",
);
const DATE_QUALIFIER = /(?:^|\s)(بعد|قبل|نحو|حدود|قريبا من|في اول|في اخر|اول|اخر)(?:\s|$)/;
const YEAR_ANCHOR = /(?:^|[\s،؛:[\]])(?:في\s+)?(?:سنه|عام)\s*\(?\s*/g;
const DATE_WINDOW = 140;
const AGE_AT_DEATH = /(?:^|\s)(?:وله|وهو ابن|بلغ|عاش|وعاش|وقد بلغ)\s+([^\s]{2,14}(?:\s+و[^\s]{2,14})?)\s+سنه(?:\s|$|[.،؛])/;

function readYear(tail) {
  const digits = tail.match(/^([٠-٩0-9]{2,4})(?![٠-٩0-9])/);
  if (digits) {
    const value = Number(toAsciiDigits(digits[1]));
    if (value >= 1 && value <= 1100) {
      return { value, centuryExplicit: value >= 100, approximate: false, rawPhrase: digits[1] };
    }
  }
  const tokens = tail.split(/[\s،؛:.()"«»[\]]+/).slice(0, 8).filter(Boolean);
  const parsed = parseYearWords(tokens);
  if (!parsed) return null;
  return {
    value: parsed.value,
    centuryExplicit: parsed.centuryExplicit,
    approximate: Boolean(parsed.approximate),
    rawPhrase: tokens.slice(0, parsed.tokensUsed).join(" "),
  };
}

/**
 * Findet Datumsaussagen in einem normalisierten Rijāl-Text. Mehrere und einander
 * widersprechende Angaben bleiben nebeneinander stehen — es wird kein Mittelwert gebildet
 * und kein Geburtsjahr aus einem Todesjahr geschätzt.
 */
function extractDateAssertions(normalizedText) {
  const assertions = [];
  const hits = [];
  DATE_TRIGGER.lastIndex = 0;
  let match;
  while ((match = DATE_TRIGGER.exec(normalizedText))) {
    hits.push({
      verb: match[1],
      kind: DATE_VERBS.find(([word]) => word === match[1])[1],
      start: match.index + match[0].length - match[1].length,
      end: match.index + match[0].length,
    });
    DATE_TRIGGER.lastIndex = match.index + match[0].length;
  }
  for (let index = 0; index < hits.length; index += 1) {
    const hit = hits[index];
    let limit = Math.min(normalizedText.length, hit.end + DATE_WINDOW);
    const next = hits[index + 1];
    if (next && next.start > hit.end && next.start < limit) limit = next.start;
    let window = normalizedText.slice(hit.end, limit);
    const stop = window.search(/[.؟!]|_{3,}/);
    if (stop !== -1) window = window.slice(0, stop);
    let parsed = null;
    let gap = "";
    let yearEnd = 0;
    YEAR_ANCHOR.lastIndex = 0;
    let anchor;
    while ((anchor = YEAR_ANCHOR.exec(window))) {
      const at = anchor.index + anchor[0].length;
      const candidate = readYear(window.slice(at));
      if (candidate) {
        parsed = candidate;
        gap = window.slice(0, anchor.index);
        yearEnd = at + candidate.rawPhrase.length;
        break;
      }
    }
    if (!parsed && /^[\s،؛:]*[٠-٩0-9]{2,4}/.test(window)) {
      const direct = readYear(window.replace(/^[\s،؛:]+/, ""));
      if (direct) {
        parsed = direct;
        yearEnd = window.indexOf(direct.rawPhrase) + direct.rawPhrase.length;
      }
    }
    if (!parsed) continue;
    const qualifierMatch = DATE_QUALIFIER.exec(gap.length <= 40 ? gap : gap.slice(-40));
    const confidence = parsed.centuryExplicit ? (parsed.approximate ? 0.68 : 0.85) : 0.65;
    assertions.push({
      kind: hit.kind,
      verb: hit.verb,
      qualifier: qualifierMatch ? qualifierMatch[1] : parsed.approximate ? "نحو" : null,
      valueAh: parsed.value,
      centuryExplicit: parsed.centuryExplicit,
      approximate: parsed.approximate,
      rawPhrase: parsed.rawPhrase,
      textOffset: hit.start,
      evidenceClass: "rijal_statement",
      confidence,
      confidenceBand: confidenceBand(confidence),
      reviewStatus: "unreviewed",
    });
    const after = window.slice(yearEnd);
    const variant = after.match(/^\s*(?:او|وقيل|ويقال)\s*(?:في\s+)?(?:سنه|عام)?\s*/);
    if (!variant) continue;
    const alternative = readYear(after.slice(variant[0].length));
    if (!alternative) continue;
    assertions.push({
      kind: hit.kind,
      verb: hit.verb,
      qualifier: "reported-variant",
      valueAh: alternative.value,
      centuryExplicit: alternative.centuryExplicit,
      approximate: alternative.approximate,
      rawPhrase: alternative.rawPhrase,
      textOffset: hit.start,
      evidenceClass: "rijal_statement",
      confidence: 0.6,
      confidenceBand: confidenceBand(0.6),
      reviewStatus: "unreviewed",
    });
  }
  return assertions;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 4. Rijāl-Namenskopf, Kunya, Nisba, Ṭabaqa, Region
 * ════════════════════════════════════════════════════════════════════════════ */

const HEAD_CUT_TOKENS = [
  "عن", "روي عن", "سمع", "سمع من", "حدث عن", "اخذ عن", "يروي عن", "وعنه", "عنه", "روي عنه", "حدث عنه",
  "يروي عنه", "رواه عنه", "قال", "قالت", "وقال", "قلت", "وقلت", "ثقه", "صدوق", "ضعيف", "ضعفوه", "مجهول",
  "متروك", "مستور", "مقبول", "لين", "هالك", "كذاب", "واه", "صحابي", "له صحبه", "لا يعرف", "لا يعتمد",
  "لا باس به", "فيه نظر", "وثقه", "وثق", "ثم", "مات", "ماتت", "توفي", "توفيت", "روي له", "اخرج له", "ذكره",
  "وذكره", "انظر", "تقدم", "يايي", "تمييز", "مبتدع", "زاهد", "مشهور", "محله الصدق", "صالح الحديث",
  "منكر الحديث", "حسن الحديث", "اسمه", "واسمه", "يقال", "ويقال", "وهو", "وهي", "وقد", "وكان", "كان",
  "صاحب", "احد", "من الطبقه", "بخ", "خت", "وزعم", "زعم", "اختلف", "يعرف", "لقبه", "ولقبه", "سكن", "نزيل",
  "مولي", "مولاه", "مولاهم", "حليف", "والد", "ابنه", "اخو", "اخوه", "جد", "حفيد", "قاضي", "امام", "حافظ",
  "شيخ", "ثبت", "له", "وله", "خلط", "سماعه",
];
const TABAQA_ORDINALS = [
  "الاولي", "الثانيه", "الثالثه", "الرابعه", "الخامسه", "السادسه", "السابعه", "الثامنه", "التاسعه",
  "العاشره", "الحاديه عشره", "الثانيه عشره",
];
const HEAD_CUT = new RegExp(
  "(?:^|[\\s،؛])(?:" +
    [...HEAD_CUT_TOKENS, ...TABAQA_ORDINALS.map((ordinal) => `من (?:كبار |صغار |اواسط |اوساط )?${ordinal}`)].join("|") +
    ")(?=[\\s،؛.:]|$)",
);
const TABAQA_PATTERN = new RegExp(`من\\s+(كبار|صغار|اواسط|اوساط)?\\s*(${TABAQA_ORDINALS.join("|")})`);
const TABAQA_ORDINAL_INDEX = new Map(TABAQA_ORDINALS.map((ordinal, index) => [ordinal, index + 1]));
const FOOTNOTE_MARK = /\(\s*\^?\s*[٠-٩0-9]{1,3}\s*\)/g;
const SIGLA_LEAD = /^\s*(?:[([]\s*(?:[ء-ي٤]{1,3}\s*[،,]?\s*){1,8}[)\]]|[([]\s*تمييز\s*[)\]])\s*/;
const GLOSS_TOKENS = new Set([
  "بضم", "بفتح", "بكسر", "بسكون", "باسكان", "وسكون", "وفتح", "وضم", "وكسر", "واسكان", "وبفتحها",
  "وبكسرها", "وبضمها", "بعدها", "بعده", "بعدهما", "ثم", "واخره", "واخرها", "اخره", "مهمله", "معجمه",
  "موحده", "مثناه", "مثلثه", "تحتانيه", "فوقانيه", "ساكنه", "خفيفه", "ثقيله", "مشدده", "مخففه", "مصغر",
  "مصغرا", "بالتصغير", "بالتخفيف", "بالتشديد", "بالقصر", "بالمد", "والمد", "والقصر", "بمعجمه", "بمهمله",
  "بموحده", "بمثناه", "بمثلثه", "بنون", "بجيم", "بحاء", "بخاء", "بدال", "بذال", "براء", "بزاي", "بسين",
  "بشين", "بصاد", "بضاد", "بطاء", "بظاء", "بعين", "بغين", "بفاء", "بقاف", "بكاف", "بلام", "بميم", "بهاء",
  "بواو", "بياء", "بهمزه", "بباء", "بتاء", "بثاء", "بمعجمات", "بمهملات", "بمعجمتين", "بمهملتين", "نون",
  "جيم", "حاء", "خاء", "دال", "ذال", "راء", "زاي", "سين", "شين", "صاد", "ضاد", "طاء", "ظاء", "عين", "غين",
  "فاء", "قاف", "كاف", "لام", "ميم", "هاء", "واو", "ياء", "همزه", "باء", "تاء", "ثاء", "حرف", "حروف",
  "الحروف", "لفظ", "بلفظ", "كسرها", "فتحها", "ضمها", "وحكي", "اللام", "الميم", "الراء", "النون",
  "المهمله", "المعجمه", "الموحده", "الفاء", "القاف", "الكاف", "العين", "الحاء", "الجيم", "الدال",
  "الزاي", "السين", "الشين", "الصاد", "الطاء", "الياء", "الواو", "الهاء", "الباء", "التاء", "الثاء",
  "والراء", "والنون", "وسين", "وميم", "ولام", "ونون", "وراء", "وجيم", "وكاف", "وقاف", "وفاء", "وعين",
  "وحاء", "ودال", "وزاي", "وشين", "وصاد", "وطاء", "وباء", "وتاء", "وثاء", "وهاء", "وواو", "وياء",
  "وهمزه", "معا", "معجمتين", "مهملتين",
]);
const NISBA_STOPWORDS = new Set([
  "صحابي", "تابعي", "مولاي", "والدي", "اخي", "ابني", "نفسي", "يعني", "الذي", "التي", "الباقي", "الماضي",
  "حي", "في", "علي", "الي", "المتوفي", "الاتي", "الثاني", "الاولي",
]);
const NISBA_REGION = new Map(Object.entries({
  "الكوفي": "الكوفة", "كوفي": "الكوفة", "البصري": "البصرة", "بصري": "البصرة", "المدني": "المدينة",
  "مدني": "المدينة", "المكي": "مكة", "مكي": "مكة", "الدمشقي": "دمشق", "دمشقي": "دمشق", "الشامي": "الشام",
  "شامي": "الشام", "المصري": "مصر", "مصري": "مصر", "الواسطي": "واسط", "واسطي": "واسط",
  "البغدادي": "بغداد", "بغدادي": "بغداد", "اليماني": "اليمن", "يماني": "اليمن", "الخراساني": "خراسان",
  "خراساني": "خراسان", "المروزي": "مرو", "مروزي": "مرو", "المروي": "مرو", "النيسابوري": "نيسابور",
  "الرازي": "الري", "رازي": "الري", "الحمصي": "حمص", "حمصي": "حمص", "الحلبي": "حلب",
  "الجزري": "الجزيرة", "الاندلسي": "الأندلس", "الاصبهاني": "أصبهان", "الاصفهاني": "أصبهان",
  "الهروي": "هراة", "البلخي": "بلخ", "الطبري": "طبرستان", "الانطاكي": "أنطاكية", "الحراني": "حران",
  "الموصلي": "الموصل", "السمرقندي": "سمرقند", "البخاري": "بخارى", "الجرجاني": "جرجان",
  "العسقلاني": "عسقلان", "القرطبي": "قرطبة", "الطرسوسي": "طرسوس", "العدني": "عدن", "الصنعاني": "صنعاء",
  "الايلي": "أيلة", "الطايفي": "الطائف", "الاسكندراني": "الإسكندرية", "التستري": "تستر",
  "الفلسطيني": "فلسطين", "الاهوازي": "الأهواز", "القزويني": "قزوين", "الهمداني": "همدان",
  "الهمذاني": "همذان", "السجستاني": "سجستان", "الطوسي": "طوس", "الرملي": "الرملة", "التنيسي": "تنيس",
  "البيروتي": "بيروت", "المرعشي": "مرعش", "الجندي": "الجند", "الطرابلسي": "طرابلس", "البيهقي": "بيهق",
  "الهجري": "هجر", "الاموي": null,
}));
const RESIDENCE_PATTERN = /(?:^|\s)نزيل\s+([^\s،؛.]{3,20})/;

/** Entfernt Fußnotenmarken und führende Quellensigel aus einem Namenskopf. */
function cleanHead(value) {
  let head = value
    .replace(FOOTNOTE_MARK, " ")
    .replace(/⦗[^⦘]*⦘/g, " ")
    // Rest einer Fußnotenmarke, deren öffnende Klammer außerhalb der Spanne lag.
    .replace(/^\s*\^?\s*[٠-٩0-9]{0,3}\s*[)\]]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  const sigla = [];
  let guard = 0;
  let match;
  while ((match = SIGLA_LEAD.exec(head)) && guard < 4) {
    sigla.push(match[0].trim());
    head = head.slice(match[0].length);
    guard += 1;
  }
  head = head
    .replace(/\s+-\s+[\s\S]*$/, "")
    .replace(/^[\s،؛:.\-/]+/, "")
    // Anschlusswörter am Kopfanfang gehören nicht zum Namen ("فأما إبراهيم بن سويد").
    .replace(/^(?:فاما|واما|اما|فأما|وأما|أما|ثم|منهم|وفيهم|وقد|وهو)\s+/, "")
    .replace(/[\s،؛:.\-•/]+$/, "")
    .trim();
  // Eingebettete Quellensigel wie «[خ د]» oder «[صح، خ، م]» werden getrennt geführt.
  head = head.replace(/\[[^\]]{0,18}\]/g, (group) => {
    if (/[ء-ي]{4,}/.test(group)) return group;
    sigla.push(group);
    return " ";
  }).replace(/\s+/g, " ").replace(/^[\s،؛:.\-/]+|[\s،؛:.\-•/]+$/g, "").trim();
  return { head, sigla };
}

/** Schneidet einen Kandidatentext beim ersten Bewertungs-, Beziehungs- oder Datumswort ab. */
function cutAtBoundary(value) {
  const normalized = normalizeSearchText(value);
  const at = normalized.search(HEAD_CUT);
  if (at <= 0) return { text: value, cut: at === 0 };
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (normalizeSearchText(value.slice(0, mid + 1)).length > at) high = mid;
    else low = mid + 1;
  }
  return { text: value.slice(0, low), cut: true };
}

// Eine Glosse MUSS mit einem einleitenden Wort beginnen. Sonst würde ein Lexikoneintrag wie
// "النون" den echten Namen «ذو النون المصري» zerstören.
const GLOSS_INTRODUCERS = new Set(
  [...GLOSS_TOKENS].filter((token) => /^ب/.test(token)).concat(["مصغر", "مصغرا", "بالتصغير", "بالتخفيف", "بالتشديد", "بالقصر", "بالمد"]),
);

/** Trennt orthografische Glossen ("بضم الموحدة بعدها مهملة") vom Namen ab. */
function stripGloss(head) {
  const pieces = head.split(/(\s+)/);
  const kept = [];
  const notes = [];
  let run = null;
  for (const piece of pieces) {
    if (/^\s+$/.test(piece)) {
      (run ?? kept).push(piece);
      continue;
    }
    const token = normalizeSearchText(piece).replace(/[،؛.:()[\]"]/g, "");
    if (run ? GLOSS_TOKENS.has(token) : GLOSS_INTRODUCERS.has(token)) {
      run = run ?? [];
      run.push(piece);
      continue;
    }
    if (run) {
      notes.push(run.join("").trim());
      run = null;
    }
    kept.push(piece);
  }
  if (run) notes.push(run.join("").trim());
  return {
    head: kept.join("").replace(/\s+/g, " ").replace(/[\s،؛:.-]+$/, "").trim(),
    notes: notes.map((note) => note.replace(/^[\s،؛]+|[\s،؛]+$/g, "")).filter((note) => note.length > 1),
  };
}

/** Zerlegt einen Namenskopf in Kunya, Nisba-Liste, Nasab-Kette und Region. */
function fieldsFromHead(head) {
  const tokens = normalizeSearchText(head).split(/[\s،؛]+/).filter(Boolean);
  let kunya = null;
  let kunyaAt = -1;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    const isMarker = (token === "ابو" || token === "ام" || token === "ابا") && !(index > 0 && /^(?:بن|ابن)$/.test(tokens[index - 1]));
    const isVerbal = token === "يكني" || token === "ويكني";
    if (!isMarker && !isVerbal) continue;
    const from = isVerbal ? index + 1 : index;
    const parts = [tokens[from]];
    if (tokens[from + 1] && !/^(?:بن|ابن)$/.test(tokens[from + 1])) parts.push(tokens[from + 1]);
    if (/^(?:عبد|ابي|ابن|ال)$/.test(parts[1] ?? "") && tokens[from + 2]) parts.push(tokens[from + 2]);
    kunya = parts.join(" ");
    kunyaAt = index;
    break;
  }
  const nisbas = [];
  let firstNisbaAt = -1;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (NISBA_STOPWORDS.has(token) || /^لل/.test(token)) continue;
    const looksLikeNisba = /^ال[ء-ي]{3,}ي$/.test(token) || (/^[ء-ي]{4,}ي$/.test(token) && index > 0);
    if (!looksLikeNisba) continue;
    if (index > 0 && /^(?:بن|ابن|ابو|ابي|ام|ابا)$/.test(tokens[index - 1])) continue;
    if (/^(?:بن|ابن)$/.test(tokens[index + 1] ?? "")) continue;
    if (firstNisbaAt === -1) firstNisbaAt = index;
    if (!nisbas.includes(token)) nisbas.push(token);
  }
  const chainEnd = [kunyaAt, firstNisbaAt].filter((index) => index > 0).sort((a, b) => a - b)[0] ?? tokens.length;
  const residence = RESIDENCE_PATTERN.exec(normalizeSearchText(head));
  return {
    kunya,
    nisbas,
    nameChain: tokens.slice(0, chainEnd).join(" "),
    nameChainTokens: tokens.slice(0, chainEnd).filter((token) => !/^(?:بن|ابن)$/.test(token)),
    region: nisbas.map((nisba) => NISBA_REGION.get(nisba)).find(Boolean) ?? null,
    residence: residence ? residence[1] : null,
  };
}

function extractTabaqa(normalizedText) {
  const match = TABAQA_PATTERN.exec(normalizedText);
  if (!match) return null;
  return {
    label: [match[1], match[2]].filter(Boolean).join(" "),
    ordinal: TABAQA_ORDINAL_INDEX.get(match[2]) ?? null,
    modifier: match[1] ?? null,
    evidenceClass: "rijal_statement",
    confidence: 0.88,
    confidenceBand: confidenceBand(0.88),
    reviewStatus: "unreviewed",
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 5. Lehrer- und Schülerphrasen
 * ════════════════════════════════════════════════════════════════════════════ */

const TEACHER_CUES = ["روي عن", "يروي عن", "روي عنه ايضا", "حدث عن", "سمع من", "اخذ عن", "قرا علي", "عن"];
const STUDENT_CUES = ["روي عنه", "يروي عنه", "حدث عنه", "رواه عنه", "اخذ عنه", "وعنه", "عنه"];
const RELATION_STOP = [
  "وعنه", "روي عنه", "حدث عنه", "يروي عنه", "رواه عنه", "اخذ عنه", "ثقه", "صدوق", "ضعيف", "مجهول",
  "متروك", "مستور", "مقبول", "لين", "هالك", "كذاب", "وثقه", "وثق", "قال", "وقال", "قلت", "مات", "ماتت",
  "توفي", "وفاته", "من الطبقه", "روي له", "اخرج له", "ذكره", "وذكره", "له", "فيه نظر", "لا يعرف",
  "صالح الحديث", "منكر الحديث", "من كبار", "من صغار", "تمييز",
];
const RELATION_STOP_PATTERN = `(?:${[...RELATION_STOP, ...TABAQA_ORDINALS.map((o) => `من ${o}`)].join("|")})`;
const TEACHER_PATTERN = new RegExp(
  `(?:^|[\\s،؛.])(?:${TEACHER_CUES.join("|")})\\s*[:：]?\\s+([\\s\\S]{2,600}?)(?=[\\s،؛.](?:${RELATION_STOP_PATTERN})(?=[\\s،؛.:]|$)|$)`,
);
const STUDENT_PATTERN = new RegExp(
  `(?:^|[\\s،؛.])(?:${STUDENT_CUES.join("|")})\\s*[:：]?\\s+([\\s\\S]{2,600}?)(?=[\\s،؛.](?:${["ثقه", "صدوق", "ضعيف", "مجهول", "متروك", "مستور", "مقبول", "لين", "هالك", "كذاب", "وثقه", "وثق", "قال", "وقال", "قلت", "مات", "ماتت", "توفي", "وفاته", "روي له", "اخرج له", "ذكره", "وذكره", "من الطبقه", "فيه نظر", "تمييز", ...TABAQA_ORDINALS.map((o) => `من ${o}`)].join("|")})(?=[\\s،؛.:]|$)|$)`,
);

/** Zerlegt eine Beziehungsphrase in einzelne Nennungen. Jede bleibt ein Vorschlag. */
function splitMentions(phrase) {
  if (!phrase) return [];
  return phrase
    .split(/\s*(?:،|؛|\bو(?=[اآإأبتثجحخدذرزسشصضطظعغفقكلمنهوي]{2,}\s))\s*/)
    .map((piece) => piece.replace(/^[\s،؛:.-]+|[\s،؛:.-]+$/g, "").trim())
    .filter((piece) => piece.length >= 3 && piece.length <= 80 && !/^(?:و|جماعه|وجماعه|غيره|وغيره|اخرين|واخرين|خلق|وخلق)$/.test(piece))
    .slice(0, 40);
}

function extractRelationPhrases(normalizedText) {
  const teacher = TEACHER_PATTERN.exec(normalizedText);
  const student = STUDENT_PATTERN.exec(normalizedText);
  const teacherPhrase = teacher ? teacher[1].replace(/[\s،؛:.-]+$/, "").trim() || null : null;
  const studentPhrase = student ? student[1].replace(/[\s،؛:.-]+$/, "").trim() || null : null;
  return {
    teacherPhrase,
    studentPhrase,
    teacherMentions: splitMentions(teacherPhrase),
    studentMentions: splitMentions(studentPhrase),
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 6. Isnād und Matn
 * ════════════════════════════════════════════════════════════════════════════ */

// Erweiterte Begriffsliste. Bis Version 0.4.1 fehlten أنبأنا, حدثناه, أخبرناه, ثنا und أنا;
// 113 Bukhārī-Vorkommen scheiterten allein daran.
const STRONG_TERMS = [
  "حدثنا", "حدثني", "حدثناه", "حدثنيه", "حدثنا به", "اخبرنا", "اخبرني", "اخبرناه", "اخبرنيه",
  "انبانا", "انباني", "نبانا", "ثنا", "انا", "نا", "سمعت", "سمعنا", "قرات علي", "حكي لنا",
];
const LINK_TERMS = [...STRONG_TERMS, "عن", "انه سمع", "انها سمعت", "ذكر", "بلغني", "قال", "قالت"];
const boundedAlternation = (list) => `(?:و|ف)?(?:${list.slice().sort((a, b) => b.length - a.length).join("|")})`;
const STRONG_TERM_PATTERN = new RegExp(`(?:^|[\\s،؛:.()"«»])${boundedAlternation(STRONG_TERMS)}(?=[\\s:،؛.])`, "g");
const CHAIN_LINK_PATTERN = new RegExp(
  `(?:^|[\\s،؛:.()"«»])${boundedAlternation(LINK_TERMS.filter((term) => term !== "قال" && term !== "قالت"))}(?=[\\s:،؛.])`,
  "g",
);
const NARRATOR_TERM_PATTERN = new RegExp(`(?:^|[\\s،؛:.()"«»])(${boundedAlternation(LINK_TERMS)})(?=[\\s:،؛.])`, "g");

const PROPHET_NAMES = "(?:رسول الله|النبي|نبي الله)";
const PROPHET_HONORIFIC = "(?:\\s*صلي الله عليه وسلم|\\s*صلي الله عليه و سلم|\\s*عليه السلام)?";
const PROPHET_ATTRIBUTION = new RegExp(
  `(?:قال|قالت|قالا|يقول|فقال|انه قال|انه سمع|سمعت|عن)\\s*${PROPHET_NAMES}${PROPHET_HONORIFIC}\\s*(?:انه\\s*)?(?:يقول|قال|فقال|قالت)?\\s*[:؛،.]*\\s*`,
  "g",
);
const QUOTE_OPEN = /["«“(﴿]/g;
const SPEECH_COLON = /(?:قال|قالت|قالا|قالوا|يقول|فقال|انه قال)\s*[:.]\s*/g;
const SPEECH_BARE = /(?:قال|قالت|قالا|قالوا|يقول|فقال)\s+/g;
const SUBORDINATE_CLAUSE = /(?:^|\s)(?:ان|انه|انها|انهم)\s+/g;
const COLON_BOUNDARY = /:\s*/g;
const ATTRIBUTED_REPORT = /^\s*(?:و?قال|و?قالت|و?قالا|و?قالوا|و?يقول|و?ذكر|و?زاد|و?روي)\s*[^:،]{0,60}?[:،]\s*/;
const REFERENCE_FORMULA = /(?:^|[\s،؛.:])(?:بمثله|مثله|بنحوه|نحوه|بهذا الاسناد|باسناده|باسنادهما|باسنادهم|بمعناه|نحو حديث|مثل حديث|بهذا الحديث|بذلك|سواء|بمثل ذلك|بمثل هذا|بنحو ذلك)(?=[\s،؛.:]|$)/;
const SHORT_REFERENCE = /(?:^|\s)(?:بهذا|مثله|بمثله|نحوه|بنحوه|سواء|بمعناه)(?=[\s.،؛]|$)/;
const STRUCTURAL_HEADING = /^(?:باب|ابواب|كتاب)(?=[\s:.،]|$)/;
const ROUTE_SPLIT = /(?:^|\s)(?:ح\s*و?|وحدثنا|وحدثني|واخبرنا|واخبرني|وانبانا|وحدثناه|واخبرناه)(?=\s)/g;

function firstMatchAfter(pattern, text, from) {
  pattern.lastIndex = from;
  const match = pattern.exec(text);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

/**
 * Bestimmt die Grenze zwischen Isnād und Matn auf der Suchform eines Vorkommens.
 *
 * Die alte Heuristik suchte einen Redeverb NACH der ersten Prophetennennung. Genau
 * umgekehrt steht im arabischen Hadith die Rede vor der Nennung ("قال: قال رسول الله ﷺ")
 * oder die Prophetennennung liegt mitten im Matn. Deshalb wird jetzt vom ENDE der
 * Überliefererkette aus gesucht und rückwärts durch alle Kettenglieder iteriert.
 * Jede Regel trägt ihren Namen und ihre Konfidenz in den Datensatz.
 */
function findMatnBoundary(normalized) {
  const linkEnds = [];
  CHAIN_LINK_PATTERN.lastIndex = 0;
  let match;
  while ((match = CHAIN_LINK_PATTERN.exec(normalized))) {
    linkEnds.push(match.index + match[0].length);
    CHAIN_LINK_PATTERN.lastIndex = match.index + match[0].length;
  }
  if (!linkEnds.length) {
    const lone = ATTRIBUTED_REPORT.exec(normalized);
    if (lone && normalized.length - lone[0].length >= 8) {
      return { boundary: lone[0].length, rule: "attributed-report", confidence: 0.5, error: null, recordClass: "attributed-report", chainEndIndex: 0 };
    }
    return { boundary: null, rule: null, confidence: 0, error: "transmission-term-not-found", recordClass: "unparsed" };
  }
  const chainEnd = linkEnds[linkEnds.length - 1];
  const residual = normalized.slice(chainEnd);
  const tailWords = residual.split(/[\s،؛.:]+/).filter(Boolean);
  if ((tailWords.length <= 16 && REFERENCE_FORMULA.test(residual)) || (tailWords.length <= 5 && SHORT_REFERENCE.test(residual))) {
    return { boundary: chainEnd, rule: "reference-record", confidence: 0.7, error: null, recordClass: "hadith-reference", chainEndIndex: chainEnd };
  }
  const rules = [
    ["quote-open", QUOTE_OPEN, 0.8, "start"],
    ["prophet-attribution", PROPHET_ATTRIBUTION, 0.78, "end"],
    ["speech-verb-colon", SPEECH_COLON, 0.72, "end"],
    ["speech-verb", SPEECH_BARE, 0.62, "end"],
    ["colon-boundary", COLON_BOUNDARY, 0.6, "end"],
    ["subordinate-clause", SUBORDINATE_CLAUSE, 0.55, "end"],
  ];
  for (let index = linkEnds.length - 1; index >= 0; index -= 1) {
    const from = linkEnds[index];
    let best = null;
    for (const [rule, pattern, confidence, side] of rules) {
      const hit = firstMatchAfter(pattern, normalized, from);
      if (!hit) continue;
      const boundary = side === "start" ? hit.start : hit.end;
      if (boundary <= from) continue;
      if (normalized.length - boundary < 8) continue;
      if (!best || boundary < best.boundary || (boundary === best.boundary && confidence > best.confidence)) {
        best = { boundary, rule, confidence };
      }
    }
    if (best) return { ...best, error: null, recordClass: "hadith", chainEndIndex: from };
  }
  const attributed = ATTRIBUTED_REPORT.exec(normalized);
  if (attributed && normalized.length - attributed[0].length >= 8) {
    return { boundary: attributed[0].length, rule: "attributed-report", confidence: 0.5, error: null, recordClass: "attributed-report", chainEndIndex: 0 };
  }
  return { boundary: null, rule: null, confidence: 0, error: "matn-boundary-not-found", recordClass: "unparsed" };
}

const RELATIVE_FORMS = /^(?:ابيه|ابيها|ابوه|امه|امها|عمه|عمها|عمته|اخيه|اخيها|اختها|جده|جدها|جدته|ابنه|ابنها|شيخه|رجل|شيخ|امراه|بعض اصحابه)$/u;
const SURFACE_REJECT = /^(?:هذا|ذلك|كذا|ما|لا|كان|كنت|فقال|به|بهذا|مثله|نحوه|ذكره|قال|قالت|قوله|هو|هي|انه|انها|اليه|منه|عنه|فيه|لي|له|لك|بها|جميعا|كلاهما|كلهم)$/u;

/**
 * Erzeugt positionsgenaue Erzählerstellen für eine Kette.
 * Jede Stelle trägt `spanStart`/`spanEnd` in Rohtext-Koordinaten der Cache-Datei,
 * die verbatim daraus geschnittene `rawSurfaceForm` und die normalisierte Suchform.
 */
function extractNarratorOccurrences(page, chainNormStart, chainNormEnd, chainId, prophetScanEnd = chainNormEnd) {
  const scope = page.normalized.slice(chainNormStart, chainNormEnd);
  const occurrences = [];
  const seen = new Set();
  const terms = [];
  NARRATOR_TERM_PATTERN.lastIndex = 0;
  let match;
  while ((match = NARRATOR_TERM_PATTERN.exec(scope))) {
    terms.push({ term: match[1], start: match.index, end: match.index + match[0].length });
    NARRATOR_TERM_PATTERN.lastIndex = match.index + match[0].length;
  }
  for (let index = 0; index < terms.length; index += 1) {
    const term = terms[index];
    const hardStop = terms[index + 1]?.start ?? scope.length;
    let from = term.end;
    let piece = scope.slice(from, hardStop);
    const delimiter = piece.search(/[،؛:.\n()"«»]/);
    if (delimiter !== -1) piece = piece.slice(0, delimiter);
    const filler = piece.match(/^(?:ان|انه|انها|وهو|وهي|يعني|جميعا|كلاهما|كلهم|قال|قالا|قالت|له|عن)\s+/);
    if (filler) {
      from += filler[0].length;
      piece = piece.slice(filler[0].length);
    }
    const trimmedStart = piece.length - piece.trimStart().length;
    from += trimmedStart;
    // Nachgestellte Redeverben gehören nicht zum Namen ("أبا هريرة يقول" → "أبا هريرة").
    const surface = piece.trim().replace(/\s+(?:يقول|يحدث|يخبر|يذكر|يروي|قال|قالت|انه)$/u, "").trim();
    if (surface.length < 2 || surface.length > 92) continue;
    if (SURFACE_REJECT.test(surface)) continue;
    if (!/[ء-ي]/.test(surface)) continue;
    if (seen.has(surface)) continue;
    seen.add(surface);
    const span = page.rawSpan(chainNormStart + from, chainNormStart + from + surface.length);
    if (!span) continue;
    const rawSurfaceForm = page.raw.slice(span.spanStart, span.spanEnd);
    const relativeForm = RELATIVE_FORMS.test(surface);
    occurrences.push({
      chainId,
      position: occurrences.length,
      rawSurfaceForm,
      normalizedSurfaceForm: surface,
      transmissionTerm: term.term,
      spanStart: span.spanStart,
      spanEnd: span.spanEnd,
      spanIntegrity: spanIntegrity(page.raw, span.spanStart, span.spanEnd),
      relativeForm,
      // Explizites Signal statt Textprobe: die Rohform trägt jetzt Diakritika, weshalb
      // `rawSurfaceForm.includes("رسول الله")` nicht mehr greift.
      prophetMention: false,
      identityStatus: relativeForm ? "unresolved-relative" : "unresolved",
      evidenceClass: "isnad_link",
      reviewStatus: "unreviewed",
    });
    if (occurrences.length >= 24) break;
  }
  // Die Prophetennennung steht häufig in der Zuschreibungsformel unmittelbar hinter dem
  // Kettenende ("... عن أبي هريرة قال: قال رسول الله ﷺ"). Sie wird deshalb in einem
  // begrenzten Nachlauffenster mitgelesen — der Offset zeigt trotzdem auf die echte Stelle
  // im Rohtext, und die Isnād-Spanne selbst bleibt unverändert.
  const prophetScope = page.normalized.slice(chainNormStart, Math.max(chainNormEnd, prophetScanEnd));
  const PROPHET_SURFACE = /(?:رسول الله|نبي الله|النبي)(?:\s*صلي الله عليه وسلم)?/;
  if (PROPHET_SURFACE.test(prophetScope)) {
    const at = prophetScope.search(PROPHET_SURFACE);
    const surface = PROPHET_SURFACE.exec(prophetScope.slice(at))[0];
    const span = page.rawSpan(chainNormStart + at, chainNormStart + at + surface.length);
    if (span && !seen.has(surface)) {
      occurrences.push({
        chainId,
        position: occurrences.length,
        rawSurfaceForm: page.raw.slice(span.spanStart, span.spanEnd),
        normalizedSurfaceForm: surface,
        transmissionTerm: null,
        spanStart: span.spanStart,
        spanEnd: span.spanEnd,
        spanIntegrity: spanIntegrity(page.raw, span.spanStart, span.spanEnd),
        relativeForm: false,
        prophetMention: true,
        identityStatus: "prophet-mention",
        evidenceClass: "isnad_link",
        reviewStatus: "unreviewed",
      });
    }
  }
  return occurrences;
}

/** Trennt parallele Überlieferungswege ("ح", "وحدثنا") und erhält jede Rohform. */
function splitChainRoutes(page, isnadNormStart, isnadNormEnd, recordId, attributionEnd = isnadNormEnd) {
  const scope = page.normalized.slice(isnadNormStart, isnadNormEnd);
  const cuts = [0];
  ROUTE_SPLIT.lastIndex = 0;
  let match;
  while ((match = ROUTE_SPLIT.exec(scope))) {
    const at = match.index + (match[0].startsWith(" ") ? 1 : 0);
    if (at > cuts[cuts.length - 1] + 8) cuts.push(at);
    ROUTE_SPLIT.lastIndex = match.index + match[0].length;
  }
  cuts.push(scope.length);
  const chains = [];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const localStart = cuts[index];
    const localEnd = cuts[index + 1];
    if (localEnd - localStart < 6) continue;
    const chainOrder = chains.length;
    const chainId = `${recordId}#c${chainOrder}`;
    const span = page.rawSpan(isnadNormStart + localStart, isnadNormStart + localEnd);
    if (!span) continue;
    chains.push({
      chainId,
      chainOrder,
      // Rohform, zeichengenau aus der Cache-Datei geschnitten (P1.2).
      rawIsnad: page.raw.slice(span.spanStart, span.spanEnd),
      normalizedIsnad: scope.slice(localStart, localEnd).trim(),
      spanStart: span.spanStart,
      spanEnd: span.spanEnd,
      spanIntegrity: spanIntegrity(page.raw, span.spanStart, span.spanEnd),
      narratorOccurrences: extractNarratorOccurrences(
        page,
        isnadNormStart + localStart,
        isnadNormStart + localEnd,
        chainId,
        localEnd === scope.length ? Math.max(isnadNormStart + localEnd, attributionEnd) : isnadNormStart + localEnd,
      ),
    });
  }
  return chains;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 7. Extraktion
 * ════════════════════════════════════════════════════════════════════════════ */

function hashOf(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

async function rawSha256(source) {
  return createHash("sha256").update(await readFile(resolve(cacheDir, `${source.turathBookId}.json`))).digest("hex");
}

function sourceUrl(bookId, pageIndex) {
  return `https://app.turath.io/book/${bookId}?page=${pageIndex}`;
}

function titleFromPage(text) {
  const matches = [...text.matchAll(/<span[^>]*data-type=["']title["'][^>]*>(.*?)<\/span>/gis)];
  if (!matches.length) return null;
  const title = matches.at(-1)[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return title || null;
}

function recordMarkerPattern(key) {
  return key === "muslim"
    ? /(?:^|\n)([٠-٩0-9]{1,5})\s*-\s*\(([٠-٩0-9]{1,5})\)\s*/g
    : /(?:^|\n)([٠-٩0-9]{1,5})\s*-\s*/g;
}

function extractHadiths(bookJson, source) {
  const records = [];
  let currentBook = null;
  let currentChapter = null;
  for (const [pageIndex, page] of bookJson.pages.entries()) {
    // Die Bukhārī-Datei beginnt mit einem Herausgebervorwort, dessen nummerierte Beispiele
    // wie Hadithe aussehen. Das Werk selbst startet mit Band 1.
    if (source.key === "bukhari" && page.vol === "المقدمة") continue;
    const heading = titleFromPage(page.text);
    if (heading) {
      if (/^\d+\s*-\s*(?!باب)/.test(toAsciiDigits(normalizeSearchText(heading)))) currentBook = heading;
      if (/باب/.test(normalizeSearchText(heading))) currentChapter = heading;
    }
    const prepared = preparePage(page.text);
    // Die Datensatzgrenzen werden im ROHTEXT gesucht. Im markupfreien Text würden zusätzlich
    // rund 3.900 in Title-Spans versteckte Kapitelüberschriften als Datensätze erscheinen.
    const markers = [...page.text.matchAll(recordMarkerPattern(source.key))];
    for (let index = 0; index < markers.length; index += 1) {
      const marker = markers[index];
      const markerRawStart = marker.index + (marker[0].startsWith("\n") ? 1 : 0);
      const bodyRawStart = marker.index + marker[0].length;
      const recordRawEnd = markers[index + 1]?.index ?? page.text.length;
      const displayNumber = Number(toAsciiDigits(source.key === "muslim" ? marker[2] : marker[1]));
      const routeNumber = Number(toAsciiDigits(marker[1]));
      if (!Number.isFinite(displayNumber) || displayNumber < 1 || displayNumber > 10000) continue;
      // Die Hauptzählung von Muḥammad Fuʾād ʿAbd al-Bāqī für Muslim endet bei 3033.
      // Höhere geklammerte Werte sind Verweise, keine Hauptnummern.
      if (source.key === "muslim" && displayNumber > 3033) continue;

      const strippedBodyStart = prepared.strippedIndexOfRaw(bodyRawStart);
      const strippedRecordEnd = prepared.strippedIndexOfRaw(recordRawEnd);
      let strippedBodyEnd = strippedRecordEnd;
      const footnoteAt = prepared.stripped.slice(strippedBodyStart, strippedRecordEnd).search(/\n_{5,}\n/);
      if (footnoteAt !== -1) strippedBodyEnd = strippedBodyStart + footnoteAt;
      const normStart = prepared.normalizedIndexOfStripped(strippedBodyStart);
      const normEnd = prepared.normalizedIndexOfStripped(strippedBodyEnd);
      const normalizedBody = prepared.normalized.slice(normStart, normEnd).trim();
      const recordId = `${source.key}-${displayNumber}-${routeNumber}-${pageIndex}`;
      const recordSpan = { spanStart: markerRawStart, spanEnd: recordRawEnd };
      const commonSource = {
        provider: "turath",
        bookId: source.turathBookId,
        url: sourceUrl(source.turathBookId, pageIndex + 1),
        rightsStatus: source.rightsStatus,
      };

      if (!normalizedBody) {
        records.push({
          id: recordId, collection: source.key, hadithNumber: displayNumber, routeNumber,
          book: currentBook, chapter: currentChapter, volume: page.vol, printedPage: page.page,
          sourcePageId: pageIndex + 1, recordClass: "unparsed",
          isnad: "", matn: "", narratorSurfaceForms: [], chains: [], chainLength: 0, routeMarkers: 1,
          matnFingerprint: hashOf(""), sourceSpan: recordSpan, isnadSpan: null, matnSpan: null,
          parser: {
            version: HADITH_PARSER_VERSION, normalizerVersion: NORMALIZER_VERSION, confidence: 0,
            confidenceBand: confidenceBand(0), reviewStatus: "unreviewed", state: "numbered-record-unparsed",
            boundaryRule: null, errorReason: "empty-segment",
          },
          source: commonSource,
        });
        continue;
      }

      if (STRUCTURAL_HEADING.test(normalizedBody)) {
        records.push({
          id: recordId, collection: source.key, hadithNumber: displayNumber, routeNumber,
          book: currentBook, chapter: currentChapter, volume: page.vol, printedPage: page.page,
          sourcePageId: pageIndex + 1, recordClass: "structural-heading",
          isnad: "", matn: normalizedBody, narratorSurfaceForms: [], chains: [], chainLength: 0, routeMarkers: 1,
          matnFingerprint: hashOf(normalizedBody.replace(/[^\p{L}\p{N}]/gu, "")),
          sourceSpan: recordSpan, isnadSpan: null,
          matnSpan: prepared.rawSpan(normStart, normEnd),
          parser: {
            version: HADITH_PARSER_VERSION, normalizerVersion: NORMALIZER_VERSION, confidence: 0.85,
            confidenceBand: confidenceBand(0.85), reviewStatus: "unreviewed", state: "structural-heading",
            boundaryRule: "structural-heading", errorReason: null,
          },
          source: commonSource,
        });
        continue;
      }

      const boundary = findMatnBoundary(normalizedBody);
      const hasStrongTerm = (() => {
        STRONG_TERM_PATTERN.lastIndex = 0;
        return STRONG_TERM_PATTERN.test(normalizedBody);
      })();
      const isnadNormEnd = boundary.error ? normEnd : normStart + boundary.boundary;
      const isnadNormalized = boundary.error ? normalizedBody : normalizedBody.slice(0, boundary.boundary).trim();
      const matnNormalized = boundary.error ? "" : normalizedBody.slice(boundary.boundary).replace(/^[\s:،؛.-]+/, "").trim();
      const chains = boundary.error
        ? []
        : splitChainRoutes(prepared, normStart, isnadNormEnd, recordId, Math.min(normEnd, isnadNormEnd + 90));
      const narratorSurfaceForms = chains.flatMap((chain) => chain.narratorOccurrences.map((item) => item.rawSurfaceForm));
      const confidence = boundary.error ? 0 : boundary.confidence;
      records.push({
        id: recordId,
        collection: source.key,
        hadithNumber: displayNumber,
        routeNumber,
        book: currentBook,
        chapter: currentChapter,
        volume: page.vol,
        printedPage: page.page,
        sourcePageId: pageIndex + 1,
        recordClass: boundary.recordClass,
        // Suchformen (bestehende Feldnamen, von API und Oberfläche benutzt)
        isnad: isnadNormalized,
        matn: matnNormalized,
        // Rohform-Anker: jede Spanne ist ein Zeichenbereich in .cache/turath/<bookId>.json
        sourceSpan: recordSpan,
        isnadSpan: prepared.rawSpan(normStart, isnadNormEnd),
        matnSpan: boundary.error ? null : prepared.rawSpan(normStart + boundary.boundary, normEnd),
        narratorSurfaceForms,
        chains,
        chainLength: narratorSurfaceForms.length,
        routeMarkers: chains.length || 1,
        matnFingerprint: hashOf(matnNormalized.replace(/[^\p{L}\p{N}]/gu, "")),
        parser: {
          version: HADITH_PARSER_VERSION,
          normalizerVersion: NORMALIZER_VERSION,
          confidence,
          confidenceBand: confidenceBand(confidence),
          reviewStatus: "unreviewed",
          state: boundary.error
            ? "numbered-record-unparsed"
            : boundary.recordClass === "hadith"
              ? "heuristically-parsed"
              : boundary.recordClass === "hadith-reference"
                ? "matn-by-reference"
                : "attributed-report",
          boundaryRule: boundary.rule,
          errorReason: boundary.error,
          hasStrongTransmissionTerm: hasStrongTerm,
        },
        source: commonSource,
      });
    }
  }
  return records;
}

/**
 * Baut die Rijāl-Einträge eines Werks zusammen.
 *
 * Wichtig gegenüber Version 0.2.1: eine Trandslation wird über Seitengrenzen hinweg
 * zusammengesetzt. Vorher endete jeder Eintrag am Seitenende, weshalb Todesjahre,
 * Schülerlisten und Ṭabaqa-Angaben auf der Folgeseite verloren gingen. Fußnoten werden
 * je Seite abgetrennt und separat geführt, damit Herausgeberanmerkungen keine
 * Personendaten erzeugen.
 */
function extractRijalEntries(bookJson, source) {
  const contentStart = source.rijalContentStartPage ?? 0;
  const pages = [];
  let document = "";
  for (let pageIndex = contentStart; pageIndex < bookJson.pages.length; pageIndex += 1) {
    const page = bookJson.pages[pageIndex];
    const prepared = preparePage(page.text);
    const footnoteAt = prepared.stripped.search(/\n_{5,}\n/);
    const bodyEnd = footnoteAt === -1 ? prepared.stripped.length : footnoteAt;
    pages.push({
      pageIndex,
      page,
      prepared,
      body: prepared.stripped.slice(0, bodyEnd),
      documentStart: document.length,
      titleSpans: prepared.titleSpans.filter((span) => span.start < bodyEnd),
    });
    document += `${prepared.stripped.slice(0, bodyEnd)}\n`;
  }
  const pageOf = (documentIndex) => {
    let low = 0;
    let high = pages.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (pages[mid].documentStart <= documentIndex) low = mid;
      else high = mid - 1;
    }
    return pages[low];
  };
  const markerPattern = source.key === "tahdhib"
    ? /(?:^|\n)\[([٠-٩0-9]{1,5})\](\s*[([][^)\]]{0,24}[)\]])?\s*/g
    : /(?:^|\n)([٠-٩0-9]{1,5})\s*-\s*/g;
  const markers = [...document.matchAll(markerPattern)];
  const entries = [];
  const rejected = [];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const markerAt = marker.index + (marker[0].startsWith("\n") ? 1 : 0);
    const headStart = marker.index + marker[0].length;
    const segmentEnd = markers[index + 1]?.index ?? document.length;
    const entryNumber = Number(toAsciiDigits(marker[1]));
    const rawEntryText = document.slice(headStart, segmentEnd);
    const normalizedText = normalizeSearchText(rawEntryText);
    const home = pageOf(markerAt);
    const localMarkerAt = markerAt - home.documentStart;
    const localHeadStart = headStart - home.documentStart;

    // Namenskopf: in Tahdhīb und Mīzān steht er in einem `data-type="title"`-Span, in
    // Taqrīb und al-Kāshif endet er beim ersten Bewertungs-, Beziehungs- oder Datumswort.
    const titleSpan = home.titleSpans.find((span) => localMarkerAt >= span.start - 3 && localMarkerAt < span.end);
    let headRange = null;
    let headMethod = null;
    let headConfidence = 0;
    if (titleSpan && titleSpan.end > localHeadStart && titleSpan.end - localHeadStart < 420) {
      headRange = { start: localHeadStart, end: titleSpan.end };
      headMethod = "title-span";
      headConfidence = 0.9;
    }
    if (!headRange) {
      const window = home.body.slice(localHeadStart, Math.min(home.body.length, localHeadStart + 280)).split("\n")[0];
      const cut = cutAtBoundary(window);
      headRange = { start: localHeadStart, end: localHeadStart + cut.text.length };
      headMethod = cut.cut ? "boundary-cut" : "window-fallback";
      headConfidence = cut.cut ? 0.72 : 0.55;
    }
    const headSpan = home.prepared.rawSpanFromStripped(headRange.start, headRange.end);
    const headRaw = headSpan ? home.prepared.raw.slice(headSpan.spanStart, headSpan.spanEnd) : home.body.slice(headRange.start, headRange.end);
    const cleaned = cleanHead(headRaw);
    const glossed = stripGloss(cleaned.head);
    const nameSurface = glossed.head;
    const nameNormalized = normalizeSearchText(nameSurface);
    const fields = fieldsFromHead(nameSurface);

    const rejectReasons = [];
    if (!Number.isFinite(entryNumber)) rejectReasons.push("entry-number-unreadable");
    if (normalizedText.length < 12) rejectReasons.push("segment-too-short");
    if (normalizedText.length > 24000) rejectReasons.push("segment-too-long");
    if (nameNormalized.length < 4) rejectReasons.push("name-head-too-short");
    if (nameNormalized.length > 220) rejectReasons.push("name-head-too-long");
    if (!/[ء-ي]/.test(nameNormalized)) rejectReasons.push("name-head-not-arabic");
    // Namensprobe: Nasab-Marker ODER Nisba ODER Kunya. Ein einzelner Name wie
    // «شفعة السمعي» wird damit nicht mehr stillschweigend verworfen.
    const hasNameMarker = /(?:^|\s)(?:ابن|بن|ابو|ابي|ابا|ام|بنت|مولي)(?:\s|$)/.test(nameNormalized)
      || fields.nisbas.length > 0
      || Boolean(fields.kunya);
    if (!hasNameMarker) rejectReasons.push("no-personal-name-marker");

    const dateAssertions = extractDateAssertions(normalizedText);
    const deathAssertions = dateAssertions.filter((item) => item.kind === "death");
    const birthAssertions = dateAssertions.filter((item) => item.kind === "birth");
    const tabaqa = extractTabaqa(normalizedText);
    const relations = extractRelationPhrases(normalizedText);
    const ageMatch = AGE_AT_DEATH.exec(normalizedText);
    const ageParsed = ageMatch ? parseYearWords(ageMatch[1].split(/\s+/)) : null;

    // `deathYearCandidate` bleibt der bestehende Feldname, führt aber ausschließlich Jahre
    // mit ausdrücklicher Hunderterangabe. Ein «مات سنة ست وثلاثين» ohne Jahrhundert wird
    // NICHT zu 236 ergänzt; es steht vollständig und unverändert in `dateAssertions`.
    const fullySpecifiedDeath = deathAssertions.find((item) => item.centuryExplicit && !item.approximate)
      ?? deathAssertions.find((item) => item.centuryExplicit);
    const entryConfidence = Number(
      (0.35 + 0.3 * headConfidence + (fullySpecifiedDeath ? 0.1 : 0) + (tabaqa ? 0.07 : 0) + (relations.teacherPhrase ? 0.05 : 0)).toFixed(3),
    );
    const lastPage = pageOf(Math.max(headStart, segmentEnd - 1));

    const record = {
      id: `${source.key}-${entryNumber}-${home.pageIndex}-${index}`,
      entryNumber: Number.isFinite(entryNumber) ? entryNumber : null,
      // Bestehender Feldname. Nicht mehr `slice(0, 180)`, sondern ein echter Namenskopf.
      nameSurface,
      nameSurfaceNormalized: nameNormalized,
      nameSpan: headSpan
        ? {
            sourcePageId: home.pageIndex + 1,
            spanStart: headSpan.spanStart,
            spanEnd: headSpan.spanEnd,
            integrity: spanIntegrity(home.prepared.raw, headSpan.spanStart, headSpan.spanEnd),
          }
        : null,
      nameChain: fields.nameChain,
      nameChainTokens: fields.nameChainTokens,
      kunya: fields.kunya,
      nisbas: fields.nisbas,
      region: fields.region,
      residence: fields.residence,
      collectionSigla: cleaned.sigla,
      orthographyNotes: glossed.notes,
      tabaqa,
      deathYearCandidate: fullySpecifiedDeath ? fullySpecifiedDeath.valueAh : null,
      birthYearCandidate: birthAssertions.find((item) => item.centuryExplicit)?.valueAh ?? null,
      ageAtDeath: ageParsed && ageParsed.value >= 15 && ageParsed.value <= 130 ? ageParsed.value : null,
      dateAssertions,
      teacherPhrase: relations.teacherPhrase,
      studentPhrase: relations.studentPhrase,
      teacherMentions: relations.teacherMentions,
      studentMentions: relations.studentMentions,
      text: normalizedText,
      volume: home.page.vol,
      printedPage: home.page.page,
      sourcePageId: home.pageIndex + 1,
      entrySpan: {
        sourcePageId: home.pageIndex + 1,
        spanStart: headSpan?.spanStart ?? null,
        spanEnd: headSpan?.spanEnd ?? null,
        lastSourcePageId: lastPage.pageIndex + 1,
      },
      spansPages: lastPage.pageIndex - home.pageIndex + 1,
      parser: {
        version: RIJAL_PARSER_VERSION,
        normalizerVersion: NORMALIZER_VERSION,
        confidence: entryConfidence,
        confidenceBand: confidenceBand(entryConfidence),
        reviewStatus: "unreviewed",
        state: rejectReasons.length ? "rijal-entry-review-required" : "rijal-entry-parsed",
        errorReason: rejectReasons[0] ?? null,
        fields: {
          nameSurface: { method: headMethod, confidence: headConfidence, confidenceBand: confidenceBand(headConfidence) },
          deathYear: fullySpecifiedDeath
            ? { method: "arabic-year-phrase", confidence: fullySpecifiedDeath.confidence, confidenceBand: confidenceBand(fullySpecifiedDeath.confidence) }
            : null,
          tabaqa: tabaqa ? { method: "tabaqa-phrase", confidence: tabaqa.confidence, confidenceBand: confidenceBand(tabaqa.confidence) } : null,
          relations: relations.teacherPhrase || relations.studentPhrase
            ? { method: "relation-cue", confidence: 0.75, confidenceBand: confidenceBand(0.75) }
            : null,
        },
      },
      source: {
        provider: "turath",
        bookId: source.turathBookId,
        url: sourceUrl(source.turathBookId, home.pageIndex + 1),
        rightsStatus: source.rightsStatus,
      },
    };

    if (rejectReasons.length) {
      // Kein stiller Verlust: der Kandidat wandert vollständig in die Review-Queue.
      rejected.push({ ...record, rejectReasons });
      continue;
    }
    entries.push(record);
  }
  return { entries, rejected };
}

async function getBook(source) {
  const path = resolve(cacheDir, `${source.turathBookId}.json`);
  if (!existsSync(path)) {
    if (!shouldFetch) throw new Error(`Missing ${path}. Re-run with --fetch.`);
    const url = `${manifest.provider.filesUrl}/${source.turathBookId}.json`;
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "SanadAtlasResearch/1.0" } });
    if (!response.ok) throw new Error(`Turath ${source.turathBookId}: HTTP ${response.status}`);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
  }
  return JSON.parse(await readFile(path, "utf8"));
}

/* ══════════════════════════════════════════════════════════════════════════════
 * 8. Ausgabe
 * ════════════════════════════════════════════════════════════════════════════ */

const hadithSources = manifest.sources.filter((source) => source.kind === "hadith_collection");
const rijalSources = manifest.sources.filter((source) => source.kind.startsWith("rijal"));

await mkdir(outputDir, { recursive: true });
await mkdir(publicOutputDir, { recursive: true });

const summary = {
  generatedAt: new Date().toISOString(),
  dataVersion: "pending",
  parserVersion: PARSER_VERSION,
  hadithParserVersion: HADITH_PARSER_VERSION,
  rijalParserVersion: RIJAL_PARSER_VERSION,
  normalizerVersion: NORMALIZER_VERSION,
  confidenceThresholds: { high: 0.9, medium: 0.7 },
  provider: manifest.provider,
  externalDatasets: manifest.externalDatasets,
  collections: {},
  rijal: {},
};
const completeness = {
  generatedAt: summary.generatedAt,
  parserVersion: PARSER_VERSION,
  normalizerVersion: NORMALIZER_VERSION,
  acceptanceRule:
    "Jedes nummerierte Vorkommen ist importiert oder trägt einen konkreten Fehlercode. "
    + "coveragePercent = Vorkommen mit rekonstruierter Kette und Matn ÷ nummerierte Hadithvorkommen "
    + "(ohne Struktur­überschriften). accountedPercent muss 100 sein.",
  collections: {},
  rijal: {},
};
const reviewQueue = {
  generatedAt: summary.generatedAt,
  parserVersion: PARSER_VERSION,
  note: "Maschinelle Vorschläge und abgelehnte Kandidaten. Kein Eintrag ist geprüft; keiner wurde verworfen.",
  hadithParserErrors: [],
  rijalRejectedCandidates: [],
  rijalEntriesWithoutDate: { note: "Nur Zählung — die Einträge selbst stehen vollständig in den abgeleiteten Dateien.", counts: {} },
  contaminatedSpans: [],
};
const normalizeFixture = { generatedAt: summary.generatedAt, normalizerVersion: NORMALIZER_VERSION, samples: [] };
const fixtureSeen = new Set();

function collectFixture(raw) {
  if (normalizeFixture.samples.length >= 260) return;
  const trimmed = String(raw ?? "").trim();
  if (trimmed.length < 3 || trimmed.length > 120) return;
  if (fixtureSeen.has(trimmed)) return;
  fixtureSeen.add(trimmed);
  normalizeFixture.samples.push({ raw: trimmed, normalized: normalizeSearchText(trimmed) });
}

for (const source of hadithSources) {
  const records = extractHadiths(await getBook(source), source);
  const file = `${source.key}.json`;
  await writeFile(resolve(outputDir, file), JSON.stringify({ source, records }));

  const byClass = {};
  for (const record of records) byClass[record.recordClass] = (byClass[record.recordClass] ?? 0) + 1;
  const boundaryRules = {};
  for (const record of records) {
    const rule = record.parser.boundaryRule ?? "none";
    boundaryRules[rule] = (boundaryRules[rule] ?? 0) + 1;
  }
  const structural = byClass["structural-heading"] ?? 0;
  const hadithOccurrences = records.length - structural;
  const withChain = (byClass.hadith ?? 0) + (byClass["hadith-reference"] ?? 0);
  const attributed = byClass["attributed-report"] ?? 0;
  const unparsed = byClass.unparsed ?? 0;
  const occurrences = records.reduce((sum, record) => sum + record.narratorSurfaceForms.length, 0);
  const chainCount = records.reduce((sum, record) => sum + record.chains.length, 0);
  let rawEqualsNormalized = 0;
  let contaminated = 0;
  for (const record of records) {
    for (const chain of record.chains) {
      for (const occurrence of chain.narratorOccurrences) {
        if (occurrence.rawSurfaceForm === occurrence.normalizedSurfaceForm) rawEqualsNormalized += 1;
        if (occurrence.spanIntegrity !== "verbatim") {
          contaminated += 1;
          if (reviewQueue.contaminatedSpans.length < 400) {
            reviewQueue.contaminatedSpans.push({
              hadithId: record.id, chainId: occurrence.chainId, position: occurrence.position,
              sourcePageId: record.sourcePageId, spanStart: occurrence.spanStart, spanEnd: occurrence.spanEnd,
              reason: occurrence.spanIntegrity,
            });
          }
        }
      }
      collectFixture(chain.narratorOccurrences[0]?.rawSurfaceForm);
    }
  }

  summary.collections[source.key] = {
    title: source.title,
    records: records.length,
    uniqueNumbers: new Set(records.filter((record) => record.recordClass !== "structural-heading").map((record) => record.hadithNumber)).size,
    narratorOccurrences: occurrences,
    multiRouteRecords: records.filter((record) => record.chains.length > 1).length,
    parsedRecords: withChain,
    unparsedRecords: unparsed,
    recordClasses: byClass,
    boundaryRules,
    reconstructedChains: chainCount,
    rawSurfaceEqualsNormalized: rawEqualsNormalized,
    spansWithMarkup: contaminated,
    localFile: file,
    turathBookId: source.turathBookId,
    directFile: `${manifest.provider.filesUrl}/${source.turathBookId}.json`,
    rawSha256: await rawSha256(source),
  };

  const errors = records
    .filter((record) => record.recordClass === "unparsed")
    .map((record) => ({
      externalRecordId: record.id, collection: record.collection, hadithNumber: record.hadithNumber,
      routeNumber: record.routeNumber, sourcePageId: record.sourcePageId,
      spanStart: record.sourceSpan.spanStart, spanEnd: record.sourceSpan.spanEnd,
      errorCode: record.parser.errorReason, sourceUrl: record.source.url,
    }));
  reviewQueue.hadithParserErrors.push(...errors);

  completeness.collections[source.key] = {
    numberedSegments: records.length,
    structuralHeadings: structural,
    numberedOccurrences: hadithOccurrences,
    importedOccurrences: hadithOccurrences,
    occurrencesWithChainAndMatn: withChain,
    matnByReference: byClass["hadith-reference"] ?? 0,
    attributedReportsWithoutOwnChain: attributed,
    unparsedOccurrences: unparsed,
    reconstructedChains: chainCount,
    narratorOccurrences: occurrences,
    unresolvedNarratorOccurrences: occurrences,
    narratorOccurrencesWithSpan: occurrences,
    parserErrors: errors,
    coveragePercent: hadithOccurrences ? Number(((100 * withChain) / hadithOccurrences).toFixed(1)) : 0,
    accountedPercent: hadithOccurrences
      ? Number(((100 * (withChain + attributed + unparsed)) / hadithOccurrences).toFixed(1))
      : 0,
  };
}

for (const source of rijalSources) {
  const { entries, rejected } = extractRijalEntries(await getBook(source), source);
  const file = `${source.key}.json`;
  await writeFile(resolve(outputDir, file), JSON.stringify({ source, entries, rejected }));

  const withDeathAssertion = entries.filter((entry) => entry.dateAssertions.some((item) => item.kind === "death")).length;
  const withFullDeathYear = entries.filter((entry) => entry.deathYearCandidate !== null).length;
  const headLengths = entries.map((entry) => entry.nameSurfaceNormalized.length).sort((a, b) => a - b);
  for (const entry of entries.slice(0, 4000)) collectFixture(entry.nameSurface);

  summary.rijal[source.key] = {
    title: source.title,
    entries: entries.length,
    reviewQueueEntries: rejected.length,
    deathYearsDetected: withFullDeathYear,
    deathAssertionsDetected: withDeathAssertion,
    birthYearsDetected: entries.filter((entry) => entry.birthYearCandidate !== null).length,
    tabaqaDetected: entries.filter((entry) => entry.tabaqa).length,
    regionsDetected: entries.filter((entry) => entry.region).length,
    kunyaDetected: entries.filter((entry) => entry.kunya).length,
    nisbaDetected: entries.filter((entry) => entry.nisbas.length).length,
    teacherPhrasesDetected: entries.filter((entry) => entry.teacherPhrase).length,
    studentPhrasesDetected: entries.filter((entry) => entry.studentPhrase).length,
    teacherMentions: entries.reduce((sum, entry) => sum + entry.teacherMentions.length, 0),
    studentMentions: entries.reduce((sum, entry) => sum + entry.studentMentions.length, 0),
    nameHeadMedianLength: headLengths.length ? headLengths[Math.floor(headLengths.length / 2)] : 0,
    nameHeadWithin60: headLengths.filter((length) => length <= 60).length,
    nameHeadWithin80: headLengths.filter((length) => length <= 80).length,
    entriesSpanningPages: entries.filter((entry) => entry.spansPages > 1).length,
    localFile: file,
    turathBookId: source.turathBookId,
    directFile: `${manifest.provider.filesUrl}/${source.turathBookId}.json`,
    rawSha256: await rawSha256(source),
  };

  reviewQueue.rijalRejectedCandidates.push(
    ...rejected.map((entry) => ({
      source: source.key, candidateId: entry.id, entryNumber: entry.entryNumber,
      nameSurface: entry.nameSurface.slice(0, 120), sourcePageId: entry.sourcePageId,
      spanStart: entry.entrySpan.spanStart, spanEnd: entry.entrySpan.spanEnd,
      rejectReasons: entry.rejectReasons, sourceUrl: entry.source.url,
    })),
  );
  reviewQueue.rijalEntriesWithoutDate.counts[source.key] = entries.length - withDeathAssertion;

  completeness.rijal[source.key] = {
    numberedSegments: entries.length + rejected.length,
    importedEntries: entries.length,
    reviewQueueEntries: rejected.length,
    entriesWithNameHead: entries.length,
    nameHeadWithin60Percent: entries.length ? Number(((100 * summary.rijal[source.key].nameHeadWithin60) / entries.length).toFixed(1)) : 0,
    deathAssertionPercent: entries.length ? Number(((100 * withDeathAssertion) / entries.length).toFixed(1)) : 0,
    fullySpecifiedDeathYearPercent: entries.length ? Number(((100 * withFullDeathYear) / entries.length).toFixed(1)) : 0,
    tabaqaPercent: entries.length ? Number(((100 * summary.rijal[source.key].tabaqaDetected) / entries.length).toFixed(1)) : 0,
    teacherPhrasePercent: entries.length ? Number(((100 * summary.rijal[source.key].teacherPhrasesDetected) / entries.length).toFixed(1)) : 0,
    studentPhrasePercent: entries.length ? Number(((100 * summary.rijal[source.key].studentPhrasesDetected) / entries.length).toFixed(1)) : 0,
    accountedPercent: 100,
  };
}

// dataVersion ist ein Hash über Parser-, Normalisierer- und Rohquellen-Prüfsummen.
summary.dataVersion = `turath-${hashOf(JSON.stringify({
  parserVersion: PARSER_VERSION,
  hadithParserVersion: HADITH_PARSER_VERSION,
  rijalParserVersion: RIJAL_PARSER_VERSION,
  normalizerVersion: NORMALIZER_VERSION,
  collections: Object.fromEntries(Object.entries(summary.collections).map(([key, value]) => [key, value.rawSha256])),
  rijal: Object.fromEntries(Object.entries(summary.rijal).map(([key, value]) => [key, value.rawSha256])),
}))}`;
completeness.dataVersion = summary.dataVersion;
reviewQueue.dataVersion = summary.dataVersion;
normalizeFixture.dataVersion = summary.dataVersion;
reviewQueue.totals = {
  hadithParserErrors: reviewQueue.hadithParserErrors.length,
  rijalRejectedCandidates: reviewQueue.rijalRejectedCandidates.length,
  contaminatedSpans: reviewQueue.contaminatedSpans.length,
};

await writeFile(resolve(publicOutputDir, "manifest.json"), JSON.stringify(summary, null, 2));
await writeFile(resolve(publicOutputDir, "completeness.json"), JSON.stringify(completeness, null, 2));
await writeFile(resolve(publicOutputDir, "review-queue.json"), JSON.stringify(reviewQueue, null, 2));
await writeFile(resolve(publicOutputDir, "normalize-fixture.json"), JSON.stringify(normalizeFixture, null, 2));
await writeFile(resolve(testFixtureDir, "normalize-fixture.json"), JSON.stringify(normalizeFixture, null, 2));
console.log(JSON.stringify(summary, null, 2));
