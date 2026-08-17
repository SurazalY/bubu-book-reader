#!/usr/bin/env python3
"""Validate book-package/v1 invariants without changing package contents."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import fitz

from calibrate_char_geometry import sha256, validate_char_geometry_fields, validate_page_geometry_corrections


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("package", type=Path)
    parser.add_argument("--source", type=Path)
    args = parser.parse_args()

    manifest = json.loads((args.package / "manifest.json").read_text(encoding="utf-8"))
    content = json.loads((args.package / "content" / "pages.json").read_text(encoding="utf-8"))
    pages = content["pages"]
    errors: list[str] = []
    if manifest.get("schemaVersion") != "book-package/v1":
        errors.append("manifest schemaVersion mismatch")
    if manifest.get("pageCount") != len(pages):
        errors.append("manifest/content pageCount mismatch")
    if manifest.get("quality", {}).get("pageCount") != len(pages):
        errors.append("manifest/quality pageCount mismatch")

    manifest_pages = {item["pageNo"]: item for item in manifest.get("pages", [])}
    for page in pages:
        page_no = page["pageNo"]
        image = args.package / page["image"]
        if not image.is_file():
            errors.append(f"page {page_no}: missing image {image}")
            continue
        pixmap = fitz.Pixmap(str(image))
        if pixmap.width != page["width"] or pixmap.height != page["height"]:
            errors.append(f"page {page_no}: image dimensions mismatch")
        if manifest_pages.get(page_no, {}).get("status") != page["status"]:
            errors.append(f"page {page_no}: manifest status mismatch")
        cursor = 0
        for block in page.get("blocks", []):
            text = block.get("text", "")
            if re.search(r"[A-Za-z]", text):
                errors.append(f"page {page_no} block {block['id']}: Latin/pinyin text found")
            if block["charStart"] != cursor or block["charEnd"] != cursor + len(text):
                errors.append(f"page {page_no} block {block['id']}: char range is not contiguous")
            cursor = block["charEnd"]
            box = block["bbox"]
            if box["x"] < 0 or box["y"] < 0 or box["x"] + box["width"] > page["width"] or box["y"] + box["height"] > page["height"]:
                errors.append(f"page {page_no} block {block['id']}: bbox outside page")
            if "geometryStatus" in block or "chars" in block:
                try:
                    validate_char_geometry_fields(block, text, page["width"], page["height"], box)
                except ValueError as exc:
                    errors.append(f"page {page_no} block {block['id']}: invalid character geometry: {exc}")
        if page.get("text", "") != "".join(block["text"] for block in page.get("blocks", [])):
            errors.append(f"page {page_no}: text projection mismatch")
        errors.extend(
            f"page {page_no}: {error}"
            for error in validate_page_geometry_corrections(page.get("blocks", []))
        )
        if page["status"] == "failed" and page.get("blocks"):
            errors.append(f"page {page_no}: failed page contains blocks")

    if args.source:
        expected = manifest.get("source", {}).get("sha256")
        actual = sha256(args.source)
        if expected != actual:
            errors.append("source SHA-256 mismatch")

    searchable = args.package / "source" / "book.searchable.pdf"
    if searchable.is_file():
        pdf = fitz.open(searchable)
        if pdf.page_count != len(pages):
            errors.append("searchable PDF page count mismatch")
        pdf.close()
    else:
        errors.append("missing searchable PDF")

    result = {"ok": not errors, "pageCount": len(pages), "errors": errors}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
