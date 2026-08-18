import { useCallback, useMemo } from 'react'

import { createConsoleApi } from '../../api/console.js'
import { asApiError } from '../../api/envelope.js'
import { useApiResource } from '../../api/useApiResource.js'

export async function loadBookVisibility(api, { workspaceId, bookId } = {}) {
  if (!workspaceId || !bookId) return { data: null, meta: {} }

  const [visibilityResult, classesResult] = await Promise.allSettled([
    api.getBookVisibility(bookId, { workspaceId }),
    api.listAuthorizedClasses({ workspaceId }),
  ])

  if (visibilityResult.status === 'rejected') {
    throw visibilityResult.reason
  }

  const visibility = visibilityResult.value
  const classesError = classesResult.status === 'rejected' ? asApiError(classesResult.reason) : null
  const classes = classesResult.status === 'fulfilled' && Array.isArray(classesResult.value?.data?.items)
    ? classesResult.value.data.items
    : []

  return {
    data: {
      visibility: visibility.data || null,
      classes,
      classesError,
    },
    meta: visibility.meta || {},
  }
}

export default function useBookVisibility(workspaceId, bookId) {
  const api = useMemo(() => createConsoleApi(), [])
  const load = useCallback(
    () => loadBookVisibility(api, { workspaceId, bookId }),
    [api, bookId, workspaceId],
  )

  return useApiResource(load)
}
