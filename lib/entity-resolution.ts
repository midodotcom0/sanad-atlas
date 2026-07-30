/**
 * Mehrsignal-Scoring der Identitaetsaufloesung (Umsetzungsplan P4.2 und P4.3).
 *
 * Verbindliche Spezifikation ist die Tabelle in `docs/05-ENTITY-RESOLUTION.md`,
 * Abschnitt 3. Die Gewichte selbst stehen NICHT hier, sondern in
 * `config/er-weights.v1.json`; jedes Ergebnis nennt die Profilversion, die es
 * erzeugt hat (`weightProfileVersion` — dieselbe Spalte fuehrt
 * `identity_candidate.weight_profile_version`, `database/schema.sql:690`).
 *
 * ## Was sich gegenueber dem Vorzustand geaendert hat
 *
 * | Signal (docs/05)              | vorher | jetzt |
 * |---|---:|---:|
 * | kanonische Namensaehnlichkeit  | 0,52 (exakt) / 0,30 (teilweise) | 0,22, anteilig |
 * | bekannte Namensvariante        | fehlte | 0,18 |
 * | Lehrer-/Schuelernachbarschaft  | 0,18 + 0,18 (zwei Signale) | 0,22 gemeinsam |
 * | Chronologie plausibel          | fehlte | 0,14 |
 * | Region/Reise plausibel         | 0,08 | 0,08 |
 * | Buch-/Autor-Muster             | fehlte | 0,06 |
 * | widersprüchliches Todesjahr    | -0,45 (nur Sonderfall) | -0,25 |
 * | unmoegliche Chronologie        | fehlte | harte Regel, `conflict` |
 * | expliziter Quellenkonflikt     | fehlte | harte Regel, `conflict` |
 * | Regionsabweichung              | -0,04 (ohne Deckung) | protokolliert, 0 |
 *
 * Ausserdem war der Zahlenscore vom Vokabular entkoppelt: `scoreIdentityCandidate`
 * rief `confidenceLevelFromScore` nie auf. Jetzt traegt jedes Ergebnis beides,
 * und `confidenceLevelMatchesScore()` (dieselbe Regel wie der CHECK
 * `identity_candidate_level_threshold`) ist dadurch erfuellbar.
 *
 * ## Zusicherung
 *
 * Kein Pfad dieser Datei kann `verified` erzeugen. `confidenceLevelFromScore()`
 * gibt die Stufe nie zurueck, `assertMachineLevel()` prueft es zusaetzlich zur
 * Laufzeit, und jedes Ergebnis traegt `origin: "machine"`,
 * `reviewStatus: "machine_unreviewed"` und `requiresEditorialDecision: true`.
 */

import weightProfileV1 from "../config/er-weights.v1.json";
import { compareChronology } from "./chronology";
import { analyzeRelativeForm, RELATIVE_FORM_VERSION, surfaceTokens } from "./relative-forms";
import { normalizeSearchText } from "./search";
import { confidenceLevelFromScore, type ConfidenceLevel, type DateAssertion, type Origin, type ReviewStatus } from "./types";

/**
 * Struktur der Gewichtsdatei. Absichtlich ohne Schwellen: die stehen in
 * `lib/types.ts` (`CONFIDENCE_THRESHOLDS`) und im Schema-CHECK.
 */
export interface WeightProfile {
  weightProfileVersion: string;
  resolverVersion: string;
  signals: Record<string, { weight: number; direction: string; minSimilarity?: number; perNeighbour?: number }>;
  observations: Record<string, { weight: number }>;
  hardRules: { competingStrongCandidates: { minScore: number; maxGap: number } };
  blocking: { candidateBudget: number | null; maxRankedCandidates: number };
}

/** Das ausgelieferte Profil. Eine Kalibrierung erzeugt v2 und laesst v1 unveraendert. */
export const DEFAULT_WEIGHT_PROFILE = weightProfileV1 as unknown as WeightProfile;

/** Strukturtoken arabischer Namen: verbinden, benennen aber nicht. */
export const NAME_STOPWORD_TOKENS: readonly string[] = ["بن", "ابن", "ابو", "ابي", "ابا", "بنت", "مولي", "مولاه", "مولاهم", "ال", "و", "عن", "ويقال"];

