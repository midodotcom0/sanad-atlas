/**
 * Quellenregistrierung. Port von `backend/app/repository.py`
 * (`sources`, `source_list`). Arbeitet -- wie die Referenz -- ausschliesslich
 * auf `data/sources/turath-manifest.json` (hier: dem beim Worker-Start
 * einmal geparsten `registry`-Objekt), NICHT auf atlas.db: Quellenmetadaten
 * sind Registrierungsdaten, kein aus dem Korpus abgeleiteter, gate-
 * pflichtiger Inhalt (Registry bleibt Agent 1s alleinige Quelle der
 * Wahrheit, hier nur gelesen).
 * @param {any} registry geparster Inhalt von data/sources/turath-manifest.json
 */
import { envelope, cited } from "../envelope.mjs";

export function getSource(registry, dataVersion, sourceId) {
  for (const source of registry.sources ?? []) {
    if (source.key === sourceId) {
      return envelope(source, [{ provider: "turath", workId: source.turathBookId, url: `https://app.turath.io/book/${source.turathBookId}` }], {
        confidenceLevel: "verified",
        origin: "registry",
        dataVersion,
      });
    }
  }
  for (const source of registry.externalDatasets ?? []) {
    if (source.key === sourceId) {
      return envelope(source, [{ url: source.url, doi: source.doi ?? null, license: source.license ?? null }], {
        confidenceLevel: "verified",
        origin: "registry",
        dataVersion,
      });
    }
  }
  return null;
}

export function listSources(registry, dataVersion) {
  const items = [...(registry.sources ?? []), ...(registry.externalDatasets ?? [])];
  return envelope({ items }, cited([{ registry: "data/sources/turath-manifest.json" }], "Registrierung leer."), {
    confidenceLevel: "verified",
    origin: "registry",
    dataVersion,
  });
}
