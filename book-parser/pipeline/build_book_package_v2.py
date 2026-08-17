#!/usr/bin/env python3
"""Build a deterministic dual-mode reader package from one frozen pilot OCR job."""

from __future__ import annotations

import argparse
import shutil
import tempfile
from pathlib import Path

from pypdf import PdfReader

from book_package_v2 import (
    NORMALIZATION_VERSION,
    SCHEMA_VERSION,
    automatic_quality,
    normalize_corrections,
    normalize_ocr_page,
    read_json,
    sha256_file,
    validate_corrections_applied,
    write_canonical_json,
)


def model_route(source_record: dict, report: dict) -> str:
    value = source_record.get("modelRoute") or source_record.get("model") or report.get("modelRoute")
    if not isinstance(value, str) or not value:
        raise ValueError("OCR source record does not contain a model route")
    return value


def required_config_text(book: dict, field: str) -> str:
    value = book.get(field)
    if not isinstance(value, str) or not value:
        raise ValueError(f"pilot catalog {field} is required")
    return value


def sanitized_provenance(book: dict, source_record: dict, report: dict, source_hash: str, source_record_path: Path, report_path: Path) -> tuple[dict, dict]:
    route = model_route(source_record, report)
    job_id = source_record.get("jobId")
    if not isinstance(job_id, str) or job_id != book.get("bookId") or report.get("jobId") != job_id:
        raise ValueError("OCR source/report jobId does not match the pilot book")
    render_dpi = source_record.get("renderDpi")
    if isinstance(render_dpi, bool) or not isinstance(render_dpi, int) or render_dpi <= 0:
        raise ValueError("OCR source record renderDpi is invalid")
    validation = report.get("validation")
    if not isinstance(validation, dict) or any(not isinstance(key, str) or not isinstance(value, bool) for key, value in validation.items()):
        raise ValueError("OCR report validation must be a boolean object")
    failed_page_nos = report.get("failedPageNos")
    errors = report.get("errors")
    if not isinstance(failed_page_nos, list) or not isinstance(errors, list):
        raise ValueError("OCR report failedPageNos/errors must be arrays")
    source = {
        "schemaVersion": "book-package-ocr-source/v2",
        "jobId": job_id,
        "sourceSha256": source_hash,
        "pageCount": int(source_record.get("pageCount", 0)),
        "renderDpi": render_dpi,
        "modelRoute": route,
        "pipelineVersion": required_config_text(book, "ocrPipelineVersion"),
        "createdAt": source_record.get("createdAt"),
        "originalRecordSha256": sha256_file(source_record_path),
    }
    if not isinstance(source["createdAt"], str) or not source["createdAt"]:
        raise ValueError("OCR source record createdAt is required")
    sanitized_report = {
        "schemaVersion": "book-package-ocr-report/v2",
        "jobId": job_id,
        "status": report.get("status"),
        "sourceSha256": source_hash,
        "sourceSizeBytes": int(report.get("sourceSizeBytes", 0)),
        "pageCount": int(report.get("pageCount", 0)),
        "completedPages": int(report.get("completedPages", 0)),
        "failedPages": int(report.get("failedPages", -1)),
        "failedPageNos": failed_page_nos,
        "renderDpi": int(report.get("renderDpi", 0)),
        "terminalPageCount": int(report.get("terminalPageCount", 0)),
        "validation": validation,
        "errorCount": len(errors),
        "completedAt": report.get("completedAt"),
        "originalReportSha256": sha256_file(report_path),
    }
    if (sanitized_report["status"] != "complete"
            or not isinstance(sanitized_report["completedAt"], str)
            or sanitized_report["failedPageNos"]
            or sanitized_report["errorCount"] != 0
            or not sanitized_report["validation"]
            or not all(sanitized_report["validation"].values())):
        raise ValueError("OCR report status/completedAt is invalid")
    return source, sanitized_report


