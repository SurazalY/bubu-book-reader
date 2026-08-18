import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LOGIN_FAILURE_MESSAGE,
  ONBOARDING_PATH,
  SELECT_CLASS_PATH,
  actorUser,
  assertHttpStatus,
  errorOf,
  loginWithSchool,
  loginWithUsername,
  newIdempotencyKey,
  startPhase8App,
} from './harness.guard.test.js'

test('A. POST /auth/login 只接受 {schoolCode, loginName, password} 且登录成功', async (t) => {
  const { fixture, baseUrl } = await startPhase8App(t)
  const response = await loginWithSchool(baseUrl, {
    schoolCode: fixture.schoolCodeA,
    loginName: fixture.login.schoolAdmin,
    password: fixture.password,
  })
  assertHttpStatus(response, 200, 'schoolCode+loginName 登录')
  assert.equal(response.payload.data.user.id, fixture.id.schoolAdmin)
  assert.ok(response.cookie, '登录必须下发 session cookie')
})

test('A. username-only 登录不得再成功', async (t) => {
  const { fixture, baseUrl } = await startPhase8App(t)
  const response = await loginWithUsername(baseUrl, {
    username: fixture.id.schoolAdmin,
    password: fixture.password,
  })
  assert.notEqual(response.status, 200, 'username-only 不得再登录成功')
})

test('A. 登录失败统一 401「学校、账号或密码错误」', async (t) => {
  const { fixture, baseUrl } = await startPhase8App(t)
  const cases = [
    {
      title: '错密码',
      body: { schoolCode: fixture.schoolCodeA, loginName: fixture.login.schoolAdmin, password: 'wrong-password' },
    },
    {
      title: '错 loginName',
      body: { schoolCode: fixture.schoolCodeA, loginName: 'no-such-login', password: fixture.password },
    },
    {
      title: '错 schoolCode',
      body: { schoolCode: 'no-such-school', loginName: fixture.login.schoolAdmin, password: fixture.password },
    },
  ]
  const messages = []
  for (const item of cases) {
    const response = await loginWithSchool(baseUrl, item.body, newIdempotencyKey(item.title))
    assertHttpStatus(response, 401, item.title)
    assert.equal(errorOf(response).code, 'AUTH_REQUIRED', item.title)
    assert.equal(errorOf(response).message, LOGIN_FAILURE_MESSAGE, item.title)
    messages.push(errorOf(response).message)
  }
  assert.ok(messages.every((message) => message === messages[0]), '失败文案必须完全一致以防枚举')
})

test('A. pending 学生登录 200，defaultPath=/student/onboarding，activeWorkspaceId=null', async (t) => {
  const { fixture, baseUrl, module } = await startPhase8App(t)
  const navigation = module.service.navigationForUser(actorUser(module.database, fixture.id.pendingStudent), [])
  assert.equal(navigation.defaultPath, ONBOARDING_PATH, 'navigationForUser 必须产出 pending 学生路径')

  const response = await loginWithSchool(baseUrl, {
    schoolCode: fixture.schoolCodeA,
    loginName: fixture.login.pendingStudent,
    password: fixture.password,
  })
  assertHttpStatus(response, 200, 'pending 学生登录')
  assert.equal(response.payload.data.navigation.defaultPath, ONBOARDING_PATH)
  assert.equal(response.payload.data.activeWorkspaceId, null)
})

test('A. V 成立且零 active 教师班：defaultPath=/console/select-class', async (t) => {
  const { fixture, baseUrl, module } = await startPhase8App(t)
  const navigation = module.service.navigationForUser(actorUser(module.database, fixture.id.zeroWsTeacher), [])
  assert.equal(navigation.defaultPath, SELECT_CLASS_PATH, 'navigationForUser 必须产出零班教师路径')

  const response = await loginWithSchool(baseUrl, {
    schoolCode: fixture.schoolCodeA,
    loginName: fixture.login.zeroWsTeacher,
    password: fixture.password,
  })
  assertHttpStatus(response, 200, '零班教师登录')
  assert.equal(response.payload.data.navigation.defaultPath, SELECT_CLASS_PATH)
  assert.equal(response.payload.data.activeWorkspaceId, null)
})

test('A. 不得把空 defaultPath 当成登录失败', async (t) => {
  const { fixture, baseUrl } = await startPhase8App(t)
  const pending = await loginWithSchool(baseUrl, {
    schoolCode: fixture.schoolCodeA,
    loginName: fixture.login.pendingStudent,
    password: fixture.password,
  })
  assertHttpStatus(pending, 200, '零 workspace 登录仍是 200')
  assert.notEqual(pending.payload?.data?.navigation?.defaultPath, null, 'defaultPath 不得为 null')
  assert.notEqual(pending.payload?.data?.navigation?.defaultPath, '', 'defaultPath 不得为空串')
  assert.ok(
    [ONBOARDING_PATH, SELECT_CLASS_PATH].includes(pending.payload.data.navigation.defaultPath)
      || typeof pending.payload.data.navigation.defaultPath === 'string',
    '登录成功不得把空 defaultPath 当成失败',
  )
})
