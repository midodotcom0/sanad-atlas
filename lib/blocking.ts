/**
 * Blocking-Index und Batch-Resolver (Umsetzungsplan P4.1).
 *
 * Vorher existierte gar kein Blocking: `rankIdentityCandidates()` bekam eine
 * fertige Kandidatenliste und niemand erzeugte sie. Ein vollstaendiger Lauf
 * haette 87.867 Erzaehlerpositionen gegen 34.045 Rijal-Eintraege gestellt, also
 * rund 3,0 Mrd. Paare.
 *
 * Zwei Hebel, beide gemessen (Zahlen und Kommandos in `docs/13-RESOLVER.md`):
 *
 *  1. **Deduplizierung auf distinkte Namensformen.** 87.867 Positionen ergeben
 *     9.908 distinkte, nicht relative, nicht prophetische Formen — Faktor 8,9.
 *     Der Resolver arbeitet auf Formen; die Positionen erben das Ergebnis, weil
 *     die Signale, die von der Position abhaengen, getrennt bewertet werden
 *     (`FormResolution.positions`).
 *  2. **Prophetenpositionen ausschliessen.** Sie sind keine
 *     Identitaetsaufgabe. Autoritativ ist das Importerfeld `prophetMention`;
 *     zusaetzlich werden die daraus ABGELEITETEN Formen erkannt (siehe
 *     `collectProphetForms`), weil dasselbe „النبي صلي الله عليه وسلم" in 3.434
 *     Fällen markiert und in 1.449 Fällen nicht markiert ist. Es wird bewusst
 *     keine eigene Prophetenliste gepflegt.
 *
 * Der Index selbst ist ein Kopftoken-Invertindex ueber die Namensköpfe der
 * Rijal-Eintraege: Token -> Eintragsindizes. Kandidat ist jeder Eintrag, der
 * mindestens ein Token mit der Namensform teilt. Die Tokenisierung kommt aus
 * `lib/entity-resolution.ts` (`nameTokens`), damit Blocking und Scoring
 * dieselbe Definition benutzen.
 *
 * Bewusste Grenze: `candidateBudget` nimmt Token nach Seltenheit auf und bricht
 * ab, sobald das Budget ueberschritten wuerde — das seltenste Token ist immer
 * dabei. Dadurch fallen Eintraege heraus, die mit der Anfrage AUSSCHLIESSLICH
 * sehr haeufige Token teilen. Die Wirkung ist gemessen (Median 536 -> 191,
 * p90 9.065 -> 1.184) und die Recall-Folge ist in `docs/13-RESOLVER.md` als
 * offener Punkt gegen den noch fehlenden Goldbestand (P4.7) benannt.
 */

import {
  DEFAULT_WEIGHT_PROFILE, nameTokens, proposeIdentity,
  type IdentityProfile, type IdentityProposal, type OccurrenceContext, type WeightProfile,
} from "./entity-resolution";
import { analyzeRelativeForm, resolveRelativeForm, type RelativeFormReference } from "./relative-forms";
import { normalizeSearchText } from "./search";
import type { ConfidenceLevel } from "./types";

/** Minimalform eines Rijal-Eintrags, wie der Importer ihn schreibt. */
export interface RijalEntryLike {
  id: string;
  source?: string;
  nameSurface?: string | null;
  nameSurfaceNormalized?: string | null;
  nameChain?: string | null;
  nameChainTokens?: string[] | null;
  kunya?: string | null;
  nisbas?: string[] | null;
  region?: string | null;
  residence?: string | null;
  deathYearCandidate?: number | null;
  teacherMentions?: string[] | null;
  studentMentions?: string[] | null;
  collectionSigla?: string[] | null;
}

/** Minimalform einer Erzaehlerposition, wie der Importer sie schreibt. */
export interface OccurrenceLike {
  chainId: string;
  position: number;
  rawSurfaceForm?: string | null;
  normalizedSurfaceForm?: string | null;
  prophetMention?: boolean;
  relativeForm?: boolean;
  transmissionTerm?: string | null;
}

export interface HeadTokenIndex {
  /** Token -> Indizes in `entries`. */
  postings: Map<string, number[]>;
  entries: RijalEntryLike[];
  /** Messwerte des Aufbaus, damit jede Zahl im Bericht aus dem Code kommt. */
  stats: { entries: number; tokens: number; postingsTotal: number; buildMs: number };
}

