import { createApiClient } from './client.js'

const READING_SUMMARY_FIELDS = Object.freeze([
  'schemaVersion',
  'sessionId',
  'revision',
  'leaseId',
  'bookVersionId',
  'statDate',
  'startedAt',
  'measuredThroughAt',
  'cumulativeEffectiveMs',
  'hadSkip',
  'hadReread',
  'lastPageNo',
  'endedAt',
  'endReason',
  'fingerprint',
])

function readingSummaryBody(input = {}) {
  const summary = input?.summary ?? input
  return Object.fromEntries(READING_SUMMARY_FIELDS.map((field) => [field, summary?.[field]]))
}

function requireReaderTargetPart(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${field} is required to build a reader URL`)
  }
  return value.trim()
}

export function buildStudentReaderUrl(target = {}) {
  const bookId = requireReaderTargetPart(target.bookId, 'bookId')
  const bookVersionId = requireReaderTargetPart(target.bookVersionId, 'bookVersionId')
  const pageNo = target.lastPageNo ?? target.pageNo
  if (!Number.isSafeInteger(pageNo) || pageNo < 1) {
    throw new TypeError('pageNo must be a positive safe integer')
  }
  if (target.totalPages !== undefined && target.totalPages !== null) {
    if (!Number.isSafeInteger(target.totalPages) || target.totalPages < 1 || pageNo > target.totalPages) {
      throw new TypeError('pageNo must be within the declared book bounds')
    }
  }
  const query = new URLSearchParams({ versionId: bookVersionId, pageNo: String(pageNo) })
  return `/student/reader/${encodeURIComponent(bookId)}?${query.toString()}`
}

export function createStudentApi(client = createApiClient()) {
  return {
    getSession: (options = {}) => client.get('/session', options),
    listBooks: (options = {}) => client.get('/books', { ...options, query: { limit: 100, ...(options.query || {}) } }),
    getBookPage: (bookId, pageNo, options = {}) =>
      client.get(`/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(pageNo)}`, options),
    getReadingProgress: (options = {}) => client.get('/reading/progress', options),
    getEyeCareStatus: (options = {}) => client.get('/eyecare/status', options),
    listConversations: (options = {}) => client.get('/ai/conversations', { ...options, query: { limit: 100, ...(options.query || {}) } }),
    listCommunityPosts: (options = {}) => client.get('/community/posts', { ...options, query: { limit: 100, ...(options.query || {}) } }),
    createCommunityPost: (body, options = {}) => client.post('/community/posts', { ...options, body }),
    reactToCommunityPost: (postId, body, options = {}) =>
      client.post(`/community/posts/${encodeURIComponent(postId)}/reactions`, { ...options, body }),
    removeCommunityReaction: (postId, body, options = {}) =>
      client.delete(`/community/posts/${encodeURIComponent(postId)}/reactions`, { ...options, body }),
    getClassroomState: (sessionId, options = {}) => client.get(`/classroom/sessions/${encodeURIComponent(sessionId)}`, options),
    joinClassroom: (sessionId, options = {}) => client.post(`/classroom/sessions/${encodeURIComponent(sessionId)}/join`, { ...options, body: {} }),
    acknowledgeClassroomBroadcast: (sessionId, broadcastId, options = {}) =>
      client.post(`/classroom/sessions/${encodeURIComponent(sessionId)}/broadcasts/${encodeURIComponent(broadcastId)}/received`, { ...options, body: {} }),
    sendAiMessage: (body, options = {}) => client.post('/ai/messages', { ...options, body }),
    acquireReadingLease: (input = {}, options = {}) => client.post('/reading/lease', {
      ...options,
      body: {
        bookVersionId: input.bookVersionId,
        ...(input.takeover === true ? { takeover: true } : {}),
      },
    }),
    renewReadingLease: (leaseId, input = {}, options = {}) =>
      client.post(`/reading/lease/${encodeURIComponent(leaseId)}/renew`, {
        ...options,
        body: { schemaVersion: input.schemaVersion, bookVersionId: input.bookVersionId },
      }),
    submitReadingSessionSummary: (input = {}, options = {}) =>
      client.post('/reading/session-summaries', { ...options, body: readingSummaryBody(input) }),
    getReadingStatisticsSelf: (options = {}) => client.get('/reading/statistics/self', options),
    submitReadingEvents: (body, options = {}) => client.post('/reading/events/batch', { ...options, body }),
  }
}
