import { createHash } from 'node:crypto'

import { withTransaction } from '../../db/database.js'
import { createDomainContext, transaction } from './sql.js'

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const STAT_DAY_OFFSET_MS = 4 * 60 * 60 * 1000
const LEASE_TTL_MS = 90 * 1000
const FUTURE_SKEW_MS = 120 * 1000
const MAX_SAFE_DURATION = Number.MAX_SAFE_INTEGER
const ISO_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const STAT_DATE = /^\d{4}-\d{2}-\d{2}$/
const FINGERPRINT = /^[0-9a-f]{64}$/
const SUMMARY_FIELDS = new Set([
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
  'fingerprint',
])
const RENEW_FIELDS = new Set(['schemaVersion', 'bookVersionId'])
const CLIENT_END_REASONS = new Set([
  'reader_close',
  'identity_change',
  'workspace_change',
  'book_change',
  'stat_date_change',
])
const LEASE_END_REASONS = new Set(['lease_ended', 'lease_taken_over'])
const PAGE_COVERAGE_FIELDS = new Set([
  'pageNo',
  'effectiveOriginalMs',
  'effectiveTextMs',
  'confirmedInteractions',
])

function domainError(code, message, details) {
  const error = new Error(message)
  error.code = code
  if (details !== undefined) error.details = details
  return error
}

function validationError(message, details) {
  const error = new TypeError(message)
  error.code = 'VALIDATION_FAILED'
  if (details !== undefined) error.details = details
  return error
}

function requireDatabase(database) {
  if (!database || typeof database.prepare !== 'function') {
    throw new TypeError('db 必须是 node:sqlite 数据库')
  }
  return database
}

function requiredText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw validationError(`${name} 不能为空`)
  return value.trim()
}

function exactObject(value, fields, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError(`${name} 必须是对象`)
  }
  const unknown = Object.keys(value).filter((key) => !fields.has(key))
  if (unknown.length > 0) throw validationError(`${name} 包含未知字段`, { fields: unknown })
  return value
}

function safeInteger(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw validationError(`${name} 必须是大于等于 ${minimum} 的安全整数`)
  }
  return value
}

function exactIso(value, name) {
  if (typeof value !== 'string' || !ISO_MILLISECONDS.test(value)) {
    throw validationError(`${name} 必须是精确到毫秒的 UTC ISO 时间`)
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw validationError(`${name} 必须是有效且已规范化的 UTC ISO 时间`)
  }
  return parsed
}

function exactStatDate(value, name = 'statDate') {
  if (typeof value !== 'string' || !STAT_DATE.test(value)) throw validationError(`${name} 格式无效`)
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw validationError(`${name} 必须是有效日期`)
  }
  return value
}

function tableExists(database, name) {
  return Boolean(database.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name))
}

function columnExists(database, tableName, columnName) {
  if (!tableExists(database, tableName)) return false
  return database.prepare(`PRAGMA table_info(${tableName})`).all().some((column) => column.name === columnName)
}

export function readingStatDateFor(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw validationError('统计时间必须是有效日期')
  return new Date(date.getTime() + STAT_DAY_OFFSET_MS).toISOString().slice(0, 10)
}

export function readingStatDateStart(statDate) {
  const normalized = exactStatDate(statDate)
  return new Date(Date.parse(`${normalized}T00:00:00.000Z`) - STAT_DAY_OFFSET_MS)
}

export function addStatDates(statDate, days) {
  const normalized = exactStatDate(statDate)
  if (!Number.isInteger(days)) throw validationError('days 必须是整数')
  return new Date(Date.parse(`${normalized}T00:00:00.000Z`) + days * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10)
}

export function readingRetentionCutoff(nowValue) {
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue)
  if (Number.isNaN(now.getTime())) throw validationError('now 必须是有效时间')
  const local = new Date(now.getTime() + SHANGHAI_OFFSET_MS)
  const sourceYear = local.getUTCFullYear()
  const sourceMonth = local.getUTCMonth()
  const targetMonthIndex = sourceYear * 12 + sourceMonth - 6
  const targetYear = Math.floor(targetMonthIndex / 12)
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const targetDay = Math.min(local.getUTCDate(), lastDay)
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    targetDay,
    local.getUTCHours(),
    local.getUTCMinutes(),
    local.getUTCSeconds(),
    local.getUTCMilliseconds(),
  ) - SHANGHAI_OFFSET_MS)
}

export function canonicalReadingSummaryFingerprint(summary) {
  return createHash('sha256').update(JSON.stringify([
    summary.schemaVersion,
    summary.sessionId,
    summary.revision,
    summary.leaseId,
    summary.bookVersionId,
    summary.statDate,
    summary.startedAt,
    summary.measuredThroughAt,
    summary.cumulativeEffectiveMs,
    summary.hadSkip,
    summary.hadReread,
    summary.lastPageNo,
    summary.pageCoverage,
    summary.endedAt,
    summary.endReason,
  ]), 'utf8').digest('hex')
}

