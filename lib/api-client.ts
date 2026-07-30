import type { ConfidenceLevel, ResponseEnvelope } from "./types";

/**
 * Client fuer die Forschungs-API. Der Antwortvertrag liegt in `lib/types.ts`
 * (`ResponseEnvelope`) und ist identisch mit `backend/app/repository.py`
 * `envelope()` und `docs/06-API-SPECIFICATION.yaml`. Dieses Modul definiert
 * kein eigenes Statusvokabular mehr: `confidenceLevel`, `origin` und
 * `reviewStatus` kommen ausschliesslich aus `lib/types.ts`.
 */

/** Die vier registrierten Rijāl-Werke aus `data/sources/turath-manifest.json`. */
export type RijalSourceKey = "tahdhib" | "mizan" | "taqrib" | "kashif";

/**
 * Arabische Werktitel der Rijāl-Quellen. Einzige Beschriftungsquelle fuer
 * Bibliothek, Kandidatenliste und Einzelnachweis -- vorher gab es je Ansicht
 * eine eigene Karte, weshalb die vierte Quelle (al-Kāshif, 6.942 Eintraege)
 * nach ihrer Registrierung nirgends benannt war.
 */
export const RIJAL_SOURCE_NAMES_AR: Record<RijalSourceKey, string> = {
  tahdhib: "تهذيب التهذيب",
  mizan: "ميزان الاعتدال",
  taqrib: "تقريب التهذيب",
  kashif: "الكاشف في معرفة من له رواية في الكتب الستة",
};

export type ApiHadith = {
  id: string;
  collection: "bukhari" | "muslim";
  hadithNumber: number;
  routeNumber?: number;
  book?: string;
  chapter?: string;
  volume?: string | number;
  page?: string | number;
  isnad?: string;
  matn?: string;
  /**
   * Serverseitiges Lizenz-Gate: `true`, sobald die Rechtepruefung der Edition
   * die Volltextfelder zurueckhaelt (`backend/app/repository.py`
   * `public_record`). Das Frontend darf fehlenden Volltext dann nicht als
   * Datenfehler darstellen, sondern muss den Rechtegrund nennen.
   */
  textWithheld?: boolean;
  chainCount: number;
  narratorOccurrenceCount: number;
  parser: { confidence: number; state: string; reviewStatus: string };
};

export type PageInfo = { nextCursor: string | null; hasNextPage: boolean };

type HadithEnvelope = ResponseEnvelope<{ items: ApiHadith[]; pageInfo: PageInfo }>;

export type ApiRijalEntry = {
  id: string;
  source: RijalSourceKey;
  entryNumber: number;
  /** Namenskopf der Uebersetzung, seit dem Rijāl-Reparse kein Textanfang mehr. */
  nameSurface: string;
  /** Reine Namenskette ohne Kunya und Nisba, Grundlage des Blocking-Index. */
  nameChain?: string | null;
  kunya?: string | null;
  nisbas?: string[];
  region?: string | null;
  /** Generation, sofern die Quelle sie ausdruecklich nennt. */
  tabaqa?: string | null;
  deathYearCandidate: number | null;
  /**
   * Alle Datierungsangaben der Uebersetzung, jede mit Verb, Rohphrase und
   * Textoffset. Widerspruechliche Angaben bleiben nebeneinander stehen; es wird
   * nicht gemittelt und kein Geburtsjahr aus einem Todesjahr geschaetzt.
   */
  dateAssertions?: ApiRijalDateAssertion[];
  /** Lebensalter, nur wenn die Quelle es ausdruecklich nennt. */
  ageAtDeath?: number | null;
  teacherPhrase: string | null;
  studentPhrase: string | null;
  /** Einzeln zerlegte Lehrernennungen der Phrase. Jede bleibt ein Kandidat. */
  teacherMentions?: string[];
  /** Einzeln zerlegte Schuelernennungen der Phrase. Jede bleibt ein Kandidat. */
  studentMentions?: string[];
  volume?: string | number;
  page?: string | number;
  /** Siehe `ApiHadith.textWithheld`. */
  textWithheld?: boolean;
  /**
   * Stand der Identitaetsauflaesung im gemeinsamen Vokabular. Ein importierter
   * Quelleneintrag ist per se `unresolved`: er ist ein Beleg, keine Person.
   */
  identityStatus: ConfidenceLevel;
  parser: { confidence: number; reviewStatus: string };
};

export type ApiRijalDateAssertion = {
  kind: "birth" | "death" | string;
  verb: string | null;
  qualifier: string | null;
  valueAh: number | null;
  approximate: boolean;
  rawPhrase: string | null;
  textOffset: number | null;
  /** Immer `rijal_statement` fuer diese Herkunft, nie `chronology_only`. */
  evidenceClass: string;
  confidence: number | null;
  reviewStatus: string;
};

