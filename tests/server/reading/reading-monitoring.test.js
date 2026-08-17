import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { openSqliteDatabase } from '../../../server/db/database.js'
import { runMigrations } from '../../../server/db/migrate.js'
import { createReadingDomain } from '../../../server/domains/reading/catalog.js'
import {
  addStatDates,
  canonicalReadingSummaryFingerprint,
  cleanupReadingSummarySessions,
  createReadingMonitoringDomain,
  deleteReadingMonitorDataForAccount,
  readingRetentionCutoff,
  readingStatDateFor,
  readingStatDateStart,
} from '../../../server/domains/reading/monitoring.js'

const migrationDirectory = fileURLToPath(new URL('../../../server/db/migrations/', import.meta.url))
const BASE_NOW = '2026-08-10T00:00:00.000Z'

function insertOrganization(db, id) {
  db.prepare(`INSERT INTO organizations (id, name, status, created_at, updated_at, version)
    VALUES (?, ?, 'active', ?, ?, 1)`).run(id, id, BASE_NOW, BASE_NOW)
}

function insertUser(db, id, organizationId, displayName = id) {
  db.prepare(`INSERT INTO users
      (id, organization_id, username, display_name, status, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, 'active', ?, ?, 1)`)
    .run(id, organizationId, id, displayName, BASE_NOW, BASE_NOW)
}

function insertClassScope(db, { organizationId, classId, workspaceId, studentIds }) {
  db.prepare(`INSERT INTO classes
      (id, organization_id, grade_id, name, status, created_at, updated_at, version)
    VALUES (?, ?, 'grade-a', ?, 'active', ?, ?, 1)`)
    .run(classId, organizationId, classId, BASE_NOW, BASE_NOW)
  db.prepare(`INSERT INTO workspaces
      (id, organization_id, code, name, scope_type, scope_id, status, created_at, updated_at, version)
    VALUES (?, ?, 'class-teacher', ?, 'class', ?, 'active', ?, ?, 1)`)
    .run(workspaceId, organizationId, workspaceId, classId, BASE_NOW, BASE_NOW)
  for (const studentId of studentIds) {
    db.prepare(`INSERT INTO workspace_memberships
        (id, user_id, workspace_id, status, created_at, updated_at, version)
      VALUES (?, ?, ?, 'active', ?, ?, 1)`)
      .run(`${workspaceId}:${studentId}`, studentId, workspaceId, BASE_NOW, BASE_NOW)
    db.prepare(`INSERT INTO class_memberships
        (id, class_id, user_id, membership_role, status, created_at, updated_at, version)
      VALUES (?, ?, ?, 'student', 'active', ?, ?, 1)`)
      .run(`${classId}:${studentId}`, classId, studentId, BASE_NOW, BASE_NOW)
  }
}

function insertBook(db, { organizationId = 'org-a', actorId = 'student-a', bookId, versionId, pages = 100 }) {
  db.prepare(`INSERT INTO books
      (id, organization_id_at_creation, actor_id_at_creation, title, status, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, 'published', ?, ?, 1)`)
    .run(bookId, organizationId, actorId, bookId, BASE_NOW, BASE_NOW)
  db.prepare(`INSERT INTO book_versions
      (id, book_id, organization_id_at_creation, actor_id_at_creation, label,
       source_format, page_count, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, 'v1', 'text', ?, ?, ?, 1)`)
    .run(versionId, bookId, organizationId, actorId, pages, BASE_NOW, BASE_NOW)
  const insertPage = db.prepare(`INSERT INTO book_pages
      (id, book_version_id, page_no, text_content, width, height, raw_text, normalized_text,
       created_at, updated_at, version)
    VALUES (?, ?, ?, '', 1, 1, '', '', ?, ?, 1)`)
  for (let pageNo = 1; pageNo <= pages; pageNo += 1) {
    insertPage.run(`${versionId}:page:${pageNo}`, versionId, pageNo, BASE_NOW, BASE_NOW)
  }
}

function createFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'reading-monitor-domain-'))
  const db = openSqliteDatabase(path.join(directory, 'monitoring.sqlite'))
  runMigrations(db, migrationDirectory, BASE_NOW)
  insertOrganization(db, 'org-a')
  insertOrganization(db, 'org-b')
  for (const [id, organizationId] of [
    ['student-a', 'org-a'],
    ['student-a2', 'org-a'],
    ['student-a3', 'org-a'],
    ['student-b', 'org-b'],
  ]) insertUser(db, id, organizationId)
  insertClassScope(db, {
    organizationId: 'org-a',
    classId: 'class-a',
    workspaceId: 'workspace-a',
    studentIds: ['student-a', 'student-a2', 'student-a3'],
  })
  insertClassScope(db, {
    organizationId: 'org-b',
    classId: 'class-b',
    workspaceId: 'workspace-b',
    studentIds: ['student-b'],
  })
  insertBook(db, { bookId: 'book-a', versionId: 'version-a' })
  insertBook(db, { bookId: 'book-a2', versionId: 'version-a2' })
  insertBook(db, {
    organizationId: 'org-b', actorId: 'student-b', bookId: 'book-b', versionId: 'version-b',
  })
  let current = new Date(BASE_NOW)
  let id = 0
  const dependencies = {
    db,
    actor: { id: 'student-a' },
    workspace: { id: 'workspace-a', organizationId: 'org-a' },
    authorize: async ({ action }) => action === 'reading.read_self' || action === 'account.manage',
    audit: async () => undefined,
    idFactory: () => `generated-${++id}`,
    now: () => current,
  }
  return {
    db,
    dependencies,
    reading: createReadingDomain(dependencies),
    monitoring: createReadingMonitoringDomain(dependencies),
    setNow(value) { current = new Date(value) },
    forStudent(studentId, organizationId = 'org-a', workspaceId = 'workspace-a') {
      const scoped = {
        ...dependencies,
        actor: { id: studentId },
        workspace: { id: workspaceId, organizationId },
      }
      return {
        reading: createReadingDomain(scoped),
        monitoring: createReadingMonitoringDomain(scoped),
      }
    },
    close() {
      db.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

function summaryBody(overrides = {}) {
  const body = {
    schemaVersion: 2,
    sessionId: 'session-a',
    revision: 1,
    leaseId: 'lease-placeholder',
    bookVersionId: 'version-a',
    statDate: '2026-08-10',
    startedAt: '2026-08-10T00:00:00.000Z',
    measuredThroughAt: '2026-08-10T00:00:30.000Z',
    cumulativeEffectiveMs: 30_000,
    hadSkip: false,
    hadReread: false,
    lastPageNo: 2,
    pageCoverage: [],
    endedAt: null,
    endReason: null,
    fingerprint: '',
    ...overrides,
  }
  body.fingerprint = canonicalReadingSummaryFingerprint(body)
  return body
}

test('北京时间 04:00、日期范围和六个日历月 cutoff 使用冻结边界', () => {
  assert.equal(readingStatDateFor('2026-08-09T19:59:59.999Z'), '2026-08-09')
  assert.equal(readingStatDateFor('2026-08-09T20:00:00.000Z'), '2026-08-10')
  assert.equal(readingStatDateStart('2026-08-10').toISOString(), '2026-08-09T20:00:00.000Z')
  assert.equal(addStatDates('2026-08-10', -6), '2026-08-04')
  assert.equal(
    readingRetentionCutoff('2026-08-31T22:15:16.123Z').toISOString(),
    '2026-02-28T22:15:16.123Z',
  )
  assert.equal(
    readingRetentionCutoff('2024-08-31T01:00:00.000Z').toISOString(),
    '2024-02-29T01:00:00.000Z',
  )
})

test('acquire 不原地换 scope 或续期，renew 仅延长原范围且 TTL 固定 90 秒', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const first = await fixture.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-a' })
  assert.equal(first.expiresAt, '2026-08-10T00:01:30.000Z')
  fixture.setNow('2026-08-10T00:00:30.000Z')
  const acquiredAgain = await fixture.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-a' })
  assert.equal(acquiredAgain.leaseId, first.leaseId)
  assert.equal(acquiredAgain.expiresAt, first.expiresAt)

  const renewed = await fixture.monitoring.renewLease({
    leaseId: first.leaseId,
    deviceId: 'device-a',
    body: { schemaVersion: 1, bookVersionId: 'version-a' },
  })
  assert.deepEqual(renewed, {
    leaseId: first.leaseId,
    renewedAt: '2026-08-10T00:00:30.000Z',
    expiresAt: '2026-08-10T00:02:00.000Z',
  })
  await assert.rejects(() => fixture.monitoring.renewLease({
    leaseId: first.leaseId,
    deviceId: 'other-device',
    body: { schemaVersion: 1, bookVersionId: 'version-a' },
  }), { code: 'LEASE_CONFLICT' })
  await assert.rejects(() => fixture.monitoring.renewLease({
    leaseId: first.leaseId,
    deviceId: 'device-a',
    body: { schemaVersion: 1, bookVersionId: 'version-a', ttlSeconds: 300 },
  }), { code: 'VALIDATION_FAILED' })

  fixture.setNow('2026-08-10T00:00:40.000Z')
  const nextBook = await fixture.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-a2' })
  assert.notEqual(nextBook.leaseId, first.leaseId)
  const oldHistory = fixture.db.prepare(`SELECT end_reason, valid_until
    FROM reading_device_lease_history WHERE lease_id = ?`).get(first.leaseId)
  assert.equal(oldHistory.end_reason, 'lease_taken_over')
  assert.equal(oldHistory.valid_until, '2026-08-10T00:00:40.000Z')

  fixture.setNow('2026-08-10T00:02:11.000Z')
  await assert.rejects(() => fixture.monitoring.renewLease({
    leaseId: nextBook.leaseId,
    deviceId: 'device-a',
    body: { schemaVersion: 1, bookVersionId: 'version-a2' },
  }), { code: 'LEASE_REQUIRED' })
})

test('摘要 accepted/replayed/superseded、历史指纹、连续 revision 与事务 delta 不重复计时', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const lease = await fixture.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-a' })
  fixture.setNow('2026-08-10T00:00:30.000Z')
  const first = summaryBody({ leaseId: lease.leaseId })
  assert.equal((await fixture.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: first })).result, 'accepted')
  assert.equal((await fixture.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: first })).result, 'replayed')

  fixture.setNow('2026-08-10T00:00:45.000Z')
  const second = summaryBody({
    leaseId: lease.leaseId,
    revision: 2,
    measuredThroughAt: '2026-08-10T00:00:45.000Z',
    cumulativeEffectiveMs: 45_000,
    hadSkip: true,
    lastPageNo: 3,
  })
  const accepted = await fixture.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: second })
  assert.equal(accepted.result, 'accepted')
  assert.equal(accepted.latestRevision, 2)
  assert.equal((await fixture.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: first })).result, 'superseded')

  const conflictingFirst = summaryBody({ ...first, lastPageNo: 4 })
  await assert.rejects(() => fixture.monitoring.acceptSessionSummary({
    deviceId: 'device-a', body: conflictingFirst,
  }), { code: 'REVISION_CONFLICT' })
  const gap = summaryBody({
    ...second,
    revision: 4,
    measuredThroughAt: '2026-08-10T00:00:46.000Z',
    cumulativeEffectiveMs: 46_000,
  })
  await assert.rejects(() => fixture.monitoring.acceptSessionSummary({
    deviceId: 'device-a', body: gap,
  }), { code: 'REVISION_GAP' })
  const regression = summaryBody({
    ...second,
    revision: 3,
    measuredThroughAt: '2026-08-10T00:00:46.000Z',
    cumulativeEffectiveMs: 44_000,
  })
  await assert.rejects(() => fixture.monitoring.acceptSessionSummary({
    deviceId: 'device-a', body: regression,
  }), { code: 'SUMMARY_REGRESSION' })

  const daily = fixture.db.prepare('SELECT * FROM reading_daily_book_summaries').get()
  assert.equal(daily.effective_reading_ms, 45_000)
  assert.equal(daily.had_skip, 1)
  const progress = fixture.db.prepare('SELECT * FROM reading_progress').get()
  assert.equal(progress.last_page_no, 3)
  assert.equal(progress.valid_reading_seconds, 0)
  const session = fixture.db.prepare('SELECT * FROM reading_summary_sessions').get()
  assert.deepEqual(JSON.parse(session.revision_fingerprints_json), {
    1: first.fingerprint,
    2: second.fingerprint,
  })
})

