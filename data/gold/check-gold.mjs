#!/usr/bin/env node
/**
 * P4.7-Integritaets- und Metrikpruefung.
 *
 * Ohne --strict prueft das Skript die Stichprobenrahmen und berichtet fehlende
 * menschliche Arbeit als Blocker, ohne einen roten Exitcode zu erzeugen.
 * Mit --strict sind A1, A2, Adjudikation und Resolverausgabe Pflicht; dieser
 * Modus ist das vorgesehene CI-Gate.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const goldDir = dirname(fileURLToPath(import.meta.url));
const strict = process.argv.includes("--strict");
const jsonOnly = process.argv.includes("--json");

const TASKS = [
  { name: "hadith-occurrences", expectedSize: 250 },
  { name: "narrator-forms", expectedSize: 100 },
];
const GOLD_DECISIONS = new Set(["linked", "ambiguous", "not-a-narrator", "invalid-frame"]);
const PREDICTION_DECISIONS = new Set(["linked", "abstain", "conflict"]);
const STRATUM_PARTS = [
  ["length", /^L[012]$/],
  ["kunya", /^K[01]$/],
  ["nisba", /^N[01]$/],
  ["relative", /^R[01]$/],
  ["homonym", /^H[01]$/],
];

const errors = [];
const blockers = [];
const report = {
  status: "incomplete",
  strict,
  frames: {},
  agreement: {},
  metrics: {},
  blockers,
  errors,
};

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${path}: unlesbares JSON (${error.message})`);
    return null;
  }
}

function digestIds(items) {
  return createHash("sha256").update(items.map((item) => item.id).join("\n")).digest("hex").slice(0, 32);
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function exactSet(label, actual, expected) {
  const missing = [...expected].filter((value) => !actual.has(value));
  const extra = [...actual].filter((value) => !expected.has(value));
  if (missing.length) errors.push(`${label}: ${missing.length} Rahmen-IDs fehlen (erste: ${missing.slice(0, 3).join(", ")})`);
  if (extra.length) errors.push(`${label}: ${extra.length} unbekannte IDs (erste: ${extra.slice(0, 3).join(", ")})`);
}

function marginalCounts(items) {
  const counts = Object.fromEntries(STRATUM_PARTS.map(([name]) => [name, {}]));
  for (const item of items) {
    const parts = String(item.stratum ?? "").split("|");
    STRATUM_PARTS.forEach(([name], index) => {
      const value = parts[index] ?? "missing";
      counts[name][value] = (counts[name][value] ?? 0) + 1;
    });
  }
  return counts;
}

function loadFrames() {
  const frames = new Map();
  for (const task of TASKS) {
    const path = resolve(goldDir, `${task.name}.frame.json`);
    const frame = readJson(path);
    if (!frame) continue;
    const items = Array.isArray(frame.items) ? frame.items : [];
    if (frame.sampleSize !== task.expectedSize || items.length !== task.expectedSize) {
      errors.push(`${task.name}: erwartet ${task.expectedSize}, sampleSize=${frame.sampleSize}, items=${items.length}`);
    }
    const ids = items.map((item) => item.id);
    const duplicates = duplicateValues(ids);
    if (duplicates.length) errors.push(`${task.name}: doppelte IDs (${duplicates.slice(0, 3).join(", ")})`);
    const digest = digestIds(items);
    if (frame.provenance?.digest !== digest) {
      errors.push(`${task.name}: Frame-Digest ${frame.provenance?.digest ?? "fehlt"} stimmt nicht mit ${digest} ueberein`);
    }
    for (const item of items) {
      const parts = String(item.stratum ?? "").split("|");
      if (parts.length !== STRATUM_PARTS.length) {
        errors.push(`${task.name}/${item.id}: Stratum braucht fuenf Teile`);
        continue;
      }
      STRATUM_PARTS.forEach(([name, pattern], index) => {
        if (!pattern.test(parts[index])) errors.push(`${task.name}/${item.id}: ungueltiges ${name}-Stratum ${parts[index]}`);
      });
      if (!(Number(item.cellSize) >= 1) || !(Number(item.inclusionWeight) >= 1)) {
        errors.push(`${task.name}/${item.id}: ungueltige Zellgroesse oder Ziehungsgewicht`);
      }
      if (item.samplingFlags?.relativeFormVersion === undefined) {
        errors.push(`${task.name}/${item.id}: Version der Relativform-Schichtung fehlt`);
      }
    }
    const byCell = new Map();
    for (const item of items) {
      if (!byCell.has(item.stratum)) byCell.set(item.stratum, []);
      byCell.get(item.stratum).push(item);
    }
    let coveredPopulation = 0;
    for (const [stratum, cellItems] of byCell) {
      const cellSizes = new Set(cellItems.map((item) => item.cellSize));
      if (cellSizes.size !== 1) errors.push(`${task.name}/${stratum}: widerspruechliche cellSize-Werte`);
      const cellSize = Number(cellItems[0].cellSize);
      coveredPopulation += cellSize;
      const expectedWeight = cellSize / cellItems.length;
      for (const item of cellItems) {
        if (Math.abs(Number(item.inclusionWeight) - expectedWeight) > 0.00011) {
          errors.push(`${task.name}/${item.id}: inclusionWeight passt nicht zu Zellgroesse/Stichprobenzahl`);
        }
      }
    }
    if (coveredPopulation !== frame.population || frame.frameSize !== frame.population) {
      errors.push(
        `${task.name}: Samplingzellen decken ${coveredPopulation}, population=${frame.population}, frameSize=${frame.frameSize}`,
      );
    }
    const marginals = marginalCounts(items);
    for (const [name, pattern] of STRATUM_PARTS) {
      const levels = Object.keys(marginals[name]).filter((value) => pattern.test(value));
      if (levels.length < 2) errors.push(`${task.name}: ${name} ist in der Stichprobe nicht mit beiden Auspraegungen vertreten`);
    }
    frames.set(task.name, frame);
    report.frames[task.name] = {
      population: frame.population,
      sampleSize: items.length,
      digest,
      marginalSampleCounts: marginals,
      compositeCells: byCell.size,
      coveredPopulation,
    };
  }
  return frames;
}

function validateGoldItem(item, label) {
  if (!item || typeof item !== "object") {
    errors.push(`${label}: Eintrag ist kein Objekt`);
    return false;
  }
  if (!GOLD_DECISIONS.has(item.decision)) errors.push(`${label}: ungueltige Entscheidung ${item.decision}`);
  const linked = item.decision === "linked";
  if (linked && !(typeof item.narratorId === "string" && /^SA-P-[A-Z2-7]{8}$/.test(item.narratorId))) {
    errors.push(`${label}: linked braucht eine stabile narratorId im Format SA-P-<base32(8)>`);
  }
  if (linked && !(Number.isInteger(item.narratorRevision) && item.narratorRevision >= 1)) {
    errors.push(`${label}: linked braucht eine positive narratorRevision`);
  }
  if (!linked && item.narratorId !== null) errors.push(`${label}: ${item.decision} darf keine narratorId tragen`);
  if (!linked && item.narratorRevision !== null) errors.push(`${label}: ${item.decision} darf keine narratorRevision tragen`);
  if (!Array.isArray(item.evidenceReferences) || item.evidenceReferences.length === 0) {
    errors.push(`${label}: mindestens eine konkrete evidenceReference ist Pflicht`);
  }
  if (!(typeof item.rationale === "string" && item.rationale.trim())) errors.push(`${label}: fachliche Begruendung fehlt`);
  return GOLD_DECISIONS.has(item.decision);
}

function loadAnnotation(taskName, suffix, frame) {
  const path = resolve(goldDir, `${taskName}.${suffix}.json`);
  if (!existsSync(path)) {
    blockers.push(`${taskName}.${suffix}.json fehlt`);
    return null;
  }
  const data = readJson(path);
  if (!data) return null;
  const expectedType = suffix === "adjudication" ? "adjudication" : "independent-annotation";
  if (data.artifactType !== expectedType) errors.push(`${taskName}.${suffix}: artifactType muss ${expectedType} sein`);
  if (data.schemaVersion !== "p47-gold-1.0.0") errors.push(`${taskName}.${suffix}: unbekannte schemaVersion`);
  if (data.task !== taskName) errors.push(`${taskName}.${suffix}: falsche Aufgabe ${data.task}`);
  if (data.frameDigest !== frame.provenance.digest) errors.push(`${taskName}.${suffix}: falscher Frame-Digest`);
  if (expectedType === "independent-annotation") {
    if (!(typeof data.annotator === "string" && data.annotator.trim())) errors.push(`${taskName}.${suffix}: annotator fehlt`);
    if (data.blindToOtherAnnotation !== true) errors.push(`${taskName}.${suffix}: blindToOtherAnnotation muss true sein`);
    if (data.blindToSystemPredictions !== true) errors.push(`${taskName}.${suffix}: blindToSystemPredictions muss true sein`);
  }
  const items = Array.isArray(data.items) ? data.items : [];
  const duplicates = duplicateValues(items.map((item) => item.id));
  if (duplicates.length) errors.push(`${taskName}.${suffix}: doppelte IDs (${duplicates.slice(0, 3).join(", ")})`);
  exactSet(
    `${taskName}.${suffix}`,
    new Set(items.map((item) => item.id)),
    new Set(frame.items.map((item) => item.id)),
  );
  for (const item of items) validateGoldItem(item, `${taskName}.${suffix}/${item.id ?? "ohne-id"}`);
  return data;
}

function goldLabel(item) {
  return item.decision === "linked" ? `linked:${item.narratorId}@r${item.narratorRevision}` : item.decision;
}

function cohenKappa(itemsA, itemsB) {
  const labels = [...GOLD_DECISIONS];
  const countA = new Map(labels.map((label) => [label, 0]));
  const countB = new Map(labels.map((label) => [label, 0]));
  let observed = 0;
  for (let index = 0; index < itemsA.length; index += 1) {
    const a = itemsA[index].decision;
    const b = itemsB[index].decision;
    countA.set(a, (countA.get(a) ?? 0) + 1);
    countB.set(b, (countB.get(b) ?? 0) + 1);
    if (a === b) observed += 1;
  }
  const n = itemsA.length;
  if (!n) return null;
  const po = observed / n;
  const pe = labels.reduce((sum, label) => sum + ((countA.get(label) ?? 0) / n) * ((countB.get(label) ?? 0) / n), 0);
  return pe === 1 ? null : (po - pe) / (1 - pe);
}

function agreement(taskName, a1, a2) {
  if (!a1 || !a2) return null;
  if (a1.annotator === a2.annotator) errors.push(`${taskName}: A1 und A2 muessen verschiedene Annotatoren sein`);
  const byIdB = new Map(a2.items.map((item) => [item.id, item]));
  const pairs = a1.items.map((item) => [item, byIdB.get(item.id)]).filter((pair) => pair[1]);
  const exact = pairs.filter(([left, right]) => goldLabel(left) === goldLabel(right)).length;
  return {
    n: pairs.length,
    decisionClassKappa: cohenKappa(pairs.map(([left]) => left), pairs.map(([, right]) => right)),
    exactIdentityAgreement: pairs.length ? exact / pairs.length : null,
    exactIdentityAgreements: exact,
    disagreements: pairs.length - exact,
  };
}

function validateAdjudication(taskName, adjudication, a1, a2) {
  if (!adjudication || !a1 || !a2) return;
  const byA = new Map(a1.items.map((item) => [item.id, item]));
  const byB = new Map(a2.items.map((item) => [item.id, item]));
  for (const item of adjudication.items) {
    const left = byA.get(item.id);
    const right = byB.get(item.id);
    if (!left || !right) continue;
    const same = goldLabel(left) === goldLabel(right);
    if (same && item.method !== "agreement") errors.push(`${taskName}.adjudication/${item.id}: identische Labels brauchen method=agreement`);
    if (!same && item.method !== "adjudicated") errors.push(`${taskName}.adjudication/${item.id}: Dissens braucht method=adjudicated`);
    if (item.method === "agreement") {
      if (item.adjudicator !== null) errors.push(`${taskName}.adjudication/${item.id}: agreement braucht adjudicator=null`);
      if (goldLabel(item) !== goldLabel(left)) errors.push(`${taskName}.adjudication/${item.id}: agreement darf das gemeinsame Label nicht aendern`);
    } else if (!(typeof item.adjudicator === "string" && item.adjudicator.trim())) {
      errors.push(`${taskName}.adjudication/${item.id}: adjudicator fehlt`);
    } else if (item.adjudicator === a1.annotator || item.adjudicator === a2.annotator) {
      errors.push(`${taskName}.adjudication/${item.id}: dritte Person fuer Adjudikation erforderlich`);
    }
  }
}

function loadPredictions(frames) {
  const path = resolve(goldDir, "resolver-predictions.json");
  if (!existsSync(path)) {
    blockers.push("resolver-predictions.json fehlt");
    return null;
  }
  const data = readJson(path);
  if (!data) return null;
  if (data.artifactType !== "resolver-predictions") errors.push("resolver-predictions: falscher artifactType");
  if (data.schemaVersion !== "p47-gold-1.0.0") errors.push("resolver-predictions: unbekannte schemaVersion");
  if (!(typeof data.resolverVersion === "string" && data.resolverVersion.trim())) errors.push("resolver-predictions: resolverVersion fehlt");
  if (!(typeof data.weightProfileVersion === "string" && data.weightProfileVersion.trim())) errors.push("resolver-predictions: weightProfileVersion fehlt");
  const expectedKeys = new Set();
  for (const [taskName, frame] of frames) {
    if (data.frameDigests?.[taskName] !== frame.provenance.digest) errors.push(`resolver-predictions: falscher Digest fuer ${taskName}`);
    for (const item of frame.items) expectedKeys.add(`${taskName}\u0000${item.id}`);
  }
  const items = Array.isArray(data.items) ? data.items : [];
  const actualKeys = new Set();
  for (const item of items) {
    const key = `${item.task}\u0000${item.id}`;
    if (actualKeys.has(key)) errors.push(`resolver-predictions: doppelte Vorhersage fuer ${item.task}/${item.id}`);
    actualKeys.add(key);
    if (!PREDICTION_DECISIONS.has(item.decision)) errors.push(`resolver-predictions/${item.id}: ungueltige Entscheidung`);
    if (item.decision === "linked" && !(typeof item.narratorId === "string" && /^SA-P-[A-Z2-7]{8}$/.test(item.narratorId))) {
      errors.push(`resolver-predictions/${item.id}: linked braucht narratorId im Format SA-P-<base32(8)>`);
    }
    if (item.decision === "linked" && !(Number.isInteger(item.narratorRevision) && item.narratorRevision >= 1)) {
      errors.push(`resolver-predictions/${item.id}: linked braucht narratorRevision`);
    }
    if (item.decision !== "linked" && item.narratorId !== null) errors.push(`resolver-predictions/${item.id}: ${item.decision} darf keine narratorId tragen`);
    if (item.decision !== "linked" && item.narratorRevision !== null) errors.push(`resolver-predictions/${item.id}: ${item.decision} darf keine narratorRevision tragen`);
  }
  exactSet("resolver-predictions", actualKeys, expectedKeys);
  return data;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function scoreGroup(rows, weighted) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let linkedPredictions = 0;
  let conflictPredictions = 0;
  let total = 0;
  for (const row of rows) {
    const weight = weighted ? Number(row.frame.inclusionWeight) : 1;
    total += weight;
    const truthLinked = row.truth.decision === "linked";
    const predictedLinked = row.prediction.decision === "linked";
    if (predictedLinked) linkedPredictions += weight;
    if (row.prediction.decision === "conflict") conflictPredictions += weight;
    if (
      truthLinked
      && predictedLinked
      && row.truth.narratorId === row.prediction.narratorId
      && row.truth.narratorRevision === row.prediction.narratorRevision
    ) tp += weight;
    else {
      if (predictedLinked) fp += weight;
      if (truthLinked) fn += weight;
    }
  }
  return {
    n: rows.length,
    tp,
    fp,
    fn,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    linkedCoverage: ratio(linkedPredictions, total),
    abstentionRate: ratio(total - linkedPredictions, total),
    conflictRate: ratio(conflictPredictions, total),
  };
}

function metricGroups(frame, truth, predictions, taskName) {
  const byTruth = new Map(truth.items.map((item) => [item.id, item]));
  const byPrediction = new Map(predictions.items.filter((item) => item.task === taskName).map((item) => [item.id, item]));
  const rows = frame.items.map((item) => ({ frame: item, truth: byTruth.get(item.id), prediction: byPrediction.get(item.id) }));
  if (rows.some((row) => !row.truth || !row.prediction)) return null;
  const groups = new Map([["overall", rows]]);
  for (const row of rows) {
    const names = [`composite:${row.frame.stratum}`];
    const parts = row.frame.stratum.split("|");
    STRATUM_PARTS.forEach(([name], index) => names.push(`${name}:${parts[index]}`));
    for (const name of names) {
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(row);
    }
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, groupRows]) => [name, {
        unweighted: scoreGroup(groupRows, false),
        weightedByInclusion: scoreGroup(groupRows, true),
      }]),
  );
}

const frames = loadFrames();
const completed = new Map();

for (const task of TASKS) {
  const frame = frames.get(task.name);
  if (!frame) continue;
  const a1 = loadAnnotation(task.name, "annotation-a1", frame);
  const a2 = loadAnnotation(task.name, "annotation-a2", frame);
  const adjudication = loadAnnotation(task.name, "adjudication", frame);
  report.agreement[task.name] = agreement(task.name, a1, a2);
  validateAdjudication(task.name, adjudication, a1, a2);
  completed.set(task.name, { frame, a1, a2, adjudication });
}

const predictions = loadPredictions(frames);
if (predictions) {
  for (const [taskName, state] of completed) {
    if (state.adjudication) report.metrics[taskName] = metricGroups(state.frame, state.adjudication, predictions, taskName);
  }
}

if (errors.length) report.status = "invalid";
else if (blockers.length) report.status = "incomplete";
else report.status = "complete";

if (jsonOnly) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(`P4.7 Goldbestand: ${report.status}\n`);
  for (const [taskName, frame] of Object.entries(report.frames)) {
    const m = frame.marginalSampleCounts;
    process.stdout.write(
      `${taskName}: ${frame.sampleSize}/${frame.population}, ${frame.compositeCells} Zellen, `
      + `Laenge ${JSON.stringify(m.length)}, Kunya ${JSON.stringify(m.kunya)}, `
      + `Nisba ${JSON.stringify(m.nisba)}, Relativform ${JSON.stringify(m.relative)}, `
      + `Homonym ${JSON.stringify(m.homonym)}\n`,
    );
  }
  for (const [taskName, value] of Object.entries(report.agreement)) {
    if (!value) continue;
    process.stdout.write(
      `${taskName}: Cohen-kappa=${value.decisionClassKappa ?? "nicht-definiert"}, `
      + `exakte Identitaetsuebereinstimmung=${value.exactIdentityAgreement}\n`,
    );
  }
  for (const [taskName, groups] of Object.entries(report.metrics)) {
    const overall = groups?.overall;
    if (!overall) continue;
    process.stdout.write(
      `${taskName}: Praezision=${overall.unweighted.precision ?? "nicht-definiert"}, `
      + `Recall=${overall.unweighted.recall ?? "nicht-definiert"}, `
      + `Coverage=${overall.unweighted.linkedCoverage ?? "nicht-definiert"}\n`,
    );
  }
  for (const blocker of blockers) process.stdout.write(`BLOCKER: ${blocker}\n`);
  for (const error of errors) process.stderr.write(`FEHLER: ${error}\n`);
}

if (errors.length || (strict && blockers.length)) process.exitCode = 1;
