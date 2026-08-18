import assert from 'node:assert/strict'
import test from 'node:test'

import {
  INTEGRATION_ROUTER_PATH,
  assertStandardJson404,
  countBookGrants,
  createTextBook,
  extractRouteBlock,
  grantCurrentBookToClass,
  loginWithSchool,
  newIdempotencyKey,
  readSource,
  requestJson,
  requireIntegrationReachable,
  startPhase8HttpApp,
} from './shared-harness.guard.test.js'

test('A. integration-router 必须删除 GET/PUT /books/:bookId/visibility，无兼容 handler', () => {
  const source = readSource(INTEGRATION_ROUTER_PATH)
  assert.equal(extractRouteBlock(source, 'get', '/books/:bookId/visibility'), '', '必须删除 GET /books/:bookId/visibility')
  assert.equal(extractRouteBlock(source, 'put', '/books/:bookId/visibility'), '', '必须删除 PUT /books/:bookId/visibility')
  assert.equal(
    /router\.(get|put)\(\s*['"`]\/books\/:bookId\/visibility['"`]/.test(source),
    false,
    'integration-router 不得再注册 visibility 路由',
  )
  assert.equal(
    /scope\s*===\s*['"]organization['"]|scope=organization/.test(source),
    false,
    '不得保留 scope=organization 兼容分支',
  )
})

test('A. GET /books/:bookId/visibility 必须是标准 JSON 404，且 integration 链可到达', async (t) => {
  const { application, fixture, baseUrl } = await startPhase8HttpApp(t)
  const book = await createTextBook(application, fixture, { title: '旧可见范围书' })
  const teacher = await loginWithTeacherA(baseUrl, fixture)
  await requireIntegrationReachable(baseUrl, teacher, fixture.wsClassA)

  const response = await requestJson(baseUrl, teacher, `/books/${book.bookId}/visibility`, {
    workspaceId: fixture.wsClassA,
  })
  assertStandardJson404(response, 'GET 旧 visibility')
  assert.equal(response.status, 404)
  assert.notEqual(response.status, 200, '旧 GET visibility 不得再 200')
})

test('A. PUT /books/:bookId/visibility 含 scope=organization 也必须标准 JSON 404，且不得清空他班 grant', async (t) => {
  const { application, fixture, baseUrl } = await startPhase8HttpApp(t)
  const book = await createTextBook(application, fixture, { title: '禁止全量替换 HTTP 书' })
  grantCurrentBookToClass(application.database, {
    bookId: book.bookId,
    classId: fixture.classBId,
    organizationId: fixture.organizationId,
    actorId: fixture.teacherB,
  })
  const teacher = await loginWithTeacherA(baseUrl, fixture)
  await requireIntegrationReachable(baseUrl, teacher, fixture.wsClassA)

  const putOrg = await requestJson(baseUrl, teacher, `/books/${book.bookId}/visibility`, {
    method: 'PUT',
    workspaceId: fixture.wsClassA,
    idempotencyKey: newIdempotencyKey('vis-org'),
    body: { scope: 'organization' },
  })
  assertStandardJson404(putOrg, 'PUT visibility scope=organization')

  const putClasses = await requestJson(baseUrl, teacher, `/books/${book.bookId}/visibility`, {
    method: 'PUT',
    workspaceId: fixture.wsClassA,
    idempotencyKey: newIdempotencyKey('vis-classes'),
    body: { scope: 'classes', classIds: [fixture.classAId] },
  })
  assertStandardJson404(putClasses, 'PUT visibility scope=classes')

  assert.equal(
    countBookGrants(application.database, {
      bookId: book.bookId,
      organizationId: fixture.organizationId,
      classId: fixture.classBId,
      granteeType: 'class',
    }),
    1,
    '旧 visibility 写口不得再清空他班 grant',
  )
})

function loginWithTeacherA(baseUrl, fixture) {
  return loginWithSchool(baseUrl, {
    schoolCode: fixture.schoolCode,
    loginName: fixture.login.teacherA,
    password: fixture.password,
  })
}
