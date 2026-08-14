import { createHash, createHmac } from 'node:crypto'

import { createAiService } from '../domains/ai/service.js'
import { createAiSafetySqliteAdapter } from '../domains/ai/sqlite-adapter.js'
import { createSafetyService } from '../domains/safety/service.js'
import { createExternalOpenAiProvider } from './external-openai-provider.js'

function parseStructuredContent(content) {
  if (typeof content === 'object' && content) return content
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(text)
}

function usageFromProvider(raw, pricing) {
  const inputTokens = Number(raw?.prompt_tokens ?? raw?.input_tokens ?? 0)
  const outputTokens = Number(raw?.completion_tokens ?? raw?.output_tokens ?? 0)
  const cachedTokens = Number(raw?.prompt_tokens_details?.cached_tokens ?? raw?.cached_tokens ?? 0)
  const costMicros = Math.round(
    (inputTokens * pricing.inputMicrosPerMillion + outputTokens * pricing.outputMicrosPerMillion) / 1_000_000,
  )
  return { inputTokens, outputTokens, cachedTokens, costMicros }
}

function providerConfiguration(env) {
  const baseUrl = String(env.AI_BASE_URL || '').replace(/\/$/, '')
  const apiKey = String(env.AI_API_KEY || '')
  const models = [env.AI_MODEL, ...(env.AI_FALLBACK_MODELS || '').split(',')].map((value) => String(value || '').trim()).filter(Boolean)
  const inputMicrosPerMillion = Number(env.AI_INPUT_COST_MICROS_PER_MILLION)
  const outputMicrosPerMillion = Number(env.AI_OUTPUT_COST_MICROS_PER_MILLION)
  const timeoutMs = Number(env.AI_TIMEOUT_MS || 30000)
  const configured = Boolean(baseUrl && apiKey && models.length && Number.isFinite(inputMicrosPerMillion) && Number.isFinite(outputMicrosPerMillion))
  return {
    configured,
    baseUrl,
    apiKey,
    models,
    pricing: { inputMicrosPerMillion, outputMicrosPerMillion },
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000,
  }
}

async function callStructuredChat(configuration, fetchImpl, { model, messages, idempotencyKey }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), configuration.timeoutMs)
  try {
    const response = await fetchImpl(`${configuration.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${configuration.apiKey}`,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ model, messages, temperature: 0.2, stream: false, response_format: { type: 'json_object' } }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const error = new Error(`AI provider returned HTTP ${response.status}`)
      error.code = 'MODEL_PROVIDER_FAILED'
      throw error
    }
    const payload = await response.json()
    const content = payload?.choices?.[0]?.message?.content
    if (!content) throw new Error('AI provider returned an empty structured response')
    return {
      response: parseStructuredContent(content),
      usage: usageFromProvider(payload.usage, configuration.pricing),
    }
  } finally {
    clearTimeout(timer)
  }
}

