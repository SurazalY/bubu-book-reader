// T8.7 新增攻击：只补 14.2 中 T8.3A / T8.5A 尚未用全栈 HTTP 锁死的缺口。
// 已有守卫只引用标题，不在本文件复制弱化版。
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { hashPassword } from '../../../server/auth/password.js'
import { createReadmateApplication } from '../../../server/app.js'
import { createReadingDomain } from '../../../server/domains/reading/catalog.js'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(dirname(dirname(here)))
const REAL_DATABASE_PATH = join(projectRoot, 'server', 'data', 'readmate.sqlite')

function rememberCookies(jar, response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)
  for (const value of values) {
    const [pair] = value.split(';')
    const separator = pair.indexOf('=')
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1))
  }
}

async function requestJson(baseUrl, jar, path, options = {}) {
  const headers = new Headers(options.headers)
  if (jar?.size) headers.set('Cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '))
  if (options.workspaceId) headers.set('X-Workspace-Id', options.workspaceId)
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)
  if (options.ifMatch) headers.set('If-Match', String(options.ifMatch))
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  if (jar) rememberCookies(jar, response)
  const raw = await response.text()
  let payload = null
  try {
    payload = raw ? JSON.parse(raw) : null
  } catch {
    payload = { raw }
  }
  return { status: response.status, payload }
}

async function loginWithSchool(baseUrl, { loginName, password }) {
  const jar = new Map()
  const response = await requestJson(baseUrl, jar, '/auth/login', {
    method: 'POST',
    idempotencyKey: `t87-login-${randomUUID()}`,
    body: { loginName, password },
  })
  assert.equal(response.status, 200, JSON.stringify(response.payload))
  return jar
}

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function createAttackFixture() {
  const suffix = randomBytes(4).toString('hex')
  const id = (name) => `${name}-${suffix}`
  const password = `Pw.${randomBytes(12).toString('base64url')}`
  const passwordHash = hashPassword(password)
  const ids = {
    suffix,
    password,
    schoolCode: `t87${suffix}`,
    organizationId: id('org'),
    classAId: id('class-a'),
    classCId: id('class-c'),
    grade2023: 'primary:2023',
    grade2024: 'primary:2024',
    wsClassA: id('ws-a'),
    wsClassC: id('ws-c'),
    wsSchool: id('ws-school'),
    wsGrade2023: id('ws-g2023'),
    studentA: id('student-a'),
    pendingStudent: id('student-pending'),
    teacherA: id('teacher-a'),
    zeroWsTeacher: id('teacher-zero'),
    gradeManager: id('gm-2023'),
    schoolAdmin: id('admin'),
    login: {
      studentA: `sta${suffix}`,
      pendingStudent: `pnd${suffix}`,
      teacherA: `tca${suffix}`,
      zeroWsTeacher: `tv0${suffix}`,
      gradeManager: `gma${suffix}`,
      schoolAdmin: `adm${suffix}`,
    },
  }
  const user = (userId, loginName, displayName) => ({
    id: userId,
    organizationId: ids.organizationId,
    username: loginName,
    loginName,
    displayName,
  })
  ids.seed = {
    organizations: [{ id: ids.organizationId, name: 'T8.7 攻击本校', schoolCode: ids.schoolCode }],
    users: [
      user(ids.studentA, ids.login.studentA, 'A 班学生'),
      user(ids.pendingStudent, ids.login.pendingStudent, '待审学生'),
      user(ids.teacherA, ids.login.teacherA, 'A 班教师'),
      user(ids.zeroWsTeacher, ids.login.zeroWsTeacher, '零班教师'),
      user(ids.gradeManager, ids.login.gradeManager, '2023 届年级主任'),
      user(ids.schoolAdmin, ids.login.schoolAdmin, '校长'),
    ],
    workspaces: [
      { id: ids.wsClassA, organizationId: ids.organizationId, code: 'class-teacher', name: 'A 班', scopeType: 'class', scopeId: ids.classAId },
      { id: ids.wsClassC, organizationId: ids.organizationId, code: 'class-teacher', name: 'C 班', scopeType: 'class', scopeId: ids.classCId },
      { id: ids.wsSchool, organizationId: ids.organizationId, code: 'school-admin', name: '校务', scopeType: 'school', scopeId: ids.organizationId },
      { id: ids.wsGrade2023, organizationId: ids.organizationId, code: 'grade-admin', name: '2023 届', scopeType: 'grade', scopeId: ids.grade2023 },
    ],
    classes: [
      { id: ids.classAId, organizationId: ids.organizationId, gradeId: ids.grade2023, name: '2023 A 班', stage: 'primary', entryYear: 2023, classNumber: 1 },
      { id: ids.classCId, organizationId: ids.organizationId, gradeId: ids.grade2024, name: '2024 C 班', stage: 'primary', entryYear: 2024, classNumber: 1 },
    ],
    workspaceMemberships: [
      { id: randomUUID(), userId: ids.studentA, workspaceId: ids.wsClassA },
      { id: randomUUID(), userId: ids.teacherA, workspaceId: ids.wsClassA },
      { id: randomUUID(), userId: ids.gradeManager, workspaceId: ids.wsGrade2023 },
      { id: randomUUID(), userId: ids.schoolAdmin, workspaceId: ids.wsSchool },
    ],
    classMemberships: [
      { id: randomUUID(), classId: ids.classAId, userId: ids.studentA, membershipRole: 'student' },
      { id: randomUUID(), classId: ids.classAId, userId: ids.teacherA, membershipRole: 'teacher' },
    ],
    roleAssignments: [
      { id: randomUUID(), organizationId: ids.organizationId, userId: ids.studentA, workspaceId: ids.wsClassA, roleCode: 'student', scopeType: 'class', scopeId: ids.classAId },
      { id: randomUUID(), organizationId: ids.organizationId, userId: ids.teacherA, workspaceId: ids.wsClassA, roleCode: 'teacher', scopeType: 'class', scopeId: ids.classAId },
      { id: randomUUID(), organizationId: ids.organizationId, userId: ids.gradeManager, workspaceId: ids.wsGrade2023, roleCode: 'grade_manager', scopeType: 'grade', scopeId: ids.grade2023 },
      { id: randomUUID(), organizationId: ids.organizationId, userId: ids.schoolAdmin, workspaceId: ids.wsSchool, roleCode: 'school_admin', scopeType: 'school', scopeId: ids.organizationId },
    ],
    credentials: [
      ids.studentA, ids.pendingStudent, ids.teacherA, ids.zeroWsTeacher, ids.gradeManager, ids.schoolAdmin,
    ].map((userId) => ({ id: randomUUID(), userId, passwordHash })),
  }
  return ids
}

