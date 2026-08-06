const ACTIVE_EVENT_TYPES = new Set([
  'page_stay', 'page_turn', 'selection', 'bookmark', 'annotation', 'ai_question', 'class_sync',
])
const MAX_EVENT_SECONDS = 120

function domainError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw domainError('VALIDATION_FAILED', `${name} 不能为空`)
  }
  return value.trim()
}

function requireDatabase(database) {
  if (!database || typeof database.prepare !== 'function') {
    throw new TypeError('db 必须是 node:sqlite 数据库')
  }
  return database
}

function normalizeDate(value, name) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw domainError('VALIDATION_FAILED', `${name} 必须是有效时间`)
  return date
}

function windowStart(value, kind) {
  const date = normalizeDate(value, '统计时间')
  const shifted = new Date(date.getTime() + 4 * 60 * 60 * 1000)
  if (kind === 'week') {
    const day = shifted.getUTCDay() || 7
    shifted.setUTCDate(shifted.getUTCDate() - day + 1)
  }
  const localStart = Date.UTC(
    shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), 4, 0, 0, 0,
  )
  return new Date(localStart - 8 * 60 * 60 * 1000)
}

function requireAuthScope(database, authContext) {
  const organizationId = requiredText(authContext?.organizationId, 'authContext.organizationId')
  const userId = requiredText(authContext?.userId, 'authContext.userId')
  const workspaceId = requiredText(authContext?.workspaceId, 'authContext.workspaceId')
  const row = database.prepare(`SELECT
      actor.id AS user_id, actor.display_name,
      workspace.id AS workspace_id, workspace.scope_type, workspace.scope_id
    FROM users actor
    JOIN organizations organization ON organization.id = actor.organization_id
      AND organization.status = 'active'
    JOIN workspace_memberships membership ON membership.user_id = actor.id
      AND membership.status = 'active'
    JOIN workspaces workspace ON workspace.id = membership.workspace_id
      AND workspace.organization_id = actor.organization_id AND workspace.status = 'active'
    WHERE actor.id = ? AND actor.organization_id = ? AND actor.status = 'active'
      AND workspace.id = ?`).get(userId, organizationId, workspaceId)
  if (!row) throw domainError('RESOURCE_NOT_FOUND', '当前身份或工作空间不存在')
  return {
    organizationId,
    userId,
    workspaceId,
    displayName: row.display_name,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    authContext: { organizationId, userId, workspaceId },
  }
}

async function requireAuthorized(authorize, action, scope, resource) {
  const allowed = await authorize({
    authContext: scope.authContext,
    actor: { id: scope.userId, displayName: scope.displayName },
    workspace: {
      id: scope.workspaceId,
      organizationId: scope.organizationId,
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
    },
    action,
    resource,
  })
  if (!allowed) throw domainError('PERMISSION_DENIED', '当前工作空间无权读取阅读统计')
}

function validInterval(row, secondsColumn = 'valid_reading_seconds') {
  const seconds = Number(row[secondsColumn])
  if (row.foreground !== 1 || row.screen_on !== 1) return null
  if (!ACTIVE_EVENT_TYPES.has(row.event_type)) return null
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_EVENT_SECONDS) return null
  const start = new Date(row.client_occurred_at).getTime()
  if (!Number.isFinite(start)) return null
  return { start, end: start + seconds * 1000, row }
}

function mergeIntervals(intervals) {
  const merged = []
  const ordered = intervals
    .filter(Boolean)
    .sort((left, right) => left.start - right.start || left.end - right.end)
  for (const interval of ordered) {
    const previous = merged.at(-1)
    if (!previous || interval.start > previous.end) {
      merged.push({ start: interval.start, end: interval.end })
    } else {
      previous.end = Math.max(previous.end, interval.end)
    }
  }
  return merged
}

function clipIntervals(intervals, from, to) {
  const fromTime = from?.getTime() ?? Number.NEGATIVE_INFINITY
  const toTime = to?.getTime() ?? Number.POSITIVE_INFINITY
  return intervals
    .map((interval) => ({ start: Math.max(interval.start, fromTime), end: Math.min(interval.end, toTime) }))
    .filter((interval) => interval.end > interval.start)
}

function intervalSeconds(intervals) {
  return Math.floor(intervals.reduce((total, interval) => total + interval.end - interval.start, 0) / 1000)
}

function groupBy(items, keyFor) {
  const grouped = new Map()
  for (const item of items) {
    const key = keyFor(item)
    const values = grouped.get(key) || []
    values.push(item)
    grouped.set(key, values)
  }
  return grouped
}