export function createOpenAiCompatibleProvider({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const configuration = providerConfiguration(env)
  return {
    configured: configuration.configured,
    listCandidates: async () => configuration.configured
      ? configuration.models.map((model) => ({ id: model, model }))
      : [],
    generate: async ({ candidate, providerAttemptKey, request }) => {
      if (!configuration.configured) throw new Error('AI provider runtime configuration is incomplete')
      return callStructuredChat(configuration, fetchImpl, {
        model: candidate.model || candidate.id,
        idempotencyKey: providerAttemptKey,
        messages: [
          {
            role: 'system',
            content: '你是读伴的受控阅读助手。只返回 JSON，必须包含 answer、responseType、citations、privacy、danger、implicatedCandidates、spoilerRisk。引用只能使用 sources 中的 evidenceId；不得输出通知对象。',
          },
          { role: 'user', content: JSON.stringify(request) },
        ],
      })
    },
    review: async ({ reviewTaskId, context, candidateUserIds }) => {
      if (!configuration.configured) throw new Error('AI provider runtime configuration is incomplete')
      const result = await callStructuredChat(configuration, fetchImpl, {
        model: configuration.models[0],
        idempotencyKey: `secondary-review:${reviewTaskId}:${context.evidenceGeneration}`,
        messages: [
          {
            role: 'system',
            content: '你是独立安全复核器。只返回 JSON：review_result(false_positive|uncertain|likely|confirmed)、risk_level(none|low|medium|high|critical)、evidence_message_ids（必须保留输入中的全部证据）、summary_for_staff、implicated_candidates、unknown_implicated_person、requires_human_review。模型只可从 candidateUserIds 选择涉事稳定账号，不得决定通知链。',
          },
          { role: 'user', content: JSON.stringify({ context, candidateUserIds }) },
        ],
      })
      return result.response
    },
  }
}

function readScopeProvider(database, input) {
  const page = database.prepare(`
    SELECT page.id, page.page_no, page.book_version_id
    FROM book_pages AS page
    JOIN book_versions AS version ON version.id = page.book_version_id
    JOIN books AS book ON book.id = version.book_id
    WHERE page.id = ? AND page.book_version_id = ?
      AND version.organization_id_at_creation = ? AND book.organization_id_at_creation = ?
      AND book.status = 'published'
  `).get(input.currentPageId, input.bookVersionId, input.organizationId, input.organizationId)
  if (!page) return null
  const expectedVersion = `current-page:${page.id}`
  if (input.readRangeVersion !== expectedVersion) return null
  return { currentPageId: page.id, pageIds: [page.id], readRangeVersion: expectedVersion }
}

function evidenceBlockProvider(database, input) {
  const readablePageIds = [...new Set([...(input.validReadPageIds || []), input.currentPageId].filter(Boolean))]
  if (!readablePageIds.length) return []
  const placeholders = readablePageIds.map(() => '?').join(', ')
  return database.prepare(`
    SELECT block.id, block.text_content, block.x, block.y, block.width, block.height,
      page.id AS page_id, page.page_no, page.book_version_id
    FROM book_blocks AS block
    JOIN book_pages AS page ON page.id = block.page_id
    JOIN book_versions AS version ON version.id = page.book_version_id
    JOIN books AS book ON book.id = version.book_id
    WHERE page.book_version_id = ? AND page.id IN (${placeholders})
      AND version.organization_id_at_creation = ? AND book.organization_id_at_creation = ?
    ORDER BY page.page_no, block.char_start, block.id
  `).all(input.bookVersionId, ...readablePageIds, input.organizationId, input.organizationId).map((row) => ({
    id: row.id,
    bookVersionId: row.book_version_id,
    pageId: row.page_id,
    pageNumber: row.page_no,
    content: row.text_content,
    coordinates: { x: row.x, y: row.y, width: row.width, height: row.height },
    sequence: row.page_no,
  }))
}

function createOrganizationResolver(database) {
  return {
    listCandidates: async ({ organizationId, actorUserId }) => database.prepare(`
      SELECT DISTINCT user.id AS candidate_user_id, user.display_name, user.username,
        candidate_membership.membership_role, class.id AS class_id, class.name AS class_name,
        assignment.role_code
      FROM class_memberships AS actor_membership
      JOIN classes AS class
        ON class.id = actor_membership.class_id
       AND class.organization_id = ?
       AND class.status = 'active'
      JOIN class_memberships AS candidate_membership
        ON candidate_membership.class_id = class.id
       AND candidate_membership.status = 'active'
       AND candidate_membership.membership_role IN ('teacher', 'assistant')
      JOIN users AS user
        ON user.id = candidate_membership.user_id
       AND user.organization_id = class.organization_id
       AND user.status = 'active'
      JOIN role_assignments AS assignment
        ON assignment.user_id = user.id
       AND assignment.organization_id = class.organization_id
       AND assignment.status = 'active'
      JOIN workspaces AS workspace
        ON workspace.id = assignment.workspace_id
       AND workspace.organization_id = class.organization_id
       AND workspace.status = 'active'
      WHERE actor_membership.user_id = ?
        AND actor_membership.status = 'active'
        AND user.id <> ?
      ORDER BY class.id, user.id
    `).all(organizationId, actorUserId, actorUserId).map((row) => ({
      candidateUserId: row.candidate_user_id,
      stableAccountId: row.candidate_user_id,
      displayName: row.display_name,
      aliases: [row.display_name, row.username].filter(Boolean),
      role: row.role_code || row.membership_role,
      classRelation: `${row.class_name || row.class_id}:${row.membership_role}`,
    })),
    resolveNotificationChain: async ({ organizationId, actorUserId }) => database.prepare(`
      SELECT
        handler.user_id,
        handler.scope_type,
        handler.scope_id,
        (
          SELECT assignment.role_code
          FROM role_assignments AS assignment
          JOIN workspaces AS workspace
            ON workspace.id = assignment.workspace_id
           AND workspace.organization_id = assignment.organization_id
           AND workspace.status = 'active'
          WHERE assignment.user_id = handler.user_id
            AND assignment.organization_id = handler.organization_id
            AND assignment.status = 'active'
            AND (
              assignment.scope_type IN ('school', 'platform')
              OR (handler.scope_type = 'class' AND assignment.scope_type = 'class' AND assignment.scope_id = handler.scope_id)
              OR (handler.scope_type = 'grade' AND assignment.scope_type = 'grade' AND assignment.scope_id = handler.scope_id)
            )
          ORDER BY CASE assignment.scope_type WHEN 'school' THEN 0 WHEN 'platform' THEN 1 ELSE 2 END,
            assignment.role_code, assignment.workspace_id
          LIMIT 1
        ) AS role
      FROM safety_handlers AS handler
      JOIN users AS user ON user.id = handler.user_id AND user.organization_id = handler.organization_id
      WHERE handler.organization_id = ? AND handler.active = 1 AND user.status = 'active'
        AND (
          (handler.scope_type = 'school' AND handler.scope_id = handler.organization_id)
          OR (
            handler.scope_type = 'class'
            AND EXISTS (
              SELECT 1
              FROM class_memberships AS membership
              JOIN classes AS class
                ON class.id = membership.class_id
               AND class.organization_id = handler.organization_id
               AND class.status = 'active'
              WHERE membership.user_id = ?
                AND membership.status = 'active'
                AND class.id = handler.scope_id
            )
          )
          OR (
            handler.scope_type = 'grade'
            AND EXISTS (
              SELECT 1
              FROM class_memberships AS membership
              JOIN classes AS class
                ON class.id = membership.class_id
               AND class.organization_id = handler.organization_id
               AND class.status = 'active'
              WHERE membership.user_id = ?
                AND membership.status = 'active'
                AND class.grade_id = handler.scope_id
            )
          )
        )
        AND EXISTS (
          SELECT 1
          FROM role_assignments AS assignment
          JOIN workspaces AS workspace
            ON workspace.id = assignment.workspace_id
           AND workspace.organization_id = assignment.organization_id
           AND workspace.status = 'active'
          WHERE assignment.user_id = handler.user_id
            AND assignment.organization_id = handler.organization_id
            AND assignment.status = 'active'
            AND (
              assignment.scope_type IN ('school', 'platform')
              OR (handler.scope_type = 'class' AND assignment.scope_type = 'class' AND assignment.scope_id = handler.scope_id)
              OR (handler.scope_type = 'grade' AND assignment.scope_type = 'grade' AND assignment.scope_id = handler.scope_id)
            )
        )
      ORDER BY handler.handler_level, handler.created_at, handler.id
    `).all(organizationId, actorUserId, actorUserId).map((row) => ({
      userId: row.user_id,
      role: row.role,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
    })),
  }
}

export function createAiRuntime({ database, sessionSecret, modelProvider, reviewProvider, quotaPolicy, env = process.env } = {}) {
  const externalProvider = createExternalOpenAiProvider({ env })
  const provider = modelProvider || (externalProvider.configured ? externalProvider : createOpenAiCompatibleProvider({ env }))
  const fallbackReviewProvider = typeof provider.review === 'function'
    ? provider
    : externalProvider.configured
      ? externalProvider
      : createOpenAiCompatibleProvider({ env })
  const adapter = createAiSafetySqliteAdapter({
    database,
    readScopeProvider: (input) => readScopeProvider(database, input),
    evidenceBlockProvider: (input) => evidenceBlockProvider(database, input),
  })
  const safetyService = createSafetyService({
    db: adapter,
    organizationCandidateResolver: createOrganizationResolver(database),
  })
  const resolvedQuotaPolicy = quotaPolicy || {
    estimateReservation: async () => ({ maxCostMicros: 2_000_000, requestUnits: 1 }),
    calculateSettlement: async ({ acceptedUsage, providerUsage, safeDegradation }) => ({
      studentChargeCostMicros: safeDegradation ? 0 : acceptedUsage.costMicros,
      providerCostMicros: providerUsage.costMicros,
      safeDegradation,
    }),
  }
  const fingerprintHasher = {
    hash: ({ material }) => createHmac('sha256', sessionSecret).update(JSON.stringify(material)).digest('hex'),
  }
  return {
    adapter,
    provider,
    reviewProvider: reviewProvider || fallbackReviewProvider,
    safetyService,
    aiService: createAiService({
      db: adapter,
      modelProvider: provider,
      quotaPolicy: resolvedQuotaPolicy,
      safetyService,
      fingerprintHasher,
    }),
  }
}

export function createConversation(database, { id, organizationId, ownerUserId, bookVersionId, title, createdAt }) {
  database.prepare(`
    INSERT INTO ai_conversations (
      id, organization_id, organization_id_at_creation, owner_user_id, actor_id_at_creation,
      book_version_id, title, summary_json, privacy_mode, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 'standard', ?, ?, 1)
  `).run(id, organizationId, organizationId, ownerUserId, ownerUserId, bookVersionId, title, createdAt, createdAt)
  return id
}

export function deriveAiRequestScope(database, { organizationId, ownerUserId, bookId, currentPageNo }) {
  const normalizedPageNo = Number(currentPageNo)
  if (!Number.isSafeInteger(normalizedPageNo) || normalizedPageNo <= 0) return null
  const page = database.prepare(`
    SELECT page.id AS page_id, page.book_version_id, page.page_no
    FROM books AS book
    JOIN book_versions AS version ON version.book_id = book.id AND version.organization_id_at_creation = book.organization_id_at_creation
    JOIN book_pages AS page ON page.book_version_id = version.id AND page.page_no = ?
    WHERE book.id = ? AND book.organization_id_at_creation = ? AND book.status = 'published'
    ORDER BY version.created_at DESC, version.id DESC
    LIMIT 1
  `).get(normalizedPageNo, bookId, organizationId)
  if (!page) return null
  return {
    bookVersionId: page.book_version_id,
    currentPageId: page.page_id,
    currentPageNo: page.page_no,
    readRangeVersion: `current-page:${page.page_id}`,
  }
}
