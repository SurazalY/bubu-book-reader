import { createHash, createHmac, randomUUID } from 'node:crypto'

import { assertSynchronousOperation, withTransaction } from './database.js'
import { HttpError, isHttpError } from './errors.js'

const defaultAsyncLeaseMs = 30_000
const minAsyncLeaseMs = 1_000
const maxAsyncLeaseMs = 5 * 60_000
const maxFailureReasonLength = 500

export function stableSerialize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  }

  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`).join(',')}}`
}

export function createIdempotencyRequestHash(value) {
  return createHash('sha256').update(stableSerialize(value), 'utf8').digest('hex')
}

export function createRuntimeKeyedRequestHash(runtimeSecret, value) {
  if (typeof runtimeSecret !== 'string' || runtimeSecret.length === 0) {
    throw new Error('运行时幂等摘要密钥不能为空')
  }
  return createHmac('sha256', runtimeSecret).update(stableSerialize(value), 'utf8').digest('hex')
}

function validateIdempotencyKey(options) {
  const key = options?.key?.trim()
  if (!key || key.length > 200) {
    throw new HttpError(400, 'VALIDATION_FAILED', '写入请求必须提供有效的 Idempotency-Key', {
      details: { field: 'Idempotency-Key' },
    })
  }
  if (!options.scope) {
    throw new Error('幂等操作必须声明 scope')
  }
  return key
}

function resolveRequestHash(options) {
  const requestHash = options.requestHash ?? createIdempotencyRequestHash(options.request ?? {})
  if (typeof requestHash !== 'string' || !/^[a-f0-9]{64}$/i.test(requestHash)) {
    throw new Error('幂等请求摘要必须是 SHA-256 或 HMAC-SHA-256 十六进制值')
  }
  return requestHash
}

function stringifySnapshot(value) {
  if (typeof value === 'string') {
    return value
  }
  return JSON.stringify(value ?? {})
}

function parsePayload(record) {
  return JSON.parse(record.response_json)
}

function recordState(record) {
  return record.state ?? 'succeeded'
}

function currentTime(options) {
  const supplied = typeof options?.now === 'function' ? options.now() : options?.now
  const timestamp = supplied === undefined ? new Date() : new Date(supplied)
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('幂等时钟必须返回有效时间')
  }
  return timestamp.toISOString()
}

function succeededOutcome(record, replayed = true) {
  return {
    state: 'succeeded',
    replayed,
    pending: false,
    processing: false,
    statusCode: record.status_code,
    payload: parsePayload(record),
    sessionId: record.session_id,
  }
}

function failedOutcome(record, replayed = true) {
  return {
    state: 'failed',
    replayed,
    pending: false,
    processing: false,
    retryable: Number(record.retryable) === 1,
    reconciliationRequired: Number(record.reconciliation_required) === 1,
    statusCode: record.status_code,
    payload: parsePayload(record),
    sessionId: record.session_id,
  }
}

function unknownOutcome(record, replayed = true) {
  return {
    state: 'unknown',
    replayed,
    pending: false,
    processing: false,
    retryable: false,
    reconciliationRequired: true,
    statusCode: record.status_code,
    payload: parsePayload(record),
    sessionId: record.session_id,
  }
}

function pendingOutcome(record, now) {
  const retryAfterMs = Math.max(
    0,
    record.lease_until ? new Date(record.lease_until).getTime() - new Date(now).getTime() : 0,
  )
  return {
    state: 'pending',
    replayed: false,
    pending: true,
    processing: true,
    retryable: true,
    statusCode: 202,
    payload: {
      data: {
        status: 'pending',
        retryAfterMs,
      },
      meta: {
        retryable: true,
      },
    },
    sessionId: null,
  }
}

function storedOutcome(record, now, replayed = true) {
  switch (recordState(record)) {
    case 'succeeded':
      return succeededOutcome(record, replayed)
    case 'failed':
      return failedOutcome(record, replayed)
    case 'unknown':
      return unknownOutcome(record, replayed)
    case 'pending':
      return pendingOutcome(record, now)
    default:
      throw new Error(`未知幂等状态: ${record.state}`)
  }
}

