-- The lease history row is the server-authoritative cutoff for late cumulative summaries.
ALTER TABLE reading_device_lease_history
  ADD COLUMN end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN ('lease_ended', 'lease_taken_over'));

CREATE UNIQUE INDEX IF NOT EXISTS users_id_organization_unique
  ON users(id, organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_id_organization_unique
  ON workspaces(id, organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS classes_id_organization_unique
  ON classes(id, organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS book_versions_id_organization_unique
  ON book_versions(id, organization_id_at_creation);

CREATE TABLE reading_summary_sessions (
  id TEXT PRIMARY KEY,
  organization_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  workspace_id_at_creation TEXT NOT NULL,
  class_id_at_creation TEXT NOT NULL,
  device_id TEXT NOT NULL,
  book_version_id TEXT NOT NULL,
  lease_id_at_start TEXT NOT NULL,
  stat_date TEXT NOT NULL CHECK (
    length(stat_date) = 10
    AND date(stat_date) = stat_date
  ),
  started_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', started_at) = started_at),
  latest_revision INTEGER NOT NULL CHECK (latest_revision >= 1),
  latest_fingerprint TEXT NOT NULL CHECK (
    length(latest_fingerprint) = 64
    AND latest_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  revision_fingerprints_json TEXT NOT NULL CHECK (
    json_valid(revision_fingerprints_json)
    AND json_type(revision_fingerprints_json) = 'object'
  ),
  cumulative_effective_ms INTEGER NOT NULL CHECK (
    cumulative_effective_ms BETWEEN 0 AND 9007199254740991
  ),
  had_skip INTEGER NOT NULL CHECK (had_skip IN (0, 1)),
  had_reread INTEGER NOT NULL CHECK (had_reread IN (0, 1)),
  last_page_no INTEGER NOT NULL CHECK (last_page_no > 0),
  measured_through_at TEXT NOT NULL CHECK (
    strftime('%Y-%m-%dT%H:%M:%fZ', measured_through_at) = measured_through_at
    AND measured_through_at >= started_at
  ),
  ended_at TEXT CHECK (
    ended_at IS NULL
    OR (
      strftime('%Y-%m-%dT%H:%M:%fZ', ended_at) = ended_at
      AND ended_at >= measured_through_at
    )
  ),
  end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN (
    'reader_close',
    'identity_change',
    'workspace_change',
    'book_change',
    'stat_date_change',
    'lease_ended',
    'lease_taken_over',
    'account_deleted'
  )),
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at),
  version INTEGER NOT NULL CHECK (version >= 1),
  CHECK (
    (status = 'open' AND ended_at IS NULL AND end_reason IS NULL)
    OR (status = 'closed' AND ended_at IS NOT NULL AND end_reason IS NOT NULL)
  ),
  CHECK (
    json_extract(revision_fingerprints_json, '$."' || latest_revision || '"') = latest_fingerprint
  ),
  FOREIGN KEY (organization_id_at_creation) REFERENCES organizations(id),
  FOREIGN KEY (actor_id_at_creation, organization_id_at_creation)
    REFERENCES users(id, organization_id),
  FOREIGN KEY (workspace_id_at_creation, organization_id_at_creation)
    REFERENCES workspaces(id, organization_id),
  FOREIGN KEY (class_id_at_creation, organization_id_at_creation)
    REFERENCES classes(id, organization_id),
  FOREIGN KEY (book_version_id, organization_id_at_creation)
    REFERENCES book_versions(id, organization_id_at_creation)
);

CREATE UNIQUE INDEX reading_summary_sessions_actor_open_unique
  ON reading_summary_sessions(organization_id_at_creation, actor_id_at_creation)
  WHERE status = 'open';

CREATE INDEX reading_summary_sessions_actor_stat_date
  ON reading_summary_sessions(
    organization_id_at_creation,
    actor_id_at_creation,
    workspace_id_at_creation,
    stat_date
  );

CREATE INDEX reading_summary_sessions_actor_updated
  ON reading_summary_sessions(
    organization_id_at_creation,
    actor_id_at_creation,
    updated_at
  );

CREATE INDEX reading_summary_sessions_lease
  ON reading_summary_sessions(lease_id_at_start);

CREATE INDEX reading_summary_sessions_status_ended
  ON reading_summary_sessions(status, ended_at);

CREATE TRIGGER reading_summary_sessions_revision_map_insert
BEFORE INSERT ON reading_summary_sessions
WHEN
  (SELECT COUNT(*) FROM json_each(NEW.revision_fingerprints_json)) <> NEW.latest_revision
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.revision_fingerprints_json) AS revision
    WHERE CAST(CAST(revision.key AS INTEGER) AS TEXT) <> revision.key
      OR CAST(revision.key AS INTEGER) < 1
      OR CAST(revision.key AS INTEGER) > NEW.latest_revision
      OR json_type(NEW.revision_fingerprints_json, '$."' || revision.key || '"') <> 'text'
      OR length(revision.value) <> 64
      OR revision.value GLOB '*[^0-9a-f]*'
  )