export type ApiRijalCandidate = ApiRijalEntry & {
  matchKind: "exact_name" | "name_prefix" | "name_contains" | "biography_mention";
};

/**
 * Eine Erzaehlerstelle in einer Kette. Positionsgebunden, niemals global:
 * `chainId`/`position` plus `spanStart`/`spanEnd` machen sie auf den Rohtext
 * zurueckschneidbar (Abnahmekriterium "positionsgenau zum Rohtext").
 */
export type ApiNarratorOccurrence = {
  position: number;
  rawSurfaceForm: string;
  normalizedSurfaceForm: string;
  /** Zeichenoffsets im Rohtext des Datensatzes. */
  spanStart?: number | null;
  spanEnd?: number | null;
  /** Ueberlieferungsbegriff der Stelle (`عن`, `حدثنا`, `اخبرني` …). */
  transmissionTerm?: string | null;
  /**
   * Relative Namensform wie `ابيه` oder `عمه`. Solche Stellen duerfen niemals
   * global aufgeloest werden; ihre Identitaet haengt allein an
   * `(chainId, position)` und dem vorhergehenden Erzaehler.
   */
  relativeForm?: boolean;
  /**
   * Der Importer markiert Prophetennennungen ausdruecklich. Ersetzt das
   * frueher im Frontend gerechnete `rawSurfaceForm.includes("رسول الله")`,
   * das seit der Rohformerhaltung an den Diakritika scheitert.
   */
  prophetMention?: boolean;
  identityStatus: ConfidenceLevel;
};

export type ApiIsnadChain = {
  chainOrder: number;
  chainId?: string;
  rawIsnad: string;
  spanStart?: number | null;
  spanEnd?: number | null;
  narratorOccurrences: ApiNarratorOccurrence[];
};

export type HadithGraphPayload = {
  hadith: ApiHadith;
  chains: ApiIsnadChain[];
  sourceReferences: ResponseEnvelope<unknown>["sourceReferences"];
  dataVersion: string;
  confidenceLevel: ConfidenceLevel;
  reviewStatus: ResponseEnvelope<unknown>["reviewStatus"];
};

type RijalEnvelope = ResponseEnvelope<{ items: ApiRijalEntry[]; pageInfo: PageInfo }>;

const configuredBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";

export function researchApiAvailable() {
  return Boolean(configuredBase);
}

export async function searchHadiths(collection: "bukhari" | "muslim", query: string, cursor?: string | null, signal?: AbortSignal) {
  if (!configuredBase) throw new Error("NEXT_PUBLIC_API_URL is not configured");
  const parameters = new URLSearchParams({ collection, q: query, limit: "40" });
  if (cursor) parameters.set("cursor", cursor);
  const response = await fetch(`${configuredBase}/api/v1/hadiths?${parameters}`, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`API HTTP ${response.status}`);
  return response.json() as Promise<HadithEnvelope>;
}

export async function searchRijal(source: RijalSourceKey, query: string, cursor?: string | null, signal?: AbortSignal) {
  if (!configuredBase) throw new Error("NEXT_PUBLIC_API_URL is not configured");
  const parameters = new URLSearchParams({ source, q: query, limit: "40" });
  if (cursor) parameters.set("cursor", cursor);
  const response = await fetch(`${configuredBase}/api/v1/rijal?${parameters}`, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`API HTTP ${response.status}`);
  return response.json() as Promise<RijalEnvelope>;
}

export async function searchRijalCandidates(query: string, signal?: AbortSignal) {
  const parameters = new URLSearchParams({ q: query, limit: "24" });
  return researchGet<ResponseEnvelope<{ query: string; items: ApiRijalCandidate[] }>>(`/api/v1/identity-candidates?${parameters}`, signal);
}

export async function loadRijalEntry(entryId: string, signal?: AbortSignal) {
  return researchGet<ResponseEnvelope<ApiRijalEntry>>(`/api/v1/rijal/${encodeURIComponent(entryId)}`, signal);
}

async function researchGet<T>(path: string, signal?: AbortSignal) {
  if (!configuredBase) throw new Error("NEXT_PUBLIC_API_URL is not configured");
  const response = await fetch(`${configuredBase}${path}`, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`API HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export async function loadHadithGraph(recordId: string, signal?: AbortSignal): Promise<HadithGraphPayload> {
  const encoded = encodeURIComponent(recordId);
  const [record, chains] = await Promise.all([
    researchGet<ResponseEnvelope<ApiHadith>>(`/api/v1/hadiths/${encoded}`, signal),
    researchGet<ResponseEnvelope<{ hadithId: string; items: ApiIsnadChain[] }>>(`/api/v1/hadiths/${encoded}/chains`, signal),
  ]);
  return {
    hadith: record.data,
    chains: chains.data.items,
    sourceReferences: record.sourceReferences,
    dataVersion: record.dataVersion,
    confidenceLevel: record.confidenceLevel,
    reviewStatus: record.reviewStatus,
  };
}
