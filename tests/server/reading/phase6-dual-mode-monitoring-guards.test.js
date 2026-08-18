import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { openSqliteDatabase } from '../../../server/db/database.js'
import { runMigrations } from '../../../server/db/migrate.js'
import { grantBookToClass } from '../helpers/phase8-old-fixture.js'
import { createReadingDomain } from '../../../server/domains/reading/catalog.js'
import {
  canonicalReadingSummaryFingerprint,
  createReadingMonitoringDomain,
  readingRetentionCutoff,
  readingStatDateFor,
} from '../../../server/domains/reading/monitoring.js'
import { createReadingStatisticsDomain } from '../../../server/domains/reading/statistics.js'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const migrationDirectory = fileURLToPath(new URL('../../../server/db/migrations/', import.meta.url))
const cleanupScriptPath = path.join(repositoryRoot, 'server/scripts/reading-monitor-cleanup.js')
const BASE_NOW = '2026-08-10T00:00:00.000Z'

function insertOrganization(db, id) {
  db.prepare(`INSERT INTO organizations (id, name, school_code, status, created_at, updated_at, version)
    VALUES (?, ?, ?, 'active', ?, ?, 1)`).run(id, id, id, BASE_NOW, BASE_NOW)
}

function insertUser(db, id, organizationId, displayName = id) {
  db.prepare(`INSERT INTO users
      (id, organization_id, username, display_name, status, created_at, updated_at, version, login_name, account_code)
    VALUES (?, ?, ?, ?, 'active', ?, ?, 1, ?, ?)`)
    .run(id, organizationId, id, displayName, BASE_NOW, BASE_NOW, id, `A-${id}`)
}

function insertClassScope(db, { organizationId, classId, workspaceId, studentIds, teacherId }) {
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
  if (teacherId) {
    db.prepare(`INSERT INTO workspace_memberships
        (id, user_id, workspace_id, status, created_at, updated_at, version)
      VALUES (?, ?, ?, 'active', ?, ?, 1)`)
      .run(`${workspaceId}:${teacherId}`, teacherId, workspaceId, BASE_NOW, BASE_NOW)
    db.prepare(`INSERT INTO role_assignments
        (id, organization_id, user_id, workspace_id, role_code, scope_type, scope_id, status, created_at, updated_at, version)
      VALUES (?, ?, ?, ?, 'teacher', 'class', ?, 'active', ?, ?, 1)`)
      .run(`role:${workspaceId}:${teacherId}`, organizationId, teacherId, workspaceId, classId, BASE_NOW, BASE_NOW)
  }
}