/**
 * Tokenmenge eines Rijal-Eintrags fuer den Index: Namenskette, Kunya, Nisben.
 * Der Biografietext geht NICHT in den Index — eine Erwaehnung im Text ist keine
 * Namensgleichheit (Befund B1) und wuerde die Postinglisten unbrauchbar machen.
 */
export function entryHeadTokens(entry: RijalEntryLike): Set<string> {
  const bag = new Set<string>();
  for (const token of nameTokens(entry.nameSurfaceNormalized ?? entry.nameSurface ?? "")) bag.add(token);
  for (const token of entry.nameChainTokens ?? []) for (const part of nameTokens(token)) bag.add(part);
  for (const token of nameTokens(entry.kunya ?? "")) bag.add(token);
  for (const nisba of entry.nisbas ?? []) for (const token of nameTokens(nisba)) bag.add(token);
  return bag;
}

export function buildHeadTokenIndex(entries: RijalEntryLike[]): HeadTokenIndex {
  const started = Date.now();
  const postings = new Map<string, number[]>();
  let postingsTotal = 0;
  entries.forEach((entry, index) => {
    for (const token of entryHeadTokens(entry)) {
      const list = postings.get(token);
      if (list) list.push(index);
      else postings.set(token, [index]);
      postingsTotal += 1;
    }
  });
  return { postings, entries, stats: { entries: entries.length, tokens: postings.size, postingsTotal, buildMs: Date.now() - started } };
}

export interface CandidateSelection {
  /** Indizes in `index.entries`. */
  indices: number[];
  /** Token, die tatsaechlich abgefragt wurden (nach Seltenheit). */
  usedTokens: string[];
  /** Token, die das Budget gesprengt haetten. */
  skippedTokens: string[];
}

/**
 * Kandidaten einer Namensform. `budget === null` liefert die vollstaendige
 * Vereinigung ueber alle Token (hoechster Recall, groesster Aufwand).
 */
export function selectCandidates(index: HeadTokenIndex, form: string, budget: number | null = DEFAULT_WEIGHT_PROFILE.blocking.candidateBudget): CandidateSelection {
  const tokens = [...new Set(nameTokens(form))]
    .filter((token) => index.postings.has(token))
    .sort((a, b) => (index.postings.get(a)?.length ?? 0) - (index.postings.get(b)?.length ?? 0) || a.localeCompare(b));
  const seen = new Set<number>();
  const usedTokens: string[] = [];
  const skippedTokens: string[] = [];
  for (const token of tokens) {
    const list = index.postings.get(token) ?? [];
    if (usedTokens.length > 0 && budget !== null && seen.size + list.length > budget) { skippedTokens.push(token); continue; }
    for (const entryIndex of list) seen.add(entryIndex);
    usedTokens.push(token);
  }
  return { indices: [...seen], usedTokens, skippedTokens };
}

/**
 * Die Oberflaechenformen, die der Importer als Prophetenerwaehnung markiert hat.
 * Abgeleitet, nicht gepflegt: die Liste entsteht aus `prophetMention === true`
 * im Bestand selbst. Damit werden auch die Positionen erfasst, bei denen das
 * Flag fehlt, ohne dass hier eine eigene Prophetenliste entstehen wuerde.
 */
export function collectProphetForms(occurrences: Iterable<OccurrenceLike>): Set<string> {
  const forms = new Set<string>();
  for (const occurrence of occurrences) {
    if (!occurrence.prophetMention) continue;
    const form = normalizeSearchText(occurrence.normalizedSurfaceForm ?? occurrence.rawSurfaceForm ?? "");
    if (form) forms.add(form);
  }
  return forms;
}

export interface DistinctNameForm {
  /** Kanonische Suchform. Schluessel der Deduplizierung. */
  form: string;
  /** Alle Positionen, die diese Form tragen. */
  positions: { chainId: string; position: number }[];
  occurrences: number;
}

