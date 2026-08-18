import assert from 'node:assert/strict'
import test from 'node:test'

import {
  INTEGRATION_ROUTER_PATH,
  REAL_DATABASE_PATH,
  assertNotRealDatabasePath,
  isRealDatabasePath,
  loginWithSchool,
  readSource,
  requestJson,
  startPhase8HttpApp,
} from './shared-harness.guard.test.js'

test('G. 临时库路径不得指向真库，独立端口不得为 5191', async (t) => {
  const { databasePath, port } = await startPhase8HttpApp(t)
  assert.equal(isRealDatabasePath(REAL_DATABASE_PATH), true)
  assertNotRealDatabasePath(databasePath)
  assert.notEqual(port, 5191, '独立端口禁止 5191')
})

test('G. 登录后 GET /books 必须打到 integration-router，不得被 identity 兜底吞掉', async (t) => {
  const { fixture, baseUrl, port } = await startPhase8HttpApp(t)
  assert.notEqual(port, 5191)
  const jar = await loginWithSchool(baseUrl, {
    schoolCode: fixture.schoolCode,
    loginName: fixture.login.studentA,
    password: fixture.password,
  })
  const books = await requestJson(baseUrl, jar, '/books', { workspaceId: fixture.wsClassA })
  assert.equal(
    books.status,
    200,
    `GET /books 必须 200 才证明 integration-router 挂上了。实际 ${books.status} ${JSON.stringify(books.payload)?.slice(0, 300)}。identity catch-all 若对未匹配路径直接 404，T8.5B 无法在允许文件内修好 HTTP 契约。`,
  )
})

test('G. 书架路由块不得调用 listAuthorizedClasses', () => {
  const source = readSource(INTEGRATION_ROUTER_PATH)
  const shelfStart = source.indexOf('/classes/:classId/shelf')
  assert.notEqual(shelfStart, -1, 'integration-router 必须注册 /classes/:classId/shelf')
  const window = source.slice(shelfStart, shelfStart + 3500)
  assert.equal(window.includes('listAuthorizedClasses'), false, '书架路由块禁止 listAuthorizedClasses')
})
