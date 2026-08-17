#!/usr/bin/env python3
"""Read-only catalog verification against the business SQLite (T3.3).

Walks `book-parser/catalog-default-49.json` and, for each book independently,
asserts the five T3.3 contracts against `server/data/readmate.sqlite`. Failures
do not abort the batch.

This script never writes to the business database. The connection is opened
with `file:<path>?mode=ro` and `PRAGMA query_only=ON`. It does not import
packages, judge OCR quality, or mutate txt/blank files. Blank-page checks only
confirm that manifest-listed empty pages have `normalized_text == ''`.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from book_package_v2 import read_json
from trusted_package_v2 import repo_root


DEFAULT_DATABASE = "server/data/readmate.sqlite"
DEFAULT_PACKAGE_ROOT = "book-parser/work/package-v2-trusted"
DEFAULT_SUMMARY_REL = "docs/product-close-loop/evidence/phase3/t3.3-verify-summary.json"
EXPECTED_QUALITY_STATUS = "trusted-baseline"
EXPECTED_STATUS = "published"
GRADE_MIN = 1
GRADE_MAX = 6

REQUIRED_TABLE_COLUMNS = {
    "books": ("id", "status"),
    "book_versions": ("id", "book_id", "page_count", "package_quality_status", "created_at"),
    "book_pages": ("book_version_id", "page_no", "normalized_text"),
    "book_assets": ("book_version_id", "asset_type", "page_id"),
    "book_catalog_metadata": ("book_id", "grade"),
}

DB_SIDECARS = ("", "-wal", "-shm")


def catalog_books(catalog_path: Path) -> list[dict[str, Any]]:
    catalog = read_json(catalog_path)
    books = catalog.get("books")
    if not isinstance(books, list) or not books:
        raise ValueError(f"{catalog_path}: books must be a non-empty list")
    return books


def posix_rel(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root).as_posix()
    except ValueError:
        return str(path)


def configure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8")


def file_fingerprint(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "path": str(path),
            "exists": False,
            "sizeBytes": None,
            "mtimeNs": None,
            "mtimeIso": None,
        }
    stat = path.stat()
    return {
        "path": str(path),
        "exists": True,
        "sizeBytes": stat.st_size,
        "mtimeNs": stat.st_mtime_ns,
        "mtimeIso": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).replace(microsecond=0).isoformat(),
    }


def database_file_fingerprints(db_path: Path) -> dict[str, dict[str, Any]]:
    fingerprints: dict[str, dict[str, Any]] = {}
    for suffix in DB_SIDECARS:
        label = "sqlite" if suffix == "" else suffix.lstrip("-")
        fingerprints[label] = file_fingerprint(Path(str(db_path) + suffix))
    return fingerprints


def fingerprints_unchanged(before: dict[str, dict[str, Any]], after: dict[str, dict[str, Any]]) -> dict[str, bool]:
    changed: dict[str, bool] = {}
    for key in ("sqlite", "wal", "shm"):
        left = before.get(key) or {}
        right = after.get(key) or {}
        changed[key] = (
            left.get("exists") == right.get("exists")
            and left.get("sizeBytes") == right.get("sizeBytes")
            and left.get("mtimeNs") == right.get("mtimeNs")
        )
    return changed


def readonly_uri(db_path: Path) -> str:
    return db_path.resolve().as_uri() + "?mode=ro"


def open_readonly(db_path: Path) -> sqlite3.Connection:
    if not db_path.is_file():
        raise FileNotFoundError(f"database not found: {db_path}")
    conn = sqlite3.connect(readonly_uri(db_path), uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    return conn


def table_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return [str(row["name"]) for row in rows]


def discover_schema(conn: sqlite3.Connection) -> dict[str, Any]:
    schema: dict[str, Any] = {"tables": {}, "missing": []}
    for table, required in REQUIRED_TABLE_COLUMNS.items():
        columns = table_columns(conn, table)
        schema["tables"][table] = columns
        if not columns:
            schema["missing"].append({"table": table, "columns": list(required)})
            continue
        absent = [name for name in required if name not in columns]
        if absent:
            schema["missing"].append({"table": table, "columns": absent})
    return schema


def assertion(passed: bool, *, failures: list[str] | None = None, **details: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {"pass": bool(passed), **details}
    payload["failures"] = list(failures or [])
    return payload


def empty_pages_from_manifest(manifest: dict[str, Any], book_id: str) -> tuple[list[int], str]:
    """Read blank/empty page numbers from the package manifest only.

    This is a structural expectation from the packager, not an OCR quality check.
    """
    quality = manifest.get("quality")
    if not isinstance(quality, dict):
        raise ValueError(f"{book_id}: manifest.quality is missing or not an object")
    automatic = quality.get("automatic")
    if not isinstance(automatic, dict):
        raise ValueError(f"{book_id}: manifest.quality.automatic is missing or not an object")

    field = "quality.automatic.emptyPages"
    raw = automatic.get("emptyPages")
    if raw is None:
        field = "quality.automatic.blankPages"
        raw = automatic.get("blankPages")
    if raw is None:
        raise ValueError(f"{book_id}: manifest has no quality.automatic.emptyPages or blankPages")
    if not isinstance(raw, list):
        raise ValueError(f"{book_id}: {field} must be a list")

    pages: list[int] = []
    for index, item in enumerate(raw):
        if isinstance(item, bool) or not isinstance(item, int) or item < 1:
            raise ValueError(f"{book_id}: {field}[{index}] must be a positive integer")
        pages.append(item)
    return pages, field


def current_version_row(conn: sqlite3.Connection, book_id: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT id, book_id, page_count, package_quality_status, created_at
        FROM book_versions
        WHERE book_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        """,
        (book_id,),
    ).fetchone()


