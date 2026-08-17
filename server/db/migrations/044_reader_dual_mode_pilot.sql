ALTER TABLE book_versions
  ADD COLUMN package_format TEXT CHECK (package_format IS NULL OR package_format = 'book-package/v2');

ALTER TABLE book_versions
  ADD COLUMN release_sha256 TEXT CHECK (
    release_sha256 IS NULL
    OR (length(release_sha256) = 64 AND release_sha256 NOT GLOB '*[^0-9a-f]*')
  );

ALTER TABLE book_versions
  ADD COLUMN normalization_version TEXT;

ALTER TABLE book_versions
  ADD COLUMN package_quality_status TEXT CHECK (
    package_quality_status IS NULL
    OR package_quality_status IN ('human-review-pending', 'human-review-failed', 'passed')
  );

ALTER TABLE book_versions
  ADD COLUMN content_provenance_json TEXT CHECK (
    content_provenance_json IS NULL OR json_valid(content_provenance_json)
  );

ALTER TABLE book_pages ADD COLUMN raw_text TEXT NOT NULL DEFAULT '';
ALTER TABLE book_pages ADD COLUMN normalized_text TEXT NOT NULL DEFAULT '';
ALTER TABLE book_pages ADD COLUMN printed_page_label TEXT CHECK (
  printed_page_label IS NULL OR length(printed_page_label) BETWEEN 1 AND 64
);

UPDATE book_pages SET raw_text = text_content, normalized_text = text_content;

ALTER TABLE book_blocks ADD COLUMN raw_text TEXT NOT NULL DEFAULT '';
ALTER TABLE book_blocks ADD COLUMN normalized_text TEXT NOT NULL DEFAULT '';
ALTER TABLE book_blocks ADD COLUMN source_confidence REAL CHECK (
  source_confidence IS NULL OR source_confidence BETWEEN 0 AND 1
);
ALTER TABLE book_blocks ADD COLUMN source_geometry_json TEXT CHECK (
  source_geometry_json IS NULL OR json_valid(source_geometry_json)
);
ALTER TABLE book_blocks ADD COLUMN geometry_usage TEXT CHECK (
  geometry_usage IS NULL OR geometry_usage = 'audit-only'
);

UPDATE book_blocks SET raw_text = text_content, normalized_text = text_content;

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

CREATE TRIGGER book_pages_v2_text_insert
BEFORE INSERT ON book_pages
WHEN EXISTS (
  SELECT 1 FROM book_versions AS version
  WHERE version.id = NEW.book_version_id
    AND version.package_format = 'book-package/v2'
    AND NEW.text_content <> NEW.normalized_text
)
BEGIN
  SELECT RAISE(ABORT, 'book-package/v2 page text_content must equal normalized_text');
END;

CREATE TRIGGER book_blocks_v2_text_insert
BEFORE INSERT ON book_blocks
WHEN EXISTS (
  SELECT 1
  FROM book_pages AS page
  JOIN book_versions AS version ON version.id = page.book_version_id
  WHERE page.id = NEW.page_id
    AND version.package_format = 'book-package/v2'
    AND (
      NEW.text_content <> NEW.normalized_text
      OR NEW.geometry_usage <> 'audit-only'
      OR NEW.source_geometry_json IS NULL
    )
)
BEGIN
  SELECT RAISE(ABORT, 'book-package/v2 block text/geometry audit contract mismatch');
END;

CREATE TABLE reading_summary_page_coverage (
  session_id TEXT NOT NULL,
  page_no INTEGER NOT NULL CHECK (page_no > 0),
  effective_original_ms INTEGER NOT NULL CHECK (
    effective_original_ms BETWEEN 0 AND 9007199254740991
  ),
  effective_text_ms INTEGER NOT NULL CHECK (
    effective_text_ms BETWEEN 0 AND 9007199254740991
  ),
  confirmed_interactions INTEGER NOT NULL CHECK (
    confirmed_interactions BETWEEN 0 AND 9007199254740991
  ),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at),
  version INTEGER NOT NULL CHECK (version >= 1),
  PRIMARY KEY (session_id, page_no),
  FOREIGN KEY (session_id) REFERENCES reading_summary_sessions(id) ON DELETE CASCADE
);

CREATE TRIGGER reading_summary_page_coverage_monotonic
BEFORE UPDATE ON reading_summary_page_coverage
WHEN NEW.session_id IS NOT OLD.session_id
  OR NEW.page_no IS NOT OLD.page_no
  OR NEW.effective_original_ms < OLD.effective_original_ms
  OR NEW.effective_text_ms < OLD.effective_text_ms
  OR NEW.confirmed_interactions < OLD.confirmed_interactions
  OR NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'reading summary page coverage must advance monotonically');
END;

CREATE TABLE reading_page_coverage (
  id TEXT PRIMARY KEY,
  organization_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  workspace_id_at_creation TEXT NOT NULL,
  book_version_id TEXT NOT NULL,
  page_no INTEGER NOT NULL CHECK (page_no > 0),
  effective_original_ms INTEGER NOT NULL CHECK (
    effective_original_ms BETWEEN 0 AND 9007199254740991
  ),
  effective_text_ms INTEGER NOT NULL CHECK (
    effective_text_ms BETWEEN 0 AND 9007199254740991
  ),
  confirmed_interactions INTEGER NOT NULL CHECK (
    confirmed_interactions BETWEEN 0 AND 9007199254740991
  ),
  last_covered_at TEXT NOT NULL CHECK (
    strftime('%Y-%m-%dT%H:%M:%fZ', last_covered_at) = last_covered_at
  ),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at),
  version INTEGER NOT NULL CHECK (version >= 1),
  UNIQUE (
    organization_id_at_creation,
    actor_id_at_creation,
    workspace_id_at_creation,
    book_version_id,
    page_no
  ),
  FOREIGN KEY (organization_id_at_creation) REFERENCES organizations(id),
  FOREIGN KEY (actor_id_at_creation, organization_id_at_creation)
    REFERENCES users(id, organization_id),
  FOREIGN KEY (workspace_id_at_creation, organization_id_at_creation)
    REFERENCES workspaces(id, organization_id),
  FOREIGN KEY (book_version_id, organization_id_at_creation)
    REFERENCES book_versions(id, organization_id_at_creation),
  FOREIGN KEY (book_version_id, page_no)
    REFERENCES book_pages(book_version_id, page_no)
);

CREATE INDEX reading_page_coverage_read_scope
  ON reading_page_coverage (
    organization_id_at_creation,
    actor_id_at_creation,
    workspace_id_at_creation,
    book_version_id,
    page_no
  );

CREATE TRIGGER reading_page_coverage_monotonic
BEFORE UPDATE ON reading_page_coverage
WHEN NEW.organization_id_at_creation IS NOT OLD.organization_id_at_creation
  OR NEW.actor_id_at_creation IS NOT OLD.actor_id_at_creation
  OR NEW.workspace_id_at_creation IS NOT OLD.workspace_id_at_creation
  OR NEW.book_version_id IS NOT OLD.book_version_id
  OR NEW.page_no IS NOT OLD.page_no
  OR NEW.effective_original_ms < OLD.effective_original_ms
  OR NEW.effective_text_ms < OLD.effective_text_ms
  OR NEW.confirmed_interactions < OLD.confirmed_interactions
  OR NEW.last_covered_at < OLD.last_covered_at
  OR NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'reading page coverage must advance monotonically');
END;
