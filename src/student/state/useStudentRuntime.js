import { useCallback, useMemo } from 'react'

import { createStudentApi } from '../../api/student.js'
import { useApiResource } from '../../api/useApiResource.js'
import { toStudentRuntimeDto } from '../../adapters/student.js'

export default function useStudentRuntime() {
  const api = useMemo(() => createStudentApi(), [])
  const load = useCallback(async () => {
    const session = await api.getSession()
    const workspaceId = session.data?.activeWorkspaceId || session.data?.workspaceId
    if (!workspaceId) throw new Error('当前账号没有可用工作空间')
    const options = { workspaceId }
    const [books, progress, eyeCare] = await Promise.all([
      api.listBooks(options),
      api.getReadingProgress(options),
      api.getEyeCareStatus(options),
    ])
    return {
      data: toStudentRuntimeDto({
        session: session.data,
        books: books.data,
        progress: progress.data,
        eyeCare: eyeCare.data,
      }),
      meta: session.meta,
    }
  }, [api])

  return useApiResource(load)
}
