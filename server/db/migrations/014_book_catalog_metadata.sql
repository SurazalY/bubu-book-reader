CREATE TABLE IF NOT EXISTS book_catalog_metadata (
  book_id TEXT PRIMARY KEY REFERENCES books(id),
  author TEXT NOT NULL,
  illustrator TEXT,
  source_page TEXT NOT NULL,
  usage_label TEXT NOT NULL,
  rights_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_book_catalog_metadata_source_page
  ON book_catalog_metadata(source_page);
