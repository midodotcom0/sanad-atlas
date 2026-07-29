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
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const shouldFetch = process.argv.includes("--fetch");

const arabicDigitMap = new Map([..."٠١٢٣٤٥٦٧٨٩"].map((digit, index) => [digit, String(index)]));
const transmissionTerms = ["حدثنا", "حدثني", "اخبرنا", "اخبرني", "سمعت", "عن", "قال", "قالت", "ذكر", "انه سمع"];
const hadithSources = manifest.sources.filter((source) => source.kind === "hadith_collection");
const rijalSources = manifest.sources.filter((source) => source.kind === "rijal");

function toAsciiDigits(value) {
  return value.replace(/[٠-٩]/g, (digit) => arabicDigitMap.get(digit));
}

function stripMarkup(value) {
  return value
    .replace(/<span[^>]*>(.*?)<\/span>/gis, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/⦗[^⦘]+⦘/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeArabic(value) {
  return stripMarkup(value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function sourceUrl(bookId, pageIndex) {
  return `https://app.turath.io/book/${bookId}?page=${pageIndex}`;
}

function titleFromPage(text) {
  const matches = [...text.matchAll(/<span[^>]*data-type=["']title["'][^>]*>(.*?)<\/span>/gis)];
  return matches.length ? stripMarkup(matches.at(-1)[1]) : null;
}

function splitFootnotes(text) {
  return text.split(/\n_{5,}\n/)[0].trim();
}

function extractNarratorSurfaces(isnad) {
  const termPattern = new RegExp(`(?:^|[،؛:.\\s])(?:${transmissionTerms.join("|")})\\s+`, "gu");
  const pieces = isnad.split(termPattern).slice(1);
  const surfaces = [];
  for (const piece of pieces) {
    const surface = piece
      .split(/[،؛:.\n()]/)[0]
      .replace(/^(?:ان|انه|وهو|يعني)\s+/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (surface.length < 2 || surface.length > 92) continue;
    if (/^(?:هذا|ذلك|كذا|ما|لا|كان|كنت|فقال|رسول الله)/.test(surface)) continue;
    if (!surfaces.includes(surface)) surfaces.push(surface);
    if (surfaces.length >= 20) break;
  }
  if (isnad.includes("رسول الله")) surfaces.push("رسول الله ﷺ");
  return surfaces;
}

function splitIsnadMatn(primaryText) {
  const normalized = normalizeArabic(primaryText);
  const prophetIndex = normalized.search(/(?:رسول الله|النبي صلى الله عليه وسلم|النبي ﷺ)/);
  if (prophetIndex === -1) {
    return { isnad: normalized.slice(0, 900), matn: normalized.slice(0, 1800), confidence: 0.42 };
  }
  const afterProphet = normalized.slice(prophetIndex);
  const speechOffset = afterProphet.search(/(?:قال|يقول|انه قال|فقال)/);
  const boundary = speechOffset === -1 ? Math.min(normalized.length, prophetIndex + 80) : prophetIndex + speechOffset + (afterProphet.match(/(?:قال|يقول|انه قال|فقال)/)?.[0].length ?? 0);
  return {
    isnad: normalized.slice(0, boundary).trim(),
    matn: normalized.slice(boundary).replace(/^[ :،؛.-]+/, "").trim(),
    confidence: speechOffset === -1 ? 0.58 : 0.73,
  };
}

function recordMatches(text, key) {
  const pattern = key === "muslim"
    ? /(?:^|\n)([٠-٩0-9]{1,5})\s*-\s*\(([٠-٩0-9]{1,5})\)\s*/g
    : /(?:^|\n)([٠-٩0-9]{1,5})\s*-\s*/g;
  return [...text.matchAll(pattern)];
}

function extractHadiths(bookJson, source) {
  const records = [];
  let currentBook = null;
  let currentChapter = null;
  for (const [pageIndex, page] of bookJson.pages.entries()) {
    // The Bukhari file contains an editor's preface with numbered examples that
    // look like hadith records. The actual work starts with volume 1.
    if (source.key === "bukhari" && page.vol === "المقدمة") continue;
    const heading = titleFromPage(page.text);
    if (heading) {
      if (/^\d+\s*-\s*(?!باب)/.test(toAsciiDigits(normalizeArabic(heading)))) currentBook = heading;
      if (/باب/.test(normalizeArabic(heading))) currentChapter = heading;
    }
    const matches = recordMatches(page.text, source.key);
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const next = matches[index + 1];
      const rawSegment = page.text.slice(match.index + (match[0].startsWith("\n") ? 1 : 0), next?.index ?? page.text.length);
      const primary = splitFootnotes(stripMarkup(rawSegment));
      const displayNumber = Number(toAsciiDigits(source.key === "muslim" ? match[2] : match[1]));
      const routeNumber = Number(toAsciiDigits(match[1]));
      if (!Number.isFinite(displayNumber) || displayNumber < 1 || displayNumber > 10000) continue;
      // Muhammad Fu'ad Abd al-Baqi's principal Muslim numbering ends at 3033.
      // Higher parenthesised values in the digital file are references, not
      // principal hadith identifiers.
      if (source.key === "muslim" && displayNumber > 3033) continue;
      const { isnad, matn, confidence } = splitIsnadMatn(primary);
      const narratorSurfaceForms = extractNarratorSurfaces(isnad);
      const hasTransmissionTerm = transmissionTerms.some((term) => normalizeArabic(primary.slice(0, 900)).includes(term));
      // Keep every numbered source record. Unsupported records stay explicitly
      // unparsed instead of disappearing from the corpus silently.
      const parseConfidence = hasTransmissionTerm && matn.length >= 8 ? confidence : 0.25;
      const recordId = `${source.key}-${displayNumber}-${routeNumber}-${pageIndex}`;
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
        isnad,
        matn,
        narratorSurfaceForms,
        chainLength: narratorSurfaceForms.length,
        routeMarkers: (normalizeArabic(primary).match(/(?: ح |وحدثنا|وحدثني)/g) ?? []).length + 1,
        matnFingerprint: hash(normalizeArabic(matn).replace(/[^\p{L}\p{N}]/gu, "")),
        parser: {
          version: "turath-rule-parser-0.3.0",
          confidence: parseConfidence,
          reviewStatus: "unreviewed",
          state: parseConfidence <= 0.25 ? "numbered-record-unparsed" : "heuristically-parsed",
        },
        source: { provider: "turath", bookId: source.turathBookId, url: sourceUrl(source.turathBookId, pageIndex + 1), rightsStatus: source.rightsStatus },
      });
    }
  }
  return records;
}

function extractRijalEntries(bookJson, source) {
  const entries = [];
  for (const [pageIndex, page] of bookJson.pages.entries()) {
    const contentStart = source.key === "taqrib" ? 2 : 181;
    if (pageIndex < contentStart) continue;
    const text = stripMarkup(page.text);
    const matches = [...text.matchAll(/(?:^|\n)([٠-٩0-9]{1,5})\s*-\s*/g)];
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const next = matches[index + 1];
      const raw = text.slice(match.index + (match[0].startsWith("\n") ? 1 : 0), next?.index ?? text.length).trim();
      const entryNumber = Number(toAsciiDigits(match[1]));
      if (!Number.isFinite(entryNumber) || raw.length < 12 || raw.length > 3000) continue;
      const normalized = normalizeArabic(raw);
      const nameSurface = normalized.replace(/^\d+\s*-\s*/, "").split(/\s+(?:عن|روى عن|سمع|له صحبه|صحابي|ثقه|صدوق|ضعيف|مات|توفي)\s/)[0].slice(0, 180);
      const deathMatch = normalized.match(/(?:مات|توفي|وفاته)\s+(?:سنه\s+)?([0-9٠-٩]{2,4})/);
      const teachersMatch = normalized.match(/(?:عن|روى عن)\s+(.{2,260}?)(?=\s+(?:وعنه|روى عنه|ثقه|صدوق|مات|توفي|$))/);
      const studentsMatch = normalized.match(/(?:وعنه|روى عنه)\s+(.{2,260}?)(?=\s+(?:ثقه|صدوق|ضعيف|مات|توفي|$))/);
      // A biographical entry must contain at least a plausible Arabic personal
      // name. This rejects running headers, section counters and page notes.
      const plausibleName = /(?:ابن|بن|ابو|ابي|ام|بنت)/.test(nameSurface) && nameSurface.length >= 8;
      if (!plausibleName) continue;
      entries.push({
        id: `${source.key}-${entryNumber}-${pageIndex}`,
        entryNumber,
        nameSurface,
        text: normalized,
        deathYearCandidate: deathMatch ? Number(toAsciiDigits(deathMatch[1])) : null,
        teacherPhrase: teachersMatch?.[1] ?? null,
        studentPhrase: studentsMatch?.[1] ?? null,
        volume: page.vol,
        printedPage: page.page,
        sourcePageId: pageIndex + 1,
        parser: { version: "turath-rijal-parser-0.1.0", confidence: 0.55, reviewStatus: "unreviewed" },
        source: { provider: "turath", bookId: source.turathBookId, url: sourceUrl(source.turathBookId, pageIndex + 1), rightsStatus: source.rightsStatus },
      });
    }
  }
  return entries;
}

async function getBook(source) {
  const path = resolve(cacheDir, `${source.turathBookId}.json`);
  if (!existsSync(path)) {
    if (!shouldFetch) throw new Error(`Missing ${path}. Re-run with --fetch.`);
    const url = `${manifest.provider.filesUrl}/${source.turathBookId}.json`;
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "SanadAtlasResearch/0.2" } });
    if (!response.ok) throw new Error(`Turath ${source.turathBookId}: HTTP ${response.status}`);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
  }
  return JSON.parse(await readFile(path, "utf8"));
}

await mkdir(outputDir, { recursive: true });
await mkdir(publicOutputDir, { recursive: true });
const summary = { generatedAt: new Date().toISOString(), parserVersion: "0.3.0", provider: manifest.provider, collections: {}, rijal: {} };

for (const source of hadithSources) {
  const records = extractHadiths(await getBook(source), source);
  const file = `${source.key}.json`;
  await writeFile(resolve(outputDir, file), JSON.stringify({ source, records }));
  summary.collections[source.key] = {
    title: source.title,
    records: records.length,
    uniqueNumbers: new Set(records.map((record) => record.hadithNumber)).size,
    narratorOccurrences: records.reduce((sum, record) => sum + record.narratorSurfaceForms.length, 0),
    multiRouteRecords: records.filter((record) => record.routeMarkers > 1).length,
    parsedRecords: records.filter((record) => record.parser.state === "heuristically-parsed").length,
    unparsedRecords: records.filter((record) => record.parser.state === "numbered-record-unparsed").length,
    localFile: file,
    turathBookId: source.turathBookId,
    directFile: `${manifest.provider.filesUrl}/${source.turathBookId}.json`,
  };
}

for (const source of rijalSources) {
  const entries = extractRijalEntries(await getBook(source), source);
  const file = `${source.key}.json`;
  await writeFile(resolve(outputDir, file), JSON.stringify({ source, entries }));
  summary.rijal[source.key] = {
    title: source.title,
    entries: entries.length,
    deathYearsDetected: entries.filter((entry) => entry.deathYearCandidate).length,
    teacherPhrasesDetected: entries.filter((entry) => entry.teacherPhrase).length,
    studentPhrasesDetected: entries.filter((entry) => entry.studentPhrase).length,
    localFile: file,
    turathBookId: source.turathBookId,
    directFile: `${manifest.provider.filesUrl}/${source.turathBookId}.json`,
  };
}

await writeFile(resolve(publicOutputDir, "manifest.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
