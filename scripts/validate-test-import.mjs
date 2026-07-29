import { readFile } from "node:fs/promises";

const input = new URL("../data/test-import.json", import.meta.url);
const payload = JSON.parse(await readFile(input, "utf8"));
const requiredSourceFields = ["name", "version", "licenseStatus", "retrievedAt", "commercialUse"];
const requiredRecordFields = ["externalId", "collection", "number", "rawIsnad", "matn", "editorialStatus"];

for (const field of requiredSourceFields) {
  if (!(field in payload.source)) throw new Error(`Missing source provenance field: ${field}`);
}
if (payload.source.licenseStatus === "unresolved" && payload.source.commercialUse) {
  throw new Error("Commercial import is blocked while license status is unresolved.");
}

const seen = new Set();
for (const [index, record] of payload.records.entries()) {
  for (const field of requiredRecordFields) {
    if (!record[field]) throw new Error(`Record ${index} missing ${field}`);
  }
  if (seen.has(record.externalId)) throw new Error(`Duplicate externalId: ${record.externalId}`);
  seen.add(record.externalId);
  record.occurrences = record.rawIsnad.split("←").map((rawSurfaceForm, position) => ({
    position,
    rawSurfaceForm: rawSurfaceForm.trim(),
    resolutionStatus: "unresolved",
  }));
}

console.log(`Validated ${payload.records.length} records with complete source provenance.`);
console.log(`Produced ${payload.records.reduce((sum, record) => sum + record.occurrences.length, 0)} unresolved narrator occurrences for editorial resolution.`);
