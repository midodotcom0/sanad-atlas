/**
 * Hadith- und Cluster-Endpunkte. Port der entsprechenden Methoden aus
 * `backend/app/repository.py` (`hadiths`, `hadith`, `chains`, `routes`,
 * `matn_variants`) gegen SQL-Abfragen auf atlas.db statt In-Memory-Indizes
 * ueber JSON.
 *
 * Bekannte, dokumentierte Abweichung von der FastAPI-Referenz: `q`-Suche
 * laeuft hier ueber FTS5 MATCH (phrasengebunden) statt ueber Pythons
 * Teilstring-Test `wanted in haystack`. Grund: ein Teilstring-Scan ueber
 * alle Datensaetze wuerde bei D1 gegen das taegliche Zeilen-Lesebudget
 * laufen (Umsetzungsplan Abschnitt 7, letzter Absatz). Fuer einzelne Woerter
 * und Namen -- der ueberwiegende Regelfall der Suche -- liefern beide
 * dasselbe Ergebnis; siehe tests/worker-contract.check.mjs.
 */

import { encodeCursor, decodeCursor } from "../cursor.mjs";
import { envelope, cited, aggregateMachineConfidence, levelFromScore } from "../envelope.mjs";
import { escapeFtsPhrase, normalizeSearchText } from "../search-text.mjs";
import { numOrNull } from "../util.mjs";

/** @param {Record<string, any>} row Zeile aus hadith_record_ref */
export function sourceReferenceForHadithRow(row) {
  return {
    sourceWork: row.collection,
    hadithNumber: numOrNull(row.primary_number),
    routeNumber: row.route_number ?? null,
    volume: row.passage_volume ?? null,
    page: numOrNull(row.passage_page),
    sourcePageId: row.source_page_id ?? null,
    url: row.source_url,
    rightsStatus: row.source_rights_status,
  };
}

async function withChainCounts(db, row) {
  const counts = await db.get(
    "SELECT count(DISTINCT chain_id) AS chainCount, count(*) AS narratorOccurrenceCount FROM narrator_occurrence WHERE chain_id IN (SELECT id FROM isnad_chain WHERE hadith_record_id = ?)",
    row.id,
  );
  return {
    ...row,
    parser: JSON.parse(row.parser_json ?? "{}"),
    chainCount: counts?.chainCount ?? 0,
    narratorOccurrenceCount: counts?.narratorOccurrenceCount ?? 0,
    isnad: row.arabic_isnad,
    matn: row.arabic_matn,
  };
}

/**
 * @param {{db: any, gate: any, dataVersion: string, collection?: string|null, query?: string, cursor?: string|null, limit: number}} params
 */
export async function listHadiths(db, gate, dataVersion, { collection, query, cursor, limit }) {
  const offset = decodeCursor(cursor);
  // Wie backend/app/repository.py's `wanted = normalize_arabic(query)`: die
  // Anfrage wird normalisiert, BEVOR sie mit dem Index verglichen wird, und
  // gezielt gegen die diakritikafreie FTS5-Spalte geprueft (P3.1: "Suche mit
  // und ohne Vokalzeichen"). Ein vokalisierter oder anders orthografierter
  // Suchbegriff normalisiert auf dieselbe Form wie der Index.
  const wanted = normalizeSearchText(query ?? "");
  const collectionFilter = collection === "bukhari" || collection === "muslim" ? collection : null;

  let rows;
  if (wanted) {
    const phrase = `normalized_text: ${escapeFtsPhrase(wanted)}`;
    rows = await db.all(
      `SELECT h.* FROM hadith_record_ref h
       JOIN hadith_search_doc d ON d.hadith_record_id = h.id
       JOIN hadith_fts f ON f.rowid = d.id
       WHERE hadith_fts MATCH ? ${collectionFilter ? "AND h.collection = ?" : ""}
       ORDER BY h.rowid
       LIMIT ? OFFSET ?`,
      ...(collectionFilter ? [phrase, collectionFilter, limit + 1, offset] : [phrase, limit + 1, offset]),
    );
  } else {
    rows = await db.all(
      `SELECT * FROM hadith_record_ref h WHERE ${collectionFilter ? "collection = ?" : "1=1"} ORDER BY rowid LIMIT ? OFFSET ?`,
      ...(collectionFilter ? [collectionFilter, limit + 1, offset] : [limit + 1, offset]),
    );
  }

  const hasMore = rows.length > limit;
  const window = await Promise.all(rows.slice(0, limit).map((row) => withChainCounts(db, row)));
  const matches = window.map((row) => gate.publicRecordFields(row, row.collection));
  const [level, score] = aggregateMachineConfidence(window.map((row) => row.parser?.confidence ?? null));
  const refs = cited(window.map(sourceReferenceForHadithRow), "Keine Treffer für die angegebene Suche in der aktuellen Datenbasis.");

  return envelope(
    { items: matches, pageInfo: { nextCursor: hasMore ? encodeCursor(offset + limit) : null, hasNextPage: hasMore } },
    refs,
    { confidenceLevel: level, confidenceScore: score, origin: "machine", dataVersion, resultCount: matches.length },
  );
}

