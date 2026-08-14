import { SESSION_END_REASONS, assertEnum } from './constants.js'

const FINGERPRINT_FIELDS = Object.freeze([
  'schemaVersion',
  'sessionId',
  'revision',
  'leaseId',
  'bookVersionId',
  'statDate',
  'startedAt',
  'measuredThroughAt',
  'cumulativeEffectiveMs',
  'hadSkip',
  'hadReread',
  'lastPageNo',
  'endedAt',
  'endReason',
])

function safeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${label}必须是不小于${minimum}的安全整数`)
  return value
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value) throw new TypeError(`${label}必须是非空字符串`)
  return value
}

export function canonicalSummaryValues(summary) {
  return FINGERPRINT_FIELDS.map((field) => summary[field] ?? null)
}

export async function fingerprintSummary(summary, cryptoImpl = globalThis.crypto) {
  if (typeof cryptoImpl?.subtle?.digest !== 'function') throw new Error('当前环境无法计算阅读摘要SHA-256指纹')
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalSummaryValues(summary)))
  const digest = await cryptoImpl.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createSummaryRevision({
  sessionId,
  revision,
  leaseId,
  bookVersionId,
  statDate,
  startedAt,
  measuredThroughAt,
  cumulativeEffectiveMs,
  hadSkip,
  hadReread,
  lastPageNo,
  endedAt = null,
  endReason = null,
}, { cryptoImpl } = {}) {
  requiredString(sessionId, 'sessionId')
  safeInteger(revision, 'revision', 1)
  requiredString(leaseId, 'leaseId')
  requiredString(bookVersionId, 'bookVersionId')
  requiredString(statDate, 'statDate')
  requiredString(startedAt, 'startedAt')
  requiredString(measuredThroughAt, 'measuredThroughAt')
  safeInteger(cumulativeEffectiveMs, 'cumulativeEffectiveMs')
  safeInteger(lastPageNo, 'lastPageNo', 1)
  if (typeof hadSkip !== 'boolean' || typeof hadReread !== 'boolean') throw new TypeError('行为累计字段必须是布尔值')
  if ((endedAt == null) !== (endReason == null)) throw new TypeError('endedAt与endReason必须同时为空或同时提供')
  if (endReason != null) {
    requiredString(endedAt, 'endedAt')
    assertEnum(endReason, SESSION_END_REASONS, '会话结束原因')
  }
  const summary = {
    schemaVersion: 1,
    sessionId,
    revision,
    leaseId,
    bookVersionId,
    statDate,
    startedAt,
    measuredThroughAt,
    cumulativeEffectiveMs,
    hadSkip,
    hadReread,
    lastPageNo,
    endedAt,
    endReason,
  }
  return Object.freeze({ ...summary, fingerprint: await fingerprintSummary(summary, cryptoImpl) })
}

export function createRevisionCursor(startAt = 1) {
  let nextRevision = safeInteger(startAt, '起始revision', 1)
  return Object.freeze({
    peek() {
      return nextRevision
    },
    commit(revision) {
      if (revision !== nextRevision) throw new Error(`revision提交顺序冲突：期待${nextRevision}，实际${revision}`)
      nextRevision += 1
      return revision
    },
  })
}
