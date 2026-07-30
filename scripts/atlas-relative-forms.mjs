/**
 * Wortgleicher Node-Port von `lib/relative-forms.ts` (Umsetzungsplan P4.4).
 *
 * Einzige fachliche Definition bleibt `lib/relative-forms.ts`. Diese Datei ist
 * ein Port, keine zweite Definition -- noetig, weil `scripts/build-atlas-db.mjs`
 * und `scripts/atlas-id-scheme.mjs` als reine Node-Skripte ohne TypeScript-
 * Tooling laufen muessen (dieselbe Begruendung wie bei
 * `scripts/atlas-normalize.mjs`). Weicht diese Datei ab, ist sie falsch.
 *
 * Nachweis der Gleichheit:
 *   - `tests/blocking.check.mjs`        Begriffstabelle aus allen drei Quelldateien
 *                                      Zeile fuer Zeile, plus Vektorvergleich gegen
 *                                      `backend/app/relative_forms.py` per python3
 *   - `tests/entity-resolution.test.ts` Vektorvergleich `lib/relative-forms.ts` <-> diese Datei
 */

import { normalizeSearchText } from "./atlas-normalize.mjs";

/** Muss zu RELATIVE_FORM_VERSION in lib/relative-forms.ts und backend/app/relative_forms.py passen. */
export const RELATIVE_FORM_VERSION = "sanad-relative-forms-1.0.0";

/** Wortgleich zu RELATIVE_FORM_TERMS in lib/relative-forms.ts. Reihenfolge ist Teil des Vertrags. */
export const RELATIVE_FORM_TERMS = [
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
  { term: "ابي", kinship: "father", schemaKind: "father", person: "first", arity: "single", anchored: true, anonymous: false, scope: "whole", legacyBucketTerm: false },
  { term: "اخي", kinship: "brother", schemaKind: "brother", person: "first", arity: "single", anchored: true, anonymous: false, scope: "whole", legacyBucketTerm: false },
  { term: "عمي", kinship: "uncle_paternal", schemaKind: "uncle", person: "first", arity: "single", anchored: true, anonymous: false, scope: "whole", legacyBucketTerm: false },
  { term: "جدي", kinship: "grandfather", schemaKind: "grandfather", person: "first", arity: "single", anchored: true, anonymous: false, scope: "whole", legacyBucketTerm: false },
  { term: "رجل", kinship: "unnamed_man", schemaKind: "unnamed_man", person: "third", arity: "single", anchored: false, anonymous: true, scope: "head", legacyBucketTerm: false },
  { term: "امراه", kinship: "unnamed_woman", schemaKind: "other", person: "third", arity: "single", anchored: false, anonymous: true, scope: "head", legacyBucketTerm: false },
  { term: "شيخ", kinship: "unnamed_shaykh", schemaKind: "unnamed_shaykh", person: "third", arity: "single", anchored: false, anonymous: true, scope: "head", legacyBucketTerm: false },
  { term: "بعض اصحابه", kinship: "unnamed_group", schemaKind: "other", person: "third", arity: "dual", anchored: true, anonymous: true, scope: "head", legacyBucketTerm: false },
  { term: "بعض اصحاب", kinship: "unnamed_group", schemaKind: "other", person: "third", arity: "dual", anchored: false, anonymous: true, scope: "head", legacyBucketTerm: false },
];

/** Wortgleich zu SURFACE_LEADING_PARTICLES in lib/relative-forms.ts. */
export const SURFACE_LEADING_PARTICLES = ["عن", "و", "ف", "ثم", "لي", "له", "ولي", "وله"];

/** Wortgleich zu SURFACE_TRIM_CHARACTERS in lib/relative-forms.ts. */
export const SURFACE_TRIM_CHARACTERS = ".,:؛؟!()[]{}«»\"'-*،؍/\\";

/**
 * Arabische Ehrenligaturen und Ornamente (U+FD3E bis U+FDFF).
 * @param {string} token
 */
function isOrnamentToken(token) {
  if (!token) return false;
  for (const character of token) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0xfd3e || code > 0xfdff) return false;
  }
  return true;
}

/** @param {string} token */
function trimToken(token) {
  let start = 0;
  let end = token.length;
  while (start < end && SURFACE_TRIM_CHARACTERS.includes(token[start])) start += 1;
  while (end > start && SURFACE_TRIM_CHARACTERS.includes(token[end - 1])) end -= 1;
  return token.slice(start, end);
}

/**
 * Tokenfolge einer Oberflaechenform fuer die Positionsanalyse.
 * @param {string | null | undefined} surface
 * @returns {string[]}
 */
