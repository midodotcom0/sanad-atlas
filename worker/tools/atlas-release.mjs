#!/usr/bin/env node
/**
 * Release-Werkzeug (P3.4): Datenversion und Indexversion gemeinsam
 * ausliefern, Rollback in EINEM Schritt.
 *
 * Ein Release ist das Paar (dataVersion, indexVersion), das
 * scripts/build-atlas-db.mjs beim Bau in `atlas_release` schreibt. Die
 * Release-HISTORIE liegt nicht im Repository, sondern in derselben Tabelle in
 * D1 -- also dort, wo auch der aktive Zeiger steht. Das ist der Grund, weshalb
 * ein Rollback ohne Repo-Zustand, ohne Worker-Deploy und ohne Pages-Build
 * funktioniert: er ist ein UPDATE auf zwei Zeilen.
 *
 * Betriebsarten:
 *   --db <pfad>   arbeitet auf einer lokalen SQLite-Datei (node:sqlite).
 *                 Wird von `prepare`, vom Trockenlauf und fuer die lokale
 *                 Kontrolle benutzt.
 *   --sql-only    schreibt nur SQL nach stdout, fuehrt nichts aus. Damit
 *                 laeuft derselbe Schritt gegen D1:
 *                   wrangler d1 execute sanad-atlas --remote --file=<datei>
 *
 * Unterbefehle:
 *   prepare  --db <atlas.db> [--out <verzeichnis>]
 *   list     --db <pfad>
 *   activate <releaseId> (--db <pfad> | --sql-only)
 *   rollback [--to <releaseId>] (--db <pfad> | --sql-only)
 *
 * Abhaengigkeitsfrei (nur node: builtins) -- siehe docs/12-LAUFZEIT.md.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_DDL, readActiveRelease, registerReleaseSql, activateReleaseSql } from "../src/core/release.mjs";
import { createNodeSqliteAdapter } from "../src/adapters/node-sqlite-adapter.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function parseArgs(argv) {
  const args = { command: argv[0] ?? "", positional: [], sqlOnly: false, db: null, out: null, to: null };
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--sql-only") args.sqlOnly = true;
    else if (token === "--db") args.db = resolve(argv[++i]);
    else if (token === "--out") args.out = resolve(argv[++i]);
    else if (token === "--to") args.to = argv[++i];
    else args.positional.push(token);
  }
  return args;
}

async function openDb(path, { readOnly }) {
  const { DatabaseSync } = await import("node:sqlite");
  const raw = new DatabaseSync(path, { readOnly });
  return { raw, adapter: createNodeSqliteAdapter(raw) };
}

/** Alle Releases, neueste zuerst. Quelle der Wahrheit ist die Datenbank, nicht das Repository. */
function releaseHistory(raw) {
  return raw
    .prepare("SELECT release_id, data_version, index_version, built_at, activated_at, is_active, note FROM atlas_release ORDER BY built_at DESC, release_id DESC")
    .all();
}

/**
 * Das Ziel eines Rollbacks: das zuletzt AKTIV GEWESENE Release, das gerade
 * nicht aktiv ist. `activated_at` bleibt beim Deaktivieren stehen und ist damit
 * genau dieser Nachweis. Nie aktiviert gewesene Releases sind kein Rollback-
 * Ziel -- ein Zurueckrollen auf einen Stand, der nie ausgeliefert wurde, waere
 * ein Vorwaertsschritt mit falschem Namen.
 */
