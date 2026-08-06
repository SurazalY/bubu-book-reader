CREATE UNIQUE INDEX IF NOT EXISTS uq_users_id_organization_id ON users(id, organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_id_organization_id ON workspaces(id, organization_id);

ALTER TABLE role_assignments RENAME TO role_assignments_v004;

CREATE TABLE role_assignment_quarantine (
  source_assignment_id TEXT PRIMARY KEY,
  organization_id TEXT,
  user_id TEXT,
  workspace_id TEXT,
  role_code TEXT,
  scope_type TEXT,
  scope_id TEXT,
  status TEXT,
  source_created_at TEXT,
  source_updated_at TEXT,
  source_version INTEGER,
  reason TEXT NOT NULL CHECK (
    reason IN (
      'actor_missing',
      'workspace_missing',
      'organization_missing',
      'workspace_unscoped',
      'organization_mismatch',
      'scope_mismatch'
    )
  ),
  quarantined_at TEXT NOT NULL
);

INSERT INTO role_assignment_quarantine (
  source_assignment_id, organization_id, user_id, workspace_id, role_code,
  scope_type, scope_id, status, source_created_at, source_updated_at,
  source_version, reason, quarantined_at
)
SELECT
  assignments.id,
  actors.organization_id,
  assignments.user_id,
  assignments.workspace_id,
  assignments.role_code,
  assignments.scope_type,
  assignments.scope_id,
  assignments.status,
  assignments.created_at,
  assignments.updated_at,
  assignments.version,
  CASE
    WHEN actors.id IS NULL THEN 'actor_missing'
    WHEN workspaces.id IS NULL THEN 'workspace_missing'
    WHEN workspaces.organization_id IS NULL THEN 'workspace_unscoped'
    WHEN actor_organizations.id IS NULL OR workspace_organizations.id IS NULL THEN 'organization_missing'
    WHEN actors.organization_id <> workspaces.organization_id THEN 'organization_mismatch'
    ELSE 'scope_mismatch'
  END,
  CURRENT_TIMESTAMP
FROM role_assignments_v004 AS assignments
LEFT JOIN users AS actors ON actors.id = assignments.user_id
LEFT JOIN workspaces ON workspaces.id = assignments.workspace_id
LEFT JOIN organizations AS actor_organizations ON actor_organizations.id = actors.organization_id
LEFT JOIN organizations AS workspace_organizations ON workspace_organizations.id = workspaces.organization_id
WHERE actors.id IS NULL
  OR workspaces.id IS NULL
  OR actor_organizations.id IS NULL
  OR workspace_organizations.id IS NULL
  OR workspaces.organization_id IS NULL
  OR actors.organization_id <> workspaces.organization_id
  OR assignments.scope_type <> workspaces.scope_type
  OR assignments.scope_id <> workspaces.scope_id;

CREATE TABLE role_assignments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  role_code TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('own', 'class', 'grade', 'school', 'platform')),
  scope_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  UNIQUE (organization_id, user_id, workspace_id, role_code, scope_type, scope_id),
  FOREIGN KEY (user_id, organization_id) REFERENCES users(id, organization_id),
  FOREIGN KEY (workspace_id, organization_id) REFERENCES workspaces(id, organization_id)
);

INSERT INTO role_assignments (
  id, organization_id, user_id, workspace_id, role_code, scope_type,
  scope_id, status, created_at, updated_at, version
)
SELECT
  assignments.id,
  actors.organization_id,
  assignments.user_id,
  assignments.workspace_id,
  assignments.role_code,
  assignments.scope_type,
  assignments.scope_id,
  assignments.status,
  assignments.created_at,
  assignments.updated_at,
  assignments.version
FROM role_assignments_v004 AS assignments
JOIN users AS actors ON actors.id = assignments.user_id
JOIN organizations AS actor_organizations ON actor_organizations.id = actors.organization_id
JOIN workspaces
  ON workspaces.id = assignments.workspace_id
  AND workspaces.organization_id = actors.organization_id
JOIN organizations AS workspace_organizations ON workspace_organizations.id = workspaces.organization_id
WHERE assignments.scope_type = workspaces.scope_type
  AND assignments.scope_id = workspaces.scope_id;

DROP TABLE role_assignments_v004;

CREATE INDEX idx_role_assignments_workspace_id ON role_assignments(workspace_id);
CREATE INDEX idx_role_assignments_actor_context
  ON role_assignments(user_id, organization_id, workspace_id, status);
