import assert from 'node:assert/strict'
import test from 'node:test'

import {
  booksFromConversationTree,
  buildConversationTree,
  sessionCount,
  sessionTitle,
} from '../../src/console/state/conversationViewModel.js'

test('真实会话 DTO 保留班级学生索引并隐藏私密标题', () => {
  const tree = buildConversationTree({
    classes: [{
      id: 'class-1',
      name: '三年级一班',
      students: [{
        id: 'student-1',
        displayName: '林小竹',
        conversations: [{
          id: 'conversation-private', ownerUserId: 'student-1', title: '不应展示的标题',
          privacyMode: 'private', bookId: 'book-1', bookVersionId: 'version-1',
          bookTitle: '爱丽丝梦游仙境', updatedAt: '2026-08-06T08:00:00.000Z',
        }],
      }],
    }],
  }, null, [{ conversationId: 'conversation-private', status: 'pending' }])

  const session = tree[0].students[0].sessions[0]
  assert.equal(session.kind, 'private')
  assert.equal(session.request, 'pending')
  assert.match(sessionTitle(session), /^私密会话 #/)
  assert.equal(sessionCount(session), 0)
  assert.deepEqual(booksFromConversationTree(tree).map((book) => book.id), ['version-1'])
})

test('安全最小上下文优先于私密锁并映射真实消息', () => {
  const index = {
    classes: [{ id: 'class-1', name: '三年级一班', students: [{
      id: 'student-1', displayName: '林小竹', conversations: [{
        id: 'conversation-risk', ownerUserId: 'student-1', title: '风险会话', privacyMode: 'private',
        bookId: 'book-1', bookVersionId: 'version-1', bookTitle: '爱丽丝梦游仙境',
      }],
    }] }],
  }
  const tree = buildConversationTree(index, {
    id: 'conversation-risk', accessMode: 'safety_minimum_context',
    messages: [{ id: 'message-1', role: 'user', text: '需要帮助', danger: { detected: true } }],
  })
  const session = tree[0].students[0].sessions[0]
  assert.equal(session.kind, 'safety')
  assert.equal(session.messages[0].trigger, true)
  assert.equal(sessionCount(session), 1)
})
