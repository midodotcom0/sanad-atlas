#!/usr/bin/env node
/**
 * P3.1 -- Build-Pipeline JSON -> atlas.db.
 *
 * Liest `database/schema.sql` (Agent 2) ein und uebersetzt es nach SQLite
 * (`scripts/atlas-schema-translate.mjs`), statt eigene DDL hartzucodieren --
 * kuenftige Schemaaenderungen wirken dadurch automatisch. Fuellt die
 * Datenbank aus den versionierten Ableitungen in `.cache/turath-derived`
 * und `public/data/corpus` (`scripts/atlas-build-lib.mjs`).
 *
 * Nutzung:
 *   node --experimental-sqlite scripts/build-atlas-db.mjs [--out PATH] [--quiet]
 *
 * Ohne `node:sqlite` (z. B. aeltere Node-Version) schlaegt der Bau kontrolliert
 * fehl und nennt `python3 -c "import sqlite3"` als Ausweichweg fuer die reine
 * Verifikation der uebersetzten DDL (nicht fuer den vollen Bau: der Loader
 * nutzt node:sqlite-spezifische prepared statements fuer Performance).
 *
 * Determinismus-Nachweis (Abnahme P3.1): dieses Skript zweimal nacheinander
 * ausfuehren und die ausgegebene sha256-Pruefsumme vergleichen. Siehe
 * tests/atlas-db-build.check.mjs fuer den automatisierten Nachweis.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAtlasDatabase } from "./atlas-build-lib.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { out: resolve(projectRoot, "worker/atlas.db"), quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") args.out = resolve(argv[i + 1]);
    if (argv[i] === "--quiet") args.quiet = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch (error) {
    console.error("node:sqlite ist in dieser Node-Version nicht verfuegbar (Node 22+ mit --experimental-sqlite noetig).");
    console.error("Ausweichweg fuer die reine DDL-Verifikation (nicht fuer den vollen Bau): python3 -c \"import sqlite3\"");
    console.error(String(error?.message ?? error));
    process.exitCode = 1;
    return;
  }

  const paths = {
    schemaPath: resolve(projectRoot, "database/schema.sql"),
    derivedDir: resolve(projectRoot, ".cache/turath-derived"),
    corpusDir: resolve(projectRoot, "public/data/corpus"),
    manifestPath: resolve(projectRoot, "data/sources/turath-manifest.json"),
  };
  for (const [label, path] of Object.entries(paths)) {
    if (!existsSync(path)) {
      console.error(`Eingabe fehlt (${label}): ${path}`);
      process.exitCode = 1;
      return;
    }
  }

  mkdirSync(dirname(args.out), { recursive: true });
  // Immer frisch bauen: eine bestehende Datei koennte Reste einer aelteren
  // Schemaversion enthalten. Fuer bitgleiche Pruefsummen darf nichts aus
  // einem frueheren Lauf uebrig bleiben. `unlink` (rm) ist auf diesem
  // Sandbox-Mount fuer bereits erzeugte Dateien nicht erlaubt ("Operation
  // not permitted", empirisch geprueft); `truncate` auf Laenge 0 funktioniert
  // dagegen und reicht aus, da SQLite eine leere Datei wie eine neue behandelt.
  const { truncateSync } = await import("node:fs");
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const candidate = `${args.out}${suffix}`;
    if (existsSync(candidate)) {
      try {
        truncateSync(candidate, 0);
      } catch {
        // Datei existiert evtl. nicht wirklich (z. B. -wal ohne WAL-Modus); ignorieren.
      }
    }
  }

  const startedAt = Date.now();
  const { db, stats, dataVersion, indexVersion, releaseId } = buildAtlasDatabase(paths, DatabaseSync, args.out);
  db.close();
  const durationMs = Date.now() - startedAt;

  const bytes = readFileSync(args.out);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sizeMb = bytes.length / (1024 * 1024);
  const d1FreeTierGb = 5;
  const percentOfD1FreeTier = ((bytes.length / (d1FreeTierGb * 1024 * 1024 * 1024)) * 100).toFixed(3);

  const report = {
    outPath: args.out,
    dataVersion,
    indexVersion,
    releaseId,
    sizeBytes: bytes.length,
    sizeMb: Number(sizeMb.toFixed(2)),
    percentOfD1FreeTier: Number(percentOfD1FreeTier),
    sha256,
    durationMs,
    stats,
  };

  writeFileSync(`${args.out}.manifest.json`, `${JSON.stringify(report, null, 2)}\n`);

  if (!args.quiet) {
    console.log(`atlas.db gebaut: ${args.out}`);
    console.log(`  Groesse: ${report.sizeMb} MB (${bytes.length} Bytes) -- ${report.percentOfD1FreeTier}% des D1-Freibetrags von ${d1FreeTierGb} GB`);
    console.log(`  sha256: ${sha256}`);
    console.log(`  Dauer: ${durationMs} ms`);
    console.log(`  dataVersion: ${dataVersion}`);
    console.log(`  indexVersion: ${indexVersion}`);
    console.log(`  releaseId: ${releaseId}  (Datenversion und Indexversion werden nur gemeinsam ausgeliefert -- P3.4)`);
    console.log(`  Zeilen: ${JSON.stringify(stats)}`);
  } else {
    console.log(sha256);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
