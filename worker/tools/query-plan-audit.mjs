#!/usr/bin/env node
/**
 * Zeilen-Lesebudget-Pruefung (P3.2 / Nullkosten-Randbedingung).
 *
 * D1 deckelt Zeilen-LESEVORGAENGE pro Tag (5 Mio. im Gratis-Kontingent), nicht
 * Anfragen. Eine einzige scannende Abfrage kostet daher mehr als tausend
 * indexgebundene. Dieses Werkzeug laesst EXPLAIN QUERY PLAN ueber genau die
 * Abfragen laufen, die worker/src/core/** ausfuehrt, und schlaegt Alarm, wenn
 * eine davon eine grosse Tabelle scannt statt sie zu durchsuchen.
 *
 * Es ersetzt keine Messung im Betrieb -- es verhindert die Klasse Fehler, die
 * im Betrieb erst am aufgebrauchten Tagesbudget auffaellt.
 *
 * Ausfuehren: node worker/tools/query-plan-audit.mjs [--db worker/atlas.db]
 * Exit-Code 0 = alle geprueften Abfragen indexgebunden (bis auf die unten
 * ausdruecklich begruendeten Ausnahmen), sonst 1.
 */

import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_DEPTH_HARD_LIMIT, MAX_EDGES_HARD_LIMIT, traverseFromNode } from "../src/core/graph-traversal.mjs";
import { createNodeSqliteAdapter } from "../src/adapters/node-sqlite-adapter.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const dbPath = argv.includes("--db") ? resolve(argv[argv.indexOf("--db") + 1]) : resolve(projectRoot, "worker/atlas.db");

if (!existsSync(dbPath)) {
  console.error(`atlas.db fehlt: ${dbPath}`);
  console.error("Zuerst: node --experimental-sqlite scripts/build-atlas-db.mjs");
  process.exit(1);
}

const { DatabaseSync } = await import("node:sqlite");
const raw = new DatabaseSync(dbPath, { readOnly: true });
const db = createNodeSqliteAdapter(raw);

/**
 * Jede Abfrage steht so hier, wie der Worker sie stellt (gleiche Tabellen,
 * gleiche WHERE-Form). `allowScan` nennt Tabellen, deren Scan fachlich
 * unvermeidbar UND klein ist -- mit Begruendung, nie als Sammelfreigabe.
 */
