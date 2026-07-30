"""Wortgleicher Python-Port von worker/src/core/hijri-date-phrase.mjs.

Zerlegt eine hidschri-Datumsangabe in ihre EINZELNEN belegten Moeglichkeiten.
Die Quellen nennen fuer eine Person regelmaessig mehrere Jahre nebeneinander
(«145، أو: 146هـ، أو: 147هـ، وقيل: 144هـ» sind vier Angaben, nicht eine).

Diese Funktion rechnet nicht: sie liest die Jahre, die dastehen, und behaelt den
Wortlaut jeder einzelnen Angabe bei. «أو» ist eine alternative Lesung innerhalb
derselben Aussage, «وقيل» eine eigenstaendige Aussage einer anderen Autoritaet --
der Unterschied bleibt erhalten.

Aenderungen hier und in der .mjs-Fassung muessen gemeinsam erfolgen;
tests/hijri-date-parity.check.mjs prueft beide gegen dieselbe Fixture.
"""

from __future__ import annotations

import re
from typing import Any

ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩"

QUALIFIERS: tuple[tuple[str, str], ...] = (
    ("بعيد", "shortly_after"),
    ("قبيل", "shortly_before"),
    ("بعد", "after"),
    ("قبل", "before"),
    ("نحو", "circa"),
    ("حدود", "circa"),
    ("زهاء", "circa"),
)

_REPORTED = re.compile("ق(?:ي|ِي)ل")
_ALTERNATIVE = re.compile("أو|او")
_YEAR = re.compile(r"\d{1,4}")
_TAIL = re.compile(r"^\s*(?:هـ|هجرية|هج)?")
_WORDING_HEAD = re.compile(r"^[\s،؛,.:]*(?:هـ|هجرية|هج)?[\s،؛,.:]*")


def to_ascii_digits(value: str) -> str:
    return "".join(str(ARABIC_INDIC.index(char)) if char in ARABIC_INDIC else char for char in value)


def _relation_for(connector: str, is_first: bool) -> str:
    if is_first:
        return "primary"
    if _REPORTED.search(connector):
        return "reported"
    if _ALTERNATIVE.search(connector):
        return "alternative"
    return "additional"


def _qualifier_for(segment: str) -> str | None:
    for word, code in QUALIFIERS:
        if word in segment:
            return code
    return None


def parse_hijri_year_phrase(phrase: Any, kind: str) -> list[dict[str, Any]]:
    """Liest alle Jahresangaben einer Phrase als einzelne Aussagen."""
    source_phrase = phrase.strip() if isinstance(phrase, str) and phrase.strip() else None
    if not source_phrase:
        return []

    ascii_text = to_ascii_digits(source_phrase)
    assertions: list[dict[str, Any]] = []
    seen: set[str] = set()
    previous_end = 0

    for match in _YEAR.finditer(ascii_text):
        year = int(match.group(0))
        # Ein Jahr ueber 1100 AH ist in diesem Bestand keine Jahresangabe,
        # sondern eine Seiten- oder Bandzahl in derselben Zeile.
        if not year or year > 1100:
            previous_end = match.end()
            continue

        connector = ascii_text[previous_end:match.start()]
        is_first = not assertions
        relation = _relation_for(connector, is_first)
        qualifier = _qualifier_for(ascii_text[:match.start()] if is_first else connector)

        tail = _TAIL.match(ascii_text[match.end():])
        wording_start = match.start() if is_first else previous_end
        wording_end = match.end() + (len(tail.group(0)) if tail else 0)
        wording = _WORDING_HEAD.sub("", source_phrase[wording_start:wording_end]).strip()

        key = f"{year}|{relation}|{qualifier or ''}"
        if key not in seen:
            seen.add(key)
            # Feldbild von ApiRijalDateAssertion (lib/api-client.ts).
            assertions.append({
                "kind": kind,
                "verb": None,
                "qualifier": qualifier,
                "valueAh": year,
                "approximate": qualifier == "circa",
                "rawPhrase": wording or str(year),
                "textOffset": match.start(),
                "evidenceClass": "rijal_statement",
                "confidence": None,
                "reviewStatus": "machine_unreviewed",
                "relation": relation,
                "sourcePhrase": source_phrase,
            })
        previous_end = match.end()

    return assertions
