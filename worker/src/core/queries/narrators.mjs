/**
 * Erzaehler-Endpunkte. Port von `backend/app/repository.py`
 * (`narrator_profile`, `narrator_relations`, `narrator_timeline`,
 * `_date_assertions_for`, `_lifespan_bounds`, `_chronology_verdict`,
 * `_meeting_evidence`, `compare_narrators`, `compare_chronology`).
 *
 * Python haelt einen In-Memory-"occurrence index" (Buckets nach `bucket_id`,
 * mit Nachbarliste). Der Worker ersetzt das durch die beim Bau materialisierte
 * `edge_projection` (worker/../scripts/atlas-build-lib.mjs) plus direkte
 * Abfragen auf `narrator_occurrence.node_id` -- dieselbe ID-Vergabe
 * (`scripts/atlas-id-scheme.mjs`, bitgleich zu `bucket_id()`), also
 * dieselben IDs, nur aus der Datenbank statt aus einem Python-Prozessspeicher.
 *
 * `rijal_search_index()`/`_rank_rijal()` in Python iterieren nur
 * (tahdhib, mizan, taqrib) -- siehe rijal.mjs. Timeline/Chronologie hier
 * ebenso, fuer Vertragstreue.
 */

import { encodeCursor, decodeCursor } from "../cursor.mjs";
import { envelope, cited, aggregateMachineConfidence } from "../envelope.mjs";
import { rankRijalCandidates, sourceReferenceForRijalRow, RIJAL_API_SOURCES } from "./rijal.mjs";
import { sourceReferenceForHadithRow } from "./hadiths.mjs";

const RELATIVE_ID_PREFIX = "UNC-REL-";

/**
 * Laedt hadith_record_ref-Zeilen zu einer Menge von IDs und gibt sie als Map
 * zurueck -- das SQL-Pendant zu backend/app/repository.py's
 * `_hadith_index()["by_id"]`.
 *
 * WICHTIG fuer die Feldgleichheit (P3.2): die Referenz baut ihre
 * `sourceReferences` NICHT aus dieser Map-Iteration, sondern durch Nachschlagen
 * je Ergebniszeile -- also in der Reihenfolge der Fachzeilen und MIT
 * Wiederholungen, wenn zwei Zeilen denselben Hadith belegen (repository.py:
 * `window_records.append(record)` je Nachbar, `[... for m in meeting_evidence]`).
 * Ein `SELECT ... WHERE id IN (...)` liefert stattdessen jede Zeile genau
 * einmal und in Tabellenreihenfolge. Deshalb wird hier nur nachgeschlagen; die
 * Reihenfolge macht immer der jeweilige Aufrufer.
 * @returns {Promise<Map<string, any>>}
 */
async function fetchHadithRefsById(db, ids) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const placeholders = unique.map(() => "?").join(",");
  const rows = await db.all(`SELECT * FROM hadith_record_ref WHERE id IN (${placeholders})`, ...unique);
  return new Map(rows.map((row) => [row.id, row]));
}

async function fetchOccurrencesForNode(db, nodeId) {
  return db.all(
    `SELECT o.raw_surface_form, o.normalized_surface_form, o.position, o.span_start, o.span_end,
            c.id AS chain_id, c.chain_order, c.hadith_record_id, h.collection
     FROM narrator_occurrence o
     JOIN isnad_chain c ON c.id = o.chain_id
     JOIN hadith_record h ON h.id = c.hadith_record_id
     WHERE o.node_id = ?
     ORDER BY h.rowid, c.chain_order, o.position`,
    nodeId,
  );
}

