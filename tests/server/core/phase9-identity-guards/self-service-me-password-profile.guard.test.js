/**
 * T6-1 守卫：自助改密与改名（契约 3.6.1）。
 * 只写测试，不改业务实现、不加 migration。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { hashPassword } from '../../../../server/auth/password.js'
import {
  IDENTITY_INDEX_PATH,
  INTEGRATION_ROUTER_PATH,
  actorUser,
  assertHttpStatus,
  auditText,
  extractRouteBlock,
  loginWithSchool,
  newIdempotencyKey,
  readSource,
  requestJson,
  startPhase8App,
  writeHeaders,
} from '../phase8-identity-guards/harness.guard.test.js'

const ME_PASSWORD = '/me/password'
const ME_PROFILE = '/me/profile'
const SESSION_ONLY_ME_ROUTES = [
  ['post', ME_PASSWORD],
  ['patch', ME_PROFILE],
]
const OLD_PLAINTEXT_G611 = 'old-secret-PLAINTEXT-g611'
const NEW_PLAINTEXT_G611 = 'new-secret-PLAINTEXT-g611'

function passwordHashOf(database, userId) {
  const row = database.prepare('SELECT password_hash FROM credentials WHERE user_id = ?').get(userId)
  assert.ok(row?.password_hash, `用户必须已有 password_hash: ${userId}`)
  return row.password_hash
}

function assertPasswordHashUnchanged(before, after, detail) {
  assert.equal(typeof before, 'string', `${detail}: 改前 hash 必须存在`)
  assert.equal(typeof after, 'string', `${detail}: 改后 hash 必须存在`)
  assert.equal(
    Buffer.from(before, 'utf8').equals(Buffer.from(after, 'utf8')),
    true,
    `${detail}: password_hash 必须字节级未变`,
  )
}

function sessionWriteHeaders(cookie, key) {
  const headers = writeHeaders({ cookie, key })
  assert.equal(
    Object.hasOwn(headers, 'X-Workspace-Id'),
    false,
    'session-only 请求不得带 X-Workspace-Id',
  )
  return headers
}

function changePassword(baseUrl, cookie, body, label) {
  return requestJson(baseUrl, ME_PASSWORD, {
    method: 'POST',
    headers: sessionWriteHeaders(cookie, newIdempotencyKey(label)),
    body,
  })
}

function patchProfile(baseUrl, cookie, body, label) {
  return requestJson(baseUrl, ME_PROFILE, {
    method: 'PATCH',
    headers: sessionWriteHeaders(cookie, newIdempotencyKey(label)),
    body,
  })
}

function assertHttpSuccess(response, detail) {
  assert.ok(
    response.status >= 200 && response.status < 300,
    `${detail} 期望成功 2xx，实际 ${response.status} body=${JSON.stringify(response.payload)?.slice(0, 500)}`,
  )
}

function assertFailedButRouteExists(response, detail) {
  assert.notEqual(
    response.status,
    404,
    `${detail}：接口必须已挂上，不得以 404 冒充失败 body=${JSON.stringify(response.payload)?.slice(0, 400)}`,
  )
  assert.ok(
    response.status < 200 || response.status >= 300,
    `${detail} 必须失败，实际 ${response.status} body=${JSON.stringify(response.payload)?.slice(0, 400)}`,
  )
}

function setUserPassword(database, userId, password) {
  const now = new Date().toISOString()
  const result = database
    .prepare(
      `UPDATE credentials
       SET password_hash = ?, updated_at = ?, version = version + 1
       WHERE user_id = ?`,
    )
    .run(hashPassword(password), now, userId)
  assert.equal(result.changes, 1, `测试夹具必须能改写 ${userId} 的 password_hash`)
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

function persistenceBlob(database) {
  const idempotency = database.prepare('SELECT * FROM idempotency_records').all()
  return [auditText(database), JSON.stringify(idempotency)].join('\n')
}

function assertOmitsPlaintext({ response, database, logs }, secrets, label) {
  const haystacks = [
    ['HTTP 响应正文', String(response.text ?? '')],
    ['HTTP JSON', JSON.stringify(response.payload ?? null)],
    ['审计与幂等落库', persistenceBlob(database)],
    ['服务端 console', String(logs ?? '')],
  ]
  for (const secret of secrets) {
    assert.ok(secret, `${label}: 秘密片段不得为空`)
    for (const [where, blob] of haystacks) {
      assert.equal(
        blob.includes(secret),
        false,
        `${label}: ${where} 不得出现密码明文 ${secret}`,
      )
    }
  }
}

test('G6-1 POST /me/password 与 PATCH /me/profile 必须挂 identity router，块内不得 requireWorkspace / service.authorize(', () => {
  const identity = readSource(IDENTITY_INDEX_PATH)
  for (const [method, path] of SESSION_ONLY_ME_ROUTES) {
    const block = extractRouteBlock(identity, method, path)
    assert.ok(block.length > 0, `identity router 必须挂载 ${method.toUpperCase()} ${path}`)
    assert.match(block, /requireSession/, `${path} 必须是 session-only（requireSession）`)
    assert.equal(
      /requireWorkspace/.test(block),
      false,
      `${path} 块内不得出现 requireWorkspace`,
    )
    assert.equal(
      /service\.authorize\(/.test(block),
      false,
      `${path} 块内不得出现 service.authorize(`,
    )
    assert.match(block, /idempotencyKey\s*\(\s*req\s*\)/, `${path} 必须调用 idempotencyKey(req)`)
    assert.match(block, /executeIdempotent/, `${path} 必须走 executeIdempotent`)
  }
})

test('G6-1 POST /me/password 与 PATCH /me/profile 不得出现在 integration-router.js', () => {
  const integration = readSource(INTEGRATION_ROUTER_PATH)
  for (const [, path] of SESSION_ONLY_ME_ROUTES) {
    assert.equal(
      new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(integration),
      false,
      `integration-router 不得挂载 ${path}`,
    )
  }
})

test('G6-2 未登录调用 POST /me/password 与 PATCH /me/profile → 401', async (t) => {
  const { fixture, baseUrl } = await startPhase8App(t)
  const password = await requestJson(baseUrl, ME_PASSWORD, {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey('g62-password') },
    body: { oldPassword: fixture.password, newPassword: 'newpass-g62' },
  })
  assertHttpStatus(password, 401, 'G6-2 未登录改密')

  const profile = await requestJson(baseUrl, ME_PROFILE, {
    method: 'PATCH',
    headers: { 'Idempotency-Key': newIdempotencyKey('g62-profile') },
    body: { displayName: '未登录改名' },
  })
  assertHttpStatus(profile, 401, 'G6-2 未登录改名')
})

test('G6-3 已登录但不带 X-Workspace-Id 时改密与改名仍能成功', async (t) => {
  const { fixture, baseUrl } = await startPhase8App(t)
  const login = await loginWithSchool(baseUrl, {
    loginName: fixture.login.enrolledStudent,
    password: fixture.password,
  })
  assertHttpStatus(login, 200, 'G6-3 两字段登录')
  assert.ok(login.cookie, 'G6-3 登录必须下发 cookie')

  const renamed = await patchProfile(
    baseUrl,
    login.cookie,
    { displayName: '无工作空间头改名' },
    'g63-profile',
  )
  assertHttpSuccess(renamed, 'G6-3 不带 X-Workspace-Id 改名')

  const changed = await changePassword(
    baseUrl,
    login.cookie,
    { oldPassword: fixture.password, newPassword: 'newpass-g63' },
    'g63-password',
  )
  assertHttpSuccess(changed, 'G6-3 不带 X-Workspace-Id 改密')
})

test('G6-4 缺 Idempotency-Key → 400', async (t) => {
  const { fixture, baseUrl } = await startPhase8App(t)
  const login = await loginWithSchool(baseUrl, {
    loginName: fixture.login.enrolledStudent,
    password: fixture.password,
  })
  assertHttpStatus(login, 200, 'G6-4 登录')

  const passwordHeaders = writeHeaders({ cookie: login.cookie })
  assert.equal(Object.hasOwn(passwordHeaders, 'Idempotency-Key'), false)
  assert.equal(Object.hasOwn(passwordHeaders, 'X-Workspace-Id'), false)
  const password = await requestJson(baseUrl, ME_PASSWORD, {
    method: 'POST',
    headers: passwordHeaders,
    body: { oldPassword: fixture.password, newPassword: 'newpass-g64' },
  })
  assertHttpStatus(password, 400, 'G6-4 改密缺 Idempotency-Key')

  const profileHeaders = writeHeaders({ cookie: login.cookie })
  const profile = await requestJson(baseUrl, ME_PROFILE, {
    method: 'PATCH',
    headers: profileHeaders,
    body: { displayName: '缺幂等键改名' },
  })
  assertHttpStatus(profile, 400, 'G6-4 改名缺 Idempotency-Key')
})

test('G6-5 旧密码错误 → 失败且 password_hash 字节级未变', async (t) => {
  const { fixture, baseUrl, module } = await startPhase8App(t)
  const login = await loginWithSchool(baseUrl, {
    loginName: fixture.login.enrolledStudent,
    password: fixture.password,
  })
  assertHttpStatus(login, 200, 'G6-5 登录')
  const before = passwordHashOf(module.database, fixture.id.enrolledStudent)

  const response = await changePassword(
    baseUrl,
    login.cookie,
    { oldPassword: 'wrong-old-password-g65', newPassword: 'newpass-g65' },
    'g65-wrong-old',
  )
  assertFailedButRouteExists(response, 'G6-5 旧密码错误')
  const after = passwordHashOf(module.database, fixture.id.enrolledStudent)
  assertPasswordHashUnchanged(before, after, 'G6-5')
})

test('G6-6 新密码短于 6 位 → 失败且未改密', async (t) => {
  const { fixture, baseUrl, module } = await startPhase8App(t)
  const login = await loginWithSchool(baseUrl, {
    loginName: fixture.login.enrolledStudent,
    password: fixture.password,
  })
  assertHttpStatus(login, 200, 'G6-6 登录')
  const before = passwordHashOf(module.database, fixture.id.enrolledStudent)

  const response = await changePassword(
    baseUrl,
    login.cookie,
    { oldPassword: fixture.password, newPassword: '12345' },
    'g66-short',
  )
  assertFailedButRouteExists(response, 'G6-6 新密码短于 6 位')
  assert.equal('12345'.length, 5, '本用例必须使用短于 6 位的新密码')
  const after = passwordHashOf(module.database, fixture.id.enrolledStudent)
  assertPasswordHashUnchanged(before, after, 'G6-6')
})

test('G6-7 改密成功后旧密码登录失败、新密码登录成功', async (t) => {
  const { fixture, baseUrl } = await startPhase8App(t)
  const login = await loginWithSchool(baseUrl, {
    loginName: fixture.login.enrolledStudent,
    password: fixture.password,
  })
  assertHttpStatus(login, 200, 'G6-7 登录')
  const newPassword = 'abcdef'
  assert.equal(newPassword.length, 6, 'G6-7 用恰好 6 位新密码钉 D-14 下限')

  const changed = await changePassword(
    baseUrl,
    login.cookie,
    { oldPassword: fixture.password, newPassword },
    'g67-change',
  )
  assertHttpSuccess(changed, 'G6-7 改密')

  const oldLogin = await loginWithSchool(baseUrl, {
    loginName: fixture.login.enrolledStudent,
    password: fixture.password,
  })
  assert.notEqual(oldLogin.status, 200, 'G6-7 旧密码不得再登录成功')
  assertHttpStatus(oldLogin, 401, 'G6-7 旧密码登录失败')

  const newLogin = await loginWithSchool(baseUrl, {
    loginName: fixture.login.enrolledStudent,
    password: newPassword,
  })
  assertHttpStatus(newLogin, 200, 'G6-7 新密码登录成功')
  assert.equal(newLogin.payload.data.user.id, fixture.id.enrolledStudent)
})

test('G6-8 改密成功后当前会话仍有效、其他会话全部失效', async (t) => {
  const { fixture, baseUrl } = await startPhase8App(t)
  const first = await loginWithSchool(
    baseUrl,
    { loginName: fixture.login.enrolledStudent, password: fixture.password },
    newIdempotencyKey('g68-login-1'),
  )
  const second = await loginWithSchool(
    baseUrl,
    { loginName: fixture.login.enrolledStudent, password: fixture.password },
    newIdempotencyKey('g68-login-2'),
  )
  assertHttpStatus(first, 200, 'G6-8 cookie1 登录')
  assertHttpStatus(second, 200, 'G6-8 cookie2 登录')
  assert.ok(first.cookie, 'G6-8 cookie1')
  assert.ok(second.cookie, 'G6-8 cookie2')
  assert.notEqual(first.cookie, second.cookie, 'G6-8 必须拿到两个不同会话 cookie')

  const changed = await changePassword(
    baseUrl,
    first.cookie,
    { oldPassword: fixture.password, newPassword: 'newpass-g68' },
    'g68-change',
  )
  assertHttpSuccess(changed, 'G6-8 用 cookie1 改密')

  const current = await requestJson(baseUrl, '/session', { headers: { Cookie: first.cookie } })
  assertHttpStatus(current, 200, 'G6-8 当前会话 GET /session 必须仍为 200（不得复用会踢掉自己的 revokeAllSessionsForUser）')
  assert.equal(current.payload.data.user.id, fixture.id.enrolledStudent)

  const other = await requestJson(baseUrl, '/session', { headers: { Cookie: second.cookie } })
  assert.notEqual(other.status, 200, 'G6-8 其他会话必须失效')
  assertHttpStatus(other, 401, 'G6-8 其他会话 GET /session 必须失败')
})

test('G6-9 普通学生与无工作空间 pending 学生都能成功调用两个接口', async (t) => {
  const { fixture, baseUrl, module } = await startPhase8App(t)
  const cases = [
    {
      title: '普通学生',
      loginName: fixture.login.enrolledStudent,
      userId: fixture.id.enrolledStudent,
      displayName: '普通学生自助改名',
      newPassword: 'newpass-g69a',
    },
    {
      title: 'pending 学生',
      loginName: fixture.login.pendingStudent,
      userId: fixture.id.pendingStudent,
      displayName: '待审学生自助改名',
      newPassword: 'newpass-g69b',
    },
  ]

  for (const item of cases) {
    const login = await loginWithSchool(baseUrl, {
      loginName: item.loginName,
      password: fixture.password,
    })
    assertHttpStatus(login, 200, `G6-9 ${item.title} 登录`)
    const session = await requestJson(baseUrl, '/session', { headers: { Cookie: login.cookie } })
    assertHttpStatus(session, 200, `G6-9 ${item.title} GET /session`)
    if (item.title === 'pending 学生') {
      assert.equal(
        session.payload.data.activeWorkspaceId ?? null,
        null,
        'G6-9 pending 学生不得依赖工作空间',
      )
    }

    const renamed = await patchProfile(
      baseUrl,
      login.cookie,
      { displayName: item.displayName },
      `g69-profile-${item.title}`,
    )
    assertHttpSuccess(renamed, `G6-9 ${item.title} 改名`)
    assert.equal(actorUser(module.database, item.userId).displayName, item.displayName, `G6-9 ${item.title} display_name`)

    const changed = await changePassword(
      baseUrl,
      login.cookie,
      { oldPassword: fixture.password, newPassword: item.newPassword },
      `g69-password-${item.title}`,
    )
    assertHttpSuccess(changed, `G6-9 ${item.title} 改密`)
  }
})

test('G6-10 PATCH /me/profile 只能改自己', async (t) => {
  const { fixture, baseUrl, module } = await startPhase8App(t)
  const login = await loginWithSchool(baseUrl, {
    loginName: fixture.login.enrolledStudent,
    password: fixture.password,
  })
  assertHttpStatus(login, 200, 'G6-10 登录')
  const otherBefore = actorUser(module.database, fixture.id.classBStudent).displayName
  const selfBefore = actorUser(module.database, fixture.id.enrolledStudent).displayName
  const nextName = '只改自己的显示名'

  const renamed = await patchProfile(baseUrl, login.cookie, { displayName: nextName }, 'g610-self')
  assertHttpSuccess(renamed, 'G6-10 改自己')
  assert.equal(actorUser(module.database, fixture.id.enrolledStudent).displayName, nextName)
  assert.notEqual(nextName, selfBefore, 'G6-10 必须换成与原值不同的 displayName')
  assert.equal(
    actorUser(module.database, fixture.id.classBStudent).displayName,
    otherBefore,
    'G6-10 不得改到别人的 display_name',
  )
})

test('G6-10 displayName 空或超 100 字必须失败且未写入（parseDisplayName 1–100）', async (t) => {
  const { fixture, baseUrl, module } = await startPhase8App(t)
  const login = await loginWithSchool(baseUrl, {
    loginName: fixture.login.enrolledStudent,
    password: fixture.password,
  })
  assertHttpStatus(login, 200, 'G6-10 负例登录')
  const before = actorUser(module.database, fixture.id.enrolledStudent).displayName

  const empty = await patchProfile(baseUrl, login.cookie, { displayName: '' }, 'g610-empty')
  assertFailedButRouteExists(empty, 'G6-10 空 displayName')
  assertHttpStatus(empty, 400, 'G6-10 空 displayName 对齐 parseDisplayName → VALIDATION_FAILED')
  assert.equal(empty.payload?.error?.code, 'VALIDATION_FAILED', 'G6-10 空 displayName 必须走 parseDisplayName')
  assert.equal(actorUser(module.database, fixture.id.enrolledStudent).displayName, before, 'G6-10 空值不得写入')

  const tooLong = '测'.repeat(101)
  assert.equal(tooLong.length, 101)
  const over = await patchProfile(baseUrl, login.cookie, { displayName: tooLong }, 'g610-over')
  assertFailedButRouteExists(over, 'G6-10 超 100 字')
  assertHttpStatus(over, 400, 'G6-10 超 100 字对齐 parseDisplayName')
  assert.equal(over.payload?.error?.code, 'VALIDATION_FAILED', 'G6-10 超 100 字必须走 parseDisplayName')
  assert.equal(actorUser(module.database, fixture.id.enrolledStudent).displayName, before, 'G6-10 超长不得写入')
})

test('G6-11 失败路径：审计与错误响应不得出现密码明文', async (t) => {
  const { fixture, baseUrl, module } = await startPhase8App(t)
  const login = await loginWithSchool(baseUrl, {
    loginName: fixture.login.enrolledStudent,
    password: fixture.password,
  })
  assertHttpStatus(login, 200, 'G6-11 失败路径登录')

  const { result, logs } = await withCapturedConsole(() =>
    changePassword(
      baseUrl,
      login.cookie,
      { oldPassword: OLD_PLAINTEXT_G611, newPassword: NEW_PLAINTEXT_G611 },
      'g611-fail',
    ),
  )
  assert.ok(result.status < 200 || result.status >= 300, 'G6-11 失败路径必须失败（旧密码为独特明文，不可能匹配）')
  assertOmitsPlaintext(
    { response: result, database: module.database, logs },
    [OLD_PLAINTEXT_G611, NEW_PLAINTEXT_G611],
    'G6-11 失败路径',
  )
})

test('G6-11 成功路径：审计与响应不得出现密码明文', async (t) => {
  const { fixture, baseUrl, module } = await startPhase8App(t)
  setUserPassword(module.database, fixture.id.enrolledStudent, OLD_PLAINTEXT_G611)
  const login = await loginWithSchool(baseUrl, {
    loginName: fixture.login.enrolledStudent,
    password: OLD_PLAINTEXT_G611,
  })
  assertHttpStatus(login, 200, 'G6-11 成功路径用独特明文登录')

  const { result, logs } = await withCapturedConsole(() =>
    changePassword(
      baseUrl,
      login.cookie,
      { oldPassword: OLD_PLAINTEXT_G611, newPassword: NEW_PLAINTEXT_G611 },
      'g611-ok',
    ),
  )
  assertHttpSuccess(result, 'G6-11 成功路径改密')
  assertOmitsPlaintext(
    { response: result, database: module.database, logs },
    [OLD_PLAINTEXT_G611, NEW_PLAINTEXT_G611],
    'G6-11 成功路径',
  )
})
