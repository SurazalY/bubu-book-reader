import assert from 'node:assert/strict'
import test from 'node:test'

import { createCommunityDomain } from '../../../../server/domains/community/index.js'
import {
  createHarness,
  grantCurrentBookToClass,
} from './shared-harness.guard.test.js'

function communityFor(harness, { userId, workspaceId, organizationId, classId }) {
  return createCommunityDomain({
    db: harness.db,
    actor: { id: userId, permissions: ['community.submit'] },
    workspace: {
      id: workspaceId,
      organizationId,
      scopeType: 'class',
      scopeId: classId,
    },
  })
}

function studentCommunity(harness, which = 'A') {
  return which === 'B'
    ? communityFor(harness, {
      userId: harness.ids.studentB,
      workspaceId: harness.ids.wsClassB,
      organizationId: harness.ids.organizationId,
      classId: harness.ids.classBId,
    })
    : communityFor(harness, {
      userId: harness.ids.studentA,
      workspaceId: harness.ids.wsClassA,
      organizationId: harness.ids.organizationId,
      classId: harness.ids.classAId,
    })
}

function teacherCommunity(harness) {
  return communityFor(harness, {
    userId: harness.ids.teacherA,
    workspaceId: harness.ids.wsClassA,
    organizationId: harness.ids.organizationId,
    classId: harness.ids.classAId,
  })
}

function assertQuoteHidden(post, originalText) {
  assert.ok(post, '帖子必须保留')
  assert.ok(post.quote, '引用上下文必须保留')
  assert.ok(post.quote.bookId, '不可见时仍返回 bookId')
  assert.equal(post.quote.page, 1, '不可见时仍返回 page')
  assert.equal(post.quote.text, null, '不可见时 quote.text 必须为 null')
  assert.equal(post.quote.availability, 'unavailable')
  assert.notEqual(post.quote_text, originalText, '顶层 quote_text 不得继续泄露原文')
}

function assertQuoteVisible(post, originalText) {
  assert.equal(post.quote.text, originalText)
  assert.notEqual(post.quote.availability, 'unavailable')
}

test('D-21 getPost：有本班 grant 时 quote.text 仍返回', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '可见引用书', status: 'published' })
  const quoteText = `${book.title} 第 1 页正文，足够引用。`
  grantCurrentBookToClass(harness.db, {
    bookId: book.bookId,
    classId: harness.ids.classAId,
    organizationId: harness.ids.organizationId,
    actorId: harness.ids.teacherA,
  })
  const postId = harness.insertCommunityPost({ bookId: book.bookId, quoteText })
  const post = studentCommunity(harness).getPost(postId)
  assertQuoteVisible(post, quoteText)
})

test('D-21 getPost：无 grant 时保留帖子，quote.text=null 且 availability=unavailable', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '无授权引用书', status: 'published' })
  const quoteText = `${book.title} 第 1 页正文，足够引用。`
  const postId = harness.insertCommunityPost({ bookId: book.bookId, quoteText })
  const post = studentCommunity(harness).getPost(postId)
  assertQuoteHidden(post, quoteText)
})

test('D-21 getPost：仅他班 grant 时隐藏 quote.text', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '他班引用书', status: 'published' })
  const quoteText = `${book.title} 第 1 页正文，足够引用。`
  grantCurrentBookToClass(harness.db, {
    bookId: book.bookId,
    classId: harness.ids.classBId,
    organizationId: harness.ids.organizationId,
    actorId: harness.ids.teacherB,
  })
  const postId = harness.insertCommunityPost({ bookId: book.bookId, quoteText })
  const post = studentCommunity(harness).getPost(postId)
  assertQuoteHidden(post, quoteText)
})

test('D-21 getPost：draft 即使已给本班 grant 也隐藏 quote.text（失败只归因发布状态）', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '草稿引用书', status: 'draft' })
  const quoteText = `${book.title} 第 1 页正文，足够引用。`
  grantCurrentBookToClass(harness.db, {
    bookId: book.bookId,
    classId: harness.ids.classAId,
    organizationId: harness.ids.organizationId,
    actorId: harness.ids.teacherA,
  })
  const postId = harness.insertCommunityPost({ bookId: book.bookId, quoteText })
  const post = studentCommunity(harness).getPost(postId)
  assertQuoteHidden(post, quoteText)
})

test('D-21 getPost：旧帖不改数据库；撤 grant 后读隐藏，恢复 grant 后读恢复', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '可撤可恢复的引用书', status: 'published' })
  const quoteText = `${book.title} 第 1 页正文，足够引用。`
  const postId = harness.insertCommunityPost({ bookId: book.bookId, quoteText })
  const storedBefore = harness.db.prepare('SELECT quote_text FROM community_posts WHERE id = ?').get(postId).quote_text

  grantCurrentBookToClass(harness.db, {
    bookId: book.bookId,
    classId: harness.ids.classAId,
    organizationId: harness.ids.organizationId,
    actorId: harness.ids.teacherA,
  })
  assertQuoteVisible(studentCommunity(harness).getPost(postId), quoteText)

  harness.db.prepare(`
    DELETE FROM book_access_grants
    WHERE grantee_type = 'class' AND grantee_id = ? AND book_version_id IN (
      SELECT id FROM book_versions WHERE book_id = ?
    )
  `).run(harness.ids.classAId, book.bookId)
  assertQuoteHidden(studentCommunity(harness).getPost(postId), quoteText)

  grantCurrentBookToClass(harness.db, {
    bookId: book.bookId,
    classId: harness.ids.classAId,
    organizationId: harness.ids.organizationId,
    actorId: harness.ids.teacherA,
  })
  assertQuoteVisible(studentCommunity(harness).getPost(postId), quoteText)

  const storedAfter = harness.db.prepare('SELECT quote_text FROM community_posts WHERE id = ?').get(postId).quote_text
  assert.equal(storedBefore, quoteText)
  assert.equal(storedAfter, quoteText, '旧帖不得被改写；隐藏只发生在 getPost 读取投影')
})

test('D-21 getPost：教师对 published 可看 quote.text（即使无 class grant）', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '教师可见引用书', status: 'published' })
  const quoteText = `${book.title} 第 1 页正文，足够引用。`
  const postId = harness.insertCommunityPost({ bookId: book.bookId, quoteText })
  assertQuoteVisible(teacherCommunity(harness).getPost(postId), quoteText)
})

test('D-21 getPost：跨组织不泄露帖子或 quote.text', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '跨组织引用书', status: 'published' })
  const quoteText = `${book.title} 第 1 页正文，足够引用。`
  const postId = harness.insertCommunityPost({ bookId: book.bookId, quoteText })
  const foreign = communityFor(harness, {
    userId: harness.ids.foreignStudent,
    workspaceId: harness.ids.wsForeignClass,
    organizationId: harness.ids.foreignOrganizationId,
    classId: harness.ids.foreignClassId,
  })
  assert.throws(
    () => foreign.getPost(postId),
    (error) => {
      assert.equal(error.code, 'RESOURCE_NOT_FOUND')
      const serialized = `${error.message} ${JSON.stringify(error.details ?? {})}`
      assert.ok(!serialized.includes(quoteText), '跨组织错误不得泄露 quote.text')
      return true
    },
  )
})
