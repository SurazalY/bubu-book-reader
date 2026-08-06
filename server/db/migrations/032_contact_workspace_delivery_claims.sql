ALTER TABLE parent_contacts ADD COLUMN workspace_id_at_creation TEXT;

UPDATE parent_contacts
SET workspace_id_at_creation = '__legacy_unscoped__'
WHERE workspace_id_at_creation IS NULL;

CREATE TABLE parent_contacts_v2 (
  id TEXT PRIMARY KEY,
  organization_id_at_creation TEXT NOT NULL,
  workspace_id_at_creation TEXT NOT NULL,
  student_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  destination TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'summary_link', 'mini_program')),
  unsubscribed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(organization_id_at_creation, workspace_id_at_creation, student_id, destination, channel)
);

INSERT INTO parent_contacts_v2 (
  id, organization_id_at_creation, workspace_id_at_creation, student_id,
  display_name, destination, channel, unsubscribed_at, created_at, updated_at, version
)
SELECT
  id, organization_id_at_creation, workspace_id_at_creation, student_id,
  display_name, destination, channel, unsubscribed_at, created_at, updated_at, version
FROM parent_contacts;

DROP TABLE parent_contacts;
ALTER TABLE parent_contacts_v2 RENAME TO parent_contacts;

CREATE INDEX IF NOT EXISTS idx_parent_contacts_workspace_student
ON parent_contacts(organization_id_at_creation, workspace_id_at_creation, student_id);

CREATE TABLE report_deliveries_v2 (
  id TEXT PRIMARY KEY,
  report_version_id TEXT NOT NULL,
  parent_contact_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'summary_link', 'mini_program')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'unknown_reconciliation', 'sent', 'retry_scheduled', 'failed', 'unsubscribed', 'expired')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL,
  link_expires_at TEXT,
  link_token_hash TEXT UNIQUE,
  first_opened_at TEXT,
  first_read_at TEXT,
  last_provider_reference TEXT,
  claim_token TEXT,
  claim_started_at TEXT,
  claim_expires_at TEXT,
  provider_idempotency_key TEXT,
  provider_message_id TEXT,
  reconciliation_status TEXT NOT NULL DEFAULT 'none' CHECK (reconciliation_status IN ('none', 'unknown', 'confirmed_sent', 'confirmed_failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

INSERT INTO report_deliveries_v2 (
  id, report_version_id, parent_contact_id, channel, status, attempt_count,
  max_attempts, link_expires_at, link_token_hash, first_opened_at, first_read_at,
  last_provider_reference, created_at, updated_at, version
)
SELECT
  id, report_version_id, parent_contact_id, channel, status, attempt_count,
  max_attempts, link_expires_at, link_token_hash, first_opened_at, first_read_at,
  last_provider_reference, created_at, updated_at, version
FROM report_deliveries;

DROP TABLE report_deliveries;
ALTER TABLE report_deliveries_v2 RENAME TO report_deliveries;

CREATE INDEX IF NOT EXISTS idx_report_deliveries_status
ON report_deliveries(status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_deliveries_claim_token
ON report_deliveries(claim_token)
WHERE claim_token IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_deliveries_provider_idempotency
ON report_deliveries(provider_idempotency_key)
WHERE provider_idempotency_key IS NOT NULL;

CREATE TABLE delivery_attempts_v2 (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  adapter_name TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('sent', 'failed', 'unknown')),
  provider_reference TEXT NOT NULL,
  provider_idempotency_key TEXT,
  provider_message_id TEXT,
  adapter_phase TEXT NOT NULL,
  reconciliation_status TEXT NOT NULL DEFAULT 'none' CHECK (reconciliation_status IN ('none', 'pending', 'confirmed_sent', 'confirmed_failed')),
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(delivery_id, attempt_number)
);

INSERT INTO delivery_attempts_v2 (
  id, delivery_id, attempt_number, adapter_name, outcome, provider_reference,
  adapter_phase, reconciliation_status, failure_code, created_at, updated_at
)
SELECT
  id, delivery_id, attempt_number, adapter_name, outcome, provider_reference,
  'legacy', 'none', failure_code, created_at, created_at
FROM delivery_attempts;

DROP TABLE delivery_attempts;
ALTER TABLE delivery_attempts_v2 RENAME TO delivery_attempts;

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_attempts_provider_idempotency
ON delivery_attempts(provider_idempotency_key)
WHERE provider_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS delivery_reconciliation_events (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  provider_idempotency_key TEXT NOT NULL,
  provider_reference TEXT,
  provider_message_id TEXT,
  failure_code TEXT,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_delivery_reconciliation_events_delivery
ON delivery_reconciliation_events(delivery_id, attempt_number, created_at);
