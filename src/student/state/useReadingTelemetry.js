import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createStudentApi } from '../../api/student.js'

function newEventId(prefix) {
  if (typeof globalThis.crypto?.randomUUID !== 'function') throw new Error('当前浏览器无法生成安全阅读事件标识')
  return `${prefix}-${globalThis.crypto.randomUUID()}`
}

export function initialOfflineSequence(lease) {
  const nextOfflineSequence = Number(lease?.data?.nextOfflineSequence ?? lease?.nextOfflineSequence)
  if (!Number.isInteger(nextOfflineSequence) || nextOfflineSequence < 1) {
    throw new Error('阅读租约没有返回有效的下一离线序号')
  }
  return nextOfflineSequence - 1
}

export default function useReadingTelemetry({ bookVersionId, pageNo, workspaceId }) {
  const api = useMemo(() => createStudentApi(), [])
  const leaseReady = useRef(false)
  const active = useRef({ pageNo: null, startedAt: null })
  const latestPage = useRef(pageNo)
  const sequence = useRef(0)
  const queue = useRef(Promise.resolve())
  const leaseRequest = useRef({ identity: null, idempotencyKey: null })
  const [error, setError] = useState(null)

  const enqueue = useCallback((events) => {
    if (!workspaceId || !events.length) return
    const idempotencyKey = newEventId('student-reading-batch')
    queue.current = queue.current
      .catch(() => undefined)
      .then(() => api.submitReadingEvents({ events }, { workspaceId, idempotencyKey }))
      .catch((nextError) => setError(nextError))
  }, [api, workspaceId])

  const stayEvent = useCallback((state, endedAt) => {
    if (!leaseReady.current || !bookVersionId || !state.pageNo || !state.startedAt) return null
    const durationMs = Math.min(120_000, Math.max(0, endedAt - state.startedAt))
    if (durationMs < 1_000) return null
    sequence.current += 1
    return {
      id: newEventId('student-page-stay'),
      schemaVersion: 1,
      deviceId: 'server-bound-device',
      bookVersionId,
      pageNo: state.pageNo,
      eventType: 'page_stay',
      clientOccurredAt: new Date(state.startedAt).toISOString(),
      durationMs,
      foreground: typeof document === 'undefined' || document.visibilityState === 'visible',
      screenOn: true,
      offlineSequence: sequence.current,
      classSessionId: null,
      payload: {},
    }
  }, [bookVersionId])

  const flushStay = useCallback(() => {
    const endedAt = Date.now()
    const event = stayEvent(active.current, endedAt)
    active.current = { ...active.current, startedAt: endedAt }
    if (event) enqueue([event])
  }, [enqueue, stayEvent])

  useEffect(() => {
    latestPage.current = pageNo
    if (!leaseReady.current || !Number.isInteger(pageNo) || pageNo < 1) return
    const previous = active.current
    if (!previous.pageNo) {
      active.current = { pageNo, startedAt: Date.now() }
      return
    }
    if (previous.pageNo === pageNo) return
    const changedAt = Date.now()
    const events = []
    const stay = stayEvent(previous, changedAt)
    if (stay) events.push(stay)
    sequence.current += 1
    events.push({
      id: newEventId('student-page-turn'),
      schemaVersion: 1,
      deviceId: 'server-bound-device',
      bookVersionId,
      pageNo,
      eventType: 'page_turn',
      clientOccurredAt: new Date(changedAt).toISOString(),
      durationMs: 0,
      foreground: typeof document === 'undefined' || document.visibilityState === 'visible',
      screenOn: true,
      offlineSequence: sequence.current,
      classSessionId: null,
      payload: { fromPageNo: previous.pageNo, direction: pageNo > previous.pageNo ? 'next' : 'previous' },
    })
    active.current = { pageNo, startedAt: changedAt }
    enqueue(events)
  }, [bookVersionId, enqueue, pageNo, stayEvent])

  useEffect(() => {
    if (!bookVersionId || !workspaceId) return undefined
    let cancelled = false
    leaseReady.current = false
    active.current = { pageNo: null, startedAt: null }
    setError(null)
    const identity = `${workspaceId}:${bookVersionId}`
    if (leaseRequest.current.identity !== identity) {
      leaseRequest.current = { identity, idempotencyKey: newEventId('student-reading-lease') }
    }
    const { idempotencyKey } = leaseRequest.current
    api.acquireReadingLease({ bookVersionId }, { workspaceId, idempotencyKey })
      .then((lease) => {
        if (cancelled) return
        sequence.current = initialOfflineSequence(lease)
        leaseReady.current = true
        active.current = { pageNo: latestPage.current, startedAt: Date.now() }
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError)
      })
    return () => {
      if (leaseReady.current) flushStay()
      cancelled = true
      leaseReady.current = false
    }
  }, [api, bookVersionId, flushStay, workspaceId])

  useEffect(() => {
    if (!bookVersionId || !workspaceId) return undefined
    const timer = window.setInterval(flushStay, 60_000)
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') flushStay()
      else if (leaseReady.current) active.current = { pageNo: latestPage.current, startedAt: Date.now() }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [bookVersionId, flushStay, workspaceId])

  return { error }
}
