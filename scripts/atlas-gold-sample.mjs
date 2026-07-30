#!/usr/bin/env node
/**
 * Ziehung der Goldstichproben (Umsetzungsplan P4.7, P6.3, P1.1).
 *
 * Dieses Skript zieht AUSSCHLIESSLICH die Rahmen (frames). Es urteilt nicht.
 * Ein Rahmen enthaelt: die gezogene Einheit, den Rohtext aus dem Editionsdruck
 * und — als Vergleichsgroesse — die Ausgabe des Importers. Die Golddatei mit
 * den Urteilen liegt getrennt (`data/gold/<name>.gold.json`) und wird von
 * diesem Skript niemals geschrieben oder ueberschrieben.
 *
 * WARUM GETRENNT: Ein Goldbestand, der aus der Ausgabe des zu bewertenden
 * Systems entsteht, misst nur, ob das System mit sich selbst uebereinstimmt.
 * Die Rahmenziehung darf Systemausgaben benutzen (sie definiert nur, WAS
 * angesehen wird); das Urteil darf es nicht (es definiert, was RICHTIG ist).
 * Jede Golddatei nennt diese Grenze in ihrem `provenance`-Block ausdruecklich.
 *
 * Reproduzierbarkeit: alle Ziehungen laufen ueber einen benannten Seed und
 * einen deterministischen PRNG (mulberry32, aus FNV-1a-32 des Seedstrings).
 * Vor jeder Ziehung wird die Grundgesamtheit nach einem stabilen Schluessel
 * sortiert. Gleicher Seed + gleiche Rohdaten = gleiche Stichprobe. Das Skript
 * schreibt zu jedem Rahmen den SHA-256 der gezogenen ID-Liste; die Pruefung in
 * `data/gold/check-gold.mjs` vergleicht ihn.
 *
 * Aufruf:
 *   node scripts/atlas-gold-sample.mjs            # alle Rahmen schreiben
 *   node scripts/atlas-gold-sample.mjs --check    # nur pruefen, nichts schreiben
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeRelativeForm, RELATIVE_FORM_VERSION } from "./atlas-relative-forms.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const derivedDir = resolve(projectRoot, ".cache/turath-derived");
const rawDir = resolve(projectRoot, ".cache/turath");
const goldDir = resolve(projectRoot, "data/gold");

/** Ein einziger Seed fuer alle Ziehungen dieses Pakets. Aenderung = neue Stichprobe. */
export const GOLD_SEED = "sanad-atlas/gold/2026-07-30";
export const SAMPLER_VERSION = "atlas-gold-sample-1.0.0";
export const P47_SAMPLER_VERSION = "atlas-gold-sample-p47-1.1.0";

/* ── deterministischer Zufall ──────────────────────────────────────────────── */