function insertBook(db, { organizationId = 'org-a', actorId = 'student-a', bookId, versionId, status = 'published', pages = 100 }) {
  db.prepare(`INSERT INTO books
      (id, organization_id_at_creation, actor_id_at_creation, title, status, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)`)
    .run(bookId, organizationId, actorId, bookId, status, BASE_NOW, BASE_NOW)
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
  const directory = mkdtempSync(path.join(tmpdir(), 'phase6-guards-domain-'))
  const db = openSqliteDatabase(path.join(directory, 'guards.sqlite'))
  runMigrations(db, migrationDirectory, BASE_NOW)

  insertOrganization(db, 'org-a')
  insertOrganization(db, 'org-b')

  insertUser(db, 'student-a', 'org-a', '学生A')
  insertUser(db, 'student-b', 'org-a', '学生B')
  insertUser(db, 'student-c', 'org-a', '无授权学生C')
  insertUser(db, 'teacher-a', 'org-a', '教师A')
  insertUser(db, 'foreign-student', 'org-b', '外校学生')

  insertClassScope(db, {
    organizationId: 'org-a',
    classId: 'class-a',
    workspaceId: 'workspace-a',
    studentIds: ['student-a'],
    teacherId: 'teacher-a',
  })
  insertClassScope(db, {
    organizationId: 'org-a',
    classId: 'class-b',
    workspaceId: 'workspace-b',
    studentIds: ['student-b'],
  })
  insertClassScope(db, {
    organizationId: 'org-a',
    classId: 'class-c',
    workspaceId: 'workspace-c',
    studentIds: ['student-c'],
  })
  insertClassScope(db, {
    organizationId: 'org-b',
    classId: 'class-foreign',
    workspaceId: 'workspace-foreign',
    studentIds: ['foreign-student'],
  })

  // 书目 1：已发布，grant 给班级 A 和班级 B
  insertBook(db, { bookId: 'book-1', versionId: 'version-1', pages: 50 })
  grantBookToClass(db, { bookId: 'book-1', classId: 'class-a', organizationId: 'org-a', actorId: 'student-a', now: BASE_NOW, bookVersionId: 'version-1' })
  grantBookToClass(db, { bookId: 'book-1', classId: 'class-b', organizationId: 'org-a', actorId: 'student-a', now: BASE_NOW, bookVersionId: 'version-1' })

  // 书目 2：已发布，仅 grant 给班级 A
  insertBook(db, { bookId: 'book-2', versionId: 'version-2', pages: 50 })
  grantBookToClass(db, { bookId: 'book-2', classId: 'class-a', organizationId: 'org-a', actorId: 'student-a', now: BASE_NOW, bookVersionId: 'version-2' })

  // 书目 3：草稿状态 (draft)，未发布
  insertBook(db, { bookId: 'book-3-draft', versionId: 'version-3-draft', status: 'draft', pages: 10 })

  let current = new Date(BASE_NOW)
  let id = 0

  function createScopedDomain(actorId, organizationId = 'org-a', workspaceId = 'workspace-a') {
    const dependencies = {
      db,
      actor: { id: actorId },
      workspace: { id: workspaceId, organizationId },
      authorize: async () => true,
      audit: async () => undefined,
      idFactory: () => `generated-${++id}`,
      now: () => current,
    }
    return {
      reading: createReadingDomain(dependencies),
      monitoring: createReadingMonitoringDomain(dependencies),
      statistics: createReadingStatisticsDomain(dependencies),
      authContext: { organizationId, userId: actorId, workspaceId },
    }
  }

  return {
    db,
    directory,
    setNow(value) { current = new Date(value) },
    getNow() { return current },
    forStudentA() { return createScopedDomain('student-a', 'org-a', 'workspace-a') },
    forStudentB() { return createScopedDomain('student-b', 'org-a', 'workspace-b') },
    forStudentC() { return createScopedDomain('student-c', 'org-a', 'workspace-c') },
    forTeacherA() { return createScopedDomain('teacher-a', 'org-a', 'workspace-a') },
    forForeignStudent() { return createScopedDomain('foreign-student', 'org-b', 'workspace-foreign') },
    close() {
      db.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

function buildSummary(overrides = {}) {
  const cumulativeEffectiveMs = overrides.cumulativeEffectiveMs ?? 60_000
  const half = Math.floor(cumulativeEffectiveMs / 2)
  const defaultPageCoverage = [
    { pageNo: overrides.lastPageNo ?? 2, effectiveOriginalMs: half, effectiveTextMs: cumulativeEffectiveMs - half, confirmedInteractions: 0 },
  ]
  const body = {
    schemaVersion: 2,
    sessionId: 'session-test-1',
    revision: 1,
    leaseId: 'lease-test-1',
    bookVersionId: 'version-1',
    statDate: '2026-08-10',
    startedAt: '2026-08-10T00:00:00.000Z',
    measuredThroughAt: '2026-08-10T00:01:00.000Z',
    cumulativeEffectiveMs,
    hadSkip: false,
    hadReread: false,
    lastPageNo: 2,
    pageCoverage: defaultPageCoverage,
    endedAt: null,
    endReason: null,
    fingerprint: '',
    ...overrides,
  }
  body.fingerprint = canonicalReadingSummaryFingerprint(body)
  return body
}

test('T6.1 模式切换不重复计时：服务端入库页覆盖按 original/text 独立累加，两项之和等于总有效毫秒且日汇总不翻倍', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const studentA = fixture.forStudentA()

  // 1. 获取租约
  const lease = await studentA.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-1' })
  assert.ok(lease.leaseId)

  // 2. 提交 revision 1（第 2 页 original 30s + text 30s = 60s）
  fixture.setNow('2026-08-10T00:01:00.000Z')
  const summaryRev1 = buildSummary({
    leaseId: lease.leaseId,
    cumulativeEffectiveMs: 60_000,
    measuredThroughAt: '2026-08-10T00:01:00.000Z',
    lastPageNo: 2,
    pageCoverage: [
      { pageNo: 2, effectiveOriginalMs: 30_000, effectiveTextMs: 30_000, confirmedInteractions: 0 },
    ],
  })
  const outcome1 = await studentA.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: summaryRev1 })
  assert.equal(outcome1.result, 'accepted')

  // 3. 验证 reading_summary_sessions 表
  const sessionRow = fixture.db.prepare('SELECT * FROM reading_summary_sessions WHERE id = ?').get('session-test-1')
  assert.equal(sessionRow.cumulative_effective_ms, 60_000)
  assert.equal(sessionRow.latest_revision, 1)

  // 4. 验证 reading_summary_page_coverage 表
  const pageCoverageRow = fixture.db.prepare('SELECT * FROM reading_summary_page_coverage WHERE session_id = ? AND page_no = 2')
    .get('session-test-1')
  assert.equal(pageCoverageRow.effective_original_ms, 30_000)
  assert.equal(pageCoverageRow.effective_text_ms, 30_000)
  assert.equal(pageCoverageRow.effective_original_ms + pageCoverageRow.effective_text_ms, 60_000)

  // 5. 验证 reading_page_coverage 累计表
  const aggregateCoverageRow = fixture.db.prepare(`SELECT * FROM reading_page_coverage
    WHERE actor_id_at_creation = 'student-a' AND book_version_id = 'version-1' AND page_no = 2`).get()
  assert.equal(aggregateCoverageRow.effective_original_ms, 30_000)
  assert.equal(aggregateCoverageRow.effective_text_ms, 30_000)

  // 6. 验证 reading_daily_book_summaries 日汇总时长等于 60s（无翻倍、无跳变）
  const dailyRow = fixture.db.prepare(`SELECT * FROM reading_daily_book_summaries
    WHERE actor_id_at_creation = 'student-a' AND book_version_id = 'version-1' AND stat_date = '2026-08-10'`).get()
  assert.equal(dailyRow.effective_reading_ms, 60_000)

  // 7. 提交 revision 2（继续阅读 15s original，总计 75s）
  fixture.setNow('2026-08-10T00:01:20.000Z')
  const summaryRev2 = buildSummary({
    leaseId: lease.leaseId,
    revision: 2,
    cumulativeEffectiveMs: 75_000,
    measuredThroughAt: '2026-08-10T00:01:20.000Z',
    lastPageNo: 2,
    pageCoverage: [
      { pageNo: 2, effectiveOriginalMs: 45_000, effectiveTextMs: 30_000, confirmedInteractions: 0 },
    ],
  })
  const outcome2 = await studentA.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: summaryRev2 })
  assert.equal(outcome2.result, 'accepted')

  // 验证日汇总时长严格累加 15s 增量，总计 75s
  const dailyRow2 = fixture.db.prepare(`SELECT * FROM reading_daily_book_summaries
    WHERE actor_id_at_creation = 'student-a' AND book_version_id = 'version-1' AND stat_date = '2026-08-10'`).get()
  assert.equal(dailyRow2.effective_reading_ms, 75_000)
})

