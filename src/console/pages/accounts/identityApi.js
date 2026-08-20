import { createApiClient } from '../../../api/client.js'

function writeIdempotencyKey(prefix) {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('当前浏览器无法生成安全请求标识')
  }
  return `${prefix}:${globalThis.crypto.randomUUID()}`
}

function versionMatchHeaders(version, headers = {}) {
  if (version === undefined || version === null || version === '') return headers
  return { ...headers, 'If-Match': `"${version}"` }
}

function withWrite(options, prefix, body) {
  return {
    ...options,
    idempotencyKey: options.idempotencyKey || writeIdempotencyKey(prefix),
    body: body === undefined ? options.body ?? {} : body,
  }
}

export function createIdentityConsoleApi(client = createApiClient()) {
  return {
    getTeacherClassDirectory: (options = {}) => client.get('/teacher/class-directory', options),
    joinTeacherClass: (classId, options = {}) =>
      client.put(`/teacher/classes/${encodeURIComponent(classId)}`, withWrite(options, 'teacher-class-join')),
    leaveTeacherClass: (classId, options = {}) =>
      client.delete(`/teacher/classes/${encodeURIComponent(classId)}`, withWrite(options, 'teacher-class-leave')),
    getClass: (classId, options = {}) => client.get(`/classes/${encodeURIComponent(classId)}`, options),
    createClass: (body, options = {}) => client.post('/classes', withWrite(options, 'class-create', body)),
    disableClass: (classId, body, options = {}) =>
      client.delete(`/classes/${encodeURIComponent(classId)}`, {
        ...withWrite(options, 'class-disable', body),
        headers: versionMatchHeaders(body?.version, options.headers),
      }),
    restoreClass: (classId, body, options = {}) =>
      client.post(`/classes/${encodeURIComponent(classId)}/restore`, {
        ...withWrite(options, 'class-restore', body),
        headers: versionMatchHeaders(body?.version, options.headers),
      }),
    listEnrollmentRequests: (classId, options = {}) =>
      client.get(`/classes/${encodeURIComponent(classId)}/enrollment-requests`, {
        ...options,
        query: { status: 'pending', ...(options.query || {}) },
      }),
    approveEnrollmentRequest: (id, body, options = {}) =>
      client.post(`/enrollment-requests/${encodeURIComponent(id)}/approve`, withWrite(options, 'enrollment-approve', body)),
    rejectEnrollmentRequest: (id, body, options = {}) =>
      client.post(`/enrollment-requests/${encodeURIComponent(id)}/reject`, withWrite(options, 'enrollment-reject', body)),
    listRegistrationCredentials: (options = {}) =>
      client.get('/registration-credentials', {
        ...options,
        query: { expectedRole: options.expectedRole, ...(options.query || {}) },
      }),
    issueRegistrationCredential: (body, options = {}) =>
      client.post('/registration-credentials', withWrite(options, 'registration-issue', body)),
    revokeRegistrationCredential: (id, body, options = {}) =>
      client.post(
        `/registration-credentials/${encodeURIComponent(id)}/revoke`,
        withWrite(options, 'registration-revoke', body),
      ),
    issuePasswordResetCredential: (userId, options = {}) =>
      client.post(
        `/users/${encodeURIComponent(userId)}/password-reset-credentials`,
        withWrite(options, 'password-reset-issue'),
      ),
    issueTempPassword: (userId, options = {}) =>
      client.post(
        `/users/${encodeURIComponent(userId)}/password-reset`,
        withWrite(options, 'temp-password-issue'),
      ),
    getTempPassword: (userId, options = {}) =>
      client.get(`/users/${encodeURIComponent(userId)}/temp-password`, options),
  }
}

export function createIdentityStudentApi(client = createApiClient()) {
  return {
    createEnrollmentRequest: (body, options = {}) =>
      client.post('/onboarding/enrollment-requests', withWrite(options, 'enrollment-request', body)),
  }
}
