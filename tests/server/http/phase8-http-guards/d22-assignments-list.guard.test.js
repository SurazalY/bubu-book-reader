import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PROJECTIONS_PATH,
  VISIBILITY_SOURCE_PATH,
  createClassAssignment,
  createTextBook,
  grantCurrentBookToClass,
  loginWithSchool,
  readSource,
  readingDomain,
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

function assignmentItems(payload) {
  const items = payload?.data?.items
  assert.ok(Array.isArray(items), `GET /assignments 必须返回 data.items，实际 ${JSON.stringify(payload)?.slice(0, 300)}`)
  return items
}

function leaksInvisibleBook(item, book) {
  const blob = JSON.stringify(item)
  return (
    blob.includes(book.title)
    || blob.includes(book.bookId)
    || blob.includes(book.versionId)
  )
}

test('E. projectAssignments 必须接到与 T8.4 同一 isBookVisibleToAudience', () => {
  const projections = readSource(PROJECTIONS_PATH)
  const visibility = readSource(VISIBILITY_SOURCE_PATH)
  assert.match(visibility, /export function isBookVisibleToAudience/)
  const fnStart = projections.indexOf('export function projectAssignments')
  assert.ok(fnStart >= 0, '必须仍导出 projectAssignments')
  const nextExport = projections.indexOf('export function', fnStart + 1)
  const body = projections.slice(fnStart, nextExport > 0 ? nextExport : undefined)
  assert.match(body, /isBookVisibleToAudience/, 'projectAssignments 必须调用 isBookVisibleToAudience（book.id 实际是 bookVersionId）')
})

test('D-22 HTTP：GET /assignments 对学生省略无 grant 的书整项', async (t) => {
  const { application, fixture, baseUrl } = await startPhase8HttpApp(t)
  const book = await createTextBook(application, fixture, { title: '不可见安排书' })
  const created = await createClassAssignment(application, fixture, {
    bookVersionId: book.versionId,
    title: '不可见阅读安排',
  })
  const student = await loginStudentA(baseUrl, fixture)
  const response = await requestJson(baseUrl, student, '/assignments', {
    workspaceId: fixture.wsClassA,
  })
  assert.equal(response.status, 200, JSON.stringify(response.payload)?.slice(0, 300))
  const items = assignmentItems(response.payload)
  assert.equal(
    items.some((item) => item.id === created.assignmentId || leaksInvisibleBook(item, book)),
    false,
    `无 grant 时不得返回该安排或其 title/bookId/bookVersionId，实际 ${JSON.stringify(items)}`,
  )
})

test('D-22 HTTP：GET /assignments 仅他班 grant 或 draft 也整项省略', async (t) => {
  const { application, fixture, baseUrl } = await startPhase8HttpApp(t)
  const otherClassBook = await createTextBook(application, fixture, { title: '只授权他班的安排书' })
  grantCurrentBookToClass(application.database, {
    bookId: otherClassBook.bookId,
    classId: fixture.classBId,
    organizationId: fixture.organizationId,
    actorId: fixture.teacherB,
  })
  const otherAssignment = await createClassAssignment(application, fixture, {
    bookVersionId: otherClassBook.versionId,
    title: '他班安排',
  })
  const draft = await createTextBook(application, fixture, { title: '草稿安排书', published: false })
  grantCurrentBookToClass(application.database, {
    bookId: draft.bookId,
    classId: fixture.classAId,
    organizationId: fixture.organizationId,
    actorId: fixture.teacherA,
  })
  const draftAssignment = await createClassAssignment(application, fixture, {
    bookVersionId: draft.versionId,
    title: '草稿安排',
  })
  const student = await loginStudentA(baseUrl, fixture)
  const response = await requestJson(baseUrl, student, '/assignments', {
    workspaceId: fixture.wsClassA,
  })
  assert.equal(response.status, 200, JSON.stringify(response.payload)?.slice(0, 300))
  const items = assignmentItems(response.payload)
  assert.equal(
    items.some((item) => item.id === otherAssignment.assignmentId || leaksInvisibleBook(item, otherClassBook)),
    false,
    '他班 grant 不得向学生投影该书安排',
  )
  assert.equal(
    items.some((item) => item.id === draftAssignment.assignmentId || leaksInvisibleBook(item, draft)),
    false,
    'draft 安排必须整项省略',
  )
})

test('D-22 HTTP：有本班 grant 返回安排；撤下后消失', async (t) => {
  const { application, fixture, baseUrl } = await startPhase8HttpApp(t)
  const book = await createTextBook(application, fixture, { title: '可投放安排书' })
  const created = await createClassAssignment(application, fixture, {
    bookVersionId: book.versionId,
    title: '本班阅读安排',
  })
  grantCurrentBookToClass(application.database, {
    bookId: book.bookId,
    classId: fixture.classAId,
    organizationId: fixture.organizationId,
    actorId: fixture.teacherA,
  })
  const student = await loginStudentA(baseUrl, fixture)
  const visible = await requestJson(baseUrl, student, '/assignments', {
    workspaceId: fixture.wsClassA,
  })
  assert.equal(visible.status, 200, JSON.stringify(visible.payload)?.slice(0, 300))
  const shown = assignmentItems(visible.payload).find((item) => item.id === created.assignmentId)
  assert.ok(shown, '有 grant 必须返回该安排')
  assert.equal(shown.book?.id, book.versionId, 'book.id 必须是 bookVersionId')
  assert.equal(shown.book?.title, book.title)

  const reading = readingDomain(application, fixture.teacherA, fixture.wsClassA, fixture.organizationId)
  await reading.revokeClassLocalShelf({ bookId: book.bookId, classId: fixture.classAId })

  const hidden = await requestJson(baseUrl, student, '/assignments', {
    workspaceId: fixture.wsClassA,
  })
  assert.equal(hidden.status, 200, JSON.stringify(hidden.payload)?.slice(0, 300))
  const items = assignmentItems(hidden.payload)
  assert.equal(
    items.some((item) => item.id === created.assignmentId || leaksInvisibleBook(item, book)),
    false,
    '撤下后安排必须从学生列表消失',
  )
})
