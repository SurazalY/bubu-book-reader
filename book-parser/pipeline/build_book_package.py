#!/usr/bin/env python3
"""Build a deterministic book package from rendered pages and Luna JSON responses."""

from __future__ import annotations

import argparse
import base64
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

import fitz

from calibrate_char_geometry import (
    FONT_CANDIDATES,
    insert_positioned_character,
    normalize_box,
    sha256,
    validate_char_geometry_fields,
    validate_page_geometry_corrections,
)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_page(page: dict, render_info: dict, source: str) -> dict:
    page_no = int(page.get("pageNo", render_info["pageNo"]))
    if page_no != render_info["pageNo"]:
        raise ValueError(f"response page {page_no} does not match render page {render_info['pageNo']}")
    width = int(page.get("width", render_info["width"]))
    height = int(page.get("height", render_info["height"]))
    if width != render_info["width"] or height != render_info["height"]:
        raise ValueError(f"page {page_no}: response dimensions do not match rendered image")

    status = page.get("status", "ok")
    if status not in {"ok", "failed"}:
        raise ValueError(f"page {page_no}: unsupported status {status}")
    blocks = []
    cursor = 0
    for index, raw in enumerate(page.get("blocks", []), start=1):
        text = raw.get("text", raw.get("hanzi", ""))
        if not isinstance(text, str):
            raise ValueError(f"page {page_no} block {index}: text is not a string")
        block_id = str(raw.get("id") or f"p{page_no:04d}-b{index:03d}")
        start = int(raw.get("charStart", cursor))
        end = int(raw.get("charEnd", start + len(text)))
        if start != cursor or end != start + len(text):
            raise ValueError(f"page {page_no} block {block_id}: non-contiguous char range")
        box = normalize_box(raw.get("bbox"))
        if box["x"] < 0 or box["y"] < 0 or box["x"] + box["width"] > width or box["y"] + box["height"] > height:
            raise ValueError(f"page {page_no} block {block_id}: bbox outside image")
        block = {
            "id": block_id,
            "blockId": block_id,
            "kind": raw.get("kind", "paragraph"),
            "order": int(raw.get("order", index)),
            "text": text,
            "charStart": start,
            "charEnd": end,
            "bbox": box,
            "confidence": raw.get("confidence"),
        }
        try:
            block.update(validate_char_geometry_fields(raw, text, width, height, box))
        except ValueError as exc:
            raise ValueError(f"page {page_no} block {block_id}: invalid character geometry: {exc}") from exc
        blocks.append(block)
        cursor = end

    correction_errors = validate_page_geometry_corrections(blocks)
    if correction_errors:
        raise ValueError(f"page {page_no}: invalid geometry correction: {'; '.join(correction_errors)}")

    if status == "failed" and blocks:
        raise ValueError(f"page {page_no}: failed page must not contain successful blocks")
    return {
        "pageNo": page_no,
        "width": width,
        "height": height,
        "image": render_info["image"],
        "status": status,
        "text": "".join(block["text"] for block in blocks),
        "blocks": blocks,
        "failureReason": page.get("failureReason") if status == "failed" else None,
        "source": source,
    }


def svg_debug(image_path: Path, page: dict, output: Path) -> None:
    image_data = base64.b64encode(image_path.read_bytes()).decode("ascii")
    boxes = []
    for index, block in enumerate(page["blocks"], start=1):
        box = block["bbox"]
        color = "#0b84f3" if index % 2 else "#ef4444"
        boxes.append(
            f'<rect x="{box["x"]}" y="{box["y"]}" width="{box["width"]}" height="{box["height"]}" fill="none" stroke="{color}" stroke-width="4"/><text x="{box["x"] + 4}" y="{box["y"] + 22}" fill="{color}" font-size="20">{index}</text>'
        )
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{page["width"]}" height="{page["height"]}" viewBox="0 0 {page["width"]} {page["height"]}">'
        f'<image width="{page["width"]}" height="{page["height"]}" href="data:image/png;base64,{image_data}"/>'
        + "".join(boxes)
        + "</svg>"
    )
    output.write_text(svg, encoding="utf-8")


