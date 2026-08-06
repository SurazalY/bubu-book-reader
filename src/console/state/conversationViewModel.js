export const SESSION_KIND = {
  normal: { label: '普通', tone: 'brand', dot: '#3B66F5' },
  private: { label: '私密', tone: 'violet', dot: '#7C6BD8' },
  safety: { label: '安全', tone: 'danger', dot: '#C2453D' },
}

export const REQUEST_STATE = {
  none: { label: '未申请', tone: 'muted' },
  pending: { label: '等待学生同意', tone: 'warning' },
  approved: { label: '学生已同意', tone: 'success' },
  denied: { label: '学生已拒绝', tone: 'danger' },
  expired: { label: '申请已过期', tone: 'muted' },
}

export const SAFETY_CONTEXT_SPAN = 2

export function buildConversationTree(indexPayload, detailPayload, requests = []) {
  const requestByConversation = new Map()
  for (const request of requests) {
    if (!request?.conversationId || requestByConversation.has(request.conversationId)) continue
    requestByConversation.set(request.conversationId, request)
  }
  return (indexPayload?.classes || []).map((classItem) => {
    const klass = { id: classItem.id, name: classItem.name }
    const students = (classItem.students || []).map((student) => {
      const studentView = { id: student.id, name: student.displayName }
      const sessions = (student.conversations || []).map((conversation) => {
        const isDetail = detailPayload?.id === conversation.id
        const detail = isDetail ? detailPayload : null
        const request = requestByConversation.get(conversation.id)
        const privateMode = conversation.privacyMode === 'private'
        const safetyMode = detail?.accessMode === 'safety_minimum_context'
        return {
          ...conversation,
          no: `C-${conversation.id}`,
          kind: safetyMode ? 'safety' : privateMode ? 'private' : 'normal',
          title: conversation.title || '新的对话',
          studentId: student.id,
          bookId: conversation.bookId,
          lastAt: formatDateTime(conversation.updatedAt),
          request: request?.status || 'none',
          messages: detail ? (detail.messages || []).map(normalizeMessage) : [],
          watermark: detail?.watermark || null,
          eventId: detail?.safetyContext?.id || null,
          risk: detail?.safetyContext?.riskLevel || null,
          eventState: detail?.safetyContext?.status || null,
          _student: studentView,
          _class: klass,
          _book: {
            id: conversation.bookVersionId,
            bookId: conversation.bookId,
            versionId: conversation.bookVersionId,
            title: conversation.bookTitle || '未命名书籍',
            cover: ['#8FA8E8', '#DDE6FA'],
          },
        }
      })
      return { student: studentView, sessions }
    }).filter((group) => group.sessions.length > 0)
    return { klass, students, total: students.reduce((total, group) => total + group.sessions.length, 0) }
  }).filter((group) => group.total > 0)
}

export function booksFromConversationTree(tree) {
  const books = new Map()
  for (const group of tree) {
    for (const student of group.students) {
      for (const session of student.sessions) {
        if (session._book?.id && !books.has(session._book.id)) books.set(session._book.id, session._book)
      }
    }
  }
  return [...books.values()]
}

export function sessionStudent(session) {
  return session?._student || null
}

export function sessionBook(session) {
  return session?._book || null
}

export function sessionClass(session) {
  return session?._class || null
}

export function sessionTitle(session) {
  if (session?.kind === 'private') return `私密会话 #${String(session.no || '').slice(-4)}`
  return session?.title || '新的对话'
}

export function sessionCount(session) {
  return Array.isArray(session?.messages) ? session.messages.length : '—'
}

export function safetyWindow(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : []
  const triggerIndex = messages.findIndex((message) => message.trigger)
  if (triggerIndex < 0) return { list: messages, before: 0, after: 0 }
  const from = Math.max(0, triggerIndex - SAFETY_CONTEXT_SPAN)
  const to = Math.min(messages.length, triggerIndex + SAFETY_CONTEXT_SPAN + 1)
  return { list: messages.slice(from, to), before: from, after: messages.length - to }
}

function normalizeMessage(message) {
  const createdAt = message.createdAt || null
  return {
    id: message.id,
    role: message.role === 'assistant' ? 'ai' : 'stu',
    at: formatTime(createdAt),
    text: message.text || '',
    trigger: Boolean(message.danger?.detected),
  }
}

function formatDateTime(value) {
  if (!value) return '时间未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}
