import { useCallback, useEffect, useRef, useState } from 'react'

import { createStudentApi } from '../../api/student.js'

const POLL_MS = 1500
const HEARTBEAT_EVERY = 10

function idempotencyKey(prefix) {
  return `${prefix}-${Date.now()}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`
}

export default function useClassroomRuntime(seed, workspaceId) {
  const [data, setData] = useState(seed || null)
  const [error, setError] = useState(null)
  const apiRef = useRef(null)
  const tickRef = useRef(0)
  if (!apiRef.current) apiRef.current = createStudentApi()

  useEffect(() => {
    setData(seed || null)
    setError(null)
  }, [seed?.id])

  useEffect(() => {
    const sessionId = seed?.id
    if (!sessionId || !workspaceId) return undefined
    let cancelled = false
    let timer
    const refresh = async (heartbeat = false) => {
      try {
        const options = { workspaceId }
        const response = heartbeat
          ? await apiRef.current.joinClassroom(sessionId, { ...options, idempotencyKey: idempotencyKey(`classroom-join-${sessionId}`) })
          : await apiRef.current.getClassroomState(sessionId, options)
        if (!cancelled) {
          setData(response.data)
          setError(null)
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError)
          setData((current) => current ? { ...current, connected: false } : current)
        }
      }
    }
    refresh(true)
    timer = globalThis.setInterval(() => {
      tickRef.current += 1
      refresh(tickRef.current % HEARTBEAT_EVERY === 0)
    }, POLL_MS)
    return () => {
      cancelled = true
      globalThis.clearInterval(timer)
    }
  }, [seed?.id, workspaceId])

  const acknowledgeBroadcast = useCallback(async (broadcastId) => {
    const sessionId = data?.id || seed?.id
    if (!sessionId || !broadcastId || !workspaceId) return null
    const response = await apiRef.current.acknowledgeClassroomBroadcast(sessionId, broadcastId, {
      workspaceId,
      idempotencyKey: idempotencyKey(`classroom-received-${broadcastId}`),
    })
    setData((current) => current?.broadcast?.id === broadcastId
      ? { ...current, broadcast: { ...current.broadcast, received: true } }
      : current)
    return response.data
  }, [data?.id, seed?.id, workspaceId])

  return { data, error, acknowledgeBroadcast }
}