function normalizePageCoverage(value, cumulativeEffectiveMs) {
  if (!Array.isArray(value)) throw validationError('summary.pageCoverage 必须是数组')
  const seen = new Set()
  const normalized = value.map((entry, index) => {
    const input = exactObject(entry, PAGE_COVERAGE_FIELDS, `summary.pageCoverage[${index}]`)
    for (const field of PAGE_COVERAGE_FIELDS) {
      if (!Object.hasOwn(input, field)) throw validationError(`summary.pageCoverage[${index}].${field} 缺失`)
    }
    const pageNo = safeInteger(input.pageNo, `summary.pageCoverage[${index}].pageNo`, 1)
    if (seen.has(pageNo)) throw validationError('summary.pageCoverage 物理页不能重复')
    seen.add(pageNo)
    const effectiveOriginalMs = safeInteger(input.effectiveOriginalMs, `summary.pageCoverage[${index}].effectiveOriginalMs`)
    const effectiveTextMs = safeInteger(input.effectiveTextMs, `summary.pageCoverage[${index}].effectiveTextMs`)
    const confirmedInteractions = safeInteger(input.confirmedInteractions, `summary.pageCoverage[${index}].confirmedInteractions`)
    if (effectiveOriginalMs + effectiveTextMs > cumulativeEffectiveMs) {
      throw validationError('单页双模式有效覆盖不能超过会话累计有效时长')
    }
    return { pageNo, effectiveOriginalMs, effectiveTextMs, confirmedInteractions }
  })
  normalized.sort((left, right) => left.pageNo - right.pageNo)
  return normalized
}

function normalizeSummary(body, now) {
  const input = exactObject(body, SUMMARY_FIELDS, 'summary')
  for (const field of SUMMARY_FIELDS) {
    if (!Object.hasOwn(input, field)) throw validationError(`summary.${field} 缺失`)
  }
  if (input.schemaVersion !== 2) throw validationError('summary.schemaVersion 仅支持 2')
  const sessionId = requiredText(input.sessionId, 'summary.sessionId')
  const revision = safeInteger(input.revision, 'summary.revision', 1)
  const leaseId = requiredText(input.leaseId, 'summary.leaseId')
  const bookVersionId = requiredText(input.bookVersionId, 'summary.bookVersionId')
  const statDate = exactStatDate(input.statDate)
  const startedAt = exactIso(input.startedAt, 'summary.startedAt')
  const measuredThroughAt = exactIso(input.measuredThroughAt, 'summary.measuredThroughAt')
  const cumulativeEffectiveMs = safeInteger(
    input.cumulativeEffectiveMs,
    'summary.cumulativeEffectiveMs',
  )
  if (typeof input.hadSkip !== 'boolean' || typeof input.hadReread !== 'boolean') {
    throw validationError('summary.hadSkip 与 summary.hadReread 必须是布尔值')
  }
  const lastPageNo = safeInteger(input.lastPageNo, 'summary.lastPageNo', 1)
  const pageCoverage = normalizePageCoverage(input.pageCoverage, cumulativeEffectiveMs)
  if ((input.endedAt === null) !== (input.endReason === null)) {
    throw validationError('summary.endedAt 与 summary.endReason 必须同时为空或同时提供')
  }
  const endedAt = input.endedAt === null ? null : exactIso(input.endedAt, 'summary.endedAt')
  const endReason = input.endReason === null ? null : requiredText(input.endReason, 'summary.endReason')
  if (endReason !== null && !CLIENT_END_REASONS.has(endReason)) {
    throw validationError('summary.endReason 不是允许的客户端结束原因')
  }
  if (measuredThroughAt < startedAt || (endedAt && endedAt < measuredThroughAt)) {
    throw validationError('summary 时间顺序必须满足 startedAt <= measuredThroughAt <= endedAt')
  }
  if (cumulativeEffectiveMs > measuredThroughAt.getTime() - startedAt.getTime()) {
    throw validationError('summary.cumulativeEffectiveMs 不能超过会话墙钟跨度')
  }
  if (readingStatDateFor(startedAt) !== statDate || readingStatDateFor(measuredThroughAt) !== statDate) {
    throw domainError('STAT_DATE_MISMATCH', 'summary.statDate 与测量范围不一致')
  }
  if (endedAt) {
    const endedStatDate = readingStatDateFor(endedAt)
    const nextDate = addStatDates(statDate, 1)
    const allowedBoundary = endReason === 'stat_date_change'
      && endedAt.toISOString() === readingStatDateStart(nextDate).toISOString()
    if (endedStatDate !== statDate && !allowedBoundary) {
      throw domainError('STAT_DATE_MISMATCH', 'summary.endedAt 不能越过统计日边界')
    }
  }
  const futureLimit = now.getTime() + FUTURE_SKEW_MS
  if ([startedAt, measuredThroughAt, endedAt].filter(Boolean).some((date) => date.getTime() > futureLimit)) {
    throw domainError('FUTURE_TIME_REJECTED', 'summary 客户端时间超过允许的未来偏差')
  }
  const cutoff = readingRetentionCutoff(now)
  if (startedAt < cutoff || measuredThroughAt < cutoff) {
    throw validationError('summary 已超出六个日历月接受窗口')
  }
  const fingerprint = requiredText(input.fingerprint, 'summary.fingerprint')
  if (!FINGERPRINT.test(fingerprint)) throw validationError('summary.fingerprint 必须是 64 位小写十六进制')
  const normalized = {
    schemaVersion: 2,
    sessionId,
    revision,
    leaseId,
    bookVersionId,
    statDate,
    startedAt: startedAt.toISOString(),
    measuredThroughAt: measuredThroughAt.toISOString(),
    cumulativeEffectiveMs,
    hadSkip: input.hadSkip,
    hadReread: input.hadReread,
    lastPageNo,
    pageCoverage,
    endedAt: endedAt?.toISOString() ?? null,
    endReason,
    fingerprint,
  }
  if (canonicalReadingSummaryFingerprint(normalized) !== fingerprint) {
    throw validationError('summary.fingerprint 与规范摘要不一致')
  }
  return normalized
}