/**
 * Tokenmenge eines Namens fuer Aehnlichkeit und Blocking. Nutzt `surfaceTokens`
 * (kanonische Normalisierung, Ornamente und Partikel entfernt) und wirft die
 * Strukturtoken weg. Einzige Tokenisierung des Resolvers — `lib/blocking.ts`
 * importiert sie, statt eine zweite zu definieren.
 */
export function nameTokens(value: string | null | undefined): string[] {
  return surfaceTokens(value).filter((token) => !NAME_STOPWORD_TOKENS.includes(token));
}

/**
 * Tokenbeutel einer Lehrer- oder Schuelernennung aus einer Rijal-Phrase.
 *
 * Der Importer trennt die Aufzaehlung, laesst das Aufzaehlungs-Waw aber am ersten
 * Token stehen („وحماد بن زيد"). Deshalb kommt zusaetzlich die Lesart ohne Waw in
 * den Beutel — additiv, damit „وهب" oder „وليد" nicht faelschlich zu „هب" / „ليد"
 * werden, sondern beide Formen treffen koennen.
 */
export function mentionTokenBag(mention: string): string[] {
  const tokens = nameTokens(mention);
  if (!tokens.length) return tokens;
  const first = tokens[0];
  return first.startsWith("و") && first.length >= 4 ? [...tokens, first.slice(1)] : tokens;
}

/** Trifft eine der Nennungen die Namensform eines Kettennachbarn vollstaendig? */
function mentionMatchesNeighbour(bags: string[][], forms: string[]): boolean {
  for (const form of forms) {
    const formTokens = nameTokens(form);
    if (!formTokens.length) continue;
    if (bags.some((bag) => formTokens.every((token) => bag.includes(token)))) return true;
  }
  return false;
}

export type IdentityProfile = {
  id: string;
  /** Hauptnamensformen (Namenskopf, Namenskette). */
  names: string[];
  /** Bekannte Varianten: Kunya, Nisba, Laqab, Alias, abweichende Namenskette. Signal 2. */
  variants?: string[];
  kunya?: string;
  nisba?: string;
  /** Herkunft; `regions` nimmt zusaetzlich Wohnort und Reisestationen auf. Signal 5. */
  region?: string;
  regions?: string[];
  deathYearMin?: number;
  deathYearMax?: number;
  /** Alle belegten Todesjahre. Mehrere Werte sind mehrere Quellenaussagen, kein Mittelwert. */
  deathYears?: number[];
  /** Bereits aufgeloeste Nachbarn (IDs). Signal 3. */
  teachers: string[];
  students: string[];
  /** Rohe Lehrer-/Schuelernennungen als Namensformen. Signal 3, wenn keine ID existiert. */
  teacherNames?: string[];
  studentNames?: string[];
  /** Vorberechnete Tokenbeutel derselben Nennungen (`mentionTokenBag`), einmal je Eintrag. */
  teacherMentionTokens?: string[][];
  studentMentionTokens?: string[][];
  /** Sammlungen, denen die Rijal-Quelle die Person zuordnet (Sigel, „روى عنه البخاري"). Signal 6. */
  collections?: string[];
  /** Schluessel dieser Person in den `DateAssertion`-Zeilen. Signal 4. */
  chronologyId?: string;
  /** Quellenstelle des Kandidaten. Ohne sie ist der Kandidat ein Fund, keine Aussage. */
  sourcePassageId?: string;
};

/** Eine Quelle sagt ausdruecklich, dass zwei Kandidaten nicht dieselbe Person sind. */
export interface SourceConflictClaim {
  candidateId: string;
  /** Pflicht. Eine Behauptung ohne Quellenstelle bleibt wirkungslos. */
  sourcePassageId: string;
  statement?: string;
}

