/**
 * Kleine geteilte Hilfsfunktion gegen eine Klasse von Typabweichungen zur
 * FastAPI-Referenz: `database/schema.sql` modelliert Nummern-/Seitenfelder
 * (`hadith_record.primary_number`, `source_passage.page`,
 * `rijal_entry.entry_number`, `rijal_entry.printed_page`) bewusst als TEXT
 * (Agent 2 -- allgemein gueltig auch fuer nicht rein numerische
 * Editionsangaben). `backend/app/repository.py` liest dieselben Werte aber
 * direkt aus dem Importer-JSON, wo sie fuer den heutigen Turath-Korpus immer
 * als Zahl vorliegen (`hadithNumber: 1`, nicht `"1"`; geprueft an
 * .cache/turath-derived/{bukhari,tahdhib}.json) und ohne jede Konvertierung
 * durchgereicht werden. Ohne Rueckwandlung an der Antwortgrenze wuerde der
 * Worker "1" statt 1 ausliefern -- ein von JSON.stringify unterscheidbarer,
 * Vertrag-brechender Typ, keine kosmetische Nuance.
 * @param {unknown} value
 * @returns {number | null}
 */
export function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}
