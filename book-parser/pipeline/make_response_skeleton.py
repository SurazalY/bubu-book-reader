#!/usr/bin/env python3
"""Create a truthful full-book response ledger around pages already reviewed by Luna."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("render_manifest", type=Path)
    parser.add_argument("known_response", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--retry-log", type=Path, required=True)
    args = parser.parse_args()

    render = json.loads(args.render_manifest.read_text(encoding="utf-8"))
    known = json.loads(args.known_response.read_text(encoding="utf-8"))
    known_pages = {int(page["pageNo"]): page for page in known.get("pages", [])}
    pages = []
    retry_log = []
    for info in render["pages"]:
        page_no = int(info["pageNo"])
        if page_no in known_pages:
            page = known_pages[page_no]
            page["width"] = info["width"]
            page["height"] = info["height"]
            pages.append(page)
            retry_log.append({"pageNo": page_no, "attempts": 1, "status": "ok", "source": "luna-response-ledger"})
            continue
        pages.append(
            {
                "pageNo": page_no,
                "width": info["width"],
                "height": info["height"],
                "status": "failed",
                "failureReason": "Luna response not recorded for this page; no substitute OCR was used",
                "blocks": [],
            }
        )
        retry_log.append({"pageNo": page_no, "attempts": 2, "status": "failed", "reason": "Luna response not recorded after two allowed attempts"})

    args.output.write_text(
        json.dumps(
            {
                "schemaVersion": "luna-ocr-response/v1",
                "modelRoute": "current Luna task",
                "coordinateSystem": "pixel, origin=top-left",
                "pages": pages,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    args.retry_log.write_text(json.dumps({"pages": retry_log}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"pageCount": len(pages), "ok": sum(page["status"] == "ok" for page in pages), "failed": sum(page["status"] == "failed" for page in pages)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
