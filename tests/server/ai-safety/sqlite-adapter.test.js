import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAiSafetySqliteAdapter, createAiService } from '../../../server/domains/ai/index.js'
import { createSafetyService } from '../../../server/domains/safety/index.js'

const migrationFiles = [
  new URL('../../../server/db/migrations/020_ai_safety.sql', import.meta.url),
  new URL('../../../server/db/migrations/021_ai_safety_hardening.sql', import.meta.url),
  new URL('../../../server/db/migrations/022_ai_safety_sqlite_adapter.sql', import.meta.url),
  new URL('../../../server/db/migrations/023_ai_safety_tenant_scope.sql', import.meta.url),
  new URL('../../../server/db/migrations/024_ai_safety_review_generation_and_idempotency_scope.sql', import.meta.url),
  new URL('../../../server/db/migrations/025_safety_notification_delivery.sql', import.meta.url),
]

const reviewAuthContext = { organizationId: 'organization-1', userId: 'staff-b', ownerUserId: 'student-1' }

function sequentialIds(prefix) {
  let value = 0
  return () => `${prefix}-${++value}`
}

function fixedClock() {
  return new Date('2026-08-05T11:00:00.000Z')
}

function mutableClock() {
  let value = Date.parse('2026-08-05T11:00:00.000Z')
  const clock = () => new Date(value)
  clock.advance = (milliseconds) => {
    value += milliseconds
  }
  return clock
}

function deferred() {
  let resolve
  return {
    promise: new Promise((resolvePromise) => {
      resolve = resolvePromise
    }),
    resolve,
  }
}

function createTestOnlyFingerprintHasher() {
  return {
    hash: async ({ material }) => createHash('sha256').update(JSON.stringify(material)).digest('hex'),
  }
}

function modelResponse(overrides = {}) {
  return {
    answer: '已读内容中的人物正在作出选择。',
    responseType: 'answer',
    citations: [{ evidenceId: 'block-2', pageNumber: 2 }],
    privacy: { detected: false, confidence: 0, category: 'none', urgency: 'none' },
    danger: { detected: false, confidence: 0, category: 'none', urgency: 'none' },
    implicatedCandidates: [],
    usage: { inputTokens: 15, outputTokens: 9, cachedTokens: 0, costMicros: 24 },
    spoilerRisk: false,
    ...overrides,
  }
}

function request(idempotencyKey, question = 'prompt') {
  return {
    authContext: { organizationId: 'organization-1', userId: 'student-1', workspaceId: 'workspace-1' },
    request: {
      idempotencyKey,
      conversationId: 'conversation-1',
      bookVersionId: 'book-version-1',
      currentPageId: 'page-2',
      readRangeVersion: 'read-range-1',
      question,
      selections: [{ pageNo: 2, blockId: 'block-2', startOffset: 0, endOffset: 4 }],
    },
  }
}

function createFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-ai-safety-'))
  const database = new DatabaseSync(join(directory, 'ai-safety.sqlite'))
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE outbox_events (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL,
      available_at TEXT NOT NULL,
      locked_at TEXT,
      processed_at TEXT,
      last_error TEXT,
      dedupe_key TEXT UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL
    );
  `)
  for (const migrationFile of migrationFiles) {
    const sql = readFileSync(migrationFile, 'utf8')
    database.exec(sql)
    database.exec(sql)
  }
  database.prepare(`
    INSERT INTO users (id, organization_id, display_name, status)
    VALUES
      ('student-1', 'organization-1', '测试学生', 'active'),
      ('staff-a', 'organization-1', '测试教师', 'active'),
      ('staff-b', 'organization-1', '测试管理员', 'active')
  `).run()
  database.prepare(`
    INSERT INTO ai_conversations (
      id, organization_id, organization_id_at_creation, owner_user_id, actor_id_at_creation,
      book_version_id, privacy_mode, created_at, updated_at
    ) VALUES ('conversation-1', 'organization-1', 'organization-1', 'student-1', 'student-1',
      'book-version-1', 'standard', '2026-08-05T11:00:00.000Z', '2026-08-05T11:00:00.000Z')
  `).run()
  database.prepare(`
    INSERT INTO book_memory_cards (
      id, organization_id_at_creation, actor_id_at_creation, book_version_id,
      source_evidence_ids_json, source_page_ids_json, content, status, created_at, updated_at
    ) VALUES ('memory-card-1', 'organization-1', 'student-1', 'book-version-1',
      '["block-1","block-2"]', '["page-1","page-2"]', '可追溯的已读记忆。', 'ready',
      '2026-08-05T11:00:00.000Z', '2026-08-05T11:00:00.000Z')
  `).run()
  const adapter = createAiSafetySqliteAdapter({
    database,
    readScopeProvider: async () => ({ currentPageId: 'page-2', pageIds: ['page-1', 'page-2'] }),
    evidenceBlockProvider: async () => [
      { id: 'block-1', bookVersionId: 'book-version-1', pageId: 'page-1', pageNumber: 1, content: '早期已读内容。', sequence: 1 },
      { id: 'block-2', bookVersionId: 'book-version-1', pageId: 'page-2', pageNumber: 2, content: '当前已读内容。', sequence: 2 },
      { id: 'block-5', bookVersionId: 'book-version-1', pageId: 'page-5', pageNumber: 5, content: '未读内容。', sequence: 5 },
    ],
  })
  t.after(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return { adapter, database }
}

function createOrganizationResolver(overrides = {}) {
  return {
    listCandidates: async () => [{ candidateUserId: 'staff-a' }, { candidateUserId: 'staff-b' }],
    resolveNotificationChain: async () => [
      { userId: 'student-1', role: 'student', scopeType: 'class', scopeId: 'class-1' },
      { userId: 'staff-a', role: 'class-teacher', scopeType: 'class', scopeId: 'class-1' },
      { userId: 'staff-b', role: 'school-admin', scopeType: 'school', scopeId: 'organization-1' },
    ],
    ...overrides,
  }
}

function createServices({ adapter, modelProvider, organizationResolver = createOrganizationResolver(), policy, clock = fixedClock }) {
  const safetyService = createSafetyService({
    db: adapter,
    organizationCandidateResolver: organizationResolver,
    idFactory: sequentialIds('safety'),
    clock,
  })
  const quotaPolicy = {
    estimateReservation: async () => ({ maxCostMicros: 500, requestUnits: 1 }),
    calculateSettlement: async ({ acceptedUsage, providerUsage, safeDegradation }) => ({
      studentChargeCostMicros: acceptedUsage.costMicros,
      providerCostMicros: providerUsage.costMicros,
      safeDegradation,
    }),
  }
  return {
    safetyService,
    aiService: createAiService({
      db: adapter,
      modelProvider,
      quotaPolicy,
      safetyService,
      fingerprintHasher: createTestOnlyFingerprintHasher(),
      idFactory: sequentialIds('ai'),
      policy,
      clock,
    }),
  }
}

function scalar(database, sql, ...parameters) {
  return database.prepare(sql).get(...parameters).value
}

test('真实 node:sqlite 临时库可重复应用 020 至 025，且同步事务拒绝 Promise 回调', (t) => {
  const { adapter, database } = createFixture(t)

  assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'ai_idempotency_requests'"), 1)
  assert.throws(() => adapter.transaction(async () => 'invalid'), /synchronous/)
  assert.equal(adapter.transaction(() => 'committed'), 'committed')
})

test('023 前向迁移发现既有跨租户错绑记录时明确失败且不静默重挂', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-ai-safety-migration-audit-'))
  const database = new DatabaseSync(join(directory, 'migration-audit.sqlite'))
  t.after(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  for (const migrationFile of migrationFiles.slice(0, 3)) {
    database.exec(readFileSync(migrationFile, 'utf8'))
  }
  database.prepare(`
    INSERT INTO ai_conversations (
      id, organization_id, organization_id_at_creation, owner_user_id, actor_id_at_creation,
      book_version_id, privacy_mode, created_at, updated_at
    ) VALUES ('conversation-a', 'organization-a', 'organization-a', 'student-a', 'student-a',
      'book-version-1', 'standard', '2026-08-05T11:00:00.000Z', '2026-08-05T11:00:00.000Z')
  `).run()
  database.prepare(`
    INSERT INTO ai_messages (
      id, conversation_id, organization_id, organization_id_at_creation, actor_id_at_creation,
      role, content, privacy_json, danger_json, provider_attempts_json, created_at, updated_at
    ) VALUES ('orphan-cross-scope', 'conversation-a', 'organization-b', 'organization-b', 'student-b',
      'assistant', 'cross-scope', '{}', '{}', '[]', '2026-08-05T11:00:00.000Z', '2026-08-05T11:00:00.000Z')
  `).run()

  assert.throws(
    () => database.exec(readFileSync(migrationFiles[3], 'utf8')),
    /CHECK constraint failed|migration_023_scope_guard/,
  )
  database.exec('ROLLBACK')
  const persisted = database.prepare('SELECT organization_id, actor_id_at_creation FROM ai_messages WHERE id = ?').get('orphan-cross-scope')
  assert.equal(persisted.organization_id, 'organization-b')
  assert.equal(persisted.actor_id_at_creation, 'student-b')
})

test('024 前向迁移发现既有 ai_message_evidence 孤儿时明确失败且不静默删除或重挂', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-ai-safety-evidence-audit-'))
  const database = new DatabaseSync(join(directory, 'evidence-audit.sqlite'))
  t.after(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  for (const migrationFile of migrationFiles.slice(0, 4)) {
    database.exec(readFileSync(migrationFile, 'utf8'))
  }
  database.exec('PRAGMA foreign_keys = OFF')
  database.prepare(`
    INSERT INTO ai_message_evidence (
      id, ai_message_id, book_version_id, evidence_id, page_id, page_number,
      citation_verified, created_at, updated_at
    ) VALUES (
      'orphan-citation', 'missing-message', 'book-version-1', 'block-missing', 'page-missing', 99,
      1, '2026-08-05T11:00:00.000Z', '2026-08-05T11:00:00.000Z'
    )
  `).run()

  assert.throws(
    () => database.exec(readFileSync(migrationFiles[4], 'utf8')),
    /CHECK constraint failed|migration_024_evidence_guard/,
  )
  database.exec('ROLLBACK')
  assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM ai_message_evidence WHERE id = 'orphan-citation'"), 1)
})

test('024 迁移后的 citation scope 触发器在关闭 FK 时仍拒绝 missing-message', (t) => {
  const { adapter, database } = createFixture(t)
  adapter.transaction((tx) => {
    tx.ai.insertMessage({
      id: 'citation-parent',
      conversationId: 'conversation-1',
      organizationId: 'organization-1',
      organizationIdAtCreation: 'organization-1',
      actorIdAtCreation: 'student-1',
      role: 'assistant',
      content: 'citation-parent-content',
      requestId: 'citation-parent-request',
      modelCandidateId: 'model-1',
      responseType: 'answer',
      privacy: null,
      danger: null,
      providerAttempts: [],
      safeDegradation: false,
      createdAt: '2026-08-05T11:00:00.000Z',
      updatedAt: '2026-08-05T11:00:00.000Z',
    })
    tx.ai.insertMessageEvidence({
      id: 'citation-parent-evidence',
      messageId: 'citation-parent',
      bookVersionId: 'book-version-1',
      evidenceId: 'block-2',
      pageId: 'page-2',
      pageNumber: 2,
      coordinates: null,
      citationVerified: true,
      createdAt: '2026-08-05T11:00:00.000Z',
      updatedAt: '2026-08-05T11:00:00.000Z',
    })
  })
  database.exec('PRAGMA foreign_keys = OFF')

  assert.throws(() => database.prepare(`
    INSERT INTO ai_message_evidence (
      id, ai_message_id, book_version_id, evidence_id, page_id, page_number,
      citation_verified, created_at, updated_at
    ) VALUES (
      'post-migration-orphan', 'missing-message', 'book-version-1', 'block-missing', 'page-missing', 99,
      1, '2026-08-05T11:00:00.000Z', '2026-08-05T11:00:00.000Z'
    )
  `).run(), /resource scope violation/)
  assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM ai_message_evidence WHERE id = 'post-migration-orphan'"), 0)
  assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM ai_message_evidence_scopes WHERE evidence_id = 'post-migration-orphan'"), 0)
  assert.throws(
    () => database.prepare("UPDATE ai_messages SET actor_id_at_creation = 'other-owner' WHERE id = 'citation-parent'").run(),
    /resource scope violation/,
  )
  assert.throws(
    () => database.prepare("DELETE FROM ai_messages WHERE id = 'citation-parent'").run(),
    /resource scope violation/,
  )
})

test('024 对无法从可信账本确定 scope 的旧幂等记录明确失败', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-ai-idempotency-audit-'))
  const database = new DatabaseSync(join(directory, 'idempotency-audit.sqlite'))
  t.after(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  for (const migrationFile of migrationFiles.slice(0, 4)) {
    database.exec(readFileSync(migrationFile, 'utf8'))
  }
  database.prepare(`
    INSERT INTO ai_idempotency_requests (
      idempotency_key, fingerprint, request_id, status, reason_code,
      created_at, updated_at, failed_at
    ) VALUES (
      'legacy-unscoped', '1234567890abcdef1234567890abcdef', 'legacy-request-unscoped',
      'failed', 'LEGACY_FAILURE', '2026-08-05T11:00:00.000Z',
      '2026-08-05T11:00:00.000Z', '2026-08-05T11:00:00.000Z'
    )
  `).run()

  assert.throws(
    () => database.exec(readFileSync(migrationFiles[4], 'utf8')),
    /CHECK constraint failed|migration_024_evidence_guard/,
  )
  database.exec('ROLLBACK')
  assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM ai_idempotency_requests WHERE request_id = 'legacy-request-unscoped'"), 1)
})

test('024 只从可信 usage 与 conversation 关系回填旧幂等 scope', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-ai-idempotency-backfill-'))
  const database = new DatabaseSync(join(directory, 'idempotency-backfill.sqlite'))
  t.after(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  for (const migrationFile of migrationFiles.slice(0, 4)) {
    database.exec(readFileSync(migrationFile, 'utf8'))
  }
  database.prepare(`
    INSERT INTO ai_conversations (
      id, organization_id, organization_id_at_creation, owner_user_id, actor_id_at_creation,
      book_version_id, privacy_mode, created_at, updated_at
    ) VALUES (
      'legacy-conversation', 'legacy-organization', 'legacy-organization', 'legacy-owner', 'legacy-owner',
      'book-version-1', 'standard', '2026-08-05T11:00:00.000Z', '2026-08-05T11:00:00.000Z'
    )
  `).run()
  database.prepare(`
    INSERT INTO ai_idempotency_requests (
      idempotency_key, fingerprint, request_id, status, response_json,
      created_at, updated_at, completed_at
    ) VALUES (
      'legacy-key', '1234567890abcdef1234567890abcdef', 'legacy-request', 'completed', '{}',
      '2026-08-05T11:00:00.000Z', '2026-08-05T11:00:00.000Z', '2026-08-05T11:00:00.000Z'
    )
  `).run()
  database.prepare(`
    INSERT INTO ai_usage_ledger (
      id, request_id, organization_id, organization_id_at_creation, user_id, conversation_id,
      charge_scope, reservation_state, reserved_cost_micros, student_charge_cost_micros,
      provider_cost_micros, input_tokens, output_tokens, cached_tokens,
      created_at, updated_at
    ) VALUES (
      'legacy-usage', 'legacy-request', 'legacy-organization', 'legacy-organization',
      'legacy-owner', 'legacy-conversation', 'student', 'settled', 10, 1, 1, 1, 1, 0,
      '2026-08-05T11:00:00.000Z', '2026-08-05T11:00:00.000Z'
    )
  `).run()

  database.exec(readFileSync(migrationFiles[4], 'utf8'))
  database.exec(readFileSync(migrationFiles[4], 'utf8'))
  const scope = database.prepare(`
    SELECT organization_id, owner_user_id, conversation_id, idempotency_key
    FROM ai_idempotency_scopes WHERE request_id = 'legacy-request'
  `).get()

  assert.deepEqual({ ...scope }, {
    organization_id: 'legacy-organization',
    owner_user_id: 'legacy-owner',
    conversation_id: 'legacy-conversation',
    idempotency_key: 'legacy-key',
  })
  database.exec('PRAGMA foreign_keys = OFF')
  assert.throws(
    () => database.prepare("UPDATE ai_idempotency_requests SET request_id = 'moved-request' WHERE request_id = 'legacy-request'").run(),
    /resource scope violation/,
  )
  assert.throws(
    () => database.prepare("DELETE FROM ai_idempotency_requests WHERE request_id = 'legacy-request'").run(),
    /resource scope violation/,
  )
})

test('真实 SQLite 中隐私累计三条只转私密访问规则，不创建危险复核任务', async (t) => {
  const { adapter, database } = createFixture(t)
  const { aiService, safetyService } = createServices({
    adapter,
    modelProvider: {
      listCandidates: async () => [{ id: 'model-1' }],
      generate: async () => modelResponse({ privacy: { detected: true, confidence: 0.8, category: 'private', urgency: 'none' } }),
    },
  })

  await aiService.answer(request('privacy-1', 'prompt-p1'))
  await aiService.answer(request('privacy-2', 'prompt-p2'))
  await aiService.answer(request('privacy-3', 'prompt-p3'))
  const accessRequest = await safetyService.createPrivacyAccessRequest({
    authContext: reviewAuthContext,
    request: { conversationId: 'conversation-1', purpose: 'approved-support' },
  })

  assert.equal(scalar(database, "SELECT privacy_mode AS value FROM ai_conversations WHERE id = 'conversation-1'"), 'private')
  assert.equal(accessRequest.status, 'pending')
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM privacy_access_requests'), 1)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM safety_review_tasks'), 0)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM safety_events'), 0)
})

test('真实 SQLite 危险任务保存全部阈值证据，原问题可见且并发复核只调用一次 provider', async (t) => {
  const { adapter, database } = createFixture(t)
  const { aiService, safetyService } = createServices({
    adapter,
    modelProvider: {
      listCandidates: async () => [{ id: 'model-1' }],
      generate: async () => modelResponse({ danger: { detected: true, confidence: 0.9, category: 'risk', urgency: 'high' } }),
    },
  })

  await aiService.answer(request('danger-1', 'prompt-d1'))
  await aiService.answer(request('danger-2', 'prompt-d2'))
  const third = await aiService.answer(request('danger-3', 'prompt-d3'))
  const reviewTask = await adapter.safety.getReviewTask({
    reviewTaskId: third.reviewTaskId,
    organizationId: reviewAuthContext.organizationId,
    ownerUserId: reviewAuthContext.ownerUserId,
  })
  const started = deferred()
  const release = deferred()
  let providerCalls = 0
  let capturedContext = null
  const reviewProvider = {
    review: async ({ context }) => {
      providerCalls += 1
      capturedContext = context
      started.resolve()
      await release.promise
      return {
        review_result: 'confirmed',
        risk_level: 'high',
        evidence_message_ids: reviewTask.evidenceMessageIds,
        summary_for_staff: 'needs-human-acceptance',
        implicated_candidates: [
          { candidate_user_id: 'staff-a', confidence: 0.81, reason: 'first' },
          { candidate_user_id: 'staff-a', confidence: 0.93, reason: 'deduplicated' },
        ],
        unknown_implicated_person: false,
        requires_human_review: false,
      }
    },
  }

  const first = safetyService.runSecondaryReview({ authContext: reviewAuthContext, reviewTaskId: third.reviewTaskId, reviewProvider })
  await started.promise
  const concurrent = await safetyService.runSecondaryReview({ authContext: reviewAuthContext, reviewTaskId: third.reviewTaskId, reviewProvider })
  release.resolve()
  const completed = await first
  const replay = await safetyService.runSecondaryReview({ authContext: reviewAuthContext, reviewTaskId: third.reviewTaskId, reviewProvider })
  const event = database.prepare('SELECT notification_chain_json FROM safety_events WHERE review_task_id = ?').get(third.reviewTaskId)

  assert.equal(reviewTask.evidenceMessageIds.length, 3)
  assert.equal(capturedContext.messages.some((message) => message.role === 'user' && message.content === 'prompt-d1'), true)
  assert.equal(concurrent.status, 'review_in_progress')
  assert.equal(completed.status, 'awaiting_human_acceptance')
  assert.equal(replay.status, 'awaiting_human_acceptance')
  assert.equal(providerCalls, 1)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM safety_events'), 1)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM safety_event_evidence'), 3)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM safety_implicated_candidates'), 1)
  assert.deepEqual(JSON.parse(event.notification_chain_json).map((entry) => entry.userId), ['staff-b'])
})

test('真实 SQLite 隐藏一条复核证据 assistant 消息后转人工确认且不调用 provider', async (t) => {
  const { adapter, database } = createFixture(t)
  const { aiService, safetyService } = createServices({
    adapter,
    modelProvider: {
      listCandidates: async () => [{ id: 'model-1' }],
      generate: async () => modelResponse({ danger: { detected: true, confidence: 0.9, category: 'risk', urgency: 'high' } }),
    },
  })

  await aiService.answer(request('context-missing-1', 'prompt-context-missing-1'))
  await aiService.answer(request('context-missing-2', 'prompt-context-missing-2'))
  const third = await aiService.answer(request('context-missing-3', 'prompt-context-missing-3'))
  const reviewTask = await adapter.safety.getReviewTask({
    reviewTaskId: third.reviewTaskId,
    organizationId: reviewAuthContext.organizationId,
    ownerUserId: reviewAuthContext.ownerUserId,
  })
  database.prepare("UPDATE ai_messages SET role = 'user' WHERE id = ?").run(reviewTask.evidenceMessageIds[1])

  let providerCalls = 0
  const result = await safetyService.runSecondaryReview({
    authContext: reviewAuthContext,
    reviewTaskId: third.reviewTaskId,
    reviewProvider: {
      review: async () => {
        providerCalls += 1
        return {
          review_result: 'confirmed',
          risk_level: 'high',
          evidence_message_ids: reviewTask.evidenceMessageIds,
          summary_for_staff: '不得在缺失证据时调用模型。',
          implicated_candidates: [],
          unknown_implicated_person: false,
          requires_human_review: false,
        }
      },
    },
  })

  assert.equal(result.status, 'pending_human_confirmation')
  assert.equal(providerCalls, 0)
  assert.equal(
    scalar(database, 'SELECT reason_code AS value FROM safety_events WHERE review_task_id = ?', third.reviewTaskId),
    'SECONDARY_REVIEW_CONTEXT_UNAVAILABLE',
  )
})

test('真实 SQLite claim 后追加危险证据会 supersede 旧复核，并以最新稳定全量证据重新复核', async (t) => {
  const { adapter, database } = createFixture(t)
  const { aiService, safetyService } = createServices({
    adapter,
    modelProvider: {
      listCandidates: async () => [{ id: 'model-1' }],
      generate: async () => modelResponse({ danger: { detected: true, confidence: 0.9, category: 'risk', urgency: 'high' } }),
    },
  })
  const initial = []
  for (let index = 1; index <= 3; index += 1) {
    initial.push(await aiService.answer(request(`generation-${index}`, `prompt-generation-${index}`)))
  }

  const providerStarted = deferred()
  const providerRelease = deferred()
  let firstContext
  const staleReview = safetyService.runSecondaryReview({
    authContext: reviewAuthContext,
    reviewTaskId: initial[2].reviewTaskId,
    reviewProvider: {
      review: async ({ context }) => {
        firstContext = context
        providerStarted.resolve()
        await providerRelease.promise
        return {
          review_result: 'confirmed',
          risk_level: 'high',
          evidence_message_ids: context.evidenceMessageIds,
          summary_for_staff: 'stale-review-must-not-publish',
          implicated_candidates: [],
          unknown_implicated_person: false,
          requires_human_review: false,
        }
      },
    },
  })
  await providerStarted.promise
  const appended = await Promise.all([
    aiService.answer(request('generation-4', 'prompt-generation-4')),
    aiService.answer(request('generation-5', 'prompt-generation-5')),
  ])
  providerRelease.resolve()
  const superseded = await staleReview

  assert.equal(firstContext.evidenceMessageIds.length, 3)
  assert.equal(superseded.status, 'review_superseded')
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM safety_events'), 0)
  assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM safety_review_attempts WHERE status = 'superseded'"), 1)
  const pendingTask = await adapter.safety.getReviewTask({
    reviewTaskId: initial[2].reviewTaskId,
    organizationId: reviewAuthContext.organizationId,
    ownerUserId: reviewAuthContext.ownerUserId,
  })
  assert.equal(pendingTask.status, 'pending_secondary_review')
  assert.equal(pendingTask.evidenceMessageIds.length, 5)
  assert.equal(pendingTask.evidenceGeneration, firstContext.evidenceGeneration + 2)

  const duplicateRecord = {
    id: 'duplicate-review-id-is-ignored',
    organizationId: pendingTask.organizationId,
    organizationIdAtCreation: pendingTask.organizationId,
    actorIdAtCreation: pendingTask.actorUserId,
    conversationId: pendingTask.conversationId,
    initialMessageId: appended[1].messageId,
    evidenceMessageIds: [appended[1].messageId],
    triggerReasons: pendingTask.triggerReasons,
    privacy: pendingTask.privacy,
    danger: pendingTask.danger,
    candidateUserIds: pendingTask.candidateUserIds,
    candidateCatalogIds: pendingTask.candidateCatalogIds,
    policySnapshot: pendingTask.policySnapshot,
    status: 'pending_secondary_review',
    createdAt: '2026-08-05T11:00:00.000Z',
    updatedAt: '2026-08-05T11:00:00.000Z',
  }
  adapter.transaction((tx) => tx.safety.createOrGetOpenReviewTask(duplicateRecord))
  adapter.transaction((tx) => tx.safety.createOrGetOpenReviewTask(duplicateRecord))
  const afterDuplicates = await adapter.safety.getReviewTask({
    reviewTaskId: pendingTask.id,
    organizationId: pendingTask.organizationId,
    ownerUserId: pendingTask.actorUserId,
  })
  assert.equal(afterDuplicates.evidenceGeneration, pendingTask.evidenceGeneration)
  assert.equal(afterDuplicates.evidenceMessageIds.length, 5)

  let latestContext
  const finalized = await safetyService.runSecondaryReview({
    authContext: reviewAuthContext,
    reviewTaskId: pendingTask.id,
    reviewProvider: {
      review: async ({ context }) => {
        latestContext = context
        return {
          review_result: 'confirmed',
          risk_level: 'high',
          evidence_message_ids: context.evidenceMessageIds,
          summary_for_staff: 'latest-stable-review',
          implicated_candidates: [],
          unknown_implicated_person: false,
          requires_human_review: false,
        }
      },
    },
  })
  const finalTask = await adapter.safety.getReviewTask({
    reviewTaskId: pendingTask.id,
    organizationId: pendingTask.organizationId,
    ownerUserId: pendingTask.actorUserId,
  })
  const eventEvidence = database.prepare(`
    SELECT evidence.ai_message_id
    FROM safety_event_evidence AS evidence
    JOIN safety_events AS event ON event.id = evidence.safety_event_id
    WHERE event.review_task_id = ?
    ORDER BY evidence.ai_message_id
  `).all(pendingTask.id).map((row) => row.ai_message_id)

  assert.equal(finalized.status, 'awaiting_human_acceptance')
  assert.equal(latestContext.evidenceGeneration, finalTask.evidenceGeneration)
  assert.equal(latestContext.evidenceMessageIds.length, 5)
  assert.deepEqual(new Set(latestContext.evidenceMessageIds), new Set([...initial, ...appended].map((result) => result.messageId)))
  assert.deepEqual(eventEvidence, [...finalTask.evidenceMessageIds].sort())
  assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM safety_review_attempts WHERE status = 'finalized' AND evidence_generation = 5"), 1)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM safety_review_tasks'), 1)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM safety_events'), 1)
})

test('真实 SQLite 迁移证据缺少请求链接时仍向复核上下文保留 assistant 原文', async (t) => {
  const { adapter, database } = createFixture(t)
  database.prepare(`
    INSERT INTO ai_messages (
      id, conversation_id, organization_id, organization_id_at_creation, actor_id_at_creation,
      role, content, request_id, privacy_json, danger_detected, danger_confidence, danger_json,
      provider_attempts_json, created_at, updated_at
    ) VALUES ('legacy-assistant', 'conversation-1', 'organization-1', 'organization-1', 'student-1',
      'assistant', 'legacy-danger-evidence', 'legacy-request', '{}', 1, 0.9,
      '{"detected":true,"confidence":0.9}', '[]',
      '2026-08-05T10:59:00.000Z', '2026-08-05T10:59:00.000Z')
  `).run()
  adapter.transaction((tx) => tx.safety.createOrGetOpenReviewTask({
    id: 'legacy-review',
    organizationId: 'organization-1',
    organizationIdAtCreation: 'organization-1',
    actorIdAtCreation: 'student-1',
    conversationId: 'conversation-1',
    initialMessageId: 'legacy-assistant',
    evidenceMessageIds: ['legacy-assistant'],
    triggerReasons: [{ kind: 'danger', reason: 'qualified_message_count', qualifiedMessageCount: 3 }],
    privacy: { detected: false, confidence: 0 },
    danger: { detected: true, confidence: 0.9 },
    candidateUserIds: [],
    candidateCatalogIds: ['staff-a', 'staff-b'],
    policySnapshot: { confidenceThreshold: 0.8, requiredQualifiedMessages: 3 },
    status: 'pending_secondary_review',
    createdAt: '2026-08-05T11:00:00.000Z',
    updatedAt: '2026-08-05T11:00:00.000Z',
  }))

  const context = await adapter.safety.getReviewContext({
    reviewTaskId: 'legacy-review',
    organizationId: 'organization-1',
    ownerUserId: 'student-1',
  })

  assert.deepEqual(context.evidenceMessageIds, ['legacy-assistant'])
  assert.deepEqual(context.messages, [{ id: 'legacy-assistant', role: 'assistant', content: 'legacy-danger-evidence' }])
})

test('真实 SQLite 在安全任务后结算失败会整单回滚，同键重试不重复预留或消息', async (t) => {
  const { adapter, database } = createFixture(t)
  const { aiService } = createServices({
    adapter,
    modelProvider: {
      listCandidates: async () => [{ id: 'model-1' }],
      generate: async () => modelResponse({
        danger: { detected: true, confidence: 0.2, category: 'self-harm', urgency: 'critical', explicitSelfHarmPlan: true },
      }),
    },
  })
  database.exec(`
    CREATE TRIGGER force_settlement_rollback
    BEFORE UPDATE OF reservation_state ON ai_usage_ledger
    FOR EACH ROW WHEN NEW.reservation_state = 'settled'
    BEGIN
      SELECT RAISE(ABORT, 'forced sqlite settlement failure');
    END;
  `)
  const input = request('rollback-1', 'prompt-rollback')

  await assert.rejects(aiService.answer(input), /forced sqlite settlement failure/)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM ai_messages'), 0)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM ai_message_request_links'), 0)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM ai_message_evidence'), 0)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM safety_review_tasks'), 0)
  assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM ai_usage_ledger WHERE reservation_state = 'settled'"), 0)
  assert.equal(scalar(database, "SELECT reservation_state AS value FROM ai_usage_ledger"), 'released')
  assert.equal(scalar(database, "SELECT status AS value FROM ai_idempotency_requests"), 'failed')

  database.exec('DROP TRIGGER force_settlement_rollback')
  const recovered = await aiService.answer(input)

  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM ai_messages'), 2)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM ai_message_request_links'), 1)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM ai_message_evidence'), 1)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM safety_review_tasks'), 1)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM ai_usage_ledger'), 1)
  assert.equal(scalar(database, "SELECT danger_detected AS value FROM ai_messages WHERE role = 'assistant'"), 1)
  assert.equal(scalar(database, "SELECT privacy_detected AS value FROM ai_messages WHERE role = 'assistant'"), 0)
  assert.ok(recovered.reviewTaskId)
  assert.equal(scalar(database, 'SELECT provider_cost_micros AS value FROM ai_usage_ledger'), 48)
  assert.equal(scalar(database, "SELECT reservation_state AS value FROM ai_usage_ledger"), 'settled')
  assert.equal(scalar(database, "SELECT status AS value FROM ai_idempotency_requests"), 'completed')
})

test('真实 SQLite 过期 lease 的并发重试不能覆盖已完成请求，只保留一组消息与用量', async (t) => {
  const { adapter, database } = createFixture(t)
  const clock = mutableClock()
  const started = deferred()
  const release = deferred()
  let calls = 0
  const { aiService } = createServices({
    adapter,
    clock,
    policy: { idempotencyLeaseMs: 1, maxProviderAttempts: 1 },
    modelProvider: {
      listCandidates: async () => [{ id: 'model-1' }],
      generate: async () => {
        calls += 1
        if (calls === 1) {
          started.resolve()
          await release.promise
          throw new Error('stale-test-provider-failure')
        }
        return modelResponse()
      },
    },
  })
  const input = request('lease-retry-1', 'prompt-lease')

  const stale = aiService.answer(input)
  await started.promise
  clock.advance(2)
  const recovered = await aiService.answer(input)
  release.resolve()
  await assert.rejects(stale, /no approved model produced a valid response/)
  const replay = await aiService.answer(input)

  assert.deepEqual(replay, recovered)
  assert.equal(calls, 2)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM ai_messages'), 2)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM ai_message_evidence'), 1)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM ai_usage_ledger'), 1)
  assert.equal(scalar(database, "SELECT reservation_state AS value FROM ai_usage_ledger"), 'settled')
  assert.equal(scalar(database, "SELECT status AS value FROM ai_idempotency_requests"), 'completed')
})

test('真实 SQLite 幂等键按组织、主体和会话隔离，失败重试与完成状态互不覆盖', async (t) => {
  const { adapter, database } = createFixture(t)
  database.exec(`
    INSERT INTO ai_conversations (
      id, organization_id, organization_id_at_creation, owner_user_id, actor_id_at_creation,
      book_version_id, privacy_mode, created_at, updated_at
    ) VALUES
      ('conversation-2', 'organization-1', 'organization-1', 'student-1', 'student-1',
       'book-version-1', 'standard', '2026-08-05T11:00:00.000Z', '2026-08-05T11:00:00.000Z'),
      ('conversation-b', 'organization-b', 'organization-b', 'student-b', 'student-b',
       'book-version-1', 'standard', '2026-08-05T11:00:00.000Z', '2026-08-05T11:00:00.000Z')
  `)
  let failingScopeCalls = 0
  let providerCalls = 0
  const { aiService } = createServices({
    adapter,
    policy: { maxProviderAttempts: 1 },
    modelProvider: {
      listCandidates: async () => [{ id: 'model-1' }],
      generate: async ({ request: providerRequest }) => {
        providerCalls += 1
        if (providerRequest.question === 'scope-a' && failingScopeCalls++ === 0) {
          throw new Error('test-only scoped provider failure')
        }
        return modelResponse()
      },
    },
  })
  const scopeA = request('shared-key', 'scope-a')
  const scopeASecondConversation = request('shared-key', 'scope-a-conversation-2')
  scopeASecondConversation.request.conversationId = 'conversation-2'
  const scopeB = request('shared-key', 'scope-b')
  scopeB.authContext = { organizationId: 'organization-b', userId: 'student-b', workspaceId: 'workspace-b' }
  scopeB.request.conversationId = 'conversation-b'

  await assert.rejects(aiService.answer(scopeA), /no approved model produced a valid response/)
  const resultB = await aiService.answer(scopeB)
  const recoveredA = await aiService.answer(scopeA)
  const replayA = await aiService.answer(scopeA)
  const resultA2 = await aiService.answer(scopeASecondConversation)
  await assert.rejects(
    aiService.answer(request('shared-key', 'scope-a-conflict')),
    (error) => error?.code === 'IDEMPOTENCY_KEY_REUSED',
  )

  assert.deepEqual(replayA, recoveredA)
  assert.notEqual(resultB.requestId, recoveredA.requestId)
  assert.notEqual(resultA2.requestId, recoveredA.requestId)
  assert.equal(providerCalls, 4)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM ai_idempotency_requests'), 3)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM ai_idempotency_scopes'), 3)
  assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM ai_idempotency_requests WHERE status = 'completed'"), 3)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM ai_usage_ledger'), 3)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM ai_messages'), 6)
})

test('真实 SQLite 账本保留无效主模型与 fallback 的供应商总成本，学生仅扣成功回答', async (t) => {
  const { adapter, database } = createFixture(t)
  const { aiService } = createServices({
    adapter,
    policy: { maxProviderAttempts: 2 },
    modelProvider: {
      listCandidates: async () => [{ id: 'primary' }, { id: 'fallback' }],
      generate: async ({ candidate }) => candidate.id === 'primary'
        ? modelResponse({ answer: '', usage: { inputTokens: 11, outputTokens: 6, cachedTokens: 0, costMicros: 17 } })
        : modelResponse(),
    },
  })

  await aiService.answer(request('usage-fallback-1', 'prompt-usage'))
  const ledger = database.prepare(`
    SELECT student_charge_cost_micros, provider_cost_micros, provider_attempts_json
    FROM ai_usage_ledger
  `).get()

  assert.equal(ledger.student_charge_cost_micros, 24)
  assert.equal(ledger.provider_cost_micros, 41)
  assert.deepEqual(JSON.parse(ledger.provider_attempts_json).map((attempt) => attempt.usage.costMicros), [17, 24])
})

test('真实 SQLite 拒绝跨租户或跨主体复用 conversationId，且模型看不到他人历史', async (t) => {
  const { adapter, database } = createFixture(t)
  database.prepare(`
    INSERT INTO ai_messages (
      id, conversation_id, organization_id, organization_id_at_creation, actor_id_at_creation,
      role, content, request_id, privacy_detected, privacy_confidence, privacy_json,
      danger_detected, danger_confidence, danger_json, provider_attempts_json, safe_degradation,
      created_at, updated_at
    ) VALUES ('history-a', 'conversation-1', 'organization-1', 'organization-1', 'student-1',
      'assistant', 'private-history', 'history-request-a', 1, 0.9, '{}', 0, 0, '{}', '[]', 0,
      '2026-08-05T10:59:00.000Z', '2026-08-05T10:59:00.000Z')
  `).run()
  let providerCalls = 0
  const { aiService } = createServices({
    adapter,
    modelProvider: {
      listCandidates: async () => [{ id: 'model-1' }],
      generate: async () => {
        providerCalls += 1
        return modelResponse()
      },
    },
  })

  await assert.rejects(
    aiService.answer({
      ...request('cross-org-1', 'prompt-cross-org'),
      authContext: { organizationId: 'organization-b', userId: 'student-b', workspaceId: 'workspace-b' },
    }),
    (error) => error?.code === 'RESOURCE_NOT_FOUND',
  )
  await assert.rejects(
    aiService.answer({
      ...request('cross-owner-1', 'prompt-cross-owner'),
      authContext: { organizationId: 'organization-1', userId: 'student-b', workspaceId: 'workspace-1' },
    }),
    (error) => error?.code === 'RESOURCE_NOT_FOUND',
  )

  assert.deepEqual(await adapter.ai.findRecentConversationMessages({
    organizationId: 'organization-b',
    ownerUserId: 'student-b',
    conversationId: 'conversation-1',
    limit: 10,
  }), [])
  assert.throws(() => adapter.transaction((tx) => {
    tx.ai.insertMessage({
      id: 'mixed-user',
      conversationId: 'conversation-1',
      organizationId: 'organization-1',
      organizationIdAtCreation: 'organization-1',
      actorIdAtCreation: 'student-1',
      role: 'user',
      content: 'valid-half',
      requestId: null,
      modelCandidateId: null,
      responseType: null,
      privacy: null,
      danger: null,
      providerAttempts: [],
      safeDegradation: false,
      createdAt: '2026-08-05T11:00:00.000Z',
      updatedAt: '2026-08-05T11:00:00.000Z',
    })
    tx.ai.insertMessage({
      id: 'mixed-assistant',
      conversationId: 'conversation-1',
      organizationId: 'organization-b',
      organizationIdAtCreation: 'organization-b',
      actorIdAtCreation: 'student-b',
      role: 'assistant',
      content: 'invalid-half',
      requestId: 'mixed-request',
      modelCandidateId: null,
      responseType: 'answer',
      privacy: null,
      danger: null,
      providerAttempts: [],
      safeDegradation: false,
      createdAt: '2026-08-05T11:00:00.000Z',
      updatedAt: '2026-08-05T11:00:00.000Z',
    })
  }), /resource scope violation/)

  assert.equal(providerCalls, 0)
  assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM ai_messages WHERE id IN ('mixed-user', 'mixed-assistant')"), 0)
  assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM ai_messages WHERE organization_id <> 'organization-1'"), 0)
  assert.equal(scalar(database, "SELECT COUNT(*) AS value FROM ai_messages WHERE actor_id_at_creation <> 'student-1'"), 0)
})

test('真实 SQLite 的跨租户隐私申请与复核上下文统一返回 RESOURCE_NOT_FOUND', async (t) => {
  const { adapter, database } = createFixture(t)
  const organizationResolver = createOrganizationResolver()
  const { aiService, safetyService } = createServices({
    adapter,
    organizationResolver,
    modelProvider: {
      listCandidates: async () => [{ id: 'model-1' }],
      generate: async () => modelResponse({
        privacy: { detected: true, confidence: 0.9, category: 'private', urgency: 'none' },
        danger: { detected: true, confidence: 0.9, category: 'risk', urgency: 'high' },
      }),
    },
  })
  await aiService.answer(request('scope-1', 'prompt-scope-1'))
  await aiService.answer(request('scope-2', 'prompt-scope-2'))
  const third = await aiService.answer(request('scope-3', 'prompt-scope-3'))
  let reviewCalls = 0

  await assert.rejects(
    safetyService.createPrivacyAccessRequest({
      authContext: { organizationId: 'organization-b', userId: 'staff-b', ownerUserId: 'student-1' },
      request: { conversationId: 'conversation-1', purpose: 'cross-tenant' },
    }),
    (error) => error?.code === 'RESOURCE_NOT_FOUND',
  )
  await assert.rejects(
    safetyService.createPrivacyAccessRequest({
      authContext: { organizationId: 'organization-1', userId: 'staff-b', ownerUserId: 'student-b' },
      request: { conversationId: 'conversation-1', purpose: 'cross-owner' },
    }),
    (error) => error?.code === 'RESOURCE_NOT_FOUND',
  )
  assert.equal(await adapter.safety.getReviewContext({
    reviewTaskId: third.reviewTaskId,
    organizationId: 'organization-b',
    ownerUserId: 'student-1',
  }), null)
  await assert.rejects(
    safetyService.runSecondaryReview({
      authContext: { organizationId: 'organization-b', userId: 'staff-b', ownerUserId: 'student-1' },
      reviewTaskId: third.reviewTaskId,
      reviewProvider: {
        review: async () => {
          reviewCalls += 1
          return {}
        },
      },
    }),
    (error) => error?.code === 'RESOURCE_NOT_FOUND',
  )

  assert.equal(reviewCalls, 0)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM privacy_access_requests'), 0)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM safety_events'), 0)
})

test('真实 SQLite open review 并发追加第4第5条及后续证据，不丢失也不重复建任务', async (t) => {
  const { adapter, database } = createFixture(t)
  const { aiService } = createServices({
    adapter,
    modelProvider: {
      listCandidates: async () => [{ id: 'model-1' }],
      generate: async ({ request: providerRequest }) => {
        return modelResponse({
          danger: providerRequest.question === 'prompt-append-5'
            ? {
                detected: true,
                confidence: 0.2,
                category: 'self-harm',
                urgency: 'critical',
                explicitSelfHarmTime: true,
                explicitSelfHarmMeans: true,
              }
            : { detected: true, confidence: 0.9, category: 'risk', urgency: 'high' },
          implicatedCandidates: providerRequest.question === 'prompt-append-4'
            ? [{ candidate_user_id: 'staff-a' }]
            : providerRequest.question === 'prompt-append-5'
              ? [{ candidate_user_id: 'staff-b' }]
              : [],
        })
      },
    },
  })

  const results = []
  for (let index = 1; index <= 3; index += 1) {
    results.push(await aiService.answer(request(`append-${index}`, `prompt-append-${index}`)))
  }
  results.push(...await Promise.all([
    aiService.answer(request('append-4', 'prompt-append-4')),
    aiService.answer(request('append-5', 'prompt-append-5')),
  ]))
  results.push(await aiService.answer(request('append-6', 'prompt-append-6')))
  const reviewTask = await adapter.safety.getReviewTask({
    reviewTaskId: results[2].reviewTaskId,
    organizationId: reviewAuthContext.organizationId,
    ownerUserId: reviewAuthContext.ownerUserId,
  })
  const reviewContext = await adapter.safety.getReviewContext({
    reviewTaskId: results[2].reviewTaskId,
    organizationId: reviewAuthContext.organizationId,
    ownerUserId: reviewAuthContext.ownerUserId,
  })

  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM safety_review_tasks'), 1)
  assert.equal(scalar(database, 'SELECT COUNT(*) AS value FROM safety_review_evidence'), 6)
  assert.equal(reviewTask.evidenceMessageIds.length, 6)
  assert.deepEqual(new Set(reviewTask.evidenceMessageIds), new Set(results.map((result) => result.messageId)))
  assert.equal(reviewTask.triggerReasons.some((reason) => reason.reason === 'immediate_secondary_review'), true)
  assert.equal(reviewTask.reviewEvidence.find((evidence) => evidence.messageId === results[4].messageId)?.trigger, 'immediate_secondary_review')
  assert.equal(reviewTask.danger.explicitSelfHarmTime, true)
  assert.equal(reviewTask.danger.explicitSelfHarmMeans, true)
  assert.equal(reviewTask.danger.urgency, 'critical')
  assert.deepEqual(new Set(reviewTask.candidateUserIds), new Set(['staff-a', 'staff-b']))
  assert.deepEqual(new Set(reviewTask.candidateCatalogIds), new Set(['staff-a', 'staff-b']))
  assert.deepEqual(new Set(reviewContext.evidenceMessageIds), new Set(results.map((result) => result.messageId)))
  assert.equal(reviewContext.messages.some((message) => message.role === 'user' && message.content === 'prompt-append-5'), true)
})

test('真实 SQLite 本地安全降级不扣学生额度，但保留两次 provider 成本与拦截原因', async (t) => {
  const { adapter, database } = createFixture(t)
  const { aiService } = createServices({
    adapter,
    modelProvider: {
      listCandidates: async () => [{ id: 'model-1' }],
      generate: async () => modelResponse({ citations: [{ evidenceId: 'block-2', pageNumber: 5 }] }),
    },
  })

  const result = await aiService.answer(request('safe-degradation-ledger-1', 'prompt-safe-degradation'))
  const ledger = database.prepare(`
    SELECT student_charge_cost_micros, provider_cost_micros, input_tokens, output_tokens,
           provider_attempts_json, reason_code
    FROM ai_usage_ledger
  `).get()

  assert.equal(result.safeDegradation, true)
  assert.equal(result.safeDegradationReason, 'CITATION_VALIDATION_FAILED')
  assert.equal(result.usage.studentChargeCostMicros, 0)
  assert.equal(ledger.student_charge_cost_micros, 0)
  assert.equal(ledger.provider_cost_micros, 48)
  assert.equal(ledger.input_tokens, 30)
  assert.equal(ledger.output_tokens, 18)
  assert.equal(ledger.reason_code, 'CITATION_VALIDATION_FAILED')
  const attempts = JSON.parse(ledger.provider_attempts_json)
  assert.equal(attempts.length, 2)
  assert.equal(attempts.every((attempt) => attempt.outcome === 'unsafe_response' && attempt.reason), true)
})

test('真实 SQLite 将纯剧透风险与引用失败分开记账', async (t) => {
  const { adapter, database } = createFixture(t)
  const { aiService } = createServices({
    adapter,
    modelProvider: {
      listCandidates: async () => [{ id: 'model-1' }],
      generate: async () => modelResponse({ spoilerRisk: true }),
    },
  })

  const result = await aiService.answer(request('spoiler-degradation-ledger-1', 'prompt-spoiler-degradation'))
  const ledger = database.prepare(`
    SELECT student_charge_cost_micros, provider_cost_micros, provider_attempts_json, reason_code
    FROM ai_usage_ledger
  `).get()
  const attempts = JSON.parse(ledger.provider_attempts_json)

  assert.equal(result.safeDegradation, true)
  assert.equal(result.safeDegradationReason, 'SPOILER_RISK_DETECTED')
  assert.equal(ledger.student_charge_cost_micros, 0)
  assert.equal(ledger.provider_cost_micros, 48)
  assert.equal(ledger.reason_code, 'SPOILER_RISK_DETECTED')
  assert.equal(attempts.every((attempt) => attempt.reason === 'spoiler_risk'), true)
})
