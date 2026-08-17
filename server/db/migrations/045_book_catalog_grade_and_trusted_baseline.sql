-- Phase 1B / T1.4 + T1.6
-- 1) book_versions.package_quality_status 需要接受 D1 新增的真实状态 trusted-baseline。
--    SQLite 无法就地放宽列级 CHECK，这里用 RENAME COLUMN -> ADD COLUMN -> 回填 -> DROP COLUMN
--    完成等价替换；两个 v2 契约触发器引用该列，必须先删除再按原文重建
--    （RENAME COLUMN 会改写触发器里的列名引用）。
-- 2) book_catalog_metadata 增加编目年级字段。trusted 导入只知道年级与权利声明，
--    author/source_page 等公共领域素材字段在本轮没有真实取值，放宽为可空以避免写入占位数据。

DROP TRIGGER book_versions_v2_contract_insert;
DROP TRIGGER book_versions_v2_contract_update;

ALTER TABLE book_versions
  RENAME COLUMN package_quality_status TO package_quality_status_pre_trusted;

ALTER TABLE book_versions
  ADD COLUMN package_quality_status TEXT CHECK (
    package_quality_status IS NULL
    OR package_quality_status IN (
      'human-review-pending', 'human-review-failed', 'passed', 'trusted-baseline'
    )
  );

UPDATE book_versions SET package_quality_status = package_quality_status_pre_trusted;

ALTER TABLE book_versions DROP COLUMN package_quality_status_pre_trusted;

CREATE TRIGGER book_versions_v2_contract_insert
BEFORE INSERT ON book_versions
WHEN NEW.package_format = 'book-package/v2' AND (
  NEW.source_format <> 'pdf'
  OR NEW.release_sha256 IS NULL
  OR NEW.normalization_version IS NULL
  OR NEW.package_quality_status IS NULL
  OR NEW.content_provenance_json IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'book-package/v2 version metadata is incomplete');
END;

CREATE TRIGGER book_versions_v2_contract_update
BEFORE UPDATE ON book_versions
WHEN NEW.package_format = 'book-package/v2' AND (
  NEW.source_format <> 'pdf'
  OR NEW.release_sha256 IS NULL
  OR NEW.normalization_version IS NULL
  OR NEW.package_quality_status IS NULL
  OR NEW.content_provenance_json IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'book-package/v2 version metadata is incomplete');
END;

CREATE TABLE book_catalog_metadata_with_grade (
  book_id TEXT PRIMARY KEY REFERENCES books(id),
  author TEXT,
  illustrator TEXT,
  source_page TEXT,
  usage_label TEXT,
  rights_json TEXT,
  grade INTEGER CHECK (grade IS NULL OR (grade BETWEEN 1 AND 6)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

INSERT INTO book_catalog_metadata_with_grade (
  book_id, author, illustrator, source_page, usage_label, rights_json,
  grade, created_at, updated_at, version
)
SELECT book_id, author, illustrator, source_page, usage_label, rights_json,
  NULL, created_at, updated_at, version
FROM book_catalog_metadata;

DROP TABLE book_catalog_metadata;

ALTER TABLE book_catalog_metadata_with_grade RENAME TO book_catalog_metadata;

CREATE INDEX IF NOT EXISTS idx_book_catalog_metadata_source_page
  ON book_catalog_metadata(source_page);

CREATE INDEX IF NOT EXISTS idx_book_catalog_metadata_grade
  ON book_catalog_metadata(grade);