function resolveStudentClass(database, { organizationId, actorId, workspaceId }) {
  const row = database.prepare(`SELECT class.id AS class_id
    FROM users AS actor
    JOIN workspace_memberships AS workspace_membership
      ON workspace_membership.user_id = actor.id
      AND workspace_membership.workspace_id = :workspaceId
      AND workspace_membership.status = 'active'
    JOIN workspaces AS workspace
      ON workspace.id = workspace_membership.workspace_id
      AND workspace.organization_id = actor.organization_id
      AND workspace.scope_type = 'class'
      AND workspace.status = 'active'
    JOIN classes AS class
      ON class.id = workspace.scope_id
      AND class.organization_id = actor.organization_id
      AND class.status = 'active'
    JOIN class_memberships AS class_membership
      ON class_membership.class_id = class.id
      AND class_membership.user_id = actor.id
      AND class_membership.membership_role = 'student'
      AND class_membership.status = 'active'
    WHERE actor.id = :actorId
      AND actor.organization_id = :organizationId
      AND actor.status = 'active'`).get({ organizationId, actorId, workspaceId })
  if (!row) throw domainError('PERMISSION_DENIED', '当前学生不属于可信阅读班级范围')
  return row.class_id
}

function requireBookVersion(database, organizationId, bookVersionId, lastPageNo) {
  const row = database.prepare(`SELECT version.id, version.page_count
    FROM book_versions AS version
    JOIN books AS book
      ON book.id = version.book_id
      AND book.organization_id_at_creation = version.organization_id_at_creation
      AND book.status = 'published'
    WHERE version.id = ? AND version.organization_id_at_creation = ?`).get(bookVersionId, organizationId)
  if (!row) throw domainError('RESOURCE_NOT_FOUND', '书籍版本不存在或当前不可读取')
  if (lastPageNo > Number(row.page_count)) throw validationError('summary.lastPageNo 超出书籍版本页数')
  return row
}

function closeOpenSummaryRows(database, { leaseId, endedAt, endReason, updatedAt }) {
  if (!tableExists(database, 'reading_summary_sessions')) return 0
  return database.prepare(`UPDATE reading_summary_sessions
    SET status = 'closed', ended_at = :endedAt, end_reason = :endReason,
      updated_at = :updatedAt, version = version + 1
    WHERE lease_id_at_start = :leaseId AND status = 'open'
      AND measured_through_at <= :endedAt`).run({ leaseId, endedAt, endReason, updatedAt }).changes
}

export function closeReadingSummarySessionsForLease(database, input) {
  requireDatabase(database)
  if (!LEASE_END_REASONS.has(input.endReason)) throw validationError('租约结束原因无效')
  return closeOpenSummaryRows(database, input)
}

function expireActiveLease(database, active, nowIso) {
  const endedAt = active.expires_at
  database.prepare(`UPDATE active_reading_leases
    SET released_at = :releasedAt, updated_at = :updatedAt, version = version + 1
    WHERE id = :id AND released_at IS NULL`).run({ id: active.id, releasedAt: nowIso, updatedAt: nowIso })
  if (columnExists(database, 'reading_device_lease_history', 'end_reason')) {
    database.prepare(`UPDATE reading_device_lease_history
      SET valid_until = CASE WHEN valid_until > :endedAt THEN :endedAt ELSE valid_until END,
        end_reason = 'lease_ended', updated_at = :updatedAt, version = version + 1
      WHERE id = (
        SELECT id FROM reading_device_lease_history
        WHERE lease_id = :leaseId AND end_reason IS NULL
        ORDER BY valid_from DESC, id DESC LIMIT 1
      )`).run({ leaseId: active.id, endedAt, updatedAt: nowIso })
  }
  closeOpenSummaryRows(database, {
    leaseId: active.id,
    endedAt,
    endReason: 'lease_ended',
    updatedAt: nowIso,
  })
}

function findLeaseHistory(database, scope, summary) {
  const any = database.prepare(`SELECT 1 FROM reading_device_lease_history WHERE lease_id = ? LIMIT 1`)
    .get(summary.leaseId)
  if (!any) throw domainError('LEASE_REQUIRED', '摘要没有匹配的阅读租约历史')
  const history = database.prepare(`SELECT * FROM reading_device_lease_history
    WHERE lease_id = :leaseId
      AND organization_id = :organizationId
      AND actor_id = :actorId
      AND workspace_id = :workspaceId
      AND device_id = :deviceId
      AND book_version_id = :bookVersionId
    ORDER BY valid_from DESC, id DESC LIMIT 1`).get({
    leaseId: summary.leaseId,
    organizationId: scope.organizationId,
    actorId: scope.actorId,
    workspaceId: scope.workspaceId,
    deviceId: scope.deviceId,
    bookVersionId: summary.bookVersionId,
  })
  if (!history) throw domainError('LEASE_CONFLICT', '摘要租约与当前可信范围不一致')
  if (summary.startedAt < history.valid_from || summary.measuredThroughAt > history.valid_until) {
    throw domainError('LEASE_CONFLICT', '摘要测量范围超出租约合法 history')
  }
  if (summary.endedAt && summary.endedAt > history.valid_until) {
    throw domainError('LEASE_CONFLICT', '摘要结束时间超出租约合法 history')
  }
  if (!history.end_reason) {
    const active = database.prepare(`SELECT * FROM active_reading_leases
      WHERE id = :leaseId AND actor_id = :actorId AND workspace_id = :workspaceId
        AND device_id = :deviceId AND book_version_id = :bookVersionId
        AND released_at IS NULL`).get({
      leaseId: summary.leaseId,
      actorId: scope.actorId,
      workspaceId: scope.workspaceId,
      deviceId: scope.deviceId,
      bookVersionId: summary.bookVersionId,
    })
    if (!active) throw domainError('LEASE_CONFLICT', '租约 history 没有权威结束记录且租约已不再有效')
  }
  return history
}

