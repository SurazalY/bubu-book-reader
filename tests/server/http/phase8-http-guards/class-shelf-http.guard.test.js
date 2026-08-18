import assert from 'node:assert/strict'
import test from 'node:test'

import {
  INTEGRATION_ROUTER_PATH,
  assertForbiddenOrOpaque404,
  assertHttpStatus,
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

function loginAs(baseUrl, fixture, loginName) {
  return loginWithSchool(baseUrl, {
    schoolCode: fixture.schoolCode,
    loginName,
    password: fixture.password,
  })
}

test('B. integration-router 必须注册 class-local 书架路由，且不得调用 listAuthorizedClasses', () => {
  const source = readSource(INTEGRATION_ROUTER_PATH)
  assert.ok(extractRouteBlock(source, 'get', '/classes/:classId/shelf'), '必须有 GET /classes/:classId/shelf')
  assert.ok(extractRouteBlock(source, 'put', '/classes/:classId/shelf/:bookId'), '必须有 PUT /classes/:classId/shelf/:bookId')
  assert.ok(extractRouteBlock(source, 'delete', '/classes/:classId/shelf/:bookId'), '必须有 DELETE /classes/:classId/shelf/:bookId')
  const shelfBlocks = [
    extractRouteBlock(source, 'get', '/classes/:classId/shelf'),
    extractRouteBlock(source, 'put', '/classes/:classId/shelf/:bookId'),
    extractRouteBlock(source, 'delete', '/classes/:classId/shelf/:bookId'),
  ].join('\n')
  assert.equal(
    shelfBlocks.includes('listAuthorizedClasses'),
    false,
    '书架 HTTP 禁止调用 listAuthorizedClasses，只用当前 class workspace 的 teacher assignment',
  )
})

test('B. 教师对本班 PUT/GET/DELETE 书架 200 幂等，只改本班一行', async (t) => {
  const { application, fixture, baseUrl } = await startPhase8HttpApp(t)
  const book = await createTextBook(application, fixture, { title: '本班上架书' })
  const teacher = await loginAs(baseUrl, fixture, fixture.login.teacherA)
  await requireIntegrationReachable(baseUrl, teacher, fixture.wsClassA)

  const putOnce = await requestJson(baseUrl, teacher, `/classes/${fixture.classAId}/shelf/${book.bookId}`, {
    method: 'PUT',
    workspaceId: fixture.wsClassA,
    idempotencyKey: newIdempotencyKey('shelf-put-1'),
    body: {},
  })
  assertHttpStatus(putOnce, 200, '本班首次 PUT')
  const putAgain = await requestJson(baseUrl, teacher, `/classes/${fixture.classAId}/shelf/${book.bookId}`, {
    method: 'PUT',
    workspaceId: fixture.wsClassA,
    idempotencyKey: newIdempotencyKey('shelf-put-2'),
    body: {},
  })
  assertHttpStatus(putAgain, 200, '本班重复 PUT 幂等')
  assert.equal(
    countBookGrants(application.database, {
      bookId: book.bookId,
      organizationId: fixture.organizationId,
      classId: fixture.classAId,
      granteeType: 'class',
    }),
    1,
    '同班同书只能一行 class grant',
  )

  const listed = await requestJson(baseUrl, teacher, `/classes/${fixture.classAId}/shelf`, {
    workspaceId: fixture.wsClassA,
  })
  assertHttpStatus(listed, 200, '本班 GET shelf')
  const items = listed.payload?.data?.items ?? listed.payload?.data
  assert.ok(Array.isArray(items), 'GET shelf 必须返回 items 数组')
  assert.ok(items.some((item) => item.bookId === book.bookId || item.id === book.bookId), 'GET shelf 必须包含已投放书')

  const delOnce = await requestJson(baseUrl, teacher, `/classes/${fixture.classAId}/shelf/${book.bookId}`, {
    method: 'DELETE',
    workspaceId: fixture.wsClassA,
    idempotencyKey: newIdempotencyKey('shelf-del-1'),
  })
  assertHttpStatus(delOnce, 200, '本班首次 DELETE')
  const delAgain = await requestJson(baseUrl, teacher, `/classes/${fixture.classAId}/shelf/${book.bookId}`, {
    method: 'DELETE',
    workspaceId: fixture.wsClassA,
    idempotencyKey: newIdempotencyKey('shelf-del-2'),
  })
  assertHttpStatus(delAgain, 200, '本班重复 DELETE 幂等')
  assert.equal(
    countBookGrants(application.database, {
      bookId: book.bookId,
      organizationId: fixture.organizationId,
      classId: fixture.classAId,
      granteeType: 'class',
    }),
    0,
    '撤下后本班 grant 必须为 0',
  )
})

test('B. 他班或无 C workspace 操作书架必须 403 或 404', async (t) => {
  const { application, fixture, baseUrl } = await startPhase8HttpApp(t)
  const book = await createTextBook(application, fixture, { title: '越权书架书' })
  const teacherA = await loginAs(baseUrl, fixture, fixture.login.teacherA)
  await requireIntegrationReachable(baseUrl, teacherA, fixture.wsClassA)

  const otherClass = await requestJson(baseUrl, teacherA, `/classes/${fixture.classBId}/shelf/${book.bookId}`, {
    method: 'PUT',
    workspaceId: fixture.wsClassA,
    idempotencyKey: newIdempotencyKey('shelf-other-class'),
    body: {},
  })
  assertForbiddenOrOpaque404(otherClass, '教师用本班 workspace 写他班书架')

  const schoolAdmin = await loginAs(baseUrl, fixture, fixture.login.schoolAdmin)
  const noClassWs = await requestJson(baseUrl, schoolAdmin, `/classes/${fixture.classAId}/shelf/${book.bookId}`, {
    method: 'PUT',
    workspaceId: fixture.wsSchool,
    idempotencyKey: newIdempotencyKey('shelf-school-ws'),
    body: {},
  })
  assertForbiddenOrOpaque404(noClassWs, '校长无 C workspace 不得改书架')
})

test('B. 跨组织 classId 与不存在 classId 书架写必须同码同文案 404', async (t) => {
  const { application, fixture, baseUrl } = await startPhase8HttpApp(t)
  const book = await createTextBook(application, fixture, { title: '跨组织书架书' })
  const teacher = await loginAs(baseUrl, fixture, fixture.login.teacherA)
  await requireIntegrationReachable(baseUrl, teacher, fixture.wsClassA)

  const foreign = await requestJson(baseUrl, teacher, `/classes/${fixture.foreignClassId}/shelf/${book.bookId}`, {
    method: 'PUT',
    workspaceId: fixture.wsClassA,
    idempotencyKey: newIdempotencyKey('shelf-foreign'),
    body: {},
  })
  const missing = await requestJson(baseUrl, teacher, `/classes/${fixture.missingClassId}/shelf/${book.bookId}`, {
    method: 'PUT',
    workspaceId: fixture.wsClassA,
    idempotencyKey: newIdempotencyKey('shelf-missing'),
    body: {},
  })
  assertStandardJson404(foreign, '跨组织书架')
  assertStandardJson404(missing, '不存在班级书架')
  assert.equal(foreign.payload.error.message, missing.payload.error.message, '跨组织与不存在必须同文案')
})

test('B. 两名教师并发 PUT 同班同书最终只有一行 grant', async (t) => {
  const { application, fixture, baseUrl } = await startPhase8HttpApp(t)
  const book = await createTextBook(application, fixture, { title: '并发上架书' })
  const teacherA = await loginAs(baseUrl, fixture, fixture.login.teacherA)
  const teacherA2 = await loginAs(baseUrl, fixture, fixture.login.teacherA2)
  await requireIntegrationReachable(baseUrl, teacherA, fixture.wsClassA)

  const [first, second] = await Promise.all([
    requestJson(baseUrl, teacherA, `/classes/${fixture.classAId}/shelf/${book.bookId}`, {
      method: 'PUT',
      workspaceId: fixture.wsClassA,
      idempotencyKey: newIdempotencyKey('shelf-conc-a'),
      body: {},
    }),
    requestJson(baseUrl, teacherA2, `/classes/${fixture.classAId}/shelf/${book.bookId}`, {
      method: 'PUT',
      workspaceId: fixture.wsClassA,
      idempotencyKey: newIdempotencyKey('shelf-conc-a2'),
      body: {},
    }),
  ])
  assertHttpStatus(first, 200, '并发 PUT 教师 A')
  assertHttpStatus(second, 200, '并发 PUT 教师 A2')
  assert.equal(
    countBookGrants(application.database, {
      bookId: book.bookId,
      organizationId: fixture.organizationId,
      classId: fixture.classAId,
      granteeType: 'class',
    }),
    1,
    '并发同班同书必须只剩一行',
  )
})

test('B. 一班撤下不得删除他班 grant', async (t) => {
  const { application, fixture, baseUrl } = await startPhase8HttpApp(t)
  const book = await createTextBook(application, fixture, { title: '跨班隔离书' })
  grantCurrentBookToClass(application.database, {
    bookId: book.bookId,
    classId: fixture.classBId,
    organizationId: fixture.organizationId,
    actorId: fixture.teacherB,
  })
  const teacherA = await loginAs(baseUrl, fixture, fixture.login.teacherA)
  await requireIntegrationReachable(baseUrl, teacherA, fixture.wsClassA)

  const put = await requestJson(baseUrl, teacherA, `/classes/${fixture.classAId}/shelf/${book.bookId}`, {
    method: 'PUT',
    workspaceId: fixture.wsClassA,
    idempotencyKey: newIdempotencyKey('shelf-iso-put'),
    body: {},
  })
  assertHttpStatus(put, 200, 'A 班上架')
  const del = await requestJson(baseUrl, teacherA, `/classes/${fixture.classAId}/shelf/${book.bookId}`, {
    method: 'DELETE',
    workspaceId: fixture.wsClassA,
    idempotencyKey: newIdempotencyKey('shelf-iso-del'),
  })
  assertHttpStatus(del, 200, 'A 班撤下')
  assert.equal(
    countBookGrants(application.database, {
      bookId: book.bookId,
      organizationId: fixture.organizationId,
      classId: fixture.classAId,
      granteeType: 'class',
    }),
    0,
    'A 班 grant 已撤',
  )
  assert.equal(
    countBookGrants(application.database, {
      bookId: book.bookId,
      organizationId: fixture.organizationId,
      classId: fixture.classBId,
      granteeType: 'class',
    }),
    1,
    'B 班 grant 必须仍在',
  )
})