export async function getHadith(db, gate, dataVersion, id) {
  const row = await db.get("SELECT * FROM hadith_record_ref WHERE id = ?", id);
  if (!row) return null;
  const full = await withChainCounts(db, row);
  const confidence = full.parser?.confidence ?? null;
  return envelope(gate.publicRecordFields(full, full.collection), [sourceReferenceForHadithRow(full)], {
    confidenceLevel: levelFromScore(confidence),
    confidenceScore: confidence,
    origin: "machine",
    dataVersion,
  });
}

/**
 * backend/app/repository.py's chains() gibt `dict(chain)` unveraendert
 * zurueck (nur rawIsnad ggf. entfernt) -- inklusive Feldern, die sonst
 * nirgends in atlas.db liegen (normalizedIsnad, spanIntegrity, und
 * narratorOccurrences in der ROHEN Importer-Form). isnad_chain.raw_json
 * haelt das vollstaendige Original-Kettenobjekt genau dafuer (siehe
 * atlas-build-lib.mjs); dieser Endpunkt parst es nur zurueck und entfernt
 * rawIsnad, statt es aus Einzelspalten neu zusammenzusetzen -- jede
 * Rekonstruktion aus Spalten waere bei der naechsten Importer-Erweiterung
 * erneut unvollstaendig.
 */
export async function getChains(db, gate, dataVersion, id) {
  const record = await db.get("SELECT * FROM hadith_record_ref WHERE id = ?", id);
  if (!record) return null;
  const rawIsnadCleared = gate.fullTextCleared(record.collection) && gate.allowedDerivedFields(record.collection).has("isnad");
  const chainRows = await db.all("SELECT raw_json FROM isnad_chain WHERE hadith_record_id = ? ORDER BY rowid", id);
  // Fallback bytegleich zu repository.py's `record.get("chains") or [...]`:
  // 163 von 7291 Bukhari-Datensaetzen (recordClass "structural-heading")
  // haben keine Isnad-Kette; narratorSurfaceForms ist fuer genau diese
  // Datensaetze im Korpus empirisch immer leer, also ist die synthetische
  // narratorOccurrences-Liste hier immer [].
  const rawChains = chainRows.length ? chainRows.map((r) => JSON.parse(r.raw_json)) : [{ chainOrder: 0, rawIsnad: record.arabic_isnad ?? "", narratorOccurrences: [] }];
  const items = rawChains.map((chain) => {
    const item = { ...chain };
    if (!rawIsnadCleared) delete item.rawIsnad;
    return item;
  });
  const confidence = JSON.parse(record.parser_json ?? "{}")?.confidence ?? null;
  return envelope({ hadithId: id, items }, [sourceReferenceForHadithRow(record)], {
    confidenceLevel: levelFromScore(confidence),
    confidenceScore: confidence,
    origin: "machine",
    dataVersion,
  });
}

/** clusterId hat die Form "HCL-<matnFingerprint>", identisch zu repository.py. */
function fingerprintFromClusterId(clusterId) {
  return clusterId.startsWith("HCL-") ? clusterId.slice(4) : clusterId;
}

