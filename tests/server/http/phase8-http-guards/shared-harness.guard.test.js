/**
 * T8.5A 共享夹具。本文件只导出助手，不注册 test()。
 * D-21 / D-22 / 书架 / 旧 visibility 删除必须打 createReadmateApplication（identity + integration-router）。
 * 禁止 beforeEach / 共享 bootstrap 给所有书 grant 所有班。
 */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { hashPassword } from '../../../../server/auth/password.js'
import { createReadmateApplication } from '../../../../server/app.js'
import { createReadingDomain } from '../../../../server/domains/reading/catalog.js'
import { resolveCurrentBookVersionId } from '../../../../server/domains/reading/visibility.js'
import { createTeachingDomain } from '../../../../server/domains/teaching/classroom.js'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(dirname(dirname(dirname(here))))

export const NOW = '2026-08-18T11:00:00.000Z'
export const REAL_DATABASE_PATH = join(projectRoot, 'server', 'data', 'readmate.sqlite')
export const INTEGRATION_ROUTER_PATH = join(projectRoot, 'server', 'http', 'integration-router.js')
export const PROJECTIONS_PATH = join(projectRoot, 'server', 'integration', 'projections.js')
export const CONSOLE_API_PATH = join(projectRoot, 'src', 'api', 'console.js')
export const STUDENT_API_PATH = join(projectRoot, 'src', 'api', 'student.js')
export const AUTH_API_PATH = join(projectRoot, 'src', 'api', 'auth.js')
export const VISIBILITY_SOURCE_PATH = join(projectRoot, 'server', 'domains', 'reading', 'visibility.js')

export const RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND'
export const PERMISSION_DENIED = 'PERMISSION_DENIED'
export const QUOTE_UNAVAILABLE = 'unavailable'

export function isRealDatabasePath(filename) {
  return String(filename).replace(/\\/g, '/').toLowerCase() === REAL_DATABASE_PATH.replace(/\\/g, '/').toLowerCase()
}

export function readSource(pathname) {
  return readFileSync(pathname, 'utf8')
}

