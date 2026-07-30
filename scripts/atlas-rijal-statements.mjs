/**
 * Lehrer- und Schuelernennungen aus den Rijāl-Werken als einzelne,
 * quellengebundene Assertions (Umsetzungsplan P4.6).
 *
 * Ausgangslage: der Importer legt die Lehrer-/Schuelerpassage eines Eintrags
 * sowohl als ganze Phrase (`teacherPhrase`/`studentPhrase`) als auch bereits
 * in Einzelnennungen zerlegt ab (`teacherMentions`/`studentMentions`).
 * `backend/app/repository.py` gab daraus bisher KEINE Relationen aus, mit der
 * ausdruecklichen Begruendung, die Phrasen seien nicht personenscharf
 * geparst. Dieses Modul schliesst genau diese Luecke -- und zwar so, dass
 * jede erzeugte Kante an einer nachpruefbaren Stelle im Quelltext haengt.
 *
 * Die drei Regeln, die hier alles bestimmen:
 *
 *   1. **Keine Kante ohne Quellenstelle.** Eine Nennung wird nur dann zur
 *      Aussagekandidat, wenn ihre bereinigte Oberflaechenform WORTWOERTLICH im
 *      Eintragstext (`rijal_entry.entry_text`, zugleich der Text der
 *      zugehoerigen `source_passage`) steht. Damit ist die Fundstelle nicht
 *      nur behauptet, sondern durch eine Zeichenkettensuche im belegten Text
 *      jederzeit wiederauffindbar -- auch ohne gespeicherten Offset.
 *   2. **Keine Chronologie als Beleg.** Dieses Modul kennt keine Jahreszahlen
 *      und keine Lebensspannen. `evidence_kind` ist ausschliesslich
 *      `rijal_statement`; eine zeitliche Moeglichkeit ist kein Beleg fuer eine
 *      Ueberlieferungsbeziehung und erzeugt hier nie eine Kante.
 *   3. **Verworfenes verschwindet nicht.** Jede zurueckgewiesene Nennung
 *      bekommt einen Grund und wird als `parse_review_item`
 *      (`queue_kind = 'relationship_assertion'`) in die Review-Queue
 *      geschrieben -- nicht stillschweigend weggelassen und erst recht nicht
 *      geraten.
 *
 * Wichtig: `accepted` bedeutet hier nur „personenscharf segmentierte,
 * quellengebundene Nennung“. Die `UNC-*`-Enden sind Oberflaechenform-Cluster,
 * keine geklaerten historischen Identitaeten. Der Datenbankbau legt diese
 * Ergebnisse deshalb als `rijal_statement_identity_unresolved` in die
 * Review-Queue; erst nach Aufloesung beider Enden darf daraus eine echte
 * `relationship_assertion` werden.
 *
 * Reine Funktionen, keine Dateizugriffe, keine Datenbank: dieselbe Logik
 * laeuft im Bau (`scripts/atlas-build-lib.mjs`) und -- als wortgleicher Port
 * `backend/app/rijal_statements.py` -- in der FastAPI-Referenz. Die Gleichheit
 * beider Seiten prueft `tests/atlas-db-id-scheme.check.mjs`.
 */

import { normalizeSearchText } from "./atlas-normalize.mjs";
import { isRelativeReference, clusterIdForName } from "./atlas-id-scheme.mjs";

/** Version dieser Segmentierung. Geht als `parser_version` in jede Assertion. */
export const RIJAL_STATEMENT_VERSION = "rijal-statements-1.1.0";

/**
 * Nennungen, die keine Person benennen, sondern eine Restmenge ("und andere",
 * "eine Gruppe"). Sie sind fachlich korrekt im Text und trotzdem kein
 * Beziehungsbeleg: es gibt keine zweite Person, auf die die Kante zeigen
 * koennte. Geprueft wird gegen die NORMALISIERTE Form und nur als ganzes
 * Wort am Anfang der Nennung -- "غيرهم" als Kopf verwirft, ein Name, der das
 * Wort zufaellig enthaelt, nicht.
 */
const COLLECTIVE_HEAD_TOKENS_RAW = [
  "غير", "غيرهم", "غيرهما", "غيرهن", "غيره", "غيرها",
  "اخر", "اخران", "اخرون", "اخرين", "الاخرون", "جماعه", "الجماعه",
  "خلق", "خلائق", "جمع", "عده", "طايفه", "طائفه", "ناس", "اخرهم", "عدد",
  "سوي", "الباقون", "باقون", "شيخان",
];

