/**
 * Prueft, dass `scripts/atlas-id-scheme.mjs` (bucketId/isRelativeReference)
 * bitgleiche Ergebnisse liefert wie `backend/app/repository.py`
 * (`bucket_id`, `is_relative_reference`). Ohne diese Gleichheit wuerden
 * Worker- und FastAPI-Antworten fuer /api/v1/narrators/{id} unter
 * verschiedenen IDs dasselbe Erzaehler-Vorkommen adressieren -- die
 * Contract-Tests (P3.2) koennten dann nicht feldweise vergleichen.
 *
 * Ruft `backend/app/repository.py` per `python3 -c` auf, um die Python-
 * Referenz direkt zu befragen (kein FastAPI/uvicorn noetig -- repository.py
 * hat keine FastAPI-Abhaengigkeit). Ohne funktionierendes `python3` wird der
 * Vergleichstest uebersprungen; die reinen JS-Vertragstests laufen immer.
 *
 * Ausfuehren: `node --test tests/atlas-db-id-scheme.check.mjs`
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  bucketId,
  canonicalPersonKey,
  canonicalPersonKeyForCluster,
  clusterIdForName,
  isCanonicalPersonKey,
  isRelativeReference,
} from "../scripts/atlas-id-scheme.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const VECTORS = [
  ["bukhari-1-1-12", 0, 0, "الحميدي عبد الله بن الزبير"],
  ["bukhari-1-1-12", 0, 6, "رسول الله صلي الله عليه وسلم"],
  ["muslim-5-5-9", 0, 3, "ابيه"],
  ["muslim-5-5-9", 0, 4, "عن جده"],
  ["bukhari-42-3-9", 1, 2, "يحيي بن سعيد الانصاري"],
  ["bukhari-42-3-9", 1, 2, ""],
];

function pythonAvailable() {
  const probe = spawnSync("python3", ["-c", "import sys; sys.exit(0)"]);
  return probe.status === 0;
}

function pythonBucketId(recordId, chainOrder, position, normalizedForm) {
  const script = `
import sys
sys.path.insert(0, "backend")
from app.repository import bucket_id, is_relative_reference
import json
print(json.dumps({"bucketId": bucket_id(${JSON.stringify(recordId)}, ${chainOrder}, ${position}, ${JSON.stringify(normalizedForm)}), "isRelative": is_relative_reference(${JSON.stringify(normalizedForm)})}))
`;
  const result = spawnSync("python3", ["-c", script], { cwd: projectRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

test("bucketId() stimmt fuer jeden Testvektor mit backend/app/repository.py ueberein", { skip: !pythonAvailable() && "kein python3" }, () => {
  for (const [recordId, chainOrder, position, normalizedForm] of VECTORS) {
    const python = pythonBucketId(recordId, chainOrder, position, normalizedForm);
    assert.equal(bucketId(recordId, chainOrder, position, normalizedForm), python.bucketId, `bucketId divergiert fuer ${JSON.stringify([recordId, chainOrder, position, normalizedForm])}`);
    assert.equal(isRelativeReference(normalizedForm), python.isRelative, `isRelativeReference divergiert fuer ${JSON.stringify(normalizedForm)}`);
  }
});

test("relative Rueckverweisformen erhalten ein UNC-REL-Praefix, gewoehnliche Namen UNC-", () => {
  assert.ok(bucketId("x", 0, 0, "ابيه").startsWith("UNC-REL-"));
  assert.ok(bucketId("x", 0, 0, "محمد بن ادريس").startsWith("UNC-"));
  assert.ok(!bucketId("x", 0, 0, "محمد بن ادريس").startsWith("UNC-REL-"));
});

test("gleiche Position in verschiedenen Ketten erzeugt verschiedene relative IDs (Positionsbindung)", () => {
  const a = bucketId("hadith-A", 0, 3, "ابيه");
  const b = bucketId("hadith-B", 0, 3, "ابيه");
  assert.notEqual(a, b, "relative Formen duerfen nie global zusammenfallen");
});

test("gleicher normalisierter Name erzeugt in jeder Kette dieselbe ID (Wiederimport-stabil)", () => {
  const a = bucketId("hadith-A", 0, 1, "سفيان");
  const b = bucketId("hadith-B", 3, 9, "سفيان");
  assert.equal(a, b, "gewoehnliche Namen sind korpusweit konsistent, unabhaengig von Kette/Position");
});

test("kanonische SA-P-ID ist fuer einen unveraenderlichen Identitaets-Seed deterministisch und Python-paritaetisch", { skip: !pythonAvailable() && "kein python3" }, () => {
  const seeds = [
    "identity-decision:11111111-2222-3333-4444-555555555555",
    "narrator-registry:al-bukhari:42",
    "هوية:يحيى بن سعيد",
  ];
  for (const seed of seeds) {
    const jsKey = canonicalPersonKey(seed);
    const script = `
import sys
sys.path.insert(0, "backend")
from app.stable_keys import canonical_person_key
print(canonical_person_key(${JSON.stringify(seed)}))
`;
    const result = spawnSync("python3", ["-c", script], { cwd: projectRoot, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(jsKey, result.stdout.trim());
    assert.ok(isCanonicalPersonKey(jsKey));
    assert.equal(canonicalPersonKey(seed), jsKey, "derselbe Identitaets-Seed muss denselben Schluessel liefern");
    assert.notEqual(canonicalPersonKey(seed, 1), jsKey, "Kollisionsindex muss einen getrennten Schluesselraum bilden");
  }
});

test("UNC-Cluster werden streng validiert und relative/ungueltige IDs nie kanonisiert", () => {
  const clusterId = clusterIdForName("يحيى بن سعيد الأنصاري");
  assert.match(clusterId, /^UNC-[0-9a-f]{12}$/);
  assert.ok(isCanonicalPersonKey(canonicalPersonKeyForCluster(clusterId)));
  for (const invalid of ["UNC-REL-123456789abc", "UNC-beliebig", "UNC-ABCDEF123456", "", null]) {
    assert.equal(canonicalPersonKeyForCluster(invalid), null);
  }
});

test("SA-P-Minting lehnt leere Seeds und ungueltige Kollisionsindizes ab", () => {
  assert.throws(() => canonicalPersonKey(""), /identitySeed/);
  assert.throws(() => canonicalPersonKey("identity", -1), /collisionIndex/);
  assert.throws(() => canonicalPersonKey("identity", 1.5), /collisionIndex/);
});
