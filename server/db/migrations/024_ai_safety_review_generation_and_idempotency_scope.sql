PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TEMP TABLE migration_024_evidence_guard (
  check_name TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO migration_024_evidence_guard (check_name, valid)
SELECT 'ai_message_evidence_parent', CASE WHEN NOT EXISTS (
  SELECT 1
  FROM ai_message_evidence AS evidence
  LEFT JOIN ai_messages AS message ON message.id = evidence.ai_message_id
  LEFT JOIN ai_conversations AS conversation
    ON conversation.organization_id = message.organization_id
   AND conversation.owner_user_id = message.actor_id_at_creation
   AND conversation.id = message.conversation_id
  WHERE message.id IS NULL
     OR conversation.id IS NULL
     OR message.organization_id_at_creation <> message.organization_id
) THEN 1 ELSE 0 END;

INSERT INTO migration_024_evidence_guard (check_name, valid)
SELECT 'ai_idempotency_trusted_scope', CASE WHEN NOT EXISTS (
  SELECT 1
  FROM ai_idempotency_requests AS request
  LEFT JOIN ai_usage_ledger AS usage ON usage.request_id = request.request_id
  LEFT JOIN ai_conversations AS conversation
    ON conversation.organization_id = usage.organization_id
   AND conversation.owner_user_id = usage.user_id
   AND conversation.id = usage.conversation_id
  WHERE usage.request_id IS NULL
     OR usage.user_id IS NULL
     OR usage.conversation_id IS NULL
     OR usage.organization_id_at_creation <> usage.organization_id
     OR conversation.id IS NULL
) THEN 1 ELSE 0 END;

CREATE TABLE IF NOT EXISTS ai_idempotency_scopes (
  request_id TEXT PRIMARY KEY REFERENCES ai_idempotency_requests(request_id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  scope_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (organization_id, owner_user_id, conversation_id, idempotency_key),
  FOREIGN KEY (organization_id, owner_user_id, conversation_id)
    REFERENCES ai_conversations(organization_id, owner_user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_ai_idempotency_scopes_lookup
  ON ai_idempotency_scopes (organization_id, owner_user_id, conversation_id, idempotency_key);

INSERT OR IGNORE INTO ai_idempotency_scopes (
  request_id, organization_id, owner_user_id, conversation_id, idempotency_key,
  scope_key, created_at, updated_at
)
SELECT request.request_id, usage.organization_id, usage.user_id, usage.conversation_id,
       request.idempotency_key, 'legacy:' || request.request_id, request.created_at, request.updated_at
FROM ai_idempotency_requests AS request
JOIN ai_usage_ledger AS usage ON usage.request_id = request.request_id
JOIN ai_conversations AS conversation
  ON conversation.organization_id = usage.organization_id
 AND conversation.owner_user_id = usage.user_id
 AND conversation.id = usage.conversation_id;

INSERT INTO migration_024_evidence_guard (check_name, valid)
SELECT 'ai_idempotency_scope_backfill', CASE WHEN NOT EXISTS (
  SELECT 1
  FROM ai_idempotency_requests AS request
  JOIN ai_usage_ledger AS usage ON usage.request_id = request.request_id
  LEFT JOIN ai_idempotency_scopes AS scope
    ON scope.request_id = request.request_id
   AND scope.organization_id = usage.organization_id
   AND scope.owner_user_id = usage.user_id
   AND scope.conversation_id = usage.conversation_id
  WHERE scope.request_id IS NULL
) THEN 1 ELSE 0 END;

CREATE TRIGGER IF NOT EXISTS trg_ai_idempotency_scopes_insert
BEFORE INSERT ON ai_idempotency_scopes
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1
  FROM ai_idempotency_requests AS request
  JOIN ai_conversations AS conversation
    ON conversation.organization_id = NEW.organization_id
   AND conversation.owner_user_id = NEW.owner_user_id
   AND conversation.id = NEW.conversation_id
  WHERE request.request_id = NEW.request_id
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_idempotency_scopes_identity_update
BEFORE UPDATE OF request_id, organization_id, owner_user_id, conversation_id, idempotency_key, scope_key
ON ai_idempotency_scopes
FOR EACH ROW WHEN NEW.request_id <> OLD.request_id
  OR NEW.organization_id <> OLD.organization_id
  OR NEW.owner_user_id <> OLD.owner_user_id
  OR NEW.conversation_id <> OLD.conversation_id
  OR NEW.idempotency_key <> OLD.idempotency_key
  OR NEW.scope_key <> OLD.scope_key
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_idempotency_scopes_delete
BEFORE DELETE ON ai_idempotency_scopes
FOR EACH ROW WHEN EXISTS (SELECT 1 FROM ai_idempotency_requests WHERE request_id = OLD.request_id)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_idempotency_requests_scope_identity_update
BEFORE UPDATE OF request_id, idempotency_key ON ai_idempotency_requests
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM ai_idempotency_scopes AS scope
  WHERE scope.request_id = OLD.request_id
    AND (NEW.request_id <> OLD.request_id OR NEW.idempotency_key <> OLD.idempotency_key)
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_idempotency_requests_scope_delete
BEFORE DELETE ON ai_idempotency_requests
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM ai_idempotency_scopes AS scope WHERE scope.request_id = OLD.request_id
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TABLE IF NOT EXISTS ai_message_evidence_scopes (
  evidence_id TEXT PRIMARY KEY REFERENCES ai_message_evidence(id) ON DELETE CASCADE,
  ai_message_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (evidence_id, organization_id, owner_user_id, conversation_id, ai_message_id),
  FOREIGN KEY (organization_id, owner_user_id, conversation_id, ai_message_id)
    REFERENCES ai_messages(organization_id, actor_id_at_creation, conversation_id, id)
);

CREATE INDEX IF NOT EXISTS idx_ai_message_evidence_scopes_lookup
  ON ai_message_evidence_scopes (organization_id, owner_user_id, conversation_id, ai_message_id);

INSERT OR IGNORE INTO ai_message_evidence_scopes (
  evidence_id, ai_message_id, organization_id, owner_user_id, conversation_id, created_at, updated_at
)
SELECT evidence.id, message.id, message.organization_id, message.actor_id_at_creation,
       message.conversation_id, evidence.created_at, evidence.updated_at
FROM ai_message_evidence AS evidence
JOIN ai_messages AS message ON message.id = evidence.ai_message_id
JOIN ai_conversations AS conversation
  ON conversation.organization_id = message.organization_id
 AND conversation.owner_user_id = message.actor_id_at_creation
 AND conversation.id = message.conversation_id;

INSERT INTO migration_024_evidence_guard (check_name, valid)
SELECT 'ai_message_evidence_scope_backfill', CASE WHEN NOT EXISTS (
  SELECT 1
  FROM ai_message_evidence AS evidence
  JOIN ai_messages AS message ON message.id = evidence.ai_message_id
  LEFT JOIN ai_message_evidence_scopes AS scope
    ON scope.evidence_id = evidence.id
   AND scope.ai_message_id = message.id
   AND scope.organization_id = message.organization_id
   AND scope.owner_user_id = message.actor_id_at_creation
   AND scope.conversation_id = message.conversation_id
  WHERE scope.evidence_id IS NULL
) THEN 1 ELSE 0 END;

CREATE TRIGGER IF NOT EXISTS trg_ai_message_evidence_scopes_insert
BEFORE INSERT ON ai_message_evidence_scopes
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1
  FROM ai_message_evidence AS evidence
  JOIN ai_messages AS message
    ON message.id = NEW.ai_message_id
   AND message.organization_id = NEW.organization_id
   AND message.actor_id_at_creation = NEW.owner_user_id
   AND message.conversation_id = NEW.conversation_id
  WHERE evidence.id = NEW.evidence_id AND evidence.ai_message_id = NEW.ai_message_id
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_message_evidence_scope_insert
AFTER INSERT ON ai_message_evidence
FOR EACH ROW
BEGIN
  INSERT INTO ai_message_evidence_scopes (
    evidence_id, ai_message_id, organization_id, owner_user_id, conversation_id, created_at, updated_at
  )
  SELECT NEW.id, message.id, message.organization_id, message.actor_id_at_creation,
         message.conversation_id, NEW.created_at, NEW.updated_at
  FROM ai_messages AS message
  WHERE message.id = NEW.ai_message_id;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'resource scope violation') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_message_evidence_scope_update
BEFORE UPDATE ON ai_message_evidence
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1
  FROM ai_message_evidence_scopes AS scope
  JOIN ai_messages AS message
    ON message.id = scope.ai_message_id
   AND message.organization_id = scope.organization_id
   AND message.actor_id_at_creation = scope.owner_user_id
   AND message.conversation_id = scope.conversation_id
  WHERE scope.evidence_id = OLD.id
    AND NEW.id = OLD.id
    AND NEW.ai_message_id = scope.ai_message_id
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_message_evidence_scopes_touch
AFTER UPDATE ON ai_message_evidence
FOR EACH ROW
BEGIN
  UPDATE ai_message_evidence_scopes
  SET updated_at = NEW.updated_at, version = version + 1
  WHERE evidence_id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_message_evidence_scopes_identity_update
BEFORE UPDATE OF evidence_id, ai_message_id, organization_id, owner_user_id, conversation_id
ON ai_message_evidence_scopes
FOR EACH ROW WHEN NEW.evidence_id <> OLD.evidence_id
  OR NEW.ai_message_id <> OLD.ai_message_id
  OR NEW.organization_id <> OLD.organization_id
  OR NEW.owner_user_id <> OLD.owner_user_id
  OR NEW.conversation_id <> OLD.conversation_id
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_message_evidence_scopes_delete
BEFORE DELETE ON ai_message_evidence_scopes
FOR EACH ROW WHEN EXISTS (SELECT 1 FROM ai_message_evidence WHERE id = OLD.evidence_id)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_messages_evidence_identity_update
BEFORE UPDATE OF id, organization_id, actor_id_at_creation, conversation_id ON ai_messages
FOR EACH ROW WHEN EXISTS (
  SELECT 1
  FROM ai_message_evidence_scopes AS scope
  WHERE scope.ai_message_id = OLD.id
    AND (NEW.id <> OLD.id
      OR NEW.organization_id <> scope.organization_id
      OR NEW.actor_id_at_creation <> scope.owner_user_id
      OR NEW.conversation_id <> scope.conversation_id)
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_messages_evidence_parent_delete
BEFORE DELETE ON ai_messages
FOR EACH ROW WHEN EXISTS (
  SELECT 1 FROM ai_message_evidence_scopes AS scope WHERE scope.ai_message_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TABLE IF NOT EXISTS safety_review_evidence_state (
  review_task_id TEXT PRIMARY KEY REFERENCES safety_review_tasks(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  evidence_generation INTEGER NOT NULL DEFAULT 0 CHECK (evidence_generation >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (organization_id, owner_user_id, conversation_id, review_task_id),
  FOREIGN KEY (organization_id, owner_user_id, conversation_id, review_task_id)
    REFERENCES safety_review_tasks(organization_id, actor_id_at_creation, conversation_id, id)
);

INSERT OR IGNORE INTO safety_review_evidence_state (
  review_task_id, organization_id, owner_user_id, conversation_id,
  evidence_generation, created_at, updated_at
)
SELECT review_task.id, review_task.organization_id, review_task.actor_id_at_creation,
       review_task.conversation_id, COUNT(evidence.ai_message_id), review_task.created_at, review_task.updated_at
FROM safety_review_tasks AS review_task
LEFT JOIN safety_review_evidence AS evidence ON evidence.review_task_id = review_task.id
GROUP BY review_task.id, review_task.organization_id, review_task.actor_id_at_creation,
         review_task.conversation_id, review_task.created_at, review_task.updated_at;

INSERT INTO migration_024_evidence_guard (check_name, valid)
SELECT 'safety_review_evidence_state_backfill', CASE WHEN NOT EXISTS (
  SELECT 1
  FROM safety_review_tasks AS review_task
  LEFT JOIN safety_review_evidence_state AS state
    ON state.review_task_id = review_task.id
   AND state.organization_id = review_task.organization_id
   AND state.owner_user_id = review_task.actor_id_at_creation
   AND state.conversation_id = review_task.conversation_id
  WHERE state.review_task_id IS NULL
) THEN 1 ELSE 0 END;

CREATE TABLE IF NOT EXISTS safety_review_attempts (
  lease_token TEXT PRIMARY KEY,
  review_task_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  evidence_generation INTEGER NOT NULL CHECK (evidence_generation >= 0),
  status TEXT NOT NULL CHECK (status IN ('claimed', 'superseded', 'finalized')),
  reason_code TEXT,
  claimed_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  FOREIGN KEY (organization_id, owner_user_id, conversation_id, review_task_id)
    REFERENCES safety_review_evidence_state(organization_id, owner_user_id, conversation_id, review_task_id)
);

CREATE INDEX IF NOT EXISTS idx_safety_review_attempts_task
  ON safety_review_attempts (organization_id, owner_user_id, conversation_id, review_task_id, claimed_at);

CREATE TRIGGER IF NOT EXISTS trg_safety_review_evidence_state_insert
BEFORE INSERT ON safety_review_evidence_state
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM safety_review_tasks AS review_task
  WHERE review_task.id = NEW.review_task_id
    AND review_task.organization_id = NEW.organization_id
    AND review_task.actor_id_at_creation = NEW.owner_user_id
    AND review_task.conversation_id = NEW.conversation_id
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_review_evidence_state_identity_update
BEFORE UPDATE OF review_task_id, organization_id, owner_user_id, conversation_id
ON safety_review_evidence_state
FOR EACH ROW WHEN NEW.review_task_id <> OLD.review_task_id
  OR NEW.organization_id <> OLD.organization_id
  OR NEW.owner_user_id <> OLD.owner_user_id
  OR NEW.conversation_id <> OLD.conversation_id
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_review_evidence_generation_insert
AFTER INSERT ON safety_review_evidence
FOR EACH ROW
BEGIN
  UPDATE safety_review_evidence_state
  SET evidence_generation = evidence_generation + 1,
      updated_at = NEW.updated_at,
      version = version + 1
  WHERE review_task_id = NEW.review_task_id
    AND organization_id = NEW.organization_id
    AND owner_user_id = NEW.owner_user_id
    AND conversation_id = NEW.conversation_id;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'resource scope violation') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_review_evidence_generation_update
AFTER UPDATE OF confidence, trigger ON safety_review_evidence
FOR EACH ROW WHEN NEW.confidence <> OLD.confidence OR NEW.trigger <> OLD.trigger
BEGIN
  UPDATE safety_review_evidence_state
  SET evidence_generation = evidence_generation + 1,
      updated_at = NEW.updated_at,
      version = version + 1
  WHERE review_task_id = NEW.review_task_id
    AND organization_id = NEW.organization_id
    AND owner_user_id = NEW.owner_user_id
    AND conversation_id = NEW.conversation_id;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'resource scope violation') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_review_evidence_generation_delete
AFTER DELETE ON safety_review_evidence
FOR EACH ROW
BEGIN
  UPDATE safety_review_evidence_state
  SET evidence_generation = evidence_generation + 1,
      updated_at = OLD.updated_at,
      version = version + 1
  WHERE review_task_id = OLD.review_task_id
    AND organization_id = OLD.organization_id
    AND owner_user_id = OLD.owner_user_id
    AND conversation_id = OLD.conversation_id;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'resource scope violation') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_review_attempts_insert
BEFORE INSERT ON safety_review_attempts
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1 FROM safety_review_evidence_state AS state
  WHERE state.review_task_id = NEW.review_task_id
    AND state.organization_id = NEW.organization_id
    AND state.owner_user_id = NEW.owner_user_id
    AND state.conversation_id = NEW.conversation_id
    AND state.evidence_generation = NEW.evidence_generation
)
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_review_attempts_identity_update
BEFORE UPDATE OF lease_token, review_task_id, organization_id, owner_user_id, conversation_id, evidence_generation
ON safety_review_attempts
FOR EACH ROW WHEN NEW.lease_token <> OLD.lease_token
  OR NEW.review_task_id <> OLD.review_task_id
  OR NEW.organization_id <> OLD.organization_id
  OR NEW.owner_user_id <> OLD.owner_user_id
  OR NEW.conversation_id <> OLD.conversation_id
  OR NEW.evidence_generation <> OLD.evidence_generation
BEGIN
  SELECT RAISE(ABORT, 'resource scope violation');
END;

DROP TABLE migration_024_evidence_guard;

COMMIT;
