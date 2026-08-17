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
  'pageCoverage',
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
  pageCoverage,
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
  if (!Array.isArray(pageCoverage)) throw new TypeError('pageCoverage必须是数组')
  const seenPages = new Set()
  const normalizedPageCoverage = pageCoverage.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError(`pageCoverage[${index}]必须是对象`)
    const fields = ['pageNo', 'effectiveOriginalMs', 'effectiveTextMs', 'confirmedInteractions']
    const unknown = Object.keys(entry).filter((field) => !fields.includes(field))
    if (unknown.length || fields.some((field) => !Object.hasOwn(entry, field))) throw new TypeError(`pageCoverage[${index}]字段不完整`)
    const pageNo = safeInteger(entry.pageNo, `pageCoverage[${index}].pageNo`, 1)
    if (seenPages.has(pageNo)) throw new TypeError('pageCoverage页码不能重复')
    seenPages.add(pageNo)
    const effectiveOriginalMs = safeInteger(entry.effectiveOriginalMs, `pageCoverage[${index}].effectiveOriginalMs`)
    const effectiveTextMs = safeInteger(entry.effectiveTextMs, `pageCoverage[${index}].effectiveTextMs`)
    const confirmedInteractions = safeInteger(entry.confirmedInteractions, `pageCoverage[${index}].confirmedInteractions`)
    if (effectiveOriginalMs + effectiveTextMs > cumulativeEffectiveMs) throw new TypeError('单页双模式覆盖不能超过累计有效时长')
    return { pageNo, effectiveOriginalMs, effectiveTextMs, confirmedInteractions }
  }).sort((left, right) => left.pageNo - right.pageNo)
  if (typeof hadSkip !== 'boolean' || typeof hadReread !== 'boolean') throw new TypeError('行为累计字段必须是布尔值')
  if ((endedAt == null) !== (endReason == null)) throw new TypeError('endedAt与endReason必须同时为空或同时提供')
  if (endReason != null) {
    requiredString(endedAt, 'endedAt')
    assertEnum(endReason, SESSION_END_REASONS, '会话结束原因')
  }
  const summary = {
    schemaVersion: 2,
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
    pageCoverage: normalizedPageCoverage,
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
