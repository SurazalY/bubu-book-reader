/**
 * T1-1 守卫：共读社区发帖改造（R1 / D-3 / D-4 / D-5 / D-6）。
 * 只断言新契约，不改实现、不改冻结的 D-21 / shared-harness。
 */
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { createCommunityDomain } from '../../../../server/domains/community/index.js'
import {
  QUOTE_UNAVAILABLE,
  assertErrorCode,
  assertHttpStatus,
  createTextBook,
  insertCommunityPost,
  newIdempotencyKey,
  readSource,
  requestJson,
  startPhase8HttpApp,
} from '../phase8-http-guards/shared-harness.guard.test.js'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(dirname(dirname(dirname(here))))
const COMMUNITY_DOMAIN_PATH = join(projectRoot, 'server', 'domains', 'community', 'index.js')

function login(harness, loginName) {
  return harness.login(loginName)
}

function findPost(payload, postId) {
  const items = payload?.data?.items
  assert.ok(Array.isArray(items), `社区列表必须返回 data.items，实际 ${JSON.stringify(payload)?.slice(0, 300)}`)
  return items.find((item) => item.id === postId)
}

function composeBody({ bookId, title, body, scope, quote }) {
  const payload = { title, body, scope }
  if (bookId !== undefined) payload.bookId = bookId
  if (quote !== undefined) payload.quote = quote
  return payload
}

function validQuote(book) {
  return { bookId: book.bookId, page: 1, text: book.quoteText }
}

async function submitPost(baseUrl, jar, workspaceId, body, label) {
  return requestJson(baseUrl, jar, '/community/posts', {
    method: 'POST',
    workspaceId,
    idempotencyKey: newIdempotencyKey(label),
    body,
  })
}

async function reviewPost(baseUrl, jar, workspaceId, postId, label) {
  return requestJson(baseUrl, jar, `/community/posts/${postId}/review`, {
    method: 'POST',
    workspaceId,
    idempotencyKey: newIdempotencyKey(label),
    body: { decision: 'approved', reason: '本班教师人工审核通过' },
  })
}

function studentDetail(application, fixture) {
  return createCommunityDomain({
    db: application.database,
    actor: { id: fixture.studentA, permissions: ['community.submit'] },
    workspace: {
      id: fixture.wsClassA,
      organizationId: fixture.organizationId,
      scopeType: 'class',
      scopeId: fixture.classAId,
    },
  })
}

function insertPostBoundToBook(db, fixture, { bookId, title = '新契约无引文帖', body = '只关联书，不带原文' }) {
  const postId = `post-book-${fixture.suffix}`
  db.prepare(`
    INSERT INTO community_posts (
      id, organization_id_at_creation, workspace_id_at_creation, class_id_at_creation,
      actor_id_at_creation, author_id, scope, title, body,
      quote_book_id, quote_page, quote_text, book_id,
      status, ai_assisted, organization_snapshot_json, workspace_snapshot_json,
      created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, 'class', ?, ?, NULL, NULL, NULL, ?, 'approved', 0, '{}', '{}', ?, ?, 1)
  `).run(
    postId,
    fixture.organizationId,
    fixture.wsClassA,
    fixture.classAId,
    fixture.studentA,
    fixture.studentA,
    title,
    body,
    bookId,
    '2026-08-18T11:00:00.000Z',
    '2026-08-18T11:00:00.000Z',
  )
  return postId
}

function assertQuoteHiddenByD21(item, originalText, detail) {
  assert.ok(item, `${detail}: 帖子必须保留，不得整项删除`)
  assert.ok(item.quote, `${detail}: 存量引文帖的 quote 上下文必须保留`)
  assert.ok(item.quote.bookId, `${detail}: 不可见时仍返回 quote.bookId`)
  assert.equal(item.quote.page, 1, `${detail}: 不可见时仍返回 page`)
  assert.equal(item.quote.text, null, `${detail}: quote.text 必须为 null`)
  assert.equal(item.quote.availability, QUOTE_UNAVAILABLE, `${detail}: availability 必须为 unavailable`)
  assert.notEqual(item.quote.text, originalText, `${detail}: 不得继续返回原文`)
}

function assertNoCatalogLeak(value, bookTitle, detail) {
  const serialized = JSON.stringify(value)
  assert.equal(
    serialized.includes(bookTitle),
    false,
    `${detail}: 不可见书不得在投影中泄露书名等书目信息，实际 ${serialized.slice(0, 500)}`,
  )
}