def version_rows(conn: sqlite3.Connection, book_id: str) -> list[sqlite3.Row]:
    return list(
        conn.execute(
            """
            SELECT id, book_id, page_count, package_quality_status, created_at
            FROM book_versions
            WHERE book_id = ?
            ORDER BY created_at DESC, id DESC
            """,
            (book_id,),
        )
    )


def assert_published(conn: sqlite3.Connection, book_id: str) -> dict[str, Any]:
    row = conn.execute("SELECT id, status FROM books WHERE id = ?", (book_id,)).fetchone()
    if row is None:
        return assertion(False, exists=False, status=None, failures=[f"books 缺少 {book_id}"])
    status = row["status"]
    if status != EXPECTED_STATUS:
        return assertion(
            False,
            exists=True,
            status=status,
            failures=[f"books.status={status!r}, expected {EXPECTED_STATUS!r}"],
        )
    return assertion(True, exists=True, status=status)


def assert_page_count(
    conn: sqlite3.Connection,
    book_id: str,
    catalog_page_count: Any,
    version: sqlite3.Row | None,
) -> dict[str, Any]:
    failures: list[str] = []
    version_page_count = None if version is None else version["page_count"]
    page_row_count = None
    if version is None:
        failures.append(f"{book_id}: 没有 book_versions 行，无法对照 pageCount")
    else:
        page_row_count = conn.execute(
            "SELECT COUNT(*) AS n FROM book_pages WHERE book_version_id = ?",
            (version["id"],),
        ).fetchone()["n"]
        if version_page_count != catalog_page_count:
            failures.append(
                f"book_versions.page_count={version_page_count} != catalog pageCount={catalog_page_count}"
            )
        if page_row_count != catalog_page_count:
            failures.append(
                f"book_pages 行数={page_row_count} != catalog pageCount={catalog_page_count}"
            )
        if page_row_count != version_page_count:
            failures.append(
                f"book_pages 行数={page_row_count} != book_versions.page_count={version_page_count}"
            )
    return assertion(
        not failures,
        catalogPageCount=catalog_page_count,
        versionPageCount=version_page_count,
        pageRowCount=page_row_count,
        versionId=None if version is None else version["id"],
        failures=failures,
    )


