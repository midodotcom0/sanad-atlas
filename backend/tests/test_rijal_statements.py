"""P4.6: quellengebundene Lehrer-/Schuelerassertions."""

from __future__ import annotations

import unittest

from app.normalize import normalize_arabic
from app.rijal_statements import REJECTION_CODES, evaluate_mention, extract_rijal_statements


class RijalStatementTests(unittest.TestCase):
    def test_teacher_and_student_lists_both_point_from_teacher_to_student(self) -> None:
        entry = {
            "id": "entry-1",
            "nameSurfaceNormalizedHead": normalize_arabic("مالك بن أنس"),
            "entryText": "روى عن نافع، وروى عنه الشافعي",
            "teacherMentions": ["نافع"],
            "studentMentions": ["الشافعي"],
        }
        result = extract_rijal_statements(entry)

        self.assertEqual([], result["rejected"])
        self.assertEqual(2, len(result["accepted"]))
        self.assertEqual(result["accepted"][0]["objectClusterId"], result["accepted"][1]["subjectClusterId"])
        self.assertTrue(all(item["relationshipType"] == "teacher" for item in result["accepted"]))
        self.assertTrue(all(item["surface"] in entry["entryText"] for item in result["accepted"]))

    def test_false_positive_sentence_and_multi_person_forms_are_reviewed(self) -> None:
        cases = (
            "البخاري ومسلم والنسايي وابن ماجه والمحاملي وابن عياش",
            "هو اكبر منه",
            "ق] بن عرزب الشامي",
            "حماد بن سلمه ومالك",
            "عن ابن عجلان",
            "محمد بن يحيى خ م د",
            "نافع عن ابن عمر في التوديع عند السفر",
        )
        for surface in cases:
            with self.subTest(surface=surface):
                verdict = evaluate_mention(surface, 0, f"قال {surface}")
                self.assertFalse(verdict["ok"])
                self.assertEqual(REJECTION_CODES["UNSEGMENTED_PHRASE"], verdict["code"])

    def test_missing_passage_and_relative_form_never_create_edges(self) -> None:
        missing = evaluate_mention("نافع", 0, "")
        relative = evaluate_mention("ابنا ابي شيبه", 0, "ذكر ابنا ابي شيبه")

        self.assertEqual(REJECTION_CODES["ENTRY_TEXT_MISSING"], missing["code"])
        self.assertEqual(REJECTION_CODES["RELATIVE_FORM"], relative["code"])


if __name__ == "__main__":
    unittest.main()
