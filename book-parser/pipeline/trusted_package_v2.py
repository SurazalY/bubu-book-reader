"""Shared helpers for the trusted (antigravity plain-text) book-package/v2 path.

The trusted path treats `book-parser/work/ocr-antigravity-v1/jobs/<bookId>/pages`
as a read-only, trusted input: the packager never re-runs OCR and never judges OCR
text quality. Every check implemented here is structural (file readable, page
numbers contiguous, exactly one file per page, PDF present and page count equal).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from book_package_v2 import sha256_file


SCHEMA_VERSION = "book-package/v2"
TRUSTED_QUALITY_STATUS = "trusted-baseline"
TRUSTED_BASELINE_AT = "2026-08-17T00:00:00+08:00"
TRUSTED_STATUS_NOTE = "OCR trusted per baseline 2026-08-17"
TRUSTED_RIGHTS_USAGE = "internal-default-catalog"

OCR_PIPELINE_VERSION = "ocr-antigravity-v1"
# The antigravity job directory carries no model metadata; this is an explicit
# sentinel, not a claim about which model produced the text.
OCR_MODEL_ROUTE = "unrecorded-antigravity-v1"
# No geometry is captured on the trusted path, so there is no coordinate space.
OCR_COORDINATE_SYSTEM = "none-trusted-text-baseline"
OCR_PROMPT_VERSION = "not-applicable-trusted-baseline"
PARSER_VERSION = "book-package-v2-trusted-builder-v1"

OCR_JOBS_ROOT = "book-parser/work/ocr-antigravity-v1/jobs"
PDF_ROOT = "device-migration-20260815/verification-extract/source/book-parser/input"
SOURCE_RECORD_ROOT = "device-migration-20260815/verification-extract/core-final/book-parser/work/text-ocr-v1/jobs"
PDF_PATH_MARKER = "book-parser/input/"

PAGE_FILE_PATTERN = re.compile(r"^page-(\d{4})\.(txt|blank)$")


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def book_id_pattern_ok(book_id: str) -> bool:
    return bool(re.fullmatch(r"book-[0-9]{3}", book_id))


@dataclass(frozen=True)
class PageFile:
    page_no: int
    name: str
    kind: str  # "text" | "blank"
    size_bytes: int
    sha256: str
    path: Path


def scan_ocr_pages(pages_dir: Path) -> list[PageFile]:
    """Structurally scan one antigravity pages directory.

    Fails when a file name is unrecognised, when a physical page has both a
    `.txt` and a `.blank` file, or when the page numbers are not exactly
    1..N contiguous.
    """
    if not pages_dir.is_dir():
        raise FileNotFoundError(f"OCR pages directory is missing: {pages_dir}")
    by_page: dict[int, list[str]] = {}
    for entry in sorted(pages_dir.iterdir(), key=lambda item: item.name):
        if not entry.is_file():
            raise ValueError(f"unexpected non-file entry in OCR pages directory: {entry.name}")
        match = PAGE_FILE_PATTERN.match(entry.name)
        if not match:
            raise ValueError(f"unexpected file name in OCR pages directory: {entry.name}")
        by_page.setdefault(int(match.group(1)), []).append(entry.name)

    duplicates = sorted(page_no for page_no, names in by_page.items() if len(names) != 1)
    if duplicates:
        detail = ", ".join(f"{page_no}: {sorted(by_page[page_no])}" for page_no in duplicates)
        raise ValueError(f"each physical page needs exactly one .txt or .blank file; conflicts at {detail}")
    expected = list(range(1, len(by_page) + 1))
    if sorted(by_page) != expected:
        found = set(by_page)
        missing = sorted(set(expected) - found)
        extra = sorted(found - set(expected))
        raise ValueError(f"OCR page numbers must cover 1..{len(by_page)} contiguously; missing={missing} unexpected={extra}")

    pages: list[PageFile] = []
    for page_no in expected:
        name = by_page[page_no][0]
        path = pages_dir / name
        pages.append(PageFile(
            page_no=page_no,
            name=name,
            kind="blank" if name.endswith(".blank") else "text",
            size_bytes=path.stat().st_size,
            sha256=sha256_file(path),
            path=path,
        ))
    return pages


def read_page_text(page: PageFile) -> str:
    """Return the exact OCR text for one physical page.

    `.blank` placeholder files carry no page text by contract, so they always
    produce an empty string. `.txt` files are decoded as UTF-8 from raw bytes so
    that CR/LF and BOM bytes survive verbatim (no newline translation).
    """
    if page.kind == "blank":
        return ""
    data = page.path.read_bytes()
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError(f"{page.name}: OCR text is not valid UTF-8: {error}") from error


def split_blocks(text: str) -> list[str]:
    """Split page text into blank-line separated blocks without losing a byte.

    Separator (blank) lines stay attached to the end of the preceding block, and
    leading blank lines stay attached to the first block, so that
    `"".join(split_blocks(text)) == text` always holds. That identity is what
    makes the character offsets in the package exact.
    """
    if not text:
        return []
    blocks: list[list[str]] = []
    leading: list[str] = []
    block_open = False
    for line in text.splitlines(keepends=True):
        if line.strip():
            if not block_open:
                blocks.append(leading)
                leading = []
                block_open = True
            blocks[-1].append(line)
        elif blocks:
            blocks[-1].append(line)
            block_open = False
        else:
            leading.append(line)
    if leading:  # the page holds whitespace only
        blocks.append(leading)
    return ["".join(block) for block in blocks]


def utf16_length(value: str) -> int:
    """Length in UTF-16 code units, i.e. what JavaScript `String.length` returns.

    The application importer, the server-side selection rebuild and the browser
    selection anchors all count UTF-16 code units, so package offsets must use the
    same unit. Python string indices would drift on non-BMP characters (book-028
    page 123/124 contain U+2A248).
    """
    return len(value.encode("utf-16-le")) // 2


def build_page(page_no: int, text: str, width: int, height: int) -> dict[str, Any]:
    """Build one `content/pages.json` page entry with exact character offsets."""
    if page_no < 1:
        raise ValueError("page numbers start at 1")
    if width < 1 or height < 1:
        raise ValueError(f"page {page_no}: physical page size must be positive")
    segments = split_blocks(text)
    if "".join(segments) != text:
        raise ValueError(f"page {page_no}: block segmentation lost text")
    blocks: list[dict[str, Any]] = []
    cursor = 0
    for order, segment in enumerate(segments, start=1):
        length = utf16_length(segment)
        blocks.append({
            "blockId": f"p{page_no:04d}-b{order:03d}",
            "order": order,
            "rawText": segment,
            "normalizedText": segment,
            "rawCharStart": cursor,
            "rawCharEnd": cursor + length,
            "charStart": cursor,
            "charEnd": cursor + length,
            # No per-block confidence signal exists on the trusted path; 1.0 is a
            # fixed sentinel and is not a quality claim.
            "confidence": 1.0,
            "sourceGeometry": {
                "lineBBox": {"x": 0, "y": 0, "width": 0, "height": 0},
                "estimated": False,
                "usage": "audit-only",
            },
        })
        cursor += length
    return {
        "pageNo": page_no,
        "printedPageLabel": None,
        "width": width,
        "height": height,
        "rawText": text,
        "normalizedText": text,
        "blocks": blocks,
    }


@dataclass(frozen=True)
class SourceRecord:
    """The archived text-ocr-v1 `source.json`, read as a PDF identity record."""

    job_id: str
    pdf_relative_path: str
    recorded_pdf_sha256: str
    recorded_page_count: int
    render_dpi: int
    field_aliases: dict[str, str]


def _first_alias(record: dict[str, Any], aliases: tuple[tuple[str, ...], ...]) -> tuple[Any, str]:
    for alias in aliases:
        value: Any = record
        for key in alias:
            value = value.get(key) if isinstance(value, dict) else None
            if value is None:
                break
        if value is not None:
            return value, ".".join(alias)
    return None, ""


def pdf_relative_path(raw_path: str) -> str:
    """Return the part of a recorded PDF path after `book-parser/input/`.

    File names are used verbatim: trailing spaces and original typos are part of
    the real file name on disk and must never be trimmed or corrected.
    """
    normalized = raw_path.replace("\\", "/")
    if PDF_PATH_MARKER not in normalized:
        raise ValueError(f"recorded PDF path does not contain '{PDF_PATH_MARKER}': {raw_path}")
    relative = normalized.split(PDF_PATH_MARKER, 1)[1]
    if not relative or relative.startswith("/") or ".." in relative.split("/"):
        raise ValueError(f"recorded PDF path is unsafe: {raw_path}")
    return relative


def parse_source_record(record: dict[str, Any], book_id: str) -> SourceRecord:
    """Parse one archived source.json, tolerating every known field alias."""
    job_id = record.get("jobId")
    if job_id != book_id:
        raise ValueError(f"{book_id}: source.json jobId is {job_id!r}")
    raw_path, path_alias = _first_alias(record, (("sourcePdf",), ("sourcePath",), ("source", "path")))
    if not isinstance(raw_path, str) or not raw_path:
        raise ValueError(f"{book_id}: source.json has no sourcePdf/sourcePath/source.path")
    sha256, sha_alias = _first_alias(record, (("sourceSha256",), ("sha256",), ("source", "sha256")))
    if not isinstance(sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", sha256):
        raise ValueError(f"{book_id}: source.json has no lowercase SHA-256 for the PDF")
    page_count, count_alias = _first_alias(record, (("pageCount",), ("totalPages",), ("source", "pageCount")))
    if isinstance(page_count, bool) or not isinstance(page_count, int) or page_count < 1:
        raise ValueError(f"{book_id}: source.json has no positive pageCount/totalPages/source.pageCount")
    dpi, dpi_alias = _first_alias(record, (("renderDpi",), ("dpi",), ("render", "dpi")))
    if isinstance(dpi, bool) or not isinstance(dpi, int) or dpi < 1:
        raise ValueError(f"{book_id}: source.json has no positive renderDpi/dpi/render.dpi")
    return SourceRecord(
        job_id=book_id,
        pdf_relative_path=pdf_relative_path(raw_path),
        recorded_pdf_sha256=sha256,
        recorded_page_count=page_count,
        render_dpi=dpi,
        field_aliases={"pdfPath": path_alias, "pdfSha256": sha_alias, "pageCount": count_alias, "renderDpi": dpi_alias},
    )
