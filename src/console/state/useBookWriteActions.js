import { useCallback, useMemo, useRef, useState } from 'react'

import { createConsoleApi } from '../../api/console.js'
import { asApiError } from '../../api/envelope.js'
import {
  createWriteKeyBag,
  formatBookWriteError,
  readTeacherCount,
  requireClassShelfApi,
} from '../pages/teaching/bookManagement.js'

export async function grantClassShelfBook(api, { workspaceId, classId, bookId, idempotencyKey }) {
  requireClassShelfApi(api)
  if (!workspaceId) throw new TypeError('当前会话没有可用工作空间')
  if (!classId) throw new TypeError('当前工作空间没有班级，无法投放')
  const response = await api.putClassShelfBook(classId, bookId, { workspaceId, idempotencyKey })
  return {
    data: response.data,
    teacherCount: readTeacherCount(response.data) ?? readTeacherCount(response),
  }
}

export async function revokeClassShelfBook(api, { workspaceId, classId, bookId, idempotencyKey }) {
  requireClassShelfApi(api)
  if (!workspaceId) throw new TypeError('当前会话没有可用工作空间')
  if (!classId) throw new TypeError('当前工作空间没有班级，无法撤下')
  const response = await api.deleteClassShelfBook(classId, bookId, { workspaceId, idempotencyKey })
  return {
    data: response.data,
    teacherCount: readTeacherCount(response.data) ?? readTeacherCount(response),
  }
}

export default function useBookWriteActions(workspaceId) {
  const api = useMemo(() => createConsoleApi(), [])
  const keys = useRef(createWriteKeyBag())
  const [actionState, setActionState] = useState({ status: 'idle', action: null, bookId: null, error: null })
  const [teacherCount, setTeacherCount] = useState(null)

  const rememberTeacherCount = useCallback((count) => {
    if (Number.isInteger(count) && count >= 0) setTeacherCount(count)
  }, [])

  const runWrite = useCallback(async (action, bookId, keyScope, request) => {
    if (!workspaceId) throw new TypeError('当前会话没有可用工作空间')
    const idempotencyKey = keys.current.take(keyScope)
    setActionState({ status: 'loading', action, bookId, error: null })
    try {
      const result = await request(idempotencyKey)
      keys.current.clear(keyScope)
      rememberTeacherCount(result?.teacherCount)
      setActionState({ status: 'ready', action, bookId, error: null })
      return result
    } catch (error) {
      const apiError = asApiError(error)
      setActionState({ status: 'error', action, bookId, error: apiError })
      throw apiError
    }
  }, [rememberTeacherCount, workspaceId])

  const putClassShelfBook = useCallback((classId, bookId) => (
    runWrite('grant', bookId, `shelf-grant:${classId}:${bookId}`, (idempotencyKey) =>
      grantClassShelfBook(api, { workspaceId, classId, bookId, idempotencyKey }))
  ), [api, runWrite, workspaceId])

  const deleteClassShelfBook = useCallback((classId, bookId) => (
    runWrite('revoke', bookId, `shelf-revoke:${classId}:${bookId}`, (idempotencyKey) =>
      revokeClassShelfBook(api, { workspaceId, classId, bookId, idempotencyKey }))
  ), [api, runWrite, workspaceId])

  const resetActionState = useCallback(() => {
    setActionState({ status: 'idle', action: null, bookId: null, error: null })
  }, [])

  const applyTeacherCount = useCallback((value) => {
    rememberTeacherCount(readTeacherCount({ teacherCount: value }) ?? value)
  }, [rememberTeacherCount])

  return {
    putClassShelfBook,
    deleteClassShelfBook,
    teacherCount,
    applyTeacherCount,
    actionState,
    resetActionState,
    formatError: formatBookWriteError,
  }
}
