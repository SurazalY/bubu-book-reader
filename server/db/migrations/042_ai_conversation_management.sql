PRAGMA foreign_keys = ON;

CREATE TEMP TABLE migration_042_scope_guard (
  check_name TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO migration_042_scope_guard (check_name, valid)
SELECT 'conversation_book_scope', CASE WHEN NOT EXISTS (
  SELECT 1
  FROM ai_conversations AS conversation
  LEFT JOIN book_versions AS version
    ON version.id = conversation.book_version_id
   AND version.organization_id_at_creation = conversation.organization_id
  LEFT JOIN books AS book
    ON book.id = version.book_id
   AND book.organization_id_at_creation = conversation.organization_id
  WHERE version.id IS NULL OR book.id IS NULL
) THEN 1 ELSE 0 END;

ALTER TABLE ai_conversations ADD COLUMN title_source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE ai_conversations ADD COLUMN deleted_at TEXT;
ALTER TABLE ai_conversations ADD COLUMN deleted_by_user_id TEXT;

CREATE TABLE ai_conversation_contexts (
  organization_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  book_version_id TEXT NOT NULL,
  page_number INTEGER CHECK (page_number IS NULL OR page_number > 0),
  selection_json TEXT NOT NULL DEFAULT '{}',
  citations_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (organization_id, owner_user_id, conversation_id),
  FOREIGN KEY (organization_id, owner_user_id, conversation_id)
    REFERENCES ai_conversations(organization_id, owner_user_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_ai_conversations_owner_live
  ON ai_conversations (organization_id, owner_user_id, deleted_at, updated_at DESC);

CREATE INDEX idx_ai_conversation_contexts_book
  ON ai_conversation_contexts (organization_id, book_version_id, updated_at DESC);

CREATE TRIGGER ai_conversations_management_insert
BEFORE INSERT ON ai_conversations
FOR EACH ROW WHEN NEW.title_source NOT IN ('auto', 'manual')
  OR (NEW.deleted_at IS NULL AND NEW.deleted_by_user_id IS NOT NULL)
  OR (NEW.deleted_at IS NOT NULL AND NEW.deleted_by_user_id IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'invalid ai conversation management state');
END;

CREATE TRIGGER ai_conversations_management_update
BEFORE UPDATE ON ai_conversations
FOR EACH ROW WHEN NEW.title_source NOT IN ('auto', 'manual')
  OR (NEW.deleted_at IS NULL AND NEW.deleted_by_user_id IS NOT NULL)
  OR (NEW.deleted_at IS NOT NULL AND NEW.deleted_by_user_id IS NULL)
  OR NEW.organization_id <> OLD.organization_id
  OR NEW.owner_user_id <> OLD.owner_user_id
  OR NEW.id <> OLD.id
BEGIN
  SELECT RAISE(ABORT, 'invalid ai conversation management state');
END;

CREATE TRIGGER ai_conversations_create_default_context
AFTER INSERT ON ai_conversations
FOR EACH ROW
BEGIN
  INSERT INTO ai_conversation_contexts (
    organization_id, owner_user_id, conversation_id, book_version_id,
    page_number, selection_json, citations_json, created_at, updated_at, version
  )
  SELECT NEW.organization_id, NEW.owner_user_id, NEW.id, NEW.book_version_id,
         NULL, '{}', '[]', NEW.created_at, NEW.updated_at, 1
  FROM book_versions AS version
  JOIN books AS book
    ON book.id = version.book_id
   AND book.organization_id_at_creation = NEW.organization_id
  WHERE version.id = NEW.book_version_id
    AND version.organization_id_at_creation = NEW.organization_id;
END;

CREATE TRIGGER ai_conversation_contexts_insert_scope
BEFORE INSERT ON ai_conversation_contexts
FOR EACH ROW WHEN json_valid(NEW.selection_json) <> 1
  OR json_valid(NEW.citations_json) <> 1
  OR json_type(NEW.citations_json) <> 'array'
  OR NOT EXISTS (
    SELECT 1
    FROM ai_conversations AS conversation
    JOIN book_versions AS version
      ON version.id = NEW.book_version_id
     AND version.organization_id_at_creation = conversation.organization_id
    JOIN books AS book
      ON book.id = version.book_id
     AND book.organization_id_at_creation = conversation.organization_id
    WHERE conversation.organization_id = NEW.organization_id
      AND conversation.owner_user_id = NEW.owner_user_id
      AND conversation.id = NEW.conversation_id
      AND conversation.book_version_id = NEW.book_version_id
  )
BEGIN
  SELECT RAISE(ABORT, 'ai conversation context scope violation');
END;

CREATE TRIGGER ai_conversation_contexts_update_scope
BEFORE UPDATE ON ai_conversation_contexts
FOR EACH ROW WHEN NEW.organization_id <> OLD.organization_id
  OR NEW.owner_user_id <> OLD.owner_user_id
  OR NEW.conversation_id <> OLD.conversation_id
  OR json_valid(NEW.selection_json) <> 1
  OR json_valid(NEW.citations_json) <> 1
  OR json_type(NEW.citations_json) <> 'array'
  OR NOT EXISTS (
    SELECT 1
    FROM ai_conversations AS conversation
    JOIN book_versions AS version
      ON version.id = NEW.book_version_id
     AND version.organization_id_at_creation = conversation.organization_id
    JOIN books AS book
      ON book.id = version.book_id
     AND book.organization_id_at_creation = conversation.organization_id
    WHERE conversation.organization_id = NEW.organization_id
      AND conversation.owner_user_id = NEW.owner_user_id
      AND conversation.id = NEW.conversation_id
      AND conversation.book_version_id = NEW.book_version_id
  )
BEGIN
  SELECT RAISE(ABORT, 'ai conversation context scope violation');
END;

INSERT INTO ai_conversation_contexts (
  organization_id, owner_user_id, conversation_id, book_version_id,
  selection_json, citations_json, created_at, updated_at, version
)
SELECT organization_id, owner_user_id, id, book_version_id,
       '{}', '[]', created_at, updated_at, 1
FROM ai_conversations;

DROP TABLE migration_042_scope_guard;
