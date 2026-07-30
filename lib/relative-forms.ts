/**
 * Relative Namensformen (Umsetzungsplan P4.4).
 *
 * Diese Datei ist die EINZIGE fachliche Definition. Bitgleiche Ports, die
 * synchron gehalten werden muessen:
 *   - `backend/app/relative_forms.py`      (Python: Resolver-Pipeline, Contract-Tests)
 *   - `scripts/atlas-relative-forms.mjs`   (reines Node: Build-Pipeline, ID-Schema)
 *
 * Nachweis der Gleichheit:
 *   - `tests/blocking.check.mjs`         mjs <-> Python (Vektoren, per python3 aufgerufen)
 *                                        und Tabellenvergleich ueber alle drei Quelldateien
 *   - `tests/entity-resolution.test.ts`  TypeScript <-> mjs auf denselben Vektoren
 *
 * ## Warum ueberhaupt ein eigener Algorithmus
 *
 * „ابنه" heisst in jeder Kette jemand anderen. Eine relative Form ist deshalb
 * keine Namensvariante, die man normalisieren und global nachschlagen koennte,
 * sondern ein Zeiger auf eine andere Position DERSELBEN Kette. Das Ergebnis
 * haengt ausschliesslich an `(chainId, position)` — `resolveRelativeForm()`
 * nimmt diese beiden Werte verpflichtend an und gibt sie im Ergebnis zurueck.
 * Es gibt bewusst keine Funktion, die aus einer relativen Form eine globale
 * Identitaet macht.
 *
 * ## Ankerregel (aus dem Korpus abgelesen, nicht angenommen)
 *
 * Die Erzaehlerpositionen laufen vom Sammler nach hinten: Position `i-1`
 * ueberliefert von Position `i`. In `bukhari-2-2-13#c0`
 * („عن هشام بن عروه، عن ابيه") steht `هشام بن عروه` auf Position 2 und `ابيه`
 * auf Position 3 — gemeint ist der Vater von Hischam, also der Vater des
 * ZITIERENDEN Erzaehlers. Der Anker einer relativen Form ist damit immer
 * `position - 1`. Steht die relative Form auf Position 0, liegt der Anker
 * ausserhalb der Kette (der Sammler selbst) und ist hier nicht aufloesbar
 * (gemessen: 2 von 1.699 Faellen).
 *
 * ## Vier Listen wurden zu dieser einen zusammengefuehrt
 *
 * | Fundstelle (Vorzustand)                | Begriffe | Form              |
 * |---|---:|---|
 * | `lib/entity-resolution.ts:31`           | 10 | Set, exakte Gleichheit |
 * | `components/research-record-layout.tsx:74` | 7 | Regex, `^...$`      |
 * | `scripts/import-turath-corpus.mjs:840`  | 20 | Regex, `^...$`      |
 * | `backend/app/repository.py:144`          | 16 | Set, Tokenschnitt   |
 *
 * Keine davon kannte nachgestellte Token, keine unterschied „عمه" (unbenannt)
 * von „عمه ابي سهيل بن مالك" (benannt, mit Apposition). Beides entscheidet
 * dieser Algorithmus. Die Migrationsnotiz je Fundstelle steht in
 * `docs/13-RESOLVER.md`.
 */

import { normalizeSearchText } from "./search";

/** Version der Begriffstabelle. Wandert in jedes Ergebnis und in `docs/13-RESOLVER.md`. */
export const RELATIVE_FORM_VERSION = "sanad-relative-forms-1.0.0";

/** Feinkoernige Verwandtschaftsangabe. Fachliche Aussage, keine Schemaspalte. */
export type RelativeKinship =
  | "father" | "mother" | "grandfather" | "grandmother"
  | "uncle_paternal" | "uncle_maternal" | "aunt_paternal" | "aunt_maternal"
  | "brother" | "sister" | "son" | "daughter" | "wife" | "husband"
  | "shaykh" | "companion" | "unnamed_man" | "unnamed_woman" | "unnamed_shaykh" | "unnamed_group";

/**
 * Genau die sieben Werte des CHECK `narrator_occurrence_relative_kind`
 * (`database/schema.sql:471`). Feinere Verwandtschaften fallen auf `other`,
 * damit eine Zeile schreibbar bleibt, ohne das Schema anzufassen.
 */
export type SchemaRelativeFormKind =
  | "father" | "grandfather" | "uncle" | "brother" | "unnamed_man" | "unnamed_shaykh" | "other";

/**
 * `whole`  nur als vollstaendige Oberflaechenform (Mehrdeutigkeitsschutz).
 * `head`   nur als erstes Token (anonyme Umschreibungen).
 * `any`    an jeder Position (drittes Possessivsuffix ist eindeutig).
 */