export interface FormCollectionResult {
  forms: DistinctNameForm[];
  /** Positionsgebundene relative Formen. Nie dedupliziert, nie global. */
  relatives: RelativeFormReference[];
  stats: {
    occurrences: number;
    prophetPositionsByFlag: number;
    prophetPositionsByDerivedForm: number;
    relativePositions: number;
    emptyPositions: number;
    distinctForms: number;
    dedupeFactor: number;
    collectMs: number;
  };
}

/**
 * Dedupliziert die Erzaehlerpositionen auf distinkte Namensformen, schliesst
 * Prophetenpositionen aus und trennt die relativen Formen ab.
 *
 * Eine relative Form landet NIE in `forms`, auch nicht als Nebenprodukt: bei
 * einer Apposition („عمه ابي سهيل بن مالك") geht ausschliesslich der benannte
 * Rest in die Deduplizierung, die Verwandtschaftsangabe bleibt bei der Position.
 */
export function collectDistinctNameForms(occurrences: Iterable<OccurrenceLike>, prophetForms: Set<string>): FormCollectionResult {
  const started = Date.now();
  const byForm = new Map<string, DistinctNameForm>();
  const relatives: RelativeFormReference[] = [];
  let occurrenceCount = 0;
  let prophetFlag = 0;
  let prophetDerived = 0;
  let relativeCount = 0;
  let emptyCount = 0;
  for (const occurrence of occurrences) {
    occurrenceCount += 1;
    const raw = occurrence.normalizedSurfaceForm ?? occurrence.rawSurfaceForm ?? "";
    if (occurrence.prophetMention) { prophetFlag += 1; continue; }
    const normalized = normalizeSearchText(raw);
    if (prophetForms.has(normalized)) { prophetDerived += 1; continue; }
    const analysis = analyzeRelativeForm(raw);
    if (analysis.isRelativeForm) {
      relativeCount += 1;
      const reference = resolveRelativeForm(raw, occurrence);
      if (reference) relatives.push(reference);
      if (analysis.unresolvableRelative) continue;
    }
    const form = normalizeSearchText(analysis.isRelativeForm ? analysis.resolutionSurface : normalized);
    if (!form) { emptyCount += 1; continue; }
    const bucket = byForm.get(form);
    if (bucket) {
      bucket.positions.push({ chainId: occurrence.chainId, position: occurrence.position });
      bucket.occurrences += 1;
    } else {
      byForm.set(form, { form, positions: [{ chainId: occurrence.chainId, position: occurrence.position }], occurrences: 1 });
    }
  }
  const forms = [...byForm.values()];
  const covered = forms.reduce((total, entry) => total + entry.occurrences, 0);
  return {
    forms,
    relatives,
    stats: {
      occurrences: occurrenceCount,
      prophetPositionsByFlag: prophetFlag,
      prophetPositionsByDerivedForm: prophetDerived,
      relativePositions: relativeCount,
      emptyPositions: emptyCount,
      distinctForms: forms.length,
      dedupeFactor: forms.length ? Number((covered / forms.length).toFixed(2)) : 0,
      collectMs: Date.now() - started,
    },
  };
}

/**
 * Uebersetzt einen Rijal-Eintrag in ein Kandidatenprofil. Die
 * Lehrer-/Schuelernennungen bleiben Namensformen: sie sind noch keine
 * aufgeloesten Personen, und daraus eine ID zu machen waere genau die
 * Verwechslung, die P4.6 vermeiden soll.
 */
export function profileFromRijalEntry(entry: RijalEntryLike, collections: string[] = []): IdentityProfile {
  const names = [entry.nameSurfaceNormalized ?? entry.nameSurface ?? "", entry.nameChain ?? ""].filter(Boolean) as string[];
  return {
    id: entry.id,
    names,
    variants: [entry.kunya ?? "", ...(entry.nisbas ?? [])].filter(Boolean) as string[],
    kunya: entry.kunya ?? undefined,
    nisba: (entry.nisbas ?? [])[0] ?? undefined,
    region: entry.region ?? undefined,
    regions: [entry.region ?? "", entry.residence ?? ""].filter(Boolean) as string[],
    deathYearMin: entry.deathYearCandidate ?? undefined,
    deathYearMax: entry.deathYearCandidate ?? undefined,
    deathYears: entry.deathYearCandidate === null || entry.deathYearCandidate === undefined ? [] : [entry.deathYearCandidate],
    teachers: [],
    students: [],
    teacherNames: (entry.teacherMentions ?? []).map((mention) => mention ?? "").filter(Boolean),
    studentNames: (entry.studentMentions ?? []).map((mention) => mention ?? "").filter(Boolean),
    collections,
    sourcePassageId: entry.id,
  };
}

