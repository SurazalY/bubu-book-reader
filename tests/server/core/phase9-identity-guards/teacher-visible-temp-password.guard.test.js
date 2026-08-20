/**
 * T3-1 守卫：教师重置密码可见（契约 3.3 / D-8，G3-1～G3-10）。
 * 只写测试，不改业务实现、不加 migration、不改既有测试。
 *
 * 病根：教师端能签发重置码、学生端没有消费入口、后端消费接口前端零调用。
 * 本轮产品形态是教师直接看到 6 位临时密码，不是补重置码输入框。
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { ACCOUNT_NOT_FOUND_MESSAGE } from '../../../../server/domains/identity/validation.js'
import {
  assertAuditOmitsSecrets,
  assertErrorCode,
  assertHttpStatus,
  assertOpaque404,
  errorOf,
  loginWithSchool,
  newIdempotencyKey,
  requestJson,
  startPhase8App,
  writeHeaders,
} from '../phase8-identity-guards/harness.guard.test.js'

const TEMP_PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const CONFUSABLE = /[ilo01]/i

function passwordResetPath(userId) {
  return `/users/${userId}/password-reset`
}

function tempPasswordPath(userId) {
  return `/users/${userId}/temp-password`
}

function issueTempPassword(baseUrl, cookie, workspaceId, targetUserId, label) {
  return requestJson(baseUrl, passwordResetPath(targetUserId), {
    method: 'POST',
    headers: writeHeaders({
      cookie,
      workspaceId,
      key: newIdempotencyKey(label ?? 'temp-password-issue'),
    }),
    body: {},
  })
}

function readTempPassword(baseUrl, cookie, workspaceId, targetUserId) {
  return requestJson(baseUrl, tempPasswordPath(targetUserId), {
    headers: writeHeaders({ cookie, workspaceId }),
  })
}

function changeOwnPassword(baseUrl, cookie, body, label) {
  const headers = writeHeaders({ cookie, key: newIdempotencyKey(label) })
  assert.equal(
    Object.hasOwn(headers, 'X-Workspace-Id'),
    false,
    'POST /me/password 必须是 session-only，不得带 X-Workspace-Id',
  )
  return requestJson(baseUrl, '/me/password', {
    method: 'POST',
    headers,
    body,
  })
}

function envelopeData(response) {
  return response.payload?.data
}

function assertSixCharTempPassword(password, detail) {
  assert.equal(typeof password, 'string', `${detail}: 明文密码必须是字符串`)
  assert.equal(password.length, 6, `${detail}: 密码必须恰好 6 位，实际 ${password.length}`)
  for (const character of password) {
    assert.equal(
      TEMP_PASSWORD_ALPHABET.includes(character),
      true,
      `${detail}: 字符 ${JSON.stringify(character)} 不在约定字符集 ${TEMP_PASSWORD_ALPHABET}`,
    )
  }
  assert.equal(CONFUSABLE.test(password), false, `${detail}: 不得含易混字符 i/l/o/0/1`)
}

function assertIssuedPasswordPayload(response, detail) {
  assertHttpStatus(response, 201, detail)
  const data = envelopeData(response)
  assert.equal(data == null, false, `${detail}: 必须走 identity { data } 信封`)
  assert.equal(typeof data, 'object', `${detail}: data 必须是对象`)
  assertSixCharTempPassword(data.newPassword, detail)
  assert.equal(typeof data.issuedAt, 'string', `${detail}: issuedAt 必须是字符串`)
  assert.equal(Number.isFinite(Date.parse(data.issuedAt)), true, `${detail}: issuedAt 必须可解析`)
  return data
}

function assertTempPasswordAvailable(response, expectedPassword, detail) {
  assertHttpStatus(response, 200, detail)
  const data = envelopeData(response)
  assert.equal(data == null, false, `${detail}: 必须走 identity { data } 信封`)
  assert.equal(data.status, 'available', `${detail}: status 必须是 available`)
  assert.equal(data.password, expectedPassword, `${detail}: password 必须与签发明文相同`)
  assert.equal(typeof data.issuedAt, 'string', `${detail}: issuedAt 必须是字符串`)
  return data
}

function assertTempPasswordStatus(response, status, detail) {
  assertHttpStatus(response, 200, detail)
  const data = envelopeData(response)
  assert.equal(data == null, false, `${detail}: 必须走 identity { data } 信封`)
  assert.equal(data.status, status, `${detail}: status 必须是 ${status}`)
  assert.equal(Object.hasOwn(data, 'password'), false, `${detail}: ${status} 态不得带 password`)
  assert.equal(Object.hasOwn(data, 'newPassword'), false, `${detail}: ${status} 态不得带 newPassword`)
  return data
}

function requireIssuedTempPasswordTable(database) {
  const table = database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'issued_temp_passwords'`)
    .get()
  assert.ok(table, 'issued_temp_passwords 表必须存在（迁移 053，T3-2）')
}

function issuedTempPasswordRows(database, targetUserId) {
  requireIssuedTempPasswordTable(database)
  return database
    .prepare(
      `SELECT target_user_id AS targetUserId, plaintext
       FROM issued_temp_passwords
       WHERE target_user_id = ?`,
    )
    .all(targetUserId)
}

function passwordHashOf(database, userId) {
  return database.prepare('SELECT password_hash FROM credentials WHERE user_id = ?').get(userId)?.password_hash
}

function auditEventCount(database) {
  return database.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count
}

async function withCapturedConsole(fn) {
  const chunks = []
  const tap = (original) => (...args) => {
    chunks.push(args.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(' '))
    return original.apply(console, args)
  }
  const originals = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  }
  console.log = tap(originals.log)
  console.info = tap(originals.info)
  console.warn = tap(originals.warn)
  console.error = tap(originals.error)
  try {
    const result = await fn()
    return { result, logs: chunks.join('\n') }
  } finally {
    console.log = originals.log
    console.info = originals.info
    console.warn = originals.warn
    console.error = originals.error
  }
}

function assertTextOmitsSecrets(blob, secrets, label) {
  const text = String(blob ?? '')
  for (const secret of secrets.filter(Boolean)) {
    assert.equal(text.includes(secret), false, `${label} 不得出现明文密码 ${secret}`)
  }
}

test('G3-1 班主任对本班学生签发返回 201 且密码 6 位无易混字符', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const teacher = cookieFor(fixture.id.classTeacher)
  const issued = await issueTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.enrolledStudent,
    'g31-issue',
  )
  assertIssuedPasswordPayload(issued, 'G3-1 班主任对本班学生签发')
})

test('G3-2 学生用该密码可立即登录成功且旧密码失效', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const teacher = cookieFor(fixture.id.classTeacher)
  const issued = await issueTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.enrolledStudent,
    'g32-issue',
  )
  const data = assertIssuedPasswordPayload(issued, 'G3-2 签发')

  const oldLogin = await loginWithSchool(baseUrl, {
    loginName: fixture.login.enrolledStudent,
    password: fixture.password,
  })
  assert.notEqual(oldLogin.status, 200, 'G3-2 重置前的旧密码不得再登录成功')
  assertHttpStatus(oldLogin, 401, 'G3-2 旧密码登录失败')

  const newLogin = await loginWithSchool(baseUrl, {
    loginName: fixture.login.enrolledStudent,
    password: data.newPassword,
  })
  assertHttpStatus(newLogin, 200, 'G3-2 学生用临时密码立即登录成功')
  assert.equal(newLogin.payload.data.user.id, fixture.id.enrolledStudent)
})

test('G3-3 重置会踢掉该学生所有既有会话', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const firstSession = cookieFor(fixture.id.enrolledStudent)
  const secondSession = cookieFor(fixture.id.enrolledStudent)
  assert.notEqual(firstSession.header, secondSession.header, 'G3-3 必须拿到两个不同会话 cookie')

  const beforeFirst = await requestJson(baseUrl, '/session', { headers: { Cookie: firstSession.header } })
  const beforeSecond = await requestJson(baseUrl, '/session', { headers: { Cookie: secondSession.header } })
  assertHttpStatus(beforeFirst, 200, 'G3-3 签发前会话 1 必须有效')
  assertHttpStatus(beforeSecond, 200, 'G3-3 签发前会话 2 必须有效')

  const teacher = cookieFor(fixture.id.classTeacher)
  const issued = await issueTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.enrolledStudent,
    'g33-issue',
  )
  assertIssuedPasswordPayload(issued, 'G3-3 签发')

  const afterFirst = await requestJson(baseUrl, '/session', { headers: { Cookie: firstSession.header } })
  const afterSecond = await requestJson(baseUrl, '/session', { headers: { Cookie: secondSession.header } })
  assert.notEqual(afterFirst.status, 200, 'G3-3 会话 1 必须不再是已登录（revokeAllSessionsForUser，不是保留当前）')
  assert.notEqual(afterSecond.status, 200, 'G3-3 会话 2 必须不再是已登录')
  assertHttpStatus(afterFirst, 401, 'G3-3 会话 1 GET /session')
  assertHttpStatus(afterSecond, 401, 'G3-3 会话 2 GET /session')
})

test('G3-4 教师对他班学生 403、对教师账号 403、跨组织 404（与 password_reset.student.issue 一致）', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const teacher = cookieFor(fixture.id.classTeacher)

  const otherClass = await issueTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.classBStudent,
    'g34-other-class',
  )
  assertHttpStatus(otherClass, 403, 'G3-4 教师不得重置他班学生')
  assertErrorCode(otherClass, 'PERMISSION_DENIED', 'G3-4 他班学生')

  const teacherTarget = await issueTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.classBTeacher,
    'g34-teacher-target',
  )
  assertHttpStatus(teacherTarget, 403, 'G3-4 教师不得重置教师账号')
  assertErrorCode(teacherTarget, 'PERMISSION_DENIED', 'G3-4 教师账号')

  const foreign = await issueTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.otherStudent,
    'g34-foreign',
  )
  const missing = await issueTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    randomUUID(),
    'g34-missing',
  )
  assertOpaque404(foreign, missing, 'G3-4 教师重置跨组织/不存在')
  assert.equal(errorOf(foreign).message, ACCOUNT_NOT_FOUND_MESSAGE, 'G3-4 跨组织必须是账号不存在，不得与缺路由「资源不存在」同文案')
})

test('G3-5 GET /temp-password 的权限与 scope 判定与签发接口完全相同', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const teacher = cookieFor(fixture.id.classTeacher)
  const scenarios = [
    {
      title: '他班学生',
      userId: fixture.id.classBStudent,
      expected: 403,
      code: 'PERMISSION_DENIED',
      key: 'g35-other-class',
    },
    {
      title: '教师账号',
      userId: fixture.id.classBTeacher,
      expected: 403,
      code: 'PERMISSION_DENIED',
      key: 'g35-teacher-target',
    },
    {
      title: '跨组织学生',
      userId: fixture.id.otherStudent,
      expected: 404,
      code: 'RESOURCE_NOT_FOUND',
      key: 'g35-foreign',
    },
  ]

  for (const scenario of scenarios) {
    const posted = await issueTempPassword(
      baseUrl,
      teacher.header,
      fixture.id.classAWs,
      scenario.userId,
      scenario.key,
    )
    const got = await readTempPassword(baseUrl, teacher.header, fixture.id.classAWs, scenario.userId)
    assertHttpStatus(posted, scenario.expected, `G3-5 POST ${scenario.title}`)
    assertHttpStatus(got, scenario.expected, `G3-5 GET ${scenario.title}`)
    assertErrorCode(posted, scenario.code, `G3-5 POST ${scenario.title}`)
    assertErrorCode(got, scenario.code, `G3-5 GET ${scenario.title}`)
    assert.equal(
      posted.status,
      got.status,
      `G3-5 ${scenario.title}: 签发与读取必须同状态码，不得能签发却看不了或反之`,
    )
  }

  const missingId = randomUUID()
  const postMissing = await issueTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    missingId,
    'g35-missing',
  )
  const getMissing = await readTempPassword(baseUrl, teacher.header, fixture.id.classAWs, missingId)
  const postForeign = await issueTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.otherStudent,
    'g35-foreign-pair',
  )
  const getForeign = await readTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.otherStudent,
  )
  assertOpaque404(postForeign, postMissing, 'G3-5 POST 跨组织/不存在')
  assertOpaque404(getForeign, getMissing, 'G3-5 GET 跨组织/不存在')
  assert.equal(errorOf(postForeign).message, ACCOUNT_NOT_FOUND_MESSAGE)
  assert.equal(errorOf(getForeign).message, ACCOUNT_NOT_FOUND_MESSAGE)

  const issued = await issueTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.enrolledStudent,
    'g35-allow',
  )
  const data = assertIssuedPasswordPayload(issued, 'G3-5 能签发')
  const readable = await readTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.enrolledStudent,
  )
  assertTempPasswordAvailable(readable, data.newPassword, 'G3-5 能签发就必须能看')
})

test('G3-5 POST password-reset 与 GET temp-password 都不是 session-only', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const teacher = cookieFor(fixture.id.classTeacher)

  const postHeaders = writeHeaders({
    cookie: teacher.header,
    key: newIdempotencyKey('g35-post-no-ws'),
  })
  assert.equal(Object.hasOwn(postHeaders, 'X-Workspace-Id'), false)
  const posted = await requestJson(baseUrl, passwordResetPath(fixture.id.enrolledStudent), {
    method: 'POST',
    headers: postHeaders,
    body: {},
  })
  assertHttpStatus(posted, 400, 'G3-5 签发缺 X-Workspace-Id 必须 400，不得当 session-only 成功')
  assertErrorCode(posted, 'VALIDATION_FAILED', 'G3-5 签发缺工作空间')

  const getHeaders = writeHeaders({ cookie: teacher.header })
  assert.equal(Object.hasOwn(getHeaders, 'X-Workspace-Id'), false)
  const got = await requestJson(baseUrl, tempPasswordPath(fixture.id.enrolledStudent), {
    headers: getHeaders,
  })
  assertHttpStatus(got, 400, 'G3-5 读取缺 X-Workspace-Id 必须 400，不得当 session-only 成功')
  assertErrorCode(got, 'VALIDATION_FAILED', 'G3-5 读取缺工作空间')
})

test('G3-6 老师可以重复读取同一个临时密码（不是一次性）', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const teacher = cookieFor(fixture.id.classTeacher)

  const before = await readTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.enrolledStudent,
  )
  assertTempPasswordStatus(before, 'none', 'G3-6 从未签发过必须是 none')

  const issued = await issueTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.enrolledStudent,
    'g36-issue',
  )
  const data = assertIssuedPasswordPayload(issued, 'G3-6 签发')

  const first = await readTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.enrolledStudent,
  )
  const second = await readTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.enrolledStudent,
  )
  const firstData = assertTempPasswordAvailable(first, data.newPassword, 'G3-6 第一次读取')
  const secondData = assertTempPasswordAvailable(second, data.newPassword, 'G3-6 第二次读取')
  assert.equal(firstData.password, secondData.password, 'G3-6 两次读取必须是同一明文')
  assert.equal(firstData.issuedAt, secondData.issuedAt, 'G3-6 重复读取不得重新签发')
  assert.equal(firstData.issuedAt, data.issuedAt, 'G3-6 读取的 issuedAt 必须与签发时相同')
})

test('G3-7 学生自助改密后 GET 返回 cleared 且明文行已删除', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  const teacher = cookieFor(fixture.id.classTeacher)
  const issued = await issueTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.enrolledStudent,
    'g37-issue',
  )
  const data = assertIssuedPasswordPayload(issued, 'G3-7 签发')

  const studentLogin = await loginWithSchool(baseUrl, {
    loginName: fixture.login.enrolledStudent,
    password: data.newPassword,
  })
  assertHttpStatus(studentLogin, 200, 'G3-7 学生用临时密码登录')
  assert.ok(studentLogin.cookie, 'G3-7 登录必须下发 cookie')

  const selfChanged = await changeOwnPassword(
    baseUrl,
    studentLogin.cookie,
    { oldPassword: data.newPassword, newPassword: 'changed-by-student-g37' },
    'g37-me-password',
  )
  assertHttpStatus(selfChanged, 200, 'G3-7 学生 POST /me/password（session-only）')

  const cleared = await readTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.enrolledStudent,
  )
  assertTempPasswordStatus(cleared, 'cleared', 'G3-7 教师再 GET 必须是 cleared，不是 none/available')
  assert.equal(
    issuedTempPasswordRows(module.database, fixture.id.enrolledStudent).length,
    0,
    'G3-7 issued_temp_passwords 中该 target_user_id 行必须已删除',
  )
})

test('G3-8 再次重置会覆盖旧明文且 target_user_id 唯一约束生效', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  const teacher = cookieFor(fixture.id.classTeacher)

  const first = await issueTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.enrolledStudent,
    'g38-issue-1',
  )
  const firstData = assertIssuedPasswordPayload(first, 'G3-8 第一次签发')

  const second = await issueTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.enrolledStudent,
    'g38-issue-2',
  )
  const secondData = assertIssuedPasswordPayload(second, 'G3-8 第二次签发')
  assert.notEqual(secondData.newPassword, firstData.newPassword, 'G3-8 再次重置必须生成新明文')

  const got = await readTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.enrolledStudent,
  )
  assertTempPasswordAvailable(got, secondData.newPassword, 'G3-8 GET 只能读到第二次的密码')
  assert.notEqual(got.payload.data.password, firstData.newPassword, 'G3-8 旧明文不得再被读到')

  const rows = issuedTempPasswordRows(module.database, fixture.id.enrolledStudent)
  assert.equal(rows.length, 1, 'G3-8 同一 target_user_id 在 issued_temp_passwords 中必须只有一行')
  assert.equal(rows[0].plaintext, secondData.newPassword, 'G3-8 库中明文必须是第二次签发值')
})

test('G3-9 审计事件、错误响应、日志与列表接口不出现明文密码', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  const teacher = cookieFor(fixture.id.classTeacher)
  const beforeCount = auditEventCount(module.database)

  const { result: issued, logs } = await withCapturedConsole(() =>
    issueTempPassword(
      baseUrl,
      teacher.header,
      fixture.id.classAWs,
      fixture.id.enrolledStudent,
      'g39-issue',
    ),
  )
  const data = assertIssuedPasswordPayload(issued, 'G3-9 签发成功路径')
  const plaintext = data.newPassword
  assert.ok(auditEventCount(module.database) > beforeCount, 'G3-9 签发成功必须新增审计事件')

  const passwordHash = passwordHashOf(module.database, fixture.id.enrolledStudent)
  assertAuditOmitsSecrets(module.database, [plaintext, fixture.password, passwordHash])
  assertTextOmitsSecrets(logs, [plaintext], 'G3-9 服务端 console')

  const forbidden = await issueTempPassword(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.classBStudent,
    'g39-forbidden',
  )
  assertHttpStatus(forbidden, 403, 'G3-9 错误路径（他班 403）')
  assertTextOmitsSecrets(
    [forbidden.text, JSON.stringify(forbidden.payload)],
    [plaintext],
    'G3-9 错误响应',
  )

  const userDetail = await requestJson(baseUrl, `/users/${fixture.id.enrolledStudent}`, {
    headers: writeHeaders({ cookie: teacher.header, workspaceId: fixture.id.classAWs }),
  })
  assertHttpStatus(userDetail, 200, 'G3-9 GET /users/:id')
  assertTextOmitsSecrets(
    [userDetail.text, JSON.stringify(userDetail.payload)],
    [plaintext],
    'G3-9 GET /users/:id',
  )

  const oldResetList = await requestJson(
    baseUrl,
    `/users/${fixture.id.enrolledStudent}/password-reset-credentials`,
    { headers: writeHeaders({ cookie: teacher.header, workspaceId: fixture.id.classAWs }) },
  )
  assertHttpStatus(oldResetList, 200, 'G3-9 旧重置码列表仍可访问')
  assertTextOmitsSecrets(
    [oldResetList.text, JSON.stringify(oldResetList.payload)],
    [plaintext],
    'G3-9 GET /users/:id/password-reset-credentials',
  )
})

test('G3-10 学生角色调用这两个接口一律 403，无法读取任何人的临时密码（包括自己的）', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const student = cookieFor(fixture.id.enrolledStudent)
  const session = await requestJson(baseUrl, '/session', { headers: { Cookie: student.header } })
  assertHttpStatus(session, 200, 'G3-10 学生会话必须仍有效（测角色权限，不先签发、不踩 revokeAllSessionsForUser）')

  const targets = [
    { title: '自己', userId: fixture.id.enrolledStudent },
    { title: '他班学生', userId: fixture.id.classBStudent },
  ]

  for (const target of targets) {
    const posted = await issueTempPassword(
      baseUrl,
      student.header,
      fixture.id.classAWs,
      target.userId,
      `g310-post-${target.title}`,
    )
    const got = await readTempPassword(baseUrl, student.header, fixture.id.classAWs, target.userId)
    assertHttpStatus(posted, 403, `G3-10 学生签发${target.title}`)
    assertHttpStatus(got, 403, `G3-10 学生读取${target.title}的临时密码`)
    assertErrorCode(posted, 'PERMISSION_DENIED', `G3-10 学生签发${target.title}`)
    assertErrorCode(got, 'PERMISSION_DENIED', `G3-10 学生读取${target.title}`)
    assert.notEqual(got.status, 200, `G3-10 学生不得以 available/cleared/none 读到${target.title}的临时密码`)
  }
})
