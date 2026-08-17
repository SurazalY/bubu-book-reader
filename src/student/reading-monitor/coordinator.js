import { createActivityTracker } from './activity.js'
import { exactIso, nextStatDateBoundary, pointAtWallBoundary, statDateFor } from './clock.js'
import { SESSION_END_REASONS, SUMMARY_INTERVAL_MS, assertEnum } from './constants.js'
import { createLeaseController } from './leaseController.js'
import { createPendingQueue } from './pendingQueue.js'
import { createRevisionCursor, createSummaryRevision } from './summary.js'

function defaultScheduler() {
  return {
    setTimeout(callback, delayMs) {
      return globalThis.setTimeout(callback, delayMs)
    },
    clearTimeout(timer) {
      globalThis.clearTimeout(timer)
    },
  }
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value) throw new TypeError(`${label}不能为空`)
  return value
}

function assertScope(scope) {
  requiredString(scope?.organizationId, 'organizationId')
  requiredString(scope?.studentId, 'studentId')
  requiredString(scope?.workspaceId, 'workspaceId')
  if (scope?.deviceId != null) requiredString(scope.deviceId, 'deviceId')
  return { ...scope }
}

function pendingCapacityError(usage, cause = null) {
  const error = new Error('阅读待确认区已满，请联网排空后继续', cause ? { cause } : undefined)
  error.code = 'PENDING_STORE_FULL'
  error.usage = usage
  return error
}

