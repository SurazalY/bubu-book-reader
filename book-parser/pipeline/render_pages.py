#!/usr/bin/env python3
"""Render selected PDF pages at one fixed DPI without modifying the source PDF."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import fitz


def parse_page_list(value: str | None, total: int) -> list[int]:
    if not value:
        return list(range(1, total + 1))
    result: list[int] = []
    for token in value.split(","):
        if "-" in token:
            start, end = (int(item) for item in token.split("-", 1))
            result.extend(range(start, end + 1))
        else:
            result.append(int(token))
    unique = sorted(set(result))
    if any(page < 1 or page > total for page in unique):
        raise ValueError(f"page selection outside PDF range 1..{total}: {unique}")
    return unique


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--pages", help="1-based pages, e.g. 1,6,9-12")
    args = parser.parse_args()

    if args.dpi <= 0:
        raise ValueError("dpi must be positive")
    if not args.source.is_file():
        raise FileNotFoundError(args.source)

    document = fitz.open(args.source)
    pages = parse_page_list(args.pages, document.page_count)
    args.output.mkdir(parents=True, exist_ok=True)
    scale = args.dpi / 72
    matrix = fitz.Matrix(scale, scale)
    rendered: list[dict[str, object]] = []

    for page_no in pages:
        page = document.load_page(page_no - 1)
        pixmap = page.get_pixmap(matrix=matrix, alpha=False)
        target = args.output / f"page-{page_no:04d}.png"
        pixmap.save(target)
        rendered.append(
            {
                "pageNo": page_no,
                "image": target.name,
                "width": pixmap.width,
                "height": pixmap.height,
                "dpi": args.dpi,
                "coordinateSystem": "pixel, origin=top-left",
                "pdfRectPt": {
                    "width": round(page.rect.width, 3),
                    "height": round(page.rect.height, 3),
                },
            }
        )

    (args.output / "render-manifest.json").write_text(
        json.dumps(
            {
                "source": str(args.source),
                "pageCount": document.page_count,
                "dpi": args.dpi,
                "pages": rendered,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"pageCount": document.page_count, "rendered": rendered}, ensure_ascii=False))


if __name__ == "__main__":
    main()
