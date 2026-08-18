import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { openSqliteDatabase } from '../../../server/db/database.js'
import { runMigrations } from '../../../server/db/migrate.js'
import { grantBookToClass } from '../helpers/phase8-old-fixture.js'
import {
  createReadingStatisticsDomain,
  deriveClassReadingMetrics,
  fillReadingSevenDays,
  isReadingCheckIn,
  readingComparisonState,
  readingLastCompleteWeekDates,
  readingSevenStatDates,
  readingStreakDays,
} from '../../../server/domains/reading/statistics.js'

const NOW = '2026-08-10T09:00:00.000Z'
const migrationDirectory = fileURLToPath(new URL('../../../server/db/migrations/', import.meta.url))

function insertOrganization(db, id) {
  db.prepare(`INSERT INTO organizations (id, name, school_code, status, created_at, updated_at, version)
    VALUES (?, ?, ?, 'active', ?, ?, 1)`).run(id, id, id, NOW, NOW)
}

function insertUser(db, { id, organizationId, displayName = id }) {
  db.prepare(`INSERT INTO users
      (id, organization_id, username, display_name, status, created_at, updated_at, version, login_name, account_code)
    VALUES (?, ?, ?, ?, 'active', ?, ?, 1, ?, ?)`)
    .run(id, organizationId, id, displayName, NOW, NOW, id, `A-${id}`)
}

function insertClass(db, { id, organizationId, gradeId = 'grade-a' }) {
  db.prepare(`INSERT INTO classes
      (id, organization_id, grade_id, name, status, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, 'active', ?, ?, 1)`)
    .run(id, organizationId, gradeId, `${id} name`, NOW, NOW)
}

function insertWorkspace(db, { id, organizationId, code, scopeType, scopeId }) {
  db.prepare(`INSERT INTO workspaces
      (id, organization_id, code, name, scope_type, scope_id, status, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1)`)
    .run(id, organizationId, code, id, scopeType, scopeId, NOW, NOW)
}

function insertWorkspaceMembership(db, userId, workspaceId) {
  db.prepare(`INSERT INTO workspace_memberships
      (id, user_id, workspace_id, status, created_at, updated_at, version)
    VALUES (?, ?, ?, 'active', ?, ?, 1)`)
    .run(`${workspaceId}:${userId}`, userId, workspaceId, NOW, NOW)
}

function insertClassMembership(db, classId, userId, role = 'student') {
  db.prepare(`INSERT INTO class_memberships
      (id, class_id, user_id, membership_role, status, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, 'active', ?, ?, 1)`)
    .run(`${classId}:${userId}`, classId, userId, role, NOW, NOW)
}

function insertRole(db, { id, organizationId, userId, workspaceId, roleCode, scopeType, scopeId }) {
  db.prepare(`INSERT INTO role_assignments
      (id, organization_id, user_id, workspace_id, role_code, scope_type, scope_id,
       status, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 1)`)
    .run(id, organizationId, userId, workspaceId, roleCode, scopeType, scopeId, NOW, NOW)
}

function insertBook(db, { organizationId, actorId, bookId, versionId, title, pageCount = 100 }) {
  db.prepare(`INSERT INTO books
      (id, organization_id_at_creation, actor_id_at_creation, title, status, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, 'published', ?, ?, 1)`)
    .run(bookId, organizationId, actorId, title, NOW, NOW)
  db.prepare(`INSERT INTO book_versions
      (id, book_id, organization_id_at_creation, actor_id_at_creation, label,
       source_format, page_count, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, 'v1', 'text', ?, ?, ?, 1)`)
    .run(versionId, bookId, organizationId, actorId, pageCount, NOW, NOW)
}