const CHECKS = [
  {
    label: "GET /hadiths (ohne Suche, mit collection)",
    sql: "SELECT * FROM hadith_record_ref h WHERE collection = ? ORDER BY rowid LIMIT ? OFFSET ?",
  },
  { label: "GET /hadiths/{id}", sql: "SELECT * FROM hadith_record_ref WHERE id = ?" },
  {
    label: "GET /hadiths/{id}/chains",
    sql: "SELECT raw_json FROM isnad_chain WHERE hadith_record_id = ? ORDER BY rowid",
  },
  {
    label: "GET /hadiths (FTS-Suche)",
    sql: `SELECT h.* FROM hadith_record_ref h
          JOIN hadith_search_doc d ON d.hadith_record_id = h.id
          JOIN hadith_fts f ON f.rowid = d.id
          WHERE hadith_fts MATCH ? AND h.collection = ? ORDER BY h.rowid LIMIT ? OFFSET ?`,
  },
  { label: "GET /clusters/{id}/routes + /matn-variants", sql: "SELECT * FROM hadith_record_ref WHERE matn_fingerprint = ? ORDER BY rowid" },
  {
    label: "Vorkommen eines Erzaehlerknotens (Profil, Relationen, Timeline)",
    sql: `SELECT o.raw_surface_form, o.position, c.id AS chain_id, c.chain_order, c.hadith_record_id, h.collection
          FROM narrator_occurrence o
          JOIN isnad_chain c ON c.id = o.chain_id
          JOIN hadith_record h ON h.id = c.hadith_record_id
          WHERE o.node_id = ? ORDER BY h.rowid, c.chain_order, o.position`,
  },
  { label: "GET /narrators/{id}/relations", sql: "SELECT * FROM edge_projection WHERE source_node_id = ? ORDER BY rowid LIMIT ? OFFSET ?" },
  { label: "Begegnungsbeleg (compare)", sql: "SELECT * FROM edge_projection WHERE source_node_id = ? AND target_node_id = ? ORDER BY id" },
  {
    label: "Namenstreffer exakt (Timeline, Chronologie, Kandidatenstufe 1)",
    sql: "SELECT * FROM rijal_entry_ref WHERE source_key IN (?, ?, ?) AND name_head_normalized = ?",
  },
  { label: "GET /rijal/{id}", sql: "SELECT * FROM rijal_entry_ref WHERE id = ?" },
  { label: "GET /rijal (Liste je Quelle)", sql: "SELECT * FROM rijal_entry_ref WHERE source_key = ? ORDER BY rowid LIMIT ? OFFSET ?" },
  { label: "Release-Zeiger", sql: "SELECT release_id, data_version, index_version FROM atlas_release WHERE is_active = 1" },
  {
    // Bekannte, bewusst in Kauf genommene Ausnahme: ein Teilstring-Treffer
    // MITTEN im Namen ist mit einem B-Baum-Index nicht adressierbar. Die
    // FastAPI-Referenz macht an dieser Stelle dasselbe (repository.py:476,
    // `wanted in name` ueber alle Eintraege), und ein Umbau auf FTS wuerde die
    // Trefferbedeutung von "Teilstring" zu "Token" aendern -- also den Vertrag
    // brechen. Die Stufe laeuft nur, wenn die beiden index-gebundenen Stufen
    // davor die Trefferzahl nicht erreichen (worker/src/core/queries/rijal.mjs).
    label: "Kandidatenstufe 3 (name_contains, LIKE %..%)",
    sql: "SELECT * FROM rijal_entry_ref WHERE source_key IN (?, ?, ?) AND name_head_normalized LIKE ? ORDER BY length(name_head_normalized), entry_number_int",
    allowScan: ["rijal_entry", "r"],
    reason: "Teilstring in der Mitte ist nicht indexierbar; Referenzverhalten, siehe Kommentar im Quelltext",
  },
];

const SMALL_TABLES = new Set(["source_work", "w", "atlas_release", "atlas_build_info", "import_batch"]);

function planFor(sql) {
  return raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((row) => row.detail);
}

/**
 * "SCAN f VIRTUAL TABLE INDEX 0:=M2" ist KEIN Volltabellenscan, sondern die
 * Schreibweise, mit der SQLite einen FTS5-MATCH-Zugriff ausgibt: das ":=M"
 * bedeutet, dass die MATCH-Einschraenkung an das Virtual-Table-Modul
 * durchgereicht wird, der Index also benutzt wird. Ein FTS5-Zugriff OHNE MATCH
 * waere dagegen ein echter Scan -- deshalb wird hier auf ":=M" geprueft und
 * nicht pauschal jedes Virtual Table freigegeben.
 */
function isVirtualTableMatch(line) {
  return /VIRTUAL TABLE INDEX \d+:.*\bM/.test(line);
}

/**
 * Ein "AUTOMATIC ... INDEX" ist der teuerste Befund von allen: SQLite liest die
 * ganze Tabelle, baut daraus einen Wegwerfindex und verwirft ihn nach der
 * Abfrage -- pro Anfrage, jedes Mal. Auf D1 sind das die Zeilen-Lesevorgaenge
 * der gesamten Tabelle, nicht die des Ergebnisses.
 */
function automaticIndexes(plan) {
  return plan.filter((line) => /AUTOMATIC[ A-Z]*INDEX/.test(line));
}

let failures = 0;
console.log(`Zeilen-Lesebudget-Pruefung gegen ${dbPath}\n`);

for (const check of CHECKS) {
  const plan = planFor(check.sql);
  const scans = plan
    .filter((line) => /\bSCAN\b/.test(line) && !isVirtualTableMatch(line))
    .map((line) => line.match(/SCAN (\S+)/)?.[1] ?? "?")
    .filter((table) => !SMALL_TABLES.has(table) && !(check.allowScan ?? []).includes(table));
  const automatic = automaticIndexes(plan);
  if (scans.length === 0 && automatic.length === 0) {
    const note = check.allowScan ? `  (zugelassener Scan: ${check.allowScan[0]} -- ${check.reason})` : "";
    console.log(`ok   ${check.label}${note}`);
  } else {
    failures += 1;
    if (scans.length) console.error(`FEHL ${check.label}: Volltabellenscan auf ${scans.join(", ")}`);
    if (automatic.length) console.error(`FEHL ${check.label}: Wegwerfindex je Anfrage -- ${automatic.join(" | ")}`);
    for (const line of plan) console.error(`       ${line}`);
  }
}