BEGIN
  SELECT RAISE(ABORT, 'reading summary revision fingerprint history is invalid');
END;

CREATE TRIGGER reading_summary_sessions_revision_map_update
BEFORE UPDATE OF latest_revision, latest_fingerprint, revision_fingerprints_json
ON reading_summary_sessions
WHEN
  (SELECT COUNT(*) FROM json_each(NEW.revision_fingerprints_json)) <> NEW.latest_revision
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.revision_fingerprints_json) AS revision
    WHERE CAST(CAST(revision.key AS INTEGER) AS TEXT) <> revision.key
      OR CAST(revision.key AS INTEGER) < 1
      OR CAST(revision.key AS INTEGER) > NEW.latest_revision
      OR json_type(NEW.revision_fingerprints_json, '$."' || revision.key || '"') <> 'text'
      OR length(revision.value) <> 64
      OR revision.value GLOB '*[^0-9a-f]*'
  )
BEGIN
  SELECT RAISE(ABORT, 'reading summary revision fingerprint history is invalid');
END;

CREATE TRIGGER reading_summary_sessions_scope_immutable
BEFORE UPDATE ON reading_summary_sessions
WHEN
  NEW.organization_id_at_creation IS NOT OLD.organization_id_at_creation
  OR NEW.actor_id_at_creation IS NOT OLD.actor_id_at_creation
  OR NEW.workspace_id_at_creation IS NOT OLD.workspace_id_at_creation
  OR NEW.class_id_at_creation IS NOT OLD.class_id_at_creation
  OR NEW.device_id IS NOT OLD.device_id
  OR NEW.book_version_id IS NOT OLD.book_version_id
  OR NEW.lease_id_at_start IS NOT OLD.lease_id_at_start
  OR NEW.stat_date IS NOT OLD.stat_date
  OR NEW.started_at IS NOT OLD.started_at
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'reading summary session scope is immutable');
END;

CREATE TRIGGER reading_summary_sessions_monotonic_update
BEFORE UPDATE ON reading_summary_sessions
WHEN
  NEW.latest_revision < OLD.latest_revision
  OR NEW.latest_revision > OLD.latest_revision + 1
  OR NEW.cumulative_effective_ms < OLD.cumulative_effective_ms
  OR NEW.had_skip < OLD.had_skip
  OR NEW.had_reread < OLD.had_reread
  OR NEW.measured_through_at < OLD.measured_through_at
  OR (OLD.status = 'closed' AND NEW.status <> 'closed')
  OR (OLD.ended_at IS NOT NULL AND NEW.ended_at IS NOT OLD.ended_at)
  OR (OLD.end_reason IS NOT NULL AND NEW.end_reason IS NOT OLD.end_reason)
  OR (
    NEW.latest_revision = OLD.latest_revision
    AND (
      NEW.latest_fingerprint IS NOT OLD.latest_fingerprint
      OR NEW.revision_fingerprints_json IS NOT OLD.revision_fingerprints_json
      OR NEW.cumulative_effective_ms <> OLD.cumulative_effective_ms
      OR NEW.had_skip <> OLD.had_skip
      OR NEW.had_reread <> OLD.had_reread
      OR NEW.last_page_no <> OLD.last_page_no
      OR NEW.measured_through_at <> OLD.measured_through_at
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'reading summary session fields must advance monotonically');
END;

CREATE TRIGGER reading_summary_sessions_page_insert
BEFORE INSERT ON reading_summary_sessions
WHEN NOT EXISTS (
  SELECT 1 FROM book_versions AS version
  WHERE version.id = NEW.book_version_id
    AND version.organization_id_at_creation = NEW.organization_id_at_creation
    AND NEW.last_page_no <= version.page_count
)
BEGIN
  SELECT RAISE(ABORT, 'reading summary page is outside the book version');
END;

CREATE TRIGGER reading_summary_sessions_page_update
BEFORE UPDATE OF last_page_no ON reading_summary_sessions
WHEN NOT EXISTS (
  SELECT 1 FROM book_versions AS version
  WHERE version.id = NEW.book_version_id
    AND version.organization_id_at_creation = NEW.organization_id_at_creation
    AND NEW.last_page_no <= version.page_count
)
BEGIN
  SELECT RAISE(ABORT, 'reading summary page is outside the book version');
END;

CREATE TABLE reading_daily_book_summaries (
  id TEXT PRIMARY KEY,
  organization_id_at_creation TEXT NOT NULL,
  actor_id_at_creation TEXT NOT NULL,
  workspace_id_at_creation TEXT NOT NULL,
  class_id_at_creation TEXT NOT NULL,
  book_version_id TEXT NOT NULL,
  stat_date TEXT NOT NULL CHECK (
    length(stat_date) = 10
    AND date(stat_date) = stat_date
  ),
  effective_reading_ms INTEGER NOT NULL CHECK (
    effective_reading_ms BETWEEN 0 AND 9007199254740991
  ),
  had_skip INTEGER NOT NULL CHECK (had_skip IN (0, 1)),
  had_reread INTEGER NOT NULL CHECK (had_reread IN (0, 1)),
  last_read_at TEXT CHECK (
    last_read_at IS NULL
    OR strftime('%Y-%m-%dT%H:%M:%fZ', last_read_at) = last_read_at
  ),
  last_page_no INTEGER NOT NULL CHECK (last_page_no > 0),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at),
  updated_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at),
  version INTEGER NOT NULL CHECK (version >= 1),
  UNIQUE (
    organization_id_at_creation,
    actor_id_at_creation,
    workspace_id_at_creation,
    class_id_at_creation,
    book_version_id,
    stat_date
  ),
  FOREIGN KEY (organization_id_at_creation) REFERENCES organizations(id),
  FOREIGN KEY (actor_id_at_creation, organization_id_at_creation)
    REFERENCES users(id, organization_id),
  FOREIGN KEY (workspace_id_at_creation, organization_id_at_creation)
    REFERENCES workspaces(id, organization_id),
  FOREIGN KEY (class_id_at_creation, organization_id_at_creation)
    REFERENCES classes(id, organization_id),
  FOREIGN KEY (book_version_id, organization_id_at_creation)
    REFERENCES book_versions(id, organization_id_at_creation)
);