def searchable_pdf(pages: list[dict], page_dir: Path, output: Path, dpi: int = 200) -> None:
    document = fitz.open()
    fontfile = next((Path(path) for path in FONT_CANDIDATES if Path(path).is_file()), None)
    for page in pages:
        target = document.new_page(width=page["width"] * 72 / dpi, height=page["height"] * 72 / dpi)
        image_path = page_dir.parent / page["image"]
        target.insert_image(target.rect, filename=str(image_path))
        if page["status"] != "ok":
            continue
        scale = 72 / dpi
        for block in page["blocks"]:
            if "geometryStatus" in block:
                if block["geometryStatus"] == "ok":
                    if fontfile is None:
                        raise RuntimeError("a CJK-capable local font is required for positioned text")
                    for character in block["chars"]:
                        insert_positioned_character(
                            target,
                            character["text"],
                            character["bbox"],
                            dpi,
                            fontfile=fontfile,
                        )
                # Failed calibrated geometry is intentionally omitted. Falling
                # back to the coarse box would disguise the recorded failure.
                continue
            box = block["bbox"]
            rect = fitz.Rect(box["x"] * scale, box["y"] * scale, (box["x"] + box["width"]) * scale, (box["y"] + box["height"]) * scale)
            kwargs = {
                "fontname": "ArialUnicode" if fontfile else "helv",
                # The text layer is invisible and exists for local search. Keep
                # a conservative size so long Chinese paragraphs fit inside
                # the visual block instead of being rejected by insert_textbox.
                "fontsize": 6,
                "render_mode": 3,
                "align": 0,
            }
            if fontfile:
                kwargs["fontfile"] = str(fontfile)
            target.insert_textbox(rect, block["text"], **kwargs)
    document.save(output)
    document.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("render_dir", type=Path)
    parser.add_argument("response", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--book-id", default="book-ocr-pilot-童话故事")
    parser.add_argument("--attempt", type=int, default=1)
    args = parser.parse_args()

    render_manifest = read_json(args.render_dir / "render-manifest.json")
    response_root = read_json(args.response)
    response_pages = {int(page["pageNo"]): page for page in response_root.get("pages", [])}
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "pages").mkdir(exist_ok=True)
    (args.output / "content").mkdir(exist_ok=True)
    (args.output / "debug").mkdir(exist_ok=True)
    (args.output / "source").mkdir(exist_ok=True)

    pages = []
    for render_info in render_manifest["pages"]:
        page_no = int(render_info["pageNo"])
        source_page = response_pages.get(page_no, {"pageNo": page_no, "status": "failed", "failureReason": "no Luna response"})
        page = normalize_page(source_page, render_info, str(args.source))
        source_image = args.render_dir / render_info["image"]
        output_image = args.output / "pages" / f"{page_no:04d}.png"
        shutil.copyfile(source_image, output_image)
        page["image"] = f"pages/{output_image.name}"
        pages.append(page)
        svg_debug(output_image, page, args.output / "debug" / f"{page_no:04d}.svg")

    pages.sort(key=lambda page: page["pageNo"])
    failed = [page["pageNo"] for page in pages if page["status"] != "ok"]
    manifest = {
        "schemaVersion": "book-package/v1",
        "bookId": args.book_id,
        "title": "快乐读书吧部编版一年级和大人一起读 童话故事",
        "pageCount": len(pages),
        "source": {"path": str(args.source), "sha256": sha256(args.source)},
        "render": {"dpi": render_manifest["dpi"], "coordinateSystem": "pixel, origin=top-left"},
        "parser": {"version": "luna-ocr-pilot-v1", "attempt": args.attempt, "modelRoute": "current Luna task"},
        "pages": [{"pageNo": page["pageNo"], "image": page["image"], "status": page["status"]} for page in pages],
        "quality": {"pageCount": len(pages), "successfulPages": len(pages) - len(failed), "failedPages": failed},
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    (args.output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (args.output / "content" / "pages.json").write_text(json.dumps({"pages": pages}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (args.output / "quality-report.json").write_text(
        json.dumps({"failedPages": failed, "pageCount": len(pages), "successfulPages": len(pages) - len(failed)}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    searchable_pdf(
        pages,
        args.output / "pages",
        args.output / "source" / "book.searchable.pdf",
        int(render_manifest["dpi"]),
    )
    print(json.dumps({"output": str(args.output), "pageCount": len(pages), "failedPages": failed}, ensure_ascii=False))


if __name__ == "__main__":
    main()