def validate_human_review(review: dict, book_id: str, page_count: int) -> dict:
    if review.get("schemaVersion") != "book-package-human-review/v1" or review.get("bookId") != book_id:
        raise ValueError("human review schemaVersion/bookId mismatch")
    status = review.get("status")
    sample_pages = review.get("samplePages")
    if status not in {"pending", "failed", "passed"} or not isinstance(sample_pages, list):
        raise ValueError("human review status/samplePages is invalid")
    if len(set(sample_pages)) != len(sample_pages) or any(isinstance(page, bool) or not isinstance(page, int) or not 1 <= page <= page_count for page in sample_pages):
        raise ValueError("human review samplePages must be unique physical page numbers")
    required_pages = review.get("requiredReviewPages")
    if not isinstance(required_pages, list) or any(page not in sample_pages for page in required_pages):
        raise ValueError("all requiredReviewPages must be present in samplePages")
    findings = review.get("findings", [])
    if not isinstance(findings, list) or any(not isinstance(item, dict) for item in findings):
        raise ValueError("human review findings must be an array of objects")
    if status in {"failed", "passed"}:
        if len(sample_pages) < 30:
            raise ValueError("a completed human review requires at least 30 sampled pages")
        for field in ("reviewer", "reviewedAt", "evidencePath"):
            if not isinstance(review.get(field), str) or not review[field]:
                raise ValueError(f"a completed human review requires {field}")
    if status == "failed" and not findings:
        raise ValueError("a failed human review requires at least one finding")
    return {
        "schemaVersion": "book-package-human-review/v1",
        "bookId": book_id,
        "status": status,
        "samplePages": sorted(sample_pages),
        "requiredReviewPages": sorted(required_pages),
        "reviewer": review.get("reviewer"),
        "reviewedAt": review.get("reviewedAt"),
        "evidencePath": review.get("evidencePath"),
        "notes": review.get("notes", ""),
        "findings": findings,
    }


