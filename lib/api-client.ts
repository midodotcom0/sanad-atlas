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
  chainCount: number;
  narratorOccurrenceCount: number;
  parser: { confidence: number; state: string; reviewStatus: string };
};

export type PageInfo = { nextCursor: string | null; hasNextPage: boolean };

export type ResearchEnvelope<T> = {
  data: T;
  sourceReferences: Array<Record<string, unknown>>;
  confidence: string;
  reviewStatus: string;
  dataVersion: string;
  lastReviewedAt: string | null;
};

type HadithEnvelope = ResearchEnvelope<{ items: ApiHadith[]; pageInfo: PageInfo }>;

export type ApiRijalEntry = {
  id: string;
  source: "tahdhib" | "mizan" | "taqrib";
  entryNumber: number;
  nameSurface: string;
  deathYearCandidate: number | null;
  teacherPhrase: string | null;
  studentPhrase: string | null;
  volume?: string | number;
  page?: string | number;
  identityStatus: "unresolved";
  parser: { confidence: number; reviewStatus: string };
};

export type ApiRijalCandidate = ApiRijalEntry & {
  matchKind: "exact_name" | "name_prefix" | "name_contains" | "biography_mention";
};

export type ApiNarratorOccurrence = {
  position: number;
  rawSurfaceForm: string;
  normalizedSurfaceForm: string;
  identityStatus: string;
};

export type ApiIsnadChain = {
  chainOrder: number;
  rawIsnad: string;
  narratorOccurrences: ApiNarratorOccurrence[];
};

export type HadithGraphPayload = {
  hadith: ApiHadith;
  chains: ApiIsnadChain[];
  sourceReferences: Array<Record<string, unknown>>;
  dataVersion: string;
};

type RijalEnvelope = ResearchEnvelope<{ items: ApiRijalEntry[]; pageInfo: PageInfo }>;

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

export async function searchRijal(source: ApiRijalEntry["source"], query: string, cursor?: string | null, signal?: AbortSignal) {
  if (!configuredBase) throw new Error("NEXT_PUBLIC_API_URL is not configured");
  const parameters = new URLSearchParams({ source, q: query, limit: "40" });
  if (cursor) parameters.set("cursor", cursor);
  const response = await fetch(`${configuredBase}/api/v1/rijal?${parameters}`, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`API HTTP ${response.status}`);
  return response.json() as Promise<RijalEnvelope>;
}

export async function searchRijalCandidates(query: string, signal?: AbortSignal) {
  const parameters = new URLSearchParams({ q: query, limit: "24" });
  return researchGet<ResearchEnvelope<{ query: string; items: ApiRijalCandidate[] }>>(`/api/v1/identity-candidates?${parameters}`, signal);
}

export async function loadRijalEntry(entryId: string, signal?: AbortSignal) {
  return researchGet<ResearchEnvelope<ApiRijalEntry>>(`/api/v1/rijal/${encodeURIComponent(entryId)}`, signal);
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
    researchGet<ResearchEnvelope<ApiHadith>>(`/api/v1/hadiths/${encoded}`, signal),
    researchGet<ResearchEnvelope<{ hadithId: string; items: ApiIsnadChain[] }>>(`/api/v1/hadiths/${encoded}/chains`, signal),
  ]);
  return { hadith: record.data, chains: chains.data.items, sourceReferences: record.sourceReferences, dataVersion: record.dataVersion };
}
