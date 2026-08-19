#!/usr/bin/env python3
"""Verify the frozen calibration job without accepting or repairing content."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ocr_v2 import (  # noqa: E402
    CALIBRATION_PAGE_NOS,
    OCR_TASK_THREAD_ID,
    PHYSICAL_PAGE_COUNT,
    SOURCE_PDF_SHA256,
    STRUCTURE_ONLY_PAGE_NO,
    read_json,
    sha256_file,
    validate_attempt,
    validate_page_work_unit,
    write_json,
)


PAGE1_ATTEMPT_ID = "book-025-p0001-a01-attempt-0001"
PAGE1_ATTEMPT_SHA256 = "5b30fa58cc1f1a488418e30f3d142ddf0897139e9d9d779c082e975ef241f72d"
TASK_SOURCE_THREAD_ID = "01a004d4-9af6-7652-bdce-5bc955278230"


def verify(job_dir: Path) -> dict[str, object]:
    errors: list[str] = []
    source = read_json(job_dir / "source.json")
    if source.get("sourcePdfSha256") != SOURCE_PDF_SHA256:
        errors.append("source PDF SHA-256 mismatch")
    if source.get("pageCount") != PHYSICAL_PAGE_COUNT:
        errors.append("source physical page count mismatch")
    render = read_json(job_dir / "render" / "render-manifest.json")
    render_pages = {item.get("pageNo"): item for item in render.get("pages", [])}
    expected_render_pages = set(CALIBRATION_PAGE_NOS) | {STRUCTURE_ONLY_PAGE_NO}
    if set(render_pages) != expected_render_pages:
        errors.append("render manifest must contain exactly 12 calibration pages plus structure page 162")
    for page_no, item in render_pages.items():
        image_path = job_dir / item["image"]
        if not image_path.is_file() or sha256_file(image_path) != item.get("sha256"):
            errors.append(f"page {page_no} render image hash mismatch")
    work_units: dict[int, dict[str, object]] = {}
    for page_no in CALIBRATION_PAGE_NOS:
        path = job_dir / "work-units" / f"page-{page_no:04d}.json"
        if not path.is_file():
            errors.append(f"missing work unit page {page_no}")
            continue
        work_unit = read_json(path)
        try:
            validate_page_work_unit(work_unit)
        except ValueError as exc:
            errors.append(str(exc))
        work_units[page_no] = work_unit
        if sha256_file(job_dir / work_unit["imagePath"]) != work_unit["inputImageSha256"]:
            errors.append(f"page {page_no} work-unit input image hash mismatch")
    if (job_dir / "work-units" / f"page-{STRUCTURE_ONLY_PAGE_NO:04d}.json").exists():
        errors.append("physical page 162 must not have an OCR work unit")
    structure_check_path = job_dir / "structure-page-0162.json"
    if not structure_check_path.is_file():
        errors.append("missing physical page 162 structure-only check")
    else:
        structure_check = read_json(structure_check_path)
        if structure_check.get("pageNo") != STRUCTURE_ONLY_PAGE_NO or structure_check.get("sourcePdfSha256") != SOURCE_PDF_SHA256:
            errors.append("physical page 162 structure check identity mismatch")
        if structure_check.get("ocrAttemptCreated") is not False:
            errors.append("physical page 162 must not have an OCR attempt")
    attempt_ledger = job_dir / "attempt-ledger.jsonl"
    attempts = []
    if attempt_ledger.is_file():
        for line in attempt_ledger.read_text(encoding="utf-8").splitlines():
            if line.strip():
                attempts.append(json.loads(line))
    for ledger in attempts:
        path = job_dir / ledger["attemptPath"]
        if not path.is_file():
            errors.append(f"missing attempt file {ledger['attemptPath']}")
            continue
        actual_sha = sha256_file(path)
        if actual_sha != ledger.get("attemptSha256"):
            errors.append(f"attempt hash mismatch {ledger['attemptId']}")
        work_unit = work_units.get(ledger["pageNo"])
        if work_unit is None:
            errors.append(f"attempt outside calibration set {ledger['pageNo']}")
            continue
        try:
            validate_attempt(read_json(path), work_unit)
        except ValueError as exc:
            errors.append(str(exc))

    transaction_root = job_dir / "transactions"
    transactions = []
    if transaction_root.is_dir():
        for transaction_dir in sorted(path for path in transaction_root.iterdir() if path.is_dir()):
            transactions.append(transaction_dir.name)
            commit_path = transaction_dir / "commit.json"
            intent_path = transaction_dir / "intent.json"
            staged_attempt_path = transaction_dir / "attempt.json"
            staged_projection_path = transaction_dir / "projection.json"
            if not commit_path.is_file():
                errors.append(f"unfinished OCR transaction {transaction_dir.name}")
                continue
            if not intent_path.is_file() or not staged_attempt_path.is_file() or not staged_projection_path.is_file():
                errors.append(f"committed OCR transaction is missing staged artifacts {transaction_dir.name}")
                continue
            commit = read_json(commit_path)
            if commit.get("schemaVersion") != "ocr-attempt-transaction/v1" or commit.get("status") != "committed":
                errors.append(f"invalid OCR transaction commit marker {transaction_dir.name}")
            if commit.get("attemptId") != transaction_dir.name:
                errors.append(f"OCR transaction attemptId mismatch {transaction_dir.name}")
            if sha256_file(staged_attempt_path) != commit.get("attemptSha256"):
                errors.append(f"OCR transaction attempt hash mismatch {transaction_dir.name}")
            if sha256_file(staged_projection_path) != commit.get("projectionSha256"):
                errors.append(f"OCR transaction projection hash mismatch {transaction_dir.name}")

    audit_path = job_dir / "provenance-audit-ledger.jsonl"
    audit_events = []
    if not audit_path.is_file():
        errors.append("missing provenance audit ledger")
    else:
        for line in audit_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                audit_events.append(json.loads(line))
        matching_audits = [event for event in audit_events if event.get("attemptId") == PAGE1_ATTEMPT_ID]
        if len(matching_audits) != 1:
            errors.append("page 1 immutable attempt must have exactly one provenance correction audit event")
        else:
            audit = matching_audits[0]
            if (
                audit.get("schemaVersion") != "ocr-provenance-audit/v1"
                or audit.get("eventType") != "provenance-correction"
                or audit.get("bookId") != "book-025"
                or audit.get("pageNo") != 1
                or audit.get("attemptSha256") != PAGE1_ATTEMPT_SHA256
                or audit.get("taskSourceThreadId") != TASK_SOURCE_THREAD_ID
                or audit.get("actualOcrTaskThreadId") != OCR_TASK_THREAD_ID
                or audit.get("artifactFieldModified") is not False
            ):
                errors.append("page 1 provenance correction audit event is invalid")
        page1_attempt_path = job_dir / "attempts" / "page-0001" / "attempt-0001.json"
        if not page1_attempt_path.is_file() or sha256_file(page1_attempt_path) != PAGE1_ATTEMPT_SHA256:
            errors.append("page 1 immutable attempt SHA-256 changed")
    result = {
        "ok": not errors,
        "jobId": "book-025",
        "physicalPageCount": source.get("pageCount"),
        "workUnitCount": len(work_units),
        "attemptCount": len(attempts),
        "transactionCount": len(transactions),
        "provenanceAuditEventCount": len(audit_events),
        "ocrPageNos": sorted({item.get("pageNo") for item in attempts}),
        "structureOnlyPageNo": STRUCTURE_ONLY_PAGE_NO,
        "errors": errors,
    }
    write_json(job_dir / "verification.json", result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("job_dir", type=Path)
    args = parser.parse_args()
    result = verify(args.job_dir.resolve())
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    if not result["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