export interface FormResolution {
  form: string;
  occurrences: number;
  positions: { chainId: string; position: number }[];
  candidateCount: number;
  usedTokens: string[];
  skippedTokens: string[];
  proposal: IdentityProposal;
}

export interface BatchResolveOptions {
  budget?: number | null;
  profile?: WeightProfile;
  /** Kontext, der fuer alle Formen gleich gilt (Sammlung, Region, Datierungen). */
  context?: Partial<OccurrenceContext>;
  /** Positionsgebundener Kontext je Form, falls vorhanden. */
  contextForForm?: (form: DistinctNameForm) => Partial<OccurrenceContext>;
}

export interface BatchResolveResult {
  resolutions: FormResolution[];
  stats: {
    forms: number;
    formsWithoutCandidate: number;
    candidateTotal: number;
    candidateMedian: number;
    candidateP90: number;
    candidateMax: number;
    proposalsHigh: number;
    proposalsMedium: number;
    proposalsLow: number;
    proposalsUnresolved: number;
    proposalsConflict: number;
    autoLinkAllowed: number;
    resolveMs: number;
  };
}

function quantile(sorted: number[], share: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
}

/**
 * Loest eine Menge distinkter Namensformen gegen den Index auf. Einsträngig,
 * ohne Nebenlaeufigkeit und ohne Netz — der Lauf muss auf einem gewoehnlichen
 * Rechner durchlaufen.
 */
export function resolveFormsBatch(index: HeadTokenIndex, forms: DistinctNameForm[], options: BatchResolveOptions = {}): BatchResolveResult {
  const started = Date.now();
  const profile = options.profile ?? DEFAULT_WEIGHT_PROFILE;
  const budget = options.budget === undefined ? profile.blocking.candidateBudget : options.budget;
  const resolutions: FormResolution[] = [];
  const counts: number[] = [];
  const levels: Record<ConfidenceLevel, number> = { verified: 0, high: 0, medium: 0, low: 0, unresolved: 0, conflict: 0 };
  let autoLink = 0;
  let withoutCandidate = 0;
  for (const form of forms) {
    const selection = selectCandidates(index, form.form, budget);
    if (!selection.indices.length) withoutCandidate += 1;
    counts.push(selection.indices.length);
    const occurrence: OccurrenceContext = {
      surface: form.form,
      chainId: form.positions[0]?.chainId,
      position: form.positions[0]?.position,
      citingNarratorIds: [],
      citedNarratorIds: [],
      ...options.context,
      ...(options.contextForForm ? options.contextForForm(form) : {}),
    };
    const profiles = selection.indices.map((entryIndex) => profileFromRijalEntry(index.entries[entryIndex]));
    const proposal = proposeIdentity(occurrence, profiles, profile);
    levels[proposal.confidenceLevel] += 1;
    if (proposal.autoLinkAllowed) autoLink += 1;
    resolutions.push({
      form: form.form,
      occurrences: form.occurrences,
      positions: form.positions,
      candidateCount: selection.indices.length,
      usedTokens: selection.usedTokens,
      skippedTokens: selection.skippedTokens,
      proposal,
    });
  }
  const sorted = [...counts].sort((a, b) => a - b);
  return {
    resolutions,
    stats: {
      forms: forms.length,
      formsWithoutCandidate: withoutCandidate,
      candidateTotal: counts.reduce((total, value) => total + value, 0),
      candidateMedian: quantile(sorted, 0.5),
      candidateP90: quantile(sorted, 0.9),
      candidateMax: sorted.length ? sorted[sorted.length - 1] : 0,
      proposalsHigh: levels.high,
      proposalsMedium: levels.medium,
      proposalsLow: levels.low,
      proposalsUnresolved: levels.unresolved,
      proposalsConflict: levels.conflict,
      autoLinkAllowed: autoLink,
      resolveMs: Date.now() - started,
    },
  };
}
