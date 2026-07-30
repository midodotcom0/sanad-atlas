import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createNodeSqliteAdapter } from "./src/adapters/node-sqlite-adapter.mjs";
import { createLicenseGate } from "./src/core/license-gate.mjs";
import { route } from "./src/core/router.mjs";

const rawDb = new DatabaseSync(new URL("./atlas.db", import.meta.url).pathname, { readOnly: true });
const db = createNodeSqliteAdapter(rawDb);
const registry = JSON.parse(readFileSync(new URL("../data/sources/turath-manifest.json", import.meta.url), "utf8"));
const gate = createLicenseGate(registry);
const buildInfo = rawDb.prepare("SELECT data_version FROM atlas_build_info WHERE id = 1").get();
const dataVersion = buildInfo.data_version;
console.log("dataVersion:", dataVersion);

async function call(path) {
  const req = new Request(`http://worker.local${path}`);
  const res = await route(req, { db, gate, registry, dataVersion });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const someHadith = rawDb.prepare("SELECT id FROM hadith_record LIMIT 1 OFFSET 5").get();
const someNodeRow = rawDb.prepare("SELECT node_id, count(*) c FROM narrator_occurrence WHERE node_id IS NOT NULL GROUP BY node_id ORDER BY c DESC LIMIT 1").get();
const someRelNodeRow = rawDb.prepare("SELECT source_node_id, count(*) c FROM edge_projection GROUP BY source_node_id ORDER BY c DESC LIMIT 1").get();
const someRijal = rawDb.prepare("SELECT id FROM rijal_entry WHERE source_work_id = 'source:tahdhib' LIMIT 1 OFFSET 3").get();
const someClusterRec = rawDb.prepare("SELECT matn_fingerprint FROM hadith_record WHERE matn_fingerprint IS NOT NULL LIMIT 1").get();

console.log("\n--- /health ---");
console.log(JSON.stringify(await call("/health")));

console.log("\n--- /api/v1/hadiths?limit=2 ---");
console.log(JSON.stringify(await call("/api/v1/hadiths?limit=2"), null, 1).slice(0, 2000));

console.log("\n--- /api/v1/hadiths/{id} ---", someHadith.id);
console.log(JSON.stringify(await call(`/api/v1/hadiths/${someHadith.id}`), null, 1).slice(0, 2500));

console.log("\n--- /api/v1/hadiths/{id}/chains ---");
console.log(JSON.stringify(await call(`/api/v1/hadiths/${someHadith.id}/chains`), null, 1).slice(0, 2500));

console.log("\n--- /api/v1/clusters/HCL-{fp}/routes ---", someClusterRec?.matn_fingerprint);
if (someClusterRec) {
  console.log(JSON.stringify(await call(`/api/v1/clusters/HCL-${someClusterRec.matn_fingerprint}/routes`), null, 1).slice(0, 2500));
}

console.log("\n--- /api/v1/clusters/HCL-{fp}/matn-variants ---");
if (someClusterRec) {
  console.log(JSON.stringify(await call(`/api/v1/clusters/HCL-${someClusterRec.matn_fingerprint}/matn-variants`), null, 1).slice(0, 1500));
}

console.log("\n--- /api/v1/rijal?limit=2 ---");
console.log(JSON.stringify(await call("/api/v1/rijal?limit=2"), null, 1).slice(0, 2000));

console.log("\n--- /api/v1/rijal/{id} ---", someRijal.id);
console.log(JSON.stringify(await call(`/api/v1/rijal/${someRijal.id}`), null, 1).slice(0, 2000));

console.log("\n--- /api/v1/identity-candidates?q=... ---");
const rijalRow = rawDb.prepare("SELECT name_head_normalized FROM rijal_entry WHERE name_head_normalized <> '' LIMIT 1 OFFSET 10").get();
console.log("query name:", rijalRow.name_head_normalized);
console.log(JSON.stringify(await call(`/api/v1/identity-candidates?q=${encodeURIComponent(rijalRow.name_head_normalized)}`), null, 1).slice(0, 2500));

console.log("\n--- /api/v1/narrators/{id} ---", someNodeRow.node_id, "occurrences:", someNodeRow.c);
console.log(JSON.stringify(await call(`/api/v1/narrators/${someNodeRow.node_id}`), null, 1).slice(0, 3000));

console.log("\n--- /api/v1/narrators/{id}/relations ---", someRelNodeRow.source_node_id, "edges:", someRelNodeRow.c);
console.log(JSON.stringify(await call(`/api/v1/narrators/${someRelNodeRow.source_node_id}/relations?limit=3`), null, 1).slice(0, 3000));

console.log("\n--- /api/v1/narrators/{id}/timeline ---");
console.log(JSON.stringify(await call(`/api/v1/narrators/${someNodeRow.node_id}/timeline`), null, 1).slice(0, 2000));

console.log("\n--- /api/v1/narrators/{id}/paths ---");
console.log(JSON.stringify(await call(`/api/v1/narrators/${someRelNodeRow.source_node_id}/paths?maxDepth=4`), null, 1).slice(0, 2500));

console.log("\n--- /api/v1/narrators/compare?a=..&b=.. ---");
console.log(JSON.stringify(await call(`/api/v1/narrators/compare?a=${someNodeRow.node_id}&b=${someRelNodeRow.source_node_id}`), null, 1).slice(0, 2000));

console.log("\n--- /api/v1/chronology/compare ---");
console.log(JSON.stringify(await call(`/api/v1/chronology/compare?a=${someNodeRow.node_id}&b=${someRelNodeRow.source_node_id}`), null, 1).slice(0, 2000));

console.log("\n--- /api/v1/sources ---");
console.log(JSON.stringify(await call("/api/v1/sources"), null, 1).slice(0, 1500));

console.log("\n--- /api/v1/sources/bukhari ---");
console.log(JSON.stringify(await call("/api/v1/sources/bukhari"), null, 1).slice(0, 1500));

console.log("\n--- 404 case ---");
console.log(JSON.stringify(await call("/api/v1/hadiths/does-not-exist")));

console.log("\n--- OPTIONS/CORS ---");
const optRes = await route(new Request("http://worker.local/api/v1/sources", { method: "OPTIONS", headers: { origin: "https://midodotcom0.github.io" } }), { db, gate, registry, dataVersion });
console.log(optRes.status, Object.fromEntries(optRes.headers.entries()));

console.log("\nOK");