function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32 — 32 Bit Zustand, keine Abhaengigkeit, exakt reproduzierbar. */
export function makeRandom(seedText) {
  let state = fnv1a32(seedText);
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates auf einer Kopie; die Eingabe muss vorher stabil sortiert sein. */
export function shuffled(items, seedText) {
  const random = makeRandom(seedText);
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

/**
 * Stratifizierte Ziehung mit Mindestbelegung.
 *
 * Jede nichtleere Zelle bekommt zuerst `minPerCell` Einheiten (oder alles, was
 * sie hat), der Rest wird nach Zellgroesse mit groesstem Rest verteilt. Seltene
 * Zellen sind damit ABSICHTLICH ueberrepraesentiert — anders waeren Relativform
 * und Homonym nicht messbar. Damit die Stichprobe trotzdem etwas ueber die
 * Grundgesamtheit sagen kann, traegt jede Einheit ihr Ziehungsgewicht
 * (`inclusionWeight` = Zellgroesse / gezogene Einheiten der Zelle).
 */
export function stratifiedSample(units, keyOf, total, seedText, minPerCell = 1) {
  const cells = new Map();
  for (const unit of units) {
    const key = keyOf(unit);
    const list = cells.get(key);
    if (list) list.push(unit);
    else cells.set(key, [unit]);
  }
  const cellKeys = [...cells.keys()].sort();
  const quota = new Map();
  let assigned = 0;
  for (const key of cellKeys) {
    const take = Math.min(minPerCell, cells.get(key).length);
    quota.set(key, take);
    assigned += take;
  }
  let remaining = total - assigned;
  if (remaining > 0) {
    const free = cellKeys.map((key) => ({ key, free: cells.get(key).length - quota.get(key) }));
    const freeTotal = free.reduce((sum, item) => sum + item.free, 0);
    const shares = free.map((item) => ({ ...item, exact: freeTotal ? (item.free * remaining) / freeTotal : 0 }));
    for (const share of shares) {
      const take = Math.min(share.free, Math.floor(share.exact));
      quota.set(share.key, quota.get(share.key) + take);
      remaining -= take;
    }
    const byRemainder = shares
      .map((share) => ({ ...share, rest: share.exact - Math.floor(share.exact) }))
      .sort((a, b) => b.rest - a.rest || a.key.localeCompare(b.key));
    for (const share of byRemainder) {
      if (remaining <= 0) break;
      if (quota.get(share.key) >= cells.get(share.key).length) continue;
      quota.set(share.key, quota.get(share.key) + 1);
      remaining -= 1;
    }
    // Zweiter Durchgang, falls einzelne Zellen erschoepft sind.
    while (remaining > 0) {
      let placed = false;
      for (const key of cellKeys) {
        if (remaining <= 0) break;
        if (quota.get(key) >= cells.get(key).length) continue;
        quota.set(key, quota.get(key) + 1);
        remaining -= 1;
        placed = true;
      }
      if (!placed) break;
    }
  }
  const drawn = [];
  for (const key of cellKeys) {
    const take = quota.get(key);
    if (!take) continue;
    const pool = shuffled(cells.get(key), `${seedText}|${key}`);
    for (const unit of pool.slice(0, take)) {
      drawn.push({ unit, stratum: key, cellSize: cells.get(key).length, inclusionWeight: cells.get(key).length / take });
    }
  }
  return drawn;
}

/* ── Merkmale fuer die Schichtung ─────────────────────────────────────────── */

/** Kunya-Marker am Formanfang. Reines Oberflaechenmerkmal der Schichtung. */
export function hasKunya(form) {
  return /^(?:ابو|ابي|اب[ىا]|ام)\s/.test(form.trim());
}

/** Nisba-Marker: ein Token der Gestalt al-…ī. Reines Oberflaechenmerkmal. */
export function hasNisba(form) {
  return form
    .split(/\s+/)
    .some((token) => /^ال.{2,}(?:ي|ية|يه)$/.test(token.replace(/[،.:؛()"«»]/g, "")));
}

export function lengthBand(text, bounds) {
  const size = text.trim().length;
  for (let index = 0; index < bounds.length; index += 1) if (size <= bounds[index]) return `L${index}`;
  return `L${bounds.length}`;
}

/* ── Quellen laden ────────────────────────────────────────────────────────── */

const RIJAL_SOURCES = ["tahdhib", "taqrib", "mizan", "kashif"];
const HADITH_SOURCES = ["bukhari", "muslim"];

function loadDerived(key) {
  const path = resolve(derivedDir, `${key}.json`);
  if (!existsSync(path)) throw new Error(`Abgeleitete Datei fehlt: ${path} — zuerst \`npm run import:turath\` laufen lassen.`);
  return JSON.parse(readFileSync(path, "utf8"));
}

const rawPageCache = new Map();
function rawPages(bookId) {
  if (!rawPageCache.has(bookId)) {
    const path = resolve(rawDir, `${bookId}.json`);
    if (!existsSync(path)) throw new Error(`Rohdatei fehlt: ${path}`);
    rawPageCache.set(bookId, JSON.parse(readFileSync(path, "utf8")).pages);
  }
  return rawPageCache.get(bookId);
}

/** Rohtext aus dem Editionsdruck, nicht die normalisierte Importerfassung. */
function rawExcerpt(bookId, sourcePageId, spanStart, length) {
  const pages = rawPages(bookId);
  const page = pages[sourcePageId - 1];
  if (!page) return null;
  return page.text.slice(spanStart, spanStart + length);
}

/* ── Rahmen 1: Todesjahr-Ausbeute in Tahdhib ──────────────────────────────── */

function frameDeathYear() {
  const book = loadDerived("tahdhib");
  const population = book.entries.length;
  const frame = book.entries
    .filter((entry) => entry.deathYearCandidate === null || entry.deathYearCandidate === undefined)
    .sort((a, b) => a.id.localeCompare(b.id));
  const drawn = shuffled(frame, `${GOLD_SEED}|tahdhib-death-year`).slice(0, 100);
  const items = drawn.map((entry) => ({
    id: entry.id,
    entryNumber: entry.entryNumber,
    sourceId: "tahdhib",
    turathBookId: book.source.turathBookId,
    volume: entry.volume,
    printedPage: entry.printedPage,
    sourcePageId: entry.sourcePageId,
    nameSurface: entry.nameSurface,
    /** Vergleichsgroesse, kein Urteil. */
    parserOutput: {
      deathYearCandidate: entry.deathYearCandidate ?? null,
      deathYearBound: entry.deathYearBound ?? null,
      deathAssertions: (entry.dateAssertions ?? []).filter((item) => item.kind === "death"),
      dateAssertionKinds: (entry.dateAssertions ?? []).map((item) => `${item.kind}:${item.verb}`),
    },
    textLength: entry.text.length,
    /** Der normalisierte Eintragstext, wie er dem Parser vorlag. */
    text: entry.text,
    rawHead: rawExcerpt(book.source.turathBookId, entry.nameSpan?.sourcePageId ?? entry.sourcePageId, entry.nameSpan?.spanStart ?? 0, 160),
  }));
  return {
    name: "tahdhib-death-year",
    question: "Wie viele Tahdhib-Eintraege ohne erkanntes Todesjahr enthalten ueberhaupt eine Sterbeangabe mit bestimmbarem Jahr?",
    population,
    frameSize: frame.length,
    frameDefinition: "tahdhib.entries mit deathYearCandidate === null",
    design: "einfache Zufallsstichprobe ohne Zuruecklegen",
    sampleSize: items.length,
    items,
  };
}

/* ── Rahmen 2: Namenskoepfe ───────────────────────────────────────────────── */

function frameNameHeads() {
  const units = [];
  for (const key of RIJAL_SOURCES) {
    const book = loadDerived(key);
    for (const entry of book.entries) {
      const head = entry.nameSurface ?? "";
      units.push({
        key,
        bookId: book.source.turathBookId,
        entry,
        head,
        stratum: [
          key,
          lengthBand(head, [20, 40, 60]),
          hasKunya(entry.nameSurfaceNormalized ?? "") || entry.kunya ? "K1" : "K0",
          (entry.nisbas ?? []).length ? "N1" : "N0",
        ].join("|"),
      });
    }
  }
  units.sort((a, b) => a.entry.id.localeCompare(b.entry.id));
  const drawn = stratifiedSample(units, (unit) => unit.stratum, 100, `${GOLD_SEED}|rijal-name-heads`, 1);
  const items = drawn.map(({ unit, stratum, cellSize, inclusionWeight }) => {
    const entry = unit.entry;
    const span = entry.nameSpan;
    return {
      id: entry.id,
      sourceId: unit.key,
      turathBookId: unit.bookId,
      entryNumber: entry.entryNumber,
      volume: entry.volume,
      printedPage: entry.printedPage,
      sourcePageId: entry.sourcePageId,
      stratum,
      cellSize,
      inclusionWeight: Number(inclusionWeight.toFixed(4)),
      /** Rohtextausschnitt aus dem Druck, ab Kopfbeginn. Grundlage des Urteils. */
      rawExcerpt: rawExcerpt(unit.bookId, span?.sourcePageId ?? entry.sourcePageId, span?.spanStart ?? 0, 320),
      /** Ausgabe des Importers. Vergleichsgroesse, kein Urteil. */
      extractedHead: entry.nameSurface,
      extractedHeadNormalized: entry.nameSurfaceNormalized,
      headDescriptors: entry.headDescriptors ?? null,
      alternateNameForms: entry.alternateNameForms ?? [],
      kunya: entry.kunya ?? null,
      nisbas: entry.nisbas ?? [],
      headLength: (entry.nameSurface ?? "").length,
      spanIntegrity: span?.integrity ?? null,
    };
  });
  return {
    name: "rijal-name-heads",
    question: "Wie oft ist der vom Importer geschnittene Namenskopf der richtige Namenskopf?",
    population: units.length,
    frameSize: units.length,
    frameDefinition: "alle Rijal-Eintraege aus tahdhib, taqrib, mizan, kashif",
    design: "stratifizierte Ziehung nach Quelle x Kopflaenge(<=20,<=40,<=60,>60) x Kunya x Nisba, Mindestbelegung 1 je nichtleerer Zelle, Rest proportional (groesster Rest)",
    sampleSize: items.length,
    items,
  };
}

/* ── Erzaehlerpositionen aus den Hadithsammlungen ─────────────────────────── */

function collectOccurrences() {
  const occurrences = [];
  for (const key of HADITH_SOURCES) {
    const book = loadDerived(key);
    for (const record of book.records) {
      for (const chain of record.chains ?? []) {
        const positions = chain.narratorOccurrences ?? [];
        positions.forEach((occurrence, index) => {
          occurrences.push({
            sourceId: key,
            turathBookId: book.source.turathBookId,
            recordId: record.id,
            hadithNumber: record.hadithNumber,
            sourcePageId: record.sourcePageId,
            volume: record.volume,
            printedPage: record.printedPage,
            chainId: chain.chainId,
            chainOrder: chain.chainOrder,
            normalizedIsnad: chain.normalizedIsnad,
            rawIsnad: chain.rawIsnad,
            position: occurrence.position,
            rawSurfaceForm: occurrence.rawSurfaceForm,
            form: occurrence.normalizedSurfaceForm ?? "",
            transmissionTerm: occurrence.transmissionTerm ?? null,
            /** Autoritative P4.4-Erkennung, einschliesslich nachgestellter Token. */
            relativeForm: analyzeRelativeForm(occurrence.normalizedSurfaceForm ?? "").isRelativeForm,
            /** Nur Diagnose: Alt-/Importerflag darf die Schichtung nicht steuern. */
            importerRelativeForm: Boolean(occurrence.relativeForm),
            prophetMention: Boolean(occurrence.prophetMention),
            previousForm: positions[index - 1]?.normalizedSurfaceForm ?? null,
            nextForm: positions[index + 1]?.normalizedSurfaceForm ?? null,
          });
        });
      }
    }
  }
  return occurrences;
}

/**
 * Exakte Kopftreffer im Rijal-Bestand. Reiner Zeichenkettenvergleich gegen
 * `nameSurfaceNormalized` und `nameChain` — KEIN Aufruf des Resolvers, kein
 * Scoring. Diese Liste ist Belegmaterial fuer die Annotation, nicht ihr
 * Ergebnis; sie definiert zugleich das Merkmal `homonym` (>= 2 Treffer).
 */
function buildHeadLookup() {
  const byString = new Map();
  for (const key of RIJAL_SOURCES) {
    const book = loadDerived(key);
    for (const entry of book.entries) {
      for (const form of new Set([entry.nameSurfaceNormalized, entry.nameChain].filter(Boolean))) {
        const list = byString.get(form);
        const record = { entryId: entry.id, sourceId: key, entryNumber: entry.entryNumber, head: entry.nameSurface, deathYear: entry.deathYearCandidate ?? null };
        if (list) list.push(record);
        else byString.set(form, [record]);
      }
    }
  }
  return byString;
}

function occurrenceStratum(occurrence, headLookup) {
  const matches = headLookup.get(occurrence.form) ?? [];
  return [
    lengthBand(occurrence.form, [12, 25]),
    hasKunya(occurrence.form) ? "K1" : "K0",
    hasNisba(occurrence.form) ? "N1" : "N0",
    occurrence.relativeForm ? "R1" : "R0",
    matches.length >= 2 ? "H1" : "H0",
  ].join("|");
}

function occurrenceItem(occurrence, headLookup, stratum, cellSize, inclusionWeight) {
  const matches = headLookup.get(occurrence.form) ?? [];
  return {
    id: `${occurrence.chainId}#p${occurrence.position}`,
    sourceId: occurrence.sourceId,
    recordId: occurrence.recordId,
    hadithNumber: occurrence.hadithNumber,
    volume: occurrence.volume,
    printedPage: occurrence.printedPage,
    chainId: occurrence.chainId,
    position: occurrence.position,
    stratum,
    cellSize,
    inclusionWeight: Number(inclusionWeight.toFixed(4)),
    rawSurfaceForm: occurrence.rawSurfaceForm,
    form: occurrence.form,
    transmissionTerm: occurrence.transmissionTerm,
    previousForm: occurrence.previousForm,
    nextForm: occurrence.nextForm,
    /** Kettenkontext, gekuerzt auf das fuer das Urteil Noetige. */
    isnadContext: (occurrence.normalizedIsnad ?? "").slice(0, 420),
    /** Importerfelder. Vergleichsgroessen, keine Urteile. */
    importerFlags: { relativeForm: occurrence.importerRelativeForm, prophetMention: occurrence.prophetMention },
    samplingFlags: { relativeForm: occurrence.relativeForm, relativeFormVersion: RELATIVE_FORM_VERSION },
    /** Belegmaterial: exakte Kopftreffer im Rijal-Bestand (reiner Stringvergleich). */
    exactHeadMatches: matches.slice(0, 8),
    exactHeadMatchCount: matches.length,
  };
}

function frameHadithOccurrences() {
  const headLookup = buildHeadLookup();
  const all = collectOccurrences().filter((occurrence) => !occurrence.prophetMention && occurrence.form);
  all.sort((a, b) => a.chainId.localeCompare(b.chainId) || a.position - b.position);
  const drawn = stratifiedSample(all, (occurrence) => occurrenceStratum(occurrence, headLookup), 250, `${GOLD_SEED}|hadith-occurrences`, 1);
  const items = drawn.map(({ unit, stratum, cellSize, inclusionWeight }) => occurrenceItem(unit, headLookup, stratum, cellSize, inclusionWeight));
  return {
    name: "hadith-occurrences",
    question: "Trifft der Resolver je Erzaehlerposition die richtige Entscheidung — Person, Abstinenz oder Konflikt?",
    population: all.length,
    frameSize: all.length,
    frameDefinition: "alle narratorOccurrences aus bukhari und muslim mit prophetMention !== true und nichtleerer normalisierter Form",
    design: "stratifizierte Ziehung nach Namenslaenge(<=12,<=25,>25) x Kunya x Nisba x Relativform x Homonym(>=2 exakte Kopftreffer), Mindestbelegung 1, Rest proportional",
    sampleSize: items.length,
    items,
  };
}

function frameNarratorForms() {
  const headLookup = buildHeadLookup();
  const all = collectOccurrences().filter((occurrence) => !occurrence.prophetMention && occurrence.form);
  const byForm = new Map();
  for (const occurrence of all) {
    const list = byForm.get(occurrence.form);
    if (list) list.push(occurrence);
    else byForm.set(occurrence.form, [occurrence]);
  }
  const forms = [...byForm.entries()]
    .map(([form, positions]) => ({
      form,
      occurrences: positions.length,
      representative: positions[0],
      positions: positions.slice(0, 5).map((item) => ({ chainId: item.chainId, position: item.position })),
      relativeForm: positions.some((item) => item.relativeForm),
    }))
    .sort((a, b) => a.form.localeCompare(b.form));
  const drawn = stratifiedSample(
    forms,
    (entry) => occurrenceStratum({ form: entry.form, relativeForm: entry.relativeForm }, headLookup),
    100,
    `${GOLD_SEED}|narrator-forms`,
    1,
  );
  const items = drawn.map(({ unit, stratum, cellSize, inclusionWeight }) => {
    const base = occurrenceItem(unit.representative, headLookup, stratum, cellSize, inclusionWeight);
    return {
      ...base,
      id: `form:${unit.form}`,
      occurrenceCount: unit.occurrences,
      samplePositions: unit.positions,
    };
  });
  return {
    name: "narrator-forms",
    question: "Trifft der Resolver je distinkter Namensform die richtige Entscheidung?",
    population: forms.length,
    frameSize: forms.length,
    frameDefinition: "distinkte normalisierte Namensformen aus bukhari und muslim, ohne prophetMention",
    design: "stratifizierte Ziehung nach denselben fuenf Merkmalen wie hadith-occurrences, Mindestbelegung 1, Rest proportional",
    sampleSize: items.length,
    items,
  };
}

/* ── Schreiben ────────────────────────────────────────────────────────────── */

export function frameDigest(frame) {
  return createHash("sha256").update(frame.items.map((item) => item.id).join("\n")).digest("hex").slice(0, 32);
}

function writeFrame(frame, check) {
  const path = resolve(goldDir, `${frame.name}.frame.json`);
  const isP47 = frame.name === "hadith-occurrences" || frame.name === "narrator-forms";
  const payload = {
    provenance: {
      producedBy: `scripts/atlas-gold-sample.mjs (${isP47 ? P47_SAMPLER_VERSION : SAMPLER_VERSION})`,
      seed: GOLD_SEED,
      drawnAt: "deterministisch — der Datenstand, nicht die Uhrzeit, bestimmt das Ergebnis",
      inputs: {
        derived: ".cache/turath-derived/*.json (Ausgabe von scripts/import-turath-corpus.mjs)",
        raw: ".cache/turath/<turathBookId>.json (Editionstext, Turath)",
      },
      boundary:
        "Dieser Rahmen benutzt Importerausgaben, um zu bestimmen WAS angesehen wird. Die Urteile in der zugehoerigen .gold.json duerfen nicht daraus abgeleitet werden.",
      ...(isP47 ? { relativeFormStratifier: RELATIVE_FORM_VERSION } : {}),
      digest: "",
    },
    question: frame.question,
    population: frame.population,
    frameSize: frame.frameSize,
    frameDefinition: frame.frameDefinition,
    design: frame.design,
    sampleSize: frame.sampleSize,
    items: frame.items,
  };
  payload.provenance.digest = frameDigest(frame);
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  if (check) {
    if (!existsSync(path)) return { path, status: "fehlt", digest: payload.provenance.digest };
    const current = readFileSync(path, "utf8");
    return { path, status: current === text ? "gleich" : "abweichend", digest: payload.provenance.digest };
  }
  mkdirSync(goldDir, { recursive: true });
  writeFileSync(path, text);
  return { path, status: "geschrieben", digest: payload.provenance.digest, size: frame.items.length };
}

const FRAMES = [frameDeathYear, frameNameHeads, frameHadithOccurrences, frameNarratorForms];

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check");
  for (const build of FRAMES) {
    const frame = build();
    const result = writeFrame(frame, check);
    process.stdout.write(
      `${frame.name}: Grundgesamtheit ${frame.population}, Rahmen ${frame.frameSize}, gezogen ${frame.sampleSize} — ${result.status} (${result.digest})\n`,
    );
  }
}

export { frameDeathYear, frameNameHeads, frameHadithOccurrences, frameNarratorForms, FRAMES };
