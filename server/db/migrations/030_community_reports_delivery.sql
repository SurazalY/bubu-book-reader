CREATE TABLE IF NOT EXISTS community_posts (
  id TEXT PRIMARY KEY,
  organization_id_at_creation TEXT NOT NULL,
  workspace_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  author_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted', 'approved', 'rejected', 'delisted')),
  ai_assisted INTEGER NOT NULL DEFAULT 0,
  organization_snapshot_json TEXT NOT NULL,
  workspace_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS post_assets (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  original_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(post_id, sha256)
);

CREATE TABLE IF NOT EXISTS post_reviews (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  workspace_id_at_review TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'delisted')),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS post_reactions (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reaction_type TEXT NOT NULL CHECK (reaction_type IN ('appreciate', 'insight', 'bookmark')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(post_id, actor_id, reaction_type)
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  organization_id_at_creation TEXT NOT NULL,
  workspace_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  student_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('generated', 'reviewed', 'archived')),
  current_version_id TEXT,
  generated_from_snapshot_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(organization_id_at_creation, workspace_id_at_creation, student_id, generated_from_snapshot_key)
);

CREATE TABLE IF NOT EXISTS report_versions (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  ai_generated INTEGER NOT NULL,
  ai_notice TEXT NOT NULL,
  generated_by_id TEXT NOT NULL,
  reviewed_by_id TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(report_id, version_number)
);

CREATE TABLE IF NOT EXISTS parent_contacts (
  id TEXT PRIMARY KEY,
  organization_id_at_creation TEXT NOT NULL,
  student_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  destination TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'summary_link', 'mini_program')),
  unsubscribed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(student_id, destination, channel)
);

CREATE TABLE IF NOT EXISTS report_deliveries (
  id TEXT PRIMARY KEY,
  report_version_id TEXT NOT NULL,
  parent_contact_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'summary_link', 'mini_program')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'retry_scheduled', 'failed', 'unsubscribed', 'expired')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL,
  link_expires_at TEXT,
  link_token_hash TEXT UNIQUE,
  first_opened_at TEXT,
  first_read_at TEXT,
  last_provider_reference TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  adapter_name TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('sent', 'failed')),
  provider_reference TEXT NOT NULL,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(delivery_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS delivery_receipts (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  receipt_kind TEXT NOT NULL CHECK (receipt_kind IN ('opened', 'read')),
  external_event_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(delivery_id, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_community_posts_workspace_status ON community_posts(workspace_id_at_creation, status, created_at);
CREATE INDEX IF NOT EXISTS idx_report_deliveries_status ON report_deliveries(status, updated_at);
