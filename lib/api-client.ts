import type { ConfidenceLevel, ResponseEnvelope } from "./types";

/**
 * Client fuer die Forschungs-API. Der Antwortvertrag liegt in `lib/types.ts`
 * (`ResponseEnvelope`) und ist identisch mit `backend/app/repository.py`
 * `envelope()` und `docs/06-API-SPECIFICATION.yaml`. Dieses Modul definiert
 * kein eigenes Statusvokabular mehr: `confidenceLevel`, `origin` und
 * `reviewStatus` kommen ausschliesslich aus `lib/types.ts`.
 */

/** Official Shamela narrator registry plus legacy source keys for old databases. */
export type RijalSourceKey = "shamela" | "tahdhib" | "mizan" | "taqrib" | "kashif";

/**
 * Arabic labels shared by the library, identity candidates and source record.
 * New narrator search uses `shamela`; the remaining labels preserve backward
 * compatibility with previously built Atlas databases.
 */
export const RIJAL_SOURCE_NAMES_AR: Record<RijalSourceKey, string> = {
  shamela: "دليل رواة المكتبة الشاملة",
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
  /** Full lineage/name exactly as decoded from the Shamela source record. */
  longName?: string | null;
  /** Reine Namenskette ohne Kunya und Nisba, Grundlage des Blocking-Index. */
  nameChain?: string | null;
  kunya?: string | null;
  nisbas?: string[];
  region?: string | null;
  /** Generation, sofern die Quelle sie ausdruecklich nennt. */
  tabaqa?: string | null;
  /** Source metadata remains keyed by the Arabic field labels. */
  metadata?: Record<string, string[]>;
  residencePlaces?: string[];
  travelPlaces?: string[];
  relationNotes?: string | null;
  creedNote?: string | null;
  /** Separate source summaries; never collapsed into a single Atlas grade. */
  ibnHajarGrade?: string | null;
  alDhahabiGrade?: string | null;
  criticisms?: ApiRijalCriticism[];
  criticismsWithheld?: boolean;
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

export type ApiRijalCriticism = {
  criticName: string;
  sectionKind: "critic" | "hearing_evidence" | "disconnection" | "comparison" | "other";
  phrase: string | null;
  citedWork: string;
  citedVolume: string | null;
  citedPage: string | null;
  sourcePageId: number | null;
  sequenceNo: number;
  textWithheld?: boolean;
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

export type ApiNarratorOccurrenceSummary = {
  hadithId: string;
  collection: "bukhari" | "muslim";
  chainId: string;
  chainOrder: number;
  position: number;
  rawSurfaceForm: string;
  spanStart: number | null;
  spanEnd: number | null;
};

export type ApiNarratorProfile = {
  id: string;
  identityStatus: ConfidenceLevel;
  isRelativeReference: boolean;
  normalizedSurfaceForm: string;
  rawSurfaceForms: string[];
  occurrenceCount: number;
  occurrences: ApiNarratorOccurrenceSummary[];
  truncatedOccurrences: boolean;
  rijalCandidates: ApiRijalCandidate[];
  note: string | null;
};

export type ApiNarratorRelation = {
  relatedNarratorId: string;
  relationshipType: "transmitted_from" | "transmitted_to";
  evidenceKind: "isnad_link" | "rijal_statement" | "chronology_only";
  chainId: string;
  position: number;
  spanStart: number | null;
  spanEnd: number | null;
  hadithId: string;
};

export type ApiNarratorRelations = {
  narratorId: string;
  items: ApiNarratorRelation[];
  pageInfo: PageInfo;
  note?: string | null;
};

export type ApiTimelineAssertion = {
  event: "birth" | "death";
  precision: string;
  yearMin: number;
  yearMax: number;
  sourceWork: string;
  entryId: string;
  reviewStatus: string;
};

export type ApiNarratorTimeline = {
  narratorId: string;
  dateAssertions: ApiTimelineAssertion[];
  note: string | null;
};

export type ApiMeetingEvidence = {
  relatedNarratorId: string;
  relationshipType: "transmitted_from" | "transmitted_to";
  hadithId: string;
  collection: "bukhari" | "muslim";
  chainId: string;
  position: number;
};

export type ApiNarratorComparison = {
  narratorA: string;
  narratorB: string;
  chronology: "possible" | "impossible" | "insufficient";
  chronologyReason: string;
  meeting: "asserted_isnad" | "not_asserted";
  meetingEvidence: ApiMeetingEvidence[];
};

export type ApiChronologyComparison = {
  narratorA: string;
  narratorB: string;
  result: "possible" | "impossible" | "insufficient";
  reason: string;
  meetingIsProven: boolean;
};

export type ApiGraphPath = {
  startNodeId: string;
  maxDepth: number;
  direction: "transmitted_from" | "transmitted_to";
  nodes: { id: string }[];
  edges: Array<{
    source: string;
    target: string;
    relationshipType: "transmitted_from" | "transmitted_to";
    evidenceKind: "isnad_link";
    hadithId: string;
    chainOrder: number;
    depth: number;
  }>;
  truncated: boolean;
};

export type ApiSource = {
  key: string;
  title: string;
  author?: string;
  kind?: string;
  priority?: string;
  rightsStatus: string;
  publicDerivedFields?: string[];
  turathBookId?: number;
  url?: string;
  doi?: string;
  license?: string;
  importStatus?: string;
  scope?: string;
};

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
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json() as { detail?: unknown };
      if (typeof payload.detail === "string") detail = `: ${payload.detail}`;
    } catch {
      // Nicht-JSON-Fehler behalten den HTTP-Status als verlaessliche Aussage.
    }
    throw new Error(`API HTTP ${response.status}${detail}`);
  }
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