test('T6.2 切换不丢会话：连续 revision 严格校验，跳号抛出 REVISION_GAP，数据倒退抛出 SUMMARY_REGRESSION', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const studentA = fixture.forStudentA()

  const lease = await studentA.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-1' })

  // 1. 提交 revision 1 成功
  fixture.setNow('2026-08-10T00:01:00.000Z')
  const rev1 = buildSummary({
    sessionId: 'session-gap-test',
    leaseId: lease.leaseId,
    revision: 1,
    cumulativeEffectiveMs: 30_000,
    measuredThroughAt: '2026-08-10T00:01:00.000Z',
    pageCoverage: [{ pageNo: 1, effectiveOriginalMs: 30_000, effectiveTextMs: 0, confirmedInteractions: 0 }],
  })
  const outcome1 = await studentA.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: rev1 })
  assert.equal(outcome1.result, 'accepted')

  // 2. 尝试跳过 revision 2 直接发送 revision 3 -> 拒绝 REVISION_GAP
  const rev3Gap = buildSummary({
    sessionId: 'session-gap-test',
    leaseId: lease.leaseId,
    revision: 3,
    cumulativeEffectiveMs: 60_000,
    measuredThroughAt: '2026-08-10T00:01:20.000Z',
    pageCoverage: [{ pageNo: 1, effectiveOriginalMs: 60_000, effectiveTextMs: 0, confirmedInteractions: 0 }],
  })
  await assert.rejects(
    () => studentA.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: rev3Gap }),
    (error) => error.code === 'REVISION_GAP',
    '跳过 revision 必须抛出 REVISION_GAP',
  )

  // 3. 发送合法的 revision 2 -> 成功 accepted
  const rev2 = buildSummary({
    sessionId: 'session-gap-test',
    leaseId: lease.leaseId,
    revision: 2,
    cumulativeEffectiveMs: 50_000,
    measuredThroughAt: '2026-08-10T00:01:20.000Z',
    pageCoverage: [{ pageNo: 1, effectiveOriginalMs: 30_000, effectiveTextMs: 20_000, confirmedInteractions: 0 }],
  })
  const outcome2 = await studentA.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: rev2 })
  assert.equal(outcome2.result, 'accepted')

  // 4. 尝试发送 revision 3 但 cumulativeEffectiveMs 倒退 -> 拒绝 SUMMARY_REGRESSION
  const rev3Regress = buildSummary({
    sessionId: 'session-gap-test',
    leaseId: lease.leaseId,
    revision: 3,
    cumulativeEffectiveMs: 40_000,
    measuredThroughAt: '2026-08-10T00:01:25.000Z',
    pageCoverage: [{ pageNo: 1, effectiveOriginalMs: 20_000, effectiveTextMs: 20_000, confirmedInteractions: 0 }],
  })
  await assert.rejects(
    () => studentA.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: rev3Regress }),
    (error) => error.code === 'SUMMARY_REGRESSION',
    '累计时长或页覆盖倒退必须抛出 SUMMARY_REGRESSION',
  )
})

