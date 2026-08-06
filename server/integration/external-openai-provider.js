const RESPONSE_TYPES = new Set(['answer', 'guidance', 'insufficient_evidence', 'off_topic'])
const RESPONSE_TYPE_ALIASES = new Map([['direct_answer', 'answer']])
const CANDIDATE_FIELDS = new Set(['stableAccountId', 'confidence', 'reason'])
const REVIEW_RESULTS = new Set(['confirmed', 'likely', 'false_positive', 'uncertain'])
const REVIEW_RISK_LEVELS = new Set(['none', 'low', 'medium', 'high', 'critical'])
const REVIEW_FIELDS = new Set(['review_result', 'risk_level', 'evidence_message_ids', 'summary_for_staff', 'implicated_candidates', 'unknown_implicated_person', 'requires_human_review'])
const REVIEW_CANDIDATE_FIELDS = new Set(['candidate_user_id', 'confidence', 'reason'])

const STRICT_SYSTEM_PROMPT = [
  '你是读伴的受控阅读助手，只返回一个 JSON 对象，不要 Markdown。',
  'responseType 只能是 answer、guidance、insufficient_evidence、off_topic 之一，禁止 direct_answer 等自造枚举。',
  'citations 必须是对象数组，每项严格使用 {"evidenceId":"sources 中的 evidenceId"}，禁止返回字符串数组或白名单外引用。',
  'spoilerRisk 必须是 JSON boolean，只能为 true 或 false，禁止 low、high、none 等字符串。',
  'privacy 与 danger 必须完整给出 detected(boolean)、confidence(0..1)、category、urgency、reasons(string[])，并按实际语义诚实分类，不得为了触发产品规则抬高置信度或强迫报警。',
  'implicatedCandidates 只能使用后端 teacherCandidates 中的 stableAccountId，并且每项只含 stableAccountId、confidence、reason；不得返回姓名、联系方式，不得决定通知对象或安全事件。',
  '引用只能使用 sources 中的 evidenceId，不得补写未读内容。最小合法 JSON 示例位于 responseContract.minimalValidJson，字段类型必须完全一致。',
].join(' ')

const emptyUsage = () => ({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, costMicros: 0 })

export class ExternalOpenAiProviderError extends Error {
  constructor(code, message, {
    category,
    retryable = false,
    safetyReviewRecommended = false,
    status = null,
    providerUsage = emptyUsage(),
  } = {}) {
    super(message)
    this.name = 'ExternalOpenAiProviderError'
    this.code = code
    this.category = category
    this.retryable = retryable
    this.safetyReviewRecommended = safetyReviewRecommended
    this.status = status
    this.providerUsage = providerUsage
  }
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function integerInRange(value, fallback, minimum, maximum) {
  const number = Number(value)
  if (!Number.isInteger(number)) return fallback
  return Math.min(maximum, Math.max(minimum, number))
}

function positiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function runtimeConfiguration(env, config) {
  const baseUrl = stringValue(config?.baseUrl ?? env?.OPENAI_BASE_URL).replace(/\/+$/, '')
  const apiKey = stringValue(config?.apiKey ?? env?.OPENAI_API_KEY)
  const modelId = stringValue(config?.modelId ?? env?.MODEL_ID)
  return {
    baseUrl,
    apiKey,
    modelId,
    configured: Boolean(baseUrl && apiKey && modelId),
    timeoutMs: positiveNumber(config?.timeoutMs ?? env?.OPENAI_TIMEOUT_MS, 30000),
    maxParseRetries: integerInRange(config?.maxParseRetries ?? env?.OPENAI_PARSE_RETRIES, 1, 0, 2),
  }
}

function usageFromPayload(payload) {
  const usage = payload?.usage || {}
  return {
    inputTokens: Math.max(0, Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0),
    outputTokens: Math.max(0, Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0),
    cachedTokens: Math.max(0, Number(usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens ?? 0) || 0),
    costMicros: Math.max(0, Number(usage.cost_micros ?? 0) || 0),
  }
}

function addUsage(left, right) {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cachedTokens: left.cachedTokens + right.cachedTokens,
    costMicros: left.costMicros + right.costMicros,
  }
}