let dailyId = 0
function insertDaily(db, input) {
  const row = {
    organizationId: 'org-a',
    actorId: 'student-01',
    workspaceId: 'student-workspace-a',
    classId: 'class-a',
    bookVersionId: 'version-a',
    statDate: '2026-08-10',
    effectiveMs: 0,
    hadSkip: 0,
    hadReread: 0,
    lastReadAt: `${input.statDate || '2026-08-10'}T08:00:00.000Z`,
    lastPageNo: 2,
    updatedAt: NOW,
    ...input,
  }
  db.prepare(`INSERT INTO reading_daily_book_summaries (
      id, organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation,
      class_id_at_creation, book_version_id, stat_date, effective_reading_ms,
      had_skip, had_reread, last_read_at, last_page_no, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
    .run(
      `daily-${++dailyId}`,
      row.organizationId,
      row.actorId,
      row.workspaceId,
      row.classId,
      row.bookVersionId,
      row.statDate,
      row.effectiveMs,
      row.hadSkip,
      row.hadReread,
      row.lastReadAt,
      row.lastPageNo,
      row.updatedAt,
      row.updatedAt,
    )
}

function createFixture({ studentCount = 3 } = {}) {
  dailyId = 0
  const directory = mkdtempSync(path.join(tmpdir(), 'reading-monitor-statistics-'))
  const db = openSqliteDatabase(path.join(directory, 'statistics.sqlite'))
  runMigrations(db, migrationDirectory, NOW)
  insertOrganization(db, 'org-a')
  insertOrganization(db, 'org-b')
  insertClass(db, { id: 'class-a', organizationId: 'org-a' })
  insertClass(db, { id: 'class-empty', organizationId: 'org-a' })
  insertClass(db, { id: 'class-other-a', organizationId: 'org-a' })
  insertClass(db, { id: 'class-b', organizationId: 'org-b', gradeId: 'grade-b' })
  insertWorkspace(db, {
    id: 'student-workspace-a', organizationId: 'org-a', code: 'class-teacher', scopeType: 'class', scopeId: 'class-a',
  })
  insertWorkspace(db, {
    id: 'school-workspace-a', organizationId: 'org-a', code: 'school-admin', scopeType: 'school', scopeId: 'org-a',
  })
  insertWorkspace(db, {
    id: 'student-workspace-b', organizationId: 'org-b', code: 'class-teacher', scopeType: 'class', scopeId: 'class-b',
  })
  insertUser(db, { id: 'teacher-a', organizationId: 'org-a', displayName: 'Teacher' })
  insertUser(db, { id: 'admin-a', organizationId: 'org-a', displayName: 'Admin' })
  insertUser(db, { id: 'student-b', organizationId: 'org-b', displayName: 'B Student' })
  insertWorkspaceMembership(db, 'teacher-a', 'student-workspace-a')
  insertWorkspaceMembership(db, 'admin-a', 'school-workspace-a')
  insertWorkspaceMembership(db, 'student-b', 'student-workspace-b')
  insertClassMembership(db, 'class-a', 'teacher-a', 'teacher')
  insertClassMembership(db, 'class-b', 'student-b')
  insertRole(db, {
    id: 'teacher-role', organizationId: 'org-a', userId: 'teacher-a', workspaceId: 'student-workspace-a',
    roleCode: 'teacher', scopeType: 'class', scopeId: 'class-a',
  })
  insertRole(db, {
    id: 'admin-role', organizationId: 'org-a', userId: 'admin-a', workspaceId: 'school-workspace-a',
    roleCode: 'school_admin', scopeType: 'school', scopeId: 'org-a',
  })
  for (let index = 1; index <= studentCount; index += 1) {
    const id = `student-${String(index).padStart(2, '0')}`
    const displayName = index % 2 === 0 ? ` 王 ${String(index).padStart(2, '0')}` : `李${String(index).padStart(2, '0')}`
    insertUser(db, { id, organizationId: 'org-a', displayName })
    insertWorkspaceMembership(db, id, 'student-workspace-a')
    insertClassMembership(db, 'class-a', id)
  }
  insertBook(db, {
    organizationId: 'org-a', actorId: 'admin-a', bookId: 'book-a', versionId: 'version-a', title: '真实书籍 A', pageCount: 120,
  })
  insertBook(db, {
    organizationId: 'org-a', actorId: 'admin-a', bookId: 'book-a2', versionId: 'version-a2', title: '真实书籍 A2', pageCount: 80,
  })
  insertBook(db, {
    organizationId: 'org-b', actorId: 'student-b', bookId: 'book-b', versionId: 'version-b', title: 'B Book',
  })
  grantBookToClass(db, { bookId: 'book-a', classId: 'class-a', organizationId: 'org-a', actorId: 'admin-a', now: NOW, bookVersionId: 'version-a' })
  grantBookToClass(db, { bookId: 'book-a2', classId: 'class-a', organizationId: 'org-a', actorId: 'admin-a', now: NOW, bookVersionId: 'version-a2' })
  grantBookToClass(db, { bookId: 'book-b', classId: 'class-b', organizationId: 'org-b', actorId: 'student-b', now: NOW, bookVersionId: 'version-b' })
  return {
    db,
    domain: createReadingStatisticsDomain({
      db,
      now: () => new Date(NOW),
      authorize: async ({ action }) => ['reading.read_self', 'reading.read_scope'].includes(action),
      audit: async () => undefined,
    }),
    close() {
      db.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('打卡、正负 10%、连续天数、上周和七日补零纯函数固定边界', () => {
  assert.equal(isReadingCheckIn(299_999), false)
  assert.equal(isReadingCheckIn(300_000), true)
  assert.equal(readingComparisonState(0, 0), 'no_baseline')
  assert.equal(readingComparisonState(899, 7_000), 'growth_space')
  assert.equal(readingComparisonState(900, 7_000), 'close')
  assert.equal(readingComparisonState(1_100, 7_000), 'close')
  assert.equal(readingComparisonState(1_101, 7_000), 'more')
  assert.deepEqual(readingLastCompleteWeekDates('2026-08-10'), [
    '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09',
  ])
  assert.deepEqual(readingSevenStatDates('2026-08-10'), [
    '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10',
  ])
  const rows = [
    { statDate: '2026-08-07', effectiveReadingMs: 300_000 },
    { statDate: '2026-08-08', effectiveReadingMs: 300_000 },
    { statDate: '2026-08-09', effectiveReadingMs: 300_000 },
    { statDate: '2026-08-10', effectiveReadingMs: 299_999 },
  ]
  assert.equal(readingStreakDays(rows, '2026-08-10'), 3)
  assert.deepEqual(fillReadingSevenDays(rows, '2026-08-10').map((day) => day.effectiveReadingMs), [
    0, 0, 0, 300_000, 300_000, 300_000, 299_999,
  ])
})

test('班级纯函数对空班级返回 null，并以全体有效名单作为人均分母', () => {
  assert.deepEqual(deriveClassReadingMetrics({ activeStudentCount: 0, studentTotalsMs: [] }), {
    checkedInStudentCount: 0,
    checkInRateBasisPoints: null,
    totalEffectiveReadingMs: 0,
    perCapitaEffectiveReadingMs: null,
  })
  assert.deepEqual(deriveClassReadingMetrics({
    activeStudentCount: 3,
    studentTotalsMs: [300_000, 299_999],
  }), {
    checkedInStudentCount: 1,
    checkInRateBasisPoints: 3333,
    totalEffectiveReadingMs: 599_999,
    perCapitaEffectiveReadingMs: 200_000,
  })
})

test('/self 严格返回新 DTO、空事实语义和隐私边界', async (t) => {
  const fixture = createFixture({ studentCount: 1 })
  t.after(() => fixture.close())
  const auth = { organizationId: 'org-a', userId: 'student-01', workspaceId: 'student-workspace-a' }
  let result = await fixture.domain.getStudentSummary(auth)
  assert.deepEqual(result, {
    generatedAt: NOW,
    dataUpdatedAt: null,
    statDate: '2026-08-10',
    todayEffectiveReadingSeconds: 0,
    checkIn: { checked: false, thresholdSeconds: 300, remainingSeconds: 300 },
    streakDays: 0,
    comparisonState: 'no_baseline',
    lastReading: null,
  })
  for (const statDate of readingLastCompleteWeekDates('2026-08-10')) {
    if (['2026-08-08', '2026-08-09'].includes(statDate)) continue
    insertDaily(fixture.db, { actorId: 'student-01', statDate, effectiveMs: 300_000 })
  }
  insertDaily(fixture.db, { actorId: 'student-01', statDate: '2026-08-08', effectiveMs: 300_000 })
  insertDaily(fixture.db, { actorId: 'student-01', statDate: '2026-08-09', effectiveMs: 300_000 })
  insertDaily(fixture.db, {
    actorId: 'student-01', statDate: '2026-08-10', effectiveMs: 300_001,
    lastReadAt: '2026-08-10T08:00:00.000Z', lastPageNo: 10,
  })
  insertDaily(fixture.db, {
    actorId: 'student-01', statDate: '2026-08-10', effectiveMs: 10_999,
    bookVersionId: 'version-a2', lastReadAt: '2026-08-10T08:30:00.000Z', lastPageNo: 7,
    hadSkip: 1, hadReread: 1, updatedAt: '2026-08-10T08:31:00.000Z',
  })
  result = await fixture.domain.getStudentSummary(auth)
  assert.equal(result.todayEffectiveReadingSeconds, 311)
  assert.deepEqual(result.checkIn, { checked: true, thresholdSeconds: 300, remainingSeconds: 0 })
  assert.equal(result.streakDays, 8)
  assert.equal(result.comparisonState, 'close')
  assert.deepEqual(result.lastReading, {
    bookId: 'book-a2',
    bookVersionId: 'version-a2',
    title: '真实书籍 A2',
    lastPageNo: 7,
    totalPages: 80,
    lastReadAt: '2026-08-10T08:30:00.000Z',
  })
  assert.equal(result.dataUpdatedAt, NOW)
  assert.equal(Object.hasOwn(result, 'lastWeek'), false)
  assert.equal(Object.hasOwn(result, 'hadSkip'), false)
  assert.equal(JSON.stringify(result).includes('dailyAverage'), false)
})

test('/self 最近书籍不可访问时取下一条，教师身份不能冒充 self', async (t) => {
  const fixture = createFixture({ studentCount: 1 })
  t.after(() => fixture.close())
  insertDaily(fixture.db, {
    actorId: 'student-01', bookVersionId: 'version-a', effectiveMs: 1,
    lastReadAt: '2026-08-10T08:00:00.000Z',
  })
  insertDaily(fixture.db, {
    actorId: 'student-01', bookVersionId: 'version-a2', effectiveMs: 1,
    lastReadAt: '2026-08-10T08:30:00.000Z',
  })
  fixture.db.prepare("UPDATE books SET status = 'archived' WHERE id = 'book-a2'").run()
  const result = await fixture.domain.getStudentSummary({
    organizationId: 'org-a', userId: 'student-01', workspaceId: 'student-workspace-a',
  })
  assert.equal(result.lastReading.bookVersionId, 'version-a')
  await assert.rejects(() => fixture.domain.getStudentSummary({
    organizationId: 'org-a', userId: 'teacher-a', workspaceId: 'student-workspace-a',
  }), { code: 'PERMISSION_DENIED' })
})

test('/scope 50 人一次返回 37/50、七日补零、学生详情与稳定姓名排序', async (t) => {
  const fixture = createFixture({ studentCount: 50 })
  t.after(() => fixture.close())
  for (let index = 1; index <= 37; index += 1) {
    insertDaily(fixture.db, {
      actorId: `student-${String(index).padStart(2, '0')}`,
      effectiveMs: 300_000,
      hadSkip: index <= 4 ? 1 : 0,
      hadReread: index <= 8 ? 1 : 0,
      lastReadAt: `2026-08-10T08:${String(index).padStart(2, '0')}:00.000Z`,
      lastPageNo: index,
    })
  }
  for (const statDate of readingLastCompleteWeekDates('2026-08-10')) {
    insertDaily(fixture.db, { actorId: 'student-01', statDate, effectiveMs: 70_000 })
  }
  insertDaily(fixture.db, {
    actorId: 'student-01', statDate: '2026-08-09', effectiveMs: 300_000, bookVersionId: 'version-a2',
  })
  insertDaily(fixture.db, {
    actorId: 'student-01', statDate: '2026-08-08', effectiveMs: 300_000, bookVersionId: 'version-a2',
  })
  const result = await fixture.domain.getScopedSummary({
    organizationId: 'org-a', userId: 'teacher-a', workspaceId: 'student-workspace-a',
  }, { classId: 'class-a', statDate: '2026-08-10' })
  assert.equal(result.class.activeStudentCount, 50)
  assert.equal(result.summary.checkedInStudentCount, 37)
  assert.equal(result.summary.checkInRateBasisPoints, 7400)
  assert.equal(result.summary.totalEffectiveReadingSeconds, 11_100)
  assert.equal(result.summary.perCapitaEffectiveReadingSeconds, 222)
  assert.equal(result.summary.skipStudentCount, 4)
  assert.equal(result.summary.rereadStudentCount, 8)
  assert.equal(result.trend.length, 7)
  assert.equal(result.trend.at(-1).statDate, '2026-08-10')
  assert.equal(result.students.length, 50)
  assert.equal(result.students.every((student) => student.recentDays.length === 7), true)
  const first = result.students.find((student) => student.studentId === 'student-01')
  assert.equal(first.streakDays, 3)
  assert.deepEqual(first.lastWeek, {
    totalEffectiveReadingSeconds: 1090,
    dailyAverageEffectiveReadingSeconds: 155,
    todayDeltaSeconds: 144,
    comparisonState: 'more',
  })
  assert.deepEqual(first.lastReading, {
    bookId: 'book-a',
    bookVersionId: 'version-a',
    title: '真实书籍 A',
    lastPageNo: 1,
    totalPages: 120,
  })
  const sorted = [...result.students].sort((left, right) => left.displayName.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
    .localeCompare(right.displayName.normalize('NFKC').trim().toLocaleLowerCase('zh-CN'), 'zh-CN')
    || left.studentId.localeCompare(right.studentId))
  assert.deepEqual(result.students.map((student) => student.studentId), sorted.map((student) => student.studentId))
  assert.equal(Object.hasOwn(result, 'ranking'), false)
  assert.equal(JSON.stringify(result).includes('pageEvidence'), false)
})

test('/scope 空班级使用 null；转班历史 numerator 按发生时班级、分母使用当前名单', async (t) => {
  const fixture = createFixture({ studentCount: 2 })
  t.after(() => fixture.close())
  let empty = await fixture.domain.getScopedSummary({
    organizationId: 'org-a', userId: 'admin-a', workspaceId: 'school-workspace-a',
  }, { classId: 'class-empty', statDate: '2026-08-10' })
  assert.equal(empty.class.activeStudentCount, 0)
  assert.deepEqual(empty.summary, {
    checkedInStudentCount: 0,
    checkInRateBasisPoints: null,
    totalEffectiveReadingSeconds: 0,
    perCapitaEffectiveReadingSeconds: null,
    skipStudentCount: 0,
    rereadStudentCount: 0,
  })
  assert.equal(empty.trend.length, 7)
  assert.deepEqual(empty.students, [])

  insertDaily(fixture.db, {
    actorId: 'student-01', classId: 'class-empty', effectiveMs: 300_000,
  })
  empty = await fixture.domain.getScopedSummary({
    organizationId: 'org-a', userId: 'admin-a', workspaceId: 'school-workspace-a',
  }, { classId: 'class-empty', statDate: '2026-08-10' })
  assert.equal(empty.class.activeStudentCount, 0)
  assert.equal(empty.summary.checkedInStudentCount, 0)
  assert.equal(empty.summary.totalEffectiveReadingSeconds, 0)
  assert.equal(empty.summary.checkInRateBasisPoints, null)

  insertDaily(fixture.db, { actorId: 'student-01', effectiveMs: 300_000 })
  insertDaily(fixture.db, { actorId: 'student-02', effectiveMs: 300_000 })
  fixture.db.prepare(`UPDATE class_memberships SET status = 'disabled'
    WHERE class_id = 'class-a' AND user_id = 'student-01'`).run()
  const historical = await fixture.domain.getScopedSummary({
    organizationId: 'org-a', userId: 'teacher-a', workspaceId: 'student-workspace-a',
  }, { classId: 'class-a', statDate: '2026-08-10' })
  assert.equal(historical.class.activeStudentCount, 1)
  assert.equal(historical.summary.checkedInStudentCount, 2)
  assert.equal(historical.summary.checkInRateBasisPoints, 20_000)
  assert.equal(historical.students.some((student) => student.studentId === 'student-01'), false)
  empty = historical
})

test('/scope 严格校验必填 query、组织 404、同组织越权 403 和 student 403', async (t) => {
  const fixture = createFixture({ studentCount: 1 })
  t.after(() => fixture.close())
  const teacherAuth = {
    organizationId: 'org-a', userId: 'teacher-a', workspaceId: 'student-workspace-a',
  }
  await assert.rejects(() => fixture.domain.getScopedSummary(teacherAuth, {
    classId: 'class-a', statDate: '2026-08-10', search: 'student',
  }), { code: 'VALIDATION_FAILED' })
  await assert.rejects(() => fixture.domain.getScopedSummary(teacherAuth, {
    classId: 'class-b', statDate: '2026-08-10',
  }), { code: 'RESOURCE_NOT_FOUND' })
  await assert.rejects(() => fixture.domain.getScopedSummary(teacherAuth, {
    classId: 'class-other-a', statDate: '2026-08-10',
  }), { code: 'PERMISSION_DENIED' })
  await assert.rejects(() => fixture.domain.getScopedSummary({
    organizationId: 'org-a', userId: 'student-01', workspaceId: 'student-workspace-a',
  }, { classId: 'class-a', statDate: '2026-08-10' }), { code: 'PERMISSION_DENIED' })
})
