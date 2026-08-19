import {
  addStatDates,
  readingStatDateFor,
  readingStatDateStart,
} from './monitoring.js'

import { computeClassLifecycle } from '../identity/lifecycle.js'

const CHECK_IN_MS = 300_000
const SCOPE_ROLE_CODES = new Set([
  'teacher',
  'class_teacher',
  'grade_manager',
  'grade_group',
  'grade_admin',
  'school_admin',
])

function domainError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function validationError(message, details) {
  const error = new TypeError(message)
  error.code = 'VALIDATION_FAILED'
  if (details !== undefined) error.details = details
  return error
}

function requiredText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw validationError(`${name} 不能为空`)
  return value.trim()
}

function requireDatabase(database) {
  if (!database || typeof database.prepare !== 'function') {
    throw new TypeError('db 必须是 node:sqlite 数据库')
  }
  return database
}

function exactStatDate(value, name = 'statDate') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw validationError(`${name} 格式无效`)
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw validationError(`${name} 必须是有效日期`)
  }
  return value
}

function safeDuration(value, name = 'effectiveReadingMs') {
  if (!Number.isSafeInteger(value) || value < 0) throw validationError(`${name} 必须是非负安全整数`)
  return value
}

export function isReadingCheckIn(effectiveReadingMs) {
  return safeDuration(effectiveReadingMs) >= CHECK_IN_MS
}

export function readingComparisonState(todayEffectiveMs, lastWeekTotalMs) {
  const today = safeDuration(todayEffectiveMs, 'todayEffectiveMs')
  const baseline = safeDuration(lastWeekTotalMs, 'lastWeekTotalMs')
  if (baseline === 0) return 'no_baseline'
  const scaledToday = BigInt(today) * 70n
  const scaledBaseline = BigInt(baseline)
  if (scaledToday < scaledBaseline * 9n) return 'growth_space'
  if (scaledToday > scaledBaseline * 11n) return 'more'
  return 'close'
}

export function readingSevenStatDates(statDate) {
  const normalized = exactStatDate(statDate)
  return Array.from({ length: 7 }, (_, index) => addStatDates(normalized, index - 6))
}

export function readingLastCompleteWeekDates(statDate) {
  const normalized = exactStatDate(statDate)
  const weekday = new Date(`${normalized}T00:00:00.000Z`).getUTCDay() || 7
  const previousMonday = addStatDates(normalized, -(weekday + 6))
  return Array.from({ length: 7 }, (_, index) => addStatDates(previousMonday, index))
}

function totalMap(rows) {
  const totals = new Map()
  for (const row of rows) {
    const statDate = exactStatDate(row.statDate ?? row.stat_date)
    const value = safeDuration(
      Number(row.effectiveReadingMs ?? row.effective_reading_ms ?? 0),
      'daily effectiveReadingMs',
    )
    const next = (totals.get(statDate) || 0) + value
    if (!Number.isSafeInteger(next)) throw validationError('每日累计超过安全整数范围')
    totals.set(statDate, next)
  }
  return totals
}

export function readingStreakDays(rows, statDate) {
  const normalized = exactStatDate(statDate)
  const totals = rows instanceof Map ? rows : totalMap(rows)
  let cursor = isReadingCheckIn(totals.get(normalized) || 0) ? normalized : addStatDates(normalized, -1)
  if (!isReadingCheckIn(totals.get(cursor) || 0)) return 0
  let streak = 0
  while (isReadingCheckIn(totals.get(cursor) || 0)) {
    streak += 1
    cursor = addStatDates(cursor, -1)
  }
  return streak
}

export function fillReadingSevenDays(rows, statDate) {
  const totals = rows instanceof Map ? rows : totalMap(rows)
  return readingSevenStatDates(statDate).map((date) => ({
    statDate: date,
    effectiveReadingMs: totals.get(date) || 0,
  }))
}