export type OccurrenceContext = {
  surface: string;
  /** Positionsbindung. Fuer relative Formen die einzige zulaessige Identitaet. */
  chainId?: string;
  position?: number;
  /**
   * Die Position DAVOR in der Occurrence-Reihenfolge (`position - 1`). Sie
   * ueberliefert von dieser Position und ist damit deren SCHUELER — die Reihenfolge
   * laeuft vom Sammler nach hinten (belegt in `lib/relative-forms.ts`, Ankerregel).
   * Der frueher hier stehende Name `previousNarratorIds` legte die umgekehrte
   * Lesart nahe und wurde deshalb ersetzt.
   */
  citingNarratorIds: string[];
  /** Die Position DANACH (`position + 1`): diese Position ueberliefert von ihr, sie ist deren LEHRER. */
  citedNarratorIds: string[];
  /** Namensformen der Kettennachbarn, falls sie noch keine ID haben. */
  citingSurfaceForms?: string[];
  citedSurfaceForms?: string[];
  region?: string;
  /** Sammlung, in der die Position steht („bukhari", „muslim"). Signal 6. */
  collection?: string;
  /** Datierung der Ueberlieferung selbst, falls belegt. Teil von Signal 7. */
  transmissionYear?: number;
  /** Fuer diese Position belegte Todesjahre. Teil von Signal 7. */
  deathYearAssertions?: DateAssertion[];
  /** Belegte Datierungen, aus denen `compareChronology()` rechnet. Signal 4. */
  dateAssertions?: DateAssertion[];
  /** Schluessel der Kettennachbarn in `dateAssertions`. Signal 4 und harte Regel 1. */
  neighbourChronologyIds?: string[];
  /** Ausdrueckliche Quellenkonflikte. Harte Regel 2. */
  sourceConflicts?: SourceConflictClaim[];
};

/** Ein einzelner Signalbeitrag, damit jeder Score aufschluesselbar bleibt. */
export interface SignalContribution {
  signal: string;
  /** Gewicht aus dem Profil. */
  weight: number;
  /** Tatsaechlich angerechnet (anteilige Signale liegen darunter). */
  applied: number;
  detail: string;
}

/** Harte Regel, die einen maschinellen Vorschlag blockiert. */
export interface HardBlock {
  rule: "impossible-chronology" | "explicit-source-conflict" | "competing-strong-candidates" | "relative-form-position-bound";
  reasonCode: string;
  rationale: string;
  sourcePassageId?: string | null;
}

export interface IdentityCandidateScore {
  narratorId: string;
  /** 0..1, drei Dezimalstellen wie `numeric(4,3)` im Schema. */
  confidenceScore: number;
  /** Aus dem Score abgeleitet; `conflict`, wenn eine harte Regel greift. Nie `verified`. */
  confidenceLevel: ConfidenceLevel;
  matchingSignals: string[];
  conflictingSignals: string[];
  contributions: SignalContribution[];
  hardBlocks: HardBlock[];
  notes: string[];
  requiresEditorialDecision: true;
  origin: Origin;
  reviewStatus: ReviewStatus;
  weightProfileVersion: string;
  resolverVersion: string;
  relativeFormVersion: string;
};

/**
 * Zusicherung als Code, nicht als Kommentar: eine maschinell erzeugte Stufe
 * ist niemals `verified`. Wird von jedem Rueckgabepfad durchlaufen.
 */
export function assertMachineLevel(level: ConfidenceLevel): ConfidenceLevel {
  if (level === "verified") throw new Error("Maschinelle Verarbeitung darf 'verified' nicht setzen (docs/05, Abschnitt 4).");
  return level;
}

const round3 = (value: number) => Number(Math.max(0, Math.min(1, value)).toFixed(3));

function overlapRatio(surfaceTokenList: string[], candidateTokens: Set<string>): number {
  if (!surfaceTokenList.length || !candidateTokens.size) return 0;
  const shared = surfaceTokenList.filter((token) => candidateTokens.has(token)).length;
  return shared / surfaceTokenList.length;
}

/** Alle Namensformen eines Kandidaten, die als Hauptname gelten. */
function candidateNameForms(candidate: IdentityProfile): string[] {
  return candidate.names.filter(Boolean);
}

/** Alle Formen, die als bekannte Variante gelten (Signal 2). */
function candidateVariantForms(candidate: IdentityProfile): string[] {
  return [...(candidate.variants ?? []), candidate.kunya ?? "", candidate.nisba ?? ""].filter(Boolean);
}

/**
 * Bewertet einen Kandidaten fuer eine Erzaehlerposition. Ergebnis ist immer ein
 * ungepruefter Vorschlag.
 */
