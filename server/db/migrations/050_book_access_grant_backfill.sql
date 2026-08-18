-- Phase 8 T8.2：默认全闭前的 book_access_grants 等价回填。
-- 不改表结构，不删既有 grant，不用 ON CONFLICT DO NOTHING。
-- 时间取同一次 runMigrations 写入的 schema_migrations.applied_at，禁止 datetime('now')。

CREATE TEMP TABLE phase8_050_now (
  now TEXT NOT NULL,
  academic_start_year INTEGER NOT NULL
);

INSERT INTO phase8_050_now (now, academic_start_year)
SELECT
  applied_at,
  CASE
    WHEN CAST(strftime('%m', datetime(replace(substr(applied_at, 1, 19), 'T', ' '), '+8 hours')) AS INTEGER) >= 9
    THEN CAST(strftime('%Y', datetime(replace(substr(applied_at, 1, 19), 'T', ' '), '+8 hours')) AS INTEGER)
    ELSE CAST(strftime('%Y', datetime(replace(substr(applied_at, 1, 19), 'T', ' '), '+8 hours')) AS INTEGER) - 1
  END
FROM schema_migrations
WHERE id GLOB '047_*'
   OR id GLOB '048_*'
   OR id GLOB '049_*'
ORDER BY id DESC
LIMIT 1;

CREATE TEMP TABLE phase8_050_preconditions (
  allowed INTEGER NOT NULL CHECK (allowed = 1)
);

INSERT INTO phase8_050_preconditions (allowed)
SELECT CASE
  WHEN (SELECT COUNT(*) FROM phase8_050_now) <> 1 THEN 0
  WHEN (SELECT COUNT(*) FROM book_access_grants) <> 0 THEN 0
  WHEN EXISTS (
    SELECT 1
    FROM books
    WHERE status = 'published'
      AND (
        SELECT latest.id
        FROM book_versions AS latest
        WHERE latest.book_id = books.id
        ORDER BY latest.created_at DESC, latest.id DESC
        LIMIT 1
      ) IS NULL
  ) THEN 0
  ELSE 1
END;

INSERT INTO book_access_grants (
  id,
  book_version_id,
  grantee_type,
  grantee_id,
  organization_id_at_creation,
  actor_id_at_creation,
  created_at,
  updated_at,
  version
)
SELECT
  'phase8-backfill-050:' || current_version.id || ':' || classes.id,
  current_version.id,
  'class',
  classes.id,
  classes.organization_id,
  'phase8-migration-050',
  phase8_050_now.now,
  phase8_050_now.now,
  1
FROM books
JOIN phase8_050_now
JOIN classes
  ON classes.organization_id = books.organization_id_at_creation
  AND classes.status = 'active'
JOIN book_versions AS current_version
  ON current_version.id = (
    SELECT latest.id
    FROM book_versions AS latest
    WHERE latest.book_id = books.id
    ORDER BY latest.created_at DESC, latest.id DESC
    LIMIT 1
  )
WHERE books.status = 'published'
  AND (
    CASE classes.stage
      WHEN 'primary' THEN 6
      WHEN 'junior' THEN 3
      WHEN 'senior' THEN 3
    END
  ) >= (phase8_050_now.academic_start_year - classes.entry_year + 1);

DROP TABLE phase8_050_preconditions;
DROP TABLE phase8_050_now;
