-- T3-2 / 契约 3.3.1：教师签发的可见临时密码明文表。
-- 本系统唯一允许存放密码明文的地方，且只存教师签发的临时密码，永远不存学生自己设置的密码。
-- issued_temp_password_clear_markers 只记「曾经签发后被学生自改清掉」，不含任何密码字段。
-- migrate.js 按 checksum 跳过已应用记录，本文件可重复跑迁移器。

CREATE TABLE issued_temp_passwords (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  target_user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  plaintext TEXT NOT NULL,
  issued_by_user_id TEXT NOT NULL REFERENCES users(id),
  issued_workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  issued_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE issued_temp_password_clear_markers (
  target_user_id TEXT NOT NULL PRIMARY KEY REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  cleared_at TEXT NOT NULL
);