function seedZeroWsAndPending(database, fixture) {
  const now = new Date().toISOString()
  const week = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const teacherToken = randomBytes(32).toString('base64url')
  const credId = randomUUID()
  database.prepare(`
    INSERT INTO registration_credentials (
      id, organization_id, secret_hash, expected_role, scope_type, scope_id,
      expires_at, max_uses, successful_use_count, revoked_at, revoked_by, revoked_reason,
      created_by_user_id, created_workspace_id, created_at, updated_at, version
    ) VALUES (?, ?, ?, 'teacher', 'school', ?, ?, 1, 1, NULL, NULL, NULL, ?, ?, ?, ?, 1)
  `).run(
    credId, fixture.organizationId, sha256Hex(teacherToken), fixture.organizationId,
    week, fixture.schoolAdmin, fixture.wsSchool, now, now,
  )
  database.prepare(`
    INSERT INTO registration_credential_uses (
      id, credential_id, organization_id, expected_role, created_user_id, request_id, used_at
    ) VALUES (?, ?, ?, 'teacher', ?, ?, ?)
  `).run(randomUUID(), credId, fixture.organizationId, fixture.zeroWsTeacher, `t87-${randomUUID()}`, now)

  const enrollmentId = randomUUID()
  database.prepare(`
    INSERT INTO student_enrollment_requests (
      id, organization_id, student_user_id, class_id, status, requested_at,
      decided_at, decided_by, decision_reason, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, 'pending', ?, NULL, NULL, NULL, ?, ?, 1)
  `).run(enrollmentId, fixture.organizationId, fixture.pendingStudent, fixture.classAId, now, now, now)
  return { teacherToken, enrollmentId }
}