function allocateDailyIntervals(intervals) {
  const buckets = new Map()
  for (const interval of intervals) {
    let cursor = interval.start
    while (cursor < interval.end) {
      const start = windowStart(new Date(cursor), 'day')
      const next = start.getTime() + 24 * 60 * 60 * 1000
      const end = Math.min(interval.end, next)
      const key = start.toISOString()
      const values = buckets.get(key) || []
      values.push({ start: cursor, end })
      buckets.set(key, values)
      cursor = end
    }
  }
  return buckets
}

function selectStudentEvents(database, scope) {
  return database.prepare(`SELECT
      event.*, version.book_id, book.title,
      progress.last_page_no, progress.updated_from_event_at
    FROM reading_events event
    JOIN users actor ON actor.id = event.actor_id_at_creation
      AND actor.organization_id = event.organization_id_at_creation AND actor.status = 'active'
    JOIN workspaces workspace ON workspace.id = event.workspace_id_at_creation
      AND workspace.organization_id = event.organization_id_at_creation AND workspace.status = 'active'
    JOIN workspace_memberships membership ON membership.user_id = actor.id
      AND membership.workspace_id = workspace.id AND membership.status = 'active'
    JOIN book_versions version ON version.id = event.book_version_id
      AND version.organization_id_at_creation = event.organization_id_at_creation
    JOIN books book ON book.id = version.book_id
      AND book.organization_id_at_creation = event.organization_id_at_creation
      AND book.status = 'published'
    LEFT JOIN reading_progress progress ON progress.actor_id = actor.id
      AND progress.workspace_id = workspace.id AND progress.book_version_id = version.id
    WHERE event.organization_id_at_creation = :organizationId
      AND event.actor_id_at_creation = :userId
      AND event.workspace_id_at_creation = :workspaceId
    ORDER BY event.client_occurred_at, event.id`).all({
    organizationId: scope.organizationId,
    userId: scope.userId,
    workspaceId: scope.workspaceId,
  })
}

function eyeCareUsage(database, { organizationId, userId, workspaceId }, current) {
  const dayStart = windowStart(current, 'day').toISOString()
  const weekStart = windowStart(current, 'week').toISOString()
  const usage = database.prepare(`SELECT usage.window_kind, usage.window_start_at, usage.valid_eye_seconds
    FROM eye_care_usage usage
    JOIN users actor ON actor.id = usage.actor_id AND actor.organization_id = ? AND actor.status = 'active'
    JOIN workspaces workspace ON workspace.id = usage.workspace_id
      AND workspace.organization_id = ? AND workspace.status = 'active'
    JOIN workspace_memberships membership ON membership.user_id = actor.id
      AND membership.workspace_id = workspace.id AND membership.status = 'active'
    WHERE usage.actor_id = ? AND usage.workspace_id = ?
      AND ((usage.window_kind = 'day' AND usage.window_start_at = ?)
        OR (usage.window_kind = 'week' AND usage.window_start_at = ?))`)
    .all(organizationId, organizationId, userId, workspaceId, dayStart, weekStart)
  const state = database.prepare(`SELECT state.continuous_eye_seconds, state.last_active_at,
      enforcement.status, enforcement.forced_rest_until
    FROM users actor
    JOIN workspaces workspace ON workspace.id = ?
      AND workspace.organization_id = ? AND workspace.status = 'active'
    JOIN workspace_memberships membership ON membership.user_id = actor.id
      AND membership.workspace_id = workspace.id AND membership.status = 'active'
    LEFT JOIN eye_care_states state ON state.actor_id = actor.id AND state.workspace_id = workspace.id
    LEFT JOIN eye_care_enforcement_states enforcement
      ON enforcement.organization_id = actor.organization_id
      AND enforcement.actor_user_id = actor.id AND enforcement.workspace_id = workspace.id
    WHERE actor.id = ? AND actor.organization_id = ? AND actor.status = 'active'`)
    .get(workspaceId, organizationId, userId, organizationId)
  return {
    continuousEyeSeconds: Number(state?.continuous_eye_seconds || 0),
    todayValidEyeSeconds: Number(usage.find((row) => row.window_kind === 'day')?.valid_eye_seconds || 0),
    weekValidEyeSeconds: Number(usage.find((row) => row.window_kind === 'week')?.valid_eye_seconds || 0),
    lastActiveAt: state?.last_active_at || null,
    status: state?.status || 'normal',
    forcedRestUntil: state?.forced_rest_until || null,
  }
}

