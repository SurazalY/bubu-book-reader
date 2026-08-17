import {
  MAX_CONTINUOUS_EFFECTIVE_MS,
  MOVEMENT_SOURCES,
  REREAD_VIEW_MIN_MS,
  SKIP_VIEW_MAX_MS,
  STUDENT_MOVEMENT_SOURCES,
  assertEnum,
} from './constants.js'
import { areAdjacentViews } from './view.js'

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label}必须是非负安全整数`)
  return value
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label}必须是正安全整数`)
  return value
}

function normalizePoint(clock, point) {
  const next = point || clock.now()
  const wallMs = Number(next.wallMs)
  const monotonicMs = Number(next.monotonicMs)
  if (!Number.isFinite(wallMs) || !Number.isFinite(monotonicMs)) throw new TypeError('计时点必须包含有效墙钟和单调钟')
  return { wallMs, monotonicMs }
}

export function createActivityTracker({
  clock,
  initialView = null,
  initialReaderMode,
  ready = false,
  visible = true,
  foreground = true,
  leaseValid = false,
  storageAvailable = true,
  maxContinuousMs = MAX_CONTINUOUS_EFFECTIVE_MS,
  initialPoint,
} = {}) {
  if (!clock?.now) throw new TypeError('有效停留追踪器需要可注入时钟')
  nonNegativeInteger(maxContinuousMs, '单段上限')
  if (!['original', 'text'].includes(initialReaderMode)) throw new TypeError('阅读模式必须是original或text')

  const state = {
    ready: Boolean(ready),
    visible: Boolean(visible),
    foreground: Boolean(foreground),
    leaseValid: Boolean(leaseValid),
    storageAvailable: Boolean(storageAvailable),
    view: initialView,
    readerMode: initialReaderMode,
    pageCoverage: new Map(),
    visitEffectiveMs: 0,
    segment: null,
    cumulativeEffectiveMs: 0,
    measuredThroughWallMs: null,
    hadSkip: false,
    hadReread: false,
    fastAdjacentViewCount: 0,
    rereadCandidateViewKey: null,
  }

  function eligible() {
    return Boolean(state.ready && state.visible && state.foreground && state.leaseValid && state.storageAvailable && state.view)
  }

  function startSegment(point) {
    if (state.segment || !eligible()) return
    const at = normalizePoint(clock, point)
    state.segment = { startedMonotonicMs: at.monotonicMs, creditedMs: 0 }
    state.measuredThroughWallMs = Math.max(state.measuredThroughWallMs ?? at.wallMs, at.wallMs)
  }

  function capture(point, close) {
    const at = normalizePoint(clock, point)
    state.measuredThroughWallMs = Math.max(state.measuredThroughWallMs ?? at.wallMs, at.wallMs)
    if (!state.segment) return 0
    const elapsed = Math.max(0, Math.floor(at.monotonicMs - state.segment.startedMonotonicMs))
    const credited = Math.min(maxContinuousMs, elapsed)
    const delta = Math.max(0, credited - state.segment.creditedMs)
    state.segment.creditedMs = credited
    state.cumulativeEffectiveMs += delta
    state.visitEffectiveMs += delta
    if (delta > 0) {
      for (const pageNo of state.view?.pageNos || []) {
        const coverage = state.pageCoverage.get(pageNo) || {
          pageNo,
          effectiveOriginalMs: 0,
          effectiveTextMs: 0,
          confirmedInteractions: 0,
        }
        if (state.readerMode === 'original') coverage.effectiveOriginalMs += delta
        else coverage.effectiveTextMs += delta
        state.pageCoverage.set(pageNo, coverage)
      }
    }
    if (close) state.segment = null
    return delta
  }

  function cut(point) {
    return capture(point, true)
  }

  function synchronizeEligibility(patch, point) {
    const wasEligible = eligible()
    Object.assign(state, patch)
    const isEligible = eligible()
    if (wasEligible && !isEligible) cut(point)
    else if (!wasEligible && isEligible) startSegment(point)
  }

  function finishView(nextView, source, { readerEnding = false } = {}) {
    const previousView = state.view
    const durationMs = state.visitEffectiveMs
    const studentMovement = STUDENT_MOVEMENT_SOURCES.includes(source)

    if (state.rereadCandidateViewKey === previousView?.key) {
      if ((studentMovement || readerEnding) && durationMs > REREAD_VIEW_MIN_MS) state.hadReread = true
      state.rereadCandidateViewKey = null
    }

    if (source === 'student_adjacent' && areAdjacentViews(previousView, nextView) && durationMs > 0 && durationMs < SKIP_VIEW_MAX_MS) {
      state.fastAdjacentViewCount += 1
      if (state.fastAdjacentViewCount >= 2) state.hadSkip = true
    } else if (!readerEnding) {
      state.fastAdjacentViewCount = 0
    }

    if (!readerEnding && studentMovement && previousView && nextView && previousView.mainPageNo - nextView.mainPageNo >= 3) {
      state.rereadCandidateViewKey = nextView.key
    } else if (!readerEnding && !studentMovement) {
      state.rereadCandidateViewKey = null
    }
  }

  function move(nextView, source, point) {
    assertEnum(source, MOVEMENT_SOURCES, '位置变化来源')
    if (!nextView) throw new TypeError('位置变化必须提供稳定阅读视图')
    const at = normalizePoint(clock, point)
    cut(at)
    if (state.view?.key === nextView.key) {
      if (!STUDENT_MOVEMENT_SOURCES.includes(source)) {
        state.fastAdjacentViewCount = 0
        state.rereadCandidateViewKey = null
      }
      startSegment(at)
      return snapshot(at, false)
    }
    finishView(nextView, source)
    state.view = nextView
    state.visitEffectiveMs = 0
    startSegment(at)
    return snapshot(at, false)
  }

  function confirmedInteraction(pageNos = state.view?.pageNos || [], point) {
    if (!Array.isArray(pageNos) || pageNos.length === 0) throw new TypeError('确认交互必须携带物理页')
    const normalizedPages = [...new Set(pageNos.map((pageNo) => positiveInteger(pageNo, '确认交互物理页')))]
    const at = normalizePoint(clock, point)
    const acceptInteraction = eligible()
    cut(at)
    if (acceptInteraction) {
      for (const pageNo of normalizedPages) {
        const coverage = state.pageCoverage.get(pageNo) || {
          pageNo,
          effectiveOriginalMs: 0,
          effectiveTextMs: 0,
          confirmedInteractions: 0,
        }
        coverage.confirmedInteractions += 1
        state.pageCoverage.set(pageNo, coverage)
      }
    }
    startSegment(at)
    return snapshot(at, false)
  }

  function snapshot(point, measure = true) {
    const at = normalizePoint(clock, point)
    if (measure) capture(at, false)
    return Object.freeze({
      cumulativeEffectiveMs: state.cumulativeEffectiveMs,
      hadSkip: state.hadSkip,
      hadReread: state.hadReread,
      lastPageNo: state.view?.mainPageNo ?? null,
      readerMode: state.readerMode,
      pageCoverage: Object.freeze([...state.pageCoverage.values()]
        .sort((left, right) => left.pageNo - right.pageNo)
        .map((entry) => Object.freeze({ ...entry }))),
      measuredThroughWallMs: state.measuredThroughWallMs ?? at.wallMs,
      segmentActive: Boolean(state.segment),
      viewEffectiveMs: state.visitEffectiveMs,
    })
  }

  function end(point) {
    const at = normalizePoint(clock, point)
    cut(at)
    finishView(null, 'system_restore', { readerEnding: true })
    state.ready = false
    return snapshot(at, false)
  }

  startSegment(initialPoint || clock.now())

  return Object.freeze({
    move,
    confirmedInteraction,
    measure(point) {
      return snapshot(point, true)
    },
    cut,
    end,
    setReady(value, point) {
      synchronizeEligibility({ ready: Boolean(value) }, point)
    },
    setVisible(value, point) {
      synchronizeEligibility({ visible: Boolean(value) }, point)
    },
    setForeground(value, point) {
      synchronizeEligibility({ foreground: Boolean(value) }, point)
    },
    setLeaseValid(value, point) {
      synchronizeEligibility({ leaseValid: Boolean(value) }, point)
    },
    setStorageAvailable(value, point) {
      synchronizeEligibility({ storageAvailable: Boolean(value) }, point)
    },
    setReaderMode(value, point) {
      if (!['original', 'text'].includes(value)) throw new TypeError('阅读模式必须是original或text')
      const at = normalizePoint(clock, point)
      cut(at)
      state.readerMode = value
      startSegment(at)
      return snapshot(at, false)
    },
    getState() {
      return snapshot(undefined, false)
    },
  })
}
