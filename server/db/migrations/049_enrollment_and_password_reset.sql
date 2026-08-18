-- Phase 8 T8.2：入班申请、密码重置凭据、一名学生最多一个 active 班。
-- 不改 reading_summary_sessions / reading_daily_book_summaries。

CREATE TEMP TABLE phase8_049_student_membership_baseline (
  allowed INTEGER NOT NULL CHECK (allowed = 1)
);

INSERT INTO phase8_049_student_membership_baseline (allowed)
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM class_memberships
    WHERE membership_role = 'student'
      AND status = 'active'
    GROUP BY user_id
    HAVING COUNT(*) > 1
  ) THEN 0
  ELSE 1
END;

CREATE TABLE student_enrollment_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  student_user_id TEXT NOT NULL REFERENCES users(id),
  class_id TEXT NOT NULL REFERENCES classes(id),
  status TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,
  decision_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE UNIQUE INDEX uq_student_enrollment_requests_pending_student
  ON student_enrollment_requests(student_user_id)
  WHERE status = 'pending';

CREATE TABLE password_reset_credentials (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  target_user_id TEXT NOT NULL REFERENCES users(id),
  secret_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  revoked_reason TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  UNIQUE (secret_hash),
  CHECK (version >= 1)
);

CREATE UNIQUE INDEX uq_class_memberships_active_student
  ON class_memberships(user_id)
  WHERE membership_role = 'student' AND status = 'active';

DROP TABLE phase8_049_student_membership_baseline;