function studentSummary(database, scope, current) {
  const rows = selectStudentEvents(database, scope)
  const currentTime = current.getTime()
  const activeIntervals = rows.map((row) => validInterval(row)).map((interval) => {
    if (!interval || interval.start >= currentTime) return null
    return { ...interval, end: Math.min(interval.end, currentTime) }
  }).filter((interval) => interval && interval.end > interval.start)
  const allIntervals = mergeIntervals(activeIntervals)
  const dayStart = windowStart(current, 'day')
  const weekStart = windowStart(current, 'week')
  const byVersion = groupBy(activeIntervals, (interval) => interval.row.book_version_id)
  const byBook = [...byVersion].map(([bookVersionId, intervals]) => {
    const latest = [...intervals].sort((left, right) => right.start - left.start)[0].row
    return {
      bookId: latest.book_id,
      bookVersionId,
      title: latest.title,
      effectiveReadingSeconds: intervalSeconds(mergeIntervals(intervals)),
      lastReadAt: latest.client_occurred_at,
      lastPageNo: Number(latest.last_page_no || latest.page_no || 1),
      progressUpdatedAt: latest.updated_from_event_at || null,
    }
  }).sort((left, right) => right.effectiveReadingSeconds - left.effectiveReadingSeconds
    || right.lastReadAt.localeCompare(left.lastReadAt))
  const recentReading = [...byBook]
    .sort((left, right) => right.lastReadAt.localeCompare(left.lastReadAt))
    .slice(0, 12)
  const readingDays = [...allocateDailyIntervals(allIntervals).values()]
    .filter((intervals) => intervalSeconds(mergeIntervals(intervals)) > 0).length
  const totalEffectiveReadingSeconds = intervalSeconds(allIntervals)
  return {
    generatedAt: current.toISOString(),
    totalEffectiveReadingSeconds,
    todayEffectiveReadingSeconds: intervalSeconds(clipIntervals(allIntervals, dayStart, current)),
    weekEffectiveReadingSeconds: intervalSeconds(clipIntervals(allIntervals, weekStart, current)),
    readingDays,
    byBook,
    recentReading,
    levelInput: {
      totalEffectiveReadingSeconds,
      readingDays,
      startedBookCount: byBook.length,
    },
    eyeCare: eyeCareUsage(database, scope, current),
  }
}

function scopedStudentTargets(database, scope) {
  const clauses = [
    `student.organization_id = :organizationId`,
    `student.status = 'active'`,
    `membership.membership_role = 'student'`,
    `membership.status = 'active'`,
    `class.status = 'active'`,
    `class.organization_id = :organizationId`,
    `student_workspace.organization_id = :organizationId`,
    `student_workspace.scope_type = 'class'`,
    `student_workspace.scope_id = class.id`,
    `student_workspace.status = 'active'`,
    `workspace_membership.status = 'active'`,
  ]
  if (scope.scopeType === 'class') clauses.push('class.id = :scopeId')
  else if (scope.scopeType === 'grade') clauses.push('class.grade_id = :scopeId')
  else if (scope.scopeType === 'school') clauses.push('class.organization_id = :scopeId')
  else if (scope.scopeType === 'own') clauses.push('student.id = :userId')
  else return []
  return database.prepare(`SELECT DISTINCT
      student.id AS student_id, student.display_name,
      class.id AS class_id, class.name AS class_name,
      student_workspace.id AS workspace_id
    FROM users student
    JOIN class_memberships membership ON membership.user_id = student.id
    JOIN classes class ON class.id = membership.class_id
    JOIN workspaces student_workspace ON student_workspace.scope_id = class.id
    JOIN workspace_memberships workspace_membership
      ON workspace_membership.user_id = student.id
      AND workspace_membership.workspace_id = student_workspace.id
    WHERE ${clauses.join(' AND ')}
    ORDER BY class.id, student.id, student_workspace.id`).all({
    organizationId: scope.organizationId,
    scopeId: scope.scopeId,
    ...(scope.scopeType === 'own' ? { userId: scope.userId } : {}),
  }).map((row) => ({
    studentId: row.student_id,
    studentDisplayName: row.display_name,
    classId: row.class_id,
    className: row.class_name,
    workspaceId: row.workspace_id,
  }))
}

function normalizeFilters(filters = {}) {
  const from = filters.from ? normalizeDate(filters.from, 'filters.from') : null
  const to = filters.to ? normalizeDate(filters.to, 'filters.to') : null
  if (from && to && from >= to) throw domainError('VALIDATION_FAILED', 'filters.to 必须晚于 filters.from')
  return {
    classId: filters.classId ? requiredText(filters.classId, 'filters.classId') : null,
    studentId: filters.studentId ? requiredText(filters.studentId, 'filters.studentId') : null,
    bookVersionId: filters.bookVersionId ? requiredText(filters.bookVersionId, 'filters.bookVersionId') : null,
    from,
    to,
  }
}