function providerError(code, category, message, options = {}) {
  return new ExternalOpenAiProviderError(code, message, { category, ...options })
}

function httpError(status) {
  if (status === 401 || status === 403) {
    return providerError('EXTERNAL_PROVIDER_AUTH_FAILED', 'authentication', 'External AI provider authentication failed', {
      status,
      retryable: false,
    })
  }
  if (status === 429) {
    return providerError('EXTERNAL_PROVIDER_RATE_LIMITED', 'rate_limit', 'External AI provider is rate limited', {
      status,
      retryable: true,
      safetyReviewRecommended: true,
    })
  }
  if (status === 408 || status === 504) {
    return providerError('EXTERNAL_PROVIDER_TIMEOUT', 'timeout', 'External AI provider timed out', {
      status,
      retryable: true,
      safetyReviewRecommended: true,
    })
  }
  if (status >= 500) {
    return providerError('EXTERNAL_PROVIDER_UNAVAILABLE', 'unavailable', 'External AI provider is unavailable', {
      status,
      retryable: true,
      safetyReviewRecommended: true,
    })
  }
  return providerError('EXTERNAL_PROVIDER_REQUEST_REJECTED', 'request_rejected', 'External AI provider rejected the request', {
    status,
    retryable: false,
    safetyReviewRecommended: true,
  })
}

function parseJsonObject(content) {
  if (content && typeof content === 'object' && !Array.isArray(content)) return content
  const text = stringValue(content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  if (!text) throw new TypeError('empty structured content')
  const parsed = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('structured content is not an object')
  return parsed
}

function normalizeReasons(raw, fieldName) {
  if (!Array.isArray(raw) || raw.some((reason) => !stringValue(reason))) {
    throw new TypeError(`${fieldName}.reasons must be an array of strings`)
  }
  return raw.map((reason) => stringValue(reason))
}

function normalizeSignal(raw, fieldName) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(`${fieldName} must be an object`)
  const confidence = Number(raw.confidence)
  if (typeof raw.detected !== 'boolean' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new TypeError(`${fieldName} classification is incomplete`)
  }
  const category = stringValue(raw.category)
  const urgency = stringValue(raw.urgency)
  if (!category || !urgency) throw new TypeError(`${fieldName} taxonomy is incomplete`)
  return {
    detected: raw.detected,
    confidence,
    category,
    urgency,
    reasons: normalizeReasons(raw.reasons, fieldName),
    explicitSelfHarmPlan: Boolean(raw.explicitSelfHarmPlan),
    explicitSelfHarmTime: Boolean(raw.explicitSelfHarmTime),
    explicitSelfHarmMeans: Boolean(raw.explicitSelfHarmMeans),
    extremeRisk: Boolean(raw.extremeRisk),
  }
}

function candidateSource(request) {
  if (Array.isArray(request?.teacherCandidates)) return request.teacherCandidates
  if (Array.isArray(request?.candidateTable)) return request.candidateTable
  if (Array.isArray(request?.candidateUserIds)) return request.candidateUserIds
  return []
}

function sanitizeCandidateTable(request) {
  const candidates = []
  const seen = new Set()
  for (const raw of candidateSource(request)) {
    const stableAccountId = stringValue(typeof raw === 'string' ? raw : raw?.stableAccountId ?? raw?.candidateUserId)
    if (!stableAccountId || seen.has(stableAccountId)) continue
    seen.add(stableAccountId)
    const candidate = { stableAccountId }
    if (typeof raw === 'object' && raw) {
      const displayName = stringValue(raw.displayName)
      const role = stringValue(raw.role)
      const classRelation = stringValue(raw.classRelation)
      const aliases = Array.isArray(raw.aliases) ? [...new Set(raw.aliases.map(stringValue).filter(Boolean))] : []
      if (displayName) candidate.displayName = displayName
      if (aliases.length) candidate.aliases = aliases
      if (role) candidate.role = role
      if (classRelation) candidate.classRelation = classRelation
    }
    candidates.push(candidate)
  }
  return candidates
}

