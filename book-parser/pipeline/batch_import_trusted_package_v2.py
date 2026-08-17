#!/usr/bin/env python3
"""Batch driver for trusted book-package/v2 imports (T3.2).

Walks `book-parser/catalog-default-49.json` and imports each book independently
by subprocess-invoking `server/db/import-book-package-v2.js` (never via npm).
Failures do not abort the batch.

book-001 is always skipped before any node invocation. Real reading records
reference `book_version_id = book-001-trusted-v1`; the book is already imported
and verified. There is no switch to undo this skip.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from book_package_v2 import read_json
from trusted_package_v2 import repo_root


ALWAYS_SKIP_BOOK_IDS = frozenset({"book-001"})
BOOK_001_SKIP_REASON = "已存在且已核验合规，按裁决跳过"

DEFAULT_DATABASE = "server/data/readmate.sqlite"
DEFAULT_ACTOR_ID = "internal-principal"
DEFAULT_WORKSPACE_ID = "internal-demo-school-workspace"
DEFAULT_PUBLIC_ROOT_NAME = "public"
DEFAULT_PACKAGE_ROOT = "book-parser/work/package-v2-trusted"
IMPORTER_REL = "server/db/import-book-package-v2.js"
DEFAULT_SUMMARY_REL = "docs/product-close-loop/evidence/phase3/t3.2-batch-import-summary.json"


def catalog_books(catalog_path: Path) -> list[dict[str, Any]]:
    catalog = read_json(catalog_path)
    books = catalog.get("books")
    if not isinstance(books, list) or not books:
        raise ValueError(f"{catalog_path}: books must be a non-empty list")
    return books


def parse_id_list(values: list[str] | None) -> list[str]:
    ids: list[str] = []
    for value in values or []:
        for part in value.split(","):
            item = part.strip()
            if item:
                ids.append(item)
    return ids


def posix_rel(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root).as_posix()
    except ValueError:
        return str(path)


def cli_path(path: Path, root: Path) -> str:
    if not path.is_absolute():
        return path.as_posix()
    return posix_rel(path, root)


def resolve_node(*, required: bool) -> str:
    found = shutil.which("node")
    if found:
        return found
    if required:
        raise SystemExit("node not found on PATH")
    return "node"


def load_resume_successes(summary_path: Path) -> set[str]:
    if not summary_path.is_file():
        return set()
    try:
        payload = json.loads(summary_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    if not isinstance(payload, dict) or payload.get("dryRun"):
        return set()
    successes: set[str] = set()
    for row in payload.get("rows") or []:
        if not isinstance(row, dict):
            continue
        book_id = row.get("bookId")
        if row.get("status") == "success" and isinstance(book_id, str) and book_id:
            successes.add(book_id)
    return successes


def parse_importer_stdout(stdout: str) -> dict[str, Any] | None:
    for line in reversed(stdout.splitlines()):
        text = line.strip()
        if not text:
            continue
        try:
            value = json.loads(text)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return None


def assets_from_result(result: dict[str, Any] | None) -> dict[str, int | None]:
    empty: dict[str, int | None] = {"source_pdf": None, "cover": None}
    if not result:
        return empty
    assets = result.get("assets")
    if isinstance(assets, dict):
        parsed: dict[str, int | None] = {}
        for key in ("source_pdf", "cover"):
            value = assets.get(key)
            parsed[key] = value if isinstance(value, int) else None
        return parsed
    if isinstance(assets, list):
        counts = {"source_pdf": 0, "cover": 0}
        for item in assets:
            if not isinstance(item, dict):
                continue
            kind = item.get("assetType") or item.get("type")
            if kind in counts:
                counts[kind] += 1
        return counts
    return empty


def summarize_row(
    book: dict[str, Any],
    *,
    status: str,
    reason: str | None,
    error: str | None,
    elapsed_seconds: float,
    assets: dict[str, int | None],
    command: list[str] | None,
    version_id: str | None = None,
) -> dict[str, Any]:
    return {
        "bookId": book["bookId"],
        "title": book.get("title"),
        "versionId": version_id or book.get("versionId"),
        "status": status,
        "reason": reason,
        "assets": {
            "source_pdf": assets.get("source_pdf"),
            "cover": assets.get("cover"),
        },
        "error": error,
        "elapsedSeconds": elapsed_seconds,
        "command": command,
    }


def build_import_command(
    *,
    node: str,
    book_id: str,
    database: str,
    package: str,
    actor_id: str,
    workspace_id: str,
    public_root: str,
) -> list[str]:
    if book_id in ALWAYS_SKIP_BOOK_IDS:
        raise RuntimeError(f"refusing to build importer command for protected book {book_id}")
    return [
        node,
        IMPORTER_REL,
        "--database",
        database,
        "--package",
        package,
        "--actor-id",
        actor_id,
        "--workspace-id",
        workspace_id,
        "--public-root",
        public_root,
        "--accept-trusted",
    ]


def format_command(argv: list[str]) -> str:
    return " ".join(argv)


def write_summary(summary_path: Path, payload: dict[str, Any]) -> None:
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def import_one(
    book: dict[str, Any],
    *,
    root: Path,
    node: str,
    database: str,
    package_root: Path,
    package_root_cli: str,
    actor_id: str,
    workspace_id: str,
    public_root: str,
    dry_run: bool,
    skip_ids: set[str],
    resume_successes: set[str],
) -> dict[str, Any]:
    book_id = book["bookId"]
    package_cli = f"{package_root_cli}/{book_id}"
    empty_assets: dict[str, int | None] = {"source_pdf": None, "cover": None}

    if book_id in ALWAYS_SKIP_BOOK_IDS:
        print(f"SKIP {book_id}  {BOOK_001_SKIP_REASON}")
        return summarize_row(
            book,
            status="skipped",
            reason=BOOK_001_SKIP_REASON,
            error=None,
            elapsed_seconds=0.0,
            assets=empty_assets,
            command=None,
        )

    if book_id in skip_ids:
        reason = f"CLI --skip-book-ids: {book_id}"
        print(f"SKIP {book_id}  {reason}")
        return summarize_row(
            book,
            status="skipped",
            reason=reason,
            error=None,
            elapsed_seconds=0.0,
            assets=empty_assets,
            command=None,
        )

    if book_id in resume_successes:
        reason = "resume: already success in summary"
        print(f"SKIP {book_id}  {reason}")
        return summarize_row(
            book,
            status="skipped",
            reason=reason,
            error=None,
            elapsed_seconds=0.0,
            assets=empty_assets,
            command=None,
        )

    command = build_import_command(
        node=node,
        book_id=book_id,
        database=database,
        package=package_cli,
        actor_id=actor_id,
        workspace_id=workspace_id,
        public_root=public_root,
    )

    if dry_run:
        print(f"IMPORT {book_id}")
        print(f"  {format_command(command)}")
        return summarize_row(
            book,
            status="planned",
            reason="dry-run: importer not invoked",
            error=None,
            elapsed_seconds=0.0,
            assets=empty_assets,
            command=command,
        )

    package_dir = package_root / book_id
    if not package_dir.is_dir():
        error = f"package directory not found: {package_cli}"
        print(f"FAIL {book_id}  {error}")
        return summarize_row(
            book,
            status="failed",
            reason=None,
            error=error,
            elapsed_seconds=0.0,
            assets=empty_assets,
            command=command,
        )

    started = time.perf_counter()
    try:
        completed = subprocess.run(
            command,
            cwd=str(root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except Exception as exc:
        elapsed = round(time.perf_counter() - started, 3)
        error = f"{type(exc).__name__}: {exc}"
        print(f"FAIL {book_id}  {error}")
        return summarize_row(
            book,
            status="failed",
            reason=None,
            error=error,
            elapsed_seconds=elapsed,
            assets=empty_assets,
            command=command,
        )

    elapsed = round(time.perf_counter() - started, 3)
    result = parse_importer_stdout(completed.stdout)
    assets = assets_from_result(result)
    version_id = None
    if result and isinstance(result.get("versionId"), str):
        version_id = result["versionId"]

    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip() or f"exit {completed.returncode}"
        print(f"FAIL {book_id}  {detail}")
        return summarize_row(
            book,
            status="failed",
            reason=None,
            error=detail,
            elapsed_seconds=elapsed,
            assets=assets,
            command=command,
            version_id=version_id,
        )

    print(f"OK {book_id}  {version_id or book.get('versionId')}")
    return summarize_row(
        book,
        status="success",
        reason=None,
        error=None,
        elapsed_seconds=elapsed,
        assets=assets,
        command=command,
        version_id=version_id,
    )


def configure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8")


def main() -> None:
    configure_stdio()
    parser = argparse.ArgumentParser(
        description="Batch import trusted book-package/v2 for catalog-default-49 (skips book-001)"
    )
    parser.add_argument("--catalog", type=Path, default=repo_root() / "book-parser" / "catalog-default-49.json")
    parser.add_argument("--repo-root", type=Path, default=repo_root())
    parser.add_argument("--database", type=Path, default=Path(DEFAULT_DATABASE))
    parser.add_argument("--actor-id", default=DEFAULT_ACTOR_ID)
    parser.add_argument("--workspace-id", default=DEFAULT_WORKSPACE_ID)
    parser.add_argument(
        "--public-root",
        type=Path,
        help=f"default: <repo>/{DEFAULT_PUBLIC_ROOT_NAME} (absolute or repo-relative)",
    )
    parser.add_argument("--package-root", type=Path, default=Path(DEFAULT_PACKAGE_ROOT))
    parser.add_argument(
        "--skip-book-ids",
        action="append",
        default=[],
        help="Additional book ids to skip (book-001 is always skipped and cannot be removed)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print commands and skip decisions; do not call node")
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Skip books whose previous summary row is status=success (never overrides book-001 skip)",
    )
    parser.add_argument(
        "--summary",
        type=Path,
        help=f"Write JSON summary (default: {DEFAULT_SUMMARY_REL})",
    )
    parser.add_argument("--book-id", action="append", help="Limit to one or more book ids (repeatable)")
    parser.add_argument("--node", help="node executable (default: node on PATH)")
    args = parser.parse_args()

    root = args.repo_root.resolve()
    catalog_path = args.catalog if args.catalog.is_absolute() else root / args.catalog
    catalog_path = catalog_path.resolve()
    books = catalog_books(catalog_path)
    if args.book_id:
        wanted = set(args.book_id)
        books = [book for book in books if book.get("bookId") in wanted]
        missing = sorted(wanted - {book.get("bookId") for book in books})
        if missing:
            raise SystemExit(f"unknown book ids: {', '.join(missing)}")

    extra_skips = set(parse_id_list(args.skip_book_ids))
    skip_ids = set(ALWAYS_SKIP_BOOK_IDS) | extra_skips

    database = cli_path(args.database, root)
    package_root = args.package_root if args.package_root.is_absolute() else root / args.package_root
    package_root_cli = cli_path(args.package_root, root)
    if args.public_root is None:
        public_root = str(root / DEFAULT_PUBLIC_ROOT_NAME)
    else:
        public_root = str(args.public_root)

    summary_path = args.summary or (root / DEFAULT_SUMMARY_REL)
    if not summary_path.is_absolute():
        summary_path = root / summary_path

    resume_successes: set[str] = set()
    if args.resume:
        resume_successes = load_resume_successes(summary_path)

    node = args.node or resolve_node(required=not args.dry_run)
    if args.dry_run and not args.node:
        node = "node"

    print(
        json.dumps(
            {
                "task": "T3.2-batch-import",
                "dryRun": args.dry_run,
                "resume": args.resume,
                "catalog": posix_rel(catalog_path, root),
                "database": database,
                "packageRoot": package_root_cli,
                "publicRoot": public_root,
                "actorId": args.actor_id,
                "workspaceId": args.workspace_id,
                "alwaysSkipBookIds": sorted(ALWAYS_SKIP_BOOK_IDS),
                "skipBookIds": sorted(skip_ids),
                "bookCount": len(books),
            },
            ensure_ascii=False,
        )
    )

    rows: list[dict[str, Any]] = []
    for book in books:
        rows.append(
            import_one(
                book,
                root=root,
                node=node,
                database=database,
                package_root=package_root,
                package_root_cli=package_root_cli,
                actor_id=args.actor_id,
                workspace_id=args.workspace_id,
                public_root=public_root,
                dry_run=args.dry_run,
                skip_ids=extra_skips,
                resume_successes=resume_successes,
            )
        )

    success = sum(1 for row in rows if row["status"] == "success")
    failed = sum(1 for row in rows if row["status"] == "failed")
    skipped = sum(1 for row in rows if row["status"] == "skipped")
    planned = sum(1 for row in rows if row["status"] == "planned")

    payload = {
        "task": "T3.2-batch-import",
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "dryRun": args.dry_run,
        "resume": args.resume,
        "catalog": posix_rel(catalog_path, root),
        "database": database,
        "packageRoot": package_root_cli,
        "publicRoot": public_root,
        "actorId": args.actor_id,
        "workspaceId": args.workspace_id,
        "alwaysSkipBookIds": sorted(ALWAYS_SKIP_BOOK_IDS),
        "skipBookIds": sorted(skip_ids),
        "totals": {
            "books": len(rows),
            "success": success,
            "failed": failed,
            "skipped": skipped,
            "planned": planned,
        },
        "rows": rows,
    }

    write_summary(summary_path, payload)
    print(
        json.dumps(
            {
                "summaryPath": str(summary_path),
                "totals": payload["totals"],
                "importBookIds": [row["bookId"] for row in rows if row["status"] in {"success", "planned"}],
                "skippedBookIds": [row["bookId"] for row in rows if row["status"] == "skipped"],
                "failedBookIds": [row["bookId"] for row in rows if row["status"] == "failed"],
            },
            ensure_ascii=False,
        )
    )
    if failed and not args.dry_run:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
