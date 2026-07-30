/**
 * Reiner Router: Pfad/Query -> Handler -> Response. Bildet main.py's
 * @app.get(...)-Tabelle 1:1 nach (dieselben Pfade, Defaults, Grenzen), ruft
 * aber ausschliesslich die db.all()/db.get()-Abstraktion auf -- kein
 * Cloudflare-spezifischer Code hier (kein `env.DB`, kein `caches`). Der
 * Cloudflare-Adapter (worker/src/index.mjs) ist ein duenner Wrapper, der nur
 * env.DB an den D1-Adapter bindet und `route()` aufruft; er ist ohne wrangler
 * nicht ausfuehrbar -- diese Datei ist die geprueft lauffaehige Kernlogik
 * (tests/worker-contract.check.mjs, node --test gegen den node:sqlite-Adapter).
 *
 * Nutzt ausschliesslich Web-Standard Request/Response/URL (global in Node
 * >=18 und in Cloudflare Workers) -- kein Hono, Abwaegung in
 * docs/12-LAUFZEIT.md.
 */

import * as hadithsQ from "./queries/hadiths.mjs";
import * as rijalQ from "./queries/rijal.mjs";
import * as narratorsQ from "./queries/narrators.mjs";
import * as sourcesQ from "./queries/sources.mjs";
import * as editorialQ from "./queries/editorial.mjs";
import { getNarratorPaths } from "./graph-traversal.mjs";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

// Bytegleich zu backend/app/main.py's CORSMiddleware-Konfiguration.
const ALLOWED_ORIGINS = new Set(["http://localhost:3000", "https://midodotcom0.github.io"]);