function normalizeCandidates(rawCandidates, allowedCandidateIds) {
  if (!Array.isArray(rawCandidates)) throw new TypeError('implicatedCandidates must be an array')
  return rawCandidates.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new TypeError('implicated candidate must be an object')
    }
    if (Object.keys(candidate).some((field) => !CANDIDATE_FIELDS.has(field))) {
      throw new TypeError('implicated candidate contains a prohibited identity field')
    }
    const stableAccountId = stringValue(candidate.stableAccountId)
    const confidence = Number(candidate.confidence)
    const reason = stringValue(candidate.reason)
    if (!stableAccountId || !allowedCandidateIds.has(stableAccountId)) {
      throw new TypeError('implicated candidate is outside the backend candidate table')
    }
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1 || !reason) {
      throw new TypeError('implicated candidate classification is incomplete')
    }
    return {
      stableAccountId,
      candidate_user_id: stableAccountId,
      confidence,
      reason,
    }
  })
}

function normalizeResponseType(raw) {
  const value = stringValue(raw)
  return RESPONSE_TYPE_ALIASES.get(value) || value
}

function normalizeCitations(raw, allowedEvidenceIds) {
  if (!Array.isArray(raw)) throw new TypeError('citations must be an array')
  return raw.map((citation) => {
    const normalized = typeof citation === 'string' ? { evidenceId: stringValue(citation) } : citation
    const evidenceId = stringValue(normalized?.evidenceId)
    if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized) || !evidenceId) {
      throw new TypeError('citation must identify backend evidence')
    }
    if (!allowedEvidenceIds.has(evidenceId)) throw new TypeError('citation is outside backend evidence')
    return typeof citation === 'string' ? { evidenceId } : normalized
  })
}

function normalizeStructuredResponse(raw, allowedCandidateIds, allowedEvidenceIds) {
  const answer = stringValue(raw?.answer)
  const responseType = normalizeResponseType(raw?.responseType)
  if (!answer || !RESPONSE_TYPES.has(responseType)) throw new TypeError('answer or responseType is invalid')
  if (typeof raw?.spoilerRisk !== 'boolean') throw new TypeError('spoilerRisk must be a boolean')
  return {
    answer,
    responseType,
    citations: normalizeCitations(raw.citations, allowedEvidenceIds),
    privacy: normalizeSignal(raw.privacy, 'privacy'),
    danger: normalizeSignal(raw.danger, 'danger'),
    implicatedCandidates: normalizeCandidates(raw.implicatedCandidates, allowedCandidateIds),
    spoilerRisk: raw.spoilerRisk,
  }
}

function normalizeReviewResponse(raw, allowedCandidateIds, allowedEvidenceMessageIds) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((field) => !REVIEW_FIELDS.has(field))) {
    throw new TypeError('secondary review response contains an invalid field')
  }
  const reviewResult = stringValue(raw.review_result)
  const riskLevel = stringValue(raw.risk_level)
  if (!REVIEW_RESULTS.has(reviewResult) || !REVIEW_RISK_LEVELS.has(riskLevel)) {
    throw new TypeError('secondary review result or risk level is invalid')
  }
  if (!Array.isArray(raw.evidence_message_ids) || !Array.isArray(raw.implicated_candidates)) {
    throw new TypeError('secondary review evidence and candidates must be arrays')
  }
  if (typeof raw.unknown_implicated_person !== 'boolean' || typeof raw.requires_human_review !== 'boolean') {
    throw new TypeError('secondary review safeguards must be booleans')
  }
  const summaryForStaff = stringValue(raw.summary_for_staff)
  if (!summaryForStaff) throw new TypeError('secondary review staff summary is required')

  const evidenceMessageIds = raw.evidence_message_ids.map(stringValue)
  const evidenceSet = new Set(evidenceMessageIds)
  if (!evidenceMessageIds.length || evidenceSet.size !== evidenceMessageIds.length || !evidenceMessageIds.every((messageId) => allowedEvidenceMessageIds.has(messageId)) || evidenceSet.size !== allowedEvidenceMessageIds.size) {
    throw new TypeError('secondary review must retain the complete evidence generation')
  }

  const implicatedCandidates = raw.implicated_candidates.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || Object.keys(candidate).some((field) => !REVIEW_CANDIDATE_FIELDS.has(field))) {
      throw new TypeError('secondary review candidate contains an invalid field')
    }
    const candidateUserId = stringValue(candidate.candidate_user_id)
    const confidence = Number(candidate.confidence)
    const reason = stringValue(candidate.reason)
    if (!candidateUserId || !allowedCandidateIds.has(candidateUserId) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1 || !reason) {
      throw new TypeError('secondary review candidate is outside the backend candidate table')
    }
    return { candidate_user_id: candidateUserId, confidence, reason }
  })
  if (new Set(implicatedCandidates.map((candidate) => candidate.candidate_user_id)).size !== implicatedCandidates.length) {
    throw new TypeError('secondary review candidates must be unique')
  }

  return {
    review_result: reviewResult,
    risk_level: riskLevel,
    evidence_message_ids: evidenceMessageIds,
    summary_for_staff: summaryForStaff,
    implicated_candidates: implicatedCandidates,
    unknown_implicated_person: raw.unknown_implicated_person,
    requires_human_review: raw.requires_human_review,
  }
}

