import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertErrorCode,
  assertHttpStatus,
  countBookGrants,
  createTextBook,
  grantCurrentBookToClass,
  loginWithSchool,
  newIdempotencyKey,
  requestJson,
  startPhase8HttpApp,
} from './shared-harness.guard.test.js'

function loginAs(baseUrl, fixture, loginName, schoolCode = fixture.schoolCode) {
  return loginWithSchool(baseUrl, { schoolCode, loginName, password: fixture.password })
}

test('C. 教师全局 publish/unpublish 必须 403，且不得改 grants', async (t) => {
  const { application, fixture, baseUrl } = await startPhase8HttpApp(t)
  const published = await createTextBook(application, fixture, { title: '教师不得下架的书', published: true })
  const draft = await createTextBook(application, fixture, { title: '教师不得发布的书', published: false })
  grantCurrentBookToClass(application.database, {
    bookId: published.bookId,
    classId: fixture.classAId,
    organizationId: fixture.organizationId,
    actorId: fixture.teacherA,
  })
  const teacher = await loginAs(baseUrl, fixture, fixture.login.teacherA)

  const unpublish = await requestJson(baseUrl, teacher, `/books/${published.bookId}/unpublish`, {
    method: 'POST',
    workspaceId: fixture.wsClassA,
    idempotencyKey: newIdempotencyKey('teacher-unpublish'),
    body: {},
  })
  assertHttpStatus(unpublish, 403, '教师 unpublish')
  assertErrorCode(unpublish, 'PERMISSION_DENIED', '教师 unpublish')
  assert.equal(
    application.database.prepare('SELECT status FROM books WHERE id = ?').get(published.bookId).status,
    'published',
  )

  const publish = await requestJson(baseUrl, teacher, `/books/${draft.bookId}/publish`, {
    method: 'POST',
    workspaceId: fixture.wsClassA,
    idempotencyKey: newIdempotencyKey('teacher-publish'),
    body: {},
  })
  assertHttpStatus(publish, 403, '教师 publish')
  assertErrorCode(publish, 'PERMISSION_DENIED', '教师 publish')
  assert.equal(
    application.database.prepare('SELECT status FROM books WHERE id = ?').get(draft.bookId).status,
    'draft',
  )
  assert.equal(
    countBookGrants(application.database, {
      bookId: published.bookId,
      organizationId: fixture.organizationId,
      classId: fixture.classAId,
      granteeType: 'class',
    }),
    1,
    '教师 publish 403 不得动 grants',
  )
})

test('C. 校长与年级主任全局 publish 必须 403', async (t) => {
  const { application, fixture, baseUrl } = await startPhase8HttpApp(t)
  const draft = await createTextBook(application, fixture, { title: '行政不得发布的书', published: false })
  const admin = await loginAs(baseUrl, fixture, fixture.login.schoolAdmin)
  const grade = await loginAs(baseUrl, fixture, fixture.login.gradeManager)

  const adminPublish = await requestJson(baseUrl, admin, `/books/${draft.bookId}/publish`, {
    method: 'POST',
    workspaceId: fixture.wsSchool,
    idempotencyKey: newIdempotencyKey('admin-publish'),
    body: {},
  })
  assertHttpStatus(adminPublish, 403, '校长 publish')
  assertErrorCode(adminPublish, 'PERMISSION_DENIED', '校长 publish')

  const gradePublish = await requestJson(baseUrl, grade, `/books/${draft.bookId}/publish`, {
    method: 'POST',
    workspaceId: fixture.wsGrade,
    idempotencyKey: newIdempotencyKey('grade-publish'),
    body: {},
  })
  assertHttpStatus(gradePublish, 403, '年级主任 publish')
  assertErrorCode(gradePublish, 'PERMISSION_DENIED', '年级主任 publish')
  assert.equal(
    application.database.prepare('SELECT status FROM books WHERE id = ?').get(draft.bookId).status,
    'draft',
  )
})

test('C. platform publish/unpublish 仍 200，且不得创建或清空 grants', async (t) => {
  const { application, fixture, baseUrl } = await startPhase8HttpApp(t)
  const draft = await createTextBook(application, fixture, { title: '平台发布书', published: false })
  const published = await createTextBook(application, fixture, { title: '平台下架书', published: true })
  grantCurrentBookToClass(application.database, {
    bookId: published.bookId,
    classId: fixture.classAId,
    organizationId: fixture.organizationId,
    actorId: fixture.teacherA,
  })
  const grantsBeforeDraft = countBookGrants(application.database, {
    bookId: draft.bookId,
    organizationId: fixture.organizationId,
  })
  const grantsBeforePublished = countBookGrants(application.database, {
    bookId: published.bookId,
    organizationId: fixture.organizationId,
    classId: fixture.classAId,
    granteeType: 'class',
  })
  const platform = await loginAs(baseUrl, fixture, fixture.login.platformOps)

  const publish = await requestJson(baseUrl, platform, `/books/${draft.bookId}/publish`, {
    method: 'POST',
    workspaceId: fixture.wsPlatform,
    idempotencyKey: newIdempotencyKey('ops-publish'),
    body: {},
  })
  assertHttpStatus(publish, 200, 'platform publish')
  assert.equal(application.database.prepare('SELECT status FROM books WHERE id = ?').get(draft.bookId).status, 'published')
  assert.equal(
    countBookGrants(application.database, { bookId: draft.bookId, organizationId: fixture.organizationId }),
    grantsBeforeDraft,
    'platform publish 不得顺带创建 grants',
  )

  const unpublish = await requestJson(baseUrl, platform, `/books/${published.bookId}/unpublish`, {
    method: 'POST',
    workspaceId: fixture.wsPlatform,
    idempotencyKey: newIdempotencyKey('ops-unpublish'),
    body: {},
  })
  assertHttpStatus(unpublish, 200, 'platform unpublish')
  assert.equal(application.database.prepare('SELECT status FROM books WHERE id = ?').get(published.bookId).status, 'draft')
  assert.equal(
    countBookGrants(application.database, {
      bookId: published.bookId,
      organizationId: fixture.organizationId,
      classId: fixture.classAId,
      granteeType: 'class',
    }),
    grantsBeforePublished,
    'platform unpublish 不得清空已有 grants',
  )
})
