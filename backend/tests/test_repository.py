import json
import tempfile
import unittest
from pathlib import Path

from app.repository import CorpusRepository, normalize_arabic


class CorpusRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        directory = Path(self.temp.name)
        payload = {
            "records": [
                {
                    "id": "bukhari-1-1-0",
                    "collection": "bukhari",
                    "hadithNumber": 1,
                    "routeNumber": 1,
                    "book": "بدء الوحي",
                    "chapter": "كيف كان بدء الوحي",
                    "volume": 1,
                    "printedPage": 3,
                    "sourcePageId": 4,
                    "isnad": "حدثنا الحميدي عن سفيان",
                    "matn": "إنما الأعمال بالنيات",
                    "narratorSurfaceForms": ["الحميدي", "سفيان"],
                    "chains": [{"chainOrder": 0, "rawIsnad": "حدثنا الحميدي عن سفيان", "narratorOccurrences": [{"position": 0, "rawSurfaceForm": "الحميدي", "normalizedSurfaceForm": "الحميدي", "identityStatus": "unresolved"}, {"position": 1, "rawSurfaceForm": "سفيان", "normalizedSurfaceForm": "سفيان", "identityStatus": "unresolved"}]}],
                    "matnFingerprint": "abc",
                    "parser": {"confidence": 0.73, "reviewStatus": "unreviewed", "state": "heuristically-parsed"},
                    "source": {"url": "https://example.test/1", "rightsStatus": "review-required"},
                }
            ]
        }
        (directory / "bukhari.json").write_text(json.dumps(payload), encoding="utf-8")
        (directory / "muslim.json").write_text(json.dumps({"records": []}), encoding="utf-8")
        (directory / "tahdhib.json").write_text(json.dumps({"entries": [{
            "id": "tahdhib-1-2", "entryNumber": 1, "nameSurface": "يحيى بن سعيد", "text": "يحيى بن سعيد روى عن أنس وعنه مالك", "deathYearCandidate": 143,
            "teacherPhrase": "أنس", "studentPhrase": "مالك", "volume": 1, "printedPage": 2, "sourcePageId": 3,
            "parser": {"confidence": 0.55, "reviewStatus": "unreviewed"}, "source": {"url": "https://example.test/tahdhib/3", "rightsStatus": "review-required"}
        }]}), encoding="utf-8")
        self.repo = CorpusRepository(directory)

    def tearDown(self):
        self.temp.cleanup()

    def test_search_ignores_arabic_diacritics(self):
        result = self.repo.hadiths(collection="bukhari", query="إِنَّمَا", cursor=None, limit=20)
        self.assertEqual(len(result["data"]["items"]), 1)
        self.assertEqual(normalize_arabic("يَحْيَى"), normalize_arabic("يحيي"))

    def test_every_response_has_required_research_metadata(self):
        result = self.repo.hadith("bukhari-1-1-0")
        self.assertIsNotNone(result)
        for key in ("sourceReferences", "confidence", "reviewStatus", "dataVersion", "lastReviewedAt"):
            self.assertIn(key, result)

    def test_chain_positions_reconstruct_the_imported_order(self):
        result = self.repo.chains("bukhari-1-1-0")
        occurrences = result["data"]["items"][0]["narratorOccurrences"]
        self.assertEqual([item["position"] for item in occurrences], [0, 1])
        self.assertTrue(all(item["identityStatus"] == "unresolved" for item in occurrences))

    def test_cluster_routes_are_bounded_and_source_bound(self):
        result = self.repo.routes("HCL-abc")
        self.assertEqual(result["data"]["recordCount"], 1)
        self.assertEqual(result["data"]["edges"][0]["evidenceKind"], "isnad_occurrence")
        self.assertTrue(result["sourceReferences"])

    def test_rijal_entries_are_searchable_without_publishing_full_edition_text(self):
        result = self.repo.rijal_entries(source="tahdhib", query="يحيى", cursor=None, limit=20)
        self.assertEqual(len(result["data"]["items"]), 1)
        self.assertNotIn("text", result["data"]["items"][0])
        self.assertEqual(result["data"]["items"][0]["identityStatus"], "unresolved")

    def test_identity_candidates_are_ranked_but_never_merged(self):
        result = self.repo.rijal_candidates(query="يحيى بن سعيد", limit=10)
        self.assertEqual(len(result["data"]["items"]), 1)
        candidate = result["data"]["items"][0]
        self.assertEqual(candidate["matchKind"], "exact_name")
        self.assertEqual(candidate["identityStatus"], "unresolved")
        self.assertNotIn("text", candidate)
        self.assertTrue(result["sourceReferences"])


if __name__ == "__main__":
    unittest.main()