test('T6.3 可见性与生命周期：终态摘要正确将 session 置为 closed，进度更新至 reading_progress 且重登后可恢复', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const studentA = fixture.forStudentA()

  const lease = await studentA.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-1' })

  // 1. 发送带有 reader_close 的终态摘要 (在 60s 内)
  fixture.setNow('2026-08-10T00:01:00.000Z')
  const finalSummary = buildSummary({
    sessionId: 'session-lifecycle-1',
    leaseId: lease.leaseId,
    revision: 1,
    cumulativeEffectiveMs: 45_000,
    lastPageNo: 8,
    measuredThroughAt: '2026-08-10T00:01:00.000Z',
    endedAt: '2026-08-10T00:01:00.000Z',
    endReason: 'reader_close',
    pageCoverage: [{ pageNo: 8, effectiveOriginalMs: 45_000, effectiveTextMs: 0, confirmedInteractions: 1 }],
  })
  const outcome = await studentA.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: finalSummary })
  assert.equal(outcome.result, 'accepted')

  // 2. 验证会话变为 closed 态
  const sessionRow = fixture.db.prepare('SELECT * FROM reading_summary_sessions WHERE id = ?').get('session-lifecycle-1')
  assert.equal(sessionRow.status, 'closed')
  assert.equal(sessionRow.ended_at, '2026-08-10T00:01:00.000Z')
  assert.equal(sessionRow.end_reason, 'reader_close')

  // 3. 验证 reading_progress 记录了关闭前的阅读位置 (last_page_no = 8)
  const progressRow = fixture.db.prepare(`SELECT * FROM reading_progress
    WHERE actor_id = 'student-a' AND book_version_id = 'version-1'`).get()
  assert.equal(progressRow.last_page_no, 8)

  // 4. 模拟学生重登后开启新会话（使用新租约与新 session_id）
  fixture.setNow('2026-08-10T00:05:00.000Z')
  const newLease = await studentA.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-1' })
  fixture.setNow('2026-08-10T00:05:30.000Z')
  const newSessionSummary = buildSummary({
    sessionId: 'session-lifecycle-2',
    leaseId: newLease.leaseId,
    revision: 1,
    startedAt: '2026-08-10T00:05:00.000Z',
    measuredThroughAt: '2026-08-10T00:05:30.000Z',
    cumulativeEffectiveMs: 30_000,
    lastPageNo: 9,
    pageCoverage: [{ pageNo: 9, effectiveOriginalMs: 0, effectiveTextMs: 30_000, confirmedInteractions: 0 }],
  })
  const newOutcome = await studentA.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: newSessionSummary })
  assert.equal(newOutcome.result, 'accepted')

  // 验证进度更新为 page 9，总时长等于 45s + 30s = 75s
  const updatedProgress = fixture.db.prepare(`SELECT * FROM reading_progress
    WHERE actor_id = 'student-a' AND book_version_id = 'version-1'`).get()
  assert.equal(updatedProgress.last_page_no, 9)

  const dailyTotal = fixture.db.prepare(`SELECT effective_reading_ms FROM reading_daily_book_summaries
    WHERE actor_id_at_creation = 'student-a' AND book_version_id = 'version-1' AND stat_date = '2026-08-10'`).get()
  assert.equal(dailyTotal.effective_reading_ms, 75_000)
})

test('T6.4 幂等性：已提交的相同 revision 与指纹返回 replayed/superseded，日汇总与页覆盖毫秒不重复累加', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const studentA = fixture.forStudentA()

  const lease = await studentA.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-1' })

  // 1. 首次提交 revision 1
  fixture.setNow('2026-08-10T00:00:30.000Z')
  const summaryRev1 = buildSummary({
    sessionId: 'session-idempotency',
    leaseId: lease.leaseId,
    revision: 1,
    cumulativeEffectiveMs: 30_000,
    measuredThroughAt: '2026-08-10T00:00:30.000Z',
    pageCoverage: [{ pageNo: 1, effectiveOriginalMs: 15_000, effectiveTextMs: 15_000, confirmedInteractions: 0 }],
  })
  const outcome1 = await studentA.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: summaryRev1 })
  assert.equal(outcome1.result, 'accepted')

  // 2. 再次重放完全相同的 revision 1 -> 返回 replayed
  const replayOutcome = await studentA.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: summaryRev1 })
  assert.equal(replayOutcome.result, 'replayed')

  // 断言日汇总时长仍为 30,000 ms，没有重复累加
  let dailyRow = fixture.db.prepare(`SELECT effective_reading_ms FROM reading_daily_book_summaries
    WHERE actor_id_at_creation = 'student-a' AND book_version_id = 'version-1' AND stat_date = '2026-08-10'`).get()
  assert.equal(dailyRow.effective_reading_ms, 30_000)

  // 3. 提交 revision 2 -> 返回 accepted
  fixture.setNow('2026-08-10T00:01:00.000Z')
  const summaryRev2 = buildSummary({
    sessionId: 'session-idempotency',
    leaseId: lease.leaseId,
    revision: 2,
    cumulativeEffectiveMs: 60_000,
    measuredThroughAt: '2026-08-10T00:01:00.000Z',
    pageCoverage: [{ pageNo: 1, effectiveOriginalMs: 30_000, effectiveTextMs: 30_000, confirmedInteractions: 0 }],
  })
  const outcome2 = await studentA.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: summaryRev2 })
  assert.equal(outcome2.result, 'accepted')

  // 4. 重放旧的 revision 1 -> 返回 superseded
  const supersededOutcome = await studentA.monitoring.acceptSessionSummary({ deviceId: 'device-a', body: summaryRev1 })
  assert.equal(supersededOutcome.result, 'superseded')

  // 断言日汇总时长仍为 60,000 ms
  dailyRow = fixture.db.prepare(`SELECT effective_reading_ms FROM reading_daily_book_summaries
    WHERE actor_id_at_creation = 'student-a' AND book_version_id = 'version-1' AND stat_date = '2026-08-10'`).get()
  assert.equal(dailyRow.effective_reading_ms, 60_000)
})