export function newIdempotencyKey(label) {
  const ascii = String(label ?? 'key')
    .replace(/[^\x20-\x7E]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${ascii || 'key'}-${randomUUID()}`
}

export function extractRouteBlock(source, method, path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`router\\.${method}\\(\\s*['\`]${escaped}['\`][\\s\\S]*?\\n  \\)`, 'm')
  return source.match(pattern)?.[0] ?? ''
}

export function assertNotRealDatabasePath(databasePath) {
  const resolved = String(databasePath).replace(/\\/g, '/')
  assert.equal(isRealDatabasePath(resolved), false, `守卫不得打开真库 ${REAL_DATABASE_PATH}，实际: ${databasePath}`)
  assert.equal(
    resolved.toLowerCase().endsWith('/server/data/readmate.sqlite'),
    false,
    `数据库路径不得指向 server/data/readmate.sqlite，实际: ${databasePath}`,
  )
}

export function errorOf(response) {
  return response.payload?.error ?? {}
}

export function assertHttpStatus(response, expected, detail) {
  assert.equal(
    response.status,
    expected,
    `${detail ?? 'HTTP 状态'} 期望 ${expected}，实际 ${response.status} body=${JSON.stringify(response.payload)?.slice(0, 500)}`,
  )
}

export function assertErrorCode(response, code, detail) {
  assert.equal(errorOf(response).code, code, `${detail ?? 'error.code'} 期望 ${code}，实际 ${errorOf(response).code}`)
}

export function assertStandardJson404(response, detail) {
  assertHttpStatus(response, 404, detail)
  assertErrorCode(response, RESOURCE_NOT_FOUND, `${detail}: 必须是标准 JSON 404，不得是 Express HTML`)
  assert.equal(response.payload?.parseError, undefined, `${detail}: 必须是 JSON`)
  assert.ok(errorOf(response).message, `${detail}: 404 必须有文案`)
}

export function assertForbiddenOrOpaque404(response, detail) {
  assert.ok(
    response.status === 403 || response.status === 404,
    `${detail}: 期望 403 或 404，实际 ${response.status} body=${JSON.stringify(response.payload)?.slice(0, 400)}`,
  )
  if (response.status === 403) {
    assertErrorCode(response, PERMISSION_DENIED, detail)
  } else {
    assertStandardJson404(response, detail)
  }
}

export function countBookGrants(db, { bookId, organizationId, classId, granteeType } = {}) {
  const rows = db.prepare(`
    SELECT grant_row.grantee_type AS granteeType, grant_row.grantee_id AS granteeId
    FROM book_access_grants AS grant_row
    JOIN book_versions AS version ON version.id = grant_row.book_version_id
    WHERE version.book_id = ?
      AND version.organization_id_at_creation = ?
  `).all(bookId, organizationId)
  return rows.filter((row) => {
    if (classId && row.granteeId !== classId) return false
    if (granteeType && row.granteeType !== granteeType) return false
    return true
  }).length
}

export function grantCurrentBookToClass(db, {
  bookId,
  classId,
  organizationId,
  actorId,
  granteeType = 'class',
  now = NOW,
}) {
  const bookVersionId = resolveCurrentBookVersionId(db, { bookId, organizationId })
  assert.ok(bookVersionId, `grantCurrentBookToClass 需要当前版本：bookId=${bookId}`)
  db.prepare(`
    INSERT INTO book_access_grants (
      id, book_version_id, grantee_type, grantee_id,
      organization_id_at_creation, actor_id_at_creation, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    `grant-${randomUUID()}`,
    bookVersionId,
    granteeType,
    classId,
    organizationId,
    actorId,
    now,
    now,
  )
  return bookVersionId
}

function pages(title) {
  return [1, 2].map((pageNo) => ({
    pageNo,
    width: 1024,
    height: 768,
    textContent: `${title} 第 ${pageNo} 页正文，足够引用。`,
    blocks: [{
      blockKey: `page-${pageNo}-paragraph-1`,
      paragraphId: `paragraph-${pageNo}`,
      textContent: `${title} 第 ${pageNo} 页正文，足够引用。`,
      charStart: 0,
      charEnd: 16,
      x: 80,
      y: 100,
      width: 760,
      height: 120,
    }],
  }))
}

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

export async function requestJson(baseUrl, jar, path, options = {}) {
  const headers = new Headers(options.headers)
  if (jar?.size) headers.set('Cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '))
  if (options.workspaceId) headers.set('X-Workspace-Id', options.workspaceId)
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  if (jar) rememberCookies(jar, response)
  const text = await response.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { parseError: true, raw: text.slice(0, 400) }
    }
  }
  return { status: response.status, payload, text }
}

export async function loginWithSchool(baseUrl, { loginName, password }, key = newIdempotencyKey('login')) {
  const jar = new Map()
  const response = await requestJson(baseUrl, jar, '/auth/login', {
    method: 'POST',
    idempotencyKey: key,
    body: { loginName, password },
  })
  assertHttpStatus(response, 200, `loginName 登录 ${loginName}`)
  return jar
}

export async function requireIntegrationReachable(baseUrl, jar, workspaceId) {
  const response = await requestJson(baseUrl, jar, '/books', { workspaceId })
  assertHttpStatus(
    response,
    200,
    'createReadmateApplication 必须打到 integration-router：登录后 GET /books 须 200。若是 identity 兜底 404「资源不存在」，说明 catch-all 吞掉了整条集成链，visibility/书架/D-21/D-22 HTTP 不能当已接线',
  )
  return response
}

function identitySeed(ids, passwordHash) {
  const user = (id, organizationId, loginName, displayName) => ({
    id,
    organizationId,
    username: id,
    loginName,
    displayName,
  })
  const membership = (userId, workspaceId) => ({ id: randomUUID(), userId, workspaceId })
  const role = (userId, workspaceId, roleCode, scopeType, scopeId, organizationId = ids.organizationId) => ({
    id: randomUUID(),
    organizationId,
    userId,
    workspaceId,
    roleCode,
    scopeType,
    scopeId,
  })
  const classMember = (classId, userId, membershipRole = 'student') => ({
    id: randomUUID(),
    classId,
    userId,
    membershipRole,
  })

  return {
    organizations: [
      { id: ids.organizationId, name: 'T8.5A 本校', schoolCode: ids.schoolCode },
      { id: ids.foreignOrganizationId, name: 'T8.5A 外校', schoolCode: ids.foreignSchoolCode },
    ],
    users: [
      user(ids.studentA, ids.organizationId, ids.login.studentA, 'A 班学生'),
      user(ids.studentB, ids.organizationId, ids.login.studentB, 'B 班学生'),
      user(ids.teacherA, ids.organizationId, ids.login.teacherA, 'A 班教师'),
      user(ids.teacherA2, ids.organizationId, ids.login.teacherA2, 'A 班第二教师'),
      user(ids.teacherB, ids.organizationId, ids.login.teacherB, 'B 班教师'),
      user(ids.schoolAdmin, ids.organizationId, ids.login.schoolAdmin, '校长'),
      user(ids.gradeManager, ids.organizationId, ids.login.gradeManager, '年级主任'),
      user(ids.platformOps, ids.organizationId, ids.login.platformOps, '平台运维'),
      user(ids.foreignStudent, ids.foreignOrganizationId, ids.login.foreignStudent, '外校学生'),
      user(ids.foreignTeacher, ids.foreignOrganizationId, ids.login.foreignTeacher, '外校教师'),
    ],
    workspaces: [
      { id: ids.wsClassA, organizationId: ids.organizationId, code: 'class-teacher', name: 'A 班', scopeType: 'class', scopeId: ids.classAId },
      { id: ids.wsClassB, organizationId: ids.organizationId, code: 'class-teacher', name: 'B 班', scopeType: 'class', scopeId: ids.classBId },
      { id: ids.wsSchool, organizationId: ids.organizationId, code: 'school-admin', name: '校务', scopeType: 'school', scopeId: ids.organizationId },
      { id: ids.wsGrade, organizationId: ids.organizationId, code: 'grade-admin', name: '年级', scopeType: 'grade', scopeId: ids.gradeId },
      { id: ids.wsPlatform, organizationId: ids.organizationId, code: 'platform-ops', name: '平台', scopeType: 'platform', scopeId: ids.organizationId },
      {
        id: ids.wsForeignClass,
        organizationId: ids.foreignOrganizationId,
        code: 'class-teacher',
        name: '外校班',
        scopeType: 'class',
        scopeId: ids.foreignClassId,
      },
    ],
    classes: [
      {
        id: ids.classAId,
        organizationId: ids.organizationId,
        gradeId: ids.gradeId,
        name: '一年级 A 班',
        stage: 'primary',
        entryYear: 2023,
        classNumber: 1,
      },
      {
        id: ids.classBId,
        organizationId: ids.organizationId,
        gradeId: ids.gradeId,
        name: '一年级 B 班',
        stage: 'primary',
        entryYear: 2023,
        classNumber: 2,
      },
      {
        id: ids.foreignClassId,
        organizationId: ids.foreignOrganizationId,
        gradeId: ids.foreignGradeId,
        name: '外校班级',
        stage: 'primary',
        entryYear: 2023,
        classNumber: 1,
      },
    ],
    workspaceMemberships: [
      membership(ids.studentA, ids.wsClassA),
      membership(ids.studentB, ids.wsClassB),
      membership(ids.teacherA, ids.wsClassA),
      membership(ids.teacherA2, ids.wsClassA),
      membership(ids.teacherB, ids.wsClassB),
      membership(ids.schoolAdmin, ids.wsSchool),
      membership(ids.gradeManager, ids.wsGrade),
      membership(ids.platformOps, ids.wsPlatform),
      membership(ids.foreignStudent, ids.wsForeignClass),
      membership(ids.foreignTeacher, ids.wsForeignClass),
    ],
    classMemberships: [
      classMember(ids.classAId, ids.studentA),
      classMember(ids.classBId, ids.studentB),
      classMember(ids.classAId, ids.teacherA, 'teacher'),
      classMember(ids.classAId, ids.teacherA2, 'teacher'),
      classMember(ids.classBId, ids.teacherB, 'teacher'),
      classMember(ids.foreignClassId, ids.foreignStudent),
      classMember(ids.foreignClassId, ids.foreignTeacher, 'teacher'),
    ],
    roleAssignments: [
      role(ids.studentA, ids.wsClassA, 'student', 'class', ids.classAId),
      role(ids.studentB, ids.wsClassB, 'student', 'class', ids.classBId),
      role(ids.teacherA, ids.wsClassA, 'teacher', 'class', ids.classAId),
      role(ids.teacherA2, ids.wsClassA, 'teacher', 'class', ids.classAId),
      role(ids.teacherB, ids.wsClassB, 'teacher', 'class', ids.classBId),
      role(ids.schoolAdmin, ids.wsSchool, 'school_admin', 'school', ids.organizationId),
      role(ids.gradeManager, ids.wsGrade, 'grade_manager', 'grade', ids.gradeId),
      role(ids.platformOps, ids.wsPlatform, 'platform_ops', 'platform', ids.organizationId),
      role(ids.foreignStudent, ids.wsForeignClass, 'student', 'class', ids.foreignClassId, ids.foreignOrganizationId),
      role(ids.foreignTeacher, ids.wsForeignClass, 'teacher', 'class', ids.foreignClassId, ids.foreignOrganizationId),
    ],
    credentials: [
      ids.studentA, ids.studentB, ids.teacherA, ids.teacherA2, ids.teacherB,
      ids.schoolAdmin, ids.gradeManager, ids.platformOps, ids.foreignStudent, ids.foreignTeacher,
    ].map((userId) => ({ id: randomUUID(), userId, passwordHash })),
  }
}

export function createPhase8HttpFixture() {
  const suffix = randomBytes(4).toString('hex')
  const id = (name) => `${name}-${suffix}`
  const password = `Pw.${randomBytes(12).toString('base64url')}`
  const ids = {
    suffix,
    password,
    schoolCode: `sa${suffix}`,
    foreignSchoolCode: `sb${suffix}`,
    organizationId: id('org-home'),
    foreignOrganizationId: id('org-foreign'),
    classAId: id('class-a'),
    classBId: id('class-b'),
    foreignClassId: id('class-foreign'),
    missingClassId: id('class-missing'),
    gradeId: 'primary:2023',
    foreignGradeId: 'primary:2023',
    wsClassA: id('ws-class-a'),
    wsClassB: id('ws-class-b'),
    wsSchool: id('ws-school'),
    wsGrade: id('ws-grade'),
    wsPlatform: id('ws-platform'),
    wsForeignClass: id('ws-foreign-class'),
    studentA: id('student-a'),
    studentB: id('student-b'),
    teacherA: id('teacher-a'),
    teacherA2: id('teacher-a2'),
    teacherB: id('teacher-b'),
    schoolAdmin: id('school-admin'),
    gradeManager: id('grade-manager'),
    platformOps: id('platform-ops'),
    foreignStudent: id('foreign-student'),
    foreignTeacher: id('foreign-teacher'),
    login: {
      studentA: `sta${suffix}`,
      studentB: `stb${suffix}`,
      teacherA: `tca${suffix}`,
      teacherA2: `tca2${suffix}`,
      teacherB: `tcb${suffix}`,
      schoolAdmin: `adm${suffix}`,
      gradeManager: `gma${suffix}`,
      platformOps: `ops${suffix}`,
      foreignStudent: `fsb${suffix}`,
      foreignTeacher: `ftc${suffix}`,
    },
  }
  return {
    ...ids,
    seed: identitySeed(ids, hashPassword(password)),
  }
}

export function readingDomain(application, actorId, workspaceId, organizationId) {
  return createReadingDomain({
    db: application.database,
    actor: { id: actorId },
    workspace: { id: workspaceId, organizationId },
    authorize: async () => true,
    audit: async () => undefined,
    idFactory: randomUUID,
    now: () => new Date(NOW),
  })
}

export async function createTextBook(application, fixture, { title, published = true, organizationId } = {}) {
  const orgId = organizationId || fixture.organizationId
  const actorId = orgId === fixture.foreignOrganizationId ? fixture.foreignTeacher : fixture.platformOps
  const workspaceId = orgId === fixture.foreignOrganizationId ? fixture.wsForeignClass : fixture.wsPlatform
  const reading = readingDomain(application, actorId, workspaceId, orgId)
  const created = await reading.createBookVersion({
    title: title || (published ? '已发布测试书' : '草稿测试书'),
    label: `t85a-${randomUUID().slice(0, 8)}`,
    sourceFormat: 'text',
    pages: pages(title || (published ? '已发布测试书' : '草稿测试书')),
  })
  if (published) await reading.publishBook(created.bookId)
  if (orgId !== fixture.organizationId) {
    application.database.prepare('UPDATE books SET organization_id_at_creation = ? WHERE id = ?').run(orgId, created.bookId)
    application.database.prepare('UPDATE book_versions SET organization_id_at_creation = ? WHERE id = ?').run(orgId, created.versionId)
  }
  return {
    ...created,
    title: title || (published ? '已发布测试书' : '草稿测试书'),
    quoteText: `${title || (published ? '已发布测试书' : '草稿测试书')} 第 1 页正文，足够引用。`,
  }
}

export function insertCommunityPost(db, fixture, {
  postId = `post-${randomUUID()}`,
  bookId,
  quoteText,
  workspaceId = fixture.wsClassA,
  classId = fixture.classAId,
  organizationId = fixture.organizationId,
  authorId = fixture.studentA,
  status = 'approved',
}) {
  db.prepare(`
    INSERT INTO community_posts (
      id, organization_id_at_creation, workspace_id_at_creation, class_id_at_creation,
      actor_id_at_creation, author_id, scope, title, body, quote_book_id, quote_page, quote_text,
      status, ai_assisted, organization_snapshot_json, workspace_snapshot_json,
      created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, 'class', ?, ?, ?, 1, ?, ?, 0, '{}', '{}', ?, ?, 1)
  `).run(
    postId,
    organizationId,
    workspaceId,
    classId,
    authorId,
    authorId,
    '旧帖引用',
    '这是一条不改库的旧社区帖',
    bookId,
    quoteText,
    status,
    NOW,
    NOW,
  )
  return postId
}

export async function createClassAssignment(application, fixture, { bookVersionId, title, classId = fixture.classAId, workspaceId = fixture.wsClassA }) {
  const teaching = createTeachingDomain({
    db: application.database,
    actor: { id: fixture.teacherA },
    workspace: { id: workspaceId, organizationId: fixture.organizationId },
    authorize: async () => true,
    audit: () => undefined,
    idFactory: randomUUID,
    now: () => new Date(NOW),
  })
  return teaching.createAssignment({
    bookVersionId,
    title,
    classIds: [classId],
    startsAt: NOW,
  })
}

export async function startPhase8HttpApp(t) {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-t85a-'))
  const databasePath = join(directory, 't8-5a-guard.sqlite')
  assertNotRealDatabasePath(databasePath)
  const fixture = createPhase8HttpFixture()
  const application = createReadmateApplication({
    databasePath,
    sessionSecret: randomBytes(48).toString('base64url'),
    cookieSecure: false,
    serveStatic: false,
  })
  application.identity.service.importSeed(fixture.seed)

  const server = await new Promise((resolve) => {
    const listener = application.app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  const port = server.address().port
  assert.notEqual(port, 5191, '独立端口禁止 5191')
  assert.notEqual(port, 0, '必须拿到真实监听端口')

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    application.close()
    rmSync(directory, { recursive: true, force: true })
  })

  return {
    application,
    fixture,
    directory,
    databasePath,
    port,
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
