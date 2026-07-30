/**
 * Ladepipeline JSON -> atlas.db (P3.1). Reine Orchestrierungslogik, getrennt
 * von der CLI (`scripts/build-atlas-db.mjs`), damit sie unter `node --test`
 * ohne Seiteneffekte pruefbar bleibt.
 *
 * Eingaben (nur gelesen, nie geschrieben):
 *   - database/schema.sql                    (Agent 2, uebersetzt per atlas-schema-translate.mjs)
 *   - .cache/turath-derived/*.json            (Agent 1: bukhari, muslim, tahdhib, mizan, taqrib, kashif)
 *   - public/data/corpus/manifest.json        (Agent 1: Versionen, Statistiken)
 *   - data/sources/turath-manifest.json       (Agent 1: Quellenregistrierung, Lizenz-Allowlist)
 *
 * Ausgabe: eine SQLite-Datei mit drei Schichten:
 *   1. das uebersetzte Postgres-Schema (37 Tabellen, 4 Sichten, unveraendert
 *      aus database/schema.sql abgeleitet);
 *   2. zwei FTS5-Volltextindizes im external-content-Modus (hadith, rijal),
 *      je mit einer Rohspalte und einer diakritikafreien Spalte;
 *   3. eine materialisierte `edge_projection` (Isnad-Nachbarschaftskanten)
 *      plus zwei kleine, klar gekennzeichnete atlas.db-eigene Erweiterungen
 *      (`narrator_occurrence.node_id`, `hadith_record.matn_fingerprint|
 *      collection`) fuer effiziente Worker-Abfragen. Diese Erweiterungen
 *      aendern database/schema.sql NICHT; sie werden per ALTER TABLE nach
 *      dem Laden der uebersetzten DDL ergaenzt und sind unten unter
 *      "ATLAS.DB-EIGENE ERWEITERUNGEN" klar markiert.
 *
 * Determinismus (Abnahme P3.1: zwei Laeufe -> bitgleiche Pruefsumme):
 *   - jede eingefuegte Zeile bekommt eine ID, die deterministisch aus
 *     Korpusinhalt abgeleitet ist (Korpus-eigene IDs wo vorhanden, sonst
 *     sha1-Praefixe ueber stabile Bestandteile) -- niemals eine Zufalls-UUID;
 *   - jede Zeitangabe ist ein fester, aus dem Korpus-Manifest gelesener Wert
 *     (`manifest.generatedAt`), niemals `Date.now()`;
 *   - jede Iteration folgt der Reihenfolge der JSON-Arrays, wie sie auf der
 *     Platte stehen -- keine Objektschluessel-Iteration, kein Set/Map, deren
 *     Reihenfolge vom Laufzeit-internen Hashing abhaengen koennte.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { translateSchemaToSqlite } from "./atlas-schema-translate.mjs";
import { normalizeSearchText } from "./atlas-normalize.mjs";
import { bucketId, isRelativeReference } from "./atlas-id-scheme.mjs";

const RIJAL_SOURCES = ["tahdhib", "mizan", "taqrib", "kashif"];
const HADITH_COLLECTIONS = ["bukhari", "muslim"];

// Vokabular, wortgleich zu database/schema.sql (P2.3). Nur zur defensiven
// Validierung beim Laden -- keine Neudefinition, nur ein Abgleich.
const CONFIDENCE_LEVELS = new Set(["verified", "high", "medium", "low", "unresolved", "conflict"]);
const TEXT_RIGHTS_CLEARED_STATUSES = new Set(["cleared", "public-domain", "editorially-cleared"]);

function sha256Hex(text) {
  return createHash("sha256").update(text ?? "", "utf8").digest("hex");
}

function sha1Hex12(text) {
  return createHash("sha1").update(text, "utf8").digest("hex").slice(0, 12);
}

function asJsonText(value) {
  return JSON.stringify(value ?? null);
}

/**
 * @param {object} paths
 * @param {string} paths.schemaPath
 * @param {string} paths.derivedDir     .cache/turath-derived
 * @param {string} paths.corpusDir      public/data/corpus
 * @param {string} paths.manifestPath   data/sources/turath-manifest.json
 * @param {any} DatabaseSync            node:sqlite DatabaseSync-Konstruktor (dependency injection fuer Testbarkeit)
 * @param {string} dbPath               Zielpfad der SQLite-Datei ("" oder fehlend -> :memory:, fuer Tests)
 * @returns {{ db: any, stats: Record<string, number> }}
 */
