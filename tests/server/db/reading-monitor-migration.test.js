import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { openSqliteDatabase } from '../../../server/db/database.js'
import { listMigrationFiles, runMigrations } from '../../../server/db/migrate.js'

const NOW = '2026-08-10T08:00:00.000Z'
const migrationDirectory = fileURLToPath(new URL('../../../server/db/migrations/', import.meta.url))

function temporaryDatabase(prefix) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix))
  const db = openSqliteDatabase(path.join(directory, 'reading-monitor.sqlite'))
  return {
    directory,
    db,
    close() {
      db.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

function insertScope(db) {
  db.prepare(`INSERT INTO organizations (id, name, school_code, status, created_at, updated_at, version)
    VALUES ('org-a', 'A', 'org-a', 'active', ?, ?, 1), ('org-b', 'B', 'org-b', 'active', ?, ?, 1)`)
    .run(NOW, NOW, NOW, NOW)
  db.prepare(`INSERT INTO users
      (id, organization_id, username, display_name, status, created_at, updated_at, version, login_name, account_code)
    VALUES ('student-a', 'org-a', 'student-a', 'A Student', 'active', ?, ?, 1, 'student-a', 'A-student-a'),
      ('student-b', 'org-b', 'student-b', 'B Student', 'active', ?, ?, 1, 'student-b', 'A-student-b'),
      ('admin-a', 'org-a', 'admin-a', 'A Admin', 'active', ?, ?, 1, 'admin-a', 'A-admin-a')`)
    .run(NOW, NOW, NOW, NOW, NOW, NOW)
  db.prepare(`INSERT INTO classes
      (id, organization_id, grade_id, name, status, created_at, updated_at, version)
    VALUES ('class-a', 'org-a', 'grade-a', 'A Class', 'active', ?, ?, 1),
      ('class-b', 'org-b', 'grade-b', 'B Class', 'active', ?, ?, 1)`)
    .run(NOW, NOW, NOW, NOW)
  db.prepare(`INSERT INTO workspaces
      (id, organization_id, code, name, scope_type, scope_id, status, created_at, updated_at, version)
    VALUES ('workspace-a', 'org-a', 'class-teacher', 'A Workspace', 'class', 'class-a', 'active', ?, ?, 1),
      ('workspace-b', 'org-b', 'class-teacher', 'B Workspace', 'class', 'class-b', 'active', ?, ?, 1)`)
    .run(NOW, NOW, NOW, NOW)
  db.prepare(`INSERT INTO books
      (id, organization_id_at_creation, actor_id_at_creation, title, status, created_at, updated_at, version)
    VALUES ('book-a', 'org-a', 'admin-a', 'Book A', 'published', ?, ?, 1)`)
    .run(NOW, NOW)
  db.prepare(`INSERT INTO book_versions
      (id, book_id, organization_id_at_creation, actor_id_at_creation, label, source_format,
       page_count, created_at, updated_at, version)
    VALUES ('version-a', 'book-a', 'org-a', 'admin-a', 'v1', 'text', 10, ?, ?, 1)`)
    .run(NOW, NOW)
}

function sessionValues(overrides = {}) {
  const values = {
    id: 'session-a',
    organizationId: 'org-a',
    actorId: 'student-a',
    workspaceId: 'workspace-a',
    classId: 'class-a',
    deviceId: 'device-a',
    bookVersionId: 'version-a',
    leaseId: 'lease-a',
    statDate: '2026-08-10',
    startedAt: '2026-08-10T00:00:00.000Z',
    revision: 1,
    fingerprint: 'a'.repeat(64),
    fingerprints: JSON.stringify({ 1: 'a'.repeat(64) }),
    cumulativeMs: 60_000,
    hadSkip: 0,
    hadReread: 0,
    lastPageNo: 2,
    measuredThroughAt: '2026-08-10T00:01:00.000Z',
    endedAt: null,
    endReason: null,
    status: 'open',
    now: NOW,
    ...overrides,
  }
  return values
}

function insertSession(db, overrides = {}) {
  db.prepare(`INSERT INTO reading_summary_sessions (
      id, organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation,
      class_id_at_creation, device_id, book_version_id, lease_id_at_start, stat_date,
      started_at, latest_revision, latest_fingerprint, revision_fingerprints_json,
      cumulative_effective_ms, had_skip, had_reread, last_page_no, measured_through_at,
      ended_at, end_reason, status, created_at, updated_at, version
    ) VALUES (
      :id, :organizationId, :actorId, :workspaceId,
      :classId, :deviceId, :bookVersionId, :leaseId, :statDate,
      :startedAt, :revision, :fingerprint, :fingerprints,
      :cumulativeMs, :hadSkip, :hadReread, :lastPageNo, :measuredThroughAt,
      :endedAt, :endReason, :status, :now, :now, 1
    )`).run(sessionValues(overrides))
}

test('044 在全新数据库顺序执行并由迁移账本重复启动校验和保护', (t) => {
  const fixture = temporaryDatabase('reading-monitor-fresh-')
  t.after(() => fixture.close())
  const first = runMigrations(fixture.db, migrationDirectory, NOW)
  const second = runMigrations(fixture.db, migrationDirectory, NOW)
  assert.equal(first.applied.at(-1), '053_issued_temp_passwords.sql')
  assert.equal(first.applied.length, listMigrationFiles(migrationDirectory).length)
  assert.equal(second.applied.length, 0)
  assert.equal(second.alreadyApplied.length, first.applied.length)
  assert.equal(fixture.db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type = 'table' AND name IN (
      'reading_summary_sessions', 'reading_daily_book_summaries',
      'reading_summary_page_coverage', 'reading_page_coverage'
    )`).get().count, 4)
  assert.equal(fixture.db.prepare(`SELECT COUNT(*) AS count FROM schema_migrations
    WHERE id = '043_reading_session_summaries.sql' AND length(checksum) = 64`).get().count, 1)
  assert.equal(fixture.db.prepare(`SELECT COUNT(*) AS count FROM schema_migrations
    WHERE id = '044_reader_dual_mode_pilot.sql' AND length(checksum) = 64`).get().count, 1)
})

test('043 与 044 可从已执行 042 的干净数据库前向升级并保留 reading_progress', (t) => {
  const fixture = temporaryDatabase('reading-monitor-forward-')
  t.after(() => fixture.close())
  const stagedMigrations = path.join(fixture.directory, 'migrations')
  mkdirSync(stagedMigrations)
  for (const filename of readdirSync(migrationDirectory).filter((name) => name.endsWith('.sql') && name < '043_')) {
    copyFileSync(path.join(migrationDirectory, filename), path.join(stagedMigrations, filename))
  }
  runMigrations(fixture.db, stagedMigrations, NOW)
  fixture.db.prepare(`INSERT INTO reading_progress (
      id, actor_id, workspace_id, book_version_id, last_page_no, valid_reading_seconds,
      updated_from_event_at, created_at, updated_at, version
    ) VALUES ('legacy-progress', 'legacy-student', 'legacy-workspace', 'legacy-version', 4, 99, ?, ?, ?, 1)`)
    .run(NOW, NOW, NOW)
  copyFileSync(
    path.join(migrationDirectory, '043_reading_session_summaries.sql'),
    path.join(stagedMigrations, '043_reading_session_summaries.sql'),
  )
  copyFileSync(
    path.join(migrationDirectory, '044_reader_dual_mode_pilot.sql'),
    path.join(stagedMigrations, '044_reader_dual_mode_pilot.sql'),
  )
  const result = runMigrations(fixture.db, stagedMigrations, NOW)
  assert.deepEqual(result.applied, ['043_reading_session_summaries.sql', '044_reader_dual_mode_pilot.sql'])
  const progress = fixture.db.prepare(`SELECT last_page_no, valid_reading_seconds
    FROM reading_progress WHERE id = 'legacy-progress'`).get()
  assert.equal(progress.last_page_no, 4)
  assert.equal(progress.valid_reading_seconds, 99)
})

test('043 强制范围、连续指纹、open 唯一、页码和单调更新约束', (t) => {
  const fixture = temporaryDatabase('reading-monitor-constraints-')
  t.after(() => fixture.close())
  runMigrations(fixture.db, migrationDirectory, NOW)
  insertScope(fixture.db)
  insertSession(fixture.db)

  assert.throws(() => insertSession(fixture.db, {
    id: 'cross-org',
    workspaceId: 'workspace-b',
    status: 'closed',
    endedAt: '2026-08-10T00:01:00.000Z',
    endReason: 'reader_close',
  }), /FOREIGN KEY/)
  assert.throws(() => insertSession(fixture.db, {
    id: 'bad-page',
    actorId: 'student-a',
    lastPageNo: 11,
  }), /page is outside/)
  assert.throws(() => insertSession(fixture.db, {
    id: 'second-open',
    leaseId: 'lease-b',
  }), /UNIQUE/)
  assert.throws(() => fixture.db.prepare(`UPDATE reading_summary_sessions
    SET cumulative_effective_ms = 1 WHERE id = 'session-a'`).run(), /monotonically/)
  assert.throws(() => fixture.db.prepare(`UPDATE reading_summary_sessions
    SET class_id_at_creation = 'class-b' WHERE id = 'session-a'`).run(), /immutable/)
  assert.throws(() => fixture.db.prepare(`UPDATE reading_summary_sessions SET
      latest_revision = 2,
      latest_fingerprint = ?,
      revision_fingerprints_json = ?,
      cumulative_effective_ms = 61_000,
      measured_through_at = '2026-08-10T00:01:01.000Z',
      updated_at = ?, version = version + 1
    WHERE id = 'session-a'`).run('b'.repeat(64), JSON.stringify({ 2: 'b'.repeat(64) }), NOW), /fingerprint history/)

  fixture.db.prepare(`INSERT INTO reading_daily_book_summaries (
      id, organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation,
      class_id_at_creation, book_version_id, stat_date, effective_reading_ms,
      had_skip, had_reread, last_read_at, last_page_no, created_at, updated_at, version
    ) VALUES ('daily-a', 'org-a', 'student-a', 'workspace-a', 'class-a', 'version-a',
      '2026-08-10', 60000, 0, 0, '2026-08-10T00:01:00.000Z', 2, ?, ?, 1)`).run(NOW, NOW)
  assert.throws(() => fixture.db.prepare(`UPDATE reading_daily_book_summaries
    SET effective_reading_ms = 1 WHERE id = 'daily-a'`).run(), /monotonically/)
  assert.throws(() => fixture.db.prepare(`INSERT INTO reading_daily_book_summaries (
      id, organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation,
      class_id_at_creation, book_version_id, stat_date, effective_reading_ms,
      had_skip, had_reread, last_read_at, last_page_no, created_at, updated_at, version
    ) SELECT 'daily-duplicate', organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation,
      class_id_at_creation, book_version_id, stat_date, effective_reading_ms,
      had_skip, had_reread, last_read_at, last_page_no, created_at, updated_at, version
      FROM reading_daily_book_summaries WHERE id = 'daily-a'`).run(), /UNIQUE/)
})