function sessionScopeMatches(session, scope, classId, summary) {
  return session.organization_id_at_creation === scope.organizationId
    && session.actor_id_at_creation === scope.actorId
    && session.workspace_id_at_creation === scope.workspaceId
    && session.class_id_at_creation === classId
    && session.device_id === scope.deviceId
    && session.book_version_id === summary.bookVersionId
    && session.lease_id_at_start === summary.leaseId
    && session.stat_date === summary.statDate
    && session.started_at === summary.startedAt
}

function dailySummaryRow(database, session) {
  return database.prepare(`SELECT updated_at FROM reading_daily_book_summaries
    WHERE organization_id_at_creation = :organizationId
      AND actor_id_at_creation = :actorId
      AND workspace_id_at_creation = :workspaceId
      AND class_id_at_creation = :classId
      AND book_version_id = :bookVersionId
      AND stat_date = :statDate`).get({
    organizationId: session.organization_id_at_creation,
    actorId: session.actor_id_at_creation,
    workspaceId: session.workspace_id_at_creation,
    classId: session.class_id_at_creation,
    bookVersionId: session.book_version_id,
    statDate: session.stat_date,
  })
}

function confirmedResult(database, session, requestedRevision, result) {
  return {
    sessionId: session.id,
    revision: requestedRevision,
    latestRevision: Number(session.latest_revision),
    result,
    cumulativeEffectiveMs: Number(session.cumulative_effective_ms),
    dailySummaryUpdatedAt: dailySummaryRow(database, session)?.updated_at ?? null,
  }
}

function writeDailySummary(database, context, classId, summary, delta, nowIso) {
  database.prepare(`INSERT INTO reading_daily_book_summaries (
      id, organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation,
      class_id_at_creation, book_version_id, stat_date, effective_reading_ms,
      had_skip, had_reread, last_read_at, last_page_no, created_at, updated_at, version
    ) VALUES (
      :id, :organizationId, :actorId, :workspaceId,
      :classId, :bookVersionId, :statDate, :delta,
      :hadSkip, :hadReread, :measuredThroughAt, :lastPageNo, :now, :now, 1
    ) ON CONFLICT (
      organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation,
      class_id_at_creation, book_version_id, stat_date
    ) DO UPDATE SET
      effective_reading_ms = effective_reading_ms + excluded.effective_reading_ms,
      had_skip = MAX(had_skip, excluded.had_skip),
      had_reread = MAX(had_reread, excluded.had_reread),
      last_read_at = CASE
        WHEN last_read_at IS NULL OR excluded.last_read_at > last_read_at THEN excluded.last_read_at
        ELSE last_read_at
      END,
      last_page_no = CASE
        WHEN last_read_at IS NULL OR excluded.last_read_at > last_read_at THEN excluded.last_page_no
        WHEN excluded.last_read_at = last_read_at AND excluded.last_page_no > last_page_no THEN excluded.last_page_no
        ELSE last_page_no
      END,
      updated_at = excluded.updated_at,
      version = version + 1`).run({
    id: context.idFactory(),
    organizationId: context.organizationId,
    actorId: context.actorId,
    workspaceId: context.workspaceId,
    classId,
    bookVersionId: summary.bookVersionId,
    statDate: summary.statDate,
    delta,
    hadSkip: Number(summary.hadSkip),
    hadReread: Number(summary.hadReread),
    measuredThroughAt: summary.measuredThroughAt,
    lastPageNo: summary.lastPageNo,
    now: nowIso,
  })
}

function writeReadingPosition(database, context, summary, nowIso) {
  database.prepare(`INSERT INTO reading_progress (
      id, actor_id, workspace_id, book_version_id, last_page_no,
      valid_reading_seconds, updated_from_event_at, created_at, updated_at, version
    ) VALUES (
      :id, :actorId, :workspaceId, :bookVersionId, :lastPageNo,
      0, :measuredThroughAt, :now, :now, 1
    ) ON CONFLICT(actor_id, workspace_id, book_version_id) DO UPDATE SET
      last_page_no = excluded.last_page_no,
      updated_from_event_at = excluded.updated_from_event_at,
      updated_at = excluded.updated_at,
      version = reading_progress.version + 1
    WHERE excluded.updated_from_event_at > reading_progress.updated_from_event_at
      OR (
        excluded.updated_from_event_at = reading_progress.updated_from_event_at
        AND excluded.last_page_no > reading_progress.last_page_no
      )`).run({
    id: context.idFactory(),
    actorId: context.actorId,
    workspaceId: context.workspaceId,
    bookVersionId: summary.bookVersionId,
    lastPageNo: summary.lastPageNo,
    measuredThroughAt: summary.measuredThroughAt,
    now: nowIso,
  })
}

