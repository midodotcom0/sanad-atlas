/**
 * Mehrschritt-Traversierung ueber die materialisierte `edge_projection`
 * (P3.1) per `WITH RECURSIVE` -- ersetzt eine Graphdatenbank fuer genau den
 * Anwendungsfall "von einem Erzaehlerknoten aus die Isnad-Nachbarschaft bis
 * Tiefe N erkunden" (docs/04-GRAPH-SCHEMA.md, Abschnitt "Projektionen":
 * "Neo4j und Elastic entfallen; die Graphprojektion ist eine materialisierte
 * Tabelle plus WITH RECURSIVE in SQLite/D1").
 *
 * Harte Grenzen (docs/04-GRAPH-SCHEMA.md, Abschnitt "Abfragegrenzen" sowie
 * Arbeitsauftrag P3.2): `maxDepth <= 8`, insgesamt hoechstens 500 Kanten pro
 * Antwort. Der Dokumentabschnitt nennt fuer eine dedizierte /paths-Ansicht
 * zusaetzlich "maximal 100 Pfade"; dieser Worker setzt die vom eigenen
 * Arbeitsauftrag geforderte 500-Kanten-Grenze als GLOBALE
 * Ausfuehrungsschranke um (schuetzt D1s Zeilen-Lesebudget bei einem stark
 * vernetzten Startknoten), was die 100-Pfade-Grenze automatisch mit abdeckt
 * (jeder Pfad besteht aus mindestens einer Kante).
 *
 * WICHTIG: Es gibt in backend/app/repository.py KEINE Mehrschritt-Traversierung
 * -- narrator_relations() liefert nur den direkten Nachbarschafts-Schritt
 * (Umsetzungsplan-Stand P2.2). Dieses Modul ist eine additive, rein
 * Worker-seitige Erweiterung (zusaetzlicher Endpunkt, siehe router.mjs:
 * GET /api/v1/narrators/{id}/paths), keine Ersetzung eines bestehenden
 * Vertragsfelds -- es gibt daher keine Python-Referenz, mit der ein
 * Contract-Test dieses Modul feldgleich abgleichen koennte.
 */

import { envelope, cited } from "./envelope.mjs";

export const MAX_DEPTH_HARD_LIMIT = 8;
export const MAX_EDGES_HARD_LIMIT = 500;

/**
 * @param {any} db db.all()/db.get()-Adapter
 * @param {string} startNodeId ein narrator_occurrence.node_id (bucket_id())
 * @param {{ direction?: "transmitted_from" | "transmitted_to", maxDepth?: number }} options
 *   direction: "transmitted_from" (Default) folgt der Kette RUECKWAERTS in
 *   der Zeit (vom Startknoten zu seinen Lehrern/fruehen Gliedern -- die
 *   ueblichste Erkundungsrichtung eines Isnads); "transmitted_to" folgt
 *   VORWAERTS (zu Schuelern/spaeteren Gliedern, in Richtung der Kompilatoren).
 * @returns {Promise<{ nodes: Array<{id:string}>, edges: Array<object>, truncated: boolean }>}
 */