def assert_blank_normalized_empty(
    conn: sqlite3.Connection,
    book_id: str,
    package_dir: Path,
    version: sqlite3.Row | None,
) -> dict[str, Any]:
    failures: list[str] = []
    manifest_path = package_dir / "manifest.json"
    source_field = None
    empty_pages: list[int] = []
    missing_page_nos: list[int] = []
    nonempty_page_nos: list[int] = []

    if not manifest_path.is_file():
        failures.append(f"缺少包 manifest: {manifest_path.as_posix()}")
    else:
        try:
            manifest = read_json(manifest_path)
            empty_pages, source_field = empty_pages_from_manifest(manifest, book_id)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            failures.append(str(exc))

    if version is None:
        failures.append(f"{book_id}: 没有 book_versions 行，无法核对 blank 页")
    elif not failures:
        for page_no in empty_pages:
            row = conn.execute(
                """
                SELECT page_no, length(normalized_text) AS text_len
                FROM book_pages
                WHERE book_version_id = ? AND page_no = ?
                """,
                (version["id"], page_no),
            ).fetchone()
            if row is None:
                missing_page_nos.append(page_no)
                failures.append(f"blank 页 {page_no} 在 book_pages 中不存在")
                continue
            if row["text_len"] != 0:
                nonempty_page_nos.append(page_no)
                failures.append(f"blank 页 {page_no} 的 normalized_text 非空（length={row['text_len']}）")

    return assertion(
        not failures,
        sourceField=source_field,
        emptyPageCount=len(empty_pages),
        emptyPages=empty_pages,
        missingPageNos=missing_page_nos,
        nonEmptyPageNos=nonempty_page_nos,
        failures=failures,
    )


def assert_assets(conn: sqlite3.Connection, book_id: str, version: sqlite3.Row | None) -> dict[str, Any]:
    failures: list[str] = []
    counts = {"source_pdf": 0, "cover": 0}
    other_types: dict[str, int] = {}
    if version is None:
        failures.append(f"{book_id}: 没有 book_versions 行，无法核对资产")
    else:
        rows = conn.execute(
            """
            SELECT asset_type, COUNT(*) AS n
            FROM book_assets
            WHERE book_version_id = ?
            GROUP BY asset_type
            """,
            (version["id"],),
        ).fetchall()
        for row in rows:
            kind = row["asset_type"]
            if kind in counts:
                counts[kind] = row["n"]
            else:
                other_types[kind] = row["n"]
        for kind, expected in (("source_pdf", 1), ("cover", 1)):
            actual = counts[kind]
            if actual != expected:
                failures.append(f"{kind} 数量={actual}, expected {expected}")
    return assertion(
        not failures,
        source_pdf=counts["source_pdf"] if version is not None else None,
        cover=counts["cover"] if version is not None else None,
        otherAssetTypes=other_types,
        versionId=None if version is None else version["id"],
        failures=failures,
    )


def assert_grade(
    conn: sqlite3.Connection,
    book_id: str,
    catalog_grade: Any,
    grade_column: str,
) -> dict[str, Any]:
    failures: list[str] = []
    if not isinstance(catalog_grade, int) or isinstance(catalog_grade, bool) or not (GRADE_MIN <= catalog_grade <= GRADE_MAX):
        failures.append(f"编目 grade={catalog_grade!r} 不是 {GRADE_MIN}–{GRADE_MAX} 的整数")
    row = conn.execute(
        f"SELECT {grade_column} AS grade FROM book_catalog_metadata WHERE book_id = ?",
        (book_id,),
    ).fetchone()
    actual = None if row is None else row["grade"]
    if row is None:
        failures.append(f"book_catalog_metadata 缺少 {book_id}")
    elif actual is None:
        failures.append("book_catalog_metadata.grade 为空")
    else:
        if not isinstance(actual, int) or isinstance(actual, bool) or not (GRADE_MIN <= actual <= GRADE_MAX):
            failures.append(f"book_catalog_metadata.grade={actual!r} 不是 {GRADE_MIN}–{GRADE_MAX} 的整数")
        if actual != catalog_grade:
            failures.append(f"book_catalog_metadata.grade={actual} != catalog grade={catalog_grade}")
    return assertion(
        not failures,
        column=grade_column,
        expected=catalog_grade,
        actual=actual,
        hasMetadataRow=row is not None,
        failures=failures,
    )


