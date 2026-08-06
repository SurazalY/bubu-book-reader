import { useCallback, useMemo } from 'react'

import { createConsoleApi } from '../../api/console.js'
import { useApiResource } from '../../api/useApiResource.js'
import { toSafetyDetailDto } from '../../adapters/safety.js'

export default function useSafetyEvent(eventId, workspaceId) {
  const api = useMemo(() => createConsoleApi(), [])
  const load = useCallback(async () => {
    const response = await api.getSafetyEvent(eventId, { workspaceId })
    return {
      data: toSafetyDetailDto(response.data),
      meta: response.meta,
    }
  }, [api, eventId, workspaceId])

  const resource = useApiResource(load)
  const accept = useCallback(async () => {
    const response = await api.acceptSafetyEvent(eventId, {}, {
      workspaceId,
      idempotencyKey: `safety-accept:${eventId}:${globalThis.crypto.randomUUID()}`,
    })
    resource.reload()
    return toSafetyDetailDto(response.data)
  }, [api, eventId, resource.reload, workspaceId])
  const close = useCallback(async ({ outcome, note }) => {
    const response = await api.closeSafetyEvent(eventId, { outcome, note }, {
      workspaceId,
      idempotencyKey: `safety-close:${eventId}:${globalThis.crypto.randomUUID()}`,
    })
    resource.reload()
    return toSafetyDetailDto(response.data)
  }, [api, eventId, resource.reload, workspaceId])

  return { ...resource, accept, close }
}