export async function getNarratorProfile(db, gate, dataVersion, narratorId) {
  const occurrences = await fetchOccurrencesForNode(db, narratorId);
  if (occurrences.length === 0) return null;

  const isRelative = narratorId.startsWith(RELATIVE_ID_PREFIX);
  const normalizedSurfaceForm = occurrences[0].normalized_surface_form;
  const rawSurfaceForms = [...new Set(occurrences.map((o) => o.raw_surface_form))].sort();
  const previewLimit = 50;
  const preview = occurrences.slice(0, previewLimit).map((o) => ({
    hadithId: o.hadith_record_id,
    collection: o.collection,
    // Bytegleich zu repository.py's _narrator_occurrence_index():
    // f"{record_id}#{chainOrder}" -- ein BERECHNETER String, NICHT
    // isnad_chain.id (das den Importer-eigenen "#c<n>"-Suffix traegt, siehe
    // Moduldoc oben). chains()/routes() verwenden wiederum andere Formen;
    // das ist eine echte Eigenart der Referenzimplementierung, hier bewusst
    // repliziert statt vereinheitlicht.
    chainId: `${o.hadith_record_id}#${o.chain_order}`,
    chainOrder: o.chain_order,
    position: o.position,
    rawSurfaceForm: o.raw_surface_form,
    spanStart: o.span_start,
    spanEnd: o.span_end,
  }));

  const rijalMatches = isRelative ? [] : await rankRijalCandidates(db, normalizedSurfaceForm, 10);
  const note = isRelative
    ? "Positionsgebundene Rückverweisform (z. B. أبيه); wird nie mit anderen Vorkommen global zusammengeführt."
    : "Unaufgelöstes, quellengebundenes Namenscluster -- kein bestätigtes kanonisches Personenprofil (siehe docs/05-ENTITY-RESOLUTION.md, Umsetzungsplan P4.5).";

  const data = {
    id: narratorId,
    identityStatus: "unresolved",
    isRelativeReference: isRelative,
    normalizedSurfaceForm,
    rawSurfaceForms,
    occurrenceCount: occurrences.length,
    occurrences: preview,
    truncatedOccurrences: occurrences.length > previewLimit,
    rijalCandidates: rijalMatches.map(({ row, matchKind }) => ({ ...gate.publicRijalFields(row, row.source_key), matchKind })),
    note,
  };

  // repository.py:717-718: `hadith_ids = sorted({...})`, dann `[by_id[hid] for
  // hid in hadith_ids if hid in by_id]` -- lexikografisch nach ID sortiert und
  // dedupliziert, NICHT in Tabellenreihenfolge (die bei den heutigen IDs
  // abweicht: "bukhari-10-..." steht lexikografisch vor "bukhari-2-...",
  // in der Tabelle aber dahinter).
  const hadithIds = [...new Set(occurrences.map((o) => o.hadith_record_id))].sort();
  const byId = await fetchHadithRefsById(db, hadithIds);
  const records = hadithIds.filter((hid) => byId.has(hid)).map((hid) => byId.get(hid));
  const references = cited(records.map(sourceReferenceForHadithRow), "Keine Hadith-Quellenbelege für dieses Namenscluster auflösbar.");
  return envelope(data, references, { confidenceLevel: "unresolved", confidenceScore: null, origin: "machine", dataVersion });
}

