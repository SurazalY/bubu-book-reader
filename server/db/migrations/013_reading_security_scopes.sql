DROP INDEX IF EXISTS reading_events_device_offline_sequence_unique;

CREATE UNIQUE INDEX IF NOT EXISTS reading_events_tenant_device_offline_sequence_unique
  ON reading_events(organization_id_at_creation, actor_id_at_creation, device_id, offline_sequence);

CREATE TABLE IF NOT EXISTS reading_device_lease_history (
  id TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  book_version_id TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  CHECK (valid_from <= valid_until)
);

CREATE INDEX IF NOT EXISTS reading_device_lease_history_event_match
  ON reading_device_lease_history(
    organization_id,
    actor_id,
    workspace_id,
    device_id,
    book_version_id,
    valid_from,
    valid_until
  );

CREATE INDEX IF NOT EXISTS reading_device_lease_history_lease_id
  ON reading_device_lease_history(lease_id, valid_until);

CREATE TABLE IF NOT EXISTS integration_launch_scopes (
  launch_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  subject_student_id TEXT NOT NULL,
  class_session_id TEXT,
  book_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  token_nonce TEXT NOT NULL,
  token_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (launch_id) REFERENCES integration_launches(id)
);

CREATE INDEX IF NOT EXISTS integration_launch_scopes_full_scope
  ON integration_launch_scopes(
    launch_id,
    organization_id,
    workspace_id,
    actor_id,
    subject_student_id,
    class_session_id,
    book_id,
    device_id,
    token_nonce,
    token_fingerprint
  );

CREATE TRIGGER IF NOT EXISTS integration_launch_scopes_immutable_update
BEFORE UPDATE ON integration_launch_scopes
BEGIN
  SELECT RAISE(ABORT, 'integration launch scope is immutable');
END;

CREATE TRIGGER IF NOT EXISTS integration_launch_scopes_immutable_delete
BEFORE DELETE ON integration_launch_scopes
BEGIN
  SELECT RAISE(ABORT, 'integration launch scope is immutable');
END;

CREATE TRIGGER IF NOT EXISTS integration_launches_scoped_identity_immutable_update
BEFORE UPDATE OF client_id, subject_id, device_id, book_id, class_session_id, return_uri ON integration_launches
WHEN EXISTS (SELECT 1 FROM integration_launch_scopes WHERE launch_id = OLD.id)
  AND (
    NEW.client_id IS NOT OLD.client_id
    OR NEW.subject_id IS NOT OLD.subject_id
    OR NEW.device_id IS NOT OLD.device_id
    OR NEW.book_id IS NOT OLD.book_id
    OR NEW.class_session_id IS NOT OLD.class_session_id
    OR NEW.return_uri IS NOT OLD.return_uri
  )
BEGIN
  SELECT RAISE(ABORT, 'integration launch identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS integration_launches_scoped_identity_immutable_delete
BEFORE DELETE ON integration_launches
WHEN EXISTS (SELECT 1 FROM integration_launch_scopes WHERE launch_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'integration launch identity is immutable');
END;
