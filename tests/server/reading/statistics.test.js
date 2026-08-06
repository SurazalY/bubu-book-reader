import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { openSqliteDatabase } from '../../../server/db/database.js'
import { runMigrations } from '../../../server/db/migrate.js'
import { createReadingStatisticsDomain } from '../../../server/domains/reading/statistics.js'

const NOW = '2026-08-06T05:30:00.000Z'

function insertOrganization(db, id) {
  db.prepare(`INSERT INTO organizations (id, name, status, created_at, updated_at, version)
    VALUES (?, ?, 'active', ?, ?, 1)`).run(id, `${id} school`, NOW, NOW)
}

function insertUser(db, { id, organizationId, username = id }) {
  db.prepare(`INSERT INTO users (id, organization_id, username, display_name, status, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, 'active', ?, ?, 1)`).run(id, organizationId, username, `${id} display`, NOW, NOW)
}

function insertWorkspace(db, { id, organizationId, code, scopeType, scopeId }) {
  db.prepare(`INSERT INTO workspaces
      (id, organization_id, code, name, scope_type, scope_id, status, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1)`)
    .run(id, organizationId, code, `${id} workspace`, scopeType, scopeId, NOW, NOW)
}

function insertMembership(db, userId, workspaceId) {
  db.prepare(`INSERT INTO workspace_memberships
      (id, user_id, workspace_id, status, created_at, updated_at, version)
    VALUES (?, ?, ?, 'active', ?, ?, 1)`).run(`${workspaceId}:${userId}`, userId, workspaceId, NOW, NOW)
}

function insertClass(db, { id, organizationId, gradeId = 'grade-3' }) {
  db.prepare(`INSERT INTO classes
      (id, organization_id, grade_id, name, status, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, 'active', ?, ?, 1)`).run(id, organizationId, gradeId, `${id} class`, NOW, NOW)
}

function insertClassMembership(db, { classId, userId, role }) {
  db.prepare(`INSERT INTO class_memberships
      (id, class_id, user_id, membership_role, status, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, 'active', ?, ?, 1)`).run(`${classId}:${userId}`, classId, userId, role, NOW, NOW)
}

function insertBook(db, { organizationId, actorId, bookId, versionId, title }) {
  db.prepare(`INSERT INTO books
      (id, organization_id_at_creation, actor_id_at_creation, title, status, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, 'published', ?, ?, 1)`).run(bookId, organizationId, actorId, title, NOW, NOW)
  db.prepare(`INSERT INTO book_versions
      (id, book_id, organization_id_at_creation, actor_id_at_creation, label, source_format,
       page_count, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, 'v1', 'text', 100, ?, ?, 1)`)
    .run(versionId, bookId, organizationId, actorId, NOW, NOW)
}

function insertEvent(db, input) {
  const defaults = {
    organizationId: 'org-a', actorId: 'student-a', workspaceId: 'class-a-workspace',
    deviceId: 'device-a', bookVersionId: 'version-a', pageNo: 1, eventType: 'page_stay',
    foreground: 1, screenOn: 1, offlineSequence: 1, validReadingSeconds: 60,
    validEyeSeconds: 60,
  }
  const event = { ...defaults, ...input }
  db.prepare(`INSERT INTO reading_events (
      id, organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation,
      device_id, book_version_id, page_no, event_type, client_occurred_at, received_at,
      foreground, screen_on, offline_sequence, event_fingerprint, payload_json,
      valid_reading_seconds, valid_eye_seconds, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, 1)`)
    .run(event.id, event.organizationId, event.actorId, event.workspaceId, event.deviceId,
      event.bookVersionId, event.pageNo, event.eventType, event.occurredAt, event.occurredAt,
      event.foreground, event.screenOn, event.offlineSequence, event.id.padEnd(64, '0').slice(0, 64),
      event.validReadingSeconds, event.validEyeSeconds, event.occurredAt, event.occurredAt)
}

function createFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'readmate-statistics-'))
  const db = openSqliteDatabase(path.join(directory, 'statistics.sqlite'))
  const migrationDirectory = fileURLToPath(new URL('../../../server/db/migrations', import.meta.url))
  runMigrations(db, migrationDirectory, NOW)

  insertOrganization(db, 'org-a')
  insertOrganization(db, 'org-b')
  insertClass(db, { id: 'class-a', organizationId: 'org-a' })
  insertClass(db, { id: 'class-b', organizationId: 'org-b' })
  insertWorkspace(db, { id: 'class-a-workspace', organizationId: 'org-a', code: 'class-teacher', scopeType: 'class', scopeId: 'class-a' })
  insertWorkspace(db, { id: 'school-a-workspace', organizationId: 'org-a', code: 'school-admin', scopeType: 'school', scopeId: 'org-a' })
  insertWorkspace(db, { id: 'class-b-workspace', organizationId: 'org-b', code: 'class-teacher', scopeType: 'class', scopeId: 'class-b' })

  for (const user of [
    { id: 'student-a', organizationId: 'org-a' },
    { id: 'student-a2', organizationId: 'org-a' },
    { id: 'teacher-a', organizationId: 'org-a' },
    { id: 'admin-a', organizationId: 'org-a' },
    { id: 'student-b', organizationId: 'org-b' },
  ]) insertUser(db, user)
  for (const [userId, workspaceId] of [
    ['student-a', 'class-a-workspace'], ['student-a2', 'class-a-workspace'],
    ['teacher-a', 'class-a-workspace'], ['admin-a', 'school-a-workspace'],
    ['student-b', 'class-b-workspace'],
  ]) insertMembership(db, userId, workspaceId)
  for (const membership of [
    { classId: 'class-a', userId: 'student-a', role: 'student' },
    { classId: 'class-a', userId: 'student-a2', role: 'student' },
    { classId: 'class-a', userId: 'teacher-a', role: 'teacher' },
    { classId: 'class-b', userId: 'student-b', role: 'student' },
  ]) insertClassMembership(db, membership)

  insertBook(db, { organizationId: 'org-a', actorId: 'admin-a', bookId: 'book-a', versionId: 'version-a', title: '真实书籍 A' })
  insertBook(db, { organizationId: 'org-a', actorId: 'admin-a', bookId: 'book-a2', versionId: 'version-a2', title: '真实书籍 A2' })
  insertBook(db, { organizationId: 'org-b', actorId: 'student-b', bookId: 'book-b', versionId: 'version-b', title: '真实书籍 B' })

  return {
    db,
    directory,
    close() { db.close(); rmSync(directory, { recursive: true, force: true }) },
  }
}

