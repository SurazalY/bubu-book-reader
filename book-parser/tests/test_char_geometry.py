from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

import fitz


BOOK_PARSER = Path(__file__).resolve().parents[1]
PIPELINE = BOOK_PARSER / "pipeline"
if str(PIPELINE) not in sys.path:
    sys.path.insert(0, str(PIPELINE))

import build_book_package  # noqa: E402
from calibrate_char_geometry import (  # noqa: E402
    CALIBRATION_METHOD,
    BOUNDARY_CORRECTION_KIND,
    CHAR_METHOD,
    GEOMETRY_TEXT_POLICY,
    GrayImage,
    SCHEMA_VERSION,
    calibrate_block,
    calibrate_page,
    insert_positioned_character,
    summarize_quality,
    validate_calibrated_page,
    validate_calibrated_document,
)


class SyntheticPage:
    def __init__(self, width: int = 420, height: int = 140):
        self.width = width
        self.height = height
        self.samples = bytearray([255]) * (width * height)

    def rect(self, x0: int, y0: int, x1: int, y1: int, value: int = 20) -> None:
        for y in range(y0, y1):
            for x in range(x0, x1):
                self.samples[y * self.width + x] = value

    def horizontal(self, x0: int, x1: int, y: int, value: int = 20) -> None:
        self.rect(x0, y, x1, y + 1, value)

    def image(self) -> GrayImage:
        return GrayImage(self.width, self.height, bytes(self.samples))


def pinyin_line(
    text: str = "小红，帽子",
    *,
    start: int = 105,
    pitch: int = 55,
    split_index: int | None = 1,
) -> tuple[SyntheticPage, list[int]]:
    page = SyntheticPage()
    centers = [start + index * pitch for index in range(len(text))]
    for index, center in enumerate(centers):
        if text[index] != "，":
            page.rect(center - 7, 31, center + 7, 41, 65)
        if text[index] == "，":
            page.rect(center + 6, 96, center + 11, 102)
        elif index == split_index:
            page.rect(center - 15, 69, center - 3, 104)
            page.rect(center + 4, 69, center + 15, 104)
        else:
            page.rect(center - 14, 69, center + 14, 104)
    return page, centers


def draw_synthetic_line(
    page: SyntheticPage,
    count: int,
    *,
    y: int,
    start: int = 70,
    pitch: int = 55,
    punctuation_indices: set[int] | None = None,
) -> list[int]:
    punctuation_indices = punctuation_indices or set()
    centers = [start + index * pitch for index in range(count)]
    for index, center in enumerate(centers):
        if index not in punctuation_indices:
            page.rect(center - 7, y + 12, center + 7, y + 22, 65)
            page.rect(center - 14, y + 50, center + 14, y + 85)
        else:
            page.rect(center + 6, y + 77, center + 11, y + 84)
    return centers


