from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[2]
DERIVED = Path(os.environ.get("CORPUS_DERIVED_DIR", ROOT / ".cache" / "turath-derived"))
MANIFEST = ROOT / "data" / "sources" / "turath-manifest.json"
PUBLIC_MANIFEST = ROOT / "public" / "data" / "corpus" / "manifest.json"
try:
    DATA_VERSION = json.loads(PUBLIC_MANIFEST.read_text(encoding="utf-8")).get("dataVersion", "research-unversioned")
except (FileNotFoundError, json.JSONDecodeError):
    DATA_VERSION = "research-unversioned"

DIACRITICS = re.compile(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]")


def normalize_arabic(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    value = DIACRITICS.sub("", value).replace("ـ", "")
    return re.sub(r"\s+", " ", value.translate(str.maketrans("أإآٱىةؤئ", "اااايهوي"))).strip().lower()


def _cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(f"v1:{offset}".encode()).decode().rstrip("=")


def _offset(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        version, value = raw.split(":", 1)
        return max(0, int(value)) if version == "v1" else 0
    except (ValueError, UnicodeError):
        return 0


def public_meta(confidence: str = "machine", review_status: str = "machine_unreviewed", *, last_reviewed_at: str | None = None) -> dict[str, Any]:
    return {
        "confidence": confidence,
        "reviewStatus": review_status,
        "dataVersion": DATA_VERSION,
        "lastReviewedAt": last_reviewed_at,
    }


def envelope(data: Any, sources: list[dict[str, Any]], **meta: Any) -> dict[str, Any]:
    standard = public_meta(**{key: value for key, value in meta.items() if key in {"confidence", "review_status", "last_reviewed_at"}})
    standard.update({key: value for key, value in meta.items() if key not in {"confidence", "review_status", "last_reviewed_at"}})
    return {"data": data, "sourceReferences": sources, **standard}


class CorpusRepository:
    """Read-only development repository.

    Production swaps this adapter for PostgreSQL without changing the public API.
    The JSON files are immutable importer output and are never editorial truth.
    """

    def __init__(self, derived_dir: Path = DERIVED) -> None:
        self.derived_dir = derived_dir
        self.registry = json.loads(MANIFEST.read_text(encoding="utf-8"))
        self.summary = json.loads(PUBLIC_MANIFEST.read_text(encoding="utf-8")) if PUBLIC_MANIFEST.exists() else {}

    @lru_cache(maxsize=4)
    def records(self, collection: str) -> tuple[dict[str, Any], ...]:
        if collection not in {"bukhari", "muslim"}:
            return ()
        path = self.derived_dir / f"{collection}.json"
        if not path.exists():
            return ()
        return tuple(json.loads(path.read_text(encoding="utf-8"))["records"])

    def all_records(self, collection: str | None = None) -> Iterable[dict[str, Any]]:
        collections = (collection,) if collection in {"bukhari", "muslim"} else ("bukhari", "muslim")
        for key in collections:
            yield from self.records(key)

    @lru_cache(maxsize=4)
    def rijal_records(self, source: str) -> tuple[dict[str, Any], ...]:
        if source not in {"tahdhib", "mizan", "taqrib"}:
            return ()
        path = self.derived_dir / f"{source}.json"
        if not path.exists():
            return ()
        return tuple(json.loads(path.read_text(encoding="utf-8"))["entries"])

    @lru_cache(maxsize=1)
    def rijal_search_index(self) -> tuple[tuple[str, dict[str, Any], str, str], ...]:
        return tuple(
            (
                source,
                entry,
                normalize_arabic(entry.get("nameSurface", "")).strip(" .،؛:-()[]"),
                normalize_arabic(entry.get("text", "")),
            )
            for source in ("tahdhib", "mizan", "taqrib")
            for entry in self.rijal_records(source)
        )

    @staticmethod
    def source_reference(record: dict[str, Any]) -> dict[str, Any]:
        return {
            "sourceWork": record["collection"],
            "hadithNumber": record["hadithNumber"],
            "routeNumber": record.get("routeNumber"),
            "volume": record.get("volume"),
            "page": record.get("printedPage"),
            "sourcePageId": record.get("sourcePageId"),
            "url": record["source"]["url"],
            "rightsStatus": record["source"]["rightsStatus"],
        }

    @staticmethod
    def public_record(record: dict[str, Any], *, include_text: bool = False) -> dict[str, Any]:
        item = {
            "id": record["id"],
            "collection": record["collection"],
            "hadithNumber": record["hadithNumber"],
            "routeNumber": record.get("routeNumber"),
            "book": record.get("book"),
            "chapter": record.get("chapter"),
            "volume": record.get("volume"),
            "page": record.get("printedPage"),
            "chainCount": len(record.get("chains") or []) or record.get("routeMarkers", 1),
            "narratorOccurrenceCount": len(record.get("narratorSurfaceForms", [])),
            "parser": record["parser"],
        }
        if include_text:
            item.update({"isnad": record.get("isnad"), "matn": record.get("matn")})
        return item

    def hadiths(self, *, collection: str | None, query: str, cursor: str | None, limit: int) -> dict[str, Any]:
        start = _offset(cursor)
        wanted = normalize_arabic(query)
        matches: list[dict[str, Any]] = []
        skipped = 0
        has_more = False
        for record in self.all_records(collection):
            haystack = normalize_arabic(" ".join(str(record.get(field) or "") for field in ("hadithNumber", "book", "chapter", "isnad", "matn")))
            if wanted and wanted not in haystack:
                continue
            if skipped < start:
                skipped += 1
                continue
            if len(matches) >= limit:
                has_more = True
                break
            matches.append(self.public_record(record, include_text=True))
        refs = [self.source_reference(record) for record in self._records_by_ids({item["id"] for item in matches})]
        return envelope(
            {"items": matches, "pageInfo": {"nextCursor": _cursor(start + limit) if has_more else None, "hasNextPage": has_more}},
            refs,
            confidence="mixed",
            resultCount=len(matches),
        )

    def _records_by_ids(self, ids: set[str]) -> Iterable[dict[str, Any]]:
        for record in self.all_records():
            if record["id"] in ids:
                yield record

    def hadith(self, record_id: str) -> dict[str, Any] | None:
        for record in self.all_records():
            if record["id"] == record_id:
                return envelope(self.public_record(record, include_text=True), [self.source_reference(record)], confidence=str(record["parser"]["confidence"]))
        return None

    @staticmethod
    def public_rijal_entry(entry: dict[str, Any], source: str) -> dict[str, Any]:
        return {
            "id": entry["id"],
            "source": source,
            "entryNumber": entry.get("entryNumber"),
            "nameSurface": entry.get("nameSurface"),
            "deathYearCandidate": entry.get("deathYearCandidate"),
            "teacherPhrase": entry.get("teacherPhrase"),
            "studentPhrase": entry.get("studentPhrase"),
            "volume": entry.get("volume"),
            "page": entry.get("printedPage"),
            "parser": entry.get("parser"),
            "identityStatus": "unresolved",
        }

    @staticmethod
    def rijal_source_reference(entry: dict[str, Any], source: str) -> dict[str, Any]:
        return {
            "sourceWork": source,
            "entryNumber": entry.get("entryNumber"),
            "volume": entry.get("volume"),
            "page": entry.get("printedPage"),
            "sourcePageId": entry.get("sourcePageId"),
            "url": entry["source"]["url"],
            "rightsStatus": entry["source"]["rightsStatus"],
        }

    def rijal_entries(self, *, source: str, query: str, cursor: str | None, limit: int) -> dict[str, Any]:
        start = _offset(cursor)
        wanted = normalize_arabic(query)
        matches: list[dict[str, Any]] = []
        source_entries: list[dict[str, Any]] = []
        skipped = 0
        has_more = False
        for entry in self.rijal_records(source):
            if wanted and wanted not in normalize_arabic(entry.get("text", "")):
                continue
            if skipped < start:
                skipped += 1
                continue
            if len(matches) >= limit:
                has_more = True
                break
            matches.append(self.public_rijal_entry(entry, source))
            source_entries.append(entry)
        return envelope(
            {"items": matches, "pageInfo": {"nextCursor": _cursor(start + len(matches)) if has_more else None, "hasNextPage": has_more}},
            [self.rijal_source_reference(entry, source) for entry in source_entries],
            confidence="machine",
            resultCount=len(matches),
        )

    def rijal_entry(self, entry_id: str) -> dict[str, Any] | None:
        source = entry_id.split("-", 1)[0]
        for entry in self.rijal_records(source):
            if entry["id"] == entry_id:
                return envelope(self.public_rijal_entry(entry, source), [self.rijal_source_reference(entry, source)], confidence=str(entry["parser"]["confidence"]))
        return None

    def rijal_candidates(self, *, query: str, limit: int) -> dict[str, Any]:
        """Return source entries ranked as identity candidates, never identities.

        Name-heading matches rank before mentions buried in a biography. Results
        remain separate per source so the client cannot accidentally turn a text
        search hit into a canonical-person merge.
        """
        wanted = normalize_arabic(query)
        if not wanted:
            return envelope({"query": query, "items": []}, [], confidence="insufficient", resultCount=0)

        ranked: list[tuple[int, int, dict[str, Any], str, dict[str, Any]]] = []
        for source, entry, name, text in self.rijal_search_index():
            if name == wanted:
                rank, match_kind = 0, "exact_name"
            elif name.startswith(wanted) or wanted.startswith(name):
                rank, match_kind = 1, "name_prefix"
            elif wanted in name:
                rank, match_kind = 2, "name_contains"
            elif wanted in text:
                rank, match_kind = 3, "biography_mention"
            else:
                continue
            item = self.public_rijal_entry(entry, source)
            item["matchKind"] = match_kind
            ranked.append((rank, len(name), item, source, entry))

        ranked.sort(key=lambda item: (item[0], item[1], item[2]["entryNumber"] or 0))
        selected = ranked[:limit]
        references = [self.rijal_source_reference(entry, source) for _, _, _, source, entry in selected]
        return envelope(
            {"query": query, "items": [item for _, _, item, _, _ in selected]},
            references,
            confidence="machine",
            resultCount=len(selected),
        )

    def chains(self, record_id: str) -> dict[str, Any] | None:
        for record in self.all_records():
            if record["id"] != record_id:
                continue
            chains = record.get("chains") or [{
                "chainOrder": 0,
                "rawIsnad": record.get("isnad", ""),
                "narratorOccurrences": [
                    {"position": index, "rawSurfaceForm": surface, "normalizedSurfaceForm": normalize_arabic(surface), "identityStatus": "unresolved"}
                    for index, surface in enumerate(record.get("narratorSurfaceForms", []))
                ],
            }]
            return envelope({"hadithId": record_id, "items": chains}, [self.source_reference(record)], confidence=str(record["parser"]["confidence"]))
        return None

    def routes(self, cluster_id: str, collection: str | None = None, limit: int = 250) -> dict[str, Any] | None:
        fingerprint = cluster_id.removeprefix("HCL-")
        records = [record for record in self.all_records(collection) if record.get("matnFingerprint") == fingerprint]
        if not records:
            return None
        nodes: dict[str, dict[str, Any]] = {}
        edges: dict[str, dict[str, Any]] = {}
        for record in records[:limit]:
            chains = record.get("chains") or [{"narratorOccurrences": [{"rawSurfaceForm": name, "normalizedSurfaceForm": normalize_arabic(name)} for name in record.get("narratorSurfaceForms", [])]}]
            for chain in chains:
                ids = []
                for occurrence in chain["narratorOccurrences"]:
                    normalized = occurrence.get("normalizedSurfaceForm") or normalize_arabic(occurrence["rawSurfaceForm"])
                    node_id = "UNC-" + hashlib.sha1(normalized.encode()).hexdigest()[:12]
                    ids.append(node_id)
                    nodes.setdefault(node_id, {"id": node_id, "label": occurrence["rawSurfaceForm"], "identityStatus": "unresolved", "reviewStatus": "machine_unreviewed"})
                for position, (source, target) in enumerate(zip(ids, ids[1:])):
                    edge_id = f"{source}:{target}"
                    edge = edges.setdefault(edge_id, {"id": edge_id, "source": source, "target": target, "evidenceKind": "isnad_occurrence", "occurrences": [], "matnFamilies": []})
                    edge["occurrences"].append({"hadithId": record["id"], "chainOrder": chain.get("chainOrder", 0), "position": position})
                    if fingerprint not in edge["matnFamilies"]:
                        edge["matnFamilies"].append(fingerprint)
        return envelope(
            {"clusterId": cluster_id, "nodes": list(nodes.values()), "edges": list(edges.values()), "recordCount": len(records), "truncated": len(records) > limit},
            [self.source_reference(record) for record in records[:limit]],
            confidence="machine",
        )

    def matn_variants(self, cluster_id: str) -> dict[str, Any] | None:
        fingerprint = cluster_id.removeprefix("HCL-")
        records = [record for record in self.all_records() if record.get("matnFingerprint") == fingerprint]
        if not records:
            return None
        families: dict[str, dict[str, Any]] = {}
        colors = ("teal", "clay", "gold", "ink", "sage")
        for record in records:
            normalized = normalize_arabic(record.get("matn", ""))
            family_key = hashlib.sha1(normalized.encode()).hexdigest()[:12]
            family = families.setdefault(family_key, {"id": family_key, "colorToken": colors[len(families) % len(colors)], "representativeText": record.get("matn"), "hadithIds": [], "reviewStatus": "machine_unreviewed"})
            family["hadithIds"].append(record["id"])
        return envelope({"clusterId": cluster_id, "status": "machine_suggestion", "items": list(families.values())}, [self.source_reference(record) for record in records], confidence="machine")

    def sources(self, source_id: str) -> dict[str, Any] | None:
        for source in self.registry["sources"]:
            if source["key"] == source_id:
                return envelope(source, [{"provider": "turath", "workId": source["turathBookId"], "url": f"https://app.turath.io/book/{source['turathBookId']}"}], confidence="registry")
        for source in self.registry.get("externalDatasets", []):
            if source["key"] == source_id:
                return envelope(source, [{"url": source["url"], "doi": source.get("doi"), "license": source.get("license")}], confidence="registry")
        return None

    def source_list(self) -> dict[str, Any]:
        items = [*self.registry["sources"], *self.registry.get("externalDatasets", [])]
        return envelope({"items": items}, [{"registry": "data/sources/turath-manifest.json"}], confidence="registry")


repository = CorpusRepository()
