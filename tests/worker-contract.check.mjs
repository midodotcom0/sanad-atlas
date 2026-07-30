// P3.2-Abnahme: "Contract-Tests, die Worker- und FastAPI-Antworten
// feldweise vergleichen." Ruft fuer dieselben Parameter (a) den
// Worker-Router (worker/src/core/router.mjs) gegen die reale atlas.db und
// (b) backend/app/repository.py direkt (per Python-Subprozess-Bruecke,
// FastAPI/uvicorn selbst ist im Sandbox nicht startbar) auf und vergleicht
// die geparsten JSON-Antworten strukturell (assert.deepStrictEqual --
// erkennt auch Typabweichungen wie "1" vs. 1, nicht nur Wertabweichungen).
//
// Voraussetzung: worker/atlas.db existiert und wurde aus DENSELBEN
// .cache/turath-derived/*.json gebaut, gegen die die Python-Bruecke laeuft
// (sonst vergleicht der Test zwei verschiedene Datenstaende miteinander).
// `node --experimental-sqlite --test tests/worker-contract.check.mjs`.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dbPath = path.join(root, "worker", "atlas.db");
const bridgePath = path.join(here, "worker-contract-python-bridge.py");

const { createNodeSqliteAdapter } = await import(path.join(root, "worker/src/adapters/node-sqlite-adapter.mjs"));
const { createLicenseGate } = await import(path.join(root, "worker/src/core/license-gate.mjs"));
const { route } = await import(path.join(root, "worker/src/core/router.mjs"));

test("worker-contract: voraussetzungen", { skip: !existsSync(dbPath) ? "worker/atlas.db fehlt -- node --experimental-sqlite scripts/build-atlas-db.mjs zuerst ausfuehren" : false }, () => {
  assert.ok(existsSync(dbPath));
});

