ALTER TABLE safety_events ADD COLUMN closure_outcome TEXT
  CHECK (closure_outcome IS NULL OR closure_outcome IN ('closed', 'false_positive_closed'));
ALTER TABLE safety_events ADD COLUMN resolution_note TEXT;
ALTER TABLE safety_events ADD COLUMN closed_by_user_id TEXT;
ALTER TABLE safety_events ADD COLUMN closed_at TEXT;

CREATE INDEX idx_safety_events_closure
  ON safety_events (organization_id, status, closed_at, id);

DROP TRIGGER trg_safety_events_status_insert;
DROP TRIGGER trg_safety_events_status_update;

CREATE TRIGGER trg_safety_events_status_insert
BEFORE INSERT ON safety_events
FOR EACH ROW WHEN NEW.status NOT IN (
  'pending_human_confirmation', 'awaiting_human_acceptance', 'working', 'closed', 'false_positive_closed'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid safety_events status');
END;

CREATE TRIGGER trg_safety_events_status_update
BEFORE UPDATE ON safety_events
FOR EACH ROW WHEN NEW.status NOT IN (
  'pending_human_confirmation', 'awaiting_human_acceptance', 'working', 'closed', 'false_positive_closed'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid safety_events status');
END;