function readIdempotencyRecord(database, scope, key) {
  return database
    .prepare(`
      SELECT
        id, status_code, response_json, session_id, request_hash, state,
        lease_owner, lease_epoch, lease_until, external_effect_started, attempt_count, failure_code,
        failure_reason, retryable, reconciliation_required, provider_reference, failure_at
      FROM idempotency_records
      WHERE scope_key = ? AND idempotency_key = ?
    `)
    .get(scope, key)
}

function assertMatchingRequest(existing, requestHash) {
  if (existing.request_hash !== requestHash) {
    throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '同一 Idempotency-Key 对应的请求内容不同')
  }
}

function assertOutcome(outcome, operationName) {
  if (!outcome || !Number.isInteger(outcome.statusCode) || !outcome.payload) {
    throw new Error(`${operationName} 必须返回 statusCode 与 payload`)
  }
}

function validateAsyncLeaseMs(value = defaultAsyncLeaseMs) {
  if (!Number.isSafeInteger(value) || value < minAsyncLeaseMs || value > maxAsyncLeaseMs) {
    throw new Error(`leaseMs 必须为 ${minAsyncLeaseMs} 到 ${maxAsyncLeaseMs} 之间的整数毫秒数`)
  }
  return value
}

function leaseUntilAt(now, leaseMs) {
  return new Date(new Date(now).getTime() + leaseMs).toISOString()
}

function leaseLostError(message = '幂等租约已失效，当前 worker 不能继续提交') {
  return new HttpError(409, 'IDEMPOTENCY_LEASE_LOST', message, {
    retryable: true,
  })
}

function isLeaseLostError(error) {
  return isHttpError(error) && error.code === 'IDEMPOTENCY_LEASE_LOST'
}

function pendingPayload() {
  return { data: { status: 'pending' } }
}

function failureReason(message, fallback) {
  const normalized = typeof message === 'string' ? message.trim() : ''
  return (normalized || fallback).slice(0, maxFailureReasonLength)
}

function createFailedDescriptor({ statusCode, code, message, details = {}, retryable = false }) {
  if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
    throw new Error('失败幂等结果必须使用 400 到 599 的 statusCode')
  }
  if (typeof code !== 'string' || code.length === 0 || typeof message !== 'string' || message.length === 0) {
    throw new Error('失败幂等结果必须包含 code 与 message')
  }
  const safeRetry = Boolean(retryable)
  return {
    state: 'failed',
    statusCode,
    payload: {
      error: {
        code,
        message,
        retryable: safeRetry,
        details,
      },
    },
    failureCode: code,
    failureReason: failureReason(message, '已确认操作失败'),
    retryable: safeRetry,
    reconciliationRequired: false,
  }
}

function createUnknownDescriptor() {
  return {
    state: 'unknown',
    statusCode: 503,
    payload: {
      error: {
        code: 'DEPENDENCY_UNAVAILABLE',
        message: '外部操作结果未知，正在等待对账确认，不能自动重试',
        retryable: false,
        details: { reconciliationRequired: true },
      },
    },
    failureCode: 'UNKNOWN_EXTERNAL_OUTCOME',
    failureReason: '外部操作结果未知，需要对账或人工确认',
    retryable: false,
    reconciliationRequired: true,
  }
}

function classifyAsyncFailure(error, externalSideEffectStarted) {
  if (!externalSideEffectStarted && isHttpError(error)) {
    return createFailedDescriptor({
      statusCode: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
      retryable: error.retryable,
    })
  }
  return createUnknownDescriptor()
}

function readIdempotencyRecordById(database, id) {
  return database
    .prepare(`
      SELECT
        id, status_code, response_json, session_id, request_hash, state,
        lease_owner, lease_epoch, lease_until, external_effect_started, attempt_count, failure_code,
        failure_reason, retryable, reconciliation_required, provider_reference, failure_at
      FROM idempotency_records
      WHERE id = ?
    `)
    .get(id)
}

