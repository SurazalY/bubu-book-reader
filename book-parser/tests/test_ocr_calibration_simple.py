import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import fitz


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))

import ocr_calibration_simple as calibration  # noqa: E402


class OcrCalibrationSimpleTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def write_image(self, page_no=1, content=b"synthetic page image"):
        image_path = self.root / "images" / f"page-{page_no:04d}.png"
        image_path.parent.mkdir(parents=True, exist_ok=True)
        image_path.write_bytes(content)
        return image_path, hashlib.sha256(content).hexdigest()

    def test_exports_one_allowed_page_from_the_frozen_pdf_contract(self):
        source_pdf = self.root / "source.pdf"
        document = fitz.open()
        for _ in range(calibration.FROZEN_PAGE_COUNT):
            document.new_page(width=72, height=72)
        document.save(source_pdf)
        document.close()
        source_sha256 = calibration.sha256_file(source_pdf)

        with mock.patch.object(calibration, "FROZEN_PDF_SHA256", source_sha256):
            binding = calibration.export_page(source_pdf, 1, self.root, dpi=72)
            existing_binding = calibration.export_page(source_pdf, 1, self.root, dpi=72)

        image_path = self.root / binding["imagePath"]
        self.assertTrue(image_path.is_file())
        self.assertEqual(binding["pageNo"], 1)
        self.assertEqual(binding["imageSha256"], calibration.sha256_file(image_path))
        self.assertEqual(existing_binding, binding)

    def test_rejects_existing_image_that_differs_from_fresh_render_without_overwriting(self):
        source_pdf = self.root / "source.pdf"
        document = fitz.open()
        for _ in range(calibration.FROZEN_PAGE_COUNT):
            document.new_page(width=72, height=72)
        document.save(source_pdf)
        document.close()
        source_sha256 = calibration.sha256_file(source_pdf)
        image_path, _ = self.write_image(content=b"wrong existing image")

        with mock.patch.object(calibration, "FROZEN_PDF_SHA256", source_sha256):
            with self.assertRaisesRegex(ValueError, "does not match freshly rendered PDF bytes"):
                calibration.export_page(source_pdf, 1, self.root, dpi=72)

        self.assertEqual(image_path.read_bytes(), b"wrong existing image")

    def test_rejects_page_outside_calibration_set_before_opening_pdf(self):
        with mock.patch.object(calibration.fitz, "open") as fitz_open:
            with self.assertRaisesRegex(ValueError, "not in the book-025 calibration set"):
                calibration.export_page(self.root / "missing.pdf", 2, self.root)
        fitz_open.assert_not_called()

    def test_saves_self_test_with_deterministic_text_hash_and_isolated_path(self):
        _, image_sha256 = self.write_image()
        result_path, result = calibration.save_result(
            work_root=self.root,
            page_no=1,
            expected_image_sha256=image_sha256,
            paragraphs=["第一段", "第二段"],
            model="gpt-5.6-sol",
            task_id="self-test-task",
            kind="pipeline-self-test",
        )

        self.assertEqual(result_path, self.root / "self-test" / "page-0001.json")
        self.assertFalse((self.root / "formal").exists())
        self.assertEqual(result["textSha256"], calibration.sha256_text("第一段\n\n第二段"))
        self.assertEqual(json.loads(result_path.read_text(encoding="utf-8")), result)

    def test_rejects_actual_image_hash_mismatch(self):
        self.write_image()
        with self.assertRaisesRegex(ValueError, "image SHA-256 mismatch"):
            calibration.save_result(
                work_root=self.root,
                page_no=1,
                expected_image_sha256="0" * 64,
                paragraphs=["文本"],
                model="gpt-5.6-luna",
                task_id="task",
                kind="formal-luna",
            )
        self.assertFalse((self.root / "formal").exists())

    def test_rejects_kind_and_model_mismatch(self):
        _, image_sha256 = self.write_image()
        mismatches = [
            ("pipeline-self-test", "gpt-5.6-luna"),
            ("formal-luna", "gpt-5.6-sol"),
        ]
        for kind, model in mismatches:
            with self.subTest(kind=kind, model=model):
                with self.assertRaisesRegex(ValueError, "requires model"):
                    calibration.save_result(
                        work_root=self.root,
                        page_no=1,
                        expected_image_sha256=image_sha256,
                        paragraphs=["文本"],
                        model=model,
                        task_id="task",
                        kind=kind,
                    )

    def test_rejects_empty_text(self):
        _, image_sha256 = self.write_image()
        with self.assertRaisesRegex(ValueError, r"paragraphs\[0\] must be a non-empty string"):
            calibration.save_result(
                work_root=self.root,
                page_no=1,
                expected_image_sha256=image_sha256,
                paragraphs=["  "],
                model="gpt-5.6-luna",
                task_id="task",
                kind="formal-luna",
            )
        self.assertFalse((self.root / "formal").exists())

    def test_rejects_existing_formal_result_without_overwriting(self):
        _, image_sha256 = self.write_image()
        result_path = self.root / "formal" / "page-0001.json"
        result_path.parent.mkdir(parents=True)
        result_path.write_text("existing\n", encoding="utf-8")

        with self.assertRaisesRegex(FileExistsError, "target result already exists"):
            calibration.save_result(
                work_root=self.root,
                page_no=1,
                expected_image_sha256=image_sha256,
                paragraphs=["文本"],
                model="gpt-5.6-luna",
                task_id="task",
                kind="formal-luna",
            )
        self.assertEqual(result_path.read_text(encoding="utf-8"), "existing\n")

    def test_saves_gemini_low_result_in_isolated_directory(self):
        _, image_sha256 = self.write_image()
        result_path, result = calibration.save_result(
            work_root=self.root,
            page_no=1,
            expected_image_sha256=image_sha256,
            paragraphs=["第一段", "第二段"],
            model="gemini-3.7-flash-low",
            task_id="gemini-conversation",
            kind="formal-gemini-low",
        )

        self.assertEqual(result_path, self.root / "gemini-low" / "formal" / "page-0001.json")
        self.assertEqual(result["kind"], "formal-gemini-low")
        self.assertFalse((self.root / "formal").exists())

    def test_validates_gemini_direct_ocr_shape(self):
        self.assertEqual(
            calibration._validate_direct_ocr_output({"paragraphs": ["第一段"]}),
            ["第一段"],
        )
        invalid_values = [
            {},
            {"paragraphs": []},
            {"paragraphs": ["  "]},
            {"paragraphs": ["文本"], "extra": True},
        ]
        for value in invalid_values:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    calibration._validate_direct_ocr_output(value)

    def test_gemini_failure_paths_never_overwrite_prior_attempts(self):
        first = calibration._next_gemini_failure_path(self.root, 40)
        self.assertEqual(first.name, "page-0040-attempt-01.json")
        first.parent.mkdir(parents=True)
        first.write_text("{}\n", encoding="utf-8")
        second = calibration._next_gemini_failure_path(self.root, 40)
        self.assertEqual(second.name, "page-0040-attempt-02.json")


if __name__ == "__main__":
    unittest.main()
