import { useCallback, useMemo } from 'react'

import { createConsoleApi } from '../../api/console.js'
import { useApiResource } from '../../api/useApiResource.js'
import { toConsoleHomeDto } from '../../adapters/consoleHome.js'

export async function loadConsoleHomeData(api, workspaceId) {
  if (!workspaceId) return { data: null, meta: {} }
  const options = { workspaceId }
  const [usageResult, assignmentsResult, safetyResult] = await Promise.allSettled([
    api.getUsageSummary(options),
    api.listAssignments(options),
    api.listSafetyEvents(options),
  ])
  if (usageResult.status === 'rejected') throw usageResult.reason
  if (assignmentsResult.status === 'rejected') throw assignmentsResult.reason

  const safetyForbidden = safetyResult.status === 'rejected' && safetyResult.reason?.code === 'PERMISSION_DENIED'
  if (safetyResult.status === 'rejected' && !safetyForbidden) throw safetyResult.reason

  const data = toConsoleHomeDto({
    usage: usageResult.value.data,
    assignments: assignmentsResult.value.data,
    safetyEvents: safetyResult.status === 'fulfilled' ? safetyResult.value.data : { items: [] },
  })
  if (safetyForbidden) {
    data.safetyStatus = 'forbidden'
    data.blocks = data.blocks.map((block) => (
      block.key === 'safety'
        ? { ...block, unavailableReason: '当前身份无权查看安全事件' }
        : block
    ))
  }
  return { data, meta: usageResult.value.meta }
}

export default function useConsoleHomeData(workspaceId) {
  const api = useMemo(() => createConsoleApi(), [])
  const load = useCallback(() => loadConsoleHomeData(api, workspaceId), [api, workspaceId])

  return useApiResource(load)
}
