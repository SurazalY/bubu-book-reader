#!/usr/bin/env python3
"""Freeze the book-025 12-page OCR v2 calibration inputs.

This command is intentionally hard-coded to the approved calibration set. It
renders those 12 pages plus physical page 162 for structure-only inspection;
it never creates a 162-page OCR work set.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

try:
    import fitz
except ImportError as exc:  # pragma: no cover - exercised by environment setup
    raise SystemExit("PyMuPDF is required for deterministic OCR page rendering") from exc

from ocr_v2 import (  # noqa: E402
    BOOK_ID,
    CALIBRATION_PAGE_NOS,
    MODEL_ROUTE,
    PHYSICAL_PAGE_COUNT,
    PROMPT_VERSION,
    REASONING_EFFORT,
    RENDER_DPI,
    REVIEW_MODEL,
    SOURCE_PDF_SHA256,
    STATE_SCHEMA_VERSION,
    STRUCTURE_ONLY_PAGE_NO,
    append_jsonl,
    canonical_json,
    persist_deterministic_render,
    sha256_bytes,
    sha256_file,
    utc_now,
    validate_page_work_unit,
    write_json,
    write_immutable_json,
)


DEFAULT_AGY = "/mnt/c/Users/Yak/AppData/Local/agy/bin/agy.exe"
REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE_RELATIVE = Path("book-parser/input/快乐读书吧1-6年级阅读全本/快乐读书吧4年级/快乐读书吧部编版配套阅读 世界神话传说 .pdf")


def check_agy(agy_executable: Path) -> dict[str, object]:
    if not agy_executable.is_file():
        raise RuntimeError(f"required Agy CLI is missing: {agy_executable}")
    result = subprocess.run([str(agy_executable), "models"], check=False, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Agy model listing failed with exit code {result.returncode}: {result.stderr.strip()}")
    model_lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if not any(line.split("\t", 1)[0] == REVIEW_MODEL for line in model_lines):
        raise RuntimeError(f"required Agy model not listed: {REVIEW_MODEL}")
    return {
        "executable": str(agy_executable),
        "modelListingCommand": [str(agy_executable), "models"],
        "modelListed": REVIEW_MODEL,
        "modelListingSha256": sha256_bytes(result.stdout.encode("utf-8")),
        "modelListingLines": model_lines,
        "requiredEffort": "high",
        "mode": "plan",
        "sandbox": True,
    }


def git_snapshot() -> dict[str, str]:
    def git(*args: str) -> str:
        result = subprocess.run(["git", *args], cwd=REPO_ROOT, check=False, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
        return result.stdout.strip()

    return {"branch": git("branch", "--show-current"), "head": git("rev-parse", "HEAD")}


def render_page(document: fitz.Document, page_no: int, target: Path, dpi: int) -> dict[str, object]:
    page = document.load_page(page_no - 1)
    scale = dpi / 72
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    rendered_bytes = pixmap.tobytes("png")
    existing_hash = persist_deterministic_render(target, rendered_bytes)
    return {
        "pageNo": page_no,
        "role": "structure-only" if page_no == STRUCTURE_ONLY_PAGE_NO else "calibration",
        "image": f"render/page-{page_no:04d}.png",
        "sha256": existing_hash,
        "width": pixmap.width,
        "height": pixmap.height,
        "dpi": dpi,
        "coordinateSystem": "pixel, origin=top-left",
        "pdfRectPt": {"width": round(page.rect.width, 3), "height": round(page.rect.height, 3)},
    }


def write_or_verify_immutable(path: Path, value: object) -> str:
    """Resume only when an interrupted write left the exact same artifact."""

    expected = canonical_json(value)
    if path.exists():
        actual = path.read_bytes()
        if actual != expected:
            raise RuntimeError(f"existing immutable artifact differs: {path}")
        return sha256_bytes(actual)
    return write_immutable_json(path, value)


def freeze(args: argparse.Namespace) -> None:
    source = (REPO_ROOT / SOURCE_RELATIVE).resolve()
    job_dir = (REPO_ROOT / args.job_dir).resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    if args.dpi != RENDER_DPI:
        raise ValueError(f"calibration render DPI is fixed at {RENDER_DPI}")
    source_sha256 = sha256_file(source)
    if source_sha256 != SOURCE_PDF_SHA256:
        raise ValueError("source PDF SHA-256 does not match the frozen value")
    agy = check_agy(Path(args.agy_executable))
    git_state = git_snapshot()
    document = fitz.open(source)
    if document.page_count != PHYSICAL_PAGE_COUNT:
        raise ValueError(f"source PDF physical page count must be {PHYSICAL_PAGE_COUNT}")

    all_render_pages = [*CALIBRATION_PAGE_NOS, STRUCTURE_ONLY_PAGE_NO]
    render_root = job_dir / "render"
    render_entries = [render_page(document, page_no, render_root / f"page-{page_no:04d}.png", args.dpi) for page_no in all_render_pages]
    renderer_version = f"PyMuPDF {fitz.VersionBind}; MuPDF {fitz.mupdf_version}"
    render_manifest = {
        "schemaVersion": "ocr-render-manifest/v2",
        "bookId": BOOK_ID,
        "sourcePdf": str(SOURCE_RELATIVE).replace("\\", "/"),
        "sourcePdfSha256": source_sha256,
        "pageCount": document.page_count,
        "renderDpi": args.dpi,
        "rendererVersion": renderer_version,
        "pages": render_entries,
        "calibrationPageNos": list(CALIBRATION_PAGE_NOS),
        "structureOnlyPageNo": STRUCTURE_ONLY_PAGE_NO,
    }
    write_json(job_dir / "render" / "render-manifest.json", render_manifest)

    source_record = {
        "schemaVersion": "ocr-v2-source/v1",
        "jobId": BOOK_ID,
        "sourcePdf": str(SOURCE_RELATIVE).replace("\\", "/"),
        "sourcePdfSha256": source_sha256,
        "pageCount": document.page_count,
        "renderDpi": args.dpi,
        "model": MODEL_ROUTE,
        "reasoningEffort": REASONING_EFFORT,
        "promptVersion": PROMPT_VERSION,
        "calibrationPageNos": list(CALIBRATION_PAGE_NOS),
        "structureOnlyPageNo": STRUCTURE_ONLY_PAGE_NO,
        "historicalOcrReadForPrompt": False,
        "createdAt": utc_now(),
    }
    source_path = job_dir / "source.json"
    if source_path.exists():
        existing_source = json.loads(source_path.read_text(encoding="utf-8"))
        if isinstance(existing_source, dict) and isinstance(existing_source.get("createdAt"), str):
            source_record["createdAt"] = existing_source["createdAt"]
    write_or_verify_immutable(source_path, source_record)

    work_unit_dir = job_dir / "work-units"
    for entry in render_entries:
        if entry["role"] != "calibration":
            continue
        page_no = int(entry["pageNo"])
        work_unit = {
            "schemaVersion": "page-work-unit/v1",
            "workUnitId": f"{BOOK_ID}-p{page_no:04d}-a01",
            "bookId": BOOK_ID,
            "pageNo": page_no,
            "sourcePdfSha256": source_sha256,
            "imagePath": str(entry["image"]),
            "inputImageSha256": entry["sha256"],
            "render": {
                "dpi": args.dpi,
                "width": entry["width"],
                "height": entry["height"],
                "rendererVersion": renderer_version,
            },
        }
        validate_page_work_unit(work_unit)
        write_or_verify_immutable(work_unit_dir / f"page-{page_no:04d}.json", work_unit)

    progress = {
        "schemaVersion": "ocr-v2-progress/v1",
        "jobId": BOOK_ID,
        "scope": "12-page-calibration-only",
        "calibrationPageNos": list(CALIBRATION_PAGE_NOS),
        "structureOnlyPageNo": STRUCTURE_ONLY_PAGE_NO,
        "pageStates": {str(page_no): "created" for page_no in CALIBRATION_PAGE_NOS},
        "attempts": {},
        "reviews": {},
        "acceptedPageNos": [],
        "fullBookRunStarted": False,
        "releaseCreated": False,
        "importStarted": False,
        "g2Started": False,
    }
    write_json(job_dir / "progress.json", progress)
    job_dir.joinpath("attempts").mkdir(parents=True, exist_ok=True)
    job_dir.joinpath("reviews").mkdir(parents=True, exist_ok=True)
    job_dir.joinpath("projections").mkdir(parents=True, exist_ok=True)
    write_json(job_dir / "quality-signals.json", {"schemaVersion": "ocr-quality-signals/v1", "status": "not-started"})

    state_ledger = job_dir / "state-ledger.jsonl"
    attempt_ledger = job_dir / "attempt-ledger.jsonl"
    if state_ledger.exists() or attempt_ledger.exists():
        raise RuntimeError("OCR v2 ledgers already exist; refusing to append a second freeze")
    for page_no in CALIBRATION_PAGE_NOS:
        append_jsonl(state_ledger, {
            "schemaVersion": STATE_SCHEMA_VERSION,
            "event": "page-created",
            "pageNo": page_no,
            "state": "created",
            "at": utc_now(),
        })
    baseline = {
        "schemaVersion": "ocr-v2-phase0-baseline/v1",
        "scope": "book-025 12-page calibration only",
        "git": git_state,
        "sourcePdfSha256": source_sha256,
        "physicalPageCount": document.page_count,
        "historicalOcrV1": {"path": "book-parser/work/text-ocr-v1/jobs/book-025", "readOnly": True, "pageBodiesReadForPrompt": False},
        "deviceMigrationArchive": {"path": "device-migration-20260815", "protected": True, "modified": False},
        "agy": agy,
        "modelRoute": MODEL_ROUTE,
        "reasoningEffort": REASONING_EFFORT,
        "fullBookRunStarted": False,
        "releaseOrImportStarted": False,
        "g2Started": False,
    }
    write_or_verify_immutable(job_dir / "phase0-baseline.json", baseline)
    print(json.dumps({"jobDir": str(job_dir), "pageCount": document.page_count, "renderedPages": all_render_pages, "workUnits": len(CALIBRATION_PAGE_NOS)}, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-dir", type=Path, default=Path("book-parser/work/text-ocr-v2/jobs/book-025"))
    parser.add_argument("--agy-executable", type=Path, default=Path(DEFAULT_AGY))
    parser.add_argument("--dpi", type=int, default=RENDER_DPI)
    freeze(parser.parse_args())


if __name__ == "__main__":
    main()
