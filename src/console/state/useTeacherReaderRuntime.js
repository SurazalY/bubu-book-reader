import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createConsoleApi } from '../../api/console.js'

function key(prefix) {
  return `${prefix}-${Date.now()}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`
}

function toReaderPage(raw) {
  const blocks = Array.isArray(raw?.blocks) ? raw.blocks : []
  const paragraphs = blocks.map((block) => block.text).filter(Boolean)
  if (paragraphs.length === 0 && raw?.text) paragraphs.push(raw.text)
  return {
    index: raw.pageNo,
    heading: `第 ${raw.pageNo} 页`,
    paragraphs: paragraphs.length ? paragraphs : ['服务端返回了空页。'],
  }
}

export default function useTeacherReaderRuntime(bookId) {
  const api = useMemo(() => createConsoleApi(), [])
  const [state, setState] = useState({ status: 'loading', book: null, pages: [], assignment: null, classroom: null, workspaceId: null, error: null })
  const stateRef = useRef(state)
  stateRef.current = state

  const load = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading', error: null }))
    try {
      const session = await api.getSession()
      const workspaceId = session.data?.activeWorkspaceId || session.data?.workspaceId
      if (!workspaceId) throw new Error('当前账号没有可用工作空间')
      const options = { workspaceId }
      const [booksResponse, assignmentsResponse] = await Promise.all([api.listBooks(options), api.listAssignments(options)])
      const book = booksResponse.data?.items?.find((item) => item.id === bookId) || null
      if (!book) {
        setState({ status: 'empty', book: null, pages: [], assignment: null, classroom: null, workspaceId, error: null })
        return
      }
      const totalPages = Math.max(1, Number(book.progress?.totalPages) || 1)
      const [pages, classroomResponse] = await Promise.all([
        Promise.all(Array.from({ length: totalPages }, (_, index) =>
          api.getBookPage(book.id, index + 1, { workspaceId, query: { versionId: book.versionId } }).then((response) => toReaderPage(response.data)))),
        book.classReading?.id ? api.getClassroomState(book.classReading.id, options) : Promise.resolve(null),
      ])
      const assignment = assignmentsResponse.data?.items?.find((item) => item.book?.id === book.versionId) || null
      setState({ status: 'ready', book, pages, assignment, classroom: classroomResponse?.data || book.classReading || null, workspaceId, error: null })
    } catch (error) {
      setState((current) => ({ ...current, status: 'error', error }))
    }
  }, [api, bookId])

  useEffect(() => { load() }, [load])

  const refreshClassroom = useCallback(async (sessionId) => {
    const current = stateRef.current
    const response = await api.getClassroomState(sessionId, { workspaceId: current.workspaceId })
    setState((value) => ({ ...value, classroom: response.data }))
    return response.data
  }, [api])

  const ensureClassroom = useCallback(async () => {
    const current = stateRef.current
    if (current.classroom?.id && current.classroom.status !== 'ended') {
      await api.claimClassroomControl(current.classroom.id, { ttlSeconds: 180 }, {
        workspaceId: current.workspaceId,
        idempotencyKey: key('classroom-control-renew'),
      })
      return refreshClassroom(current.classroom.id)
    }
    if (!current.assignment?.id) throw new Error('这本书还没有可用的阅读安排')
    const started = await api.startClassroom({ assignmentId: current.assignment.id, pageNo: 1 }, {
      workspaceId: current.workspaceId,
      idempotencyKey: key('classroom-start'),
    })
    const sessionId = started.data.sessionId
    await api.claimClassroomControl(sessionId, { ttlSeconds: 180 }, {
      workspaceId: current.workspaceId,
      idempotencyKey: key('classroom-control'),
    })
    await api.lockClassroomBook(sessionId, { bookVersionId: current.book.versionId }, {
      workspaceId: current.workspaceId,
      idempotencyKey: key('classroom-lock'),
    })
    return refreshClassroom(sessionId)
  }, [api, refreshClassroom])

  const lock = useCallback(async () => ensureClassroom(), [ensureClassroom])
  const syncPage = useCallback(async (pageNo) => {
    const current = stateRef.current
    const classroom = await ensureClassroom()
    await api.syncClassroomPage(classroom.id, { pageNo }, {
      workspaceId: current.workspaceId,
      idempotencyKey: key(`classroom-page-${pageNo}`),
    })
    return refreshClassroom(classroom.id)
  }, [api, ensureClassroom, refreshClassroom])
  const end = useCallback(async () => {
    const current = stateRef.current
    if (!current.classroom?.id) return null
    const response = await api.endClassroom(current.classroom.id, {
      workspaceId: current.workspaceId,
      idempotencyKey: key('classroom-end'),
    })
    setState((value) => ({ ...value, classroom: { ...value.classroom, ...response.data, mode: 'ended' } }))
    return response.data
  }, [api])

  return { ...state, reload: load, lock, syncPage, end }
}