function writePageCoverage(database, context, summary, nowIso) {
  const existingRows = database.prepare(`SELECT page_no, effective_original_ms, effective_text_ms,
      confirmed_interactions
    FROM reading_summary_page_coverage
    WHERE session_id = ?
    ORDER BY page_no`).all(summary.sessionId)
  const incoming = new Map(summary.pageCoverage.map((entry) => [entry.pageNo, entry]))
  for (const existing of existingRows) {
    if (!incoming.has(Number(existing.page_no))) {
      throw domainError('SUMMARY_REGRESSION', '摘要逐页覆盖不能删除已经确认的物理页')
    }
  }
  const existingByPage = new Map(existingRows.map((row) => [Number(row.page_no), row]))
  for (const entry of summary.pageCoverage) {
    const previous = existingByPage.get(entry.pageNo)
    const previousOriginal = Number(previous?.effective_original_ms || 0)
    const previousText = Number(previous?.effective_text_ms || 0)
    const previousInteractions = Number(previous?.confirmed_interactions || 0)
    if (entry.effectiveOriginalMs < previousOriginal
      || entry.effectiveTextMs < previousText
      || entry.confirmedInteractions < previousInteractions) {
      throw domainError('SUMMARY_REGRESSION', `摘要物理页 ${entry.pageNo} 覆盖字段不能倒退`)
    }
    const originalDelta = entry.effectiveOriginalMs - previousOriginal
    const textDelta = entry.effectiveTextMs - previousText
    const interactionDelta = entry.confirmedInteractions - previousInteractions
    database.prepare(`INSERT INTO reading_summary_page_coverage (
        session_id, page_no, effective_original_ms, effective_text_ms,
        confirmed_interactions, created_at, updated_at, version
      ) VALUES (
        :sessionId, :pageNo, :effectiveOriginalMs, :effectiveTextMs,
        :confirmedInteractions, :now, :now, 1
      ) ON CONFLICT(session_id, page_no) DO UPDATE SET
        effective_original_ms = excluded.effective_original_ms,
        effective_text_ms = excluded.effective_text_ms,
        confirmed_interactions = excluded.confirmed_interactions,
        updated_at = excluded.updated_at,
        version = reading_summary_page_coverage.version + 1`).run({
      sessionId: summary.sessionId,
      pageNo: entry.pageNo,
      effectiveOriginalMs: entry.effectiveOriginalMs,
      effectiveTextMs: entry.effectiveTextMs,
      confirmedInteractions: entry.confirmedInteractions,
      now: nowIso,
    })
    if (originalDelta === 0 && textDelta === 0 && interactionDelta === 0) continue
    database.prepare(`INSERT INTO reading_page_coverage (
        id, organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation,
        book_version_id, page_no, effective_original_ms, effective_text_ms,
        confirmed_interactions, last_covered_at, created_at, updated_at, version
      ) VALUES (
        :id, :organizationId, :actorId, :workspaceId,
        :bookVersionId, :pageNo, :originalDelta, :textDelta,
        :interactionDelta, :measuredThroughAt, :now, :now, 1
      ) ON CONFLICT (
        organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation,
        book_version_id, page_no
      ) DO UPDATE SET
        effective_original_ms = reading_page_coverage.effective_original_ms + excluded.effective_original_ms,
        effective_text_ms = reading_page_coverage.effective_text_ms + excluded.effective_text_ms,
        confirmed_interactions = reading_page_coverage.confirmed_interactions + excluded.confirmed_interactions,
        last_covered_at = MAX(reading_page_coverage.last_covered_at, excluded.last_covered_at),
        updated_at = excluded.updated_at,
        version = reading_page_coverage.version + 1`).run({
      id: context.idFactory(),
      organizationId: context.organizationId,
      actorId: context.actorId,
      workspaceId: context.workspaceId,
      bookVersionId: summary.bookVersionId,
      pageNo: entry.pageNo,
      originalDelta,
      textDelta,
      interactionDelta,
      measuredThroughAt: summary.measuredThroughAt,
      now: nowIso,
    })
  }
}

