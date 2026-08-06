import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import {
  ExternalOpenAiProviderError,
  createExternalOpenAiProvider,
} from '../../../server/integration/external-openai-provider.js'
import { createAiRuntime } from '../../../server/integration/ai-runtime.js'

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => payload,
  }
}

function structuredResponse(overrides = {}) {
  return {
    answer: '这段话表达了难过，先认真回应感受，再继续了解情况。',
    responseType: 'answer',
    citations: [{ evidenceId: 'block-1', pageNumber: 1 }],
    privacy: {
      detected: true,
      confidence: 0.62,
      category: 'personal_emotion',
      urgency: 'low',
      reasons: ['包含个人情绪表达'],
    },
    danger: {
      detected: false,
      confidence: 0.31,
      category: 'emotional_distress',
      urgency: 'low',
      reasons: ['有难过表达，但没有明确计划、时间或手段'],
      explicitSelfHarmPlan: false,
      explicitSelfHarmTime: false,
      explicitSelfHarmMeans: false,
      extremeRisk: false,
    },
    implicatedCandidates: [
      { stableAccountId: 'internal-teacher-li', confidence: 0.84, reason: '自然语言别名命中候选表' },
    ],
    spoilerRisk: false,
    ...overrides,
  }
}

function providerOptions(overrides = {}) {
  return {
    env: {
      OPENAI_BASE_URL: 'https://provider.invalid/v1',
      OPENAI_API_KEY: 'test-only-not-a-secret',
      MODEL_ID: 'test-model',
    },
    ...overrides,
  }
}

function generateInput(overrides = {}) {
  return {
    candidate: { id: 'test-model', model: 'test-model' },
    logicalRequestId: 'logical-request-1',
    providerAttemptKey: 'provider-attempt-1',
    request: {
      question: '我最近有点难过，想聊聊书里的人物。',
      sources: [{ evidenceId: 'block-1', content: '人物在朋友的陪伴下说出了自己的难过。' }],
      teacherCandidates: [
        {
          stableAccountId: 'internal-teacher-li',
          displayName: '李老师',
          aliases: ['李老师'],
          role: 'class_teacher',
          classRelation: '三年级一班主教师',
          phone: 'must-not-leave-backend',
        },
      ],
    },
    ...overrides,
  }
}

function reviewResponse(overrides = {}) {
  return {
    review_result: 'likely',
    risk_level: 'high',
    evidence_message_ids: ['message-1', 'message-2'],
    summary_for_staff: '持续情绪困扰需要由校内负责人进一步确认。',
    implicated_candidates: [
      { candidate_user_id: 'internal-teacher-li', confidence: 0.84, reason: '候选表中的别名与上下文一致' },
    ],
    unknown_implicated_person: false,
    requires_human_review: false,
    ...overrides,
  }
}

function reviewInput(overrides = {}) {
  return {
    reviewTaskId: 'review-task-1',
    context: {
      evidenceGeneration: 4,
      evidenceMessageIds: ['message-1', 'message-2'],
      messages: [
        { id: 'context-user-1', role: 'user', content: '第一条经过授权的最小上下文。' },
        { id: 'message-1', role: 'assistant', content: '第一条已达阈值的模型回复。' },
        { id: 'message-2', role: 'assistant', content: '第二条已达阈值的模型回复。' },
      ],
    },
    candidateUserIds: ['internal-teacher-li'],
    ...overrides,
  }
}

test('uses only passed runtime configuration and returns the complete structured contract', async () => {
  const calls = []
  const provider = createExternalOpenAiProvider(providerOptions({
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify(structuredResponse()) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 18, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 3 } },
      })
    },
  }))

  assert.equal(provider.configured, true)
  assert.deepEqual(await provider.listCandidates(), [{ id: 'test-model', model: 'test-model' }])

  const result = await provider.generate(generateInput())
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://provider.invalid/v1/chat/completions')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-only-not-a-secret')
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'provider-attempt-1')

  const requestBody = JSON.parse(calls[0].options.body)
  const promptText = requestBody.messages.map((message) => message.content).join('\n')
  assert.doesNotMatch(promptText, /0\.8|三条|3\s*条/)
  assert.doesNotMatch(promptText, /must-not-leave-backend/)
  assert.match(promptText, /stableAccountId/)
  assert.match(promptText, /answer.*guidance.*insufficient_evidence.*off_topic/s)
  assert.match(promptText, /\{"evidenceId":"block-1"\}/)
  assert.match(promptText, /spoilerRisk.*true.*false/s)
  assert.match(promptText, /最小合法 JSON 示例/)

  assert.deepEqual(result.usage, { inputTokens: 18, outputTokens: 12, cachedTokens: 3, costMicros: 0 })
  assert.equal(result.response.answer, structuredResponse().answer)
  assert.deepEqual(result.response.implicatedCandidates, [
    {
      stableAccountId: 'internal-teacher-li',
      candidate_user_id: 'internal-teacher-li',
      confidence: 0.84,
      reason: '自然语言别名命中候选表',
    },
  ])
  assert.deepEqual(result.response.privacy.reasons, ['包含个人情绪表达'])
  assert.deepEqual(result.response.danger.reasons, ['有难过表达，但没有明确计划、时间或手段'])
})

