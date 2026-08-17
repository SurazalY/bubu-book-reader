import { randomUUID } from 'node:crypto'
import { DEFAULT_AI_POLICY, resolveAiPolicy } from './policy.js'
import { selectReadableSources, toModelSources, validateCitations } from './retrieval.js'

const RESPONSE_TYPES = new Set(['answer', 'guidance', 'insufficient_evidence', 'off_topic'])
const SAFE_SPOILER_DEGRADATION = '我只会依据你已经读到的内容陪你分析。现在缺少可以安全引用的原文，我们先看看这一页或你选中的句子吧。'
const IDENTITY_FIELDS = new Set(['organizationId', 'userId', 'workspaceId'])

export class AiDomainError extends Error {
  constructor(code, message, options = {}) {
    super(message)
    this.name = 'AiDomainError'
    this.code = code
    this.retryable = Boolean(options.retryable)
    this.details = options.details || null
  }
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function requiredString(value, name) {
  const normalized = stringValue(value)
  if (!normalized) throw new AiDomainError('INVALID_REQUEST', `${name} is required`)
  return normalized
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(stringValue).filter(Boolean))]
}

function timestamp(clock) {
  const value = clock()
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function futureTimestamp(clock, durationMs) {
  const value = clock()
  const date = value instanceof Date ? value : new Date(value)
  return new Date(date.getTime() + durationMs).toISOString()
}

function hasOwn(object, key) {
  return Boolean(object && Object.prototype.hasOwnProperty.call(object, key))
}

function normalizeUsage(rawUsage) {
  const usage = rawUsage || {}
  const inputTokens = Number(usage.inputTokens ?? usage.prompt_tokens)
  const outputTokens = Number(usage.outputTokens ?? usage.completion_tokens)
  const cachedTokens = Number(usage.cachedTokens ?? usage.cached_tokens ?? 0)
  const costMicros = Number(usage.costMicros ?? usage.cost_micros)
  const values = [inputTokens, outputTokens, cachedTokens, costMicros]
  if (!values.every((value) => Number.isFinite(value) && value >= 0)) {
    throw new AiDomainError('INVALID_MODEL_RESPONSE', 'model response must include non-negative usage values')
  }
  return { inputTokens, outputTokens, cachedTokens, costMicros }
}

function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, costMicros: 0 }
}

function optionalUsage(rawUsage) {
  return rawUsage === undefined || rawUsage === null ? emptyUsage() : normalizeUsage(rawUsage)
}

function addUsage(total, usage) {
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    cachedTokens: total.cachedTokens + usage.cachedTokens,
    costMicros: total.costMicros + usage.costMicros,
  }
}

function normalizeSignal(raw, kind) {
  if (!raw || typeof raw.detected !== 'boolean' || typeof raw.confidence !== 'number') {
    throw new AiDomainError('INVALID_MODEL_RESPONSE', `${kind} classification is incomplete`)
  }
  if (!Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) {
    throw new AiDomainError('INVALID_MODEL_RESPONSE', `${kind} confidence must be between 0 and 1`)
  }
  return {
    detected: raw.detected,
    confidence: raw.confidence,
    category: stringValue(raw.category) || 'none',
    urgency: stringValue(raw.urgency) || 'none',
    explicitSelfHarmPlan: Boolean(raw.explicitSelfHarmPlan),
    explicitSelfHarmTime: Boolean(raw.explicitSelfHarmTime),
    explicitSelfHarmMeans: Boolean(raw.explicitSelfHarmMeans),
    extremeRisk: Boolean(raw.extremeRisk),
  }
}

