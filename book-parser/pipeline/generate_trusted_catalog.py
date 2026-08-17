#!/usr/bin/env python3
"""Generate and verify `book-parser/catalog-default-49.json` (the default 49-book catalog).

The book titles and grades below are transcribed line by line from
`docs/product-close-loop/01_现状与资产盘点.md` §5, which is the only authority for
what gets stored in the product database. PDF paths are resolved from the archived
`text-ocr-v1/source.json` records (field aliases tolerated) and are kept verbatim,
including trailing spaces and the original `列那狐的古诗` file-name typo.

Every check here is structural: page-file counts, page-number contiguity, PDF
existence, PDF page count and PDF SHA-256. OCR text quality is never inspected.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pymupdf

from book_package_v2 import read_json, sha256_file, write_canonical_json
from trusted_package_v2 import (
    OCR_JOBS_ROOT,
    PDF_ROOT,
    SOURCE_RECORD_ROOT,
    TRUSTED_STATUS_NOTE,
    parse_source_record,
    repo_root,
    scan_ocr_pages,
)


CATALOG_SCHEMA_VERSION = "book-catalog-default/v1"
CATALOG_SOURCE = "docs/product-close-loop/01_现状与资产盘点.md §5"

# (bookId, 落库书名, 年级, 总页数, 文档标注的空白页数或 None)
DOC_TABLE: tuple[tuple[str, str, int, int, int | None], ...] = (
    ("book-001", "和大人一起读·儿童歌谣", 1, 98, 10),
    ("book-002", "和大人一起读·国学启蒙", 1, 98, None),
    ("book-003", "和大人一起读·寓言故事", 1, 98, 20),
    ("book-004", "和大人一起读·童话故事", 1, 98, None),
    ("book-005", "读读童谣和儿歌·中国传统文化", 1, 96, None),
    ("book-006", "读读童谣和儿歌·外国童谣", 1, 98, None),
    ("book-007", "读读童谣和儿歌·多彩的童年", 1, 98, None),
    ("book-008", "读读童谣和儿歌·奇妙的大自然", 1, 98, None),
    ("book-009", "一只想飞的猫", 2, 130, None),
    ("book-010", "一起长大的玩具", 2, 162, None),
    ("book-011", "七色花", 2, 162, 27),
    ("book-012", "孤独的小螃蟹", 2, 130, None),
    ("book-013", "小狗的小房子", 2, 130, None),
    ("book-014", "小鲤鱼跳龙门", 2, 130, None),
    ("book-015", "愿望的实现", 2, 154, 30),
    ("book-016", "歪脑袋木头桩", 2, 130, None),
    ("book-017", "神笔马良", 2, 193, None),
    ("book-018", "中国古代寓言", 3, 162, None),
    ("book-019", "伊索寓言", 3, 162, None),
    ("book-020", "克雷洛夫寓言", 3, 162, None),
    ("book-021", "安徒生童话", 3, 194, None),
    ("book-022", "拉封丹寓言", 3, 162, None),
    ("book-023", "格林童话", 3, 244, None),
    ("book-024", "稻草人", 3, 233, None),
    ("book-025", "世界神话传说", 4, 162, None),
    ("book-026", "中国古代神话", 4, 162, None),
    ("book-027", "十万个为什么", 4, 162, None),
    ("book-028", "吉尔伽美什", 4, 146, 27),
    ("book-029", "地球的故事", 4, 225, None),
    ("book-030", "山海经", 4, 162, None),
    ("book-031", "希腊神话故事", 4, 161, None),
    ("book-032", "森林报", 4, 322, None),
    ("book-033", "爷爷的爷爷哪里来", 4, 194, None),
    ("book-034", "穿过地平线", 4, 225, None),
    ("book-035", "细菌世界历险记", 4, 194, None),
    ("book-036", "一千零一夜", 5, 162, None),
    ("book-037", "三国演义", 5, 194, None),
    ("book-038", "列那狐的故事", 5, 218, None),
    ("book-039", "红楼梦", 5, 194, None),
    ("book-040", "西游记", 5, 194, None),
    ("book-041", "欧洲民间故事", 5, 162, None),
    ("book-042", "水浒传", 5, 193, None),
    ("book-043", "非洲民间故事", 5, 161, 21),
    ("book-044", "小英雄雨来", 6, 193, None),
    ("book-045", "尼尔斯骑鹅旅行记", 6, 354, None),
    ("book-046", "汤姆·索亚历险记", 6, 242, None),
    ("book-047", "爱丽丝漫游奇境", 6, 258, None),
    ("book-048", "爱的教育", 6, 226, None),
    ("book-049", "鲁滨逊漂流记", 6, 314, None),
)

# book-031 lost pages 34–37 and 95–100 before the 2026-08-17 repair; the catalog
# must keep asserting that its page numbers stay 1..161 contiguous.
CONTIGUITY_SPOT_CHECKS = {"book-031": 161}


def pdf_page_count(path: Path) -> int:
    with pymupdf.open(path) as document:
        return document.page_count


def collect(root: Path, verify_pdf_hash: bool) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    books: list[dict[str, Any]] = []
    findings: list[dict[str, Any]] = []
    for book_id, title, grade, doc_page_count, doc_blank_count in DOC_TABLE:
        pages_dir = root / OCR_JOBS_ROOT / book_id / "pages"
        pages = scan_ocr_pages(pages_dir)
        text_pages = sum(1 for page in pages if page.kind == "text")
        blank_pages = sum(1 for page in pages if page.kind == "blank")
        page_count = len(pages)

        record_relative = f"{SOURCE_RECORD_ROOT}/{book_id}/source.json"
        record_path = root / record_relative
        if not record_path.is_file():
            raise FileNotFoundError(f"{book_id}: archived source.json is missing: {record_relative}")
        record = parse_source_record(read_json(record_path), book_id)

        pdf_path = root / PDF_ROOT / record.pdf_relative_path
        if not pdf_path.is_file():
            raise FileNotFoundError(f"{book_id}: source PDF is missing: {PDF_ROOT}/{record.pdf_relative_path}")
        actual_pdf_pages = pdf_page_count(pdf_path)
        actual_pdf_sha256 = sha256_file(pdf_path) if verify_pdf_hash else None

        if page_count != doc_page_count:
            findings.append({"bookId": book_id, "check": "ocrPageCount-vs-docTable", "ocrPageFiles": page_count, "docTable": doc_page_count})
        if record.recorded_page_count != page_count:
            findings.append({"bookId": book_id, "check": "sourceRecordPageCount-vs-ocrPageCount", "sourceRecord": record.recorded_page_count, "ocrPageFiles": page_count})
        if actual_pdf_pages != page_count:
            findings.append({"bookId": book_id, "check": "pdfPageCount-vs-ocrPageCount", "pdf": actual_pdf_pages, "ocrPageFiles": page_count})
        if doc_blank_count is not None and blank_pages != doc_blank_count:
            findings.append({"bookId": book_id, "check": "blankPageCount-vs-docTable", "blankFiles": blank_pages, "docTable": doc_blank_count})
        if actual_pdf_sha256 is not None and actual_pdf_sha256 != record.recorded_pdf_sha256:
            findings.append({"bookId": book_id, "check": "pdfSha256-vs-sourceRecord", "pdf": actual_pdf_sha256, "sourceRecord": record.recorded_pdf_sha256})
        expected_contiguous = CONTIGUITY_SPOT_CHECKS.get(book_id)
        if expected_contiguous is not None and page_count != expected_contiguous:
            findings.append({"bookId": book_id, "check": "contiguitySpotCheck", "expectedPageCount": expected_contiguous, "ocrPageFiles": page_count})

        books.append({
            "bookId": book_id,
            "title": title,
            "grade": grade,
            "versionId": f"{book_id}-trusted-v1",
            "sourcePdfRelativePath": record.pdf_relative_path,
            "pageCount": page_count,
            "textPageCount": text_pages,
            "blankPageCount": blank_pages,
            "recordedPdfPageCount": record.recorded_page_count,
            "recordedPdfSha256": record.recorded_pdf_sha256,
            "renderDpi": record.render_dpi,
            "sourceRecordRelativePath": record_relative,
            "sourceRecordSha256": sha256_file(record_path),
            "sourceRecordFieldAliases": record.field_aliases,
        })
    return books, findings


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=repo_root())
    parser.add_argument("--output", type=Path, default=None, help="默认 book-parser/catalog-default-49.json")
    parser.add_argument("--report", type=Path, default=None, help="核对报告输出路径（默认写到被 .gitignore 覆盖的 work/ 目录）")
    parser.add_argument("--skip-pdf-hash", action="store_true", help="跳过 3.3GB PDF 哈希核对（默认核对）")
    args = parser.parse_args()

    root = args.repo_root.resolve()
    output = (args.output or root / "book-parser" / "catalog-default-49.json").resolve()
    report_path = (args.report or root / "book-parser" / "work" / "package-v2-trusted" / "_catalog-verification.json").resolve()

    books, findings = collect(root, verify_pdf_hash=not args.skip_pdf_hash)
    catalog = {
        "schemaVersion": CATALOG_SCHEMA_VERSION,
        "titleSource": CATALOG_SOURCE,
        "baselineNote": TRUSTED_STATUS_NOTE,
        "ocrJobsRoot": OCR_JOBS_ROOT,
        "pdfRoot": PDF_ROOT,
        "sourceRecordRoot": SOURCE_RECORD_ROOT,
        "books": books,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    write_canonical_json(output, catalog)

    report = {
        "books": len(books),
        "pdfHashVerified": not args.skip_pdf_hash,
        "totalPages": sum(book["pageCount"] for book in books),
        "totalTextPages": sum(book["textPageCount"] for book in books),
        "totalBlankPages": sum(book["blankPageCount"] for book in books),
        "gradeHistogram": {str(grade): sum(1 for book in books if book["grade"] == grade) for grade in range(1, 7)},
        "aliasUsage": {
            field: sorted({book["sourceRecordFieldAliases"][field] for book in books})
            for field in ("pdfPath", "pdfSha256", "pageCount", "renderDpi")
        },
        "nonDefaultAliasBooks": [
            {"bookId": book["bookId"], "aliases": book["sourceRecordFieldAliases"]}
            for book in books
            if book["sourceRecordFieldAliases"] != {"pdfPath": "sourcePdf", "pdfSha256": "sourceSha256", "pageCount": "pageCount", "renderDpi": "renderDpi"}
        ],
        "findings": findings,
        "ok": not findings,
        "catalog": str(output.relative_to(root)).replace("\\", "/"),
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    write_canonical_json(report_path, report)
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    if findings:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