test('normalizes only unambiguous response and citation aliases inside the backend evidence whitelist', async () => {
  const provider = createExternalOpenAiProvider(providerOptions({
    config: { maxParseRetries: 0 },
    fetchImpl: async () => jsonResponse({
      choices: [{
        message: {
          content: JSON.stringify(structuredResponse({
            responseType: 'direct_answer',
            citations: ['block-1'],
            spoilerRisk: false,
          })),
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 5, completion_tokens: 4 },
    }),
  }))

  const result = await provider.generate(generateInput())
  assert.equal(result.response.responseType, 'answer')
  assert.deepEqual(result.response.citations, [{ evidenceId: 'block-1' }])
})

test('does not coerce ambiguous spoiler severity strings into the boolean contract', async () => {
  const provider = createExternalOpenAiProvider(providerOptions({
    config: { maxParseRetries: 0 },
    fetchImpl: async () => jsonResponse({
      choices: [{
        message: { content: JSON.stringify(structuredResponse({ spoilerRisk: 'low' })) },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 5, completion_tokens: 4 },
    }),
  }))

  await assert.rejects(provider.generate(generateInput()), (error) => {
    assert.equal(error.code, 'EXTERNAL_PROVIDER_INVALID_RESPONSE')
    assert.deepEqual(error.providerUsage, { inputTokens: 5, outputTokens: 4, cachedTokens: 0, costMicros: 0 })
    return true
  })
})

test('uses the same explicit external runtime configuration for structured secondary review', async () => {
  const calls = []
  const provider = createExternalOpenAiProvider(providerOptions({
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify(reviewResponse()) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 11, completion_tokens: 9 },
      })
    },
  }))

  const result = await provider.review(reviewInput())
  assert.deepEqual(result, reviewResponse())
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'secondary-review:review-task-1:4')
  const prompt = JSON.parse(calls[0].options.body).messages.map((message) => message.content).join('\n')
  assert.match(prompt, /review_result.*confirmed.*likely.*false_positive.*uncertain/s)
  assert.match(prompt, /evidence_message_ids/)
  assert.match(prompt, /candidate_user_id/)
  assert.match(prompt, /不得决定通知链/)
})

test('缺少任一证据 assistant 消息时在发出请求前拒绝外部复核', async () => {
  let calls = 0
  const provider = createExternalOpenAiProvider(providerOptions({
    fetchImpl: async () => {
      calls += 1
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify(reviewResponse()) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 11, completion_tokens: 9 },
      })
    },
  }))
  const input = reviewInput({
    context: {
      ...reviewInput().context,
      messages: [
        { id: 'context-user-1', role: 'user', content: '第一条经过授权的最小上下文。' },
        { id: 'message-2', role: 'assistant', content: '第二条已达阈值的模型回复。' },
      ],
    },
  })

  await assert.rejects(provider.review(input), (error) => {
    assert.equal(error.code, 'EXTERNAL_PROVIDER_INVALID_REQUEST')
    assert.equal(error.category, 'validation')
    return true
  })
  assert.equal(calls, 0)
})

test('AI runtime keeps external question and review calls on the same OPENAI runtime configuration', async () => {
  const database = new DatabaseSync(':memory:')
  try {
    const runtime = createAiRuntime({
      database,
      sessionSecret: 'test-session-secret',
      env: providerOptions().env,
    })
    assert.deepEqual(await runtime.provider.listCandidates(), [{ id: 'test-model', model: 'test-model' }])
    assert.equal(runtime.reviewProvider, runtime.provider)
    assert.equal(typeof runtime.reviewProvider.review, 'function')
  } finally {
    database.close()
  }
})

test('rejects incomplete structured secondary review output before it reaches the safety domain', async (t) => {
  const cases = [
    ['empty staff summary', reviewResponse({ summary_for_staff: '' })],
    ['incomplete evidence generation', reviewResponse({ evidence_message_ids: ['message-1'] })],
    ['candidate outside backend table', reviewResponse({ implicated_candidates: [{ candidate_user_id: 'outside-candidate', confidence: 0.8, reason: 'not allowed' }] })],
  ]
  for (const [label, payload] of cases) {
    await t.test(label, async () => {
      const provider = createExternalOpenAiProvider(providerOptions({
        config: { maxParseRetries: 0 },
        fetchImpl: async () => jsonResponse({
          choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 4, completion_tokens: 3 },
        }),
      }))
      await assert.rejects(provider.review(reviewInput()), (error) => {
        assert.equal(error.code, 'EXTERNAL_PROVIDER_INVALID_RESPONSE')
        assert.deepEqual(error.providerUsage, { inputTokens: 4, outputTokens: 3, cachedTokens: 0, costMicros: 0 })
        return true
      })
    })
  }
})

