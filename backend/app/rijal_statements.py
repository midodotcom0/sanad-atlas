"""Lehrer-/Schuelernennungen als quellengebundene Assertions (P4.6), Python-Seite.

Wortgleicher Port von ``scripts/atlas-rijal-statements.mjs``. Die Gleichheit
beider Seiten prueft ``tests/atlas-db-id-scheme.check.mjs`` gegen dieselben
Rohnennungen aus ``.cache/turath-derived``.

Die drei Regeln stehen ausfuehrlich im JS-Modul; kurz:

1. Keine Kante ohne Quellenstelle -- die bereinigte Nennung muss wortwoertlich
   im Eintragstext stehen, sonst ist die Fundstelle nicht nachpruefbar.
2. Keine Chronologie als Beleg -- dieses Modul kennt keine Jahreszahlen.
3. Verworfenes verschwindet nicht -- jede Zurueckweisung traegt einen Code und
   landet in der Review-Queue (``parse_review_item``).

``accepted`` bezeichnet nur quellengebundene, personenscharf segmentierte
Nennungen. Die ``UNC-*``-Enden sind Oberflaechenform-Cluster, keine geklaerten
historischen Identitaeten; bis zur Aufloesung beider Enden bleiben auch diese
Ergebnisse als ``rijal_statement_identity_unresolved`` in der Review-Queue.
"""

from __future__ import annotations

import re
from typing import Any

from .normalize import normalize_arabic
from .stable_keys import cluster_id_for_name

#: Version dieser Segmentierung. Geht als ``parser_version`` in jede Assertion.
RIJAL_STATEMENT_VERSION = "rijal-statements-1.1.0"

_COLLECTIVE_HEAD_TOKENS_RAW = (
    "غير", "غيرهم", "غيرهما", "غيرهن", "غيره", "غيرها",
    "اخر", "اخران", "اخرون", "اخرين", "الاخرون", "جماعه", "الجماعه",
    "خلق", "خلائق", "جمع", "عده", "طايفه", "طائفه", "ناس", "اخرهم", "عدد",
    "سوي", "الباقون", "باقون", "شيخان",
)
_COLLECTIVE_LEADING_PARTICLES_RAW = ("في", "من", "وفي", "ومن")

COLLECTIVE_HEAD_TOKENS = frozenset(normalize_arabic(t) for t in _COLLECTIVE_HEAD_TOKENS_RAW)
COLLECTIVE_LEADING_PARTICLES = frozenset(normalize_arabic(t) for t in _COLLECTIVE_LEADING_PARTICLES_RAW)

_NON_NAME_HEAD_TOKENS_RAW = (
    "عن", "حدثنا", "حدثني", "حدثناه", "حدثنيه", "اخبرنا", "اخبرني", "اخبرناه",
    "اخبرنيه", "انبانا", "انباني", "نبانا", "ثنا", "نا", "سمعت", "سمعنا", "سمع",
    "روي", "يروي", "يرويه", "رواه", "قال", "وقال", "قلت", "قيل", "وقيل",
    "ذكر", "ذكره", "وذكره", "كتب", "كتبت", "اخرج", "اخرجه", "واخرجه", "اخرجاه",
    "اخرجا", "ساق", "سالت", "ساله", "وثقه", "وثق", "نسبه", "ياتي", "سياتي",
    "هو", "هي", "هما", "هم", "من", "في", "لم", "لن", "لا", "ليس", "كان", "كانت",
    "يكون", "لانه", "ان", "انه", "انها", "انما", "ثم", "وقد", "قرا", "قرات",
    "بن", "له", "مات", "توفي", "عامل", "حكي", "ارسل", "قاله", "فيه", "فيحتمل",
    "حديثا", "نسيبه", "حفيده", "حفيدها", "بعضه", "الصحيح", "كانه", "منهم", "خاليه",
)
NON_NAME_HEAD_TOKENS = frozenset(normalize_arabic(t) for t in _NON_NAME_HEAD_TOKENS_RAW)

