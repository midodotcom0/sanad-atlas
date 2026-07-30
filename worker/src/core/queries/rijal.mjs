/**
 * Rijal-Endpunkte. Port von `backend/app/repository.py`
 * (`rijal_entries`, `rijal_entry`, `rijal_candidates`, `_rank_rijal`).
 *
 * WICHTIG fuer Vertragstreue: `backend/app/main.py` beschraenkt `source` auf
 * `^(tahdhib|mizan|taqrib)$` -- al-Kashif (von Agent 1 vierte registrierte
 * Quelle, Umsetzungsplan P1.5) ist in der AKTUELLEN FastAPI-Referenz noch
 * NICHT freigeschaltet. Damit Worker- und FastAPI-Antworten feldgleich
 * bleiben (P3.2-Abnahme), bedient dieser Worker `/rijal` und
 * `/identity-candidates` bewusst mit DENSELBEN drei Quellen; al-Kashif liegt
 * bereits vollstaendig in atlas.db (rijal_entry.source_work_id = 'source:kashif')
 * und kann freigeschaltet werden, sobald main.py es tut -- keine zweite
 * Migration noetig.
 */

import { encodeCursor, decodeCursor } from "../cursor.mjs";
import { envelope, cited, aggregateMachineConfidence, levelFromScore } from "../envelope.mjs";
import { escapeFtsPhrase, normalizeSearchText } from "../search-text.mjs";
import { numOrNull } from "../util.mjs";

export const RIJAL_API_SOURCES = ["tahdhib", "mizan", "taqrib"];

/** @param {Record<string, any>} row Zeile aus rijal_entry_ref */
export function sourceReferenceForRijalRow(row) {
  return {
    sourceWork: row.source_key,
    // entry_number_int (integer), nicht entry_number (text) -- siehe
    // util.mjs/numOrNull-Kommentar; rijal_source_reference() in
    // repository.py liest entry.get("entryNumber") immer als int.
    entryNumber: numOrNull(row.entry_number_int),
    volume: row.volume ?? null,
    page: numOrNull(row.printed_page),
    sourcePageId: row.source_page_id ?? null,
    url: row.source_url,
    rightsStatus: row.source_rights_status,
  };
}

function withParser(row) {
  return { ...row, parser: JSON.parse(row.parser_json ?? "{}") };
}

export async function listRijalEntries(db, gate, dataVersion, { source = "tahdhib", query, cursor, limit }) {
  if (!RIJAL_API_SOURCES.includes(source)) source = "tahdhib";
  const offset = decodeCursor(cursor);
  const wanted = normalizeSearchText(query ?? "");

  let rows;
  if (wanted) {
    const phrase = `normalized_text: ${escapeFtsPhrase(wanted)}`;
    rows = await db.all(
      `SELECT r.* FROM rijal_entry_ref r
       JOIN rijal_search_doc d ON d.rijal_entry_id = r.id
       JOIN rijal_fts f ON f.rowid = d.id
       WHERE r.source_key = ? AND rijal_fts MATCH ?
       ORDER BY r.rowid LIMIT ? OFFSET ?`,
      source,
      phrase,
      limit + 1,
      offset,
    );
  } else {
    rows = await db.all(`SELECT * FROM rijal_entry_ref WHERE source_key = ? ORDER BY rowid LIMIT ? OFFSET ?`, source, limit + 1, offset);
  }

  const hasMore = rows.length > limit;
  const window = rows.slice(0, limit).map(withParser);
  const matches = window.map((row) => gate.publicRijalFields(row, source));
  const [level, score] = aggregateMachineConfidence(window.map((row) => row.parser?.confidence ?? null));
  const refs = cited(window.map(sourceReferenceForRijalRow), "Keine Treffer für die angegebene Suche in der aktuellen Datenbasis.");

  return envelope(
    { items: matches, pageInfo: { nextCursor: hasMore ? encodeCursor(offset + limit) : null, hasNextPage: hasMore } },
    refs,
    { confidenceLevel: level, confidenceScore: score, origin: "machine", dataVersion, resultCount: matches.length },
  );
}