test('逐页覆盖按 original/text 与确认交互持久化，重放不重复且不能由 lastPageNo 推导', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const lease = await fixture.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-a' })
  fixture.setNow('2026-08-10T00:00:30.000Z')
  const first = summaryBody({
    leaseId: lease.leaseId,
    lastPageNo: 7,
    pageCoverage: [
      { pageNo: 2, effectiveOriginalMs: 10_000, effectiveTextMs: 20_000, confirmedInteractions: 1 },
    ],
  })
  assert.equal((await fixture.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: first })).result, 'accepted')
  assert.equal((await fixture.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: first })).result, 'replayed')
  assert.deepEqual(fixture.db.prepare(`SELECT page_no, effective_original_ms, effective_text_ms,
      confirmed_interactions, version FROM reading_page_coverage ORDER BY page_no`).all().map((row) => ({ ...row })), [
    { page_no: 2, effective_original_ms: 10_000, effective_text_ms: 20_000, confirmed_interactions: 1, version: 1 },
  ])
  assert.equal(fixture.db.prepare(`SELECT COUNT(*) AS count FROM reading_page_coverage
    WHERE page_no BETWEEN 1 AND 7`).get().count, 1)

  fixture.setNow('2026-08-10T00:00:45.000Z')
  const second = summaryBody({
    leaseId: lease.leaseId,
    revision: 2,
    measuredThroughAt: '2026-08-10T00:00:45.000Z',
    cumulativeEffectiveMs: 45_000,
    lastPageNo: 8,
    pageCoverage: [
      { pageNo: 2, effectiveOriginalMs: 10_000, effectiveTextMs: 30_000, confirmedInteractions: 1 },
      { pageNo: 8, effectiveOriginalMs: 5_000, effectiveTextMs: 0, confirmedInteractions: 1 },
    ],
  })
  assert.equal((await fixture.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: second })).result, 'accepted')
  assert.deepEqual(fixture.db.prepare(`SELECT page_no, effective_original_ms, effective_text_ms,
      confirmed_interactions FROM reading_page_coverage ORDER BY page_no`).all().map((row) => ({ ...row })), [
    { page_no: 2, effective_original_ms: 10_000, effective_text_ms: 30_000, confirmed_interactions: 1 },
    { page_no: 8, effective_original_ms: 5_000, effective_text_ms: 0, confirmed_interactions: 1 },
  ])

  fixture.setNow('2026-08-10T00:00:46.000Z')
  const droppedPage = summaryBody({
    leaseId: lease.leaseId,
    revision: 3,
    measuredThroughAt: '2026-08-10T00:00:46.000Z',
    cumulativeEffectiveMs: 46_000,
    lastPageNo: 8,
    pageCoverage: [{ pageNo: 8, effectiveOriginalMs: 6_000, effectiveTextMs: 0, confirmedInteractions: 1 }],
  })
  await assert.rejects(() => fixture.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: droppedPage }), { code: 'SUMMARY_REGRESSION' })
  assert.equal(fixture.db.prepare(`SELECT latest_revision FROM reading_summary_sessions
    WHERE id = ?`).get(first.sessionId).latest_revision, 2)
})

