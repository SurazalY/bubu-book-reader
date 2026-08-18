import { useCallback, useMemo } from 'react'

import { createConsoleApi } from '../../api/console.js'
import { useApiResource } from '../../api/useApiResource.js'
import {
  readTeacherCount,
  requireClassShelfApi,
  shelfItemsOf,
} from '../pages/teaching/bookManagement.js'

export async function loadClassShelf(api, { workspaceId, classId } = {}) {
  requireClassShelfApi(api)
  if (!workspaceId || !classId) {
    return { data: { items: [], teacherCount: null, classId: classId || null }, meta: {} }
  }

  const response = await api.getClassShelf(classId, { workspaceId })
  const items = shelfItemsOf(response.data)
  return {
    data: {
      items,
      teacherCount: readTeacherCount(response.data) ?? readTeacherCount(response),
      classId,
    },
    meta: response.meta || {},
  }
}

export default function useBookVisibility(workspaceId, classId) {
  const api = useMemo(() => createConsoleApi(), [])
  const load = useCallback(
    () => loadClassShelf(api, { workspaceId, classId }),
    [api, classId, workspaceId],
  )

  return useApiResource(load)
}
