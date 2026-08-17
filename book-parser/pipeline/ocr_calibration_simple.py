#!/usr/bin/env python3
"""Minimal, page-bound OCR calibration storage for book-025."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

import fitz

from review_mineru_calibration import AGY, windows_path


BOOK_ID = "book-025"
ALLOWED_PAGES = frozenset({1, 5, 40, 111, 112, 113, 122, 123, 124, 150, 151, 152})
FROZEN_PDF_SHA256 = "5c419590e69f1d00d276acd16e157bdb0c8f3e2fc0d25183484cdf65faced6cd"
FROZEN_PAGE_COUNT = 162
SCHEMA_VERSION = "ocr-calibration-page/v1"
TEXT_SEPARATOR = "\n\n"
MODEL_BY_KIND = {
    "pipeline-self-test": "gpt-5.6-sol",
    "formal-luna": "gpt-5.6-luna",
    "formal-gemini-low": "gemini-3.7-flash-low",
}
KINDS = frozenset(MODEL_BY_KIND)
RESULT_DIR_BY_KIND = {
    "pipeline-self-test": Path("self-test"),
    "formal-luna": Path("formal"),
    "formal-gemini-low": Path("gemini-low/formal"),
}
GEMINI_LOW_MODEL = MODEL_BY_KIND["formal-gemini-low"]
DEFAULT_WORK_ROOT = Path(__file__).resolve().parents[1] / "work" / "ocr-calibration-simple" / BOOK_ID


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def validate_page_no(page_no: int) -> None:
    if page_no not in ALLOWED_PAGES:
        raise ValueError(f"pageNo {page_no} is not in the book-025 calibration set")


def export_page(source_pdf: Path, page_no: int, work_root: Path, dpi: int = 200) -> dict[str, object]:
    """Export or locate one allowed physical page and return its image binding."""
    validate_page_no(page_no)
    if dpi <= 0:
        raise ValueError("dpi must be positive")
    if not source_pdf.is_file():
        raise FileNotFoundError(source_pdf)

    source_sha256 = sha256_file(source_pdf)
    if source_sha256 != FROZEN_PDF_SHA256:
        raise ValueError(
            f"source PDF SHA-256 mismatch: expected {FROZEN_PDF_SHA256}, got {source_sha256}"
        )

    with fitz.open(source_pdf) as document:
        if document.page_count != FROZEN_PAGE_COUNT:
            raise ValueError(
                f"source PDF page count mismatch: expected {FROZEN_PAGE_COUNT}, got {document.page_count}"
            )

        scale = dpi / 72
        pixmap = document.load_page(page_no - 1).get_pixmap(
            matrix=fitz.Matrix(scale, scale), alpha=False
        )
        rendered_png = pixmap.tobytes("png")

        image_path = work_root / "images" / f"page-{page_no:04d}.png"
        if image_path.exists():
            if not image_path.is_file() or image_path.read_bytes() != rendered_png:
                raise ValueError(
                    f"existing page image does not match freshly rendered PDF bytes: {image_path}"
                )
        else:
            image_path.parent.mkdir(parents=True, exist_ok=True)
            image_path.write_bytes(rendered_png)

    return {
        "bookId": BOOK_ID,
        "pageNo": page_no,
        "imagePath": image_path.relative_to(work_root).as_posix(),
        "imageSha256": sha256_file(image_path),
    }


def _validate_nonempty_string(value: str, field: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")


def save_result(
    *,
    work_root: Path,
    page_no: int,
    expected_image_sha256: str,
    paragraphs: Sequence[str],
    model: str,
    task_id: str,
    kind: str,
) -> tuple[Path, dict[str, object]]:
    """Bind supplied logical paragraphs to an exported page image and save one result."""
    validate_page_no(page_no)
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {sorted(KINDS)}")
    _validate_nonempty_string(model, "model")
    expected_model = MODEL_BY_KIND[kind]
    if model != expected_model:
        raise ValueError(f"kind {kind} requires model {expected_model}, got {model}")
    _validate_nonempty_string(task_id, "taskId")
    if not isinstance(expected_image_sha256, str) or len(expected_image_sha256) != 64:
        raise ValueError("expected imageSha256 must be a 64-character SHA-256 hex digest")
    try:
        int(expected_image_sha256, 16)
    except ValueError as error:
        raise ValueError("expected imageSha256 must be a 64-character SHA-256 hex digest") from error
    if not isinstance(paragraphs, (list, tuple)) or not paragraphs:
        raise ValueError("paragraphs must be a non-empty array")
    for index, paragraph in enumerate(paragraphs):
        _validate_nonempty_string(paragraph, f"paragraphs[{index}]")

    image_path = work_root / "images" / f"page-{page_no:04d}.png"
    if not image_path.is_file():
        raise FileNotFoundError(image_path)
    actual_image_sha256 = sha256_file(image_path)
    if actual_image_sha256 != expected_image_sha256.lower():
        raise ValueError(
            "image SHA-256 mismatch: "
            f"expected {expected_image_sha256.lower()}, got {actual_image_sha256}"
        )

    result_path = work_root / RESULT_DIR_BY_KIND[kind] / f"page-{page_no:04d}.json"
    if result_path.exists():
        raise FileExistsError(f"target result already exists: {result_path}")

    text = TEXT_SEPARATOR.join(paragraphs)
    if not text.strip():
        raise ValueError("OCR text must not be empty")
    result = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": kind,
        "bookId": BOOK_ID,
        "pageNo": page_no,
        "imagePath": image_path.relative_to(work_root).as_posix(),
        "imageSha256": actual_image_sha256,
        "paragraphs": list(paragraphs),
        "textSha256": sha256_text(text),
        "model": model,
        "taskId": task_id,
    }
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return result_path, result


def _validate_direct_ocr_output(value: Any) -> list[str]:
    if not isinstance(value, dict) or set(value) != {"paragraphs"}:
        raise ValueError("Gemini direct OCR output must contain only paragraphs")
    paragraphs = value["paragraphs"]
    if not isinstance(paragraphs, list) or not paragraphs:
        raise ValueError("Gemini direct OCR paragraphs must be a non-empty array")
    for index, paragraph in enumerate(paragraphs):
        _validate_nonempty_string(paragraph, f"paragraphs[{index}]")
    return paragraphs


def _write_json_once(path: Path, value: Any) -> None:
    if path.exists():
        raise FileExistsError(f"refusing to overwrite Gemini OCR evidence: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _next_gemini_failure_path(work_root: Path, page_no: int) -> Path:
    failure_root = work_root / "gemini-low" / "failures"
    attempt = 1
    while True:
        path = failure_root / f"page-{page_no:04d}-attempt-{attempt:02d}.json"
        if not path.exists():
            return path
        attempt += 1


def _gemini_ocr_prompt(image_windows_path: str) -> str:
    return (
        "Transcribe exactly one Chinese book-page image using vision: "
        f"{image_windows_path}. Return only the JSON required by the supplied schema. "
        "This is transcription, not summarization, rewriting, correction, or translation. "
        "Put every meaningful visible reading-content block into paragraphs in natural reading "
        "order. Include story/chapter titles even when they appear near the top like a header; "
        "include meaningful cover labels, editor/author credit, publisher text, table-of-contents "
        "entries, and image captions. Preserve the printed characters, punctuation, simplified "
        "or traditional variants, incomplete first/last lines, and meaningful spaces exactly as "
        "visible. Do not infer hidden or adjacent-page text. Ignore only an isolated printed page "
        "number, a genuinely repeated running book header, and the repeated brand footer "
        "怪叔叔讲故事. Do not output coordinates, explanations, confidence, corrections, or a "
        "second transcription. Do not read any Luna, MinerU, historical OCR, adjacent image, or "
        "other project file."
    )


def run_gemini_low_ocr(*, work_root: Path, page_no: int, schema_path: Path) -> dict[str, Any]:
    validate_page_no(page_no)
    if not AGY.is_file():
        raise FileNotFoundError(AGY)
    if not schema_path.is_file():
        raise FileNotFoundError(schema_path)

    image_path = (work_root / "images" / f"page-{page_no:04d}.png").resolve()
    if not image_path.is_file():
        raise FileNotFoundError(image_path)
    image_sha256 = sha256_file(image_path)

    result_path = work_root / RESULT_DIR_BY_KIND["formal-gemini-low"] / f"page-{page_no:04d}.json"
    raw_path = work_root / "gemini-low" / "raw" / f"page-{page_no:04d}.json"
    provenance_path = work_root / "gemini-low" / "provenance" / f"page-{page_no:04d}.json"
    for target in (result_path, raw_path, provenance_path):
        if target.exists():
            raise FileExistsError(f"Gemini OCR target already exists: {target}")

    image_windows = windows_path(image_path)
    prompt = _gemini_ocr_prompt(image_windows)
    command = [
        str(AGY),
        "--model",
        GEMINI_LOW_MODEL,
        "--effort",
        "low",
        "--mode",
        "plan",
        "--sandbox",
        "--output-format",
        "json",
        "--json-schema",
        windows_path(schema_path),
        "--add-dir",
        windows_path(image_path.parent),
        "--print-timeout",
        "10m",
        "--print",
        prompt,
    ]
    completed = subprocess.run(command, check=False, capture_output=True, text=True, timeout=660)
    if completed.returncode != 0:
        failure_path = _next_gemini_failure_path(work_root, page_no)
        _write_json_once(
            failure_path,
            {
                "pageNo": page_no,
                "imageSha256": image_sha256,
                "exitCode": completed.returncode,
                "stdout": completed.stdout,
                "stderr": completed.stderr,
                "command": command,
            },
        )
        raise RuntimeError(f"Gemini low OCR page {page_no} failed with exit code {completed.returncode}")

    try:
        outer = json.loads(completed.stdout)
        if not isinstance(outer, dict) or outer.get("status") != "SUCCESS":
            raise ValueError("Agy did not return SUCCESS")
        structured = outer.get("structured_output")
        paragraphs = _validate_direct_ocr_output(structured)
        response = outer.get("response")
        if not isinstance(response, str) or not response.strip():
            raise ValueError("Agy display response is missing")
        conversation_id = outer.get("conversation_id")
        duration = outer.get("duration_seconds")
        usage = outer.get("usage")
        if not isinstance(conversation_id, str) or not conversation_id:
            raise ValueError("Agy conversation ID is missing")
        if not isinstance(duration, (int, float)) or duration < 0:
            raise ValueError("Agy duration is invalid")
        if not isinstance(usage, dict):
            raise ValueError("Agy usage is missing")
    except (json.JSONDecodeError, ValueError, TypeError) as error:
        failure_path = _next_gemini_failure_path(work_root, page_no)
        _write_json_once(
            failure_path,
            {
                "pageNo": page_no,
                "imageSha256": image_sha256,
                "exitCode": completed.returncode,
                "stdout": completed.stdout,
                "stderr": completed.stderr,
                "error": str(error),
                "command": command,
            },
        )
        raise RuntimeError(f"Gemini low OCR page {page_no} returned invalid evidence") from error

    _write_json_once(raw_path, outer)
    saved_path, result = save_result(
        work_root=work_root,
        page_no=page_no,
        expected_image_sha256=image_sha256,
        paragraphs=paragraphs,
        model=GEMINI_LOW_MODEL,
        task_id=conversation_id,
        kind="formal-gemini-low",
    )
    provenance = {
        "schemaVersion": "ocr-calibration-gemini-direct/v1",
        "bookId": BOOK_ID,
        "pageNo": page_no,
        "imageSha256": image_sha256,
        "textSha256": result["textSha256"],
        "model": GEMINI_LOW_MODEL,
        "effort": "low",
        "mode": "plan",
        "sandbox": True,
        "conversationId": conversation_id,
        "durationSeconds": duration,
        "usage": usage,
        "promptSha256": sha256_text(prompt),
        "rawResponsePath": raw_path.relative_to(work_root).as_posix(),
        "structuredOutputIsSourceOfTruth": True,
        "resultPath": saved_path.relative_to(work_root).as_posix(),
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    _write_json_once(provenance_path, provenance)
    return provenance


def _load_paragraphs(path: Path) -> list[str]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, list):
        raise ValueError("paragraphs JSON must contain one array of strings")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    export_parser = subparsers.add_parser("export-page", help="export or locate one allowed page")
    export_parser.add_argument("--source-pdf", type=Path, required=True)
    export_parser.add_argument("--page-no", type=int, required=True)
    export_parser.add_argument("--work-root", type=Path, default=DEFAULT_WORK_ROOT)
    export_parser.add_argument("--dpi", type=int, default=200)

    save_parser = subparsers.add_parser("save-result", help="save one page-bound OCR result")
    save_parser.add_argument("--page-no", type=int, required=True)
    save_parser.add_argument("--expected-image-sha256", required=True)
    save_parser.add_argument("--paragraphs-json", type=Path, required=True)
    save_parser.add_argument("--model", required=True)
    save_parser.add_argument("--task-id", required=True)
    save_parser.add_argument("--kind", choices=sorted(KINDS), required=True)
    save_parser.add_argument("--work-root", type=Path, default=DEFAULT_WORK_ROOT)

    gemini_parser = subparsers.add_parser(
        "gemini-low-ocr-page", help="OCR one allowed page with Gemini 3.7 Flash Low"
    )
    gemini_parser.add_argument("--page-no", type=int, required=True)
    gemini_parser.add_argument("--schema", type=Path, required=True)
    gemini_parser.add_argument("--work-root", type=Path, default=DEFAULT_WORK_ROOT)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.command == "export-page":
        output = export_page(args.source_pdf, args.page_no, args.work_root, args.dpi)
    elif args.command == "save-result":
        result_path, result = save_result(
            work_root=args.work_root,
            page_no=args.page_no,
            expected_image_sha256=args.expected_image_sha256,
            paragraphs=_load_paragraphs(args.paragraphs_json),
            model=args.model,
            task_id=args.task_id,
            kind=args.kind,
        )
        output = {"resultPath": str(result_path), **result}
    else:
        output = run_gemini_low_ocr(
            work_root=args.work_root,
            page_no=args.page_no,
            schema_path=args.schema,
        )
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
