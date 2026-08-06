PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TEMP TABLE migration_025_notification_guard (
  check_name TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO migration_025_notification_guard (check_name, valid)
SELECT 'notification_chain_json', CASE WHEN NOT EXISTS (
  SELECT 1
  FROM safety_events AS event
  WHERE json_valid(event.notification_chain_json) <> 1
) THEN 1 ELSE 0 END;

INSERT INTO migration_025_notification_guard (check_name, valid)
SELECT 'notification_chain_accounts', CASE WHEN NOT EXISTS (
  SELECT 1
  FROM safety_events AS event
  JOIN json_each(event.notification_chain_json) AS handler
  LEFT JOIN users AS user
    ON user.id = json_extract(handler.value, '$.userId')
   AND user.organization_id = event.organization_id
  WHERE json_type(handler.value, '$.userId') <> 'text'
     OR length(json_extract(handler.value, '$.userId')) = 0
     OR json_type(handler.value, '$.role') <> 'text'
     OR json_type(handler.value, '$.scopeType') <> 'text'
     OR user.id IS NULL
) THEN 1 ELSE 0 END;

CREATE TABLE IF NOT EXISTS safety_notification_recipients (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  safety_event_id TEXT NOT NULL REFERENCES safety_events(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role_code TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned', 'dispatched', 'delivered', 'read', 'skipped', 'unknown')),
  outbox_event_id TEXT NOT NULL UNIQUE REFERENCES outbox_events(id),
  planned_at TEXT NOT NULL,
  dispatched_at TEXT,
  delivered_at TEXT,
  read_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (safety_event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_safety_notification_recipients_event
  ON safety_notification_recipients (organization_id, safety_event_id, status, planned_at);

CREATE INDEX IF NOT EXISTS idx_safety_notification_recipients_user
  ON safety_notification_recipients (organization_id, user_id, status, planned_at);

CREATE TRIGGER IF NOT EXISTS trg_safety_notification_recipients_scope_insert
BEFORE INSERT ON safety_notification_recipients
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1
  FROM safety_events AS event
  JOIN users AS user
    ON user.id = NEW.user_id
   AND user.organization_id = NEW.organization_id
  JOIN outbox_events AS outbox
    ON outbox.id = NEW.outbox_event_id
   AND outbox.topic = 'safety.notification.dispatch'
   AND outbox.aggregate_type = 'safety_event'
   AND outbox.aggregate_id = NEW.safety_event_id
  WHERE event.id = NEW.safety_event_id
    AND event.organization_id = NEW.organization_id
)
BEGIN
  SELECT RAISE(ABORT, 'safety notification recipient scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_notification_recipients_identity_update
BEFORE UPDATE OF organization_id, safety_event_id, user_id, role_code, scope_type, scope_id, outbox_event_id
ON safety_notification_recipients
BEGIN
  SELECT RAISE(ABORT, 'safety notification recipient identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_notification_recipients_status_update
BEFORE UPDATE OF status ON safety_notification_recipients
FOR EACH ROW WHEN OLD.status <> NEW.status AND NOT (
  (OLD.status = 'planned' AND NEW.status IN ('dispatched', 'skipped', 'unknown'))
  OR (OLD.status = 'dispatched' AND NEW.status IN ('delivered', 'unknown'))
  OR (OLD.status = 'delivered' AND NEW.status IN ('read', 'unknown'))
  OR (OLD.status = 'unknown' AND NEW.status IN ('dispatched', 'delivered', 'skipped'))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid safety notification recipient status transition');
END;

INSERT INTO outbox_events (
  id, topic, aggregate_type, aggregate_id, payload_json, status,
  attempt_count, available_at, locked_at, processed_at, last_error,
  dedupe_key, created_at, updated_at, version
)
SELECT
  'safety-notification-outbox:' || event.id || ':' || json_extract(handler.value, '$.userId'),
  'safety.notification.dispatch',
  'safety_event',
  event.id,
  json_object(
    'organizationId', event.organization_id,
    'safetyEventId', event.id,
    'recipientUserId', json_extract(handler.value, '$.userId')
  ),
  'pending',
  0,
  event.created_at,
  NULL,
  NULL,
  NULL,
  'safety.notification.dispatch:' || event.id || ':' || json_extract(handler.value, '$.userId'),
  event.created_at,
  event.created_at,
  1
FROM safety_events AS event
JOIN json_each(event.notification_chain_json) AS handler
GROUP BY event.id, json_extract(handler.value, '$.userId')
ON CONFLICT(dedupe_key) DO NOTHING;

INSERT OR IGNORE INTO safety_notification_recipients (
  id, organization_id, safety_event_id, user_id, role_code, scope_type, scope_id,
  status, outbox_event_id, planned_at, created_at, updated_at, version
)
SELECT
  'safety-notification-recipient:' || event.id || ':' || json_extract(handler.value, '$.userId'),
  event.organization_id,
  event.id,
  json_extract(handler.value, '$.userId'),
  json_extract(handler.value, '$.role'),
  json_extract(handler.value, '$.scopeType'),
  json_extract(handler.value, '$.scopeId'),
  'planned',
  outbox.id,
  event.created_at,
  event.created_at,
  event.created_at,
  1
FROM safety_events AS event
JOIN json_each(event.notification_chain_json) AS handler
JOIN outbox_events AS outbox
  ON outbox.dedupe_key = 'safety.notification.dispatch:' || event.id || ':' || json_extract(handler.value, '$.userId')
GROUP BY event.id, json_extract(handler.value, '$.userId');

DROP TABLE migration_025_notification_guard;

COMMIT;
