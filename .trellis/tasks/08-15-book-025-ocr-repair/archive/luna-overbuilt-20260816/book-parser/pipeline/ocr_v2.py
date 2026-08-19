#!/usr/bin/env python3
"""Contracts and deterministic helpers for the book-025 OCR v2 calibration.

This module is deliberately independent from the historical text-ocr-v1 job.
It owns validation at the page-work-unit, OCR-attempt, review, state, and
paragraph-projection boundaries.  No function in this module reads historical
OCR page bodies or supplies a fallback OCR/review result.
"""

from __future__ import annotations

import difflib
import hashlib
import json
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


BOOK_ID = "book-025"
SOURCE_PDF_SHA256 = "5c419590e69f1d00d276acd16e157bdb0c8f3e2fc0d25183484cdf65faced6cd"
PHYSICAL_PAGE_COUNT = 162
CALIBRATION_PAGE_NOS = (1, 5, 40, 111, 112, 113, 122, 123, 124, 150, 151, 152)
STRUCTURE_ONLY_PAGE_NO = 162
RENDER_DPI = 200
MODEL_ROUTE = "gpt-5.6-luna"
REASONING_EFFORT = "xhigh"
REVIEW_MODEL = "gemini-3.7-flash-high"
OCR_TASK_THREAD_ID = "01a00612-3bc9-7ad2-8db5-0a8ad32b9a33"
PROMPT_VERSION = "luna-ocr-v2-calibration"
STATE_SCHEMA_VERSION = "ocr-page-state/v1"

REVIEW_FINDING_TYPES = {
    "page-text-mismatch",
    "substantial-omission",
    "cross-page-contamination",
    "duplicate-content",
    "reading-order-error",
    "substantial-addition",
}
REVIEW_SEVERITIES = {"blocking", "major", "minor"}
REVIEW_VERDICTS = {"passed", "failed"}
ATTEMPT_STATUSES = {"ok", "failed"}
PAGE_STATES = {
    "created",
    "ocr_running",
    "ocr_failed",
    "ocr_complete",
    "review_running",
    "review_failed",
    "review_passed",
    "human_review_required",
    "corrected",
    "re_ocr_required",
    "accepted",
}
STATE_TRANSITIONS: dict[str, set[str]] = {
    "created": {"ocr_running"},
    "ocr_running": {"ocr_failed", "ocr_complete"},
    "ocr_failed": {"ocr_running"},
    "ocr_complete": {"review_running", "re_ocr_required"},
    "review_running": {"review_failed", "review_passed"},
    "review_failed": {"human_review_required", "re_ocr_required"},
    "review_passed": {"human_review_required", "accepted"},
    "human_review_required": {"corrected", "re_ocr_required", "accepted"},
    "corrected": {"review_running"},
    "re_ocr_required": {"ocr_running"},
    "accepted": set(),
}


class ContractError(ValueError):
    """Raised when a persisted OCR v2 contract is structurally invalid."""


class ImmutableArtifactError(FileExistsError):
    """Raised when an attempt or frozen work unit would be overwritten."""