function filterTargets(database, scope, filters) {
  let targets = scopedStudentTargets(database, scope)
  if (filters.classId) {
    if (!targets.some((target) => target.classId === filters.classId)) {
      throw domainError('RESOURCE_NOT_FOUND', '班级不在当前工作空间的有效范围内')
    }
    targets = targets.filter((target) => target.classId === filters.classId)
  }
  if (filters.studentId) {
    if (!targets.some((target) => target.studentId === filters.studentId)) {
      throw domainError('RESOURCE_NOT_FOUND', '学生不在当前工作空间的有效范围内')
    }
    targets = targets.filter((target) => target.studentId === filters.studentId)
  }
  if (filters.bookVersionId) {
    const book = database.prepare(`SELECT version.id FROM book_versions version
      JOIN books book ON book.id = version.book_id
        AND book.organization_id_at_creation = version.organization_id_at_creation
      WHERE version.id = ? AND version.organization_id_at_creation = ? AND book.status = 'published'`)
      .get(filters.bookVersionId, scope.organizationId)
    if (!book) throw domainError('RESOURCE_NOT_FOUND', '书籍不在当前组织的有效范围内')
  }
  return targets
}

function selectScopedEvents(database, scope, targets, filters) {
  if (targets.length === 0) return []
  const values = [scope.organizationId]
  const targetSql = targets.map((target) => {
    values.push(target.studentId, target.workspaceId, target.classId)
    return '(event.actor_id_at_creation = ? AND event.workspace_id_at_creation = ? AND class.id = ?)'
  }).join(' OR ')
  let filterSql = ''
  if (filters.bookVersionId) {
    filterSql += ' AND event.book_version_id = ?'
    values.push(filters.bookVersionId)
  }
  if (filters.to) {
    filterSql += ' AND event.client_occurred_at < ?'
    values.push(filters.to.toISOString())
  }
  if (filters.from) {
    filterSql += ' AND event.client_occurred_at >= ?'
    values.push(new Date(filters.from.getTime() - MAX_EVENT_SECONDS * 1000).toISOString())
  }
  return database.prepare(`SELECT event.*, actor.display_name, class.id AS class_id,
      class.name AS class_name, version.book_id, book.title
    FROM reading_events event
    JOIN users actor ON actor.id = event.actor_id_at_creation
      AND actor.organization_id = event.organization_id_at_creation AND actor.status = 'active'
    JOIN workspaces workspace ON workspace.id = event.workspace_id_at_creation
      AND workspace.organization_id = event.organization_id_at_creation
      AND workspace.scope_type = 'class' AND workspace.status = 'active'
    JOIN workspace_memberships workspace_membership
      ON workspace_membership.user_id = actor.id
      AND workspace_membership.workspace_id = workspace.id
      AND workspace_membership.status = 'active'
    JOIN classes class ON class.id = workspace.scope_id
      AND class.organization_id = event.organization_id_at_creation AND class.status = 'active'
    JOIN class_memberships class_membership ON class_membership.class_id = class.id
      AND class_membership.user_id = actor.id
      AND class_membership.membership_role = 'student' AND class_membership.status = 'active'
    JOIN book_versions version ON version.id = event.book_version_id
      AND version.organization_id_at_creation = event.organization_id_at_creation
    JOIN books book ON book.id = version.book_id
      AND book.organization_id_at_creation = event.organization_id_at_creation
      AND book.status = 'published'
    WHERE event.organization_id_at_creation = ? AND (${targetSql})${filterSql}
    ORDER BY event.actor_id_at_creation, event.client_occurred_at, event.id`).all(...values)
}

