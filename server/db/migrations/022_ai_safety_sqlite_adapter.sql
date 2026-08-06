PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_idempotency_requests (
  idempotency_key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) BETWEEN 16 AND 512),
  request_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
  lease_token TEXT UNIQUE,
  lease_expires_at TEXT,
  response_json TEXT,
  reservation_json TEXT,
  reason_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  failed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  CHECK (
    (status = 'in_progress' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND response_json IS NULL)
    OR (status = 'completed' AND lease_token IS NULL AND lease_expires_at IS NULL AND response_json IS NOT NULL AND completed_at IS NOT NULL)
    OR (status = 'failed' AND lease_token IS NULL AND lease_expires_at IS NULL AND response_json IS NULL AND failed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_ai_idempotency_status_expiry
  ON ai_idempotency_requests (status, lease_expires_at);