function modelRequest(request) {
  const teacherCandidates = sanitizeCandidateTable(request)
  const allowedEvidenceIds = Array.isArray(request?.sources)
    ? request.sources.map((source) => stringValue(source?.evidenceId)).filter(Boolean)
    : []
  const exampleEvidenceId = allowedEvidenceIds[0] || 'source-evidence-id'
  const {
    teacherCandidates: ignoredTeacherCandidates,
    candidateTable: ignoredCandidateTable,
    candidateUserIds: ignoredCandidateUserIds,
    responseContract: ignoredResponseContract,
    ...requestContext
  } = request || {}
  return {
    ...requestContext,
    teacherCandidates,
    responseContract: {
      requiredFields: ['answer', 'responseType', 'citations', 'privacy', 'danger', 'implicatedCandidates', 'spoilerRisk'],
      responseType: { type: 'string', enum: [...RESPONSE_TYPES] },
      citations: {
        type: 'array',
        item: { type: 'object', requiredFields: ['evidenceId'], evidenceIdEnum: allowedEvidenceIds },
        stringItemsForbidden: true,
      },
      spoilerRisk: { type: 'boolean', allowedValues: [true, false], severityStringsForbidden: true },
      signalFields: ['detected', 'confidence', 'category', 'urgency', 'reasons'],
      implicatedCandidateFields: ['stableAccountId', 'confidence', 'reason'],
      candidateIdentitySource: 'teacherCandidates.stableAccountId',
      doNotChooseNotificationRecipients: true,
      doNotForcePolicyThresholds: true,
      minimalValidJson: {
        answer: '基于当前可见内容的简短回答。',
        responseType: 'answer',
        citations: [{ evidenceId: exampleEvidenceId }],
        privacy: { detected: false, confidence: 0, category: 'none', urgency: 'none', reasons: [] },
        danger: { detected: false, confidence: 0, category: 'none', urgency: 'none', reasons: [] },
        implicatedCandidates: [],
        spoilerRisk: false,
      },
    },
  }
}

function requestMessages(request, retryIndex) {
  const messages = [
    {
      role: 'system',
      content: STRICT_SYSTEM_PROMPT,
    },
    { role: 'user', content: JSON.stringify(modelRequest(request)) },
  ]
  if (retryIndex > 0) {
    messages.push({
      role: 'system',
      content: '上一响应未通过 JSON 契约校验。只修正结构与字段，不改变风险判断：responseType 使用指定四项枚举；citations 使用 {"evidenceId":"..."} 对象数组；spoilerRisk 只能为 true 或 false。',
    })
  }
  return messages
}