function extractCallArgs(source, callee) {
  const calls = []
  const token = `${callee}(`
  let searchFrom = 0
  while (searchFrom < source.length) {
    const start = source.indexOf(token, searchFrom)
    if (start < 0) break
    const prefix = source.slice(Math.max(0, start - 40), start)
    if (/\bfunction\s+$/.test(prefix)) {
      searchFrom = start + token.length
      continue
    }
    const open = start + token.length - 1
    let depth = 0
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1
      else if (source[i] === ')') {
        depth -= 1
        if (depth === 0) {
          calls.push(source.slice(open + 1, i))
          searchFrom = i + 1
          break
        }
      }
    }
    if (searchFrom <= start) break
  }
  return calls
}

test('G1-1 学生在班级工作空间提交无 quote 的帖子返回 201', async (t) => {
  const harness = await startPhase8HttpApp(t)
  const { fixture, baseUrl } = harness
  const book = await createTextBook(harness.application, fixture, { title: 'G11 已发布书' })
  const student = await login(harness, fixture.login.studentA)
  const submitted = await submitPost(
    baseUrl,
    student,
    fixture.wsClassA,
    composeBody({
      bookId: book.bookId,
      title: '无引文读书心得',
      body: '只选书、标题和正文就应该能发。',
      scope: 'class',
    }),
    'g11-submit',
  )
  assertHttpStatus(submitted, 201, 'G1-1 不含 quote 的提交')
  assert.ok(submitted.payload?.data?.id, '201 响应必须带帖子 id')
})

test('G1-2 提交成功后 quote 三列为 NULL 且 book_id 等于提交值', async (t) => {
  const harness = await startPhase8HttpApp(t)
  const { application, fixture, baseUrl } = harness
  const book = await createTextBook(application, fixture, { title: 'G12 已发布书' })
  const student = await login(harness, fixture.login.studentA)
  const submitted = await submitPost(
    baseUrl,
    student,
    fixture.wsClassA,
    composeBody({
      bookId: book.bookId,
      title: '校验落库字段',
      body: '新帖不得再写引文三列。',
      scope: 'class',
    }),
    'g12-submit',
  )
  assertHttpStatus(submitted, 201, 'G1-2 先要提交成功')
  const postId = submitted.payload.data.id
  const quotes = application.database.prepare(`
    SELECT quote_book_id, quote_page, quote_text FROM community_posts WHERE id = ?
  `).get(postId)
  assert.ok(quotes, '库中必须有该帖')
  assert.equal(quotes.quote_book_id, null, 'quote_book_id 必须为 NULL')
  assert.equal(quotes.quote_page, null, 'quote_page 必须为 NULL')
  assert.equal(quotes.quote_text, null, 'quote_text 必须为 NULL')
  const bound = application.database.prepare(`
    SELECT book_id FROM community_posts WHERE id = ?
  `).get(postId)
  assert.equal(bound.book_id, book.bookId, 'book_id 必须等于提交的 bookId')
})

test('G1-3 body 携带 quote 仍成功，但三列仍为 NULL', async (t) => {
  const harness = await startPhase8HttpApp(t)
  const { application, fixture, baseUrl } = harness
  const book = await createTextBook(application, fixture, { title: 'G13 已发布书' })
  const student = await login(harness, fixture.login.studentA)
  const submitted = await submitPost(
    baseUrl,
    student,
    fixture.wsClassA,
    composeBody({
      bookId: book.bookId,
      title: '旧客户端仍带 quote',
      body: 'quote 必须被忽略，不得写库。',
      scope: 'class',
      quote: validQuote(book),
    }),
    'g13-submit',
  )
  assertHttpStatus(submitted, 201, 'G1-3 携带 quote 仍应成功')
  const postId = submitted.payload.data.id
  const quotes = application.database.prepare(`
    SELECT quote_book_id, quote_page, quote_text FROM community_posts WHERE id = ?
  `).get(postId)
  assert.equal(quotes.quote_book_id, null, '即使 body 带 quote，quote_book_id 也必须为 NULL')
  assert.equal(quotes.quote_page, null, '即使 body 带 quote，quote_page 也必须为 NULL')
  assert.equal(quotes.quote_text, null, '即使 body 带 quote，quote_text 也必须为 NULL')
})

test('G1-4 缺 bookId → VALIDATION_FAILED', async (t) => {
  const harness = await startPhase8HttpApp(t)
  const { fixture, baseUrl } = harness
  const book = await createTextBook(harness.application, fixture, { title: 'G14 缺 bookId 用书' })
  const student = await login(harness, fixture.login.studentA)
  const submitted = await submitPost(
    baseUrl,
    student,
    fixture.wsClassA,
    composeBody({
      title: '没有顶层 bookId',
      body: '旧客户端只带 quote 也不算提供 bookId。',
      scope: 'class',
      quote: validQuote(book),
    }),
    'g14-missing-book',
  )
  assertHttpStatus(submitted, 422, 'G1-4 缺 bookId')
  assertErrorCode(submitted, 'VALIDATION_FAILED', 'G1-4 缺 bookId')
})