export function scoreIdentityCandidate(
  occurrence: OccurrenceContext,
  candidate: IdentityProfile,
  profile: WeightProfile = DEFAULT_WEIGHT_PROFILE,
): IdentityCandidateScore {
  const signals = profile.signals;
  const matchingSignals: string[] = [];
  const conflictingSignals: string[] = [];
  const contributions: SignalContribution[] = [];
  const hardBlocks: HardBlock[] = [];
  const notes: string[] = [];
  const base = {
    narratorId: candidate.id,
    requiresEditorialDecision: true as const,
    origin: "machine" as Origin,
    reviewStatus: "machine_unreviewed" as ReviewStatus,
    weightProfileVersion: profile.weightProfileVersion,
    resolverVersion: profile.resolverVersion,
    relativeFormVersion: RELATIVE_FORM_VERSION,
  };

  // Relative und anonyme Formen sind kein Scoring-Fall. Sie haengen an
  // (chainId, position) und werden von lib/relative-forms.ts behandelt.
  const relative = analyzeRelativeForm(occurrence.surface);
  if (relative.unresolvableRelative) {
    return {
      ...base,
      confidenceScore: 0,
      confidenceLevel: assertMachineLevel("unresolved"),
      matchingSignals,
      conflictingSignals: ["relative-or-anonymous-surface"],
      contributions,
      hardBlocks: [{
        rule: "relative-form-position-bound",
        reasonCode: relative.term?.anonymous ? "anonymous-surface-no-anchor" : "relative-anchored-unnamed",
        rationale: `„${occurrence.surface}" nennt keine Person, sondern verweist innerhalb der Kette. Aufloesung nur ueber (chainId, position) und nur redaktionell.`,
      }],
      notes,
      };
  }
  if (relative.isRelativeForm) {
    notes.push(`relative-form-apposition:${relative.term?.term ?? ""}`);
  }

  const surface = relative.isRelativeForm ? relative.resolutionSurface : normalizeSearchText(occurrence.surface);
  const surfaceNormalized = normalizeSearchText(surface);
  const surfaceTokenList = nameTokens(surface);
  let score = 0;

  // -- Signal 1: kanonische Namensaehnlichkeit -----------------------------
  const nameSignal = signals.canonicalNameSimilarity;
  const nameForms = candidateNameForms(candidate);
  const exactName = nameForms.some((name) => normalizeSearchText(name) === surfaceNormalized);
  const nameSimilarity = exactName
    ? 1
    : Math.max(0, ...nameForms.map((name) => overlapRatio(surfaceTokenList, new Set(nameTokens(name)))));
  if (nameSimilarity >= (nameSignal.minSimilarity ?? 0)) {
    const applied = Number((nameSignal.weight * nameSimilarity).toFixed(4));
    score += applied;
    matchingSignals.push(exactName ? "canonical-name-similarity:exact" : "canonical-name-similarity:partial");
    contributions.push({ signal: "canonicalNameSimilarity", weight: nameSignal.weight, applied, detail: exactName ? "normalisierte Form identisch" : `Tokenanteil ${nameSimilarity.toFixed(2)}` });
  }

  // -- Signal 2: bekannte Namensvariante ----------------------------------
  const variantSignal = signals.knownNameVariant;
  const variantForms = candidateVariantForms(candidate);
  const variantHit = variantForms.find((variant) => {
    const normalizedVariant = normalizeSearchText(variant);
    if (!normalizedVariant) return false;
    if (normalizedVariant === surfaceNormalized) return true;
    const variantTokens = nameTokens(variant);
    return variantTokens.length > 0 && variantTokens.every((token) => surfaceTokenList.includes(token));
  });
  if (variantHit && !exactName) {
    score += variantSignal.weight;
    matchingSignals.push("known-name-variant");
    contributions.push({ signal: "knownNameVariant", weight: variantSignal.weight, applied: variantSignal.weight, detail: `Variante „${variantHit}"` });
  }

  // -- Signal 3: Lehrer-/Schuelernachbarschaft ----------------------------
  const neighbourSignal = signals.teacherStudentNeighbourhood;
  const perNeighbour = neighbourSignal.perNeighbour ?? neighbourSignal.weight / 2;
  // Kettenrichtung: `citing*` ist der Schueler dieser Position, `cited*` ihr Lehrer.
  // Beide Belege wiegen gleich viel.
  const teacherBags = candidate.teacherMentionTokens ?? (candidate.teacherNames ?? []).map(mentionTokenBag);
  const studentBags = candidate.studentMentionTokens ?? (candidate.studentNames ?? []).map(mentionTokenBag);
  const studentHit = occurrence.citingNarratorIds.some((id) => candidate.students.includes(id))
    || mentionMatchesNeighbour(studentBags, occurrence.citingSurfaceForms ?? []);
  const teacherHit = occurrence.citedNarratorIds.some((id) => candidate.teachers.includes(id))
    || mentionMatchesNeighbour(teacherBags, occurrence.citedSurfaceForms ?? []);
  const neighbourHits = (teacherHit ? 1 : 0) + (studentHit ? 1 : 0);
  if (neighbourHits) {
    const applied = Number(Math.min(neighbourSignal.weight, neighbourHits * perNeighbour).toFixed(4));
    score += applied;
    matchingSignals.push("teacher-student-neighbourhood");
    contributions.push({ signal: "teacherStudentNeighbourhood", weight: neighbourSignal.weight, applied, detail: `${neighbourHits} belegte Nachbarschaft(en)` });
  }

  // -- Signal 4 und harte Regel 1: Chronologie ----------------------------
  // Ausschliesslich compareChronology() aus lib/chronology.ts. Es gibt keine
  // zweite Chronologieberechnung im Projekt (P5.2 hat die letzte entfernt).
  const chronologySignal = signals.chronologyPlausible;
  const assertions = occurrence.dateAssertions ?? [];
  const neighbourIds = occurrence.neighbourChronologyIds ?? [];
  if (candidate.chronologyId && assertions.length && neighbourIds.length) {
    let possibleOverlap: number | null = null;
    for (const neighbourId of neighbourIds) {
      const verdict = compareChronology(assertions, candidate.chronologyId, neighbourId);
      if (verdict.result === "impossible") {
        hardBlocks.push({
          rule: "impossible-chronology",
          reasonCode: "chronology-impossible",
          rationale: `compareChronology() ergibt fuer ${candidate.chronologyId} und ${neighbourId} 'impossible'` + (verdict.gapYears !== null ? ` (Abstand ${verdict.gapYears} Jahre).` : "."),
        });
        conflictingSignals.push("impossible-chronology");
      } else if (verdict.result === "possible") {
        possibleOverlap = Math.max(possibleOverlap ?? 0, verdict.overlapYears ?? 0);
      }
    }
    if (possibleOverlap !== null && !hardBlocks.length) {
      score += chronologySignal.weight;
      matchingSignals.push("chronology-possible");
      contributions.push({ signal: "chronologyPlausible", weight: chronologySignal.weight, applied: chronologySignal.weight, detail: `Ueberlappung ${possibleOverlap} Jahre laut compareChronology()` });
    }
  }

  // -- Signal 5: Region/Reise plausibel -----------------------------------
  const regionSignal = signals.regionTravelPlausible;
  const candidateRegions = [candidate.region ?? "", ...(candidate.regions ?? [])].filter(Boolean).map(normalizeSearchText);
  if (occurrence.region && candidateRegions.length) {
    const occurrenceRegion = normalizeSearchText(occurrence.region);
    if (candidateRegions.includes(occurrenceRegion)) {
      score += regionSignal.weight;
      matchingSignals.push("region-or-travel-plausible");
      contributions.push({ signal: "regionTravelPlausible", weight: regionSignal.weight, applied: regionSignal.weight, detail: `Region ${occurrence.region}` });
    } else {
      // Protokolliert, aber nicht abgewertet: docs/05 kennt kein negatives
      // Regionsgewicht (siehe observations.regionMismatch in der Gewichtsdatei).
      conflictingSignals.push("region-mismatch");
      contributions.push({ signal: "regionMismatch", weight: profile.observations.regionMismatch.weight, applied: 0, detail: `${occurrence.region} gegen ${candidateRegions.join("/")}` });
    }
  }

  // -- Signal 6: Buch-/Autor-Muster --------------------------------------
  const bookSignal = signals.bookAuthorPattern;
  if (occurrence.collection && (candidate.collections ?? []).includes(occurrence.collection)) {
    score += bookSignal.weight;
    matchingSignals.push("book-author-pattern");
    contributions.push({ signal: "bookAuthorPattern", weight: bookSignal.weight, applied: bookSignal.weight, detail: `Quelle ordnet die Person ${occurrence.collection} zu` });
  }

  // -- Signal 7: widersprüchliches Todesjahr -----------------------------
  const deathSignal = signals.contradictoryDeathYear;
  const candidateDeathYears = [...(candidate.deathYears ?? [])];
  if (candidate.deathYearMin !== undefined) candidateDeathYears.push(candidate.deathYearMin);
  if (candidate.deathYearMax !== undefined) candidateDeathYears.push(candidate.deathYearMax);
  const transmissionAfterDeath = occurrence.transmissionYear !== undefined
    && candidate.deathYearMax !== undefined
    && occurrence.transmissionYear > candidate.deathYearMax;
  const assertedDeathYears = (occurrence.deathYearAssertions ?? []).filter((item) => item.event === "death");
  const deathYearDisagreement = assertedDeathYears.length > 0 && candidateDeathYears.length > 0
    && !assertedDeathYears.some((item) => candidateDeathYears.some((year) => year >= item.yearMin && year <= item.yearMax));
  if (transmissionAfterDeath || deathYearDisagreement) {
    score += deathSignal.weight;
    conflictingSignals.push("contradictory-death-year");
    const detail = [
      transmissionAfterDeath ? `Ueberlieferung ${occurrence.transmissionYear} nach Todesjahr ${candidate.deathYearMax}` : "",
      deathYearDisagreement ? `belegte Todesjahre der Position (${assertedDeathYears.map((item) => item.yearMin).join(", ")}) treffen ${candidateDeathYears.join(", ")} nicht` : "",
    ].filter(Boolean).join("; ");
    contributions.push({ signal: "contradictoryDeathYear", weight: deathSignal.weight, applied: deathSignal.weight, detail });
  }

  // -- Harte Regel 2: expliziter Quellenkonflikt -------------------------
  for (const claim of occurrence.sourceConflicts ?? []) {
    if (claim.candidateId !== candidate.id) continue;
    if (!claim.sourcePassageId) {
      // Keine Bewertung ohne Quellenreferenz: eine unbelegte Behauptung bleibt wirkungslos.
      notes.push("source-conflict-claim-without-passage-ignored");
      continue;
    }
    hardBlocks.push({
      rule: "explicit-source-conflict",
      reasonCode: "explicit-source-conflict",
      rationale: claim.statement ? `Quellenaussage: ${claim.statement}` : "Eine Quelle widerspricht dieser Zuordnung ausdruecklich.",
      sourcePassageId: claim.sourcePassageId,
    });
    conflictingSignals.push("explicit-source-conflict");
  }

  const confidenceScore = round3(score);
  const level: ConfidenceLevel = hardBlocks.length
    ? "conflict"
    : matchingSignals.length
      ? confidenceLevelFromScore(confidenceScore)
      : "unresolved";
  return {
    ...base,
    confidenceScore,
    confidenceLevel: assertMachineLevel(level),
    matchingSignals,
    conflictingSignals,
    contributions,
    hardBlocks,
    notes,
  };
}