CREATE INDEX idx_role_assignment_quarantine_reason ON role_assignment_quarantine(reason, quarantined_at);

CREATE TRIGGER role_assignments_require_same_organization_insert
BEFORE INSERT ON role_assignments
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM users AS actors
  JOIN organizations ON organizations.id = NEW.organization_id
  JOIN workspaces
    ON workspaces.id = NEW.workspace_id
    AND workspaces.organization_id = NEW.organization_id
  WHERE actors.id = NEW.user_id
    AND actors.organization_id = NEW.organization_id
    AND workspaces.scope_type = NEW.scope_type
    AND workspaces.scope_id = NEW.scope_id
)
BEGIN
  SELECT RAISE(ABORT, 'role assignment requires actor, workspace, and scope in the same organization');
END;

CREATE TRIGGER role_assignments_require_same_organization_update
BEFORE UPDATE OF organization_id, user_id, workspace_id, scope_type, scope_id ON role_assignments
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
  FROM users AS actors
  JOIN organizations ON organizations.id = NEW.organization_id
  JOIN workspaces
    ON workspaces.id = NEW.workspace_id
    AND workspaces.organization_id = NEW.organization_id
  WHERE actors.id = NEW.user_id
    AND actors.organization_id = NEW.organization_id
    AND workspaces.scope_type = NEW.scope_type
    AND workspaces.scope_id = NEW.scope_id
)
BEGIN
  SELECT RAISE(ABORT, 'role assignment requires actor, workspace, and scope in the same organization');
END;

ALTER TABLE idempotency_records RENAME TO idempotency_records_v004;

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
  lease_owner TEXT,
  lease_epoch INTEGER NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
  lease_until TEXT,
  external_effect_started INTEGER NOT NULL DEFAULT 0 CHECK (external_effect_started IN (0, 1)),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  failure_code TEXT,
  failure_reason TEXT,
  retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1)),
  reconciliation_required INTEGER NOT NULL DEFAULT 0 CHECK (reconciliation_required IN (0, 1)),
  provider_reference TEXT,
  failure_at TEXT,
  UNIQUE (scope_key, idempotency_key),
  CHECK (
    state <> 'pending'
    OR (lease_owner IS NOT NULL AND lease_epoch >= 1 AND lease_until IS NOT NULL)
  )
);

INSERT INTO idempotency_records (
  id, scope_key, idempotency_key, request_hash, status_code, response_json, session_id,
  created_at, updated_at, version, state, lease_owner, lease_epoch, lease_until,
  external_effect_started, attempt_count, failure_code, failure_reason, retryable,
  reconciliation_required, provider_reference, failure_at
)
SELECT
  id,
  scope_key,
  idempotency_key,
  request_hash,
  CASE WHEN state = 'pending' THEN 503 ELSE status_code END,
  CASE
    WHEN state = 'pending' THEN
      '{"error":{"code":"DEPENDENCY_UNAVAILABLE","message":"升级前操作结果未知，需要对账确认","retryable":false,"details":{"reconciliationRequired":true}}}'
    ELSE response_json
  END,
  session_id,
  created_at,
  updated_at,
  version,
  CASE WHEN state = 'pending' THEN 'unknown' ELSE state END,
  NULL,
  CASE WHEN state = 'pending' THEN attempt_count ELSE 0 END,
  NULL,
  external_effect_started,
  attempt_count,
  CASE WHEN state = 'pending' THEN 'LEGACY_PROCESSING_REQUIRES_RECONCILIATION' ELSE failure_code END,
  CASE WHEN state = 'pending' THEN '升级前 processing/pending 结果未知，需要人工对账' ELSE failure_reason END,
  CASE WHEN state = 'pending' THEN 0 ELSE retryable END,
  CASE WHEN state = 'pending' THEN 1 ELSE reconciliation_required END,
  NULL,
  CASE WHEN state = 'pending' THEN updated_at ELSE failure_at END
FROM idempotency_records_v004;

DROP TABLE idempotency_records_v004;

CREATE INDEX idx_idempotency_records_created_at ON idempotency_records(created_at);
CREATE INDEX idx_idempotency_records_state_lease ON idempotency_records(state, lease_until);
CREATE INDEX idx_idempotency_records_reconciliation
  ON idempotency_records(reconciliation_required, updated_at);
