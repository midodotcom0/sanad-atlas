"""Wortgleicher Python-Port von ``lib/relative-forms.ts`` (Umsetzungsplan P4.4).

Einzige fachliche Definition bleibt ``lib/relative-forms.ts``. Diese Datei ist
ein Port, keine zweite Definition. Weicht sie ab, ist sie falsch.

Nachweis der Gleichheit:
  * ``tests/blocking.check.mjs`` vergleicht die Begriffstabelle aus allen drei
    Quelldateien Zeile fuer Zeile und ruft diese Datei per ``python3`` fuer
    dieselben Pruefvektoren auf wie den Node-Port.
  * ``tests/entity-resolution.test.ts`` vergleicht TypeScript gegen den Node-Port.

Fachlicher Kern: eine relative Namensform ist ein Zeiger auf eine andere
POSITION derselben Kette, niemals eine globale Identitaet. ``resolve_relative_form``
verlangt deshalb ``chain_id`` und ``position``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .normalize import normalize_search_text

#: Muss zu RELATIVE_FORM_VERSION in lib/relative-forms.ts passen.
RELATIVE_FORM_VERSION = "sanad-relative-forms-1.0.0"


@dataclass(frozen=True)
class RelativeFormTerm:
    """Eine Zeile der kanonischen Begriffstabelle."""

    term: str
    kinship: str
    schema_kind: str
    person: str
    arity: str
    anchored: bool
    anonymous: bool
    scope: str
    legacy_bucket_term: bool


#: Wortgleich zu RELATIVE_FORM_TERMS in lib/relative-forms.ts. Reihenfolge ist Teil des Vertrags.
RELATIVE_FORM_TERMS: tuple[RelativeFormTerm, ...] = (
    RelativeFormTerm("ابيه", "father", "father", "third", "single", True, False, "any", True),
    RelativeFormTerm("ابيها", "father", "father", "third", "single", True, False, "any", False),
    RelativeFormTerm("ابوه", "father", "father", "third", "single", True, False, "any", False),
    RelativeFormTerm("ابيهما", "father", "father", "third", "dual", True, False, "any", False),
    RelativeFormTerm("امه", "mother", "other", "third", "single", True, False, "any", True),
    RelativeFormTerm("امها", "mother", "other", "third", "single", True, False, "any", False),
    RelativeFormTerm("جده", "grandfather", "grandfather", "third", "single", True, False, "any", True),
    RelativeFormTerm("جدها", "grandfather", "grandfather", "third", "single", True, False, "any", True),
    RelativeFormTerm("جدته", "grandmother", "other", "third", "single", True, False, "any", True),
    RelativeFormTerm("جدتها", "grandmother", "other", "third", "single", True, False, "any", False),
    RelativeFormTerm("عمه", "uncle_paternal", "uncle", "third", "single", True, False, "any", True),
    RelativeFormTerm("عمها", "uncle_paternal", "uncle", "third", "single", True, False, "any", False),
    RelativeFormTerm("عماه", "uncle_paternal", "uncle", "third", "dual", True, False, "any", False),
    RelativeFormTerm("عمته", "aunt_paternal", "other", "third", "single", True, False, "any", True),
    RelativeFormTerm("خاله", "uncle_maternal", "uncle", "third", "single", True, False, "any", True),
    RelativeFormTerm("خالته", "aunt_maternal", "other", "third", "single", True, False, "any", True),
    RelativeFormTerm("اخيه", "brother", "brother", "third", "single", True, False, "any", True),
    RelativeFormTerm("اخيها", "brother", "brother", "third", "single", True, False, "any", False),
    RelativeFormTerm("اخته", "sister", "other", "third", "single", True, False, "any", True),
    RelativeFormTerm("اختها", "sister", "other", "third", "single", True, False, "any", False),
    RelativeFormTerm("ابنه", "son", "other", "third", "single", True, False, "any", True),
    RelativeFormTerm("ابنها", "son", "other", "third", "single", True, False, "any", False),
    RelativeFormTerm("بنته", "daughter", "other", "third", "single", True, False, "any", True),
    RelativeFormTerm("زوجته", "wife", "other", "third", "single", True, False, "any", True),
    RelativeFormTerm("زوجها", "husband", "other", "third", "single", True, False, "any", False),
    RelativeFormTerm("شيخه", "shaykh", "unnamed_shaykh", "third", "single", True, False, "any", False),
    RelativeFormTerm("صاحبه", "companion", "other", "third", "single", True, False, "any", False),
    RelativeFormTerm("ابي", "father", "father", "first", "single", True, False, "whole", False),
    RelativeFormTerm("اخي", "brother", "brother", "first", "single", True, False, "whole", False),
    RelativeFormTerm("عمي", "uncle_paternal", "uncle", "first", "single", True, False, "whole", False),
    RelativeFormTerm("جدي", "grandfather", "grandfather", "first", "single", True, False, "whole", False),
    RelativeFormTerm("رجل", "unnamed_man", "unnamed_man", "third", "single", False, True, "head", False),
    RelativeFormTerm("امراه", "unnamed_woman", "other", "third", "single", False, True, "head", False),
    RelativeFormTerm("شيخ", "unnamed_shaykh", "unnamed_shaykh", "third", "single", False, True, "head", False),
    RelativeFormTerm("بعض اصحابه", "unnamed_group", "other", "third", "dual", True, True, "head", False),
    RelativeFormTerm("بعض اصحاب", "unnamed_group", "other", "third", "dual", False, True, "head", False),
)

#: Wortgleich zu SURFACE_LEADING_PARTICLES in lib/relative-forms.ts.
SURFACE_LEADING_PARTICLES = ("عن", "و", "ف", "ثم", "لي", "له", "ولي", "وله")

#: Wortgleich zu SURFACE_TRIM_CHARACTERS in lib/relative-forms.ts.
SURFACE_TRIM_CHARACTERS = ".,:؛؟!()[]{}«»\"'-*،؍/\\"


def _is_ornament_token(token: str) -> bool:
    """Arabische Ehrenligaturen und Ornamente (U+FD3E bis U+FDFF)."""
    if not token:
        return False
    return all(0xFD3E <= ord(character) <= 0xFDFF for character in token)


def _trim_token(token: str) -> str:
    start, end = 0, len(token)
    while start < end and token[start] in SURFACE_TRIM_CHARACTERS:
        start += 1
    while end > start and token[end - 1] in SURFACE_TRIM_CHARACTERS:
        end -= 1
    return token[start:end]


def surface_tokens(surface: str | None) -> list[str]:
    """Tokenfolge einer Oberflaechenform fuer die Positionsanalyse."""
    tokens = [
        trimmed
        for trimmed in (_trim_token(token) for token in normalize_search_text(surface or "").split(" "))
        if trimmed and not _is_ornament_token(trimmed)
    ]
    index = 0
    while index < len(tokens) and tokens[index] in SURFACE_LEADING_PARTICLES:
        index += 1
    return tokens[index:]


def _matches_scope(term: RelativeFormTerm, index: int, token_count: int, phrase_length: int) -> bool:
    if term.scope == "whole":
        return index == 0 and token_count == phrase_length
    if term.scope == "head":
        return index == 0
    return True


def analyze_relative_form(surface: str | None) -> dict[str, Any]:
    """Findet die erste relative Angabe und klassifiziert ihre Stellung."""
    tokens = surface_tokens(surface)
    empty: dict[str, Any] = {
        "isRelativeForm": False,
        "match": "none",
        "term": None,
        "unresolvableRelative": False,
        "residualForm": " ".join(tokens),
        "resolutionSurface": " ".join(tokens),
        "tokens": tokens,
        "version": RELATIVE_FORM_VERSION,
    }
    if not tokens:
        return empty

    found: tuple[RelativeFormTerm, int, int] | None = None
    for term in RELATIVE_FORM_TERMS:
        parts = term.term.split(" ")
        for index in range(0, len(tokens) - len(parts) + 1):
            if tokens[index : index + len(parts)] != parts:
                continue
            if not _matches_scope(term, index, len(tokens), len(parts)):
                continue
            if found is None or index < found[1] or (index == found[1] and len(parts) > found[2]):
                found = (term, index, len(parts))
            break
    if found is None:
        return empty

    term, index, length = found
    residual = tokens[:index] + tokens[index + length :]
    if not residual:
        match = "whole"
    elif index == 0:
        match = "leading-apposition"
    elif index + length == len(tokens):
        match = "trailing"
    else:
        match = "internal"
    unresolvable = match == "whole" or term.anonymous
    return {
        "isRelativeForm": True,
        "match": match,
        "term": term,
        "unresolvableRelative": unresolvable,
        "residualForm": " ".join(residual),
        "resolutionSurface": "" if unresolvable else " ".join(residual),
        "tokens": tokens,
        "version": RELATIVE_FORM_VERSION,
    }


def is_relative_surface_form(surface: str | None) -> bool:
    return bool(analyze_relative_form(surface)["isRelativeForm"])


def is_unresolvable_relative_form(surface: str | None) -> bool:
    return bool(analyze_relative_form(surface)["unresolvableRelative"])


def resolve_relative_form(surface: str | None, chain_id: str, position: int) -> dict[str, Any] | None:
    """Positionsgebundene Aufloesung. Ohne chain_id und position nicht aufrufbar."""
    analysis = analyze_relative_form(surface)
    if not analysis["isRelativeForm"] or analysis["term"] is None:
        return None
    term: RelativeFormTerm = analysis["term"]
    if not term.anchored:
        anchor_kind = "none"
    elif position > 0:
        anchor_kind = "citing-narrator"
    else:
        anchor_kind = "collector-outside-chain"
    anchor_position = position - 1 if anchor_kind == "citing-narrator" else None
    if not term.anchored:
        reason_code = "anonymous-surface-no-anchor"
        rationale = f"Anonyme Umschreibung \u201e{term.term}\" ohne Anker; ohne Quelle ist keine Person benennbar."
    elif anchor_kind == "collector-outside-chain":
        reason_code = "relative-anchor-outside-chain"
        rationale = f"Relative Form \u201e{term.term}\" auf Position 0: der zitierende Erzaehler liegt ausserhalb der Kette."
    elif analysis["unresolvableRelative"]:
        reason_code = "relative-anchored-unnamed"
        rationale = (
            f"Relative Form \u201e{term.term}\" ohne eigenen Namen; gemeint ist {term.kinship} "
            f"des Erzaehlers auf Position {anchor_position} derselben Kette."
        )
    else:
        reason_code = "relative-anchored-named-apposition"
        rationale = (
            f"Relative Form \u201e{term.term}\" mit benanntem Rest \u201e{analysis['resolutionSurface']}\"; "
            f"die Verwandtschaftsangabe bezieht sich auf Position {anchor_position} derselben Kette."
        )
    return {
        "chainId": chain_id,
        "position": position,
        "key": f"{chain_id}#{position}",
        "kinship": term.kinship,
        "schemaKind": term.schema_kind,
        "person": term.person,
        "arity": term.arity,
        "match": analysis["match"],
        "anchorKind": anchor_kind,
        "anchorPosition": anchor_position,
        "anchorComplete": term.arity == "single",
        "resolutionSurface": analysis["resolutionSurface"],
        "requiresEditorialDecision": True,
        "reasonCode": reason_code,
        "rationale": rationale,
        "version": RELATIVE_FORM_VERSION,
    }


#: Eingefrorene Teilmenge fuer die ``UNC-REL-``-Bucket-IDs (``backend/app/repository.py:144``).
LEGACY_BUCKET_RELATIVE_TERMS = tuple(term.term for term in RELATIVE_FORM_TERMS if term.legacy_bucket_term)

__all__ = [
    "RELATIVE_FORM_VERSION",
    "RELATIVE_FORM_TERMS",
    "RelativeFormTerm",
    "SURFACE_LEADING_PARTICLES",
    "SURFACE_TRIM_CHARACTERS",
    "surface_tokens",
    "analyze_relative_form",
    "is_relative_surface_form",
    "is_unresolvable_relative_form",
    "resolve_relative_form",
    "LEGACY_BUCKET_RELATIVE_TERMS",
]
