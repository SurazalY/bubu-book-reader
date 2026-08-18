-- T5.1 阅读模式偏好。编号必须是 046，禁止使用 030。
-- 号段矛盾：前任交接写 T5.1 取 030，未核 server/db/migrations/ 目录；
-- 实测 030_community_reports_delivery.sql 已占用 030；若不改用 046 会撞社区举报表。
-- 2026-08-18 用户允许改用 046。禁止创建 030 号迁移，禁止改已有 030 文件。
-- 表字段对应 B-3：org / user / book_version_id / mode / updated_at；唯一键 user + book_version。

CREATE TABLE reader_mode_preferences (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  book_version_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('original', 'text')),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at),
  PRIMARY KEY (user_id, book_version_id),
  FOREIGN KEY (user_id, organization_id) REFERENCES users(id, organization_id),
  FOREIGN KEY (book_version_id, organization_id) REFERENCES book_versions(id, organization_id_at_creation)
);
