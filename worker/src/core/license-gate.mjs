/**
 * Lizenz-Gate (Umsetzungsplan P2.4 / Befund B5), Worker-Seite.
 *
 * Byte-treuer Port der Gate-Logik aus `backend/app/repository.py`
 * (`_source_manifest_entry`, `allowed_derived_fields`, `rights_status_for`,
 * `full_text_cleared`, `TEXT_RIGHTS_CLEARED_STATUSES`, `public_record`,
 * `public_rijal_entry`). `data/sources/turath-manifest.json` bleibt die
 * einzige Quelle der Wahrheit fuer `publicDerivedFields` und `rightsStatus`
 * (Agent 1); dieses Modul liest sie nur, schreibt sie nie.
 *
 * Ein Worker, der dieses Gate umgeht, ist laut Auftrag unbrauchbar. Deshalb
 * ist die Gate-Pruefung hier die EINZIGE Stelle, an der Volltext (Isnad,
 * Matn, Lehrer-/Schuelerphrasen) in eine Antwort gelangen darf --
 * `queries/*.mjs` ruft ausschliesslich `publicRecordFields()` /
 * `publicRijalFields()` auf, nie die rohen Tabellenspalten direkt.
 *
 * Diese Datei ist bewusst frei von Node- oder Cloudflare-spezifischem Code
 * (kein `fs`, kein `env.ASSETS`): der Aufrufer (Adapter) laedt die
 * Registry und uebergibt sie an `createLicenseGate(registry)`.
 */

import { numOrNull } from "./util.mjs";

const TEXT_RIGHTS_CLEARED_STATUSES = new Set(["cleared", "public-domain", "editorially-cleared"]);

