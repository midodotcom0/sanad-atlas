/**
 * Abnahmepruefung P3.1: "zwei Laeufe erzeugen bitgleiche Pruefsummen."
 *
 * Baut atlas.db zweimal hintereinander aus denselben Eingaben (an zwei
 * verschiedene Zielpfade, damit ein Lauf den anderen nicht beeinflusst) und
 * vergleicht die sha256-Pruefsumme der beiden Dateien.
 *
 * Braucht `.cache/turath-derived` (~155 MB, nicht versioniert) und
 * `node:sqlite`; ohne beides wird uebersprungen, mit klarer Begruendung
 * (siehe `skip`-Meldung), niemals stillschweigend gruen.
 *
 * Ausfuehren: `node --experimental-sqlite --test tests/atlas-db-build.check.mjs`
 * Dauer: rund 30-40 s fuer den vollen Korpus (zwei komplette Baulaeufe).
 */

import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert";
import test from "node:test";
import { buildAtlasDatabase } from "../scripts/atlas-build-lib.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  schemaPath: resolve(projectRoot, "database/schema.sql"),
  derivedDir: resolve(projectRoot, ".cache/turath-derived"),
  corpusDir: resolve(projectRoot, "public/data/corpus"),
  manifestPath: resolve(projectRoot, "data/sources/turath-manifest.json"),
};
const corpusAvailable = Object.values(paths).every((p) => existsSync(p));

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  DatabaseSync = null;
}

function sha256OfFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test(
  "zwei unabhaengige Baulaeufe aus denselben Eingaben erzeugen bitgleiche atlas.db-Dateien",
  { skip: (!corpusAvailable && "kein .cache/turath-derived -- voller Korpus nicht vorhanden") || (!DatabaseSync && "node:sqlite nicht verfuegbar") },
  () => {
    const workdir = mkdtempSync(join(tmpdir(), "atlas-db-build-"));
    const outA = join(workdir, "run-a.db");
    const outB = join(workdir, "run-b.db");
    try {
      const resultA = buildAtlasDatabase(paths, DatabaseSync, outA);
      resultA.db.close();
      const resultB = buildAtlasDatabase(paths, DatabaseSync, outB);
      resultB.db.close();

      const shaA = sha256OfFile(outA);
      const shaB = sha256OfFile(outB);
      assert.equal(shaA, shaB, `Pruefsummen weichen ab: Lauf A=${shaA} Lauf B=${shaB}`);

      // Begleitender Plausibilitaetsnachweis, damit ein "bitgleich, aber leer"
      // Ergebnis nicht als Erfolg durchgeht.
      assert.equal(resultA.stats.hadithRecords, 13066);
      assert.equal(resultA.stats.narratorOccurrences, 87867);
      assert.ok(resultA.stats.rijalEntries > 30000, `zu wenige Rijal-Eintraege: ${resultA.stats.rijalEntries}`);
      assert.ok(resultA.stats.edgeProjectionRows > 100000, `zu wenige edge_projection-Zeilen: ${resultA.stats.edgeProjectionRows}`);
      assert.equal(resultA.dataVersion, resultB.dataVersion);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  },
);
