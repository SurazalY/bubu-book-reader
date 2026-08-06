ALTER TABLE idempotency_records ADD COLUMN state TEXT NOT NULL DEFAULT 'completed' CHECK (state IN ('processing', 'completed'));
ALTER TABLE idempotency_records ADD COLUMN lease_token TEXT;
ALTER TABLE idempotency_records ADD COLUMN lease_expires_at TEXT;
ALTER TABLE idempotency_records ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1);

CREATE INDEX idx_idempotency_records_state_lease ON idempotency_records(state, lease_expires_at);
CREATE INDEX idx_class_memberships_user_status ON class_memberships(user_id, status);
CREATE INDEX idx_classes_organization_grade_status ON classes(organization_id, grade_id, status);
CREATE INDEX idx_workspaces_organization_scope_status ON workspaces(organization_id, scope_type, status);