def assert_single_trusted_version(
    versions: list[sqlite3.Row],
    book_id: str,
    expected_version_id: str,
) -> dict[str, Any]:
    ids = [row["id"] for row in versions]
    failures: list[str] = []
    if len(versions) != 1:
        failures.append(f"book_versions 行数={len(versions)}, expected 1; ids={ids}")
    if expected_version_id not in ids:
        failures.append(f"缺少期望版本 {expected_version_id}")
    elif ids and ids[0] != expected_version_id:
        failures.append(f"当前版本是 {ids[0]}, expected {expected_version_id}")
    if expected_version_id != f"{book_id}-trusted-v1":
        failures.append(f"编目 versionId={expected_version_id!r} 不符合 {book_id}-trusted-v1")
    return assertion(
        not failures,
        expectedVersionId=expected_version_id,
        versionIds=ids,
        failures=failures,
    )


def assert_quality_status(version: sqlite3.Row | None) -> dict[str, Any]:
    if version is None:
        return assertion(
            False,
            status=None,
            failures=["没有 book_versions 行，无法核对 package_quality_status"],
        )
    status = version["package_quality_status"]
    if status != EXPECTED_QUALITY_STATUS:
        return assertion(
            False,
            status=status,
            versionId=version["id"],
            failures=[f"package_quality_status={status!r}, expected {EXPECTED_QUALITY_STATUS!r}"],
        )
    return assertion(True, status=status, versionId=version["id"])


def verify_one(
    book: dict[str, Any],
    *,
    conn: sqlite3.Connection,
    package_root: Path,
    grade_column: str,
    schema_ok: bool,
) -> dict[str, Any]:
    book_id = book["bookId"]
    expected_version_id = book.get("versionId") or f"{book_id}-trusted-v1"
    if not schema_ok:
        blocked = assertion(False, failures=["业务库缺少核对所需的表或列，本本断言全部跳过"])
        return {
            "bookId": book_id,
            "title": book.get("title"),
            "ok": False,
            "assertions": {
                "published": blocked,
                "pageCount": blocked,
                "blankNormalizedEmpty": blocked,
                "assets": blocked,
                "grade": blocked,
            },
            "advisories": {
                "singleTrustedVersion": blocked,
                "packageQualityStatus": blocked,
            },
        }

    versions = version_rows(conn, book_id)
    version = versions[0] if versions else None
    current = current_version_row(conn, book_id)
    if current is not None and version is not None and current["id"] != version["id"]:
        version = current

    published = assert_published(conn, book_id)
    page_count = assert_page_count(conn, book_id, book.get("pageCount"), version)
    blank = assert_blank_normalized_empty(conn, book_id, package_root / book_id, version)
    assets = assert_assets(conn, book_id, version)
    grade = assert_grade(conn, book_id, book.get("grade"), grade_column)
    assertions = {
        "published": published,
        "pageCount": page_count,
        "blankNormalizedEmpty": blank,
        "assets": assets,
        "grade": grade,
    }
    advisories = {
        "singleTrustedVersion": assert_single_trusted_version(versions, book_id, expected_version_id),
        "packageQualityStatus": assert_quality_status(version),
    }
    ok = all(item["pass"] for item in assertions.values())
    return {
        "bookId": book_id,
        "title": book.get("title"),
        "versionId": None if version is None else version["id"],
        "ok": ok,
        "assertions": assertions,
        "advisories": advisories,
    }


def index_failures(rows: list[dict[str, Any]], key: str, *, advisory: bool = False) -> list[dict[str, Any]]:
    bucket = "advisories" if advisory else "assertions"
    indexed: list[dict[str, Any]] = []
    for row in rows:
        item = row[bucket][key]
        if item["pass"]:
            continue
        indexed.append(
            {
                "bookId": row["bookId"],
                "failures": item.get("failures") or [],
                "details": {name: value for name, value in item.items() if name not in {"pass", "failures"}},
            }
        )
    return indexed


def count_pass_fail(rows: list[dict[str, Any]], key: str, *, advisory: bool = False) -> dict[str, int]:
    bucket = "advisories" if advisory else "assertions"
    passed = sum(1 for row in rows if row[bucket][key]["pass"])
    return {"pass": passed, "fail": len(rows) - passed}


