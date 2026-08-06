import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildConversationWriteOptions,
  createConversationApi,
  normalizeConversationSnapshot,
} from '../../src/student/state/useConversationManager.js'
import {
  buildConsoleConversationQuery,
  createConsoleConversationApi,
  normalizeConversationIndex,
} from '../../src/console/state/useConversationData.js'

test('学生会话适配器仅调用真实 API，所有写操作带工作空间与幂等键', async () => {
  const calls = []
  const client = {}
  for (const method of ['get', 'post', 'patch', 'delete']) {
    client[method] = async (path, options) => {
      calls.push({ method, path, options })
      return { data: {}, meta: {} }
    }
  }
  const api = createConversationApi(client)
  const write = buildConversationWriteOptions('workspace-a', 'rename', 'conversation-a')
  assert.equal(write.workspaceId, 'workspace-a')
  assert.match(write.idempotencyKey, /^conversation:rename:conversation-a:/)
  await api.list({ workspaceId: 'workspace-a' })
  await api.create({ bookVersionId: 'version-a' }, write)
  await api.rename('conversation-a', { title: '新标题', expectedVersion: 1 }, write)
  await api.setPrivacy('conversation-a', { privacyMode: 'private', expectedVersion: 2 }, write)
  await api.remove('conversation-a', { expectedVersion: 3 }, write)
  await api.restore('conversation-a', { expectedVersion: 4 }, write)
  assert.deepEqual(calls.map((call) => `${call.method}:${call.path}`), [
    'get:/ai/conversations',
    'post:/ai/conversations',
    'patch:/ai/conversations/conversation-a',
    'patch:/ai/conversations/conversation-a',
    'delete:/ai/conversations/conversation-a',
    'post:/ai/conversations/conversation-a/restore',
  ])
})

test('学生快照保留标题、私密、删除区、书页选文引用、额度及恢复时间', () => {
  const snapshot = normalizeConversationSnapshot({
    items: [{ id: 'c1', title: '标题', privacyMode: 'private', context: { pageNumber: 8, selection: { text: '选文' }, citations: [{ pageNumber: 8 }] } }],
    trash: [{ id: 'c2', deletedAt: '2026-08-06T05:00:00.000Z' }],
    quota: { remaining: 7, usagePercent: 30, resetAt: '2026-08-07T00:00:00.000Z' },
  })
  assert.equal(snapshot.chats[0].private, true)
  assert.equal(snapshot.chats[0].pageNumber, 8)
  assert.equal(snapshot.chats[0].quotes[0].text, '选文')
  assert.equal(snapshot.chats[0].refs[0].pageNumber, 8)
  assert.equal(snapshot.trash.length, 1)
  assert.equal(snapshot.quota.resetAt, '2026-08-07T00:00:00.000Z')
})

test('权限端构造班级学生书籍标题查询，并规范化三级索引', async () => {
  const query = buildConsoleConversationQuery({ text: ' 白兔 ', bookVersionIds: ['v1', 'v2', 'v1'], bookMode: 'AND' })
  assert.deepEqual(query, { text: '白兔', bookVersionIds: 'v1,v2', bookMode: 'AND' })
  const normalized = normalizeConversationIndex({ classes: [{ id: 'class-a', name: '一班', students: [{ id: 'student-a', displayName: '学生甲', conversations: [{ id: 'c1', title: '标题' }] }] }] })
  assert.equal(normalized.classes[0].students[0].conversations[0].title, '标题')

  const calls = []
  const api = createConsoleConversationApi({
    get: async (path, options) => {
      calls.push({ path, options })
      return { data: {}, meta: {} }
    },
  })
  await api.search({ workspaceId: 'workspace-a', query })
  await api.getConversation('student-a', 'c1', { workspaceId: 'workspace-a', query: { purpose: '教学跟进' } })
  assert.deepEqual(calls.map((call) => call.path), ['/console/conversations', '/console/conversations/student-a/c1'])
})

test('生产适配器不导入 fixture、mock、localStorage 或旧种子会话', async () => {
  const student = await readFile(new URL('../../src/student/state/useConversationManager.js', import.meta.url), 'utf8')
  const consoleSource = await readFile(new URL('../../src/console/state/useConversationData.js', import.meta.url), 'utf8')
  for (const source of [student, consoleSource]) {
    assert.doesNotMatch(source, /fixture|mock|localStorage|SEED_CHATS|\.\.\/data\//i)
  }
})
