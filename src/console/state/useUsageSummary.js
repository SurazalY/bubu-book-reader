import { useCallback, useMemo } from 'react'

import { createConsoleApi } from '../../api/console.js'
import { useApiResource } from '../../api/useApiResource.js'

export default function useUsageSummary(workspaceId) {
  const api = useMemo(() => createConsoleApi(), [])
  const load = useCallback(async () => {
    if (!workspaceId) return { data: null, meta: {} }
    const response = await api.getUsageSummary({ workspaceId })
    return { data: response.data, meta: response.meta || {} }
  }, [api, workspaceId])

  return useApiResource(load)
}