def write_summary(summary_path: Path, payload: dict[str, Any]) -> None:
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    configure_stdio()
    parser = argparse.ArgumentParser(description="Read-only T3.3 verification of the trusted 49-book catalog")
    parser.add_argument("--catalog", type=Path, default=repo_root() / "book-parser" / "catalog-default-49.json")
    parser.add_argument("--repo-root", type=Path, default=repo_root())
    parser.add_argument("--database", type=Path, default=Path(DEFAULT_DATABASE))
    parser.add_argument("--package-root", type=Path, default=Path(DEFAULT_PACKAGE_ROOT))
    parser.add_argument(
        "--summary",
        type=Path,
        help=f"Write JSON summary (default: {DEFAULT_SUMMARY_REL})",
    )
    parser.add_argument("--book-id", action="append", help="Limit to one or more book ids (repeatable)")
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

    database_path = args.database if args.database.is_absolute() else root / args.database
    database_path = database_path.resolve()
    package_root = args.package_root if args.package_root.is_absolute() else root / args.package_root
    summary_path = args.summary or (root / DEFAULT_SUMMARY_REL)
    if not summary_path.is_absolute():
        summary_path = root / summary_path

    before = database_file_fingerprints(database_path)
    uri = readonly_uri(database_path)
    extra_book_ids: list[str] = []
    journal_mode = None
    query_only = None
    schema: dict[str, Any] = {"tables": {}, "missing": []}
    rows: list[dict[str, Any]] = []

    conn = open_readonly(database_path)
    try:
        journal_mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        query_only = conn.execute("PRAGMA query_only").fetchone()[0]
        schema = discover_schema(conn)
        schema_ok = not schema["missing"]
        grade_column = "grade"
        catalog_ids = {book["bookId"] for book in books}
        extra_book_ids = [
            row["id"]
            for row in conn.execute("SELECT id FROM books ORDER BY id")
            if row["id"] not in catalog_ids
        ]
        for book in books:
            row = verify_one(
                book,
                conn=conn,
                package_root=package_root,
                grade_column=grade_column,
                schema_ok=schema_ok,
            )
            status = "PASS" if row["ok"] else "FAIL"
            print(f"{status} {row['bookId']}")
            rows.append(row)
    finally:
        conn.close()

    after = database_file_fingerprints(database_path)
    unchanged = fingerprints_unchanged(before, after)
    assertion_keys = ("published", "pageCount", "blankNormalizedEmpty", "assets", "grade")
    advisory_keys = ("singleTrustedVersion", "packageQualityStatus")
    passed_books = sum(1 for row in rows if row["ok"])
    failed_books = len(rows) - passed_books
    ok = failed_books == 0 and not schema["missing"]
    advisory_ok = all(row["advisories"][key]["pass"] for row in rows for key in advisory_keys)

    payload = {
        "task": "T3.3-verify-catalog",
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "ok": ok,
        "advisoryOk": advisory_ok,
        "catalog": posix_rel(catalog_path, root),
        "database": posix_rel(database_path, root),
        "databaseUri": uri,
        "queryOnly": bool(query_only),
        "journalMode": journal_mode,
        "packageRoot": posix_rel(package_root, root),
        "schema": schema,
        "databaseFiles": {
            "before": before,
            "after": after,
            "unchanged": unchanged,
            "allUnchanged": all(unchanged.values()),
        },
        "extraBookIds": extra_book_ids,
        "totals": {
            "books": len(rows),
            "passed": passed_books,
            "failed": failed_books,
        },
        "assertionTotals": {key: count_pass_fail(rows, key) for key in assertion_keys},
        "advisoryTotals": {key: count_pass_fail(rows, key, advisory=True) for key in advisory_keys},
        "failures": {key: index_failures(rows, key) for key in assertion_keys},
        "advisoryFailures": {key: index_failures(rows, key, advisory=True) for key in advisory_keys},
        "rows": rows,
    }
    write_summary(summary_path, payload)
    print(
        json.dumps(
            {
                "summaryPath": str(summary_path),
                "ok": ok,
                "advisoryOk": advisory_ok,
                "totals": payload["totals"],
                "assertionTotals": payload["assertionTotals"],
                "advisoryTotals": payload["advisoryTotals"],
                "failedBookIds": [row["bookId"] for row in rows if not row["ok"]],
                "databaseFilesUnchanged": payload["databaseFiles"]["unchanged"],
                "databaseUri": uri,
            },
            ensure_ascii=False,
        )
    )
    if not ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
