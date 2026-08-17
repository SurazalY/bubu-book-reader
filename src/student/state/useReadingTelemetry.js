import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createStudentApi } from '../../api/student.js'
import {
  createClock,
  createPendingStore,
  createReadingMonitorApiPorts,
  createReadingMonitorCoordinator,
  createStableView,
  movement as assertMovementSource,
  resolveReadingMonitorScope,
} from '../reading-monitor/index.js'

function newEventId(prefix) {
  if (typeof globalThis.crypto?.randomUUID !== 'function') throw new Error('当前浏览器无法生成安全阅读事件标识')
  return `${prefix}-${globalThis.crypto.randomUUID()}`
}

function documentVisible() {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

export function initialOfflineSequence(lease) {
  const nextOfflineSequence = Number(lease?.data?.nextOfflineSequence ?? lease?.nextOfflineSequence)
  if (!Number.isInteger(nextOfflineSequence) || nextOfflineSequence < 1) {
    throw new Error('阅读租约没有返回有效的下一离线序号')
  }
  return nextOfflineSequence - 1
}

export function legacyPageTurnPayload({ fromPageNo, toPageNo } = {}) {
  if (!Number.isInteger(fromPageNo) || fromPageNo < 1 || !Number.isInteger(toPageNo) || toPageNo < 1) {
    throw new TypeError('旧page_turn需要有效的起止页码')
  }
  return Object.freeze({
    fromPageNo,
    direction: toPageNo > fromPageNo ? 'next' : 'previous',
  })
}

// 新累计摘要走 monitor coordinator；旧 page events 仅保留护眼输入并复用同一租约。
// monitor.ports 仍可由测试注入，生产默认适配 createStudentApi 的真实三条接口。
export default function useReadingTelemetry({
  bookVersionId,
  pageNo,
  stableView,
  readerMode,
  movementEvent,
  workspaceId,
  readerReady = true,
  monitor = null,
}) {
  const api = useMemo(() => createStudentApi(), [])
  const leaseReady = useRef(false)
  const active = useRef({ pageNo: null, startedAt: null, visible: false })
  const latestPage = useRef(pageNo)
  const sequence = useRef(0)
  const legacyQueue = useRef(Promise.resolve())
  const coordinatorRef = useRef(null)
  const latestMonitorContext = useRef(null)
  const [legacyError, setLegacyError] = useState(null)
  const [monitorError, setMonitorError] = useState(null)

  const mainPageNo = stableView?.mainPageNo ?? pageNo
  latestMonitorContext.current = monitor?.scope ? {
    organizationId: monitor.scope.organizationId,
    studentId: monitor.scope.studentId,
    workspaceId: monitor.scope.workspaceId,
    deviceId: monitor.scope.deviceId,
    bookVersionId,
  } : null

  const enqueueLegacy = useCallback((events) => {
    if (!workspaceId || !events.length) return
    const idempotencyKey = newEventId('student-reading-batch')
    legacyQueue.current = legacyQueue.current
      .catch(() => undefined)
      .then(() => api.submitReadingEvents({ events }, { workspaceId, idempotencyKey }))
      .catch((nextError) => setLegacyError(nextError))
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
      foreground: state.visible,
      screenOn: state.visible,
      offlineSequence: sequence.current,
      classSessionId: null,
      payload: {},
    }
  }, [bookVersionId])

  const flushLegacyStay = useCallback(({ restart = true } = {}) => {
    const endedAt = Date.now()
    const event = stayEvent(active.current, endedAt)
    active.current = restart && documentVisible()
      ? { ...active.current, startedAt: endedAt, visible: true }
      : { ...active.current, startedAt: null, visible: false }
    if (event) enqueueLegacy([event])
  }, [enqueueLegacy, stayEvent])

  useEffect(() => {
    latestPage.current = mainPageNo
    if (!leaseReady.current || !Number.isInteger(mainPageNo) || mainPageNo < 1) return
    const previous = active.current
    if (!previous.pageNo) {
      if (documentVisible()) active.current = { pageNo: mainPageNo, startedAt: Date.now(), visible: true }
      return
    }
    if (previous.pageNo === mainPageNo) return
    const changedAt = Date.now()
    const visible = documentVisible()
    const events = []
    const stay = stayEvent(previous, changedAt)
    if (stay) events.push(stay)
    sequence.current += 1
    const source = movementEvent?.source || 'system_restore'
    assertMovementSource(source)
    events.push({
      id: newEventId('student-page-turn'),
      schemaVersion: 1,
      deviceId: 'server-bound-device',
      bookVersionId,
      pageNo: mainPageNo,
      eventType: 'page_turn',
      clientOccurredAt: new Date(changedAt).toISOString(),
      durationMs: 0,
      foreground: visible,
      screenOn: visible,
      offlineSequence: sequence.current,
      classSessionId: null,
      payload: legacyPageTurnPayload({ fromPageNo: previous.pageNo, toPageNo: mainPageNo }),
    })
    active.current = visible
      ? { pageNo: mainPageNo, startedAt: changedAt, visible: true }
      : { pageNo: mainPageNo, startedAt: null, visible: false }
    enqueueLegacy(events)
  }, [bookVersionId, enqueueLegacy, mainPageNo, movementEvent?.sequence, movementEvent?.source, stayEvent])

  useEffect(() => {
    if (!bookVersionId || !workspaceId) return undefined
    const timer = window.setInterval(flushLegacyStay, 60_000)
    const onVisibilityChange = () => {
      if (!documentVisible()) flushLegacyStay({ restart: false })
      else if (leaseReady.current) active.current = { pageNo: latestPage.current, startedAt: Date.now(), visible: true }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [bookVersionId, flushLegacyStay, workspaceId])

  useEffect(() => {
    if (!monitor?.scope || !stableView || !bookVersionId || !workspaceId) return undefined
    let disposed = false
    leaseReady.current = false
    active.current = { pageNo: null, startedAt: null, visible: false }
    setLegacyError(null)
    setMonitorError(null)

    const entry = { coordinator: null, ready: null }
    entry.ready = (async () => {
      const scope = await resolveReadingMonitorScope({
        api,
        workspaceId,
        studentId: monitor.scope.studentId,
        organizationId: monitor.scope.organizationId,
      })
      if (disposed) return null
      const ports = monitor.ports || createReadingMonitorApiPorts({ api, workspaceId })
      const pendingStore = monitor.pendingStore || createPendingStore()
      entry.pendingStore = pendingStore
      entry.ownsPendingStore = !monitor.pendingStore
      const coordinator = createReadingMonitorCoordinator({
        clock: monitor.clock || createClock(),
        scheduler: monitor.scheduler,
        ports,
        pendingStore,
        scope,
        bookVersionId,
        initialView: stableView,
        initialReaderMode: readerMode,
        readerReady,
        initiallyVisible: documentVisible(),
        idFactory: monitor.idFactory || newEventId,
        cryptoImpl: monitor.cryptoImpl,
        onError: (error) => {
          if (!disposed) setMonitorError(error)
        },
        onStateChange: (event) => {
          if (event?.leaseValid === false) {
            leaseReady.current = false
            active.current = { pageNo: latestPage.current, startedAt: null, visible: false }
          }
          monitor.onStateChange?.(event)
        },
      })
      entry.coordinator = coordinator
      const state = await coordinator.start()
      if (disposed) return state
      sequence.current = initialOfflineSequence(state.lease)
      leaseReady.current = true
      if (documentVisible()) active.current = { pageNo: latestPage.current, startedAt: Date.now(), visible: true }
      coordinator.attachLifecycle()
      return state
    })().catch((error) => {
      if (!disposed) setMonitorError(error)
      throw error
    })
    coordinatorRef.current = entry

    return () => {
      disposed = true
      if (leaseReady.current) flushLegacyStay({ restart: false })
      leaseReady.current = false
      const latest = latestMonitorContext.current
      const startedContext = {
        organizationId: monitor.scope.organizationId,
        studentId: monitor.scope.studentId,
        workspaceId,
        bookVersionId,
      }
      const reason = latest && latest.studentId !== startedContext.studentId
        ? 'identity_change'
        : latest && startedContext.organizationId && latest.organizationId && latest.organizationId !== startedContext.organizationId
          ? 'identity_change'
          : latest && latest.workspaceId !== startedContext.workspaceId
            ? 'workspace_change'
            : latest && latest.bookVersionId !== startedContext.bookVersionId
              ? 'book_change'
              : 'reader_close'
      entry.ready
        .then(() => entry.coordinator?.close(reason, { waitForTerminal: false }))
        .catch(() => undefined)
        .finally(async () => {
          await entry.coordinator?.stop()
          if (entry.ownsPendingStore) await entry.pendingStore?.close()
        })
      if (coordinatorRef.current === entry) coordinatorRef.current = null
    }
  }, [api, bookVersionId, flushLegacyStay, monitor, workspaceId])

  useEffect(() => {
    const entry = coordinatorRef.current
    if (!entry || !['original', 'text'].includes(readerMode)) return
    entry.ready.then(() => entry.coordinator?.setReaderMode(readerMode)).catch(() => undefined)
  }, [readerMode])

  useEffect(() => {
    const entry = coordinatorRef.current
    entry?.ready.then(() => entry.coordinator?.setReaderReady(readerReady)).catch(() => undefined)
  }, [readerReady])

  useEffect(() => {
    const entry = coordinatorRef.current
    if (!entry || !stableView || !movementEvent?.sequence) return
    entry.ready
      .then(() => entry.coordinator?.move(stableView, movementEvent.source))
      .catch(() => undefined)
  }, [movementEvent?.sequence, movementEvent?.source, stableView])

  return {
    error: monitorError || legacyError,
    confirmInteraction(_kind, pageNos = stableView?.pageNos) {
      const entry = coordinatorRef.current
      if (!entry) return Promise.resolve(null)
      return entry.ready.then(() => entry.coordinator?.confirmedInteraction(pageNos) ?? null)
    },
    closeAndWait(reason = 'reader_close') {
      const entry = coordinatorRef.current
      if (!entry) return Promise.resolve({ confirmed: true })
      return entry.ready.then(() => entry.coordinator?.close(reason, { waitForTerminal: true }) ?? { confirmed: true })
    },
    drainPending() {
      const entry = coordinatorRef.current
      if (!entry) return Promise.resolve({ confirmed: 0, retained: 0, error: null })
      return entry.ready.then(() => entry.coordinator?.drain() ?? { confirmed: 0, retained: 0, error: null })
    },
  }
}

export function singlePageView(pageNo) {
  return createStableView({ layout: 'single', pageNos: [pageNo] })
}