test('G5-01 旧事件只贡献护眼，不写阅读时长且不能覆盖摘要每日事实和位置', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const lease = await fixture.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-a' })
  fixture.setNow('2026-08-10T00:00:30.000Z')
  const summary = summaryBody({ leaseId: lease.leaseId })
  assert.equal((await fixture.monitoring.acceptSessionSummary({
    deviceId: 'device-a', body: summary,
  })).result, 'accepted')

  const dailyBefore = fixture.db.prepare('SELECT * FROM reading_daily_book_summaries').get()
  const progressBefore = fixture.db.prepare('SELECT * FROM reading_progress').get()
  assert.equal(progressBefore.last_page_no, 2)
  assert.equal(progressBefore.valid_reading_seconds, 0)
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM eye_care_usage').get().count, 0)
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM eye_care_states').get().count, 0)

  fixture.setNow('2026-08-10T00:01:00.000Z')
  const event = {
    id: 'legacy-eye-only-event',
    schemaVersion: 1,
    deviceId: 'device-a',
    bookVersionId: 'version-a',
    pageNo: 99,
    eventType: 'page_stay',
    clientOccurredAt: '2026-08-10T00:00:40.000Z',
    durationMs: 30_000,
    foreground: true,
    screenOn: true,
    offlineSequence: 1,
    classSessionId: null,
    payload: {},
  }
  assert.deepEqual(await fixture.reading.ingestEventsBatch({ events: [event] }), {
    accepted: [event.id], replayed: [],
  })

  const storedEvent = fixture.db.prepare(`SELECT valid_reading_seconds, valid_eye_seconds
    FROM reading_events WHERE id = ?`).get(event.id)
  assert.deepEqual({ ...storedEvent }, { valid_reading_seconds: 0, valid_eye_seconds: 30 })
  assert.deepEqual(fixture.db.prepare('SELECT * FROM reading_daily_book_summaries').get(), dailyBefore)
  assert.deepEqual(fixture.db.prepare('SELECT * FROM reading_progress').get(), progressBefore)
  assert.deepEqual(
    fixture.db.prepare(`SELECT window_kind, valid_eye_seconds FROM eye_care_usage
      ORDER BY window_kind`).all().map((row) => ({ ...row })),
    [
      { window_kind: 'day', valid_eye_seconds: 30 },
      { window_kind: 'week', valid_eye_seconds: 30 },
    ],
  )
  const eyeState = fixture.db.prepare(`SELECT continuous_eye_seconds, last_active_at, version
    FROM eye_care_states`).get()
  assert.deepEqual({ ...eyeState }, {
    continuous_eye_seconds: 30,
    last_active_at: '2026-08-10T00:01:10.000Z',
    version: 1,
  })

  assert.deepEqual(await fixture.reading.ingestEventsBatch({ events: [event] }), {
    accepted: [], replayed: [event.id],
  })
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM reading_events').get().count, 1)
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM eye_care_usage').get().count, 2)
  assert.deepEqual(fixture.db.prepare(`SELECT continuous_eye_seconds, last_active_at, version
    FROM eye_care_states`).get(), eyeState)
  assert.deepEqual(fixture.db.prepare('SELECT * FROM reading_daily_book_summaries').get(), dailyBefore)
  assert.deepEqual(fixture.db.prepare('SELECT * FROM reading_progress').get(), progressBefore)
})

