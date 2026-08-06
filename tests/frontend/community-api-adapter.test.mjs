import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createConsoleApi } from '../../src/api/console.js'
import { createStudentApi } from '../../src/api/student.js'

test('社区 API 适配器只调用真实路由并透传工作空间与幂等键', async () => {
  const calls = []
  const client = {
    get: async (path, options) => {
      calls.push({ method: 'GET', path, options })
      return { data: { items: [] }, meta: {} }
    },
    post: async (path, options) => {
      calls.push({ method: 'POST', path, options })
      return { data: { id: 'post-1' }, meta: {} }
    },
    delete: async (path, options) => {
      calls.push({ method: 'DELETE', path, options })
      return { data: { removed: true }, meta: {} }
    },
  }
  const student = createStudentApi(client)
  const consoleApi = createConsoleApi(client)
  const options = { workspaceId: 'workspace-1', idempotencyKey: 'community-write-1' }

  await student.listCommunityPosts({ workspaceId: 'workspace-1', query: { scope: 'school' } })
  await student.createCommunityPost({ scope: 'class', title: '标题', body: '正文', quote: { bookId: 'book-1', page: 1, text: '引文' } }, options)
  await student.reactToCommunityPost('post-1', { reactionType: 'clap' }, options)
  await student.removeCommunityReaction('post-1', { reactionType: 'clap' }, options)
  await consoleApi.listCommunityPosts({ workspaceId: 'workspace-1', query: { scope: 'pending' } })
  await consoleApi.reviewCommunityPost('post-1', { decision: 'approved', reason: '人工审核通过' }, options)

  assert.deepEqual(calls, [
    { method: 'GET', path: '/community/posts', options: { workspaceId: 'workspace-1', query: { limit: 100, scope: 'school' } } },
    { method: 'POST', path: '/community/posts', options: { ...options, body: { scope: 'class', title: '标题', body: '正文', quote: { bookId: 'book-1', page: 1, text: '引文' } } } },
    { method: 'POST', path: '/community/posts/post-1/reactions', options: { ...options, body: { reactionType: 'clap' } } },
    { method: 'DELETE', path: '/community/posts/post-1/reactions', options: { ...options, body: { reactionType: 'clap' } } },
    { method: 'GET', path: '/community/posts', options: { workspaceId: 'workspace-1', query: { limit: 100, scope: 'pending' } } },
    { method: 'POST', path: '/community/posts/post-1/review', options: { ...options, body: { decision: 'approved', reason: '人工审核通过' } } },
  ])
})

test('社区 hook 不再把 fixture 或 localStorage 当作业务真相', async () => {
  const source = await readFile(new URL('../../src/student/state/useCommunity.js', import.meta.url), 'utf8')
  assert.match(source, /api\.listCommunityPosts/)
  assert.match(source, /api\.createCommunityPost/)
  assert.match(source, /api\.reactToCommunityPost/)
  assert.doesNotMatch(source, /SEED_POSTS|localStorage|fixture|mock/i)
})

test('学生社区真实路由可达且控制台卡片不再导入 fixture', async () => {
  const [app, card, ui, runtime, mine, communityPage] = await Promise.all([
    readFile(new URL('../../src/student/StudentApp.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/console/components/CommunityPostCard.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/components/ui.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/student/community/CommunityRuntimeContext.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/student/components/MyPostsPanel.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/student/pages/Community.jsx', import.meta.url), 'utf8'),
  ])
  assert.match(app, /path="community"\s+element={<Community\s*\/>}/)
  assert.match(app, /path="community\/compose"/)
  assert.match(app, /path="community\/:postId"/)
  assert.doesNotMatch(card, /data\/fixtures|fixture|mock/i)
  assert.doesNotMatch(ui, /\.\.\/data\/books\.js/)
  assert.match(runtime, /const EMPTY_BOOKS = Object\.freeze\(\[\]\)/)
  assert.match(mine, /useStudentCommunity/)
  assert.doesNotMatch(mine, /useStudent\(\)/)
  assert.doesNotMatch(communityPage, /useStudent\(\)/)
})