test('T6.5 数据归属与 Phase 8 D-23 权限：跨学生、跨书目数据完全隔离，未授权/草稿/跨组织访问严格拒绝 404', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const studentA = fixture.forStudentA()
  const studentB = fixture.forStudentB()
  const studentC = fixture.forStudentC()
  const foreignStudent = fixture.forForeignStudent()

  // 1. 学生 A 阅读书目 1
  fixture.setNow('2026-08-10T00:00:00.000Z')
  const leaseA1 = await studentA.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-1' })
  fixture.setNow('2026-08-10T00:00:40.000Z')
  await studentA.monitoring.acceptSessionSummary({
    deviceId: 'device-a',
    body: buildSummary({
      sessionId: 'session-a-book1',
      leaseId: leaseA1.leaseId,
      bookVersionId: 'version-1',
      startedAt: '2026-08-10T00:00:00.000Z',
      measuredThroughAt: '2026-08-10T00:00:40.000Z',
      cumulativeEffectiveMs: 40_000,
      pageCoverage: [{ pageNo: 1, effectiveOriginalMs: 20_000, effectiveTextMs: 20_000, confirmedInteractions: 0 }],
    }),
  })

  // 2. 学生 A 阅读书目 2（新租约、新 session）
  fixture.setNow('2026-08-10T00:01:00.000Z')
  const leaseA2 = await studentA.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-2' })
  assert.notEqual(leaseA2.leaseId, leaseA1.leaseId, '换书必须生成新租约')
  fixture.setNow('2026-08-10T00:01:50.000Z')
  await studentA.monitoring.acceptSessionSummary({
    deviceId: 'device-a',
    body: buildSummary({
      sessionId: 'session-a-book2',
      leaseId: leaseA2.leaseId,
      bookVersionId: 'version-2',
      startedAt: '2026-08-10T00:01:00.000Z',
      measuredThroughAt: '2026-08-10T00:01:50.000Z',
      cumulativeEffectiveMs: 50_000,
      pageCoverage: [{ pageNo: 1, effectiveOriginalMs: 25_000, effectiveTextMs: 25_000, confirmedInteractions: 0 }],
    }),
  })

  // 3. 学生 B 阅读书目 1
  fixture.setNow('2026-08-10T00:00:00.000Z')
  const leaseB1 = await studentB.reading.acquireLease({ deviceId: 'device-b', bookVersionId: 'version-1' })
  fixture.setNow('2026-08-10T00:00:30.000Z')
  await studentB.monitoring.acceptSessionSummary({
    deviceId: 'device-b',
    body: buildSummary({
      sessionId: 'session-b-book1',
      leaseId: leaseB1.leaseId,
      bookVersionId: 'version-1',
      startedAt: '2026-08-10T00:00:00.000Z',
      measuredThroughAt: '2026-08-10T00:00:30.000Z',
      cumulativeEffectiveMs: 30_000,
      pageCoverage: [{ pageNo: 1, effectiveOriginalMs: 15_000, effectiveTextMs: 15_000, confirmedInteractions: 0 }],
    }),
  })

  // 验证数据隔离：学生 A 与学生 B 的汇总独立存在
  const summaryA1 = fixture.db.prepare(`SELECT effective_reading_ms FROM reading_daily_book_summaries
    WHERE actor_id_at_creation = 'student-a' AND book_version_id = 'version-1'`).get()
  const summaryA2 = fixture.db.prepare(`SELECT effective_reading_ms FROM reading_daily_book_summaries
    WHERE actor_id_at_creation = 'student-a' AND book_version_id = 'version-2'`).get()
  const summaryB1 = fixture.db.prepare(`SELECT effective_reading_ms FROM reading_daily_book_summaries
    WHERE actor_id_at_creation = 'student-b' AND book_version_id = 'version-1'`).get()

  assert.equal(summaryA1.effective_reading_ms, 40_000)
  assert.equal(summaryA2.effective_reading_ms, 50_000)
  assert.equal(summaryB1.effective_reading_ms, 30_000)

  // 4. D-23 权限门禁：
  // 4.1 学生 B 尝试访问未对其班级授权的书目 2 -> 拒绝 404 (RESOURCE_NOT_FOUND)
  await assert.rejects(
    () => studentB.reading.acquireLease({ deviceId: 'device-b', bookVersionId: 'version-2' }),
    (error) => error.code === 'RESOURCE_NOT_FOUND',
    '班级未获得 grant 的图书必须返回 RESOURCE_NOT_FOUND',
  )

  // 4.2 学生 C 所在班级无任何 grant -> 访问书目 1 拒绝 404
  await assert.rejects(
    () => studentC.reading.acquireLease({ deviceId: 'device-c', bookVersionId: 'version-1' }),
    (error) => error.code === 'RESOURCE_NOT_FOUND',
    '无 grant 班级学生必须返回 RESOURCE_NOT_FOUND',
  )

  // 4.3 访问未发布草稿书目 3 -> 拒绝 404
  await assert.rejects(
    () => studentA.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-3-draft' }),
    (error) => error.code === 'RESOURCE_NOT_FOUND',
    '草稿图书必须返回 RESOURCE_NOT_FOUND',
  )

  // 4.4 外校学生访问组织 A 书籍 -> 拒绝 404
  await assert.rejects(
    () => foreignStudent.reading.acquireLease({ deviceId: 'device-foreign', bookVersionId: 'version-1' }),
    (error) => error.code === 'RESOURCE_NOT_FOUND',
    '外部组织学生必须返回 RESOURCE_NOT_FOUND',
  )
})