/** @param {any} registry geparster Inhalt von data/sources/turath-manifest.json */
export function createLicenseGate(registry) {
  const bySourceKey = new Map((registry.sources ?? []).map((source) => [source.key, source]));

  function sourceEntry(sourceKey) {
    return bySourceKey.get(sourceKey) ?? null;
  }

  function allowedDerivedFields(sourceKey) {
    const entry = sourceEntry(sourceKey);
    return new Set(entry?.publicDerivedFields ?? []);
  }

  function rightsStatusFor(sourceKey) {
    return sourceEntry(sourceKey)?.rightsStatus ?? "review-required";
  }

  function fullTextCleared(sourceKey) {
    return TEXT_RIGHTS_CLEARED_STATUSES.has(rightsStatusFor(sourceKey));
  }

  /**
   * Oeffentliche Feldauswahl eines hadith_record-Zeilenobjekts. Spiegelt
   * `CorpusRepository.public_record()` -- dieselben Allowlist-Labels
   * ("reference", "narrator_surface_forms", "isnad", "matn"), dieselbe
   * textWithheld-Regel (nur true, wenn BEIDE Textfelder freigegeben sind).
   * @param {Record<string, any>} row hadith_record-Zeile plus chainCount/narratorOccurrenceCount plus parser-Objekt
   * @param {string} sourceKey "bukhari" | "muslim"
   */
  function publicRecordFields(row, sourceKey) {
    const allowed = allowedDerivedFields(sourceKey);
    /** @type {Record<string, any>} */
    const item = { id: row.id, collection: row.collection };
    if (allowed.has("reference")) {
      Object.assign(item, {
        // primary_number/passage_page sind TEXT (database/schema.sql, Agent
        // 2 -- allgemeingueltig fuer nicht rein numerische Editionsangaben);
        // record["hadithNumber"]/record.get("printedPage") kommen in
        // backend/app/repository.py direkt aus dem Importer-JSON und sind
        // dort fuer den heutigen Korpus immer Zahlen (siehe util.mjs).
        hadithNumber: numOrNull(row.primary_number),
        routeNumber: row.route_number ?? null,
        book: row.book_heading ?? null,
        chapter: row.chapter_heading ?? null,
        // volume bleibt Text: die Quelle liefert bereits "1" als String
        // (kein Zahlentyp im Importer-JSON), passage_volume also unveraendert.
        volume: row.passage_volume ?? null,
        page: numOrNull(row.passage_page),
      });
    }
    if (allowed.has("narrator_surface_forms")) {
      // chainCount spiegelt backend/app/repository.py's
      // `len(chains) or routeMarkers`: der SQL-gezaehlte Wert faellt auf
      // route_markers zurueck, wenn ein Datensatz keine Isnad-Kette hat
      // (163 von 7291 Bukhari-Eintraegen, recordClass "structural-heading";
      // siehe atlas-build-lib.mjs). narratorOccurrenceCount braucht keinen
      // Fallback: empirisch geprueft deckungsgleich mit
      // len(narratorSurfaceForms) in jedem Fall, auch dem chain-losen.
      item.chainCount = row.chainCount || row.route_markers || 1;
      item.narratorOccurrenceCount = row.narratorOccurrenceCount ?? 0;
    }
    item.parser = row.parser;
    const includeIsnad = fullTextCleared(sourceKey) && allowed.has("isnad");
    const includeMatn = fullTextCleared(sourceKey) && allowed.has("matn");
    item.textWithheld = !(includeIsnad && includeMatn);
    if (includeIsnad) item.isnad = row.isnad ?? null;
    if (includeMatn) item.matn = row.matn ?? null;
    return item;
  }

  /**
   * Oeffentliche Feldauswahl eines rijal_entry-Zeilenobjekts. Spiegelt
   * `CorpusRepository.public_rijal_entry()`.
   * @param {Record<string, any>} row
   * @param {string} source "tahdhib" | "mizan" | "taqrib" | "kashif"
   */
  function publicRijalFields(row, source) {
    const allowed = allowedDerivedFields(source);
    const includeTeacherStudent = fullTextCleared(source) && allowed.has("teacher_student_phrases");
    return {
      id: row.id,
      source,
      // entry_number_int (integer) statt entry_number (text): siehe
      // util.mjs/numOrNull-Kommentar in publicRecordFields oben, hier fuer
      // rijal_entry.entry_number (database/schema.sql: "text NOT NULL",
      // Agent 2) vs. entry.get("entryNumber") in repository.py (immer int).
      entryNumber: allowed.has("entry_number") ? row.entry_number_int : null,
      nameSurface: allowed.has("name_surface") ? row.name_head_raw : null,
      deathYearCandidate: allowed.has("date_assertions") ? row.death_year_ah : null,
      teacherPhrase: includeTeacherStudent ? row.teacher_phrase : null,
      studentPhrase: includeTeacherStudent ? row.student_phrase : null,
      textWithheld: !includeTeacherStudent,
      volume: allowed.has("source_pointer") ? row.volume : null,
      page: allowed.has("source_pointer") ? numOrNull(row.printed_page) : null,
      parser: row.parser,
      identityStatus: "unresolved",
    };
  }

  /**
   * Oeffentliche Feldauswahl einer Lehrer-/Schueleraussage (P4.6).
   *
   * Die ABLEITUNG „X ist in Eintrag N als Lehrer von Y genannt" wird
   * veroeffentlicht, sobald die Quelle „teacher_student_phrases" in ihrer
   * Allowlist fuehrt -- der zugehoerige Fundstellenzeiger (entry_number,
   * volume, page, url) ist ueber „source_pointer"/"entry_number" ohnehin
   * freigegeben. Der WORTLAUT der Nennung ist Editionsprosa und faellt
   * zusaetzlich unter fullTextCleared(); heute ist jede registrierte Quelle
   * „review-required", `originalPhrase` bleibt also durchgaengig null und
   * `textWithheld` true. Genau dieselbe Zweiteilung wie bei
   * publicRijalFields() oben -- kein zweites Gate, keine Ausnahme.
   * @param {Record<string, any>} row Zeile aus relationship_assertion (rijal_statement)
   */
  function publicRijalStatementFields(row) {
    const source = row.source_key;
    const includePhrase = fullTextCleared(source) && allowedDerivedFields(source).has("teacher_student_phrases");
    return {
      rijalEntryId: row.rijal_entry_id,
      sourceWork: source,
      originalPhrase: includePhrase ? row.original_phrase : null,
      textWithheld: !includePhrase,
    };
  }

  return { sourceEntry, allowedDerivedFields, rightsStatusFor, fullTextCleared, publicRecordFields, publicRijalFields, publicRijalStatementFields };
}

export { TEXT_RIGHTS_CLEARED_STATUSES };