function markPendingExternalEffectStarted(database, reservation, now) {
  return withTransaction(database, () => {
    const update = database
      .prepare(`
        UPDATE idempotency_records
        SET external_effect_started = 1, updated_at = ?, version = version + 1
        WHERE id = ?
          AND state = 'pending'
          AND lease_owner = ?
          AND lease_epoch = ?
          AND lease_until > ?
      `)
      .run(now, reservation.id, reservation.leaseOwner, reservation.leaseEpoch, now)
    if (update.changes !== 1) {
      throw leaseLostError('幂等租约已失效，外部调用不能开始')
    }
    return {
      leaseOwner: reservation.leaseOwner,
      leaseEpoch: reservation.leaseEpoch,
      leaseUntil: reservation.leaseUntil,
    }
  })
}

function renewPendingLease(database, reservation, leaseMs, now) {
  const leaseUntil = leaseUntilAt(now, leaseMs)
  return withTransaction(database, () => {
    const update = database
      .prepare(`
        UPDATE idempotency_records
        SET lease_until = ?, updated_at = ?, version = version + 1
        WHERE id = ?
          AND state = 'pending'
          AND lease_owner = ?
          AND lease_epoch = ?
          AND lease_until > ?
          AND external_effect_started = 0
      `)
      .run(leaseUntil, now, reservation.id, reservation.leaseOwner, reservation.leaseEpoch, now)
    if (update.changes !== 1) {
      throw leaseLostError('幂等租约已失效或外部副作用已经开始，不能续租')
    }
    reservation.leaseUntil = leaseUntil
    return {
      leaseOwner: reservation.leaseOwner,
      leaseEpoch: reservation.leaseEpoch,
      leaseUntil,
    }
  })
}

function createReservation(id, leaseOwner, leaseEpoch, leaseUntil, createdAt, attemptCount, options = {}) {
  return {
    kind: 'reserved',
    id,
    leaseOwner,
    leaseEpoch,
    leaseUntil,
    createdAt,
    attemptCount,
    recovered: options.recovered ?? false,
    retried: options.retried ?? false,
  }
}

function expirePendingExternalEffect(database, existing, now) {
  const descriptor = createUnknownDescriptor()
  const update = database
    .prepare(`
      UPDATE idempotency_records
      SET status_code = ?, response_json = ?, session_id = NULL, state = 'unknown',
        lease_owner = NULL, lease_until = NULL, updated_at = ?, version = version + 1,
        failure_code = ?, failure_reason = ?, retryable = 0, reconciliation_required = 1,
        provider_reference = NULL, failure_at = ?
      WHERE id = ?
        AND state = 'pending'
        AND lease_owner = ?
        AND lease_epoch = ?
        AND lease_until <= ?
        AND external_effect_started = 1
    `)
    .run(
      descriptor.statusCode,
      JSON.stringify(descriptor.payload),
      now,
      descriptor.failureCode,
      descriptor.failureReason,
      now,
      existing.id,
      existing.lease_owner,
      existing.lease_epoch,
      now,
    )
  if (update.changes === 1) {
    return unknownOutcome(readIdempotencyRecordById(database, existing.id), true)
  }
  return null
}

