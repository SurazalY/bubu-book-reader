import { enqueueOutboxEvent } from '../../db/reliability.js'

const OPEN_REVIEW_STATUSES = ['pending_secondary_review', 'review_claimed', 'pending_human_confirmation', 'awaiting_human_acceptance']
const CLAIMABLE_REVIEW_STATUSES = new Set(['pending_secondary_review', 'review_claimed'])
const DANGER_LEVEL_PRIORITY = new Map([
  ['none', 0],
  ['low', 1],
  ['medium', 2],
  ['high', 3],
  ['critical', 4],
])

function parseJson(value, fallback) {
  if (typeof value !== 'string' || value.length === 0) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function stringifyJson(value) {
  const serialized = JSON.stringify(value)
  if (typeof serialized !== 'string') throw new TypeError('SQLite adapter records must be JSON serializable')
  return serialized
}

function nonNegative(value, field) {
  const normalized = Number(value ?? 0)
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new TypeError(`${field} must be a non-negative number`)
  }
  return normalized
}

function confidence(value, field) {
  const normalized = nonNegative(value, field)
  if (normalized > 1) throw new TypeError(`${field} must not exceed 1`)
  return normalized
}

function integerFlag(value) {
  return value ? 1 : 0
}

function changeCount(result) {
  return Number(result?.changes || 0)
}

function isPromiseLike(value) {
  return Boolean(value && typeof value.then === 'function')
}

function compareIso(left, right) {
  const leftValue = Date.parse(left || '')
  const rightValue = Date.parse(right || '')
  return Number.isFinite(leftValue) && Number.isFinite(rightValue) ? leftValue - rightValue : 0
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.length > 0))]
}

function sameStringSet(left, right) {
  const leftValues = uniqueStrings(left)
  const rightValues = uniqueStrings(right)
  if (leftValues.length !== rightValues.length) return false
  const rightSet = new Set(rightValues)
  return leftValues.every((value) => rightSet.has(value))
}

function idempotencyScope({ organizationId, ownerUserId, conversationId, key }) {
  const values = [organizationId, ownerUserId, conversationId, key]
  if (values.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new TypeError('idempotency scope requires organization, owner, conversation, and key')
  }
  return {
    organizationId,
    ownerUserId,
    conversationId,
    key,
    scopeKey: `scope:v1:${values.map((value) => `${value.length}:${value}`).join('|')}`,
  }
}

function mergeTriggerReasons(existingReasons, incomingReasons) {
  const reasons = []
  const positions = new Map()
  for (const reason of [...(Array.isArray(existingReasons) ? existingReasons : []), ...(Array.isArray(incomingReasons) ? incomingReasons : [])]) {
    if (!reason || typeof reason !== 'object') continue
    const key = stringifyJson({ kind: reason.kind ?? null, reason: reason.reason ?? null })
    const position = positions.get(key)
    if (position === undefined) {
      positions.set(key, reasons.length)
      reasons.push(reason)
      continue
    }
    const existingCount = Number(reasons[position].qualifiedMessageCount) || 0
    const incomingCount = Number(reason.qualifiedMessageCount) || 0
    if (incomingCount > existingCount) reasons[position] = reason
  }
  return reasons
}

function dangerSignalPriority(signal) {
  const normalized = signal && typeof signal === 'object' ? signal : {}
  const immediate = [
    'explicitSelfHarmPlan',
    'explicitSelfHarmTime',
    'explicitSelfHarmMeans',
    'hasPlan',
    'hasTime',
    'hasMeans',
    'extremeRisk',
  ]
    .some((field) => normalized[field])
  const urgency = DANGER_LEVEL_PRIORITY.get(normalized.urgency) ?? DANGER_LEVEL_PRIORITY.get(normalized.riskLevel) ?? 0
  return (immediate ? 100 : 0) + urgency * 10 + (Number(normalized.confidence) || 0)
}

function mergeDangerSignals(existingSignal, incomingSignal) {
  const existing = existingSignal && typeof existingSignal === 'object' ? existingSignal : {}
  const incoming = incomingSignal && typeof incomingSignal === 'object' ? incomingSignal : {}
  const dominant = dangerSignalPriority(incoming) > dangerSignalPriority(existing) ? incoming : existing
  const secondary = dominant === incoming ? existing : incoming
  const merged = { ...secondary, ...dominant }
  merged.detected = Boolean(existing.detected || incoming.detected)
  merged.confidence = Math.max(Number(existing.confidence) || 0, Number(incoming.confidence) || 0)
  for (const field of [
    'explicitSelfHarmPlan',
    'explicitSelfHarmTime',
    'explicitSelfHarmMeans',
    'hasPlan',
    'hasTime',
    'hasMeans',
    'extremeRisk',
  ]) {
    if (existing[field] || incoming[field]) merged[field] = true
  }
  return merged
}

function evidenceTrigger(triggerReasons, isCurrentMessage) {
  const reasons = Array.isArray(triggerReasons) ? triggerReasons : []
  if (isCurrentMessage && reasons.some((reason) => reason?.reason === 'immediate_secondary_review')) {
    return 'immediate_secondary_review'
  }
  if (!isCurrentMessage) return 'qualified_message_count'
  return reasons.find((reason) => typeof reason?.reason === 'string' && reason.reason.length > 0)?.reason || 'qualified_message_count'
}

function signalRecord(signal) {
  const normalized = signal && typeof signal === 'object' ? signal : {}
  return {
    detected: integerFlag(normalized.detected),
    confidence: confidence(normalized.confidence ?? 0, 'signal confidence'),
    json: stringifyJson(normalized),
  }
}

function mapIdempotency(row) {
  if (!row) return null
  return {
    key: row.logical_idempotency_key || row.idempotency_key,
    fingerprint: row.fingerprint,
    requestId: row.request_id,
    status: row.status,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    response: parseJson(row.response_json, null),
    reservation: parseJson(row.reservation_json, null),
    reasonCode: row.reason_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    organizationId: row.organization_id,
    ownerUserId: row.owner_user_id,
    conversationId: row.conversation_id,
  }
}

