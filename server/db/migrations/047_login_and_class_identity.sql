-- Phase 8 T8.2：登录码、校内登录名/短编号、班级学段与届别。
-- 不创建注册凭据表，不写 book_access_grants，不改阅读摘要表。

ALTER TABLE organizations ADD COLUMN school_code TEXT COLLATE NOCASE;
ALTER TABLE users ADD COLUMN login_name TEXT COLLATE NOCASE;
ALTER TABLE users ADD COLUMN account_code TEXT COLLATE NOCASE;
ALTER TABLE classes ADD COLUMN stage TEXT;
ALTER TABLE classes ADD COLUMN entry_year INTEGER;
ALTER TABLE classes ADD COLUMN class_number INTEGER;

-- 只允许：0 个班（全新库只加列）或恰好 1 个且 id=internal-demo-class。
-- 其它既有班级不得按中文班名猜测。失败必须让本文件整事务回滚（含 ADD COLUMN）。
CREATE TEMP TABLE phase8_047_class_baseline (
  allowed INTEGER NOT NULL CHECK (allowed = 1)
);

INSERT INTO phase8_047_class_baseline (allowed)
SELECT CASE
  WHEN (SELECT COUNT(*) FROM classes) = 0 THEN 1
  WHEN (SELECT COUNT(*) FROM classes) = 1
    AND (SELECT id FROM classes) = 'internal-demo-class'
    THEN 1
  ELSE 0
END;

UPDATE organizations
SET school_code = 'internal-demo'
WHERE id = 'internal-demo-organization';

UPDATE users
SET
  login_name = username,
  account_code = 'A' || printf('%07d', rowid);

UPDATE classes
SET
  stage = 'primary',
  entry_year = 2023,
  class_number = 1,
  grade_id = 'primary:2023'
WHERE id = 'internal-demo-class';

CREATE UNIQUE INDEX uq_organizations_school_code
  ON organizations(school_code COLLATE NOCASE)
  WHERE school_code IS NOT NULL;

CREATE UNIQUE INDEX uq_users_organization_login_name
  ON users(organization_id, login_name COLLATE NOCASE)
  WHERE login_name IS NOT NULL;

CREATE UNIQUE INDEX uq_users_organization_account_code
  ON users(organization_id, account_code COLLATE NOCASE)
  WHERE account_code IS NOT NULL;

CREATE UNIQUE INDEX uq_classes_organization_grade_number
  ON classes(organization_id, grade_id, class_number);

CREATE UNIQUE INDEX uq_workspaces_active_organization_scope
  ON workspaces(organization_id, scope_type, scope_id)
  WHERE status = 'active';

CREATE TRIGGER organizations_school_code_required_insert
BEFORE INSERT ON organizations
FOR EACH ROW
WHEN NEW.school_code IS NULL OR trim(NEW.school_code) = ''
BEGIN
  SELECT RAISE(ABORT, 'organizations.school_code must be a non-empty school code');
END;

CREATE TRIGGER organizations_school_code_required_update
BEFORE UPDATE OF school_code ON organizations
FOR EACH ROW
WHEN NEW.school_code IS NULL OR trim(NEW.school_code) = ''
BEGIN
  SELECT RAISE(ABORT, 'organizations.school_code must be a non-empty school code');
END;

CREATE TRIGGER users_login_identity_required_insert
BEFORE INSERT ON users
FOR EACH ROW
WHEN NEW.login_name IS NULL OR trim(NEW.login_name) = ''
  OR NEW.account_code IS NULL OR trim(NEW.account_code) = ''
BEGIN
  SELECT RAISE(ABORT, 'users.login_name and users.account_code must be non-empty');
END;

CREATE TRIGGER users_login_identity_required_update
BEFORE UPDATE OF login_name, account_code ON users
FOR EACH ROW
WHEN NEW.login_name IS NULL OR trim(NEW.login_name) = ''
  OR NEW.account_code IS NULL OR trim(NEW.account_code) = ''
BEGIN
  SELECT RAISE(ABORT, 'users.login_name and users.account_code must be non-empty');
END;

CREATE TRIGGER classes_identity_contract_insert
BEFORE INSERT ON classes
FOR EACH ROW
WHEN NEW.stage IS NOT NULL
  OR NEW.entry_year IS NOT NULL
  OR NEW.class_number IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW.stage NOT IN ('primary', 'junior', 'senior')
      THEN RAISE(ABORT, 'classes.stage must be primary, junior, or senior')
    WHEN NEW.entry_year IS NULL
      OR typeof(NEW.entry_year) NOT IN ('integer', 'real')
      OR CAST(NEW.entry_year AS INTEGER) != NEW.entry_year
      OR NEW.entry_year < 2000
      OR NEW.entry_year > 2100
      THEN RAISE(ABORT, 'classes.entry_year must be a four-digit year from 2000 to 2100')
    WHEN NEW.class_number IS NULL
      OR typeof(NEW.class_number) NOT IN ('integer', 'real')
      OR CAST(NEW.class_number AS INTEGER) != NEW.class_number
      OR NEW.class_number < 1
      THEN RAISE(ABORT, 'classes.class_number must be a positive integer')
    WHEN NEW.grade_id IS NULL
      OR NEW.grade_id <> (NEW.stage || ':' || NEW.entry_year)
      THEN RAISE(ABORT, 'classes.grade_id must equal stage || '':'' || entry_year')
  END;
END;

CREATE TRIGGER classes_identity_contract_update
BEFORE UPDATE OF stage, entry_year, class_number, grade_id ON classes
FOR EACH ROW
WHEN NEW.stage IS NOT NULL
  OR NEW.entry_year IS NOT NULL
  OR NEW.class_number IS NOT NULL
  OR OLD.stage IS NOT NULL
  OR OLD.entry_year IS NOT NULL
  OR OLD.class_number IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW.stage NOT IN ('primary', 'junior', 'senior')
      THEN RAISE(ABORT, 'classes.stage must be primary, junior, or senior')
    WHEN NEW.entry_year IS NULL
      OR typeof(NEW.entry_year) NOT IN ('integer', 'real')
      OR CAST(NEW.entry_year AS INTEGER) != NEW.entry_year
      OR NEW.entry_year < 2000
      OR NEW.entry_year > 2100
      THEN RAISE(ABORT, 'classes.entry_year must be a four-digit year from 2000 to 2100')
    WHEN NEW.class_number IS NULL
      OR typeof(NEW.class_number) NOT IN ('integer', 'real')
      OR CAST(NEW.class_number AS INTEGER) != NEW.class_number
      OR NEW.class_number < 1
      THEN RAISE(ABORT, 'classes.class_number must be a positive integer')
    WHEN NEW.grade_id IS NULL
      OR NEW.grade_id <> (NEW.stage || ':' || NEW.entry_year)
      THEN RAISE(ABORT, 'classes.grade_id must equal stage || '':'' || entry_year')
  END;
END;

DROP TABLE phase8_047_class_baseline;
