#!/usr/bin/env node
/**
 * Imports the official Shamela v4 narrator registry (database/service/S1.db)
 * into an already-built Atlas SQLite database.
 *
 * The importer never creates canonical narrator identities. Every S1 record is
 * a source entry; matching it to a name occurrence in an isnad remains a
 * reviewable identity proposal.
 *
 * Usage:
 *   node scripts/import-shamela-rijal.mjs --source /path/to/S1.db
 *   node scripts/import-shamela-rijal.mjs --source /path/to/S1.db --db worker/atlas.db
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeSearchText } from "./atlas-normalize.mjs";
import {
  containsUndecodedShamelaBytes,
  decodeShamelaNarratorMetadata,
  decodeShamelaNarratorText,
  SHAMELA_NARRATOR_DECODER_VERSION,
} from "./shamela-rijal-decoder.mjs";

export const SHAMELA_RIJAL_IMPORTER_VERSION = "shamela-rijal-importer-1.0.0";
export const DEFAULT_SHAMELA_SOURCE_VERSION = "shamela-1447.11";
const SOURCE_WORK_ID = "source:shamela";
const SOURCE_KEY = "shamela";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseArgs(argv) {
  const args = { db: resolve("worker/atlas.db"), source: "", sourceVersion: DEFAULT_SHAMELA_SOURCE_VERSION, quiet: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--source") args.source = resolve(argv[index + 1] ?? "");
    if (argv[index] === "--db") args.db = resolve(argv[index + 1] ?? "");
    if (argv[index] === "--source-version") args.sourceVersion = argv[index + 1] ?? args.sourceVersion;
    if (argv[index] === "--quiet") args.quiet = true;
  }
  return args;
}

function metadataFields(text) {
  const fields = new Map();
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!value) continue;
    fields.set(key, [...(fields.get(key) ?? []), value]);
  }
  return fields;
}

function firstField(fields, ...keys) {
  for (const key of keys) {
    const value = fields.get(key)?.[0];
    if (value) return value;
  }
  return null;
}

function splitPlaces(value) {
  return [...new Set(String(value ?? "").split(/[،,:]/).map((part) => part.trim()).filter(Boolean))];
}

function firstHijriYear(value) {
  const match = String(value ?? "").match(/(?:^|\D)(\d{1,4})(?=\D|$)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function sectionKind(heading) {
  const normalized = normalizeSearchText(heading);
  if (/اثبات سماع|السماع/.test(normalized)) return "hearing_evidence";
  if (/الارسال|الانقطاع|لم يسمع|لم يدرك/.test(normalized)) return "disconnection";
  if (/المفاضله|مقارنه/.test(normalized)) return "comparison";
  if (/التدليس|الاختلاط|البدعه|الصحبه|الادراك/.test(normalized)) return "other";
  return "critic";
}

function citationFromLine(line) {
  const match = line.match(/^(.+?)\s*\(([^/()]+)\/\s*([^()]+)\)$/);
  if (!match) return null;
  return { work: match[1].trim(), volume: match[2].trim(), page: match[3].trim() };
}

/**
 * S1 biographies are grouped by critic/category. Each sourced statement ends
 * with `work (volume/page)` and the global Shamela page id on the next line.
 */
export function parseShamelaCriticisms(biography) {
  const sections = String(biography ?? "")
    .replace(/\r/g, "")
    .split(/\n\s*\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const results = [];
  let sequence = 0;

  for (const section of sections) {
    const lines = section.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length < 3) continue;
    const heading = lines.shift().replace(/^:\s*/, "").trim();
    const kind = sectionKind(heading);
    let phraseLines = [];

    for (let index = 0; index < lines.length; index += 1) {
      const citation = citationFromLine(lines[index]);
      if (!citation) {
        phraseLines.push(lines[index]);
        continue;
      }
      const possiblePageId = lines[index + 1];
      const sourcePageId = /^\d+$/.test(possiblePageId ?? "") ? Number.parseInt(possiblePageId, 10) : null;
      const phrase = phraseLines.join(" ").replace(/\s+/g, " ").trim();
      phraseLines = [];
      if (sourcePageId !== null) index += 1;
      if (!phrase) continue;
      results.push({
        criticName: heading,
        sectionKind: kind,
        phrase,
        citedWork: citation.work,
        citedVolume: citation.volume,
        citedPage: citation.page,
        sourcePageId,
        sequenceNo: sequence,
      });
      sequence += 1;
    }
  }
  return results;
}

