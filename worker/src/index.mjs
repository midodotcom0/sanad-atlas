/**
 * Cloudflare-Einstiegspunkt (P3.2). Duenner Adapter, keine Fachlogik:
 *
 *   fetch(request, env) -> D1-Binding an den portablen Kern haengen -> route()
 *
 * Alles Fachliche liegt in worker/src/core/**, das nichts von Cloudflare weiss
 * und deshalb unter `node --test` gegen node:sqlite pruefbar ist
 * (tests/worker-contract.check.mjs vergleicht es feldweise mit der
 * FastAPI-Referenz). Diese Datei ist der einzige Ort mit `env`.
 *
 * Abhaengigkeitsfrei, kein Hono: Begruendung in docs/12-LAUFZEIT.md.
 *
 * Erwartete Bindings (worker/wrangler.toml):
 *   env.DB  -- D1-Datenbank, geladen aus atlas.db (scripts/build-atlas-db.mjs)
 */

import { route } from "./core/router.mjs";
import { createLicenseGate } from "./core/license-gate.mjs";
import { activeRelease } from "./core/release.mjs";
import { createD1Adapter } from "./adapters/d1-adapter.mjs";

// Die Quellenregistrierung wird MITGEBUENDELT, nicht aus D1 gelesen: sie ist
// Registrierungs- und Rechtestand (Agent 1s data/sources/turath-manifest.json),
// keine Korpusableitung, und das Lizenz-Gate muss auch dann greifen, wenn eine
// Abfrage gar nicht bis zur Datenbank kommt. Wrangler loest den JSON-Import beim
// Bundeln auf; zur Laufzeit fallen dafuer null Zeilen-Lesevorgaenge an.
import registry from "../../data/sources/turath-manifest.json";

// Pro Isolate einmal aufgebaut, nicht pro Anfrage: das Gate baut Maps ueber die
// Registrierung auf, und ein Isolate bedient viele Anfragen.
const gate = createLicenseGate(registry);

/** @type {Map<any, ReturnType<typeof createD1Adapter>>} */
const adapterByBinding = new Map();

function adapterFor(binding) {
  let adapter = adapterByBinding.get(binding);
  if (!adapter) {
    adapter = createD1Adapter(binding);
    adapterByBinding.set(binding, adapter);
  }
  return adapter;
}

// Benannt statt als anonymes Objektliteral exportiert: Cloudflare erwartet nur
// den Standardexport mit einer fetch()-Methode, ein Name macht den Handler in
// Stapelspuren und Tests trotzdem ansprechbar.
const worker = {
  /**
   * @param {Request} request
   * @param {{ DB?: any }} env
   */
  async fetch(request, env) {
    if (!env?.DB) {
      // Keine erfundene Antwort und kein 500 ohne Begruendung: eine fehlende
      // D1-Bindung ist ein Konfigurationsfehler des Betreibers, und die Meldung
      // nennt genau die Stelle, an der er behoben wird.
      return new Response(
        JSON.stringify({ detail: "D1-Bindung 'DB' fehlt -- siehe worker/wrangler.toml und docs/12-LAUFZEIT.md" }),
        { status: 503, headers: { "content-type": "application/json; charset=utf-8" } },
      );
    }

    const db = adapterFor(env.DB);
    try {
      const release = await activeRelease(db);
      // dataVersion in der Antwort-Huelle bleibt die Datenversion allein --
      // feldgleich zur FastAPI-Referenz (P3.2). Die Indexversion wird ueber
      // /health und den Antwort-Header ausgeliefert, damit der Vertrag der 14
      // Endpunkte unveraendert bleibt und die Laufzeitversion trotzdem
      // nachpruefbar ist.
      const response = await route(request, { db, gate, registry, dataVersion: release.dataVersion, release });
      const headers = new Headers(response.headers);
      headers.set("x-atlas-release", release.releaseId);
      headers.set("x-atlas-data-version", release.dataVersion);
      if (release.indexVersion) headers.set("x-atlas-index-version", release.indexVersion);
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      return new Response(
        JSON.stringify({ detail: `internal error: ${error instanceof Error ? error.message : String(error)}` }),
        { status: 500, headers: { "content-type": "application/json; charset=utf-8" } },
      );
    }
  },
};

export default worker;
