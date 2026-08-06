CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id),
  workspace_id TEXT REFERENCES workspaces(id),
  scope_snapshot_json TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  request_id TEXT,
  idempotency_key TEXT,
  outcome TEXT NOT NULL,
  reason_code TEXT,
  before_version INTEGER,
  after_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1)
);

CREATE TRIGGER audit_events_block_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events are append-only');
END;

CREATE TRIGGER audit_events_block_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events are append-only');
END;

CREATE TABLE idempotency_records (
  id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  session_id TEXT REFERENCES sessions(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  UNIQUE (scope_key, idempotency_key)
);

CREATE TABLE outbox_events (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  available_at TEXT NOT NULL,
  locked_at TEXT,
  processed_at TEXT,
  last_error TEXT,
  dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1)
);

CREATE TABLE job_runs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  snapshot_version INTEGER,
  configuration_version INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  dedupe_key TEXT NOT NULL UNIQUE,
  started_at TEXT,
  finished_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1)
);

CREATE INDEX idx_audit_events_workspace_created_at ON audit_events(workspace_id, created_at);
CREATE INDEX idx_audit_events_actor_created_at ON audit_events(actor_user_id, created_at);
CREATE INDEX idx_idempotency_records_created_at ON idempotency_records(created_at);
CREATE INDEX idx_outbox_events_status_available_at ON outbox_events(status, available_at);
