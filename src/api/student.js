import { createApiClient } from './client.js'

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
    acquireReadingLease: (body, options = {}) => client.post('/reading/lease', { ...options, body }),
    submitReadingEvents: (body, options = {}) => client.post('/reading/events/batch', { ...options, body }),
  }
}