class CharacterGeometryTests(unittest.TestCase):
    def test_regular_pinyin_indent_punctuation_and_split_component(self) -> None:
        source, _ = pinyin_line()
        result = calibrate_block(source.image(), "小红，帽子", [20, 20, 400, 115])

        self.assertEqual(result["geometryStatus"], "ok")
        self.assertEqual("".join(item["text"] for item in result["chars"]), "小红，帽子")
        self.assertEqual(len(result["chars"]), len("小红，帽子"))
        self.assertGreater(result["chars"][0]["bbox"]["x"], 80, "real indentation must survive calibration")
        self.assertLess(result["chars"][2]["bbox"]["width"], result["chars"][1]["bbox"]["width"])
        self.assertTrue(all(item["method"] == CHAR_METHOD for item in result["chars"]))
        self.assertTrue(all(item["bbox"]["y"] >= 65 for item in result["chars"]), "pinyin must be excluded")
        pinyin_box = result["geometryMetrics"]["pinyinBandBbox"]
        self.assertIsNotNone(pinyin_box)
        self.assertLess(pinyin_box["y"] + pinyin_box["height"], result["chars"][0]["bbox"]["y"])
        self.assertGreater(result["geometryMetrics"]["connectedComponentCount"], len(result["chars"]))

    def test_merged_component_is_split_at_foreground_valley(self) -> None:
        source, centers = pinyin_line("天地人", start=115, pitch=65, split_index=None)
        source.horizontal(centers[0] + 14, centers[1] - 14, 86)

        result = calibrate_block(source.image(), "天地人", [20, 20, 400, 115])

        self.assertEqual(result["geometryStatus"], "ok")
        self.assertEqual(len(result["chars"]), 3)
        actions = [item["action"] for item in result["geometryMetrics"]["topologyAdjustments"]]
        self.assertIn("split-merged-component", actions)
        self.assertLess(
            result["chars"][0]["bbox"]["x"] + result["chars"][0]["bbox"]["width"],
            result["chars"][1]["bbox"]["x"] + 2,
        )
        threshold = result["geometryMetrics"]["threshold"]
        image = source.image()
        for item in result["chars"]:
            box = item["bbox"]
            evidence = sum(
                image.pixel(x, y) <= threshold
                for y in range(box["y"], box["y"] + box["height"])
                for x in range(box["x"], box["x"] + box["width"])
            )
            self.assertGreater(evidence, 0)

    def test_empty_block_fails_without_fabricated_boxes(self) -> None:
        source, _ = pinyin_line()
        result = calibrate_block(source.image(), "", [20, 20, 400, 115])
        self.assertEqual(result["geometryStatus"], "failed")
        self.assertEqual(result["geometryFailureReason"], "empty-text")
        self.assertEqual(result["chars"], [])

    def test_insufficient_evidence_fails_without_equal_split(self) -> None:
        source = SyntheticPage()
        result = calibrate_block(source.image(), "天地", [20, 20, 400, 115])
        self.assertEqual(result["geometryStatus"], "failed")
        self.assertIn("insufficient-foreground-evidence", result["geometryFailureReason"])
        self.assertEqual(result["chars"], [])
        self.assertEqual(result["geometryConfidence"], 0.0)

    def test_sequence_count_mismatch_is_an_honest_failure(self) -> None:
        source, _ = pinyin_line("天地", start=130, pitch=90, split_index=None)
        result = calibrate_block(source.image(), "天地人", [20, 20, 400, 115])
        self.assertEqual(result["geometryStatus"], "failed")
        self.assertIn("sequence-evidence-mismatch", result["geometryFailureReason"])
        self.assertEqual(result["chars"], [])

    def test_13_groups_cannot_fabricate_14_characters(self) -> None:
        source = SyntheticPage(width=850)
        draw_synthetic_line(source, 13, y=20)

        result = calibrate_block(source.image(), "天" * 14, [20, 20, 820, 115])

        self.assertEqual(result["geometryStatus"], "failed")
        self.assertEqual(result["geometryMetrics"]["initialGroupCount"], 13)
        self.assertEqual(result["geometryMetrics"]["alignedGroupCount"], 13)
        self.assertEqual(result["chars"], [])

    def test_15_groups_cannot_fabricate_16_characters(self) -> None:
        source = SyntheticPage(width=950)
        draw_synthetic_line(source, 15, y=20)

        result = calibrate_block(source.image(), "天" * 16, [20, 20, 920, 115])

        self.assertEqual(result["geometryStatus"], "failed")
        self.assertEqual(result["geometryMetrics"]["initialGroupCount"], 15)
        self.assertEqual(result["geometryMetrics"]["alignedGroupCount"], 15)
        diagnostics = result["geometryMetrics"]["sequenceAlignmentDiagnostics"]
        self.assertFalse(diagnostics["unique"])
        self.assertEqual(result["chars"], [])

    def test_15_to_14_adjacent_boundary_shift_is_traceable(self) -> None:
        source = SyntheticPage(width=420, height=280)
        draw_synthetic_line(source, 2, y=20)
        draw_synthetic_line(source, 5, y=130, punctuation_indices={3})
        raw_page = {
            "pageNo": 1,
            "status": "ok",
            "width": source.width,
            "height": source.height,
            "blocks": [
                {"text": "甲乙人", "bbox": [20, 20, 400, 115]},
                {"text": "天地。山", "bbox": [20, 130, 400, 225]},
            ],
        }

        result = calibrate_page(source.image(), raw_page, "page-0001.png")
        first, second = result["blocks"]

        self.assertEqual(first["text"], "甲乙人")
        self.assertEqual(second["text"], "天地。山")
        self.assertEqual(first["bbox"], raw_page["blocks"][0]["bbox"])
        self.assertEqual(second["bbox"], raw_page["blocks"][1]["bbox"])
        self.assertEqual(first["geometryEffectiveText"], "甲乙")
        self.assertEqual(second["geometryEffectiveText"], "人天地。山")
        self.assertEqual("".join(item["text"] for item in first["chars"]), "甲乙")
        self.assertEqual("".join(item["text"] for item in second["chars"]), "人天地。山")
        self.assertEqual(first["geometryCorrection"]["kind"], BOUNDARY_CORRECTION_KIND)
        self.assertEqual(first["geometryCorrection"]["role"], "source")
        self.assertEqual(second["geometryCorrection"]["role"], "target")
        raw_stream = "".join(block["text"] for block in result["blocks"])
        effective_stream = "".join(block.get("geometryEffectiveText", block["text"]) for block in result["blocks"])
        self.assertEqual(raw_stream, effective_stream)
        self.assertEqual(result["geometryQuality"]["correctedSuccessfulBlocks"], 2)
        self.assertEqual(result["geometryQuality"]["boundaryCorrectionCount"], 1)
        self.assertEqual(validate_calibrated_page(result), [])

    def test_deterministic_repeat(self) -> None:
        source, _ = pinyin_line()
        first = calibrate_block(source.image(), "小红，帽子", [20, 20, 400, 115])
        second = calibrate_block(source.image(), "小红，帽子", [20, 20, 400, 115])
        self.assertEqual(first, second)

    def test_page_contract_preserves_luna_text_and_bbox(self) -> None:
        source, _ = pinyin_line()
        raw_page = {
            "pageNo": 1,
            "status": "ok",
            "width": source.width,
            "height": source.height,
            "blocks": [{"text": "小红，帽子", "bbox": [20, 20, 400, 115], "confidence": 0.9}],
        }
        result = calibrate_page(source.image(), raw_page, "page-0001.png")
        block = result["blocks"][0]
        self.assertEqual(block["text"], raw_page["blocks"][0]["text"])
        self.assertEqual(block["bbox"], raw_page["blocks"][0]["bbox"])
        self.assertEqual(validate_calibrated_page(result), [])
        self.assertEqual(result["geometryQuality"]["successfulBlocks"], 1)
        self.assertEqual(result["geometryQuality"]["failedBlocks"], 0)

    def test_package_normalization_remains_backward_compatible(self) -> None:
        old_page = {
            "pageNo": 1,
            "status": "ok",
            "width": 420,
            "height": 140,
            "blocks": [{"text": "天地", "bbox": [30, 30, 180, 100]}],
        }
        render = {"pageNo": 1, "width": 420, "height": 140, "image": "page-0001.png"}
        normalized = build_book_package.normalize_page(old_page, render, "source.pdf")
        self.assertNotIn("geometryStatus", normalized["blocks"][0])
        self.assertNotIn("chars", normalized["blocks"][0])
        self.assertEqual(normalized["blocks"][0]["text"], "天地")

    def test_package_rejects_incomplete_calibrated_geometry(self) -> None:
        source, _ = pinyin_line("天地", start=130, pitch=90, split_index=None)
        raw_block = {"text": "天地", "bbox": [20, 20, 400, 115]}
        raw_block.update(calibrate_block(source.image(), raw_block["text"], raw_block["bbox"]))
        raw_block["chars"][0].pop("foregroundPixels")
        page = {
            "pageNo": 1,
            "status": "ok",
            "width": source.width,
            "height": source.height,
            "blocks": [raw_block],
        }
        render = {"pageNo": 1, "width": source.width, "height": source.height, "image": "page-0001.png"}

        with self.assertRaisesRegex(ValueError, "foregroundPixels"):
            build_book_package.normalize_page(page, render, "source.pdf")

    def test_package_rejects_fabricated_geometry_metadata(self) -> None:
        source, _ = pinyin_line("天地", start=130, pitch=90, split_index=None)
        raw_block = {"text": "天地", "bbox": [20, 20, 400, 115]}
        raw_block.update(calibrate_block(source.image(), raw_block["text"], raw_block["bbox"]))
        raw_block["geometryMethod"] = "equal-width-split"
        raw_block["geometryConfidence"] = float("nan")
        page = {
            "pageNo": 1,
            "status": "ok",
            "width": source.width,
            "height": source.height,
            "blocks": [raw_block],
        }
        render = {"pageNo": 1, "width": source.width, "height": source.height, "image": "page-0001.png"}

        with self.assertRaisesRegex(ValueError, "geometryConfidence"):
            build_book_package.normalize_page(page, render, "source.pdf")

    def test_page_quality_must_match_block_data(self) -> None:
        source, _ = pinyin_line()
        page = calibrate_page(
            source.image(),
            {
                "pageNo": 1,
                "status": "ok",
                "width": source.width,
                "height": source.height,
                "blocks": [{"text": "小红，帽子", "bbox": [20, 20, 400, 115]}],
            },
            "page-0001.png",
        )
        page["geometryQuality"]["successfulBlocks"] = 0

        self.assertIn(
            "geometryQuality successfulBlocks does not match block data",
            validate_calibrated_page(page),
        )

    def test_document_rejects_failed_pdf_geometry_validation(self) -> None:
        source, _ = pinyin_line()
        page = calibrate_page(
            source.image(),
            {
                "pageNo": 1,
                "status": "ok",
                "width": source.width,
                "height": source.height,
                "blocks": [{"text": "小红，帽子", "bbox": [20, 20, 400, 115]}],
            },
            "page-0001.png",
        )
        quality = summarize_quality([page])
        quality["pdfValidation"] = {
            "pageCount": 1,
            "pages": [
                {
                    "pageNo": 1,
                    "expectedCharacterCount": len("小红，帽子"),
                    "extractedCharacterCount": len("小红，帽子") - 1,
                    "textMatchesInsertionOrder": True,
                    "minimumCharacterBboxIoU": 0.99,
                }
            ],
        }
        document = {
            "schemaVersion": SCHEMA_VERSION,
            "method": CALIBRATION_METHOD,
            "render": {"dpi": 200, "coordinateSystem": "pixel, origin=top-left"},
            "pages": [page],
            "quality": quality,
        }

        self.assertIn(
            "page 1: PDF extracted character count mismatch",
            validate_calibrated_document(document),
        )

    def test_positioned_pdf_character_bbox_matches_target(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "positioned.pdf"
            document = fitz.open()
            page = document.new_page(width=220, height=140)
            target = {"x": 50, "y": 40, "width": 32, "height": 38}
            insert_positioned_character(page, "这", target, 200)
            document.save(path)
            document.close()

            pdf = fitz.open(path)
            raw = pdf[0].get_text("rawdict")
            character = next(
                char
                for block in raw["blocks"]
                if block["type"] == 0
                for line in block["lines"]
                for span in line["spans"]
                for char in span["chars"]
            )
            pdf.close()
            expected = tuple(value * 72 / 200 for value in (50, 40, 82, 78))
            for actual, wanted in zip(character["bbox"], expected):
                self.assertAlmostEqual(actual, wanted, delta=0.03)

    def test_character_geometry_schema_is_valid_json(self) -> None:
        schema = json.loads((BOOK_PARSER / "schemas" / "char-geometry-v1.schema.json").read_text(encoding="utf-8"))
        self.assertEqual(schema["$id"], "char-geometry/v1")
        self.assertEqual(schema["$defs"]["character"]["properties"]["method"]["const"], CHAR_METHOD)
        self.assertEqual(
            schema["properties"]["source"]["properties"]["geometryTextPolicy"]["const"],
            GEOMETRY_TEXT_POLICY,
        )
        self.assertEqual(
            set(schema["$defs"]["character"]["required"]),
            {"text", "charIndex", "bbox", "confidence", "method", "status", "foregroundPixels"},
        )


class RealPageAcceptanceTests(unittest.TestCase):
    def test_page_10_first_line_uses_printed_positions(self) -> None:
        output = BOOK_PARSER / "work" / "ocr-pilot" / "geometry-validation" / "calibrated-pages.json"
        if not output.is_file():
            self.skipTest("real validation artifact has not been generated")
        document = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(validate_calibrated_document(document), [])
        page = next(item for item in document["pages"] if item["pageNo"] == 10)
        block = page["blocks"][0]
        self.assertEqual(block["geometryStatus"], "ok")
        self.assertEqual("".join(item["text"] for item in block["chars"]), block["text"])
        x0 = block["chars"][0]["bbox"]["x"]
        x1 = block["chars"][-1]["bbox"]["x"] + block["chars"][-1]["bbox"]["width"]
        self.assertGreater(x0, 250, "the two-character printed indent must be retained")
        self.assertGreater(x1 - x0, 750, "the hidden text must not regress to the old ~200 px span")
        self.assertTrue(all(item["bbox"]["y"] >= 250 for item in block["chars"]))


if __name__ == "__main__":
    unittest.main()
