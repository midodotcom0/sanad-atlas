/**
 * Lokaler HTTP-Adapter fuer denselben portablen Router, den Cloudflare D1
 * ausliefert. Er bindet die gebaute atlas.db direkt ueber node:sqlite an und
 * ist ausschliesslich auf 127.0.0.1 erreichbar.
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createNodeSqliteAdapter } from "./src/adapters/node-sqlite-adapter.mjs";
import { createLicenseGate } from "./src/core/license-gate.mjs";
import { readActiveRelease } from "./src/core/release.mjs";
import { route } from "./src/core/router.mjs";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.ATLAS_API_PORT ?? "8787", 10);
const databasePath = resolve(process.env.ATLAS_DB_PATH ?? new URL("./atlas.db", import.meta.url).pathname);
const registryPath = new URL("../data/sources/turath-manifest.json", import.meta.url);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("ATLAS_API_PORT muss eine gueltige Portnummer sein");
}

const rawDb = new DatabaseSync(databasePath, { readOnly: process.env.ATLAS_DEV_READ_WRITE !== "1" });
const db = createNodeSqliteAdapter(rawDb);
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const gate = createLicenseGate(registry);
const release = await readActiveRelease(db);

async function requestBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 32_768) throw new Error("Anfrage ist groesser als 32 KiB");
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

const server = createServer(async (incoming, outgoing) => {
  try {
    const body = await requestBody(incoming);
    const request = new Request(`http://localhost:${port}${incoming.url ?? "/"}`, {
      method: incoming.method,
      headers: incoming.headers,
      body,
    });
    const response = await route(request, {
      db,
      gate,
      registry,
      dataVersion: release.dataVersion,
      release,
    });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    outgoing.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    outgoing.end(JSON.stringify({ detail: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(port, host, () => {
  console.log(`Sanad Atlas API: http://localhost:${port} (${release.releaseId})`);
});

function close() {
  server.close(() => {
    rawDb.close();
    process.exit(0);
  });
}

process.once("SIGINT", close);
process.once("SIGTERM", close);

