import json
import re
import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))

import pymupdf  # noqa: E402

from book_package_v2 import sha256_file, write_canonical_json  # noqa: E402
from build_trusted_package_v2 import build  # noqa: E402
from trusted_package_v2 import read_page_text, scan_ocr_pages, split_blocks, utf16_length  # noqa: E402
from validate_book_package_v2 import validate  # noqa: E402


BOOK_ID = "book-901"
PDF_NAME = "合成小书 .pdf"  # trailing space on purpose: real file names keep theirs


def write_pdf(path: Path, page_count: int) -> None:
    document = pymupdf.open()
    try:
        for index in range(page_count):
            page = document.new_page(width=595, height=842)
            page.insert_text((72, 72), f"synthetic page {index + 1}")
        document.save(str(path))
    finally:
        document.close()


class TrustedFixture:
    """A synthetic one-book workspace: OCR page files, source PDF and catalog row."""

    def __init__(self, root: Path, pages: dict[int, str | None], pdf_page_count: int | None = None, catalog_page_count: int | None = None):
        self.root = root
        self.pages_dir = root / "jobs" / BOOK_ID / "pages"
        self.pages_dir.mkdir(parents=True)
        for page_no, text in sorted(pages.items()):
            if text is None:
                (self.pages_dir / f"page-{page_no:04d}.blank").write_bytes(b"# blank\n")
            else:
                (self.pages_dir / f"page-{page_no:04d}.txt").write_bytes(text.encode("utf-8"))
        self.pdf_path = root / "pdf" / PDF_NAME
        self.pdf_path.parent.mkdir(parents=True)
        write_pdf(self.pdf_path, pdf_page_count if pdf_page_count is not None else len(pages))
        self.catalog_path = root / "catalog.json"
        write_canonical_json(self.catalog_path, {
            "schemaVersion": "book-catalog-default/v1",
            "ocrJobsRoot": "jobs",
            "pdfRoot": "pdf",
            "sourceRecordRoot": "records",
            "books": [{
                "bookId": BOOK_ID,
                "title": "合成小书",
                "grade": 3,
                "versionId": f"{BOOK_ID}-trusted-v1",
                "sourcePdfRelativePath": PDF_NAME,
                "pageCount": catalog_page_count if catalog_page_count is not None else len(pages),
                "textPageCount": sum(1 for text in pages.values() if text is not None),
                "blankPageCount": sum(1 for text in pages.values() if text is None),
                "recordedPdfPageCount": pdf_page_count if pdf_page_count is not None else len(pages),
                "recordedPdfSha256": sha256_file(self.pdf_path),
                "renderDpi": 200,
                "sourceRecordRelativePath": f"records/{BOOK_ID}/source.json",
                "sourceRecordSha256": "0" * 64,
                "sourceRecordFieldAliases": {"pdfPath": "sourcePdf", "pdfSha256": "sourceSha256", "pageCount": "pageCount", "renderDpi": "renderDpi"},
            }],
        })

    def build(self, name: str = "package") -> tuple[dict, Path]:
        output = self.root / "out" / name
        return build(self.catalog_path, BOOK_ID, output, self.root), output