/**
 * Rangfolge der Kandidaten einer Position. Filtert nur, was ueberhaupt kein
 * positives Signal hat, und schneidet auf `blocking.maxRankedCandidates`.
 */
export function rankIdentityCandidates(
  occurrence: OccurrenceContext,
  profiles: IdentityProfile[],
  limit = DEFAULT_WEIGHT_PROFILE.blocking.maxRankedCandidates,
  profile: WeightProfile = DEFAULT_WEIGHT_PROFILE,
): IdentityCandidateScore[] {
  return profiles
    .map((entry) => scoreIdentityCandidate(occurrence, entry, profile))
    .filter((item) => item.confidenceScore > 0 || item.hardBlocks.length)
    .sort((a, b) => b.confidenceScore - a.confidenceScore || a.narratorId.localeCompare(b.narratorId))
    .slice(0, limit);
}

/**
 * Vorschlag fuer eine Erzaehlerposition, inklusive der drei harten Regeln.
 *
 * `autoLinkAllowed` ist der einzige Ort, an dem die Pipeline entscheiden darf,
 * eine Position maschinell mit einer Person zu verknuepfen. Er ist genau dann
 * true, wenn keine harte Regel greift UND der beste Kandidat `high` erreicht.
 * Auch dann bleibt die Zeile `machine_unreviewed` und ist kein `verified`.
 */