export async function traverseFromNode(db, startNodeId, options = {}) {
  const direction = options.direction === "transmitted_to" ? "transmitted_to" : "transmitted_from";
  const maxDepth = Math.max(1, Math.min(Number(options.maxDepth) || MAX_DEPTH_HARD_LIMIT, MAX_DEPTH_HARD_LIMIT));

  // Zyklenschutz: SQLite erkennt Zyklen in WITH RECURSIVE nicht von selbst
  // (Pflicht laut SQLite-Dokumentation: "the recursive part ... must not
  // itself be a compound query" -- Endlosschleifen muessen manuell
  // ausgeschlossen werden). `path` haelt eine mit '>' umschlossene,
  // begrenzte Kette bereits besuchter Knoten-IDs; `instr(...)` prueft auf
  // Wiederauftreten, bevor ein Knoten erneut expandiert wird. Die
  // eigentliche Kappung ist die LIMIT-Klausel OHNE ORDER BY auf der
  // aeussersten Abfrage: SQLite bricht die Rekursion nachweislich ab,
  // sobald genug Zeilen fuer LIMIT erzeugt sind (SQLite-Doku zu
  // "Recursive Common Table Expressions"), MAX_EDGES_HARD_LIMIT ist also
  // eine echte Ausfuehrungsschranke, keine nachtraegliche Kappung einer
  // bereits vollstaendig berechneten Ergebnismenge.
  const rows = await db.all(
    `WITH RECURSIVE walk(source_node_id, target_node_id, relationship_type, hadith_record_id, chain_order, depth, path) AS (
      SELECT source_node_id, target_node_id, relationship_type, hadith_record_id, chain_order, 1,
             '>' || source_node_id || '>' || target_node_id || '>'
      FROM edge_projection
      WHERE source_node_id = ? AND relationship_type = ?
      UNION ALL
      SELECT e.source_node_id, e.target_node_id, e.relationship_type, e.hadith_record_id, e.chain_order, w.depth + 1,
             w.path || e.target_node_id || '>'
      FROM edge_projection e
      JOIN walk w ON e.source_node_id = w.target_node_id AND e.relationship_type = ?
      WHERE w.depth < ? AND instr(w.path, '>' || e.target_node_id || '>') = 0
    )
    SELECT source_node_id, target_node_id, relationship_type, hadith_record_id, chain_order, depth FROM walk LIMIT ?`,
    startNodeId,
    direction,
    direction,
    maxDepth,
    MAX_EDGES_HARD_LIMIT,
  );

  const truncated = rows.length >= MAX_EDGES_HARD_LIMIT;
  const nodeIds = new Set([startNodeId]);
  const edges = rows.map((row) => {
    nodeIds.add(row.source_node_id);
    nodeIds.add(row.target_node_id);
    return {
      source: row.source_node_id,
      target: row.target_node_id,
      relationshipType: row.relationship_type,
      evidenceKind: "isnad_occurrence",
      hadithId: row.hadith_record_id,
      chainOrder: row.chain_order,
      depth: row.depth,
    };
  });
  // Stabile, deterministische Ausgabereihenfolge (die Rekursion selbst
  // liefert Tiefe-zuerst dank breadth-first UNION-ALL-Auswertung, aber ohne
  // SQL-ORDER-BY -- siehe Kommentar oben; hier einmalig ueber der bereits
  // auf hoechstens 500 Zeilen begrenzten Menge sortiert, kostet nichts mehr
  // an D1-Zeilen-Lesevorgaengen).
  edges.sort((a, b) => a.depth - b.depth || a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  return { nodes: [...nodeIds].sort().map((id) => ({ id })), edges, truncated, maxDepth, direction };
}

/**
 * @param {any} db
 * @param {string} dataVersion
 * @param {string} startNodeId
 * @param {{ direction?: string, maxDepth?: number }} options
 */
export async function getNarratorPaths(db, dataVersion, startNodeId, options) {
  const result = await traverseFromNode(db, startNodeId, options);
  const hadithIds = [...new Set(result.edges.map((e) => e.hadithId))];
  const placeholders = hadithIds.map(() => "?").join(",");
  const records = hadithIds.length ? await db.all(`SELECT collection, primary_number, route_number, passage_volume, passage_page, source_page_id, source_url, source_rights_status FROM hadith_record_ref WHERE id IN (${placeholders})`, ...hadithIds) : [];
  const references = cited(
    records.map((r) => ({
      sourceWork: r.collection,
      hadithNumber: r.primary_number === null ? null : Number(r.primary_number),
      routeNumber: r.route_number ?? null,
      volume: r.passage_volume ?? null,
      page: r.passage_page === null ? null : Number(r.passage_page),
      sourcePageId: r.source_page_id ?? null,
      url: r.source_url,
      rightsStatus: r.source_rights_status,
    })),
    "Keine Isnād-Nachbarschaft für diesen Startknoten innerhalb der Tiefenbegrenzung gefunden.",
  );
  return envelope(
    { startNodeId, maxDepth: result.maxDepth, direction: result.direction, nodes: result.nodes, edges: result.edges, truncated: result.truncated },
    references,
    { confidenceLevel: result.edges.length ? "unresolved" : "unresolved", origin: "machine", dataVersion },
  );
}