export async function getClusterRoutes(db, gate, dataVersion, clusterId, { collection, limit = 250 } = {}) {
  const fingerprint = fingerprintFromClusterId(clusterId);
  const collectionFilter = collection === "bukhari" || collection === "muslim" ? collection : null;
  const records = await db.all(
    `SELECT * FROM hadith_record_ref WHERE matn_fingerprint = ? ${collectionFilter ? "AND collection = ?" : ""} ORDER BY rowid`,
    ...(collectionFilter ? [fingerprint, collectionFilter] : [fingerprint]),
  );
  if (records.length === 0) return null;
  const window = records.slice(0, limit);
  const recordIds = window.map((r) => r.id);
  const placeholders = recordIds.map(() => "?").join(",");

  const edges = recordIds.length
    ? await db.all(
        `SELECT source_node_id, target_node_id, hadith_record_id, chain_order, source_position
         FROM edge_projection
         WHERE relationship_type = 'transmitted_from' AND hadith_record_id IN (${placeholders})`,
        ...recordIds,
      )
    : [];
  const occurrences = recordIds.length
    ? await db.all(
        `SELECT o.node_id, o.raw_surface_form, o.identity_status, o.review_status, o.is_relative_form, c.hadith_record_id
         FROM narrator_occurrence o JOIN isnad_chain c ON c.id = o.chain_id
         WHERE c.hadith_record_id IN (${placeholders})`,
        ...recordIds,
      )
    : [];

  const nodes = new Map();
  for (const occ of occurrences) {
    if (!nodes.has(occ.node_id)) {
      nodes.set(occ.node_id, { id: occ.node_id, label: occ.raw_surface_form, identityStatus: occ.identity_status, reviewStatus: occ.review_status, isRelativeReference: Boolean(occ.is_relative_form) });
    }
  }
  const edgeMap = new Map();
  for (const edge of edges) {
    const key = `${edge.source_node_id}:${edge.target_node_id}`;
    let entry = edgeMap.get(key);
    if (!entry) {
      entry = { id: key, source: edge.source_node_id, target: edge.target_node_id, evidenceKind: "isnad_occurrence", occurrences: [], matnFamilies: [] };
      edgeMap.set(key, entry);
    }
    // Bytegleich zu repository.py's routes(): das Vorkommen traegt
    // "chainOrder" (kleine Ordnungszahl), NICHT "chainId" -- anders als
    // narrator_profile()/narrator_relations() unten, die tatsaechlich einen
    // chainId-String fuehren. Zwei unterschiedliche Formen an zwei
    // verschiedenen Endpunkten der Referenzimplementierung, hier bewusst
    // beide einzeln nachgebildet statt vereinheitlicht (P3.2-Abnahme
    // verlangt Feldgleichheit, keine Bereinigung).
    entry.occurrences.push({ hadithId: edge.hadith_record_id, chainOrder: edge.chain_order, position: edge.source_position });
    if (!entry.matnFamilies.includes(fingerprint)) entry.matnFamilies.push(fingerprint);
  }

  const [level, score] = aggregateMachineConfidence(window.map((r) => JSON.parse(r.parser_json ?? "{}")?.confidence ?? null));
  return envelope(
    { clusterId, nodes: [...nodes.values()], edges: [...edgeMap.values()], recordCount: records.length, truncated: records.length > limit },
    window.map(sourceReferenceForHadithRow),
    { confidenceLevel: level, confidenceScore: score, origin: "machine", dataVersion },
  );
}

const MATN_COLOR_TOKENS = ["teal", "clay", "gold", "ink", "sage"];

export async function getClusterMatnVariants(db, gate, dataVersion, clusterId) {
  const fingerprint = fingerprintFromClusterId(clusterId);
  const records = await db.all("SELECT * FROM hadith_record_ref WHERE matn_fingerprint = ? ORDER BY rowid", fingerprint);
  if (records.length === 0) return null;

  const families = new Map();
  for (const record of records) {
    // Innerhalb eines Clusters teilen sich per Definition alle Datensaetze
    // denselben Fingerabdruck (normalisierter Matn-Hash); eine einzelne
    // Familie pro Cluster ist der aktuell erreichte Stand, bis eine
    // redaktionell bestaetigte Unterclusterung existiert (P5.8).
    const familyKey = fingerprint;
    const textCleared = gate.fullTextCleared(record.collection) && gate.allowedDerivedFields(record.collection).has("matn");
    if (!families.has(familyKey)) {
      families.set(familyKey, {
        id: familyKey,
        colorToken: MATN_COLOR_TOKENS[families.size % MATN_COLOR_TOKENS.length],
        representativeText: textCleared ? record.matn : null,
        textWithheld: !textCleared,
        hadithIds: [],
        reviewStatus: "machine_unreviewed",
      });
    }
    families.get(familyKey).hadithIds.push(record.id);
  }
  const [level, score] = aggregateMachineConfidence(records.map((r) => JSON.parse(r.parser_json ?? "{}")?.confidence ?? null));
  return envelope(
    { clusterId, status: "machine_suggestion", items: [...families.values()] },
    records.map(sourceReferenceForHadithRow),
    { confidenceLevel: level, confidenceScore: score, origin: "machine", dataVersion },
  );
}