async function createTextBook(application, fixture, title) {
  const reading = createReadingDomain({
    db: application.database,
    actor: { id: fixture.schoolAdmin },
    workspace: { id: fixture.wsSchool, organizationId: fixture.organizationId },
    authorize: async () => true,
    audit: async () => undefined,
    idFactory: randomUUID,
    now: () => new Date(),
  })
  const created = await reading.createBookVersion({
    title,
    label: `t87-${randomUUID()}`,
    sourceFormat: 'text',
    pages: [1, 2].map((pageNo) => ({
      pageNo,
      width: 1024,
      height: 768,
      textContent: `${title} 第 ${pageNo} 页`,
      blocks: [{
        blockKey: `page-${pageNo}-paragraph-1`,
        paragraphId: `paragraph-${pageNo}`,
        textContent: `${title} 第 ${pageNo} 页`,
        charStart: 0,
        charEnd: 8,
        x: 80,
        y: 100,
        width: 760,
        height: 120,
      }],
    })),
  })
  await reading.publishBook(created.bookId)
  return created
}

async function startAttackApp(t) {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-t87-attack-'))
  const databasePath = join(directory, 't87.sqlite')
  assert.notEqual(databasePath.replace(/\\/g, '/').toLowerCase(), REAL_DATABASE_PATH.replace(/\\/g, '/').toLowerCase())
  const fixture = createAttackFixture()
  const application = createReadmateApplication({
    databasePath,
    sessionSecret: randomBytes(48).toString('base64url'),
    cookieSecure: false,
    serveStatic: false,
  })
  application.identity.service.importSeed(fixture.seed)
  const extras = seedZeroWsAndPending(application.database, fixture)
  const server = await new Promise((resolve) => {
    const listener = application.app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  const port = server.address().port
  assert.notEqual(port, 5191)
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    application.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return {
    application,
    fixture,
    extras,
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
    login(loginName) {
      return loginWithSchool(this.baseUrl, {
        schoolCode: fixture.schoolCode,
        loginName,
        password: fixture.password,
      })
    },
  }
}

test('已锁攻击只引用 T8.3A/T8.5A，不在本文件复制弱化版', () => {
  const identityDir = join(projectRoot, 'tests', 'server', 'core', 'phase8-identity-guards')
  const httpDir = join(projectRoot, 'tests', 'server', 'http', 'phase8-http-guards')
  const registration = readFileSync(join(identityDir, 'registration.guard.test.js'), 'utf8')
  const passwordReset = readFileSync(join(identityDir, 'password-reset.guard.test.js'), 'utf8')
  const affiliation = readFileSync(join(identityDir, 'teacher-affiliation.guard.test.js'), 'utf8')
  const publish = readFileSync(join(httpDir, 'publish-school-forbidden.guard.test.js'), 'utf8')
  const visibility = readFileSync(join(httpDir, 'visibility-deleted.guard.test.js'), 'utf8')
  assert.match(registration, /body 出现 role\/organizationId\/scopeId/)
  assert.match(registration, /公开消费原文不落库、不进审计/)
  assert.match(passwordReset, /审计不含 token\/password\/hash/)
  assert.match(affiliation, /行政纠错 PATCH \/students\/:userId\/class：教师 403/)
  assert.match(affiliation, /残缺纠错/)
  assert.match(publish, /教师全局 publish\/unpublish 必须 403/)
  assert.match(visibility, /必须删除 GET\/PUT \/books\/:bookId\/visibility/)
})

test('教师未加入班不得操作本班书架（零 workspace 教师）', async (t) => {
  const { fixture, baseUrl, application } = await startAttackApp(t)
  const book = await createTextBook(application, fixture, '零班教师不得投放')
  const zero = await loginWithSchool(baseUrl, {
    schoolCode: fixture.schoolCode,
    loginName: fixture.login.zeroWsTeacher,
    password: fixture.password,
  })

  const withoutWs = await requestJson(baseUrl, zero, `/classes/${fixture.classAId}/shelf/${book.bookId}`, {
    method: 'PUT',
    idempotencyKey: `t87-zero-shelf-nows-${randomUUID()}`,
    body: {},
  })
  assert.ok([400, 403].includes(withoutWs.status), `无 workspace 写书架必须拒绝，实际 ${withoutWs.status}`)
  assert.notEqual(withoutWs.status, 200)

  const forged = await requestJson(baseUrl, zero, `/classes/${fixture.classAId}/shelf/${book.bookId}`, {
    method: 'PUT',
    workspaceId: fixture.wsClassA,
    idempotencyKey: `t87-zero-shelf-forged-${randomUUID()}`,
    body: {},
  })
  assert.equal(forged.status, 403, JSON.stringify(forged.payload))
  assert.equal(forged.payload.error.code, 'PERMISSION_DENIED')
  assert.equal(
    application.database.prepare(`
      SELECT COUNT(*) AS count FROM book_access_grants
      WHERE grantee_id = ? AND grantee_type = 'class'
    `).get(fixture.classAId).count,
    0,
    '零班教师不得写出本班 grant',
  )
})

test('教师未加入班不得审批该班成员', async (t) => {
  const { fixture, extras, baseUrl } = await startAttackApp(t)
  const zero = await loginWithSchool(baseUrl, {
    schoolCode: fixture.schoolCode,
    loginName: fixture.login.zeroWsTeacher,
    password: fixture.password,
  })

  const withoutWs = await requestJson(baseUrl, zero, `/enrollment-requests/${extras.enrollmentId}/approve`, {
    method: 'POST',
    idempotencyKey: `t87-zero-enroll-nows-${randomUUID()}`,
    ifMatch: 1,
    body: { version: 1 },
  })
  assert.ok([400, 403].includes(withoutWs.status), `无 workspace 审批必须拒绝，实际 ${withoutWs.status}`)

  const forged = await requestJson(baseUrl, zero, `/enrollment-requests/${extras.enrollmentId}/approve`, {
    method: 'POST',
    workspaceId: fixture.wsClassA,
    idempotencyKey: `t87-zero-enroll-forged-${randomUUID()}`,
    ifMatch: 1,
    body: { version: 1 },
  })
  assert.equal(forged.status, 403, JSON.stringify(forged.payload))
  assert.equal(forged.payload.error.code, 'PERMISSION_DENIED')
})

test('年级主任 school 例外不扩散到本届/跨届书架', async (t) => {
  const { fixture, baseUrl, application } = await startAttackApp(t)
  const book = await createTextBook(application, fixture, '年级主任不得改书架')
  const gm = await loginWithSchool(baseUrl, {
    schoolCode: fixture.schoolCode,
    loginName: fixture.login.gradeManager,
    password: fixture.password,
  })

  const ownCohort = await requestJson(baseUrl, gm, `/classes/${fixture.classAId}/shelf/${book.bookId}`, {
    method: 'PUT',
    workspaceId: fixture.wsGrade2023,
    idempotencyKey: `t87-gm-own-shelf-${randomUUID()}`,
    body: {},
  })
  assert.equal(ownCohort.status, 403, `本届书架必须 403：${JSON.stringify(ownCohort.payload)}`)
  assert.equal(ownCohort.payload.error.code, 'PERMISSION_DENIED')

  const crossCohort = await requestJson(baseUrl, gm, `/classes/${fixture.classCId}/shelf/${book.bookId}`, {
    method: 'PUT',
    workspaceId: fixture.wsGrade2023,
    idempotencyKey: `t87-gm-cross-shelf-${randomUUID()}`,
    body: {},
  })
  assert.equal(crossCohort.status, 403, `跨届书架必须 403：${JSON.stringify(crossCohort.payload)}`)
  assert.equal(crossCohort.payload.error.code, 'PERMISSION_DENIED')

  const ownGet = await requestJson(baseUrl, gm, `/classes/${fixture.classAId}/shelf`, {
    workspaceId: fixture.wsGrade2023,
  })
  assert.equal(ownGet.status, 403, `年级主任读本届书架必须 403：${JSON.stringify(ownGet.payload)}`)

  assert.equal(
    application.database.prepare('SELECT COUNT(*) AS count FROM book_access_grants').get().count,
    0,
    '年级主任不得写出任何 grant',
  )
})
