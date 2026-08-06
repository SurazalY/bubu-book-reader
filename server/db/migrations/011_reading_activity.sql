CREATE TABLE IF NOT EXISTS active_reading_leases (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  book_version_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  released_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS active_reading_leases_actor_open_unique
  ON active_reading_leases(actor_id) WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS reading_events (
  id TEXT PRIMARY KEY,
  organization_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  workspace_id_at_creation TEXT NOT NULL,
  device_id TEXT NOT NULL,
  book_version_id TEXT NOT NULL,
  page_no INTEGER NOT NULL CHECK (page_no > 0),
  event_type TEXT NOT NULL,
  client_occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  foreground INTEGER NOT NULL CHECK (foreground IN (0, 1)),
  screen_on INTEGER NOT NULL CHECK (screen_on IN (0, 1)),
  offline_sequence INTEGER NOT NULL,
  event_fingerprint TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  valid_reading_seconds INTEGER NOT NULL DEFAULT 0,
  valid_eye_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS reading_events_device_offline_sequence_unique
  ON reading_events(actor_id_at_creation, workspace_id_at_creation, device_id, offline_sequence);

CREATE TABLE IF NOT EXISTS reading_sessions (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  book_version_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS reading_progress (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  book_version_id TEXT NOT NULL,
  last_page_no INTEGER NOT NULL DEFAULT 1,
  valid_reading_seconds INTEGER NOT NULL DEFAULT 0,
  updated_from_event_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(actor_id, workspace_id, book_version_id)
);

CREATE TABLE IF NOT EXISTS reading_policy_versions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS eye_care_usage (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  window_start_at TEXT NOT NULL,
  window_kind TEXT NOT NULL CHECK (window_kind IN ('day', 'week')),
  valid_eye_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(actor_id, workspace_id, window_kind, window_start_at)
);

CREATE TABLE IF NOT EXISTS eye_care_states (
  actor_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  continuous_eye_seconds INTEGER NOT NULL DEFAULT 0,
  last_active_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(actor_id, workspace_id)
);
