/**
 * T4-1 守卫：年级维度身份出口（契约 3.4.1 / G4-1 G4-2 G4-10 G4-11）。
 * 只新增测试，禁止改业务实现与既有测试。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { computeClassLifecycle } from '../../../../server/domains/identity/lifecycle.js'
import {
  IDENTITY_PERMISSIONS_PATH,
  INTEGRATION_ROUTER_PATH,
  extractRouteBlock,
  readSource,
} from '../phase8-identity-guards/harness.guard.test.js'
import {
  assertHttpStatus,
  newIdempotencyKey,
  requestJson,
  startPhase8HttpApp,
} from '../../http/phase8-http-guards/shared-harness.guard.test.js'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(dirname(dirname(dirname(here))))
const LIFECYCLE_PATH = join(projectRoot, 'server', 'domains', 'identity', 'lifecycle.js')
const SERVER_ROOT = join(projectRoot, 'server')
const BASELINE = 'ef0df7f'
const BEFORE_SEPT = '2026-08-31T15:59:59.000Z'
const ON_SEPT = '2026-08-31T16:00:00.000Z'

const SECOND_ACADEMIC_YEAR_LOGIC = [
  /\bfunction\s+academicStartYearAt\b/,
  /\bfunction\s+computeClassLifecycle\b/,
  /\bacademicStartYear\s*-/,
  /month\s*>\s*9/,
  /month\s*===\s*9\s*&&/,
  /9\s*月\s*1/,
]

function collectJsFiles(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'data') continue
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) collectJsFiles(fullPath, files)
    else if (entry.name.endsWith('.js')) files.push(fullPath)
  }
  return files
}

function posixPath(pathname) {
  return String(pathname).replace(/\\/g, '/')
}

function isLifecycleSource(pathname) {
  return posixPath(pathname).endsWith('/server/domains/identity/lifecycle.js')
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

function insertJuniorClassWithStudent(db, fixture, now) {
  const classId = `junior-2023-${fixture.suffix}`
  const studentId = `junior-student-${fixture.suffix}`
  db.prepare(`
    INSERT INTO classes (
      id, organization_id, grade_id, name, stage, entry_year, class_number,
      status, created_at, updated_at, version
    ) VALUES (?, ?, 'junior:2023', '初三对照班', 'junior', 2023, 1, 'active', ?, ?, 1)
  `).run(classId, fixture.organizationId, now, now)
  insertUser(db, {
    id: studentId,
    organizationId: fixture.organizationId,
    loginName: `jnr${fixture.suffix}`,
    displayName: '同 currentGrade 不同 grade_id 学生',
    now,
  })
  db.prepare(`
    INSERT INTO class_memberships (
      id, class_id, user_id, membership_role, status, created_at, updated_at, version
    ) VALUES (?, ?, ?, 'student', 'active', ?, ?, 1)
  `).run(randomUUID(), classId, studentId, now, now)
  return { classId, studentId }
}

async function issueStudentToken(baseUrl, adminJar, workspaceId) {
  const issued = await requestJson(baseUrl, adminJar, '/registration-credentials', {
    method: 'POST',
    workspaceId,
    idempotencyKey: newIdempotencyKey('g41-reg-issue'),
    body: { expectedRole: 'student' },
  })
  assertHttpStatus(issued, 201, 'G4-1 签发学生注册凭据')
  assert.ok(issued.payload?.data?.rawToken, 'G4-1 签发响应必须带 rawToken')
  return issued.payload.data.rawToken
}

function findPrimary2023Class(classes, classId) {
  assert.ok(Array.isArray(classes), `注册出口 classes 必须是数组，实际 ${JSON.stringify(classes)?.slice(0, 300)}`)
  const match = classes.find((item) => item.id === classId)
  assert.ok(match, `注册出口必须包含入学届 primary:2023 的班级 ${classId}`)
  return match
}

function findStudent(items, studentId) {
  assert.ok(Array.isArray(items), `GET /students 必须返回 data.items 数组，实际 ${JSON.stringify(items)?.slice(0, 300)}`)
  const match = items.find((item) => item.id === studentId)
  assert.ok(match, `GET /students 必须包含学生 ${studentId}`)
  return match
}

test('G4-2 源码扫描：lifecycle.js 之外不得出现第二处 9 月 1 日 / academicStartYear 年级推算逻辑', () => {
  const offenders = []
  for (const filePath of collectJsFiles(SERVER_ROOT)) {
    if (isLifecycleSource(filePath)) continue
    const source = readFileSync(filePath, 'utf8')
    const hits = SECOND_ACADEMIC_YEAR_LOGIC.filter((pattern) => pattern.test(source)).map((pattern) => String(pattern))
    if (hits.length > 0) offenders.push({ filePath: posixPath(filePath), hits })
  }
  assert.deepEqual(
    offenders,
    [],
    `G4-2 既有不变式：年级推算只能在 ${posixPath(LIFECYCLE_PATH)}。第二处实现: ${JSON.stringify(offenders)}`,
  )
})

test('G4-11 permissions.js 与 scopeAllows 相对基线 ef0df7f 未被修改', () => {
  const diff = execFileSync(
    'git',
    ['diff', BASELINE, '--', 'server/domains/identity/permissions.js'],
    { cwd: projectRoot, encoding: 'utf8' },
  )
  assert.equal(diff, '', `G4-11 既有不变式：permissions.js 相对 ${BASELINE} 必须无 diff，实际:\n${diff.slice(0, 800)}`)

  const source = readSource(IDENTITY_PERMISSIONS_PATH)
  assert.match(source, /function scopeAllows\(/, 'G4-11 scopeAllows 必须仍在 permissions.js')
  assert.match(
    source,
    /collectScopeIds\(\s*resourceScope,\s*['"]classIds['"],\s*['"]classId['"]\s*\)/,
    'G4-11 scopeAllows 的 class 分支必须仍按既有 classIds 判定，本轮不得改写',
  )
})

test('G4-10 年级工作空间 GET /students 仍按 grade_id 过滤，不得改成 currentGrade', async (t) => {
  const studentsRoute = extractRouteBlock(readSource(INTEGRATION_ROUTER_PATH), 'get', '/students')
  assert.ok(studentsRoute.length > 0, 'G4-10 GET /students 必须仍挂在 integration-router')
  assert.match(
    studentsRoute,
    /class\.grade_id = \?/,
    'G4-10 年级工作空间过滤必须仍是 class.grade_id = ?，不得改成 currentGrade',
  )

  const harness = await startPhase8HttpApp(t)
  const { application, fixture, baseUrl } = harness
  const now = new Date().toISOString()
  const junior = insertJuniorClassWithStudent(application.database, fixture, now)
  const juniorLifecycle = computeClassLifecycle({
    stage: 'junior',
    entryYear: 2023,
    now,
  })
  const primaryLifecycle = computeClassLifecycle({
    stage: 'primary',
    entryYear: 2023,
    now,
  })
  assert.equal(
    juniorLifecycle.currentGrade,
    primaryLifecycle.currentGrade,
    '本用例的对照班必须与 primary:2023 有相同 currentGrade，才能证明过滤键是 grade_id 而不是当前年级',
  )

  const gradeManager = await harness.login(fixture.login.gradeManager)
  const listed = await requestJson(baseUrl, gradeManager, '/students', {
    workspaceId: fixture.wsGrade,
  })
  assertHttpStatus(listed, 200, 'G4-10 年级主任 GET /students')
  const ids = (listed.payload?.data?.items ?? []).map((item) => item.id)
  assert.equal(ids.includes(fixture.studentA), true, 'G4-10 同年级主任工作空间必须仍能看到 grade_id=primary:2023 的 A 班学生')
  assert.equal(ids.includes(fixture.studentB), true, 'G4-10 同年级主任工作空间必须仍能看到 grade_id=primary:2023 的 B 班学生')
  assert.equal(
    ids.includes(junior.studentId),
    false,
    'G4-10 不得按 currentGrade 过滤：junior:2023 与 primary:2023 当前年级相同，但 grade_id 不同，必须排除',
  )
})

test('G4-1 / G4-10 currentGrade 唯一来源是 computeClassLifecycle：同一入学届在 8/31 与 9/1 相差 1，且必须出现在 GET /students 与注册 token 出口', async (t) => {
  const beforeExpected = computeClassLifecycle({
    stage: 'primary',
    entryYear: 2023,
    now: BEFORE_SEPT,
  }).currentGrade
  const afterExpected = computeClassLifecycle({
    stage: 'primary',
    entryYear: 2023,
    now: ON_SEPT,
  }).currentGrade
  assert.equal(beforeExpected, 3, 'G4-1 对标 class-lifecycle：8 月 31 日 primary:2023 应为三年级')
  assert.equal(afterExpected, 4, 'G4-1 对标 class-lifecycle：9 月 1 日 primary:2023 应为四年级')
  assert.equal(afterExpected - beforeExpected, 1, 'G4-1 同一入学届跨越 9 月 1 日年级必须相差 1')

  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(BEFORE_SEPT) })
  const harness = await startPhase8HttpApp(t)
  const { fixture, baseUrl } = harness
  const admin = await harness.login(fixture.login.schoolAdmin)
  const rawToken = await issueStudentToken(baseUrl, admin, fixture.wsSchool)

  const studentsBefore = await requestJson(baseUrl, admin, '/students', {
    workspaceId: fixture.wsSchool,
  })
  assertHttpStatus(studentsBefore, 200, 'G4-1 8/31 GET /students')
  const studentBefore = findStudent(studentsBefore.payload?.data?.items, fixture.studentA)
  const registrationBefore = await requestJson(baseUrl, new Map(), `/registration/${rawToken}`)
  assertHttpStatus(registrationBefore, 200, 'G4-1 8/31 GET /registration/:token')
  const classBefore = findPrimary2023Class(registrationBefore.payload?.data?.classes, fixture.classAId)
  const missingBefore = [
    Object.hasOwn(studentBefore, 'gradeId') ? null : 'GET /students.gradeId',
    Object.hasOwn(studentBefore, 'currentGrade') ? null : 'GET /students.currentGrade',
    Object.hasOwn(classBefore, 'currentGrade') ? null : 'GET /registration classes[].currentGrade',
  ].filter(Boolean)
  assert.equal(
    missingBefore.length,
    0,
    `G4-1 / G4-10 8/31 出口缺字段（功能未实现）: ${missingBefore.join(', ')}`,
  )
  assert.equal(studentBefore.gradeId, 'primary:2023', 'G4-10 gradeId 仍是入学届，不是当前年级')
  assert.equal(
    studentBefore.currentGrade,
    beforeExpected,
    'G4-1 8/31 GET /students.currentGrade 必须等于 computeClassLifecycle，不得绑到 grade_id',
  )
  assert.equal(
    classBefore.currentGrade,
    beforeExpected,
    'G4-1 8/31 注册出口 currentGrade 必须等于 computeClassLifecycle',
  )

  t.mock.timers.setTime(Date.parse(ON_SEPT))

  const studentsAfter = await requestJson(baseUrl, admin, '/students', {
    workspaceId: fixture.wsSchool,
  })
  assertHttpStatus(studentsAfter, 200, 'G4-1 9/1 GET /students')
  const studentAfter = findStudent(studentsAfter.payload?.data?.items, fixture.studentA)
  assert.equal(
    studentAfter.currentGrade,
    afterExpected,
    'G4-1 9/1 GET /students.currentGrade 必须滚动 +1，证明走的是 computeClassLifecycle 而不是落库字段',
  )
  assert.equal(
    studentAfter.currentGrade - studentBefore.currentGrade,
    1,
    'G4-1 GET /students 同一入学届在 8/31 与 9/1 的 currentGrade 必须相差 1',
  )

  const registrationAfter = await requestJson(baseUrl, new Map(), `/registration/${rawToken}`)
  assertHttpStatus(registrationAfter, 200, 'G4-1 9/1 GET /registration/:token')
  const classAfter = findPrimary2023Class(registrationAfter.payload?.data?.classes, fixture.classAId)
  assert.equal(
    classAfter.currentGrade,
    afterExpected,
    'G4-1 9/1 注册出口 currentGrade 必须滚动 +1',
  )
  assert.equal(
    classAfter.currentGrade - classBefore.currentGrade,
    1,
    'G4-1 注册出口同一入学届在 8/31 与 9/1 的 currentGrade 必须相差 1',
  )
})