test('retries invalid structured JSON a finite number of times and accounts for every attempt', async () => {
  let calls = 0
  const provider = createExternalOpenAiProvider(providerOptions({
    config: { maxParseRetries: 1 },
    fetchImpl: async () => {
      calls += 1
      return jsonResponse({
        choices: [{ message: { content: calls === 1 ? '{not-json' : JSON.stringify(structuredResponse()) }, finish_reason: 'stop' }],
        usage: calls === 1
          ? { prompt_tokens: 7, completion_tokens: 2 }
          : { prompt_tokens: 9, completion_tokens: 5 },
      })
    },
  }))

  const result = await provider.generate(generateInput())
  assert.equal(calls, 2)
  assert.deepEqual(result.usage, { inputTokens: 16, outputTokens: 7, cachedTokens: 0, costMicros: 0 })
})

test('rejects candidates outside the backend table after the configured parse retries', async () => {
  let calls = 0
  const provider = createExternalOpenAiProvider(providerOptions({
    config: { maxParseRetries: 0 },
    fetchImpl: async () => {
      calls += 1
      return jsonResponse({
        choices: [{
          message: {
            content: JSON.stringify(structuredResponse({
              implicatedCandidates: [{ stableAccountId: 'outside-candidate', confidence: 0.9, reason: '不应被接受' }],
            })),
          },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 4, completion_tokens: 3 },
      })
    },
  }))

  await assert.rejects(
    provider.generate(generateInput()),
    (error) => {
      assert.ok(error instanceof ExternalOpenAiProviderError)
      assert.equal(error.code, 'EXTERNAL_PROVIDER_INVALID_RESPONSE')
      assert.equal(error.category, 'invalid_response')
      assert.equal(error.retryable, true)
      assert.equal(error.safetyReviewRecommended, true)
      assert.deepEqual(error.providerUsage, { inputTokens: 4, outputTokens: 3, cachedTokens: 0, costMicros: 0 })
      return true
    },
  )
  assert.equal(calls, 1)
})

test('classifies provider refusal and rate limiting without exposing response details', async (t) => {
  await t.test('content refusal', async () => {
    const provider = createExternalOpenAiProvider(providerOptions({
      fetchImpl: async () => jsonResponse({
        choices: [{ message: { content: null, refusal: 'test-only refusal detail' }, finish_reason: 'content_filter' }],
        usage: { prompt_tokens: 6, completion_tokens: 0 },
      }),
    }))

    await assert.rejects(provider.generate(generateInput()), (error) => {
      assert.equal(error.code, 'EXTERNAL_PROVIDER_REFUSED')
      assert.equal(error.category, 'refusal')
      assert.equal(error.retryable, false)
      assert.equal(error.safetyReviewRecommended, true)
      assert.doesNotMatch(error.message, /test-only refusal detail/)
      assert.deepEqual(error.providerUsage, { inputTokens: 6, outputTokens: 0, cachedTokens: 0, costMicros: 0 })
      return true
    })
  })

  await t.test('rate limiting', async () => {
    const provider = createExternalOpenAiProvider(providerOptions({
      fetchImpl: async () => jsonResponse({ secret: 'must-not-be-read' }, { ok: false, status: 429 }),
    }))

    await assert.rejects(provider.generate(generateInput()), (error) => {
      assert.equal(error.code, 'EXTERNAL_PROVIDER_RATE_LIMITED')
      assert.equal(error.category, 'rate_limit')
      assert.equal(error.retryable, true)
      assert.doesNotMatch(error.message, /must-not-be-read/)
      return true
    })
  })
})

test('classifies network failures without retaining sensitive error text', async () => {
  const provider = createExternalOpenAiProvider(providerOptions({
    fetchImpl: async () => {
      throw new Error('connect failed for test-only-not-a-secret at provider.invalid')
    },
  }))

  await assert.rejects(provider.generate(generateInput()), (error) => {
    assert.equal(error.code, 'EXTERNAL_PROVIDER_NETWORK_FAILED')
    assert.equal(error.category, 'network')
    assert.equal(error.retryable, true)
    assert.equal(error.safetyReviewRecommended, true)
    assert.doesNotMatch(error.message, /test-only-not-a-secret|provider\.invalid/)
    assert.doesNotMatch(JSON.stringify(error), /test-only-not-a-secret|provider\.invalid/)
    return true
  })
})

test('stays disabled when runtime configuration is not explicitly passed', async () => {
  const provider = createExternalOpenAiProvider({ env: {}, config: {}, fetchImpl: async () => assert.fail('fetch must not run') })
  assert.equal(provider.configured, false)
  assert.deepEqual(await provider.listCandidates(), [])
  await assert.rejects(provider.generate(generateInput()), (error) => {
    assert.equal(error.code, 'EXTERNAL_PROVIDER_NOT_CONFIGURED')
    assert.equal(error.category, 'configuration')
    assert.equal(error.retryable, false)
    return true
  })
  await assert.rejects(provider.review(reviewInput()), (error) => {
    assert.equal(error.code, 'EXTERNAL_PROVIDER_NOT_CONFIGURED')
    assert.equal(error.category, 'configuration')
    return true
  })
})
