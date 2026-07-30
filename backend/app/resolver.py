"""Blocking-Index, Scoring und Batch-Resolver in Python (Umsetzungsplan P4.1-P4.3).

Wortgleicher Port von ``lib/blocking.ts`` und ``lib/entity-resolution.ts``.
Einzige fachliche Definition bleiben die TypeScript-Dateien; die Gewichte kommen
fuer BEIDE Seiten aus derselben Datei ``config/er-weights.v1.json``, es gibt also
keine zweite Gewichtstabelle.

Warum es diesen Port ueberhaupt gibt: der vollstaendige Lauf ueber den Echtbestand
gehoert nach ``docs/10-UMSETZUNGSPLAN.md`` Abschnitt 3 in GitHub Actions, und
Python ist dort die Importer- und Pipeline-Laufzeit. Der Lauf braucht keine
Abhaengigkeit ausser der Standardbibliothek.

Messlauf (die Zahlen in ``docs/13-RESOLVER.md`` stammen aus genau diesem Aufruf)::

    PYTHONPATH=backend python3 -m app.resolver --measure
    PYTHONPATH=backend python3 -m app.resolver --measure --budget 0   # ohne Begrenzung

Kein Pfad dieser Datei setzt ``verified``: ``_assert_machine_level`` bricht ab,
und jedes Ergebnis traegt ``origin='machine'`` und
``reviewStatus='machine_unreviewed'``.
"""

from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence

from .normalize import normalize_search_text
from .relative_forms import RELATIVE_FORM_VERSION, analyze_relative_form, resolve_relative_form

ROOT = Path(__file__).resolve().parents[2]
WEIGHT_PROFILE_PATH = ROOT / "config" / "er-weights.v1.json"
DERIVED_DEFAULT = ROOT / ".cache" / "turath-derived"

#: Wortgleich zu CONFIDENCE_THRESHOLDS in lib/types.ts und zum CHECK im Schema.
CONFIDENCE_THRESHOLDS = {"high": 0.9, "medium": 0.7}

#: Wortgleich zu NAME_STOPWORD_TOKENS in lib/entity-resolution.ts.
NAME_STOPWORD_TOKENS = (
    "بن", "ابن", "ابو", "ابي", "ابا", "بنت", "مولي", "مولاه", "مولاهم", "ال", "و", "عن", "ويقال",
)

#: Sigel-Zuordnung der beiden importierten Sammlungen (Signal 6). „ع" und „صح"
#: schliessen die Sechs bzw. die beiden Sahihs ein.
COLLECTION_SIGLA = {"bukhari": ("خ", "خت", "ع", "صح"), "muslim": ("م", "ع", "صح")}

#: Nennungen des Sammlers unter den Schuelern (Signal 6, zweite Lesart).
COLLECTION_COMPILER = {"bukhari": "البخاري", "muslim": "مسلم"}


def load_weight_profile(path: Path = WEIGHT_PROFILE_PATH) -> dict[str, Any]:
    """Die versionierte Gewichtsdatei. Gemeinsame Quelle mit dem TypeScript-Pfad."""
    return json.loads(path.read_text(encoding="utf-8"))


def confidence_level_from_score(score: float | None) -> str:
    """Wortgleich zu confidenceLevelFromScore in lib/types.ts. Nie 'verified'."""
    if score is None:
        return "unresolved"
    if score >= CONFIDENCE_THRESHOLDS["high"]:
        return "high"
    if score >= CONFIDENCE_THRESHOLDS["medium"]:
        return "medium"
    return "low"


def _assert_machine_level(level: str) -> str:
    if level == "verified":
        raise AssertionError("Maschinelle Verarbeitung darf 'verified' nicht setzen (docs/05, Abschnitt 4).")
    return level


def name_tokens(value: str | None) -> list[str]:
    """Wortgleich zu nameTokens in lib/entity-resolution.ts."""
    from .relative_forms import surface_tokens

    return [token for token in surface_tokens(value) if token not in NAME_STOPWORD_TOKENS]


# ---------------------------------------------------------------------------
# Blocking (Port von lib/blocking.ts)
# ---------------------------------------------------------------------------