if (!existsSync(dbPath)) {
  test.skip("worker-contract uebersprungen: worker/atlas.db fehlt", () => {});
} else {
  const rawDb = new DatabaseSync(dbPath, { readOnly: true });
  const db = createNodeSqliteAdapter(rawDb);
  const registry = JSON.parse(readFileSync(path.join(root, "data/sources/turath-manifest.json"), "utf8"));
  const gate = createLicenseGate(registry);
  const buildInfo = rawDb.prepare("SELECT data_version FROM atlas_build_info WHERE id = 1").get();
  const dataVersion = buildInfo.data_version;
  const deps = { db, gate, registry, dataVersion };

  function pyCall(method, kwargs = {}, args = []) {
    const result = spawnSync("python3", [bridgePath, method, JSON.stringify({ args, kwargs })], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error(`python bridge failed for ${method}: ${result.stderr}`);
    }
    return JSON.parse(result.stdout);
  }

  async function workerCall(urlPath) {
    const req = new Request(`http://worker.local${urlPath}`);
    const res = await route(req, deps);
    return { status: res.status, body: JSON.parse(await res.text()) };
  }

  // Reale IDs aus dem aktuellen Baustand statt hartkodierter Werte, damit
  // der Test robust gegenueber einem Re-Import bleibt (Umsetzungsplan:
  // "zwei Laeufe -> bitgleiche Pruefsumme", nicht notwendig bitgleiche IDs
  // bei geaendertem Quellkorpus).
  const someHadith = rawDb.prepare("SELECT id FROM hadith_record ORDER BY rowid LIMIT 1 OFFSET 5").get();
  const chainlessHadith = rawDb
    .prepare("SELECT h.id FROM hadith_record h WHERE NOT EXISTS (SELECT 1 FROM isnad_chain c WHERE c.hadith_record_id = h.id) ORDER BY h.rowid LIMIT 1")
    .get();
  const clusterFingerprint = rawDb.prepare("SELECT matn_fingerprint FROM hadith_record WHERE matn_fingerprint IS NOT NULL ORDER BY rowid LIMIT 1").get();
  const someRijal = rawDb.prepare("SELECT id FROM rijal_entry WHERE source_work_id = 'source:tahdhib' ORDER BY rowid LIMIT 1 OFFSET 7").get();
  const rijalNameQuery = rawDb.prepare("SELECT name_head_normalized FROM rijal_entry WHERE name_head_normalized <> '' ORDER BY rowid LIMIT 1 OFFSET 20").get();
  // Ein Knoten, dessen normalisierte Form EXAKT einen Rijal-Eintrag trifft
  // (uebt narrator_timeline()'s nicht-leeren Pfad UND die name_head_normalized-
  // Korrektheit aus, siehe atlas-build-lib.mjs stripNameEdges()).
  const namedNarrator = rawDb
    .prepare(
      `SELECT o.node_id FROM narrator_occurrence o
       WHERE o.normalized_surface_form IN (SELECT name_head_normalized FROM rijal_entry WHERE name_head_normalized <> '')
         AND o.node_id NOT LIKE 'UNC-REL-%'
       GROUP BY o.node_id ORDER BY count(*) DESC LIMIT 1`,
    )
    .get();
  const secondNarrator = rawDb
    .prepare(`SELECT node_id FROM narrator_occurrence WHERE node_id NOT LIKE 'UNC-REL-%' AND node_id <> ? GROUP BY node_id ORDER BY count(*) DESC LIMIT 1 OFFSET 3`)
    .get(namedNarrator.node_id);
  const relativeNarrator = rawDb.prepare("SELECT node_id FROM narrator_occurrence WHERE node_id LIKE 'UNC-REL-%' LIMIT 1").get();

  test("GET /api/v1/hadiths (ohne Suche)", async () => {
    const py = pyCall("hadiths", { collection: null, query: "", cursor: null, limit: 5 });
    const w = await workerCall("/api/v1/hadiths?limit=5");
    assert.deepStrictEqual(w.body, py);
  });

  test("GET /api/v1/hadiths (mit collection=muslim)", async () => {
    const py = pyCall("hadiths", { collection: "muslim", query: "", cursor: null, limit: 3 });
    const w = await workerCall("/api/v1/hadiths?collection=muslim&limit=3");
    assert.deepStrictEqual(w.body, py);
  });

  test("GET /api/v1/hadiths/{id}", async () => {
    const py = pyCall("hadith", {}, [someHadith.id]);
    const w = await workerCall(`/api/v1/hadiths/${someHadith.id}`);
    assert.deepStrictEqual(w.body, py);
  });

  test("GET /api/v1/hadiths/{id}/chains (mit Kette)", async () => {
    const py = pyCall("chains", {}, [someHadith.id]);
    const w = await workerCall(`/api/v1/hadiths/${someHadith.id}/chains`);
    assert.deepStrictEqual(w.body, py);
  });

  test("GET /api/v1/hadiths/{id}/chains (chain-loser Datensatz, Fallback)", { skip: !chainlessHadith }, async () => {
    const py = pyCall("chains", {}, [chainlessHadith.id]);
    const w = await workerCall(`/api/v1/hadiths/${chainlessHadith.id}/chains`);
    assert.deepStrictEqual(w.body, py);
  });

  test("GET /api/v1/hadiths/{id} (404)", async () => {
    const w = await workerCall("/api/v1/hadiths/does-not-exist-xyz");
    assert.strictEqual(w.status, 404);
    assert.deepStrictEqual(w.body, { detail: "Hadith occurrence not found" });
  });

  test("GET /api/v1/clusters/{id}/routes", { skip: !clusterFingerprint }, async () => {
    const clusterId = `HCL-${clusterFingerprint.matn_fingerprint}`;
    const py = pyCall("routes", {}, [clusterId]);
    const w = await workerCall(`/api/v1/clusters/${clusterId}/routes`);
    assert.deepStrictEqual(w.body, py);
  });

  test("GET /api/v1/clusters/{id}/matn-variants", { skip: !clusterFingerprint }, async () => {
    const clusterId = `HCL-${clusterFingerprint.matn_fingerprint}`;
    const py = pyCall("matn_variants", {}, [clusterId]);
    const w = await workerCall(`/api/v1/clusters/${clusterId}/matn-variants`);
    assert.deepStrictEqual(w.body, py);
  });

  test("GET /api/v1/rijal", async () => {
    const py = pyCall("rijal_entries", { source: "tahdhib", query: "", cursor: null, limit: 5 });
    const w = await workerCall("/api/v1/rijal?limit=5");
    assert.deepStrictEqual(w.body, py);
  });

  test("GET /api/v1/rijal/{id}", async () => {
    const py = pyCall("rijal_entry", {}, [someRijal.id]);
    const w = await workerCall(`/api/v1/rijal/${someRijal.id}`);
    assert.deepStrictEqual(w.body, py);
  });

  test("GET /api/v1/identity-candidates", async () => {
    const q = rijalNameQuery.name_head_normalized;
    const py = pyCall("rijal_candidates", { query: q, limit: 24 });
    const w = await workerCall(`/api/v1/identity-candidates?q=${encodeURIComponent(q)}`);
    assert.deepStrictEqual(w.body, py);
  });

  test("GET /api/v1/narrators/{id} (bekannter Name mit Rijal-Kandidaten)", async () => {
    const py = pyCall("narrator_profile", {}, [namedNarrator.node_id]);
    const w = await workerCall(`/api/v1/narrators/${namedNarrator.node_id}`);
    assert.deepStrictEqual(w.body, py);
  });

  test("GET /api/v1/narrators/{id} (relative Rueckverweisform)", async () => {
    const py = pyCall("narrator_profile", {}, [relativeNarrator.node_id]);
    const w = await workerCall(`/api/v1/narrators/${relativeNarrator.node_id}`);
    assert.deepStrictEqual(w.body, py);
  });

  test("GET /api/v1/narrators/{id} (404, unbekannte id)", async () => {
    const w = await workerCall("/api/v1/narrators/UNC-000000000000");
    assert.strictEqual(w.status, 404);
    assert.deepStrictEqual(w.body, { detail: "No occurrence cluster found for this identifier" });
  });

  test("GET /api/v1/narrators/{id}/relations", async () => {
    const py = pyCall("narrator_relations", { cursor: null, limit: 10 }, [namedNarrator.node_id]);
    const w = await workerCall(`/api/v1/narrators/${namedNarrator.node_id}/relations?limit=10`);
    assert.deepStrictEqual(w.body, py);
  });

  test("GET /api/v1/narrators/{id}/relations (unbekannte id -> notice, kein 404)", async () => {
    const py = pyCall("narrator_relations", { cursor: null, limit: 10 }, ["UNC-000000000000"]);
    const w = await workerCall("/api/v1/narrators/UNC-000000000000/relations?limit=10");
    assert.strictEqual(w.status, 200);
    assert.deepStrictEqual(w.body, py);
  });

  test("GET /api/v1/narrators/{id}/timeline (mit Datierungsangaben)", async () => {
    const py = pyCall("narrator_timeline", {}, [namedNarrator.node_id]);
    const w = await workerCall(`/api/v1/narrators/${namedNarrator.node_id}/timeline`);
    assert.deepStrictEqual(w.body, py);
    assert.ok(py.data.dateAssertions.length > 0, "Testfall sollte tatsaechlich Datierungsangaben pruefen");
  });

  test("GET /api/v1/narrators/compare", async () => {
    const py = pyCall("compare_narrators", {}, [namedNarrator.node_id, secondNarrator.node_id]);
    const w = await workerCall(`/api/v1/narrators/compare?a=${namedNarrator.node_id}&b=${secondNarrator.node_id}`);
    assert.deepStrictEqual(w.body, py);
  });

  test("GET /api/v1/chronology/compare", async () => {
    const py = pyCall("compare_chronology", {}, [namedNarrator.node_id, secondNarrator.node_id]);
    const w = await workerCall(`/api/v1/chronology/compare?a=${namedNarrator.node_id}&b=${secondNarrator.node_id}`);
    assert.deepStrictEqual(w.body, py);
  });

  test("GET /api/v1/sources", async () => {
    const py = pyCall("source_list");
    const w = await workerCall("/api/v1/sources");
    assert.deepStrictEqual(w.body, py);
  });

  test("GET /api/v1/sources/{id}", async () => {
    const py = pyCall("sources", {}, ["bukhari"]);
    const w = await workerCall("/api/v1/sources/bukhari");
    assert.deepStrictEqual(w.body, py);
  });

  test("GET /api/v1/sources/{id} (404)", async () => {
    const w = await workerCall("/api/v1/sources/does-not-exist");
    assert.strictEqual(w.status, 404);
    assert.deepStrictEqual(w.body, { detail: "Source not found" });
  });
}