test('G1-4 bookId 指向非本组织书 → VALIDATION_FAILED', async (t) => {
  const harness = await startPhase8HttpApp(t)
  const { fixture, baseUrl } = harness
  const localBook = await createTextBook(harness.application, fixture, { title: 'G14 本校书' })
  const foreignBook = await createTextBook(harness.application, fixture, {
    title: 'G14 外校书',
    organizationId: fixture.foreignOrganizationId,
  })
  const student = await login(harness, fixture.login.studentA)
  const submitted = await submitPost(
    baseUrl,
    student,
    fixture.wsClassA,
    composeBody({
      bookId: foreignBook.bookId,
      title: '外校书不得发帖',
      body: 'bookId 必须是当前组织已发布书。',
      scope: 'class',
      quote: validQuote(localBook),
    }),
    'g14-foreign-book',
  )
  assertHttpStatus(submitted, 422, 'G1-4 非本组织书')
  assertErrorCode(submitted, 'VALIDATION_FAILED', 'G1-4 非本组织书')
})

test('G1-4 bookId 指向未发布书 → VALIDATION_FAILED', async (t) => {
  const harness = await startPhase8HttpApp(t)
  const { fixture, baseUrl } = harness
  const published = await createTextBook(harness.application, fixture, { title: 'G14 已发布对照书' })
  const draft = await createTextBook(harness.application, fixture, { title: 'G14 未发布书', published: false })
  const student = await login(harness, fixture.login.studentA)
  const submitted = await submitPost(
    baseUrl,
    student,
    fixture.wsClassA,
    composeBody({
      bookId: draft.bookId,
      title: '草稿书不得发帖',
      body: 'bookId 必须指向已发布书。',
      scope: 'class',
      quote: validQuote(published),
    }),
    'g14-draft-book',
  )
  assertHttpStatus(submitted, 422, 'G1-4 未发布书')
  assertErrorCode(submitted, 'VALIDATION_FAILED', 'G1-4 未发布书')
})

test('G1-5 学校范围帖经本班教师一次 approved 后直接 approved 并进入学校 feed', async (t) => {
  const harness = await startPhase8HttpApp(t)
  const { application, fixture, baseUrl } = harness
  const book = await createTextBook(application, fixture, { title: 'G15 学校范围书' })
  const studentA = await login(harness, fixture.login.studentA)
  const studentB = await login(harness, fixture.login.studentB)
  const teacherA = await login(harness, fixture.login.teacherA)
  const submitted = await submitPost(
    baseUrl,
    studentA,
    fixture.wsClassA,
    composeBody({
      bookId: book.bookId,
      title: '学校范围只需一审',
      body: '本班老师一次通过就应出现在学校 feed。',
      scope: 'school',
      quote: validQuote(book),
    }),
    'g15-submit',
  )
  assertHttpStatus(submitted, 201, 'G1-5 提交学校范围帖')
  const postId = submitted.payload.data.id
  const reviewed = await reviewPost(baseUrl, teacherA, fixture.wsClassA, postId, 'g15-class-review')
  assertHttpStatus(reviewed, 200, 'G1-5 本班教师一次审核')
  assert.equal(
    reviewed.payload?.data?.status,
    'approved',
    '学校范围帖本班教师一次 approved 后必须直接 approved，不得停留在 class_approved',
  )
  assert.equal(
    application.database.prepare('SELECT status FROM community_posts WHERE id = ?').get(postId).status,
    'approved',
    '库中状态必须是 approved，不得是 class_approved',
  )
  const schoolFeed = await requestJson(baseUrl, studentB, '/community/posts?scope=school', {
    workspaceId: fixture.wsClassB,
  })
  assertHttpStatus(schoolFeed, 200, 'G1-5 他班学生拉取学校 feed')
  assert.ok(
    findPost(schoolFeed.payload, postId),
    '一次审核通过后必须出现在学校范围 feed，供他班同学看见',
  )
})