export async function getNarratorRelations(db, gate, dataVersion, narratorId, { cursor, limit }) {
  // Bytegleich zu repository.py's narrator_relations(): die Fallunterscheidung
  // ist "bucket is None" (id hat UEBERHAUPT KEIN Vorkommen im Korpus), nicht
  // "0 Nachbarn" -- ein Knoten kann Vorkommen, aber keine Nachbarn haben
  // (z. B. eine Kette der Laenge 1). Nur der echte None-Fall bekommt die
  // "nicht aufloesbar"-Meldung UND hat absichtlich KEIN "note"-Feld im
  // data-Objekt (anders als der gefundene, aber nachbarlose Fall unten).
  const occurrences = await fetchOccurrencesForNode(db, narratorId);
  if (occurrences.length === 0) {
    return envelope(
      { narratorId, items: [], pageInfo: { nextCursor: null, hasNextPage: false } },
      cited([], "narrator_id nicht in der aktuellen Vorkommens-Datenbasis auflösbar."),
      { confidenceLevel: "unresolved", origin: "machine", dataVersion },
    );
  }

  const offset = decodeCursor(cursor);
  const rows = await db.all(
    `SELECT target_node_id, relationship_type, hadith_record_id, chain_order, source_position, target_position, collection
     FROM edge_projection WHERE source_node_id = ? ORDER BY rowid LIMIT ? OFFSET ?`,
    narratorId,
    limit + 1,
    offset,
  );
  const hasMore = rows.length > limit;
  const window = rows.slice(0, limit);

  const items = window.map((row) => ({
    relatedNarratorId: row.target_node_id,
    relationshipType: row.relationship_type,
    evidenceKind: "isnad_link",
    chainId: `${row.hadith_record_id}#${row.chain_order}`,
    position: neighborPosition(row),
    spanStart: null,
    spanEnd: null,
    hadithId: row.hadith_record_id,
  }));

  // repository.py:765-779 fuehrt `window_records` je NACHBAR, nicht je Hadith:
  // belegt ein Datensatz zwei Nachbarschaftskanten desselben Knotens (in der
  // Praxis der Regelfall -- Vorgaenger und Nachfolger in derselben Kette, oder
  // mehrere Ketten eines Datensatzes), erscheint seine Quellenangabe genau so
  // oft in `sourceReferences`, und zwar in Nachbar-Reihenfolge. Ein
  // deduplizierendes `WHERE id IN (...)` lieferte hier sowohl zu wenige
  // Einträge als auch die falsche Reihenfolge (Tabellen- statt Kantenfolge) --
  // das war die Ursache der abweichenden hadithNumber/page-Werte im
  // Contract-Test, nicht ein kosmetischer Unterschied.
  const byId = await fetchHadithRefsById(db, window.map((row) => row.hadith_record_id));
  const windowRecords = window.map((row) => byId.get(row.hadith_record_id)).filter((row) => row !== undefined);
  const [level, score] = aggregateMachineConfidence(windowRecords.map((r) => JSON.parse(r.parser_json ?? "{}")?.confidence ?? null));

  const isRelative = narratorId.startsWith(RELATIVE_ID_PREFIX);
  let note = items.length ? null : "Keine Isnād-Nachbarschaft für dieses Vorkommen gefunden.";
  if (!isRelative) {
    const rijalNote = "Lehrer-/Schüler-Aussagen aus den Rijāl-Werken (rijal_statement) sind noch nicht personenscharf geparst und werden hier deshalb nicht als einzelne Relationen ausgegeben (Umsetzungsplan P4.6).";
    note = note ? `${note} ${rijalNote}` : rijalNote;
  }

  return envelope(
    { narratorId, items, pageInfo: { nextCursor: hasMore ? encodeCursor(offset + limit) : null, hasNextPage: hasMore }, note },
    cited(windowRecords.map(sourceReferenceForHadithRow), "Keine Isnād-Nachbarschaft für dieses Vorkommen gefunden."),
    { confidenceLevel: level, confidenceScore: score, origin: "machine", dataVersion },
  );
}

async function dateAssertionsFor(db, narratorId, normalizedSurfaceForm) {
  if (narratorId.startsWith(RELATIVE_ID_PREFIX)) return { assertions: [], references: [], scores: [] };
  const placeholders = RIJAL_API_SOURCES.map(() => "?").join(",");
  const rows = await db.all(`SELECT * FROM rijal_entry_ref WHERE source_key IN (${placeholders}) AND name_head_normalized = ?`, ...RIJAL_API_SOURCES, normalizedSurfaceForm);
  const assertions = [];
  const references = [];
  const scores = [];
  for (const row of rows) {
    const death = row.death_year_ah;
    const birth = row.birth_year_ah;
    if (death === null && birth === null) continue;
    if (Number.isInteger(death)) assertions.push({ event: "death", precision: "unknown", yearMin: death, yearMax: death, sourceWork: row.source_key, entryId: row.id, reviewStatus: "unresolved" });
    if (Number.isInteger(birth)) assertions.push({ event: "birth", precision: "unknown", yearMin: birth, yearMax: birth, sourceWork: row.source_key, entryId: row.id, reviewStatus: "unresolved" });
    references.push(sourceReferenceForRijalRow(row));
    scores.push(JSON.parse(row.parser_json ?? "{}")?.confidence ?? null);
  }
  return { assertions, references, scores };
}