test('学生统计按事件时间区间并集计算，多设备重叠、后台、熄屏和超长停页不重复计入', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  insertEvent(fixture.db, { id: 'day-one', occurredAt: '2026-08-05T01:00:00.000Z', validReadingSeconds: 60 })
  insertEvent(fixture.db, { id: 'today-a', occurredAt: '2026-08-06T04:00:00.000Z', validReadingSeconds: 120, offlineSequence: 2 })
  insertEvent(fixture.db, { id: 'today-overlap', occurredAt: '2026-08-06T04:01:00.000Z', deviceId: 'device-b', eventType: 'selection', validReadingSeconds: 120, offlineSequence: 1 })
  insertEvent(fixture.db, { id: 'today-book-two', occurredAt: '2026-08-06T04:10:00.000Z', bookVersionId: 'version-a2', validReadingSeconds: 60, offlineSequence: 3 })
  insertEvent(fixture.db, { id: 'background', occurredAt: '2026-08-06T04:20:00.000Z', foreground: 0, validReadingSeconds: 120, offlineSequence: 4 })
  insertEvent(fixture.db, { id: 'screen-off', occurredAt: '2026-08-06T04:30:00.000Z', screenOn: 0, validReadingSeconds: 120, offlineSequence: 5 })
  insertEvent(fixture.db, { id: 'stale-page', occurredAt: '2026-08-06T04:40:00.000Z', validReadingSeconds: 600, validEyeSeconds: 600, offlineSequence: 6 })
  fixture.db.prepare(`INSERT INTO reading_progress (
      id, actor_id, workspace_id, book_version_id, last_page_no, valid_reading_seconds,
      updated_from_event_at, created_at, updated_at, version
    ) VALUES ('progress-a', 'student-a', 'class-a-workspace', 'version-a', 9, 999,
      '2026-08-06T04:01:00.000Z', ?, ?, 1)`).run(NOW, NOW)
  fixture.db.prepare(`INSERT INTO eye_care_usage (
      id, actor_id, workspace_id, window_start_at, window_kind, valid_eye_seconds,
      created_at, updated_at, version
    ) VALUES ('eye-day-a', 'student-a', 'class-a-workspace', '2026-08-05T20:00:00.000Z',
      'day', 240, ?, ?, 1),
    ('eye-week-a', 'student-a', 'class-a-workspace', '2026-08-02T20:00:00.000Z',
      'week', 300, ?, ?, 1)`).run(NOW, NOW, NOW, NOW)
  fixture.db.prepare(`INSERT INTO eye_care_states (
      actor_id, workspace_id, continuous_eye_seconds, last_active_at,
      created_at, updated_at, version
    ) VALUES ('student-a', 'class-a-workspace', 180, '2026-08-06T04:11:00.000Z', ?, ?, 1)`)
    .run(NOW, NOW)

  const auditEvents = []
  const domain = createReadingStatisticsDomain({
    db: fixture.db,
    now: () => new Date(NOW),
    authorize: async ({ action }) => action === 'reading.read_self',
    audit: (event) => auditEvents.push(event),
  })
  const result = await domain.getStudentSummary({
    organizationId: 'org-a', userId: 'student-a', workspaceId: 'class-a-workspace',
  })

  assert.equal(result.totalEffectiveReadingSeconds, 300)
  assert.equal(result.todayEffectiveReadingSeconds, 240)
  assert.equal(result.weekEffectiveReadingSeconds, 300)
  assert.equal(result.readingDays, 2)
  assert.deepEqual(result.byBook.map(({ bookVersionId, effectiveReadingSeconds }) => [bookVersionId, effectiveReadingSeconds]), [
    ['version-a', 240], ['version-a2', 60],
  ])
  assert.equal(result.recentReading[0].bookVersionId, 'version-a2')
  assert.deepEqual(result.levelInput, {
    totalEffectiveReadingSeconds: 300,
    readingDays: 2,
    startedBookCount: 2,
  })
  assert.equal(result.byBook[0].lastPageNo, 9)
  assert.equal(result.eyeCare.continuousEyeSeconds, 180)
  assert.equal(result.eyeCare.todayValidEyeSeconds, 240)
  assert.equal(result.eyeCare.weekValidEyeSeconds, 300)
  assert.deepEqual(auditEvents, [{
    eventType: 'reading.statistics.self_viewed', resourceType: 'student', resourceId: 'student-a',
  }])
})

