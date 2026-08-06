import { randomUUID } from 'node:crypto'
import { DEFAULT_SAFETY_POLICY, resolveSafetyPolicy, usesImmediateSafetyBypass } from './policy.js'

const REVIEW_RESULTS = new Set(['confirmed', 'likely', 'false_positive', 'uncertain'])
const RISK_LEVELS = new Set(['none', 'low', 'medium', 'high', 'critical'])
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/

export class SafetyDomainError extends Error {
  constructor(code, message, options = {}) {
    super(message)
    this.name = 'SafetyDomainError'
    this.code = code
    this.retryable = Boolean(options.retryable)
  }
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function stableId(value) {
  const normalized = stringValue(value)
  return STABLE_ID_PATTERN.test(normalized) ? normalized : null
}

function requiredId(value, field) {
  const normalized = stableId(value)
  if (!normalized) throw new SafetyDomainError('INVALID_REQUEST', `${field} must be a stable identifier`)
  return normalized
}

function uniqueStableIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(stableId).filter(Boolean))]
}

function finiteConfidence(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new SafetyDomainError('INVALID_REVIEW_OUTPUT', `${field} must be between 0 and 1`)
  }
  return value
}

function normalizedChainEntry(entry) {
  const userId = stableId(entry?.userId ?? entry?.user_id)
  if (!userId) return null
  return {
    userId,
    role: stringValue(entry.role) || null,
    scopeType: stringValue(entry.scopeType ?? entry.scope_type) || null,
    scopeId: stringValue(entry.scopeId ?? entry.scope_id) || null,
  }
}

function isPotentialDirectTeacher(handler) {
  return ['class-teacher', 'class_teacher', 'teacher', 'homeroom-teacher'].includes(handler.role)
}

function normalizeReviewOutput(raw, candidateIds, allowedEvidenceMessageIds) {
  const reviewResult = stringValue(raw?.review_result)
  const riskLevel = stringValue(raw?.risk_level)
  if (!REVIEW_RESULTS.has(reviewResult) || !RISK_LEVELS.has(riskLevel)) {
    throw new SafetyDomainError('INVALID_REVIEW_OUTPUT', 'secondary review has an invalid result or risk level')
  }
  if (!Array.isArray(raw?.evidence_message_ids) || !Array.isArray(raw?.implicated_candidates)) {
    throw new SafetyDomainError('INVALID_REVIEW_OUTPUT', 'secondary review must return evidence and candidates arrays')
  }
  if (typeof raw?.unknown_implicated_person !== 'boolean' || typeof raw?.requires_human_review !== 'boolean') {
    throw new SafetyDomainError('INVALID_REVIEW_OUTPUT', 'secondary review must return boolean safeguards')
  }

  const evidenceMessageIds = uniqueStableIds(raw.evidence_message_ids)
  if (evidenceMessageIds.length === 0) {
    throw new SafetyDomainError('INVALID_REVIEW_OUTPUT', 'secondary review must retain at least one evidence message')
  }
  if (!evidenceMessageIds.every((messageId) => allowedEvidenceMessageIds.has(messageId))) {
    throw new SafetyDomainError('INVALID_REVIEW_OUTPUT', 'secondary review selected evidence outside the task context')
  }
  if (evidenceMessageIds.length !== allowedEvidenceMessageIds.size) {
    throw new SafetyDomainError('INVALID_REVIEW_OUTPUT', 'secondary review must retain the complete stable evidence generation')
  }

  const summaryForStaff = stringValue(raw.summary_for_staff)
  if ((reviewResult === 'confirmed' || reviewResult === 'likely') && !summaryForStaff) {
    throw new SafetyDomainError('INVALID_REVIEW_OUTPUT', 'confirmed or likely review requires a staff summary')
  }

  const candidatesByUserId = new Map()
  for (const candidate of raw.implicated_candidates) {
    const candidateUserId = stableId(candidate?.candidate_user_id)
    if (!candidateUserId || !candidateIds.has(candidateUserId)) {
      throw new SafetyDomainError('INVALID_REVIEW_OUTPUT', 'secondary review selected an unknown candidate user')
    }
    const normalized = {
      candidateUserId,
      confidence: finiteConfidence(candidate.confidence, 'candidate confidence'),
      reason: stringValue(candidate.reason),
    }
    const existing = candidatesByUserId.get(candidateUserId)
    if (!existing || normalized.confidence > existing.confidence) {
      candidatesByUserId.set(candidateUserId, normalized)
    }
  }

  return {
    reviewResult,
    riskLevel,
    evidenceMessageIds,
    summaryForStaff,
    implicatedCandidates: [...candidatesByUserId.values()],
    unknownImplicatedPerson: raw.unknown_implicated_person,
    requiresHumanReview: raw.requires_human_review,
  }
}