def entry_head_tokens(entry: dict[str, Any]) -> set[str]:
    """Namenskette, Kunya und Nisben. Der Biografietext bleibt aussen vor."""
    bag: set[str] = set()
    bag.update(name_tokens(entry.get("nameSurfaceNormalized") or entry.get("nameSurface") or ""))
    for token in entry.get("nameChainTokens") or []:
        bag.update(name_tokens(token))
    bag.update(name_tokens(entry.get("kunya") or ""))
    for nisba in entry.get("nisbas") or []:
        bag.update(name_tokens(nisba))
    return bag


def build_head_token_index(entries: Sequence[dict[str, Any]]) -> dict[str, Any]:
    started = time.perf_counter()
    postings: dict[str, list[int]] = {}
    postings_total = 0
    for index, entry in enumerate(entries):
        for token in entry_head_tokens(entry):
            postings.setdefault(token, []).append(index)
            postings_total += 1
    return {
        "postings": postings,
        "entries": entries,
        "stats": {
            "entries": len(entries),
            "tokens": len(postings),
            "postingsTotal": postings_total,
            "buildMs": round((time.perf_counter() - started) * 1000, 1),
        },
    }


def select_candidates(index: dict[str, Any], form: str, budget: int | None) -> dict[str, Any]:
    postings: dict[str, list[int]] = index["postings"]
    tokens = sorted(
        {token for token in name_tokens(form) if token in postings},
        key=lambda token: (len(postings[token]), token),
    )
    seen: set[int] = set()
    used: list[str] = []
    skipped: list[str] = []
    for token in tokens:
        entry_indices = postings[token]
        if used and budget is not None and len(seen) + len(entry_indices) > budget:
            skipped.append(token)
            continue
        seen.update(entry_indices)
        used.append(token)
    return {"indices": sorted(seen), "usedTokens": used, "skippedTokens": skipped}


def collect_prophet_forms(occurrences: Iterable[dict[str, Any]]) -> set[str]:
    """Abgeleitet aus dem Importerfeld ``prophetMention``, keine eigene Liste."""
    forms: set[str] = set()
    for occurrence in occurrences:
        if not occurrence.get("prophetMention"):
            continue
        form = normalize_search_text(occurrence.get("normalizedSurfaceForm") or occurrence.get("rawSurfaceForm") or "")
        if form:
            forms.add(form)
    return forms


def collect_distinct_name_forms(occurrences: Iterable[dict[str, Any]], prophet_forms: set[str]) -> dict[str, Any]:
    """Port von collectDistinctNameForms. Relative Formen bleiben positionsgebunden."""
    started = time.perf_counter()
    by_form: dict[str, dict[str, Any]] = {}
    relatives: list[dict[str, Any]] = []
    counters = {"occurrences": 0, "prophetFlag": 0, "prophetDerived": 0, "relative": 0, "empty": 0}
    for occurrence in occurrences:
        counters["occurrences"] += 1
        raw = occurrence.get("normalizedSurfaceForm") or occurrence.get("rawSurfaceForm") or ""
        if occurrence.get("prophetMention"):
            counters["prophetFlag"] += 1
            continue
        normalized = normalize_search_text(raw)
        if normalized in prophet_forms:
            counters["prophetDerived"] += 1
            continue
        analysis = analyze_relative_form(raw)
        if analysis["isRelativeForm"]:
            counters["relative"] += 1
            reference = resolve_relative_form(raw, occurrence["chainId"], occurrence["position"])
            if reference:
                relatives.append(reference)
            if analysis["unresolvableRelative"]:
                continue
        form = normalize_search_text(analysis["resolutionSurface"] if analysis["isRelativeForm"] else normalized)
        if not form:
            counters["empty"] += 1
            continue
        bucket = by_form.get(form)
        position = {"chainId": occurrence["chainId"], "position": occurrence["position"]}
        if bucket:
            bucket["positions"].append(position)
            bucket["occurrences"] += 1
        else:
            by_form[form] = {"form": form, "positions": [position], "occurrences": 1}
    forms = list(by_form.values())
    covered = sum(entry["occurrences"] for entry in forms)
    return {
        "forms": forms,
        "relatives": relatives,
        "stats": {
            "occurrences": counters["occurrences"],
            "prophetPositionsByFlag": counters["prophetFlag"],
            "prophetPositionsByDerivedForm": counters["prophetDerived"],
            "relativePositions": counters["relative"],
            "emptyPositions": counters["empty"],
            "distinctForms": len(forms),
            "dedupeFactor": round(covered / len(forms), 2) if forms else 0,
            "collectMs": round((time.perf_counter() - started) * 1000, 1),
        },
    }