test('T6.6 统计与简报：阅读满 300s 后 checkIn.checked 从 false 变为 true，教师端 scope 正确统计打卡学生与人均时长', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const studentA = fixture.forStudentA()
  const teacherA = fixture.forTeacherA()

  // 00:00:00 获取租约 (TTL 90s, 到 00:01:30)
  const lease = await studentA.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-1' })

  // 1. 模拟每 60s 续租，持续阅读到 290 秒 (00:04:50)
  const renewTimes = ['00:01:00.000Z', '00:02:00.000Z', '00:03:00.000Z', '00:04:00.000Z']
  for (const timeStr of renewTimes) {
    fixture.setNow(`2026-08-10T${timeStr}`)
    await studentA.monitoring.renewLease({
      leaseId: lease.leaseId,
      deviceId: 'device-a',
      body: { schemaVersion: 1, bookVersionId: 'version-1' },
    })
  }

  // 在 00:04:50 提交 290 秒阅读摘要（未满 300 秒打卡线）
  fixture.setNow('2026-08-10T00:04:50.000Z')
  await studentA.monitoring.acceptSessionSummary({
    deviceId: 'device-a',
    body: buildSummary({
      sessionId: 'session-goal-test',
      leaseId: lease.leaseId,
      revision: 1,
      cumulativeEffectiveMs: 290_000,
      measuredThroughAt: '2026-08-10T00:04:50.000Z',
      pageCoverage: [{ pageNo: 1, effectiveOriginalMs: 145_000, effectiveTextMs: 145_000, confirmedInteractions: 0 }],
    }),
  })

  // 学生查看个人简报 /self
  const selfStatsBefore = await studentA.statistics.getStudentSummary(studentA.authContext)
  assert.equal(selfStatsBefore.todayEffectiveReadingSeconds, 290)
  assert.equal(selfStatsBefore.checkIn.checked, false, '未满 300 秒时 checked 必须为 false')
  assert.equal(selfStatsBefore.checkIn.remainingSeconds, 10)

  // 2. 继续阅读 15 秒（总累计达到 305 秒，突破 300 秒打卡标准）
  fixture.setNow('2026-08-10T00:05:05.000Z')
  await studentA.monitoring.acceptSessionSummary({
    deviceId: 'device-a',
    body: buildSummary({
      sessionId: 'session-goal-test',
      leaseId: lease.leaseId,
      revision: 2,
      cumulativeEffectiveMs: 305_000,
      measuredThroughAt: '2026-08-10T00:05:05.000Z',
      pageCoverage: [{ pageNo: 1, effectiveOriginalMs: 155_000, effectiveTextMs: 150_000, confirmedInteractions: 0 }],
    }),
  })

  // 学生再次查看个人简报 /self
  const selfStatsAfter = await studentA.statistics.getStudentSummary(studentA.authContext)
  assert.equal(selfStatsAfter.todayEffectiveReadingSeconds, 305)
  assert.equal(selfStatsAfter.checkIn.checked, true, '达到 300 秒时 checked 必须变为 true')
  assert.equal(selfStatsAfter.checkIn.remainingSeconds, 0)
  assert.equal(selfStatsAfter.streakDays, 1)

  // 3. 教师端查看班级统计 /scope
  const scopeStats = await teacherA.statistics.getScopedSummary(teacherA.authContext, {
    classId: 'class-a',
    statDate: '2026-08-10',
  })
  assert.equal(scopeStats.class.classId, 'class-a')
  assert.equal(scopeStats.class.activeStudentCount, 1)
  assert.equal(scopeStats.summary.checkedInStudentCount, 1)
  assert.equal(scopeStats.summary.checkInRateBasisPoints, 10_000) // 100.00%
  assert.equal(scopeStats.summary.totalEffectiveReadingSeconds, 305)
  assert.equal(scopeStats.summary.perCapitaEffectiveReadingSeconds, 305)

  // 验证学生列表中包含该学生且打卡状态为 true
  const studentItem = scopeStats.students.find((item) => item.studentId === 'student-a')
  assert.ok(studentItem)
  assert.equal(studentItem.checkedIn, true)
  assert.equal(studentItem.todayEffectiveReadingSeconds, 305)
})

