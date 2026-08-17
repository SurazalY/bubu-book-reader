#!/usr/bin/env python3
"""Run independent Agy Gemini reviews for frozen MinerU calibration pages."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ALLOWED_PAGES = frozenset({1, 5, 40, 111, 112, 113, 122, 123, 124, 150, 151, 152})
AGY = Path("/mnt/c/Users/Yak/AppData/Local/agy/bin/agy.exe")
MODEL = "gemini-3.7-flash-high"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def windows_path(path: Path) -> str:
    result = subprocess.run(
        ["wslpath", "-w", str(path.resolve())],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not result.stdout.strip():
        raise RuntimeError(f"wslpath failed for {path}: {result.stderr.strip()}")
    return result.stdout.strip()


def validate_finding(finding: Any, index: int) -> None:
    if not isinstance(finding, dict) or set(finding) != {"type", "severity", "detail"}:
        raise ValueError(f"finding {index} does not match the review schema")
    if finding["type"] not in {
        "page-text-mismatch",
        "substantial-omission",
        "cross-page-contamination",
        "duplicate-content",
        "reading-order-error",
        "substantial-addition",
        "text-error",
    }:
        raise ValueError(f"finding {index} type is invalid")
    if finding["severity"] not in {"blocking", "major", "minor"}:
        raise ValueError(f"finding {index} severity is invalid")
    if not isinstance(finding["detail"], str) or not finding["detail"].strip():
        raise ValueError(f"finding {index} detail is empty")


def validate_review_output(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {"verdict", "findings"}:
        raise ValueError("Gemini structured output does not match the review schema")
    if value["verdict"] not in {"passed", "failed"} or not isinstance(value["findings"], list):
        raise ValueError("Gemini verdict or findings is invalid")
    for index, finding in enumerate(value["findings"]):
        validate_finding(finding, index)
    if value["verdict"] == "passed" and value["findings"]:
        raise ValueError("passed review cannot contain findings")
    if value["verdict"] == "failed" and not value["findings"]:
        raise ValueError("failed review must contain at least one finding")
    return value


def prompt_for(image_path: str, formal_path: str) -> str:
    return (
        "Review exactly one frozen, page-bound OCR result. Use view_image to inspect "
        f"{image_path} and read only {formal_path} as the OCR candidate. "
        "Candidate reading text is the paragraphs/text field. Do not read adjacent pages, "
        "historical OCR, Luna output, or any other OCR result. Check every meaningful visible "
        "reading-content character and reading order, including titles and image captions. "
        "Ignore only the printed page number, repeated running header, and repeated brand footer "
        "怪叔叔讲故事. Check page mismatch, substantial omission, cross-page contamination, "
        "duplicate content, reading-order error, substantial addition, and local text errors. "
        "Use blocking for wrong-page/cross-page failures, major for substantial or meaning-changing "
        "errors, and minor for local character/punctuation errors. verdict must be passed only when "
        "there is no OCR difference except the explicitly ignored auxiliary text. Return only the "
        "JSON required by the supplied schema; do not provide corrected full text and do not modify any file."
    )


def write_once(path: Path, value: Any) -> None:
    if path.exists():
        raise FileExistsError(f"refusing to overwrite review evidence: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run_page(work_root: Path, schema_path: Path, page_no: int) -> dict[str, Any]:
    formal_path = work_root / "formal" / f"page-{page_no:04d}.json"
    formal = load_json(formal_path)
    if formal.get("pageNo") != page_no:
        raise ValueError(f"formal page identity mismatch: {formal_path}")
    text = formal.get("text")
    if not isinstance(text, str) or not text.strip() or sha256_text(text) != formal.get("textSha256"):
        raise ValueError(f"formal text hash mismatch: {formal_path}")
    image_path = (work_root / formal["imagePath"]).resolve()
    if not image_path.is_file() or sha256_file(image_path) != formal.get("imageSha256"):
        raise ValueError(f"review image hash mismatch: {image_path}")

    review_path = work_root / "reviews" / f"page-{page_no:04d}.json"
    raw_path = work_root / "reviews" / "raw" / f"page-{page_no:04d}.json"
    failure_path = work_root / "review-failures" / f"page-{page_no:04d}-attempt-01.json"
    for target in (review_path, raw_path, failure_path):
        if target.exists():
            raise FileExistsError(f"review target already exists: {target}")

    image_windows = windows_path(image_path)
    formal_windows = windows_path(formal_path)
    schema_windows = windows_path(schema_path)
    prompt = prompt_for(image_windows, formal_windows)
    command = [
        str(AGY),
        "--model",
        MODEL,
        "--effort",
        "high",
        "--mode",
        "plan",
        "--sandbox",
        "--output-format",
        "json",
        "--json-schema",
        schema_windows,
        "--add-dir",
        windows_path(image_path.parent),
        "--add-dir",
        windows_path(formal_path.parent),
        "--print-timeout",
        "10m",
        "--print",
        prompt,
    ]
    result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=660)
    if result.returncode != 0:
        write_once(
            failure_path,
            {
                "pageNo": page_no,
                "exitCode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "command": command,
            },
        )
        raise RuntimeError(f"Agy page {page_no} failed with exit code {result.returncode}")

    try:
        outer = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        write_once(
            failure_path,
            {"pageNo": page_no, "exitCode": 0, "stdout": result.stdout, "stderr": result.stderr},
        )
        raise RuntimeError(f"Agy page {page_no} returned invalid JSON") from error
    write_once(raw_path, outer)
    if not isinstance(outer, dict) or outer.get("status") != "SUCCESS":
        raise RuntimeError(f"Agy page {page_no} did not return SUCCESS")
    structured = validate_review_output(outer.get("structured_output"))
    response = outer.get("response")
    if not isinstance(response, str) or validate_review_output(json.loads(response)) != structured:
        raise ValueError(f"Agy page {page_no} response and structured_output differ")
    conversation_id = outer.get("conversation_id")
    duration = outer.get("duration_seconds")
    usage = outer.get("usage")
    if not isinstance(conversation_id, str) or not conversation_id:
        raise ValueError(f"Agy page {page_no} conversation ID is missing")
    if not isinstance(duration, (int, float)) or duration < 0:
        raise ValueError(f"Agy page {page_no} duration is invalid")
    if not isinstance(usage, dict):
        raise ValueError(f"Agy page {page_no} usage is missing")

    envelope = {
        "schemaVersion": "ocr-calibration-review/v1",
        "pageNo": page_no,
        "imageSha256": formal["imageSha256"],
        "textSha256": formal["textSha256"],
        "reviewer": "agy",
        "model": MODEL,
        "effort": "high",
        "mode": "plan",
        "sandbox": True,
        "conversationId": conversation_id,
        "durationSeconds": duration,
        "usage": usage,
        "verdict": structured["verdict"],
        "findings": structured["findings"],
        "promptSha256": sha256_text(prompt),
        "reviewedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "rawResponsePath": raw_path.relative_to(work_root).as_posix(),
    }
    write_once(review_path, envelope)
    return envelope


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-root", type=Path, required=True)
    parser.add_argument("--schema", type=Path, required=True)
    parser.add_argument("--pages", type=int, nargs="+", required=True)
    args = parser.parse_args()
    if not AGY.is_file():
        raise FileNotFoundError(AGY)
    if not args.schema.is_file():
        raise FileNotFoundError(args.schema)
    if len(args.pages) != len(set(args.pages)) or not set(args.pages).issubset(ALLOWED_PAGES):
        raise ValueError("review pages must be unique members of the fixed 12-page set")
    summaries = []
    for page_no in args.pages:
        review = run_page(args.work_root, args.schema, page_no)
        summaries.append(
            {
                "pageNo": page_no,
                "verdict": review["verdict"],
                "findings": len(review["findings"]),
                "conversationId": review["conversationId"],
            }
        )
        print(json.dumps(summaries[-1], ensure_ascii=False), flush=True)
    print(json.dumps({"reviewed": summaries}, ensure_ascii=False))


if __name__ == "__main__":
    main()