function reserveAsyncIdempotency(database, options) {
  const now = options.now
  const leaseOwner = randomUUID()
  const leaseUntil = leaseUntilAt(now, options.leaseMs)

  return withTransaction(database, () => {
    const existing = readIdempotencyRecord(database, options.scope, options.key)
    if (!existing) {
      const id = randomUUID()
      database
        .prepare(`
          INSERT INTO idempotency_records (
            id, scope_key, idempotency_key, request_hash, status_code,
            response_json, session_id, created_at, updated_at, version,
            state, lease_owner, lease_epoch, lease_until, external_effect_started, attempt_count,
            failure_code, failure_reason, retryable, reconciliation_required, provider_reference, failure_at
          ) VALUES (?, ?, ?, ?, 202, ?, NULL, ?, ?, 1, 'pending', ?, 1, ?, 0, 1, NULL, NULL, 0, 0, NULL, NULL)
        `)
        .run(id, options.scope, options.key, options.requestHash, JSON.stringify(pendingPayload()), now, now, leaseOwner, leaseUntil)
      return createReservation(id, leaseOwner, 1, leaseUntil, now, 1)
    }

    assertMatchingRequest(existing, options.requestHash)
    const state = recordState(existing)
    if (state === 'succeeded' || state === 'unknown' || (state === 'failed' && Number(existing.retryable) !== 1)) {
      return { kind: 'outcome', outcome: storedOutcome(existing, now, true) }
    }
    if (state === 'pending' && existing.lease_until && existing.lease_until > now) {
      return { kind: 'outcome', outcome: pendingOutcome(existing, now) }
    }
    if (state === 'pending' && Number(existing.external_effect_started) === 1) {
      const expiredOutcome = expirePendingExternalEffect(database, existing, now)
      if (expiredOutcome) {
        return { kind: 'outcome', outcome: expiredOutcome }
      }
    }

    const claim = database
      .prepare(`
        UPDATE idempotency_records
        SET state = 'pending', status_code = 202, response_json = ?, session_id = NULL,
          lease_owner = ?, lease_epoch = lease_epoch + 1, lease_until = ?, external_effect_started = 0,
          updated_at = ?, attempt_count = attempt_count + 1,
          failure_code = NULL, failure_reason = NULL, retryable = 0, reconciliation_required = 0,
          provider_reference = NULL, failure_at = NULL, version = version + 1
        WHERE id = ?
          AND request_hash = ?
          AND (
            (state = 'pending' AND external_effect_started = 0 AND lease_until <= ?)
            OR (state = 'failed' AND retryable = 1)
          )
      `)
      .run(JSON.stringify(pendingPayload()), leaseOwner, leaseUntil, now, existing.id, options.requestHash, now)
    if (claim.changes === 1) {
      return createReservation(existing.id, leaseOwner, existing.lease_epoch + 1, leaseUntil, now, existing.attempt_count + 1, {
        recovered: state === 'pending',
        retried: state === 'failed',
      })
    }

    const latest = readIdempotencyRecord(database, options.scope, options.key)
    if (!latest) {
      throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', '幂等处理状态正在变化，请使用同一 Idempotency-Key 重试', {
        retryable: true,
      })
    }
    assertMatchingRequest(latest, options.requestHash)
    return { kind: 'outcome', outcome: storedOutcome(latest, now, true) }
  })
}

function completeAsyncIdempotency(database, reservation, outcome, now) {
  return withTransaction(database, () => {
    const update = database
      .prepare(`
        UPDATE idempotency_records
        SET status_code = ?, response_json = ?, session_id = ?, state = 'succeeded',
          lease_owner = NULL, lease_until = NULL, updated_at = ?, version = version + 1,
          failure_code = NULL, failure_reason = NULL, retryable = 0, reconciliation_required = 0,
          provider_reference = ?, failure_at = NULL
        WHERE id = ?
          AND state = 'pending'
          AND lease_owner = ?
          AND lease_epoch = ?
          AND lease_until > ?
      `)
      .run(
        outcome.statusCode,
        JSON.stringify(outcome.payload),
        outcome.sessionId ?? null,
        now,
        outcome.providerReference ?? null,
        reservation.id,
        reservation.leaseOwner,
        reservation.leaseEpoch,
        now,
      )
    if (update.changes !== 1) {
      throw leaseLostError()
    }
    return {
      state: 'succeeded',
      replayed: false,
      pending: false,
      processing: false,
      statusCode: outcome.statusCode,
      payload: outcome.payload,
      sessionId: outcome.sessionId ?? null,
      recovered: reservation.recovered,
      retried: reservation.retried,
      attemptCount: reservation.attemptCount,
    }
  })
}

