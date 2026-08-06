import { useCallback, useMemo, useState } from 'react'

import { createApiClient } from '../../api/client.js'
import { asApiError } from '../../api/envelope.js'
import { useApiResource } from '../../api/useApiResource.js'

export function createConsolePrivacyEyeCareApi(client = createApiClient()) {
  return {
    listStudents: (options = {}) => client.get('/eyecare/students', options),
    releaseFalsePositive: (studentId, reason, options = {}) =>
      client.post(`/eyecare/students/${encodeURIComponent(studentId)}/release-false-positive`, {
        ...options,
        body: { falsePositive: true, reason },
      }),
    listRequests: (options = {}) => client.get('/privacy/access-requests', options),
    createAccessRequest: (conversationId, purpose, options = {}) =>
      client.post('/privacy/access-requests', { ...options, body: { conversationId, purpose } }),
    viewConversation: (conversationId, purpose, options = {}) =>
      client.post(`/privacy/conversations/${encodeURIComponent(conversationId)}/access`, {
        ...options,
        body: { purpose },
      }),
    listAccessHistory: (options = {}) => client.get('/privacy/access-history', options),
  }
}

export default function usePrivacyEyeCareData({ workspaceId, classId, studentId, api: apiOverride } = {}) {
  const api = useMemo(() => apiOverride || createConsolePrivacyEyeCareApi(), [apiOverride])
  const [actionState, setActionState] = useState({ status: 'idle', error: null })
  const load = useCallback(async () => {
    if (!workspaceId) return { data: null, meta: {} }
    const options = { workspaceId, query: { classId, studentId } }
    const [students, requests, accessHistory] = await Promise.all([
      api.listStudents(options),
      api.listRequests(options),
      api.listAccessHistory(options),
    ])
    return {
      data: {
        students: Array.isArray(students.data?.items) ? students.data.items : [],
        requests: Array.isArray(requests.data?.items) ? requests.data.items : [],
        accessHistory: Array.isArray(accessHistory.data?.items) ? accessHistory.data.items : [],
      },
      meta: students.meta,
    }
  }, [api, classId, studentId, workspaceId])
  const resource = useApiResource(load)

  const runAction = useCallback(async (operation) => {
    setActionState({ status: 'loading', error: null })
    try {
      const response = await operation()
      setActionState({ status: 'ready', error: null })
      resource.reload()
      return response.data
    } catch (error) {
      const apiError = asApiError(error)
      setActionState({ status: 'error', error: apiError })
      throw apiError
    }
  }, [resource.reload])

  const releaseFalsePositive = useCallback((targetStudentId, reason) => {
    const uniquePart = globalThis.crypto?.randomUUID?.() || `${Date.now()}`
    return runAction(() => api.releaseFalsePositive(targetStudentId, reason, {
      workspaceId,
      idempotencyKey: `eyecare:release:${targetStudentId}:${uniquePart}`,
    }))
  }, [api, runAction, workspaceId])

  const createAccessRequest = useCallback((conversationId, purpose) => {
    const uniquePart = globalThis.crypto?.randomUUID?.() || `${Date.now()}`
    return runAction(() => api.createAccessRequest(conversationId, purpose, {
      workspaceId,
      idempotencyKey: `privacy:request:${conversationId}:${uniquePart}`,
    }))
  }, [api, runAction, workspaceId])

  const viewConversation = useCallback((conversationId, purpose) => {
    const uniquePart = globalThis.crypto?.randomUUID?.() || `${Date.now()}`
    return runAction(() => api.viewConversation(conversationId, purpose, {
      workspaceId,
      idempotencyKey: `privacy:view:${conversationId}:${uniquePart}`,
    }))
  }, [api, runAction, workspaceId])

  return {
    ...resource,
    actionState,
    releaseFalsePositive,
    createAccessRequest,
    viewConversation,
  }
}