function normalizeModelResponse(raw, allowedCandidateIds, usage) {
  const answer = stringValue(raw?.answer)
  const responseType = stringValue(raw?.responseType)
  if (!answer || !RESPONSE_TYPES.has(responseType)) {
    throw new AiDomainError('INVALID_MODEL_RESPONSE', 'model response has no accepted answer type')
  }
  if (!Array.isArray(raw?.implicatedCandidates)) {
    throw new AiDomainError('INVALID_MODEL_RESPONSE', 'model response must return implicatedCandidates as an array')
  }
  const implicatedCandidateUserIds = uniqueStrings(raw.implicatedCandidates.map((candidate) => candidate?.candidate_user_id ?? candidate?.stableAccountId))
  if (!implicatedCandidateUserIds.every((candidateUserId) => allowedCandidateIds.has(candidateUserId))) {
    throw new AiDomainError('INVALID_MODEL_RESPONSE', 'model selected a candidate outside the backend candidate table')
  }
  return {
    answer,
    responseType,
    citations: raw.citations,
    privacy: normalizeSignal(raw.privacy, 'privacy'),
    danger: normalizeSignal(raw.danger, 'danger'),
    implicatedCandidateUserIds,
    usage,
    spoilerRisk: Boolean(raw.spoilerRisk),
  }
}

function normalizeEnvelope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AiDomainError('INVALID_REQUEST', 'answer requires authContext and request')
  }
  if ([...IDENTITY_FIELDS].some((field) => hasOwn(input, field))) {
    throw new AiDomainError('INVALID_REQUEST', 'identity must be supplied only through authContext')
  }
  const authContext = input.authContext
  const request = input.request
  if (!authContext || typeof authContext !== 'object' || Array.isArray(authContext)) {
    throw new AiDomainError('INVALID_REQUEST', 'authContext is required')
  }
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new AiDomainError('INVALID_REQUEST', 'request is required')
  }
  if ([...IDENTITY_FIELDS].some((field) => hasOwn(request, field))) {
    throw new AiDomainError('INVALID_REQUEST', 'organizationId, userId, and workspaceId must not be accepted from the request body')
  }
  return {
    authContext: {
      organizationId: requiredString(authContext.organizationId, 'authContext.organizationId'),
      userId: requiredString(authContext.userId, 'authContext.userId'),
      workspaceId: requiredString(authContext.workspaceId, 'authContext.workspaceId'),
    },
    rawRequest: request,
  }
}

function normalizeSelections(value, activePolicy) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new AiDomainError('INVALID_SELECTION_RANGE', 'selections must be an array')
  if (value.length > activePolicy.maxSelectedBlockIds) {
    throw new AiDomainError('TOO_MANY_SELECTED_BLOCKS', 'selections exceeds the configured block limit')
  }
  const seenBlocks = new Set()
  let selectedCharacters = 0
  return value.map((selection, index) => {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
      throw new AiDomainError('INVALID_SELECTION_RANGE', `selections[${index}] must be an object`)
    }
    const allowedFields = new Set(['pageNo', 'blockId', 'startOffset', 'endOffset'])
    if (Object.keys(selection).length !== allowedFields.size
      || Object.keys(selection).some((field) => !allowedFields.has(field))) {
      throw new AiDomainError('INVALID_SELECTION_RANGE', `selections[${index}] fields are invalid`)
    }
    const pageNo = selection.pageNo
    const blockId = requiredString(selection.blockId, `selections[${index}].blockId`)
    const startOffset = selection.startOffset
    const endOffset = selection.endOffset
    if (!Number.isInteger(pageNo) || pageNo < 1
      || !Number.isInteger(startOffset) || !Number.isInteger(endOffset)
      || startOffset < 0 || endOffset <= startOffset) {
      throw new AiDomainError('INVALID_SELECTION_RANGE', `selections[${index}] anchor is invalid`)
    }
    if (seenBlocks.has(blockId)) throw new AiDomainError('INVALID_SELECTION_RANGE', 'selections contains a duplicate blockId')
    seenBlocks.add(blockId)
    selectedCharacters += endOffset - startOffset
    if (selectedCharacters > activePolicy.maxSelectionCharacters) {
      throw new AiDomainError('INVALID_SELECTION_RANGE', 'selections exceeds the configured character limit')
    }
    return { pageNo, blockId, startOffset, endOffset }
  })
}