test('T6.7 旧事件不计时：POST /reading/events/batch 仅写入 reading_events，有效阅读秒数恒为 0 且不污染每日汇总与简报', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const studentA = fixture.forStudentA()

  // 1. 获取租约建立设备与租约历史
  await studentA.reading.acquireLease({ deviceId: 'device-a', bookVersionId: 'version-1' })

  // 2. 发送旧事件流批次 (含 page_stay 120秒 与 page_turn)
  fixture.setNow('2026-08-10T00:01:00.000Z')
  const batchResult = await studentA.reading.ingestEventsBatch({
    events: [
      {
        id: 'event-stay-1',
        schemaVersion: 1,
        deviceId: 'device-a',
        bookVersionId: 'version-1',
        pageNo: 1,
        eventType: 'page_stay',
        clientOccurredAt: '2026-08-10T00:00:30.000Z',
        durationMs: 120_000,
        foreground: true,
        screenOn: true,
        offlineSequence: 1,
        payload: { blockId: 'p1' },
      },
      {
        id: 'event-turn-1',
        schemaVersion: 1,
        deviceId: 'device-a',
        bookVersionId: 'version-1',
        pageNo: 1,
        eventType: 'page_turn',
        clientOccurredAt: '2026-08-10T00:00:50.000Z',
        durationMs: 0,
        foreground: true,
        screenOn: true,
        offlineSequence: 2,
        payload: { fromPageNo: 1, direction: 'next' },
      },
    ],
  })
  assert.deepEqual(batchResult.accepted, ['event-stay-1', 'event-turn-1'])

  // 3. 验证 reading_events 表中写入的 valid_reading_seconds 恒为 0
  const eventRows = fixture.db.prepare('SELECT id, valid_reading_seconds, valid_eye_seconds FROM reading_events').all()
  assert.equal(eventRows.length, 2)
  for (const row of eventRows) {
    assert.equal(row.valid_reading_seconds, 0, '旧事件的有效阅读秒数必须恒为 0')
  }

  // 4. 验证 reading_daily_book_summaries 与 reading_summary_sessions 表中无任何有效阅读时长
  const dailyCount = fixture.db.prepare('SELECT COUNT(*) AS count FROM reading_daily_book_summaries').get().count
  const sessionCount = fixture.db.prepare('SELECT COUNT(*) AS count FROM reading_summary_sessions').get().count
  assert.equal(dailyCount, 0, '旧事件不得写入日汇总表')
  assert.equal(sessionCount, 0, '旧事件不得写入会话摘要表')

  // 5. 验证个人简报中今日有效阅读秒数仍为 0，打卡未达成
  const selfStats = await studentA.statistics.getStudentSummary(studentA.authContext)
  assert.equal(selfStats.todayEffectiveReadingSeconds, 0)
  assert.equal(selfStats.checkIn.checked, false)
})

