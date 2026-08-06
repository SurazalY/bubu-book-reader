PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  organization_id_at_creation TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  book_version_id TEXT NOT NULL,
  title TEXT,
  summary_json TEXT,
  privacy_mode TEXT NOT NULL DEFAULT 'standard',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_owner ON ai_conversations (organization_id, owner_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id),
  organization_id TEXT NOT NULL,
  organization_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  request_id TEXT,
  model_candidate_id TEXT,
  response_type TEXT,
  privacy_detected INTEGER NOT NULL DEFAULT 0,
  privacy_confidence REAL NOT NULL DEFAULT 0,
  privacy_json TEXT NOT NULL DEFAULT '{}',
  danger_detected INTEGER NOT NULL DEFAULT 0,
  danger_confidence REAL NOT NULL DEFAULT 0,
  danger_json TEXT NOT NULL DEFAULT '{}',
  provider_attempts_json TEXT NOT NULL DEFAULT '[]',
  safe_degradation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (conversation_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_messages_risk ON ai_messages (conversation_id, danger_confidence, privacy_confidence, created_at);

CREATE TABLE IF NOT EXISTS ai_message_evidence (
  id TEXT PRIMARY KEY,
  ai_message_id TEXT NOT NULL REFERENCES ai_messages(id),
  book_version_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  coordinates_json TEXT,
  citation_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (ai_message_id, evidence_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_message_evidence_page ON ai_message_evidence (book_version_id, page_id, page_number);

CREATE TABLE IF NOT EXISTS ai_usage_ledger (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  organization_id_at_creation TEXT NOT NULL,
  user_id TEXT,
  conversation_id TEXT,
  assistant_message_id TEXT REFERENCES ai_messages(id),
  charge_scope TEXT NOT NULL,
  reservation_state TEXT NOT NULL,
  reserved_cost_micros INTEGER NOT NULL,
  student_charge_cost_micros INTEGER,
  provider_cost_micros INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_tokens INTEGER,
  provider_attempts_json TEXT NOT NULL DEFAULT '[]',
  reason_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_scope ON ai_usage_ledger (organization_id, charge_scope, created_at);

CREATE TABLE IF NOT EXISTS book_memory_cards (
  id TEXT PRIMARY KEY,
  organization_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  book_version_id TEXT NOT NULL,
  source_evidence_ids_json TEXT NOT NULL,
  source_page_ids_json TEXT NOT NULL,
  page_range_start INTEGER,
  page_range_end INTEGER,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_book_memory_cards_version ON book_memory_cards (book_version_id, status);

CREATE TABLE IF NOT EXISTS privacy_access_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  organization_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id),
  requester_user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at TEXT,
  resolved_by_user_id TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_privacy_access_requests_scope ON privacy_access_requests (organization_id, conversation_id, status);

CREATE TABLE IF NOT EXISTS safety_review_tasks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  organization_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id),
  initial_message_id TEXT NOT NULL REFERENCES ai_messages(id),
  evidence_message_ids_json TEXT NOT NULL,
  trigger_reasons_json TEXT NOT NULL,
  privacy_json TEXT NOT NULL,
  danger_json TEXT NOT NULL,
  candidate_user_ids_json TEXT NOT NULL,
  candidate_catalog_ids_json TEXT NOT NULL,
  policy_snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL,
  reason_code TEXT,
  review_attempts INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_safety_review_tasks_status ON safety_review_tasks (organization_id, status, created_at);

CREATE TABLE IF NOT EXISTS safety_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  organization_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  review_task_id TEXT NOT NULL REFERENCES safety_review_tasks(id),
  status TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  risk_level TEXT,
  summary_for_staff TEXT,
  notification_chain_json TEXT NOT NULL DEFAULT '[]',
  accepted_by_user_id TEXT,
  accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_safety_events_status ON safety_events (organization_id, status, created_at);

CREATE TABLE IF NOT EXISTS safety_event_evidence (
  id TEXT PRIMARY KEY,
  safety_event_id TEXT NOT NULL REFERENCES safety_events(id),
  ai_message_id TEXT NOT NULL REFERENCES ai_messages(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (safety_event_id, ai_message_id)
);

CREATE TABLE IF NOT EXISTS safety_implicated_candidates (
  id TEXT PRIMARY KEY,
  safety_event_id TEXT REFERENCES safety_events(id),
  review_task_id TEXT NOT NULL REFERENCES safety_review_tasks(id),
  candidate_user_id TEXT NOT NULL,
  confidence REAL NOT NULL,
  reason TEXT,
  excluded_from_notification INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_safety_implicated_candidates_task ON safety_implicated_candidates (review_task_id, candidate_user_id);

CREATE TABLE IF NOT EXISTS safety_handlers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  organization_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  user_id TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT,
  handler_level INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_safety_handlers_lookup ON safety_handlers (organization_id, active, handler_level);