test('摘要严格拒绝未知字段、非规范时间、未来时间、墙钟超额、错统计日和错指纹', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const lease = await fixture.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-a' })
  fixture.setNow('2026-08-10T00:00:30.000Z')
  const valid = summaryBody({ leaseId: lease.leaseId })
  await assert.rejects(() => fixture.monitoring.acceptSessionSummary({
    deviceId: 'device-a', body: { ...valid, unknown: true },
  }), { code: 'VALIDATION_FAILED' })
  await assert.rejects(() => fixture.monitoring.acceptSessionSummary({
    deviceId: 'device-a',
    body: { ...valid, measuredThroughAt: '2026-08-10T00:00:30Z' },
  }), { code: 'VALIDATION_FAILED' })
  const future = summaryBody({
    ...valid,
    measuredThroughAt: '2026-08-10T00:02:30.001Z',
    cumulativeEffectiveMs: 30_000,
  })
  await assert.rejects(() => fixture.monitoring.acceptSessionSummary({
    deviceId: 'device-a', body: future,
  }), { code: 'FUTURE_TIME_REJECTED' })
  const wallClock = summaryBody({ ...valid, cumulativeEffectiveMs: 30_001 })
  await assert.rejects(() => fixture.monitoring.acceptSessionSummary({
    deviceId: 'device-a', body: wallClock,
  }), { code: 'VALIDATION_FAILED' })
  const wrongDate = summaryBody({ ...valid, statDate: '2026-08-09' })
  await assert.rejects(() => fixture.monitoring.acceptSessionSummary({
    deviceId: 'device-a', body: wrongDate,
  }), { code: 'STAT_DATE_MISMATCH' })
  await assert.rejects(() => fixture.monitoring.acceptSessionSummary({
    deviceId: 'device-a', body: { ...valid, fingerprint: '0'.repeat(64) },
  }), { code: 'VALIDATION_FAILED' })
  const outsideRetention = summaryBody({
    ...valid,
    statDate: '2026-02-09',
    startedAt: '2026-02-09T00:00:00.000Z',
    measuredThroughAt: '2026-02-09T00:00:01.000Z',
    cumulativeEffectiveMs: 1_000,
  })
  await assert.rejects(() => fixture.monitoring.acceptSessionSummary({
    deviceId: 'device-a', body: outsideRetention,
  }), { code: 'VALIDATION_FAILED' })
})

test('仅 stat_date_change 可把 endedAt 精确放在下一统计日 04:00 边界', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  fixture.setNow('2026-08-09T19:59:00.000Z')
  const lease = await fixture.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-a' })
  fixture.setNow('2026-08-09T20:00:00.000Z')
  const closing = summaryBody({
    leaseId: lease.leaseId,
    statDate: '2026-08-09',
    startedAt: '2026-08-09T19:59:00.000Z',
    measuredThroughAt: '2026-08-09T19:59:50.000Z',
    cumulativeEffectiveMs: 50_000,
    endedAt: '2026-08-09T20:00:00.000Z',
    endReason: 'stat_date_change',
  })
  assert.equal((await fixture.monitoring.acceptSessionSummary({
    deviceId: 'device-a', body: closing,
  })).result, 'accepted')
  const wrongReason = summaryBody({
    ...closing,
    sessionId: 'wrong-boundary-reason',
    endReason: 'reader_close',
  })
  await assert.rejects(() => fixture.monitoring.acceptSessionSummary({
    deviceId: 'device-a', body: wrongReason,
  }), { code: 'STAT_DATE_MISMATCH' })
})

test('旧租约首次晚到直接 closed，且允许截止前连续晚到 revision', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const oldLease = await fixture.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-a' })
  fixture.setNow('2026-08-10T00:00:40.000Z')
  await fixture.reading.takeOverLease({ deviceId: 'device-b', bookVersionId: 'version-a' })
  fixture.setNow('2026-08-10T00:00:50.000Z')
  const first = summaryBody({
    leaseId: oldLease.leaseId,
    measuredThroughAt: '2026-08-10T00:00:30.000Z',
    cumulativeEffectiveMs: 30_000,
  })
  assert.equal((await fixture.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: first })).result, 'accepted')
  let stored = fixture.db.prepare(`SELECT status, ended_at, end_reason, latest_revision
    FROM reading_summary_sessions WHERE id = 'session-a'`).get()
  assert.equal(stored.status, 'closed')
  assert.equal(stored.ended_at, '2026-08-10T00:00:40.000Z')
  assert.equal(stored.end_reason, 'lease_taken_over')

  const second = summaryBody({
    leaseId: oldLease.leaseId,
    revision: 2,
    measuredThroughAt: '2026-08-10T00:00:35.000Z',
    cumulativeEffectiveMs: 35_000,
    hadReread: true,
  })
  assert.equal((await fixture.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: second })).result, 'accepted')
  stored = fixture.db.prepare(`SELECT status, ended_at, end_reason, latest_revision
    FROM reading_summary_sessions WHERE id = 'session-a'`).get()
  assert.equal(stored.latest_revision, 2)
  assert.equal(stored.ended_at, '2026-08-10T00:00:40.000Z')

  const tooLate = summaryBody({
    leaseId: oldLease.leaseId,
    revision: 3,
    measuredThroughAt: '2026-08-10T00:00:41.000Z',
    cumulativeEffectiveMs: 36_000,
    hadReread: true,
  })
  await assert.rejects(() => fixture.monitoring.acceptSessionSummary({
    deviceId: 'device-a', body: tooLate,
  }), { code: 'LEASE_CONFLICT' })
})