function aggregateScopedRows(rows, targets, filters, current, database, organizationId) {
  const active = rows.map((row) => validInterval(row)).filter(Boolean)
  const upperBound = filters.to && filters.to < current ? filters.to : current
  const clipped = active.map((interval) => {
    const values = clipIntervals([interval], filters.from, upperBound)
    return values[0] ? { ...values[0], row: interval.row } : null
  }).filter(Boolean)
  const byStudent = groupBy(clipped, (interval) => interval.row.actor_id_at_creation)
  const participantCount = [...byStudent.values()]
    .filter((intervals) => intervalSeconds(mergeIntervals(intervals)) > 0).length
  const effectiveReadingSeconds = [...byStudent.values()]
    .reduce((total, intervals) => total + intervalSeconds(mergeIntervals(intervals)), 0)

  const trendBuckets = new Map()
  for (const [studentId, intervals] of byStudent) {
    for (const [key, slices] of allocateDailyIntervals(mergeIntervals(intervals))) {
      const bucket = trendBuckets.get(key) || { effectiveReadingSeconds: 0, participants: new Set() }
      bucket.effectiveReadingSeconds += intervalSeconds(mergeIntervals(slices))
      bucket.participants.add(studentId)
      trendBuckets.set(key, bucket)
    }
  }
  const trend = [...trendBuckets].sort(([left], [right]) => left.localeCompare(right)).map(([key, bucket]) => ({
    windowStartAt: key,
    effectiveReadingSeconds: bucket.effectiveReadingSeconds,
    participantCount: bucket.participants.size,
  }))

  const byBook = [...groupBy(clipped, (interval) => interval.row.book_version_id)]
    .map(([bookVersionId, intervals]) => {
      const byBookStudent = groupBy(intervals, (interval) => interval.row.actor_id_at_creation)
      const effectiveSeconds = [...byBookStudent.values()]
        .reduce((total, values) => total + intervalSeconds(mergeIntervals(values)), 0)
      const row = intervals[0].row
      return {
        bookId: row.book_id,
        bookVersionId,
        title: row.title,
        effectiveReadingSeconds: effectiveSeconds,
        participantCount: byBookStudent.size,
      }
    })
    .sort((left, right) => right.effectiveReadingSeconds - left.effectiveReadingSeconds
      || left.bookVersionId.localeCompare(right.bookVersionId))

  const anomalousStays = rows
    .filter((row) => row.event_type === 'page_stay'
      && row.foreground === 1 && row.screen_on === 1
      && Number(row.valid_reading_seconds) > MAX_EVENT_SECONDS
      && new Date(row.client_occurred_at) < upperBound
      && (!filters.from || new Date(row.client_occurred_at) >= filters.from))
    .map((row) => ({
      eventId: row.id,
      studentId: row.actor_id_at_creation,
      studentDisplayName: row.display_name,
      classId: row.class_id,
      bookId: row.book_id,
      bookVersionId: row.book_version_id,
      title: row.title,
      pageNo: row.page_no,
      occurredAt: row.client_occurred_at,
      observedSeconds: Number(row.valid_reading_seconds),
      reason: 'page_stay_exceeds_interaction_window',
    }))

  const eyeCareStatuses = targets.map((target) => {
    const usage = eyeCareUsage(database, {
      organizationId,
      userId: target.studentId,
      workspaceId: target.workspaceId,
    }, current)
    return {
      studentId: target.studentId,
      studentDisplayName: target.studentDisplayName,
      classId: target.classId,
      workspaceId: target.workspaceId,
      ...usage,
    }
  })

  return {
    generatedAt: current.toISOString(),
    participantCount,
    effectiveReadingSeconds,
    trend,
    byBook,
    anomalousStays,
    eyeCareStatuses,
  }
}

export function createReadingStatisticsDomain(dependencies = {}) {
  const database = requireDatabase(dependencies.db)
  const authorize = dependencies.authorize || (async () => false)
  const audit = dependencies.audit || (() => undefined)
  const now = dependencies.now || (() => new Date())

  return {
    async getStudentSummary(authContext) {
      const scope = requireAuthScope(database, authContext)
      await requireAuthorized(authorize, 'reading.read_self', scope, {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        ownerId: scope.userId,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
      })
      const result = studentSummary(database, scope, normalizeDate(now(), 'now'))
      await audit({
        eventType: 'reading.statistics.self_viewed',
        resourceType: 'student',
        resourceId: scope.userId,
      })
      return result
    },

    async getScopedSummary(authContext, input = {}) {
      const scope = requireAuthScope(database, authContext)
      const filters = normalizeFilters(input)
      await requireAuthorized(authorize, 'reading.read_scope', scope, {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        classId: filters.classId,
        studentId: filters.studentId,
        bookVersionId: filters.bookVersionId,
      })
      const targets = filterTargets(database, scope, filters)
      const current = normalizeDate(now(), 'now')
      const rows = selectScopedEvents(database, scope, targets, filters)
      const result = aggregateScopedRows(rows, targets, filters, current, database, scope.organizationId)
      await audit({
        eventType: 'reading.statistics.scope_viewed',
        resourceType: 'reading_statistics_scope',
        resourceId: filters.studentId || filters.classId || scope.scopeId,
      })
      return result
    },
  }
}

export { windowStart as readingStatisticsWindowStart }
