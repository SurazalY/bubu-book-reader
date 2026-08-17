# Phase 2A book-001 正式导入证据

## 导入前备份

```powershell
Copy-Item server\data\readmate.sqlite server\data\readmate.sqlite.pre-phase2-backup
```

## 导入前表行数

```
books: 0
book_versions: 0
book_pages: 0
book_blocks: 0
book_assets: 0
book_catalog_metadata: 0
audit_events: 6
reading_summary_sessions: 0
reading_progress: 0
```

## 首次导入命令

```powershell
node server/db/import-book-package-v2.js `
  --database server\data\readmate.sqlite `
  --package book-parser\work\package-v2-trusted\book-001 `
  --actor-id internal-principal `
  --workspace-id internal-demo-school-workspace `
  --public-root public `
  --accept-trusted
```

## 首次导入输出

```
{"imported":true,"unchanged":false,"bookId":"book-001","versionId":"book-001-trusted-v1","releaseSha256":"05941212b7f9cf33b6d7d52042c41cfb9bfad523e97c676fe96e502a902842d6","publicRoot":"D:\\Project\\整书8.15\\public"}
```

## 导入后表行数

| 表 | 导入前 | 导入后 |
|---|---:|---:|
| books | 0 | 1 |
| book_versions | 0 | 1 |
| book_pages | 0 | 98 |
| book_blocks | 0 | 260 |
| book_assets | 0 | 2 |
| book_catalog_metadata | 0 | 1 |
| audit_events | 6 | 9 |
| reading_summary_sessions | 0 | 0 |
| reading_progress | 0 | 0 |

## 核对脚本

路径：`C:\Users\Yak\AppData\Local\Temp\phase2a-verify-book-001.mjs`（系统临时目录，未入库）

### 首次核对输出（全文）

```
=== Phase 2A post-import verification ===
database: D:\Project\整书8.15\server\data\readmate.sqlite
publicRoot: D:\Project\整书8.15\public

[PASS] books row count: got 1
[PASS] books.title: 和大人一起读·儿童歌谣
[PASS] books.status: published
[PASS] book_versions row count: got 1
[PASS] book_versions.id: book-001-trusted-v1
[PASS] book_versions.package_format: book-package/v2
[PASS] book_versions.package_quality_status: trusted-baseline
[PASS] book_versions.page_count: 98
[PASS] book_pages row count: 98
[PASS] book_pages contiguous 1..98
[PASS] book_blocks row count: 260
[PASS] blank page 2 normalized_text
[PASS] blank page 2 raw_text
[PASS] blank page 3 normalized_text
[PASS] blank page 3 raw_text
[PASS] blank page 14 normalized_text
[PASS] blank page 14 raw_text
[PASS] blank page 18 normalized_text
[PASS] blank page 18 raw_text
[PASS] blank page 52 normalized_text
[PASS] blank page 52 raw_text
[PASS] blank page 66 normalized_text
[PASS] blank page 66 raw_text
[PASS] blank page 76 normalized_text
[PASS] blank page 76 raw_text
[PASS] blank page 92 normalized_text
[PASS] blank page 92 raw_text
[PASS] blank page 96 normalized_text
[PASS] blank page 96 raw_text
[PASS] blank page 97 normalized_text
[PASS] blank page 97 raw_text
[PASS] book_assets row count: 2
[PASS] book_assets has source_pdf
[PASS] book_assets has cover
[PASS] storage_key relative cover: books/pilot/book-001/book-001-trusted-v1/cover.jpg
[PASS] storage_key relative source_pdf: books/pilot/book-001/book-001-trusted-v1/source.pdf
[PASS] book_catalog_metadata.grade: 1
[PASS] audit_events book.imported
[PASS] audit_events trusted_baseline_accepted count: 1
[PASS] audit_events trusted reason_code: TRUSTED_BASELINE_HUMAN_REVIEW_WAIVED
[PASS] audit_events book.published
[PASS] no passed package_quality_status: 0
[PASS] PRAGMA foreign_key_check empty: []
[PASS] reading_summary_sessions unchanged
[PASS] reading_progress unchanged

=== Disk asset verification ===
source_pdf storage_key=books/pilot/book-001/book-001-trusted-v1/source.pdf
  absolute=D:\Project\整书8.15\public\books\pilot\book-001\book-001-trusted-v1\source.pdf
[PASS] source_pdf file exists: D:\Project\整书8.15\public\books\pilot\book-001\book-001-trusted-v1\source.pdf
[PASS] source_pdf byte size: got 115394634, expected 115394634
[PASS] source_pdf sha256 matches db: file=abeacc303306bb4faba7648de179914a87fc6260d8a043fccb13d6bfb98204f5 db=abeacc303306bb4faba7648de179914a87fc6260d8a043fccb13d6bfb98204f5
cover storage_key=books/pilot/book-001/book-001-trusted-v1/cover.jpg
  absolute=D:\Project\整书8.15\public\books\pilot\book-001\book-001-trusted-v1\cover.jpg
[PASS] cover file exists: D:\Project\整书8.15\public\books\pilot\book-001\book-001-trusted-v1\cover.jpg
[PASS] cover byte size: got 128977, expected 128977
[PASS] cover sha256 matches db: file=2fa8c8bb13fe5bcb4d76337ffb06e4b4db5638feef87c943d24ed4b32e346def db=2fa8c8bb13fe5bcb4d76337ffb06e4b4db5638feef87c943d24ed4b32e346def

=== Summary counts for idempotent compare ===
books: 1
book_versions: 1
book_pages: 98
book_blocks: 260
book_assets: 2
book_catalog_metadata: 1
audit_events: 9
reading_summary_sessions: 0
reading_progress: 0

exitCode=0
```

## 磁盘资产摘要

| asset_type | storage_key | 绝对路径 | 字节数 | SHA-256 |
|---|---|---|---:|---|
| source_pdf | `books/pilot/book-001/book-001-trusted-v1/source.pdf` | `D:\Project\整书8.15\public\books\pilot\book-001\book-001-trusted-v1\source.pdf` | 115394634 | `abeacc303306bb4faba7648de179914a87fc6260d8a043fccb13d6bfb98204f5` |
| cover | `books/pilot/book-001/book-001-trusted-v1/cover.jpg` | `D:\Project\整书8.15\public\books\pilot\book-001\book-001-trusted-v1\cover.jpg` | 128977 | `2fa8c8bb13fe5bcb4d76337ffb06e4b4db5638feef87c943d24ed4b32e346def` |

## 幂等复验

### 命令（与首次相同）

```powershell
node server/db/import-book-package-v2.js `
  --database server\data\readmate.sqlite `
  --package book-parser\work\package-v2-trusted\book-001 `
  --actor-id internal-principal `
  --workspace-id internal-demo-school-workspace `
  --public-root public `
  --accept-trusted
```

### 输出

```
{"imported":false,"unchanged":true,"bookId":"book-001","versionId":"book-001-trusted-v1","releaseSha256":"05941212b7f9cf33b6d7d52042c41cfb9bfad523e97c676fe96e502a902842d6"}
```

### 复验后核对脚本

与首次输出逐字相同（行数仍为 books:1 … audit_events:9 … reading_progress:0；`trusted_baseline_accepted` 仍为 1 条）。
