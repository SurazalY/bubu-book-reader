CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  organization_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS book_versions (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  organization_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  label TEXT NOT NULL,
  source_format TEXT NOT NULL CHECK (source_format IN ('pdf', 'epub', 'text')),
  page_count INTEGER NOT NULL CHECK (page_count > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS book_versions_book_label_unique ON book_versions(book_id, label);

CREATE TABLE IF NOT EXISTS book_pages (
  id TEXT PRIMARY KEY,
  book_version_id TEXT NOT NULL,
  page_no INTEGER NOT NULL CHECK (page_no > 0),
  text_content TEXT NOT NULL DEFAULT '',
  width REAL NOT NULL CHECK (width > 0),
  height REAL NOT NULL CHECK (height > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(book_version_id, page_no)
);

CREATE TABLE IF NOT EXISTS book_blocks (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  block_key TEXT NOT NULL,
  paragraph_id TEXT,
  text_content TEXT NOT NULL DEFAULT '',
  char_start INTEGER NOT NULL CHECK (char_start >= 0),
  char_end INTEGER NOT NULL CHECK (char_end >= char_start),
  x REAL NOT NULL CHECK (x >= 0),
  y REAL NOT NULL CHECK (y >= 0),
  width REAL NOT NULL CHECK (width >= 0),
  height REAL NOT NULL CHECK (height >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(page_id, block_key)
);

CREATE TABLE IF NOT EXISTS book_assets (
  id TEXT PRIMARY KEY,
  book_version_id TEXT NOT NULL,
  page_id TEXT,
  asset_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  usage_label TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  width REAL CHECK (width IS NULL OR width > 0),
  height REAL CHECK (height IS NULL OR height > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(book_version_id, storage_key)
);

CREATE TABLE IF NOT EXISTS book_access_grants (
  id TEXT PRIMARY KEY,
  book_version_id TEXT NOT NULL,
  grantee_type TEXT NOT NULL,
  grantee_id TEXT NOT NULL,
  organization_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(book_version_id, grantee_type, grantee_id)
);

CREATE TABLE IF NOT EXISTS book_hidden_evidence_snapshots (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  book_version_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  hidden_at TEXT NOT NULL,
  organization_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(book_version_id)
);
