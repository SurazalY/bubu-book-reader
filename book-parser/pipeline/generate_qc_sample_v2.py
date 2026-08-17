#!/usr/bin/env python3
"""Render a deterministic human-QC sample with source pages beside normalized OCR text."""

from __future__ import annotations

import argparse
import math
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from book_package_v2 import read_json, write_canonical_json


def stratified_sample(page_count: int, required: set[int], minimum: int = 30) -> list[int]:
    if page_count <= minimum:
        return list(range(1, page_count + 1))
    sampled = {round(index * (page_count - 1) / (minimum - 1)) + 1 for index in range(minimum)}
    return sorted(sampled | required)


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: int) -> list[str]:
    lines: list[str] = []
    current = ""
    for character in text:
        candidate = current + character
        if current and draw.textlength(candidate, font=font) > width:
            lines.append(current)
            current = character
        else:
            current = candidate
    if current or not lines:
        lines.append(current)
    return lines


def source_image(render_dir: Path, page_no: int) -> Path:
    matches = sorted(render_dir.glob(f"source-{page_no:03d}.*"))
    if len(matches) != 1:
        raise ValueError(f"expected exactly one rendered source image for page {page_no}, found {len(matches)}")
    return matches[0]


def build_sheet(page_numbers: list[int], pages: dict[int, dict], render_dir: Path, output: Path, font_path: Path) -> None:
    sheet_width = 1800
    row_height = 1050
    margin = 32
    image_width = 720
    text_x = image_width + margin * 2
    text_width = sheet_width - text_x - margin
    font = ImageFont.truetype(str(font_path), 25)
    label_font = ImageFont.truetype(str(font_path), 30)
    sheet = Image.new("RGB", (sheet_width, row_height * len(page_numbers)), "white")
    draw = ImageDraw.Draw(sheet)
    for row, page_no in enumerate(page_numbers):
        y = row * row_height
        with Image.open(source_image(render_dir, page_no)) as original:
            source = original.convert("RGB")
            source.thumbnail((image_width, row_height - margin * 2))
            x = margin + (image_width - source.width) // 2
            sheet.paste(source, (x, y + margin))
        draw.text((text_x, y + margin), f"PDF physical page {page_no} / normalized OCR", fill="black", font=label_font)
        text_y = y + margin + 55
        for block in pages[page_no]["blocks"]:
            for line in wrap_text(draw, block["normalizedText"], font, text_width):
                if text_y + 34 > y + row_height - margin:
                    raise ValueError(f"page {page_no}: OCR text does not fit the QC sheet")
                draw.text((text_x, text_y), line, fill="black", font=font)
                text_y += 34
        draw.line((0, y + row_height - 1, sheet_width, y + row_height - 1), fill="#777777", width=2)
    sheet.save(output, quality=92, optimize=True)


def generate(package: Path, output: Path, pdftoppm: Path, font: Path) -> dict:
    package = package.resolve()
    output = output.resolve()
    if output.exists():
        raise FileExistsError(f"QC output already exists: {output}")
    if not pdftoppm.is_file() or not font.is_file():
        raise FileNotFoundError("--pdftoppm and --font must point to existing files")
    manifest = read_json(package / "manifest.json")
    content = read_json(package / manifest["content"]["path"])
    quality = read_json(package / manifest["quality"]["report"])
    pages = {page["pageNo"]: page for page in content["pages"]}
    required = set(quality["automatic"]["emptyPages"])
    required.update(item["pageNo"] for item in quality["automatic"]["lowConfidenceBlocks"])
    sample_pages = stratified_sample(manifest["pageCount"], required)
    output.mkdir(parents=True)
    render_dir = output / "source-pages"
    render_dir.mkdir()
    source_pdf = package / manifest["source"]["asset"]
    for page_no in sample_pages:
        subprocess.run([
            str(pdftoppm), "-f", str(page_no), "-l", str(page_no), "-jpeg", "-r", "120",
            str(source_pdf), str(render_dir / "source"),
        ], check=True)
    sheets = []
    for index in range(0, len(sample_pages), 2):
        sheet_name = f"sheet-{index // 2 + 1:02d}.jpg"
        build_sheet(sample_pages[index:index + 2], pages, render_dir, output / sheet_name, font)
        sheets.append(sheet_name)
    review = {
        "schemaVersion": "book-package-human-review/v1",
        "bookId": manifest["bookId"],
        "status": "pending",
        "samplePages": sample_pages,
        "requiredReviewPages": sorted(required),
        "reviewer": None,
        "reviewedAt": None,
        "evidencePath": str(output.relative_to(Path.cwd().resolve())) if output.is_relative_to(Path.cwd().resolve()) else str(output),
        "notes": "",
        "findings": [],
    }
    write_canonical_json(output / "human-review.json", review)
    inventory = {
        "schemaVersion": "book-package-qc-evidence/v1",
        "bookId": manifest["bookId"],
        "versionId": manifest["versionId"],
        "samplePages": sample_pages,
        "requiredReviewPages": sorted(required),
        "sheets": sheets,
    }
    write_canonical_json(output / "inventory.json", inventory)
    return inventory


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("package", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--pdftoppm", type=Path, required=True)
    parser.add_argument("--font", type=Path, required=True)
    args = parser.parse_args()
    import json
    print(json.dumps(generate(args.package, args.output, args.pdftoppm, args.font), ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