export interface IdentityProposal {
  chainId: string | null;
  position: number | null;
  surface: string;
  candidates: IdentityCandidateScore[];
  best: IdentityCandidateScore | null;
  confidenceLevel: ConfidenceLevel;
  confidenceScore: number | null;
  hardBlocks: HardBlock[];
  autoLinkAllowed: boolean;
  requiresEditorialDecision: true;
  origin: Origin;
  reviewStatus: ReviewStatus;
  weightProfileVersion: string;
  resolverVersion: string;
  relativeFormVersion: string;
}

/**
 * Harte Regel 3 (P4.3): zwei Kandidaten ab `minScore` mit einem Abstand unter
 * `maxGap` sind maschinell nicht unterscheidbar. Beide — und jeder weitere im
 * selben Band — werden auf `conflict` gesetzt; keiner wird vorgeschlagen.
 * Gibt den erzeugten Block zurueck, sonst null. Absichtlich einzeln aufrufbar,
 * damit die Regel fuer sich getestet werden kann.
 */
export function applyCompetingCandidatesRule(candidates: IdentityCandidateScore[], profile: WeightProfile = DEFAULT_WEIGHT_PROFILE): HardBlock | null {
  const rule = profile.hardRules.competingStrongCandidates;
  const strong = candidates.filter((item) => item.confidenceScore >= rule.minScore && !item.hardBlocks.length);
  if (strong.length < 2 || strong[0].confidenceScore - strong[1].confidenceScore >= rule.maxGap) return null;
  const block: HardBlock = {
    rule: "competing-strong-candidates",
    reasonCode: "competing-strong-candidates",
    rationale: `${strong[0].narratorId} (${strong[0].confidenceScore}) und ${strong[1].narratorId} (${strong[1].confidenceScore}) liegen ab ${rule.minScore} weniger als ${rule.maxGap} auseinander und sind maschinell nicht unterscheidbar.`,
  };
  for (const item of strong) {
    if (strong[0].confidenceScore - item.confidenceScore >= rule.maxGap) continue;
    item.hardBlocks.push(block);
    item.conflictingSignals.push("competing-strong-candidates");
    item.confidenceLevel = assertMachineLevel("conflict");
  }
  return block;
}

