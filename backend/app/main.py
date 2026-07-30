from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .repository import DATA_VERSION, envelope, repository


app = FastAPI(
    title="Sanad Atlas API",
    version="1.0.0",
    description="Source-bound research API for Sahih al-Bukhari and Sahih Muslim.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://midodotcom0.github.io"],
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "dataVersion": DATA_VERSION}


@app.get("/api/v1/hadiths")
def get_hadiths(
    collection: str | None = Query(default=None, pattern="^(bukhari|muslim)$"),
    q: str = Query(default="", max_length=240),
    cursor: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
) -> dict:
    return repository.hadiths(collection=collection, query=q, cursor=cursor, limit=limit)


@app.get("/api/v1/hadiths/{hadith_id}")
def get_hadith(hadith_id: str) -> dict:
    result = repository.hadith(hadith_id)
    if result is None:
        raise HTTPException(404, "Hadith occurrence not found")
    return result


@app.get("/api/v1/hadiths/{hadith_id}/chains")
def get_chains(hadith_id: str) -> dict:
    result = repository.chains(hadith_id)
    if result is None:
        raise HTTPException(404, "Hadith occurrence not found")
    return result


@app.get("/api/v1/clusters/{cluster_id}/routes")
def get_cluster_routes(cluster_id: str, collection: str | None = Query(default=None, pattern="^(bukhari|muslim)$"), limit: int = Query(default=250, ge=1, le=1000)) -> dict:
    result = repository.routes(cluster_id, collection=collection, limit=limit)
    if result is None:
        raise HTTPException(404, "Cluster not found")
    return result


@app.get("/api/v1/clusters/{cluster_id}/matn-variants")
def get_matn_variants(cluster_id: str) -> dict:
    result = repository.matn_variants(cluster_id)
    if result is None:
        raise HTTPException(404, "Cluster not found")
    return result


@app.get("/api/v1/rijal")
def get_rijal_entries(
    source: str = Query(default="tahdhib", pattern="^(tahdhib|mizan|taqrib)$"),
    q: str = Query(default="", max_length=240),
    cursor: str | None = None,
    limit: int = Query(default=40, ge=1, le=100),
) -> dict:
    return repository.rijal_entries(source=source, query=q, cursor=cursor, limit=limit)


@app.get("/api/v1/identity-candidates")
def get_identity_candidates(
    q: str = Query(min_length=1, max_length=240),
    limit: int = Query(default=24, ge=1, le=100),
) -> dict:
    return repository.rijal_candidates(query=q, limit=limit)


@app.get("/api/v1/rijal/{entry_id}")
def get_rijal_entry(entry_id: str) -> dict:
    result = repository.rijal_entry(entry_id)
    if result is None:
        raise HTTPException(404, "Rijal entry not found")
    return result


@app.get("/api/v1/narrators/compare")
def compare_narrators(a: str, b: str) -> dict:
    return envelope({"narratorA": a, "narratorB": b, "chronology": "insufficient", "meeting": "not_asserted"}, [], confidence="insufficient")


@app.get("/api/v1/narrators/{narrator_id}")
def get_narrator(narrator_id: str) -> dict:
    # Canonical identities are intentionally unavailable until an identity
    # decision has been accepted. Occurrence candidates remain visible in chains.
    raise HTTPException(404, "No reviewed canonical narrator with this identifier")


@app.get("/api/v1/narrators/{narrator_id}/relations")
def get_relations(narrator_id: str, cursor: str | None = None, limit: int = Query(default=100, ge=1, le=500)) -> dict:
    return envelope({"narratorId": narrator_id, "items": [], "pageInfo": {"nextCursor": None, "hasNextPage": False}}, [], confidence="insufficient")


@app.get("/api/v1/narrators/{narrator_id}/timeline")
def get_timeline(narrator_id: str) -> dict:
    return envelope({"narratorId": narrator_id, "dateAssertions": [], "chronology": "insufficient"}, [], confidence="insufficient")


@app.get("/api/v1/chronology/compare")
def compare_chronology(a: str, b: str) -> dict:
    return envelope({"narratorA": a, "narratorB": b, "result": "insufficient", "meetingIsProven": False}, [], confidence="insufficient")


@app.get("/api/v1/sources")
def list_sources() -> dict:
    return repository.source_list()


@app.get("/api/v1/sources/{source_id}")
def get_source(source_id: str) -> dict:
    result = repository.sources(source_id)
    if result is None:
        raise HTTPException(404, "Source not found")
    return result
