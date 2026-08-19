import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import {
  IDENTITY_INDEX_PATH,
  INTEGRATION_ROUTER_PATH,
  REAL_DATABASE_PATH,
  assertErrorCode,
  assertHttpStatus,
  assertOpaque404,
  isRealDatabasePath,
  newIdempotencyKey,
  readSource,
  requestJson,
  startPhase8App,
  writeHeaders,
} from './harness.guard.test.js'

test('J. 临时库路径不得是 server/data/readmate.sqlite', async (t) => {
  const harness = await startPhase8App(t)
  assert.equal(isRealDatabasePath(harness.databasePath), false)
  assert.equal(harness.databasePath.replace(/\\/g, '/').toLowerCase().includes('/server/data/readmate.sqlite'), false)
  assert.notEqual(harness.port, 5191)
})

test('J. session-only 与公开注册必须打 identity router，禁止 integration-router', () => {
  const identity = readSource(IDENTITY_INDEX_PATH)
  const integration = readSource(INTEGRATION_ROUTER_PATH)
  assert.match(identity, /export function createIdentityTestApp/)
  assert.match(identity, /app\.use\(\s*['"]\/api\/v1['"]\s*,\s*module\.router/)
  for (const path of ['/onboarding/me', '/teacher/class-directory', '/registration/', '/password-resets/', '/me/password', '/me/profile']) {
    assert.equal(
      new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(integration),
      false,
      `integration-router 不得挂载 ${path}`,
    )
  }
})

test('J. 跨组织 id 与不存在 id 同码同文案 404', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const { header } = cookieFor(fixture.id.schoolAdmin)
  const foreign = await requestJson(baseUrl, `/users/${fixture.id.otherStudent}`, {
    headers: writeHeaders({ cookie: header, workspaceId: fixture.id.schoolAWs }),
  })
  const missing = await requestJson(baseUrl, `/users/${randomUUID()}`, {
    headers: writeHeaders({ cookie: header, workspaceId: fixture.id.schoolAWs }),
  })
  assertOpaque404(foreign, missing, 'GET /users/:id')
})

test('J. 缺失路由不得 fallback 成 200；POST /students 也不得再 200', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const { header } = cookieFor(fixture.id.schoolAdmin)
  const missing = await requestJson(baseUrl, `/__t83a-missing-${randomUUID()}`, {
    headers: writeHeaders({ cookie: header, workspaceId: fixture.id.schoolAWs }),
  })
  assert.notEqual(missing.status, 200, '未知路径不得 fallback 200')
  assertHttpStatus(missing, 404, '未知路径')

  const retired = await requestJson(baseUrl, '/students', {
    method: 'POST',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.classTeacher).header,
      workspaceId: fixture.id.classAWs,
      key: newIdempotencyKey('j-post-students'),
    }),
    body: {
      classId: fixture.id.classA,
      username: `j-ghost-${fixture.suffix}`,
      displayName: 'J不得创建',
      password: fixture.password,
    },
  })
  assert.notEqual(retired.status, 200, 'POST /students 不得再成功')
  assertHttpStatus(retired, 404, 'POST /students 退役')
  assertErrorCode(retired, 'RESOURCE_NOT_FOUND', 'POST /students 标准 404')
})

test('J. 本套守卫只声明真库路径，绝不把 createIdentityTestApp 指向它', async (t) => {
  const harness = await startPhase8App(t)
  assert.ok(REAL_DATABASE_PATH.replace(/\\/g, '/').endsWith('/server/data/readmate.sqlite'))
  assert.equal(isRealDatabasePath(harness.databasePath), false, 'databasePath 不得等于真库')
})