export async function getNarratorTimeline(db, gate, dataVersion, narratorId) {
  const occurrences = await fetchOccurrencesForNode(db, narratorId);
  if (occurrences.length === 0) return null;
  const { assertions, references, scores } = await dateAssertionsFor(db, narratorId, occurrences[0].normalized_surface_form);
  const [level, score] = aggregateMachineConfidence(scores);
  // Wortgleich zur Referenz (backend/app/repository.py). Die frueher hier
  // stehende Bestandszahl ("27.105 Einträge") ist auf beiden Seiten entfernt:
  // sie war beim naechsten Import zwangslaeufig falsch -- inzwischen sind es
  // 34.045 Eintraege -- und eine fachliche Groesse gehoert nicht als Konstante
  // in einen Antworttext. Braucht eine Ansicht sie, kommt sie aus den Daten.
  const note = assertions.length
    ? null
    : "Keine Todes- oder Geburtsjahresangabe für dieses Namenscluster in den importierten Rijāl-Werken gefunden.";
  return envelope({ narratorId, dateAssertions: assertions, note }, cited(references, note ?? "Keine Datierungsangaben gefunden."), {
    confidenceLevel: level,
    confidenceScore: score,
    origin: "machine",
    dataVersion,
  });
}

async function lifespanBounds(db, narratorId) {
  if (narratorId.startsWith(RELATIVE_ID_PREFIX)) return null;
  const occurrences = await fetchOccurrencesForNode(db, narratorId);
  if (occurrences.length === 0) return null;
  const placeholders = RIJAL_API_SOURCES.map(() => "?").join(",");
  const rows = await db.all(`SELECT death_year_ah, birth_year_ah FROM rijal_entry_ref WHERE source_key IN (${placeholders}) AND name_head_normalized = ?`, ...RIJAL_API_SOURCES, occurrences[0].normalized_surface_form);
  const deathYears = [...new Set(rows.map((r) => r.death_year_ah).filter(Number.isInteger))].sort((a, b) => a - b);
  const birthYears = [...new Set(rows.map((r) => r.birth_year_ah).filter(Number.isInteger))].sort((a, b) => a - b);
  return { deathYears, birthYears };
}

async function chronologyVerdict(db, aId, bId) {
  const [boundsA, boundsB] = await Promise.all([lifespanBounds(db, aId), lifespanBounds(db, bId)]);
  if (!boundsA || !boundsB) return ["insufficient", "Mindestens eine narrator_id ist unbekannt oder eine positionsgebundene Rückverweisform ohne eigene Datierung."];
  if (!(boundsA.birthYears.length || boundsA.deathYears.length) || !(boundsB.birthYears.length || boundsB.deathYears.length)) {
    return ["insufficient", "Für mindestens eine Person liegt weder ein Geburts- noch ein Todesjahr in der aktuellen Datenbasis vor."];
  }
  if (boundsA.birthYears.length && boundsB.deathYears.length && Math.min(...boundsA.birthYears) > Math.max(...boundsB.deathYears)) {
    return ["impossible", `A ist frühestens ${Math.min(...boundsA.birthYears)} AH belegt geboren, B ist spätestens ${Math.max(...boundsB.deathYears)} AH belegt gestorben.`];
  }
  if (boundsB.birthYears.length && boundsA.deathYears.length && Math.min(...boundsB.birthYears) > Math.max(...boundsA.deathYears)) {
    return ["impossible", `B ist frühestens ${Math.min(...boundsB.birthYears)} AH belegt geboren, A ist spätestens ${Math.max(...boundsA.deathYears)} AH belegt gestorben.`];
  }
  if (!boundsA.birthYears.length || !boundsB.birthYears.length) {
    return ["insufficient", "Kein Geburtsjahr für mindestens eine Person belegt; ein fehlendes Geburtsjahr wird nicht aus einem Todesjahr geschätzt."];
  }
  return ["possible", "Belegte Zeitspannen widersprechen sich nicht. Das ist kein Beleg für eine tatsächliche Begegnung oder Überlieferung."];
}