function persistAsyncFailure(database, reservation, descriptor, now) {
  return withTransaction(database, () => {
    const update = database
      .prepare(`
        UPDATE idempotency_records
        SET status_code = ?, response_json = ?, session_id = NULL, state = ?,
          lease_owner = NULL, lease_until = NULL, updated_at = ?, version = version + 1,
          failure_code = ?, failure_reason = ?, retryable = ?, reconciliation_required = ?,
          provider_reference = NULL, failure_at = ?
        WHERE id = ?
          AND state = 'pending'
          AND lease_owner = ?
          AND lease_epoch = ?
          AND lease_until > ?
      `)
      .run(
        descriptor.statusCode,
        JSON.stringify(descriptor.payload),
        descriptor.state,
        now,
        descriptor.failureCode,
        descriptor.failureReason,
        descriptor.retryable ? 1 : 0,
        descriptor.reconciliationRequired ? 1 : 0,
        now,
        reservation.id,
        reservation.leaseOwner,
        reservation.leaseEpoch,
        now,
      )
    if (update.changes !== 1) {
      throw leaseLostError()
    }
    return {
      state: descriptor.state,
      replayed: false,
      pending: false,
      processing: false,
      retryable: descriptor.retryable,
      reconciliationRequired: descriptor.reconciliationRequired,
      statusCode: descriptor.statusCode,
      payload: descriptor.payload,
      sessionId: null,
      recovered: reservation.recovered,
      retried: reservation.retried,
      attemptCount: reservation.attemptCount,
    }
  })
}

function reconciliationDescriptor(resolution) {
  if (!resolution || resolution.state === 'succeeded') {
    if (resolution?.sideEffectStatus !== 'completed') {
      throw new Error("成功对账必须声明 sideEffectStatus='completed'")
    }
    const providerReference = resolution.providerReference?.trim()
    if (!providerReference || providerReference.length > maxFailureReasonLength) {
      throw new Error('成功对账必须提供有效的 providerReference')
    }
    const outcome = resolution?.outcome
    assertOutcome(outcome, '幂等对账成功结果')
    return { state: 'succeeded', outcome, providerReference }
  }
  if (resolution.state === 'failed') {
    if (resolution.sideEffectStatus !== 'not_started') {
      throw new Error("失败对账必须声明 sideEffectStatus='not_started'")
    }
    const evidenceReference = resolution.evidenceReference?.trim()
    if (!evidenceReference || evidenceReference.length > maxFailureReasonLength) {
      throw new Error('失败对账必须提供有效的 evidenceReference')
    }
    return {
      state: 'failed',
      evidenceReference,
      failure: createFailedDescriptor({
        statusCode: resolution.statusCode ?? 503,
        code: resolution.code,
        message: resolution.message,
        details: resolution.details ?? {},
        retryable: resolution.retryable ?? false,
      }),
    }
  }
  throw new Error('幂等对账 resolution.state 必须是 succeeded 或 failed')
}

