import json
import tempfile
import unittest
from pathlib import Path

from app.repository import (
    CONFIDENCE_LEVELS,
    CorpusRepository,
    aggregate_machine_confidence,
    bucket_id,
    envelope,
    is_relative_reference,
    level_from_score,
    normalize_arabic,
)


REQUIRED_ENVELOPE_KEYS = (
    "sourceReferences",
    "confidenceLevel",
    "confidenceScore",
    "origin",
    "reviewStatus",
    "dataVersion",
    "lastReviewedAt",
)


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
                },
                {
                    # Second chain: enables isnad_occurrence relation tests and
                    # deliberately includes a relative back-reference ("أبيه")
                    # so the narrator index's non-merging guard is exercised
                    # against real corpus wiring, not just the bare helper.
                    "id": "bukhari-2-5-0",
                    "collection": "bukhari",
                    "hadithNumber": 5,
                    "routeNumber": 1,
                    "book": "كتاب آخر",
                    "chapter": "باب آخر",
                    "volume": 1,
                    "printedPage": 9,
                    "sourcePageId": 10,
                    "isnad": "حدثنا فلان عن يحيى بن سعيد عن أبيه",
                    "matn": "نص آخر",
                    "narratorSurfaceForms": ["فلان", "يحيى بن سعيد", "أبيه"],
                    "chains": [{"chainOrder": 0, "rawIsnad": "حدثنا فلان عن يحيى بن سعيد عن أبيه", "narratorOccurrences": [
                        {"position": 0, "rawSurfaceForm": "فلان", "normalizedSurfaceForm": "فلان", "identityStatus": "unresolved"},
                        # normalizedSurfaceForm deliberately left byte-identical to
                        # rawSurfaceForm (alif maksura, hamza left as-is): this is the
                        # realistic shape of 90% of the real corpus (Befund B3 --
                        # "normalized" is frequently not actually normalized). The
                        # repository must canonicalize defensively, not trust this field.
                        {"position": 1, "rawSurfaceForm": "يحيى بن سعيد", "normalizedSurfaceForm": "يحيى بن سعيد", "identityStatus": "unresolved"},
                        {"position": 2, "rawSurfaceForm": "أبيه", "normalizedSurfaceForm": "أبيه", "identityStatus": "unresolved"},
                    ]}],
                    "matnFingerprint": "xyz",
                    "parser": {"confidence": 0.58, "reviewStatus": "unreviewed", "state": "heuristically-parsed"},
                    "source": {"url": "https://example.test/2", "rightsStatus": "review-required"},
                },
                {
                    # A second, unrelated chain that also surfaces "أبيه" --
                    # used to prove it never gets merged with the occurrence above.
                    "id": "bukhari-3-9-0",
                    "collection": "bukhari",
                    "hadithNumber": 9,
                    "routeNumber": 1,
                    "book": "كتاب ثالث",
                    "chapter": "باب ثالث",
                    "volume": 1,
                    "printedPage": 20,
                    "sourcePageId": 21,
                    "isnad": "حدثنا فلانة عن أبيه",
                    "matn": "نص ثالث",
                    "narratorSurfaceForms": ["فلانة", "أبيه"],
                    "chains": [{"chainOrder": 0, "rawIsnad": "حدثنا فلانة عن أبيه", "narratorOccurrences": [
                        {"position": 0, "rawSurfaceForm": "فلانة", "normalizedSurfaceForm": "فلانة", "identityStatus": "unresolved"},
                        {"position": 1, "rawSurfaceForm": "أبيه", "normalizedSurfaceForm": "أبيه", "identityStatus": "unresolved"},
                    ]}],
                    "matnFingerprint": "qrs",
                    "parser": {"confidence": 0.42, "reviewStatus": "unreviewed", "state": "heuristically-parsed"},
                    "source": {"url": "https://example.test/3", "rightsStatus": "review-required"},
                },
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
        self.directory = directory

    def tearDown(self):
        self.temp.cleanup()

    def _yahya_id(self):
        return bucket_id("bukhari-2-5-0", 0, 1, normalize_arabic("يحيى بن سعيد"))

    def _falan_id(self):
        return bucket_id("bukhari-2-5-0", 0, 0, normalize_arabic("فلان"))

    # -- pre-existing behaviour ------------------------------------------------

    def test_search_ignores_arabic_diacritics(self):
        result = self.repo.hadiths(collection="bukhari", query="إِنَّمَا", cursor=None, limit=20)
        self.assertEqual(len(result["data"]["items"]), 1)
        self.assertEqual(normalize_arabic("يَحْيَى"), normalize_arabic("يحيي"))

    def test_chain_positions_reconstruct_the_imported_order(self):
        result = self.repo.chains("bukhari-1-1-0")
        occurrences = result["data"]["items"][0]["narratorOccurrences"]
        self.assertEqual([item["position"] for item in occurrences], [0, 1])
        self.assertTrue(all(item["identityStatus"] == "unresolved" for item in occurrences))

    def test_cluster_routes_are_bounded_and_source_bound(self):
        result = self.repo.routes("HCL-abc")
        self.assertEqual(result["data"]["recordCount"], 1)
        self.assertEqual(result["data"]["edges"][0]["evidenceKind"], "isnad_link")
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

    # -- P2.2: response envelope contract ---------------------------------------

    def test_every_response_has_required_research_metadata(self):
        result = self.repo.hadith("bukhari-1-1-0")
        self.assertIsNotNone(result)
        for key in REQUIRED_ENVELOPE_KEYS:
            self.assertIn(key, result)
        self.assertIn(result["confidenceLevel"], CONFIDENCE_LEVELS)
        self.assertIn(result["reviewStatus"], CONFIDENCE_LEVELS)
        self.assertIn(result["origin"], ("machine", "editorial", "registry"))

    def test_envelope_contract_holds_across_every_endpoint(self):
        """Schema-Test über alle Endpunkte (Umsetzungsplan P2.2 Abnahme)."""
        yahya = self._yahya_id()
        falan = self._falan_id()
        envelopes = [
            self.repo.hadiths(collection=None, query="", cursor=None, limit=10),
            self.repo.hadith("bukhari-1-1-0"),
            self.repo.chains("bukhari-1-1-0"),
            self.repo.routes("HCL-abc"),
            self.repo.matn_variants("HCL-abc"),
            self.repo.rijal_entries(source="tahdhib", query="", cursor=None, limit=10),
            self.repo.rijal_entry("tahdhib-1-2"),
            self.repo.rijal_candidates(query="يحيى", limit=10),
            self.repo.narrator_profile(yahya),
            self.repo.narrator_relations(yahya, cursor=None, limit=10),
            self.repo.narrator_timeline(yahya),
            self.repo.compare_narrators(yahya, falan),
            self.repo.compare_chronology(yahya, falan),
            self.repo.source_list(),
            self.repo.sources("bukhari"),
        ]
        for result in envelopes:
            self.assertIsNotNone(result)
            for key in REQUIRED_ENVELOPE_KEYS:
                self.assertIn(key, result)
            self.assertIn(result["confidenceLevel"], CONFIDENCE_LEVELS)
            self.assertIn(result["reviewStatus"], CONFIDENCE_LEVELS)
            self.assertIn(result["origin"], ("machine", "editorial", "registry"))
            self.assertTrue(result["sourceReferences"], "sourceReferences darf nie leer sein")
            if result["origin"] != "machine":
                self.assertIsNone(result["confidenceScore"])
            if result["confidenceScore"] is not None:
                self.assertGreaterEqual(result["confidenceScore"], 0.0)
                self.assertLessEqual(result["confidenceScore"], 1.0)

    def test_machine_origin_never_reports_verified(self):
        with self.assertRaises(ValueError):
            envelope({}, [{"x": 1}], confidence_level="verified", origin="machine")

    def test_level_from_score_thresholds(self):
        self.assertEqual(level_from_score(0.95), "high")
        self.assertEqual(level_from_score(0.90), "high")
        self.assertEqual(level_from_score(0.89), "medium")
        self.assertEqual(level_from_score(0.70), "medium")
        self.assertEqual(level_from_score(0.69), "low")
        self.assertEqual(level_from_score(None), "unresolved")
        self.assertNotEqual(level_from_score(0.999999), "verified")

    def test_aggregate_machine_confidence_uses_the_weakest_signal(self):
        level, score = aggregate_machine_confidence([0.95, 0.73, 0.25])
        self.assertEqual(score, 0.25)
        self.assertEqual(level, "low")
        self.assertEqual(aggregate_machine_confidence([]), ("unresolved", None))

    # -- P2.4: licence gate -------------------------------------------------------

    def test_license_gate_withholds_full_text_when_rights_are_not_cleared(self):
        """RED-Test: muss fehlschlagen, sobald ein Volltext ohne Rechte-Freigabe
        ausgeliefert wird (Umsetzungsplan P2.4)."""
        listed = self.repo.hadiths(collection="bukhari", query="", cursor=None, limit=20)
        item = listed["data"]["items"][0]
        self.assertNotIn("isnad", item)
        self.assertNotIn("matn", item)
        self.assertTrue(item["textWithheld"])

        single = self.repo.hadith("bukhari-1-1-0")
        self.assertNotIn("isnad", single["data"])
        self.assertNotIn("matn", single["data"])

        chain = self.repo.chains("bukhari-1-1-0")
        self.assertNotIn("rawIsnad", chain["data"]["items"][0])

    def test_license_gate_releases_full_text_once_rights_are_cleared(self):
        """Proves the gate is a real conditional, not a hardcoded False: an
        editor flipping rightsStatus in the registry is enough to release text,
        without any code change."""
        repo = CorpusRepository(self.directory)
        for source in repo.registry["sources"]:
            if source["key"] == "bukhari":
                source["rightsStatus"] = "cleared"
        result = repo.hadiths(collection="bukhari", query="", cursor=None, limit=20)
        item = result["data"]["items"][0]
        self.assertIn("isnad", item)
        self.assertIn("matn", item)
        self.assertFalse(item["textWithheld"])

    def test_license_gate_hides_fields_missing_from_public_derived_fields_allowlist(self):
        """taqrib's manifest entry omits "teacher_student_phrases" from
        publicDerivedFields -- the allowlist must be read, not just the
        rights status (Befund B5: 0 Treffer beim Lesen der Allowlist)."""
        (self.directory / "taqrib.json").write_text(json.dumps({"entries": [{
            "id": "taqrib-1-1", "entryNumber": 1, "nameSurface": "احمد", "text": "نص كامل",
            "deathYearCandidate": 200, "teacherPhrase": "فلان", "studentPhrase": "فلان الآخر",
            "volume": 1, "printedPage": 1, "sourcePageId": 1,
            "parser": {"confidence": 0.55, "reviewStatus": "unreviewed"},
            "source": {"url": "https://example.test/taqrib/1", "rightsStatus": "review-required"},
        }]}), encoding="utf-8")
        repo = CorpusRepository(self.directory)
        result = repo.rijal_entries(source="taqrib", query="", cursor=None, limit=20)
        item = result["data"]["items"][0]
        self.assertIsNone(item["teacherPhrase"])
        self.assertIsNone(item["studentPhrase"])
        self.assertTrue(item["textWithheld"])
        # entry_number/name_surface/date_assertions/source_pointer ARE in
        # taqrib's allowlist, so those stay populated.
        self.assertIsNotNone(item["nameSurface"])
        self.assertEqual(item["deathYearCandidate"], 200)

    # -- relative back-references never resolved globally ------------------------

    def test_relative_reference_forms_are_never_merged_globally(self):
        first = bucket_id("bukhari-2-5-0", 0, 2, normalize_arabic("أبيه"))
        second = bucket_id("bukhari-3-9-0", 0, 1, normalize_arabic("أبيه"))
        self.assertTrue(is_relative_reference(normalize_arabic("أبيه")))
        self.assertNotEqual(first, second, "zwei verschiedene أبيه-Vorkommen dürfen nie dieselbe Bucket-ID erhalten")
        self.assertTrue(first.startswith("UNC-REL-"))
        self.assertTrue(second.startswith("UNC-REL-"))
        # deterministic / stable for the same occurrence
        self.assertEqual(first, bucket_id("bukhari-2-5-0", 0, 2, normalize_arabic("أبيه")))

    def test_ordinary_names_keep_the_corpus_wide_bucket_scheme(self):
        self.assertFalse(is_relative_reference(normalize_arabic("يحيى بن سعيد")))
        first = bucket_id("bukhari-1-1-0", 0, 0, normalize_arabic("سفيان"))
        second = bucket_id("bukhari-9-9-9", 3, 7, normalize_arabic("سفيان"))
        self.assertEqual(first, second)
        self.assertTrue(first.startswith("UNC-"))
        self.assertFalse(first.startswith("UNC-REL-"))

    # -- P2.2: narrator endpoints, implemented against real derived data ---------

    def test_narrator_profile_resolves_a_real_occurrence_cluster(self):
        result = self.repo.narrator_profile(self._yahya_id())
        self.assertIsNotNone(result)
        self.assertEqual(result["data"]["identityStatus"], "unresolved")
        self.assertEqual(result["data"]["occurrenceCount"], 1)
        self.assertIn("يحيى بن سعيد", result["data"]["rawSurfaceForms"])
        self.assertEqual(result["data"]["rijalCandidates"][0]["matchKind"], "exact_name")
        self.assertTrue(result["sourceReferences"])

    def test_narrator_profile_returns_none_for_an_unknown_id(self):
        self.assertIsNone(self.repo.narrator_profile("UNC-doesnotexist0000"))

    def test_narrator_relations_uses_isnad_adjacency_only(self):
        result = self.repo.narrator_relations(self._yahya_id(), cursor=None, limit=50)
        items = result["data"]["items"]
        self.assertEqual(len(items), 2)
        kinds = {item["relationshipType"] for item in items}
        self.assertEqual(kinds, {"transmitted_from", "transmitted_to"})
        for item in items:
            self.assertEqual(item["evidenceKind"], "isnad_link")
            self.assertIn("chainId", item)
            self.assertIn("position", item)
            self.assertIsNone(item["spanStart"])
            self.assertIsNone(item["spanEnd"])
        # the relative-reference neighbour must carry the chain-local id scheme
        related_ids = {item["relatedNarratorId"] for item in items}
        self.assertTrue(any(rid.startswith("UNC-REL-") for rid in related_ids))

    def test_narrator_relations_unknown_id_is_honest_not_invented(self):
        result = self.repo.narrator_relations("UNC-doesnotexist0000", cursor=None, limit=50)
        self.assertEqual(result["data"]["items"], [])
        self.assertEqual(result["confidenceLevel"], "unresolved")
        self.assertTrue(result["sourceReferences"])

    def test_narrator_timeline_finds_a_real_death_year_and_never_averages(self):
        result = self.repo.narrator_timeline(self._yahya_id())
        self.assertIsNotNone(result)
        assertions = result["data"]["dateAssertions"]
        self.assertEqual(len(assertions), 1)
        self.assertEqual(assertions[0]["event"], "death")
        self.assertEqual(assertions[0]["yearMin"], 143)
        self.assertEqual(assertions[0]["yearMax"], 143)

    def test_narrator_timeline_is_honest_about_missing_dates(self):
        result = self.repo.narrator_timeline(self._falan_id())
        self.assertEqual(result["data"]["dateAssertions"], [])
        self.assertIsNotNone(result["data"]["note"])
        self.assertEqual(result["confidenceLevel"], "unresolved")

    def test_chronology_compare_never_estimates_a_missing_birth_year(self):
        result = self.repo.compare_chronology(self._yahya_id(), self._falan_id())
        self.assertEqual(result["data"]["result"], "insufficient")
        self.assertIsNotNone(result["data"]["reason"])
        self.assertIn(result["data"]["result"], ("possible", "impossible", "insufficient"))

    def test_narrators_compare_reports_isnad_meeting_evidence_separately_from_chronology(self):
        """A direct isnad adjacency can prove a meeting was asserted even
        while chronology stays insufficient -- the two evidence classes must
        never be conflated (Abschnitt 8)."""
        result = self.repo.compare_narrators(self._yahya_id(), self._falan_id())
        self.assertEqual(result["data"]["chronology"], "insufficient")
        self.assertEqual(result["data"]["meeting"], "asserted_isnad")
        self.assertTrue(result["data"]["meetingEvidence"])

    def test_compare_endpoints_answer_only_with_the_three_allowed_results(self):
        for result in (
            self.repo.compare_chronology("UNC-unknown-a", "UNC-unknown-b"),
            self.repo.compare_chronology(self._yahya_id(), self._falan_id()),
        ):
            self.assertIn(result["data"]["result"], ("possible", "impossible", "insufficient"))


if __name__ == "__main__":
    unittest.main()
