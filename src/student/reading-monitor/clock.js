import { BEIJING_OFFSET_MS, STAT_DATE_CUTOFF_HOUR } from './constants.js'

const DAY_MS = 24 * 60 * 60 * 1000
const CUTOFF_MS = STAT_DATE_CUTOFF_HOUR * 60 * 60 * 1000

function asWallMs(value, label = '时间') {
  const milliseconds = value instanceof Date ? value.getTime() : Number(value)
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${label}必须是有效墙钟毫秒`)
  return milliseconds
}

export function statDateFor(value) {
  const shifted = new Date(asWallMs(value) + BEIJING_OFFSET_MS - CUTOFF_MS)
  return shifted.toISOString().slice(0, 10)
}

export function nextStatDateBoundary(value) {
  const wallMs = asWallMs(value)
  const shifted = wallMs + BEIJING_OFFSET_MS - CUTOFF_MS
  const nextShiftedDay = (Math.floor(shifted / DAY_MS) + 1) * DAY_MS
  return nextShiftedDay - BEIJING_OFFSET_MS + CUTOFF_MS
}

export function exactIso(value) {
  return new Date(asWallMs(value)).toISOString()
}

export function createClock({
  wallNow = () => Date.now(),
  monotonicNow = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  if (typeof wallNow !== 'function' || typeof monotonicNow !== 'function') {
    throw new TypeError('墙钟和单调钟必须为可调用函数')
  }
  return Object.freeze({
    wallNow() {
      return asWallMs(wallNow(), '墙钟')
    },
    monotonicNow() {
      const value = Number(monotonicNow())
      if (!Number.isFinite(value)) throw new TypeError('单调钟必须返回有限毫秒')
      return value
    },
    now() {
      const wallMs = asWallMs(wallNow(), '墙钟')
      const monotonicMs = Number(monotonicNow())
      if (!Number.isFinite(monotonicMs)) throw new TypeError('单调钟必须返回有限毫秒')
      return { wallMs, monotonicMs, iso: exactIso(wallMs), statDate: statDateFor(wallMs) }
    },
  })
}

export function pointAtWallBoundary(clock, boundaryWallMs) {
  const now = clock.now()
  const wallDelta = Math.max(0, now.wallMs - asWallMs(boundaryWallMs))
  return {
    wallMs: boundaryWallMs,
    monotonicMs: now.monotonicMs - wallDelta,
    iso: exactIso(boundaryWallMs),
    statDate: statDateFor(boundaryWallMs),
  }
}
