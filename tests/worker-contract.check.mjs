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
  // Fuer /timeline braucht es einen Knoten, dessen Namensform einen Rijal-
  // Eintrag MIT Datierungsangabe trifft -- `namedNarrator` oben tut das
  // nachweislich nicht (der haeufigste Namenstreffer im Korpus hat weder
  // Todes- noch Geburtsjahr), weshalb der Testfall sonst nur den leeren Pfad
  // prueft und die eigentliche Zusammenfuehrung von Vorkommenscluster und
  // Datierung ungetestet bliebe. Beide Pfade werden unten getrennt geprueft.
  const datedNarrator = rawDb
    .prepare(
      `SELECT o.node_id FROM narrator_occurrence o
       WHERE o.node_id NOT LIKE 'UNC-REL-%'
         AND o.normalized_surface_form IN (
           SELECT name_head_normalized FROM rijal_entry
           WHERE name_head_normalized <> ''
             AND source_work_id IN ('source:tahdhib', 'source:mizan', 'source:taqrib')
             AND (death_year_ah IS NOT NULL OR birth_year_ah IS NOT NULL))
       GROUP BY o.node_id ORDER BY count(*) DESC, o.node_id LIMIT 1`,
    )
    .get();

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

  test("GET /api/v1/narrators/{id}/timeline (mit Datierungsangaben)", { skip: !datedNarrator && "kein Vorkommenscluster mit datiertem Rijal-Treffer in dieser Datenbasis" }, async () => {
    const py = pyCall("narrator_timeline", {}, [datedNarrator.node_id]);
    const w = await workerCall(`/api/v1/narrators/${datedNarrator.node_id}/timeline`);
    assert.deepStrictEqual(w.body, py);
    assert.ok(py.data.dateAssertions.length > 0, "Testfall sollte tatsaechlich Datierungsangaben pruefen");
  });

  // Der leere Pfad ist eigenstaendig zu pruefen: er liefert nicht nur eine
  // leere Liste, sondern zusaetzlich einen erklaerenden `note`-Text, der
  // feldgleich zur Referenz sein muss (siehe worker/src/core/queries/
  // narrators.mjs, Kommentar an dieser Zeichenkette).
  test("GET /api/v1/narrators/{id}/timeline (ohne Datierungsangaben -> note)", async () => {
    const py = pyCall("narrator_timeline", {}, [namedNarrator.node_id]);
    const w = await workerCall(`/api/v1/narrators/${namedNarrator.node_id}/timeline`);
    assert.deepStrictEqual(w.body, py);
    assert.strictEqual(py.data.dateAssertions.length, 0, "Testfall sollte tatsaechlich den leeren Pfad pruefen");
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

  // ---------------------------------------------------------------------
  // Vertragsprüfung statt reinem Seitenvergleich.
  //
  // Alle Tests oben vergleichen Worker gegen FastAPI. Weichen BEIDE Seiten
  // gleich ab, ist das unsichtbar -- genau so trugen die Antworten monatelang
  // `evidenceKind: "isnad_occurrence"`, obwohl das Vokabular seit
  // database/migrations/0005_evidence_envelope.sql `isnad_link` heisst.
  // Die folgenden Faelle pruefen deshalb gegen die Spezifikation selbst,
  // nicht gegen die jeweils andere Implementierung.
  // ---------------------------------------------------------------------

  const EVIDENCE_KINDS = new Set(["isnad_link", "rijal_statement", "chronology_only"]);
  const CONFIDENCE_LEVELS = new Set(["verified", "high", "medium", "low", "unresolved", "conflict"]);
  const ORIGINS = new Set(["machine", "editorial", "registry"]);

  /** Sammelt jeden Wert eines Schluessels aus einer beliebig tiefen Antwort. */
  function collectValues(node, key, found = []) {
    if (Array.isArray(node)) for (const item of node) collectValues(item, key, found);
    else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (k === key) found.push(v);
        collectValues(v, key, found);
      }
    }
    return found;
  }

  /** Beide Seiten desselben Endpunkts, damit die Pruefung nie nur eine trifft. */
  const contractCases = [
    { label: "narrator_profile", path: `/api/v1/narrators/${namedNarrator.node_id}`, method: "narrator_profile", args: [namedNarrator.node_id], kwargs: {} },
    { label: "narrator_relations", path: `/api/v1/narrators/${namedNarrator.node_id}/relations?limit=10`, method: "narrator_relations", args: [namedNarrator.node_id], kwargs: { cursor: null, limit: 10 } },
    { label: "narrator_timeline", path: `/api/v1/narrators/${namedNarrator.node_id}/timeline`, method: "narrator_timeline", args: [namedNarrator.node_id], kwargs: {} },
    { label: "compare_narrators", path: `/api/v1/narrators/compare?a=${namedNarrator.node_id}&b=${secondNarrator.node_id}`, method: "compare_narrators", args: [namedNarrator.node_id, secondNarrator.node_id], kwargs: {} },
    ...(clusterFingerprint
      ? [{
          label: "routes",
          path: `/api/v1/clusters/HCL-${clusterFingerprint.matn_fingerprint}/routes`,
          method: "routes",
          args: [`HCL-${clusterFingerprint.matn_fingerprint}`],
          kwargs: {},
        }]
      : []),
  ];

  async function bothSides(entry) {
    const w = await workerCall(entry.path);
    const py = pyCall(entry.method, entry.kwargs, entry.args);
    return [["worker", w.body], ["fastapi", py]];
  }

  test("Vertrag: evidenceKind nutzt ausschliesslich das kanonische Vokabular", async () => {
    let seen = 0;
    for (const entry of contractCases) {
      for (const [side, body] of await bothSides(entry)) {
        for (const value of collectValues(body, "evidenceKind")) {
          seen += 1;
          assert.ok(
            EVIDENCE_KINDS.has(value),
            `${side} ${entry.label}: evidenceKind=${JSON.stringify(value)} steht nicht im Vokabular aus database/schema.sql`,
          );
        }
      }
    }
    assert.ok(seen > 0, "kein einziges evidenceKind-Feld gefunden -- die Pruefung liefe ins Leere");
  });

  test("Vertrag: confidenceLevel und origin sind kanonisch, maschinell nie verified", async () => {
    for (const entry of contractCases) {
      for (const [side, body] of await bothSides(entry)) {
        for (const value of collectValues(body, "confidenceLevel")) {
          assert.ok(CONFIDENCE_LEVELS.has(value), `${side} ${entry.label}: confidenceLevel=${JSON.stringify(value)}`);
        }
        for (const value of collectValues(body, "origin")) {
          assert.ok(ORIGINS.has(value), `${side} ${entry.label}: origin=${JSON.stringify(value)}`);
        }
        if (body?.origin === "machine") {
          assert.notStrictEqual(body.confidenceLevel, "verified", `${side} ${entry.label}: maschinelle Antwort meldet verified`);
        }
      }
    }
  });

  test("Vertrag: kein Antworttext traegt eine fest verdrahtete Bestandszahl", async () => {
    // Eine Bestandsgroesse als Prosa-Konstante wird beim naechsten Import
    // unbemerkt falsch -- sie nannte 27.105 bei inzwischen 34.045 Eintraegen.
    const forbidden = /\d[\d.,]{2,}\s*(Einträge|Eintraege|Vorkommen|Datensätze|Datensaetze)/;
    for (const entry of contractCases) {
      for (const [side, body] of await bothSides(entry)) {
        const hit = JSON.stringify(body).match(forbidden);
        assert.strictEqual(hit, null, `${side} ${entry.label}: fest verdrahtete Bestandszahl „${hit?.[0]}" im Antworttext`);
      }
    }
  });
}