test('同租约残留open会话不挡新会话，且不覆盖旧累计毫秒', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const lease = await fixture.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-a' })
  fixture.setNow('2026-08-10T00:01:00.000Z')
  await fixture.monitoring.renewLease({
    leaseId: lease.leaseId,
    deviceId: 'device-a',
    body: { schemaVersion: 1, bookVersionId: 'version-a' },
  })
  fixture.setNow('2026-08-10T00:02:00.000Z')
  await fixture.monitoring.renewLease({
    leaseId: lease.leaseId,
    deviceId: 'device-a',
    body: { schemaVersion: 1, bookVersionId: 'version-a' },
  })
  fixture.setNow('2026-08-10T00:03:14.544Z')
  const leftover = summaryBody({
    sessionId: 'session-leftover',
    leaseId: lease.leaseId,
    cumulativeEffectiveMs: 194_544,
    measuredThroughAt: '2026-08-10T00:03:14.544Z',
    lastPageNo: 1,
  })
  assert.equal((await fixture.monitoring.acceptSessionSummary({
    deviceId: 'device-a',
    body: leftover,
  })).result, 'accepted')

  fixture.setNow('2026-08-10T00:03:20.000Z')
  const next = summaryBody({
    sessionId: 'session-next',
    leaseId: lease.leaseId,
    startedAt: '2026-08-10T00:03:15.000Z',
    measuredThroughAt: '2026-08-10T00:03:20.000Z',
    cumulativeEffectiveMs: 5_000,
    lastPageNo: 3,
  })
  assert.equal((await fixture.monitoring.acceptSessionSummary({
    deviceId: 'device-a',
    body: next,
  })).result, 'accepted')

  const leftoverRow = fixture.db.prepare(`SELECT status, end_reason, cumulative_effective_ms, latest_revision
    FROM reading_summary_sessions WHERE id = 'session-leftover'`).get()
  const nextRow = fixture.db.prepare(`SELECT status, cumulative_effective_ms, last_page_no
    FROM reading_summary_sessions WHERE id = 'session-next'`).get()
  assert.equal(leftoverRow.status, 'closed')
  assert.equal(leftoverRow.end_reason, 'lease_taken_over')
  assert.equal(Number(leftoverRow.cumulative_effective_ms), 194_544)
  assert.equal(Number(leftoverRow.latest_revision), 1)
  assert.equal(nextRow.status, 'open')
  assert.equal(Number(nextRow.cumulative_effective_ms), 5_000)
  assert.equal(nextRow.last_page_no, 3)
})

test('跨 session 晚到正常累加 delta/OR，但较旧位置不回退', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const oldLease = await fixture.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-a' })
  fixture.setNow('2026-08-10T00:00:40.000Z')
  const newLease = await fixture.reading.takeOverLease({ deviceId: 'device-b', bookVersionId: 'version-a' })
  fixture.setNow('2026-08-10T00:00:50.000Z')
  const current = summaryBody({
    sessionId: 'session-new',
    leaseId: newLease.leaseId,
    startedAt: '2026-08-10T00:00:40.000Z',
    measuredThroughAt: '2026-08-10T00:00:50.000Z',
    cumulativeEffectiveMs: 10_000,
    lastPageNo: 8,
  })
  await fixture.monitoring.acceptSessionSummary({ deviceId: 'device-b', body: current })
  const late = summaryBody({
    sessionId: 'session-old',
    leaseId: oldLease.leaseId,
    measuredThroughAt: '2026-08-10T00:00:30.000Z',
    cumulativeEffectiveMs: 30_000,
    hadSkip: true,
    lastPageNo: 3,
  })
  await fixture.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: late })
  const daily = fixture.db.prepare('SELECT * FROM reading_daily_book_summaries').get()
  assert.equal(daily.effective_reading_ms, 40_000)
  assert.equal(daily.had_skip, 1)
  assert.equal(daily.last_read_at, '2026-08-10T00:00:50.000Z')
  assert.equal(daily.last_page_no, 8)
  const progress = fixture.db.prepare('SELECT * FROM reading_progress').get()
  assert.equal(progress.updated_from_event_at, '2026-08-10T00:00:50.000Z')
  assert.equal(progress.last_page_no, 8)
})