export function surfaceTokens(surface) {
  const tokens = normalizeSearchText(surface ?? "").split(" ").map(trimToken).filter((token) => token && !isOrnamentToken(token));
  let index = 0;
  while (index < tokens.length && SURFACE_LEADING_PARTICLES.includes(tokens[index])) index += 1;
  return tokens.slice(index);
}

function matchesScope(term, index, tokenCount, phraseLength) {
  if (term.scope === "whole") return index === 0 && tokenCount === phraseLength;
  if (term.scope === "head") return index === 0;
  return true;
}

/**
 * Findet die erste relative Angabe und klassifiziert ihre Stellung.
 * @param {string | null | undefined} surface
 */
export function analyzeRelativeForm(surface) {
  const tokens = surfaceTokens(surface);
  const empty = {
    isRelativeForm: false, match: "none", term: null, unresolvableRelative: false,
    residualForm: tokens.join(" "), resolutionSurface: tokens.join(" "), tokens, version: RELATIVE_FORM_VERSION,
  };
  if (!tokens.length) return empty;

  let found = null;
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
  const match = !residual.length
    ? "whole"
    : found.index === 0
      ? "leading-apposition"
      : found.index + found.length === tokens.length
        ? "trailing"
        : "internal";
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

/** @param {string | null | undefined} surface */
export function isRelativeSurfaceForm(surface) {
  return analyzeRelativeForm(surface).isRelativeForm;
}

/** @param {string | null | undefined} surface */
export function isUnresolvableRelativeForm(surface) {
  return analyzeRelativeForm(surface).unresolvableRelative;
}

/**
 * Positionsgebundene Aufloesung. Ohne chainId und position nicht aufrufbar.
 * @param {string | null | undefined} surface
 * @param {{ chainId: string, position: number }} position
 */
export function resolveRelativeForm(surface, position) {
  const analysis = analyzeRelativeForm(surface);
  if (!analysis.isRelativeForm || !analysis.term) return null;
  const term = analysis.term;
  const anchorKind = !term.anchored
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
 * Eingefrorene Teilmenge fuer die `UNC-REL-`-Bucket-IDs
 * (`scripts/atlas-id-scheme.mjs`, `backend/app/repository.py:144`).
 */
export const LEGACY_BUCKET_RELATIVE_TERMS = RELATIVE_FORM_TERMS.filter((term) => term.legacyBucketTerm).map((term) => term.term);

/**
 * Pruefvektoren fuer die Paritaetstests. Jede Zeile ist eine echte oder eine
 * absichtlich grenzwertige Oberflaechenform; die Herkunft steht im Kommentar.
 * Genutzt von `tests/blocking.check.mjs` (mjs <-> Python) und
 * `tests/entity-resolution.test.ts` (TypeScript <-> mjs).
 */
export const RELATIVE_FORM_PARITY_VECTORS = [
  "ابيه",                          // 1.558 Vorkommen, blosse Form
  "أَبِيهِ",                        // dieselbe Form mit Diakritika
  "عن جده",                        // Partikel davor (Testvektor aus tests/atlas-db-id-scheme.check.mjs)
  "ابيه ﵁",                        // Ehrenligatur dahinter, 49 Vorkommen
  "عمه ابي سهيل بن مالك",           // Apposition: der Onkel ist benannt
  "ابيه المغيره بن شعبه",           // Apposition mit vollem Namen
  "جدي ابو برده",                  // erste Person mit Apposition
  "ابي",                           // 874 Vorkommen, erste Person
  "ابي هريره",                     // KEINE relative Form: Kunya-Genitiv
  "ابي هريره ﵁",                   // dito mit Ligatur
  "عبد الله بن ابي",               // abgeschnittener Name, keine relative Form
  "موسي بن ابي عايشه",             // Kunya im Nasab, keine relative Form
  "رجل",                           // anonym
  "رجل من قريش",                   // anonym mit Beschreibung
  "امراه من قريش",                 // anonym mit Beschreibung
  "بعض اصحابه",                    // anonyme Gruppe, an den Anker gebunden
  "بعض اصحاب النبي",               // anonyme Gruppe ohne Anker
  "ابيهما",                        // Dual: zwei Anker
  "ابنه وابنه ابن واخت",            // Matn-Rest, Begriff mitten im Text
  "يحيي بن سعيد الانصاري",          // gewoehnlicher Name
  "الحميدي عبد الله بن الزبير",     // gewoehnlicher Name
  "زينب بنت ام سلمه",              // „بنت" ist Nasab-Verbinder, keine relative Form
  "خاله الاسود",                   // Apposition
  "شيخه",                          // „sein Schaich"
  "وفيها شيخ حسن الهييه",           // „شيخ" nicht in Kopfstellung -> keine relative Form
  "",                              // leer
  "﵁",                             // nur eine Ligatur
];
