function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? null
}

function numberOrNull(...values) {
  const value = firstValue(...values)
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toPerson(value) {
  const source = asRecord(value)
  return {
    id: firstValue(source.id, source.userId),
    name: firstValue(source.displayName, source.display_name, source.name),
    role: firstValue(source.roleName, source.role),
  }
}

function toContextMessage(value) {
  const source = asRecord(value)
  const quote = asRecord(source.quote || source.selection)
  return {
    id: firstValue(source.id, source.messageId),
    role: firstValue(source.role, source.senderRole, 'ai'),
    at: firstValue(source.createdAt, source.at, ''),
    text: firstValue(source.text, source.content, ''),
    trigger: Boolean(source.trigger || source.isTrigger),
    quote: quote.text
      ? {
          page: firstValue(quote.pageNo, quote.page, ''),
          chapter: firstValue(quote.chapter, ''),
          text: quote.text,
        }
      : null,
  }
}

function toTimelineItem(value) {
  const source = asRecord(value)
  return {
    at: firstValue(source.at, source.createdAt, ''),
    actor: firstValue(source.actorName, source.actor?.name, source.actor, '系统'),
    action: firstValue(source.action, source.eventType, ''),
    note: firstValue(source.note, source.reason, null),
  }
}

function toHandler(value) {
  const source = asRecord(value)
  return {
    id: firstValue(source.id, source.userId),
    name: firstValue(source.name, source.displayName, source.userId, source.id, '账号信息不可用'),
    role: firstValue(source.role, source.roleName, ''),
    state: firstValue(source.deliveryStatus, source.state, 'planned'),
    at: firstValue(source.at, source.updatedAt, ''),
    note: firstValue(source.note, source.reason, null),
  }
}

export const SAFETY_RISK_META = Object.freeze({
  critical: { label: '极高风险', tone: 'danger', dot: '#A83A34', desc: '风险级别由服务端二次复核结果决定' },
  high: { label: '高风险', tone: 'danger', dot: '#C2453D', desc: '风险级别由服务端二次复核结果决定' },
  medium: { label: '中风险', tone: 'warning', dot: '#D78735', desc: '风险级别由服务端二次复核结果决定' },
  low: { label: '低风险', tone: 'brand', dot: '#3C6FE0', desc: '风险级别由服务端二次复核结果决定' },
  none: { label: '待人工确认', tone: 'muted', dot: '#98A2B3', desc: '服务端尚未给出可用的风险结论' },
})

export const SAFETY_EVENT_STATUS = Object.freeze({
  pending: { label: '待接手', tone: 'warning' },
  pending_secondary_review: { label: '待二次复核', tone: 'warning' },
  review_claimed: { label: '二次复核中', tone: 'brand' },
  pending_human_confirmation: { label: '待人工确认', tone: 'warning' },
  awaiting_human_acceptance: { label: '待人工接手', tone: 'warning' },
  working: { label: '处理中', tone: 'brand' },
  review: { label: '待复核', tone: 'warning' },
  closed: { label: '已关闭', tone: 'success' },
  false_positive_closed: { label: '误报已关闭', tone: 'muted' },
  false: { label: '误报已关闭', tone: 'muted' },
})

export const SAFETY_CHAIN_STATE = Object.freeze({
  skipped: { label: '已回避', tone: 'muted' },
  planned: { label: '待派发', tone: 'muted' },
  dispatched: { label: '已派发', tone: 'warning' },
  delivered: { label: '已送达', tone: 'brand' },
  read: { label: '已读', tone: 'success' },
  unknown: { label: '待对账', tone: 'warning' },
  current: { label: '当前责任人', tone: 'warning' },
  waiting: { label: '等待升级', tone: 'muted' },
  completed: { label: '已处理', tone: 'success' },
})

export function formatSafetyDeadline(event) {
  if (!event.status) return { text: '服务端未返回处理状态或时限', tone: 'muted' }
  const status = SAFETY_EVENT_STATUS[event.status]
  if (!status || ['closed', 'false', 'false_positive_closed'].includes(event.status)) {
    return { text: '已终止计时', tone: 'muted' }
  }
  if (typeof event.remainingMinutes !== 'number') {
    return { text: '等待服务端返回处理时限', tone: 'muted' }
  }
  if (event.remainingMinutes < 0) {
    const elapsed = Math.abs(event.remainingMinutes)
    return { text: `已超时 ${Math.floor(elapsed / 60)} 小时 ${elapsed % 60} 分`, tone: 'danger' }
  }
  if (event.remainingMinutes < 120) {
    return { text: `剩余 ${Math.floor(event.remainingMinutes / 60)} 小时 ${event.remainingMinutes % 60} 分`, tone: 'warning' }
  }
  if (event.remainingMinutes < 1440) return { text: `剩余 ${Math.floor(event.remainingMinutes / 60)} 小时`, tone: 'brand' }
  return { text: `剩余 ${Math.round(event.remainingMinutes / 1440)} 天`, tone: 'muted' }
}

export function toSafetyDetailDto(value) {
  const source = asRecord(value)
  const review = asRecord(source.review)
  const policy = asRecord(source.policy)
  const escalation = asRecord(source.escalation)
  const result = asRecord(source.result)
  const minimalContext = source.minimalContext || source.evidenceMessages || source.context
  return {
    id: firstValue(source.id, source.eventId),
    status: firstValue(source.status, null),
    risk: firstValue(source.riskLevel, source.risk_level, source.risk, null),
    summary: firstValue(source.summaryForStaff, source.summary, ''),
    reviewSummary: firstValue(source.reviewSummary, review.summaryForStaff, review.summary, null),
    reviewResult: firstValue(source.reviewResult, source.review_result, review.result, null),
    source: firstValue(source.source, null),
    displayLabel: firstValue(source.displayLabel, source.source === 'manual_demo_test' ? '演示测试事件' : null),
    threshold: numberOrNull(source.threshold, source.qualifyingThreshold, policy.threshold),
    qualifyingMessageCount: numberOrNull(
      source.qualifyingMessageCount,
      source.qualifying_message_count,
      review.qualifyingMessageCount,
    ),
    triggerAt: firstValue(source.triggeredAt, source.triggerAt, source.createdAt, ''),
    slaHours: numberOrNull(source.slaHours, source.sla_hours, policy.slaHours),
    remainingMinutes: numberOrNull(source.remainingMinutes, source.remainMinutes),
    student: toPerson(source.student),
    klass: toPerson(source.class || source.klass),
    book: asRecord(source.book),
    ownerNote: firstValue(source.ownerNote, null),
    hiddenBefore: numberOrNull(source.hiddenBefore, source.hidden_before),
    hiddenAfter: numberOrNull(source.hiddenAfter, source.hidden_after),
    context: asArray(minimalContext).map(toContextMessage),
    notificationTargets: asArray(source.notificationTargets).map((entry) => ({
      ...toPerson(entry),
      at: firstValue(asRecord(entry).at, asRecord(entry).plannedAt, ''),
      state: firstValue(asRecord(entry).deliveryStatus, asRecord(entry).state, 'planned'),
    })),
    notified: asArray(source.dispatchedNotifications || source.notified || source.notifications).map((entry) => ({
      ...toPerson(entry),
      at: firstValue(asRecord(entry).at, asRecord(entry).dispatchedAt, asRecord(entry).sentAt, ''),
      state: firstValue(asRecord(entry).deliveryStatus, asRecord(entry).state, 'dispatched'),
    })),
    delivered: asArray(source.deliveredNotifications).map((entry) => ({
      ...toPerson(entry),
      at: firstValue(asRecord(entry).at, asRecord(entry).deliveredAt, ''),
      state: firstValue(asRecord(entry).deliveryStatus, asRecord(entry).state, 'delivered'),
    })),
    excluded: asArray(source.excluded || source.implicatedCandidates).map((entry) => ({
      ...toPerson(entry),
      reason: firstValue(asRecord(entry).reason, null),
    })),
    chain: asArray(source.chain || escalation.handlers).map(toHandler),
    escalation: { owner: firstValue(escalation.owner, source.escalationOwner, null) },
    timeline: asArray(source.timeline || source.auditTrail).map(toTimelineItem),
    offline: asRecord(source.offlineRecord).text
      ? {
          by: firstValue(asRecord(source.offlineRecord).by, asRecord(source.offlineRecord).actorName, ''),
          at: firstValue(asRecord(source.offlineRecord).at, asRecord(source.offlineRecord).createdAt, ''),
          text: asRecord(source.offlineRecord).text,
        }
      : null,
    result: result.summary
      ? { tone: firstValue(result.tone, 'muted'), label: firstValue(result.label, ''), summary: result.summary }
      : null,
    sessionId: firstValue(source.sessionId, source.conversationId, null),
    watermark: firstValue(source.watermark, source.viewer?.watermark, null),
    viewer: toPerson(source.viewer),
    actions: asArray(source.availableActions || source.actions),
  }
}
