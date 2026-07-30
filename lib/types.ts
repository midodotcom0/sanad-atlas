export type ViewKey = "hadith" | "narrator" | "network" | "compare" | "variants" | "library" | "sources" | "editor";

/**
 * Das einzige Statusvokabular des Projekts. Identisch in `database/schema.sql`
 * (ENUM `confidence_level`) und in `docs/05-ENTITY-RESOLUTION.md`.
 *
 * - `verified`   nur durch einen qualifizierten Editor, belegt und mit Zeitpunkt.
 *                Maschinelle Verarbeitung darf diese Stufe niemals setzen.
 * - `high`       Score >= 0,90, keine harten Konflikte. Bleibt ein Vorschlag.
 * - `medium`     Score 0,70 bis 0,89.
 * - `low`        Score < 0,70.
 * - `unresolved` kein tragfaehiger Kandidat.
 * - `conflict`   harte Gegenbelege oder konkurrierende starke Kandidaten.
 */
export type ConfidenceLevel = "verified" | "high" | "medium" | "low" | "unresolved" | "conflict";

/** Frueherer Name derselben Aufzaehlung. Bleibt als Alias erhalten. */
export type Confidence = ConfidenceLevel;

export const CONFIDENCE_LEVELS: readonly ConfidenceLevel[] = [
  "verified",
  "high",
  "medium",
  "low",
  "unresolved",
  "conflict",
] as const;

/** Verbindliche Schwellen. Aenderungen hier muessen im Schema-CHECK nachgezogen werden. */
export const CONFIDENCE_THRESHOLDS = { high: 0.9, medium: 0.7 } as const;

/** Arabische Beschriftung je Stufe. Einzige Quelle fuer alle Ansichten. */
export const CONFIDENCE_LABELS_AR: Record<ConfidenceLevel, string> = {
  verified: "هوية محققة",
  high: "احتمال قوي",
  medium: "تحتاج إلى مراجعة",
  low: "احتمال ضعيف",
  unresolved: "هوية غير محسومة",
  conflict: "تعارض في الهوية",
};

/**
 * Engere Teilmenge, die der noch vorhandene Mock-Bestand (`lib/mock-data.ts`)
 * verwendet. Dort existiert keine Erzaehlerposition, deshalb kann `unresolved`
 * nicht auftreten.
 *
 * @deprecated Faellt mit P5.5 weg. Sobald `components/atlas-shell.tsx:38-44`
 * `CONFIDENCE_LABELS_AR` importiert statt eine eigene Karte zu fuehren, wird
 * `Narrator.confidence` auf `ConfidenceLevel` verbreitert.
 */
export type LegacyNarratorConfidence = Exclude<ConfidenceLevel, "unresolved">;

/**
 * Leitet die Stufe aus einem maschinellen Score ab. Gibt niemals `verified`
 * zurueck: diese Stufe entsteht ausschliesslich durch eine redaktionelle
 * Entscheidung mit Quelle, Begruendung und Bearbeiter.
 */
export function confidenceLevelFromScore(score: number | null | undefined): ConfidenceLevel {
  if (score === null || score === undefined || Number.isNaN(score)) return "unresolved";
  if (score >= CONFIDENCE_THRESHOLDS.high) return "high";
  if (score >= CONFIDENCE_THRESHOLDS.medium) return "medium";
  return "low";
}

/** Prueft Stufe und Score gegen die Schwellen. Spiegelt den CHECK `*_level_threshold`. */
export function confidenceLevelMatchesScore(level: ConfidenceLevel, score: number | null | undefined): boolean {
  if (score === null || score === undefined) return true;
  if (level === "verified" || level === "unresolved" || level === "conflict") return true;
  return confidenceLevelFromScore(score) === level;
}

/** Woher der Wert kommt. `machine` kann `verified` nicht erreichen. */
export type Origin = "machine" | "editorial" | "registry";

/** Pruefstatus, identisch mit dem ENUM `review_status` im Schema. */
export type ReviewStatus = "machine_unreviewed" | "in_review" | "accepted" | "rejected" | "superseded";

/**
 * Evidenzklassen, strikt getrennt. Eine chronologische Moeglichkeit ist niemals
 * ein Beleg fuer Hoeren oder Ueberlieferung.
 */
