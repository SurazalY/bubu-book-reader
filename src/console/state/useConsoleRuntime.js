import { useCallback, useMemo } from 'react'

import { createConsoleApi } from '../../api/console.js'
import { useApiResource } from '../../api/useApiResource.js'
import { toConsoleRuntimeDto } from '../../adapters/console.js'

export default function useConsoleRuntime() {
  const api = useMemo(() => createConsoleApi(), [])
  const load = useCallback(async () => {
    const [session, workspaces] = await Promise.all([api.getSession(), api.listWorkspaces()])
    return {
      data: toConsoleRuntimeDto({
        session: session.data,
        workspaces: workspaces.data,
      }),
      meta: session.meta,
    }
  }, [api])

  return useApiResource(load)
}
