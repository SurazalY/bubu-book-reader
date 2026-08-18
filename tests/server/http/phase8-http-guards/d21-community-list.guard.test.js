import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PROJECTIONS_PATH,
  QUOTE_UNAVAILABLE,
  VISIBILITY_SOURCE_PATH,
  createTextBook,
  grantCurrentBookToClass,
  insertCommunityPost,
  loginWithSchool,
  readSource,
  requestJson,
  startPhase8HttpApp,
} from './shared-harness.guard.test.js'

function loginStudentA(baseUrl, fixture) {
  return loginWithSchool(baseUrl, {
    schoolCode: fixture.schoolCode,
    loginName: fixture.login.studentA,
    password: fixture.password,
  })
}

function findPost(payload, postId) {
  const items = payload?.data?.items
  assert.ok(Array.isArray(items), `GET /community/posts 必须返回 data.items 数组，实际 ${JSON.stringify(payload)?.slice(0, 300)}`)
  return items.find((item) => item.id === postId)
}

function assertQuoteHidden(item, originalText, detail) {
  assert.ok(item, `${detail}: 帖子必须保留在列表里，不得整项删除`)
  assert.ok(item.quote, `${detail}: quote 上下文必须保留`)
  assert.ok(item.quote.bookId, `${detail}: 不可见时仍返回 bookId`)
  assert.equal(item.quote.page, 1, `${detail}: 不可见时仍返回 page`)
  assert.equal(item.quote.text, null, `${detail}: quote.text 必须为 null`)
  assert.equal(item.quote.availability, QUOTE_UNAVAILABLE, `${detail}: availability 必须为 unavailable`)
  assert.notEqual(item.quote.text, originalText, `${detail}: 不得继续返回原文`)
}

function assertQuoteVisible(item, originalText, detail) {
  assert.ok(item, `${detail}: 帖子必须在列表里`)
  assert.equal(item.quote.text, originalText, `${detail}: 有 grant 必须返回原文`)
  assert.notEqual(item.quote.availability, QUOTE_UNAVAILABLE, `${detail}: 可见时不得标 unavailable`)
}

test('D. projectCommunityPosts 必须接到与 T8.4 同一 isBookVisibleToAudience', () => {
  const projections = readSource(PROJECTIONS_PATH)
  const visibility = readSource(VISIBILITY_SOURCE_PATH)
  assert.match(visibility, /export function isBookVisibleToAudience/, 'T8.4 谓词必须仍在 visibility.js')
  assert.match(
    projections,
    /isBookVisibleToAudience/,
    'projectCommunityPosts 必须调用 isBookVisibleToAudience；只改 getPost 不算修完 D-21',
  )
  const fnStart = projections.indexOf('export function projectCommunityPosts')
  assert.ok(fnStart >= 0, '必须仍导出 projectCommunityPosts')
  const nextExport = projections.indexOf('export function', fnStart + 1)
  const body = projections.slice(fnStart, nextExport > 0 ? nextExport : undefined)
  assert.match(body, /isBookVisibleToAudience/, '调用点必须在 projectCommunityPosts 函数体内')
})

test('D-21 HTTP：GET /community/posts 无 grant 时保留帖子但 quote.text=null', async (t) => {
  const { application, fixture, baseUrl } = await startPhase8HttpApp(t)
  const book = await createTextBook(application, fixture, { title: '无授权引用书' })
  const postId = insertCommunityPost(application.database, fixture, {
    bookId: book.bookId,
    quoteText: book.quoteText,
  })
  const student = await loginStudentA(baseUrl, fixture)
  const response = await requestJson(baseUrl, student, '/community/posts', {
    workspaceId: fixture.wsClassA,
  })
  assert.equal(response.status, 200, `GET /community/posts 必须 200，实际 ${response.status} ${JSON.stringify(response.payload)?.slice(0, 300)}`)
  assertQuoteHidden(findPost(response.payload, postId), book.quoteText, '无 grant')
})

test('D-21 HTTP：GET /community/posts 仅他班 grant 时隐藏原文', async (t) => {
  const { application, fixture, baseUrl } = await startPhase8HttpApp(t)
  const book = await createTextBook(application, fixture, { title: '他班授权引用书' })
  grantCurrentBookToClass(application.database, {
    bookId: book.bookId,
    classId: fixture.classBId,
    organizationId: fixture.organizationId,
    actorId: fixture.teacherB,
  })
  const postId = insertCommunityPost(application.database, fixture, {
    bookId: book.bookId,
    quoteText: book.quoteText,
  })
  const student = await loginStudentA(baseUrl, fixture)
  const response = await requestJson(baseUrl, student, '/community/posts', {
    workspaceId: fixture.wsClassA,
  })
  assert.equal(response.status, 200, JSON.stringify(response.payload)?.slice(0, 300))
  assertQuoteHidden(findPost(response.payload, postId), book.quoteText, '他班 grant')
})

test('D-21 HTTP：GET /community/posts 对 draft 书隐藏原文', async (t) => {
  const { application, fixture, baseUrl } = await startPhase8HttpApp(t)
  const book = await createTextBook(application, fixture, { title: '草稿引用书', published: false })
  grantCurrentBookToClass(application.database, {
    bookId: book.bookId,
    classId: fixture.classAId,
    organizationId: fixture.organizationId,
    actorId: fixture.teacherA,
  })
  const postId = insertCommunityPost(application.database, fixture, {
    bookId: book.bookId,
    quoteText: book.quoteText,
  })
  const student = await loginStudentA(baseUrl, fixture)
  const response = await requestJson(baseUrl, student, '/community/posts', {
    workspaceId: fixture.wsClassA,
  })
  assert.equal(response.status, 200, JSON.stringify(response.payload)?.slice(0, 300))
  assertQuoteHidden(findPost(response.payload, postId), book.quoteText, 'draft')
})

test('D-21 HTTP：GET /community/posts 有本班 grant 仍返原文', async (t) => {
  const { application, fixture, baseUrl } = await startPhase8HttpApp(t)
  const book = await createTextBook(application, fixture, { title: '可见引用书' })
  grantCurrentBookToClass(application.database, {
    bookId: book.bookId,
    classId: fixture.classAId,
    organizationId: fixture.organizationId,
    actorId: fixture.teacherA,
  })
  const postId = insertCommunityPost(application.database, fixture, {
    bookId: book.bookId,
    quoteText: book.quoteText,
  })
  const student = await loginStudentA(baseUrl, fixture)
  const response = await requestJson(baseUrl, student, '/community/posts', {
    workspaceId: fixture.wsClassA,
  })
  assert.equal(response.status, 200, JSON.stringify(response.payload)?.slice(0, 300))
  assertQuoteVisible(findPost(response.payload, postId), book.quoteText, '有 grant')
})