class TrustedPackageV2Test(unittest.TestCase):
    def fixture(self, pages: dict[int, str | None], **kwargs) -> TrustedFixture:
        temporary = tempfile.TemporaryDirectory(prefix="trusted-fixture-")
        self.addCleanup(temporary.cleanup)
        return TrustedFixture(Path(temporary.name), pages, **kwargs)

    def read_package_json(self, package: Path, relative: str) -> dict:
        return json.loads((package / relative).read_text(encoding="utf-8"))

    def test_builds_a_plain_text_book_that_passes_the_package_validator(self):
        fixture = self.fixture({
            1: "第一段\n\n第二段\n",
            2: "只有一段\n",
            3: "末页\n\n结束\n",
        })
        result, package = fixture.build()
        self.assertEqual(result["pageCount"], 3)
        self.assertEqual(result["blankPageCount"], 0)
        self.assertEqual(result["qualityStatus"], "trusted-baseline")

        report = validate(package)
        self.assertEqual(report["errors"], [])
        self.assertTrue(report["ok"])

        manifest = self.read_package_json(package, "manifest.json")
        self.assertEqual(manifest["title"], "合成小书")
        self.assertEqual(manifest["grade"], 3)
        self.assertEqual(manifest["quality"]["status"], "trusted-baseline")
        self.assertEqual(manifest["quality"]["statusNote"], "OCR trusted per baseline 2026-08-17")
        self.assertEqual(manifest["rights"], {"usage": "internal-default-catalog"})
        self.assertEqual(manifest["cover"]["asset"], "assets/cover.jpg")
        self.assertEqual(manifest["cover"]["mimeType"], "image/jpeg")
        self.assertEqual(manifest["cover"]["sourcePageNo"], 1)
        self.assertEqual(manifest["cover"]["width"], 600)
        self.assertTrue((package / "assets" / "cover.jpg").is_file())
        self.assertEqual(self.read_package_json(package, "content/corrections.json")["corrections"], [])

        pages = self.read_package_json(package, "content/pages.json")["pages"]
        self.assertEqual([page["pageNo"] for page in pages], [1, 2, 3])
        self.assertTrue(all(page["printedPageLabel"] is None for page in pages))
        self.assertTrue(all("printedPageLabel" in page for page in pages))
        first = pages[0]
        self.assertEqual([block["blockId"] for block in first["blocks"]], ["p0001-b001", "p0001-b002"])
        self.assertTrue(all(block["sourceGeometry"]["usage"] == "audit-only" for block in first["blocks"]))
        self.assertTrue(all(block["sourceGeometry"]["lineBBox"] == {"x": 0, "y": 0, "width": 0, "height": 0} for block in first["blocks"]))

    def test_packages_never_leak_an_absolute_path(self):
        fixture = self.fixture({1: "正文\n"})
        _, package = fixture.build()
        patterns = (re.compile(r"[A-Za-z]:[\\/]"), re.compile(r"/(?:Users|home|mnt|Volumes)/"))
        for path in sorted(package.rglob("*")):
            if path.is_file() and path.suffix.lower() in {".json", ".md"}:
                text = path.read_text(encoding="utf-8")
                for pattern in patterns:
                    self.assertIsNone(pattern.search(text), f"{path.name} leaked an absolute path")

    def test_blank_pages_become_empty_text_and_are_reported(self):
        fixture = self.fixture({1: "正文\n", 2: None, 3: "尾页\n", 4: None})
        result, package = fixture.build()
        self.assertEqual(result["blankPageCount"], 2)
        self.assertEqual(result["textPageCount"], 2)

        pages = self.read_package_json(package, "content/pages.json")["pages"]
        for page_no in (2, 4):
            page = pages[page_no - 1]
            self.assertEqual(page["rawText"], "")
            self.assertEqual(page["normalizedText"], "")
            self.assertEqual(page["blocks"], [])
            self.assertGreater(page["width"], 0)
            self.assertGreater(page["height"], 0)

        manifest = self.read_package_json(package, "manifest.json")
        self.assertEqual(manifest["quality"]["automatic"]["emptyPages"], [2, 4])
        quality = self.read_package_json(package, "quality-report.json")
        self.assertEqual(quality["automatic"]["blankPages"], [2, 4])
        self.assertEqual(quality["automatic"]["emptyPages"], [2, 4])
        self.assertEqual(quality["automatic"]["blankPageCount"], 2)
        self.assertFalse(quality["humanReview"]["performed"])
        self.assertEqual(validate(package)["errors"], [])

    def test_rejects_a_gap_in_the_physical_page_numbers(self):
        fixture = self.fixture({1: "第一页\n", 3: "第三页\n"})
        with self.assertRaisesRegex(ValueError, "contiguously"):
            fixture.build()

    def test_rejects_a_page_that_has_both_a_txt_and_a_blank_file(self):
        fixture = self.fixture({1: "第一页\n", 2: "第二页\n"})
        (fixture.pages_dir / "page-0002.blank").write_bytes(b"")
        with self.assertRaisesRegex(ValueError, "exactly one"):
            fixture.build()

    def test_rejects_an_unexpected_extra_page_file(self):
        fixture = self.fixture({1: "第一页\n", 2: "第二页\n"}, pdf_page_count=2, catalog_page_count=2)
        (fixture.pages_dir / "page-0003.txt").write_bytes("多余页\n".encode("utf-8"))
        with self.assertRaisesRegex(ValueError, "catalog pageCount is 2"):
            fixture.build()

    def test_rejects_an_unrecognised_file_name(self):
        fixture = self.fixture({1: "第一页\n"})
        (fixture.pages_dir / "notes.txt").write_bytes(b"stray")
        with self.assertRaisesRegex(ValueError, "unexpected file name"):
            fixture.build()

    def test_rejects_a_pdf_whose_physical_page_count_differs(self):
        fixture = self.fixture({1: "第一页\n", 2: "第二页\n"}, pdf_page_count=3)
        with self.assertRaisesRegex(ValueError, "physical pages"):
            fixture.build()

    def test_block_offsets_slice_back_out_of_the_normalized_text(self):
        text = "\n\n开篇\r\n第二行\n\n\n中段\n\n末段没有换行"
        fixture = self.fixture({1: text, 2: "单段\n"})
        _, package = fixture.build()
        page = self.read_package_json(package, "content/pages.json")["pages"][0]
        self.assertEqual(page["rawText"], text)
        self.assertEqual(page["normalizedText"], text)
        self.assertEqual("".join(block["normalizedText"] for block in page["blocks"]), text)
        cursor = 0
        for block in page["blocks"]:
            self.assertEqual(block["charStart"], cursor)
            self.assertEqual(block["charEnd"], cursor + len(block["normalizedText"]))
            self.assertEqual(block["rawCharStart"], block["charStart"])
            self.assertEqual(block["rawCharEnd"], block["charEnd"])
            self.assertEqual(page["normalizedText"][block["charStart"]:block["charEnd"]], block["normalizedText"])
            cursor = block["charEnd"]
        self.assertEqual(cursor, len(text))
        self.assertEqual([block["blockId"] for block in page["blocks"]], ["p0001-b001", "p0001-b002", "p0001-b003"])

    def test_offsets_count_utf16_code_units_like_javascript(self):
        text = "𪉈字\n\n第二段𪉈\n"  # U+2A248 is outside the BMP, as in book-028 page 123/124
        self.assertNotEqual(len(text), utf16_length(text))
        fixture = self.fixture({1: text})
        _, package = fixture.build()
        page = self.read_package_json(package, "content/pages.json")["pages"][0]
        units = page["normalizedText"].encode("utf-16-le")
        for block in page["blocks"]:
            sliced = units[block["charStart"] * 2:block["charEnd"] * 2].decode("utf-16-le")
            self.assertEqual(sliced, block["normalizedText"])
        self.assertEqual(page["blocks"][-1]["charEnd"], utf16_length(text))
        self.assertEqual(validate(package)["errors"], [])

    def test_split_blocks_is_lossless_for_blank_line_layouts(self):
        for text in (
            "",
            "单段",
            "第一段\n\n第二段\n",
            "\n\n开头空行\n",
            "结尾空行\n\n\n",
            "带\r\n回车\r\n\r\n第二段\r\n",
            "\n\n\n",
        ):
            with self.subTest(text=text):
                self.assertEqual("".join(split_blocks(text)), text)

    def test_repeated_build_is_byte_identical(self):
        fixture = self.fixture({1: "第一页\n\n第二段\n", 2: None, 3: "第三页\n"})
        first_result, first = fixture.build("first")
        second_result, second = fixture.build("second")
        self.assertEqual(first_result["manifestSha256"], second_result["manifestSha256"])
        first_files = sorted(path.relative_to(first).as_posix() for path in first.rglob("*") if path.is_file())
        second_files = sorted(path.relative_to(second).as_posix() for path in second.rglob("*") if path.is_file())
        self.assertEqual(first_files, second_files)
        for relative in first_files:
            self.assertEqual(
                sha256_file(first / relative),
                sha256_file(second / relative),
                f"{relative} is not byte-identical between two builds",
            )

    def test_blank_placeholder_files_are_read_as_empty_text(self):
        fixture = self.fixture({1: "正文\n", 2: None})
        page_files = scan_ocr_pages(fixture.pages_dir)
        self.assertEqual([page.kind for page in page_files], ["text", "blank"])
        self.assertEqual(read_page_text(page_files[1]), "")
        self.assertEqual(read_page_text(page_files[0]), "正文\n")


if __name__ == "__main__":
    unittest.main()