test('G1-6 班级范围审核与改造前一致：本班老师通过即 approved', async (t) => {
  const harness = await startPhase8HttpApp(t)
  const { application, fixture, baseUrl } = harness
  const book = await createTextBook(application, fixture, { title: 'G16 班级范围书' })
  const studentA = await login(harness, fixture.login.studentA)
  const studentB = await login(harness, fixture.login.studentB)
  const teacherA = await login(harness, fixture.login.teacherA)
  const schoolAdmin = await login(harness, fixture.login.schoolAdmin)
  const submitted = await submitPost(
    baseUrl,
    studentA,
    fixture.wsClassA,
    composeBody({
      bookId: book.bookId,
      title: '班级范围一审即发布',
      body: '班级帖改造前就是本班老师通过即 approved。',
      scope: 'class',
      quote: validQuote(book),
    }),
    'g16-submit',
  )
  assertHttpStatus(submitted, 201, 'G1-6 提交班级范围帖')
  const postId = submitted.payload.data.id
  const skipped = await reviewPost(baseUrl, schoolAdmin, fixture.wsSchool, postId, 'g16-skip')
  assertHttpStatus(skipped, 403, 'G1-6 学校管理员不得跳过本班教师审核')
  const reviewed = await reviewPost(baseUrl, teacherA, fixture.wsClassA, postId, 'g16-class-review')
  assertHttpStatus(reviewed, 200, 'G1-6 本班教师审核')
  assert.equal(reviewed.payload?.data?.status, 'approved', '班级范围帖本班老师通过后必须是 approved')
  assert.equal(
    application.database.prepare('SELECT status FROM community_posts WHERE id = ?').get(postId).status,
    'approved',
  )
  const classFeedA = await requestJson(baseUrl, studentA, '/community/posts?scope=class', {
    workspaceId: fixture.wsClassA,
  })
  assert.ok(findPost(classFeedA.payload, postId), '通过后必须出现在本班 class feed')
  const classFeedB = await requestJson(baseUrl, studentB, '/community/posts?scope=class', {
    workspaceId: fixture.wsClassB,
  })
  assert.equal(findPost(classFeedB.payload, postId), undefined, '班级范围帖不得出现在他班 class feed')
})

test('G1-7 列表与详情投影返回 bookId，不可见书遵守 D-21', async (t) => {
  const harness = await startPhase8HttpApp(t)
  const { application, fixture, baseUrl } = harness
  const quotedBook = await createTextBook(application, fixture, { title: 'G17 不可见引文书' })
  const boundBook = await createTextBook(application, fixture, { title: 'G17 不可见独立书' })
  const quotedPostId = insertCommunityPost(application.database, fixture, {
    bookId: quotedBook.bookId,
    quoteText: quotedBook.quoteText,
  })
  const student = await login(harness, fixture.login.studentA)
  const quotedList = await requestJson(baseUrl, student, '/community/posts', {
    workspaceId: fixture.wsClassA,
  })
  assertHttpStatus(quotedList, 200, 'G1-7 存量帖列表')
  const quotedItem = findPost(quotedList.payload, quotedPostId)
  assertQuoteHiddenByD21(quotedItem, quotedBook.quoteText, '存量引文帖')
  assert.equal(quotedItem.bookId, quotedBook.bookId, '列表投影必须返回 bookId（可回退 quote_book_id）')
  assertNoCatalogLeak(quotedItem, quotedBook.title, '存量引文帖列表')
  const quotedDetail = studentDetail(application, fixture).getPost(quotedPostId)
  assertQuoteHiddenByD21(quotedDetail, quotedBook.quoteText, '存量引文帖详情')
  assert.equal(quotedDetail.bookId, quotedBook.bookId, '详情投影必须返回 bookId（可回退 quote_book_id）')
  assertNoCatalogLeak(quotedDetail, quotedBook.title, '存量引文帖详情')

  const boundPostId = insertPostBoundToBook(application.database, fixture, { bookId: boundBook.bookId })
  const boundList = await requestJson(baseUrl, student, '/community/posts', {
    workspaceId: fixture.wsClassA,
  })
  const boundItem = findPost(boundList.payload, boundPostId)
  assert.ok(boundItem, '独立 book_id 的帖子必须保留在列表中')
  assert.equal(boundItem.bookId, boundBook.bookId, '列表投影必须优先返回 book_id')
  assertNoCatalogLeak(boundItem, boundBook.title, '独立 book_id 帖列表')
  const boundDetail = studentDetail(application, fixture).getPost(boundPostId)
  assert.equal(boundDetail.bookId, boundBook.bookId, '详情投影必须优先返回 book_id')
  assertNoCatalogLeak(boundDetail, boundBook.title, '独立 book_id 帖详情')
})

test('G1-9 structuredQuote 的 required 实参不得再依赖 scopeType', () => {
  const source = readSource(COMMUNITY_DOMAIN_PATH)
  const calls = extractCallArgs(source, 'structuredQuote')
  assert.ok(calls.length > 0, '必须能定位到 structuredQuote 的调用点（定义不算）')
  for (const args of calls) {
    assert.equal(
      /scopeType/.test(args),
      false,
      `structuredQuote 的 required 实参不得再依赖 scopeType，实际调用：structuredQuote(${args.replace(/\s+/g, ' ').slice(0, 240)})`,
    )
  }
})
