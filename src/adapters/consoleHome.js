function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function listFrom(value) {
  const source = asRecord(value)
  return asArray(source.items || source.results || value)
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? null
}

function numberOrNull(...values) {
  const value = firstValue(...values)
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function toSeries(raw) {
  const source = asRecord(raw)
  const data = asArray(source.data || source.values).map(Number).filter(Number.isFinite)
  if (!data.length) return null
  const labels = asArray(source.labels || source.timestamps).map(String)
  return {
    type: firstValue(source.type, 'line'),
    data,
    labels: labels.length === data.length ? labels : data.map((_, index) => String(index + 1)),
    peakIndex: numberOrNull(source.peakIndex),
  }
}

function toAssignment(raw) {
  const source = asRecord(raw)
  const book = asRecord(source.book)
  const klass = asRecord(source.class || source.klass)
  const cover = asRecord(book.cover || source.cover)
  const coverUrl = firstValue(cover.url, cover.href, source.coverUrl)
  return {
    id: firstValue(source.id, source.assignmentId),
    date: firstValue(source.dateLabel, source.scheduledDate, source.date),
    weekday: firstValue(source.weekday, source.weekdayLabel),
    title: firstValue(book.title, source.bookTitle, source.title),
    chapter: firstValue(source.chapter, source.chapterTitle),
    klass: firstValue(klass.name, source.className),
    tag: firstValue(source.statusLabel, source.status),
    tagTone: firstValue(source.statusTone, 'brand'),
    time: firstValue(source.startTime, source.time),
    joined: firstValue(source.participantLabel, source.participantCount != null ? `${source.participantCount} 人参与` : null),
    coverUrl: typeof coverUrl === 'string' && !/^(?:file:|[a-z]:[\\/]|\\\\)/i.test(coverUrl) ? coverUrl : null,
  }
}

function toSafetyTodo(raw) {
  const source = asRecord(raw)
  const risk = firstValue(source.riskLevel, source.risk, 'unknown')
  return {
    key: firstValue(source.id, source.eventId),
    title: firstValue(source.title, source.summaryForStaff, source.summary, '安全事件'),
    sub: firstValue(source.statusLabel, source.status, risk === 'unknown' ? '服务端未返回状态' : risk),
    count: numberOrNull(source.pendingCount, source.openCount),
    to: firstValue(source.id, source.eventId) ? `/console/safety/${firstValue(source.id, source.eventId)}` : '/console/safety',
    tone: risk === 'critical' || risk === 'high' ? 'danger' : risk === 'medium' ? 'accent' : 'cyan',
    icon: 'ShieldAlert',
  }
}

export function toConsoleHomeDto({ usage, assignments, safetyEvents }) {
  const usageData = asRecord(usage)
  const metrics = asRecord(usageData.metrics || usageData.summary)
  const safetyItems = listFrom(safetyEvents).map(toSafetyTodo).filter((item) => item.key)
  const assignmentItems = listFrom(assignments).map(toAssignment).filter((item) => item.id)
  const pendingSafety = safetyItems.filter((item) => !['closed', 'false_positive_closed'].includes(item.sub)).length
  const series = asRecord(usageData.series || usageData.trends)
  return {
    greetSub: firstValue(usageData.greeting, usageData.greetingText, '当前数据范围由服务端工作空间决定。'),
    blocks: [
      {
        key: 'classes',
        label: '参与班级',
        value: numberOrNull(metrics.classCount, usageData.classCount),
        unit: '个',
        icon: 'UsersRound',
        tone: 'brand',
        to: '/console/classes',
        chart: toSeries(series.classes || series.classCount),
      },
      {
        key: 'reading',
        label: '今日有效阅读',
        value: numberOrNull(metrics.effectiveReadingCount, metrics.readingCount, usageData.effectiveReadingCount),
        unit: '次',
        icon: 'BookOpenCheck',
        tone: 'violet',
        to: '/console/usage',
        chart: toSeries(series.reading || series.effectiveReading),
      },
      {
        key: 'active',
        label: '正在阅读学生',
        value: numberOrNull(metrics.activeReaders, metrics.activeStudentCount, usageData.activeReaders),
        unit: '人',
        icon: 'UserRoundCheck',
        tone: 'cyan',
        to: '/console/classes',
        chart: toSeries(series.activeReaders || series.active),
      },
      {
        key: 'safety',
        label: '待处理安全事件',
        value: numberOrNull(metrics.pendingSafetyCount, usageData.pendingSafetyCount, pendingSafety),
        unit: '项',
        icon: 'ShieldAlert',
        tone: 'danger',
        to: '/console/safety',
        chart: toSeries(series.safety || series.pendingSafety),
      },
    ],
    arrangements: assignmentItems,
    todos: safetyItems,
  }
}
