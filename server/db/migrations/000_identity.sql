CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1)
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1)
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id),
  code TEXT NOT NULL CHECK (code IN ('class-teacher', 'grade-group', 'grade-admin', 'school-admin', 'platform-ops')),
  name TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('own', 'class', 'grade', 'school', 'platform')),
  scope_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1)
);

CREATE TABLE workspace_memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  UNIQUE (user_id, workspace_id)
);

CREATE TABLE role_assignments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  role_code TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('own', 'class', 'grade', 'school', 'platform')),
  scope_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  UNIQUE (user_id, workspace_id, role_code, scope_type, scope_id)
);

CREATE TABLE classes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  grade_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1)
);

CREATE TABLE class_memberships (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  membership_role TEXT NOT NULL CHECK (membership_role IN ('student', 'teacher', 'assistant')),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  UNIQUE (class_id, user_id)
);

CREATE TABLE workspace_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  preferences_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  UNIQUE (user_id, workspace_id)
);

CREATE INDEX idx_users_organization_id ON users(organization_id);
CREATE INDEX idx_workspace_memberships_user_id ON workspace_memberships(user_id);
CREATE INDEX idx_role_assignments_workspace_id ON role_assignments(workspace_id);
CREATE INDEX idx_class_memberships_user_id ON class_memberships(user_id);
