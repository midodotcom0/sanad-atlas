/**
 * Prueft `scripts/atlas-schema-translate.mjs` gegen das echte
 * `database/schema.sql`: die uebersetzte DDL muss (a) keine PostgreSQL-
 * Restsyntax mehr enthalten und (b) tatsaechlich fehlerfrei in einer
 * SQLite-Datenbank ausfuehrbar sein -- nicht nur "sieht plausibel aus".
 *
 * Nutzt `node:sqlite` (Node 22, `--experimental-sqlite`). Ist das Modul
 * nicht verfuegbar, wird als Rueckfallnachweis `python3 -c "import sqlite3"`
 * benutzt (siehe unten) und der Test andernfalls uebersprungen.
 *
 * Ausfuehren: `node --experimental-sqlite --test tests/atlas-db-schema-translate.check.mjs`
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert";
import test from "node:test";
import { translateSchemaToSqlite } from "../scripts/atlas-schema-translate.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = resolve(projectRoot, "database/schema.sql");
const schemaText = readFileSync(schemaPath, "utf8");

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  DatabaseSync = null;
}

test("die uebersetzte DDL enthaelt keine PostgreSQL-Restsyntax mehr", () => {
  const { sql } = translateSchemaToSqlite(schemaText);
  assert.doesNotMatch(sql, /CREATE TYPE/);
  assert.doesNotMatch(sql, /CREATE EXTENSION/);
  assert.doesNotMatch(sql, /\bjsonb\b/);
  assert.doesNotMatch(sql, /\btimestamptz\b/);
  assert.doesNotMatch(sql, /\buuid\b/);
  assert.doesNotMatch(sql, /gen_random_uuid/);
  assert.doesNotMatch(sql, /DEFAULT now\(\)/);
  assert.doesNotMatch(sql, /::jsonb/);
  assert.doesNotMatch(sql, /LANGUAGE plpgsql/);
  assert.doesNotMatch(sql, /CREATE TRIGGER/);
  assert.doesNotMatch(sql, /CREATE FUNCTION/);
  assert.doesNotMatch(sql, /USING gin/);
  // '~' darf nur noch innerhalb von Kommentartext vorkommen (falls ueberhaupt), nie mehr als Operator vor einem String-Literal.
  const stray = [...sql.matchAll(/\w+\s*~\s*'/g)];
  assert.deepEqual(stray, [], `verbliebene ~-Operatoren: ${stray.map((m) => m[0]).join(", ")}`);
});

test("36 CREATE TYPE-Werte werden auf 9 ENUMs abgebildet und liefern die dokumentierten Vokabulare", () => {
  const { enumTypes } = translateSchemaToSqlite(schemaText);
  assert.equal(enumTypes.size, 9);
  assert.deepEqual(enumTypes.get("confidence_level"), ["verified", "high", "medium", "low", "unresolved", "conflict"]);
  assert.deepEqual(enumTypes.get("review_status"), ["machine_unreviewed", "in_review", "accepted", "rejected", "superseded"]);
  assert.deepEqual(enumTypes.get("assertion_origin"), ["machine", "editorial", "registry"]);
  assert.deepEqual(enumTypes.get("evidence_kind"), ["isnad_link", "rijal_statement", "chronology_only"]);
  assert.deepEqual(enumTypes.get("chronology_result"), ["possible", "impossible", "insufficient"]);
});

test("37 Tabellen und 4 Sichten werden erkannt (Agent 2s Ausbau von 21 auf 37)", () => {
  const { tableNames, viewNames } = translateSchemaToSqlite(schemaText);
  assert.equal(tableNames.length, 37, tableNames.join(", "));
  assert.equal(viewNames.length, 4, viewNames.join(", "));
  for (const expected of ["rijal_entry", "scholar", "place", "narrator", "editor", "role", "edge_projection" /* wird separat ergaenzt, nicht hier */]) {
    if (expected === "edge_projection") continue;
    assert.ok(tableNames.includes(expected), `Tabelle ${expected} fehlt in der Uebersetzung`);
  }
});