/** Fuehrende Partikeln, die vor einer solchen Restmengen-Nennung stehen koennen ("في اخرين"). */
const COLLECTIVE_LEADING_PARTICLES_RAW = ["في", "من", "وفي", "ومن"];

const COLLECTIVE_HEAD_TOKENS = new Set(COLLECTIVE_HEAD_TOKENS_RAW.map((t) => normalizeSearchText(t)));
const COLLECTIVE_LEADING_PARTICLES = new Set(COLLECTIVE_LEADING_PARTICLES_RAW.map((t) => normalizeSearchText(t)));

/**
 * Ein sicherer Parser darf Satzreste nicht zu Personen-IDs hashen. Diese
 * Token leiten Aussagen, Zitate oder Kommentare ein, nie einen Namenskopf.
 * Die Liste ist absichtlich konservativ: „عن ابن عجلان“ enthaelt zwar einen
 * Namen, ist aber noch keine personenscharf segmentierte Nennung. Sie geht in
 * die Review-Queue, bis ein eigener Segmentierer den belegten Namensspan
 * ausweist.
 */
const NON_NAME_HEAD_TOKENS_RAW = [
  "عن", "حدثنا", "حدثني", "حدثناه", "حدثنيه", "اخبرنا", "اخبرني", "اخبرناه",
  "اخبرنيه", "انبانا", "انباني", "نبانا", "ثنا", "نا", "سمعت", "سمعنا", "سمع",
  "روي", "يروي", "يرويه", "رواه", "قال", "وقال", "قلت", "قيل", "وقيل",
  "ذكر", "ذكره", "وذكره", "كتب", "كتبت", "اخرج", "اخرجه", "واخرجه", "اخرجاه",
  "اخرجا", "ساق", "سالت", "ساله", "وثقه", "وثق", "نسبه", "ياتي", "سياتي",
  "هو", "هي", "هما", "هم", "من", "في", "لم", "لن", "لا", "ليس", "كان", "كانت",
  "يكون", "لانه", "ان", "انه", "انها", "انما", "ثم", "وقد", "قرا", "قرات",
  "بن", "له", "مات", "توفي", "عامل", "حكي", "ارسل", "قاله", "فيه", "فيحتمل",
  "حديثا", "نسيبه", "حفيده", "حفيدها", "بعضه", "الصحيح", "كانه", "منهم", "خاليه",
];
const NON_NAME_HEAD_TOKENS = new Set(NON_NAME_HEAD_TOKENS_RAW.map((t) => normalizeSearchText(t)));

/** Token, die innerhalb einer angeblichen Nennung den Beginn eines Satzrestes anzeigen. */
const NON_NAME_INTERNAL_TOKENS_RAW = [
  "عن", "عنه", "عنها", "في", "فيه", "بواسطه", "حديثا", "مرسلا", "خلاف",
  "اختلاف", "قصه", "القصه", "مسايل", "المسايل", "وحده", "وحدها",
];
const NON_NAME_INTERNAL_TOKENS = new Set(NON_NAME_INTERNAL_TOKENS_RAW.map((t) => normalizeSearchText(t)));

/** Weitere relative/duale Koepfe, die der alte Bucket-Port nicht abdeckte. */
const RELATIVE_MENTION_HEADS_RAW = [
  "اخوه", "اخوها", "ابوه", "ابوها", "والده", "والدها", "ولده", "ولدها",
  "ابناه", "ابنا", "ابني", "ابناؤه", "ابناء", "ابنته", "زوجها", "شيخه", "شيخها",
];
const RELATIVE_MENTION_HEADS = new Set(RELATIVE_MENTION_HEADS_RAW.map((t) => normalizeSearchText(t)));

/**
 * Nach diesen Abstammungswoertern kann ein mit و beginnender Name wirklich
 * ein Namensbestandteil sein („عبد الله بن وهب“). An jeder anderen spaeteren
 * Position ist ein و-Token ein nicht zerlegter Koordinator oder Kommentar
 * („وكيع ومروان“, „الذهلي وهو من اقرانه“).
 */
const W_NAME_PREDECESSORS = new Set(["بن", "ابن", "ابي", "ابو", "بنت", "ام", "عبد"].map((t) => normalizeSearchText(t)));
const W_TOKEN_EXCEPTIONS = new Set(["وسلم"].map((t) => normalizeSearchText(t)));