function insertSession(database, context, classId, summary, history, nowIso) {
  const serverClosed = LEASE_END_REASONS.has(history.end_reason)
  const status = serverClosed || summary.endedAt ? 'closed' : 'open'
  const endedAt = serverClosed ? history.valid_until : summary.endedAt
  const endReason = serverClosed ? history.end_reason : summary.endReason
  database.prepare(`INSERT INTO reading_summary_sessions (
      id, organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation,
      class_id_at_creation, device_id, book_version_id, lease_id_at_start, stat_date,
      started_at, latest_revision, latest_fingerprint, revision_fingerprints_json,
      cumulative_effective_ms, had_skip, had_reread, last_page_no, measured_through_at,
      ended_at, end_reason, status, created_at, updated_at, version
    ) VALUES (
      :sessionId, :organizationId, :actorId, :workspaceId,
      :classId, :deviceId, :bookVersionId, :leaseId, :statDate,
      :startedAt, 1, :fingerprint, :fingerprints,
      :cumulativeEffectiveMs, :hadSkip, :hadReread, :lastPageNo, :measuredThroughAt,
      :endedAt, :endReason, :status, :now, :now, 1
    )`).run({
    sessionId: summary.sessionId,
    organizationId: context.organizationId,
    actorId: context.actorId,
    workspaceId: context.workspaceId,
    classId,
    deviceId: context.deviceId,
    bookVersionId: summary.bookVersionId,
    leaseId: summary.leaseId,
    statDate: summary.statDate,
    startedAt: summary.startedAt,
    fingerprint: summary.fingerprint,
    fingerprints: JSON.stringify({ 1: summary.fingerprint }),
    cumulativeEffectiveMs: summary.cumulativeEffectiveMs,
    hadSkip: Number(summary.hadSkip),
    hadReread: Number(summary.hadReread),
    lastPageNo: summary.lastPageNo,
    measuredThroughAt: summary.measuredThroughAt,
    endedAt,
    endReason,
    status,
    now: nowIso,
  })
}

function updateSession(database, session, summary, nowIso) {
  const fingerprints = JSON.parse(session.revision_fingerprints_json)
  fingerprints[String(summary.revision)] = summary.fingerprint
  const serverClosed = session.status === 'closed' && LEASE_END_REASONS.has(session.end_reason)
  const status = serverClosed || summary.endedAt ? 'closed' : session.status
  const endedAt = serverClosed ? session.ended_at : (summary.endedAt ?? session.ended_at)
  const endReason = serverClosed ? session.end_reason : (summary.endReason ?? session.end_reason)
  database.prepare(`UPDATE reading_summary_sessions SET
      latest_revision = :revision,
      latest_fingerprint = :fingerprint,
      revision_fingerprints_json = :fingerprints,
      cumulative_effective_ms = :cumulativeEffectiveMs,
      had_skip = :hadSkip,
      had_reread = :hadReread,
      last_page_no = :lastPageNo,
      measured_through_at = :measuredThroughAt,
      ended_at = :endedAt,
      end_reason = :endReason,
      status = :status,
      updated_at = :now,
      version = version + 1
    WHERE id = :sessionId`).run({
    sessionId: summary.sessionId,
    revision: summary.revision,
    fingerprint: summary.fingerprint,
    fingerprints: JSON.stringify(fingerprints),
    cumulativeEffectiveMs: summary.cumulativeEffectiveMs,
    hadSkip: Number(summary.hadSkip),
    hadReread: Number(summary.hadReread),
    lastPageNo: summary.lastPageNo,
    measuredThroughAt: summary.measuredThroughAt,
    endedAt,
    endReason,
    status,
    now: nowIso,
  })
}

function processSummary(database, context, summary, now) {
  const nowIso = now.toISOString()
  const active = database.prepare(`SELECT * FROM active_reading_leases WHERE id = ? AND released_at IS NULL`)
    .get(summary.leaseId)
  if (active && active.expires_at <= nowIso) expireActiveLease(database, active, nowIso)

  const history = findLeaseHistory(database, context, summary)
  if (LEASE_END_REASONS.has(history.end_reason)) {
    closeOpenSummaryRows(database, {
      leaseId: summary.leaseId,
      endedAt: history.valid_until,
      endReason: history.end_reason,
      updatedAt: nowIso,
    })
  }

  let session = database.prepare('SELECT * FROM reading_summary_sessions WHERE id = ?').get(summary.sessionId)
  if (session) {
    if (!sessionScopeMatches(session, context, context.classId, summary)) {
      throw domainError('LEASE_CONFLICT', '会话摘要的不可变范围与已有会话不一致')
    }
    const fingerprints = JSON.parse(session.revision_fingerprints_json)
    if (summary.revision <= Number(session.latest_revision)) {
      if (fingerprints[String(summary.revision)] !== summary.fingerprint) {
        throw domainError('REVISION_CONFLICT', '已出现 revision 的指纹不同')
      }
      return confirmedResult(
        database,
        session,
        summary.revision,
        summary.revision === Number(session.latest_revision) ? 'replayed' : 'superseded',
      )
    }
    if (summary.revision > Number(session.latest_revision) + 1) {
      throw domainError('REVISION_GAP', 'revision 必须连续递增')
    }
    if (summary.cumulativeEffectiveMs < Number(session.cumulative_effective_ms)
      || Number(summary.hadSkip) < Number(session.had_skip)
      || Number(summary.hadReread) < Number(session.had_reread)
      || summary.measuredThroughAt < session.measured_through_at) {
      throw domainError('SUMMARY_REGRESSION', '摘要累计字段不能倒退')
    }
    if (session.status === 'closed' && !LEASE_END_REASONS.has(session.end_reason)) {
      throw domainError('SUMMARY_REGRESSION', '客户端已关闭会话不能继续提交新 revision')
    }
    if (session.status === 'closed' && summary.measuredThroughAt > session.ended_at) {
      throw domainError('LEASE_CONFLICT', '晚到 revision 超过租约权威截止')
    }
    const delta = summary.cumulativeEffectiveMs - Number(session.cumulative_effective_ms)
    updateSession(database, session, summary, nowIso)
    writePageCoverage(database, context, summary, nowIso)
    writeDailySummary(database, context, context.classId, summary, delta, nowIso)
    writeReadingPosition(database, context, summary, nowIso)
    session = database.prepare('SELECT * FROM reading_summary_sessions WHERE id = ?').get(summary.sessionId)
    return confirmedResult(database, session, summary.revision, 'accepted')
  }

  if (summary.revision !== 1) throw domainError('REVISION_GAP', '新会话必须从 revision 1 开始')
  const otherOpen = database.prepare(`SELECT id FROM reading_summary_sessions
    WHERE organization_id_at_creation = ? AND actor_id_at_creation = ? AND status = 'open'`)
    .get(context.organizationId, context.actorId)
  const incomingWillBeClosed = LEASE_END_REASONS.has(history.end_reason) || summary.endedAt !== null
  if (otherOpen && !incomingWillBeClosed) {
    throw domainError('LEASE_CONFLICT', '当前学生已有其他 open 摘要会话')
  }
  insertSession(database, context, context.classId, summary, history, nowIso)
  writePageCoverage(database, context, summary, nowIso)
  writeDailySummary(database, context, context.classId, summary, summary.cumulativeEffectiveMs, nowIso)
  writeReadingPosition(database, context, summary, nowIso)
  session = database.prepare('SELECT * FROM reading_summary_sessions WHERE id = ?').get(summary.sessionId)
  return confirmedResult(database, session, summary.revision, 'accepted')
}