// ---------------------------------------------------------------------------
// Harte Traversierungsgrenzen (docs/04-GRAPH-SCHEMA.md:121-122)
// ---------------------------------------------------------------------------

console.log("");
const hub = raw
  .prepare("SELECT source_node_id, count(*) AS n FROM edge_projection GROUP BY source_node_id ORDER BY n DESC LIMIT 1")
  .get();

if (!hub) {
  console.error("FEHL keine edge_projection-Zeilen -- Traversierungsgrenzen nicht pruefbar");
  failures += 1;
} else {
  console.log(`Traversierung ab dem am staerksten vernetzten Knoten (${hub.source_node_id}, ${hub.n} direkte Kanten):`);
  const deepPlan = planFor(
    `WITH RECURSIVE walk(source_node_id, target_node_id, depth, path) AS (
       SELECT source_node_id, target_node_id, 1, '>' || source_node_id || '>' || target_node_id || '>' FROM edge_projection WHERE source_node_id = ? AND relationship_type = ?
       UNION ALL
       SELECT e.source_node_id, e.target_node_id, w.depth + 1, w.path || e.target_node_id || '>'
       FROM edge_projection e JOIN walk w ON e.source_node_id = w.target_node_id AND e.relationship_type = ?
       WHERE w.depth < ? AND instr(w.path, '>' || e.target_node_id || '>') = 0)
     SELECT source_node_id, target_node_id, depth FROM walk LIMIT ?`,
  );
  const recursiveProblems = [
    ...deepPlan.filter((line) => /SCAN edge_projection|SCAN e\b/.test(line)),
    ...automaticIndexes(deepPlan),
  ];
  if (recursiveProblems.length) {
    failures += 1;
    console.error(`FEHL die Rekursion greift nicht indexgebunden zu: ${recursiveProblems.join(" | ")}`);
    console.error("     Ursache in der Regel: edge_projection_source_rel_idx fehlt (scripts/atlas-build-lib.mjs).");
  } else {
    console.log("ok   beide Zweige der Rekursion gehen ueber edge_projection-Indizes, kein Wegwerfindex");
  }

  const started = Date.now();
  const result = await traverseFromNode(db, hub.source_node_id, { maxDepth: 99 });
  const elapsed = Date.now() - started;
  const checks = [
    [result.maxDepth <= MAX_DEPTH_HARD_LIMIT, `maxDepth ist auf ${MAX_DEPTH_HARD_LIMIT} gedeckelt (angefordert 99, wirksam ${result.maxDepth})`],
    [result.edges.length <= MAX_EDGES_HARD_LIMIT, `hoechstens ${MAX_EDGES_HARD_LIMIT} Kanten (geliefert ${result.edges.length})`],
    [result.edges.every((edge) => edge.depth <= MAX_DEPTH_HARD_LIMIT), "keine Kante tiefer als die Grenze"],
    [result.truncated === result.edges.length >= MAX_EDGES_HARD_LIMIT, `"truncated" wird gemeldet, wenn gekappt wurde (${result.truncated})`],
  ];
  for (const [passed, label] of checks) {
    if (passed) console.log(`ok   ${label}`);
    else {
      failures += 1;
      console.error(`FEHL ${label}`);
    }
  }
  console.log(`     Laufzeit ${elapsed} ms, ${result.nodes.length} Knoten, ${result.edges.length} Kanten`);
}

raw.close();
console.log("");
if (failures) {
  console.error(`${failures} Befund(e) -- Abfragen oder Grenzen nachbessern, bevor das in D1 laeuft.`);
  process.exitCode = 1;
} else {
  console.log("Alle geprueften Abfragen sind indexgebunden, alle harten Traversierungsgrenzen greifen.");
}