export type RelativeTermScope = "whole" | "head" | "any";

export interface RelativeFormTerm {
  /** Normalisiertes Token bzw. normalisierte Wortfolge (`normalizeSearchText`). */
  term: string;
  kinship: RelativeKinship;
  schemaKind: SchemaRelativeFormKind;
  /** „ابيه" = dritte Person, „ابي" = erste Person. Der Anker ist in beiden Faellen derselbe. */
  person: "first" | "third";
  /** „ابيهما" nennt zwei Anker; die Kette kann nur einen davon zeigen. */
  arity: "single" | "dual";
  /** true: zeigt auf den zitierenden Erzaehler. false: rein anonym, kein Anker. */
  anchored: boolean;
  /**
   * true, wenn der Begriff niemanden benennt. Ein Rest hinter einem anonymen
   * Begriff ist eine Beschreibung („رجل من قريش", „بعض اصحاب النبي"), kein Name,
   * und darf deshalb nie in den Kandidatenabruf gehen.
   */
  anonymous: boolean;
  scope: RelativeTermScope;
  /**
   * true, wenn der Begriff in der 16er-Liste von `backend/app/repository.py:144`
   * steht. `scripts/atlas-id-scheme.mjs` bildet daraus die `UNC-REL-`-Bucket-IDs;
   * die Teilmenge bleibt eingefroren, bis `atlas.db` neu gebaut wird (siehe
   * `docs/13-RESOLVER.md`, Abschnitt Migration).
   */
  legacyBucketTerm: boolean;
}

/**
 * Kanonische Begriffstabelle. Reihenfolge ist Teil des Vertrags: die Ports
 * halten sie ein, und `tests/blocking.check.mjs` vergleicht sie Zeile fuer Zeile.
 *
 * Belegte Haeufigkeit im Korpus (gemessen, Stand `dataVersion`
 * `turath-5aa44bb55b758d6d9f0d`) steht in `docs/13-RESOLVER.md`; Begriffe mit
 * null Vorkommen stammen aus einer der vier Vorgaengerlisten und bleiben
 * erhalten, damit die Zusammenfuehrung keine Abdeckung verliert.
 */
