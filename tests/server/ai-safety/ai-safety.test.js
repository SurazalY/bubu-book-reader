import assert from 'node:assert/strict'
import test from 'node:test'
import { createAiService, selectReadableSources, validateCitations } from '../../../server/domains/ai/index.js'
import { createSafetyService } from '../../../server/domains/safety/index.js'
import { createTestOnlyDatabase } from './test-only-database.js'

const reviewAuthContext = { organizationId: 'organization-1', userId: 'staff-1', ownerUserId: 'student-1' }

function sequentialIds(prefix = 'test') {
  let index = 0
  return () => `${prefix}-${++index}`
}

function fixedClock() {
  return new Date('2026-08-05T10:15:00.000Z')
}

function createMutableClock() {
  let now = Date.parse('2026-08-05T10:15:00.000Z')
  const clock = () => new Date(now)
  clock.advance = (milliseconds) => {
    now += milliseconds
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

function testOnlyFingerprintHasher() {
  return {
    hash: async ({ material }) => {
      let hash = 2166136261
      for (const character of JSON.stringify(material)) {
        hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
      }
      return `test-only-opaque-${(hash >>> 0).toString(16).padStart(8, '0')}`
    },
  }
}

function baseModelResponse(overrides = {}) {
  return {
    answer: '这一页里的人物正在做出自己的选择。',
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

function createOrganizationResolver(overrides = {}) {
  return {
    listCandidates: async () => [{ candidateUserId: 'teacher-1' }, { candidateUserId: 'school-admin-1' }],
    resolveNotificationChain: async () => [
      { userId: 'teacher-1', role: 'class-teacher' },
      { userId: 'school-admin-1', role: 'school-admin' },
    ],
    ...overrides,
  }
}

function createHarness({ database, modelProvider, organizationCandidateResolver, policy, clock = fixedClock }) {
  const safetyService = createSafetyService({
    db: database,
    organizationCandidateResolver: organizationCandidateResolver || createOrganizationResolver(),
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
      db: database,
      modelProvider,
      quotaPolicy,
      safetyService,
      fingerprintHasher: testOnlyFingerprintHasher(),
      policy,
      idFactory: sequentialIds('ai'),
      clock,
    }),
  }
}

function baseRequest(overrides = {}) {
  return {
    idempotencyKey: 'request-1',
    conversationId: 'conversation-1',
    bookVersionId: 'book-version-1',
    currentPageId: 'page-2',
    readRangeVersion: 'read-range-1',
    question: '这一页里发生了什么？',
    selections: [{ pageNo: 2, blockId: 'block-2', startOffset: 0, endOffset: 4 }],
    ...overrides,
  }
}

function baseEnvelope(overrides = {}) {
  const { authContext = {}, request = {}, ...requestOverrides } = overrides
  return {
    authContext: {
      organizationId: 'organization-1',
      userId: 'student-1',
      workspaceId: 'workspace-1',
      ...authContext,
    },
    request: {
      ...baseRequest(),
      ...requestOverrides,
      ...request,
    },
  }
}

function readableDatabase(options = {}) {
  return createTestOnlyDatabase({
    evidenceBlocks: [
      { id: 'block-1', bookVersionId: 'book-version-1', pageId: 'page-1', pageNumber: 1, content: '前一页介绍了主人公的愿望。', sequence: 1 },
      { id: 'block-2', bookVersionId: 'book-version-1', pageId: 'page-2', pageNumber: 2, content: '这一页里主人公犹豫后决定去帮助朋友。', sequence: 2 },
      { id: 'block-5', bookVersionId: 'book-version-1', pageId: 'page-5', pageNumber: 5, content: '未读的后续结局在这里。', sequence: 5 },
    ],
    memoryCards: [
      {
        id: 'card-readable',
        bookVersionId: 'book-version-1',
        sourceEvidenceIds: ['block-1', 'block-2'],
        sourcePageIds: ['page-1', 'page-2'],
        content: '主人公正在学习如何帮助朋友。',
        sequence: 1,
      },
      {
        id: 'card-unread',
        bookVersionId: 'book-version-1',
        sourceEvidenceIds: ['block-5'],
        sourcePageIds: ['page-5'],
        content: '未读结局记忆卡。',
        sequence: 2,
      },
    ],
    ...options,
  })
}

function validReviewOutput(overrides = {}) {
  return {
    review_result: 'confirmed',
    risk_level: 'high',
    evidence_message_ids: ['assistant-evidence-1'],
    summary_for_staff: '需要由学校处理链进一步确认。',
    implicated_candidates: [{ candidate_user_id: 'teacher-1', confidence: 0.92, reason: '与上下文相关' }],
    unknown_implicated_person: false,
    requires_human_review: false,
    ...overrides,
  }
}

function seedReviewTask(database, taskId, conversationId = 'conversation-review') {
  const userMessageId = `user-${taskId}`
  const assistantMessageId = 'assistant-evidence-1'
  database.state.messages.push(
    { id: userMessageId, role: 'user', content: '需要复核的原始提问。' },
    { id: assistantMessageId, role: 'assistant', content: '结构化回复。' },
  )
  database.state.messageLinks.push({ logicalRequestId: `logical-${taskId}`, userMessageId, assistantMessageId })
  database.state.reviewTasks.push({
    id: taskId,
    organizationId: 'organization-1',
    conversationId,
    actorUserId: 'student-1',
    evidenceMessageIds: [assistantMessageId],
    status: 'pending_secondary_review',
    reviewAttempts: 0,
    privacy: { detected: false, confidence: 0 },
    danger: { detected: true, confidence: 0.9 },
  })
}

test('只把有效已读页的证据交给模型，并在错误页码引用后仅重试一次', async () => {
  const database = readableDatabase()
  const requests = []
  let calls = 0
  const testOnlyProvider = {
    listCandidates: async () => [{ id: 'primary' }, { id: 'fallback' }],
    generate: async ({ request }) => {
      requests.push(request)
      calls += 1
      return calls === 1
        ? baseModelResponse({ citations: [{ evidenceId: 'block-2', pageNumber: 5 }] })
        : baseModelResponse()
    },
  }
  const { aiService } = createHarness({ database, modelProvider: testOnlyProvider })

  const result = await aiService.answer(baseEnvelope())

  assert.equal(requests.length, 2)
  assert.equal(requests[1].strictSpoilerMode, true)
  assert.equal(requests[0].sources.some((source) => source.pageNumber === 5 || source.content === '未读结局记忆卡。'), false)
  assert.equal(result.safeDegradation, false)
  assert.deepEqual(result.citations, [{ evidenceId: 'block-2', pageId: 'page-2', pageNumber: 2, coordinates: null }])
  assert.deepEqual(database.state.messages.map((message) => message.role), ['user', 'assistant'])
  assert.equal(database.state.messageEvidence.length, 1)
  assert.equal(database.state.usageLedger[0].reservationState, 'settled')
})

test('第二次无效引用后只保存安全退化引导，不猜测未读剧情', async () => {
  const database = readableDatabase()
  const testOnlyProvider = {
    listCandidates: async () => [{ id: 'primary' }, { id: 'fallback' }],
    generate: async () => baseModelResponse({ citations: [{ evidenceId: 'block-2', pageNumber: 5 }] }),
  }
  const { aiService } = createHarness({ database, modelProvider: testOnlyProvider })

  const result = await aiService.answer(baseEnvelope({ idempotencyKey: 'request-safe-degradation' }))

  assert.equal(result.safeDegradation, true)
  assert.equal(result.responseType, 'guidance')
  assert.deepEqual(result.citations, [])
  assert.equal(result.usage.studentChargeCostMicros, 0)
  assert.equal(result.usage.providerCostMicros, 48)
  assert.equal(result.safeDegradationReason, 'CITATION_VALIDATION_FAILED')
  assert.equal(database.state.messages.length, 2)
  assert.equal(database.state.messages[1].safeDegradation, true)
})

test('无效主模型的真实成本与 fallback 成本都进入账本，学生只扣成功回答一次', async () => {
  const database = readableDatabase()
  const testOnlyProvider = {
    listCandidates: async () => [{ id: 'primary' }, { id: 'fallback' }],
    generate: async ({ candidate }) =>
      candidate.id === 'primary'
        ? baseModelResponse({ answer: '', usage: { inputTokens: 11, outputTokens: 6, cachedTokens: 0, costMicros: 17 } })
        : baseModelResponse(),
  }
  const { aiService } = createHarness({ database, modelProvider: testOnlyProvider, policy: { maxProviderAttempts: 2 } })

  const result = await aiService.answer(baseEnvelope({ idempotencyKey: 'request-provider-usage' }))

  assert.equal(result.usage.studentChargeCostMicros, 24)
  assert.equal(result.usage.providerCostMicros, 41)
  assert.equal(database.state.usageLedger[0].providerUsage.costMicros, 41)
  assert.deepEqual(database.state.usageLedger[0].providerAttempts.map((attempt) => attempt.outcome), ['provider_error', 'accepted'])
})

test('供应商抛错但返回已计费用量时，该次成本也不会从 providerUsage 丢失', async () => {
  const database = readableDatabase()
  const testOnlyProvider = {
    listCandidates: async () => [{ id: 'primary' }, { id: 'fallback' }],
    generate: async ({ candidate }) => {
      if (candidate.id === 'primary') {
        const error = new Error('test-only billed provider failure')
        error.providerUsage = { inputTokens: 8, outputTokens: 4, cachedTokens: 0, costMicros: 12 }
        throw error
      }
      return baseModelResponse()
    },
  }
  const { aiService } = createHarness({ database, modelProvider: testOnlyProvider, policy: { maxProviderAttempts: 2 } })

  await aiService.answer(baseEnvelope({ idempotencyKey: 'request-thrown-provider-usage' }))

  assert.equal(database.state.usageLedger[0].providerUsage.costMicros, 36)
  assert.deepEqual(database.state.usageLedger[0].providerAttempts.map((attempt) => attempt.usage.costMicros), [12, 24])
})

test('失败时 user、assistant、引用、风险和 usage 整笔回滚，同键重试不重复预留或消息', async () => {
  const database = readableDatabase({ failOnMessageEvidence: true })
  const testOnlyProvider = {
    listCandidates: async () => [{ id: 'primary' }],
    generate: async () => baseModelResponse(),
  }
  const { aiService } = createHarness({ database, modelProvider: testOnlyProvider })
  const input = baseEnvelope({ idempotencyKey: 'request-atomic-retry' })

  await assert.rejects(aiService.answer(input), /test-only evidence insert failure/)
  assert.equal(database.state.messages.length, 0)
  assert.equal(database.state.messageLinks.length, 0)
  assert.equal(database.state.messageEvidence.length, 0)
  assert.equal(database.state.reviewTasks.length, 0)
  assert.equal(database.state.usageLedger.length, 1)
  assert.equal(database.state.usageLedger[0].reservationState, 'released')
  assert.equal(database.state.idempotencyRecords[0].status, 'failed')

  database.state.failOnMessageEvidence = false
  const retried = await aiService.answer(input)

  assert.equal(retried.messageId, database.state.messages[1].id)
  assert.deepEqual(database.state.messages.map((message) => message.role), ['user', 'assistant'])
  assert.equal(database.state.messageLinks.length, 1)
  assert.equal(database.state.messageEvidence.length, 1)
  assert.equal(database.state.usageLedger.length, 1)
  assert.equal(database.state.usageLedger[0].reservationState, 'settled')
  assert.equal(database.state.usageLedger[0].providerUsage.costMicros, 48)
  assert.equal(database.state.idempotencyRecords[0].status, 'completed')
})

test('隐私累计三条只把会话设为私密并进入访问申请规则，危险事件保持为零', async () => {
  const database = readableDatabase({ qualifiedMessageIds: { privacy: ['assistant-privacy-1', 'assistant-privacy-2'], danger: [] } })
  const safetyService = createSafetyService({
    db: database,
    organizationCandidateResolver: createOrganizationResolver(),
    idFactory: sequentialIds('privacy'),
    clock: fixedClock,
  })
  const assessment = await database.transaction((tx) =>
    safetyService.evaluateResponse({
      tx,
      organizationId: 'organization-1',
      conversationId: 'conversation-privacy',
      actorUserId: 'student-1',
      privacy: { detected: true, confidence: 0.8 },
      danger: { detected: false, confidence: 0 },
      candidateUserIds: [],
      candidateCatalogIds: ['teacher-1', 'school-admin-1'],
    }),
  )
  const persisted = await database.transaction((tx) =>
    safetyService.persistResponse(tx, {
      assessment,
      organizationId: 'organization-1',
      conversationId: 'conversation-privacy',
      actorUserId: 'student-1',
      userMessageId: 'user-privacy-3',
      assistantMessageId: 'assistant-privacy-3',
    }),
  )
  const accessRequest = await safetyService.createPrivacyAccessRequest({
    authContext: reviewAuthContext,
    request: { conversationId: 'conversation-privacy', purpose: '处理已获授权的学习支持请求' },
  })

  assert.equal(assessment.privacyAccessRequired, true)
  assert.equal(assessment.dangerReviewRequired, false)
  assert.equal(persisted.reviewTask, null)
  assert.equal(database.state.privateConversations[0].privacyMode, 'private')
  assert.equal(accessRequest.status, 'pending')
  assert.equal(database.state.reviewTasks.length, 0)
  assert.equal(database.state.safetyEvents.length, 0)
})

test('危险累计任务携带达到阈值的全部消息，第四第五条不为未完成风险重复建任务', async () => {
  const database = readableDatabase({ qualifiedMessageIds: { privacy: [], danger: ['assistant-danger-1', 'assistant-danger-2'] } })
  const safetyService = createSafetyService({
    db: database,
    organizationCandidateResolver: createOrganizationResolver(),
    idFactory: sequentialIds('danger'),
    clock: fixedClock,
  })
  const assessAndPersist = async (assistantMessageId) => {
    const assessment = await database.transaction((tx) =>
      safetyService.evaluateResponse({
        tx,
        organizationId: 'organization-1',
        conversationId: 'conversation-danger',
        actorUserId: 'student-1',
        privacy: { detected: false, confidence: 0 },
        danger: { detected: true, confidence: 0.8 },
        candidateUserIds: [],
        candidateCatalogIds: ['teacher-1', 'school-admin-1'],
      }),
    )
    return database.transaction((tx) =>
      safetyService.persistResponse(tx, {
        assessment,
        organizationId: 'organization-1',
        conversationId: 'conversation-danger',
        actorUserId: 'student-1',
        userMessageId: `user-${assistantMessageId}`,
        assistantMessageId,
      }),
    )
  }

  await assessAndPersist('assistant-danger-3')
  database.state.qualifiedMessageIds.danger.push('assistant-danger-3')
  await assessAndPersist('assistant-danger-4')
  database.state.qualifiedMessageIds.danger.push('assistant-danger-4')
  await assessAndPersist('assistant-danger-5')

  assert.equal(database.state.reviewTasks.length, 1)
  assert.deepEqual(database.state.reviewTasks[0].evidenceMessageIds, [
    'assistant-danger-1',
    'assistant-danger-2',
    'assistant-danger-3',
    'assistant-danger-4',
    'assistant-danger-5',
  ])
  assert.equal(database.state.safetyEvents.length, 0)
})

test('单条明确自伤信号只进入二次复核，复核上下文能取得原始用户提问', async () => {
  const database = readableDatabase()
  const testOnlyProvider = {
    listCandidates: async () => [{ id: 'primary' }],
    generate: async () =>
      baseModelResponse({
        danger: { detected: true, confidence: 0.2, explicitSelfHarmPlan: true, urgency: 'high' },
      }),
  }
  const { aiService } = createHarness({ database, modelProvider: testOnlyProvider })

  const result = await aiService.answer(baseEnvelope({ idempotencyKey: 'request-immediate-danger' }))
  const context = await database.safety.getReviewContext({
    reviewTaskId: result.reviewTaskId,
    organizationId: reviewAuthContext.organizationId,
    ownerUserId: reviewAuthContext.ownerUserId,
  })

  assert.equal(database.state.reviewTasks.length, 1)
  assert.deepEqual(database.state.reviewTasks[0].evidenceMessageIds, [result.messageId])
  assert.equal(database.state.safetyEvents.length, 0)
  assert.deepEqual(context.messages.map((message) => message.role), ['user', 'assistant'])
})

test('二次复核以原子 claim 防并发重复调用，事件唯一且涉事候选去重', async () => {
  const database = readableDatabase()
  seedReviewTask(database, 'review-concurrent')
  const safetyService = createSafetyService({
    db: database,
    organizationCandidateResolver: createOrganizationResolver(),
    idFactory: sequentialIds('review'),
    clock: fixedClock,
  })
  const started = deferred()
  const releaseFirst = deferred()
  let providerCalls = 0
  let capturedContext
  const reviewProvider = {
    review: async ({ context }) => {
      providerCalls += 1
      capturedContext = context
      started.resolve()
      await releaseFirst.promise
      return validReviewOutput({
        implicated_candidates: [
          { candidate_user_id: 'teacher-1', confidence: 0.81, reason: '首次候选' },
          { candidate_user_id: 'teacher-1', confidence: 0.92, reason: '更高置信候选' },
        ],
      })
    },
  }

  const first = safetyService.runSecondaryReview({ authContext: reviewAuthContext, reviewTaskId: 'review-concurrent', reviewProvider })
  await started.promise
  const second = await safetyService.runSecondaryReview({ authContext: reviewAuthContext, reviewTaskId: 'review-concurrent', reviewProvider })
  releaseFirst.resolve()
  const completed = await first
  const repeated = await safetyService.runSecondaryReview({ authContext: reviewAuthContext, reviewTaskId: 'review-concurrent', reviewProvider })

  assert.equal(second.status, 'review_in_progress')
  assert.equal(completed.status, 'awaiting_human_acceptance')
  assert.equal(repeated.status, 'awaiting_human_acceptance')
  assert.equal(providerCalls, 1)
  assert.equal(database.state.safetyEvents.length, 1)
  assert.equal(database.state.implicatedCandidates.length, 1)
  assert.deepEqual(completed.notificationChain.map((handler) => handler.userId), ['school-admin-1'])
  assert.deepEqual(capturedContext.messages.map((message) => message.role), ['user', 'assistant'])
})

test('复核输出缺证据或缺 staff 摘要转人工确认，重复调用不重复建事件', async () => {
  const database = readableDatabase()
  seedReviewTask(database, 'review-invalid', 'conversation-review-invalid')
  const safetyService = createSafetyService({
    db: database,
    organizationCandidateResolver: createOrganizationResolver(),
    idFactory: sequentialIds('invalid-review'),
    clock: fixedClock,
  })
  let providerCalls = 0
  const reviewProvider = {
    review: async () => {
      providerCalls += 1
      return validReviewOutput({ evidence_message_ids: [], summary_for_staff: '' })
    },
  }

  const first = await safetyService.runSecondaryReview({ authContext: reviewAuthContext, reviewTaskId: 'review-invalid', reviewProvider })
  const second = await safetyService.runSecondaryReview({ authContext: reviewAuthContext, reviewTaskId: 'review-invalid', reviewProvider })

  assert.equal(first.status, 'pending_human_confirmation')
  assert.equal(second.status, 'pending_human_confirmation')
  assert.equal(providerCalls, 1)
  assert.equal(database.state.safetyEvents.length, 1)
  assert.equal(database.state.safetyEvents[0].summaryForStaff, null)
})

test('已确认复核缺少 staff 摘要同样不能发布正式待接受事件', async () => {
  const database = readableDatabase()
  seedReviewTask(database, 'review-missing-summary', 'conversation-review-summary')
  const safetyService = createSafetyService({
    db: database,
    organizationCandidateResolver: createOrganizationResolver(),
    idFactory: sequentialIds('summary-review'),
    clock: fixedClock,
  })

  const result = await safetyService.runSecondaryReview({
    authContext: reviewAuthContext,
    reviewTaskId: 'review-missing-summary',
    reviewProvider: { review: async () => validReviewOutput({ summary_for_staff: '' }) },
  })

  assert.equal(result.status, 'pending_human_confirmation')
  assert.equal(database.state.safetyEvents.length, 1)
})

test('没有合格通知人的已确认风险转人工确认，不生成无人可见的待接受事件', async () => {
  const database = readableDatabase()
  seedReviewTask(database, 'review-no-handler', 'conversation-review-no-handler')
  const safetyService = createSafetyService({
    db: database,
    organizationCandidateResolver: createOrganizationResolver({ resolveNotificationChain: async () => [] }),
    idFactory: sequentialIds('no-handler'),
    clock: fixedClock,
  })

  const result = await safetyService.runSecondaryReview({
    authContext: reviewAuthContext,
    reviewTaskId: 'review-no-handler',
    reviewProvider: { review: async () => validReviewOutput({ implicated_candidates: [] }) },
  })

  assert.equal(result.status, 'pending_human_confirmation')
  assert.equal(database.state.safetyEvents[0].notificationChain.length, 0)
})

test('过期的二次复核租约可由后续调用接手并只产一条事件', async () => {
  const database = readableDatabase()
  seedReviewTask(database, 'review-expired-lease', 'conversation-review-expired')
  Object.assign(database.state.reviewTasks[0], {
    status: 'review_claimed',
    reviewLeaseToken: 'stale-review-lease',
    reviewLeaseExpiresAt: '2026-08-05T10:14:59.000Z',
  })
  const safetyService = createSafetyService({
    db: database,
    organizationCandidateResolver: createOrganizationResolver(),
    idFactory: sequentialIds('expired-review'),
    clock: fixedClock,
  })
  let providerCalls = 0

  const result = await safetyService.runSecondaryReview({
    authContext: reviewAuthContext,
    reviewTaskId: 'review-expired-lease',
    reviewProvider: {
      review: async () => {
        providerCalls += 1
        return validReviewOutput()
      },
    },
  })

  assert.equal(result.status, 'awaiting_human_acceptance')
  assert.equal(providerCalls, 1)
  assert.equal(database.state.safetyEvents.length, 1)
})

test('通知链计算失败转人工确认，后续重试不重复调用模型或创建事件', async () => {
  const database = readableDatabase()
  seedReviewTask(database, 'review-chain-failure', 'conversation-review-chain-failure')
  const safetyService = createSafetyService({
    db: database,
    organizationCandidateResolver: createOrganizationResolver({
      resolveNotificationChain: async () => {
        throw new Error('test-only notification chain failure')
      },
    }),
    idFactory: sequentialIds('chain-review'),
    clock: fixedClock,
  })
  let providerCalls = 0
  const reviewProvider = {
    review: async () => {
      providerCalls += 1
      return validReviewOutput()
    },
  }

  const first = await safetyService.runSecondaryReview({ authContext: reviewAuthContext, reviewTaskId: 'review-chain-failure', reviewProvider })
  const second = await safetyService.runSecondaryReview({ authContext: reviewAuthContext, reviewTaskId: 'review-chain-failure', reviewProvider })

  assert.equal(first.status, 'pending_human_confirmation')
  assert.equal(second.status, 'pending_human_confirmation')
  assert.equal(providerCalls, 1)
  assert.equal(database.state.safetyEvents.length, 1)
  assert.equal(database.state.safetyEvents[0].reasonCode, 'NOTIFICATION_CHAIN_UNAVAILABLE')
})

test('过期 claim 的失败 worker 不能覆盖并发重试完成的统一落盘结果', async () => {
  const database = readableDatabase()
  const clock = createMutableClock()
  const firstProviderStarted = deferred()
  const releaseFirstProvider = deferred()
  let generationCalls = 0
  const providerAttemptKeys = []
  const testOnlyProvider = {
    listCandidates: async () => [{ id: 'primary' }],
    generate: async ({ providerAttemptKey }) => {
      generationCalls += 1
      providerAttemptKeys.push(providerAttemptKey)
      if (generationCalls === 1) {
        firstProviderStarted.resolve()
        await releaseFirstProvider.promise
        throw new Error('test-only stale worker failure')
      }
      return baseModelResponse()
    },
  }
  const { aiService } = createHarness({
    database,
    modelProvider: testOnlyProvider,
    clock,
    policy: { maxProviderAttempts: 1, idempotencyLeaseMs: 1 },
  })
  const input = baseEnvelope({ idempotencyKey: 'request-concurrent-lease' })

  const staleWorker = aiService.answer(input)
  await firstProviderStarted.promise
  clock.advance(2)
  const recovered = await aiService.answer(input)
  releaseFirstProvider.resolve()
  await assert.rejects(staleWorker, /no approved model produced a valid response/)
  const replay = await aiService.answer(input)

  assert.equal(generationCalls, 2)
  assert.equal(providerAttemptKeys[0], providerAttemptKeys[1])
  assert.equal(providerAttemptKeys[0].includes(baseRequest().question), false)
  assert.deepEqual(replay, recovered)
  assert.equal(database.state.idempotencyRecords[0].status, 'completed')
  assert.equal(database.state.usageLedger.length, 1)
  assert.equal(database.state.usageLedger[0].reservationState, 'settled')
  assert.deepEqual(database.state.messages.map((message) => message.role), ['user', 'assistant'])
  assert.equal(database.state.messageEvidence.length, 1)
  assert.equal(database.state.messageLinks.length, 1)
})

test('认证身份与普通请求分离，指纹不保存原问，超长或非法选文不会调用模型', async () => {
  const database = readableDatabase()
  let generationCalls = 0
  const testOnlyProvider = {
    listCandidates: async () => [{ id: 'primary' }],
    generate: async () => {
      generationCalls += 1
      return baseModelResponse()
    },
  }
  const { aiService } = createHarness({ database, modelProvider: testOnlyProvider, policy: { maxQuestionCharacters: 32, maxSelectedBlockIds: 1, maxSelectionCharacters: 128 } })

  await assert.rejects(
    aiService.answer(baseEnvelope({ request: { organizationId: 'body-organization' } })),
    (error) => error?.code === 'INVALID_REQUEST',
  )
  await assert.rejects(aiService.answer(baseEnvelope({ idempotencyKey: 'request-too-long', question: '字'.repeat(33) })), (error) => error?.code === 'QUESTION_TOO_LONG')
  await assert.rejects(
    aiService.answer(baseEnvelope({
      idempotencyKey: 'request-block-limit',
      selections: [
        { pageNo: 1, blockId: 'block-1', startOffset: 0, endOffset: 1 },
        { pageNo: 2, blockId: 'block-2', startOffset: 0, endOffset: 1 },
      ],
    })),
    (error) => error?.code === 'TOO_MANY_SELECTED_BLOCKS',
  )
  await assert.rejects(
    aiService.answer(baseEnvelope({
      idempotencyKey: 'request-range-limit',
      selections: [{ pageNo: 2, blockId: 'block-2', startOffset: 0, endOffset: 129 }],
    })),
    (error) => error?.code === 'INVALID_SELECTION_RANGE',
  )
  const result = await aiService.answer(baseEnvelope({ idempotencyKey: 'request-digest' }))
  await assert.rejects(
    aiService.answer(baseEnvelope({ idempotencyKey: 'request-digest', question: '另一个问题' })),
    (error) => error?.code === 'IDEMPOTENCY_KEY_REUSED',
  )
  const storedFingerprint = database.state.idempotencyRecords.find((record) => record.requestId === result.requestId).fingerprint

  assert.equal(generationCalls, 1)
  assert.equal(storedFingerprint.includes(baseRequest().question), false)
  assert.equal(database.state.idempotencyRecords[0].fingerprint.includes('organizationId'), false)
})

test('跨页 selections 保留每页锚点并由服务端按 block 重建引用文本', async () => {
  const database = readableDatabase()
  const providerRequests = []
  const testOnlyProvider = {
    listCandidates: async () => [{ id: 'primary' }],
    generate: async ({ request }) => {
      providerRequests.push(request)
      return baseModelResponse()
    },
  }
  const { aiService } = createHarness({
    database,
    modelProvider: testOnlyProvider,
    policy: { maxSelectedBlockIds: 2, maxSelectionCharacters: 128 },
  })
  const selections = [
    { pageNo: 1, blockId: 'block-1', startOffset: 0, endOffset: 3 },
    { pageNo: 2, blockId: 'block-2', startOffset: 4, endOffset: 9 },
  ]

  await aiService.answer(baseEnvelope({
    idempotencyKey: 'request-cross-page-selections',
    selections,
  }))

  assert.equal(providerRequests.length, 1)
  assert.deepEqual(providerRequests[0].selections, selections)
  assert.equal(providerRequests[0].selectionText, '前一页\n主人公犹豫')
  assert.equal(Object.hasOwn(providerRequests[0], 'quotes'), false)
})

test('记忆卡只要求全部来源已读，非 lexical top 的来源仍随卡片带入并可引用', () => {
  const sources = selectReadableSources({
    bookVersionId: 'book-version-1',
    validReadPageIds: ['page-1', 'page-2', 'page-3', 'page-4'],
    currentPageId: 'page-2',
    question: '当前页人物的选择',
    selectedBlockIds: ['block-2'],
    limit: 4,
    evidenceBlocks: [
      { id: 'block-1', bookVersionId: 'book-version-1', pageId: 'page-1', pageNumber: 1, content: '可追溯的早期铺垫。', sequence: 1 },
      { id: 'block-2', bookVersionId: 'book-version-1', pageId: 'page-2', pageNumber: 2, content: '当前页人物作出选择。', sequence: 2 },
      { id: 'block-3', bookVersionId: 'book-version-1', pageId: 'page-3', pageNumber: 3, content: '人物选择带来影响。', sequence: 3 },
      { id: 'block-4', bookVersionId: 'book-version-1', pageId: 'page-4', pageNumber: 4, content: '选择让关系发生变化。', sequence: 4 },
    ],
    memoryCards: [
      {
        id: 'card-early',
        bookVersionId: 'book-version-1',
        sourceEvidenceIds: ['block-1'],
        sourcePageIds: ['page-1'],
        content: '这段关系的早期铺垫仍与当前选择相关。',
        sequence: 1,
      },
    ],
  })
  const citationCheck = validateCitations({
    citations: [{ evidenceId: 'block-1', pageNumber: 1 }],
    sources,
    bookVersionId: 'book-version-1',
    validReadPageIds: ['page-1', 'page-2', 'page-3', 'page-4'],
    responseType: 'answer',
  })

  assert.equal(sources.some((source) => source.sourceType === 'memory_card' && source.memoryCardId === 'card-early'), true)
  assert.equal(sources.some((source) => source.sourceType === 'evidence_block' && source.evidenceId === 'block-1'), true)
  assert.equal(citationCheck.valid, true)
})