export function loadClusterRoutes(clusterId: string, collection?: "bukhari" | "muslim", signal?: AbortSignal) {
  const query = collection ? `?collection=${collection}` : "";
  return researchGet<ResponseEnvelope<Record<string, unknown>>>(`/api/v1/clusters/${encodeURIComponent(clusterId)}/routes${query}`, signal);
}

export function loadClusterMatnVariants(clusterId: string, signal?: AbortSignal) {
  return researchGet<ResponseEnvelope<Record<string, unknown>>>(`/api/v1/clusters/${encodeURIComponent(clusterId)}/matn-variants`, signal);
}

export function loadNarratorProfile(narratorId: string, signal?: AbortSignal) {
  return researchGet<ResponseEnvelope<ApiNarratorProfile>>(`/api/v1/narrators/${encodeURIComponent(narratorId)}`, signal);
}

export function loadNarratorRelations(narratorId: string, cursor?: string | null, limit = 100, signal?: AbortSignal) {
  const parameters = new URLSearchParams({ limit: String(Math.min(500, Math.max(1, limit))) });
  if (cursor) parameters.set("cursor", cursor);
  return researchGet<ResponseEnvelope<ApiNarratorRelations>>(`/api/v1/narrators/${encodeURIComponent(narratorId)}/relations?${parameters}`, signal);
}

export function loadNarratorTimeline(narratorId: string, signal?: AbortSignal) {
  return researchGet<ResponseEnvelope<ApiNarratorTimeline>>(`/api/v1/narrators/${encodeURIComponent(narratorId)}/timeline`, signal);
}

export function loadNarratorPaths(
  narratorId: string,
  options: { direction?: "transmitted_from" | "transmitted_to"; maxDepth?: number } = {},
  signal?: AbortSignal,
) {
  const parameters = new URLSearchParams({
    direction: options.direction ?? "transmitted_from",
    maxDepth: String(Math.min(8, Math.max(1, options.maxDepth ?? 3))),
  });
  return researchGet<ResponseEnvelope<ApiGraphPath>>(`/api/v1/narrators/${encodeURIComponent(narratorId)}/paths?${parameters}`, signal);
}

export function compareNarrators(a: string, b: string, signal?: AbortSignal) {
  const parameters = new URLSearchParams({ a, b });
  return researchGet<ResponseEnvelope<ApiNarratorComparison>>(`/api/v1/narrators/compare?${parameters}`, signal);
}

export function compareNarratorChronology(a: string, b: string, signal?: AbortSignal) {
  const parameters = new URLSearchParams({ a, b });
  return researchGet<ResponseEnvelope<ApiChronologyComparison>>(`/api/v1/chronology/compare?${parameters}`, signal);
}

export function loadSources(signal?: AbortSignal) {
  return researchGet<ResponseEnvelope<{ items: ApiSource[] }>>("/api/v1/sources", signal);
}

export function loadSource(sourceId: string, signal?: AbortSignal) {
  return researchGet<ResponseEnvelope<ApiSource>>(`/api/v1/sources/${encodeURIComponent(sourceId)}`, signal);
}
