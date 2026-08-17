#!/usr/bin/env python3
"""Merge explicitly reviewed page response batches into a response ledger."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--batch", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--retry-log", type=Path, required=True)
    args = parser.parse_args()

    merged = load_json(args.base)
    pages = {int(page["pageNo"]): page for page in merged["pages"]}
    for batch_path in args.batch:
        batch = load_json(batch_path)
        for page in batch["pages"]:
            page_no = int(page["pageNo"])
            if page_no not in pages:
                raise ValueError(f"batch page {page_no} is not present in the base ledger")
            pages[page_no] = page

    merged["pages"] = [pages[page_no] for page_no in sorted(pages)]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    retry_pages = []
    for page in merged["pages"]:
        ok = page.get("status") == "ok"
        retry_pages.append(
            {
                "pageNo": page["pageNo"],
                "attempts": 1 if ok else 2,
                "status": "success" if ok else "failed",
                "reason": None
                if ok
                else page.get("failureReason", "Luna response not recorded"),
            }
        )
    args.retry_log.write_text(
        json.dumps({"pages": retry_pages}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
