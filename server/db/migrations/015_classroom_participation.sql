ALTER TABLE class_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'lock' CHECK (mode IN ('lock', 'sync'));
ALTER TABLE class_sessions ADD COLUMN teacher_display_name TEXT;
ALTER TABLE class_sessions ADD COLUMN ended_at TEXT;

CREATE TABLE class_session_participants (
  id TEXT PRIMARY KEY,
  class_session_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_broadcast_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(class_session_id, actor_id)
);

CREATE TABLE class_broadcast_receipts (
  id TEXT PRIMARY KEY,
  class_session_id TEXT NOT NULL,
  class_broadcast_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(class_broadcast_id, actor_id)
);

CREATE INDEX idx_class_participants_session_seen
  ON class_session_participants(class_session_id, last_seen_at);
CREATE INDEX idx_class_receipts_session_actor
  ON class_broadcast_receipts(class_session_id, actor_id, received_at);

CREATE TRIGGER class_participants_require_session_insert
BEFORE INSERT ON class_session_participants
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM class_sessions WHERE id = NEW.class_session_id
)
BEGIN
  SELECT RAISE(ABORT, 'class participant session missing');
END;

CREATE TRIGGER class_receipts_require_scoped_broadcast_insert
BEFORE INSERT ON class_broadcast_receipts
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM class_broadcasts
  WHERE id = NEW.class_broadcast_id AND class_session_id = NEW.class_session_id
)
BEGIN
  SELECT RAISE(ABORT, 'class receipt broadcast scope mismatch');
END;