function reviewMessages({ context, candidateUserIds }, retryIndex) {
  const messages = [
    {
      role: 'system',
      content: '你是读伴的独立安全复核器，只返回一个 JSON 对象，不要 Markdown。review_result 只能为 confirmed、likely、false_positive、uncertain；risk_level 只能为 none、low、medium、high、critical。evidence_message_ids 必须完整保留 context.evidenceMessageIds 中的每一项，不能增加、删除或重复。implicated_candidates 只能是对象数组，每项严格使用 candidate_user_id、confidence(0..1)、reason，并且 candidate_user_id 只能从 candidateUserIds 中选择。必须给出 summary_for_staff、unknown_implicated_person(boolean)、requires_human_review(boolean)。模型不得决定通知链、处理人或最终事件状态。',
    },
    { role: 'user', content: JSON.stringify({ context, candidateUserIds }) },
  ]
  if (retryIndex > 0) {
    messages.push({
      role: 'system',
      content: '上一响应未通过复核 JSON 契约。只修正字段和类型：完整保留证据 ID，候选只用 candidateUserIds，所有布尔值必须是 JSON boolean。',
    })
  }
  return messages
}

function invalidResponseError(providerUsage) {
  return providerError('EXTERNAL_PROVIDER_INVALID_RESPONSE', 'invalid_response', 'External AI provider returned an invalid structured response', {
    retryable: true,
    safetyReviewRecommended: true,
    providerUsage,
  })
}

async function fetchStructuredResponse({ configuration, fetchImpl, messages, providerAttemptKey, retryIndex, retrySuffix = 'structured-retry' }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), configuration.timeoutMs)
  try {
    const response = await fetchImpl(`${configuration.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${configuration.apiKey}`,
        'Idempotency-Key': retryIndex === 0
          ? providerAttemptKey
          : `${providerAttemptKey}:${retrySuffix}:${retryIndex}`,
      },
      body: JSON.stringify({
        model: configuration.modelId,
        messages,
        temperature: 0.2,
        stream: false,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    })
    if (!response?.ok) throw httpError(Number(response?.status) || 0)
    return response
  } catch (error) {
    if (error instanceof ExternalOpenAiProviderError) throw error
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw providerError('EXTERNAL_PROVIDER_TIMEOUT', 'timeout', 'External AI provider timed out', {
        retryable: true,
        safetyReviewRecommended: true,
      })
    }
    throw providerError('EXTERNAL_PROVIDER_NETWORK_FAILED', 'network', 'External AI provider network request failed', {
      retryable: true,
      safetyReviewRecommended: true,
    })
  } finally {
    clearTimeout(timer)
  }
}