class ExternalReviewUnavailable(RuntimeError):
    """Raised when the required Agy review command is unavailable or fails."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def canonical_json(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_json(value: Any) -> str:
    return sha256_bytes(canonical_json(value))


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ContractError(f"{path}: JSON root must be an object")
    return value


def write_json(path: Path, value: Any) -> None:
    """Write a mutable snapshot atomically."""

    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    if temporary.exists():
        raise ImmutableArtifactError(f"temporary snapshot already exists: {temporary}")
    temporary.write_bytes(canonical_json(value))
    os.replace(temporary, path)


def write_immutable_json(path: Path, value: Any) -> str:
    """Write one JSON artifact exactly once and return its byte hash."""

    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise ImmutableArtifactError(f"immutable artifact already exists: {path}")
    payload = canonical_json(value)
    temporary = path.with_name(f".{path.name}.tmp")
    if temporary.exists():
        raise ImmutableArtifactError(f"temporary artifact already exists: {temporary}")
    temporary.write_bytes(payload)
    try:
        os.link(temporary, path)
    except FileExistsError as exc:
        raise ImmutableArtifactError(f"immutable artifact already exists: {path}") from exc
    finally:
        temporary.unlink(missing_ok=True)
    return sha256_bytes(payload)


def persist_deterministic_render(target: Path, rendered_bytes: bytes) -> str:
    """Compare rendered bytes before touching an existing page image."""

    rendered_sha256 = sha256_bytes(rendered_bytes)
    if target.exists():
        existing_bytes = target.read_bytes()
        if existing_bytes != rendered_bytes:
            raise ImmutableArtifactError(f"deterministic render bytes differ: {target}")
        return rendered_sha256
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.render.tmp")
    if temporary.exists():
        raise ImmutableArtifactError(f"temporary render already exists: {temporary}")
    temporary.write_bytes(rendered_bytes)
    try:
        os.link(temporary, target)
    except FileExistsError as exc:
        raise ImmutableArtifactError(f"render target appeared during write: {target}") from exc
    finally:
        temporary.unlink(missing_ok=True)
    return rendered_sha256


def append_jsonl(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as stream:
        stream.write(canonical_json(value).decode("utf-8"))


def _require_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ContractError(f"{label} must be an object")
    return value


def _require_exact_keys(value: dict[str, Any], expected: set[str], label: str, optional: set[str] | None = None) -> None:
    optional = optional or set()
    allowed = expected | optional
    actual = set(value)
    missing = expected - actual
    extra = actual - allowed
    if missing:
        raise ContractError(f"{label} missing fields: {sorted(missing)}")
    if extra:
        raise ContractError(f"{label} has unsupported fields: {sorted(extra)}")


def _require_string(value: Any, label: str, *, nonempty: bool = True) -> str:
    if not isinstance(value, str) or (nonempty and not value):
        raise ContractError(f"{label} must be a non-empty string")
    return value


def _require_sha256(value: Any, label: str) -> str:
    text = _require_string(value, label)
    if len(text) != 64 or any(char not in "0123456789abcdef" for char in text):
        raise ContractError(f"{label} must be a lowercase SHA-256")
    return text


def _require_int(value: Any, label: str, minimum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ContractError(f"{label} must be an integer")
    if minimum is not None and value < minimum:
        raise ContractError(f"{label} must be >= {minimum}")
    return value


def validate_page_work_unit(value: Any) -> dict[str, Any]:
    work_unit = _require_object(value, "page-work-unit")
    _require_exact_keys(
        work_unit,
        {
            "schemaVersion",
            "workUnitId",
            "bookId",
            "pageNo",
            "sourcePdfSha256",
            "imagePath",
            "inputImageSha256",
            "render",
        },
        "page-work-unit",
    )
    if work_unit["schemaVersion"] != "page-work-unit/v1":
        raise ContractError("page-work-unit schemaVersion mismatch")
    if work_unit["bookId"] != BOOK_ID:
        raise ContractError("page-work-unit bookId mismatch")
    page_no = _require_int(work_unit["pageNo"], "page-work-unit.pageNo", 1)
    if page_no > PHYSICAL_PAGE_COUNT or page_no not in CALIBRATION_PAGE_NOS:
        raise ContractError("page-work-unit.pageNo must be one of the 12 calibration pages")
    expected_id = f"{BOOK_ID}-p{page_no:04d}-a01"
    if work_unit["workUnitId"] != expected_id:
        raise ContractError("page-work-unit workUnitId is not derived from the physical page")
    if work_unit["sourcePdfSha256"] != SOURCE_PDF_SHA256:
        raise ContractError("page-work-unit source PDF SHA-256 mismatch")
    image_path = _require_string(work_unit["imagePath"], "page-work-unit.imagePath")
    image_path_obj = Path(image_path)
    if image_path_obj.is_absolute() or ".." in image_path_obj.parts:
        raise ContractError("page-work-unit.imagePath must be a safe relative path")
    _require_sha256(work_unit["inputImageSha256"], "page-work-unit.inputImageSha256")
    render = _require_object(work_unit["render"], "page-work-unit.render")
    _require_exact_keys(render, {"dpi", "width", "height", "rendererVersion"}, "page-work-unit.render")
    if _require_int(render["dpi"], "page-work-unit.render.dpi", 1) != RENDER_DPI:
        raise ContractError("page-work-unit render dpi mismatch")
    _require_int(render["width"], "page-work-unit.render.width", 1)
    _require_int(render["height"], "page-work-unit.render.height", 1)
    _require_string(render["rendererVersion"], "page-work-unit.render.rendererVersion")
    return work_unit


def attempt_output_payload(attempt: dict[str, Any]) -> dict[str, Any]:
    return {
        "bookId": attempt["bookId"],
        "pageNo": attempt["pageNo"],
        "paragraphs": attempt["paragraphs"],
    }


def validate_attempt(value: Any, work_unit: dict[str, Any]) -> dict[str, Any]:
    attempt = _require_object(value, "ocr-page-attempt")
    _require_exact_keys(
        attempt,
        {
            "schemaVersion",
            "attemptId",
            "workUnitId",
            "bookId",
            "pageNo",
            "sourcePdfSha256",
            "inputImageSha256",
            "promptVersion",
            "promptSha256",
            "outputSha256",
            "status",
            "paragraphs",
            "executionTrace",
            "createdAt",
        },
        "ocr-page-attempt",
        optional={"selfReportedPageNo", "failureReason"},
    )
    validate_page_work_unit(work_unit)
    if attempt["schemaVersion"] != "ocr-page-attempt/v2":
        raise ContractError("ocr-page-attempt schemaVersion mismatch")
    if attempt["workUnitId"] != work_unit["workUnitId"]:
        raise ContractError("ocr-page-attempt workUnitId mismatch")
    if attempt["bookId"] != work_unit["bookId"] or attempt["pageNo"] != work_unit["pageNo"]:
        raise ContractError("ocr-page-attempt physical page identity mismatch")
    if attempt["sourcePdfSha256"] != SOURCE_PDF_SHA256:
        raise ContractError("ocr-page-attempt source PDF SHA-256 mismatch")
    if attempt["inputImageSha256"] != work_unit["inputImageSha256"]:
        raise ContractError("ocr-page-attempt input image SHA-256 mismatch")
    if not isinstance(attempt["attemptId"], str) or not attempt["attemptId"].startswith(f"{work_unit['workUnitId']}-attempt-"):
        raise ContractError("ocr-page-attempt attemptId is not bound to its work unit")
    if attempt["status"] not in ATTEMPT_STATUSES:
        raise ContractError("ocr-page-attempt status is invalid")
    _require_string(attempt["promptVersion"], "ocr-page-attempt.promptVersion")
    _require_sha256(attempt["promptSha256"], "ocr-page-attempt.promptSha256")
    _require_sha256(attempt["outputSha256"], "ocr-page-attempt.outputSha256")
    _require_string(attempt["createdAt"], "ocr-page-attempt.createdAt")
    if "selfReportedPageNo" in attempt:
        reported = _require_int(attempt["selfReportedPageNo"], "ocr-page-attempt.selfReportedPageNo", 1)
        if reported != attempt["pageNo"]:
            raise ContractError("self-reported page number does not match the work-unit page")
    paragraphs = attempt["paragraphs"]
    if not isinstance(paragraphs, list):
        raise ContractError("ocr-page-attempt.paragraphs must be an array")
    orders: list[int] = []
    for index, paragraph in enumerate(paragraphs, start=1):
        paragraph = _require_object(paragraph, f"ocr-page-attempt.paragraphs[{index}]")
        _require_exact_keys(paragraph, {"order", "rawText"}, f"ocr-page-attempt.paragraphs[{index}]")
        order = _require_int(paragraph["order"], f"paragraph {index}.order", 1)
        raw_text = _require_string(paragraph["rawText"], f"paragraph {index}.rawText")
        if not raw_text.strip():
            raise ContractError(f"paragraph {index}.rawText must contain visible text")
        if any(key.lower().endswith("bbox") or key.lower() == "bbox" for key in paragraph):
            raise ContractError("ocr-page-attempt paragraphs must not contain bbox data")
        orders.append(order)
    if orders != list(range(1, len(orders) + 1)):
        raise ContractError("ocr-page-attempt paragraph orders must be contiguous")
    if attempt["status"] == "failed":
        if paragraphs:
            raise ContractError("failed OCR attempt cannot carry OCR paragraphs")
        _require_string(attempt.get("failureReason"), "ocr-page-attempt.failureReason")
    elif "failureReason" in attempt:
        raise ContractError("successful OCR attempt cannot carry failureReason")
    trace = _require_object(attempt["executionTrace"], "ocr-page-attempt.executionTrace")
    _require_exact_keys(
        trace,
        {"system", "model", "reasoningEffort", "taskSourceThreadId"},
        "ocr-page-attempt.executionTrace",
        optional={"threadId", "turnId"},
    )
    if trace["system"] != "codex" or trace["model"] != MODEL_ROUTE or trace["reasoningEffort"] != REASONING_EFFORT:
        raise ContractError("OCR execution trace is not the required Luna route")
    _require_string(trace["taskSourceThreadId"], "executionTrace.taskSourceThreadId")
    for field in ("threadId", "turnId"):
        if field in trace:
            _require_string(trace[field], f"executionTrace.{field}")
    expected_output_hash = sha256_json(attempt_output_payload(attempt))
    if attempt["outputSha256"] != expected_output_hash:
        raise ContractError("ocr-page-attempt outputSha256 mismatch")
    return attempt


def project_attempt(attempt: dict[str, Any], work_unit: dict[str, Any], attempt_sha256: str) -> dict[str, Any]:
    validate_attempt(attempt, work_unit)
    if attempt["status"] != "ok":
        raise ContractError("only a successful OCR attempt can be projected")
    _require_sha256(attempt_sha256, "attemptSha256")
    blocks: list[dict[str, Any]] = []
    cursor = 0
    for paragraph in attempt["paragraphs"]:
        text = paragraph["rawText"]
        block = {
            "blockId": f"p{attempt['pageNo']:04d}-b{paragraph['order']:03d}",
            "order": paragraph["order"],
            "rawText": text,
            "normalizedText": text,
            "rawCharStart": cursor,
            "rawCharEnd": cursor + len(text),
            "charStart": cursor,
            "charEnd": cursor + len(text),
        }
        blocks.append(block)
        cursor += len(text)
    return {
        "schemaVersion": "ocr-page-projection/v1",
        "bookId": attempt["bookId"],
        "pageNo": attempt["pageNo"],
        "workUnitId": attempt["workUnitId"],
        "attemptId": attempt["attemptId"],
        "attemptSha256": attempt_sha256,
        "inputImageSha256": work_unit["inputImageSha256"],
        "rawText": "".join(block["rawText"] for block in blocks),
        "normalizedText": "".join(block["normalizedText"] for block in blocks),
        "blocks": blocks,
    }


def validate_gemini_review_output(value: Any) -> dict[str, Any]:
    """Validate the only payload Gemini is allowed to produce."""

    output = _require_object(value, "gemini-review-output")
    _require_exact_keys(output, {"verdict", "findings"}, "gemini-review-output")
    if output["verdict"] not in REVIEW_VERDICTS:
        raise ContractError("gemini-review-output verdict is invalid")
    findings = output["findings"]
    if not isinstance(findings, list):
        raise ContractError("gemini-review-output findings must be an array")
    for index, finding in enumerate(findings, start=1):
        finding = _require_object(finding, f"gemini finding {index}")
        _require_exact_keys(
            finding,
            {"type", "severity", "detail", "imageEvidence", "ocrEvidence"},
            f"gemini finding {index}",
        )
        if finding["type"] not in REVIEW_FINDING_TYPES or finding["severity"] not in REVIEW_SEVERITIES:
            raise ContractError(f"gemini finding {index} type or severity is invalid")
        for field in ("detail", "imageEvidence", "ocrEvidence"):
            _require_string(finding[field], f"gemini finding {index}.{field}")
    if output["verdict"] == "passed" and findings:
        raise ContractError("passed review must have no findings")
    if output["verdict"] == "failed" and not findings:
        raise ContractError("failed review must have at least one finding")
    return output


def build_review_envelope(
    *,
    gemini_output: dict[str, Any],
    work_unit: dict[str, Any],
    attempt_sha256: str,
    review_number: int,
    created_at: str | None = None,
    conversation_id: str | None = None,
) -> dict[str, Any]:
    """Inject trusted local identity and execution metadata around Gemini output."""

    validate_page_work_unit(work_unit)
    validate_gemini_review_output(gemini_output)
    _require_sha256(attempt_sha256, "attemptSha256")
    if isinstance(review_number, bool) or not isinstance(review_number, int) or review_number < 1:
        raise ContractError("review_number must be a positive integer")
    execution_trace: dict[str, Any] = {
        "system": "agy",
        "model": REVIEW_MODEL,
        "mode": "plan",
        "sandbox": True,
    }
    if conversation_id is not None:
        _require_string(conversation_id, "conversationId")
        execution_trace["conversationId"] = conversation_id
    review = {
        "schemaVersion": "ocr-page-review/v1",
        "reviewId": f"{work_unit['workUnitId']}-review-{review_number:04d}",
        "bookId": work_unit["bookId"],
        "pageNo": work_unit["pageNo"],
        "inputImageSha256": work_unit["inputImageSha256"],
        "ocrAttemptSha256": attempt_sha256,
        "verdict": gemini_output["verdict"],
        "findings": gemini_output["findings"],
        "executionTrace": execution_trace,
        "createdAt": created_at or utc_now(),
    }
    return validate_review(review, work_unit, attempt_sha256)


def validate_review(value: Any, work_unit: dict[str, Any], attempt_sha256: str) -> dict[str, Any]:
    review = _require_object(value, "ocr-page-review")
    _require_exact_keys(
        review,
        {
            "schemaVersion",
            "reviewId",
            "bookId",
            "pageNo",
            "inputImageSha256",
            "ocrAttemptSha256",
            "verdict",
            "findings",
            "executionTrace",
            "createdAt",
        },
        "ocr-page-review",
    )
    validate_page_work_unit(work_unit)
    if review["schemaVersion"] != "ocr-page-review/v1":
        raise ContractError("ocr-page-review schemaVersion mismatch")
    if review["bookId"] != work_unit["bookId"] or review["pageNo"] != work_unit["pageNo"]:
        raise ContractError("ocr-page-review physical page identity mismatch")
    if review["inputImageSha256"] != work_unit["inputImageSha256"]:
        raise ContractError("ocr-page-review input image SHA-256 mismatch")
    if review["ocrAttemptSha256"] != attempt_sha256:
        raise ContractError("ocr-page-review OCR attempt SHA-256 mismatch")
    validate_gemini_review_output({"verdict": review["verdict"], "findings": review["findings"]})
    trace = _require_object(review["executionTrace"], "ocr-page-review.executionTrace")
    _require_exact_keys(
        trace,
        {"system", "model", "mode", "sandbox"},
        "ocr-page-review.executionTrace",
        optional={"conversationId"},
    )
    if trace["system"] != "agy" or trace["model"] != REVIEW_MODEL or trace["mode"] != "plan" or trace["sandbox"] is not True:
        raise ContractError("review execution trace is not the required Gemini High route")
    if "conversationId" in trace:
        _require_string(trace["conversationId"], "executionTrace.conversationId")
    _require_string(review["createdAt"], "ocr-page-review.createdAt")
    return review


def validate_state_transition(current: str, target: str) -> None:
    if current not in PAGE_STATES or target not in PAGE_STATES:
        raise ContractError(f"unknown page state transition: {current} -> {target}")
    if target not in STATE_TRANSITIONS[current]:
        raise ContractError(f"invalid page state transition: {current} -> {target}")


def scan_quality_signals(attempts: Iterable[dict[str, Any]], expected_page_nos: Iterable[int]) -> dict[str, Any]:
    """Return audit signals only; never edits or selects OCR text."""

    expected = sorted(set(expected_page_nos))
    by_page: dict[int, dict[str, Any]] = {}
    duplicate_page_nos: list[int] = []
    for attempt in attempts:
        if attempt.get("status") != "ok":
            continue
        page_no = attempt.get("pageNo")
        if page_no in by_page:
            duplicate_page_nos.append(page_no)
        by_page[page_no] = attempt
    missing = [page_no for page_no in expected if page_no not in by_page]
    text_by_page = {
        page_no: "".join(item["rawText"] for item in attempt["paragraphs"])
        for page_no, attempt in sorted(by_page.items())
    }
    exact_groups: dict[str, list[int]] = {}
    for page_no, text in text_by_page.items():
        if not text:
            continue
        exact_groups.setdefault(hashlib.sha256(text.encode("utf-8")).hexdigest(), []).append(page_no)
    exact_duplicate_groups = [pages for pages in exact_groups.values() if len(pages) > 1]
    near_duplicate_pairs: list[dict[str, Any]] = []
    page_items = sorted(text_by_page.items())
    for index, (left_page, left_text) in enumerate(page_items):
        if not left_text:
            continue
        for right_page, right_text in page_items[index + 1 :]:
            if not right_text:
                continue
            ratio = difflib.SequenceMatcher(None, left_text, right_text).ratio()
            if ratio >= 0.85 and left_text != right_text:
                near_duplicate_pairs.append({"pageNos": [left_page, right_page], "ratio": round(ratio, 6)})
    empty_pages = [page_no for page_no, text in text_by_page.items() if not text]
    return {
        "schemaVersion": "ocr-quality-signals/v1",
        "expectedPageNos": expected,
        "observedOkPageNos": sorted(text_by_page),
        "missingPageNos": missing,
        "duplicateAttemptPageNos": sorted(set(duplicate_page_nos)),
        "emptyPageNos": empty_pages,
        "textLengthByPage": {str(page_no): len(text) for page_no, text in sorted(text_by_page.items())},
        "exactDuplicateGroups": exact_duplicate_groups,
        "nearDuplicatePairs": near_duplicate_pairs,
        "requiresHumanReview": bool(missing or duplicate_page_nos or empty_pages or exact_duplicate_groups or near_duplicate_pairs),
        "textSelectionPerformed": False,
    }


def build_agy_review_command(
    *,
    agy_executable: str,
    image_path: Path,
    ocr_review_input_path: Path,
    review_schema_path: Path,
) -> list[str]:
    """Build the only supported external-review invocation."""

    review_prompt = (
        "Review exactly one page-bound OCR result. Read the one image at "
        f"{image_path} and the one narrow OCR review input at {ocr_review_input_path}. "
        "Do not read historical OCR or adjacent pages. Check page mismatch, "
        "substantial omission, cross-page contamination, duplicate content, "
        "reading-order error, and substantial addition. Return only the JSON "
        "object required by the supplied schema. Do not modify the OCR text."
    )
    return [
        agy_executable,
        "--model",
        REVIEW_MODEL,
        "--effort",
        "high",
        "--mode",
        "plan",
        "--sandbox",
        "--output-format",
        "json",
        "--json-schema",
        str(review_schema_path),
        "--add-dir",
        str(image_path.parent),
        "--add-dir",
        str(ocr_review_input_path.parent),
        "--print",
        review_prompt,
    ]


def run_agy_review(
    *,
    agy_executable: str,
    image_path: Path,
    ocr_attempt_path: Path,
    review_schema_path: Path,
    work_unit: dict[str, Any],
    attempt_sha256: str,
    review_output_path: Path,
    review_number: int,
    conversation_id: str | None = None,
) -> dict[str, Any]:
    validate_page_work_unit(work_unit)
    if not image_path.is_file():
        raise ContractError(f"OCR review input image is missing: {image_path}")
    actual_image_sha256 = sha256_file(image_path)
    if actual_image_sha256 != work_unit["inputImageSha256"]:
        raise ContractError("OCR review input image SHA-256 does not match the trusted work unit")
    actual_attempt_sha256 = sha256_file(ocr_attempt_path)
    if actual_attempt_sha256 != attempt_sha256:
        raise ContractError("OCR attempt file SHA-256 does not match the trusted runner input")
    attempt = read_json(ocr_attempt_path)
    validate_attempt(attempt, work_unit)
    narrow_input = {
        "schemaVersion": "ocr-page-review-input/v1",
        "paragraphs": attempt["paragraphs"],
    }
    temporary_input: Path | None = None
    with tempfile.NamedTemporaryFile(
        mode="wb",
        prefix=".ocr-review-input-",
        suffix=".json",
        dir=ocr_attempt_path.parent,
        delete=False,
    ) as stream:
        stream.write(canonical_json(narrow_input))
        temporary_input = Path(stream.name)
    command = build_agy_review_command(
        agy_executable=agy_executable,
        image_path=image_path,
        ocr_review_input_path=temporary_input,
        review_schema_path=review_schema_path,
    )
    try:
        try:
            result = subprocess.run(command, check=False, capture_output=True, text=True)
        except OSError as exc:
            raise ExternalReviewUnavailable(f"required Agy review command unavailable: {exc}") from exc
        if result.returncode != 0:
            raise ExternalReviewUnavailable(f"Agy review failed with exit code {result.returncode}: {result.stderr.strip()}")
        try:
            gemini_output = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise ExternalReviewUnavailable("Agy review did not return structured JSON") from exc
        validate_gemini_review_output(gemini_output)
        review = build_review_envelope(
            gemini_output=gemini_output,
            work_unit=work_unit,
            attempt_sha256=attempt_sha256,
            review_number=review_number,
            conversation_id=conversation_id,
        )
        write_immutable_json(review_output_path, review)
        return review
    finally:
        if temporary_input is not None:
            temporary_input.unlink(missing_ok=True)