export function reconcileIdempotency(database, options) {
  const key = validateIdempotencyKey(options)
  const requestHash = resolveRequestHash(options)
  const descriptor = reconciliationDescriptor(options.resolution)
  const now = currentTime(options)

  return withTransaction(database, () => {
    const existing = readIdempotencyRecord(database, options.scope, key)
    if (!existing) {
      throw new HttpError(404, 'RESOURCE_NOT_FOUND', '未找到需要对账的幂等记录')
    }
    assertMatchingRequest(existing, requestHash)
    if (recordState(existing) !== 'unknown') {
      throw new HttpError(409, 'IDEMPOTENCY_RECONCILIATION_NOT_REQUIRED', '当前幂等记录不处于待对账状态')
    }

    if (descriptor.state === 'succeeded') {
      const update = database
        .prepare(`
          UPDATE idempotency_records
          SET status_code = ?, response_json = ?, session_id = ?, state = 'succeeded',
            lease_owner = NULL, lease_until = NULL, updated_at = ?, version = version + 1,
            failure_code = NULL, failure_reason = NULL, retryable = 0, reconciliation_required = 0,
            provider_reference = ?, failure_at = NULL
          WHERE id = ? AND state = 'unknown'
        `)
        .run(
          descriptor.outcome.statusCode,
          JSON.stringify(descriptor.outcome.payload),
          descriptor.outcome.sessionId ?? null,
          now,
          descriptor.providerReference,
          existing.id,
        )
      if (update.changes === 1) {
        return {
          state: 'succeeded',
          replayed: false,
          pending: false,
          processing: false,
          statusCode: descriptor.outcome.statusCode,
          payload: descriptor.outcome.payload,
          sessionId: descriptor.outcome.sessionId ?? null,
          reconciled: true,
        }
      }
    } else {
      const update = database
        .prepare(`
          UPDATE idempotency_records
          SET status_code = ?, response_json = ?, session_id = NULL, state = 'failed',
            lease_owner = NULL, lease_until = NULL, updated_at = ?, version = version + 1,
            failure_code = ?, failure_reason = ?, retryable = ?, reconciliation_required = 0,
            provider_reference = ?, failure_at = ?
          WHERE id = ? AND state = 'unknown'
        `)
        .run(
          descriptor.failure.statusCode,
          JSON.stringify(descriptor.failure.payload),
          now,
          descriptor.failure.failureCode,
          descriptor.failure.failureReason,
          descriptor.failure.retryable ? 1 : 0,
          descriptor.evidenceReference,
          now,
          existing.id,
        )
      if (update.changes === 1) {
        return {
          state: 'failed',
          replayed: false,
          pending: false,
          processing: false,
          retryable: descriptor.failure.retryable,
          reconciliationRequired: false,
          statusCode: descriptor.failure.statusCode,
          payload: descriptor.failure.payload,
          sessionId: null,
          reconciled: true,
        }
      }
    }

    const latest = readIdempotencyRecord(database, options.scope, key)
    if (latest) {
      return { ...storedOutcome(latest, now, true), reconciled: false }
    }
    throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', '幂等对账状态正在变化，请稍后重试', { retryable: true })
  })
}