export function buildAtlasDatabase(paths, DatabaseSync, dbPath) {
  const schemaText = readFileSync(paths.schemaPath, "utf8");
  const { sql: translatedSchema } = translateSchemaToSqlite(schemaText);

  const manifest = JSON.parse(readFileSync(`${paths.corpusDir}/manifest.json`, "utf8"));
  const registry = JSON.parse(readFileSync(paths.manifestPath, "utf8"));
  const dataVersion = manifest.dataVersion;
  const generatedAt = manifest.generatedAt; // fester, aus dem Korpus gelesener Zeitstempel -- nie Date.now().

  const db = new DatabaseSync(dbPath || ":memory:");
  // journal_mode=OFF statt DELETE: der Sandbox-Mount ist ein FUSE-Dateisystem,
  // auf dem das ueblichen Rollback-Journal-Lebenszyklus (anlegen, schreiben,
  // am Ende loeschen) einen "disk I/O error" ausloest -- vermutlich weil
  // unlink()/fsync()-Semantik dort eingeschraenkt ist (empirisch geprueft:
  // einfache rm-Aufrufe auf frisch erzeugten Dateien scheitern ebenfalls mit
  // "Operation not permitted"). Unkritisch hier: ein Baulauf ist jederzeit
  // aus denselben Eingaben wiederholbar, Crash-Sicherheit waehrend des Baus
  // ist nicht erforderlich.
  db.exec("PRAGMA journal_mode = OFF;");
  db.exec("PRAGMA synchronous = OFF;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(translatedSchema);
  applyAtlasExtensions(db);
  createFtsTables(db);

  const stats = {};
  const timing = {};
  const phase = (label, fn) => {
    const t0 = Date.now();
    const result = fn();
    timing[label] = Date.now() - t0;
    if (process.env.ATLAS_BUILD_VERBOSE) console.error(`  [phase] ${label}: ${timing[label]} ms`);
    return result;
  };

  db.exec("BEGIN;");
  try {
    db.prepare("INSERT INTO atlas_build_info (id, data_version, built_at) VALUES (1, ?, ?)").run(dataVersion, generatedAt);
    const sourceWorkIds = phase("sourceWorks", () => loadSourceWorks(db, registry, manifest));
    const importBatchIds = phase("importBatches", () => loadImportBatches(db, manifest, sourceWorkIds, dataVersion, generatedAt));
    stats.sourceWorks = sourceWorkIds.size;
    stats.importBatches = importBatchIds.size;

    const hadithStats = phase("hadithCorpus", () => loadHadithCorpus(db, paths.derivedDir, sourceWorkIds, importBatchIds, dataVersion));
    Object.assign(stats, hadithStats);

    const rijalStats = phase("rijalCorpus", () => loadRijalCorpus(db, paths.derivedDir, sourceWorkIds, importBatchIds, dataVersion));
    Object.assign(stats, rijalStats);

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  // FTS5-Indizes und edge_projection werden NACH dem Commit befuellt: beide lesen
  // die soeben eingefuegten Basisdaten per SELECT zurueck.
  db.exec("BEGIN;");
  try {
    stats.edgeProjectionRows = phase("edgeProjection", () => buildEdgeProjection(db, dataVersion));
    phase("edgeProjectionIndexes", () => createEdgeProjectionIndexes(db));
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  phase("ftsRebuild", () => rebuildFtsIndexes(db));
  phase("integrityCheck", () => verifyIntegrity(db));
  stats._timingMs = timing;

  return { db, stats, dataVersion };
}

// ---------------------------------------------------------------------------
// ATLAS.DB-EIGENE ERWEITERUNGEN (nicht Teil von database/schema.sql)
// ---------------------------------------------------------------------------
//
// Zwei kleine Spaltenzusaetze plus die materialisierte edge_projection.
// Grund: das kanonische Schema (Agent 2) modelliert absichtlich korrekt, dass
// eine unaufgeloeste Erzaehlerposition KEINE narrator-Zeile ist (P4 Entity
// Resolution laeuft noch nicht) und ein Matn-Cluster KEINE hadith_cluster-
// Zeile ohne redaktionelle Pruefung sein darf (P2.1/P5.8 noch nicht
// erreicht). Beides bleibt darum in dieser Bauversion leer -- das ist
// korrekt, keine Luecke. Fuer die 14 Worker-Endpunkte wird trotzdem eine
// schnelle Gruppierung nach "unaufgeloestes Namenscluster" bzw.
// "Matn-Fingerabdruck" gebraucht, exakt wie backend/app/repository.py sie
// zur Laufzeit aus denselben Rohdaten berechnet. Statt das bei jeder
// Web-Anfrage im Worker neu zu berechnen (teuer, D1 zaehlt Zeilen-
// Lesevorgaenge), wird es einmal beim Bau vorab materialisiert.
function applyAtlasExtensions(db) {
  db.exec(`
    -- Eine-Zeile-Tabelle: der Worker liest hieraus dataVersion fuer die
    -- Antwort-Huelle (P2.2), statt bei jeder Anfrage aus einer Fachtabelle
    -- zu raten oder das Manifest erneut zu bundlen. Analog zu
    -- backend/app/repository.py, das PUBLIC_MANIFEST einmal beim Start liest.
    CREATE TABLE atlas_build_info (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data_version TEXT NOT NULL,
      built_at TEXT NOT NULL,
      schema_source TEXT NOT NULL DEFAULT 'database/schema.sql'
    );

    ALTER TABLE narrator_occurrence ADD COLUMN node_id TEXT;
    CREATE INDEX atlas_narrator_occurrence_node_id_idx ON narrator_occurrence (node_id);

    -- route_number/source_page_id/source_url sind im kanonischen Schema
    -- bewusst nicht auf hadith_record: sie sind Editions-/Fundstellendetail,
    -- das systematisch auf source_passage.source_locator liegt. Fuer den
    -- Worker (P3.2), der sourceReferences auf jeder Anfrage ausliefert (P2.2),
    -- waere ein JOIN plus JSON-Parse pro Zeile spuerbar teurer als eine
    -- denormalisierte Spalte -- exakt der Fall, fuer den eine Projektion
    -- (Abschnitt 11: "jederzeit neu aufbaubar") gedacht ist.
    ALTER TABLE hadith_record ADD COLUMN matn_fingerprint TEXT;
    ALTER TABLE hadith_record ADD COLUMN collection TEXT;
    ALTER TABLE hadith_record ADD COLUMN route_number INTEGER;
    ALTER TABLE hadith_record ADD COLUMN source_page_id INTEGER;
    ALTER TABLE hadith_record ADD COLUMN source_url TEXT;
    -- Voller Parser-Unterobjekt-Schnappschuss (JSON), damit der Worker
    -- backend/app/repository.py's "parser": record["parser"] -- ein
    -- Passthrough des kompletten Importer-Objekts -- feldgleich reproduzieren
    -- kann, ohne jedes einzelne Unterfeld (confidenceBand, boundaryRule,
    -- hasStrongTransmissionTerm, ...) als eigene Spalte nachzubilden.
    ALTER TABLE hadith_record ADD COLUMN parser_json TEXT;
    -- record.isnad im Importer-JSON ist die normalisierte (nicht die
    -- vokalisierte) Isnad-Textform -- ein eigenes Feld neben arabic_matn und
    -- full_raw_text (vokalisiert), damit publicRecordFields() dieselbe
    -- Textvariante wie backend/app/repository.py's item["isnad"] ausliefert.
    ALTER TABLE hadith_record ADD COLUMN arabic_isnad TEXT;
    -- record.routeMarkers im Importer-JSON (Standard 1). backend/app/
    -- repository.py's public_record() bildet "chainCount" als
    -- len(chains) or routeMarkers -- d. h. der Fallback greift nur, wenn
    -- chains leer ist (163 von 7291 Bukhari-Datensaetzen, recordClass
    -- "structural-heading" ohne parsbaren Isnad; empirisch geprueft:
    -- routeMarkers ist dort immer 1 und weicht nie von len(chains) ab,
    -- wenn chains vorhanden ist). Eigene Spalte statt Neuberechnung, damit
    -- der Worker denselben Fallback ohne Sonderfall-Query nachbilden kann.
    ALTER TABLE hadith_record ADD COLUMN route_markers INTEGER;
    CREATE INDEX atlas_hadith_record_fingerprint_idx ON hadith_record (matn_fingerprint);
    CREATE INDEX atlas_hadith_record_collection_idx ON hadith_record (collection, primary_number);

    -- backend/app/repository.py's chains() liefert dict(chain) unveraendert
    -- zurueck (nur rawIsnad ggf. entfernt) -- inklusive Feldern, die sonst
    -- nirgends in atlas.db abgelegt sind (normalizedIsnad, spanIntegrity,
    -- und die narratorOccurrences-Eintraege in ihrer ROHEN Importer-Form,
    -- nicht der fuer edge_projection/narrator_occurrence umgeformten). Statt
    -- jedes Detailfeld einzeln nachzubilden (und bei jeder Importer-
    -- Erweiterung erneut zu verfehlen), haelt raw_json das vollstaendige
    -- Original-Kettenobjekt fuer einen bytegleichen Passthrough im Worker.
    ALTER TABLE isnad_chain ADD COLUMN raw_json TEXT;

    ALTER TABLE rijal_entry ADD COLUMN source_page_id INTEGER;
    ALTER TABLE rijal_entry ADD COLUMN source_url TEXT;
    ALTER TABLE rijal_entry ADD COLUMN parser_json TEXT;

    -- id ist bewusst der native SQLite-rowid (INTEGER PRIMARY KEY), keine
    -- eigene Hash-ID: eine zusaetzliche TEXT-Primaerschluessel-Spalte auf
    -- Hash-Basis wuerde einen zweiten, praktisch zufaellig sortierten
    -- Unique-B-Baum erzwingen. Bei ~150.000 Zeilen kostete das auf dem
    -- FUSE-Sandbox-Dateisystem dieser Umgebung mehrere zehn Sekunden
    -- (gemessen: mit Hash-PK plus drei Indizes stieg die Einfuegezeit von
    -- 20.000 Zeilen/2 s auf 20.000 Zeilen/9 s -- eindeutig B-Baum-Kosten
    -- durch zufaellige Schluesselreihenfolge, nicht Zeilenanzahl). Die
    -- Indizes werden zusaetzlich absichtlich ERST NACH dem Befuellen
    -- angelegt (siehe buildEdgeProjection/createEdgeProjectionIndexes):
    -- ein Index-Build ueber eine bereits vollstaendige Tabelle sortiert
    -- einmal, statt bei jeder Einzelzeile den Baum neu zu balancieren.
    CREATE TABLE edge_projection (
      id INTEGER PRIMARY KEY,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      relationship_type TEXT NOT NULL CHECK (relationship_type IN ('transmitted_from', 'transmitted_to')),
      evidence_kind TEXT NOT NULL DEFAULT 'isnad_link',
      hadith_record_id TEXT NOT NULL REFERENCES hadith_record(id),
      collection TEXT NOT NULL,
      chain_id TEXT NOT NULL REFERENCES isnad_chain(id),
      -- Redundant zu chain_id, aber backend/app/repository.py's
      -- narrator_relations()/routes() brauchen den KURZEN, aus (hadithId,
      -- chainOrder) berechneten chainId-String bzw. den blossen Ordnungswert
      -- -- nicht isnad_chain.id (das den Importer-eigenen "#c<n>"-Suffix
      -- traegt, siehe worker/src/core/queries/narrators.mjs Moduldoc). Ohne
      -- diese Spalte muesste jede Anfrage zusaetzlich gegen isnad_chain
      -- joinen; bei einer materialisierten Projektion (Abschnitt 11) gehoert
      -- das an den Bauzeitpunkt, nicht in den Anfragepfad.
      chain_order INTEGER NOT NULL,
      source_position INTEGER NOT NULL,
      target_position INTEGER NOT NULL,
      data_version TEXT NOT NULL
    );

    -- "Assertion-Zaehler" (P3.1): Anzahl konkreter Kettenbelege je Kantentyp,
    -- gruppiert wie schema.sql:relationship_projection es fuer die (noch
    -- leere) relationship_assertion vorsieht -- dasselbe Muster, hier auf die
    -- tatsaechlich vorhandene Isnad-Nachbarschaft angewendet.
    CREATE VIEW edge_projection_aggregate AS
    SELECT source_node_id, target_node_id, relationship_type, evidence_kind,
           count(*) AS assertion_count
    FROM edge_projection
    GROUP BY source_node_id, target_node_id, relationship_type, evidence_kind;

    -- Komfortsichten fuer den Worker (worker/src/core/queries/*.mjs): buendeln
    -- den Drei-Tabellen-Join (Fachzeile + source_passage + source_work), den
    -- backend/app/repository.py's source_reference()/rijal_source_reference()
    -- brauchen, an einer Stelle statt in jeder Abfrage zu wiederholen. Reine
    -- Lesehilfen, keine zusaetzlichen Daten.
    -- h.rowid wird EXPLIZIT als eigene Spalte "rowid" durchgereicht: eine
    -- SQLite-Sicht ueber einem Mehrtabellen-Join exponiert die
    -- rowid-Pseudospalte der Basistabelle sonst nicht (h.* allein reicht
    -- nicht). worker/src/core/queries/*.mjs sortiert Trefferlisten nach
    -- dieser Spalte, um dieselbe Reihenfolge wie backend/app/repository.py's
    -- Tupel-Iteration ueber die JSON-Arrays zu erhalten (Abschnitt
    -- "Determinismus" oben) -- ohne eigenen Namen waere das Feld unter
    -- "rowid" von aussen gar nicht ansprechbar.
    CREATE VIEW hadith_record_ref AS
    SELECT h.*, h.rowid AS rowid, p.volume AS passage_volume, p.page AS passage_page, w.rights_status AS source_rights_status
    FROM hadith_record h
    JOIN source_passage p ON p.id = h.source_passage_id
    JOIN source_work w ON w.id = h.source_work_id;

    CREATE VIEW rijal_entry_ref AS
    SELECT r.*, r.rowid AS rowid, w.rights_status AS source_rights_status, w.slug AS source_key
    FROM rijal_entry r
    JOIN source_work w ON w.id = r.source_work_id;
  `);
}

// ---------------------------------------------------------------------------
// source_work / import_batch
// ---------------------------------------------------------------------------

function loadSourceWorks(db, registry, manifest) {
  const stmt = db.prepare(`
    INSERT INTO source_work (id, slug, title_ar, author_ar, genre, provider, provider_work_id, canonical_url, rights_status, public_field_policy, retrieved_at)
    VALUES (?, ?, ?, ?, ?, 'turath', ?, ?, ?, ?, ?)
  `);
  const ids = new Map();
  for (const source of registry.sources) {
    const id = `source:${source.key}`;
    ids.set(source.key, id);
    stmt.run(
      id,
      source.key,
      source.title,
      source.author ?? null,
      source.kind,
      String(source.turathBookId),
      `https://app.turath.io/book/${source.turathBookId}`,
      source.rightsStatus,
      asJsonText({ publicDerivedFields: source.publicDerivedFields ?? [] }),
      registry.provider?.retrievedAt ?? manifest.generatedAt,
    );
  }
  return ids;
}

function loadImportBatches(db, manifest, sourceWorkIds, dataVersion, generatedAt) {
  const stmt = db.prepare(`
    INSERT INTO import_batch (id, source_work_id, source_version, importer_version, raw_object_key, raw_sha256, started_at, completed_at, record_count, rejected_count, report)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const ids = new Map();
  for (const key of HADITH_COLLECTIONS) {
    const entry = manifest.collections[key];
    const id = `batch:${key}`;
    ids.set(key, id);
    stmt.run(id, sourceWorkIds.get(key), dataVersion, manifest.hadithParserVersion, entry.localFile, entry.rawSha256, generatedAt, generatedAt, entry.records, entry.unparsedRecords ?? 0, asJsonText(entry));
  }
  for (const key of RIJAL_SOURCES) {
    const entry = manifest.rijal[key];
    const id = `batch:${key}`;
    ids.set(key, id);
    stmt.run(id, sourceWorkIds.get(key), dataVersion, manifest.rijalParserVersion, entry.localFile, entry.rawSha256, generatedAt, generatedAt, entry.entries, entry.reviewQueueEntries ?? 0, asJsonText(entry));
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Hadith-Korpus: source_passage / hadith_record / isnad_chain / narrator_occurrence
// ---------------------------------------------------------------------------

function loadHadithCorpus(db, derivedDir, sourceWorkIds, importBatchIds, dataVersion) {
  const passageStmt = db.prepare(`
    INSERT INTO source_passage (id, source_work_id, import_batch_id, volume, page, source_locator, original_text, original_text_sha256, stable_reference, publication_allowed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);
  const recordStmt = db.prepare(`
    INSERT INTO hadith_record (id, source_work_id, source_passage_id, import_batch_id, external_record_id, source_order, book_heading, chapter_heading, primary_number, arabic_matn, normalized_matn, full_raw_text, full_raw_text_sha256, extraction_method, parser_version, parse_confidence, parse_error_code, review_status, data_version, matn_fingerprint, collection, route_number, source_page_id, source_url, parser_json, arabic_isnad, route_markers)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'parser', ?, ?, ?, 'machine_unreviewed', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const chainStmt = db.prepare(`
    INSERT INTO isnad_chain (id, hadith_record_id, chain_order, raw_isnad, span_start, span_end, extraction_method, parser_version, parse_confidence, review_status, data_version, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, 'parser', ?, ?, 'machine_unreviewed', ?, ?)
  `);
  const occurrenceStmt = db.prepare(`
    INSERT INTO narrator_occurrence (id, chain_id, position, raw_surface_form, normalized_surface_form, transmission_term, is_relative_form, relative_form_kind, resolved_narrator_id, identity_status, origin, span_start, span_end, review_status, data_version, node_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'machine', ?, ?, 'machine_unreviewed', ?, ?)
  `);

  let records = 0;
  let chains = 0;
  let occurrences = 0;
  let relativeForms = 0;

  for (const collection of HADITH_COLLECTIONS) {
    const path = `${derivedDir}/${collection}.json`;
    const data = JSON.parse(readFileSync(path, "utf8"));
    const sourceWorkId = sourceWorkIds.get(collection);
    const importBatchId = importBatchIds.get(collection);

    data.records.forEach((record, sourceOrder) => {
      const passageId = `passage:${record.id}`;
      const chainTexts = (record.chains ?? []).map((c) => c.rawIsnad ?? "").join(" | ");
      const combinedRaw = `${chainTexts}\n${record.matn ?? ""}`.trim();
      passageStmt.run(
        passageId,
        sourceWorkId,
        importBatchId,
        record.volume ?? null,
        record.printedPage != null ? String(record.printedPage) : null,
        asJsonText({ sourcePageId: record.sourcePageId, url: record.source?.url }),
        combinedRaw,
        sha256Hex(combinedRaw),
        `${record.collection}:${record.hadithNumber}${record.routeNumber ? `:${record.routeNumber}` : ""}`,
      );

      recordStmt.run(
        record.id,
        sourceWorkId,
        passageId,
        importBatchId,
        record.id,
        sourceOrder,
        record.book ?? null,
        record.chapter ?? null,
        String(record.hadithNumber),
        record.matn ?? null,
        normalizeSearchText(record.matn ?? ""),
        combinedRaw,
        sha256Hex(combinedRaw),
        record.parser?.version ?? null,
        record.parser?.confidence ?? null,
        record.parser?.errorReason ?? null,
        dataVersion,
        record.matnFingerprint ?? null,
        record.collection,
        record.routeNumber ?? null,
        record.sourcePageId ?? null,
        record.source?.url ?? null,
        asJsonText(record.parser ?? {}),
        record.isnad ?? null,
        Number.isInteger(record.routeMarkers) ? record.routeMarkers : 1,
      );
      records += 1;

      for (const chain of record.chains ?? []) {
        chainStmt.run(
          chain.chainId,
          record.id,
          chain.chainOrder,
          chain.rawIsnad ?? "",
          chain.spanStart ?? null,
          chain.spanEnd ?? null,
          record.parser?.version ?? null,
          record.parser?.confidence ?? null,
          dataVersion,
          asJsonText(chain),
        );
        chains += 1;

        for (const occurrence of chain.narratorOccurrences ?? []) {
          const normalized = normalizeSearchText(occurrence.normalizedSurfaceForm || occurrence.rawSurfaceForm || "");
          const nodeId = bucketId(record.id, chain.chainOrder, occurrence.position, normalized);
          const isRelative = Boolean(occurrence.relativeForm) || isRelativeReference(normalized);
          if (isRelative) relativeForms += 1;
          occurrenceStmt.run(
            `${chain.chainId}:${occurrence.position}`,
            chain.chainId,
            occurrence.position,
            occurrence.rawSurfaceForm ?? "",
            normalized,
            occurrence.transmissionTerm ?? null,
            isRelative ? 1 : 0,
            mapOccurrenceIdentityStatus(occurrence.identityStatus),
            occurrence.spanStart ?? null,
            occurrence.spanEnd ?? null,
            dataVersion,
            nodeId,
          );
          occurrences += 1;
        }
      }
    });
  }

  return { hadithRecords: records, isnadChains: chains, narratorOccurrences: occurrences, relativeFormOccurrences: relativeForms };
}

function mapOccurrenceIdentityStatus(value) {
  // Der Importer kennt einen feineren Zwischenwert ("unresolved-relative"),
  // der im kanonischen sechsstufigen Vokabular (P2.3) nicht vorgesehen ist.
  // Die Tatsache "relative Form" bleibt vollstaendig ueber die eigene Spalte
  // is_relative_form erhalten; hier wird nur auf das gemeinsame Vokabular
  // abgebildet, nichts geht verloren.
  if (value === "unresolved-relative") return "unresolved";
  return CONFIDENCE_LEVELS.has(value) ? value : "unresolved";
}

// ---------------------------------------------------------------------------
// Rijal-Quellen: source_passage / rijal_entry
// ---------------------------------------------------------------------------

function loadRijalCorpus(db, derivedDir, sourceWorkIds, importBatchIds, dataVersion) {
  const passageStmt = db.prepare(`
    INSERT INTO source_passage (id, source_work_id, import_batch_id, volume, page, source_locator, original_text, original_text_sha256, stable_reference, publication_allowed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);
  const entryStmt = db.prepare(`
    INSERT INTO rijal_entry (
      id, source_work_id, source_passage_id, import_batch_id, external_entry_id, entry_number, entry_number_int,
      name_head_raw, name_head_normalized, full_nasab, kunya, nisba, laqab, tabaqa, tabaqa_number,
      birth_year_ah, birth_year_min_ah, birth_year_max_ah, birth_precision, birth_original_phrase,
      death_year_ah, death_year_min_ah, death_year_max_ah, death_precision, death_original_phrase,
      primary_region, regions, teacher_phrase, student_phrase, teacher_names, student_names, grade_phrase,
      entry_text, entry_text_sha256, volume, printed_page, span_start, span_end,
      resolved_narrator_id, identity_status, extraction_method, parser_version, parse_confidence, parse_error_code,
      origin, review_status, data_version, publication_allowed, source_page_id, source_url, parser_json
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, NULL, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, NULL,
      ?, ?, ?, ?, ?, ?,
      NULL, 'unresolved', 'parser', ?, ?, ?,
      'machine', 'machine_unreviewed', ?, 0, ?, ?, ?
    )
  `);

  let entries = 0;
  for (const source of RIJAL_SOURCES) {
    const path = `${derivedDir}/${source}.json`;
    const data = JSON.parse(readFileSync(path, "utf8"));
    const sourceWorkId = sourceWorkIds.get(source);
    const importBatchId = importBatchIds.get(source);

    for (const entry of data.entries) {
      const passageId = `passage:${entry.id}`;
      passageStmt.run(
        passageId,
        sourceWorkId,
        importBatchId,
        entry.volume ?? null,
        entry.printedPage != null ? String(entry.printedPage) : null,
        asJsonText({ sourcePageId: entry.sourcePageId, url: entry.source?.url }),
        entry.text ?? "",
        sha256Hex(entry.text ?? ""),
        `${source}:${entry.entryNumber}`,
      );

      const birth = pickDateAssertion(entry.dateAssertions, "birth");
      const death = pickDateAssertion(entry.dateAssertions, "death");
      const regions = [entry.region, entry.residence].filter(Boolean);
      // entry.tabaqa ist im Importer-Output ein Objekt {label, ordinal, modifier,
      // evidenceClass, confidence, ...}, kein Skalar -- rijal_entry.tabaqa (text)
      // und .tabaqa_number (integer) bilden beide Teile getrennt ab.
      const tabaqaLabel = entry.tabaqa?.label ?? null;
      const tabaqaOrdinal = Number.isInteger(entry.tabaqa?.ordinal) ? entry.tabaqa.ordinal : null;

      entryStmt.run(
        entry.id,
        sourceWorkId,
        passageId,
        importBatchId,
        entry.id,
        String(entry.entryNumber),
        entry.entryNumber,
        entry.nameSurface ?? "",
        stripNameEdges(normalizeSearchText(entry.nameSurface ?? "")),
        entry.nameChain ?? null,
        entry.kunya ?? null,
        (entry.nisbas && entry.nisbas.length ? entry.nisbas.join("، ") : null),
        tabaqaLabel,
        tabaqaOrdinal,
        entry.birthYearCandidate ?? null,
        entry.birthYearCandidate ?? null,
        entry.birthYearCandidate ?? null,
        precisionFor(birth),
        birth?.rawPhrase ?? null,
        entry.deathYearCandidate ?? null,
        entry.deathYearCandidate ?? null,
        entry.deathYearCandidate ?? null,
        precisionFor(death),
        death?.rawPhrase ?? null,
        entry.region ?? null,
        asJsonText(regions),
        entry.teacherPhrase ?? null,
        entry.studentPhrase ?? null,
        asJsonText(entry.teacherMentions ?? []),
        asJsonText(entry.studentMentions ?? []),
        entry.text ?? null,
        sha256Hex(entry.text ?? ""),
        entry.volume ?? null,
        entry.printedPage != null ? String(entry.printedPage) : null,
        entry.entrySpan?.spanStart ?? null,
        entry.entrySpan?.spanEnd ?? null,
        entry.parser?.version ?? null,
        entry.parser?.confidence ?? null,
        entry.parser?.errorReason ?? null,
        dataVersion,
        entry.sourcePageId ?? null,
        entry.source?.url ?? null,
        asJsonText(entry.parser ?? {}),
      );
      entries += 1;
    }
  }
  return { rijalEntries: entries };
}

function pickDateAssertion(dateAssertions, kind) {
  return (dateAssertions ?? []).find((assertion) => assertion.kind === kind) ?? null;
}

// Bytegleich zu backend/app/repository.py's rijal_search_index():
// `normalize_arabic(entry.get("nameSurface", "")).strip(" .،؛:-()[]")` --
// IMMER von der ROHEN nameSurface aus, nie von einer bereits vorliegenden
// "normalisierten" Variante (die Python-Referenz kennt nameSurfaceNormalized
// im Importer-JSON gar nicht und liesst sie nie). Der nachgelagerte .strip()
// entfernt Trennzeichen, mit denen Namen in den Rijal-Werken oft enden
// (z. B. "...، الموصلي،"); ohne ihn wuerde ein exakter Namensabgleich (siehe
// worker/src/core/queries/narrators.mjs: narrator_timeline sucht per
// name_head_normalized = wanted) bei jedem so endenden Eintrag stumm
// scheitern.
const NAME_EDGE_CHARS = /^[ .،؛:\-()\[\]]+|[ .،؛:\-()\[\]]+$/g;
function stripNameEdges(value) {
  return value.replace(NAME_EDGE_CHARS, "");
}

function precisionFor(assertion) {
  if (!assertion) return "unknown";
  if (assertion.approximate || assertion.centuryExplicit === false) return "approximate";
  return "exact";
}

// ---------------------------------------------------------------------------
// edge_projection: materialisierte Isnad-Nachbarschaft
// ---------------------------------------------------------------------------

/**
 * Ein einziger Bulk-Read statt eine Abfrage je Kette (~14.100 Ketten): alle
 * Erzaehlerpositionen sortiert nach Datensatz, Kette und Position, dann in
 * EINEM Durchlauf in JS zu Paaren benachbarter Positionen zusammengefasst.
 * Die fruehere Fassung fragte pro Kette einzeln nach (N+1-Muster); auf dem
 * FUSE-Sandbox-Dateisystem dieser Umgebung kostete das mehrere zehn Sekunden
 * fuer ~14.100 Round-Trips. Ein Full-Scan mit anschliessendem linearem
 * Gruppieren braucht dieselbe Information in einer einzigen Abfrage.
 */
function buildEdgeProjection(db, dataVersion) {
  const verbose = Boolean(process.env.ATLAS_BUILD_VERBOSE);
  const t0 = Date.now();
  const rows = db
    .prepare(`
      SELECT o.chain_id AS chain_id, o.position AS position, o.node_id AS node_id,
             c.hadith_record_id AS hadith_record_id, h.collection AS collection, h.rowid AS record_rowid, c.chain_order AS chain_order
      FROM narrator_occurrence o
      JOIN isnad_chain c ON c.id = o.chain_id
      JOIN hadith_record h ON h.id = c.hadith_record_id
      ORDER BY h.rowid, c.chain_order, o.position
    `)
    .all();
  if (verbose) console.error(`    edge_projection: SELECT ${rows.length} Zeilen in ${Date.now() - t0} ms`);
  const t1 = Date.now();
  // id-Spalte bewusst NICHT befuellt: sie ist die native rowid (siehe
  // applyAtlasExtensions) und wird von SQLite fortlaufend vergeben --
  // billiger als jede selbst berechnete ID und fuer die Determinismus-
  // Abnahme unschaedlich, weil die Einfuegereihenfolge selbst deterministisch
  // ist (sortierter Bulk-Read oben, keine Iteration ueber Set/Map).
  const insert = db.prepare(`
    INSERT INTO edge_projection (source_node_id, target_node_id, relationship_type, evidence_kind, hadith_record_id, collection, chain_id, chain_order, source_position, target_position, data_version)
    VALUES (?, ?, ?, 'isnad_link', ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  let prev = null;
  let processed = 0;
  for (const row of rows) {
    if (prev && prev.chain_id === row.chain_id && prev.node_id && row.node_id) {
      insert.run(prev.node_id, row.node_id, "transmitted_from", row.hadith_record_id, row.collection, row.chain_id, row.chain_order, prev.position, row.position, dataVersion);
      insert.run(row.node_id, prev.node_id, "transmitted_to", row.hadith_record_id, row.collection, row.chain_id, row.chain_order, row.position, prev.position, dataVersion);
      inserted += 2;
    }
    prev = row;
    processed += 1;
    if (verbose && processed % 20000 === 0) console.error(`    edge_projection: ${processed}/${rows.length} verarbeitet, ${Date.now() - t1} ms seit Insertbeginn`);
  }
  if (verbose) console.error(`    edge_projection: INSERT-Schleife fertig in ${Date.now() - t1} ms`);
  return inserted;
}

/** Muss NACH buildEdgeProjection() laufen -- Begruendung siehe Kommentar an der Tabellendefinition in applyAtlasExtensions(). */
function createEdgeProjectionIndexes(db) {
  db.exec(`
    CREATE INDEX edge_projection_target_idx ON edge_projection (target_node_id);
    CREATE INDEX edge_projection_pair_idx ON edge_projection (source_node_id, target_node_id);
  `);
}

// ---------------------------------------------------------------------------
// FTS5 (external content, Roh- plus diakritikafreie Spalte)
// ---------------------------------------------------------------------------

function rebuildFtsIndexes(db) {
  populateHadithSearchDoc(db);
  populateRijalSearchDoc(db);
  db.exec(`INSERT INTO hadith_fts(hadith_fts) VALUES ('rebuild');`);
  db.exec(`INSERT INTO rijal_fts(rijal_fts) VALUES ('rebuild');`);
}

// Haystack-Felder und -Reihenfolge bytegleich zu backend/app/repository.py's
// _hadith_index(): normalize_arabic(" ".join(str(record.get(f) or "") for f
// in ("hadithNumber", "book", "chapter", "isnad", "matn"))) -- ERST
// zusammenfuegen, DANN einmal normalisieren (nicht Feld-fuer-Feld
// normalisieren und dann zusammenfuegen: normalize_arabic ist nicht
// notwendig verkettungsneutral, z. B. bei Leerzeichen-Kollaps an Fugen).
function populateHadithSearchDoc(db) {
  const records = db
    .prepare(`SELECT id, collection, full_raw_text, primary_number, book_heading, chapter_heading, arabic_isnad, arabic_matn FROM hadith_record ORDER BY rowid`)
    .all();
  const insert = db.prepare(`INSERT INTO hadith_search_doc (id, hadith_record_id, collection, raw_text, normalized_text) VALUES (?, ?, ?, ?, ?)`);
  let rowNum = 0;
  db.exec("BEGIN;");
  for (const record of records) {
    rowNum += 1;
    const haystackSource = [record.primary_number, record.book_heading, record.chapter_heading, record.arabic_isnad, record.arabic_matn].map((v) => v ?? "").join(" ");
    const normalized = normalizeSearchText(haystackSource);
    insert.run(rowNum, record.id, record.collection, record.full_raw_text, normalized);
  }
  db.exec("COMMIT;");
}

function populateRijalSearchDoc(db) {
  const entries = db.prepare(`SELECT id, name_head_raw, name_head_normalized, entry_text FROM rijal_entry ORDER BY rowid`).all();
  const insert = db.prepare(`INSERT INTO rijal_search_doc (id, rijal_entry_id, raw_text, normalized_text, name_normalized) VALUES (?, ?, ?, ?, ?)`);
  let rowNum = 0;
  db.exec("BEGIN;");
  for (const entry of entries) {
    rowNum += 1;
    const rawText = `${entry.name_head_raw ?? ""} ${entry.entry_text ?? ""}`.trim();
    const normalizedText = `${entry.name_head_normalized ?? ""} ${normalizeSearchText(entry.entry_text ?? "")}`.trim();
    insert.run(rowNum, entry.id, rawText, normalizedText, entry.name_head_normalized ?? "");
  }
  db.exec("COMMIT;");
}

function verifyIntegrity(db) {
  const result = db.prepare("PRAGMA integrity_check").get();
  const value = result?.integrity_check ?? result?.["integrity_check"];
  if (value !== "ok") {
    throw new Error(`SQLite integrity_check fehlgeschlagen: ${JSON.stringify(result)}`);
  }
}

/** Fuer build-atlas-db.mjs: legt die beiden externen FTS5-Aussenschichten an. Muss vor rebuildFtsIndexes() laufen. */
export function createFtsTables(db) {
  db.exec(`
    CREATE TABLE hadith_search_doc (
      id INTEGER PRIMARY KEY,
      hadith_record_id TEXT NOT NULL UNIQUE REFERENCES hadith_record(id),
      collection TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      normalized_text TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE hadith_fts USING fts5(
      raw_text, normalized_text,
      content='hadith_search_doc', content_rowid='id'
    );

    CREATE TABLE rijal_search_doc (
      id INTEGER PRIMARY KEY,
      rijal_entry_id TEXT NOT NULL UNIQUE REFERENCES rijal_entry(id),
      raw_text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      name_normalized TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE rijal_fts USING fts5(
      raw_text, normalized_text, name_normalized,
      content='rijal_search_doc', content_rowid='id'
    );
  `);
}

export const internal = {
  sha256Hex,
  sha1Hex12,
  mapOccurrenceIdentityStatus,
  precisionFor,
  pickDateAssertion,
  TEXT_RIGHTS_CLEARED_STATUSES,
};
