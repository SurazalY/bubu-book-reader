PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_message_request_links (
  logical_request_id TEXT PRIMARY KEY,
  user_message_id TEXT NOT NULL UNIQUE REFERENCES ai_messages(id),
  assistant_message_id TEXT NOT NULL UNIQUE REFERENCES ai_messages(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  CHECK (user_message_id <> assistant_message_id)
);

CREATE TABLE IF NOT EXISTS safety_review_leases (
  review_task_id TEXT PRIMARY KEY REFERENCES safety_review_tasks(id),
  lease_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed', 'released', 'completed')),
  claimed_at TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  completed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  CHECK (lease_expires_at > claimed_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_safety_events_review_task ON safety_events (review_task_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_safety_implicated_candidates_task_user ON safety_implicated_candidates (review_task_id, candidate_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_open_safety_review_per_conversation
  ON safety_review_tasks (conversation_id)
  WHERE status IN ('pending_secondary_review', 'review_claimed', 'pending_human_confirmation', 'awaiting_human_acceptance');
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_privacy_access_request
  ON privacy_access_requests (conversation_id, requester_user_id)
  WHERE status = 'pending';

CREATE TRIGGER IF NOT EXISTS trg_ai_conversations_privacy_mode_insert
BEFORE INSERT ON ai_conversations
FOR EACH ROW WHEN NEW.privacy_mode NOT IN ('standard', 'private')
BEGIN
  SELECT RAISE(ABORT, 'invalid ai_conversations privacy_mode');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_conversations_privacy_mode_update
BEFORE UPDATE ON ai_conversations
FOR EACH ROW WHEN NEW.privacy_mode NOT IN ('standard', 'private')
BEGIN
  SELECT RAISE(ABORT, 'invalid ai_conversations privacy_mode');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_messages_flags_insert
BEFORE INSERT ON ai_messages
FOR EACH ROW WHEN NEW.privacy_detected NOT IN (0, 1)
  OR NEW.danger_detected NOT IN (0, 1)
  OR NEW.safe_degradation NOT IN (0, 1)
  OR NEW.privacy_confidence < 0 OR NEW.privacy_confidence > 1
  OR NEW.danger_confidence < 0 OR NEW.danger_confidence > 1
BEGIN
  SELECT RAISE(ABORT, 'invalid ai_messages flags or confidence');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_messages_flags_update
BEFORE UPDATE ON ai_messages
FOR EACH ROW WHEN NEW.privacy_detected NOT IN (0, 1)
  OR NEW.danger_detected NOT IN (0, 1)
  OR NEW.safe_degradation NOT IN (0, 1)
  OR NEW.privacy_confidence < 0 OR NEW.privacy_confidence > 1
  OR NEW.danger_confidence < 0 OR NEW.danger_confidence > 1
BEGIN
  SELECT RAISE(ABORT, 'invalid ai_messages flags or confidence');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_message_evidence_flag_insert
BEFORE INSERT ON ai_message_evidence
FOR EACH ROW WHEN NEW.citation_verified NOT IN (0, 1)
BEGIN
  SELECT RAISE(ABORT, 'invalid ai_message_evidence citation_verified');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_message_evidence_flag_update
BEFORE UPDATE ON ai_message_evidence
FOR EACH ROW WHEN NEW.citation_verified NOT IN (0, 1)
BEGIN
  SELECT RAISE(ABORT, 'invalid ai_message_evidence citation_verified');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_usage_ledger_valid_insert
BEFORE INSERT ON ai_usage_ledger
FOR EACH ROW WHEN NEW.reservation_state NOT IN ('reserved', 'settled', 'released')
  OR NEW.reserved_cost_micros < 0
  OR (NEW.student_charge_cost_micros IS NOT NULL AND NEW.student_charge_cost_micros < 0)
  OR (NEW.provider_cost_micros IS NOT NULL AND NEW.provider_cost_micros < 0)
  OR (NEW.input_tokens IS NOT NULL AND NEW.input_tokens < 0)
  OR (NEW.output_tokens IS NOT NULL AND NEW.output_tokens < 0)
  OR (NEW.cached_tokens IS NOT NULL AND NEW.cached_tokens < 0)
BEGIN
  SELECT RAISE(ABORT, 'invalid ai_usage_ledger state or non-negative usage');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_usage_ledger_valid_update
BEFORE UPDATE ON ai_usage_ledger
FOR EACH ROW WHEN NEW.reservation_state NOT IN ('reserved', 'settled', 'released')
  OR NEW.reserved_cost_micros < 0
  OR (NEW.student_charge_cost_micros IS NOT NULL AND NEW.student_charge_cost_micros < 0)
  OR (NEW.provider_cost_micros IS NOT NULL AND NEW.provider_cost_micros < 0)
  OR (NEW.input_tokens IS NOT NULL AND NEW.input_tokens < 0)
  OR (NEW.output_tokens IS NOT NULL AND NEW.output_tokens < 0)
  OR (NEW.cached_tokens IS NOT NULL AND NEW.cached_tokens < 0)
BEGIN
  SELECT RAISE(ABORT, 'invalid ai_usage_ledger state or non-negative usage');
END;

CREATE TRIGGER IF NOT EXISTS trg_privacy_access_requests_status_insert
BEFORE INSERT ON privacy_access_requests
FOR EACH ROW WHEN NEW.status NOT IN ('pending', 'approved', 'denied', 'expired')
BEGIN
  SELECT RAISE(ABORT, 'invalid privacy_access_requests status');
END;

CREATE TRIGGER IF NOT EXISTS trg_privacy_access_requests_status_update
BEFORE UPDATE ON privacy_access_requests
FOR EACH ROW WHEN NEW.status NOT IN ('pending', 'approved', 'denied', 'expired')
BEGIN
  SELECT RAISE(ABORT, 'invalid privacy_access_requests status');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_review_tasks_valid_insert
BEFORE INSERT ON safety_review_tasks
FOR EACH ROW WHEN NEW.status NOT IN ('pending_secondary_review', 'review_claimed', 'pending_human_confirmation', 'awaiting_human_acceptance', 'false_positive_closed')
  OR NEW.review_attempts < 0
BEGIN
  SELECT RAISE(ABORT, 'invalid safety_review_tasks status or attempts');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_review_tasks_valid_update
BEFORE UPDATE ON safety_review_tasks
FOR EACH ROW WHEN NEW.status NOT IN ('pending_secondary_review', 'review_claimed', 'pending_human_confirmation', 'awaiting_human_acceptance', 'false_positive_closed')
  OR NEW.review_attempts < 0
BEGIN
  SELECT RAISE(ABORT, 'invalid safety_review_tasks status or attempts');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_events_status_insert
BEFORE INSERT ON safety_events
FOR EACH ROW WHEN NEW.status NOT IN ('pending_human_confirmation', 'awaiting_human_acceptance', 'false_positive_closed')
BEGIN
  SELECT RAISE(ABORT, 'invalid safety_events status');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_events_status_update
BEFORE UPDATE ON safety_events
FOR EACH ROW WHEN NEW.status NOT IN ('pending_human_confirmation', 'awaiting_human_acceptance', 'false_positive_closed')
BEGIN
  SELECT RAISE(ABORT, 'invalid safety_events status');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_implicated_candidates_valid_insert
BEFORE INSERT ON safety_implicated_candidates
FOR EACH ROW WHEN NEW.confidence < 0 OR NEW.confidence > 1 OR NEW.excluded_from_notification NOT IN (0, 1)
BEGIN
  SELECT RAISE(ABORT, 'invalid safety_implicated_candidates confidence or flag');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_implicated_candidates_valid_update
BEFORE UPDATE ON safety_implicated_candidates
FOR EACH ROW WHEN NEW.confidence < 0 OR NEW.confidence > 1 OR NEW.excluded_from_notification NOT IN (0, 1)
BEGIN
  SELECT RAISE(ABORT, 'invalid safety_implicated_candidates confidence or flag');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_handlers_active_insert
BEFORE INSERT ON safety_handlers
FOR EACH ROW WHEN NEW.active NOT IN (0, 1)
BEGIN
  SELECT RAISE(ABORT, 'invalid safety_handlers active');
END;

CREATE TRIGGER IF NOT EXISTS trg_safety_handlers_active_update
BEFORE UPDATE ON safety_handlers
FOR EACH ROW WHEN NEW.active NOT IN (0, 1)
BEGIN
  SELECT RAISE(ABORT, 'invalid safety_handlers active');
END;