_NON_NAME_INTERNAL_TOKENS_RAW = (
    "عن", "عنه", "عنها", "في", "فيه", "بواسطه", "حديثا", "مرسلا", "خلاف",
    "اختلاف", "قصه", "القصه", "مسايل", "المسايل", "وحده", "وحدها",
)
NON_NAME_INTERNAL_TOKENS = frozenset(normalize_arabic(t) for t in _NON_NAME_INTERNAL_TOKENS_RAW)

_RELATIVE_MENTION_HEADS_RAW = (
    "اخوه", "اخوها", "ابوه", "ابوها", "والده", "والدها", "ولده", "ولدها",
    "ابناه", "ابنا", "ابني", "ابناؤه", "ابناء", "ابنته", "زوجها", "شيخه", "شيخها",
)
RELATIVE_MENTION_HEADS = frozenset(normalize_arabic(t) for t in _RELATIVE_MENTION_HEADS_RAW)

W_NAME_PREDECESSORS = frozenset(normalize_arabic(t) for t in ("بن", "ابن", "ابي", "ابو", "بنت", "ام", "عبد"))
W_TOKEN_EXCEPTIONS = frozenset(normalize_arabic(t) for t in ("وسلم",))

_BRACKETED = re.compile(r"[([][^)\]]*[)\]]")
_QUOTE_CHARS = re.compile(r"[\"«»”“„']")
_EDGE_PUNCTUATION = re.compile(r"^[\s.,،؛:\-–—()\[\]]+|[\s.,،؛:\-–—()\[\]]+$")
_WHITESPACE = re.compile(r"\s+")
_INTERNAL_STRUCTURE = re.compile(r"[:\-–—/\[\]]")

MAX_NAME_TOKENS = 8

REJECTION_CODES = {
    "SUBJECT_NOT_NAMED": "rijal_statement_subject_not_named",
    "ENTRY_TEXT_MISSING": "rijal_statement_entry_text_missing",
    "EMPTY_AFTER_CLEANING": "rijal_statement_empty_after_cleaning",
    "RELATIVE_FORM": "rijal_statement_relative_form",
    "NO_PERSON_NAMED": "rijal_statement_no_person_named",
    "UNSEGMENTED_PHRASE": "rijal_statement_unsegmented_phrase",
    "PHRASE_NOT_IN_PASSAGE": "rijal_statement_phrase_not_in_passage",
    "SELF_REFERENCE": "rijal_statement_self_reference",
    "DUPLICATE": "rijal_statement_duplicate",
}


def _strip_edges(value: str) -> str:
    # Genau EIN Durchlauf -- die JS-Seite ruft `String.replace` mit einem
    # /g-Regex ebenfalls genau einmal auf. Ein Wiederholen bis zum Fixpunkt
    # wuerde in Randfaellen mehr entfernen und die Portgleichheit brechen.
    return _EDGE_PUNCTUATION.sub("", value)


def clean_mention_surface(raw: str | None, index: int) -> str:
    """Bereinigt eine Rohnennung zu einer Namensoberflaeche.

    ``index > 0``: der Importer trennt an „، و" und laesst das verbindende و am
    Anfang jeder Folgenennung stehen. Genau dieses eine و faellt weg. Die erste
    Nennung traegt es nicht und wird nie beschnitten -- sonst wuerde aus dem
    Namen „وكيع" ein „كيع".
    """
    value = _BRACKETED.sub(" ", str(raw or ""))
    value = _QUOTE_CHARS.sub(" ", value)
    value = _strip_edges(_WHITESPACE.sub(" ", value))
    if index > 0 and value.startswith("و") and len(value) > 2:
        value = value[1:]
    return _strip_edges(value)