export const RELATIVE_FORM_TERMS: readonly RelativeFormTerm[] = [
  { term: "ابيه", kinship: "father", schemaKind: "father", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: true },
  { term: "ابيها", kinship: "father", schemaKind: "father", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: false },
  { term: "ابوه", kinship: "father", schemaKind: "father", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: false },
  { term: "ابيهما", kinship: "father", schemaKind: "father", person: "third", arity: "dual", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: false },
  { term: "امه", kinship: "mother", schemaKind: "other", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: true },
  { term: "امها", kinship: "mother", schemaKind: "other", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: false },
  { term: "جده", kinship: "grandfather", schemaKind: "grandfather", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: true },
  { term: "جدها", kinship: "grandfather", schemaKind: "grandfather", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: true },
  { term: "جدته", kinship: "grandmother", schemaKind: "other", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: true },
  { term: "جدتها", kinship: "grandmother", schemaKind: "other", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: false },
  { term: "عمه", kinship: "uncle_paternal", schemaKind: "uncle", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: true },
  { term: "عمها", kinship: "uncle_paternal", schemaKind: "uncle", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: false },
  { term: "عماه", kinship: "uncle_paternal", schemaKind: "uncle", person: "third", arity: "dual", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: false },
  { term: "عمته", kinship: "aunt_paternal", schemaKind: "other", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: true },
  { term: "خاله", kinship: "uncle_maternal", schemaKind: "uncle", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: true },
  { term: "خالته", kinship: "aunt_maternal", schemaKind: "other", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: true },
  { term: "اخيه", kinship: "brother", schemaKind: "brother", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: true },
  { term: "اخيها", kinship: "brother", schemaKind: "brother", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: false },
  { term: "اخته", kinship: "sister", schemaKind: "other", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: true },
  { term: "اختها", kinship: "sister", schemaKind: "other", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: false },
  { term: "ابنه", kinship: "son", schemaKind: "other", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: true },
  { term: "ابنها", kinship: "son", schemaKind: "other", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: false },
  { term: "بنته", kinship: "daughter", schemaKind: "other", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: true },
  { term: "زوجته", kinship: "wife", schemaKind: "other", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: true },
  { term: "زوجها", kinship: "husband", schemaKind: "other", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: false },
  { term: "شيخه", kinship: "shaykh", schemaKind: "unnamed_shaykh", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: false },
  { term: "صاحبه", kinship: "companion", schemaKind: "other", person: "third", arity: "single", anchored: true, anonymous: false, scope: "any", legacyBucketTerm: false },
  // Erste Person. „ابي" ist mit dem Kunya-Genitiv identisch („ابي هريره" =
  // Abu Huraira, 9.996 Vorkommen, davon 874 die blosse Form „ابي"), deshalb
  // ausschliesslich als vollstaendige Oberflaechenform.
  { term: "ابي", kinship: "father", schemaKind: "father", person: "first", arity: "single", anchored: true, anonymous: false, scope: "whole", legacyBucketTerm: false },
  { term: "اخي", kinship: "brother", schemaKind: "brother", person: "first", arity: "single", anchored: true, anonymous: false, scope: "whole", legacyBucketTerm: false },
  { term: "عمي", kinship: "uncle_paternal", schemaKind: "uncle", person: "first", arity: "single", anchored: true, anonymous: false, scope: "whole", legacyBucketTerm: false },
  { term: "جدي", kinship: "grandfather", schemaKind: "grandfather", person: "first", arity: "single", anchored: true, anonymous: false, scope: "whole", legacyBucketTerm: false },
  // Anonyme Umschreibungen. Kein Anker: „رجل من قريش" nennt niemanden, auch
  // nicht relativ. Nur in Kopfstellung, damit Matn-Reste wie „قتله رجل" nicht
  // als Erzaehlerumschreibung gelten.
  { term: "رجل", kinship: "unnamed_man", schemaKind: "unnamed_man", person: "third", arity: "single", anchored: false, anonymous: true, scope: "head", legacyBucketTerm: false },
  { term: "امراه", kinship: "unnamed_woman", schemaKind: "other", person: "third", arity: "single", anchored: false, anonymous: true, scope: "head", legacyBucketTerm: false },
  { term: "شيخ", kinship: "unnamed_shaykh", schemaKind: "unnamed_shaykh", person: "third", arity: "single", anchored: false, anonymous: true, scope: "head", legacyBucketTerm: false },
  // Wortfolgen. „بعض اصحابه" ist an den Anker gebunden, „بعض اصحاب" nicht.
  { term: "بعض اصحابه", kinship: "unnamed_group", schemaKind: "other", person: "third", arity: "dual", anchored: true, anonymous: true, scope: "head", legacyBucketTerm: false },
  { term: "بعض اصحاب", kinship: "unnamed_group", schemaKind: "other", person: "third", arity: "dual", anchored: false, anonymous: true, scope: "head", legacyBucketTerm: false },
];

/**
 * Partikel, die vor einer Oberflaechenform stehen koennen, ohne Teil des Namens
 * zu sein. Bewusst kurz und ausschliesslich belegt: „عن جده" (Ueberlieferungs-
 * partikel, auch in den Testvektoren von `tests/atlas-db-id-scheme.check.mjs`)
 * sowie „له ابي" / „لي ابي" (7 Vorkommen, Matn-Rest vor dem Namen).
 */
export const SURFACE_LEADING_PARTICLES: readonly string[] = ["عن", "و", "ف", "ثم", "لي", "له", "ولي", "وله"];

/** Zeichen, die an Tokenraendern abgeschnitten werden, bevor verglichen wird. */
export const SURFACE_TRIM_CHARACTERS = ".,:؛؟!()[]{}«»\"'-*،؍/\\";

/**
 * Arabische Ehrenligaturen und Ornamente (U+FD3E bis U+FDFF): ﵁ ﵂ ﵃ ﵄ ﵇ ﵎ ﷿ ﴾ ﴿.
 * Ein Token, das nur daraus besteht, ist kein Namensbestandteil. `ﷺ` erscheint
 * hier nie, weil NFKD es bereits zu „صلي الله عليه وسلم" zerlegt.
 */
function isOrnamentToken(token: string): boolean {
  if (!token) return false;
  for (const character of token) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0xfd3e || code > 0xfdff) return false;
  }
  return true;
}

function trimToken(token: string): string {
  let start = 0;
  let end = token.length;
  while (start < end && SURFACE_TRIM_CHARACTERS.includes(token[start])) start += 1;
  while (end > start && SURFACE_TRIM_CHARACTERS.includes(token[end - 1])) end -= 1;
  return token.slice(start, end);
}

/**
 * Tokenfolge einer Oberflaechenform fuer die Positionsanalyse: kanonisch
 * normalisiert, ohne Ornamente, ohne fuehrende Partikel, randbereinigt.
 *
 * Das ist KEINE zweite Normalisierung. `normalizeSearchText` bleibt die einzige
 * Definition; hier werden nur Token verworfen, die kein Namensbestandteil sind.
 */