export function createReadingMonitoringDomain(dependencies = {}) {
  const context = createDomainContext(dependencies)
  const organizationId = () => requiredText(context.workspace?.organizationId, 'workspace.organizationId')
  const actorId = () => requiredText(context.actor?.id, 'actor.id')
  const workspaceId = () => requiredText(context.workspace?.id, 'workspace.id')

  async function authorize(action, resource = {}) {
    const allowed = await context.authorize({
      actor: context.actor,
      workspace: context.workspace,
      action,
      resource,
    })
    if (!allowed) throw domainError('PERMISSION_DENIED', '当前工作空间无权执行此阅读操作')
  }

  return {
    async renewLease({ leaseId, deviceId, body }) {
      const normalizedBody = exactObject(body, RENEW_FIELDS, 'renew body')
      for (const field of RENEW_FIELDS) {
        if (!Object.hasOwn(normalizedBody, field)) throw validationError(`renew body.${field} 缺失`)
      }
      if (normalizedBody.schemaVersion !== 1) throw validationError('renew body.schemaVersion 仅支持 1')
      const normalizedLeaseId = requiredText(leaseId, 'leaseId')
      const normalizedDeviceId = requiredText(deviceId, 'deviceId')
      const bookVersionId = requiredText(normalizedBody.bookVersionId, 'bookVersionId')
      await authorize('reading.read_self', { bookVersionId })
      requireBookVersion(context.db, organizationId(), bookVersionId, 1)
      const renewedAt = context.now().toISOString()
      const expiresAt = new Date(new Date(renewedAt).getTime() + LEASE_TTL_MS).toISOString()
      const result = transaction(context.db, () => {
        const active = context.db.prepare('SELECT * FROM active_reading_leases WHERE id = ?').get(normalizedLeaseId)
        const history = context.db.prepare(`SELECT * FROM reading_device_lease_history
          WHERE lease_id = ? ORDER BY valid_from DESC, id DESC LIMIT 1`).get(normalizedLeaseId)
        if (!active && !history) throw domainError('LEASE_REQUIRED', '阅读租约不存在')
        const exactScope = history
          && history.organization_id === organizationId()
          && history.actor_id === actorId()
          && history.workspace_id === workspaceId()
          && history.device_id === normalizedDeviceId
          && history.book_version_id === bookVersionId
        if (!exactScope) throw domainError('LEASE_CONFLICT', '阅读租约与当前可信范围不一致')
        if (!active || active.released_at !== null || active.expires_at <= renewedAt || history.end_reason) {
          if (active && active.released_at === null && active.expires_at <= renewedAt) {
            expireActiveLease(context.db, active, renewedAt)
          }
          throw domainError('LEASE_REQUIRED', '阅读租约已过期，不能复活')
        }
        if (active.actor_id !== actorId()
          || active.workspace_id !== workspaceId()
          || active.device_id !== normalizedDeviceId
          || active.book_version_id !== bookVersionId) {
          throw domainError('LEASE_CONFLICT', '活动租约与当前可信范围不一致')
        }
        context.db.prepare(`UPDATE active_reading_leases
          SET expires_at = :expiresAt, updated_at = :renewedAt, version = version + 1
          WHERE id = :leaseId`).run({ leaseId: normalizedLeaseId, expiresAt, renewedAt })
        context.db.prepare(`UPDATE reading_device_lease_history
          SET valid_until = :expiresAt, updated_at = :renewedAt, version = version + 1
          WHERE id = :historyId`).run({ historyId: history.id, expiresAt, renewedAt })
        return { leaseId: normalizedLeaseId, renewedAt, expiresAt }
      })
      await context.audit({
        eventType: 'reading.lease.renewed',
        actorId: actorId(),
        workspaceId: workspaceId(),
        resourceId: result.leaseId,
      })
      return result
    },

    async acceptSessionSummary({ deviceId, body }) {
      const now = context.now()
      const summary = normalizeSummary(body, now)
      const normalizedDeviceId = requiredText(deviceId, 'deviceId')
      await authorize('reading.read_self', {
        bookVersionId: summary.bookVersionId,
        ownerId: actorId(),
      })
      const classId = resolveStudentClass(context.db, {
        organizationId: organizationId(),
        actorId: actorId(),
        workspaceId: workspaceId(),
      })
      const version = requireBookVersion(context.db, organizationId(), summary.bookVersionId, summary.lastPageNo)
      if (summary.pageCoverage.some((entry) => entry.pageNo > Number(version.page_count))) {
        throw validationError('summary.pageCoverage 包含超出书籍版本的物理页')
      }
      const trusted = {
        idFactory: context.idFactory,
        organizationId: organizationId(),
        actorId: actorId(),
        workspaceId: workspaceId(),
        classId,
        deviceId: normalizedDeviceId,
      }
      const result = transaction(context.db, () => processSummary(context.db, trusted, summary, now))
      await context.audit({
        eventType: 'reading.summary.confirmed',
        actorId: actorId(),
        workspaceId: workspaceId(),
        resourceId: summary.sessionId,
        outcome: result,
      })
      return result
    },

    async deleteAccountData({ studentId }) {
      const normalizedStudentId = requiredText(studentId, 'studentId')
      await authorize('account.manage', { ownerId: normalizedStudentId })
      return deleteReadingMonitorDataForAccount(context.db, {
        organizationId: organizationId(),
        actorId: normalizedStudentId,
      })
    },
  }
}