test('位置测量时间精确相同时仅以更大页码稳定破同值', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const lease = await fixture.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-a' })
  fixture.setNow('2026-08-10T00:00:30.000Z')
  const first = summaryBody({
    sessionId: 'tie-session-a',
    leaseId: lease.leaseId,
    measuredThroughAt: '2026-08-10T00:00:30.000Z',
    cumulativeEffectiveMs: 20_000,
    lastPageNo: 3,
    endedAt: '2026-08-10T00:00:30.000Z',
    endReason: 'reader_close',
  })
  await fixture.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: first })
  const second = summaryBody({
    sessionId: 'tie-session-b',
    leaseId: lease.leaseId,
    startedAt: '2026-08-10T00:00:10.000Z',
    measuredThroughAt: '2026-08-10T00:00:30.000Z',
    cumulativeEffectiveMs: 10_000,
    lastPageNo: 5,
    endedAt: '2026-08-10T00:00:30.000Z',
    endReason: 'reader_close',
  })
  await fixture.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: second })
  const daily = fixture.db.prepare('SELECT last_read_at, last_page_no FROM reading_daily_book_summaries').get()
  const progress = fixture.db.prepare('SELECT updated_from_event_at, last_page_no FROM reading_progress').get()
  assert.equal(daily.last_read_at, '2026-08-10T00:00:30.000Z')
  assert.equal(daily.last_page_no, 5)
  assert.equal(progress.updated_from_event_at, '2026-08-10T00:00:30.000Z')
  assert.equal(progress.last_page_no, 5)
})

test('班级在会话创建时快照，转班后的新会话归入新班级且旧事实不改写', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const oldLease = await fixture.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-a' })
  fixture.setNow('2026-08-10T00:00:30.000Z')
  await fixture.monitoring.acceptSessionSummary({
    deviceId: 'device-a',
    body: summaryBody({ leaseId: oldLease.leaseId, cumulativeEffectiveMs: 30_000 }),
  })

  fixture.db.prepare(`UPDATE class_memberships SET status = 'disabled'
    WHERE class_id = 'class-a' AND user_id = 'student-a'`).run()
  fixture.db.prepare(`UPDATE workspace_memberships SET status = 'disabled'
    WHERE workspace_id = 'workspace-a' AND user_id = 'student-a'`).run()
  insertClassScope(fixture.db, {
    organizationId: 'org-a',
    classId: 'class-new',
    workspaceId: 'workspace-new',
    studentIds: ['student-a'],
  })
  fixture.setNow('2026-08-10T00:00:40.000Z')
  const moved = fixture.forStudent('student-a', 'org-a', 'workspace-new')
  const newLease = await moved.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-a' })
  fixture.setNow('2026-08-10T00:00:50.000Z')
  await moved.monitoring.acceptSessionSummary({
    deviceId: 'device-a',
    body: summaryBody({
      sessionId: 'session-after-transfer',
      leaseId: newLease.leaseId,
      startedAt: '2026-08-10T00:00:40.000Z',
      measuredThroughAt: '2026-08-10T00:00:50.000Z',
      cumulativeEffectiveMs: 10_000,
      lastPageNo: 4,
    }),
  })
  assert.deepEqual(fixture.db.prepare(`SELECT class_id_at_creation, effective_reading_ms
    FROM reading_daily_book_summaries ORDER BY class_id_at_creation`).all().map((row) => [
    row.class_id_at_creation,
    row.effective_reading_ms,
  ]), [
    ['class-a', 30_000],
    ['class-new', 10_000],
  ])
  assert.equal(fixture.db.prepare(`SELECT class_id_at_creation FROM reading_summary_sessions
    WHERE id = 'session-a'`).get().class_id_at_creation, 'class-a')
})

test('每日汇总失败时会话和位置均回滚，不产生半写', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const lease = await fixture.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-a' })
  fixture.db.exec(`CREATE TRIGGER fail_daily_insert BEFORE INSERT ON reading_daily_book_summaries
    BEGIN SELECT RAISE(ABORT, 'forced daily failure'); END;`)
  fixture.setNow('2026-08-10T00:00:30.000Z')
  await assert.rejects(() => fixture.monitoring.acceptSessionSummary({
    deviceId: 'device-a', body: summaryBody({ leaseId: lease.leaseId }),
  }), /forced daily failure/)
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM reading_summary_sessions').get().count, 0)
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM reading_daily_book_summaries').get().count, 0)
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM reading_progress').get().count, 0)
})