export function deriveClassReadingMetrics({ activeStudentCount, studentTotalsMs }) {
  if (!Number.isInteger(activeStudentCount) || activeStudentCount < 0) {
    throw validationError('activeStudentCount 必须是非负整数')
  }
  const totals = Array.from(studentTotalsMs || [], (value) => safeDuration(Number(value), 'student total'))
  const checkedInStudentCount = totals.filter(isReadingCheckIn).length
  const totalEffectiveReadingMs = totals.reduce((sum, value) => {
    const next = sum + value
    if (!Number.isSafeInteger(next)) throw validationError('班级累计超过安全整数范围')
    return next
  }, 0)
  if (activeStudentCount === 0) {
    return {
      checkedInStudentCount,
      checkInRateBasisPoints: null,
      totalEffectiveReadingMs,
      perCapitaEffectiveReadingMs: null,
    }
  }
  return {
    checkedInStudentCount,
    checkInRateBasisPoints: Math.round(checkedInStudentCount * 10_000 / activeStudentCount),
    totalEffectiveReadingMs,
    perCapitaEffectiveReadingMs: Math.round(totalEffectiveReadingMs / activeStudentCount),
  }
}

function requireAuthScope(database, authContext) {
  const organizationId = requiredText(authContext?.organizationId, 'authContext.organizationId')
  const userId = requiredText(authContext?.userId, 'authContext.userId')
  const workspaceId = requiredText(authContext?.workspaceId, 'authContext.workspaceId')
  const row = database.prepare(`SELECT
      actor.id AS user_id,
      actor.display_name,
      workspace.id AS workspace_id,
      workspace.scope_type,
      workspace.scope_id
    FROM users AS actor
    JOIN organizations AS organization
      ON organization.id = actor.organization_id AND organization.status = 'active'
    JOIN workspace_memberships AS membership
      ON membership.user_id = actor.id AND membership.status = 'active'
    JOIN workspaces AS workspace
      ON workspace.id = membership.workspace_id
      AND workspace.organization_id = actor.organization_id
      AND workspace.status = 'active'
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

function requireStudentSelf(database, scope) {
  const row = database.prepare(`SELECT class.id AS class_id
    FROM class_memberships AS membership
    JOIN classes AS class
      ON class.id = membership.class_id
      AND class.organization_id = :organizationId
      AND class.status = 'active'
    JOIN workspaces AS workspace
      ON workspace.id = :workspaceId
      AND workspace.organization_id = :organizationId
      AND workspace.scope_type = 'class'
      AND workspace.scope_id = class.id
    WHERE membership.user_id = :userId
      AND membership.membership_role = 'student'
      AND membership.status = 'active'`).get({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    userId: scope.userId,
  })
  if (!row) throw domainError('PERMISSION_DENIED', '只有当前班级学生可以读取本人阅读简报')
  return row.class_id
}

function parseScopeLevel(value) {
  if (value === undefined || value === null || value === '') return 'class'
  if (value === 'class' || value === 'grade' || value === 'school') return value
  throw validationError('scopeLevel 必须是 class、grade 或 school', { fields: ['scopeLevel'] })
}

function parseGrade(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6) {
    return value
  }
  if (typeof value === 'string' && /^[1-6]$/.test(value.trim())) {
    return Number(value.trim())
  }
  throw validationError('grade 必须是 1 到 6 的整数', { fields: ['grade'] })
}

function hasPresent(input, key) {
  if (!Object.hasOwn(input, key)) return false
  const value = input[key]
  return value !== undefined && value !== null && value !== ''
}

function requireScopeRole(database, scope) {
  const roleRows = database.prepare(`SELECT role_code FROM role_assignments
    WHERE organization_id = ? AND user_id = ? AND workspace_id = ? AND status = 'active'`)
    .all(scope.organizationId, scope.userId, scope.workspaceId)
  if (!roleRows.some((row) => SCOPE_ROLE_CODES.has(row.role_code))) {
    throw domainError('PERMISSION_DENIED', '当前账号角色无权查看教师阅读统计')
  }
}

function currentGradeForGradeWorkspace(database, scope, now) {
  const row = database.prepare(`
    SELECT stage, entry_year FROM classes
    WHERE organization_id = ? AND grade_id = ? AND status = 'active'
    LIMIT 1
  `).get(scope.organizationId, scope.scopeId)
  if (row) {
    return computeClassLifecycle({ stage: row.stage, entryYear: row.entry_year, now }).currentGrade
  }
  if (typeof scope.scopeId === 'string' && scope.scopeId.includes(':')) {
    const [stage, yearText] = scope.scopeId.split(':')
    const entryYear = Number(yearText)
    if (stage && Number.isInteger(entryYear)) {
      return computeClassLifecycle({ stage, entryYear, now }).currentGrade
    }
  }
  return null
}

function assertScopeLevelAllowed(database, scope, query, now) {
  if (scope.scopeType === 'class' && query.scopeLevel !== 'class') {
    throw domainError('PERMISSION_DENIED', '当前工作空间无权读取阅读统计')
  }
  if (scope.scopeType === 'grade' && query.scopeLevel === 'school') {
    throw domainError('PERMISSION_DENIED', '当前工作空间无权读取阅读统计')
  }
  if (scope.scopeType === 'grade' && query.scopeLevel === 'grade') {
    const allowedGrade = currentGradeForGradeWorkspace(database, scope, now)
    if (allowedGrade === null || allowedGrade !== query.grade) {
      throw domainError('PERMISSION_DENIED', '当前工作空间无权读取阅读统计')
    }
  }
}

const GRADE_HANZI = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六' }

function syntheticClassView(query) {
  if (query.scopeLevel === 'school') {
    return { classId: 'school', displayName: '全校' }
  }
  return {
    classId: `grade:${query.grade}`,
    displayName: `${GRADE_HANZI[query.grade]}年级（全年级）`,
  }
}

function listOrganizationClasses(database, organizationId) {
  return database.prepare(`
    SELECT id, name, grade_id, stage, entry_year
    FROM classes
    WHERE organization_id = ? AND status = 'active'
    ORDER BY id
  `).all(organizationId)
}

function resolveScopeClasses(database, organizationId, query, now) {
  const classes = listOrganizationClasses(database, organizationId)
  if (query.scopeLevel === 'school') return classes
  return classes.filter((klass) =>
    computeClassLifecycle({ stage: klass.stage, entryYear: klass.entry_year, now }).currentGrade === query.grade)
}

function normalizeScopeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('scope query 必须是对象')
  }
  const allowed = new Set(['classId', 'statDate', 'scopeLevel', 'grade'])
  const unknown = Object.keys(input).filter((key) => !allowed.has(key))
  if (unknown.length > 0) throw validationError('scope query 包含未知字段', { fields: unknown })
  if (!Object.hasOwn(input, 'statDate')) {
    throw validationError('scope query 必须同时提供 classId 和 statDate')
  }
  const statDate = exactStatDate(input.statDate)
  const scopeLevel = parseScopeLevel(input.scopeLevel)
  if (hasPresent(input, 'grade') && scopeLevel !== 'grade') {
    throw validationError('grade 仅在 scopeLevel 为 grade 时允许出现', { fields: ['grade'] })
  }
  if (scopeLevel === 'grade') {
    return {
      scopeLevel,
      grade: parseGrade(input.grade),
      statDate,
      classId: null,
    }
  }
  if (scopeLevel === 'school') {
    return {
      scopeLevel,
      statDate,
      classId: null,
    }
  }
  if (!Object.hasOwn(input, 'classId')) {
    throw validationError('scope query 必须同时提供 classId 和 statDate')
  }
  return {
    scopeLevel: 'class',
    classId: requiredText(input.classId, 'classId'),
    statDate,
  }
}

function requireScopeClass(database, scope, classId) {
  const classRow = database.prepare(`SELECT id, name, grade_id, organization_id
    FROM classes WHERE id = ? AND organization_id = ? AND status = 'active'`)
    .get(classId, scope.organizationId)
  if (!classRow) throw domainError('RESOURCE_NOT_FOUND', '班级不属于当前组织或不存在')
  requireScopeRole(database, scope)
  const inWorkspaceScope = (scope.scopeType === 'class' && scope.scopeId === classId)
    || (scope.scopeType === 'grade' && scope.scopeId === classRow.grade_id)
    || (scope.scopeType === 'school' && scope.scopeId === scope.organizationId)
  if (!inWorkspaceScope) throw domainError('PERMISSION_DENIED', '班级不在当前工作空间权限范围内')
  return classRow
}

function selectSelfRows(database, scope, throughStatDate) {
  return database.prepare(`SELECT * FROM reading_daily_book_summaries
    WHERE organization_id_at_creation = ?
      AND actor_id_at_creation = ?
      AND workspace_id_at_creation = ?
      AND stat_date <= ?
    ORDER BY stat_date, last_read_at, id`).all(
    scope.organizationId,
    scope.userId,
    scope.workspaceId,
    throughStatDate,
  )
}

function selectLastReading(database, { organizationId, actorId, workspaceId, classId = null, statDate }) {
  const params = [organizationId, actorId]
  const workspaceClause = workspaceId === null || workspaceId === undefined
    ? ''
    : ' AND summary.workspace_id_at_creation = ?'
  if (workspaceClause) params.push(workspaceId)
  params.push(statDate)
  const classClause = classId === null ? '' : ' AND summary.class_id_at_creation = ?'
  if (classId !== null) params.push(classId)
  const row = database.prepare(`SELECT
      version.book_id,
      summary.book_version_id,
      book.title,
      summary.last_page_no,
      version.page_count,
      summary.last_read_at
    FROM reading_daily_book_summaries AS summary
    JOIN book_versions AS version
      ON version.id = summary.book_version_id
      AND version.organization_id_at_creation = summary.organization_id_at_creation
    JOIN books AS book
      ON book.id = version.book_id
      AND book.organization_id_at_creation = summary.organization_id_at_creation
      AND book.status = 'published'
    WHERE summary.organization_id_at_creation = ?
      AND summary.actor_id_at_creation = ?
      ${workspaceClause}
      AND summary.stat_date <= ?${classClause}
      AND summary.last_read_at IS NOT NULL
    ORDER BY summary.last_read_at DESC, summary.last_page_no DESC, summary.id DESC
    LIMIT 1`).get(...params)
  if (!row) return null
  return {
    bookId: row.book_id,
    bookVersionId: row.book_version_id,
    title: row.title,
    lastPageNo: Number(row.last_page_no),
    totalPages: Number(row.page_count),
    lastReadAt: row.last_read_at,
  }
}

function maxUpdatedAt(rows) {
  return rows.reduce((latest, row) => !latest || row.updated_at > latest ? row.updated_at : latest, null)
}

function sumDates(totals, dates) {
  return dates.reduce((sum, date) => {
    const next = sum + (totals.get(date) || 0)
    if (!Number.isSafeInteger(next)) throw validationError('统计累计超过安全整数范围')
    return next
  }, 0)
}

function selfStatistics(database, scope, current) {
  const statDate = readingStatDateFor(current)
  const rows = selectSelfRows(database, scope, statDate)
  const totals = totalMap(rows)
  const todayMs = totals.get(statDate) || 0
  const lastWeekTotalMs = sumDates(totals, readingLastCompleteWeekDates(statDate))
  const lastReading = selectLastReading(database, {
    organizationId: scope.organizationId,
    actorId: scope.userId,
    workspaceId: scope.workspaceId,
    statDate,
  })
  return {
    generatedAt: current.toISOString(),
    dataUpdatedAt: maxUpdatedAt(rows),
    statDate,
    todayEffectiveReadingSeconds: Math.floor(todayMs / 1000),
    checkIn: {
      checked: isReadingCheckIn(todayMs),
      thresholdSeconds: CHECK_IN_MS / 1000,
      remainingSeconds: Math.ceil(Math.max(0, CHECK_IN_MS - todayMs) / 1000),
    },
    streakDays: readingStreakDays(totals, statDate),
    comparisonState: readingComparisonState(todayMs, lastWeekTotalMs),
    lastReading,
  }
}

function activeClassStudents(database, organizationId, classIds) {
  if (!Array.isArray(classIds) || classIds.length === 0) return []
  if (classIds.length === 1) {
    return database.prepare(`SELECT DISTINCT actor.id AS student_id, actor.display_name
      FROM class_memberships AS membership
      JOIN users AS actor
        ON actor.id = membership.user_id
        AND actor.organization_id = :organizationId
        AND actor.status = 'active'
      JOIN classes AS class
        ON class.id = membership.class_id
        AND class.organization_id = :organizationId
        AND class.status = 'active'
      WHERE membership.class_id = :classId
        AND membership.membership_role = 'student'
        AND membership.status = 'active'`).all({ organizationId, classId: classIds[0] })
  }
  const placeholders = classIds.map(() => '?').join(', ')
  return database.prepare(`SELECT DISTINCT actor.id AS student_id, actor.display_name
    FROM class_memberships AS membership
    JOIN users AS actor
      ON actor.id = membership.user_id
      AND actor.organization_id = ?
      AND actor.status = 'active'
    JOIN classes AS class
      ON class.id = membership.class_id
      AND class.organization_id = ?
      AND class.status = 'active'
    WHERE membership.class_id IN (${placeholders})
      AND membership.membership_role = 'student'
      AND membership.status = 'active'`).all(organizationId, organizationId, ...classIds)
}

function selectClassRows(database, organizationId, classIds, statDate) {
  if (!Array.isArray(classIds) || classIds.length === 0) return []
  if (classIds.length === 1) {
    return database.prepare(`SELECT * FROM reading_daily_book_summaries
      WHERE organization_id_at_creation = ? AND class_id_at_creation = ? AND stat_date <= ?
      ORDER BY actor_id_at_creation, stat_date, last_read_at, id`)
      .all(organizationId, classIds[0], statDate)
  }
  const placeholders = classIds.map(() => '?').join(', ')
  return database.prepare(`SELECT * FROM reading_daily_book_summaries
    WHERE organization_id_at_creation = ? AND class_id_at_creation IN (${placeholders}) AND stat_date <= ?
    ORDER BY actor_id_at_creation, stat_date, last_read_at, id`)
    .all(organizationId, ...classIds, statDate)
}

function groupRows(rows, keyFor) {
  const groups = new Map()
  for (const row of rows) {
    const key = keyFor(row)
    const values = groups.get(key) || []
    values.push(row)
    groups.set(key, values)
  }
  return groups
}

function normalizedDisplayName(value) {
  return String(value).normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
}

function factsForDate(rows, statDate) {
  const dateRows = rows.filter((row) => row.stat_date === statDate)
  const byStudent = groupRows(dateRows, (row) => row.actor_id_at_creation)
  const totals = new Map()
  for (const [studentId, studentRows] of byStudent) {
    totals.set(studentId, totalMap(studentRows).get(statDate) || 0)
  }
  return { dateRows, byStudent, totals }
}

function studentDto(database, scope, classId, student, rows, statDate) {
  const totals = totalMap(rows)
  const todayRows = rows.filter((row) => row.stat_date === statDate)
  const todayMs = totals.get(statDate) || 0
  const lastWeekTotalMs = sumDates(totals, readingLastCompleteWeekDates(statDate))
  const averageMs = Math.round(lastWeekTotalMs / 7)
  const lastReadAt = rows.reduce(
    (latest, row) => !latest || row.last_read_at > latest ? row.last_read_at : latest,
    null,
  )
  const lastReading = selectLastReading(database, {
    organizationId: scope.organizationId,
    actorId: student.student_id,
    workspaceId: null,
    classId,
    statDate,
  })
  if (lastReading) delete lastReading.lastReadAt
  return {
    studentId: student.student_id,
    displayName: student.display_name,
    todayEffectiveReadingSeconds: Math.floor(todayMs / 1000),
    checkedIn: isReadingCheckIn(todayMs),
    streakDays: readingStreakDays(totals, statDate),
    hadSkip: todayRows.some((row) => Number(row.had_skip) === 1),
    hadReread: todayRows.some((row) => Number(row.had_reread) === 1),
    lastReadAt,
    lastWeek: {
      totalEffectiveReadingSeconds: Math.floor(lastWeekTotalMs / 1000),
      dailyAverageEffectiveReadingSeconds: Math.floor(averageMs / 1000),
      todayDeltaSeconds: lastWeekTotalMs === 0 ? null : Math.trunc((todayMs - averageMs) / 1000),
      comparisonState: readingComparisonState(todayMs, lastWeekTotalMs),
    },
    recentDays: fillReadingSevenDays(totals, statDate).map((day) => ({
      statDate: day.statDate,
      effectiveReadingSeconds: Math.floor(day.effectiveReadingMs / 1000),
      checkedIn: isReadingCheckIn(day.effectiveReadingMs),
    })),
    lastReading,
  }
}

function scopeStatistics(database, scope, classIds, classView, statDate, current) {
  const students = activeClassStudents(database, scope.organizationId, classIds)
  const rows = selectClassRows(database, scope.organizationId, classIds, statDate)
  const currentStudentIds = new Set(students.map((student) => student.student_id))
  const rowsByStudent = groupRows(
    rows.filter((row) => currentStudentIds.has(row.actor_id_at_creation)),
    (row) => row.actor_id_at_creation,
  )
  const today = factsForDate(rows, statDate)
  const todayMetrics = deriveClassReadingMetrics({
    activeStudentCount: students.length,
    studentTotalsMs: students.length === 0 ? [] : [...today.totals.values()],
  })
  const trend = readingSevenStatDates(statDate).map((date) => {
    const facts = factsForDate(rows, date)
    const metrics = deriveClassReadingMetrics({
      activeStudentCount: students.length,
      studentTotalsMs: students.length === 0 ? [] : [...facts.totals.values()],
    })
    return {
      statDate: date,
      checkedInStudentCount: metrics.checkedInStudentCount,
      activeStudentCount: students.length,
      checkInRateBasisPoints: metrics.checkInRateBasisPoints,
      perCapitaEffectiveReadingSeconds: metrics.perCapitaEffectiveReadingMs === null
        ? null
        : Math.floor(metrics.perCapitaEffectiveReadingMs / 1000),
    }
  })
  const lastReadingClassId = classIds.length === 1 ? classIds[0] : null
  const studentDtos = students.map((student) => studentDto(
    database,
    scope,
    lastReadingClassId,
    student,
    rowsByStudent.get(student.student_id) || [],
    statDate,
  )).sort((left, right) => normalizedDisplayName(left.displayName).localeCompare(
    normalizedDisplayName(right.displayName),
    'zh-CN',
  ) || left.studentId.localeCompare(right.studentId))
  return {
    generatedAt: current.toISOString(),
    dataUpdatedAt: maxUpdatedAt(rows),
    statDate,
    class: {
      classId: classView.classId,
      displayName: classView.displayName,
      activeStudentCount: students.length,
    },
    summary: {
      checkedInStudentCount: todayMetrics.checkedInStudentCount,
      checkInRateBasisPoints: todayMetrics.checkInRateBasisPoints,
      totalEffectiveReadingSeconds: Math.floor(todayMetrics.totalEffectiveReadingMs / 1000),
      perCapitaEffectiveReadingSeconds: todayMetrics.perCapitaEffectiveReadingMs === null
        ? null
        : Math.floor(todayMetrics.perCapitaEffectiveReadingMs / 1000),
      skipStudentCount: students.length === 0 || today.byStudent.size === 0 ? 0 : [...today.byStudent.values()]
        .filter((studentRows) => studentRows.some((row) => Number(row.had_skip) === 1)).length,
      rereadStudentCount: students.length === 0 || today.byStudent.size === 0 ? 0 : [...today.byStudent.values()]
        .filter((studentRows) => studentRows.some((row) => Number(row.had_reread) === 1)).length,
    },
    trend,
    students: studentDtos,
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
      requireStudentSelf(database, scope)
      const suppliedNow = now()
      const current = suppliedNow instanceof Date ? suppliedNow : new Date(suppliedNow)
      if (Number.isNaN(current.getTime())) throw validationError('now 必须是有效时间')
      const result = selfStatistics(database, scope, current)
      await audit({
        eventType: 'reading.statistics.self_viewed',
        resourceType: 'student',
        resourceId: scope.userId,
      })
      return result
    },

    async getScopedSummary(authContext, input) {
      const scope = requireAuthScope(database, authContext)
      const query = normalizeScopeInput(input)
      const suppliedNow = now()
      const current = suppliedNow instanceof Date ? suppliedNow : new Date(suppliedNow)
      if (Number.isNaN(current.getTime())) throw validationError('now 必须是有效时间')
      assertScopeLevelAllowed(database, scope, query, current)
      let classIds
      let classView
      let authorizeResource
      let auditResourceId
      if (query.scopeLevel === 'class') {
        const classRow = requireScopeClass(database, scope, query.classId)
        classIds = [classRow.id]
        classView = { classId: classRow.id, displayName: classRow.name }
        auditResourceId = query.classId
        authorizeResource = {
          organizationId: scope.organizationId,
          workspaceId: scope.workspaceId,
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          classId: query.classId,
        }
      } else {
        requireScopeRole(database, scope)
        const classRows = resolveScopeClasses(database, scope.organizationId, query, current)
        classIds = classRows.map((row) => row.id)
        classView = syntheticClassView(query)
        auditResourceId = classView.classId
        authorizeResource = {
          organizationId: scope.organizationId,
          workspaceId: scope.workspaceId,
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          classIds,
        }
      }
      await requireAuthorized(authorize, 'reading.read_scope', scope, authorizeResource)
      const result = scopeStatistics(database, scope, classIds, classView, query.statDate, current)
      await audit({
        eventType: 'reading.statistics.scope_viewed',
        resourceType: 'reading_statistics_scope',
        resourceId: auditResourceId,
      })
      return result
    },
  }
}

export { readingStatDateFor }
export const readingStatisticsWindowStart = readingStatDateStart
