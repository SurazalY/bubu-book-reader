#!/usr/bin/env python3
"""Build a deterministic book-package/v2 package from trusted antigravity OCR text.

Input: one row of `book-parser/catalog-default-49.json`, the read-only page files in
`book-parser/work/ocr-antigravity-v1/jobs/<bookId>/pages`, and the read-only source PDF.
Output: a `book-package/v2` package directory with `quality.status='trusted-baseline'`.

The OCR text is trusted input: it is copied verbatim and its quality is never judged.
The only checks are structural — page numbers cover 1..pageCount with exactly one
`.txt` or `.blank` per page, the PDF exists, its SHA-256 matches the archived source
record, and its physical page count equals the OCR page count. Any structural failure
aborts the build.

Builds are deterministic: JSON is canonical (sorted keys, 2-space indent, UTF-8),
every timestamp comes from the fixed trusted baseline constant instead of `now()`,
and no wall-clock or environment value is written into the package.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pymupdf

from book_package_v2 import (
    NORMALIZATION_VERSION,
    automatic_quality,
    read_json,
    sha256_file,
    write_canonical_json,
)
from trusted_package_v2 import (
    OCR_COORDINATE_SYSTEM,
    OCR_JOBS_ROOT,
    OCR_MODEL_ROUTE,
    OCR_PIPELINE_VERSION,
    OCR_PROMPT_VERSION,
    PARSER_VERSION,
    PDF_ROOT,
    SCHEMA_VERSION,
    TRUSTED_BASELINE_AT,
    TRUSTED_QUALITY_STATUS,
    TRUSTED_RIGHTS_USAGE,
    TRUSTED_STATUS_NOTE,
    book_id_pattern_ok,
    build_page,
    read_page_text,
    repo_root,
    scan_ocr_pages,
)


COVER_TARGET_WIDTH = 600
COVER_JPEG_QUALITY = 85
COVER_ASSET = "assets/cover.jpg"
SOURCE_ASSET = "assets/source.pdf"
ABSOLUTE_PATH_PATTERNS = (
    re.compile(r"[A-Za-z]:[\\/]"),
    re.compile(r"\\\\[A-Za-z0-9]"),
    re.compile(r"/(?:Users|home|mnt|Volumes)/"),
)
PROMPT_PLACEHOLDER = f"""# OCR prompt artifact — not applicable on the trusted baseline

This package was produced by the trusted path (`{OCR_PIPELINE_VERSION}`), whose job
directory contains page text only: `pages/page-XXXX.txt` and `pages/page-XXXX.blank`.

No prompt artifact, model route, or per-page model response was recorded for that
pipeline, so there is nothing to copy here. This file exists because
`book-package/v2` requires `provenance/ocr-prompt.md` to be present and hashed.

- `ocr.promptVersion` = `{OCR_PROMPT_VERSION}`
- `ocr.modelRoute` = `{OCR_MODEL_ROUTE}` (explicit sentinel, not a claim)
- Per-page input identity lives in `provenance/ocr-pages-index.json`
- Synthesized-field explanations live in `provenance/trusted-baseline.json`

