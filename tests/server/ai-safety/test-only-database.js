const OPEN_REVIEW_STATUSES = new Set(['pending_secondary_review', 'review_claimed', 'pending_human_confirmation', 'awaiting_human_acceptance'])

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.length > 0))]
}

function leaseIsActive(expiresAt, now) {
  const expiresAtMs = Date.parse(expiresAt || '')
  const nowMs = Date.parse(now || '')
  return Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) && expiresAtMs > nowMs
}

function taskOwnerId(task) {
  return task?.actorIdAtCreation ?? task?.actorUserId
}

function mergeTriggerReasons(existingReasons, incomingReasons) {
  const merged = new Map()
  for (const reason of [...(existingReasons || []), ...(incomingReasons || [])]) {
    const key = `${reason?.kind || ''}:${reason?.reason || ''}`
    const existing = merged.get(key)
    if (!existing || (Number(reason?.qualifiedMessageCount) || 0) > (Number(existing?.qualifiedMessageCount) || 0)) {
      merged.set(key, reason)
    }
  }
  return [...merged.values()]
}

export function createTestOnlyDatabase(options = {}) {
  const state = {
    readScope: options.readScope || { currentPageId: 'page-2', pageIds: ['page-1', 'page-2'] },
    evidenceBlocks: options.evidenceBlocks || [],
    memoryCards: options.memoryCards || [],
    recentMessages: options.recentMessages || [],
    qualifiedMessageIds: options.qualifiedMessageIds || { privacy: [], danger: [] },
    idempotencyRecords: options.idempotencyRecords || [],
    usageLedger: options.usageLedger || [],
    messages: options.messages || [],
    messageLinks: options.messageLinks || [],
    messageEvidence: options.messageEvidence || [],
    privateConversations: options.privateConversations || [],
    privacyAccessRequests: options.privacyAccessRequests || [],
    reviewTasks: options.reviewTasks || [],
    safetyEvents: options.safetyEvents || [],
    reviewAttempts: options.reviewAttempts || [],
    eventEvidence: options.eventEvidence || [],
    implicatedCandidates: options.implicatedCandidates || [],
    failOnMessageEvidence: Boolean(options.failOnMessageEvidence),
  }
  let transactionTail = Promise.resolve()

  function restore(snapshot) {
    for (const key of Object.keys(state)) delete state[key]
    Object.assign(state, snapshot)
  }

  function findIdempotencyRecord({ key, organizationId, ownerUserId, conversationId }) {
    return state.idempotencyRecords.find((record) => record.key === key
      && record.organizationId === organizationId
      && record.ownerUserId === ownerUserId
      && record.conversationId === conversationId) || null
  }

  function findLedger(requestId) {
    return state.usageLedger.find((ledger) => ledger.requestId === requestId) || null
  }

  function transactionPort() {
    return {
      idempotency: {
        get: (input) => findIdempotencyRecord(input),
        claim: ({ key, organizationId, ownerUserId, conversationId, fingerprint, requestId, leaseToken, claimedAt, leaseExpiresAt }) => {
          const scope = { key, organizationId, ownerUserId, conversationId }
          const existing = findIdempotencyRecord(scope)
          if (!existing) {
            const record = {
              ...scope,
              key,
              fingerprint,
              requestId,
              status: 'in_progress',
              leaseToken,
              claimedAt,
              leaseExpiresAt,
            }
            state.idempotencyRecords.push(record)
            return { outcome: 'claimed', requestId, leaseToken, reservationAction: 'reserve' }
          }
          if (existing.fingerprint !== fingerprint) return { outcome: 'conflict' }
          if (existing.status === 'completed') return { outcome: 'replay', response: existing.response }
          if (existing.status === 'in_progress' && leaseIsActive(existing.leaseExpiresAt, claimedAt)) {
            return { outcome: 'busy', record: existing }
          }
          const reservationAction = existing.status === 'failed' ? 'reacquire' : findLedger(existing.requestId) ? 'reuse' : 'reserve'
          Object.assign(existing, {
            status: 'in_progress',
            leaseToken,
            claimedAt,
            leaseExpiresAt,
            reasonCode: null,
          })
          return { outcome: 'claimed', requestId: existing.requestId, leaseToken, reservationAction }
        },
        complete: ({ key, organizationId, ownerUserId, conversationId, fingerprint, leaseToken, response, completedAt }) => {
          const record = findIdempotencyRecord({ key, organizationId, ownerUserId, conversationId })
          if (!record || record.fingerprint !== fingerprint || record.status !== 'in_progress' || record.leaseToken !== leaseToken) return false
          Object.assign(record, {
            status: 'completed',
            response,
            completedAt,
            leaseToken: null,
            leaseExpiresAt: null,
          })
          return true
        },
        fail: ({ key, organizationId, ownerUserId, conversationId, fingerprint, leaseToken, reasonCode, failedAt }) => {
          const record = findIdempotencyRecord({ key, organizationId, ownerUserId, conversationId })
          if (!record || record.fingerprint !== fingerprint || record.status !== 'in_progress' || record.leaseToken !== leaseToken) return false
          Object.assign(record, {
            status: 'failed',
            reasonCode,
            failedAt,
            leaseToken: null,
            leaseExpiresAt: null,
          })
          return true
        },
      },
      usage: {
        reserve: (record) => {
          if (findLedger(record.requestId)) throw new Error('test-only duplicate reservation')
          const ledger = {
            id: `ledger-${state.usageLedger.length + 1}`,
            ...record,
            reservationState: 'reserved',
            providerUsage: null,
            providerAttempts: [],
          }
          state.usageLedger.push(ledger)
          return ledger
        },
        reacquire: ({ requestId, leaseToken, claimedAt, key, organizationId, ownerUserId, conversationId }) => {
          const ledger = findLedger(requestId)
          if (!ledger || ledger.organizationId !== organizationId || ledger.userId !== ownerUserId || ledger.conversationId !== conversationId) return null
          const record = findIdempotencyRecord({ key, organizationId, ownerUserId, conversationId })
          if (!record || record.status !== 'in_progress' || record.leaseToken !== leaseToken) return null
          Object.assign(ledger, { reservationState: 'reserved', reacquiredAt: claimedAt })
          return ledger
        },
        getReservation: ({ requestId, key, organizationId, ownerUserId, conversationId }) => {
          const record = findIdempotencyRecord({ key, organizationId, ownerUserId, conversationId })
          const ledger = findLedger(requestId)
          return record?.requestId === requestId
            && ledger?.organizationId === organizationId
            && ledger?.userId === ownerUserId
            && ledger?.conversationId === conversationId
            ? ledger
            : null
        },
        settle: ({ requestId, leaseToken, assistantMessageId, settlement, providerUsage, attempts, reasonCode, settledAt, key, organizationId, ownerUserId, conversationId }) => {
          const record = findIdempotencyRecord({ key, organizationId, ownerUserId, conversationId })
          const ledger = findLedger(requestId)
          if (!record || record.requestId !== requestId || !ledger || ledger.organizationId !== organizationId || ledger.userId !== ownerUserId || ledger.conversationId !== conversationId || record.status !== 'in_progress' || record.leaseToken !== leaseToken) return false
          Object.assign(ledger, {
            assistantMessageId,
            settlement,
            providerUsage,
            providerAttempts: attempts,
            reasonCode: reasonCode || null,
            settledAt,
            reservationState: 'settled',
          })
          return true
        },
        release: ({ requestId, leaseToken, providerUsage, attempts, reasonCode, releasedAt, key, organizationId, ownerUserId, conversationId }) => {
          const ledger = findLedger(requestId)
          const record = findIdempotencyRecord({ key, organizationId, ownerUserId, conversationId })
          if (!ledger || ledger.organizationId !== organizationId || ledger.userId !== ownerUserId || ledger.conversationId !== conversationId || !record || record.requestId !== requestId || record.status !== 'failed') return false
          Object.assign(ledger, {
            providerUsage,
            providerAttempts: attempts,
            reasonCode,
            releasedAt,
            reservationState: 'released',
          })
          return true
        },
      },
      ai: {
        assertConversationAccess: () => true,
        insertMessage: (record) => {
          state.messages.push({ ...record })
        },
        insertMessageLink: (record) => {
          if (state.messageLinks.some((link) => link.logicalRequestId === record.logicalRequestId || link.userMessageId === record.userMessageId || link.assistantMessageId === record.assistantMessageId)) {
            throw new Error('test-only duplicate message link')
          }
          state.messageLinks.push({ ...record })
        },
        insertMessageEvidence: (record) => {
          if (state.failOnMessageEvidence) throw new Error('test-only evidence insert failure')
          state.messageEvidence.push({ ...record })
        },
      },
      privacy: {
        markConversationPrivate: (record) => {
          const existing = state.privateConversations.find((item) => item.conversationId === record.conversationId)
          if (existing) {
            Object.assign(existing, { ...record, privacyMode: 'private' })
            return existing
          }
          const privateConversation = { ...record, privacyMode: 'private' }
          state.privateConversations.push(privateConversation)
          return privateConversation
        },
        createAccessRequest: (record) => {
          const existing = state.privacyAccessRequests.find(
            (item) => item.conversationId === record.conversationId && item.requesterUserId === record.requesterUserId && item.status === 'pending',
          )
          if (existing) return existing
          const accessRequest = { ...record }
          state.privacyAccessRequests.push(accessRequest)
          return accessRequest
        },
      },
      safety: {
        listQualifiedMessageIds: ({ kind, confidenceThreshold }) => {
          const seeded = uniqueIds(state.qualifiedMessageIds[kind])
          const persisted = state.messages
            .filter((message) => message.role === 'assistant')
            .filter((message) => message[kind]?.detected && message[kind]?.confidence >= confidenceThreshold)
            .map((message) => message.id)
          return uniqueIds([...seeded, ...persisted])
        },
        createOrGetOpenReviewTask: (record) => {
          const existing = state.reviewTasks.find(
            (task) => task.organizationId === record.organizationId
              && taskOwnerId(task) === record.actorIdAtCreation
              && task.conversationId === record.conversationId
              && OPEN_REVIEW_STATUSES.has(task.status),
          )
          if (existing) {
            const previousEvidenceIds = uniqueIds(existing.evidenceMessageIds)
            existing.evidenceMessageIds = uniqueIds([...previousEvidenceIds, ...record.evidenceMessageIds])
            existing.evidenceGeneration = Number(existing.evidenceGeneration ?? previousEvidenceIds.length)
              + existing.evidenceMessageIds.length - previousEvidenceIds.length
            existing.triggerReasons = mergeTriggerReasons(existing.triggerReasons, record.triggerReasons)
            existing.candidateUserIds = uniqueIds([...existing.candidateUserIds, ...record.candidateUserIds])
            existing.candidateCatalogIds = uniqueIds([...existing.candidateCatalogIds, ...record.candidateCatalogIds])
            existing.danger = {
              ...(existing.danger || {}),
              ...(record.danger || {}),
              detected: Boolean(existing.danger?.detected || record.danger?.detected),
              confidence: Math.max(Number(existing.danger?.confidence) || 0, Number(record.danger?.confidence) || 0),
              explicitSelfHarmPlan: Boolean(existing.danger?.explicitSelfHarmPlan || record.danger?.explicitSelfHarmPlan),
            }
            existing.updatedAt = record.updatedAt
            existing.version = Number(existing.version || 1) + 1
            return { reviewTask: existing, created: false }
          }
          const task = {
            ...record,
            evidenceMessageIds: uniqueIds(record.evidenceMessageIds),
            evidenceGeneration: uniqueIds(record.evidenceMessageIds).length,
          }
          state.reviewTasks.push(task)
          return { reviewTask: task, created: true }
        },
        createReviewTask: (record) => {
          const task = { ...record }
          state.reviewTasks.push(task)
          return task
        },
        claimReviewTask: ({ reviewTaskId, organizationId, ownerUserId, leaseToken, claimedAt, leaseExpiresAt }) => {
          const task = state.reviewTasks.find(
            (item) => item.id === reviewTaskId && item.organizationId === organizationId && taskOwnerId(item) === ownerUserId,
          )
          if (!task) return { outcome: 'not_found' }
          const event = state.safetyEvents.find((item) => item.reviewTaskId === reviewTaskId)
          if (event || !['pending_secondary_review', 'review_claimed'].includes(task.status)) {
            return { outcome: 'finalized', reviewTask: task, safetyEvent: event || null, status: event?.status || task.status, notificationChain: event?.notificationChain || [] }
          }
          if (task.status === 'review_claimed' && leaseIsActive(task.reviewLeaseExpiresAt, claimedAt)) {
            return { outcome: 'busy', reviewTask: task }
          }
          if (!Number.isInteger(task.evidenceGeneration)) {
            task.evidenceGeneration = uniqueIds(task.evidenceMessageIds).length
          }
          Object.assign(task, {
            status: 'review_claimed',
            reviewLeaseToken: leaseToken,
            reviewLeaseExpiresAt: leaseExpiresAt,
            reviewClaimedAt: claimedAt,
            reviewAttempts: Number(task.reviewAttempts || 0) + 1,
          })
          state.reviewAttempts.push({
            leaseToken,
            reviewTaskId,
            organizationId,
            ownerUserId,
            conversationId: task.conversationId,
            evidenceGeneration: task.evidenceGeneration,
            status: 'claimed',
            claimedAt,
          })
          return { outcome: 'claimed', reviewTask: structuredClone(task), leaseToken }
        },
        finalizeReview: ({ reviewTaskId, organizationId, ownerUserId, leaseToken, expectedEvidenceGeneration, status, reasonCode, evidenceMessageIds, implicatedCandidates, safetyEvent, updatedAt }) => {
          const task = state.reviewTasks.find(
            (item) => item.id === reviewTaskId && item.organizationId === organizationId && taskOwnerId(item) === ownerUserId,
          )
          if (!task) return { outcome: 'lease_lost', reviewTask: null }
          const existingEvent = state.safetyEvents.find((item) => item.reviewTaskId === reviewTaskId)
          if (existingEvent) {
            return { outcome: 'finalized', reviewTask: task, safetyEvent: existingEvent, status: existingEvent.status, notificationChain: existingEvent.notificationChain }
          }
          if (task.status !== 'review_claimed' || task.reviewLeaseToken !== leaseToken) {
            return { outcome: 'lease_lost', reviewTask: task }
          }
          const attempt = state.reviewAttempts.find((item) => item.leaseToken === leaseToken
            && item.reviewTaskId === reviewTaskId
            && item.organizationId === organizationId
            && item.ownerUserId === ownerUserId
            && item.conversationId === task.conversationId
            && item.evidenceGeneration === expectedEvidenceGeneration)
          if (!attempt) throw new Error('test-only review attempt scope violation')
          if (task.evidenceGeneration !== expectedEvidenceGeneration) {
            Object.assign(attempt, { status: 'superseded', reasonCode: 'REVIEW_EVIDENCE_SUPERSEDED', completedAt: updatedAt })
            Object.assign(task, {
              status: 'pending_secondary_review',
              reasonCode: 'REVIEW_EVIDENCE_SUPERSEDED',
              reviewLeaseToken: null,
              reviewLeaseExpiresAt: null,
              updatedAt,
            })
            return { outcome: 'superseded', reviewTask: task, safetyEvent: null, status: 'review_superseded', notificationChain: [] }
          }
          const normalizedEvidenceIds = uniqueIds(evidenceMessageIds)
          if (normalizedEvidenceIds.length !== task.evidenceMessageIds.length
            || normalizedEvidenceIds.some((messageId) => !task.evidenceMessageIds.includes(messageId))) {
            throw new Error('test-only review evidence must match the complete claimed generation')
          }
          const event = { ...safetyEvent, notificationChain: [...safetyEvent.notificationChain] }
          state.safetyEvents.push(event)
          for (const messageId of uniqueIds(evidenceMessageIds)) {
            if (!state.eventEvidence.some((item) => item.safetyEventId === event.id && item.messageId === messageId)) {
              state.eventEvidence.push({ id: `event-evidence-${state.eventEvidence.length + 1}`, safetyEventId: event.id, messageId, createdAt: updatedAt, updatedAt })
            }
          }
          for (const candidate of implicatedCandidates) {
            if (!state.implicatedCandidates.some((item) => item.reviewTaskId === reviewTaskId && item.candidateUserId === candidate.candidateUserId)) {
              state.implicatedCandidates.push({
                id: `candidate-${state.implicatedCandidates.length + 1}`,
                safetyEventId: event.id,
                reviewTaskId,
                candidateUserId: candidate.candidateUserId,
                confidence: candidate.confidence,
                reason: candidate.reason,
                excludedFromNotification: true,
                createdAt: updatedAt,
                updatedAt,
              })
            }
          }
          Object.assign(task, {
            status,
            reasonCode,
            reviewLeaseToken: null,
            reviewLeaseExpiresAt: null,
            updatedAt,
          })
          Object.assign(attempt, { status: 'finalized', reasonCode, completedAt: updatedAt })
          return { outcome: 'finalized', reviewTask: task, safetyEvent: event, status, notificationChain: event.notificationChain }
        },
      },
    }
  }

  return {
    state,
    transaction: async (callback) => {
      let releaseTurn
      const turn = new Promise((resolve) => {
        releaseTurn = resolve
      })
      const previousTurn = transactionTail
      transactionTail = transactionTail.then(() => turn)
      await previousTurn
      const snapshot = structuredClone(state)
      try {
        const result = callback(transactionPort())
        if (result && typeof result.then === 'function') {
          throw new TypeError('test-only transaction callback must be synchronous')
        }
        return result
      } catch (error) {
        restore(snapshot)
        throw error
      } finally {
        releaseTurn()
      }
    },
    reading: {
      getValidReadScope: async () => state.readScope,
    },
    ai: {
      hasConversationAccess: async () => true,
      findEvidenceBlocks: async () => state.evidenceBlocks,
      findMemoryCards: async () => state.memoryCards,
      findRecentConversationMessages: async () => state.recentMessages,
    },
    safety: {
      getReviewTask: async ({ reviewTaskId, organizationId, ownerUserId }) => state.reviewTasks.find(
        (task) => task.id === reviewTaskId && task.organizationId === organizationId && taskOwnerId(task) === ownerUserId,
      ) || null,
      getReviewContext: async ({ reviewTaskId, organizationId, ownerUserId, expectedEvidenceGeneration }) => {
        const task = state.reviewTasks.find(
          (item) => item.id === reviewTaskId && item.organizationId === organizationId && taskOwnerId(item) === ownerUserId,
        )
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
          const link = state.messageLinks.find((item) => item.assistantMessageId === assistantMessageId)
          const userMessage = link ? state.messages.find((item) => item.id === link.userMessageId) : null
          const assistantMessage = state.messages.find((item) => item.id === assistantMessageId)
          if (userMessage) messages.push({ id: userMessage.id, role: userMessage.role, content: userMessage.content })
          if (assistantMessage) messages.push({ id: assistantMessage.id, role: assistantMessage.role, content: assistantMessage.content })
        }
        return {
          outcome: 'stable',
          reviewTaskId,
          evidenceGeneration: task.evidenceGeneration,
          evidenceMessageIds: task?.evidenceMessageIds || [],
          privacy: task?.privacy || null,
          danger: task?.danger || null,
          messages,
        }
      },
    },
  }
}
