import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { openSqliteDatabase } from '../../../server/db/database.js'
import { runMigrations } from '../../../server/db/migrate.js'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const migrationDirectory = fileURLToPath(new URL('../../../server/db/migrations', import.meta.url))
const commandPath = path.join(repositoryRoot, 'server/scripts/reading-monitor-cleanup.js')
const now = '2026-08-10T00:00:00.000Z'
const cutoff = '2026-02-10T00:00:00.000Z'
const beforeCutoff = '2026-02-09T23:59:59.999Z'

function insertSession(db, {
  id,
  actorId,
  leaseId,
  startedAt,
  measuredThroughAt = startedAt,
  endedAt = null,
  endReason = null,
  status = 'open',
}) {
  const fingerprint = id.padEnd(64, 'a').slice(0, 64).replaceAll(/[^0-9a-f]/g, 'a')
  db.prepare(`INSERT INTO reading_summary_sessions (
      id, organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation,
      class_id_at_creation, device_id, book_version_id, lease_id_at_start, stat_date,
      started_at, latest_revision, latest_fingerprint, revision_fingerprints_json,
      cumulative_effective_ms, had_skip, had_reread, last_page_no, measured_through_at,
      ended_at, end_reason, status, created_at, updated_at, version
    ) VALUES (
      ?, 'cleanup-org', ?, 'cleanup-workspace', 'cleanup-class', 'cleanup-device',
      'cleanup-version', ?, '2026-01-01', ?, 1, ?, ?, 0, 0, 0, 1, ?, ?, ?, ?, ?, ?, 1
    )`).run(
    id,
    actorId,
    leaseId,
    startedAt,
    fingerprint,
    JSON.stringify({ 1: fingerprint }),
    measuredThroughAt,
    endedAt,
    endReason,
    status,
    startedAt,
    startedAt,
  )
}

function seedCleanupDatabase(databasePath) {
  const db = openSqliteDatabase(databasePath)
  runMigrations(db, migrationDirectory, '2026-08-09T00:00:00.000Z')
  const createdAt = '2026-01-01T00:00:00.000Z'
  db.prepare(`INSERT INTO organizations (id, name, status, created_at, updated_at, version)
    VALUES ('cleanup-org', '清理命令测试组织', 'active', ?, ?, 1)`).run(createdAt, createdAt)
  for (const actorId of ['cleanup-student-a', 'cleanup-student-b', 'cleanup-student-c']) {
    db.prepare(`INSERT INTO users (
        id, organization_id, username, display_name, status, created_at, updated_at, version
      ) VALUES (?, 'cleanup-org', ?, ?, 'active', ?, ?, 1)`)
      .run(actorId, actorId, actorId, createdAt, createdAt)
  }
  db.prepare(`INSERT INTO workspaces (
      id, organization_id, code, name, scope_type, scope_id, status, created_at, updated_at, version
    ) VALUES ('cleanup-workspace', 'cleanup-org', 'class-teacher', '清理班级空间',
      'class', 'cleanup-class', 'active', ?, ?, 1)`).run(createdAt, createdAt)
  db.prepare(`INSERT INTO classes (
      id, organization_id, grade_id, name, status, created_at, updated_at, version
    ) VALUES ('cleanup-class', 'cleanup-org', NULL, '清理班级', 'active', ?, ?, 1)`)
    .run(createdAt, createdAt)
  db.prepare(`INSERT INTO books (
      id, organization_id_at_creation, actor_id_at_creation, title, status, created_at, updated_at, version
    ) VALUES ('cleanup-book', 'cleanup-org', 'cleanup-student-a', '清理测试书', 'published', ?, ?, 1)`)
    .run(createdAt, createdAt)
  db.prepare(`INSERT INTO book_versions (
      id, book_id, organization_id_at_creation, actor_id_at_creation, label, source_format,
      page_count, created_at, updated_at, version
    ) VALUES ('cleanup-version', 'cleanup-book', 'cleanup-org', 'cleanup-student-a',
      'v1', 'text', 1, ?, ?, 1)`).run(createdAt, createdAt)

  insertSession(db, {
    id: 'older-closed', actorId: 'cleanup-student-a', leaseId: 'lease-older-closed',
    startedAt: createdAt, endedAt: beforeCutoff, endReason: 'reader_close', status: 'closed',
  })
  insertSession(db, {
    id: 'equal-cutoff', actorId: 'cleanup-student-a', leaseId: 'lease-equal-cutoff',
    startedAt: cutoff, endedAt: cutoff, endReason: 'reader_close', status: 'closed',
  })
  insertSession(db, {
    id: 'legitimate-open', actorId: 'cleanup-student-b', leaseId: 'lease-legitimate-open',
    startedAt: createdAt,
  })
  db.prepare(`INSERT INTO reading_device_lease_history (
      id, lease_id, organization_id, workspace_id, actor_id, device_id, book_version_id,
      valid_from, valid_until, created_at, updated_at, version, end_reason
    ) VALUES ('history-legitimate-open', 'lease-legitimate-open', 'cleanup-org',
      'cleanup-workspace', 'cleanup-student-b', 'cleanup-device', 'cleanup-version',
      ?, ?, ?, ?, 1, 'lease_ended')`).run(createdAt, beforeCutoff, beforeCutoff, beforeCutoff)
  insertSession(db, {
    id: 'anomalous-open', actorId: 'cleanup-student-c', leaseId: 'lease-anomalous-open',
    startedAt: createdAt,
  })
  db.close()
}

function runCommand(databasePath, commandNow = now) {
  return spawnSync(process.execPath, [commandPath, '--database', databasePath, '--now', commandNow], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
}

test('maintenance cleanup 命令真实处理 cutoff、等值保留、历史 open、异常报告且幂等', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'readmate-cleanup-command-'))
  const databasePath = path.join(directory, 'cleanup.sqlite')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  seedCleanupDatabase(databasePath)

  const first = runCommand(databasePath)
  assert.equal(first.status, 0, first.stderr)
  assert.deepEqual(JSON.parse(first.stdout), {
    cutoff,
    closedCount: 1,
    deletedCount: 2,
    anomalousOpenSessionIds: ['anomalous-open'],
  })
  const db = openSqliteDatabase(databasePath)
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM reading_summary_sessions
    WHERE id = 'equal-cutoff'`).get().count, 1)
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM reading_summary_sessions
    WHERE id IN ('older-closed', 'legitimate-open')`).get().count, 0)
  db.close()

  const second = runCommand(databasePath)
  assert.equal(second.status, 0, second.stderr)
  assert.deepEqual(JSON.parse(second.stdout), {
    cutoff,
    closedCount: 0,
    deletedCount: 0,
    anomalousOpenSessionIds: ['anomalous-open'],
  })
})

test('maintenance cleanup 命令参数错误时非零退出并给出稳定错误前缀', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'readmate-cleanup-command-error-'))
  const databasePath = path.join(directory, 'cleanup.sqlite')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  seedCleanupDatabase(databasePath)

  const failed = runCommand(databasePath, 'not-a-time')
  assert.notEqual(failed.status, 0)
  assert.match(failed.stderr, /^reading monitor cleanup failed: cleanup now 必须是有效时间/m)
})
