import { useCallback, useMemo, useRef, useState } from 'react'

import { createConsoleApi } from '../../api/console.js'
import { asApiError } from '../../api/envelope.js'
import {
  createWriteKeyBag,
  formatBookWriteError,
  visibilityWriteBody,
} from '../pages/teaching/bookManagement.js'

export default function useBookWriteActions(workspaceId) {
  const api = useMemo(() => createConsoleApi(), [])
  const keys = useRef(createWriteKeyBag())
  const [actionState, setActionState] = useState({ status: 'idle', action: null, bookId: null, error: null })

  const runWrite = useCallback(async (action, bookId, keyScope, request) => {
    if (!workspaceId) throw new TypeError('当前会话没有可用工作空间')
    const idempotencyKey = keys.current.take(keyScope)
    setActionState({ status: 'loading', action, bookId, error: null })
    try {
      const data = await request(idempotencyKey)
      keys.current.clear(keyScope)
      setActionState({ status: 'ready', action, bookId, error: null })
      return data
    } catch (error) {
      const apiError = asApiError(error)
      setActionState({ status: 'error', action, bookId, error: apiError })
      throw apiError
    }
  }, [workspaceId])

  const publishBook = useCallback((bookId) => (
    runWrite('publish', bookId, `publish:${bookId}`, (idempotencyKey) =>
      api.publishBook(bookId, { workspaceId, idempotencyKey }).then((response) => response.data))
  ), [api, runWrite, workspaceId])

  const unpublishBook = useCallback((bookId) => (
    runWrite('unpublish', bookId, `unpublish:${bookId}`, (idempotencyKey) =>
      api.unpublishBook(bookId, { workspaceId, idempotencyKey }).then((response) => response.data))
  ), [api, runWrite, workspaceId])

  const setBookVisibility = useCallback((bookId, { scope, classIds }) => {
    const body = visibilityWriteBody(scope, classIds)
    return runWrite('visibility', bookId, `visibility:${bookId}:${JSON.stringify(body)}`, (idempotencyKey) =>
      api.setBookVisibility(bookId, body, { workspaceId, idempotencyKey }).then((response) => response.data))
  }, [api, runWrite, workspaceId])

  const resetActionState = useCallback(() => {
    setActionState({ status: 'idle', action: null, bookId: null, error: null })
  }, [])

  return {
    publishBook,
    unpublishBook,
    setBookVisibility,
    actionState,
    resetActionState,
    formatError: formatBookWriteError,
  }
}