export function surfaceTokens(surface: string | null | undefined): string[] {
  const tokens = normalizeSearchText(surface ?? "").split(" ").map(trimToken).filter((token) => token && !isOrnamentToken(token));
  let index = 0;
  while (index < tokens.length && SURFACE_LEADING_PARTICLES.includes(tokens[index])) index += 1;
  return tokens.slice(index);
}

/**
 * `whole`              die Form besteht nur aus der relativen Angabe -> kein Name vorhanden.
 * `leading-apposition` relative Angabe, danach ein Name („عمه ابي سهيل بن مالك").
 * `trailing`           Name, danach die relative Angabe -> der Nasab selbst ist relativ.
 * `internal`           relative Angabe mitten im Text (meist Matn-Rest).
 */
export type RelativeFormMatch = "none" | "whole" | "leading-apposition" | "trailing" | "internal";

export interface RelativeFormAnalysis {
  /** true, sobald eine relative Angabe erkannt wurde. Entspricht `narrator_occurrence.is_relative_form`. */
  isRelativeForm: boolean;
  match: RelativeFormMatch;
  term: RelativeFormTerm | null;
  /**
   * true nur bei `match === "whole"`: es existiert kein Name, die Position ist
   * ausschliesslich ueber den Anker aufloesbar und niemals global.
   */
  unresolvableRelative: boolean;
  /** Der benannte Rest ohne die relative Angabe. Leer, wenn keiner existiert. */
  residualForm: string;
  /**
   * Die Form, mit der Kandidatenabruf arbeiten darf. Bei `whole` leer — es gibt
   * nichts nachzuschlagen. Sonst der benannte Rest.
   */
  resolutionSurface: string;
  tokens: string[];
  version: string;
}

function matchesScope(term: RelativeFormTerm, index: number, tokenCount: number, phraseLength: number): boolean {
  if (term.scope === "whole") return index === 0 && tokenCount === phraseLength;
  if (term.scope === "head") return index === 0;
  return true;
}

/**
 * Findet die erste relative Angabe in einer Oberflaechenform und klassifiziert
 * ihre Stellung. Wortfolgen werden vor Einzeltoken geprueft, damit
 * „بعض اصحابه" nicht als „بعض اصحاب" gelesen wird.
 */
export function analyzeRelativeForm(surface: string | null | undefined): RelativeFormAnalysis {
  const tokens = surfaceTokens(surface);
  const empty: RelativeFormAnalysis = {
    isRelativeForm: false, match: "none", term: null, unresolvableRelative: false,
    residualForm: tokens.join(" "), resolutionSurface: tokens.join(" "), tokens, version: RELATIVE_FORM_VERSION,
  };
  if (!tokens.length) return empty;

  let found: { term: RelativeFormTerm; index: number; length: number } | null = null;
  for (const term of RELATIVE_FORM_TERMS) {
    const parts = term.term.split(" ");
    for (let index = 0; index + parts.length <= tokens.length; index += 1) {
      let hit = true;
      for (let offset = 0; offset < parts.length; offset += 1) {
        if (tokens[index + offset] !== parts[offset]) { hit = false; break; }
      }
      if (!hit) continue;
      if (!matchesScope(term, index, tokens.length, parts.length)) continue;
      if (!found || index < found.index || (index === found.index && parts.length > found.length)) {
        found = { term, index, length: parts.length };
      }
      break;
    }
  }
  if (!found) return empty;

  const residual = [...tokens.slice(0, found.index), ...tokens.slice(found.index + found.length)];
  const match: RelativeFormMatch = !residual.length
    ? "whole"
    : found.index === 0
      ? "leading-apposition"
      : found.index + found.length === tokens.length
        ? "trailing"
        : "internal";
  // Hinter einem anonymen Begriff steht eine Beschreibung, kein Name: „رجل من
  // قريش" bleibt unaufloesbar, obwohl Resttoken vorhanden sind.
  const unresolvable = match === "whole" || found.term.anonymous;
  return {
    isRelativeForm: true,
    match,
    term: found.term,
    unresolvableRelative: unresolvable,
    residualForm: residual.join(" "),
    resolutionSurface: unresolvable ? "" : residual.join(" "),
    tokens,
    version: RELATIVE_FORM_VERSION,
  };
}

/** Kurzform fuer Oberflaechen (Warnhinweis in der Rechercheansicht, Importer-Flag). */
export function isRelativeSurfaceForm(surface: string | null | undefined): boolean {
  return analyzeRelativeForm(surface).isRelativeForm;
}