export type EvidenceKind = "isnad_link" | "rijal_statement" | "chronology_only";

/** Eine Erzaehlerstelle ist immer positionsgebunden, niemals global. */
export interface ChainPosition {
  chainId: string;
  position: number;
  spanStart?: number | null;
  spanEnd?: number | null;
}

/** Kanonische Personen-ID: `SA-P-<base32(8)>` plus ganzzahlige Revision. */
export const STABLE_NARRATOR_ID_PATTERN = /^SA-P-[A-Z2-7]{8}$/;

export interface CanonicalNarratorId {
  stableKey: string;
  revision: number;
}

export function isStableNarratorId(value: string): boolean {
  return STABLE_NARRATOR_ID_PATTERN.test(value);
}

export interface SourceReference {
  sourcePassageId: string;
  work: string;
  edition?: string | null;
  volume?: string | null;
  page?: string | null;
  stableReference?: string | null;
  url?: string | null;
  rightsStatus?: string | null;
}

/**
 * Antwort-Huelle jeder fachlichen API-Antwort. Die Spalten liegen im Schema:
 *   sourceReferences <- source_passage plus evidence_link
 *   confidenceLevel  <- confidence_level bzw. identity_status
 *   confidenceScore  <- confidence_score (0..1, nur maschinell, sonst null)
 *   origin           <- origin
 *   reviewStatus     <- review_status
 *   dataVersion      <- data_version
 *   lastReviewedAt   <- reviewed_at
 */
export interface ResponseEnvelope<T> {
  data: T;
  sourceReferences: SourceReference[];
  confidenceLevel: ConfidenceLevel;
  confidenceScore: number | null;
  origin: Origin;
  reviewStatus: ReviewStatus;
  dataVersion: string;
  lastReviewedAt: string | null;
}

export interface Narrator {
  id: string;
  nameAr: string;
  shortAr: string;
  transliteration: string;
  role: "prophet" | "companion" | "tabii" | "later" | "compiler";
  tabaqa: string;
  birthAhMin?: number;
  birthAhMax?: number;
  deathAh?: number;
  region: string;
  confidence: LegacyNarratorConfidence;
  teachers: string[];
  students: string[];
  hadithCount: number;
  aliases?: string[];
}

export interface SourceAssertion {
  id: string;
  subjectId: string;
  scholar: string;
  phraseAr: string;
  normalized: string;
  work: string;
  volume: string;
  page: string;
  status: "reviewed" | "pending";
}

/**
 * Beleg eines einzelnen Kettenbeitrags zu einem Knoten oder einer Kante, die
 * mehrere gleiche Kettenabschnitte gestapelt darstellen (P5.6). Das Zusammenfassen
 * ist rein darstellend -- jede Kette bleibt hier mit ihrer eigenen Position und
 * ihren eigenen Offsets auffindbar, es geht kein Einzelbeleg verloren.
 */
export interface ChainContributor {
  chainOrder: number;
  chainId?: string;
  position: number;
  spanStart?: number | null;
  spanEnd?: number | null;
}

export interface GraphNode {
  data: {
    id: string;
    label: string;
    subtitle: string;
    kind: string;
    status: Confidence;
    collections?: string;
    /** Nur gesetzt, wenn dieser Knoten mehrere gemeinsame Kettenabschnitte buendelt. */
    contributors?: ChainContributor[];
  };
  position?: { x: number; y: number };
  classes?: string;
}

export interface GraphEdge {
  data: {
    id: string;
    source: string;
    target: string;
    verb: string;
    evidence: string;
    collection: string;
    count: number;
    chronologyStatus?: "possible" | "impossible" | "unknown";
    chronologyLabel?: string;
    variants?: string;
    /** Nur gesetzt, wenn diese Kante mehrere gemeinsame Kettenabschnitte buendelt (P5.6). */
    contributors?: ChainContributor[];
  };
  classes?: string;
}

export type DatePrecision = "exact" | "range" | "before" | "after" | "approximate";

export interface DateAssertion {
  id: string;
  narratorId: string;
  event: "birth" | "death";
  precision: DatePrecision;
  yearMin: number;
  yearMax: number;
  sourceKey: "ibn-hajar" | "al-dhahabi" | "other";
  sourceLabel: string;
  reference: string;
  reviewStatus: "reviewed" | "pending";
}