/**
 * Bewertet die uebergebenen Kandidatenprofile fuer eine Position und baut daraus
 * den Vorschlag. Das ist der Weg, den der Batch-Resolver in Stufe 1 geht: eine
 * Namensform, die Kandidaten aus dem Blocking-Index, ein Ergebnis.
 *
 * Rueckgabe ist immer ein ungepruefter Vorschlag — `assertMachineLevel()` in
 * `buildProposal()` schliesst `verified` auf jedem Pfad aus.
 */
export function proposeIdentity(
  occurrence: OccurrenceContext,
  profiles: IdentityProfile[],
  profile: WeightProfile = DEFAULT_WEIGHT_PROFILE,
): IdentityProposal {
  return buildProposal(occurrence, rankIdentityCandidates(occurrence, profiles, profile.blocking.maxRankedCandidates, profile), profile);
}

/**
 * Baut den Vorschlag aus einer bereits bewerteten Kandidatenliste. Getrennt von
 * `proposeIdentity()`, weil der Batch-Resolver in zwei Stufen arbeitet: Stufe 1
 * bewertet je Namensform (Blocking), Stufe 2 bewertet je Position erneut mit
 * dem Positionskontext.
 */
export function buildProposal(
  occurrence: OccurrenceContext,
  candidates: IdentityCandidateScore[],
  profile: WeightProfile = DEFAULT_WEIGHT_PROFILE,
): IdentityProposal {
  const seenBlocks = new Set<string>();
  const hardBlocks: HardBlock[] = [];
  const competing = applyCompetingCandidatesRule(candidates, profile);
  for (const block of [...candidates.flatMap((item) => item.hardBlocks), ...(competing ? [competing] : [])]) {
    const key = `${block.rule}|${block.reasonCode}|${block.rationale}`;
    if (seenBlocks.has(key)) continue;
    seenBlocks.add(key);
    hardBlocks.push(block);
  }
  const best = candidates.find((item) => !item.hardBlocks.length) ?? null;
  const level: ConfidenceLevel = hardBlocks.length
    ? "conflict"
    : best
      ? best.confidenceLevel
      : "unresolved";
  return {
    chainId: occurrence.chainId ?? null,
    position: occurrence.position ?? null,
    surface: occurrence.surface,
    candidates,
    best,
    confidenceLevel: assertMachineLevel(level),
    confidenceScore: best ? best.confidenceScore : null,
    hardBlocks,
    autoLinkAllowed: !hardBlocks.length && best !== null && best.confidenceLevel === "high",
    requiresEditorialDecision: true,
    origin: "machine",
    reviewStatus: "machine_unreviewed",
    weightProfileVersion: profile.weightProfileVersion,
    resolverVersion: profile.resolverVersion,
    relativeFormVersion: RELATIVE_FORM_VERSION,
  };
}
