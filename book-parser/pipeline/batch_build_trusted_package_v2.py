#!/usr/bin/env python3
"""Batch driver for trusted book-package/v2 builds (T3.1).

Walks `book-parser/catalog-default-49.json`, builds each book independently via
`build_trusted_package_v2.build`, records per-book success/failure, and writes a
summary table. Failures do not abort the batch; existing successful outputs are
skipped unless `--force` is passed (resume-friendly).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from book_package_v2 import read_json, sha256_file
from build_trusted_package_v2 import build
from trusted_package_v2 import repo_root, scan_ocr_pages
from validate_book_package_v2 import validate


DEFAULT_OUTPUT_ROOT = "book-parser/work/package-v2-trusted"


def catalog_books(catalog_path: Path) -> list[dict[str, Any]]:
    catalog = read_json(catalog_path)
    books = catalog.get("books")
    if not isinstance(books, list) or not books:
        raise ValueError(f"{catalog_path}: books must be a non-empty list")
    return books


def output_dir(root: Path, book_id: str, output_root: Path | None) -> Path:
    base = output_root or root / DEFAULT_OUTPUT_ROOT
    return base / book_id


def package_ready(package: Path) -> bool:
    manifest = package / "manifest.json"
    if not manifest.is_file():
        return False
    report = validate(package)
    return bool(report.get("ok"))


def page_continuity(pages_dir: Path) -> dict[str, Any]:
    try:
        page_files = scan_ocr_pages(pages_dir)
    except Exception as exc:
        return {"contiguous": False, "error": str(exc), "pageNos": []}
    page_nos = [page.page_no for page in page_files]
    expected = list(range(1, len(page_nos) + 1)) if page_nos else []
    return {
        "contiguous": page_nos == expected,
        "pageCount": len(page_nos),
        "firstPageNo": page_nos[0] if page_nos else None,
        "lastPageNo": page_nos[-1] if page_nos else None,
        "pageNos": page_nos,
    }


def summarize_row(
    book: dict[str, Any],
    *,
    status: str,
    actual_page_count: int | None,
    blank_page_count: int | None,
    manifest_sha256: str | None,
    output: str | None,
    build_seconds: float | None,
    error: str | None = None,
    skipped: bool = False,
    page_continuity_ok: bool | None = None,
    catalog_page_mismatch: bool = False,
) -> dict[str, Any]:
    catalog_page_count = book.get("pageCount")
    return {
        "bookId": book["bookId"],
        "title": book.get("title"),
        "status": status,
        "skippedExisting": skipped,
        "catalogPageCount": catalog_page_count,
        "actualPageCount": actual_page_count,
        "catalogPageMismatch": catalog_page_mismatch,
        "blankPageCount": blank_page_count,
        "manifestSha256": manifest_sha256,
        "outputPath": output,
        "buildSeconds": build_seconds,
        "pageContinuityOk": page_continuity_ok,
        "error": error,
    }


def build_one(
    catalog_path: Path,
    book: dict[str, Any],
    root: Path,
    output_root: Path | None,
    force: bool,
    jobs_root: Path,
) -> dict[str, Any]:
    book_id = book["bookId"]
    package = output_dir(root, book_id, output_root)
    pages_dir = jobs_root / book_id / "pages"
    continuity = page_continuity(pages_dir)

    if package.exists() and package_ready(package) and not force:
        manifest = read_json(package / "manifest.json")
        quality = read_json(package / "quality-report.json")
        automatic = quality.get("automatic", {})
        actual = manifest.get("pageCount")
        catalog_count = book.get("pageCount")
        return summarize_row(
            book,
            status="success",
            actual_page_count=actual,
            blank_page_count=automatic.get("blankPageCount"),
            manifest_sha256=sha256_file(package / "manifest.json"),
            output=str(package.relative_to(root)).replace("\\", "/"),
            build_seconds=0.0,
            skipped=True,
            page_continuity_ok=continuity.get("contiguous"),
            catalog_page_mismatch=actual != catalog_count,
        )

    started = time.perf_counter()
    try:
        result = build(catalog_path, book_id, package, root, force=force or package.exists())
        elapsed = round(time.perf_counter() - started, 3)
        actual = result["pageCount"]
        catalog_count = book.get("pageCount")
        return summarize_row(
            book,
            status="success",
            actual_page_count=actual,
            blank_page_count=result["blankPageCount"],
            manifest_sha256=result["manifestSha256"],
            output=str(Path(result["output"]).relative_to(root)).replace("\\", "/"),
            build_seconds=elapsed,
            page_continuity_ok=continuity.get("contiguous"),
            catalog_page_mismatch=actual != catalog_count,
        )
    except Exception as exc:
        elapsed = round(time.perf_counter() - started, 3)
        return summarize_row(
            book,
            status="failed",
            actual_page_count=continuity.get("pageCount"),
            blank_page_count=None,
            manifest_sha256=None,
            output=str(package.relative_to(root)).replace("\\", "/") if package.exists() else None,
            build_seconds=elapsed,
            error=f"{type(exc).__name__}: {exc}",
            page_continuity_ok=continuity.get("contiguous"),
            catalog_page_mismatch=continuity.get("pageCount") != book.get("pageCount"),
        )


def write_summary(summary_path: Path, payload: dict[str, Any]) -> None:
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Batch build trusted book-package/v2 for catalog-default-49")
    parser.add_argument("--catalog", type=Path, default=repo_root() / "book-parser" / "catalog-default-49.json")
    parser.add_argument("--repo-root", type=Path, default=repo_root())
    parser.add_argument("--output-root", type=Path, help=f"default: <repo>/{DEFAULT_OUTPUT_ROOT}")
    parser.add_argument("--force", action="store_true", help="Rebuild even when a valid package already exists")
    parser.add_argument(
        "--summary",
        type=Path,
        help="Write JSON summary (default: docs/product-close-loop/evidence/phase3/t3.1-batch-package-summary.json)",
    )
    parser.add_argument("--book-id", action="append", help="Limit to one or more book ids (repeatable)")
    args = parser.parse_args()

    root = args.repo_root.resolve()
    catalog_path = args.catalog.resolve()
    catalog = read_json(catalog_path)
    jobs_root = root / catalog.get("ocrJobsRoot", "book-parser/work/ocr-antigravity-v1/jobs")
    books = catalog_books(catalog_path)
    if args.book_id:
        wanted = set(args.book_id)
        books = [book for book in books if book.get("bookId") in wanted]
        missing = sorted(wanted - {book.get("bookId") for book in books})
        if missing:
            raise SystemExit(f"unknown book ids: {', '.join(missing)}")

    rows: list[dict[str, Any]] = []
    for book in books:
        rows.append(build_one(catalog_path, book, root, args.output_root, args.force, jobs_root))

    success = sum(1 for row in rows if row["status"] == "success")
    failed = sum(1 for row in rows if row["status"] == "failed")
    skipped = sum(1 for row in rows if row.get("skippedExisting"))

    payload = {
        "task": "T3.1-batch-package",
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "catalog": str(catalog_path.relative_to(root)).replace("\\", "/"),
        "outputRoot": str((args.output_root or root / DEFAULT_OUTPUT_ROOT).relative_to(root)).replace("\\", "/"),
        "force": args.force,
        "totals": {
            "books": len(rows),
            "success": success,
            "failed": failed,
            "skippedExisting": skipped,
        },
        "rows": rows,
    }

    summary_path = args.summary or root / "docs/product-close-loop/evidence/phase3/t3.1-batch-package-summary.json"
    write_summary(summary_path, payload)
    print(json.dumps({"summaryPath": str(summary_path), "totals": payload["totals"]}, ensure_ascii=False))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