test('T6.8 清理脚本：reading-monitor-cleanup 严格基于 6 个月 cutoff 清理 closed 会话、关闭历史 open 会话，上报异常且幂等', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'phase6-cleanup-domain-'))
  const databasePath = path.join(directory, 'cleanup.sqlite')
  t.after(() => rmSync(directory, { recursive: true, force: true }))

  const db = openSqliteDatabase(databasePath)
  runMigrations(db, migrationDirectory, BASE_NOW)

  const testNow = '2026-08-10T00:00:00.000Z'
  const cutoff = readingRetentionCutoff(testNow).toISOString() // 2026-02-10T00:00:00.000Z
  const beforeCutoff = '2026-02-09T23:59:59.999Z'
  const afterCutoff = '2026-03-01T00:00:00.000Z'

  insertOrganization(db, 'cleanup-org')
  insertUser(db, 'clean-student-1', 'cleanup-org')
  insertUser(db, 'clean-student-2', 'cleanup-org')
  insertUser(db, 'clean-student-3', 'cleanup-org')
  insertClassScope(db, {
    organizationId: 'cleanup-org',
    classId: 'clean-class',
    workspaceId: 'clean-workspace',
    studentIds: ['clean-student-1', 'clean-student-2', 'clean-student-3'],
  })
  insertBook(db, { organizationId: 'cleanup-org', actorId: 'clean-student-1', bookId: 'clean-book', versionId: 'clean-version' })

  function insertCleanupSession({ id, actorId, leaseId, startedAt, endedAt = null, endReason = null, status = 'open' }) {
    const fingerprint = id.padEnd(64, 'f').slice(0, 64).replaceAll(/[^0-9a-f]/g, 'f')
    db.prepare(`INSERT INTO reading_summary_sessions (
        id, organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation,
        class_id_at_creation, device_id, book_version_id, lease_id_at_start, stat_date,
        started_at, latest_revision, latest_fingerprint, revision_fingerprints_json,
        cumulative_effective_ms, had_skip, had_reread, last_page_no, measured_through_at,
        ended_at, end_reason, status, created_at, updated_at, version
      ) VALUES (
        ?, 'cleanup-org', ?, 'clean-workspace', 'clean-class', 'clean-device',
        'clean-version', ?, '2026-01-01', ?, 1, ?, ?, 0, 0, 0, 1, ?, ?, ?, ?, ?, ?, 1
      )`).run(
      id, actorId, leaseId, startedAt, fingerprint, JSON.stringify({ 1: fingerprint }),
      startedAt, endedAt, endReason, status, startedAt, startedAt,
    )
  }

  // 1. 7个月前 closed 会话（应被删除）
  insertCleanupSession({
    id: 'old-closed-session',
    actorId: 'clean-student-1',
    leaseId: 'lease-old-closed',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: beforeCutoff,
    endReason: 'reader_close',
    status: 'closed',
  })

  // 2. 恰好等于 cutoff 的 closed 会话（应保留）
  insertCleanupSession({
    id: 'exact-cutoff-session',
    actorId: 'clean-student-1',
    leaseId: 'lease-exact-cutoff',
    startedAt: cutoff,
    endedAt: cutoff,
    endReason: 'reader_close',
    status: 'closed',
  })

  // 3. 1个月前 closed 会话（应保留）
  insertCleanupSession({
    id: 'recent-closed-session',
    actorId: 'clean-student-1',
    leaseId: 'lease-recent-closed',
    startedAt: afterCutoff,
    endedAt: afterCutoff,
    endReason: 'reader_close',
    status: 'closed',
  })

  // 4. 7个月前 open 会话，但其对应租约已在 cutoff 前权威结束（应先被关闭，再被删除）
  insertCleanupSession({
    id: 'old-open-with-lease-ended',
    actorId: 'clean-student-2',
    leaseId: 'lease-ended-history',
    startedAt: '2026-01-01T00:00:00.000Z',
    status: 'open',
  })
  db.prepare(`INSERT INTO reading_device_lease_history (
      id, lease_id, organization_id, workspace_id, actor_id, device_id, book_version_id,
      valid_from, valid_until, created_at, updated_at, version, end_reason
    ) VALUES ('hist-ended', 'lease-ended-history', 'cleanup-org', 'clean-workspace',
      'clean-student-2', 'clean-device', 'clean-version', '2026-01-01T00:00:00.000Z',
      ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1, 'lease_ended')`).run(beforeCutoff)

  // 5. 7个月前 open 会话，租约无结束记录（异常会话，保留在 DB 并上报）
  insertCleanupSession({
    id: 'anomalous-open-session',
    actorId: 'clean-student-3',
    leaseId: 'lease-unended-history',
    startedAt: '2026-01-01T00:00:00.000Z',
    status: 'open',
  })

  db.close()

  // 首次运行清理脚本（通过 CLI 执行验证退出码与输出格式）
  const firstRun = spawnSync(process.execPath, [
    cleanupScriptPath,
    '--database', databasePath,
    '--now', testNow,
  ], { cwd: repositoryRoot, encoding: 'utf8' })

  assert.equal(firstRun.status, 0, firstRun.stderr)
  const firstResult = JSON.parse(firstRun.stdout)
  assert.deepEqual(firstResult, {
    cutoff,
    closedCount: 1,
    deletedCount: 2,
    anomalousOpenSessionIds: ['anomalous-open-session'],
  })

  // 检查数据库
  const checkDb = openSqliteDatabase(databasePath)
  const remainingIds = checkDb.prepare('SELECT id FROM reading_summary_sessions ORDER BY id').all().map((r) => r.id)
  assert.deepEqual(remainingIds, ['anomalous-open-session', 'exact-cutoff-session', 'recent-closed-session'])
  checkDb.close()

  // 再次运行清理脚本验证幂等性
  const secondRun = spawnSync(process.execPath, [
    cleanupScriptPath,
    '--database', databasePath,
    '--now', testNow,
  ], { cwd: repositoryRoot, encoding: 'utf8' })

  assert.equal(secondRun.status, 0, secondRun.stderr)
  const secondResult = JSON.parse(secondRun.stdout)
  assert.deepEqual(secondResult, {
    cutoff,
    closedCount: 0,
    deletedCount: 0,
    anomalousOpenSessionIds: ['anomalous-open-session'],
  })
})