def evaluate_mention(raw: str | None, index: int, entry_text: str | None) -> dict[str, Any]:
    from .repository import is_relative_reference

    surface = clean_mention_surface(raw, index)
    if not surface:
        return {"ok": False, "code": REJECTION_CODES["EMPTY_AFTER_CLEANING"],
                "detail": "Nennung ist nach dem Entfernen von Sigeln und Trennzeichen leer.", "surface": surface}
    if "." in surface:
        return {"ok": False, "code": REJECTION_CODES["UNSEGMENTED_PHRASE"],
                "detail": "Nennung enthaelt eine Satzgrenze und ist damit nicht personenscharf zerlegt.", "surface": surface}
    normalized = normalize_arabic(surface)
    if not normalized:
        return {"ok": False, "code": REJECTION_CODES["EMPTY_AFTER_CLEANING"],
                "detail": "Normalisierte Form der Nennung ist leer.", "surface": surface}
    if is_relative_reference(normalized):
        return {"ok": False, "code": REJECTION_CODES["RELATIVE_FORM"],
                "detail": "Positionsgebundene Rueckverweisform (z. B. ابيه). Sie benennt keine global adressierbare Person und bekommt deshalb keine kanonische ID.",
                "surface": surface}
    tokens = [t for t in normalized.split(" ") if t]
    if len(tokens) > MAX_NAME_TOKENS:
        return {"ok": False, "code": REJECTION_CODES["UNSEGMENTED_PHRASE"],
                "detail": f"Nennung hat {len(tokens)} Token und ist damit ein Satzrest, keine Einzelnennung.", "surface": surface}
    if any(len(token) == 1 for token in tokens):
        return {
            "ok": False,
            "code": REJECTION_CODES["UNSEGMENTED_PHRASE"],
            "detail": "Nennung enthaelt einen einbuchstabigen Werk-/Quellensigelrest und ist nicht personenscharf.",
            "surface": surface,
        }
    head = tokens[1] if (tokens[0] in COLLECTIVE_LEADING_PARTICLES and len(tokens) > 1) else tokens[0]
    head_without_conjunction = head[1:] if head.startswith("و") and len(head) > 2 else head
    if head in COLLECTIVE_HEAD_TOKENS or head_without_conjunction in COLLECTIVE_HEAD_TOKENS:
        return {"ok": False, "code": REJECTION_CODES["NO_PERSON_NAMED"],
                "detail": "Restmengenangabe („und andere“) ohne benannte Person.", "surface": surface}
    if tokens[0] in RELATIVE_MENTION_HEADS:
        return {
            "ok": False,
            "code": REJECTION_CODES["RELATIVE_FORM"],
            "detail": "Relative oder duale Familiennennung ohne eigenstaendigen, personenscharfen Namenskopf.",
            "surface": surface,
        }
    if tokens[0] in NON_NAME_HEAD_TOKENS:
        return {
            "ok": False,
            "code": REJECTION_CODES["UNSEGMENTED_PHRASE"],
            "detail": f"Nennung beginnt mit dem Aussage-/Kommentarwort „{tokens[0]}“ und ist kein personenscharfer Namenskopf.",
            "surface": surface,
        }
    internal_non_name_token = next((token for token in tokens[1:] if token in NON_NAME_INTERNAL_TOKENS), None)
    if internal_non_name_token:
        return {
            "ok": False,
            "code": REJECTION_CODES["UNSEGMENTED_PHRASE"],
            "detail": f"Nennung geht bei „{internal_non_name_token}“ in einen Satzrest ueber und ist nicht personenscharf.",
            "surface": surface,
        }
    if _INTERNAL_STRUCTURE.search(surface):
        return {
            "ok": False,
            "code": REJECTION_CODES["UNSEGMENTED_PHRASE"],
            "detail": "Nennung enthaelt einen redaktionellen Zusatz oder einen unvollstaendigen Markuprest.",
            "surface": surface,
        }
    for token_index in range(1, len(tokens)):
        token = tokens[token_index]
        if (
            token.startswith("و")
            and len(token) > 2
            and token not in W_TOKEN_EXCEPTIONS
            and tokens[token_index - 1] not in W_NAME_PREDECESSORS
        ):
            return {
                "ok": False,
                "code": REJECTION_CODES["UNSEGMENTED_PHRASE"],
                "detail": f"Nennung enthaelt bei „{token}“ mehrere Personen oder einen nicht abgetrennten Kommentar.",
                "surface": surface,
            }
    cluster_id = cluster_id_for_name(normalized)
    if cluster_id is None:
        return {"ok": False, "code": REJECTION_CODES["EMPTY_AFTER_CLEANING"],
                "detail": "Aus der Nennung laesst sich keine Namensidentitaet bilden.", "surface": surface}
    if not entry_text or surface not in entry_text:
        return {
            "ok": False,
            "code": REJECTION_CODES["PHRASE_NOT_IN_PASSAGE"] if entry_text else REJECTION_CODES["ENTRY_TEXT_MISSING"],
            "detail": (
                "Bereinigte Nennung steht nicht wortwoertlich im Eintragstext; die Fundstelle waere nicht nachpruefbar."
                if entry_text
                else "Zum Eintrag liegt kein Quelltext vor, an dem die Nennung belegt werden koennte."
            ),
            "surface": surface,
        }
    return {"ok": True, "surface": surface, "normalized": normalized, "clusterId": cluster_id}