function normalizeRequest(input, activePolicy) {
  const rawQuestion = input?.question
  if (typeof rawQuestion !== 'string' || rawQuestion.length > activePolicy.maxQuestionCharacters) {
    throw new AiDomainError('QUESTION_TOO_LONG', 'question exceeds the configured character limit')
  }
  if (hasOwn(input, 'selectedBlockIds') || hasOwn(input, 'selectionRange')) {
    throw new AiDomainError('INVALID_REQUEST', 'use structured selections[] instead of legacy selection fields')
  }
  const selections = normalizeSelections(input?.selections, activePolicy)
  const selectedBlockIds = selections.map((selection) => selection.blockId)
  return {
    idempotencyKey: requiredString(input?.idempotencyKey, 'idempotencyKey'),
    conversationId: requiredString(input?.conversationId, 'conversationId'),
    bookVersionId: requiredString(input?.bookVersionId, 'bookVersionId'),
    currentPageId: requiredString(input?.currentPageId, 'currentPageId'),
    readRangeVersion: requiredString(input?.readRangeVersion, 'readRangeVersion'),
    question: requiredString(rawQuestion, 'question'),
    selections,
    selectedBlockIds,
    serviceMode: stringValue(input?.serviceMode) || 'balanced',
  }
}

function fingerprintMaterial(authContext, request) {
  return {
    organizationId: authContext.organizationId,
    userId: authContext.userId,
    workspaceId: authContext.workspaceId,
    conversationId: request.conversationId,
    bookVersionId: request.bookVersionId,
    currentPageId: request.currentPageId,
    readRangeVersion: request.readRangeVersion,
    question: request.question,
    selections: request.selections,
    selectedBlockIds: request.selectedBlockIds,
    serviceMode: request.serviceMode,
  }
}

async function buildFingerprint(fingerprintHasher, authContext, request) {
  const fingerprint = stringValue(await fingerprintHasher.hash({ material: fingerprintMaterial(authContext, request) }))
  if (fingerprint.length < 16 || fingerprint.length > 512) {
    throw new AiDomainError('INVALID_FINGERPRINT', 'fingerprintHasher must return a bounded opaque digest')
  }
  return fingerprint
}

function resolveSelectionText({ selections, evidenceBlocks, bookVersionId, readablePageIds }) {
  const blocks = Array.isArray(evidenceBlocks) ? evidenceBlocks : []
  return selections.map((selection) => {
    const block = blocks.find(
      (candidate) => stringValue(candidate?.id) === selection.blockId
        && candidate?.bookVersionId === bookVersionId
        && candidate?.pageNumber === selection.pageNo
        && readablePageIds.has(stringValue(candidate?.pageId)),
    )
    const content = typeof block?.content === 'string' ? block.content : null
    if (!content || selection.endOffset > content.length) {
      throw new AiDomainError('INVALID_SELECTION_RANGE', 'selection is outside a readable evidence block')
    }
    return content.slice(selection.startOffset, selection.endOffset)
  }).join('\n')
}

function providerRequest({ request, sources, selectionText, recentMessages, candidateUserIds, candidateCatalog, strictSpoilerMode }) {
  return {
    bookVersionId: request.bookVersionId,
    conversationId: request.conversationId,
    question: request.question,
    selections: request.selections,
    selectionText,
    strictSpoilerMode,
    recentMessages,
    sources: toModelSources(sources),
    candidateUserIds,
    teacherCandidates: candidateCatalog,
    responseContract: {
      responseTypes: [...RESPONSE_TYPES],
      citationField: 'evidenceId',
      implicatedCandidateField: 'candidate_user_id',
      requireStructuredPrivacyAndDanger: true,
      prohibitUnseenBookFacts: true,
      prohibitNotificationRecipients: true,
    },
  }
}

function candidateAttemptPlan(candidates, maxProviderAttempts) {
  const approvedCandidates = candidates.filter(Boolean)
  const plan = []
  for (let index = 0; index < maxProviderAttempts; index += 1) {
    plan.push(approvedCandidates[index % approvedCandidates.length])
  }
  return plan
}