function normalizeSignal(signal, kind) {
  if (!signal || typeof signal.detected !== 'boolean' || typeof signal.confidence !== 'number') {
    throw new SafetyDomainError('INVALID_CLASSIFICATION', `${kind} classification is incomplete`)
  }
  if (!Number.isFinite(signal.confidence) || signal.confidence < 0 || signal.confidence > 1) {
    throw new SafetyDomainError('INVALID_CLASSIFICATION', `${kind} confidence must be between 0 and 1`)
  }
  return signal
}

function nowIso(clock) {
  const value = clock()
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function futureIso(clock, durationMs) {
  const value = clock()
  const date = value instanceof Date ? value : new Date(value)
  return new Date(date.getTime() + durationMs).toISOString()
}

function scopedAuthContext(authContext) {
  return {
    organizationId: requiredId(authContext?.organizationId, 'authContext.organizationId'),
    requesterUserId: requiredId(authContext?.userId, 'authContext.userId'),
    ownerUserId: requiredId(authContext?.ownerUserId, 'authContext.ownerUserId'),
  }
}

function resultFromFinalization(finalization, reviewTask) {
  const safetyEvent = finalization?.safetyEvent || null
  return {
    safetyEvent,
    status: finalization?.status || safetyEvent?.status || reviewTask.status,
    notificationChain: finalization?.notificationChain || safetyEvent?.notificationChain || [],
    reviewTask: finalization?.reviewTask || reviewTask,
  }
}

export function createSafetyService({
  db,
  organizationCandidateResolver,
  policy = DEFAULT_SAFETY_POLICY,
  idFactory = () => randomUUID(),
  clock = () => new Date(),
}) {
  if (typeof db?.transaction !== 'function' || typeof db?.safety?.getReviewTask !== 'function' || typeof db?.safety?.getReviewContext !== 'function') {
    throw new TypeError('db must provide transaction, safety.getReviewTask, and safety.getReviewContext')
  }
  if (typeof organizationCandidateResolver?.listCandidates !== 'function') {
    throw new TypeError('organizationCandidateResolver.listCandidates is required')
  }

  async function listCandidateCatalog(context) {
    const candidates = await organizationCandidateResolver.listCandidates(context)
    const catalog = []
    const seen = new Set()
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      const candidateUserId = stringValue(candidate?.candidateUserId ?? candidate?.candidate_user_id ?? candidate?.stableAccountId)
      if (!candidateUserId || seen.has(candidateUserId)) continue
      seen.add(candidateUserId)
      catalog.push({
        candidateUserId,
        stableAccountId: candidateUserId,
        displayName: stringValue(candidate?.displayName) || null,
        aliases: uniqueStableIds(candidate?.aliases || []),
        role: stringValue(candidate?.role) || null,
        classRelation: stringValue(candidate?.classRelation) || null,
      })
    }
    return catalog
  }

  async function listCandidateIds(context) {
    return (await listCandidateCatalog(context)).map((candidate) => candidate.candidateUserId)
  }

  function evaluateResponse({
    tx,
    organizationId,
    conversationId,
    actorUserId,
    privacy,
    danger,
    candidateUserIds = [],
    candidateCatalogIds,
  }) {
    if (typeof tx?.safety?.listQualifiedMessageIds !== 'function') {
      throw new TypeError('transaction must provide safety.listQualifiedMessageIds')
    }
    const normalizedPrivacy = normalizeSignal(privacy, 'privacy')
    const normalizedDanger = normalizeSignal(danger, 'danger')
    const activePolicy = resolveSafetyPolicy(policy, { organizationId, conversationId, actorUserId })
    if (!Array.isArray(candidateCatalogIds)) {
      throw new SafetyDomainError('CANDIDATE_CATALOG_REQUIRED', 'candidate catalog must be resolved before entering a transaction')
    }
    const permittedCandidates = new Set(candidateCatalogIds)
    const selectedCandidates = uniqueStableIds(candidateUserIds)
    if (!selectedCandidates.every((candidateUserId) => permittedCandidates.has(candidateUserId))) {
      throw new SafetyDomainError('INVALID_CANDIDATE_ID', 'model selected a candidate outside the backend candidate table')
    }

    function historicalQualifiedIds(kind) {
      return uniqueStableIds(tx.safety.listQualifiedMessageIds({
        organizationId,
        ownerUserId: actorUserId,
        conversationId,
        kind,
        confidenceThreshold: activePolicy.confidenceThreshold,
      }))
    }

    const privacyQualifies = normalizedPrivacy.detected && normalizedPrivacy.confidence >= activePolicy.confidenceThreshold
    const privacyHistoricalMessageIds = privacyQualifies ? historicalQualifiedIds('privacy') : []
    const privacyQualifiedMessageCount = privacyQualifies ? privacyHistoricalMessageIds.length + 1 : 0

    const dangerQualifies = normalizedDanger.detected && normalizedDanger.confidence >= activePolicy.confidenceThreshold
    const immediateDanger = usesImmediateSafetyBypass(normalizedDanger)
    const dangerHistoricalMessageIds = dangerQualifies || immediateDanger ? historicalQualifiedIds('danger') : []
    const dangerQualifiedMessageCount = dangerQualifies ? dangerHistoricalMessageIds.length + 1 : 0
    const dangerTriggers = []
    if (dangerQualifies && dangerQualifiedMessageCount >= activePolicy.requiredQualifiedMessages) {
      dangerTriggers.push({ kind: 'danger', reason: 'qualified_message_count', qualifiedMessageCount: dangerQualifiedMessageCount })
    }
    if (immediateDanger) {
      dangerTriggers.push({ kind: 'danger', reason: 'immediate_secondary_review', qualifiedMessageCount: null })
    }

    return {
      privacy: normalizedPrivacy,
      danger: normalizedDanger,
      candidateUserIds: selectedCandidates,
      candidateCatalogIds: [...permittedCandidates],
      policySnapshot: activePolicy,
      privacyAccessRequired: privacyQualifies && privacyQualifiedMessageCount >= activePolicy.requiredQualifiedMessages,
      privacyHistoricalMessageIds,
      privacyQualifiedMessageCount,
      dangerReviewRequired: dangerTriggers.length > 0,
      dangerHistoricalMessageIds,
      dangerQualifiedMessageCount,
      dangerTriggers,
      evaluatedAt: nowIso(clock),
    }
  }

  function persistResponse(tx, { assessment, organizationId, conversationId, actorUserId, assistantMessageId }) {
    let privacyState = null
    if (assessment.privacyAccessRequired) {
      if (typeof tx?.privacy?.markConversationPrivate !== 'function') {
        throw new TypeError('transaction must provide privacy.markConversationPrivate')
      }
      privacyState = tx.privacy.markConversationPrivate({
        organizationId,
        conversationId,
        actorUserId,
        ownerUserId: actorUserId,
        sourceMessageId: assistantMessageId,
        qualifiedMessageIds: uniqueStableIds([...assessment.privacyHistoricalMessageIds, assistantMessageId]),
        reasonCode: 'PRIVACY_QUALIFIED_MESSAGE_COUNT',
        updatedAt: nowIso(clock),
      })
    }

    let reviewTask = null
    if (assessment.dangerReviewRequired) {
      if (typeof tx?.safety?.createOrGetOpenReviewTask !== 'function') {
        throw new TypeError('transaction must provide safety.createOrGetOpenReviewTask')
      }
      const evidenceMessageIds = uniqueStableIds([...assessment.dangerHistoricalMessageIds, assistantMessageId])
      const taskResult = tx.safety.createOrGetOpenReviewTask({
        id: idFactory(),
        organizationId,
        organizationIdAtCreation: organizationId,
        conversationId,
        actorUserId,
        actorIdAtCreation: actorUserId,
        initialMessageId: assistantMessageId,
        evidenceMessageIds,
        status: 'pending_secondary_review',
        triggerReasons: assessment.dangerTriggers,
        privacy: assessment.privacy,
        danger: assessment.danger,
        candidateUserIds: assessment.candidateUserIds,
        candidateCatalogIds: assessment.candidateCatalogIds,
        policySnapshot: assessment.policySnapshot,
        createdAt: nowIso(clock),
        updatedAt: nowIso(clock),
      })
      reviewTask = taskResult?.reviewTask || taskResult || null
    }
    return { privacyState, reviewTask }
  }

  async function recordManualDemoEvidence({ authContext, request }) {
    const { organizationId, requesterUserId, ownerUserId } = scopedAuthContext(authContext)
    if (requesterUserId !== ownerUserId) {
      throw new SafetyDomainError('PERMISSION_DENIED', 'manual demo evidence must be recorded by the conversation owner')
    }
    const conversationId = requiredId(request?.conversationId, 'request.conversationId')
    const userMessage = stringValue(request?.userMessage)
    if (!userMessage) throw new SafetyDomainError('INVALID_REQUEST', 'request.userMessage is required')
    const candidateCatalog = await listCandidateCatalog({
      organizationId,
      conversationId,
      actorUserId: ownerUserId,
    })
    const candidateCatalogIds = candidateCatalog.map((candidate) => candidate.candidateUserId)
    const candidateUserIds = uniqueStableIds(request?.candidateUserIds)
    const createdAt = nowIso(clock)
    return db.transaction((tx) => {
      if (typeof tx?.ai?.assertConversationAccess !== 'function' || !tx.ai.assertConversationAccess({
        organizationId,
        ownerUserId,
        conversationId,
      })) {
        throw new SafetyDomainError('RESOURCE_NOT_FOUND', 'resource not found')
      }
      if (typeof tx?.ai?.insertMessage !== 'function') {
        throw new TypeError('transaction must provide ai.insertMessage')
      }
      const assessment = evaluateResponse({
        tx,
        organizationId,
        conversationId,
        actorUserId: ownerUserId,
        privacy: request?.privacy,
        danger: { ...request?.danger, source: 'manual_demo_test' },
        candidateUserIds,
        candidateCatalogIds,
      })
      assessment.dangerTriggers = assessment.dangerTriggers.map((trigger) => ({
        ...trigger,
        source: 'manual_demo_test',
      }))
      const userMessageId = idFactory()
      const assistantMessageId = idFactory()
      tx.ai.insertMessage({
        id: userMessageId,
        conversationId,
        organizationId,
        organizationIdAtCreation: organizationId,
        actorUserId: ownerUserId,
        actorIdAtCreation: ownerUserId,
        role: 'user',
        content: userMessage,
        requestId: null,
        responseType: null,
        modelCandidateId: null,
        privacy: null,
        danger: null,
        providerAttempts: [],
        safeDegradation: false,
        createdAt,
        updatedAt: createdAt,
      })
      tx.ai.insertMessage({
        id: assistantMessageId,
        conversationId,
        organizationId,
        organizationIdAtCreation: organizationId,
        actorUserId: ownerUserId,
        actorIdAtCreation: ownerUserId,
        role: 'assistant',
        content: '这条内容已作为受控演示证据记录，系统将继续按学校安全规则处理。',
        requestId: null,
        responseType: 'guidance',
        modelCandidateId: null,
        privacy: assessment.privacy,
        danger: assessment.danger,
        providerAttempts: [],
        safeDegradation: false,
        createdAt,
        updatedAt: createdAt,
      })
      const safety = persistResponse(tx, {
        assessment,
        organizationId,
        conversationId,
        actorUserId: ownerUserId,
        userMessageId,
        assistantMessageId,
      })
      return {
        source: 'manual_demo_test',
        conversationId,
        userMessageId,
        assistantMessageId,
        reviewTaskId: safety.reviewTask?.id || null,
        safetyEvent: null,
        threshold: assessment.policySnapshot.confidenceThreshold,
        requiredQualifiedMessages: assessment.policySnapshot.requiredQualifiedMessages,
        qualifyingMessageCount: assessment.dangerQualifiedMessageCount,
        danger: assessment.danger,
      }
    })
  }

  async function createPrivacyAccessRequest({ authContext, request }) {
    const { organizationId, requesterUserId, ownerUserId } = scopedAuthContext(authContext)
    const conversationId = requiredId(request?.conversationId, 'request.conversationId')
    const purpose = stringValue(request?.purpose)
    if (!purpose) throw new SafetyDomainError('INVALID_REQUEST', 'request.purpose is required')
    return db.transaction((tx) => {
      if (typeof tx?.privacy?.createAccessRequest !== 'function') {
        throw new TypeError('transaction must provide privacy.createAccessRequest')
      }
      const accessRequest = tx.privacy.createAccessRequest({
        id: idFactory(),
        organizationId,
        ownerUserId,
        organizationIdAtCreation: organizationId,
        actorIdAtCreation: requesterUserId,
        conversationId,
        requesterUserId,
        status: 'pending',
        purpose,
        createdAt: nowIso(clock),
        updatedAt: nowIso(clock),
      })
      if (!accessRequest) throw new SafetyDomainError('RESOURCE_NOT_FOUND', 'resource not found')
      return accessRequest
    })
  }

  async function finalizeReview({ task, leaseToken, status, reasonCode, riskLevel = null, summaryForStaff = null, notificationChain = [], evidenceMessageIds, implicatedCandidates = [] }) {
    return db.transaction((tx) => {
      if (typeof tx?.safety?.finalizeReview !== 'function') {
        throw new TypeError('transaction must provide safety.finalizeReview')
      }
      const createdAt = nowIso(clock)
      const finalization = tx.safety.finalizeReview({
        reviewTaskId: task.id,
        organizationId: task.organizationId,
        ownerUserId: task.actorUserId,
        leaseToken,
        expectedEvidenceGeneration: task.evidenceGeneration,
        status,
        reasonCode,
        evidenceMessageIds: uniqueStableIds(evidenceMessageIds),
        implicatedCandidates,
        safetyEvent: {
          id: idFactory(),
          organizationId: task.organizationId,
          organizationIdAtCreation: task.organizationId,
          actorIdAtCreation: task.actorUserId,
          reviewTaskId: task.id,
          status,
          reasonCode,
          riskLevel,
          summaryForStaff,
          notificationChain,
          createdAt,
          updatedAt: createdAt,
        },
        updatedAt: createdAt,
      })
      if (finalization?.outcome === 'lease_lost') {
        return { status: 'review_in_progress', reviewTask: finalization.reviewTask || task, notificationChain: [] }
      }
      return resultFromFinalization(finalization, task)
    })
  }

  async function persistPendingHumanConfirmation(task, leaseToken, reasonCode) {
    return finalizeReview({
      task,
      leaseToken,
      status: 'pending_human_confirmation',
      reasonCode,
      evidenceMessageIds: task.evidenceMessageIds || [],
    })
  }

  async function runSecondaryReview({ authContext, reviewTaskId, reviewProvider }) {
    if (typeof reviewProvider?.review !== 'function') {
      throw new TypeError('reviewProvider.review is required')
    }
    const { organizationId, ownerUserId } = scopedAuthContext(authContext)
    const requestedTask = await db.safety.getReviewTask({ reviewTaskId, organizationId, ownerUserId })
    if (!requestedTask) {
      throw new SafetyDomainError('RESOURCE_NOT_FOUND', 'resource not found')
    }
    const activePolicy = resolveSafetyPolicy(policy, {
      organizationId: requestedTask.organizationId,
      conversationId: requestedTask.conversationId,
      actorUserId: requestedTask.actorUserId,
    })
    const claim = await db.transaction((tx) => {
      if (typeof tx?.safety?.claimReviewTask !== 'function') {
        throw new TypeError('transaction must provide safety.claimReviewTask')
      }
      return tx.safety.claimReviewTask({
        reviewTaskId,
        organizationId,
        ownerUserId,
        leaseToken: idFactory(),
        claimedAt: nowIso(clock),
        leaseExpiresAt: futureIso(clock, activePolicy.reviewLeaseMs),
      })
    })
    if (claim?.outcome === 'not_found') {
      throw new SafetyDomainError('RESOURCE_NOT_FOUND', 'resource not found')
    }
    if (claim?.outcome === 'busy') {
      return { status: 'review_in_progress', reviewTask: claim.reviewTask }
    }
    if (claim?.outcome === 'finalized') {
      return resultFromFinalization(claim, claim.reviewTask || requestedTask)
    }
    if (claim?.outcome !== 'claimed') {
      throw new SafetyDomainError('REVIEW_CLAIM_FAILED', 'secondary review claim did not return an owned lease', { retryable: true })
    }
    const task = claim.reviewTask

    let candidateIds
    let reviewContext
    try {
      ;[candidateIds, reviewContext] = await Promise.all([
        listCandidateIds({ organizationId: task.organizationId, conversationId: task.conversationId, actorUserId: task.actorUserId }),
        db.safety.getReviewContext({
          reviewTaskId,
          organizationId,
          ownerUserId,
          expectedEvidenceGeneration: task.evidenceGeneration,
        }),
      ])
    } catch {
      return persistPendingHumanConfirmation(task, claim.leaseToken, 'SECONDARY_REVIEW_CONTEXT_UNAVAILABLE')
    }
    if (!reviewContext || reviewContext.outcome === 'superseded') {
      return persistPendingHumanConfirmation(task, claim.leaseToken, 'REVIEW_EVIDENCE_SUPERSEDED')
    }

    let parsedReview
    try {
      const rawReview = await reviewProvider.review({
        reviewTaskId,
        context: reviewContext,
        candidateUserIds: candidateIds,
      })
      parsedReview = normalizeReviewOutput(rawReview, new Set(candidateIds), new Set(reviewContext.evidenceMessageIds || []))
    } catch (error) {
      const reasonCode = error instanceof SafetyDomainError ? 'SECONDARY_REVIEW_PARSE_FAILED' : 'SECONDARY_REVIEW_UNAVAILABLE'
      return persistPendingHumanConfirmation(task, claim.leaseToken, reasonCode)
    }

    let notificationChain = []
    if (parsedReview.reviewResult !== 'false_positive') {
      if (typeof organizationCandidateResolver.resolveNotificationChain !== 'function') {
        return persistPendingHumanConfirmation(task, claim.leaseToken, 'NOTIFICATION_CHAIN_UNAVAILABLE')
      }
      try {
        const implicatedCandidateUserIds = parsedReview.implicatedCandidates.map((candidate) => candidate.candidateUserId)
        const rawChain = await organizationCandidateResolver.resolveNotificationChain({
          organizationId: task.organizationId,
          actorUserId: task.actorUserId,
          conversationId: task.conversationId,
          implicatedCandidateUserIds,
          excludeUserIds: uniqueStableIds([task.actorUserId, ...implicatedCandidateUserIds]),
          skipPotentialDirectTeacher: parsedReview.unknownImplicatedPerson,
        })
        const excluded = new Set(uniqueStableIds([task.actorUserId, ...implicatedCandidateUserIds]))
        notificationChain = (Array.isArray(rawChain) ? rawChain : [])
          .map(normalizedChainEntry)
          .filter(Boolean)
          .filter((handler) => !excluded.has(handler.userId))
          .filter((handler) => !parsedReview.unknownImplicatedPerson || !isPotentialDirectTeacher(handler))
      } catch {
        return persistPendingHumanConfirmation(task, claim.leaseToken, 'NOTIFICATION_CHAIN_UNAVAILABLE')
      }
    }

    const requiresHumanConfirmation =
      parsedReview.reviewResult === 'uncertain' ||
      parsedReview.requiresHumanReview ||
      parsedReview.unknownImplicatedPerson ||
      (parsedReview.reviewResult !== 'false_positive' && notificationChain.length === 0)
    const status =
      parsedReview.reviewResult === 'false_positive' && !requiresHumanConfirmation
        ? 'false_positive_closed'
        : requiresHumanConfirmation
          ? 'pending_human_confirmation'
          : 'awaiting_human_acceptance'
    return finalizeReview({
      task,
      leaseToken: claim.leaseToken,
      status,
      reasonCode: `SECONDARY_REVIEW_${parsedReview.reviewResult.toUpperCase()}`,
      riskLevel: parsedReview.riskLevel,
      summaryForStaff: parsedReview.summaryForStaff || null,
      notificationChain,
      evidenceMessageIds: reviewContext.evidenceMessageIds,
      implicatedCandidates: parsedReview.implicatedCandidates,
    })
  }

  return {
    listCandidateCatalog,
    listCandidateIds,
    evaluateResponse,
    persistResponse,
    recordManualDemoEvidence,
    createPrivacyAccessRequest,
    runSecondaryReview,
  }
}
