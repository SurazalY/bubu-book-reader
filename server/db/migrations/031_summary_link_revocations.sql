CREATE TABLE IF NOT EXISTS delivery_link_revocations (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL UNIQUE,
  revoked_by_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  revoked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