function insertStoredSession(db, input) {
  const fingerprint = input.fingerprint || 'a'.repeat(64)
  db.prepare(`INSERT INTO reading_summary_sessions (
      id, organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation,
      class_id_at_creation, device_id, book_version_id, lease_id_at_start, stat_date,
      started_at, latest_revision, latest_fingerprint, revision_fingerprints_json,
      cumulative_effective_ms, had_skip, had_reread, last_page_no, measured_through_at,
      ended_at, end_reason, status, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, 'device-cleanup', 'version-a', ?, ?, ?, 1, ?, ?,
      0, 0, 0, 1, ?, ?, ?, ?, ?, ?, 1)`)
    .run(
      input.id,
      'org-a',
      input.actorId,
      'workspace-a',
      'class-a',
      input.leaseId,
      input.statDate,
      input.startedAt,
      fingerprint,
      JSON.stringify({ 1: fingerprint }),
      input.measuredThroughAt,
      input.endedAt,
      input.endReason,
      input.status,
      input.createdAt || input.startedAt,
      input.updatedAt || input.startedAt,
    )
}

test('reading-domain 删除按组织隔离；六个月 cleanup 先关历史已结束 open、严格删除 cutoff 前 closed 且幂等', (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const cutoff = '2026-02-10T00:00:00.000Z'
  const before = '2026-02-09T23:59:59.999Z'
  insertStoredSession(fixture.db, {
    id: 'old-open-ended', actorId: 'student-a', leaseId: 'cleanup-lease-ended',
    statDate: '2026-01-01', startedAt: '2026-01-01T00:00:00.000Z',
    measuredThroughAt: '2026-01-01T00:00:00.000Z', status: 'open', endedAt: null, endReason: null,
  })
  fixture.db.prepare(`INSERT INTO reading_device_lease_history (
      id, lease_id, organization_id, workspace_id, actor_id, device_id, book_version_id,
      valid_from, valid_until, created_at, updated_at, version, end_reason
    ) VALUES ('cleanup-history', 'cleanup-lease-ended', 'org-a', 'workspace-a', 'student-a',
      'device-cleanup', 'version-a', '2026-01-01T00:00:00.000Z', ?, ?, ?, 1, 'lease_ended')`)
    .run(before, before, before)
  insertStoredSession(fixture.db, {
    id: 'cutoff-closed', actorId: 'student-a2', leaseId: 'cleanup-cutoff',
    statDate: '2026-02-10', startedAt: cutoff, measuredThroughAt: cutoff,
    status: 'closed', endedAt: cutoff, endReason: 'reader_close',
  })
  insertStoredSession(fixture.db, {
    id: 'abnormal-open', actorId: 'student-a3', leaseId: 'cleanup-missing-history',
    statDate: '2026-01-02', startedAt: '2026-01-02T00:00:00.000Z',
    measuredThroughAt: '2026-01-02T00:00:00.000Z', status: 'open', endedAt: null, endReason: null,
  })
  const first = cleanupReadingSummarySessions({ db: fixture.db, now: '2026-08-10T00:00:00.000Z' })
  assert.deepEqual(first, {
    cutoff,
    closedCount: 1,
    deletedCount: 1,
    anomalousOpenSessionIds: ['abnormal-open'],
  })
  assert.equal(fixture.db.prepare(`SELECT COUNT(*) AS count FROM reading_summary_sessions
    WHERE id = 'cutoff-closed'`).get().count, 1)
  const second = cleanupReadingSummarySessions({ db: fixture.db, now: '2026-08-10T00:00:00.000Z' })
  assert.deepEqual(second, {
    cutoff,
    closedCount: 0,
    deletedCount: 0,
    anomalousOpenSessionIds: ['abnormal-open'],
  })

  fixture.db.prepare(`INSERT INTO reading_progress (
      id, actor_id, workspace_id, book_version_id, last_page_no, valid_reading_seconds,
      updated_from_event_at, created_at, updated_at, version
    ) VALUES ('progress-delete', 'student-a2', 'workspace-a', 'version-a', 2, 9, ?, ?, ?, 1)`)
    .run(BASE_NOW, BASE_NOW, BASE_NOW)
  fixture.db.prepare(`INSERT INTO reading_daily_book_summaries (
      id, organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation,
      class_id_at_creation, book_version_id, stat_date, effective_reading_ms,
      had_skip, had_reread, last_read_at, last_page_no, created_at, updated_at, version
    ) VALUES ('daily-delete', 'org-a', 'student-a2', 'workspace-a', 'class-a', 'version-a',
      '2026-08-10', 1, 0, 0, ?, 1, ?, ?, 1)`).run(BASE_NOW, BASE_NOW, BASE_NOW)
  assert.deepEqual(deleteReadingMonitorDataForAccount(fixture.db, {
    organizationId: 'org-a', actorId: 'student-a2',
  }), { sessions: 1, dailySummaries: 1, progress: 1, pageCoverage: 0 })
  assert.throws(() => deleteReadingMonitorDataForAccount(fixture.db, {
    organizationId: 'org-b', actorId: 'student-a2',
  }), { code: 'RESOURCE_NOT_FOUND' })
  assert.equal(fixture.db.prepare(`SELECT COUNT(*) AS count FROM users WHERE id = 'student-b'`).get().count, 1)
})
