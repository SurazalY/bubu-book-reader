PRAGMA foreign_keys = ON;

CREATE TEMP TABLE migration_041_scope_guard (
  check_name TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO migration_041_scope_guard (check_name, valid)
SELECT 'privacy_request_scope_integrity', CASE WHEN NOT EXISTS (
  SELECT 1
  FROM privacy_access_requests AS access_request
  LEFT JOIN privacy_access_request_scopes AS scope
    ON scope.request_id = access_request.id
   AND scope.organization_id = access_request.organization_id
   AND scope.conversation_id = access_request.conversation_id
  WHERE scope.request_id IS NULL
) THEN 1 ELSE 0 END;

CREATE TABLE eye_care_enforcement_states (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('normal', 'reminder', 'forced_rest')),
  reminder_at TEXT,
  forced_rest_started_at TEXT,
  forced_rest_until TEXT,
  recovered_at TEXT,
  recovery_source TEXT CHECK (recovery_source IS NULL OR recovery_source IN ('timer', 'false_positive_release')),
  released_until TEXT,
  last_evaluated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (organization_id, actor_user_id, workspace_id),
  UNIQUE (id, organization_id, actor_user_id, workspace_id),
  FOREIGN KEY (actor_user_id, organization_id) REFERENCES users(id, organization_id),
  FOREIGN KEY (workspace_id, organization_id) REFERENCES workspaces(id, organization_id)
);

CREATE INDEX idx_eye_care_enforcement_scope
  ON eye_care_enforcement_states (organization_id, workspace_id, status, updated_at);

CREATE TABLE eye_care_release_records (
  id TEXT PRIMARY KEY,
  enforcement_state_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  released_by_user_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 4),
  released_until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  FOREIGN KEY (enforcement_state_id, organization_id, actor_user_id, workspace_id)
    REFERENCES eye_care_enforcement_states(id, organization_id, actor_user_id, workspace_id),
  FOREIGN KEY (released_by_user_id, organization_id) REFERENCES users(id, organization_id)
);

CREATE INDEX idx_eye_care_release_records_student
  ON eye_care_release_records (organization_id, actor_user_id, created_at DESC);

CREATE TRIGGER eye_care_release_records_block_update
BEFORE UPDATE ON eye_care_release_records
BEGIN
  SELECT RAISE(ABORT, 'eye_care_release_records are append-only');
END;

CREATE TRIGGER eye_care_release_records_block_delete
BEFORE DELETE ON eye_care_release_records
BEGIN
  SELECT RAISE(ABORT, 'eye_care_release_records are append-only');
END;

CREATE TABLE privacy_access_decisions (
  request_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  decided_by_user_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'denied')),
  decision_source TEXT NOT NULL CHECK (decision_source IN ('student', 'timeout_auto_approved')),
  decided_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  FOREIGN KEY (request_id, organization_id, owner_user_id, conversation_id)
    REFERENCES privacy_access_request_scopes(request_id, organization_id, owner_user_id, conversation_id),
  FOREIGN KEY (decided_by_user_id, organization_id) REFERENCES users(id, organization_id)
);

CREATE INDEX idx_privacy_access_decisions_owner
  ON privacy_access_decisions (organization_id, owner_user_id, decided_at DESC);

CREATE TRIGGER privacy_access_decisions_block_update
BEFORE UPDATE ON privacy_access_decisions
BEGIN
  SELECT RAISE(ABORT, 'privacy_access_decisions are append-only');
END;

CREATE TRIGGER privacy_access_decisions_block_delete
BEFORE DELETE ON privacy_access_decisions
BEGIN
  SELECT RAISE(ABORT, 'privacy_access_decisions are append-only');
END;

CREATE TABLE privacy_access_grants (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  requester_user_id TEXT NOT NULL,
  grant_source TEXT NOT NULL CHECK (grant_source IN ('student_approved', 'timeout_auto_approved')),
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  FOREIGN KEY (request_id, organization_id, owner_user_id, conversation_id)
    REFERENCES privacy_access_request_scopes(request_id, organization_id, owner_user_id, conversation_id),
  FOREIGN KEY (requester_user_id, organization_id) REFERENCES users(id, organization_id)
);

CREATE INDEX idx_privacy_access_grants_lookup
  ON privacy_access_grants (organization_id, owner_user_id, conversation_id, requester_user_id, expires_at);

CREATE TRIGGER privacy_access_grants_block_update
BEFORE UPDATE ON privacy_access_grants
BEGIN
  SELECT RAISE(ABORT, 'privacy_access_grants are append-only');
END;

CREATE TRIGGER privacy_access_grants_block_delete
BEFORE DELETE ON privacy_access_grants
BEGIN
  SELECT RAISE(ABORT, 'privacy_access_grants are append-only');
END;

CREATE TABLE privacy_access_history (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  viewer_user_id TEXT NOT NULL,
  request_id TEXT,
  access_mode TEXT NOT NULL CHECK (access_mode IN ('student_approved', 'timeout_auto_approved', 'safety_minimum_context')),
  purpose TEXT NOT NULL CHECK (length(trim(purpose)) >= 4),
  watermark TEXT NOT NULL,
  context_message_count INTEGER NOT NULL CHECK (context_message_count >= 0),
  student_visible INTEGER NOT NULL CHECK (student_visible IN (0, 1)),
  accessed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  FOREIGN KEY (organization_id, owner_user_id, conversation_id)
    REFERENCES ai_conversations(organization_id, owner_user_id, id),
  FOREIGN KEY (viewer_user_id, organization_id) REFERENCES users(id, organization_id),
  FOREIGN KEY (request_id, organization_id, owner_user_id, conversation_id)
    REFERENCES privacy_access_request_scopes(request_id, organization_id, owner_user_id, conversation_id)
);

CREATE INDEX idx_privacy_access_history_owner
  ON privacy_access_history (organization_id, owner_user_id, student_visible, accessed_at DESC);

CREATE INDEX idx_privacy_access_history_viewer
  ON privacy_access_history (organization_id, viewer_user_id, accessed_at DESC);

CREATE TRIGGER privacy_access_history_block_update
BEFORE UPDATE ON privacy_access_history
BEGIN
  SELECT RAISE(ABORT, 'privacy_access_history is append-only');
END;

CREATE TRIGGER privacy_access_history_block_delete
BEFORE DELETE ON privacy_access_history
BEGIN
  SELECT RAISE(ABORT, 'privacy_access_history is append-only');
END;

DROP TABLE migration_041_scope_guard;
