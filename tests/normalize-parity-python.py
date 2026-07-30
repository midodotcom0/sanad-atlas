"""Property-Test für P1.2, Python-Seite.

Vergleicht ``backend/app/normalize.py`` gegen dieselbe Fixture, die
``tests/normalize-parity.test.ts`` gegen ``lib/search.ts`` prüft. Sind beide grün, ist
die Normalisierung in Importer, TypeScript und Python bitgleich.

Ausführen:
    PYTHONPATH=backend python3 tests/normalize-parity-python.py

Die Datei liegt bewusst nicht unter ``backend/tests`` (fremdes Arbeitspaket) und trägt den
Präfix ``normalize-``; deshalb wird sie direkt aufgerufen und nicht per unittest-Discovery
gefunden (Bindestriche sind keine gültigen Modulnamen).
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.normalize import NORMALIZER_VERSION, normalize_search_text  # noqa: E402

FIXTURE_PATH = ROOT / "tests" / "normalize-fixture.json"


class NormalizeParityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

    def test_fixture_covers_at_least_200_corpus_forms(self) -> None:
        self.assertGreaterEqual(len(self.fixture["samples"]), 200)
        self.assertEqual(self.fixture["normalizerVersion"], NORMALIZER_VERSION)

    def test_python_port_matches_importer_output_bit_for_bit(self) -> None:
        divergent = [
            sample["raw"]
            for sample in self.fixture["samples"]
            if normalize_search_text(sample["raw"]) != sample["normalized"]
        ]
        self.assertEqual(divergent, [])

    def test_normalization_is_idempotent(self) -> None:
        for sample in self.fixture["samples"]:
            self.assertEqual(normalize_search_text(sample["normalized"]), sample["normalized"])

    def test_contract_character_rules(self) -> None:
        self.assertEqual(normalize_search_text("يَحْيَى"), normalize_search_text("يحيي"))
        self.assertEqual(normalize_search_text("أإآٱ"), "اااا")
        self.assertEqual(normalize_search_text("ى"), "ي")
        self.assertEqual(normalize_search_text("ة"), "ه")
        self.assertEqual(normalize_search_text("ؤ"), "و")
        self.assertEqual(normalize_search_text("ئ"), "ي")
        self.assertEqual(normalize_search_text("مـــحمد"), "محمد")
        self.assertIn("yahya", normalize_search_text("Yaḥyā ibn Saʿīd"))
        self.assertIn(" b ", normalize_search_text("Yaḥyā ibn Saʿīd"))
        self.assertIn(" b ", normalize_search_text("Malik BIN Anas"))

    def test_whitespace_and_locale_independence(self) -> None:
        self.assertEqual(normalize_search_text("Ibrahim"), "ibrahim")
        self.assertEqual(normalize_search_text(" مالك بن　أنس﻿"), "مالك بن انس")
        self.assertEqual(normalize_search_text(None), "")


if __name__ == "__main__":
    unittest.main(verbosity=2)
