// Shared envelope helper for the Next.js prototype routes under app/api/**
// (narrators/search, narrators/[id], graph/subgraph, hadith-clusters/[id]/routes).
//
// These four routes serve build-time mock data from lib/mock-data.ts. With
// `output: "export"` (next.config.ts) every route handler here is frozen at
// build time (`dynamic = "force-static"`): none of them can call the real,
// source-bound research API at request time. Umsetzungsplan P3.2/P3.3
// replaces them with a Cloudflare Worker that serves the actual data; until
// that lands, every response from these routes is unambiguously marked as a
// transitional mock so nobody mistakes it for reviewed research data.
//
// Field shape matches the binding response contract used by the FastAPI
// backend (backend/app/repository.py envelope()): sourceReferences,
// confidenceLevel, confidenceScore, origin, reviewStatus, dataVersion,
// lastReviewedAt. Mock output is deliberately pinned to
// confidenceLevel/reviewStatus = "unresolved" and origin = "machine" --
// never "verified" -- because nothing here was ever assessed, let alone
// reviewed.

export const TRANSITIONAL_MOCK_NOTICE =
  "Übergangsattrappe: liefert statische Demonstrationsdaten aus lib/mock-data.ts, keine echten Forschungsdaten. Wird durch die Worker-API abgelöst (Umsetzungsplan P3.2/P3.3).";

export type TransitionalMockEnvelopeFields = {
  sourceReferences: Array<Record<string, unknown>>;
  confidenceLevel: "unresolved";
  confidenceScore: null;
  origin: "machine";
  reviewStatus: "unresolved";
  dataVersion: string;
  lastReviewedAt: null;
};

export function transitionalMockEnvelopeFields(
  sourceReferences: Array<Record<string, unknown>> = [],
): TransitionalMockEnvelopeFields {
  return {
    sourceReferences: sourceReferences.length ? sourceReferences : [{ notice: TRANSITIONAL_MOCK_NOTICE }],
    confidenceLevel: "unresolved",
    confidenceScore: null,
    origin: "machine",
    reviewStatus: "unresolved",
    dataVersion: "mock-0.1.0",
    lastReviewedAt: null,
  };
}
