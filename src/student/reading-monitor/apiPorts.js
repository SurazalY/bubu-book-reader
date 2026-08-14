function requiredString(value, label) {
  if (typeof value !== 'string' || !value) throw new TypeError(`${label}不能为空`)
  return value
}

function scopeError(message) {
  const error = new Error(message)
  error.code = 'READING_SCOPE_INVALID'
  return error
}

export function createReadingMonitorApiPorts({ api, workspaceId } = {}) {
  if (typeof api?.acquireReadingLease !== 'function'
    || typeof api?.renewReadingLease !== 'function'
    || typeof api?.submitReadingSessionSummary !== 'function') {
    throw new TypeError('真实阅读监测端口缺少租约或摘要API')
  }
  requiredString(workspaceId, 'workspaceId')

  return Object.freeze({
    acquireLease({ bookVersionId, idempotencyKey }) {
      return api.acquireReadingLease(
        { bookVersionId },
        { workspaceId, idempotencyKey },
      )
    },
    renewLease({ leaseId, schemaVersion, bookVersionId, idempotencyKey }) {
      return api.renewReadingLease(
        leaseId,
        { schemaVersion, bookVersionId },
        { workspaceId, idempotencyKey },
      )
    },
    submitSummary({ summary, idempotencyKey }) {
      return api.submitReadingSessionSummary(
        { summary },
        { workspaceId, idempotencyKey },
      )
    },
  })
}

export async function resolveReadingMonitorScope({ api, workspaceId, studentId, organizationId } = {}) {
  requiredString(workspaceId, 'workspaceId')
  requiredString(studentId, 'studentId')

  if (typeof organizationId === 'string' && organizationId) {
    return Object.freeze({ organizationId, studentId, workspaceId })
  }
  if (typeof api?.getSession !== 'function') throw new TypeError('阅读监测范围解析需要会话API')

  const response = await api.getSession()
  const session = response?.data ?? response
  const authoritativeStudentId = session?.user?.id ?? session?.actor?.id ?? session?.id
  if (authoritativeStudentId !== studentId) throw scopeError('阅读监测学生身份与当前会话不一致')

  const workspaces = Array.isArray(session?.workspaces) ? session.workspaces : []
  const workspace = workspaces.find((item) => item?.id === workspaceId)
  if (!workspace) throw scopeError('当前会话无权访问阅读工作空间')
  const authoritativeOrganizationId = workspace.organizationId ?? session?.user?.organizationId ?? session?.actor?.organizationId
  if (typeof authoritativeOrganizationId !== 'string' || !authoritativeOrganizationId) {
    throw scopeError('当前会话没有返回阅读监测组织范围')
  }
  if (session?.user?.organizationId && session.user.organizationId !== authoritativeOrganizationId) {
    throw scopeError('阅读工作空间与学生组织范围不一致')
  }

  return Object.freeze({
    organizationId: authoritativeOrganizationId,
    studentId: authoritativeStudentId,
    workspaceId,
  })
}