/** Klammerausdruecke: Quellensigel wie "(د)" und Fussnotenmarken wie "(^١)". */
const BRACKETED = /[([][^)\]]*[)\]]/g;
/** Anfuehrungszeichen aller in den Editionen vorkommenden Formen. */
const QUOTE_CHARS = /["«»”“„']/g;
/** Trennzeichen am Rand einer Nennung. */
const EDGE_PUNCTUATION = /^[\s.,،؛:\-–—()[\]]+|[\s.,،؛:\-–—()[\]]+$/g;
/** Innere Editionszeichen markieren einen Zusatz oder einen unvollstaendigen Markuprest. */
const INTERNAL_STRUCTURE = /[:\-–—/[\]]/;

/** Hoechstzahl Token einer Einzelnennung. Darueber ist es ein Satz, keine Nennung. */
const MAX_NAME_TOKENS = 8;

/**
 * Gruende fuer eine Zurueckweisung. Der Wert landet unveraendert in
 * `parse_review_item.error_code`; die Liste ist damit Teil des Vertrags und
 * wird von tests/atlas-db-build.check.mjs mitgeprueft.
 */
export const REJECTION_CODES = Object.freeze({
  SUBJECT_NOT_NAMED: "rijal_statement_subject_not_named",
  ENTRY_TEXT_MISSING: "rijal_statement_entry_text_missing",
  EMPTY_AFTER_CLEANING: "rijal_statement_empty_after_cleaning",
  RELATIVE_FORM: "rijal_statement_relative_form",
  NO_PERSON_NAMED: "rijal_statement_no_person_named",
  UNSEGMENTED_PHRASE: "rijal_statement_unsegmented_phrase",
  PHRASE_NOT_IN_PASSAGE: "rijal_statement_phrase_not_in_passage",
  SELF_REFERENCE: "rijal_statement_self_reference",
  DUPLICATE: "rijal_statement_duplicate",
});

/**
 * Bereinigt eine Rohnennung zu einer Namensoberflaeche.
 *
 * `index > 0`: der Importer trennt die Nennungen an "، و" und laesst das
 * verbindende و am Anfang jeder Folgenennung stehen ("وحماد بن زيد"). Genau
 * dieses eine و faellt hier weg. Die ERSTE Nennung traegt es nicht und wird
 * darum nie beschnitten -- sonst wuerde aus dem Namen "وكيع" ein "كيع".
 * @param {string} raw
 * @param {number} index Position der Nennung in ihrer Phrase
 * @returns {string} bereinigte Oberflaechenform (noch nicht normalisiert)
 */
export function cleanMentionSurface(raw, index) {
  let value = String(raw ?? "").replace(BRACKETED, " ").replace(QUOTE_CHARS, " ");
  value = value.replace(/\s+/g, " ").replace(EDGE_PUNCTUATION, "");
  if (index > 0 && value.startsWith("و") && value.length > 2) value = value.slice(1);
  return value.replace(EDGE_PUNCTUATION, "");
}

/**
 * Prueft eine einzelne Nennung und liefert entweder eine annehmbare
 * Namensform oder einen Zurueckweisungsgrund.
 * @param {string} raw Rohnennung aus teacherMentions/studentMentions
 * @param {number} index
 * @param {string} entryText Text des Eintrags = Text der source_passage
 * @returns {{ ok: true, surface: string, normalized: string, clusterId: string }
 *          | { ok: false, code: string, detail: string, surface: string }}
 */
export function evaluateMention(raw, index, entryText) {
  const rawText = String(raw ?? "");
  const surface = cleanMentionSurface(rawText, index);
  if (!surface) {
    return { ok: false, code: REJECTION_CODES.EMPTY_AFTER_CLEANING, detail: "Nennung ist nach dem Entfernen von Sigeln und Trennzeichen leer.", surface };
  }
  // Ein Punkt trennt in diesen Editionen Saetze. Was einen Satz enthaelt, ist
  // keine Einzelnennung, sondern ein unzerlegter Rest ("واخرون. وكتب عنه ...").
  if (surface.includes(".")) {
    return { ok: false, code: REJECTION_CODES.UNSEGMENTED_PHRASE, detail: "Nennung enthaelt eine Satzgrenze und ist damit nicht personenscharf zerlegt.", surface };
  }
  const normalized = normalizeSearchText(surface);
  if (!normalized) {
    return { ok: false, code: REJECTION_CODES.EMPTY_AFTER_CLEANING, detail: "Normalisierte Form der Nennung ist leer.", surface };
  }
  if (isRelativeReference(normalized)) {
    return {
      ok: false,
      code: REJECTION_CODES.RELATIVE_FORM,
      detail: "Positionsgebundene Rueckverweisform (z. B. ابيه). Sie benennt keine global adressierbare Person und bekommt deshalb keine kanonische ID.",
      surface,
    };
  }
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length > MAX_NAME_TOKENS) {
    return { ok: false, code: REJECTION_CODES.UNSEGMENTED_PHRASE, detail: `Nennung hat ${tokens.length} Token und ist damit ein Satzrest, keine Einzelnennung.`, surface };
  }
  if (tokens.some((token) => [...token].length === 1)) {
    return {
      ok: false,
      code: REJECTION_CODES.UNSEGMENTED_PHRASE,
      detail: "Nennung enthaelt einen einbuchstabigen Werk-/Quellensigelrest und ist nicht personenscharf.",
      surface,
    };
  }
  const head = COLLECTIVE_LEADING_PARTICLES.has(tokens[0]) && tokens.length > 1 ? tokens[1] : tokens[0];
  const headWithoutConjunction = head.startsWith("و") && head.length > 2 ? head.slice(1) : head;
  if (COLLECTIVE_HEAD_TOKENS.has(head) || COLLECTIVE_HEAD_TOKENS.has(headWithoutConjunction)) {
    return { ok: false, code: REJECTION_CODES.NO_PERSON_NAMED, detail: "Restmengenangabe („und andere“) ohne benannte Person.", surface };
  }
  if (RELATIVE_MENTION_HEADS.has(tokens[0])) {
    return {
      ok: false,
      code: REJECTION_CODES.RELATIVE_FORM,
      detail: "Relative oder duale Familiennennung ohne eigenstaendigen, personenscharfen Namenskopf.",
      surface,
    };
  }
  if (NON_NAME_HEAD_TOKENS.has(tokens[0])) {
    return {
      ok: false,
      code: REJECTION_CODES.UNSEGMENTED_PHRASE,
      detail: `Nennung beginnt mit dem Aussage-/Kommentarwort „${tokens[0]}“ und ist kein personenscharfer Namenskopf.`,
      surface,
    };
  }
  const internalNonNameToken = tokens.slice(1).find((token) => NON_NAME_INTERNAL_TOKENS.has(token));
  if (internalNonNameToken) {
    return {
      ok: false,
      code: REJECTION_CODES.UNSEGMENTED_PHRASE,
      detail: `Nennung geht bei „${internalNonNameToken}“ in einen Satzrest ueber und ist nicht personenscharf.`,
      surface,
    };
  }
  if (INTERNAL_STRUCTURE.test(surface)) {
    return {
      ok: false,
      code: REJECTION_CODES.UNSEGMENTED_PHRASE,
      detail: "Nennung enthaelt einen redaktionellen Zusatz oder einen unvollstaendigen Markuprest.",
      surface,
    };
  }
  for (let tokenIndex = 1; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    if (
      token.startsWith("و")
      && token.length > 2
      && !W_TOKEN_EXCEPTIONS.has(token)
      && !W_NAME_PREDECESSORS.has(tokens[tokenIndex - 1])
    ) {
      return {
        ok: false,
        code: REJECTION_CODES.UNSEGMENTED_PHRASE,
        detail: `Nennung enthaelt bei „${token}“ mehrere Personen oder einen nicht abgetrennten Kommentar.`,
        surface,
      };
    }
  }
  const clusterId = clusterIdForName(normalized);
  if (clusterId === null) {
    return { ok: false, code: REJECTION_CODES.EMPTY_AFTER_CLEANING, detail: "Aus der Nennung laesst sich keine Namensidentitaet bilden.", surface };
  }
  // Quellenbindung: die bereinigte Form muss wortwoertlich im Eintragstext
  // stehen. Erst das macht die Fundstelle nachpruefbar statt behauptet.
  if (!entryText || !entryText.includes(surface)) {
    return {
      ok: false,
      code: entryText ? REJECTION_CODES.PHRASE_NOT_IN_PASSAGE : REJECTION_CODES.ENTRY_TEXT_MISSING,
      detail: entryText
        ? "Bereinigte Nennung steht nicht wortwoertlich im Eintragstext; die Fundstelle waere nicht nachpruefbar."
        : "Zum Eintrag liegt kein Quelltext vor, an dem die Nennung belegt werden koennte.",
      surface,
    };
  }
  return { ok: true, surface, normalized, clusterId };
}

