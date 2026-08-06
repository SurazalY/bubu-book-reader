CREATE TABLE IF NOT EXISTS reading_assignments (
  id TEXT PRIMARY KEY,
  organization_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  workspace_id_at_creation TEXT NOT NULL,
  book_version_id TEXT NOT NULL,
  title TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS assignment_classes (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(assignment_id, class_id)
);

CREATE TABLE IF NOT EXISTS class_sessions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  organization_id_at_creation TEXT NOT NULL,
  workspace_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  locked_book_version_id TEXT,
  synced_page_no INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS class_session_clients (
  id TEXT PRIMARY KEY,
  class_session_id TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS class_broadcasts (
  id TEXT PRIMARY KEY,
  class_session_id TEXT NOT NULL,
  source_request_id TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  message_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(class_session_id, source_request_id)
);

CREATE TABLE IF NOT EXISTS class_broadcast_outbox (
  id TEXT PRIMARY KEY,
  class_broadcast_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatched', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS integration_clients (
  id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL UNIQUE,
  audience TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS integration_launch_tokens (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(client_id, nonce)
);

CREATE TABLE IF NOT EXISTS integration_launches (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  page_no INTEGER,
  class_session_id TEXT,
  return_uri TEXT NOT NULL,
  launched_at TEXT NOT NULL,
  returned_at TEXT,
  return_payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
