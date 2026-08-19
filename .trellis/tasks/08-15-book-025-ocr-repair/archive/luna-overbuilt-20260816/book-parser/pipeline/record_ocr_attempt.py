#!/usr/bin/env python3
"""Record one immutable Luna OCR attempt for exactly one frozen work unit."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from ocr_v2 import (  # noqa: E402
    BOOK_ID,
    ImmutableArtifactError,
    MODEL_ROUTE,
    OCR_TASK_THREAD_ID,
    PROMPT_VERSION,
    REASONING_EFFORT,
    append_jsonl,
    canonical_json,
    project_attempt,
    read_json,
    sha256_file,
    sha256_json,
    utc_now,
    validate_attempt,
    validate_page_work_unit,
    validate_state_transition,
    write_immutable_json,
    write_json,
)


def _read_ledger(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _idempotent_commit(
    *,
    attempt: dict,
    work_unit: dict,
    attempt_path: Path,
    projection_path: Path,
    transaction_dir: Path,
    progress: dict,
    attempt_ledger: list[dict],
) -> dict | None:
    """Return an exact committed result, or raise on an inconsistent duplicate."""

    if not attempt_path.exists() and not projection_path.exists():
        return None
    if not attempt_path.is_file() or not projection_path.is_file():
        raise ImmutableArtifactError("attempt/projection commit is incomplete")
    commit_path = transaction_dir / "commit.json"
    if not commit_path.is_file():
        raise ImmutableArtifactError("attempt/projection commit has no committed transaction marker")
    commit = read_json(commit_path)
    if (
        commit.get("schemaVersion") != "ocr-attempt-transaction/v1"
        or commit.get("status") != "committed"
        or commit.get("attemptId") != attempt["attemptId"]
    ):
        raise ImmutableArtifactError("attempt/projection commit has an invalid transaction marker")
    existing_attempt = read_json(attempt_path)
    validate_attempt(existing_attempt, work_unit)
    expected_attempt_sha256 = sha256_json(attempt)
    if sha256_file(attempt_path) != expected_attempt_sha256 or existing_attempt != attempt:
        raise ImmutableArtifactError("duplicate attempt ID has different immutable content")
    expected_projection = project_attempt(existing_attempt, work_unit, expected_attempt_sha256)
    if projection_path.read_bytes() != canonical_json(expected_projection):
        raise ImmutableArtifactError("duplicate attempt ID has different projection content")
    if commit.get("attemptSha256") != expected_attempt_sha256 or commit.get("projectionSha256") != sha256_file(projection_path):
        raise ImmutableArtifactError("attempt/projection commit has inconsistent transaction hashes")
    matching_entries = [entry for entry in attempt_ledger if entry.get("attemptId") == attempt["attemptId"]]
    if len(matching_entries) != 1 or matching_entries[0].get("attemptSha256") != expected_attempt_sha256:
        raise ImmutableArtifactError("duplicate attempt ID has an inconsistent attempt ledger")
    page_state = progress.get("pageStates", {}).get(str(work_unit["pageNo"]))
    progress_entry = progress.get("attempts", {}).get(str(work_unit["pageNo"]))
    if page_state != "ocr_complete" or not isinstance(progress_entry, dict) or progress_entry.get("attemptSha256") != expected_attempt_sha256:
        raise ImmutableArtifactError("duplicate attempt ID has an inconsistent progress snapshot")
    return {
        "pageNo": work_unit["pageNo"],
        "attemptId": attempt["attemptId"],
        "attemptSha256": expected_attempt_sha256,
        "projection": str(projection_path),
        "idempotent": True,
    }


def record(args: argparse.Namespace) -> dict:
    job_dir = args.job_dir.resolve()
    work_unit = read_json(args.work_unit)
    validate_page_work_unit(work_unit)
    if work_unit["bookId"] != BOOK_ID:
        raise ValueError("attempt recorder only accepts book-025 work units")
    if args.ocr_task_thread_id != OCR_TASK_THREAD_ID:
        raise ValueError("ocr task threadId does not match the assigned Luna task")
    if not args.paragraph:
        raise ValueError("a successful OCR attempt requires at least one visible paragraph")

    # Read and validate progress before creating any attempt, transaction, or ledger file.
    progress_path = job_dir / "progress.json"
    progress = read_json(progress_path)
    page_states = progress.get("pageStates")
    if not isinstance(page_states, dict):
        raise ValueError("progress.pageStates must be an object")
    current_state = page_states.get(str(work_unit["pageNo"]))
    attempt_path = job_dir / "attempts" / f"page-{work_unit['pageNo']:04d}" / f"attempt-{args.attempt_number:04d}.json"
    projection_path = job_dir / "projections" / f"page-{work_unit['pageNo']:04d}.json"
    transaction_dir = job_dir / "transactions" / f"{work_unit['workUnitId']}-attempt-{args.attempt_number:04d}"
    attempt_ledger_path = job_dir / "attempt-ledger.jsonl"
    attempt_ledger = _read_ledger(attempt_ledger_path)

    paragraphs = [{"order": index, "rawText": text} for index, text in enumerate(args.paragraph, start=1)]
    attempt = {
        "schemaVersion": "ocr-page-attempt/v2",
        "attemptId": f"{work_unit['workUnitId']}-attempt-{args.attempt_number:04d}",
        "workUnitId": work_unit["workUnitId"],
        "bookId": work_unit["bookId"],
        "pageNo": work_unit["pageNo"],
        "sourcePdfSha256": work_unit["sourcePdfSha256"],
        "inputImageSha256": work_unit["inputImageSha256"],
        "promptVersion": PROMPT_VERSION,
        "promptSha256": sha256_file(args.prompt),
        "outputSha256": "",
        "status": "ok",
        "paragraphs": paragraphs,
        "executionTrace": {
            "system": "codex",
            "model": MODEL_ROUTE,
            "reasoningEffort": REASONING_EFFORT,
            "taskSourceThreadId": args.task_source_thread_id,
            "threadId": args.ocr_task_thread_id,
        },
        "createdAt": args.created_at or utc_now(),
    }
    attempt["outputSha256"] = sha256_json({"bookId": attempt["bookId"], "pageNo": attempt["pageNo"], "paragraphs": attempt["paragraphs"]})
    validate_attempt(attempt, work_unit)

    existing = _idempotent_commit(
        attempt=attempt,
        work_unit=work_unit,
        attempt_path=attempt_path,
        projection_path=projection_path,
        transaction_dir=transaction_dir,
        progress=progress,
        attempt_ledger=attempt_ledger,
    )
    if existing is not None:
        return existing
    if current_state != "created":
        raise ValueError(f"page {work_unit['pageNo']} is not ready for its first OCR attempt: {current_state}")
    validate_state_transition(current_state, "ocr_running")
    validate_state_transition("ocr_running", "ocr_complete")
    if any(entry.get("attemptId") == attempt["attemptId"] or entry.get("pageNo") == work_unit["pageNo"] for entry in attempt_ledger):
        raise ImmutableArtifactError("duplicate or inconsistent attempt ledger entry")
    if attempt_path.exists() or projection_path.exists():
        raise ImmutableArtifactError("attempt or projection path already exists with no exact committed record")
    if transaction_dir.exists():
        raise ImmutableArtifactError("an unfinished OCR attempt transaction already exists")

    # Stage all immutable page artifacts first. The commit marker is written last;
    # verify_ocr_v2_job.py rejects any transaction without that marker.
    transaction_dir.mkdir(parents=True, exist_ok=False)
    staged_attempt_path = transaction_dir / "attempt.json"
    staged_projection_path = transaction_dir / "projection.json"
    staged_attempt_sha256 = write_immutable_json(staged_attempt_path, attempt)
    projection = project_attempt(attempt, work_unit, staged_attempt_sha256)
    staged_projection_sha256 = write_immutable_json(staged_projection_path, projection)
    write_immutable_json(transaction_dir / "intent.json", {
        "schemaVersion": "ocr-attempt-transaction/v1",
        "attemptId": attempt["attemptId"],
        "attemptSha256": staged_attempt_sha256,
        "projectionSha256": staged_projection_sha256,
        "stateFrom": "created",
        "stateTo": "ocr_complete",
        "status": "prepared",
    })

    attempt_path.parent.mkdir(parents=True, exist_ok=True)
    projection_path.parent.mkdir(parents=True, exist_ok=True)
    os.link(staged_attempt_path, attempt_path)
    os.link(staged_projection_path, projection_path)
    append_jsonl(job_dir / "state-ledger.jsonl", {"schemaVersion": "ocr-page-state/v1", "event": "state-transition", "pageNo": work_unit["pageNo"], "from": "created", "to": "ocr_running", "attemptId": attempt["attemptId"], "transactionId": attempt["attemptId"], "at": utc_now()})
    append_jsonl(job_dir / "state-ledger.jsonl", {"schemaVersion": "ocr-page-state/v1", "event": "state-transition", "pageNo": work_unit["pageNo"], "from": "ocr_running", "to": "ocr_complete", "attemptId": attempt["attemptId"], "transactionId": attempt["attemptId"], "at": utc_now()})
    append_jsonl(job_dir / "attempt-ledger.jsonl", {"schemaVersion": "ocr-attempt-ledger/v1", "attemptId": attempt["attemptId"], "workUnitId": attempt["workUnitId"], "pageNo": attempt["pageNo"], "attemptPath": str(attempt_path.relative_to(job_dir)).replace("\\", "/"), "attemptSha256": staged_attempt_sha256, "projectionPath": str(projection_path.relative_to(job_dir)).replace("\\", "/"), "projectionSha256": staged_projection_sha256, "outputSha256": attempt["outputSha256"], "status": attempt["status"], "model": MODEL_ROUTE, "reasoningEffort": REASONING_EFFORT, "threadId": OCR_TASK_THREAD_ID, "transactionId": attempt["attemptId"], "at": utc_now()})
    progress["pageStates"][str(work_unit["pageNo"])] = "ocr_complete"
    progress["attempts"][str(work_unit["pageNo"])] = {"attemptId": attempt["attemptId"], "attemptSha256": staged_attempt_sha256, "attemptPath": str(attempt_path.relative_to(job_dir)).replace("\\", "/"), "projectionPath": str(projection_path.relative_to(job_dir)).replace("\\", "/"), "projectionSha256": staged_projection_sha256, "transactionId": attempt["attemptId"]}
    write_json(progress_path, progress)
    write_immutable_json(transaction_dir / "commit.json", {
        "schemaVersion": "ocr-attempt-transaction/v1",
        "attemptId": attempt["attemptId"],
        "attemptSha256": staged_attempt_sha256,
        "projectionSha256": staged_projection_sha256,
        "stateFrom": "created",
        "stateTo": "ocr_complete",
        "status": "committed",
        "committedAt": utc_now(),
    })
    return {"pageNo": work_unit["pageNo"], "attemptId": attempt["attemptId"], "attemptSha256": staged_attempt_sha256, "projection": str(projection_path), "idempotent": False}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-dir", type=Path, required=True)
    parser.add_argument("--work-unit", type=Path, required=True)
    parser.add_argument("--prompt", type=Path, required=True)
    parser.add_argument("--attempt-number", type=int, required=True)
    parser.add_argument("--task-source-thread-id", required=True)
    parser.add_argument("--ocr-task-thread-id", required=True)
    parser.add_argument("--created-at")
    parser.add_argument("--paragraph", action="append", required=True)
    args = parser.parse_args()
    if args.attempt_number < 1:
        raise ValueError("attempt-number must be positive")
    print(record(args))


if __name__ == "__main__":
    main()
