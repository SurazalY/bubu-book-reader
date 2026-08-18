import { createApiClient } from './client.js'

export function createConsoleApi(client = createApiClient()) {
  return {
    getSession: (options = {}) => client.get('/session', options),
    listWorkspaces: (options = {}) => client.get('/workspaces', { ...options, query: { limit: 100, ...(options.query || {}) } }),
    listStudents: (options = {}) => client.get('/students', { ...options, query: { limit: 100, ...(options.query || {}) } }),
    getUsageSummary: (options = {}) => client.get('/usage/summary', options),
    listBooks: (options = {}) => client.get('/books', { ...options, query: { limit: 100, ...(options.query || {}) } }),
    listAuthorizedClasses: (options = {}) => client.get('/classes', options),
    publishBook: (bookId, options = {}) =>
      client.post(`/books/${encodeURIComponent(bookId)}/publish`, options),
    unpublishBook: (bookId, options = {}) =>
      client.post(`/books/${encodeURIComponent(bookId)}/unpublish`, options),
    getBookVisibility: (bookId, options = {}) =>
      client.get(`/books/${encodeURIComponent(bookId)}/visibility`, options),
    setBookVisibility: (bookId, body, options = {}) =>
      client.put(`/books/${encodeURIComponent(bookId)}/visibility`, { ...options, body }),
    listAssignments: (options = {}) => client.get('/assignments', { ...options, query: { limit: 20, ...(options.query || {}) } }),
    createAssignment: (body, options = {}) => client.post('/assignments', { ...options, body }),
    getBookPage: (bookId, pageNo, options = {}) =>
      client.get(`/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(pageNo)}`, options),
    startClassroom: (body, options = {}) => client.post('/classroom/sessions', { ...options, body }),
    claimClassroomControl: (sessionId, body = {}, options = {}) =>
      client.post(`/classroom/sessions/${encodeURIComponent(sessionId)}/control`, { ...options, body }),
    lockClassroomBook: (sessionId, body, options = {}) =>
      client.patch(`/classroom/sessions/${encodeURIComponent(sessionId)}/book-lock`, { ...options, body }),
    syncClassroomPage: (sessionId, body, options = {}) =>
      client.patch(`/classroom/sessions/${encodeURIComponent(sessionId)}/page`, { ...options, body }),
    broadcastClassroomAi: (sessionId, body, options = {}) =>
      client.post(`/classroom/sessions/${encodeURIComponent(sessionId)}/broadcasts`, { ...options, body }),
    getClassroomState: (sessionId, options = {}) => client.get(`/classroom/sessions/${encodeURIComponent(sessionId)}`, options),
    endClassroom: (sessionId, options = {}) =>
      client.post(`/classroom/sessions/${encodeURIComponent(sessionId)}/end`, { ...options, body: {} }),
    listSafetyEvents: (options = {}) => client.get('/safety/events', { ...options, query: { limit: 20, ...(options.query || {}) } }),
    getSafetyEvent: (eventId, options = {}) => client.get(`/safety/events/${encodeURIComponent(eventId)}`, options),
    acceptSafetyEvent: (eventId, body, options = {}) =>
      client.post(`/safety/events/${encodeURIComponent(eventId)}/accept`, { ...options, body }),
    closeSafetyEvent: (eventId, body, options = {}) =>
      client.post(`/safety/events/${encodeURIComponent(eventId)}/close`, { ...options, body }),
    listAuditEvents: (options = {}) => client.get('/audit/events', options),
    getReadingStatisticsScope: (input = {}, options = {}) => client.get('/reading/statistics/scope', {
      ...options,
      query: { classId: input.classId, statDate: input.statDate },
    }),
    listCommunityPosts: (options = {}) => client.get('/community/posts', { ...options, query: { limit: 100, ...(options.query || {}) } }),
    reviewCommunityPost: (postId, body, options = {}) =>
      client.post(`/community/posts/${encodeURIComponent(postId)}/review`, { ...options, body }),
  }
}
