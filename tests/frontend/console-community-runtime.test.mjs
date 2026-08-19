import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  mapCommunityReviewAction,
  partitionConsoleCommunityPosts,
  toConsoleCommunityPost,
} from '../../src/console/state/communityRuntime.js'

test('权限端社区 DTO 保留真实作者、书目和两级审核状态', () => {
  const booksById = new Map([['book-1', { id: 'book-1', title: '真实书目' }]])
  const submitted = toConsoleCommunityPost({
    id: 'post-1',
    title: '真实标题',
    body: '真实正文',
    status: 'submitted',
    scope: 'class',
    classId: 'class-1',
    bookId: 'book-1',
    author: { id: 'student-1', displayName: '学生一' },
    reactions: [{ type: 'clap', count: 2 }],
    reviews: [],
    createdAt: '2026-08-06T01:00:00.000Z',
  }, { booksById, className: '三年级一班' })
  const schoolSecondReview = toConsoleCommunityPost({ ...submitted, id: 'post-2', scope: 'school', status: 'class_approved' }, { booksById, className: '三年级一班' })
  const groups = partitionConsoleCommunityPosts([submitted, schoolSecondReview])

  assert.equal(submitted.status, 'pending')
  assert.equal(submitted.author.name, '学生一')
  assert.equal(submitted.book.title, '真实书目')
  assert.equal(submitted.kudos, 2)
  assert.equal(groups.pending.length, 2)
  assert.equal(groups.class.length, 1)
  assert.equal(groups.school.length, 1)
})

test('权限端社区审核动作只映射到真实后端决策', () => {
  assert.deepEqual(mapCommunityReviewAction('approve'), { decision: 'approved', reason: '人工审核通过' })
  assert.deepEqual(mapCommunityReviewAction('reject'), { decision: 'rejected', reason: '内容未通过人工审核' })
  assert.equal(mapCommunityReviewAction('feature'), null)
})

test('权限端社区 hook 调用真实列表和审核接口', async () => {
  const [source, page] = await Promise.all([
    readFile(new URL('../../src/console/state/useConsoleCommunityRuntime.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/console/pages/Community.jsx', import.meta.url), 'utf8'),
  ])
  assert.match(source, /api\.listCommunityPosts/)
  assert.match(source, /api\.reviewCommunityPost/)
  assert.doesNotMatch(source, /fixture|mock|localStorage/i)
  assert.match(page, /workspace\?\.hasClassScope \?\? workspace\?\.scopeType === 'class'/)
})