export function appendAuditEvent(database, event) {
  if (!event?.eventType) {
    throw new Error('审计事件必须包含 eventType')
  }

  const createdAt = event.createdAt ?? new Date().toISOString()
  const id = event.id ?? randomUUID()
  database
    .prepare(`
      INSERT INTO audit_events (
        id, event_type, actor_user_id, workspace_id, scope_snapshot_json,
        resource_type, resource_id, request_id, idempotency_key, outcome,
        reason_code, before_version, after_version, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      event.eventType,
      event.actorUserId ?? null,
      event.workspaceId ?? null,
      stringifySnapshot(event.scopeSnapshot),
      event.resourceType ?? null,
      event.resourceId ?? null,
      event.requestId ?? null,
      event.idempotencyKey ?? null,
      event.outcome ?? 'succeeded',
      event.reasonCode ?? null,
      event.beforeVersion ?? null,
      event.afterVersion ?? null,
      createdAt,
      createdAt,
      1,
    )
  return id
}

export function enqueueOutboxEvent(database, event) {
  if (!event?.topic || !event?.aggregateType || !event?.aggregateId) {
    throw new Error('Outbox 事件必须包含 topic、aggregateType 和 aggregateId')
  }

  const createdAt = event.createdAt ?? new Date().toISOString()
  const id = event.id ?? randomUUID()
  const dedupeKey = event.dedupeKey ?? null
  const result = database
    .prepare(`
      INSERT INTO outbox_events (
        id, topic, aggregate_type, aggregate_id, payload_json, status,
        attempt_count, available_at, locked_at, processed_at, last_error,
        dedupe_key, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL, ?, ?, ?, 1)
      ON CONFLICT(dedupe_key) DO NOTHING
    `)
    .run(
      id,
      event.topic,
      event.aggregateType,
      event.aggregateId,
      JSON.stringify(event.payload ?? {}),
      event.availableAt ?? createdAt,
      dedupeKey,
      createdAt,
      createdAt,
    )

  if (result.changes > 0 || !dedupeKey) {
    return id
  }

  const existing = database
    .prepare('SELECT id FROM outbox_events WHERE dedupe_key = ?')
    .get(dedupeKey)
  return existing.id
}

export function executeIdempotent(database, options) {
  assertSynchronousOperation(options?.operation, 'executeIdempotent')
  const key = validateIdempotencyKey(options)
  const requestHash = resolveRequestHash(options)
  return withTransaction(database, () => {
    const existing = readIdempotencyRecord(database, options.scope, key)
    if (existing) {
      assertMatchingRequest(existing, requestHash)
      if (recordState(existing) === 'pending') {
        throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', '同一幂等键仍在异步处理中，请稍后重试', {
          retryable: true,
        })
      }
      return storedOutcome(existing, currentTime(options), true)
    }

    const createdAt = currentTime(options)
    const outcome = options.operation({ createdAt, requestHash, idempotencyKey: key, scope: options.scope })
    assertOutcome(outcome, '幂等操作')
    database
      .prepare(`
        INSERT INTO idempotency_records (
          id, scope_key, idempotency_key, request_hash, status_code,
          response_json, session_id, created_at, updated_at, version,
          state, lease_owner, lease_epoch, lease_until, external_effect_started, attempt_count,
          failure_code, failure_reason, retryable, reconciliation_required, provider_reference, failure_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'succeeded', NULL, 0, NULL, 0, 1, NULL, NULL, 0, 0, NULL, NULL)
      `)
      .run(
        randomUUID(),
        options.scope,
        key,
        requestHash,
        outcome.statusCode,
        JSON.stringify(outcome.payload),
        outcome.sessionId ?? null,
        createdAt,
        createdAt,
      )

    return {
      state: 'succeeded',
      replayed: false,
      pending: false,
      processing: false,
      statusCode: outcome.statusCode,
      payload: outcome.payload,
      sessionId: outcome.sessionId ?? null,
    }
  })
}

export async function executeIdempotentAsync(database, options) {
  if (typeof options?.operation !== 'function') {
    throw new TypeError('executeIdempotentAsync 必须提供 operation 函数')
  }
  const key = validateIdempotencyKey(options)
  const requestHash = resolveRequestHash(options)
  const leaseMs = validateAsyncLeaseMs(options.leaseMs)
  const reservationTime = currentTime(options)
  const reservation = reserveAsyncIdempotency(database, {
    key,
    scope: options.scope,
    requestHash,
    leaseMs,
    now: reservationTime,
  })
  if (reservation.kind === 'outcome') {
    return reservation.outcome
  }

  let externalSideEffectStarted = false
  let outcome
  try {
    outcome = await options.operation({
      createdAt: reservation.createdAt,
      requestHash,
      leaseOwner: reservation.leaseOwner,
      leaseEpoch: reservation.leaseEpoch,
      leaseUntil: reservation.leaseUntil,
      idempotencyKey: key,
      scope: options.scope,
      attemptCount: reservation.attemptCount,
      recovered: reservation.recovered,
      retried: reservation.retried,
      renewLease: (requestedLeaseMs = leaseMs) => {
        if (externalSideEffectStarted) {
          throw new HttpError(
            409,
            'IDEMPOTENCY_LEASE_RENEWAL_FORBIDDEN',
            '外部副作用开始后不能续租',
            { retryable: false },
          )
        }
        const renewed = renewPendingLease(
          database,
          reservation,
          validateAsyncLeaseMs(requestedLeaseMs),
          currentTime(options),
        )
        return renewed
      },
      markExternalSideEffectStarted: () => {
        const marked = markPendingExternalEffectStarted(database, reservation, currentTime(options))
        externalSideEffectStarted = true
        return marked
      },
    })
    assertOutcome(outcome, '异步幂等操作')
  } catch (error) {
    if (isLeaseLostError(error)) {
      throw error
    }
    return persistAsyncFailure(
      database,
      reservation,
      classifyAsyncFailure(error, externalSideEffectStarted),
      currentTime(options),
    )
  }

  return completeAsyncIdempotency(database, reservation, outcome, currentTime(options))
}

export function readCoreHealth(database) {
  const probe = database.prepare('SELECT 1 AS value').get()
  const migrations = database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()
  return {
    status: probe.value === 1 ? 'ok' : 'degraded',
    database: 'sqlite',
    migrations: migrations.count,
  }
}