export function corsHeadersFor(request) {
  const headers = {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type",
    vary: "Origin",
  };
  const origin = request.headers?.get?.("origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) headers["access-control-allow-origin"] = origin;
  return headers;
}

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

function notFound(message, extraHeaders) {
  // FastAPI's Standardfehlerantwort fuer HTTPException(404, msg):
  // {"detail": msg} mit Status 404 -- main.py wirft genau diese Meldungen.
  return json({ detail: message }, 404, extraHeaders);
}

function badRequest(message, extraHeaders) {
  return json({ detail: message }, 400, extraHeaders);
}

function clampInt(raw, { def, min, max }) {
  if (raw === null || raw === undefined || raw === "") return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function enumOrNull(value, allowed) {
  return value && allowed.includes(value) ? value : null;
}

async function requestJson(request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 32_768) {
    throw new editorialQ.EditorialError(413, "JSON-Nutzlast ist groesser als 32 KiB");
  }
  const text = await request.text();
  if (text.length > 32_768) throw new editorialQ.EditorialError(413, "JSON-Nutzlast ist groesser als 32 KiB");
  try {
    return JSON.parse(text);
  } catch {
    throw new editorialQ.EditorialError(400, "ungueltiger JSON-Body");
  }
}

/**
 * @param {Request} request
 * @param {{ db: any, gate: any, registry: any, dataVersion: string }} deps
 * @returns {Promise<Response>}
 */
export async function route(request, deps) {
  const cors = corsHeadersFor(request);
  if (request.method === "OPTIONS") {
    // FastAPIs CORSMiddleware beantwortet Preflight-OPTIONS-Anfragen selbst,
    // vor jedem Pfad-Handler -- main.py definiert keine eigene
    // OPTIONS-Route. Hier dieselbe Semantik: 204, kein Body.
    return new Response(null, { status: 204, headers: cors });
  }

  const { db, gate, registry, dataVersion, release = null } = deps;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return badRequest("invalid URL", cors);
  }
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const q = url.searchParams;
  const segs = path.split("/").filter(Boolean);

  try {
    if (path === "/health") {
      // Daten- UND Indexversion, damit von aussen pruefbar ist, welches
      // Release gerade bedient wird (P3.4) -- das ist der Nachweis, dass ein
      // Rollback gegriffen hat. `release` ist optional: der Contract-Test ruft
      // route() ohne Release-Zeiger auf, weil die 14 Fachendpunkte ihn nicht
      // brauchen.
      return json(
        {
          status: "ok",
          dataVersion,
          indexVersion: release?.indexVersion ?? null,
          releaseId: release?.releaseId ?? null,
          releaseActivatedAt: release?.activatedAt ?? null,
          releasePointer: release?.source ?? null,
        },
        200,
        cors,
      );
    }
    if (segs[0] !== "api" || segs[1] !== "v1") return notFound("Not Found", cors);
    const rest = segs.slice(2);
    const id = (i) => decodeURIComponent(rest[i]);

    // P5.8: getrennte, authentifizierte Redaktionsschnittstelle. Editor-IDs
    // kommen nie aus dem Request-Body; authenticateEditor() loest den
    // gehashten Bearer-Token auf und liest die aktiven Rollen aus D1.
    if (rest[0] === "editorial") {
      const editorHeaders = { ...cors, "cache-control": "no-store" };
      const editor = await editorialQ.authenticateEditor(db, request);
      const limit = clampInt(q.get("limit"), { def: 40, min: 1, max: 100 });
      if (request.method === "GET" && rest.length === 2 && rest[1] === "session") {
        return json(editor, 200, editorHeaders);
      }
      if (request.method === "GET" && rest.length === 2 && rest[1] === "review-queue") {
        return json(await editorialQ.listReviewQueue(db, editor, { limit }), 200, editorHeaders);
      }
      if (request.method === "GET" && rest.length === 2 && rest[1] === "proposals") {
        return json(await editorialQ.listPendingProposals(db, editor, { limit }), 200, editorHeaders);
      }
      if (request.method === "GET" && rest.length === 2 && rest[1] === "revisions") {
        return json(await editorialQ.listRevisions(db, editor, { limit }), 200, editorHeaders);
      }
      if (request.method === "POST" && rest.length === 2 && rest[1] === "proposals") {
        const result = await editorialQ.createProposal(db, editor, dataVersion, await requestJson(request));
        return json(result, 201, editorHeaders);
      }
      if (request.method === "POST" && rest.length === 4 && rest[1] === "proposals" && rest[3] === "finalize") {
        return json(await editorialQ.finalizeProposal(db, editor, id(2)), 201, editorHeaders);
      }
      if (request.method === "POST" && rest.length === 4 && rest[1] === "revisions" && rest[3] === "revert") {
        const result = await editorialQ.revertRevision(db, editor, dataVersion, id(2), await requestJson(request));
        return json(result, 201, editorHeaders);
      }
      return notFound("Not Found", editorHeaders);
    }

    if (request.method !== "GET") return notFound("Not Found", cors);

    if (rest.length === 1 && rest[0] === "hadiths") {
      const collection = enumOrNull(q.get("collection"), ["bukhari", "muslim"]);
      const query = (q.get("q") ?? "").slice(0, 240);
      const limit = clampInt(q.get("limit"), { def: 20, min: 1, max: 100 });
      return json(await hadithsQ.listHadiths(db, gate, dataVersion, { collection, query, cursor: q.get("cursor"), limit }), 200, cors);
    }

    if (rest.length === 2 && rest[0] === "hadiths") {
      const result = await hadithsQ.getHadith(db, gate, dataVersion, id(1));
      return result ? json(result, 200, cors) : notFound("Hadith occurrence not found", cors);
    }

    if (rest.length === 3 && rest[0] === "hadiths" && rest[2] === "chains") {
      const result = await hadithsQ.getChains(db, gate, dataVersion, id(1));
      return result ? json(result, 200, cors) : notFound("Hadith occurrence not found", cors);
    }

    if (rest.length === 3 && rest[0] === "clusters" && rest[2] === "routes") {
      const collection = enumOrNull(q.get("collection"), ["bukhari", "muslim"]);
      const limit = clampInt(q.get("limit"), { def: 250, min: 1, max: 1000 });
      const result = await hadithsQ.getClusterRoutes(db, gate, dataVersion, id(1), { collection, limit });
      return result ? json(result, 200, cors) : notFound("Cluster not found", cors);
    }

    if (rest.length === 3 && rest[0] === "clusters" && rest[2] === "matn-variants") {
      const result = await hadithsQ.getClusterMatnVariants(db, gate, dataVersion, id(1));
      return result ? json(result, 200, cors) : notFound("Cluster not found", cors);
    }

    if (rest.length === 1 && rest[0] === "rijal") {
      const source = enumOrNull(q.get("source"), rijalQ.RIJAL_API_SOURCES) ?? "shamela";
      const query = (q.get("q") ?? "").slice(0, 240);
      const limit = clampInt(q.get("limit"), { def: 40, min: 1, max: 100 });
      return json(await rijalQ.listRijalEntries(db, gate, dataVersion, { source, query, cursor: q.get("cursor"), limit }), 200, cors);
    }

    if (rest.length === 1 && rest[0] === "identity-candidates") {
      const query = q.get("q") ?? "";
      if (query.length < 1 || query.length > 240) return badRequest("q: 1..240 Zeichen erforderlich", cors);
      const limit = clampInt(q.get("limit"), { def: 24, min: 1, max: 100 });
      return json(await rijalQ.getIdentityCandidates(db, gate, dataVersion, query, limit), 200, cors);
    }

    if (rest.length === 2 && rest[0] === "rijal") {
      const result = await rijalQ.getRijalEntry(db, gate, dataVersion, id(1));
      return result ? json(result, 200, cors) : notFound("Rijal entry not found", cors);
    }

    if (rest.length === 2 && rest[0] === "narrators" && rest[1] === "compare") {
      const a = q.get("a");
      const b = q.get("b");
      if (!a || !b) return badRequest("a und b erforderlich", cors);
      return json(await narratorsQ.compareNarrators(db, gate, dataVersion, a, b), 200, cors);
    }

    // Additive Erweiterung ohne FastAPI-Pendant, siehe graph-traversal.mjs.
    if (rest.length === 3 && rest[0] === "narrators" && rest[2] === "paths") {
      const direction = q.get("direction") === "transmitted_to" ? "transmitted_to" : "transmitted_from";
      const maxDepth = clampInt(q.get("maxDepth"), { def: 8, min: 1, max: 8 });
      return json(await getNarratorPaths(db, dataVersion, id(1), { direction, maxDepth }), 200, cors);
    }

    if (rest.length === 3 && rest[0] === "narrators" && rest[2] === "relations") {
      const limit = clampInt(q.get("limit"), { def: 100, min: 1, max: 500 });
      return json(await narratorsQ.getNarratorRelations(db, gate, dataVersion, id(1), { cursor: q.get("cursor"), limit }), 200, cors);
    }

    if (rest.length === 3 && rest[0] === "narrators" && rest[2] === "timeline") {
      const result = await narratorsQ.getNarratorTimeline(db, gate, dataVersion, id(1));
      return result ? json(result, 200, cors) : notFound("No occurrence cluster found for this identifier", cors);
    }

    if (rest.length === 2 && rest[0] === "narrators") {
      const result = await narratorsQ.getNarratorProfile(db, gate, dataVersion, id(1));
      return result ? json(result, 200, cors) : notFound("No occurrence cluster found for this identifier", cors);
    }

    if (rest.length === 2 && rest[0] === "chronology" && rest[1] === "compare") {
      const a = q.get("a");
      const b = q.get("b");
      if (!a || !b) return badRequest("a und b erforderlich", cors);
      return json(await narratorsQ.compareChronology(db, gate, dataVersion, a, b), 200, cors);
    }

    if (rest.length === 1 && rest[0] === "sources") {
      return json(sourcesQ.listSources(registry, dataVersion), 200, cors);
    }

    if (rest.length === 2 && rest[0] === "sources") {
      const result = sourcesQ.getSource(registry, dataVersion, id(1));
      return result ? json(result, 200, cors) : notFound("Source not found", cors);
    }

    return notFound("Not Found", cors);
  } catch (error) {
    if (error instanceof editorialQ.EditorialError) return json({ detail: error.message }, error.status, { ...cors, "cache-control": "no-store" });
    return json({ detail: `internal error: ${error instanceof Error ? error.message : String(error)}` }, 500, cors);
  }
}
