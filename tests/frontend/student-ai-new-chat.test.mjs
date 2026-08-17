import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const hookUrl = new URL('../../src/student/state/useStudentAiRuntime.js', import.meta.url)
const panelUrl = new URL('../../src/student/components/AiPanel.jsx', import.meta.url)

test('全新 AI 会话首次发送不携带旧会话并保留新选择的书页上下文', async () => {
  const runtime = await import(hookUrl)
  assert.equal(typeof runtime.createStudentAiMessagePayload, 'function')

  const payload = runtime.createStudentAiMessagePayload({
    text: '重新问一个问题',
    quotes: [{ text: '不得上传的客户端文本', selections: [{ pageNo: 12, blockId: 'block-new', startOffset: 0, endOffset: 3 }] }],
    bookId: 'book-1',
    conversationId: 'conversation-old',
    currentPageNo: 12,
    readRangeVersion: 'read-range-v2:test',
    safeMode: true,
    startFresh: true,
  })

  assert.equal(Object.hasOwn(payload, 'conversationId'), false)
  assert.equal(Object.hasOwn(payload, 'quotes'), false)
  assert.deepEqual(payload.selections, [{ pageNo: 12, blockId: 'block-new', startOffset: 0, endOffset: 3 }])
  assert.equal(payload.readRangeVersion, 'read-range-v2:test')
  assert.equal(payload.bookId, 'book-1')
  assert.equal(payload.currentPageNo, 12)

  const continuedPayload = runtime.createStudentAiMessagePayload({
    text: '继续追问',
    quotes: [],
    bookId: 'book-1',
    conversationId: 'conversation-old',
    currentPageNo: 12,
    safeMode: false,
    startFresh: false,
  })
  assert.equal(continuedPayload.conversationId, 'conversation-old')
})

test('新对话状态阻止旧会话回选并在服务端创建后刷新完整历史', async () => {
  const runtime = await import(hookUrl)
  const hook = await readFile(hookUrl, 'utf8')
  const panel = await readFile(panelUrl, 'utf8')

  assert.equal(runtime.resolveFreshConversationSelection({
    startingFresh: true,
    freshConversationId: 'conversation-new',
    chats: [{ id: 'conversation-old' }],
  }), null)
  assert.equal(runtime.resolveFreshConversationSelection({
    startingFresh: true,
    freshConversationId: 'conversation-new',
    chats: [{ id: 'conversation-old' }, { id: 'conversation-new' }],
  }), 'conversation-new')
  assert.equal(runtime.resolveFreshConversationSelection({
    startingFresh: false,
    freshConversationId: 'conversation-new',
    chats: [{ id: 'conversation-new' }],
  }), null)

  assert.match(hook, /const \[startingFresh, setStartingFresh\] = useState\(false\)/)
  assert.match(hook, /freshConversationIdRef = useRef\(null\)/)
  assert.match(hook, /resolveFreshConversationSelection/)
  assert.match(hook, /const response = await api\.sendAiMessage/)
  assert.match(hook, /freshConversationIdRef\.current = response\.data\?\.conversationId/)
  assert.match(hook, /await resource\.reload\(\)/)
  assert.match(hook, /setActiveId\(createdConversationId\)/)
  assert.match(hook, /setStartingFresh\(true\)/)
  assert.doesNotMatch(hook, /newChat: \(\) => setActiveId\(null\)/)
  assert.match(panel, /clearAiQuotes\(\)[\s\S]{0,80}ai\.newChat\(bookId\)/)
  assert.match(panel, /const result = await ai\.send\(/)
  assert.match(panel, /if \(!result\?\.accepted\) return/)
  assert.match(panel, /onConfirmedInteraction\?\.\(aiQuotes\)/)
})

test('真实学生 AI 运行时把课堂广播映射为同一教师提问与同一回复', async () => {
  const runtime = await import(hookUrl)
  assert.equal(typeof runtime.toClassroomBroadcastConversation, 'function')

  const conversation = runtime.toClassroomBroadcastConversation({
    id: 'broadcast-1',
    teacher: '内部联调教师',
    createdAt: '2026-08-06T01:00:00.000Z',
    message: {
      question: { text: '为什么跟上白兔？', quotes: [{ page: 2, text: '白兔匆匆跑过。' }] },
      answer: { text: '因为好奇心被激发。', refs: [{ page: 2, text: '决定跟上去看看。' }] },
    },
  }, 'book-1')

  assert.equal(conversation.id, 'chat-class-broadcast-1')
  assert.equal(conversation.classroom, true)
  assert.equal(conversation.bookId, 'book-1')
  assert.deepEqual(conversation.messages.map((message) => message.role), ['teacher', 'classAi'])
  assert.equal(conversation.messages[0].text, '为什么跟上白兔？')
  assert.equal(conversation.messages[1].text, '因为好奇心被激发。')
  assert.equal(conversation.messages[1].typing, false)
})