export async function getRijalEntry(db, gate, dataVersion, entryId) {
  const source = entryId.split("-", 1)[0];
  const row = await db.get("SELECT * FROM rijal_entry_ref WHERE id = ?", entryId);
  if (!row) return null;
  const full = withParser(row);
  const confidence = full.parser?.confidence ?? null;
  return envelope(gate.publicRijalFields(full, source), [sourceReferenceForRijalRow(full)], {
    confidenceLevel: levelFromScore(confidence),
    confidenceScore: confidence,
    origin: "machine",
    dataVersion,
  });
}

/**
 * Vierstufige Rangfolge, identisch zu `_rank_rijal()`:
 * exact_name > name_prefix > name_contains > biography_mention. Da rank die
 * PRIMAERE Sortierung ist, kann jede Stufe fruehzeitig abbrechen, sobald
 * `limit` erreicht ist -- eine spaetere (schwaechere) Stufe koennte ohnehin
 * nie vor einer frueheren stehen. Das ist aequivalent zu Pythons "alles
 * sammeln, dann sortieren", nur ohne unnoetigen Volltabellen-Scan.
 */
export async function rankRijalCandidates(db, wantedNormalized, limit) {
  if (!wantedNormalized) return [];
  const results = [];
  const seen = new Set();
  const placeholders = RIJAL_API_SOURCES.map(() => "?").join(",");

  async function addTier(rows, matchKind, rank) {
    for (const row of rows) {
      if (seen.has(row.id) || results.length >= limit) continue;
      seen.add(row.id);
      results.push({ row: withParser(row), matchKind, rank });
    }
  }

  if (results.length < limit) {
    const exact = await db.all(`SELECT * FROM rijal_entry_ref WHERE source_key IN (${placeholders}) AND name_head_normalized = ? ORDER BY length(name_head_normalized), entry_number_int`, ...RIJAL_API_SOURCES, wantedNormalized);
    await addTier(exact, "exact_name", 0);
  }
  if (results.length < limit) {
    const prefix = await db.all(
      `SELECT * FROM rijal_entry_ref WHERE source_key IN (${placeholders}) AND (name_head_normalized LIKE ? OR ? LIKE (name_head_normalized || '%')) AND name_head_normalized <> ? ORDER BY length(name_head_normalized), entry_number_int`,
      ...RIJAL_API_SOURCES,
      `${escapeLike(wantedNormalized)}%`,
      wantedNormalized,
      wantedNormalized,
    );
    await addTier(prefix, "name_prefix", 1);
  }
  if (results.length < limit) {
    const contains = await db.all(
      `SELECT * FROM rijal_entry_ref WHERE source_key IN (${placeholders}) AND name_head_normalized LIKE ? ORDER BY length(name_head_normalized), entry_number_int`,
      ...RIJAL_API_SOURCES,
      `%${escapeLike(wantedNormalized)}%`,
    );
    await addTier(contains, "name_contains", 2);
  }
  if (results.length < limit) {
    const phrase = `normalized_text: ${escapeFtsPhrase(wantedNormalized)}`;
    const mentions = await db.all(
      `SELECT r.* FROM rijal_entry_ref r
       JOIN rijal_search_doc d ON d.rijal_entry_id = r.id
       JOIN rijal_fts f ON f.rowid = d.id
       WHERE r.source_key IN (${placeholders}) AND rijal_fts MATCH ?
       ORDER BY length(r.name_head_normalized), r.entry_number_int`,
      ...RIJAL_API_SOURCES,
      phrase,
    );
    await addTier(mentions, "biography_mention", 3);
  }

  return results.slice(0, limit);
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function getIdentityCandidates(db, gate, dataVersion, query, limit) {
  const wanted = normalizeSearchText(query ?? "");
  if (!wanted) {
    return envelope({ query, items: [] }, [{ notice: "Leere Suchanfrage." }], { confidenceLevel: "unresolved", origin: "machine", dataVersion, resultCount: 0 });
  }
  const ranked = await rankRijalCandidates(db, wanted, limit);
  const items = ranked.map(({ row, matchKind }) => ({ ...gate.publicRijalFields(row, row.source_key), matchKind }));
  const references = cited(ranked.map(({ row }) => sourceReferenceForRijalRow(row)), "Keine Kandidaten für die angegebene Suche gefunden.");
  const [level, score] = aggregateMachineConfidence(ranked.map(({ row }) => row.parser?.confidence ?? null));
  return envelope({ query, items }, references, { confidenceLevel: level, confidenceScore: score, origin: "machine", dataVersion, resultCount: items.length });
}
