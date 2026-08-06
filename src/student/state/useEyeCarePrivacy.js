import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createApiClient } from '../../api/client.js'
import { asApiError } from '../../api/envelope.js'
import { useApiResource } from '../../api/useApiResource.js'

export function createStudentEyeCarePrivacyApi(client = createApiClient()) {
  return {
    getStatus: (options = {}) => client.get('/eyecare/status', options),
    listRequests: (options = {}) => client.get('/privacy/access-requests', options),
    listAccessHistory: (options = {}) => client.get('/privacy/access-history', options),
    resolveRequest: (requestId, decision, options = {}) =>
      client.post(`/privacy/access-requests/${encodeURIComponent(requestId)}/decision`, {
        ...options,
        body: { decision },
      }),
  }
}

export function deriveOfflineEyeCareState({ lastGood, error, now = new Date() } = {}) {
  if (!lastGood) return null
  const current = now instanceof Date ? now : new Date(now)
  const forcedRestUntil = lastGood.enforcement?.forcedRestUntil
  const wasForced = lastGood.enforcement?.status === 'forced_rest'
  const stillForced = wasForced
    && forcedRestUntil
    && Date.parse(forcedRestUntil) > current.getTime()
  const status = wasForced ? (stillForced ? 'forced_rest' : 'normal') : lastGood.enforcement?.status || 'normal'
  return {
    ...lastGood,
    stale: Boolean(error),
    offline: Boolean(error),
    error: error ? asApiError(error) : null,
    enforcement: {
      ...(lastGood.enforcement || {}),
      status,
      recoverySource: wasForced && !stillForced ? 'client_timer' : lastGood.enforcement?.recoverySource || null,
      offline: {
        ...(lastGood.enforcement?.offline || {}),
        failClosed: stillForced,
        enforceUntil: forcedRestUntil || null,
      },
    },
  }
}

export default function useEyeCarePrivacy({ workspaceId, api: apiOverride, pollIntervalMs = 15_000 } = {}) {
  const api = useMemo(() => apiOverride || createStudentEyeCarePrivacyApi(), [apiOverride])
  const lastGoodEyeCare = useRef(null)
  const [clockVersion, setClockVersion] = useState(0)
  const [decisionState, setDecisionState] = useState({ status: 'idle', error: null })
  const load = useCallback(async () => {
    if (!workspaceId) return { data: null, meta: {} }
    const options = { workspaceId }
    const [eyeCare, requests, accessHistory] = await Promise.all([
      api.getStatus(options),
      api.listRequests(options),
      api.listAccessHistory(options),
    ])
    lastGoodEyeCare.current = eyeCare.data
    return {
      data: {
        eyeCare: eyeCare.data,
        requests: Array.isArray(requests.data?.items) ? requests.data.items : [],
        accessHistory: Array.isArray(accessHistory.data?.items) ? accessHistory.data.items : [],
      },
      meta: eyeCare.meta,
    }
  }, [api, workspaceId])
  const resource = useApiResource(load)

  useEffect(() => {
    if (!workspaceId || !Number.isInteger(pollIntervalMs) || pollIntervalMs < 1_000) return undefined
    const timer = window.setInterval(resource.reload, pollIntervalMs)
    return () => window.clearInterval(timer)
  }, [pollIntervalMs, resource.reload, workspaceId])

  const visibleEyeCare = deriveOfflineEyeCareState({
    lastGood: resource.status === 'ready' ? resource.data?.eyeCare : lastGoodEyeCare.current,
    error: resource.status === 'error' ? resource.error : null,
    now: new Date(),
  })

  useEffect(() => {
    if (visibleEyeCare?.enforcement?.status !== 'forced_rest') return undefined
    const timer = window.setInterval(() => setClockVersion((version) => version + 1), 1_000)
    return () => window.clearInterval(timer)
  }, [visibleEyeCare?.enforcement?.status, visibleEyeCare?.enforcement?.forcedRestUntil])

  const resolveRequest = useCallback(async (requestId, decision) => {
    if (!workspaceId) throw new Error('当前会话没有可用工作空间')
    const uniquePart = globalThis.crypto?.randomUUID?.() || `${Date.now()}`
    setDecisionState({ status: 'loading', error: null })
    try {
      const response = await api.resolveRequest(requestId, decision, {
        workspaceId,
        idempotencyKey: `privacy:decision:${requestId}:${decision}:${uniquePart}`,
      })
      setDecisionState({ status: 'ready', error: null })
      resource.reload()
      return response.data
    } catch (error) {
      const apiError = asApiError(error)
      setDecisionState({ status: 'error', error: apiError })
      throw apiError
    }
  }, [api, resource.reload, workspaceId])

  return {
    ...resource,
    data: resource.data ? { ...resource.data, eyeCare: visibleEyeCare } : visibleEyeCare ? {
      eyeCare: visibleEyeCare,
      requests: [],
      accessHistory: [],
    } : null,
    eyeCare: visibleEyeCare,
    decisionState,
    resolveRequest,
    clockVersion,
  }
}
