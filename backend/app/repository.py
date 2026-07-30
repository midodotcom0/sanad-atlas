from __future__ import annotations

import base64
import hashlib
import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

# Kanonischer Normalisierer (Umsetzungsplan P1.2/Befund B8): einzige
# fachliche Definition ist lib/search.ts; backend/app/normalize.py ist ihr
# bitgleicher Python-Port. repository.py hatte zuvor einen eigenen,
# divergierenden normalize_arabic (kein ibn/bin, andere Diakritika-Range) --
# seit Agent 1 normalize.py angelegt hat, importiert dieses Modul von dort
# statt eine zweite Definition zu pflegen.
from .normalize import normalize_arabic
from .hijri_date_phrase import parse_hijri_year_phrase


ROOT = Path(__file__).resolve().parents[2]
DERIVED = Path(os.environ.get("CORPUS_DERIVED_DIR", ROOT / ".cache" / "turath-derived"))
MANIFEST = ROOT / "data" / "sources" / "turath-manifest.json"
PUBLIC_MANIFEST = ROOT / "public" / "data" / "corpus" / "manifest.json"
try:
    DATA_VERSION = json.loads(PUBLIC_MANIFEST.read_text(encoding="utf-8")).get("dataVersion", "research-unversioned")
except (FileNotFoundError, json.JSONDecodeError):
    DATA_VERSION = "research-unversioned"


# ---------------------------------------------------------------------------
# Response envelope contract (Sanad-Atlas-Projektbeschreibung.txt Abschnitt 12;
# Umsetzungsplan P2.2). Binding for every substantive ("fachliche") answer
# from every agent's endpoints, not just this file.
#
#   sourceReferences  -- never empty for a substantive statement
#   confidenceLevel   -- verified|high|medium|low|unresolved|conflict
#   confidenceScore   -- 0..1 or null, machine-only
#   origin            -- machine|editorial|registry
#   reviewStatus      -- the SAME six-stage vocabulary as confidenceLevel
#   dataVersion
#   lastReviewedAt    -- ISO-8601 or null
#
# Thresholds: high >= 0.90, medium 0.70-0.89, low < 0.70. Machine processing
# must never claim "verified" -- that is reserved for an accepted editorial
# decision, which this dev adapter never produces on its own.
# ---------------------------------------------------------------------------

CONFIDENCE_LEVELS = ("verified", "high", "medium", "low", "unresolved", "conflict")
ORIGIN_KINDS = ("machine", "editorial", "registry")


def level_from_score(score: float | None) -> str:
    """Maps a machine confidence score onto the shared six-stage vocabulary.

    Never returns "verified" (only an accepted editorial decision may) and
    never returns "conflict" (that requires an explicit hard-conflict rule,
    which this module does not compute -- see Umsetzungsplan P4.3).
    """
    if score is None:
        return "unresolved"
    if score >= 0.90:
        return "high"
    if score >= 0.70:
        return "medium"
    return "low"


def aggregate_machine_confidence(scores: Iterable[Any]) -> tuple[str, float | None]:
    """Aggregates per-record parser confidence into one envelope-level figure.

    Deliberately conservative: uses the weakest (minimum) score in the set
    rather than an average, so a handful of low-confidence parses cannot be
    diluted into a falsely reassuring headline number. Returns
    ("unresolved", None) for an empty set -- never a made-up figure.
    """
    values = [float(s) for s in scores if isinstance(s, (int, float))]
    if not values:
        return "unresolved", None
    weakest = min(values)
    return level_from_score(weakest), round(weakest, 3)


