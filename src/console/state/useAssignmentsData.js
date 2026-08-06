import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createConsoleApi } from '../../api/console.js'
import { asApiError } from '../../api/envelope.js'
import { useApiResource } from '../../api/useApiResource.js'
import { toAssignmentCreateBody, toAssignmentsDto } from '../../adapters/consoleAssignments.js'

export default function useAssignmentsData(workspaceId) {
  const api = useMemo(() => createConsoleApi(), [])
  const requestSequence = useRef(0)
  const [createState, setCreateState] = useState({ status: 'idle', error: null })
  const load = useCallback(async () => {
    if (!workspaceId) return { data: null, meta: {} }
    const options = { workspaceId }
    const [assignments, books, workspaces] = await Promise.all([
      api.listAssignments(options),
      api.listBooks(options),
      api.listWorkspaces(),
    ])
    return {
      data: toAssignmentsDto({
        workspaceId,
        assignments: assignments.data,
        books: books.data,
        workspaces: workspaces.data,
      }),
      meta: assignments.meta,
    }
  }, [api, workspaceId])
  const resource = useApiResource(load)

  useEffect(() => setCreateState({ status: 'idle', error: null }), [workspaceId])

  const createAssignment = useCallback(async (input) => {
    if (!workspaceId) throw new TypeError('当前会话没有可用工作空间')
    const body = toAssignmentCreateBody(input)
    requestSequence.current += 1
    const uniquePart = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${requestSequence.current}`
    setCreateState({ status: 'loading', error: null })
    try {
      const response = await api.createAssignment(body, {
        workspaceId,
        idempotencyKey: `assignment:create:${workspaceId}:${uniquePart}`,
      })
      setCreateState({ status: 'ready', error: null })
      resource.reload()
      return response.data
    } catch (error) {
      const apiError = asApiError(error)
      setCreateState({ status: 'error', error: apiError })
      throw apiError
    }
  }, [api, resource.reload, workspaceId])

  const resetCreateState = useCallback(() => setCreateState({ status: 'idle', error: null }), [])

  return { ...resource, createAssignment, createState, resetCreateState }
}
