import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))

from book_package_v2 import (  # noqa: E402
    NORMALIZATION_VERSION,
    automatic_quality,
    normalize_corrections,
    normalize_ocr_page,
    sha256_text,
    validate_corrections_applied,
)
from generate_qc_sample_v2 import stratified_sample  # noqa: E402
from build_book_package_v2 import validate_human_review  # noqa: E402


class BookPackageV2Test(unittest.TestCase):
    def page(self):
        return {
            "pageNo": 1,
            "status": "ok",
            "width": 100,
            "height": 200,
            "blocks": [
                {"order": 1, "text": "原文", "lineBBox": {"x": 1, "y": 2, "width": 30, "height": 10}, "bboxEstimated": True, "confidence": 0.99},
                {"order": 2, "text": "第二行", "lineBBox": {"x": 1, "y": 20, "width": 30, "height": 10}, "bboxEstimated": True, "confidence": 0.75},
            ],
        }

    def test_preserves_raw_text_and_applies_reviewed_normalization(self):
        ledger = {
            "schemaVersion": "ocr-corrections/v1",
            "bookId": "book-025",
            "normalizationVersion": NORMALIZATION_VERSION,
            "corrections": [{
                "pageNo": 1,
                "blockOrder": 1,
                "rawText": "原文",
                "rawSha256": sha256_text("原文"),
                "normalizedText": "正文",
                "reason": "人工核对 PDF",
                "reviewer": "reviewer",
                "reviewedAt": "2026-08-15T10:00:00+08:00",
            }],
        }
        corrections, canonical = normalize_corrections(ledger, "book-025")
        page = normalize_ocr_page(self.page(), 1, corrections)
        validate_corrections_applied(corrections, [page])
        self.assertEqual(page["rawText"], "原文第二行")
        self.assertEqual(page["normalizedText"], "正文第二行")
        self.assertEqual(page["blocks"][0]["blockId"], "p0001-b001")
        self.assertEqual(canonical["corrections"], ledger["corrections"])

    def test_rejects_geometry_outside_page_even_though_geometry_is_audit_only(self):
        page = self.page()
        page["blocks"][0]["lineBBox"]["width"] = 101
        with self.assertRaisesRegex(ValueError, "outside the page"):
            normalize_ocr_page(page, 1, {})

    def test_quality_flags_empty_pages_and_low_confidence_without_using_geometry(self):
        populated = normalize_ocr_page(self.page(), 1, {})
        empty = normalize_ocr_page({"pageNo": 2, "status": "ok", "width": 100, "height": 200, "blocks": []}, 2, {})
        quality = automatic_quality([populated, empty])
        self.assertEqual(quality["emptyPages"], [2])
        self.assertEqual(quality["lowConfidenceBlocks"][0]["blockId"], "p0001-b002")
        self.assertFalse(quality["runtimeDependsOnGeometry"])

    def test_rejects_unreviewed_correction_shape(self):
        with self.assertRaisesRegex(ValueError, "exactly"):
            normalize_corrections({
                "schemaVersion": "ocr-corrections/v1",
                "bookId": "book-025",
                "normalizationVersion": NORMALIZATION_VERSION,
                "corrections": [{"pageNo": 1, "blockOrder": 1, "normalizedText": "x"}],
            }, "book-025")

    def test_rejects_correction_with_wrong_raw_hash(self):
        with self.assertRaisesRegex(ValueError, "rawSha256"):
            normalize_corrections({
                "schemaVersion": "ocr-corrections/v1",
                "bookId": "book-025",
                "normalizationVersion": NORMALIZATION_VERSION,
                "corrections": [{
                    "pageNo": 1,
                    "blockOrder": 1,
                    "rawText": "原文",
                    "rawSha256": "0" * 64,
                    "normalizedText": "正文",
                    "reason": "人工核对 PDF",
                    "reviewer": "reviewer",
                    "reviewedAt": "2026-08-15T10:00:00+08:00",
                }],
            }, "book-025")

    def test_qc_sample_is_stratified_and_always_includes_required_pages(self):
        sample = stratified_sample(162, {7, 162})
        self.assertGreaterEqual(len(sample), 30)
        self.assertEqual(sample[0], 1)
        self.assertIn(7, sample)
        self.assertEqual(sample[-1], 162)

    def test_failed_human_review_requires_diagnostic_findings(self):
        review = {
            "schemaVersion": "book-package-human-review/v1",
            "bookId": "book-025",
            "status": "failed",
            "samplePages": list(range(1, 31)),
            "requiredReviewPages": [],
            "reviewer": "Codex visual inspection",
            "reviewedAt": "2026-08-15T20:00:00+08:00",
            "evidencePath": "book-parser/work/qc/book-025",
            "findings": [],
        }
        with self.assertRaisesRegex(ValueError, "at least one finding"):
            validate_human_review(review, "book-025", 162)


if __name__ == "__main__":
    unittest.main()