export function deleteReadingMonitorDataForAccount(database, { organizationId, actorId }) {
  requireDatabase(database)
  const normalizedOrganizationId = requiredText(organizationId, 'organizationId')
  const normalizedActorId = requiredText(actorId, 'actorId')
  return withTransaction(database, () => {
    const actor = database.prepare(`SELECT 1 FROM users WHERE id = ? AND organization_id = ?`).get(
      normalizedActorId,
      normalizedOrganizationId,
    )
    if (!actor) throw domainError('RESOURCE_NOT_FOUND', '待删除学生不属于指定组织')
    const pageCoverage = database.prepare(`DELETE FROM reading_page_coverage
      WHERE organization_id_at_creation = ? AND actor_id_at_creation = ?`)
      .run(normalizedOrganizationId, normalizedActorId).changes
    const sessions = database.prepare(`DELETE FROM reading_summary_sessions
      WHERE organization_id_at_creation = ? AND actor_id_at_creation = ?`)
      .run(normalizedOrganizationId, normalizedActorId).changes
    const dailySummaries = database.prepare(`DELETE FROM reading_daily_book_summaries
      WHERE organization_id_at_creation = ? AND actor_id_at_creation = ?`)
      .run(normalizedOrganizationId, normalizedActorId).changes
    const progress = database.prepare('DELETE FROM reading_progress WHERE actor_id = ?')
      .run(normalizedActorId).changes
    return { sessions, dailySummaries, progress, pageCoverage }
  })
}

export function cleanupReadingSummarySessions({ db, now }) {
  const database = requireDatabase(db)
  const current = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(current.getTime())) throw validationError('cleanup now 必须是有效时间')
  const nowIso = current.toISOString()
  const cutoff = readingRetentionCutoff(current).toISOString()
  return withTransaction(database, () => {
    const oldOpen = database.prepare(`SELECT session.id, history.valid_until, history.end_reason
      FROM reading_summary_sessions AS session
      LEFT JOIN reading_device_lease_history AS history
        ON history.id = (
          SELECT candidate.id FROM reading_device_lease_history AS candidate
          WHERE candidate.lease_id = session.lease_id_at_start
            AND candidate.organization_id = session.organization_id_at_creation
            AND candidate.actor_id = session.actor_id_at_creation
            AND candidate.workspace_id = session.workspace_id_at_creation
            AND candidate.device_id = session.device_id
            AND candidate.book_version_id = session.book_version_id
          ORDER BY candidate.valid_from DESC, candidate.id DESC LIMIT 1
        )
      WHERE session.status = 'open' AND session.started_at < :cutoff
      ORDER BY session.id`).all({ cutoff })
    let closedCount = 0
    const anomalousOpenSessionIds = []
    for (const row of oldOpen) {
      if (!LEASE_END_REASONS.has(row.end_reason)
        || !row.valid_until
        || row.valid_until > nowIso) {
        anomalousOpenSessionIds.push(row.id)
        continue
      }
      const changed = database.prepare(`UPDATE reading_summary_sessions
        SET status = 'closed', ended_at = :endedAt, end_reason = :endReason,
          updated_at = :now, version = version + 1
        WHERE id = :id AND status = 'open' AND measured_through_at <= :endedAt`).run({
        id: row.id,
        endedAt: row.valid_until,
        endReason: row.end_reason,
        now: nowIso,
      }).changes
      if (changed === 0) anomalousOpenSessionIds.push(row.id)
      else closedCount += changed
    }
    const deletedCount = database.prepare(`DELETE FROM reading_summary_sessions
      WHERE status = 'closed' AND ended_at < ?`).run(cutoff).changes
    return { cutoff, closedCount, deletedCount, anomalousOpenSessionIds }
  })
}

export const READING_LEASE_TTL_MS = LEASE_TTL_MS
export const READING_FUTURE_SKEW_MS = FUTURE_SKEW_MS
export const READING_MAX_CUMULATIVE_MS = MAX_SAFE_DURATION