export function createExternalOpenAiProvider({ env = {}, config = {}, fetchImpl = globalThis.fetch } = {}) {
  const provider = {
    get configured() {
      return runtimeConfiguration(env, config).configured
    },
    listCandidates: async () => {
      const configuration = runtimeConfiguration(env, config)
      return configuration.configured ? [{ id: configuration.modelId, model: configuration.modelId }] : []
    },
    generate: async ({ providerAttemptKey, logicalRequestId, request } = {}) => {
      const configuration = runtimeConfiguration(env, config)
      if (!configuration.configured || typeof fetchImpl !== 'function') {
        throw providerError('EXTERNAL_PROVIDER_NOT_CONFIGURED', 'configuration', 'External AI provider runtime configuration is incomplete')
      }

      const attemptKey = stringValue(providerAttemptKey) || stringValue(logicalRequestId) || 'external-provider-attempt'
      const allowedCandidateIds = new Set(sanitizeCandidateTable(request).map((candidate) => candidate.stableAccountId))
      const allowedEvidenceIds = new Set((Array.isArray(request?.sources) ? request.sources : [])
        .map((source) => stringValue(source?.evidenceId)).filter(Boolean))
      let providerUsage = emptyUsage()

      for (let retryIndex = 0; retryIndex <= configuration.maxParseRetries; retryIndex += 1) {
        const response = await fetchStructuredResponse({
          configuration,
          fetchImpl,
          messages: requestMessages(request, retryIndex),
          providerAttemptKey: attemptKey,
          retryIndex,
        })

        let payload
        try {
          payload = await response.json()
        } catch {
          if (retryIndex < configuration.maxParseRetries) continue
          throw invalidResponseError(providerUsage)
        }

        providerUsage = addUsage(providerUsage, usageFromPayload(payload))
        const choice = payload?.choices?.[0]
        if (choice?.finish_reason === 'content_filter' || choice?.finish_reason === 'safety' || choice?.message?.refusal) {
          throw providerError('EXTERNAL_PROVIDER_REFUSED', 'refusal', 'External AI provider refused the structured response', {
            retryable: false,
            safetyReviewRecommended: true,
            providerUsage,
          })
        }

        try {
          const structured = parseJsonObject(choice?.message?.content)
          return {
            response: normalizeStructuredResponse(structured, allowedCandidateIds, allowedEvidenceIds),
            usage: providerUsage,
          }
        } catch {
          if (retryIndex >= configuration.maxParseRetries) throw invalidResponseError(providerUsage)
        }
      }

      throw invalidResponseError(providerUsage)
    },
    review: async ({ reviewTaskId, context, candidateUserIds } = {}) => {
      const configuration = runtimeConfiguration(env, config)
      if (!configuration.configured || typeof fetchImpl !== 'function') {
        throw providerError('EXTERNAL_PROVIDER_NOT_CONFIGURED', 'configuration', 'External AI provider runtime configuration is incomplete')
      }

      const normalizedReviewTaskId = stringValue(reviewTaskId)
      if (!normalizedReviewTaskId) {
        throw providerError('EXTERNAL_PROVIDER_INVALID_REQUEST', 'validation', 'Secondary review task identity is required')
      }
      const normalizedCandidateUserIds = [...new Set((Array.isArray(candidateUserIds) ? candidateUserIds : []).map(stringValue).filter(Boolean))]
      const allowedCandidateIds = new Set(normalizedCandidateUserIds)
      const allowedEvidenceMessageIds = new Set((Array.isArray(context?.evidenceMessageIds) ? context.evidenceMessageIds : []).map(stringValue).filter(Boolean))
      const availableAssistantMessageIds = new Set((Array.isArray(context?.messages) ? context.messages : [])
        .filter((message) => message?.role === 'assistant')
        .map((message) => stringValue(message?.id))
        .filter(Boolean))
      if (!allowedEvidenceMessageIds.size || ![...allowedEvidenceMessageIds].every((messageId) => availableAssistantMessageIds.has(messageId))) {
        throw providerError('EXTERNAL_PROVIDER_INVALID_REQUEST', 'validation', 'Secondary review context is missing evidence assistant messages')
      }
      const evidenceGeneration = Number.isInteger(Number(context?.evidenceGeneration)) ? Number(context.evidenceGeneration) : 0
      const attemptKey = `secondary-review:${normalizedReviewTaskId}:${evidenceGeneration}`
      let providerUsage = emptyUsage()

      for (let retryIndex = 0; retryIndex <= configuration.maxParseRetries; retryIndex += 1) {
        const response = await fetchStructuredResponse({
          configuration,
          fetchImpl,
          messages: reviewMessages({ context, candidateUserIds: normalizedCandidateUserIds }, retryIndex),
          providerAttemptKey: attemptKey,
          retryIndex,
          retrySuffix: 'review-retry',
        })

        let payload
        try {
          payload = await response.json()
        } catch {
          if (retryIndex < configuration.maxParseRetries) continue
          throw invalidResponseError(providerUsage)
        }

        providerUsage = addUsage(providerUsage, usageFromPayload(payload))
        const choice = payload?.choices?.[0]
        if (choice?.finish_reason === 'content_filter' || choice?.finish_reason === 'safety' || choice?.message?.refusal) {
          throw providerError('EXTERNAL_PROVIDER_REFUSED', 'refusal', 'External AI provider refused the structured review', {
            retryable: false,
            safetyReviewRecommended: true,
            providerUsage,
          })
        }

        try {
          return normalizeReviewResponse(parseJsonObject(choice?.message?.content), allowedCandidateIds, allowedEvidenceMessageIds)
        } catch {
          if (retryIndex >= configuration.maxParseRetries) throw invalidResponseError(providerUsage)
        }
      }

      throw invalidResponseError(providerUsage)
    },
  }
  return provider
}