/** Kurzform: gibt es ueberhaupt einen Namen, der global nachgeschlagen werden darf? */
export function isUnresolvableRelativeForm(surface: string | null | undefined): boolean {
  return analyzeRelativeForm(surface).unresolvableRelative;
}

export type RelativeAnchorKind = "citing-narrator" | "collector-outside-chain" | "none";

/**
 * Positionsgebundene Aufloesung. Ohne `chainId` und `position` nicht aufrufbar —
 * das ist der Mechanismus, der eine globale Aufloesung verhindert.
 */
export interface RelativeFormReference {
  chainId: string;
  position: number;
  /** `${chainId}#${position}`. Der einzige zulaessige Identitaetsschluessel einer relativen Form. */
  key: string;
  kinship: RelativeKinship;
  schemaKind: SchemaRelativeFormKind;
  person: "first" | "third";
  arity: "single" | "dual";
  match: RelativeFormMatch;
  anchorKind: RelativeAnchorKind;
  /** Position des zitierenden Erzaehlers in derselben Kette, sonst null. */
  anchorPosition: number | null;
  /** false, wenn die Form mehr Anker nennt, als die Position hergibt („ابيهما"). */
  anchorComplete: boolean;
  /** Der benannte Rest, falls die Form eine Apposition traegt. */
  resolutionSurface: string;
  requiresEditorialDecision: true;
  reasonCode: string;
  rationale: string;
  version: string;
}

/**
 * Loest eine relative Form ausschliesslich innerhalb ihrer Kette auf: das
 * Ergebnis nennt den Anker als POSITION, niemals als Person. Wer daraus eine
 * Person macht, braucht eine redaktionelle Entscheidung
 * (`narrator_occurrence_relative_needs_editor`, `database/schema.sql:488`).
 *
 * Gibt `null` zurueck, wenn die Form keine relative Angabe enthaelt.
 */
export function resolveRelativeForm(surface: string | null | undefined, position: { chainId: string; position: number }): RelativeFormReference | null {
  const analysis = analyzeRelativeForm(surface);
  if (!analysis.isRelativeForm || !analysis.term) return null;
  const term = analysis.term;
  const anchorKind: RelativeAnchorKind = !term.anchored
    ? "none"
    : position.position > 0
      ? "citing-narrator"
      : "collector-outside-chain";
  const anchorPosition = anchorKind === "citing-narrator" ? position.position - 1 : null;
  const reasonCode = !term.anchored
    ? "anonymous-surface-no-anchor"
    : anchorKind === "collector-outside-chain"
      ? "relative-anchor-outside-chain"
      : analysis.unresolvableRelative
        ? "relative-anchored-unnamed"
        : "relative-anchored-named-apposition";
  const rationale = !term.anchored
    ? `Anonyme Umschreibung „${term.term}" ohne Anker; ohne Quelle ist keine Person benennbar.`
    : anchorKind === "collector-outside-chain"
      ? `Relative Form „${term.term}" auf Position 0: der zitierende Erzaehler liegt ausserhalb der Kette.`
      : analysis.unresolvableRelative
        ? `Relative Form „${term.term}" ohne eigenen Namen; gemeint ist ${term.kinship} des Erzaehlers auf Position ${anchorPosition} derselben Kette.`
        : `Relative Form „${term.term}" mit benanntem Rest „${analysis.resolutionSurface}"; die Verwandtschaftsangabe bezieht sich auf Position ${anchorPosition} derselben Kette.`;
  return {
    chainId: position.chainId,
    position: position.position,
    key: `${position.chainId}#${position.position}`,
    kinship: term.kinship,
    schemaKind: term.schemaKind,
    person: term.person,
    arity: term.arity,
    match: analysis.match,
    anchorKind,
    anchorPosition,
    anchorComplete: term.arity === "single",
    resolutionSurface: analysis.resolutionSurface,
    requiresEditorialDecision: true,
    reasonCode,
    rationale,
    version: RELATIVE_FORM_VERSION,
  };
}

/**
 * Die eingefrorene Teilmenge, aus der `scripts/atlas-id-scheme.mjs` die
 * `UNC-REL-`-Bucket-IDs bildet. Sie entspricht Zeichen fuer Zeichen der Liste
 * in `backend/app/repository.py:144`, weil eine Aenderung jede bereits gebaute
 * `atlas.db` umschluesseln wuerde (Migration: `docs/13-RESOLVER.md`).
 */
export const LEGACY_BUCKET_RELATIVE_TERMS: readonly string[] = RELATIVE_FORM_TERMS
  .filter((term) => term.legacyBucketTerm)
  .map((term) => term.term);