function relationshipEvidence(criticisms, direction) {
  const pattern = direction === "teacher"
    ? /(?:روى\s+عن|سمع\s+من|لقي|أدرك)/
    : /(?:روى\s+عنه|حدث\s+عنه|سمع\s+منه)/;
  return criticisms.filter((item) => pattern.test(item.phrase)).map((item) => item.phrase);
}

function ensureSupplementalSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rijal_source_profile (
      rijal_entry_id TEXT PRIMARY KEY REFERENCES rijal_entry(id) ON DELETE CASCADE,
      long_name TEXT,
      metadata_text TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      ibn_hajar_grade TEXT,
      al_dhahabi_grade TEXT,
      residence_places TEXT NOT NULL DEFAULT '[]',
      travel_places TEXT NOT NULL DEFAULT '[]',
      relation_notes TEXT,
      creed_note TEXT,
      source_url TEXT NOT NULL,
      data_version TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'
    );
    CREATE TABLE IF NOT EXISTS rijal_criticism (
      id TEXT PRIMARY KEY,
      rijal_entry_id TEXT NOT NULL REFERENCES rijal_entry(id) ON DELETE CASCADE,
      scholar_id TEXT REFERENCES scholar(id),
      critic_name_raw TEXT NOT NULL,
      critic_name_normalized TEXT NOT NULL,
      section_kind TEXT NOT NULL DEFAULT 'critic' CHECK (section_kind IN ('critic','hearing_evidence','disconnection','comparison','other')),
      original_phrase TEXT NOT NULL,
      cited_work TEXT NOT NULL,
      cited_volume TEXT,
      cited_page TEXT,
      source_page_id INTEGER,
      sequence_no INTEGER NOT NULL CHECK (sequence_no >= 0),
      extraction_method TEXT NOT NULL DEFAULT 'parser',
      parser_version TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'machine',
      confidence_level TEXT NOT NULL DEFAULT 'high',
      review_status TEXT NOT NULL DEFAULT 'machine_unreviewed',
      data_version TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
      UNIQUE (rijal_entry_id, sequence_no)
    );
    CREATE INDEX IF NOT EXISTS rijal_criticism_entry_idx ON rijal_criticism (rijal_entry_id, sequence_no);
    CREATE INDEX IF NOT EXISTS rijal_criticism_critic_idx ON rijal_criticism (critic_name_normalized);
  `);
}

function removePreviousImport(db) {
  db.exec(`
    DELETE FROM rijal_search_doc WHERE rijal_entry_id LIKE 'shamela-%';
    DELETE FROM rijal_criticism WHERE rijal_entry_id LIKE 'shamela-%';
    DELETE FROM rijal_source_profile WHERE rijal_entry_id LIKE 'shamela-%';
    DELETE FROM rijal_entry WHERE source_work_id = '${SOURCE_WORK_ID}';
    DELETE FROM source_passage WHERE source_work_id = '${SOURCE_WORK_ID}';
    DELETE FROM import_batch WHERE source_work_id = '${SOURCE_WORK_ID}';
  `);
}

export function importShamelaRijal({ atlasDbPath, sourceDbPath, sourceVersion = DEFAULT_SHAMELA_SOURCE_VERSION }) {
  const rawSha256 = sha256(readFileSync(sourceDbPath));
  const sourceDb = new DatabaseSync(sourceDbPath, { readOnly: true });
  const atlasDb = new DatabaseSync(atlasDbPath);
  atlasDb.exec("PRAGMA foreign_keys = ON;");
  ensureSupplementalSchema(atlasDb);

  const activeRelease = atlasDb.prepare("SELECT release_id, data_version, index_version FROM atlas_release WHERE is_active = 1").get();
  const baseDataVersion = String(activeRelease?.data_version ?? "atlas").replace(/\+shamela-[^+]+-[a-f0-9]{12}$/i, "");
  const dataVersion = `${baseDataVersion}+${sourceVersion}-${rawSha256.slice(0, 12)}`;
  const importBatchId = `import:shamela:${rawSha256.slice(0, 16)}`;
  const rows = sourceDb.prepare("SELECT i, s, l, d, a, b FROM b ORDER BY i").all();

  const existingBatch = atlasDb.prepare("SELECT record_count FROM import_batch WHERE id = ?").get(importBatchId);
  const existingNarrators = Number(atlasDb.prepare("SELECT COUNT(*) AS value FROM rijal_entry WHERE source_work_id = ?").get(SOURCE_WORK_ID)?.value ?? 0);
  if (existingBatch && existingNarrators === Number(existingBatch.record_count)) {
    const existingCriticisms = Number(atlasDb.prepare("SELECT COUNT(*) AS value FROM rijal_criticism WHERE rijal_entry_id LIKE 'shamela-%'").get()?.value ?? 0);
    if (activeRelease?.release_id && activeRelease?.index_version && activeRelease.data_version !== dataVersion) {
      atlasDb.prepare("UPDATE atlas_release SET release_id = ?, data_version = ?, note = ? WHERE release_id = ?")
        .run(`${dataVersion}+${activeRelease.index_version}`, dataVersion, "official Shamela S1 narrator registry imported locally", activeRelease.release_id);
    }
    sourceDb.close();
    atlasDb.close();
    return { narratorCount: existingNarrators, criticismCount: existingCriticisms, undecodedCount: null, dataVersion, rawSha256, reused: true };
  }

  const insertSource = atlasDb.prepare(`
    INSERT INTO source_work (id, slug, title_ar, author_ar, genre, provider, provider_work_id, canonical_url, rights_status, public_field_policy, retrieved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title_ar=excluded.title_ar, provider=excluded.provider,
      canonical_url=excluded.canonical_url, rights_status=excluded.rights_status,
      public_field_policy=excluded.public_field_policy, retrieved_at=excluded.retrieved_at
  `);
  const insertBatch = atlasDb.prepare(`
    INSERT INTO import_batch (id, source_work_id, source_version, importer_version, raw_object_key, raw_sha256, completed_at, record_count, rejected_count, report)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPassage = atlasDb.prepare(`
    INSERT INTO source_passage (id, source_work_id, import_batch_id, source_locator, original_text, original_text_sha256, stable_reference, publication_allowed)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `);
  const insertEntry = atlasDb.prepare(`
    INSERT INTO rijal_entry (
      id, source_work_id, source_passage_id, import_batch_id, external_entry_id,
      entry_number, entry_number_int, name_head_raw, name_head_normalized,
      full_nasab, kunya, nisba, laqab, tabaqa, birth_year_ah,
      birth_precision, birth_original_phrase, death_year_ah, death_precision,
      death_original_phrase, primary_region, regions, teacher_phrase,
      student_phrase, teacher_names, student_names, grade_phrase, entry_text,
      entry_text_sha256, resolved_narrator_id, identity_status,
      extraction_method, parser_version, parse_confidence, origin,
      review_status, data_version, publication_allowed, source_page_id,
      source_url, parser_json
    ) VALUES (
      ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?
    )
  `);
  const insertProfile = atlasDb.prepare(`
    INSERT INTO rijal_source_profile (
      rijal_entry_id, long_name, metadata_text, metadata_json, ibn_hajar_grade,
      al_dhahabi_grade, residence_places, travel_places, relation_notes,
      creed_note, source_url, data_version
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const insertCriticism = atlasDb.prepare(`
    INSERT INTO rijal_criticism (
      id, rijal_entry_id, scholar_id, critic_name_raw, critic_name_normalized,
      section_kind, original_phrase, cited_work, cited_volume, cited_page,
      source_page_id, sequence_no, extraction_method, parser_version, origin,
      confidence_level, review_status, data_version
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const insertSearchDoc = atlasDb.prepare(`
    INSERT INTO rijal_search_doc (id, rijal_entry_id, raw_text, normalized_text, name_normalized)
    VALUES (?, ?, ?, ?, ?)
  `);

  let criticismCount = 0;
  let undecodedCount = 0;
  let nextSearchId = Number(atlasDb.prepare("SELECT COALESCE(MAX(id), 0) AS value FROM rijal_search_doc").get()?.value ?? 0) + 1;

  atlasDb.exec("BEGIN;");
  try {
    insertSource.run(
      SOURCE_WORK_ID,
      SOURCE_KEY,
      "دليل رواة المكتبة الشاملة",
      null,
      "rijal_registry",
      "shamela",
      "S1.db",
      "https://shamela.ws/narrator/3",
      "public-access-license-unspecified",
      JSON.stringify({ publicDerivedFields: ["entry_number", "name_surface", "date_assertions", "teacher_student_phrases", "source_pointer", "biographical_fields", "critic_ranks", "criticism_references"] }),
      "2026-07-30",
    );
    removePreviousImport(atlasDb);
    insertBatch.run(importBatchId, SOURCE_WORK_ID, sourceVersion, SHAMELA_RIJAL_IMPORTER_VERSION, sourceDbPath, rawSha256, "2026-07-30T00:00:00.000Z", rows.length, 0, JSON.stringify({ source: "official Shamela v4 S1.db" }));

    for (const row of rows) {
      const shortName = decodeShamelaNarratorText(row.s);
      const longName = decodeShamelaNarratorText(row.l);
      const biography = decodeShamelaNarratorText(row.a);
      const metadata = decodeShamelaNarratorMetadata(row.b);
      const fields = metadataFields(metadata);
      const criticisms = parseShamelaCriticisms(biography);
      const teacherEvidence = relationshipEvidence(criticisms, "teacher");
      const studentEvidence = relationshipEvidence(criticisms, "student");
      const entryId = `shamela-${row.i}`;
      const passageId = `passage:shamela:${row.i}`;
      const sourceUrl = `https://shamela.ws/narrator/${row.i}`;
      const originalText = `${metadata}\n\n${biography}`.trim();
      const residencePlaces = splitPlaces(firstField(fields, "بلد الإقامة"));
      const travelPlaces = splitPlaces(firstField(fields, "بلد الرحلة"));
      const deathPhrase = firstField(fields, "تاريخ الوفاة");
      const birthPhrase = firstField(fields, "تاريخ الميلاد");
      const ibnHajarGrade = firstField(fields, "الرتبة عند ابن حجر");
      const alDhahabiGrade = firstField(fields, "الرتبة عند الذهبي");
      const parser = {
        confidence: containsUndecodedShamelaBytes(`${shortName}${longName}${metadata}${biography}`) ? 0.95 : 0.995,
        reviewStatus: "machine_unreviewed",
        sourceFormat: "Shamela v4 S1.db",
        decoderVersion: SHAMELA_NARRATOR_DECODER_VERSION,
        criticismCount: criticisms.length,
        teacherEvidenceCount: teacherEvidence.length,
        studentEvidenceCount: studentEvidence.length,
      };
      if (parser.confidence < 0.99) undecodedCount += 1;

      insertPassage.run(passageId, SOURCE_WORK_ID, importBatchId, `narrator/${row.i}`, originalText, sha256(originalText), sourceUrl);
      insertEntry.run(
        entryId, SOURCE_WORK_ID, passageId, importBatchId, String(row.i),
        String(row.i), row.i, shortName, normalizeSearchText(shortName),
        longName || null, firstField(fields, "الكنية"), firstField(fields, "النسب"), firstField(fields, "اللقب"), firstField(fields, "طبقة رواة التقريب"), firstHijriYear(birthPhrase),
        birthPhrase ? "exact" : "unknown", birthPhrase, row.d ?? firstHijriYear(deathPhrase), deathPhrase?.includes("أو") || deathPhrase?.includes("وقيل") ? "range" : row.d ? "exact" : "unknown",
        deathPhrase, residencePlaces[0] ?? null, JSON.stringify([...new Set([...residencePlaces, ...travelPlaces])]), teacherEvidence[0] ?? null,
        studentEvidence[0] ?? null, "[]", "[]", [ibnHajarGrade ? `ابن حجر: ${ibnHajarGrade}` : "", alDhahabiGrade ? `الذهبي: ${alDhahabiGrade}` : ""].filter(Boolean).join(" · ") || null, originalText,
        sha256(originalText), null, "unresolved", "parser", SHAMELA_RIJAL_IMPORTER_VERSION, parser.confidence, "machine",
        "machine_unreviewed", dataVersion, 0, row.i, sourceUrl, JSON.stringify(parser),
      );
      insertProfile.run(
        entryId, longName || null, metadata, JSON.stringify(Object.fromEntries(fields)), ibnHajarGrade,
        alDhahabiGrade, JSON.stringify(residencePlaces), JSON.stringify(travelPlaces), firstField(fields, "علاقات الراوي"),
        firstField(fields, "المذهب العقدي"), sourceUrl, dataVersion,
      );

      for (const criticism of criticisms) {
        insertCriticism.run(
          `shamela-criticism-${row.i}-${criticism.sequenceNo}`, entryId, null,
          criticism.criticName, normalizeSearchText(criticism.criticName), criticism.sectionKind,
          criticism.phrase, criticism.citedWork, criticism.citedVolume, criticism.citedPage,
          criticism.sourcePageId, criticism.sequenceNo, "parser", SHAMELA_RIJAL_IMPORTER_VERSION,
          "machine", "high", "machine_unreviewed", dataVersion,
        );
        criticismCount += 1;
      }

      const rawSearchText = `${shortName} ${longName} ${metadata} ${biography}`.trim();
      const normalizedSearchText = normalizeSearchText(rawSearchText);
      insertSearchDoc.run(nextSearchId, entryId, rawSearchText, normalizedSearchText, normalizeSearchText(shortName));
      nextSearchId += 1;
    }
    // External-content FTS is rebuilt once. Row-by-row deletes make a repeat
    // import quadratic and can keep the local API waiting for minutes.
    atlasDb.exec("INSERT INTO rijal_fts(rijal_fts) VALUES ('rebuild');");
    if (activeRelease?.release_id && activeRelease?.index_version) {
      atlasDb.prepare("UPDATE atlas_release SET release_id = ?, data_version = ?, note = ? WHERE release_id = ?")
        .run(`${dataVersion}+${activeRelease.index_version}`, dataVersion, "official Shamela S1 narrator registry imported locally", activeRelease.release_id);
    }
    atlasDb.exec("COMMIT;");
  } catch (error) {
    atlasDb.exec("ROLLBACK;");
    throw error;
  } finally {
    sourceDb.close();
    atlasDb.close();
  }

  return { narratorCount: rows.length, criticismCount, undecodedCount, dataVersion, rawSha256 };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source || !existsSync(args.source)) throw new Error("--source must point to the official Shamela S1.db file");
  if (!existsSync(args.db)) throw new Error(`Atlas database not found: ${args.db}`);
  const result = importShamelaRijal({ atlasDbPath: args.db, sourceDbPath: args.source, sourceVersion: args.sourceVersion });
  if (!args.quiet) console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