def build(config_path: Path, book_id: str, output: Path, corrections_path: Path | None, review_path: Path | None) -> dict:
    parser_root = config_path.resolve().parent
    config = read_json(config_path)
    matches = [book for book in config.get("books", []) if book.get("bookId") == book_id]
    if len(matches) != 1:
        raise ValueError(f"pilot config must contain exactly one {book_id}")
    book = matches[0]
    if not isinstance(book.get("coordinateSystem"), str) or not book["coordinateSystem"]:
        raise ValueError("pilot catalog coordinateSystem is required")
    source_pdf = parser_root / book["sourcePdf"]
    ocr_job = parser_root / book["ocrJob"]
    source_record_path = ocr_job / "source.json"
    report_path = ocr_job / "report.json"
    prompt_path = parser_root / required_config_text(book, "promptArtifact")
    if not source_pdf.is_file() or not source_record_path.is_file() or not report_path.is_file() or not prompt_path.is_file():
        raise FileNotFoundError("pilot source PDF, OCR provenance, or prompt artifact is missing")
    expected_pages = int(book["pageCount"])
    actual_source_hash = sha256_file(source_pdf)
    if actual_source_hash != book["sourceSha256"]:
        raise ValueError("source PDF SHA-256 does not match the frozen pilot catalog")
    pdf_pages = len(PdfReader(str(source_pdf)).pages)
    if pdf_pages != expected_pages:
        raise ValueError(f"source PDF has {pdf_pages} pages; expected {expected_pages}")
    source_record = read_json(source_record_path)
    report = read_json(report_path)
    if source_record.get("sourceSha256") != actual_source_hash or int(source_record.get("pageCount", 0)) != expected_pages:
        raise ValueError("OCR source record does not match the frozen source PDF")
    if (report.get("sourceSha256") != actual_source_hash
            or int(report.get("sourceSizeBytes", 0)) != source_pdf.stat().st_size
            or int(report.get("failedPages", -1)) != 0
            or int(report.get("pageCount", 0)) != expected_pages
            or int(report.get("completedPages", 0)) != expected_pages
            or int(report.get("terminalPageCount", 0)) != expected_pages):
        raise ValueError("OCR report is not a zero-failure complete job")
    source_provenance, report_provenance = sanitized_provenance(
        book, source_record, report, actual_source_hash, source_record_path, report_path,
    )

    default_corrections = {
        "schemaVersion": "ocr-corrections/v1",
        "bookId": book_id,
        "normalizationVersion": NORMALIZATION_VERSION,
        "corrections": [],
    }
    corrections, correction_ledger = normalize_corrections(read_json(corrections_path) if corrections_path else default_corrections, book_id)
    pages = []
    for page_no in range(1, expected_pages + 1):
        page_path = ocr_job / "pages" / f"{page_no:04d}.json"
        if not page_path.is_file():
            raise FileNotFoundError(f"missing OCR page {page_no}: {page_path}")
        pages.append(normalize_ocr_page(read_json(page_path), page_no, corrections))
    validate_corrections_applied(corrections, pages)
    review = validate_human_review(
        read_json(review_path) if review_path else {
            "schemaVersion": "book-package-human-review/v1",
            "bookId": book_id,
            "status": "pending",
            "samplePages": [],
            "requiredReviewPages": [],
        },
        book_id,
        expected_pages,
    )
    quality_status = {
        "pending": "human-review-pending",
        "failed": "human-review-failed",
        "passed": "passed",
    }[review["status"]]
    quality = {
        "schemaVersion": "book-package-quality/v2",
        "bookId": book_id,
        "versionId": book["versionId"],
        "automatic": automatic_quality(pages),
        "humanReview": review,
        "status": quality_status,
    }
    if quality["automatic"]["emptyPages"] and quality_status == "passed":
        missing = sorted(set(quality["automatic"]["emptyPages"]) - set(review["requiredReviewPages"]))
        if missing:
            raise ValueError(f"passed review omitted empty pages: {missing}")
    if quality["automatic"]["lowConfidenceBlocks"] and quality_status == "passed":
        low_pages = {item["pageNo"] for item in quality["automatic"]["lowConfidenceBlocks"]}
        missing = sorted(low_pages - set(review["requiredReviewPages"]))
        if missing:
            raise ValueError(f"passed review omitted low-confidence pages: {missing}")

    output = output.resolve()
    if output.exists():
        raise FileExistsError(f"output already exists: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".{book_id}-", dir=output.parent) as temp_name:
        staging = Path(temp_name) / "package"
        (staging / "assets").mkdir(parents=True)
        (staging / "content").mkdir()
        (staging / "provenance").mkdir()
        shutil.copyfile(source_pdf, staging / "assets" / "source.pdf")
        write_canonical_json(staging / "content" / "pages.json", {"schemaVersion": "book-pages/v2", "bookId": book_id, "pages": pages})
        write_canonical_json(staging / "content" / "corrections.json", correction_ledger)
        write_canonical_json(staging / "quality-report.json", quality)
        write_canonical_json(staging / "provenance" / "ocr-source.json", source_provenance)
        write_canonical_json(staging / "provenance" / "ocr-report.json", report_provenance)
        shutil.copyfile(prompt_path, staging / "provenance" / "ocr-prompt.md")
        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "bookId": book_id,
            "versionId": book["versionId"],
            "title": book["title"],
            "pageCount": expected_pages,
            "source": {
                "asset": "assets/source.pdf",
                "mimeType": "application/pdf",
                "sha256": actual_source_hash,
                "sizeBytes": source_pdf.stat().st_size,
                "pdfPageCount": pdf_pages,
            },
            "ocr": {
                "jobId": str(source_record.get("jobId")),
                "modelRoute": model_route(source_record, report),
                "coordinateSystem": book["coordinateSystem"],
                "geometryUsage": "audit-only-estimated",
                "pipelineVersion": required_config_text(book, "ocrPipelineVersion"),
                "promptVersion": required_config_text(book, "promptVersion"),
                "promptAsset": "provenance/ocr-prompt.md",
                "promptSha256": sha256_file(staging / "provenance" / "ocr-prompt.md"),
                "parserVersion": required_config_text(book, "packageBuilderVersion"),
                "sourceRecordSha256": sha256_file(staging / "provenance" / "ocr-source.json"),
                "reportSha256": sha256_file(staging / "provenance" / "ocr-report.json"),
            },
            "normalization": {"version": NORMALIZATION_VERSION, "policy": "raw-exact-unless-ledger-reviewed"},
            "content": {"path": "content/pages.json", "sha256": sha256_file(staging / "content" / "pages.json")},
            "corrections": {"path": "content/corrections.json", "sha256": sha256_file(staging / "content" / "corrections.json")},
            "quality": {"report": "quality-report.json", "sha256": sha256_file(staging / "quality-report.json"), "status": quality_status},
            "rights": {"usage": "internal-pilot-only"},
        }
        write_canonical_json(staging / "manifest.json", manifest)
        staging.rename(output)
    return {"output": str(output), "bookId": book_id, "pageCount": expected_pages, "qualityStatus": quality_status, "manifestSha256": sha256_file(output / "manifest.json")}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=Path(__file__).resolve().parents[1] / "pilot-books.json")
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--corrections", type=Path)
    parser.add_argument("--human-review", type=Path)
    args = parser.parse_args()
    import json
    print(json.dumps(build(args.config, args.book_id, args.output, args.corrections, args.human_review), ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
