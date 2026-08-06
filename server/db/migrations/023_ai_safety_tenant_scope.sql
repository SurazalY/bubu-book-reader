PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TEMP TABLE migration_023_scope_guard (
  check_name TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO migration_023_scope_guard (check_name, valid)
SELECT 'ai_messages_scope', CASE WHEN NOT EXISTS (
  SELECT 1
  FROM ai_messages AS message
  LEFT JOIN ai_conversations AS conversation
    ON conversation.id = message.conversation_id
   AND conversation.organization_id = message.organization_id
   AND conversation.owner_user_id = message.actor_id_at_creation
  WHERE conversation.id IS NULL
     OR message.organization_id_at_creation <> message.organization_id
) THEN 1 ELSE 0 END;

INSERT INTO migration_023_scope_guard (check_name, valid)
SELECT 'ai_message_request_links_scope', CASE WHEN NOT EXISTS (
  SELECT 1
  FROM ai_message_request_links AS link
  LEFT JOIN ai_messages AS user_message ON user_message.id = link.user_message_id
  LEFT JOIN ai_messages AS assistant_message ON assistant_message.id = link.assistant_message_id
  WHERE user_message.id IS NULL
     OR assistant_message.id IS NULL
     OR user_message.role <> 'user'
     OR assistant_message.role <> 'assistant'
     OR user_message.organization_id <> assistant_message.organization_id
     OR user_message.actor_id_at_creation <> assistant_message.actor_id_at_creation
     OR user_message.conversation_id <> assistant_message.conversation_id
) THEN 1 ELSE 0 END;

INSERT INTO migration_023_scope_guard (check_name, valid)
SELECT 'ai_usage_ledger_scope', CASE WHEN NOT EXISTS (
  SELECT 1
  FROM ai_usage_ledger AS usage
  LEFT JOIN ai_conversations AS conversation
    ON conversation.id = usage.conversation_id
   AND conversation.organization_id = usage.organization_id
   AND conversation.owner_user_id = usage.user_id
  WHERE usage.conversation_id IS NOT NULL AND conversation.id IS NULL
) THEN 1 ELSE 0 END;

INSERT INTO migration_023_scope_guard (check_name, valid)
SELECT 'privacy_access_requests_scope', CASE WHEN NOT EXISTS (
  SELECT 1
  FROM privacy_access_requests AS access_request
  LEFT JOIN ai_conversations AS conversation
    ON conversation.id = access_request.conversation_id
   AND conversation.organization_id = access_request.organization_id
  WHERE conversation.id IS NULL
     OR access_request.organization_id_at_creation <> access_request.organization_id
     OR access_request.actor_id_at_creation <> access_request.requester_user_id
) THEN 1 ELSE 0 END;

INSERT INTO migration_023_scope_guard (check_name, valid)
SELECT 'safety_review_tasks_scope', CASE WHEN NOT EXISTS (
  SELECT 1
  FROM safety_review_tasks AS review_task
  LEFT JOIN ai_conversations AS conversation
    ON conversation.id = review_task.conversation_id
   AND conversation.organization_id = review_task.organization_id
   AND conversation.owner_user_id = review_task.actor_id_at_creation
  LEFT JOIN ai_messages AS initial_message
    ON initial_message.id = review_task.initial_message_id
   AND initial_message.conversation_id = review_task.conversation_id
   AND initial_message.organization_id = review_task.organization_id
   AND initial_message.actor_id_at_creation = review_task.actor_id_at_creation
  WHERE conversation.id IS NULL
     OR initial_message.id IS NULL
     OR review_task.organization_id_at_creation <> review_task.organization_id
     OR json_valid(review_task.evidence_message_ids_json) <> 1
) THEN 1 ELSE 0 END;

INSERT INTO migration_023_scope_guard (check_name, valid)
SELECT 'safety_review_task_evidence_scope', CASE WHEN NOT EXISTS (
  SELECT 1
  FROM safety_review_tasks AS review_task
  JOIN json_each(review_task.evidence_message_ids_json) AS evidence
  LEFT JOIN ai_messages AS message
    ON message.id = evidence.value
   AND message.conversation_id = review_task.conversation_id
   AND message.organization_id = review_task.organization_id
   AND message.actor_id_at_creation = review_task.actor_id_at_creation
  WHERE message.id IS NULL
) THEN 1 ELSE 0 END;

INSERT INTO migration_023_scope_guard (check_name, valid)
SELECT 'safety_events_scope', CASE WHEN NOT EXISTS (
  SELECT 1
  FROM safety_events AS safety_event
  LEFT JOIN safety_review_tasks AS review_task
    ON review_task.id = safety_event.review_task_id
   AND review_task.organization_id = safety_event.organization_id
   AND review_task.actor_id_at_creation = safety_event.actor_id_at_creation
  WHERE review_task.id IS NULL
     OR safety_event.organization_id_at_creation <> safety_event.organization_id
) THEN 1 ELSE 0 END;

INSERT INTO migration_023_scope_guard (check_name, valid)
SELECT 'safety_event_evidence_scope', CASE WHEN NOT EXISTS (
  SELECT 1
  FROM safety_event_evidence AS event_evidence
  JOIN safety_events AS safety_event ON safety_event.id = event_evidence.safety_event_id
  JOIN safety_review_tasks AS review_task ON review_task.id = safety_event.review_task_id
  LEFT JOIN ai_messages AS message
    ON message.id = event_evidence.ai_message_id
   AND message.conversation_id = review_task.conversation_id
   AND message.organization_id = review_task.organization_id
   AND message.actor_id_at_creation = review_task.actor_id_at_creation
  WHERE message.id IS NULL
) THEN 1 ELSE 0 END;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_conversations_scope
  ON ai_conversations (organization_id, owner_user_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_messages_scope
  ON ai_messages (organization_id, actor_id_at_creation, conversation_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_safety_review_tasks_scope
  ON safety_review_tasks (organization_id, actor_id_at_creation, conversation_id, id);

CREATE TABLE IF NOT EXISTS privacy_access_request_scopes (
  request_id TEXT PRIMARY KEY REFERENCES privacy_access_requests(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  FOREIGN KEY (organization_id, owner_user_id, conversation_id)
    REFERENCES ai_conversations(organization_id, owner_user_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_privacy_access_request_scope
  ON privacy_access_request_scopes (request_id, organization_id, owner_user_id, conversation_id);

INSERT OR IGNORE INTO privacy_access_request_scopes (
  request_id, organization_id, owner_user_id, conversation_id, created_at, updated_at
)
SELECT access_request.id, conversation.organization_id, conversation.owner_user_id,
       conversation.id, access_request.created_at, access_request.updated_at
FROM privacy_access_requests AS access_request
JOIN ai_conversations AS conversation
  ON conversation.id = access_request.conversation_id
 AND conversation.organization_id = access_request.organization_id;

CREATE TABLE IF NOT EXISTS safety_review_evidence (
  review_task_id TEXT NOT NULL,
  ai_message_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  trigger TEXT NOT NULL CHECK (length(trigger) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (review_task_id, ai_message_id),
  FOREIGN KEY (organization_id, owner_user_id, conversation_id, review_task_id)
    REFERENCES safety_review_tasks(organization_id, actor_id_at_creation, conversation_id, id),
  FOREIGN KEY (organization_id, owner_user_id, conversation_id, ai_message_id)
    REFERENCES ai_messages(organization_id, actor_id_at_creation, conversation_id, id)
);

CREATE INDEX IF NOT EXISTS idx_safety_review_evidence_scope
  ON safety_review_evidence (organization_id, owner_user_id, conversation_id, review_task_id, created_at);

INSERT OR IGNORE INTO safety_review_evidence (
  review_task_id, ai_message_id, organization_id, owner_user_id, conversation_id,
  confidence, trigger, created_at, updated_at
)
SELECT review_task.id, message.id, review_task.organization_id, review_task.actor_id_at_creation,
       review_task.conversation_id, message.danger_confidence, 'legacy_task_evidence',
       review_task.created_at, review_task.updated_at
FROM safety_review_tasks AS review_task
JOIN json_each(review_task.evidence_message_ids_json) AS evidence
JOIN ai_messages AS message
  ON message.id = evidence.value
 AND message.organization_id = review_task.organization_id
 AND message.actor_id_at_creation = review_task.actor_id_at_creation
 AND message.conversation_id = review_task.conversation_id;

CREATE TRIGGER IF NOT EXISTS trg_ai_messages_scope_insert
BEFORE INSERT ON ai_messages
FOR EACH ROW WHEN NEW.organization_id_at_creation <> NEW.organization_id OR NOT EXISTS (
  SELECT 1 FROM ai_conversations AS conversation
  WHERE conversation.id = NEW.conversation_id
    AND conversation.organization_id = NEW.organization_id
    AND conversation.owner_user_id = NEW.actor_id_at_creation
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_messages_scope_update
BEFORE UPDATE ON ai_messages
FOR EACH ROW WHEN NEW.organization_id_at_creation <> NEW.organization_id OR NOT EXISTS (
  SELECT 1 FROM ai_conversations AS conversation
  WHERE conversation.id = NEW.conversation_id
    AND conversation.organization_id = NEW.organization_id
    AND conversation.owner_user_id = NEW.actor_id_at_creation
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_message_request_links_scope_insert
BEFORE INSERT ON ai_message_request_links
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1
  FROM ai_messages AS user_message
  JOIN ai_messages AS assistant_message
    ON assistant_message.id = NEW.assistant_message_id
   AND assistant_message.role = 'assistant'
   AND assistant_message.organization_id = user_message.organization_id
   AND assistant_message.actor_id_at_creation = user_message.actor_id_at_creation
   AND assistant_message.conversation_id = user_message.conversation_id
  WHERE user_message.id = NEW.user_message_id AND user_message.role = 'user'
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_message_request_links_scope_update
BEFORE UPDATE ON ai_message_request_links
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1
  FROM ai_messages AS user_message
  JOIN ai_messages AS assistant_message
    ON assistant_message.id = NEW.assistant_message_id
   AND assistant_message.role = 'assistant'
   AND assistant_message.organization_id = user_message.organization_id
   AND assistant_message.actor_id_at_creation = user_message.actor_id_at_creation
   AND assistant_message.conversation_id = user_message.conversation_id
  WHERE user_message.id = NEW.user_message_id AND user_message.role = 'user'
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_usage_ledger_scope_insert
BEFORE INSERT ON ai_usage_ledger
FOR EACH ROW WHEN NEW.conversation_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM ai_conversations AS conversation
  WHERE conversation.id = NEW.conversation_id
    AND conversation.organization_id = NEW.organization_id
    AND conversation.owner_user_id = NEW.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_usage_ledger_scope_update
BEFORE UPDATE ON ai_usage_ledger
FOR EACH ROW WHEN NEW.conversation_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM ai_conversations AS conversation
  WHERE conversation.id = NEW.conversation_id
    AND conversation.organization_id = NEW.organization_id
    AND conversation.owner_user_id = NEW.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_privacy_access_requests_scope_insert
AFTER INSERT ON privacy_access_requests
FOR EACH ROW
BEGIN
  INSERT INTO privacy_access_request_scopes (
    request_id, organization_id, owner_user_id, conversation_id, created_at, updated_at
  )
  SELECT NEW.id, conversation.organization_id, conversation.owner_user_id,
         conversation.id, NEW.created_at, NEW.updated_at
  FROM ai_conversations AS conversation
  WHERE conversation.id = NEW.conversation_id
    AND conversation.organization_id = NEW.organization_id
    AND NEW.organization_id_at_creation = NEW.organization_id
    AND NEW.actor_id_at_creation = NEW.requester_user_id;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'resource scope violation') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_privacy_access_requests_scope_update
BEFORE UPDATE ON privacy_access_requests
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1
  FROM privacy_access_request_scopes AS scope
  JOIN ai_conversations AS conversation
    ON conversation.organization_id = scope.organization_id
   AND conversation.owner_user_id = scope.owner_user_id
   AND conversation.id = scope.conversation_id
  WHERE scope.request_id = OLD.id
    AND NEW.id = OLD.id
    AND NEW.organization_id = scope.organization_id
    AND NEW.organization_id_at_creation = scope.organization_id
    AND NEW.conversation_id = scope.conversation_id
    AND NEW.actor_id_at_creation = NEW.requester_user_id
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_privacy_access_request_scopes_touch
AFTER UPDATE ON privacy_access_requests
FOR EACH ROW
BEGIN
  UPDATE privacy_access_request_scopes
  SET updated_at = NEW.updated_at, version = version + 1
  WHERE request_id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_privacy_access_request_scopes_identity_update
BEFORE UPDATE OF request_id, organization_id, owner_user_id, conversation_id ON privacy_access_request_scopes
FOR EACH ROW WHEN NEW.request_id <> OLD.request_id
  OR NEW.organization_id <> OLD.organization_id
  OR NEW.owner_user_id <> OLD.owner_user_id
  OR NEW.conversation_id <> OLD.conversation_id
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_privacy_access_request_scopes_delete
BEFORE DELETE ON privacy_access_request_scopes
FOR EACH ROW WHEN EXISTS (SELECT 1 FROM privacy_access_requests WHERE id = OLD.request_id)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_review_tasks_scope_insert
BEFORE INSERT ON safety_review_tasks
FOR EACH ROW WHEN NEW.organization_id_at_creation <> NEW.organization_id OR NOT EXISTS (
  SELECT 1
  FROM ai_conversations AS conversation
  JOIN ai_messages AS initial_message
    ON initial_message.id = NEW.initial_message_id
   AND initial_message.organization_id = conversation.organization_id
   AND initial_message.actor_id_at_creation = conversation.owner_user_id
   AND initial_message.conversation_id = conversation.id
  WHERE conversation.id = NEW.conversation_id
    AND conversation.organization_id = NEW.organization_id
    AND conversation.owner_user_id = NEW.actor_id_at_creation
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_review_tasks_scope_update
BEFORE UPDATE ON safety_review_tasks
FOR EACH ROW WHEN NEW.organization_id_at_creation <> NEW.organization_id OR NOT EXISTS (
  SELECT 1
  FROM ai_conversations AS conversation
  JOIN ai_messages AS initial_message
    ON initial_message.id = NEW.initial_message_id
   AND initial_message.organization_id = conversation.organization_id
   AND initial_message.actor_id_at_creation = conversation.owner_user_id
   AND initial_message.conversation_id = conversation.id
  WHERE conversation.id = NEW.conversation_id
    AND conversation.organization_id = NEW.organization_id
    AND conversation.owner_user_id = NEW.actor_id_at_creation
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_events_scope_insert
BEFORE INSERT ON safety_events
FOR EACH ROW WHEN NEW.organization_id_at_creation <> NEW.organization_id OR NOT EXISTS (
  SELECT 1 FROM safety_review_tasks AS review_task
  WHERE review_task.id = NEW.review_task_id
    AND review_task.organization_id = NEW.organization_id
    AND review_task.actor_id_at_creation = NEW.actor_id_at_creation
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_events_scope_update
BEFORE UPDATE ON safety_events
FOR EACH ROW WHEN NEW.organization_id_at_creation <> NEW.organization_id OR NOT EXISTS (
  SELECT 1 FROM safety_review_tasks AS review_task
  WHERE review_task.id = NEW.review_task_id
    AND review_task.organization_id = NEW.organization_id
    AND review_task.actor_id_at_creation = NEW.actor_id_at_creation
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_event_evidence_scope_insert
BEFORE INSERT ON safety_event_evidence
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1
  FROM safety_events AS safety_event
  JOIN safety_review_tasks AS review_task ON review_task.id = safety_event.review_task_id
  JOIN ai_messages AS message
    ON message.id = NEW.ai_message_id
   AND message.organization_id = review_task.organization_id
   AND message.actor_id_at_creation = review_task.actor_id_at_creation
   AND message.conversation_id = review_task.conversation_id
  WHERE safety_event.id = NEW.safety_event_id
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_event_evidence_scope_update
BEFORE UPDATE ON safety_event_evidence
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1
  FROM safety_events AS safety_event
  JOIN safety_review_tasks AS review_task ON review_task.id = safety_event.review_task_id
  JOIN ai_messages AS message
    ON message.id = NEW.ai_message_id
   AND message.organization_id = review_task.organization_id
   AND message.actor_id_at_creation = review_task.actor_id_at_creation
   AND message.conversation_id = review_task.conversation_id
  WHERE safety_event.id = NEW.safety_event_id
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_implicated_candidates_scope_insert
BEFORE INSERT ON safety_implicated_candidates
FOR EACH ROW WHEN NEW.safety_event_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM safety_events AS safety_event
  JOIN safety_review_tasks AS review_task ON review_task.id = safety_event.review_task_id
  WHERE safety_event.id = NEW.safety_event_id AND review_task.id = NEW.review_task_id
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_implicated_candidates_scope_update
BEFORE UPDATE ON safety_implicated_candidates
FOR EACH ROW WHEN NEW.safety_event_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM safety_events AS safety_event
  JOIN safety_review_tasks AS review_task ON review_task.id = safety_event.review_task_id
  WHERE safety_event.id = NEW.safety_event_id AND review_task.id = NEW.review_task_id
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

DROP TABLE migration_023_scope_guard;

COMMIT;
