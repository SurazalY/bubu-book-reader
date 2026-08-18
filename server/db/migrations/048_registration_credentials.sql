-- Phase 8 T8.2：注册凭据与成功使用记录。不创建用户，不预置业务 token。

CREATE TABLE registration_credentials (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  secret_hash TEXT NOT NULL,
  expected_role TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  max_uses INTEGER,
  successful_use_count INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT,
  revoked_by TEXT,
  revoked_reason TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  UNIQUE (secret_hash),
  CHECK (expected_role IN ('student', 'teacher')),
  CHECK (scope_type IN ('school', 'grade')),
  CHECK (
    length(secret_hash) = 64
    AND secret_hash GLOB replace(hex(zeroblob(32)), '0', '[0-9A-Fa-f]')
  ),
  CHECK (max_uses IS NULL OR (
    typeof(max_uses) = 'integer'
    AND max_uses >= 1
  )),
  CHECK (successful_use_count >= 0)
);

CREATE TABLE registration_credential_uses (
  id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL REFERENCES registration_credentials(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  expected_role TEXT NOT NULL,
  created_user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  used_at TEXT NOT NULL,
  UNIQUE (created_user_id)
);
