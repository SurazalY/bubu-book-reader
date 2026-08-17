"""Shared, side-effect-free helpers for the deterministic book-package/v2 path."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "book-package/v2"
NORMALIZATION_VERSION = "raw-exact-ledger-v1"


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: root must be an object")
    return value


def canonical_json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def write_canonical_json(path: Path, value: Any) -> None:
    path.write_bytes(canonical_json_bytes(value))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def checked_int(value: Any, field: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{field} must be an integer >= {minimum}")
    return value


def checked_text(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    return value


def normalize_ocr_page(page: dict[str, Any], expected_page_no: int, corrections: dict[tuple[int, int], dict[str, Any]]) -> dict[str, Any]:
    page_no = checked_int(page.get("pageNo"), "pageNo", 1)
    if page_no != expected_page_no:
        raise ValueError(f"page file {expected_page_no:04d}: embedded pageNo is {page_no}")
    if page.get("status") != "ok":
        raise ValueError(f"page {page_no}: OCR status is not ok")
    width = checked_int(page.get("width"), f"page {page_no}.width", 1)
    height = checked_int(page.get("height"), f"page {page_no}.height", 1)
    raw_blocks = page.get("blocks")
    if not isinstance(raw_blocks, list):
        raise ValueError(f"page {page_no}.blocks must be an array")

    blocks: list[dict[str, Any]] = []
    raw_cursor = 0
    normalized_cursor = 0
    seen_orders: set[int] = set()
    for index, source in enumerate(raw_blocks, start=1):
        if not isinstance(source, dict):
            raise ValueError(f"page {page_no} block {index}: must be an object")
        order = checked_int(source.get("order"), f"page {page_no} block order", 1)
        if order in seen_orders:
            raise ValueError(f"page {page_no}: duplicate block order {order}")
        seen_orders.add(order)
        raw_text = checked_text(source.get("text"), f"page {page_no} block {order}.text")
        correction = corrections.get((page_no, order))
        normalized_text = correction["normalizedText"] if correction else raw_text
        line_bbox = source.get("lineBBox")
        if not isinstance(line_bbox, dict):
            raise ValueError(f"page {page_no} block {order}: lineBBox must be an object")
        bbox = {name: checked_int(line_bbox.get(name), f"page {page_no} block {order}.lineBBox.{name}") for name in ("x", "y", "width", "height")}
        if bbox["x"] + bbox["width"] > width or bbox["y"] + bbox["height"] > height:
            raise ValueError(f"page {page_no} block {order}: lineBBox is outside the page")
        confidence = source.get("confidence")
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
            raise ValueError(f"page {page_no} block {order}: confidence must be between 0 and 1")
        block_id = f"p{page_no:04d}-b{order:03d}"
        blocks.append({
            "blockId": block_id,
            "order": order,
            "rawText": raw_text,
            "normalizedText": normalized_text,
            "rawCharStart": raw_cursor,
            "rawCharEnd": raw_cursor + len(raw_text),
            "charStart": normalized_cursor,
            "charEnd": normalized_cursor + len(normalized_text),
            "confidence": float(confidence),
            "sourceGeometry": {"lineBBox": bbox, "estimated": source.get("bboxEstimated") is True, "usage": "audit-only"},
        })
        raw_cursor += len(raw_text)
        normalized_cursor += len(normalized_text)
    if sorted(seen_orders) != list(range(1, len(raw_blocks) + 1)):
        raise ValueError(f"page {page_no}: block orders must be contiguous from 1")
    return {
        "pageNo": page_no,
        "printedPageLabel": None,
        "width": width,
        "height": height,
        "rawText": "".join(block["rawText"] for block in blocks),
        "normalizedText": "".join(block["normalizedText"] for block in blocks),
        "blocks": blocks,
    }


def normalize_corrections(value: dict[str, Any], book_id: str) -> tuple[dict[tuple[int, int], dict[str, Any]], dict[str, Any]]:
    if value.get("schemaVersion") != "ocr-corrections/v1" or value.get("bookId") != book_id:
        raise ValueError("correction ledger schemaVersion/bookId mismatch")
    if value.get("normalizationVersion") != NORMALIZATION_VERSION:
        raise ValueError("correction ledger normalizationVersion mismatch")
    raw_entries = value.get("corrections")
    if not isinstance(raw_entries, list):
        raise ValueError("correction ledger corrections must be an array")
    entries: dict[tuple[int, int], dict[str, Any]] = {}
    canonical_entries: list[dict[str, Any]] = []
    for raw in raw_entries:
        if not isinstance(raw, dict) or set(raw) != {"pageNo", "blockOrder", "rawText", "rawSha256", "normalizedText", "reason", "reviewer", "reviewedAt"}:
            raise ValueError("each correction must contain exactly the reviewed correction fields")
        page_no = checked_int(raw["pageNo"], "correction.pageNo", 1)
        block_order = checked_int(raw["blockOrder"], "correction.blockOrder", 1)
        if not checked_text(raw["normalizedText"], "correction.normalizedText"):
            raise ValueError("correction.normalizedText must not be empty")
        for field in ("rawText", "reason", "reviewer", "reviewedAt"):
            if not checked_text(raw[field], f"correction.{field}"):
                raise ValueError(f"correction.{field} must not be empty")
        raw_sha256 = checked_text(raw["rawSha256"], "correction.rawSha256")
        if raw_sha256 != sha256_text(raw["rawText"]):
            raise ValueError("correction.rawSha256 must match correction.rawText")
        key = (page_no, block_order)
        if key in entries:
            raise ValueError(f"duplicate correction for page {page_no} block {block_order}")
        entry = dict(raw)
        entries[key] = entry
        canonical_entries.append(entry)
    canonical_entries.sort(key=lambda item: (item["pageNo"], item["blockOrder"]))
    canonical = {
        "schemaVersion": "ocr-corrections/v1",
        "bookId": book_id,
        "normalizationVersion": NORMALIZATION_VERSION,
        "corrections": canonical_entries,
    }
    return entries, canonical


def validate_corrections_applied(corrections: dict[tuple[int, int], dict[str, Any]], pages: list[dict[str, Any]]) -> None:
    remaining = set(corrections)
    for page in pages:
        for block in page["blocks"]:
            key = (page["pageNo"], block["order"])
            correction = corrections.get(key)
            if not correction:
                continue
            if correction["rawText"] != block["rawText"]:
                raise ValueError(f"correction rawText mismatch for page {key[0]} block {key[1]}")
            if correction["rawSha256"] != sha256_text(block["rawText"]):
                raise ValueError(f"correction rawSha256 mismatch for page {key[0]} block {key[1]}")
            remaining.remove(key)
    if remaining:
        page_no, block_order = sorted(remaining)[0]
        raise ValueError(f"correction targets missing page {page_no} block {block_order}")


def automatic_quality(pages: list[dict[str, Any]]) -> dict[str, Any]:
    empty_pages = [page["pageNo"] for page in pages if not page["rawText"]]
    low_confidence_blocks = [
        {"pageNo": page["pageNo"], "blockId": block["blockId"], "confidence": block["confidence"]}
        for page in pages
        for block in page["blocks"]
        if block["confidence"] < 0.8
    ]
    estimated_blocks = sum(1 for page in pages for block in page["blocks"] if block["sourceGeometry"]["estimated"])
    return {
        "pageCount": len(pages),
        "successfulPages": len(pages),
        "failedPages": [],
        "emptyPages": empty_pages,
        "lowConfidenceBlocks": low_confidence_blocks,
        "blockCount": sum(len(page["blocks"]) for page in pages),
        "estimatedGeometryBlocks": estimated_blocks,
        "runtimeDependsOnGeometry": False,
    }
