/**
 * T2-1 守卫：取消登录学校码（契约 3.2）。
 * 本文件只新增测试，禁止改业务实现与既有测试。
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  ONBOARDING_PATH,
  SELECT_CLASS_PATH,
  assertErrorCode,
  assertHttpStatus,
  errorOf,
  loginWithUsername,
  newIdempotencyKey,
  readSource,
  requestJson,
  startPhase8App,
} from '../phase8-identity-guards/harness.guard.test.js'

const LOGIN_FAILURE_MESSAGE = '账号或密码错误'
const STUDENT_HOME_PATH = '/student/home'
const CONSOLE_HOME_PATH = '/console/home'
const SESSION_DATA_KEYS = ['activeWorkspaceId', 'navigation', 'user', 'workspaces']
const SESSION_USER_KEYS = ['displayName', 'id', 'organizationId', 'status', 'username']
const FORBIDDEN_SCHOOL_KEYS = new Set(['schoolCode', 'school_code'])

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(dirname(dirname(dirname(here))))
const AUTH_API_PATH = join(projectRoot, 'src', 'api', 'auth.js')
const STUDENT_LOGIN_PATH = join(projectRoot, 'src', 'student', 'pages', 'Login.jsx')
const CONSOLE_LOGIN_PATH = join(projectRoot, 'src', 'console', 'pages', 'Login.jsx')

function loginWithLoginName(baseUrl, { loginName, password }, key = newIdempotencyKey('login-name')) {
  return requestJson(baseUrl, '/auth/login', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { loginName, password },
  })
}

function collectKeys(value, keys = new Set()) {
  if (!value || typeof value !== 'object') return keys
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys)
    return keys
  }
  for (const [key, nested] of Object.entries(value)) {
    keys.add(key)
    collectKeys(nested, keys)
  }
  return keys
}

function assertNoSchoolFields(value, label) {
  const keys = collectKeys(value)
  for (const key of FORBIDDEN_SCHOOL_KEYS) {
    assert.equal(keys.has(key), false, `${label} 不得出现学校相关字段 ${key}`)
  }
}

function insertCrossOrgLoginName(database, { organizationId, loginName }) {
  const now = new Date().toISOString()
  const userId = randomUUID()
  database
    .prepare(
      `INSERT INTO users (
        id, organization_id, username, display_name, status,
        created_at, updated_at, version, login_name, account_code
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, 1, ?, ?)`,
    )
    .run(
      userId,
      organizationId,
      userId,
      '跨组织撞名',
      now,
      now,
      loginName,
      `G${userId.replace(/-/g, '').slice(0, 7).toUpperCase()}`,
    )
}

test('G2-1 跨组织插入相同 login_name（含大小写变体）必须被全局唯一索引拒绝', async (t) => {
  const { fixture, module } = await startPhase8App(t)
  const index = module.database
    .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'uq_users_login_name_global'`)
    .get()
  assert.ok(index, '必须存在全局唯一索引 uq_users_login_name_global')
  assert.match(String(index.sql), /UNIQUE/i)
  assert.match(String(index.sql), /login_name COLLATE NOCASE/i)

  const collidingLogin = fixture.login.enrolledStudent.toUpperCase()
  assert.notEqual(collidingLogin, fixture.login.enrolledStudent, '本用例必须用大小写变体撞名')
  assert.throws(
    () =>
      insertCrossOrgLoginName(module.database, {
        organizationId: fixture.id.schoolB,
        loginName: collidingLogin,
      }),
    '两个不同组织插入相同 login_name（大小写不同也算相同）必须被唯一索引拒绝',
  )
})

test('G2-2 POST /auth/login 两字段登录成功且 defaultPath 分流与改造前一致', async (t) => {
  const { fixture, baseUrl } = await startPhase8App(t)
  const cases = [
    { title: '在班学生', loginName: fixture.login.enrolledStudent, userId: fixture.id.enrolledStudent, defaultPath: STUDENT_HOME_PATH },
    { title: '校长控制台', loginName: fixture.login.schoolAdmin, userId: fixture.id.schoolAdmin, defaultPath: CONSOLE_HOME_PATH },
    { title: 'pending 学生', loginName: fixture.login.pendingStudent, userId: fixture.id.pendingStudent, defaultPath: ONBOARDING_PATH },
    { title: '零班教师', loginName: fixture.login.zeroWsTeacher, userId: fixture.id.zeroWsTeacher, defaultPath: SELECT_CLASS_PATH },
  ]

  for (const item of cases) {
    const response = await loginWithLoginName(
      baseUrl,
      { loginName: item.loginName, password: fixture.password },
      newIdempotencyKey(`g22-${item.title}`),
    )
    assertHttpStatus(response, 200, `G2-2 ${item.title}`)
    assert.equal(response.payload.data.user.id, item.userId, `G2-2 ${item.title} user.id`)
    assert.equal(
      response.payload.data.navigation.defaultPath,
      item.defaultPath,
      `G2-2 ${item.title} defaultPath`,
    )
    assert.ok(response.cookie, `G2-2 ${item.title} 必须下发 session cookie`)
  }
})

test('G2-3 body 出现 schoolCode 必须 VALIDATION_FAILED 不得静默忽略', async (t) => {
  const { fixture, baseUrl } = await startPhase8App(t)
  const response = await requestJson(baseUrl, '/auth/login', {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey('g23-school-code') },
    body: {
      loginName: fixture.login.schoolAdmin,
      password: fixture.password,
      schoolCode: fixture.schoolCodeA,
    },
  })
  assertHttpStatus(response, 400, 'G2-3 出现 schoolCode')
  assertErrorCode(response, 'VALIDATION_FAILED', 'G2-3 出现 schoolCode')
  assert.notEqual(response.status, 200, 'G2-3 不得把 schoolCode 当合法登录字段并成功')
})

test('G2-4 仅凭 username（UUID）无法登录', async (t) => {
  const { fixture, baseUrl } = await startPhase8App(t)
  const usernameOnly = await loginWithUsername(baseUrl, {
    username: fixture.id.schoolAdmin,
    password: fixture.password,
  })
  assert.notEqual(usernameOnly.status, 200, 'G2-4 { username, password } 不得登录成功')

  const uuidAsLoginName = await loginWithLoginName(
    baseUrl,
    { loginName: fixture.id.schoolAdmin, password: fixture.password },
    newIdempotencyKey('g24-uuid-login-name'),
  )
  assert.notEqual(uuidAsLoginName.status, 200, 'G2-4 用 username UUID 充当 loginName 不得登录成功')
  assert.notEqual(uuidAsLoginName.payload?.data?.user?.id, fixture.id.schoolAdmin, 'G2-4 不得签发该用户会话')
})

test('G2-5 错误账号与错误密码返回同一 401 与同一文案「账号或密码错误」', async (t) => {
  const { fixture, baseUrl } = await startPhase8App(t)
  const cases = [
    {
      title: '错密码',
      body: { loginName: fixture.login.schoolAdmin, password: 'wrong-password' },
    },
    {
      title: '错账号',
      body: { loginName: 'no-such-login', password: fixture.password },
    },
  ]
  const fingerprints = []
  for (const item of cases) {
    const response = await loginWithLoginName(baseUrl, item.body, newIdempotencyKey(`g25-${item.title}`))
    assertHttpStatus(response, 401, `G2-5 ${item.title}`)
    assertErrorCode(response, 'AUTH_REQUIRED', `G2-5 ${item.title}`)
    assert.equal(errorOf(response).message, LOGIN_FAILURE_MESSAGE, `G2-5 ${item.title} 文案`)
    fingerprints.push(`${response.status}:${errorOf(response).code}:${errorOf(response).message}`)
  }
  assert.equal(fingerprints[0], fingerprints[1], 'G2-5 错误账号与错误密码必须同一 401 与同一句文案')
})

test('G2-6 同一 Idempotency-Key 重复登录与改造前一致', async (t) => {
  const { fixture, baseUrl, module } = await startPhase8App(t)
  const key = newIdempotencyKey('g26-replay')
  const body = { loginName: fixture.login.enrolledStudent, password: fixture.password }

  const first = await loginWithLoginName(baseUrl, body, key)
  assertHttpStatus(first, 200, 'G2-6 首次两字段登录')
  assert.equal(first.payload.meta?.replayed, undefined, 'G2-6 首次登录不得标 replayed')
  assert.ok(first.cookie, 'G2-6 首次登录必须下发 cookie')
  const sessionsAfterFirst = module.database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count
  assert.equal(sessionsAfterFirst, 1, 'G2-6 首次登录恰好 1 条 session')

  const replay = await loginWithLoginName(baseUrl, body, key)
  assertHttpStatus(replay, 200, 'G2-6 重复同一 Idempotency-Key')
  assert.equal(replay.payload.meta?.replayed, true, 'G2-6 重复登录必须 replayed')
  assert.ok(replay.cookie, 'G2-6 重放仍须下发 cookie')
  assert.equal(
    module.database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count,
    sessionsAfterFirst,
    'G2-6 重放不得再插一条 session',
  )

  const conflictKey = newIdempotencyKey('g26-conflict')
  const established = await loginWithLoginName(baseUrl, body, conflictKey)
  assertHttpStatus(established, 200, 'G2-6 冲突用例先成功登录')
  const conflict = await loginWithLoginName(
    baseUrl,
    { loginName: fixture.login.enrolledStudent, password: 'different-password' },
    conflictKey,
  )
  assertHttpStatus(conflict, 409, 'G2-6 同一键不同请求体')
  assertErrorCode(conflict, 'IDEMPOTENCY_CONFLICT', 'G2-6 同一键不同请求体')
})

test('G2-7 源码扫描：auth.js 与两端 Login.jsx 不得再出现学校码字段', () => {
  const authSource = readSource(AUTH_API_PATH)
  const studentLogin = readSource(STUDENT_LOGIN_PATH)
  const consoleLogin = readSource(CONSOLE_LOGIN_PATH)
  const loginFn = authSource.slice(authSource.indexOf('login:'))

  assert.equal(authSource.includes('schoolCode'), false, 'src/api/auth.js 不得再出现 schoolCode')
  assert.match(loginFn.slice(0, 500), /loginName/, 'src/api/auth.js 登录 body 必须含 loginName')
  assert.match(loginFn.slice(0, 500), /password/, 'src/api/auth.js 登录 body 必须含 password')

  for (const [label, source] of [
    ['src/student/pages/Login.jsx', studentLogin],
    ['src/console/pages/Login.jsx', consoleLogin],
  ]) {
    assert.equal(source.includes('schoolCode'), false, `${label} 不得再出现 schoolCode`)
    assert.equal(source.includes('学校码'), false, `${label} 不得再出现学校码字段`)
  }
})

test('G2-8 登录成功后 cookie 与 GET /session 字段集合与改造前一致且未新增学校相关字段', async (t) => {
  const { fixture, baseUrl, module } = await startPhase8App(t)
  const login = await loginWithLoginName(baseUrl, {
    loginName: fixture.login.enrolledStudent,
    password: fixture.password,
  })
  assertHttpStatus(login, 200, 'G2-8 两字段登录（会话结构断言的前置）')
  assert.ok(login.cookie, 'G2-8 登录必须下发 session cookie')
  assert.match(login.setCookie, /HttpOnly/i, 'G2-8 cookie 必须 HttpOnly（对标 identity-core 登录用例）')
  assert.match(login.setCookie, /Path=\//i, 'G2-8 cookie Path 必须仍是 /')
  assert.match(login.setCookie, /SameSite=Lax/i, 'G2-8 cookie SameSite 必须仍是 Lax')
  assert.match(
    login.cookie,
    new RegExp(`^${module.service.cookieName}=`),
    'G2-8 cookie 名必须与改造前一致',
  )
  assertNoSchoolFields(login.payload, 'G2-8 登录响应')

  const session = await requestJson(baseUrl, '/session', { headers: { Cookie: login.cookie } })
  assertHttpStatus(session, 200, 'G2-8 GET /session')
  assert.deepEqual(
    Object.keys(session.payload.data).sort(),
    SESSION_DATA_KEYS,
    'G2-8 GET /session data 字段集合必须与改造前一致（identity GET /session 与 identity-core 口径：user / workspaces / activeWorkspaceId / navigation）',
  )
  assert.deepEqual(
    Object.keys(session.payload.data.user).sort(),
    SESSION_USER_KEYS,
    'G2-8 GET /session user 字段集合必须与 inspectServerSession 口径一致',
  )
  assert.equal(session.payload.data.user.id, fixture.id.enrolledStudent)
  assert.ok(Array.isArray(session.payload.data.workspaces), 'G2-8 workspaces 必须仍是数组')
  assert.ok(session.payload.data.navigation, 'G2-8 必须仍有 navigation')
  assert.equal(typeof session.payload.data.navigation.defaultPath, 'string')
  assertNoSchoolFields(session.payload, 'G2-8 GET /session')
})
