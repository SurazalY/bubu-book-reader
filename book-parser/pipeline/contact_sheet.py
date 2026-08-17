#!/usr/bin/env python3
"""Create visual review sheets from rendered pages; no OCR or image correction."""

from __future__ import annotations

import argparse
from pathlib import Path

import fitz


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("render_dir", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--start", type=int, required=True)
    parser.add_argument("--end", type=int, required=True)
    parser.add_argument("--columns", type=int, default=5)
    parser.add_argument("--rows", type=int, default=4)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    items = list(range(args.start, args.end + 1))
    thumb_w = 180
    thumb_h = 260
    label_h = 28
    sheet = fitz.open()
    page = sheet.new_page(width=args.columns * thumb_w, height=args.rows * (thumb_h + label_h))
    for index, page_no in enumerate(items[: args.columns * args.rows]):
        row, col = divmod(index, args.columns)
        rect = fitz.Rect(col * thumb_w, row * (thumb_h + label_h), (col + 1) * thumb_w, row * (thumb_h + label_h) + thumb_h)
        page.insert_image(rect, filename=str(args.render_dir / f"page-{page_no:04d}.png"))
        page.insert_text((rect.x0 + 6, rect.y1 + 20), f"PDF {page_no}", fontsize=13, color=(0, 0, 0))
    sheet.save(args.output)
    sheet.close()
    print(args.output)


if __name__ == "__main__":
    main()
