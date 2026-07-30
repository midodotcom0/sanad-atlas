"""Bitgleicher Python-Port der kanonischen arabischen Normalisierung.

Einzige fachliche Definition: ``lib/search.ts`` (``normalizeSearchText``).
Diese Datei ist ein Port, keine zweite Definition. Weicht sie ab, ist sie falsch.

Nachweis der Gleichheit:
  * ``public/data/corpus/normalize-fixture.json`` wird vom Importer
    (``scripts/import-turath-corpus.mjs``) aus echten Namensformen des Korpus erzeugt.
  * ``tests/normalize-parity-python.py`` vergleicht diese Datei gegen die Fixture.
  * ``tests/normalize-parity.test.ts`` vergleicht ``lib/search.ts`` gegen dieselbe Fixture.

Schritte (Reihenfolge ist Teil des Vertrags):
  1. NFKD
  2. Kombinationszeichen entfernen (Unicode-Kategorie M*, entspricht ``\\p{M}``)
  3. Tatwil entfernen
  4. أ إ آ ٱ -> ا
  5. ى -> ي
  6. ة -> ه
  7. ؤ -> و
  8. ئ -> ي
  9. ibn / bin -> b (lateinische Transliteration, wortgebunden, case-insensitiv)
 10. Whitespace vereinheitlichen, trimmen, kleinschreiben

Schritt 10 benutzt eine explizite Whitespace-Klasse, weil ``\\s`` in Python und
JavaScript unterschiedliche Zeichenmengen abdeckt.
"""

from __future__ import annotations

import re
import unicodedata

#: Version des Normalisierungsvertrags. Muss zu ``NORMALIZER_VERSION`` in ``lib/search.ts`` passen.
NORMALIZER_VERSION = "sanad-normalize-1.0.0"

#: Whitespace-Klasse, identisch zu ``NORMALIZE_WHITESPACE_CLASS`` in ``lib/search.ts``.
NORMALIZE_WHITESPACE_CLASS = (
    "\\t\\n\\u000b\\f\\r\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a"
    "\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff"
)

_WHITESPACE_RUN = re.compile("[" + NORMALIZE_WHITESPACE_CLASS + "]+")
_WHITESPACE_EDGE = re.compile(
    "^[" + NORMALIZE_WHITESPACE_CLASS + "]+|[" + NORMALIZE_WHITESPACE_CLASS + "]+$"
)
_TATWEEL = re.compile("ـ")
_ALEF = re.compile("[أإآٱ]")
_ALEF_MAKSURA = re.compile("ى")
_TEH_MARBUTA = re.compile("ة")
_WAW_HAMZA = re.compile("ؤ")
_YEH_HAMZA = re.compile("ئ")
# ``\b`` verhält sich in Python und JavaScript für ASCII-Wortgrenzen identisch.
_IBN = re.compile(r"\b(?:ibn|bin)\b", re.IGNORECASE)


def _strip_combining(value: str) -> str:
    """Entfernt alle Zeichen der Unicode-Kategorie M* — Äquivalent zu ``\\p{M}`` in JS."""
    return "".join(ch for ch in value if unicodedata.category(ch)[0] != "M")


def normalize_search_text(value: str | None) -> str:
    """Kanonische Suchform. Erzeugt NIE eine geprüfte Aussage, nur einen Suchschlüssel."""
    text = unicodedata.normalize("NFKD", "" if value is None else str(value))
    text = _strip_combining(text)
    text = _TATWEEL.sub("", text)
    text = _ALEF.sub("ا", text)
    text = _ALEF_MAKSURA.sub("ي", text)
    text = _TEH_MARBUTA.sub("ه", text)
    text = _WAW_HAMZA.sub("و", text)
    text = _YEH_HAMZA.sub("ي", text)
    text = _IBN.sub("b", text)
    text = _WHITESPACE_RUN.sub(" ", text)
    text = _WHITESPACE_EDGE.sub("", text)
    return text.lower()


#: Alias, damit bestehender Backend-Code ohne Umbenennung auf den Port umstellen kann.
normalize_arabic = normalize_search_text

__all__ = [
    "NORMALIZER_VERSION",
    "NORMALIZE_WHITESPACE_CLASS",
    "normalize_search_text",
    "normalize_arabic",
]
