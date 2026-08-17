#!/usr/bin/env python3
"""Validate every immutable file and runtime invariant in a book-package/v2 directory."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pypdf import PdfReader

from book_package_v2 import NORMALIZATION_VERSION, SCHEMA_VERSION, read_json, sha256_file
from trusted_package_v2 import TRUSTED_QUALITY_STATUS, TRUSTED_RIGHTS_USAGE, utf16_length


QUALITY_STATUSES = {"human-review-pending", "human-review-failed", "passed", TRUSTED_QUALITY_STATUS}
RIGHTS_USAGES = {"internal-pilot-only", TRUSTED_RIGHTS_USAGE}
# Additive manifest keys: required on the trusted-baseline path, absent from the
# legacy human-reviewed packages.
TRUSTED_MANIFEST_FIELDS = {"grade", "cover", "provenance"}


def validate(package: Path, require_passed: bool = False) -> dict:
    package = package.resolve()
    errors: list[str] = []
    manifest_path = package / "manifest.json"
    if not manifest_path.is_file():
        return {"ok": False, "errors": ["missing manifest.json"]}
    manifest = read_json(manifest_path)
    required = {"schemaVersion", "bookId", "versionId", "title", "pageCount", "source", "ocr", "normalization", "content", "corrections", "quality", "rights"}
    quality_manifest = manifest.get("quality") if isinstance(manifest.get("quality"), dict) else {}
    trusted = quality_manifest.get("status") == TRUSTED_QUALITY_STATUS
    fields = set(manifest)
    if not required <= fields or fields - required - TRUSTED_MANIFEST_FIELDS:
        errors.append("manifest fields do not match book-package/v2")
    if trusted and not TRUSTED_MANIFEST_FIELDS <= fields:
        errors.append(f"{TRUSTED_QUALITY_STATUS} manifest must carry grade, cover and provenance")
    if manifest.get("schemaVersion") != SCHEMA_VERSION:
        errors.append("manifest schemaVersion mismatch")
    grade = manifest.get("grade")
    if "grade" in manifest and (isinstance(grade, bool) or not isinstance(grade, int) or not 1 <= grade <= 6):
        errors.append("manifest grade must be an integer between 1 and 6")
    page_count = manifest.get("pageCount")
    if isinstance(page_count, bool) or not isinstance(page_count, int) or page_count <= 0:
        errors.append("manifest pageCount is invalid")
        page_count = 0
    if manifest.get("normalization") != {"version": NORMALIZATION_VERSION, "policy": "raw-exact-unless-ledger-reviewed"}:
        errors.append("normalization contract mismatch")
    if not isinstance(manifest.get("rights"), dict) or set(manifest["rights"]) != {"usage"} or manifest["rights"]["usage"] not in RIGHTS_USAGES:
        errors.append("rights contract mismatch")
    if quality_manifest.get("status") not in QUALITY_STATUSES:
        errors.append("quality status is not a known book-package/v2 status")
    if trusted:
        if not isinstance(quality_manifest.get("statusNote"), str) or not quality_manifest["statusNote"]:
            errors.append(f"{TRUSTED_QUALITY_STATUS} manifest requires a quality.statusNote")
        mirrored = quality_manifest.get("automatic")
        if not isinstance(mirrored, dict) or not isinstance(mirrored.get("emptyPages"), list):
            errors.append(f"{TRUSTED_QUALITY_STATUS} manifest requires quality.automatic.emptyPages")
        cover = manifest.get("cover")
        if not isinstance(cover, dict) or cover.get("asset") != "assets/cover.jpg" or cover.get("mimeType") != "image/jpeg":
            errors.append("cover entry must point at assets/cover.jpg as image/jpeg")
        elif any(isinstance(cover.get(field), bool) or not isinstance(cover.get(field), int) or cover[field] < 1
                 for field in ("sizeBytes", "width", "height", "sourcePageNo")):
            errors.append("cover sizeBytes/width/height/sourcePageNo must be positive integers")
        elif (package / "assets" / "cover.jpg").is_file() and (package / "assets" / "cover.jpg").stat().st_size != cover["sizeBytes"]:
            errors.append("cover size mismatch")
    if manifest.get("ocr", {}).get("geometryUsage") != "audit-only-estimated":
        errors.append("OCR geometry must be audit-only-estimated")
    expected_ocr_fields = {
        "jobId", "modelRoute", "coordinateSystem", "geometryUsage", "pipelineVersion",
        "promptVersion", "promptAsset", "promptSha256", "parserVersion",
        "sourceRecordSha256", "reportSha256",
    }
    ocr = manifest.get("ocr", {})
    if not isinstance(ocr, dict) or set(ocr) != expected_ocr_fields:
        errors.append("OCR provenance fields do not match book-package/v2")
    elif ocr.get("promptAsset") != "provenance/ocr-prompt.md":
        errors.append("OCR prompt artifact path mismatch")

    file_records = [
        (manifest.get("source", {}).get("asset"), manifest.get("source", {}).get("sha256"), "source"),
        (manifest.get("content", {}).get("path"), manifest.get("content", {}).get("sha256"), "content"),
        (manifest.get("corrections", {}).get("path"), manifest.get("corrections", {}).get("sha256"), "corrections"),
        (manifest.get("quality", {}).get("report"), manifest.get("quality", {}).get("sha256"), "quality"),
        ("provenance/ocr-source.json", manifest.get("ocr", {}).get("sourceRecordSha256"), "OCR source record"),
        ("provenance/ocr-report.json", manifest.get("ocr", {}).get("reportSha256"), "OCR report"),
        (manifest.get("ocr", {}).get("promptAsset"), manifest.get("ocr", {}).get("promptSha256"), "OCR prompt"),
    ]
    if trusted:
        provenance = manifest.get("provenance") if isinstance(manifest.get("provenance"), dict) else {}
        for key, label in (("pagesIndex", "OCR pages index"), ("trustedBaseline", "trusted baseline record")):
            record = provenance.get(key) if isinstance(provenance.get(key), dict) else {}
            file_records.append((record.get("path"), record.get("sha256"), label))
        file_records.append((manifest.get("cover", {}).get("asset"), manifest.get("cover", {}).get("sha256"), "cover"))
    for relative, expected_hash, label in file_records:
        if not isinstance(relative, str) or relative.startswith("/") or ".." in Path(relative).parts:
            errors.append(f"{label} path is unsafe")
            continue
        path = package / relative
        if not path.is_file():
            errors.append(f"missing {label} file: {relative}")
        elif sha256_file(path) != expected_hash:
            errors.append(f"{label} SHA-256 mismatch")

    source_provenance_path = package / "provenance" / "ocr-source.json"
    report_provenance_path = package / "provenance" / "ocr-report.json"
    if source_provenance_path.is_file():
        source_provenance = read_json(source_provenance_path)
        source_fields = {
            "schemaVersion", "jobId", "sourceSha256", "pageCount", "renderDpi",
            "modelRoute", "pipelineVersion", "createdAt", "originalRecordSha256",
        }
        if (set(source_provenance) != source_fields
                or source_provenance.get("schemaVersion") != "book-package-ocr-source/v2"
                or source_provenance.get("jobId") != manifest.get("bookId")
                or source_provenance.get("sourceSha256") != manifest.get("source", {}).get("sha256")
                or source_provenance.get("pageCount") != page_count
                or source_provenance.get("modelRoute") != ocr.get("modelRoute")
                or source_provenance.get("pipelineVersion") != ocr.get("pipelineVersion")):
            errors.append("sanitized OCR source provenance mismatch")
    if report_provenance_path.is_file():
        report_provenance = read_json(report_provenance_path)
        report_fields = {
            "schemaVersion", "jobId", "status", "sourceSha256", "sourceSizeBytes",
            "pageCount", "completedPages", "failedPages", "failedPageNos", "renderDpi",
            "terminalPageCount", "validation", "errorCount", "completedAt", "originalReportSha256",
        }
        validation = report_provenance.get("validation")
        if (set(report_provenance) != report_fields
                or report_provenance.get("schemaVersion") != "book-package-ocr-report/v2"
                or report_provenance.get("jobId") != manifest.get("bookId")
                or report_provenance.get("status") != "complete"
                or report_provenance.get("sourceSha256") != manifest.get("source", {}).get("sha256")
                or report_provenance.get("sourceSizeBytes") != manifest.get("source", {}).get("sizeBytes")
                or report_provenance.get("pageCount") != page_count
                or report_provenance.get("completedPages") != page_count
                or report_provenance.get("terminalPageCount") != page_count
                or report_provenance.get("failedPages") != 0
                or report_provenance.get("failedPageNos") != []
                or report_provenance.get("errorCount") != 0
                or not isinstance(validation, dict)
                or not validation
                or not all(value is True for value in validation.values())):
            errors.append("sanitized OCR report provenance mismatch")

    source_path = package / "assets" / "source.pdf"
    if source_path.is_file():
        if source_path.stat().st_size != manifest.get("source", {}).get("sizeBytes"):
            errors.append("source PDF size mismatch")
        try:
            actual_pdf_pages = len(PdfReader(str(source_path)).pages)
            if actual_pdf_pages != page_count or actual_pdf_pages != manifest.get("source", {}).get("pdfPageCount"):
                errors.append("source PDF physical page count mismatch")
        except Exception as exc:
            errors.append(f"source PDF cannot be parsed: {exc}")

    content_path = package / "content" / "pages.json"
    pages = []
    if content_path.is_file():
        content = read_json(content_path)
        if content.get("schemaVersion") != "book-pages/v2" or content.get("bookId") != manifest.get("bookId"):
            errors.append("content identity mismatch")
        pages = content.get("pages")
        if not isinstance(pages, list):
            errors.append("content pages must be an array")
            pages = []
    if len(pages) != page_count:
        errors.append("content/manifest page count mismatch")
    for expected_no, page in enumerate(pages, start=1):
        if not isinstance(page, dict) or page.get("pageNo") != expected_no:
            errors.append(f"physical page sequence mismatch at {expected_no}")
            continue
        printed_page_label = page.get("printedPageLabel")
        if "printedPageLabel" not in page or (printed_page_label is not None
                and (not isinstance(printed_page_label, str) or not 1 <= len(printed_page_label) <= 64)):
            errors.append(f"page {expected_no}: printedPageLabel must be explicit null or a bounded string")
        blocks = page.get("blocks")
        if not isinstance(blocks, list):
            errors.append(f"page {expected_no}: blocks must be an array")
            continue
        raw_cursor = 0
        normalized_cursor = 0
        for expected_order, block in enumerate(blocks, start=1):
            raw_text = block.get("rawText")
            normalized_text = block.get("normalizedText")
            expected_id = f"p{expected_no:04d}-b{expected_order:03d}"
            if block.get("blockId") != expected_id or block.get("order") != expected_order:
                errors.append(f"page {expected_no}: unstable block identity/order at {expected_order}")
            if not isinstance(raw_text, str) or not isinstance(normalized_text, str):
                errors.append(f"page {expected_no} block {expected_order}: text fields must be strings")
                continue
            # Offsets are counted in UTF-16 code units, matching the application
            # importer and the browser selection anchors.
            if (block.get("rawCharStart"), block.get("rawCharEnd")) != (raw_cursor, raw_cursor + utf16_length(raw_text)):
                errors.append(f"page {expected_no} block {expected_order}: raw offsets mismatch")
            if (block.get("charStart"), block.get("charEnd")) != (normalized_cursor, normalized_cursor + utf16_length(normalized_text)):
                errors.append(f"page {expected_no} block {expected_order}: normalized offsets mismatch")
            if block.get("sourceGeometry", {}).get("usage") != "audit-only":
                errors.append(f"page {expected_no} block {expected_order}: geometry usage mismatch")
            raw_cursor += utf16_length(raw_text)
            normalized_cursor += utf16_length(normalized_text)
        if page.get("rawText") != "".join(block.get("rawText", "") for block in blocks):
            errors.append(f"page {expected_no}: rawText projection mismatch")
        if page.get("normalizedText") != "".join(block.get("normalizedText", "") for block in blocks):
            errors.append(f"page {expected_no}: normalizedText projection mismatch")

    quality_path = package / "quality-report.json"
    if quality_path.is_file():
        quality = read_json(quality_path)
        status = manifest.get("quality", {}).get("status")
        if quality.get("status") != status or quality.get("bookId") != manifest.get("bookId") or quality.get("versionId") != manifest.get("versionId"):
            errors.append("quality report identity/status mismatch")
        if quality.get("automatic", {}).get("pageCount") != page_count:
            errors.append("quality report page count mismatch")
        if quality.get("automatic", {}).get("failedPages") != []:
            errors.append("quality report contains failed pages")
        if quality.get("automatic", {}).get("runtimeDependsOnGeometry") is not False:
            errors.append("quality report permits runtime geometry dependency")
        if trusted:
            report_empty_pages = quality.get("automatic", {}).get("emptyPages")
            if not isinstance(report_empty_pages, list) or report_empty_pages != quality_manifest.get("automatic", {}).get("emptyPages"):
                errors.append("manifest quality.automatic.emptyPages does not mirror the quality report")
                report_empty_pages = []
            blank_pages = quality.get("automatic", {}).get("blankPages")
            if not isinstance(blank_pages, list) or not set(blank_pages) <= set(report_empty_pages):
                errors.append("trusted quality report blankPages must be a subset of emptyPages")
            if quality.get("statusNote") != quality_manifest.get("statusNote"):
                errors.append("quality report statusNote does not mirror the manifest")
        if require_passed:
            review = quality.get("humanReview")
            if status != "passed":
                errors.append("package has not passed human review")
            elif not isinstance(review, dict) or review.get("status") != "passed":
                errors.append("quality report does not contain a passed human review")
            else:
                sample_pages = review.get("samplePages")
                required_pages = review.get("requiredReviewPages")
                minimum = min(30, page_count)
                valid_sample_shape = isinstance(sample_pages, list) and all(
                    not isinstance(page, bool) and isinstance(page, int) for page in sample_pages
                )
                if not valid_sample_shape or len(set(sample_pages)) != len(sample_pages) or len(sample_pages) < minimum:
                    errors.append(f"passed human review requires at least {minimum} unique sample pages")
                    sample_pages = []
                if any(isinstance(page, bool) or not isinstance(page, int) or page < 1 or page > page_count for page in sample_pages):
                    errors.append("human review samplePages contain invalid physical pages")
                if not isinstance(required_pages, list) or any(page not in sample_pages for page in required_pages):
                    errors.append("passed human review omitted required review pages")
                    required_pages = []
                automatic_required = set(quality.get("automatic", {}).get("emptyPages", []))
                automatic_required.update(item.get("pageNo") for item in quality.get("automatic", {}).get("lowConfidenceBlocks", []) if isinstance(item, dict))
                if not automatic_required.issubset(set(required_pages)):
                    errors.append("passed human review omitted empty or low-confidence physical pages")
                if any(not isinstance(review.get(field), str) or not review[field] for field in ("reviewer", "reviewedAt", "evidencePath")):
                    errors.append("passed human review lacks reviewer, reviewedAt, or evidencePath")
                findings = review.get("findings")
                if not isinstance(findings, list) or any(isinstance(item, dict) and item.get("severity") == "blocking" for item in findings):
                    errors.append("passed human review contains invalid or blocking findings")
    result = {"ok": not errors, "bookId": manifest.get("bookId"), "versionId": manifest.get("versionId"), "grade": manifest.get("grade"), "pageCount": page_count, "qualityStatus": quality_manifest.get("status"), "manifestSha256": sha256_file(manifest_path), "errors": errors}
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("package", type=Path)
    parser.add_argument("--require-passed", action="store_true")
    args = parser.parse_args()
    result = validate(args.package, args.require_passed)
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    if not result["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