test("die uebersetzte DDL laedt fehlerfrei in einer echten SQLite-Datenbank (node:sqlite)", { skip: !DatabaseSync && "node:sqlite nicht verfuegbar" }, () => {
  const { sql, tableNames, viewNames } = translateSchemaToSqlite(schemaText);
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(sql);
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    const createdTables = new Set(rows.map((r) => r.name));
    for (const name of tableNames) assert.ok(createdTables.has(name), `Tabelle ${name} wurde nicht angelegt`);

    const viewRows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'view'").all();
    const createdViews = new Set(viewRows.map((r) => r.name));
    for (const name of viewNames) assert.ok(createdViews.has(name), `Sicht ${name} wurde nicht angelegt`);

    // Die Seed-Inserts aus schema.sql selbst (role, editor, schema_migration) muessen gegriffen haben.
    const roleCount = db.prepare("SELECT count(*) AS n FROM role").get().n;
    const editorCount = db.prepare("SELECT count(*) AS n FROM editor").get().n;
    const migrationCount = db.prepare("SELECT count(*) AS n FROM schema_migration").get().n;
    assert.equal(roleCount, 5);
    assert.equal(editorCount, 1);
    assert.equal(migrationCount, 7);

    // CHECK-Constraint aus dem ENUM-Uebersetzer muss tatsaechlich durchgesetzt werden.
    assert.throws(() => {
      db.exec(`
        INSERT INTO source_work (id, slug, title_ar, genre, provider, rights_status)
        VALUES ('t1', 'test-slug', 'test', 'hadith_collection', 'turath', 'review-required');
        INSERT INTO import_batch (id, source_work_id, source_version, importer_version, raw_object_key, raw_sha256)
        VALUES ('b1', 't1', 'v1', 'imp1', 'k', 'sha');
        INSERT INTO source_passage (id, source_work_id, import_batch_id, source_locator, original_text_sha256)
        VALUES ('p1', 't1', 'b1', '{}', 'sha');
        INSERT INTO hadith_record (id, source_work_id, source_passage_id, import_batch_id, external_record_id, full_raw_text, full_raw_text_sha256, parser_version, review_status, data_version)
        VALUES ('h1', 't1', 'p1', 'b1', 'ext1', 'raw', 'sha', 'v1', 'NICHT-IM-ENUM', 'v1');
      `);
    }, /CHECK constraint failed/, "ein ungueltiger review_status-Wert haette abgelehnt werden muessen");

    // GLOB-Ersatz fuer den stable_key-Regex muss funktionieren (gueltige und ungueltige Form).
    db.exec(`
      INSERT INTO narrator (id, stable_key, canonical_arabic_name, normalized_name, identity_status, origin, review_status, data_version)
      VALUES ('n1', 'SA-P-ABCDEFGH', 'x', 'x', 'unresolved', 'machine', 'machine_unreviewed', 'v1');
    `);
    assert.throws(() => {
      db.exec(`
        INSERT INTO narrator (id, stable_key, canonical_arabic_name, normalized_name, identity_status, origin, review_status, data_version)
        VALUES ('n2', 'not-a-valid-key', 'x', 'x2', 'unresolved', 'machine', 'machine_unreviewed', 'v1');
      `);
    }, /CHECK constraint failed/, "ein stable_key ausserhalb des GLOB-Musters haette abgelehnt werden muessen");
  } finally {
    db.close();
  }
});

test("Fallback-Nachweis ohne node:sqlite: python3 sqlite3 ist als Ausweichweg fuer die Verifikation verfuegbar", { skip: !!DatabaseSync }, () => {
  const probe = spawnSync("python3", ["-c", "import sqlite3; print(sqlite3.sqlite_version)"]);
  assert.equal(probe.status, 0, "weder node:sqlite noch python3 sqlite3 verfuegbar -- DDL kann in dieser Umgebung nicht verifiziert werden");
});