export function createReadingMonitorCoordinator({
  clock,
  scheduler = defaultScheduler(),
  ports,
  pendingStore,
  scope: suppliedScope,
  bookVersionId,
  initialView,
  initialReaderMode,
  idFactory,
  cryptoImpl,
  readerReady = false,
  initiallyVisible = true,
  onError,
  onStateChange,
} = {}) {
  if (!clock?.now || !clock?.wallNow) throw new TypeError('阅读监测协调器需要可注入双时钟')
  if (typeof idFactory !== 'function') throw new TypeError('阅读监测协调器需要安全ID生成器')
  if (typeof ports?.submitSummary !== 'function') throw new TypeError('阅读监测端口缺少submitSummary')
  const acquisitionScope = assertScope(suppliedScope)
  let scope = null
  requiredString(bookVersionId, 'bookVersionId')
  if (!['original', 'text'].includes(initialReaderMode)) throw new TypeError('initialReaderMode必须是original或text')

  let tracker = null
  let session = null
  let currentView = initialView
  let currentReaderMode = initialReaderMode
  let summaryTimer = null
  let statDateTimer = null
  let stopped = false
  let closed = false
  let operation = Promise.resolve()
  let detachLifecycle = null
  let lastError = null
  let pendingFinal = null
  let currentVisible = Boolean(initiallyVisible)
  let currentForeground = Boolean(initiallyVisible)
  let pendingCapacityBlocked = false
  let pendingCapacityUsage = null
  let summaryFailureCount = 0

  let queue = null

  function ensureQueue(lease) {
    const trustedDeviceId = lease?.deviceId || scope?.deviceId || acquisitionScope.deviceId
    requiredString(trustedDeviceId, 'lease.deviceId')
    if (acquisitionScope.deviceId && acquisitionScope.deviceId !== trustedDeviceId) {
      const error = new Error('租约返回的可信设备与客户端范围不一致')
      error.code = 'LEASE_SCOPE_MISMATCH'
      throw error
    }
    if (queue) return queue
    scope = Object.freeze({ ...acquisitionScope, deviceId: trustedDeviceId })
    queue = createPendingQueue({
      store: pendingStore,
      port: ports,
      scope,
      onError(error, record) {
        lastError = error
        onError?.(error, { phase: 'summary_submit', record })
        emit()
      },
      onPressure(usage) {
        onStateChange?.({ type: 'pending_pressure', usage })
      },
    })
    return queue
  }

  const leaseController = createLeaseController({
    clock,
    port: ports,
    scope: acquisitionScope,
    bookVersionId,
    idFactory,
    scheduler,
    onLease(lease) {
      ensureQueue(lease)
      tracker?.setLeaseValid(true)
      emit()
    },
    onInvalid({ reason, lease, error, invalidatedAtMs }) {
      lastError = error
      operation = operation.catch(() => undefined).then(async () => {
        const invalidPoint = pointAtWallBoundary(clock, invalidatedAtMs)
        if (session && !closed && statDateFor(invalidPoint.wallMs) !== session.statDate) {
          const boundary = nextStatDateBoundary(invalidPoint.wallMs - 24 * 60 * 60 * 1000)
          const boundaryPoint = pointAtWallBoundary(clock, boundary)
          await closeDirect('stat_date_change', { point: boundaryPoint, stopLease: false })
          createSession(boundaryPoint, lease)
        }
        tracker?.setLeaseValid(false, invalidPoint)
        return closeDirect(reason, {
          point: invalidPoint,
          stopLease: false,
          authoritativeLeaseEnd: true,
        })
      })
    },
    onError(error) {
      lastError = error
      onError?.(error, { phase: 'lease_renew' })
      emit()
    },
  })

  function emit(extra = {}) {
    onStateChange?.({
      type: 'state',
      active: Boolean(session && !closed),
      sessionId: session?.sessionId ?? null,
      statDate: session?.statDate ?? null,
      leaseValid: leaseController.isValid(),
      pendingCapacity: Object.freeze({ blocked: pendingCapacityBlocked, usage: pendingCapacityUsage }),
      error: lastError,
      ...extra,
    })
  }

  function clearTimers() {
    if (summaryTimer != null) scheduler.clearTimeout(summaryTimer)
    if (statDateTimer != null) scheduler.clearTimeout(statDateTimer)
    summaryTimer = null
    statDateTimer = null
  }

  function nextSummaryDelayMs() {
    if (summaryFailureCount <= 0) return SUMMARY_INTERVAL_MS
    const backoffMs = 15_000 * (2 ** Math.min(summaryFailureCount - 1, 3))
    return Math.min(SUMMARY_INTERVAL_MS, backoffMs)
  }

  function scheduleSummary(delayMs = nextSummaryDelayMs()) {
    if (stopped || closed) return
    if (summaryTimer != null) scheduler.clearTimeout(summaryTimer)
    summaryTimer = scheduler.setTimeout(() => {
      summaryTimer = null
      operation = operation.catch(() => undefined).then(async () => {
        try {
          await tickDirect()
          summaryFailureCount = 0
        } catch (error) {
          summaryFailureCount += 1
          lastError = error
          onError?.(error, { phase: 'summary_tick', attempt: summaryFailureCount })
          emit({ type: 'summary_tick_failed', attempt: summaryFailureCount })
        } finally {
          scheduleSummary()
        }
      })
    }, delayMs)
  }

  function scheduleStatDateBoundary() {
    if (stopped || closed) return
    if (statDateTimer != null) scheduler.clearTimeout(statDateTimer)
    const boundary = nextStatDateBoundary(clock.wallNow())
    statDateTimer = scheduler.setTimeout(() => {
      statDateTimer = null
      operation = operation.catch(() => undefined).then(() => rollStatDateDirect(boundary))
    }, Math.max(0, boundary - clock.wallNow()))
  }

  function createSession(point, lease) {
    const startedAt = exactIso(point.wallMs)
    session = {
      sessionId: idFactory('reading-session'),
      leaseId: lease.leaseId,
      statDate: statDateFor(point.wallMs),
      startedAt,
      revisions: createRevisionCursor(),
    }
    tracker = createActivityTracker({
      clock,
      initialView: currentView,
      initialReaderMode: currentReaderMode,
      ready: readerReady,
      visible: currentVisible,
      foreground: currentForeground,
      leaseValid: true,
      storageAvailable: !pendingCapacityBlocked,
      initialPoint: point,
    })
    closed = false
    summaryFailureCount = 0
    emit({ type: 'session_started' })
  }

  function reconcilePendingCapacity(usage, point = clock.now(), cause = null) {
    if (!usage) return { blocked: pendingCapacityBlocked, changed: false, error: null }
    const wasBlocked = pendingCapacityBlocked
    pendingCapacityUsage = usage
    if (usage.full) pendingCapacityBlocked = true
    else if (pendingCapacityBlocked && !usage.pressure) pendingCapacityBlocked = false
    tracker?.setStorageAvailable(!pendingCapacityBlocked, point)
    let error = null
    if (pendingCapacityBlocked) {
      error = pendingCapacityError(usage, cause)
      lastError = error
      if (!wasBlocked) {
        onError?.(error, { phase: 'pending_capacity', usage })
        onStateChange?.({ type: 'pending_full', usage, error })
      }
    } else if (wasBlocked && lastError?.code === 'PENDING_STORE_FULL') {
      lastError = cause || null
      onStateChange?.({ type: 'pending_recovered', usage })
    }
    return { blocked: pendingCapacityBlocked, changed: wasBlocked !== pendingCapacityBlocked, error }
  }

  async function persistSnapshot({ point = clock.now(), endedAt = null, endReason = null } = {}) {
    if (!session || !tracker) return null
    if (!queue) throw new Error('阅读待确认队列尚未绑定可信设备')
    const measured = endedAt ? tracker.end(point) : tracker.measure(point)
    if (!Number.isSafeInteger(measured.lastPageNo) || measured.lastPageNo < 1) return null
    const revision = session.revisions.peek()
    const normalizedEndedAt = endedAt == null
      ? null
      : exactIso(Math.max(Date.parse(endedAt), measured.measuredThroughWallMs))
    const summary = await createSummaryRevision({
      sessionId: session.sessionId,
      revision,
      leaseId: session.leaseId,
      bookVersionId,
      statDate: session.statDate,
      startedAt: session.startedAt,
      measuredThroughAt: exactIso(measured.measuredThroughWallMs),
      cumulativeEffectiveMs: measured.cumulativeEffectiveMs,
      hadSkip: measured.hadSkip,
      hadReread: measured.hadReread,
      lastPageNo: measured.lastPageNo,
      pageCoverage: measured.pageCoverage,
      endedAt: normalizedEndedAt,
      endReason,
    }, { cryptoImpl })
    const idempotencyKey = `reading-summary:${summary.sessionId}:${summary.revision}:${summary.fingerprint}`
    try {
      const outcome = await queue.enqueue(summary, { idempotencyKey, createdAt: point.wallMs })
      session.revisions.commit(revision)
      const capacity = reconcilePendingCapacity(outcome.usageAfterDrain, point, outcome.drain?.error)
      if (!capacity.blocked) lastError = outcome.drain?.error || null
      emit({ type: 'summary_persisted', revision, confirmed: outcome.confirmed })
      return { summary, outcome }
    } catch (error) {
      lastError = error
      if (error?.code === 'PENDING_STORE_FULL') reconcilePendingCapacity(error.usage, point, error)
      onError?.(error, { phase: 'summary_persist' })
      emit({ type: 'summary_failed' })
      throw error
    }
  }

  async function closeDirect(reason, {
    point = clock.now(),
    stopLease = true,
    authoritativeLeaseEnd = false,
  } = {}) {
    assertEnum(reason, SESSION_END_REASONS, '会话结束原因')
    if (!session || (closed && !pendingFinal)) return { confirmed: true, summary: null }
    const closing = pendingFinal || { reason, point, stopLease, authoritativeLeaseEnd }
    pendingFinal = closing
    closed = true
    clearTimers()
    const closingSessionId = session.sessionId
    if (closing.stopLease) leaseController.stop()
    let persisted
    try {
      persisted = await persistSnapshot({
        point: closing.point,
        endedAt: closing.authoritativeLeaseEnd ? null : exactIso(closing.point.wallMs),
        endReason: closing.authoritativeLeaseEnd ? null : closing.reason,
      })
      pendingFinal = null
    } catch (error) {
      emit({ type: 'session_close_pending', reason: closing.reason })
      throw error
    }
    emit({ type: 'session_closed', reason: closing.reason })
    if (!persisted) return { confirmed: true, summary: null }
    if (persisted.outcome.confirmed) return { confirmed: true, summary: persisted.summary }
    return { confirmed: false, summary: persisted.summary, pendingKey: persisted.outcome.record.key, sessionId: closingSessionId }
  }

  async function rollStatDateDirect(boundaryWallMs = nextStatDateBoundary(clock.wallNow())) {
    if (!session || closed) return null
    const boundaryPoint = pointAtWallBoundary(clock, boundaryWallMs)
    await closeDirect('stat_date_change', { point: boundaryPoint, stopLease: false })
    const lease = leaseController.current()
    if (!lease || stopped) return null
    createSession(boundaryPoint, lease)
    scheduleSummary()
    scheduleStatDateBoundary()
    return session
  }

  async function tickDirect() {
    if (!session || closed) return null
    const now = clock.now()
    if (statDateFor(now.wallMs) !== session.statDate) {
      return rollStatDateDirect(nextStatDateBoundary(now.wallMs - 24 * 60 * 60 * 1000))
    }
    if (!leaseController.current()) return null
    return persistSnapshot({ point: now })
  }

  async function ensureCurrentStatDateDirect() {
    if (!session || closed || statDateFor(clock.wallNow()) === session.statDate) return null
    return rollStatDateDirect(nextStatDateBoundary(clock.wallNow() - 24 * 60 * 60 * 1000))
  }

  async function start() {
    stopped = false
    closed = false
    const lease = await leaseController.start()
    await queue?.drain()
    const initialUsage = queue ? await queue.usage() : null
    if (initialUsage) {
      pendingCapacityUsage = initialUsage
      pendingCapacityBlocked = initialUsage.full
      if (pendingCapacityBlocked) lastError = pendingCapacityError(initialUsage, queue.getLastError?.())
    }
    const point = clock.now()
    createSession(point, lease)
    scheduleSummary()
    scheduleStatDateBoundary()
    return getState()
  }

  function run(operationFn) {
    const task = operation.catch(() => undefined).then(operationFn)
    operation = task.catch(() => undefined)
    return task
  }

  function attach({ documentTarget = globalThis.document, windowTarget = globalThis.window } = {}) {
    detachLifecycle?.()
    if (!documentTarget?.addEventListener || !windowTarget?.addEventListener) return () => {}
    const onVisibility = () => {
      const visible = documentTarget.visibilityState === 'visible'
      run(async () => {
        await ensureCurrentStatDateDirect()
        currentVisible = visible
        currentForeground = visible
        tracker?.setVisible(visible)
        tracker?.setForeground(visible)
        if (!visible) await persistSnapshot()
        emit({ type: visible ? 'foreground' : 'background' })
      })
    }
    const onPageHide = () => run(async () => {
      await ensureCurrentStatDateDirect()
      return closeDirect('reader_close')
    })
    const onFreeze = () => {
      run(async () => {
        await ensureCurrentStatDateDirect()
        currentForeground = false
        tracker?.setForeground(false)
        return persistSnapshot()
      })
    }
    const onOnline = () => run(async () => {
      await ensureCurrentStatDateDirect()
      if (session && !closed) await persistSnapshot()
      const outcome = await queue?.drain() ?? { confirmed: 0, retained: 0, error: null }
      if (pendingFinal) await closeDirect(pendingFinal.reason, pendingFinal)
      const usage = queue ? await queue.usage() : null
      if (usage) reconcilePendingCapacity(usage, clock.now(), outcome.error)
      if (!pendingCapacityBlocked && !outcome.error) lastError = null
      emit({ type: 'network_restored', drain: outcome })
      return outcome
    })
    documentTarget.addEventListener('visibilitychange', onVisibility)
    documentTarget.addEventListener('freeze', onFreeze)
    windowTarget.addEventListener('pagehide', onPageHide)
    windowTarget.addEventListener('online', onOnline)
    detachLifecycle = () => {
      documentTarget.removeEventListener('visibilitychange', onVisibility)
      documentTarget.removeEventListener('freeze', onFreeze)
      windowTarget.removeEventListener('pagehide', onPageHide)
      windowTarget.removeEventListener('online', onOnline)
      detachLifecycle = null
    }
    return detachLifecycle
  }

  function getState() {
    return Object.freeze({
      active: Boolean(session && !closed),
      closed,
      sessionId: session?.sessionId ?? null,
      revision: session?.revisions.peek() ?? null,
      statDate: session?.statDate ?? null,
      lease: leaseController.current(),
      activity: tracker?.getState() ?? null,
      pendingCapacity: Object.freeze({ blocked: pendingCapacityBlocked, usage: pendingCapacityUsage }),
      error: lastError,
    })
  }

  return Object.freeze({
    start,
    attachLifecycle: attach,
    move(view, source) {
      return run(async () => {
        await ensureCurrentStatDateDirect()
        currentView = view
        return tracker?.move(view, source) ?? null
      })
    },
    confirmedInteraction(pageNos) {
      return run(async () => {
        await ensureCurrentStatDateDirect()
        const measured = tracker?.confirmedInteraction(pageNos) ?? null
        if (measured && session && !closed && !pendingCapacityBlocked) await persistSnapshot()
        return measured
      })
    },
    setReaderMode(value) {
      return run(async () => {
        await ensureCurrentStatDateDirect()
        if (!['original', 'text'].includes(value)) throw new TypeError('阅读模式必须是original或text')
        currentReaderMode = value
        return tracker?.setReaderMode(value) ?? null
      })
    },
    setReaderReady(value) {
      readerReady = Boolean(value)
      tracker?.setReady(readerReady)
    },
    flush() {
      return run(() => tickDirect())
    },
    drain() {
      return run(async () => {
        const outcome = await queue?.drain() ?? { confirmed: 0, retained: 0, error: null }
        if (pendingFinal) await closeDirect(pendingFinal.reason, pendingFinal)
        const usage = queue ? await queue.usage() : null
        if (usage) reconcilePendingCapacity(usage, clock.now(), outcome.error)
        if (!pendingCapacityBlocked && !outcome.error) lastError = null
        emit({ type: 'pending_drained', drain: outcome })
        return outcome
      })
    },
    rollStatDate(boundaryWallMs) {
      return run(() => rollStatDateDirect(boundaryWallMs))
    },
    close(reason = 'reader_close', options = {}) {
      const waitForTerminal = options.waitForTerminal === true
      const closing = run(async () => {
        await ensureCurrentStatDateDirect()
        return closeDirect(reason, options)
      })
      if (!waitForTerminal) return closing
      return closing.then(async (result) => {
        if (result.confirmed || !result.pendingKey) return result
        const confirmation = await queue.waitForTerminal(result.pendingKey)
        return { ...result, confirmed: true, confirmation }
      })
    },
    async stop() {
      stopped = true
      clearTimers()
      detachLifecycle?.()
      leaseController.stop()
      await operation.catch(() => undefined)
    },
    waitIdle() {
      return operation.catch(() => undefined)
    },
    getState,
  })
}