def envelope(
    data: Any,
    sources: list[dict[str, Any]],
    *,
    confidence_level: str,
    confidence_score: float | None = None,
    origin: str = "machine",
    review_status: str | None = None,
    last_reviewed_at: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    """Canonical response envelope. See module docstring above for the contract.

    ``review_status`` defaults to ``confidence_level``: no editorial review
    workflow exists yet in this dev adapter (Umsetzungsplan P5.8), so nothing
    has ever moved independently of its machine-assessed confidence. The
    field stays distinct in the payload so a future review pipeline can
    diverge it without a breaking change.
    """
    if confidence_level not in CONFIDENCE_LEVELS:
        raise ValueError(f"unknown confidenceLevel: {confidence_level!r}")
    if origin not in ORIGIN_KINDS:
        raise ValueError(f"unknown origin: {origin!r}")
    if origin == "machine" and confidence_level == "verified":
        raise ValueError("machine origin must never report confidenceLevel='verified'")
    if origin != "machine":
        confidence_score = None
    if confidence_score is not None and not (0.0 <= confidence_score <= 1.0):
        raise ValueError(f"confidenceScore out of range: {confidence_score!r}")
    resolved_review_status = review_status if review_status is not None else confidence_level
    if resolved_review_status not in CONFIDENCE_LEVELS:
        raise ValueError(f"unknown reviewStatus: {resolved_review_status!r}")
    body: dict[str, Any] = {
        "data": data,
        "sourceReferences": sources,
        "confidenceLevel": confidence_level,
        "confidenceScore": confidence_score,
        "origin": origin,
        "reviewStatus": resolved_review_status,
        "dataVersion": DATA_VERSION,
        "lastReviewedAt": last_reviewed_at,
    }
    body.update(extra)
    return body


def cited(references: list[dict[str, Any]], reason: str) -> list[dict[str, Any]]:
    """Guarantees sourceReferences is never empty, even for a genuine "nothing
    found" result. A placeholder notice is not a citation -- it documents why
    none exists, which is itself the honest, source-bound answer."""
    return references if references else [{"notice": reason}]


# ---------------------------------------------------------------------------
# Relative back-references (Abschnitt 3: "أبيه", "عمه", "أخيه", "جده", ...)
# must never be resolved globally -- each occurrence is bound to its own
# chain position. The canonical, position-bound resolver is separate future
# work (Umsetzungsplan P4.4, lib/relative-forms.ts). This module only
# refuses to merge; it does not attempt to resolve who "his father" is.
# ---------------------------------------------------------------------------

_RELATIVE_REFERENCE_TERMS_RAW = (
    "أبيه", "عمه", "أخيه", "جده", "أمه", "امه", "ابنه", "بنته",
    "جدته", "زوجته", "خاله", "خالته", "عمته", "أخته", "اخته", "جدها",
)
RELATIVE_REFERENCE_TERMS = frozenset(normalize_arabic(term) for term in _RELATIVE_REFERENCE_TERMS_RAW)


def is_relative_reference(normalized_form: str) -> bool:
    """True when a surface form contains a relative back-reference token,
    i.e. it names someone only *relative to* the preceding narrator in this
    specific chain, not by an independent name.

    Re-normalizes defensively: the imported corpus's own "normalizedSurfaceForm"
    field is frequently not actually normalized yet (Befund B3 -- raw and
    "normalized" are byte-identical in 69.859 of 77.566 occurrences), so this
    cannot assume its input already went through normalize_arabic().
    normalize_arabic() is idempotent, so re-applying it to already-clean
    input is a harmless no-op.
    """
    tokens = set(normalize_arabic(normalized_form or "").split())
    return bool(tokens & RELATIVE_REFERENCE_TERMS)


def bucket_id(record_id: str, chain_order: int, position: int, normalized_form: str) -> str:
    """Deterministic, reversible occurrence-cluster id.

    Ordinary names get a corpus-wide id keyed only by normalized form -- an
    unresolved occurrence cluster, never a confirmed canonical person (that
    requires an accepted identity decision, Umsetzungsplan P4.5). This keeps
    the same "UNC-" scheme already used by CorpusRepository.routes() so a
    graph node id resolves through /narrators/{id} unchanged.

    Relative back-references get a chain-local id instead, so they can never
    collide with -- and therefore never be silently merged with -- an
    occurrence in a different chain (see RELATIVE_REFERENCE_TERMS above).

    Re-normalizes ``normalized_form`` before hashing (see is_relative_reference
    docstring): otherwise two occurrences of the same name could land in
    different buckets purely because the importer's own "normalized" field
    was not actually normalized consistently.
    """
    canonical = normalize_arabic(normalized_form or "")
    if not canonical or is_relative_reference(canonical):
        digest = hashlib.sha1(f"{record_id}:{chain_order}:{position}:{canonical}".encode()).hexdigest()[:12]
        return f"UNC-REL-{digest}"
    return "UNC-" + hashlib.sha1(canonical.encode()).hexdigest()[:12]


# ---------------------------------------------------------------------------
# Licence gate (Umsetzungsplan P2.4 / Befund B5). data/sources/turath-manifest.json
# is the single source of truth for publicDerivedFields and rightsStatus; it
# belongs to Agent 1 and is only ever read here, never written.
#
# Two independent gates, matching the literal instruction:
#   1. "include_text nur, wenn der Rechtestatus der Quelle es erlaubt": full,
#      extended edition prose (hadith isnad/matn, rijal teacher/student
#      phrases) additionally requires the source's rightsStatus to be in
#      TEXT_RIGHTS_CLEARED_STATUSES. Every currently registered Turath source
#      is "review-required", so this is closed today -- by design, per
#      Projektbeschreibung Abschnitt 10 ("Volltexte ... werden ... nicht
#      ungeprüft öffentlich weiterverteilt").
#   2. "Felder nur, wenn sie in publicDerivedFields stehen": every derived
#      field, literal-text or not, additionally requires its allowlist label
#      to be present for that source. taqrib and mizan both omit
#      "teacher_student_phrases", for example, so those two fields never
#      leave the API for those sources regardless of rights status.
# ---------------------------------------------------------------------------

TEXT_RIGHTS_CLEARED_STATUSES = frozenset({"cleared", "public-domain", "editorially-cleared"})


class CorpusRepository:
    """Read-only development repository.

    Production swaps this adapter for PostgreSQL without changing the public API.
    The JSON files are immutable importer output and are never editorial truth.
    """

    def __init__(self, derived_dir: Path = DERIVED) -> None:
        self.derived_dir = derived_dir
        self.registry = json.loads(MANIFEST.read_text(encoding="utf-8"))
        self.summary = json.loads(PUBLIC_MANIFEST.read_text(encoding="utf-8")) if PUBLIC_MANIFEST.exists() else {}

    # -- licence gate -------------------------------------------------------

    def _source_manifest_entry(self, source_key: str) -> dict[str, Any] | None:
        for source in self.registry.get("sources", []):
            if source["key"] == source_key:
                return source
        return None

    def allowed_derived_fields(self, source_key: str) -> frozenset[str]:
        entry = self._source_manifest_entry(source_key)
        return frozenset(entry.get("publicDerivedFields", [])) if entry else frozenset()

    def rights_status_for(self, source_key: str) -> str:
        entry = self._source_manifest_entry(source_key)
        return entry.get("rightsStatus", "review-required") if entry else "review-required"

    def full_text_cleared(self, source_key: str) -> bool:
        return self.rights_status_for(source_key) in TEXT_RIGHTS_CLEARED_STATUSES

    # -- raw record access (cached: parsed once per process) ----------------

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
        """Every rijal entry with its normalized name/text pre-computed once.

        This used to only serve /identity-candidates; rijal_entries() and the
        narrator timeline/compare endpoints now reuse it too instead of
        re-normalizing per request (Umsetzungsplan P2.2, Befund: repository.py
        scanned all records in full text on every request).
        """
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

    @lru_cache(maxsize=8)
    def _rijal_id_index(self, source: str) -> dict[str, dict[str, Any]]:
        return {entry["id"]: entry for entry in self.rijal_records(source)}

    @lru_cache(maxsize=1)
    def _hadith_index(self) -> dict[str, Any]:
        """Built once per process, reused by every hadith-facing endpoint.

        Replaces four separate full-corpus scans per request (hadiths()'s
        text search, hadith()'s and _records_by_ids()'s linear id lookup,
        routes()'s and matn_variants()'s matnFingerprint filter) with O(1)
        dict lookups over pre-computed data. See the benchmark reported
        alongside this change for measured impact.
        """
        by_id: dict[str, dict[str, Any]] = {}
        haystack: dict[str, str] = {}
        order: dict[str, list[str]] = {"bukhari": [], "muslim": []}
        by_fingerprint: dict[str, list[dict[str, Any]]] = {}
        for collection in ("bukhari", "muslim"):
            for record in self.records(collection):
                rid = record["id"]
                by_id[rid] = record
                haystack[rid] = normalize_arabic(
                    " ".join(str(record.get(field) or "") for field in ("hadithNumber", "book", "chapter", "isnad", "matn"))
                )
                order[collection].append(rid)
                fingerprint = record.get("matnFingerprint")
                if fingerprint:
                    by_fingerprint.setdefault(fingerprint, []).append(record)
        order["all"] = order["bukhari"] + order["muslim"]
        return {"by_id": by_id, "haystack": haystack, "order": order, "by_fingerprint": by_fingerprint}

    @lru_cache(maxsize=1)
    def _narrator_occurrence_index(self) -> dict[str, dict[str, Any]]:
        """Buckets every isnad narrator occurrence by a deterministic
        occurrence-cluster id (bucket_id()) and records its immediate chain
        neighbours as isnad_occurrence-evidenced relations.

        This is NOT a resolved canonical person -- that requires an accepted
        identity decision, which this pipeline does not produce yet (see
        docs/05-ENTITY-RESOLUTION.md, Umsetzungsplan P4.5). It is a
        reversible, fully source-bound grouping over occurrences that already
        exist in the corpus, built once and shared by every /narrators/*
        endpoint below.
        """
        buckets: dict[str, dict[str, Any]] = {}
        for record in self.all_records():
            chains = record.get("chains") or [{
                "chainOrder": 0,
                "narratorOccurrences": [
                    {"position": i, "rawSurfaceForm": s, "normalizedSurfaceForm": normalize_arabic(s)}
                    for i, s in enumerate(record.get("narratorSurfaceForms", []))
                ],
            }]
            for chain in chains:
                occurrences = chain.get("narratorOccurrences", [])
                ids: list[str] = []
                for position, occurrence in enumerate(occurrences):
                    # normalize_arabic() defensively even though the field is
                    # already called "normalizedSurfaceForm": Befund B3 shows
                    # raw and "normalized" are byte-identical in 90% of
                    # occurrences, i.e. not actually canonicalized yet.
                    normalized = normalize_arabic(occurrence.get("normalizedSurfaceForm") or occurrence.get("rawSurfaceForm", ""))
                    node_id = bucket_id(record["id"], chain.get("chainOrder", 0), position, normalized)
                    ids.append(node_id)
                    bucket = buckets.setdefault(node_id, {
                        "id": node_id,
                        "normalizedSurfaceForm": normalized,
                        "isRelativeReference": is_relative_reference(normalized),
                        "rawSurfaceForms": set(),
                        "occurrences": [],
                        "neighbors": [],
                    })
                    bucket["rawSurfaceForms"].add(occurrence.get("rawSurfaceForm", ""))
                    bucket["occurrences"].append({
                        "hadithId": record["id"],
                        "collection": record["collection"],
                        "chainId": f"{record['id']}#{chain.get('chainOrder', 0)}",
                        "chainOrder": chain.get("chainOrder", 0),
                        "position": position,
                        "rawSurfaceForm": occurrence.get("rawSurfaceForm", ""),
                        "spanStart": occurrence.get("spanStart"),
                        "spanEnd": occurrence.get("spanEnd"),
                    })
                # Adjacent chain positions are a direct isnad_occurrence
                # relation: the earlier (closer to the compiler) position
                # narrates FROM the later (closer to the Prophet) position.
                for position, (source_id, target_id) in enumerate(zip(ids, ids[1:])):
                    chain_id = f"{record['id']}#{chain.get('chainOrder', 0)}"
                    buckets[source_id]["neighbors"].append({
                        "relatedNarratorId": target_id, "relationshipType": "transmitted_from",
                        "hadithId": record["id"], "collection": record["collection"],
                        "chainId": chain_id, "position": position,
                    })
                    buckets[target_id]["neighbors"].append({
                        "relatedNarratorId": source_id, "relationshipType": "transmitted_to",
                        "hadithId": record["id"], "collection": record["collection"],
                        "chainId": chain_id, "position": position,
                    })
        return buckets

    # -- shared building blocks ----------------------------------------------

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

    def public_record(self, record: dict[str, Any], *, source_key: str) -> dict[str, Any]:
        allowed = self.allowed_derived_fields(source_key)
        item: dict[str, Any] = {"id": record["id"], "collection": record["collection"]}
        if "reference" in allowed:
            item.update({
                "hadithNumber": record["hadithNumber"],
                "routeNumber": record.get("routeNumber"),
                "book": record.get("book"),
                "chapter": record.get("chapter"),
                "volume": record.get("volume"),
                "page": record.get("printedPage"),
            })
        if "narrator_surface_forms" in allowed:
            item["chainCount"] = len(record.get("chains") or []) or record.get("routeMarkers", 1)
            item["narratorOccurrenceCount"] = len(record.get("narratorSurfaceForms", []))
        item["parser"] = record["parser"]
        include_isnad = self.full_text_cleared(source_key) and "isnad" in allowed
        include_matn = self.full_text_cleared(source_key) and "matn" in allowed
        item["textWithheld"] = not (include_isnad and include_matn)
        if include_isnad:
            item["isnad"] = record.get("isnad")
        if include_matn:
            item["matn"] = record.get("matn")
        return item

    def public_rijal_entry(self, entry: dict[str, Any], source: str) -> dict[str, Any]:
        allowed = self.allowed_derived_fields(source)
        include_teacher_student = self.full_text_cleared(source) and "teacher_student_phrases" in allowed
        include_biography = "biography_fields" in allowed
        include_critic_ranks = "critic_ranks" in allowed
        include_criticism_references = "criticism_references" in allowed
        return {
            "id": entry["id"],
            "source": source,
            "entryNumber": entry.get("entryNumber") if "entry_number" in allowed else None,
            "nameSurface": entry.get("nameSurface") if "name_surface" in allowed else None,
            "longName": entry.get("longName") if include_biography else None,
            "kunya": entry.get("kunya") if include_biography else None,
            "nisbas": entry.get("nisbas") or [] if include_biography else [],
            "laqab": entry.get("laqab") if include_biography else None,
            "region": entry.get("region") if include_biography else None,
            "tabaqa": entry.get("tabaqa") if include_biography else None,
            "metadata": entry.get("metadata") or {} if include_biography else {},
            "residencePlaces": entry.get("residencePlaces") or [] if include_biography else [],
            "travelPlaces": entry.get("travelPlaces") or [] if include_biography else [],
            "deathPlaces": entry.get("deathPlaces") or [] if include_biography else [],
            "birthPlaces": entry.get("birthPlaces") or [] if include_biography else [],
            "relationNotes": entry.get("relationNotes") if include_biography else None,
            "creedNote": entry.get("creedNote") if include_biography else None,
            "ibnHajarGrade": entry.get("ibnHajarGrade") if include_critic_ranks else None,
            "alDhahabiGrade": entry.get("alDhahabiGrade") if include_critic_ranks else None,
            "deathYearCandidate": entry.get("deathYearCandidate") if "date_assertions" in allowed else None,
            "birthYearCandidate": entry.get("birthYearCandidate") if "date_assertions" in allowed else None,
            # Jede einzelne im Wortlaut genannte Jahresangabe, nicht nur die
            # erste. Die Turath-Werke schreiben ihre Jahre aus («ست وثلاثين
            # ومئتين») und liefern hier daher nichts -- dieselbe Regel wie in
            # worker/src/core/hijri-date-phrase.mjs: keine Aussage ohne Beleg
            # im Wortlaut.
            "dateAssertions": self.rijal_date_assertions(entry) if "date_assertions" in allowed else [],
            "teacherPhrase": entry.get("teacherPhrase") if include_teacher_student else None,
            "studentPhrase": entry.get("studentPhrase") if include_teacher_student else None,
            "textWithheld": not include_teacher_student,
            "criticisms": entry.get("criticisms") or [] if include_criticism_references else [],
            "criticismsWithheld": include_criticism_references and not self.full_text_cleared(source),
            "volume": entry.get("volume") if "source_pointer" in allowed else None,
            "page": entry.get("printedPage") if "source_pointer" in allowed else None,
            "parser": entry.get("parser"),
            "identityStatus": "unresolved",
        }

    @staticmethod
    def rijal_date_assertions(entry: dict[str, Any]) -> list[dict[str, Any]]:
        """Zwilling von rijalDateAssertions() in worker/src/core/hijri-date-phrase.mjs.

        Liest ausschliesslich die in Ziffern genannten Jahre aus dem Wortlaut
        der Quelle. Mehrere Jahre nebeneinander bleiben mehrere Aussagen; es
        wird nichts gemittelt und nichts zu einer Spanne verschmolzen.
        """
        out: list[dict[str, Any]] = []
        for kind, phrase_key in (("birth", "birthOriginalPhrase"), ("death", "deathOriginalPhrase")):
            out.extend(parse_hijri_year_phrase(entry.get(phrase_key), kind))
        return out

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

    def _rank_rijal(self, wanted: str, limit: int) -> list[tuple[int, int, dict[str, Any], str, dict[str, Any]]]:
        """Shared ranking core behind /identity-candidates and the narrator
        profile's rijal-candidate panel. A name-heading match outranks a bare
        mention inside a long biography; results stay separate per source so
        a text hit is never silently turned into a canonical-person merge."""
        ranked: list[tuple[int, int, dict[str, Any], str, dict[str, Any]]] = []
        if not wanted:
            return ranked
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
        ranked.sort(key=lambda row: (row[0], row[1], row[2]["entryNumber"] or 0))
        return ranked[:limit]

    # -- hadiths --------------------------------------------------------------

    def hadiths(self, *, collection: str | None, query: str, cursor: str | None, limit: int) -> dict[str, Any]:
        index = self._hadith_index()
        ids = index["order"][collection] if collection in ("bukhari", "muslim") else index["order"]["all"]
        start = _offset(cursor)
        wanted = normalize_arabic(query)
        matches: list[dict[str, Any]] = []
        matched_records: list[dict[str, Any]] = []
        skipped = 0
        has_more = False
        for rid in ids:
            if wanted and wanted not in index["haystack"][rid]:
                continue
            if skipped < start:
                skipped += 1
                continue
            if len(matches) >= limit:
                has_more = True
                break
            record = index["by_id"][rid]
            matches.append(self.public_record(record, source_key=record["collection"]))
            matched_records.append(record)
        level, score = aggregate_machine_confidence(r["parser"]["confidence"] for r in matched_records)
        refs = cited([self.source_reference(record) for record in matched_records], "Keine Treffer für die angegebene Suche in der aktuellen Datenbasis.")
        return envelope(
            {"items": matches, "pageInfo": {"nextCursor": _cursor(start + limit) if has_more else None, "hasNextPage": has_more}},
            refs,
            confidence_level=level,
            confidence_score=score,
            origin="machine",
            resultCount=len(matches),
        )

    def hadith(self, record_id: str) -> dict[str, Any] | None:
        record = self._hadith_index()["by_id"].get(record_id)
        if record is None:
            return None
        confidence = record["parser"]["confidence"]
        return envelope(
            self.public_record(record, source_key=record["collection"]),
            [self.source_reference(record)],
            confidence_level=level_from_score(confidence),
            confidence_score=confidence,
            origin="machine",
        )

    def chains(self, record_id: str) -> dict[str, Any] | None:
        record = self._hadith_index()["by_id"].get(record_id)
        if record is None:
            return None
        collection = record["collection"]
        raw_isnad_cleared = self.full_text_cleared(collection) and "isnad" in self.allowed_derived_fields(collection)
        raw_chains = record.get("chains") or [{
            "chainOrder": 0,
            "rawIsnad": record.get("isnad", ""),
            "narratorOccurrences": [
                {"position": index, "rawSurfaceForm": surface, "normalizedSurfaceForm": normalize_arabic(surface), "identityStatus": "unresolved"}
                for index, surface in enumerate(record.get("narratorSurfaceForms", []))
            ],
        }]
        items = []
        for chain in raw_chains:
            item = dict(chain)
            if not raw_isnad_cleared:
                item.pop("rawIsnad", None)
            items.append(item)
        confidence = record["parser"]["confidence"]
        return envelope(
            {"hadithId": record_id, "items": items},
            [self.source_reference(record)],
            confidence_level=level_from_score(confidence),
            confidence_score=confidence,
            origin="machine",
        )

    def routes(self, cluster_id: str, collection: str | None = None, limit: int = 250) -> dict[str, Any] | None:
        fingerprint = cluster_id.removeprefix("HCL-")
        candidates = self._hadith_index()["by_fingerprint"].get(fingerprint, ())
        records = [record for record in candidates if collection is None or record["collection"] == collection]
        if not records:
            return None
        window = records[:limit]
        nodes: dict[str, dict[str, Any]] = {}
        edges: dict[str, dict[str, Any]] = {}
        for record in window:
            chains = record.get("chains") or [{"narratorOccurrences": [{"rawSurfaceForm": name, "normalizedSurfaceForm": normalize_arabic(name)} for name in record.get("narratorSurfaceForms", [])]}]
            for chain in chains:
                occurrences = chain["narratorOccurrences"]
                ids = []
                for position, occurrence in enumerate(occurrences):
                    normalized = normalize_arabic(occurrence.get("normalizedSurfaceForm") or occurrence.get("rawSurfaceForm", ""))
                    node_id = bucket_id(record["id"], chain.get("chainOrder", 0), position, normalized)
                    ids.append(node_id)
                    nodes.setdefault(node_id, {
                        "id": node_id,
                        "label": occurrence["rawSurfaceForm"],
                        "identityStatus": "unresolved",
                        "reviewStatus": "machine_unreviewed",
                        "isRelativeReference": is_relative_reference(normalized),
                    })
                for position, (source, target) in enumerate(zip(ids, ids[1:])):
                    edge_id = f"{source}:{target}"
                    edge = edges.setdefault(edge_id, {"id": edge_id, "source": source, "target": target, "evidenceKind": "isnad_link", "occurrences": [], "matnFamilies": []})
                    edge["occurrences"].append({"hadithId": record["id"], "chainOrder": chain.get("chainOrder", 0), "position": position})
                    if fingerprint not in edge["matnFamilies"]:
                        edge["matnFamilies"].append(fingerprint)
        level, score = aggregate_machine_confidence(r["parser"]["confidence"] for r in window)
        return envelope(
            {"clusterId": cluster_id, "nodes": list(nodes.values()), "edges": list(edges.values()), "recordCount": len(records), "truncated": len(records) > limit},
            [self.source_reference(record) for record in window],
            confidence_level=level,
            confidence_score=score,
            origin="machine",
        )

    def matn_variants(self, cluster_id: str) -> dict[str, Any] | None:
        fingerprint = cluster_id.removeprefix("HCL-")
        records = list(self._hadith_index()["by_fingerprint"].get(fingerprint, ()))
        if not records:
            return None
        families: dict[str, dict[str, Any]] = {}
        colors = ("teal", "clay", "gold", "ink", "sage")
        for record in records:
            normalized = normalize_arabic(record.get("matn", ""))
            family_key = hashlib.sha1(normalized.encode()).hexdigest()[:12]
            text_cleared = self.full_text_cleared(record["collection"]) and "matn" in self.allowed_derived_fields(record["collection"])
            family = families.setdefault(family_key, {
                "id": family_key,
                "colorToken": colors[len(families) % len(colors)],
                "representativeText": record.get("matn") if text_cleared else None,
                "textWithheld": not text_cleared,
                "hadithIds": [],
                "reviewStatus": "machine_unreviewed",
            })
            family["hadithIds"].append(record["id"])
        level, score = aggregate_machine_confidence(r["parser"]["confidence"] for r in records)
        return envelope(
            {"clusterId": cluster_id, "status": "machine_suggestion", "items": list(families.values())},
            [self.source_reference(record) for record in records],
            confidence_level=level,
            confidence_score=score,
            origin="machine",
        )

    # -- rijal ------------------------------------------------------------------

    def rijal_entries(self, *, source: str, query: str, cursor: str | None, limit: int) -> dict[str, Any]:
        start = _offset(cursor)
        wanted = normalize_arabic(query)
        matches: list[dict[str, Any]] = []
        source_entries: list[dict[str, Any]] = []
        skipped = 0
        has_more = False
        for src, entry, _name, text in self.rijal_search_index():
            if src != source:
                continue
            if wanted and wanted not in text:
                continue
            if skipped < start:
                skipped += 1
                continue
            if len(matches) >= limit:
                has_more = True
                break
            matches.append(self.public_rijal_entry(entry, source))
            source_entries.append(entry)
        level, score = aggregate_machine_confidence(e["parser"]["confidence"] for e in source_entries)
        refs = cited([self.rijal_source_reference(entry, source) for entry in source_entries], "Keine Treffer für die angegebene Suche in der aktuellen Datenbasis.")
        return envelope(
            {"items": matches, "pageInfo": {"nextCursor": _cursor(start + len(matches)) if has_more else None, "hasNextPage": has_more}},
            refs,
            confidence_level=level,
            confidence_score=score,
            origin="machine",
            resultCount=len(matches),
        )

    def rijal_entry(self, entry_id: str) -> dict[str, Any] | None:
        source = entry_id.split("-", 1)[0]
        entry = self._rijal_id_index(source).get(entry_id)
        if entry is None:
            return None
        confidence = entry["parser"]["confidence"]
        return envelope(
            self.public_rijal_entry(entry, source),
            [self.rijal_source_reference(entry, source)],
            confidence_level=level_from_score(confidence),
            confidence_score=confidence,
            origin="machine",
        )

    def rijal_candidates(self, *, query: str, limit: int) -> dict[str, Any]:
        """Return source entries ranked as identity candidates, never identities.

        Name-heading matches rank before mentions buried in a biography. Results
        remain separate per source so the client cannot accidentally turn a text
        search hit into a canonical-person merge.
        """
        wanted = normalize_arabic(query)
        if not wanted:
            return envelope({"query": query, "items": []}, [{"notice": "Leere Suchanfrage."}], confidence_level="unresolved", origin="machine", resultCount=0)
        selected = self._rank_rijal(wanted, limit)
        references = cited([self.rijal_source_reference(entry, source) for _, _, _, source, entry in selected], "Keine Kandidaten für die angegebene Suche gefunden.")
        level, score = aggregate_machine_confidence(entry["parser"]["confidence"] for _, _, _, _, entry in selected)
        return envelope(
            {"query": query, "items": [item for _, _, item, _, _ in selected]},
            references,
            confidence_level=level,
            confidence_score=score,
            origin="machine",
            resultCount=len(selected),
        )

    # -- narrators (occurrence clusters, not confirmed canonical persons) -------

    def narrator_profile(self, narrator_id: str) -> dict[str, Any] | None:
        """Real, source-bound implementation grounded in existing derived data
        (Umsetzungsplan P2.2). Deliberately not a confirmed canonical-person
        profile -- entity resolution has not run yet (P4.1-P4.5) -- but a
        transparent view of everything the corpus actually knows about this
        occurrence cluster: every raw surface form, every hadith it appears
        in, and ranked (never merged) rijal candidates sharing its name.
        """
        index = self._narrator_occurrence_index()
        bucket = index.get(narrator_id)
        if bucket is None:
            return None
        occurrences = bucket["occurrences"]
        by_id = self._hadith_index()["by_id"]
        hadith_ids = sorted({occ["hadithId"] for occ in occurrences})
        records = [by_id[hid] for hid in hadith_ids if hid in by_id]
        rijal_matches = [] if bucket["isRelativeReference"] else self._rank_rijal(bucket["normalizedSurfaceForm"], 10)
        preview_limit = 50
        note = (
            "Positionsgebundene Rückverweisform (z. B. أبيه); wird nie mit anderen Vorkommen global zusammengeführt."
            if bucket["isRelativeReference"] else
            "Unaufgelöstes, quellengebundenes Namenscluster -- kein bestätigtes kanonisches Personenprofil (siehe docs/05-ENTITY-RESOLUTION.md, Umsetzungsplan P4.5)."
        )
        data = {
            "id": narrator_id,
            "identityStatus": "unresolved",
            "isRelativeReference": bucket["isRelativeReference"],
            "normalizedSurfaceForm": bucket["normalizedSurfaceForm"],
            "rawSurfaceForms": sorted(bucket["rawSurfaceForms"]),
            "occurrenceCount": len(occurrences),
            "occurrences": occurrences[:preview_limit],
            "truncatedOccurrences": len(occurrences) > preview_limit,
            "rijalCandidates": [item for _, _, item, _, _ in rijal_matches],
            "note": note,
        }
        references = cited([self.source_reference(record) for record in records], "Keine Hadith-Quellenbelege für dieses Namenscluster auflösbar.")
        return envelope(data, references, confidence_level="unresolved", confidence_score=None, origin="machine")

    def narrator_relations(self, narrator_id: str, *, cursor: str | None, limit: int) -> dict[str, Any]:
        """Source-bound teacher/student/isnad relations (Abschnitt 8).

        Only isnad_occurrence evidence is populated: it is directly derivable
        from chain position with no invention. rijal_statement evidence
        (Tahdhib's teacherPhrase/studentPhrase) is NOT segmented into
        individual pairwise relations here, because the raw phrases are not
        yet parsed into individual names (Umsetzungsplan P4.6) -- emitting
        guessed pairs from an unsegmented phrase would be exactly the kind of
        invented fact this contract forbids.
        """
        bucket = self._narrator_occurrence_index().get(narrator_id)
        if bucket is None:
            return envelope(
                {"narratorId": narrator_id, "items": [], "pageInfo": {"nextCursor": None, "hasNextPage": False}},
                [{"notice": "narrator_id nicht in der aktuellen Vorkommens-Datenbasis auflösbar."}],
                confidence_level="unresolved", origin="machine",
            )
        neighbors = bucket["neighbors"]
        start = _offset(cursor)
        window = neighbors[start:start + limit]
        has_more = start + limit < len(neighbors)
        by_id = self._hadith_index()["by_id"]
        items = []
        window_records = []
        for neighbor in window:
            record = by_id.get(neighbor["hadithId"])
            items.append({
                "relatedNarratorId": neighbor["relatedNarratorId"],
                "relationshipType": neighbor["relationshipType"],
                "evidenceKind": "isnad_link",
                "chainId": neighbor["chainId"],
                "position": neighbor["position"],
                "spanStart": None,
                "spanEnd": None,
                "hadithId": neighbor["hadithId"],
            })
            if record is not None:
                window_records.append(record)
        note = (
            None if neighbors else
            "Keine Isnād-Nachbarschaft für dieses Vorkommen gefunden."
        )
        if not bucket["isRelativeReference"]:
            rijal_note = "Lehrer-/Schüler-Aussagen aus den Rijāl-Werken (rijal_statement) sind noch nicht personenscharf geparst und werden hier deshalb nicht als einzelne Relationen ausgegeben (Umsetzungsplan P4.6)."
            note = f"{note} {rijal_note}" if note else rijal_note
        level, score = aggregate_machine_confidence(r["parser"]["confidence"] for r in window_records)
        references = cited([self.source_reference(record) for record in window_records], "Keine Isnād-Nachbarschaft für dieses Vorkommen gefunden.")
        return envelope(
            {
                "narratorId": narrator_id,
                "items": items,
                "pageInfo": {"nextCursor": _cursor(start + limit) if has_more else None, "hasNextPage": has_more},
                "note": note,
            },
            references,
            confidence_level=level,
            confidence_score=score,
            origin="machine",
        )

    def _date_assertions_for(self, bucket: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[float]]:
        if bucket["isRelativeReference"]:
            return [], [], []
        assertions: list[dict[str, Any]] = []
        references: list[dict[str, Any]] = []
        scores: list[float] = []
        for source, entry, name, _text in self.rijal_search_index():
            if name != bucket["normalizedSurfaceForm"]:
                continue
            death = entry.get("deathYearCandidate")
            birth = entry.get("birthYearCandidate")  # forward-compatible; not produced by the importer today (Befund B2)
            if death is None and birth is None:
                continue
            if isinstance(death, int):
                assertions.append({"event": "death", "precision": "unknown", "yearMin": death, "yearMax": death, "sourceWork": source, "entryId": entry["id"], "reviewStatus": "unresolved"})
            if isinstance(birth, int):
                assertions.append({"event": "birth", "precision": "unknown", "yearMin": birth, "yearMax": birth, "sourceWork": source, "entryId": entry["id"], "reviewStatus": "unresolved"})
            references.append(self.rijal_source_reference(entry, source))
            scores.append(entry["parser"]["confidence"])
        return assertions, references, scores

    def narrator_timeline(self, narrator_id: str) -> dict[str, Any] | None:
        """All directly-asserted date candidates, never averaged (Abschnitt 7)."""
        bucket = self._narrator_occurrence_index().get(narrator_id)
        if bucket is None:
            return None
        assertions, references, scores = self._date_assertions_for(bucket)
        level, score = aggregate_machine_confidence(scores)
        note = None
        if not assertions:
            # Bewusst ohne Bestandszahl: eine feste Zahl im Antworttext wird beim
            # naechsten Import unbemerkt falsch (sie nannte 27.105 bei inzwischen
            # 34.045 Eintraegen). Braucht eine Ansicht die Groesse, holt sie sie
            # aus der Datenbasis -- nicht aus einer Prosa-Konstanten.
            note = (
                "Keine Todes- oder Geburtsjahresangabe für dieses Namenscluster in den importierten "
                "Rijāl-Werken gefunden."
            )
        return envelope(
            {"narratorId": narrator_id, "dateAssertions": assertions, "note": note},
            cited(references, note or "Keine Datierungsangaben gefunden."),
            confidence_level=level,
            confidence_score=score,
            origin="machine",
        )

    def _lifespan_bounds(self, narrator_id: str) -> dict[str, list[int]] | None:
        bucket = self._narrator_occurrence_index().get(narrator_id)
        if bucket is None or bucket["isRelativeReference"]:
            return None
        deaths: list[int] = []
        births: list[int] = []
        for _source, entry, name, _text in self.rijal_search_index():
            if name != bucket["normalizedSurfaceForm"]:
                continue
            death = entry.get("deathYearCandidate")
            birth = entry.get("birthYearCandidate")
            if isinstance(death, int):
                deaths.append(death)
            if isinstance(birth, int):
                births.append(birth)
        return {"deathYears": sorted(set(deaths)), "birthYears": sorted(set(births))}

    def _chronology_verdict(self, a_id: str, b_id: str) -> tuple[str, str]:
        """Never estimates a missing birth year from a death year (Abschnitt 7).
        "impossible" only fires on directly-asserted, never-inferred bounds."""
        bounds_a = self._lifespan_bounds(a_id)
        bounds_b = self._lifespan_bounds(b_id)
        if bounds_a is None or bounds_b is None:
            return "insufficient", "Mindestens eine narrator_id ist unbekannt oder eine positionsgebundene Rückverweisform ohne eigene Datierung."
        if not (bounds_a["birthYears"] or bounds_a["deathYears"]) or not (bounds_b["birthYears"] or bounds_b["deathYears"]):
            return "insufficient", "Für mindestens eine Person liegt weder ein Geburts- noch ein Todesjahr in der aktuellen Datenbasis vor."
        if bounds_a["birthYears"] and bounds_b["deathYears"] and min(bounds_a["birthYears"]) > max(bounds_b["deathYears"]):
            return "impossible", f"A ist frühestens {min(bounds_a['birthYears'])} AH belegt geboren, B ist spätestens {max(bounds_b['deathYears'])} AH belegt gestorben."
        if bounds_b["birthYears"] and bounds_a["deathYears"] and min(bounds_b["birthYears"]) > max(bounds_a["deathYears"]):
            return "impossible", f"B ist frühestens {min(bounds_b['birthYears'])} AH belegt geboren, A ist spätestens {max(bounds_a['deathYears'])} AH belegt gestorben."
        if not bounds_a["birthYears"] or not bounds_b["birthYears"]:
            return "insufficient", "Kein Geburtsjahr für mindestens eine Person belegt; ein fehlendes Geburtsjahr wird nicht aus einem Todesjahr geschätzt."
        return "possible", "Belegte Zeitspannen widersprechen sich nicht. Das ist kein Beleg für eine tatsächliche Begegnung oder Überlieferung."

    def _meeting_evidence(self, a_id: str, b_id: str) -> list[dict[str, Any]]:
        bucket = self._narrator_occurrence_index().get(a_id)
        if bucket is None:
            return []
        return [n for n in bucket["neighbors"] if n["relatedNarratorId"] == b_id]

    def compare_narrators(self, a: str, b: str) -> dict[str, Any]:
        chronology, reason = self._chronology_verdict(a, b)
        meeting_evidence = self._meeting_evidence(a, b)
        by_id = self._hadith_index()["by_id"]
        references = cited(
            [self.source_reference(by_id[m["hadithId"]]) for m in meeting_evidence if m["hadithId"] in by_id],
            reason,
        )
        data = {
            "narratorA": a,
            "narratorB": b,
            "chronology": chronology,
            "chronologyReason": reason,
            "meeting": "asserted_isnad" if meeting_evidence else "not_asserted",
            "meetingEvidence": meeting_evidence,
        }
        level = "high" if (chronology != "insufficient" or meeting_evidence) else "unresolved"
        return envelope(data, references, confidence_level=level, confidence_score=None, origin="machine")

    def compare_chronology(self, a: str, b: str) -> dict[str, Any]:
        result, reason = self._chronology_verdict(a, b)
        meeting_evidence = self._meeting_evidence(a, b)
        by_id = self._hadith_index()["by_id"]
        references = cited(
            [self.source_reference(by_id[m["hadithId"]]) for m in meeting_evidence if m["hadithId"] in by_id],
            reason,
        )
        data = {"narratorA": a, "narratorB": b, "result": result, "reason": reason, "meetingIsProven": bool(meeting_evidence)}
        level = "unresolved" if result == "insufficient" else "high"
        return envelope(data, references, confidence_level=level, confidence_score=None, origin="machine")

    # -- sources ------------------------------------------------------------

    def sources(self, source_id: str) -> dict[str, Any] | None:
        for source in self.registry["sources"]:
            if source["key"] == source_id:
                return envelope(source, [{"provider": "turath", "workId": source["turathBookId"], "url": f"https://app.turath.io/book/{source['turathBookId']}"}], confidence_level="verified", origin="registry")
        for source in self.registry.get("externalDatasets", []):
            if source["key"] == source_id:
                return envelope(source, [{"url": source["url"], "doi": source.get("doi"), "license": source.get("license")}], confidence_level="verified", origin="registry")
        return None

    def source_list(self) -> dict[str, Any]:
        items = [*self.registry["sources"], *self.registry.get("externalDatasets", [])]
        return envelope({"items": items}, [{"registry": "data/sources/turath-manifest.json"}], confidence_level="verified", origin="registry")


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


repository = CorpusRepository()