function unpackProviderAttempt(rawAttempt) {
  if (rawAttempt && typeof rawAttempt === 'object' && hasOwn(rawAttempt, 'response')) {
    return {
      response: rawAttempt.response,
      usage: rawAttempt.usage ?? rawAttempt.response?.usage,
    }
  }
  return {
    response: rawAttempt,
    usage: rawAttempt?.usage,
  }
}

function errorUsage(error) {
  return error?.providerUsage ?? error?.usage
}

async function callApprovedCandidates({ modelProvider, candidates, maxProviderAttempts, maxSpoilerRetries, requestFactory, citationInput, allowedCandidateIds, logicalRequestId }) {
  const attempts = []
  let totalUsage = emptyUsage()
  let spoilerRetries = 0
  let unsafeResponse = null
  let unsafeResponseReason = null

  const attemptPlan = candidateAttemptPlan(candidates, maxProviderAttempts)
  for (let attemptIndex = 0; attemptIndex < attemptPlan.length; attemptIndex += 1) {
    const candidate = attemptPlan[attemptIndex]
    const candidateId = stringValue(candidate?.id ?? candidate?.candidateId ?? candidate?.modelId) || `candidate-${attemptIndex + 1}`
    let recordedUsage = null
    try {
      const providerAttempt = unpackProviderAttempt(
        await modelProvider.generate({
          candidate,
          logicalRequestId,
          providerAttemptKey: `${logicalRequestId}:${candidateId}:${attemptIndex + 1}`,
          request: requestFactory(spoilerRetries > 0),
        }),
      )
      recordedUsage = optionalUsage(providerAttempt.usage)
      totalUsage = addUsage(totalUsage, recordedUsage)
      const response = normalizeModelResponse(providerAttempt.response, allowedCandidateIds, recordedUsage)
      const citationCheck = validateCitations({ ...citationInput, citations: response.citations, responseType: response.responseType })
      const unsafe = response.spoilerRisk || !citationCheck.valid
      const attemptReason = citationCheck.reason || (response.spoilerRisk ? 'spoiler_risk' : null)
      attempts.push({ candidateId, outcome: unsafe ? 'unsafe_response' : 'accepted', reason: attemptReason, usage: recordedUsage })
      if (!unsafe) {
        return {
          response: { ...response, citations: citationCheck.citations },
          totalUsage,
          attempts,
          safeDegradation: false,
          safeDegradationReason: null,
        }
      }
      unsafeResponse = response
      unsafeResponseReason = citationCheck.valid ? 'SPOILER_RISK_DETECTED' : 'CITATION_VALIDATION_FAILED'
      if (spoilerRetries >= maxSpoilerRetries) {
        return {
          response: {
            ...unsafeResponse,
            answer: SAFE_SPOILER_DEGRADATION,
            responseType: 'guidance',
            citations: [],
            usage: emptyUsage(),
          },
          totalUsage,
          attempts,
          safeDegradation: true,
          safeDegradationReason: unsafeResponseReason,
        }
      }
      spoilerRetries += 1
    } catch (error) {
      let failedUsage = recordedUsage
      if (!failedUsage) {
        try {
          failedUsage = optionalUsage(errorUsage(error))
        } catch {
          failedUsage = emptyUsage()
        }
        totalUsage = addUsage(totalUsage, failedUsage)
      }
      attempts.push({
        candidateId,
        outcome: 'provider_error',
        reason: error instanceof AiDomainError ? error.code : 'provider_unavailable',
        usage: failedUsage,
      })
    }
  }

  throw new AiDomainError('MODEL_UNAVAILABLE', 'no approved model produced a valid response', {
    retryable: true,
    details: { attempts, providerUsage: totalUsage },
  })
}

function activeLease(record, now) {
  const expiresAt = Date.parse(record?.leaseExpiresAt || '')
  const current = Date.parse(now)
  return Number.isFinite(expiresAt) && Number.isFinite(current) && expiresAt > current
}

