#!/usr/bin/env python3
"""Scan only new v2 attempts and persist non-mutating calibration signals."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ocr_v2 import CALIBRATION_PAGE_NOS, read_json, scan_quality_signals, validate_attempt, validate_page_work_unit, write_json


def scan(job_dir: Path) -> dict[str, object]:
    attempts = []
    ledger_path = job_dir / "attempt-ledger.jsonl"
    if ledger_path.is_file():
        for line in ledger_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            ledger = json.loads(line)
            attempt_path = job_dir / ledger["attemptPath"]
            attempt = read_json(attempt_path)
            work_unit = read_json(job_dir / "work-units" / f"page-{ledger['pageNo']:04d}.json")
            validate_page_work_unit(work_unit)
            validate_attempt(attempt, work_unit)
            attempts.append(attempt)
    signals = scan_quality_signals(attempts, CALIBRATION_PAGE_NOS)
    signals["status"] = "incomplete" if signals["missingPageNos"] else "complete"
    signals["attemptCount"] = len(attempts)
    write_json(job_dir / "quality-signals.json", signals)
    return signals


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("job_dir", type=Path)
    result = scan(parser.parse_args().job_dir.resolve())
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