async function meetingEvidence(db, aId, bId) {
  // ORDER BY id (= rowid) explizit: repository.py's _meeting_evidence()
  // filtert die in Korpusreihenfolge aufgebaute neighbors-Liste, behaelt deren
  // Reihenfolge also bei. edge_projection ist in genau dieser Reihenfolge
  // befuellt (scripts/atlas-build-lib.mjs, ORDER BY h.rowid, chain_order,
  // position), aber ohne ORDER BY darf SQLite die Zeilen in Indexreihenfolge
  // liefern -- hier steht die Sortierung deshalb ausdruecklich im SQL.
  return db.all("SELECT * FROM edge_projection WHERE source_node_id = ? AND target_node_id = ? ORDER BY id", aId, bId);
}

/**
 * Bildet die Nachbarschaftszeile auf das Feldbild von repository.py's
 * neighbors-Eintrag ab (_narrator_occurrence_index():380-389). Wird von
 * meetingEvidence-Konsumenten UND getNarratorRelations() gebraucht, damit
 * beide dieselbe Ableitung benutzen.
 *
 * `position` ist in der Referenz der Index des KETTENPAARS, nicht die Position
 * dieses Knotens: fuer 'transmitted_from' (dieser Knoten ist das
 * kompilatornaehere Glied) ist das source_position, fuer 'transmitted_to'
 * target_position.
 */
function neighborPosition(row) {
  return row.relationship_type === "transmitted_from" ? row.source_position : row.target_position;
}

export async function compareNarrators(db, gate, dataVersion, a, b) {
  const [chronology, reason] = await chronologyVerdict(db, a, b);
  const evidence = await meetingEvidence(db, a, b);
  // Eine Quellenangabe JE BELEG in Belegreihenfolge, mit Wiederholungen --
  // repository.py:890 `[... for m in meeting_evidence if m["hadithId"] in by_id]`.
  const byId = await fetchHadithRefsById(db, evidence.map((e) => e.hadith_record_id));
  const records = evidence.map((e) => byId.get(e.hadith_record_id)).filter((row) => row !== undefined);
  const references = cited(records.map(sourceReferenceForHadithRow), reason);
  const data = {
    narratorA: a,
    narratorB: b,
    chronology,
    chronologyReason: reason,
    meeting: evidence.length ? "asserted_isnad" : "not_asserted",
    // Feldbild wie der neighbors-Eintrag der Referenz: relatedNarratorId,
    // relationshipType, hadithId, collection, chainId, position. `chainId` ist
    // der BERECHNETE Kurzstring f"{hadithId}#{chainOrder}", nicht
    // isnad_chain.id (das den Importer-Suffix "#c<n>" traegt) -- siehe
    // Moduldoc oben und edge_projection.chain_order in atlas-build-lib.mjs.
    meetingEvidence: evidence.map((e) => ({
      relatedNarratorId: e.target_node_id,
      relationshipType: e.relationship_type,
      hadithId: e.hadith_record_id,
      collection: e.collection,
      chainId: `${e.hadith_record_id}#${e.chain_order}`,
      position: neighborPosition(e),
    })),
  };
  const level = chronology !== "insufficient" || evidence.length ? "high" : "unresolved";
  return envelope(data, references, { confidenceLevel: level, confidenceScore: null, origin: "machine", dataVersion });
}

export async function compareChronology(db, gate, dataVersion, a, b) {
  const [result, reason] = await chronologyVerdict(db, a, b);
  const evidence = await meetingEvidence(db, a, b);
  const byId = await fetchHadithRefsById(db, evidence.map((e) => e.hadith_record_id));
  const records = evidence.map((e) => byId.get(e.hadith_record_id)).filter((row) => row !== undefined);
  const references = cited(records.map(sourceReferenceForHadithRow), reason);
  const data = { narratorA: a, narratorB: b, result, reason, meetingIsProven: evidence.length > 0 };
  const level = result === "insufficient" ? "unresolved" : "high";
  return envelope(data, references, { confidenceLevel: level, confidenceScore: null, origin: "machine", dataVersion });
}