function idempotencyReplayOrConflict(existing, fingerprint, now) {
  if (!existing) return null
  if (existing.fingerprint !== fingerprint) {
    throw new AiDomainError('IDEMPOTENCY_KEY_REUSED', 'idempotency key does not match the original request')
  }
  if (existing.status === 'completed') return { replay: existing.response }
  if (existing.status === 'in_progress' && activeLease(existing, now)) {
    throw new AiDomainError('IDEMPOTENCY_IN_PROGRESS', 'this logical request is already being processed', { retryable: true })
  }
  return null
}

function priorUsage(reservation) {
  try {
    return optionalUsage(reservation?.providerUsage)
  } catch {
    return emptyUsage()
  }
}

export function createAiService({
  db,
  modelProvider,
  quotaPolicy,
  safetyService,
  fingerprintHasher,
  policy = DEFAULT_AI_POLICY,
  idFactory = () => randomUUID(),
  clock = () => new Date(),
}) {
  if (typeof db?.transaction !== 'function' || typeof db?.reading?.getValidReadScope !== 'function') {
    throw new TypeError('db must provide transaction and reading.getValidReadScope')
  }
  if (
    typeof db?.ai?.hasConversationAccess !== 'function' ||
    typeof db?.ai?.findEvidenceBlocks !== 'function' ||
    typeof db?.ai?.findMemoryCards !== 'function' ||
    typeof db?.ai?.findRecentConversationMessages !== 'function'
  ) {
    throw new TypeError('db.ai must provide scoped conversation, evidence, memory card, and recent message queries')
  }
  if (typeof modelProvider?.listCandidates !== 'function' || typeof modelProvider?.generate !== 'function') {
    throw new TypeError('modelProvider.listCandidates and modelProvider.generate are required')
  }
  if (typeof quotaPolicy?.estimateReservation !== 'function' || typeof quotaPolicy?.calculateSettlement !== 'function') {
    throw new TypeError('quotaPolicy.estimateReservation and quotaPolicy.calculateSettlement are required')
  }
  if (typeof safetyService?.listCandidateIds !== 'function' || typeof safetyService?.evaluateResponse !== 'function' || typeof safetyService?.persistResponse !== 'function') {
    throw new TypeError('safetyService must provide candidate, response assessment, and persistence operations')
  }
  if (typeof fingerprintHasher?.hash !== 'function') {
    throw new TypeError('fingerprintHasher.hash is required and must use a runtime-only keyed digest in production')
  }

  async function answer(input) {
    const { authContext, rawRequest } = normalizeEnvelope(input)
    const activePolicy = resolveAiPolicy(policy, { authContext, request: rawRequest })
    const request = normalizeRequest(rawRequest, activePolicy)
    const conversationScope = {
      organizationId: authContext.organizationId,
      ownerUserId: authContext.userId,
      conversationId: request.conversationId,
    }
    if (!(await db.ai.hasConversationAccess(conversationScope))) {
      throw new AiDomainError('RESOURCE_NOT_FOUND', 'resource not found')
    }
    const fingerprint = await buildFingerprint(fingerprintHasher, authContext, request)
    const now = timestamp(clock)
    const preflightReplay = await db.transaction((tx) => {
      if (typeof tx?.idempotency?.get !== 'function') throw new TypeError('transaction must provide idempotency.get')
      return idempotencyReplayOrConflict(tx.idempotency.get({ ...conversationScope, key: request.idempotencyKey }), fingerprint, now)
    })
    if (preflightReplay?.replay) return preflightReplay.replay

    const candidates = await modelProvider.listCandidates({
      organizationId: authContext.organizationId,
      userId: authContext.userId,
      serviceMode: request.serviceMode,
    })
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new AiDomainError('MODEL_CANDIDATES_UNAVAILABLE', 'no approved model candidate is available', { retryable: true })
    }
    const reservationSpec = await quotaPolicy.estimateReservation({ authContext, request, candidates })
    const acquisition = await db.transaction((tx) => {
      if (typeof tx?.idempotency?.claim !== 'function') throw new TypeError('transaction must provide idempotency.claim')
      const claim = tx.idempotency.claim({
        ...conversationScope,
        key: request.idempotencyKey,
        fingerprint,
        requestId: idFactory(),
        leaseToken: idFactory(),
        claimedAt: timestamp(clock),
        leaseExpiresAt: futureTimestamp(clock, activePolicy.idempotencyLeaseMs),
      })
      if (claim?.outcome === 'replay') return { replay: claim.response }
      if (claim?.outcome === 'conflict') {
        throw new AiDomainError('IDEMPOTENCY_KEY_REUSED', 'idempotency key does not match the original request')
      }
      if (claim?.outcome === 'busy') {
        throw new AiDomainError('IDEMPOTENCY_IN_PROGRESS', 'this logical request is already being processed', { retryable: true })
      }
      if (claim?.outcome !== 'claimed') {
        throw new AiDomainError('IDEMPOTENCY_CLAIM_FAILED', 'idempotency claim did not return an owned lease', { retryable: true })
      }
      let reservation
      if (claim.reservationAction === 'reserve') {
        if (typeof tx?.usage?.reserve !== 'function') throw new TypeError('transaction must provide usage.reserve')
        reservation = tx.usage.reserve({
          requestId: claim.requestId,
          organizationId: authContext.organizationId,
          organizationIdAtCreation: authContext.organizationId,
          actorIdAtCreation: authContext.userId,
          userId: authContext.userId,
          conversationId: request.conversationId,
          idempotencyKey: request.idempotencyKey,
          reservation: reservationSpec,
          createdAt: timestamp(clock),
        })
      } else if (claim.reservationAction === 'reacquire') {
        if (typeof tx?.usage?.reacquire !== 'function') throw new TypeError('transaction must provide usage.reacquire')
        reservation = tx.usage.reacquire({
          ...conversationScope,
          key: request.idempotencyKey,
          requestId: claim.requestId,
          leaseToken: claim.leaseToken,
          claimedAt: timestamp(clock),
        })
      } else if (claim.reservationAction === 'reuse') {
        if (typeof tx?.usage?.getReservation !== 'function') throw new TypeError('transaction must provide usage.getReservation')
        reservation = tx.usage.getReservation({ ...conversationScope, key: request.idempotencyKey, requestId: claim.requestId })
      } else {
        throw new AiDomainError('IDEMPOTENCY_CLAIM_FAILED', 'idempotency claim did not define a reservation action', { retryable: true })
      }
      if (!reservation) throw new AiDomainError('USAGE_RESERVATION_MISSING', 'logical request has no usage reservation', { retryable: true })
      return {
        requestId: claim.requestId,
        leaseToken: claim.leaseToken,
        reservation,
        priorProviderUsage: priorUsage(reservation),
        priorAttempts: Array.isArray(reservation.providerAttempts) ? reservation.providerAttempts : [],
      }
    })
    if (acquisition.replay) return acquisition.replay

    let providerUsage = acquisition.priorProviderUsage
    let providerAttempts = acquisition.priorAttempts
    try {
      const readScope = await db.reading.getValidReadScope({
        organizationId: authContext.organizationId,
        userId: authContext.userId,
        workspaceId: authContext.workspaceId,
        bookVersionId: request.bookVersionId,
        currentPageId: request.currentPageId,
        readRangeVersion: request.readRangeVersion,
      })
      const resolvedCurrentPageId = stringValue(readScope?.currentPageId)
      const validReadPageIds = uniqueStrings(readScope?.pageIds)
      if (!resolvedCurrentPageId) {
        throw new AiDomainError('INVALID_READ_SCOPE', 'server could not resolve the current page')
      }
      const readablePageIds = new Set([...validReadPageIds, resolvedCurrentPageId])
      const [evidenceBlocks, memoryCards, recentMessages, candidateCatalog] = await Promise.all([
        db.ai.findEvidenceBlocks({
          organizationId: authContext.organizationId,
          ownerUserId: authContext.userId,
          bookVersionId: request.bookVersionId,
          validReadPageIds,
          currentPageId: resolvedCurrentPageId,
          selectedBlockIds: request.selectedBlockIds,
        }),
        db.ai.findMemoryCards({
          organizationId: authContext.organizationId,
          ownerUserId: authContext.userId,
          bookVersionId: request.bookVersionId,
          validReadPageIds,
        }),
        db.ai.findRecentConversationMessages({
          ...conversationScope,
          limit: activePolicy.maxContextTurns,
        }),
        typeof safetyService.listCandidateCatalog === 'function'
          ? safetyService.listCandidateCatalog({
            organizationId: authContext.organizationId,
            conversationId: request.conversationId,
            actorUserId: authContext.userId,
          })
          : safetyService.listCandidateIds({
            organizationId: authContext.organizationId,
            conversationId: request.conversationId,
            actorUserId: authContext.userId,
          }).then((candidateUserIds) => candidateUserIds.map((candidateUserId) => ({
            candidateUserId,
            stableAccountId: candidateUserId,
          }))),
      ])
      const candidateUserIds = uniqueStrings(candidateCatalog.map((candidate) => candidate.candidateUserId ?? candidate.stableAccountId))
      const selectionText = resolveSelectionText({
        selections: request.selections,
        evidenceBlocks,
        bookVersionId: request.bookVersionId,
        readablePageIds,
      })
      const sources = selectReadableSources({
        evidenceBlocks,
        memoryCards,
        bookVersionId: request.bookVersionId,
        validReadPageIds,
        currentPageId: resolvedCurrentPageId,
        question: request.question,
        selectionText,
        selectedBlockIds: request.selectedBlockIds,
        limit: activePolicy.maxEvidenceSources,
      })
      const allowedCandidateIds = new Set(candidateUserIds)
      const execution = await callApprovedCandidates({
        modelProvider,
        candidates,
        maxProviderAttempts: activePolicy.maxProviderAttempts,
        maxSpoilerRetries: activePolicy.maxSpoilerRetries,
        allowedCandidateIds,
        logicalRequestId: acquisition.requestId,
        requestFactory: (strictSpoilerMode) =>
          providerRequest({
            request,
            sources,
            selectionText,
            recentMessages: Array.isArray(recentMessages) ? recentMessages : [],
            candidateUserIds,
            candidateCatalog,
            strictSpoilerMode,
          }),
        citationInput: {
          sources,
          bookVersionId: request.bookVersionId,
          validReadPageIds: [...readablePageIds],
        },
      })
      providerUsage = addUsage(acquisition.priorProviderUsage, execution.totalUsage)
      providerAttempts = [...acquisition.priorAttempts, ...execution.attempts]
      const settlement = await quotaPolicy.calculateSettlement({
        authContext,
        request,
        reservation: acquisition.reservation,
        acceptedUsage: execution.response.usage,
        providerUsage,
        safeDegradation: execution.safeDegradation,
      })

      return await db.transaction((tx) => {
        if (typeof tx?.ai?.assertConversationAccess !== 'function' || !tx.ai.assertConversationAccess(conversationScope)) {
          throw new AiDomainError('RESOURCE_NOT_FOUND', 'resource not found')
        }
        const assessment = safetyService.evaluateResponse({
          tx,
          organizationId: authContext.organizationId,
          conversationId: request.conversationId,
          actorUserId: authContext.userId,
          privacy: execution.response.privacy,
          danger: execution.response.danger,
          candidateUserIds: execution.response.implicatedCandidateUserIds,
          candidateCatalogIds: candidateUserIds,
        })
        const userMessageId = idFactory()
        const assistantMessageId = idFactory()
        const createdAt = timestamp(clock)
        tx.ai.insertMessage({
          id: userMessageId,
          conversationId: request.conversationId,
          organizationId: authContext.organizationId,
          organizationIdAtCreation: authContext.organizationId,
          actorUserId: authContext.userId,
          actorIdAtCreation: authContext.userId,
          role: 'user',
          content: request.question,
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
          conversationId: request.conversationId,
          organizationId: authContext.organizationId,
          organizationIdAtCreation: authContext.organizationId,
          actorUserId: authContext.userId,
          actorIdAtCreation: authContext.userId,
          role: 'assistant',
          content: execution.response.answer,
          modelCandidateId: execution.attempts.find((attempt) => attempt.outcome === 'accepted')?.candidateId || execution.attempts.at(-1)?.candidateId || null,
          requestId: acquisition.requestId,
          responseType: execution.response.responseType,
          privacy: assessment.privacy,
          danger: assessment.danger,
          providerAttempts,
          safeDegradation: execution.safeDegradation,
          createdAt,
          updatedAt: createdAt,
        })
        tx.ai.insertMessageLink({
          logicalRequestId: acquisition.requestId,
          userMessageId,
          assistantMessageId,
          createdAt,
          updatedAt: createdAt,
        })
        for (const citation of execution.response.citations) {
          tx.ai.insertMessageEvidence({
            id: idFactory(),
            messageId: assistantMessageId,
            bookVersionId: request.bookVersionId,
            evidenceId: citation.evidenceId,
            pageId: citation.pageId,
            pageNumber: citation.pageNumber,
            coordinates: citation.coordinates,
            citationVerified: true,
            createdAt,
            updatedAt: createdAt,
          })
        }
        const safety = safetyService.persistResponse(tx, {
          assessment,
          organizationId: authContext.organizationId,
          conversationId: request.conversationId,
          actorUserId: authContext.userId,
          userMessageId,
          assistantMessageId,
        })
        const settled = tx.usage.settle({
          ...conversationScope,
          key: request.idempotencyKey,
          requestId: acquisition.requestId,
          leaseToken: acquisition.leaseToken,
          reservation: acquisition.reservation,
          assistantMessageId,
          settlement,
          providerUsage,
          attempts: providerAttempts,
          reasonCode: execution.safeDegradationReason,
          settledAt: timestamp(clock),
        })
        if (!settled) {
          throw new AiDomainError('IDEMPOTENCY_LEASE_LOST', 'logical request lease was replaced before usage settlement', { retryable: true })
        }
        const result = {
          requestId: acquisition.requestId,
          conversationId: request.conversationId,
          messageId: assistantMessageId,
          answer: execution.response.answer,
          responseType: execution.response.responseType,
          citations: execution.response.citations,
          usage: settlement,
          privacy: assessment.privacy,
          danger: assessment.danger,
          reviewTaskId: safety.reviewTask?.id || null,
          safeDegradation: execution.safeDegradation,
          safeDegradationReason: execution.safeDegradationReason,
        }
        const completed = tx.idempotency.complete({
          ...conversationScope,
          key: request.idempotencyKey,
          fingerprint,
          leaseToken: acquisition.leaseToken,
          response: result,
          completedAt: timestamp(clock),
        })
        if (!completed) {
          throw new AiDomainError('IDEMPOTENCY_LEASE_LOST', 'logical request lease was replaced before commit', { retryable: true })
        }
        return result
      })
    } catch (error) {
      if (error instanceof AiDomainError && error.details?.providerUsage) {
        providerUsage = error.details.providerUsage
        providerAttempts = Array.isArray(error.details.attempts) ? error.details.attempts : providerAttempts
      }
      try {
        await db.transaction((tx) => {
          const failed = tx.idempotency.fail({
            ...conversationScope,
            key: request.idempotencyKey,
            fingerprint,
            leaseToken: acquisition.leaseToken,
            reasonCode: error instanceof AiDomainError ? error.code : 'UNEXPECTED_FAILURE',
            failedAt: timestamp(clock),
          })
          if (!failed) return
          tx.usage.release({
            ...conversationScope,
            key: request.idempotencyKey,
            requestId: acquisition.requestId,
            leaseToken: acquisition.leaseToken,
            reservation: acquisition.reservation,
            providerUsage,
            attempts: providerAttempts,
            reasonCode: error instanceof AiDomainError ? error.code : 'UNEXPECTED_FAILURE',
            releasedAt: timestamp(clock),
          })
        })
      } catch {
        error.cleanupFailed = true
      }
      throw error
    }
  }

  return { answer }
}