Baseline: {TRUSTED_STATUS_NOTE}.
"""


def catalog_row(catalog: dict[str, Any], book_id: str) -> dict[str, Any]:
    rows = [row for row in catalog.get("books", []) if row.get("bookId") == book_id]
    if len(rows) != 1:
        raise ValueError(f"catalog must contain exactly one {book_id}")
    row = rows[0]
    for field in ("title", "versionId", "sourcePdfRelativePath", "sourceRecordRelativePath", "sourceRecordSha256", "recordedPdfSha256"):
        if not isinstance(row.get(field), str) or not row[field]:
            raise ValueError(f"{book_id}: catalog field {field} is required")
    grade = row.get("grade")
    if isinstance(grade, bool) or not isinstance(grade, int) or not 1 <= grade <= 6:
        raise ValueError(f"{book_id}: catalog grade must be an integer 1..6")
    page_count = row.get("pageCount")
    if isinstance(page_count, bool) or not isinstance(page_count, int) or page_count < 1:
        raise ValueError(f"{book_id}: catalog pageCount must be a positive integer")
    dpi = row.get("renderDpi")
    if isinstance(dpi, bool) or not isinstance(dpi, int) or dpi < 1:
        raise ValueError(f"{book_id}: catalog renderDpi must be a positive integer")
    if not book_id_pattern_ok(book_id):
        raise ValueError(f"{book_id}: book ids must look like book-001")
    return row


def render_cover(pdf_path: Path, destination: Path) -> dict[str, Any]:
    """Render physical page 1 of the source PDF into a ~600px wide JPEG cover."""
    with pymupdf.open(pdf_path) as document:
        page = document.load_page(0)
        if page.rect.width <= 0 or page.rect.height <= 0:
            raise ValueError("source PDF page 1 has no printable area")
        zoom = COVER_TARGET_WIDTH / page.rect.width
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False, colorspace=pymupdf.csRGB)
        pixmap.save(str(destination), output="jpg", jpg_quality=COVER_JPEG_QUALITY)
        return {"width": pixmap.width, "height": pixmap.height}


def page_dimensions(document: pymupdf.Document) -> list[tuple[int, int]]:
    """Physical page sizes in PDF points, kept as audit-only reference values."""
    sizes: list[tuple[int, int]] = []
    for index in range(document.page_count):
        rect = document.load_page(index).rect
        sizes.append((max(1, round(rect.width)), max(1, round(rect.height))))
    return sizes


def promote_staging(staging: Path, output: Path) -> None:
    """Move a finished staging directory onto the output path.

    Windows can briefly deny the directory rename while a scanner still holds a
    handle on the freshly written files, so the rename is retried before falling
    back to a copy.
    """
    for attempt in range(6):
        if output.exists():
            shutil.rmtree(output)
        try:
            staging.rename(output)
            return
        except PermissionError:
            if attempt == 5:
                shutil.copytree(staging, output)
                shutil.rmtree(staging, ignore_errors=True)
                return
            time.sleep(0.5 * (attempt + 1))


def assert_no_absolute_paths(package: Path) -> None:
    for path in sorted(package.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in {".json", ".md"}:
            continue
        text = path.read_text(encoding="utf-8")
        for pattern in ABSOLUTE_PATH_PATTERNS:
            match = pattern.search(text)
            if match:
                raise ValueError(f"{path.name} contains an absolute path: {match.group(0)!r}")


def build(
    catalog_path: Path,
    book_id: str,
    output: Path,
    root: Path,
    force: bool = False,
) -> dict[str, Any]:
    started = time.perf_counter()
    catalog = read_json(catalog_path)
    row = catalog_row(catalog, book_id)
    jobs_root = root / catalog.get("ocrJobsRoot", OCR_JOBS_ROOT)
    pdf_root = root / catalog.get("pdfRoot", PDF_ROOT)
    job_relative = f"{catalog.get('ocrJobsRoot', OCR_JOBS_ROOT)}/{book_id}"

    pages_dir = jobs_root / book_id / "pages"
    page_files = scan_ocr_pages(pages_dir)
    page_count = len(page_files)
    if page_count != row["pageCount"]:
        raise ValueError(f"{book_id}: catalog pageCount is {row['pageCount']} but the OCR job holds {page_count} page files")

    pdf_path = pdf_root / row["sourcePdfRelativePath"]
    if not pdf_path.is_file():
        raise FileNotFoundError(f"{book_id}: source PDF is missing: {pdf_path.name}")
    pdf_sha256 = sha256_file(pdf_path)
    if pdf_sha256 != row["recordedPdfSha256"]:
        raise ValueError(f"{book_id}: source PDF SHA-256 {pdf_sha256} does not match the archived source record")
    pdf_size = pdf_path.stat().st_size
    with pymupdf.open(pdf_path) as document:
        pdf_page_count = document.page_count
        sizes = page_dimensions(document)
    if pdf_page_count != page_count:
        raise ValueError(f"{book_id}: source PDF has {pdf_page_count} physical pages but the OCR job holds {page_count}")

    pages = [
        build_page(page_file.page_no, read_page_text(page_file), *sizes[page_file.page_no - 1])
        for page_file in page_files
    ]
    blank_pages = [page_file.page_no for page_file in page_files if page_file.kind == "blank"]

    automatic = automatic_quality(pages)
    if set(blank_pages) - set(automatic["emptyPages"]):
        raise ValueError(f"{book_id}: blank placeholder pages must project to empty page text")
    automatic.update({
        "blankPages": blank_pages,
        "textPageCount": page_count - len(blank_pages),
        "blankPageCount": len(blank_pages),
        # Structural checks only. No OCR quality review was performed.
        "confidenceSignal": "unavailable-fixed-1.0",
        "structuralChecks": {
            "pageSequenceContiguous": True,
            "exactlyOneFilePerPage": True,
            "pageFilesReadableUtf8": True,
            "pdfPresent": True,
            "pdfPageCountMatchesOcrPageCount": True,
            "sourcePdfSha256MatchesRecord": True,
        },
    })
    quality = {
        "schemaVersion": "book-package-quality/v2",
        "bookId": book_id,
        "versionId": row["versionId"],
        "status": TRUSTED_QUALITY_STATUS,
        "statusNote": TRUSTED_STATUS_NOTE,
        "automatic": automatic,
        "humanReview": {
            "performed": False,
            "reason": f"{TRUSTED_STATUS_NOTE}: OCR is treated as trusted input; no per-page human quality review was run.",
        },
    }
    pages_index = {
        "schemaVersion": "book-package-ocr-pages-index/v1",
        "bookId": book_id,
        "jobId": book_id,
        "pipelineVersion": OCR_PIPELINE_VERSION,
        "jobRelativePath": job_relative,
        "pageCount": page_count,
        "textPageCount": page_count - len(blank_pages),
        "blankPageCount": len(blank_pages),
        "pages": [
            {
                "pageNo": page_file.page_no,
                "file": page_file.name,
                "kind": page_file.kind,
                "sizeBytes": page_file.size_bytes,
                "sha256": page_file.sha256,
            }
            for page_file in page_files
        ],
    }

    output = output.resolve()
    if output.exists() and not force:
        raise FileExistsError(f"output already exists: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".{book_id}-", dir=output.parent) as temporary:
        staging = Path(temporary) / "package"
        (staging / "assets").mkdir(parents=True)
        (staging / "content").mkdir()
        (staging / "provenance").mkdir()

        write_canonical_json(staging / "content" / "pages.json", {
            "schemaVersion": "book-pages/v2",
            "bookId": book_id,
            "pages": pages,
        })
        write_canonical_json(staging / "content" / "corrections.json", {
            "schemaVersion": "ocr-corrections/v1",
            "bookId": book_id,
            "normalizationVersion": NORMALIZATION_VERSION,
            "corrections": [],
        })
        write_canonical_json(staging / "quality-report.json", quality)
        write_canonical_json(staging / "provenance" / "ocr-pages-index.json", pages_index)
        pages_index_sha256 = sha256_file(staging / "provenance" / "ocr-pages-index.json")

        # `book-package-ocr-source/v2` and `book-package-ocr-report/v2` keep exactly the
        # field sets the application importer already validates. On the trusted path the
        # per-page attestation in ocr-pages-index.json takes the place of a pipeline
        # report, so its hash is recorded as `originalReportSha256`.
        write_canonical_json(staging / "provenance" / "ocr-source.json", {
            "schemaVersion": "book-package-ocr-source/v2",
            "jobId": book_id,
            "sourceSha256": pdf_sha256,
            "pageCount": page_count,
            "renderDpi": row["renderDpi"],
            "modelRoute": OCR_MODEL_ROUTE,
            "pipelineVersion": OCR_PIPELINE_VERSION,
            "createdAt": TRUSTED_BASELINE_AT,
            "originalRecordSha256": row["sourceRecordSha256"],
        })
        write_canonical_json(staging / "provenance" / "ocr-report.json", {
            "schemaVersion": "book-package-ocr-report/v2",
            "jobId": book_id,
            "status": "complete",
            "sourceSha256": pdf_sha256,
            "sourceSizeBytes": pdf_size,
            "pageCount": page_count,
            "completedPages": page_count,
            "failedPages": 0,
            "failedPageNos": [],
            "renderDpi": row["renderDpi"],
            "terminalPageCount": page_count,
            "validation": automatic["structuralChecks"],
            "errorCount": 0,
            "completedAt": TRUSTED_BASELINE_AT,
            "originalReportSha256": pages_index_sha256,
        })
        (staging / "provenance" / "ocr-prompt.md").write_text(PROMPT_PLACEHOLDER, encoding="utf-8", newline="\n")
        write_canonical_json(staging / "provenance" / "trusted-baseline.json", {
            "schemaVersion": "book-package-trusted-baseline/v1",
            "bookId": book_id,
            "versionId": row["versionId"],
            "baselineAt": TRUSTED_BASELINE_AT,
            "statusNote": TRUSTED_STATUS_NOTE,
            "parserVersion": PARSER_VERSION,
            "ocrInput": {
                "pipelineVersion": OCR_PIPELINE_VERSION,
                "jobRelativePath": job_relative,
                "pagesIndex": "provenance/ocr-pages-index.json",
                "readOnly": True,
            },
            "sourcePdf": {
                "relativeRoot": catalog.get("pdfRoot", PDF_ROOT),
                "relativePath": row["sourcePdfRelativePath"],
                "sha256": pdf_sha256,
                "sizeBytes": pdf_size,
                "physicalPageCount": pdf_page_count,
            },
            "pdfIdentityRecord": {
                "relativePath": row["sourceRecordRelativePath"],
                "fileSha256": row["sourceRecordSha256"],
                "recordedPdfSha256": row["recordedPdfSha256"],
                "recordedPdfPageCount": row.get("recordedPdfPageCount"),
                "fieldAliases": row.get("sourceRecordFieldAliases", {}),
            },
            "synthesizedFields": {
                "ocr.modelRoute": f"{OCR_MODEL_ROUTE} — the antigravity job records no model identity.",
                "ocr.coordinateSystem": f"{OCR_COORDINATE_SYSTEM} — no geometry is captured, block boxes are zero and audit-only.",
                "ocr.promptVersion": f"{OCR_PROMPT_VERSION} — no prompt artifact exists, provenance/ocr-prompt.md is a placeholder.",
                "ocr.renderDpi": "Inherited from the archived text-ocr-v1 source record for the same PDF.",
                "createdAt/completedAt": f"{TRUSTED_BASELINE_AT} — fixed trusted-baseline instant, not an OCR run timestamp (keeps builds byte-identical).",
                "originalReportSha256": "SHA-256 of provenance/ocr-pages-index.json; the trusted path has no pipeline report.",
                "page.width/page.height": "Source PDF page size in PDF points, audit-only; runtime block coordinates are zero.",
                "block.confidence": "Fixed 1.0 sentinel; the trusted path carries no per-block confidence signal.",
                "blank pages": "`page-XXXX.blank` placeholders carry no page text by contract, so rawText/normalizedText are empty strings.",
            },
        })

        shutil.copyfile(pdf_path, staging / SOURCE_ASSET)
        if sha256_file(staging / SOURCE_ASSET) != pdf_sha256:
            raise ValueError(f"{book_id}: source PDF copy failed integrity check")
        cover = render_cover(pdf_path, staging / COVER_ASSET)

        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "bookId": book_id,
            "versionId": row["versionId"],
            "title": row["title"],
            "grade": row["grade"],
            "pageCount": page_count,
            "source": {
                "asset": SOURCE_ASSET,
                "mimeType": "application/pdf",
                "sha256": pdf_sha256,
                "sizeBytes": pdf_size,
                "pdfPageCount": pdf_page_count,
            },
            "cover": {
                "asset": COVER_ASSET,
                "mimeType": "image/jpeg",
                "sha256": sha256_file(staging / COVER_ASSET),
                "sizeBytes": (staging / COVER_ASSET).stat().st_size,
                "width": cover["width"],
                "height": cover["height"],
                "sourcePageNo": 1,
            },
            "ocr": {
                "jobId": book_id,
                "modelRoute": OCR_MODEL_ROUTE,
                "coordinateSystem": OCR_COORDINATE_SYSTEM,
                "geometryUsage": "audit-only-estimated",
                "pipelineVersion": OCR_PIPELINE_VERSION,
                "promptVersion": OCR_PROMPT_VERSION,
                "promptAsset": "provenance/ocr-prompt.md",
                "promptSha256": sha256_file(staging / "provenance" / "ocr-prompt.md"),
                "parserVersion": PARSER_VERSION,
                "sourceRecordSha256": sha256_file(staging / "provenance" / "ocr-source.json"),
                "reportSha256": sha256_file(staging / "provenance" / "ocr-report.json"),
            },
            "provenance": {
                "pagesIndex": {"path": "provenance/ocr-pages-index.json", "sha256": pages_index_sha256},
                "trustedBaseline": {
                    "path": "provenance/trusted-baseline.json",
                    "sha256": sha256_file(staging / "provenance" / "trusted-baseline.json"),
                },
            },
            "normalization": {"version": NORMALIZATION_VERSION, "policy": "raw-exact-unless-ledger-reviewed"},
            "content": {"path": "content/pages.json", "sha256": sha256_file(staging / "content" / "pages.json")},
            "corrections": {"path": "content/corrections.json", "sha256": sha256_file(staging / "content" / "corrections.json")},
            "quality": {
                "report": "quality-report.json",
                "sha256": sha256_file(staging / "quality-report.json"),
                "status": TRUSTED_QUALITY_STATUS,
                "statusNote": TRUSTED_STATUS_NOTE,
                "automatic": {"emptyPages": automatic["emptyPages"]},
            },
            "rights": {"usage": TRUSTED_RIGHTS_USAGE},
        }
        write_canonical_json(staging / "manifest.json", manifest)
        assert_no_absolute_paths(staging)

        promote_staging(staging, output)

    return {
        "output": str(output),
        "bookId": book_id,
        "versionId": row["versionId"],
        "title": row["title"],
        "grade": row["grade"],
        "pageCount": page_count,
        "textPageCount": page_count - len(blank_pages),
        "blankPageCount": len(blank_pages),
        "blockCount": automatic["blockCount"],
        "coverWidth": cover["width"],
        "coverHeight": cover["height"],
        "qualityStatus": TRUSTED_QUALITY_STATUS,
        "manifestSha256": sha256_file(output / "manifest.json"),
        "buildSeconds": round(time.perf_counter() - started, 3),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=repo_root() / "book-parser" / "catalog-default-49.json")
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--output", type=Path, help="默认 book-parser/work/package-v2-trusted/<bookId>")
    parser.add_argument("--repo-root", type=Path, default=repo_root())
    parser.add_argument("--force", action="store_true", help="覆盖已存在的输出目录")
    args = parser.parse_args()
    root = args.repo_root.resolve()
    output = args.output or root / "book-parser" / "work" / "package-v2-trusted" / args.book_id
    result = build(args.catalog, args.book_id, output, root, force=args.force)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