function rollbackTarget(history) {
  const candidates = history.filter((row) => row.is_active !== 1 && row.activated_at);
  candidates.sort((a, b) => String(b.activated_at).localeCompare(String(a.activated_at)));
  return candidates[0] ?? null;
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------

async function cmdPrepare(args) {
  const dbPath = args.db ?? resolve(projectRoot, "worker/atlas.db");
  const outDir = args.out ?? resolve(projectRoot, "worker/release");
  const { raw, adapter } = await openDb(dbPath, { readOnly: true });
  try {
    const active = await readActiveRelease(adapter);
    if (!active.indexVersion) {
      fail(`atlas.db unter ${dbPath} kennt keine Indexversion -- mit dem aktuellen scripts/build-atlas-db.mjs neu bauen.`);
      return;
    }
    const info = raw.prepare("SELECT built_at FROM atlas_build_info WHERE id = 1").get();
    const builtAt = active.builtAt ?? info?.built_at ?? null;
    const counts = raw
      .prepare("SELECT (SELECT count(*) FROM hadith_record) AS hadithRecords, (SELECT count(*) FROM rijal_entry) AS rijalEntries, (SELECT count(*) FROM edge_projection) AS edgeProjectionRows")
      .get();

    const release = {
      releaseId: active.releaseId,
      dataVersion: active.dataVersion,
      indexVersion: active.indexVersion,
      builtAt,
      note: "vorbereitet von worker/tools/atlas-release.mjs",
    };
    const dir = resolve(outDir, active.releaseId.replace(/[^A-Za-z0-9._+-]/g, "_"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "manifest.json"), `${JSON.stringify({ ...release, rowCounts: counts }, null, 2)}\n`);
    writeFileSync(resolve(dir, "register.sql"), `${registerReleaseSql(release)}\n`);
    // activated_at ist der BAU-Zeitstempel, nicht Date.now(): derselbe
    // Vorbereitungslauf muss zweimal dieselbe Datei erzeugen (Determinismus-
    // Anforderung aus P3.1, hier auf die Release-Artefakte uebertragen).
    writeFileSync(resolve(dir, "activate.sql"), `${activateReleaseSql(release.releaseId, builtAt ?? "")}\n`);
    writeFileSync(resolve(outDir, "latest.json"), `${JSON.stringify({ ...release, rowCounts: counts, dir }, null, 2)}\n`);
    // Zusaetzlich in Shell-Form: der Workflow liest die Werte damit ohne
    // eingebettetes node -e (und damit ohne Anfuehrungszeichen-Fallen) --
    // `cat latest.env >> "$GITHUB_OUTPUT"` bzw. `source latest.env`.
    writeFileSync(
      resolve(outDir, "latest.env"),
      [
        `releaseId=${release.releaseId}`,
        `dataVersion=${release.dataVersion}`,
        `indexVersion=${release.indexVersion}`,
        `releaseDir=${dir}`,
        "",
      ].join("\n"),
    );

    console.log(`Release vorbereitet: ${release.releaseId}`);
    console.log(`  dataVersion:  ${release.dataVersion}`);
    console.log(`  indexVersion: ${release.indexVersion}`);
    console.log(`  Artefakte:    ${dir}`);
    console.log(`  Zeilen:       ${JSON.stringify(counts)}`);
  } finally {
    raw.close();
  }
}

async function cmdList(args) {
  if (!args.db) return fail("list braucht --db <pfad>");
  const { raw } = await openDb(args.db, { readOnly: true });
  try {
    for (const row of releaseHistory(raw)) {
      const marker = row.is_active === 1 ? "* aktiv " : "        ";
      console.log(`${marker}${row.release_id}  gebaut=${row.built_at}  aktiviert=${row.activated_at ?? "-"}`);
    }
  } finally {
    raw.close();
  }
}

/** Fuehrt die Umschaltung aus und PRUEFT sie -- eine unbestaetigte Umschaltung gilt als Fehler. */
async function applySwitch(dbPath, releaseId, activatedAt) {
  const { raw, adapter } = await openDb(dbPath, { readOnly: false });
  try {
    const exists = raw.prepare("SELECT 1 FROM atlas_release WHERE release_id = ?").get(releaseId);
    if (!exists) throw new Error(`Release ${releaseId} ist in dieser Datenbank nicht registriert -- zuerst register.sql einspielen.`);
    raw.exec("BEGIN;");
    try {
      raw.exec(activateReleaseSql(releaseId, activatedAt));
      raw.exec("COMMIT;");
    } catch (error) {
      raw.exec("ROLLBACK;");
      throw error;
    }
    const active = await readActiveRelease(adapter);
    if (active.releaseId !== releaseId) throw new Error(`Umschaltung nicht wirksam: aktiv ist ${active.releaseId}, erwartet ${releaseId}`);
    return active;
  } finally {
    raw.close();
  }
}

async function cmdActivate(args) {
  const releaseId = args.positional[0];
  if (!releaseId) return fail("activate braucht eine releaseId");
  const activatedAt = new Date().toISOString();
  if (args.sqlOnly) {
    console.log(activateReleaseSql(releaseId, activatedAt));
    return;
  }
  if (!args.db) return fail("activate braucht --db <pfad> oder --sql-only");
  const active = await applySwitch(args.db, releaseId, activatedAt);
  console.log(`aktiv: ${active.releaseId} (dataVersion=${active.dataVersion}, indexVersion=${active.indexVersion})`);
}

async function cmdRollback(args) {
  if (args.sqlOnly) {
    if (!args.to) return fail("rollback --sql-only braucht --to <releaseId> (ohne Datenbank ist das Vorgaengerrelease nicht bestimmbar)");
    console.log(activateReleaseSql(args.to, new Date().toISOString()));
    return;
  }
  if (!args.db) return fail("rollback braucht --db <pfad> oder --sql-only mit --to");
  const { raw } = await openDb(args.db, { readOnly: true });
  let target;
  try {
    const history = releaseHistory(raw);
    target = args.to ? history.find((row) => row.release_id === args.to) : rollbackTarget(history);
  } finally {
    raw.close();
  }
  if (!target) return fail("kein Rollback-Ziel: es gibt kein zweites, zuvor aktiv gewesenes Release in dieser Datenbank.");
  const active = await applySwitch(args.db, target.release_id, new Date().toISOString());
  console.log(`Rollback ausgefuehrt -- aktiv: ${active.releaseId} (dataVersion=${active.dataVersion}, indexVersion=${active.indexVersion})`);
}

async function cmdDdl() {
  console.log(RELEASE_DDL);
}

const COMMANDS = { prepare: cmdPrepare, list: cmdList, activate: cmdActivate, rollback: cmdRollback, ddl: cmdDdl };

const args = parseArgs(process.argv.slice(2));
const handler = COMMANDS[args.command];
if (!handler) {
  console.error(`Unbekannter Unterbefehl: ${args.command || "(keiner)"}`);
  console.error(`Bekannt: ${Object.keys(COMMANDS).join(", ")}`);
  process.exitCode = 2;
} else {
  await handler(args).catch((error) => {
    console.error(String(error?.message ?? error));
    process.exitCode = 1;
  });
}