def collections_for_entry(entry: dict[str, Any]) -> list[str]:
    """Signal 6: welche der importierten Sammlungen die Quelle der Person zuordnet."""
    sigla_text = " ".join(entry.get("collectionSigla") or [])
    sigla_tokens = {
        token
        for token in sigla_text.replace("[", " ").replace("]", " ").replace("(", " ").replace(")", " ").replace("،", " ").replace(",", " ").split()
    }
    students = " ".join(entry.get("studentMentions") or [])
    found: list[str] = []
    for collection, sigla in COLLECTION_SIGLA.items():
        if sigla_tokens.intersection(sigla) or COLLECTION_COMPILER[collection] in students:
            found.append(collection)
    return found


def profile_from_rijal_entry(entry: dict[str, Any], collections: Sequence[str] | None = None) -> dict[str, Any]:
    """Port von profileFromRijalEntry."""
    death = entry.get("deathYearCandidate")
    return {
        "id": entry["id"],
        "names": [value for value in (entry.get("nameSurfaceNormalized") or entry.get("nameSurface") or "", entry.get("nameChain") or "") if value],
        "variants": [value for value in [entry.get("kunya") or "", *(entry.get("nisbas") or [])] if value],
        "kunya": entry.get("kunya"),
        "nisba": (entry.get("nisbas") or [None])[0],
        "region": entry.get("region"),
        "regions": [value for value in (entry.get("region") or "", entry.get("residence") or "") if value],
        "deathYearMin": death,
        "deathYearMax": death,
        "deathYears": [] if death is None else [death],
        "teachers": [],
        "students": [],
        "teacherNames": [value for value in (entry.get("teacherMentions") or []) if value],
        "studentNames": [value for value in (entry.get("studentMentions") or []) if value],
        "collections": list(collections) if collections is not None else collections_for_entry(entry),
        "sourcePassageId": entry["id"],
    }


# ---------------------------------------------------------------------------
# Scoring (Port von lib/entity-resolution.ts)
# ---------------------------------------------------------------------------


def _overlap_ratio(surface_tokens_list: Sequence[str], candidate_tokens: set[str]) -> float:
    if not surface_tokens_list or not candidate_tokens:
        return 0.0
    shared = sum(1 for token in surface_tokens_list if token in candidate_tokens)
    return shared / len(surface_tokens_list)


def _round3(value: float) -> float:
    return round(max(0.0, min(1.0, value)), 3)