/**
 * Zerlegt einen Rijāl-Eintrag in personenscharfe Aussagekandidaten und
 * zurueckgewiesene Nennungen.
 *
 * `relationshipType` folgt der Leserichtung des Eintrags: unter „Lehrer" steht,
 * von wem die Person des Eintrags gehoert hat -- Subjekt ist die genannte
 * Person, Objekt die Person des Eintrags, Typ `teacher`. Unter „Schueler"
 * umgekehrt. Die Kante zeigt also immer vom Lehrer zum Schueler, unabhaengig
 * davon, in welcher Liste die Nennung stand.
 *
 * @param {object} entry Eintrag aus .cache/turath-derived/<quelle>.json
 * @param {string} entry.id
 * @param {string} entry.nameSurfaceNormalizedHead bereits normalisierter, randbereinigter Namenskopf
 * @param {string} entry.entryText
 * @param {string[]} entry.teacherMentions
 * @param {string[]} entry.studentMentions
 * @returns {{ accepted: Array<object>, rejected: Array<object> }}
 */
export function extractRijalStatements(entry) {
  const accepted = [];
  const rejected = [];
  const subjectNormalized = entry.nameSurfaceNormalizedHead ?? "";
  const entryText = entry.entryText ?? "";
  const subjectClusterId = clusterIdForName(subjectNormalized);

  const lists = [
    ["teacher", entry.teacherMentions ?? []],
    ["student", entry.studentMentions ?? []],
  ];

  if (subjectClusterId === null) {
    for (const [listKind, mentions] of lists) {
      mentions.forEach((raw, index) => {
        rejected.push({
          entryId: entry.id,
          listKind,
          index,
          rawMention: String(raw ?? ""),
          surface: "",
          code: REJECTION_CODES.SUBJECT_NOT_NAMED,
          detail: "Der Eintrag selbst hat keinen auswertbaren Namenskopf; ohne benanntes Subjekt gibt es keine Kante.",
        });
      });
    }
    return { accepted, rejected };
  }

  const seen = new Set();
  for (const [listKind, mentions] of lists) {
    mentions.forEach((raw, index) => {
      const verdict = evaluateMention(raw, index, entryText);
      if (!verdict.ok) {
        rejected.push({ entryId: entry.id, listKind, index, rawMention: String(raw ?? ""), surface: verdict.surface, code: verdict.code, detail: verdict.detail });
        return;
      }
      if (verdict.clusterId === subjectClusterId) {
        rejected.push({
          entryId: entry.id,
          listKind,
          index,
          rawMention: String(raw ?? ""),
          surface: verdict.surface,
          code: REJECTION_CODES.SELF_REFERENCE,
          detail: "Nennung faellt mit der Person des Eintrags zusammen; eine Kante auf sich selbst ist keine Ueberlieferungsbeziehung.",
        });
        return;
      }
      // Lehrerliste: die genannte Person ist der Lehrer. Schuelerliste: die
      // Person des Eintrags ist der Lehrer.
      const teacherClusterId = listKind === "teacher" ? verdict.clusterId : subjectClusterId;
      const studentClusterId = listKind === "teacher" ? subjectClusterId : verdict.clusterId;
      const dedupeKey = `${teacherClusterId}>${studentClusterId}`;
      if (seen.has(dedupeKey)) {
        rejected.push({
          entryId: entry.id,
          listKind,
          index,
          rawMention: String(raw ?? ""),
          surface: verdict.surface,
          code: REJECTION_CODES.DUPLICATE,
          detail: "Dieselbe Beziehung ist in diesem Eintrag bereits belegt; die Wiederholung erzeugt keine zweite Kante.",
        });
        return;
      }
      seen.add(dedupeKey);
      accepted.push({
        entryId: entry.id,
        listKind,
        index,
        rawMention: String(raw ?? ""),
        surface: verdict.surface,
        normalized: verdict.normalized,
        mentionClusterId: verdict.clusterId,
        subjectClusterId: teacherClusterId,
        objectClusterId: studentClusterId,
        relationshipType: "teacher",
      });
    });
  }
  return { accepted, rejected };
}

export const internal = {
  COLLECTIVE_HEAD_TOKENS,
  COLLECTIVE_LEADING_PARTICLES,
  NON_NAME_HEAD_TOKENS,
  NON_NAME_INTERNAL_TOKENS,
  RELATIVE_MENTION_HEADS,
  W_NAME_PREDECESSORS,
  W_TOKEN_EXCEPTIONS,
  MAX_NAME_TOKENS,
};