test('教师和学校统计只聚合真实授权资源，返回参与人数、趋势、异常停留和护眼状态但不做学生竞争排行', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  insertEvent(fixture.db, { id: 'student-a-valid', occurredAt: '2026-08-06T04:00:00.000Z', validReadingSeconds: 120 })
  insertEvent(fixture.db, { id: 'student-a-overlap', occurredAt: '2026-08-06T04:01:00.000Z', deviceId: 'device-b', validReadingSeconds: 120, offlineSequence: 1 })
  insertEvent(fixture.db, { id: 'student-a2-valid', actorId: 'student-a2', occurredAt: '2026-08-06T04:01:00.000Z', validReadingSeconds: 60, offlineSequence: 1 })
  insertEvent(fixture.db, { id: 'student-a2-stale', actorId: 'student-a2', occurredAt: '2026-08-06T04:20:00.000Z', validReadingSeconds: 600, validEyeSeconds: 600, offlineSequence: 2 })
  insertEvent(fixture.db, { id: 'org-b-valid', organizationId: 'org-b', actorId: 'student-b', workspaceId: 'class-b-workspace', bookVersionId: 'version-b', occurredAt: '2026-08-06T04:00:00.000Z', validReadingSeconds: 120 })
  fixture.db.prepare(`INSERT INTO eye_care_enforcement_states (
      id, organization_id, actor_user_id, workspace_id, status, reminder_at,
      forced_rest_started_at, forced_rest_until, recovered_at, recovery_source,
      released_until, last_evaluated_at, created_at, updated_at, version
    ) VALUES ('eye-a2', 'org-a', 'student-a2', 'class-a-workspace', 'reminder', ?,
      NULL, NULL, NULL, NULL, NULL, ?, ?, ?, 1)`).run(NOW, NOW, NOW, NOW)

  const authorizationCalls = []
  const auditEvents = []
  const domain = createReadingStatisticsDomain({
    db: fixture.db,
    now: () => new Date(NOW),
    authorize: async (input) => { authorizationCalls.push(input); return input.action === 'reading.read_scope' },
    audit: (event) => auditEvents.push(event),
  })
  const result = await domain.getScopedSummary({
    organizationId: 'org-a', userId: 'teacher-a', workspaceId: 'class-a-workspace',
  }, { classId: 'class-a', from: '2026-08-06T00:00:00.000Z', to: '2026-08-07T00:00:00.000Z' })

  assert.equal(authorizationCalls.length, 1)
  assert.equal(result.participantCount, 2)
  assert.equal(result.effectiveReadingSeconds, 240)
  assert.equal(result.trend.length, 1)
  assert.equal(result.trend[0].effectiveReadingSeconds, 240)
  assert.equal(result.anomalousStays.length, 1)
  assert.equal(result.anomalousStays[0].eventId, 'student-a2-stale')
  assert.equal(result.eyeCareStatuses.find((item) => item.studentId === 'student-a2').status, 'reminder')
  assert.equal(Object.hasOwn(result, 'studentRanking'), false)
  assert.equal(JSON.stringify(result).includes('student-b'), false)

  const school = await domain.getScopedSummary({
    organizationId: 'org-a', userId: 'admin-a', workspaceId: 'school-a-workspace',
  }, { studentId: 'student-a', bookVersionId: 'version-a' })
  assert.equal(school.participantCount, 1)
  assert.equal(school.effectiveReadingSeconds, 180)
  assert.deepEqual(auditEvents.map((event) => event.resourceId), ['class-a', 'student-a'])
})

test('统计查询拒绝伪造工作空间、跨班学生和未授权读取', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const denied = createReadingStatisticsDomain({ db: fixture.db, authorize: async () => false })
  await assert.rejects(() => denied.getStudentSummary({
    organizationId: 'org-a', userId: 'student-a', workspaceId: 'class-a-workspace',
  }), { code: 'PERMISSION_DENIED' })

  const allowed = createReadingStatisticsDomain({ db: fixture.db, authorize: async () => true })
  await assert.rejects(() => allowed.getScopedSummary({
    organizationId: 'org-a', userId: 'teacher-a', workspaceId: 'class-a-workspace',
  }, { studentId: 'student-b' }), { code: 'RESOURCE_NOT_FOUND' })
  await assert.rejects(() => allowed.getScopedSummary({
    organizationId: 'org-a', userId: 'teacher-a', workspaceId: 'class-b-workspace',
  }), { code: 'RESOURCE_NOT_FOUND' })
})
