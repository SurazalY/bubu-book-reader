/**
 * T4-1 守卫：年级 / 全校阅读统计聚合（契约 3.4.1 / G4-3～G4-9）。
 * 只新增测试，禁止改业务实现与既有测试。
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { computeClassLifecycle } from '../../../../server/domains/identity/lifecycle.js'
import { deriveClassReadingMetrics } from '../../../../server/domains/reading/statistics.js'
import {
  PERMISSION_DENIED,
  assertErrorCode,
  assertHttpStatus,
  createTextBook,
  grantCurrentBookToClass,
  requestJson,
  startPhase8HttpApp,
} from '../phase8-http-guards/shared-harness.guard.test.js'

const STAT_DATE = '2026-08-10'
const DAILY_AT = '2026-08-10T08:00:00.000Z'
const CHECK_IN_MS = 300_000
const ROOT_KEYS = ['class', 'dataUpdatedAt', 'generatedAt', 'statDate', 'students', 'summary', 'trend']
const CLASS_KEYS = ['activeStudentCount', 'classId', 'displayName']
const GRADE_HANZI = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六' }

function scopePath(query) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) search.set(key, String(value))
  }
  return `/reading/statistics/scope?${search}`
}

function currentPrimary2023Grade(now = new Date().toISOString()) {
  const grade = computeClassLifecycle({ stage: 'primary', entryYear: 2023, now }).currentGrade
  assert.equal(typeof grade, 'number', 'primary:2023 在本测试时刻必须仍是在籍年级，才能构造年级档')
  return grade
}

function gradeDisplayName(grade) {
  const hanzi = GRADE_HANZI[grade]
  assert.ok(hanzi, `年级展示文案未覆盖 currentGrade=${grade}`)
  return `${hanzi}年级（全年级）`
}

function assertNoPayloadData(response, detail) {
  assert.equal(
    response.payload?.data,
    undefined,
    `${detail}: 403 不得返回任何 data（不是空列表 200），实际 ${JSON.stringify(response.payload)?.slice(0, 400)}`,
  )
}

function assertExactKeys(value, expected, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} 必须是对象`)
  assert.deepEqual(Object.keys(value).sort(), expected, `${label} 字段必须恰好为 ${expected.join(', ')}`)
}

function insertUser(db, { id, organizationId, loginName, displayName, now }) {
  db.prepare(`
    INSERT INTO users (
      id, organization_id, username, display_name, status,
      created_at, updated_at, version, login_name, account_code
    ) VALUES (?, ?, ?, ?, 'active', ?, ?, 1, ?, ?)
  `).run(
    id,
    organizationId,
    id,
    displayName,
    now,
    now,
    loginName,
    `G${id.replace(/-/g, '').slice(0, 7).toUpperCase()}`,
  )
}

function insertEmptyClass(db, fixture, now) {
  const classId = `empty-${fixture.suffix}`
  db.prepare(`
    INSERT INTO classes (
      id, organization_id, grade_id, name, stage, entry_year, class_number,
      status, created_at, updated_at, version
    ) VALUES (?, ?, 'primary:2025', '空班对照', 'primary', 2025, 1, 'active', ?, ?, 1)
  `).run(classId, fixture.organizationId, now, now)
  return classId
}

function insertClassBExtraStudent(db, fixture, now) {
  const studentId = `student-c-${fixture.suffix}`
  insertUser(db, {
    id: studentId,
    organizationId: fixture.organizationId,
    loginName: `stc${fixture.suffix}`,
    displayName: 'B 班第二学生',
    now,
  })
  db.prepare(`
    INSERT INTO class_memberships (
      id, class_id, user_id, membership_role, status, created_at, updated_at, version
    ) VALUES (?, ?, ?, 'student', 'active', ?, ?, 1)
  `).run(randomUUID(), fixture.classBId, studentId, now, now)
  return studentId
}

let dailySeq = 0
function insertDaily(db, {
  organizationId,
  actorId,
  workspaceId,
  classId,
  bookVersionId,
  effectiveMs,
  statDate = STAT_DATE,
  at = DAILY_AT,
}) {
  db.prepare(`
    INSERT INTO reading_daily_book_summaries (
      id, organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation,
      class_id_at_creation, book_version_id, stat_date, effective_reading_ms,
      had_skip, had_reread, last_read_at, last_page_no, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 1, ?, ?, 1)
  `).run(
    `g48-daily-${++dailySeq}-${randomUUID()}`,
    organizationId,
    actorId,
    workspaceId,
    classId,
    bookVersionId,
    statDate,
    effectiveMs,
    at,
    at,
    at,
  )
}

async function seedTwoClassReading(harness) {
  const { application, fixture } = harness
  const now = new Date().toISOString()
  const studentC = insertClassBExtraStudent(application.database, fixture, now)
  const book = await createTextBook(application, fixture, { title: 'G4-8 统计用书' })
  grantCurrentBookToClass(application.database, {
    bookId: book.bookId,
    classId: fixture.classAId,
    organizationId: fixture.organizationId,
    actorId: fixture.schoolAdmin,
  })
  grantCurrentBookToClass(application.database, {
    bookId: book.bookId,
    classId: fixture.classBId,
    organizationId: fixture.organizationId,
    actorId: fixture.schoolAdmin,
  })
  insertDaily(application.database, {
    organizationId: fixture.organizationId,
    actorId: fixture.studentA,
    workspaceId: fixture.wsClassA,
    classId: fixture.classAId,
    bookVersionId: book.versionId,
    effectiveMs: CHECK_IN_MS,
  })
  insertDaily(application.database, {
    organizationId: fixture.organizationId,
    actorId: fixture.studentB,
    workspaceId: fixture.wsClassB,
    classId: fixture.classBId,
    bookVersionId: book.versionId,
    effectiveMs: 0,
  })
  insertDaily(application.database, {
    organizationId: fixture.organizationId,
    actorId: studentC,
    workspaceId: fixture.wsClassB,
    classId: fixture.classBId,
    bookVersionId: book.versionId,
    effectiveMs: CHECK_IN_MS,
  })
  return { studentC, book }
}

test('G4-3 教师 class 工作空间请求 scopeLevel=school 或 grade 必须 403，不得返回任何数据', async (t) => {
  const harness = await startPhase8HttpApp(t)
  const { fixture, baseUrl } = harness
  const teacher = await harness.login(fixture.login.teacherA)
  const grade = currentPrimary2023Grade()

  for (const [title, query] of [
    ['school', { scopeLevel: 'school', statDate: STAT_DATE }],
    ['grade', { scopeLevel: 'grade', grade, statDate: STAT_DATE }],
  ]) {
    const response = await requestJson(baseUrl, teacher, scopePath(query), {
      workspaceId: fixture.wsClassA,
    })
    assertHttpStatus(response, 403, `G4-3 教师 ${title}`)
    assertErrorCode(response, PERMISSION_DENIED, `G4-3 教师 ${title}`)
    assertNoPayloadData(response, `G4-3 教师 ${title}`)
    assert.notEqual(response.status, 200, `G4-3 教师 ${title} 不得用空列表 200 冒充无数据`)
  }
})

test('G4-4 校长 school 工作空间请求 class / grade / school 三档均 200', async (t) => {
  const harness = await startPhase8HttpApp(t)
  const { fixture, baseUrl } = harness
  const admin = await harness.login(fixture.login.schoolAdmin)
  const grade = currentPrimary2023Grade()

  const classLevel = await requestJson(
    baseUrl,
    admin,
    scopePath({
      scopeLevel: 'class',
      classId: fixture.classAId,
      statDate: STAT_DATE,
    }),
    { workspaceId: fixture.wsSchool },
  )
  assertHttpStatus(classLevel, 200, 'G4-4 校长 class 档')

  const gradeLevel = await requestJson(
    baseUrl,
    admin,
    scopePath({ scopeLevel: 'grade', grade, statDate: STAT_DATE }),
    { workspaceId: fixture.wsSchool },
  )
  assertHttpStatus(gradeLevel, 200, 'G4-4 校长 grade 档')

  const schoolLevel = await requestJson(
    baseUrl,
    admin,
    scopePath({ scopeLevel: 'school', statDate: STAT_DATE }),
    { workspaceId: fixture.wsSchool },
  )
  assertHttpStatus(schoolLevel, 200, 'G4-4 校长 school 档')
})

test('G4-5 年级主任 grade 工作空间请求 scopeLevel=school 必须 403', async (t) => {
  const harness = await startPhase8HttpApp(t)
  const { fixture, baseUrl } = harness
  const gradeManager = await harness.login(fixture.login.gradeManager)
  const response = await requestJson(
    baseUrl,
    gradeManager,
    scopePath({ scopeLevel: 'school', statDate: STAT_DATE }),
    { workspaceId: fixture.wsGrade },
  )
  assertHttpStatus(response, 403, 'G4-5 年级主任 school 档')
  assertErrorCode(response, PERMISSION_DENIED, 'G4-5 年级主任 school 档')
  assertNoPayloadData(response, 'G4-5 年级主任 school 档')
})

test('G4-6 query 白名单：未知字段 422；grade 在非 grade 档出现 422；grade 越界 422', async (t) => {
  const harness = await startPhase8HttpApp(t)
  const { fixture, baseUrl } = harness
  const admin = await harness.login(fixture.login.schoolAdmin)
  const classQuery = {
    classId: fixture.classAId,
    statDate: STAT_DATE,
  }

  const unknown = await requestJson(
    baseUrl,
    admin,
    scopePath({ ...classQuery, studentId: fixture.studentA }),
    { workspaceId: fixture.wsSchool },
  )
  assertHttpStatus(unknown, 422, 'G4-6 未知字段 studentId')
  assertErrorCode(unknown, 'VALIDATION_FAILED', 'G4-6 未知字段 studentId')
  assert.deepEqual(unknown.payload.error.details.fields, ['studentId'], 'G4-6 studentId 必须出现在 details.fields')

  const gradeOnClass = await requestJson(
    baseUrl,
    admin,
    scopePath({ ...classQuery, grade: 3 }),
    { workspaceId: fixture.wsSchool },
  )
  assertHttpStatus(gradeOnClass, 422, 'G4-6 grade 出现在缺省 class 档')
  assertErrorCode(gradeOnClass, 'VALIDATION_FAILED', 'G4-6 grade 出现在缺省 class 档')
  assert.equal(
    gradeOnClass.payload.error.details.fields.includes('grade'),
    true,
    'G4-6 scopeLevel 不是 grade 时出现 grade 必须 422，fields 含 grade',
  )

  const gradeOnSchool = await requestJson(
    baseUrl,
    admin,
    scopePath({ scopeLevel: 'school', grade: 3, statDate: STAT_DATE }),
    { workspaceId: fixture.wsSchool },
  )
  assertHttpStatus(gradeOnSchool, 422, 'G4-6 grade 出现在 school 档')
  assertErrorCode(gradeOnSchool, 'VALIDATION_FAILED', 'G4-6 grade 出现在 school 档')
  assert.equal(
    gradeOnSchool.payload.error.details.fields.includes('grade'),
    true,
    'G4-6 scopeLevel=school 时出现 grade 必须 422',
  )

  for (const [title, grade] of [
    ['0', 0],
    ['7', 7],
    ['非整数 3.5', '3.5'],
    ['非整数 abc', 'abc'],
  ]) {
    const response = await requestJson(
      baseUrl,
      admin,
      scopePath({ scopeLevel: 'grade', grade, statDate: STAT_DATE }),
      { workspaceId: fixture.wsSchool },
    )
    assertHttpStatus(response, 422, `G4-6 grade 越界 ${title}`)
    assertErrorCode(response, 'VALIDATION_FAILED', `G4-6 grade 越界 ${title}`)
    assert.equal(
      response.payload.error.details.fields.includes('grade'),
      true,
      `G4-6 grade=${grade} 必须 422 且 fields 含 grade`,
    )
  }
})

test('G4-7 响应根节点恰好 7 字段、class 恰好 3 字段；年级/全校档用合成值填充', async (t) => {
  const harness = await startPhase8HttpApp(t)
  const { fixture, baseUrl } = harness
  const admin = await harness.login(fixture.login.schoolAdmin)
  const grade = currentPrimary2023Grade()

  const gradeLevel = await requestJson(
    baseUrl,
    admin,
    scopePath({ scopeLevel: 'grade', grade, statDate: STAT_DATE }),
    { workspaceId: fixture.wsSchool },
  )
  assertHttpStatus(gradeLevel, 200, 'G4-7 年级档')
  assertExactKeys(gradeLevel.payload.data, ROOT_KEYS, 'G4-7 年级档根节点')
  assertExactKeys(gradeLevel.payload.data.class, CLASS_KEYS, 'G4-7 年级档 class')
  assert.equal(gradeLevel.payload.data.class.classId, `grade:${grade}`, 'G4-7 年级档 classId 必须是 grade:{n} 合成值')
  assert.equal(
    gradeLevel.payload.data.class.displayName,
    gradeDisplayName(grade),
    'G4-7 年级档 displayName 必须是「N年级（全年级）」',
  )

  const schoolLevel = await requestJson(
    baseUrl,
    admin,
    scopePath({ scopeLevel: 'school', statDate: STAT_DATE }),
    { workspaceId: fixture.wsSchool },
  )
  assertHttpStatus(schoolLevel, 200, 'G4-7 全校档')
  assertExactKeys(schoolLevel.payload.data, ROOT_KEYS, 'G4-7 全校档根节点')
  assertExactKeys(schoolLevel.payload.data.class, CLASS_KEYS, 'G4-7 全校档 class')
  assert.equal(schoolLevel.payload.data.class.classId, 'school', 'G4-7 全校档 classId 必须是 school')
  assert.equal(schoolLevel.payload.data.class.displayName, '全校', 'G4-7 全校档 displayName 必须是 全校')
})

test('G4-8 年级汇总必须先加总分子分母再走 deriveClassReadingMetrics，不得对两班比率求平均', async (t) => {
  const harness = await startPhase8HttpApp(t)
  const { fixture, baseUrl } = harness
  await seedTwoClassReading(harness)
  const admin = await harness.login(fixture.login.schoolAdmin)
  const grade = currentPrimary2023Grade()

  const response = await requestJson(
    baseUrl,
    admin,
    scopePath({ scopeLevel: 'grade', grade, statDate: STAT_DATE }),
    { workspaceId: fixture.wsSchool },
  )
  assertHttpStatus(response, 200, 'G4-8 年级汇总')
  const combined = deriveClassReadingMetrics({
    activeStudentCount: 3,
    studentTotalsMs: [CHECK_IN_MS, 0, CHECK_IN_MS],
  })
  const classA = deriveClassReadingMetrics({
    activeStudentCount: 1,
    studentTotalsMs: [CHECK_IN_MS],
  })
  const classB = deriveClassReadingMetrics({
    activeStudentCount: 2,
    studentTotalsMs: [0, CHECK_IN_MS],
  })
  const averagedRate = Math.round((classA.checkInRateBasisPoints + classB.checkInRateBasisPoints) / 2)
  assert.notEqual(
    combined.checkInRateBasisPoints,
    averagedRate,
    'G4-8 构造前提：总分子/总分母 必须不等于两班比率平均，否则本用例没有区分力',
  )

  const summary = response.payload.data.summary
  assert.equal(
    summary.checkInRateBasisPoints,
    combined.checkInRateBasisPoints,
    'G4-8 checkInRateBasisPoints 必须等于两班分子分母加总后重算，不得用比率平均',
  )
  assert.notEqual(
    summary.checkInRateBasisPoints,
    averagedRate,
    'G4-8 不得把两班打卡率求平均',
  )
  assert.equal(
    summary.perCapitaEffectiveReadingSeconds,
    Math.floor(combined.perCapitaEffectiveReadingMs / 1000),
    'G4-8 人均有效阅读时长必须按总时长/总人数重算',
  )
})

test('G4-9 单班空班（既有 class 档）比率仍为 null，不得为 0', async (t) => {
  const harness = await startPhase8HttpApp(t)
  const { application, fixture, baseUrl } = harness
  const now = new Date().toISOString()
  const emptyClassId = insertEmptyClass(application.database, fixture, now)
  const admin = await harness.login(fixture.login.schoolAdmin)

  const classEmpty = await requestJson(
    baseUrl,
    admin,
    scopePath({ classId: emptyClassId, statDate: STAT_DATE }),
    { workspaceId: fixture.wsSchool },
  )
  assertHttpStatus(classEmpty, 200, 'G4-9 单班空班（既有 class 档口径，允许绿）')
  assert.equal(classEmpty.payload.data.class.activeStudentCount, 0, 'G4-9 单班空班人数为 0')
  assert.equal(classEmpty.payload.data.summary.checkInRateBasisPoints, null, 'G4-9 单班空班打卡率必须是 null')
  assert.equal(
    classEmpty.payload.data.summary.perCapitaEffectiveReadingSeconds,
    null,
    'G4-9 单班空班人均时长必须是 null',
  )
  assert.notEqual(classEmpty.payload.data.summary.checkInRateBasisPoints, 0, 'G4-9 单班空班不得把 null 变成 0')
})

test('G4-9 年级档范围内无在籍学生时比率仍为 null，不得为 0', async (t) => {
  const harness = await startPhase8HttpApp(t)
  const { fixture, baseUrl } = harness
  const admin = await harness.login(fixture.login.schoolAdmin)
  const emptyGrade = 6
  assert.notEqual(
    emptyGrade,
    currentPrimary2023Grade(),
    'G4-9 年级空档必须选一个夹具里没有班级的 currentGrade',
  )
  const gradeEmpty = await requestJson(
    baseUrl,
    admin,
    scopePath({ scopeLevel: 'grade', grade: emptyGrade, statDate: STAT_DATE }),
    { workspaceId: fixture.wsSchool },
  )
  assertHttpStatus(gradeEmpty, 200, 'G4-9 年级档无在籍学生')
  assert.equal(gradeEmpty.payload.data.summary.checkInRateBasisPoints, null, 'G4-9 年级空档打卡率必须是 null')
  assert.equal(
    gradeEmpty.payload.data.summary.perCapitaEffectiveReadingSeconds,
    null,
    'G4-9 年级空档人均时长必须是 null',
  )
  assert.notEqual(gradeEmpty.payload.data.summary.checkInRateBasisPoints, 0, 'G4-9 年级空档不得为 0')
})

test('G4-9 全校档范围内无在籍学生时比率仍为 null，不得为 0', async (t) => {
  const harness = await startPhase8HttpApp(t)
  const { application, fixture, baseUrl } = harness
  const admin = await harness.login(fixture.login.schoolAdmin)
  application.database.prepare(`
    UPDATE class_memberships
    SET status = 'disabled'
    WHERE membership_role = 'student'
      AND class_id IN (SELECT id FROM classes WHERE organization_id = ?)
  `).run(fixture.organizationId)

  const schoolEmpty = await requestJson(
    baseUrl,
    admin,
    scopePath({ scopeLevel: 'school', statDate: STAT_DATE }),
    { workspaceId: fixture.wsSchool },
  )
  assertHttpStatus(schoolEmpty, 200, 'G4-9 全校档无在籍学生')
  assert.equal(schoolEmpty.payload.data.summary.checkInRateBasisPoints, null, 'G4-9 全校空档打卡率必须是 null')
  assert.equal(
    schoolEmpty.payload.data.summary.perCapitaEffectiveReadingSeconds,
    null,
    'G4-9 全校空档人均时长必须是 null',
  )
  assert.notEqual(schoolEmpty.payload.data.summary.checkInRateBasisPoints, 0, 'G4-9 全校空档不得为 0')
})