function mapUsage(row, reservation = null) {
  if (!row) return null
  return {
    id: row.id,
    requestId: row.request_id,
    organizationId: row.organization_id,
    organizationIdAtCreation: row.organization_id_at_creation,
    userId: row.user_id,
    conversationId: row.conversation_id,
    assistantMessageId: row.assistant_message_id,
    chargeScope: row.charge_scope,
    reservationState: row.reservation_state,
    reservation: reservation || { maxCostMicros: row.reserved_cost_micros, requestUnits: 1 },
    reservedCostMicros: row.reserved_cost_micros,
    studentChargeCostMicros: row.student_charge_cost_micros,
    providerUsage: {
      costMicros: row.provider_cost_micros ?? 0,
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      cachedTokens: row.cached_tokens ?? 0,
    },
    providerAttempts: parseJson(row.provider_attempts_json, []),
    reasonCode: row.reason_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapReviewTask(row, reviewEvidence = []) {
  if (!row) return null
  const normalizedEvidence = reviewEvidence.map((evidence) => ({
    messageId: evidence.ai_message_id,
    confidence: evidence.confidence,
    trigger: evidence.trigger,
    createdAt: evidence.created_at,
  }))
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationIdAtCreation: row.organization_id_at_creation,
    actorUserId: row.actor_id_at_creation,
    actorIdAtCreation: row.actor_id_at_creation,
    conversationId: row.conversation_id,
    initialMessageId: row.initial_message_id,
    evidenceMessageIds: normalizedEvidence.length > 0
      ? normalizedEvidence.map((evidence) => evidence.messageId)
      : uniqueStrings(parseJson(row.evidence_message_ids_json, [])),
    reviewEvidence: normalizedEvidence,
    triggerReasons: parseJson(row.trigger_reasons_json, []),
    privacy: parseJson(row.privacy_json, {}),
    danger: parseJson(row.danger_json, {}),
    candidateUserIds: uniqueStrings(parseJson(row.candidate_user_ids_json, [])),
    candidateCatalogIds: uniqueStrings(parseJson(row.candidate_catalog_ids_json, [])),
    policySnapshot: parseJson(row.policy_snapshot_json, {}),
    status: row.status,
    reasonCode: row.reason_code,
    reviewAttempts: Number(row.review_attempts || 0),
    evidenceGeneration: Number(row.evidence_generation || 0),
    dueAt: row.due_at,
    reviewLeaseToken: row.lease_token || null,
    reviewLeaseExpiresAt: row.lease_expires_at || null,
    reviewClaimedAt: row.claimed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapSafetyEvent(row) {
  if (!row) return null
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationIdAtCreation: row.organization_id_at_creation,
    actorIdAtCreation: row.actor_id_at_creation,
    reviewTaskId: row.review_task_id,
    status: row.status,
    reasonCode: row.reason_code,
    riskLevel: row.risk_level,
    summaryForStaff: row.summary_for_staff,
    notificationChain: parseJson(row.notification_chain_json, []),
    acceptedByUserId: row.accepted_by_user_id,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapAccessRequest(row) {
  if (!row) return null
  return {
    id: row.id,
    organizationId: row.organization_id,
    conversationId: row.conversation_id,
    requesterUserId: row.requester_user_id,
    status: row.status,
    purpose: row.purpose,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createAiSafetySqliteAdapter({ database, readScopeProvider, evidenceBlockProvider }) {
  if (typeof database?.prepare !== 'function' || typeof database?.exec !== 'function') {
    throw new TypeError('database must be a node:sqlite DatabaseSync-compatible connection')
  }
  if (typeof readScopeProvider !== 'function' || typeof evidenceBlockProvider !== 'function') {
    throw new TypeError('readScopeProvider and evidenceBlockProvider are required external read adapters')
  }

  function hasConversationAccess({ organizationId, ownerUserId, conversationId }) {
    return Boolean(database.prepare(`
      SELECT 1
      FROM ai_conversations
      WHERE organization_id = ? AND owner_user_id = ? AND id = ?
    `).get(organizationId, ownerUserId, conversationId))
  }

  function getIdempotency(input) {
    const scope = idempotencyScope(input)
    return mapIdempotency(database.prepare(`
      SELECT request.*, scope.idempotency_key AS logical_idempotency_key,
             scope.organization_id, scope.owner_user_id, scope.conversation_id
      FROM ai_idempotency_scopes AS scope
      JOIN ai_idempotency_requests AS request ON request.request_id = scope.request_id
      WHERE scope.organization_id = ? AND scope.owner_user_id = ? AND scope.conversation_id = ?
        AND scope.idempotency_key = ?
    `).get(scope.organizationId, scope.ownerUserId, scope.conversationId, scope.key))
  }

  function getUsage(input) {
    const scope = idempotencyScope(input)
    const idempotency = getIdempotency(scope)
    if (!idempotency || idempotency.requestId !== input.requestId) return null
    const row = database.prepare(`
      SELECT * FROM ai_usage_ledger
      WHERE request_id = ? AND organization_id = ? AND user_id = ? AND conversation_id = ?
    `).get(input.requestId, scope.organizationId, scope.ownerUserId, scope.conversationId)
    return mapUsage(row, idempotency?.reservation || null)
  }

  function getReviewTask({ reviewTaskId, organizationId, ownerUserId }) {
    const row = database.prepare(`
      SELECT task.*, lease.lease_token, lease.lease_expires_at, lease.claimed_at,
             evidence_state.evidence_generation
      FROM safety_review_tasks AS task
      LEFT JOIN safety_review_leases AS lease ON lease.review_task_id = task.id
      LEFT JOIN safety_review_evidence_state AS evidence_state
        ON evidence_state.review_task_id = task.id
       AND evidence_state.organization_id = task.organization_id
       AND evidence_state.owner_user_id = task.actor_id_at_creation
       AND evidence_state.conversation_id = task.conversation_id
      WHERE task.id = ? AND task.organization_id = ? AND task.actor_id_at_creation = ?
    `).get(reviewTaskId, organizationId, ownerUserId)
    if (!row) return null
    const reviewEvidence = database.prepare(`
      SELECT ai_message_id, confidence, trigger, created_at
      FROM safety_review_evidence
      WHERE review_task_id = ? AND organization_id = ? AND owner_user_id = ? AND conversation_id = ?
      ORDER BY created_at ASC, ai_message_id ASC
    `).all(reviewTaskId, organizationId, ownerUserId, row.conversation_id)
    return mapReviewTask(row, reviewEvidence)
  }

  function getSafetyEvent({ reviewTaskId, organizationId, ownerUserId }) {
    return mapSafetyEvent(database.prepare(`
      SELECT safety_event.*
      FROM safety_events AS safety_event
      JOIN safety_review_tasks AS review_task ON review_task.id = safety_event.review_task_id
      WHERE safety_event.review_task_id = ?
        AND review_task.organization_id = ?
        AND review_task.actor_id_at_creation = ?
    `).get(reviewTaskId, organizationId, ownerUserId))
  }

  function upsertReviewEvidence(record) {
    const messageStatement = database.prepare(`
      SELECT id, danger_confidence, created_at
      FROM ai_messages
      WHERE id = ? AND organization_id = ? AND actor_id_at_creation = ? AND conversation_id = ?
    `)
    const upsertStatement = database.prepare(`
      INSERT INTO safety_review_evidence (
        review_task_id, ai_message_id, organization_id, owner_user_id, conversation_id,
        confidence, trigger, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(review_task_id, ai_message_id) DO UPDATE SET
        confidence = MAX(safety_review_evidence.confidence, excluded.confidence),
        trigger = CASE
          WHEN excluded.trigger = 'immediate_secondary_review' THEN excluded.trigger
          ELSE safety_review_evidence.trigger
        END,
        updated_at = excluded.updated_at,
        version = safety_review_evidence.version + 1
      WHERE excluded.confidence > safety_review_evidence.confidence
         OR (excluded.trigger = 'immediate_secondary_review'
             AND safety_review_evidence.trigger <> 'immediate_secondary_review')
    `)
    for (const messageId of uniqueStrings(record.evidenceMessageIds)) {
      const message = messageStatement.get(
        messageId,
        record.organizationId,
        record.actorIdAtCreation,
        record.conversationId,
      )
      if (!message) throw new Error('resource scope violation')
      upsertStatement.run(
        record.reviewTaskId,
        messageId,
        record.organizationId,
        record.actorIdAtCreation,
        record.conversationId,
        confidence(message.danger_confidence, 'review evidence confidence'),
        evidenceTrigger(record.triggerReasons, messageId === record.currentMessageId),
        message.created_at,
        record.updatedAt,
      )
    }
  }

  function transactionPort() {
    return {
      idempotency: {
        get: (input) => getIdempotency(input),
        claim: (input) => {
          const { fingerprint, requestId, leaseToken, claimedAt, leaseExpiresAt } = input
          const scope = idempotencyScope(input)
          const existing = getIdempotency(scope)
          if (!existing) {
            database.prepare(`
              INSERT INTO ai_idempotency_requests (
                idempotency_key, fingerprint, request_id, status, lease_token, lease_expires_at,
                created_at, updated_at
              ) VALUES (?, ?, ?, 'in_progress', ?, ?, ?, ?)
            `).run(scope.scopeKey, fingerprint, requestId, leaseToken, leaseExpiresAt, claimedAt, claimedAt)
            database.prepare(`
              INSERT INTO ai_idempotency_scopes (
                request_id, organization_id, owner_user_id, conversation_id,
                idempotency_key, scope_key, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              requestId,
              scope.organizationId,
              scope.ownerUserId,
              scope.conversationId,
              scope.key,
              scope.scopeKey,
              claimedAt,
              claimedAt,
            )
            return { outcome: 'claimed', requestId, leaseToken, reservationAction: 'reserve' }
          }
          if (existing.fingerprint !== fingerprint) return { outcome: 'conflict' }
          if (existing.status === 'completed') return { outcome: 'replay', response: existing.response }
          if (existing.status === 'in_progress' && compareIso(existing.leaseExpiresAt, claimedAt) > 0) {
            return { outcome: 'busy', record: existing }
          }
          const hasReservation = Boolean(getUsage({ ...scope, requestId: existing.requestId }))
          const updated = database.prepare(`
            UPDATE ai_idempotency_requests
            SET status = 'in_progress', lease_token = ?, lease_expires_at = ?, response_json = NULL,
                reason_code = NULL, completed_at = NULL, failed_at = NULL, updated_at = ?
            WHERE request_id = (
              SELECT request_id FROM ai_idempotency_scopes
              WHERE organization_id = ? AND owner_user_id = ? AND conversation_id = ? AND idempotency_key = ?
            )
              AND fingerprint = ?
              AND status <> 'completed'
              AND (status = 'failed' OR lease_expires_at <= ?)
          `).run(
            leaseToken,
            leaseExpiresAt,
            claimedAt,
            scope.organizationId,
            scope.ownerUserId,
            scope.conversationId,
            scope.key,
            fingerprint,
            claimedAt,
          )
          if (changeCount(updated) !== 1) return { outcome: 'busy', record: getIdempotency(scope) }
          return {
            outcome: 'claimed',
            requestId: existing.requestId,
            leaseToken,
            reservationAction: hasReservation ? 'reacquire' : 'reserve',
          }
        },
        complete: (input) => {
          const { fingerprint, leaseToken, response, completedAt } = input
          const scope = idempotencyScope(input)
          const result = database.prepare(`
            UPDATE ai_idempotency_requests
            SET status = 'completed', lease_token = NULL, lease_expires_at = NULL, response_json = ?,
                reason_code = NULL, completed_at = ?, updated_at = ?
            WHERE request_id = (
              SELECT request_id FROM ai_idempotency_scopes
              WHERE organization_id = ? AND owner_user_id = ? AND conversation_id = ? AND idempotency_key = ?
            )
              AND fingerprint = ? AND status = 'in_progress' AND lease_token = ?
          `).run(
            stringifyJson(response),
            completedAt,
            completedAt,
            scope.organizationId,
            scope.ownerUserId,
            scope.conversationId,
            scope.key,
            fingerprint,
            leaseToken,
          )
          return changeCount(result) === 1
        },
        fail: (input) => {
          const { fingerprint, leaseToken, reasonCode, failedAt } = input
          const scope = idempotencyScope(input)
          const result = database.prepare(`
            UPDATE ai_idempotency_requests
            SET status = 'failed', lease_token = NULL, lease_expires_at = NULL, response_json = NULL,
                reason_code = ?, failed_at = ?, updated_at = ?
            WHERE request_id = (
              SELECT request_id FROM ai_idempotency_scopes
              WHERE organization_id = ? AND owner_user_id = ? AND conversation_id = ? AND idempotency_key = ?
            )
              AND fingerprint = ? AND status = 'in_progress' AND lease_token = ?
          `).run(
            reasonCode,
            failedAt,
            failedAt,
            scope.organizationId,
            scope.ownerUserId,
            scope.conversationId,
            scope.key,
            fingerprint,
            leaseToken,
          )
          return changeCount(result) === 1
        },
      },
      usage: {
        reserve: (record) => {
          const scope = idempotencyScope({ ...record, key: record.idempotencyKey, ownerUserId: record.userId })
          const reservation = record.reservation || {}
          const reservedCostMicros = nonNegative(reservation.maxCostMicros ?? reservation.reservedCostMicros, 'reserved cost')
          database.prepare(`
            INSERT INTO ai_usage_ledger (
              id, request_id, organization_id, organization_id_at_creation, user_id, conversation_id,
              charge_scope, reservation_state, reserved_cost_micros, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?)
          `).run(
            record.id || `usage:${record.requestId}`,
            record.requestId,
            record.organizationId,
            record.organizationIdAtCreation,
            record.userId,
            record.conversationId,
            reservation.chargeScope || 'student',
            reservedCostMicros,
            record.createdAt,
            record.createdAt,
          )
          const stored = database.prepare(`
            UPDATE ai_idempotency_requests SET reservation_json = ?, updated_at = ?
            WHERE request_id = ? AND status = 'in_progress'
              AND request_id = (
                SELECT request_id FROM ai_idempotency_scopes
                WHERE organization_id = ? AND owner_user_id = ? AND conversation_id = ? AND idempotency_key = ?
              )
          `).run(
            stringifyJson(reservation),
            record.createdAt,
            record.requestId,
            scope.organizationId,
            scope.ownerUserId,
            scope.conversationId,
            scope.key,
          )
          if (changeCount(stored) !== 1) throw new Error('idempotency lease disappeared before usage reservation')
          return getUsage({ ...scope, requestId: record.requestId })
        },
        reacquire: (input) => {
          const { requestId, leaseToken, claimedAt } = input
          const scope = idempotencyScope(input)
          const owner = getIdempotency(scope)
          if (owner?.requestId !== requestId) return null
          if (!owner || owner.status !== 'in_progress' || owner.leaseToken !== leaseToken) return null
          const updated = database.prepare(`
            UPDATE ai_usage_ledger
            SET reservation_state = 'reserved', reason_code = NULL, updated_at = ?
            WHERE request_id = ? AND organization_id = ? AND user_id = ? AND conversation_id = ?
          `).run(claimedAt, requestId, scope.organizationId, scope.ownerUserId, scope.conversationId)
          return changeCount(updated) === 1 ? getUsage({ ...scope, requestId }) : null
        },
        getReservation: (input) => getUsage(input),
        settle: (input) => {
          const { requestId, leaseToken, assistantMessageId, settlement, providerUsage, attempts, reasonCode, settledAt } = input
          const scope = idempotencyScope(input)
          const owner = getIdempotency(scope)
          if (owner?.requestId !== requestId) return false
          if (!owner || owner.status !== 'in_progress' || owner.leaseToken !== leaseToken) return false
          const usage = providerUsage || {}
          const result = database.prepare(`
            UPDATE ai_usage_ledger
            SET assistant_message_id = ?, reservation_state = 'settled',
                student_charge_cost_micros = ?, provider_cost_micros = ?, input_tokens = ?,
                output_tokens = ?, cached_tokens = ?, provider_attempts_json = ?, reason_code = ?,
                updated_at = ?
            WHERE request_id = ? AND organization_id = ? AND user_id = ? AND conversation_id = ?
          `).run(
            assistantMessageId,
            nonNegative(settlement?.studentChargeCostMicros, 'student charge'),
            nonNegative(settlement?.providerCostMicros ?? usage.costMicros, 'provider cost'),
            nonNegative(usage.inputTokens, 'provider input tokens'),
            nonNegative(usage.outputTokens, 'provider output tokens'),
            nonNegative(usage.cachedTokens, 'provider cached tokens'),
            stringifyJson(Array.isArray(attempts) ? attempts : []),
            reasonCode || null,
            settledAt,
            requestId,
            scope.organizationId,
            scope.ownerUserId,
            scope.conversationId,
          )
          return changeCount(result) === 1
        },
        release: (input) => {
          const { requestId, providerUsage, attempts, reasonCode, releasedAt } = input
          const scope = idempotencyScope(input)
          const owner = getIdempotency(scope)
          if (owner?.requestId !== requestId) return false
          if (!owner || owner.status !== 'failed') return false
          const usage = providerUsage || {}
          const result = database.prepare(`
            UPDATE ai_usage_ledger
            SET reservation_state = 'released', provider_cost_micros = ?, input_tokens = ?, output_tokens = ?,
                cached_tokens = ?, provider_attempts_json = ?, reason_code = ?, updated_at = ?
            WHERE request_id = ? AND organization_id = ? AND user_id = ? AND conversation_id = ?
          `).run(
            nonNegative(usage.costMicros, 'provider cost'),
            nonNegative(usage.inputTokens, 'provider input tokens'),
            nonNegative(usage.outputTokens, 'provider output tokens'),
            nonNegative(usage.cachedTokens, 'provider cached tokens'),
            stringifyJson(Array.isArray(attempts) ? attempts : []),
            reasonCode,
            releasedAt,
            requestId,
            scope.organizationId,
            scope.ownerUserId,
            scope.conversationId,
          )
          return changeCount(result) === 1
        },
      },
      ai: {
        assertConversationAccess: (scope) => hasConversationAccess(scope),
        insertMessage: (record) => {
          const privacy = signalRecord(record.privacy)
          const danger = signalRecord(record.danger)
          database.prepare(`
            INSERT INTO ai_messages (
              id, conversation_id, organization_id, organization_id_at_creation, actor_id_at_creation,
              role, content, request_id, model_candidate_id, response_type,
              privacy_detected, privacy_confidence, privacy_json,
              danger_detected, danger_confidence, danger_json, provider_attempts_json, safe_degradation,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            record.id,
            record.conversationId,
            record.organizationId,
            record.organizationIdAtCreation,
            record.actorIdAtCreation,
            record.role,
            record.content,
            record.requestId,
            record.modelCandidateId,
            record.responseType,
            privacy.detected,
            privacy.confidence,
            privacy.json,
            danger.detected,
            danger.confidence,
            danger.json,
            stringifyJson(Array.isArray(record.providerAttempts) ? record.providerAttempts : []),
            integerFlag(record.safeDegradation),
            record.createdAt,
            record.updatedAt,
          )
        },
        insertMessageLink: (record) => {
          database.prepare(`
            INSERT INTO ai_message_request_links (
              logical_request_id, user_message_id, assistant_message_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?)
          `).run(record.logicalRequestId, record.userMessageId, record.assistantMessageId, record.createdAt, record.updatedAt)
        },
        insertMessageEvidence: (record) => {
          database.prepare(`
            INSERT INTO ai_message_evidence (
              id, ai_message_id, book_version_id, evidence_id, page_id, page_number,
              coordinates_json, citation_verified, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            record.id,
            record.messageId,
            record.bookVersionId,
            record.evidenceId,
            record.pageId,
            record.pageNumber,
            record.coordinates === null || record.coordinates === undefined ? null : stringifyJson(record.coordinates),
            integerFlag(record.citationVerified),
            record.createdAt,
            record.updatedAt,
          )
        },
      },
      privacy: {
        markConversationPrivate: (record) => {
          const result = database.prepare(`
            UPDATE ai_conversations
            SET privacy_mode = 'private', updated_at = ?
            WHERE organization_id = ? AND owner_user_id = ? AND id = ?
          `).run(record.updatedAt, record.organizationId, record.ownerUserId, record.conversationId)
          if (changeCount(result) !== 1) return null
          return { ...record, privacyMode: 'private' }
        },
        createAccessRequest: (record) => {
          const conversation = database.prepare(`
            SELECT privacy_mode
            FROM ai_conversations
            WHERE organization_id = ? AND owner_user_id = ? AND id = ?
          `).get(record.organizationId, record.ownerUserId, record.conversationId)
          if (!conversation || conversation.privacy_mode !== 'private') return null
          const existing = database.prepare(`
            SELECT access_request.*
            FROM privacy_access_requests AS access_request
            JOIN privacy_access_request_scopes AS scope ON scope.request_id = access_request.id
            WHERE scope.organization_id = ? AND scope.owner_user_id = ? AND scope.conversation_id = ?
              AND access_request.requester_user_id = ? AND access_request.status = 'pending'
          `).get(record.organizationId, record.ownerUserId, record.conversationId, record.requesterUserId)
          if (existing) return mapAccessRequest(existing)
          database.prepare(`
            INSERT INTO privacy_access_requests (
              id, organization_id, organization_id_at_creation, actor_id_at_creation, conversation_id,
              requester_user_id, status, purpose, expires_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            record.id,
            record.organizationId,
            record.organizationIdAtCreation,
            record.actorIdAtCreation,
            record.conversationId,
            record.requesterUserId,
            record.status,
            record.purpose,
            record.expiresAt || null,
            record.createdAt,
            record.updatedAt,
          )
          return mapAccessRequest(database.prepare(`
            SELECT access_request.*
            FROM privacy_access_requests AS access_request
            JOIN privacy_access_request_scopes AS scope ON scope.request_id = access_request.id
            WHERE access_request.id = ? AND scope.organization_id = ? AND scope.owner_user_id = ? AND scope.conversation_id = ?
          `).get(record.id, record.organizationId, record.ownerUserId, record.conversationId))
        },
      },
      safety: {
        listQualifiedMessageIds: ({ organizationId, ownerUserId, conversationId, kind, confidenceThreshold }) => {
          const columns = kind === 'privacy'
            ? { detected: 'privacy_detected', confidence: 'privacy_confidence' }
            : kind === 'danger'
              ? { detected: 'danger_detected', confidence: 'danger_confidence' }
              : null
          if (!columns) throw new TypeError('qualified message kind must be privacy or danger')
          return database.prepare(`
            SELECT message.id
            FROM ai_messages AS message
            JOIN ai_conversations AS conversation
              ON conversation.organization_id = message.organization_id
             AND conversation.owner_user_id = message.actor_id_at_creation
             AND conversation.id = message.conversation_id
            WHERE conversation.organization_id = ? AND conversation.owner_user_id = ? AND conversation.id = ?
              AND message.organization_id = ? AND message.actor_id_at_creation = ? AND message.conversation_id = ?
              AND message.role = 'assistant' AND message.${columns.detected} = 1 AND message.${columns.confidence} >= ?
            ORDER BY message.created_at ASC, message.id ASC
          `).all(
            organizationId,
            ownerUserId,
            conversationId,
            organizationId,
            ownerUserId,
            conversationId,
            confidenceThreshold,
          ).map((row) => row.id)
        },
        createOrGetOpenReviewTask: (record) => {
          const placeholders = OPEN_REVIEW_STATUSES.map(() => '?').join(', ')
          const existing = database.prepare(`
            SELECT task.*, lease.lease_token, lease.lease_expires_at, lease.claimed_at
            FROM safety_review_tasks AS task
            LEFT JOIN safety_review_leases AS lease ON lease.review_task_id = task.id
            WHERE task.organization_id = ? AND task.actor_id_at_creation = ? AND task.conversation_id = ?
              AND task.status IN (${placeholders})
            ORDER BY task.created_at ASC
            LIMIT 1
          `).get(record.organizationId, record.actorIdAtCreation, record.conversationId, ...OPEN_REVIEW_STATUSES)
          if (existing) {
            const existingTask = mapReviewTask(existing)
            const mergedEvidenceMessageIds = uniqueStrings([...existingTask.evidenceMessageIds, ...record.evidenceMessageIds])
            const mergedTriggerReasons = mergeTriggerReasons(existingTask.triggerReasons, record.triggerReasons)
            const mergedDanger = mergeDangerSignals(existingTask.danger, record.danger)
            const updated = database.prepare(`
              UPDATE safety_review_tasks
              SET evidence_message_ids_json = ?, trigger_reasons_json = ?, danger_json = ?,
                  candidate_user_ids_json = ?, candidate_catalog_ids_json = ?,
                  updated_at = ?, version = version + 1
              WHERE id = ? AND organization_id = ? AND actor_id_at_creation = ? AND conversation_id = ?
            `).run(
              stringifyJson(mergedEvidenceMessageIds),
              stringifyJson(mergedTriggerReasons),
              stringifyJson(mergedDanger),
              stringifyJson(uniqueStrings([...existingTask.candidateUserIds, ...record.candidateUserIds])),
              stringifyJson(uniqueStrings([...existingTask.candidateCatalogIds, ...record.candidateCatalogIds])),
              record.updatedAt,
              existing.id,
              record.organizationId,
              record.actorIdAtCreation,
              record.conversationId,
            )
            if (changeCount(updated) !== 1) throw new Error('resource scope violation')
            upsertReviewEvidence({
              ...record,
              reviewTaskId: existing.id,
              evidenceMessageIds: mergedEvidenceMessageIds,
              triggerReasons: record.triggerReasons,
              currentMessageId: record.initialMessageId,
            })
            return {
              reviewTask: getReviewTask({
                reviewTaskId: existing.id,
                organizationId: record.organizationId,
                ownerUserId: record.actorIdAtCreation,
              }),
              created: false,
            }
          }
          database.prepare(`
            INSERT INTO safety_review_tasks (
              id, organization_id, organization_id_at_creation, actor_id_at_creation, conversation_id,
              initial_message_id, evidence_message_ids_json, trigger_reasons_json, privacy_json, danger_json,
              candidate_user_ids_json, candidate_catalog_ids_json, policy_snapshot_json, status,
              reason_code, due_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            record.id,
            record.organizationId,
            record.organizationIdAtCreation,
            record.actorIdAtCreation,
            record.conversationId,
            record.initialMessageId,
            stringifyJson(uniqueStrings(record.evidenceMessageIds)),
            stringifyJson(record.triggerReasons || []),
            stringifyJson(record.privacy || {}),
            stringifyJson(record.danger || {}),
            stringifyJson(uniqueStrings(record.candidateUserIds)),
            stringifyJson(uniqueStrings(record.candidateCatalogIds)),
            stringifyJson(record.policySnapshot || {}),
            record.status,
            record.reasonCode || null,
            record.dueAt || null,
            record.createdAt,
            record.updatedAt,
          )
          database.prepare(`
            INSERT INTO safety_review_evidence_state (
              review_task_id, organization_id, owner_user_id, conversation_id,
              evidence_generation, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 0, ?, ?)
          `).run(
            record.id,
            record.organizationId,
            record.actorIdAtCreation,
            record.conversationId,
            record.createdAt,
            record.updatedAt,
          )
          upsertReviewEvidence({
            ...record,
            reviewTaskId: record.id,
            currentMessageId: record.initialMessageId,
          })
          return {
            reviewTask: getReviewTask({
              reviewTaskId: record.id,
              organizationId: record.organizationId,
              ownerUserId: record.actorIdAtCreation,
            }),
            created: true,
          }
        },
        claimReviewTask: ({ reviewTaskId, organizationId, ownerUserId, leaseToken, claimedAt, leaseExpiresAt }) => {
          const task = getReviewTask({ reviewTaskId, organizationId, ownerUserId })
          if (!task) return { outcome: 'not_found' }
          const safetyEvent = getSafetyEvent({ reviewTaskId, organizationId, ownerUserId })
          if (safetyEvent || !CLAIMABLE_REVIEW_STATUSES.has(task.status)) {
            return {
              outcome: 'finalized',
              reviewTask: task,
              safetyEvent,
              status: safetyEvent?.status || task.status,
              notificationChain: safetyEvent?.notificationChain || [],
            }
          }
          const lease = database.prepare('SELECT * FROM safety_review_leases WHERE review_task_id = ?').get(reviewTaskId)
          if (lease?.status === 'claimed' && compareIso(lease.lease_expires_at, claimedAt) > 0) {
            return { outcome: 'busy', reviewTask: task }
          }
          if (lease) {
            database.prepare(`
              UPDATE safety_review_leases
              SET lease_token = ?, status = 'claimed', claimed_at = ?, lease_expires_at = ?, completed_at = NULL
              WHERE review_task_id = ?
            `).run(leaseToken, claimedAt, leaseExpiresAt, reviewTaskId)
          } else {
            database.prepare(`
              INSERT INTO safety_review_leases (
                review_task_id, lease_token, status, claimed_at, lease_expires_at
              ) VALUES (?, ?, 'claimed', ?, ?)
            `).run(reviewTaskId, leaseToken, claimedAt, leaseExpiresAt)
          }
          database.prepare(`
            UPDATE safety_review_tasks
            SET status = 'review_claimed', review_attempts = review_attempts + 1, updated_at = ?
            WHERE id = ? AND organization_id = ? AND actor_id_at_creation = ? AND conversation_id = ?
          `).run(claimedAt, reviewTaskId, organizationId, ownerUserId, task.conversationId)
          database.prepare(`
            INSERT INTO safety_review_attempts (
              lease_token, review_task_id, organization_id, owner_user_id, conversation_id,
              evidence_generation, status, claimed_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'claimed', ?, ?, ?)
          `).run(
            leaseToken,
            reviewTaskId,
            organizationId,
            ownerUserId,
            task.conversationId,
            task.evidenceGeneration,
            claimedAt,
            claimedAt,
            claimedAt,
          )
          return {
            outcome: 'claimed',
            reviewTask: getReviewTask({ reviewTaskId, organizationId, ownerUserId }),
            leaseToken,
          }
        },
        finalizeReview: ({ reviewTaskId, organizationId, ownerUserId, leaseToken, expectedEvidenceGeneration, status, reasonCode, evidenceMessageIds, implicatedCandidates, safetyEvent, updatedAt }) => {
          const task = getReviewTask({ reviewTaskId, organizationId, ownerUserId })
          if (!task) return { outcome: 'lease_lost', reviewTask: null }
          const existingEvent = getSafetyEvent({ reviewTaskId, organizationId, ownerUserId })
          if (existingEvent) {
            return {
              outcome: 'finalized',
              reviewTask: task,
              safetyEvent: existingEvent,
              status: existingEvent.status,
              notificationChain: existingEvent.notificationChain,
            }
          }
          const lease = database.prepare(`
            SELECT lease.*
            FROM safety_review_leases AS lease
            JOIN safety_review_tasks AS review_task ON review_task.id = lease.review_task_id
            WHERE lease.review_task_id = ? AND lease.lease_token = ? AND lease.status = 'claimed'
              AND review_task.organization_id = ? AND review_task.actor_id_at_creation = ?
              AND review_task.conversation_id = ?
          `).get(reviewTaskId, leaseToken, organizationId, ownerUserId, task.conversationId)
          if (!lease) return { outcome: 'lease_lost', reviewTask: task }
          if (task.evidenceGeneration !== expectedEvidenceGeneration) {
            const supersededAttempt = database.prepare(`
              UPDATE safety_review_attempts
              SET status = 'superseded', reason_code = 'REVIEW_EVIDENCE_SUPERSEDED',
                  completed_at = ?, updated_at = ?, version = version + 1
              WHERE lease_token = ? AND review_task_id = ?
                AND organization_id = ? AND owner_user_id = ? AND conversation_id = ?
                AND evidence_generation = ? AND status = 'claimed'
            `).run(
              updatedAt,
              updatedAt,
              leaseToken,
              reviewTaskId,
              organizationId,
              ownerUserId,
              task.conversationId,
              expectedEvidenceGeneration,
            )
            if (changeCount(supersededAttempt) !== 1) throw new Error('review attempt scope violation')
            database.prepare(`
              UPDATE safety_review_tasks
              SET status = 'pending_secondary_review', reason_code = 'REVIEW_EVIDENCE_SUPERSEDED',
                  updated_at = ?, version = version + 1
              WHERE id = ? AND organization_id = ? AND actor_id_at_creation = ? AND conversation_id = ?
            `).run(updatedAt, reviewTaskId, organizationId, ownerUserId, task.conversationId)
            database.prepare(`
              UPDATE safety_review_leases
              SET status = 'released', completed_at = ?, version = version + 1
              WHERE review_task_id = ? AND lease_token = ? AND status = 'claimed'
            `).run(updatedAt, reviewTaskId, leaseToken)
            return {
              outcome: 'superseded',
              reviewTask: getReviewTask({ reviewTaskId, organizationId, ownerUserId }),
              safetyEvent: null,
              status: 'review_superseded',
              notificationChain: [],
            }
          }
          if (!sameStringSet(evidenceMessageIds, task.evidenceMessageIds)) {
            throw new Error('review evidence must match the complete claimed generation')
          }
          database.prepare(`
            INSERT INTO safety_events (
              id, organization_id, organization_id_at_creation, actor_id_at_creation, review_task_id,
              status, reason_code, risk_level, summary_for_staff, notification_chain_json,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            safetyEvent.id,
            organizationId,
            organizationId,
            ownerUserId,
            reviewTaskId,
            status,
            reasonCode,
            safetyEvent.riskLevel,
            safetyEvent.summaryForStaff,
            stringifyJson(Array.isArray(safetyEvent.notificationChain) ? safetyEvent.notificationChain : []),
            safetyEvent.createdAt,
            safetyEvent.updatedAt,
          )
          const notificationRecipientUserIds = new Set()
          for (const handler of Array.isArray(safetyEvent.notificationChain) ? safetyEvent.notificationChain : []) {
            if (typeof handler?.userId !== 'string' || handler.userId.length === 0) continue
            if (notificationRecipientUserIds.has(handler.userId)) continue
            if (typeof handler.role !== 'string' || handler.role.length === 0) throw new Error('safety notification handler role is required')
            if (typeof handler.scopeType !== 'string' || handler.scopeType.length === 0) throw new Error('safety notification handler scope is required')
            notificationRecipientUserIds.add(handler.userId)
            const recipientId = `safety-notification-recipient:${safetyEvent.id}:${handler.userId}`
            const outboxId = enqueueOutboxEvent(database, {
              id: `safety-notification-outbox:${safetyEvent.id}:${handler.userId}`,
              topic: 'safety.notification.dispatch',
              aggregateType: 'safety_event',
              aggregateId: safetyEvent.id,
              payload: {
                organizationId,
                safetyEventId: safetyEvent.id,
                recipientUserId: handler.userId,
              },
              dedupeKey: `safety.notification.dispatch:${safetyEvent.id}:${handler.userId}`,
              createdAt: updatedAt,
            })
            database.prepare(`
              INSERT INTO safety_notification_recipients (
                id, organization_id, safety_event_id, user_id, role_code, scope_type, scope_id,
                status, outbox_event_id, planned_at, created_at, updated_at, version
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, 1)
            `).run(
              recipientId,
              organizationId,
              safetyEvent.id,
              handler.userId,
              handler.role,
              handler.scopeType,
              handler.scopeId || null,
              outboxId,
              updatedAt,
              updatedAt,
              updatedAt,
            )
          }
          for (const messageId of uniqueStrings(evidenceMessageIds)) {
            database.prepare(`
              INSERT OR IGNORE INTO safety_event_evidence (
                id, safety_event_id, ai_message_id, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?)
            `).run(`${safetyEvent.id}:${messageId}`, safetyEvent.id, messageId, updatedAt, updatedAt)
          }
          for (const candidate of Array.isArray(implicatedCandidates) ? implicatedCandidates : []) {
            if (typeof candidate?.candidateUserId !== 'string' || candidate.candidateUserId.length === 0) continue
            database.prepare(`
              INSERT OR IGNORE INTO safety_implicated_candidates (
                id, safety_event_id, review_task_id, candidate_user_id, confidence, reason,
                excluded_from_notification, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
            `).run(
              `${safetyEvent.id}:${candidate.candidateUserId}`,
              safetyEvent.id,
              reviewTaskId,
              candidate.candidateUserId,
              nonNegative(candidate.confidence, 'candidate confidence'),
              candidate.reason || null,
              updatedAt,
              updatedAt,
            )
          }
          database.prepare(`
            UPDATE safety_review_tasks SET status = ?, reason_code = ?, updated_at = ?, version = version + 1
            WHERE id = ? AND organization_id = ? AND actor_id_at_creation = ? AND conversation_id = ?
          `).run(status, reasonCode, updatedAt, reviewTaskId, organizationId, ownerUserId, task.conversationId)
          database.prepare(`
            UPDATE safety_review_leases
            SET status = 'completed', completed_at = ?, version = version + 1
            WHERE review_task_id = ? AND lease_token = ? AND status = 'claimed'
          `).run(updatedAt, reviewTaskId, leaseToken)
          const finalizedAttempt = database.prepare(`
            UPDATE safety_review_attempts
            SET status = 'finalized', reason_code = ?, completed_at = ?, updated_at = ?, version = version + 1
            WHERE lease_token = ? AND review_task_id = ?
              AND organization_id = ? AND owner_user_id = ? AND conversation_id = ?
              AND evidence_generation = ? AND status = 'claimed'
          `).run(
            reasonCode,
            updatedAt,
            updatedAt,
            leaseToken,
            reviewTaskId,
            organizationId,
            ownerUserId,
            task.conversationId,
            expectedEvidenceGeneration,
          )
          if (changeCount(finalizedAttempt) !== 1) throw new Error('review attempt scope violation')
          const finalizedEvent = getSafetyEvent({ reviewTaskId, organizationId, ownerUserId })
          return {
            outcome: 'finalized',
            reviewTask: getReviewTask({ reviewTaskId, organizationId, ownerUserId }),
            safetyEvent: finalizedEvent,
            status: finalizedEvent.status,
            notificationChain: finalizedEvent.notificationChain,
          }
        },
      },
    }
  }

  function transaction(callback) {
    database.exec('BEGIN IMMEDIATE')
    try {
      const result = callback(transactionPort())
      if (isPromiseLike(result)) throw new TypeError('SQLite transaction callback must be synchronous')
      database.exec('COMMIT')
      return result
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  return {
    transaction,
    reading: {
      getValidReadScope: (input) => readScopeProvider(input),
    },
    ai: {
      hasConversationAccess,
      findEvidenceBlocks: (input) => evidenceBlockProvider(input),
      findMemoryCards: ({ organizationId, ownerUserId, bookVersionId }) => database.prepare(`
        SELECT * FROM book_memory_cards
        WHERE organization_id_at_creation = ? AND actor_id_at_creation = ? AND book_version_id = ? AND status = 'ready'
        ORDER BY page_range_start ASC, id ASC
      `).all(organizationId, ownerUserId, bookVersionId).map((row) => ({
        id: row.id,
        bookVersionId: row.book_version_id,
        sourceEvidenceIds: uniqueStrings(parseJson(row.source_evidence_ids_json, [])),
        sourcePageIds: uniqueStrings(parseJson(row.source_page_ids_json, [])),
        pageRangeStart: row.page_range_start,
        pageRangeEnd: row.page_range_end,
        content: row.content,
        sequence: row.page_range_start ?? 0,
      })),
      findRecentConversationMessages: ({ organizationId, ownerUserId, conversationId, limit }) => database.prepare(`
        SELECT message.id, message.role, message.content, message.created_at
        FROM ai_messages AS message
        JOIN ai_conversations AS conversation
          ON conversation.organization_id = message.organization_id
         AND conversation.owner_user_id = message.actor_id_at_creation
         AND conversation.id = message.conversation_id
        WHERE conversation.organization_id = ? AND conversation.owner_user_id = ? AND conversation.id = ?
          AND message.organization_id = ? AND message.actor_id_at_creation = ? AND message.conversation_id = ?
        ORDER BY message.created_at DESC, message.id DESC
        LIMIT ?
      `).all(
        organizationId,
        ownerUserId,
        conversationId,
        organizationId,
        ownerUserId,
        conversationId,
        Math.max(0, Number(limit) || 0),
      ).reverse().map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        createdAt: row.created_at,
      })),
    },
    safety: {
      getReviewTask: ({ reviewTaskId, organizationId, ownerUserId }) => getReviewTask({ reviewTaskId, organizationId, ownerUserId }),
      getReviewContext: ({ reviewTaskId, organizationId, ownerUserId, expectedEvidenceGeneration }) => {
        const task = getReviewTask({ reviewTaskId, organizationId, ownerUserId })
        if (!task) return null
        if (expectedEvidenceGeneration !== undefined && task.evidenceGeneration !== expectedEvidenceGeneration) {
          return {
            outcome: 'superseded',
            reviewTaskId,
            evidenceGeneration: task.evidenceGeneration,
            evidenceMessageIds: task.evidenceMessageIds,
            messages: [],
          }
        }
        const messages = []
        for (const assistantMessageId of task?.evidenceMessageIds || []) {
          const scopedMessages = database.prepare(`
            SELECT user_message.id AS user_id, user_message.role AS user_role, user_message.content AS user_content,
                   assistant_message.id AS assistant_id, assistant_message.role AS assistant_role,
                   assistant_message.content AS assistant_content
            FROM ai_messages AS assistant_message
            LEFT JOIN ai_message_request_links AS link ON link.assistant_message_id = assistant_message.id
            LEFT JOIN ai_messages AS user_message
              ON user_message.id = link.user_message_id
             AND user_message.organization_id = ?
             AND user_message.actor_id_at_creation = ?
             AND user_message.conversation_id = ?
            WHERE assistant_message.id = ?
              AND assistant_message.organization_id = ?
              AND assistant_message.actor_id_at_creation = ?
              AND assistant_message.conversation_id = ?
              AND assistant_message.role = 'assistant'
          `).get(
            organizationId,
            ownerUserId,
            task.conversationId,
            assistantMessageId,
            organizationId,
            ownerUserId,
            task.conversationId,
          )
          const userMessage = scopedMessages?.user_id
            ? { id: scopedMessages.user_id, role: scopedMessages.user_role, content: scopedMessages.user_content }
            : null
          const assistantMessage = scopedMessages
            ? { id: scopedMessages.assistant_id, role: scopedMessages.assistant_role, content: scopedMessages.assistant_content }
            : null
          if (userMessage) messages.push({ id: userMessage.id, role: userMessage.role, content: userMessage.content })
          if (assistantMessage) messages.push({ id: assistantMessage.id, role: assistantMessage.role, content: assistantMessage.content })
        }
        const latestTask = getReviewTask({ reviewTaskId, organizationId, ownerUserId })
        if (!latestTask || latestTask.evidenceGeneration !== task.evidenceGeneration) {
          return {
            outcome: 'superseded',
            reviewTaskId,
            evidenceGeneration: latestTask?.evidenceGeneration ?? null,
            evidenceMessageIds: latestTask?.evidenceMessageIds || [],
            messages: [],
          }
        }
        const requiredEvidenceIds = new Set((task.evidenceMessageIds || []).filter(Boolean))
        const availableAssistantIds = new Set(messages
          .filter((message) => message.role === 'assistant')
          .map((message) => message.id))
        if (![...requiredEvidenceIds].every((messageId) => availableAssistantIds.has(messageId))) {
          const error = new Error('secondary review context is missing an evidence assistant message')
          error.code = 'SECONDARY_REVIEW_CONTEXT_UNAVAILABLE'
          throw error
        }
        return {
          outcome: 'stable',
          reviewTaskId,
          evidenceGeneration: task.evidenceGeneration,
          evidenceMessageIds: task.evidenceMessageIds || [],
          privacy: task?.privacy || null,
          danger: task?.danger || null,
          messages,
        }
      },
    },
  }
}