def score_identity_candidate(occurrence: dict[str, Any], candidate: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    """Port von scoreIdentityCandidate. Die neun Signale in derselben Reihenfolge."""
    signals = profile["signals"]
    matching: list[str] = []
    conflicting: list[str] = []
    contributions: list[dict[str, Any]] = []
    hard_blocks: list[dict[str, Any]] = []
    notes: list[str] = []
    base = {
        "narratorId": candidate["id"],
        "requiresEditorialDecision": True,
        "origin": "machine",
        "reviewStatus": "machine_unreviewed",
        "weightProfileVersion": profile["weightProfileVersion"],
        "resolverVersion": profile["resolverVersion"],
        "relativeFormVersion": RELATIVE_FORM_VERSION,
    }

    relative = analyze_relative_form(occurrence["surface"])
    if relative["unresolvableRelative"]:
        term = relative["term"]
        return {
            **base,
            "confidenceScore": 0.0,
            "confidenceLevel": _assert_machine_level("unresolved"),
            "matchingSignals": [],
            "conflictingSignals": ["relative-or-anonymous-surface"],
            "contributions": [],
            "hardBlocks": [{
                "rule": "relative-form-position-bound",
                "reasonCode": "anonymous-surface-no-anchor" if (term is not None and term.anonymous) else "relative-anchored-unnamed",
                "rationale": (
                    f"„{occurrence['surface']}\" nennt keine Person, sondern verweist innerhalb der Kette. "
                    "Aufloesung nur ueber (chainId, position) und nur redaktionell."
                ),
            }],
            "notes": notes,
        }
    if relative["isRelativeForm"]:
        term = relative["term"]
        notes.append("relative-form-apposition:" + (term.term if term is not None else ""))

    surface = relative["resolutionSurface"] if relative["isRelativeForm"] else normalize_search_text(occurrence["surface"])
    surface_normalized = normalize_search_text(surface)
    surface_token_list = name_tokens(surface)
    score = 0.0

    # Signal 1: kanonische Namensaehnlichkeit
    name_signal = signals["canonicalNameSimilarity"]
    name_forms = [value for value in candidate.get("names", []) if value]
    exact_name = any(normalize_search_text(name) == surface_normalized for name in name_forms)
    if exact_name:
        similarity = 1.0
    else:
        similarity = max([_overlap_ratio(surface_token_list, set(name_tokens(name))) for name in name_forms] or [0.0])
    if similarity >= name_signal.get("minSimilarity", 0):
        applied = round(name_signal["weight"] * similarity, 4)
        score += applied
        matching.append("canonical-name-similarity:exact" if exact_name else "canonical-name-similarity:partial")
        contributions.append({
            "signal": "canonicalNameSimilarity", "weight": name_signal["weight"], "applied": applied,
            "detail": "normalisierte Form identisch" if exact_name else f"Tokenanteil {similarity:.2f}",
        })

    # Signal 2: bekannte Namensvariante
    variant_signal = signals["knownNameVariant"]
    variant_hit = None
    for variant in [*(candidate.get("variants") or []), candidate.get("kunya") or "", candidate.get("nisba") or ""]:
        if not variant:
            continue
        normalized_variant = normalize_search_text(variant)
        if not normalized_variant:
            continue
        variant_tokens = name_tokens(variant)
        if normalized_variant == surface_normalized or (variant_tokens and all(token in surface_token_list for token in variant_tokens)):
            variant_hit = variant
            break
    if variant_hit and not exact_name:
        score += variant_signal["weight"]
        matching.append("known-name-variant")
        contributions.append({"signal": "knownNameVariant", "weight": variant_signal["weight"], "applied": variant_signal["weight"], "detail": f"Variante „{variant_hit}\""})

    # Signal 3: Lehrer-/Schuelernachbarschaft
    neighbour_signal = signals["teacherStudentNeighbourhood"]
    per_neighbour = neighbour_signal.get("perNeighbour", neighbour_signal["weight"] / 2)
    teacher_names = {normalize_search_text(name) for name in candidate.get("teacherNames") or []}
    student_names = {normalize_search_text(name) for name in candidate.get("studentNames") or []}
    teacher_hit = any(identifier in (candidate.get("teachers") or []) for identifier in occurrence.get("previousNarratorIds") or []) or any(
        normalize_search_text(form) in teacher_names for form in occurrence.get("previousSurfaceForms") or []
    )
    student_hit = any(identifier in (candidate.get("students") or []) for identifier in occurrence.get("nextNarratorIds") or []) or any(
        normalize_search_text(form) in student_names for form in occurrence.get("nextSurfaceForms") or []
    )
    neighbour_hits = int(teacher_hit) + int(student_hit)
    if neighbour_hits:
        applied = round(min(neighbour_signal["weight"], neighbour_hits * per_neighbour), 4)
        score += applied
        matching.append("teacher-student-neighbourhood")
        contributions.append({"signal": "teacherStudentNeighbourhood", "weight": neighbour_signal["weight"], "applied": applied, "detail": f"{neighbour_hits} belegte Nachbarschaft(en)"})

    # Signal 4 und harte Regel 1: Chronologie, ausschliesslich compare_chronology
    chronology_signal = signals["chronologyPlausible"]
    assertions = occurrence.get("dateAssertions") or []
    neighbour_ids = occurrence.get("neighbourChronologyIds") or []
    if candidate.get("chronologyId") and assertions and neighbour_ids:
        possible_overlap: int | None = None
        for neighbour_id in neighbour_ids:
            verdict = compare_chronology(assertions, candidate["chronologyId"], neighbour_id)
            if verdict["result"] == "impossible":
                gap = verdict["gapYears"]
                hard_blocks.append({
                    "rule": "impossible-chronology",
                    "reasonCode": "chronology-impossible",
                    "rationale": (
                        f"compare_chronology() ergibt fuer {candidate['chronologyId']} und {neighbour_id} 'impossible'"
                        + (f" (Abstand {gap} Jahre)." if gap is not None else ".")
                    ),
                })
                conflicting.append("impossible-chronology")
            elif verdict["result"] == "possible":
                possible_overlap = max(possible_overlap or 0, verdict["overlapYears"] or 0)
        if possible_overlap is not None and not hard_blocks:
            score += chronology_signal["weight"]
            matching.append("chronology-possible")
            contributions.append({"signal": "chronologyPlausible", "weight": chronology_signal["weight"], "applied": chronology_signal["weight"], "detail": f"Ueberlappung {possible_overlap} Jahre laut compare_chronology()"})

    # Signal 5: Region/Reise plausibel
    region_signal = signals["regionTravelPlausible"]
    candidate_regions = [normalize_search_text(value) for value in [candidate.get("region") or "", *(candidate.get("regions") or [])] if value]
    if occurrence.get("region") and candidate_regions:
        occurrence_region = normalize_search_text(occurrence["region"])
        if occurrence_region in candidate_regions:
            score += region_signal["weight"]
            matching.append("region-or-travel-plausible")
            contributions.append({"signal": "regionTravelPlausible", "weight": region_signal["weight"], "applied": region_signal["weight"], "detail": f"Region {occurrence['region']}"})
        else:
            conflicting.append("region-mismatch")
            contributions.append({"signal": "regionMismatch", "weight": profile["observations"]["regionMismatch"]["weight"], "applied": 0, "detail": f"{occurrence['region']} gegen {'/'.join(candidate_regions)}"})

    # Signal 6: Buch-/Autor-Muster
    book_signal = signals["bookAuthorPattern"]
    if occurrence.get("collection") and occurrence["collection"] in (candidate.get("collections") or []):
        score += book_signal["weight"]
        matching.append("book-author-pattern")
        contributions.append({"signal": "bookAuthorPattern", "weight": book_signal["weight"], "applied": book_signal["weight"], "detail": f"Quelle ordnet die Person {occurrence['collection']} zu"})

    # Signal 7: widersprüchliches Todesjahr
    death_signal = signals["contradictoryDeathYear"]
    candidate_death_years = [year for year in (candidate.get("deathYears") or []) if year is not None]
    for key in ("deathYearMin", "deathYearMax"):
        if candidate.get(key) is not None:
            candidate_death_years.append(candidate[key])
    transmission_after_death = (
        occurrence.get("transmissionYear") is not None
        and candidate.get("deathYearMax") is not None
        and occurrence["transmissionYear"] > candidate["deathYearMax"]
    )
    asserted = [item for item in (occurrence.get("deathYearAssertions") or []) if item.get("event") == "death"]
    death_disagreement = bool(asserted) and bool(candidate_death_years) and not any(
        any(item["yearMin"] <= year <= item["yearMax"] for year in candidate_death_years) for item in asserted
    )
    if transmission_after_death or death_disagreement:
        score += death_signal["weight"]
        conflicting.append("contradictory-death-year")
        detail = "; ".join(
            part
            for part in [
                f"Ueberlieferung {occurrence.get('transmissionYear')} nach Todesjahr {candidate.get('deathYearMax')}" if transmission_after_death else "",
                f"belegte Todesjahre der Position ({', '.join(str(item['yearMin']) for item in asserted)}) treffen {', '.join(str(year) for year in candidate_death_years)} nicht" if death_disagreement else "",
            ]
            if part
        )
        contributions.append({"signal": "contradictoryDeathYear", "weight": death_signal["weight"], "applied": death_signal["weight"], "detail": detail})

    # Harte Regel 2: expliziter Quellenkonflikt
    for claim in occurrence.get("sourceConflicts") or []:
        if claim.get("candidateId") != candidate["id"]:
            continue
        if not claim.get("sourcePassageId"):
            notes.append("source-conflict-claim-without-passage-ignored")
            continue
        hard_blocks.append({
            "rule": "explicit-source-conflict",
            "reasonCode": "explicit-source-conflict",
            "rationale": f"Quellenaussage: {claim['statement']}" if claim.get("statement") else "Eine Quelle widerspricht dieser Zuordnung ausdruecklich.",
            "sourcePassageId": claim["sourcePassageId"],
        })
        conflicting.append("explicit-source-conflict")

    confidence_score = _round3(score)
    if hard_blocks:
        level = "conflict"
    elif matching:
        level = confidence_level_from_score(confidence_score)
    else:
        level = "unresolved"
    return {
        **base,
        "confidenceScore": confidence_score,
        "confidenceLevel": _assert_machine_level(level),
        "matchingSignals": matching,
        "conflictingSignals": conflicting,
        "contributions": contributions,
        "hardBlocks": hard_blocks,
        "notes": notes,
    }


# ---------------------------------------------------------------------------
# Chronologie: Port von lib/chronology.ts, KEINE zweite Berechnung
# ---------------------------------------------------------------------------


def possible_life_intervals(assertions: Sequence[dict[str, Any]], narrator_id: str) -> list[dict[str, int]]:
    """Wortgleich zu possibleLifeIntervals in lib/chronology.ts."""
    birth = [item for item in assertions if item["narratorId"] == narrator_id and item["event"] == "birth"]
    death = [item for item in assertions if item["narratorId"] == narrator_id and item["event"] == "death"]
    if not birth or not death:
        return []
    return [
        {"birthMin": start["yearMin"], "birthMax": start["yearMax"], "deathMin": end["yearMin"], "deathMax": end["yearMax"]}
        for start in birth
        for end in death
        if start["yearMin"] <= end["yearMax"]
    ]


def compare_chronology(assertions: Sequence[dict[str, Any]], first_id: str, second_id: str) -> dict[str, Any]:
    """Wortgleich zu compareChronology in lib/chronology.ts."""
    first = possible_life_intervals(assertions, first_id)
    second = possible_life_intervals(assertions, second_id)
    if not first or not second:
        return {"result": "insufficient", "overlapYears": None, "gapYears": None}
    maximum_overlap = 0
    minimum_gap: float = float("inf")
    for a in first:
        for b in second:
            overlap = min(a["deathMax"], b["deathMax"]) - max(a["birthMin"], b["birthMin"])
            if overlap >= 0:
                maximum_overlap = max(maximum_overlap, overlap)
            else:
                minimum_gap = min(minimum_gap, abs(overlap))
    if maximum_overlap > 0:
        return {"result": "possible", "overlapYears": maximum_overlap, "gapYears": None}
    return {"result": "impossible", "overlapYears": None, "gapYears": None if minimum_gap == float("inf") else int(minimum_gap)}


# ---------------------------------------------------------------------------
# Vorschlag und Batch
# ---------------------------------------------------------------------------


def rank_identity_candidates(occurrence: dict[str, Any], profiles: Sequence[dict[str, Any]], profile: dict[str, Any], limit: int | None = None) -> list[dict[str, Any]]:
    limit = profile["blocking"]["maxRankedCandidates"] if limit is None else limit
    scored = [score_identity_candidate(occurrence, entry, profile) for entry in profiles]
    scored = [item for item in scored if item["confidenceScore"] > 0 or item["hardBlocks"]]
    scored.sort(key=lambda item: (-item["confidenceScore"], item["narratorId"]))
    return scored[:limit]


def propose_identity(occurrence: dict[str, Any], profiles: Sequence[dict[str, Any]], profile: dict[str, Any]) -> dict[str, Any]:
    """Port von proposeIdentity, inklusive der drei harten Regeln."""
    candidates = rank_identity_candidates(occurrence, profiles, profile)
    hard_blocks: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for candidate in candidates:
        for block in candidate["hardBlocks"]:
            key = (block["rule"], block["reasonCode"], block["rationale"])
            if key in seen:
                continue
            seen.add(key)
            hard_blocks.append(block)

    rule = profile["hardRules"]["competingStrongCandidates"]
    strong = [item for item in candidates if item["confidenceScore"] >= rule["minScore"] and not item["hardBlocks"]]
    if len(strong) >= 2 and strong[0]["confidenceScore"] - strong[1]["confidenceScore"] < rule["maxGap"]:
        block = {
            "rule": "competing-strong-candidates",
            "reasonCode": "competing-strong-candidates",
            "rationale": (
                f"{strong[0]['narratorId']} ({strong[0]['confidenceScore']}) und {strong[1]['narratorId']} "
                f"({strong[1]['confidenceScore']}) liegen ab {rule['minScore']} weniger als {rule['maxGap']} "
                "auseinander und sind maschinell nicht unterscheidbar."
            ),
        }
        hard_blocks.append(block)
        for item in strong:
            if strong[0]["confidenceScore"] - item["confidenceScore"] >= rule["maxGap"]:
                continue
            item["hardBlocks"].append(block)
            item["conflictingSignals"].append("competing-strong-candidates")
            item["confidenceLevel"] = _assert_machine_level("conflict")

    best = next((item for item in candidates if not item["hardBlocks"]), None)
    if hard_blocks:
        level = "conflict"
    elif best:
        level = best["confidenceLevel"]
    else:
        level = "unresolved"
    return {
        "chainId": occurrence.get("chainId"),
        "position": occurrence.get("position"),
        "surface": occurrence["surface"],
        "candidates": candidates,
        "best": best,
        "confidenceLevel": _assert_machine_level(level),
        "confidenceScore": best["confidenceScore"] if best else None,
        "hardBlocks": hard_blocks,
        "autoLinkAllowed": not hard_blocks and best is not None and best["confidenceLevel"] == "high",
        "requiresEditorialDecision": True,
        "origin": "machine",
        "reviewStatus": "machine_unreviewed",
        "weightProfileVersion": profile["weightProfileVersion"],
        "resolverVersion": profile["resolverVersion"],
        "relativeFormVersion": RELATIVE_FORM_VERSION,
    }


def resolve_forms_batch(
    index: dict[str, Any],
    forms: Sequence[dict[str, Any]],
    profile: dict[str, Any],
    budget: int | None,
    context: dict[str, Any] | None = None,
    keep_resolutions: bool = False,
) -> dict[str, Any]:
    """Einsträngiger Batch-Lauf ueber distinkte Namensformen."""
    started = time.perf_counter()
    resolutions: list[dict[str, Any]] = []
    counts: list[int] = []
    levels = {"high": 0, "medium": 0, "low": 0, "unresolved": 0, "conflict": 0}
    auto_link = 0
    without_candidate = 0
    entries: Sequence[dict[str, Any]] = index["entries"]
    for form in forms:
        selection = select_candidates(index, form["form"], budget)
        if not selection["indices"]:
            without_candidate += 1
        counts.append(len(selection["indices"]))
        occurrence = {
            "surface": form["form"],
            "chainId": form["positions"][0]["chainId"] if form["positions"] else None,
            "position": form["positions"][0]["position"] if form["positions"] else None,
            "previousNarratorIds": [],
            "nextNarratorIds": [],
            **(context or {}),
        }
        profiles = [profile_from_rijal_entry(entries[entry_index]) for entry_index in selection["indices"]]
        proposal = propose_identity(occurrence, profiles, profile)
        levels[proposal["confidenceLevel"]] += 1
        if proposal["autoLinkAllowed"]:
            auto_link += 1
        if keep_resolutions:
            resolutions.append({
                "form": form["form"],
                "occurrences": form["occurrences"],
                "candidateCount": len(selection["indices"]),
                "usedTokens": selection["usedTokens"],
                "skippedTokens": selection["skippedTokens"],
                "proposal": proposal,
            })
    ordered = sorted(counts)

    def quantile(share: float) -> int:
        if not ordered:
            return 0
        return ordered[min(len(ordered) - 1, int(len(ordered) * share))]

    return {
        "resolutions": resolutions,
        "stats": {
            "forms": len(forms),
            "formsWithoutCandidate": without_candidate,
            "candidateTotal": sum(counts),
            "candidateMean": round(statistics.fmean(counts), 1) if counts else 0,
            "candidateMedian": quantile(0.5),
            "candidateP90": quantile(0.9),
            "candidateMax": ordered[-1] if ordered else 0,
            "proposalsHigh": levels["high"],
            "proposalsMedium": levels["medium"],
            "proposalsLow": levels["low"],
            "proposalsUnresolved": levels["unresolved"],
            "proposalsConflict": levels["conflict"],
            "autoLinkAllowed": auto_link,
            "resolveMs": round((time.perf_counter() - started) * 1000, 1),
        },
    }


# ---------------------------------------------------------------------------
# Messlauf ueber den Echtbestand
# ---------------------------------------------------------------------------

HADITH_SOURCES = ("bukhari", "muslim")
RIJAL_SOURCES = ("tahdhib", "mizan", "taqrib", "kashif")


def iter_occurrences(derived: Path, collections: Sequence[str] = HADITH_SOURCES) -> Iterator[dict[str, Any]]:
    for collection in collections:
        path = derived / f"{collection}.json"
        if not path.exists():
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        for record in payload["records"]:
            for chain in record.get("chains") or []:
                for occurrence in chain.get("narratorOccurrences") or []:
                    yield {**occurrence, "collection": collection, "recordId": record["id"]}


def load_rijal_entries(derived: Path, sources: Sequence[str] = RIJAL_SOURCES) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for source in sources:
        path = derived / f"{source}.json"
        if not path.exists():
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        for entry in payload["entries"]:
            entries.append({**entry, "source": source})
    return entries


def measure(derived: Path, budget: int | None, weight_profile: dict[str, Any]) -> dict[str, Any]:
    """Vollstaendiger Lauf mit Messwerten. Jede Zahl im Bericht kommt hier heraus."""
    total_started = time.perf_counter()
    load_started = time.perf_counter()
    entries = load_rijal_entries(derived)
    occurrences = list(iter_occurrences(derived))
    load_ms = round((time.perf_counter() - load_started) * 1000, 1)

    index = build_head_token_index(entries)
    prophet_forms = collect_prophet_forms(occurrences)
    collected = collect_distinct_name_forms(occurrences, prophet_forms)
    batch = resolve_forms_batch(index, collected["forms"], weight_profile, budget)

    posting_sizes = sorted((len(value) for value in index["postings"].values()), reverse=True)
    relative_kinds: dict[str, int] = {}
    relative_matches: dict[str, int] = {}
    for reference in collected["relatives"]:
        relative_kinds[reference["kinship"]] = relative_kinds.get(reference["kinship"], 0) + 1
        relative_matches[reference["match"]] = relative_matches.get(reference["match"], 0) + 1
    return {
        "dataVersion": json.loads((ROOT / "public" / "data" / "corpus" / "manifest.json").read_text(encoding="utf-8")).get("dataVersion"),
        "weightProfileVersion": weight_profile["weightProfileVersion"],
        "resolverVersion": weight_profile["resolverVersion"],
        "relativeFormVersion": RELATIVE_FORM_VERSION,
        "budget": budget,
        "loadMs": load_ms,
        "index": {**index["stats"], "largestPostings": posting_sizes[:5], "singletonTokens": sum(1 for size in posting_sizes if size == 1)},
        "prophetFormsDerived": sorted(prophet_forms),
        "forms": collected["stats"],
        "relatives": {"total": len(collected["relatives"]), "byKinship": relative_kinds, "byMatch": relative_matches},
        "batch": batch["stats"],
        "totalMs": round((time.perf_counter() - total_started) * 1000, 1),
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Blocking-Index und Batch-Resolver (P4.1)")
    parser.add_argument("--measure", action="store_true", help="vollstaendigen Lauf mit Messwerten ausfuehren")
    parser.add_argument("--derived", default=str(DERIVED_DEFAULT), help="Verzeichnis der Importerausgabe")
    parser.add_argument("--budget", type=int, default=None, help="Kandidatenbudget je Form; 0 schaltet die Begrenzung ab")
    parser.add_argument("--weights", default=str(WEIGHT_PROFILE_PATH), help="Pfad zur Gewichtsdatei")
    args = parser.parse_args(argv)
    weight_profile = load_weight_profile(Path(args.weights))
    budget = weight_profile["blocking"]["candidateBudget"] if args.budget is None else (None if args.budget == 0 else args.budget)
    if not args.measure:
        parser.print_help()
        return 0
    report = measure(Path(args.derived), budget, weight_profile)
    print(json.dumps(report, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
