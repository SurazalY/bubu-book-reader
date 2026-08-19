-- T2-2 / 契约 3.2.1：users.login_name 升为全局唯一。
-- 组织内唯一索引 uq_users_organization_login_name 保留。
-- organizations.school_code 列、唯一索引与非空触发器全部保留不动。
-- 冲突（跨组织撞名）即失败，不做回填。migrate.js 按 checksum 跳过已应用记录，本文件可重复跑迁移器。

CREATE UNIQUE INDEX uq_users_login_name_global
  ON users(login_name COLLATE NOCASE)
  WHERE login_name IS NOT NULL;
