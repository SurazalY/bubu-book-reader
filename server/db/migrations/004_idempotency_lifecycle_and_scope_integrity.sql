ALTER TABLE idempotency_records RENAME TO idempotency_records_v003;

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
  state TEXT NOT NULL CHECK (state IN ('pending', 'succeeded', 'failed', 'unknown')),
  lease_token TEXT,
  lease_expires_at TEXT,
  external_effect_started INTEGER NOT NULL DEFAULT 0 CHECK (external_effect_started IN (0, 1)),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  failure_code TEXT,
  failure_reason TEXT,
  retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1)),
  reconciliation_required INTEGER NOT NULL DEFAULT 0 CHECK (reconciliation_required IN (0, 1)),
  failure_at TEXT,
  UNIQUE (scope_key, idempotency_key)
);

INSERT INTO idempotency_records (
  id, scope_key, idempotency_key, request_hash, status_code, response_json, session_id,
  created_at, updated_at, version, state, lease_token, lease_expires_at, external_effect_started, attempt_count,
  failure_code, failure_reason, retryable, reconciliation_required, failure_at
)
SELECT
  id, scope_key, idempotency_key, request_hash, status_code, response_json, session_id,
  created_at, updated_at, version,
  CASE state WHEN 'completed' THEN 'succeeded' ELSE 'pending' END,
  lease_token, lease_expires_at, 0, attempt_count,
  NULL, NULL, 0, 0, NULL
FROM idempotency_records_v003;

DROP TABLE idempotency_records_v003;

CREATE INDEX idx_idempotency_records_created_at ON idempotency_records(created_at);
CREATE INDEX idx_idempotency_records_state_lease ON idempotency_records(state, lease_expires_at);
CREATE INDEX idx_idempotency_records_reconciliation ON idempotency_records(reconciliation_required, updated_at);

CREATE TRIGGER class_memberships_require_active_same_organization_insert
BEFORE INSERT ON class_memberships
FOR EACH ROW
WHEN NEW.status = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM users
    JOIN organizations AS user_organizations ON user_organizations.id = users.organization_id
    JOIN classes ON classes.id = NEW.class_id
    JOIN organizations AS class_organizations ON class_organizations.id = classes.organization_id
    WHERE users.id = NEW.user_id
      AND users.status = 'active'
      AND user_organizations.status = 'active'
      AND classes.status = 'active'
      AND class_organizations.status = 'active'
      AND classes.organization_id = users.organization_id
  )
BEGIN
  SELECT RAISE(ABORT, 'active class membership requires active user and class in the same organization');
END;

CREATE TRIGGER class_memberships_require_active_same_organization_update
BEFORE UPDATE OF class_id, user_id, status ON class_memberships
FOR EACH ROW
WHEN NEW.status = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM users
    JOIN organizations AS user_organizations ON user_organizations.id = users.organization_id
    JOIN classes ON classes.id = NEW.class_id
    JOIN organizations AS class_organizations ON class_organizations.id = classes.organization_id
    WHERE users.id = NEW.user_id
      AND users.status = 'active'
      AND user_organizations.status = 'active'
      AND classes.status = 'active'
      AND class_organizations.status = 'active'
      AND classes.organization_id = users.organization_id
  )
BEGIN
  SELECT RAISE(ABORT, 'active class membership requires active user and class in the same organization');
END;