CREATE INDEX reading_daily_book_summaries_actor_stat_date
  ON reading_daily_book_summaries(
    organization_id_at_creation,
    actor_id_at_creation,
    workspace_id_at_creation,
    stat_date
  );

CREATE INDEX reading_daily_book_summaries_class_stat_actor
  ON reading_daily_book_summaries(
    organization_id_at_creation,
    class_id_at_creation,
    stat_date,
    actor_id_at_creation
  );

CREATE INDEX reading_daily_book_summaries_actor_book_stat
  ON reading_daily_book_summaries(
    organization_id_at_creation,
    actor_id_at_creation,
    workspace_id_at_creation,
    book_version_id,
    stat_date
  );

CREATE INDEX reading_daily_book_summaries_actor_last_read
  ON reading_daily_book_summaries(
    organization_id_at_creation,
    actor_id_at_creation,
    workspace_id_at_creation,
    last_read_at DESC
  );

CREATE INDEX reading_daily_book_summaries_organization_stat_date
  ON reading_daily_book_summaries(organization_id_at_creation, stat_date);

CREATE TRIGGER reading_daily_book_summaries_scope_immutable
BEFORE UPDATE ON reading_daily_book_summaries
WHEN
  NEW.organization_id_at_creation IS NOT OLD.organization_id_at_creation
  OR NEW.actor_id_at_creation IS NOT OLD.actor_id_at_creation
  OR NEW.workspace_id_at_creation IS NOT OLD.workspace_id_at_creation
  OR NEW.class_id_at_creation IS NOT OLD.class_id_at_creation
  OR NEW.book_version_id IS NOT OLD.book_version_id
  OR NEW.stat_date IS NOT OLD.stat_date
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'reading daily summary scope is immutable');
END;

CREATE TRIGGER reading_daily_book_summaries_monotonic_update
BEFORE UPDATE ON reading_daily_book_summaries
WHEN
  NEW.effective_reading_ms < OLD.effective_reading_ms
  OR NEW.had_skip < OLD.had_skip
  OR NEW.had_reread < OLD.had_reread
  OR (OLD.last_read_at IS NOT NULL AND NEW.last_read_at IS NULL)
  OR (
    OLD.last_read_at IS NOT NULL
    AND NEW.last_read_at < OLD.last_read_at
  )
  OR (
    OLD.last_read_at IS NOT NULL
    AND NEW.last_read_at = OLD.last_read_at
    AND NEW.last_page_no < OLD.last_page_no
  )
BEGIN
  SELECT RAISE(ABORT, 'reading daily summary fields must advance monotonically');
END;

CREATE TRIGGER reading_daily_book_summaries_page_insert
BEFORE INSERT ON reading_daily_book_summaries
WHEN NOT EXISTS (
  SELECT 1 FROM book_versions AS version
  WHERE version.id = NEW.book_version_id
    AND version.organization_id_at_creation = NEW.organization_id_at_creation
    AND NEW.last_page_no <= version.page_count
)
BEGIN
  SELECT RAISE(ABORT, 'reading daily summary page is outside the book version');
END;

CREATE TRIGGER reading_daily_book_summaries_page_update
BEFORE UPDATE OF last_page_no ON reading_daily_book_summaries
WHEN NOT EXISTS (
  SELECT 1 FROM book_versions AS version
  WHERE version.id = NEW.book_version_id
    AND version.organization_id_at_creation = NEW.organization_id_at_creation
    AND NEW.last_page_no <= version.page_count
)
BEGIN
  SELECT RAISE(ABORT, 'reading daily summary page is outside the book version');
END;