def extract_rijal_statements(entry: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Zerlegt einen Rijāl-Eintrag in Aussagekandidaten und verworfene Nennungen.

    Die Kante zeigt immer vom Lehrer zum Schueler: unter „Lehrer" ist die
    genannte Person das Subjekt, unter „Schueler" die Person des Eintrags.
    """
    accepted: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    subject_normalized = entry.get("nameSurfaceNormalizedHead") or ""
    entry_text = entry.get("entryText") or ""
    subject_cluster_id = cluster_id_for_name(subject_normalized)

    lists = (("teacher", entry.get("teacherMentions") or []), ("student", entry.get("studentMentions") or []))

    if subject_cluster_id is None:
        for list_kind, mentions in lists:
            for index, raw in enumerate(mentions):
                rejected.append({
                    "entryId": entry.get("id"), "listKind": list_kind, "index": index,
                    "rawMention": str(raw or ""), "surface": "",
                    "code": REJECTION_CODES["SUBJECT_NOT_NAMED"],
                    "detail": "Der Eintrag selbst hat keinen auswertbaren Namenskopf; ohne benanntes Subjekt gibt es keine Kante.",
                })
        return {"accepted": accepted, "rejected": rejected}

    seen: set[str] = set()
    for list_kind, mentions in lists:
        for index, raw in enumerate(mentions):
            verdict = evaluate_mention(raw, index, entry_text)
            if not verdict["ok"]:
                rejected.append({
                    "entryId": entry.get("id"), "listKind": list_kind, "index": index,
                    "rawMention": str(raw or ""), "surface": verdict["surface"],
                    "code": verdict["code"], "detail": verdict["detail"],
                })
                continue
            if verdict["clusterId"] == subject_cluster_id:
                rejected.append({
                    "entryId": entry.get("id"), "listKind": list_kind, "index": index,
                    "rawMention": str(raw or ""), "surface": verdict["surface"],
                    "code": REJECTION_CODES["SELF_REFERENCE"],
                    "detail": "Nennung faellt mit der Person des Eintrags zusammen; eine Kante auf sich selbst ist keine Ueberlieferungsbeziehung.",
                })
                continue
            teacher_cluster_id = verdict["clusterId"] if list_kind == "teacher" else subject_cluster_id
            student_cluster_id = subject_cluster_id if list_kind == "teacher" else verdict["clusterId"]
            dedupe_key = f"{teacher_cluster_id}>{student_cluster_id}"
            if dedupe_key in seen:
                rejected.append({
                    "entryId": entry.get("id"), "listKind": list_kind, "index": index,
                    "rawMention": str(raw or ""), "surface": verdict["surface"],
                    "code": REJECTION_CODES["DUPLICATE"],
                    "detail": "Dieselbe Beziehung ist in diesem Eintrag bereits belegt; die Wiederholung erzeugt keine zweite Kante.",
                })
                continue
            seen.add(dedupe_key)
            accepted.append({
                "entryId": entry.get("id"), "listKind": list_kind, "index": index,
                "rawMention": str(raw or ""), "surface": verdict["surface"],
                "normalized": verdict["normalized"], "mentionClusterId": verdict["clusterId"],
                "subjectClusterId": teacher_cluster_id, "objectClusterId": student_cluster_id,
                "relationshipType": "teacher",
            })
    return {"accepted": accepted, "rejected": rejected}
