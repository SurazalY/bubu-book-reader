import { randomUUID } from 'node:crypto'

const DEFAULT_POLICY = Object.freeze({
  reminderSeconds: 20 * 60,
  forceRestSeconds: 30 * 60,
  restSeconds: 5 * 60,
  offlineGraceSeconds: 2 * 60,
})

export function createEyeCareDomain(dependencies = {}) {
  const database = requireDatabase(dependencies.db)
  const now = dependencies.now || (() => new Date())
  const idFactory = dependencies.idFactory || randomUUID
  const authorize = dependencies.authorize || (async () => true)
  const audit = dependencies.audit || (async () => undefined)
  const policy = normalizePolicy(dependencies.policy)

  async function getStudentStatus({ authContext, studentId } = {}) {
    const scope = requireAuthScope(database, authContext)
    const targetId = studentId || scope.user.id
    if (targetId === scope.user.id) {
      const ownTarget = requireScopedStudent(database, scope, targetId, true)
      await requireAuthorized(authorize, 'eyecare.read_self', scope, ownTarget)
      return evaluateStudent(database, ownTarget, policy, now(), idFactory)
    }
    const target = requireScopedStudent(database, scope, targetId)
    await requireAuthorized(authorize, 'eyecare.read_scoped', scope, target)
    return evaluateStudent(database, target, policy, now(), idFactory)
  }

  async function listScopedStudents({ authContext } = {}) {
    const scope = requireAuthScope(database, authContext)
    if (scope.workspace.scope_type === 'own' || scope.workspace.scope_type === 'platform') {
      throw domainError('PERMISSION_DENIED', '当前工作空间不能查看学生护眼状态')
    }
    await requireAuthorized(authorize, 'eyecare.read_scoped', scope, workspaceResource(scope.workspace))
    const targets = listStudentTargets(database, scope)
    return {
      items: targets.map((target) => evaluateStudent(database, target, policy, now(), idFactory)),
      scope: workspaceResource(scope.workspace),
    }
  }

  async function releaseFalsePositive({ authContext, studentId, falsePositive, reason } = {}) {
    if (falsePositive !== true) throw domainError('VALIDATION_FAILED', '护眼限制只能按误判解除')
    const normalizedReason = requiredText(reason, 'reason', 4)
    const scope = requireAuthScope(database, authContext)
    if (scope.user.id === studentId) throw domainError('PERMISSION_DENIED', '学生不能自行解除护眼限制')
    const target = requireScopedStudent(database, scope, requiredText(studentId, 'studentId'))
    await requireAuthorized(authorize, 'eyecare.release_false_positive', scope, target)
    const evaluated = evaluateStudent(database, target, policy, now(), idFactory)
    if (!['reminder', 'forced_rest'].includes(evaluated.enforcement.status)) {
      throw domainError('STATE_CONFLICT', '当前学生没有可按误判解除的护眼限制')
    }
    const current = normalizeDate(now())
    const currentIso = current.toISOString()
    const releasedUntil = new Date(current.getTime() + policy.restSeconds * 1000).toISOString()
    const state = database.prepare(`SELECT id FROM eye_care_enforcement_states
      WHERE organization_id = ? AND actor_user_id = ? AND workspace_id = ?`)
      .get(scope.organizationId, target.studentId, target.workspaceId)
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare(`UPDATE eye_care_enforcement_states
        SET status = 'normal', recovered_at = ?, recovery_source = 'false_positive_release',
          released_until = ?, last_evaluated_at = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND organization_id = ? AND actor_user_id = ? AND workspace_id = ?`)
        .run(currentIso, releasedUntil, currentIso, currentIso, state.id,
          scope.organizationId, target.studentId, target.workspaceId)
      database.prepare(`INSERT INTO eye_care_release_records
        (id, enforcement_state_id, organization_id, actor_user_id, workspace_id,
          released_by_user_id, reason, released_until, created_at, updated_at, version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
        .run(idFactory(), state.id, scope.organizationId, target.studentId, target.workspaceId,
          scope.user.id, normalizedReason, releasedUntil, currentIso, currentIso)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    await audit({
      eventType: 'eyecare.false_positive_released',
      resourceType: 'user',
      resourceId: target.studentId,
      actorId: scope.user.id,
      workspaceId: scope.workspace.id,
      details: { reason: normalizedReason, releasedUntil },
    })
    return evaluateStudent(database, target, policy, now(), idFactory)
  }

  return { getStudentStatus, listScopedStudents, releaseFalsePositive }
}

function evaluateStudent(database, target, policy, value, idFactory) {
  const current = normalizeDate(value)
  const currentIso = current.toISOString()
  const dayStart = eyeCareWindowStart(current, 'day')
  const weekStart = eyeCareWindowStart(current, 'week')
  const metrics = database.prepare(`SELECT continuous_eye_seconds, last_active_at
    FROM eye_care_states WHERE actor_id = ? AND workspace_id = ?`)
    .get(target.studentId, target.workspaceId) || { continuous_eye_seconds: 0, last_active_at: null }
  const dailyValidEyeSeconds = usageFor(database, target.studentId, target.workspaceId, 'day', dayStart)
  const weeklyValidEyeSeconds = usageFor(database, target.studentId, target.workspaceId, 'week', weekStart)
  const existing = database.prepare(`SELECT * FROM eye_care_enforcement_states
    WHERE organization_id = ? AND actor_user_id = ? AND workspace_id = ?`)
    .get(target.organizationId, target.studentId, target.workspaceId)
  const storedContinuousSeconds = Number(metrics.continuous_eye_seconds || 0)
  const recoveredAfterLastActivity = existing?.recovered_at && metrics.last_active_at
    && Date.parse(existing.recovered_at) >= Date.parse(metrics.last_active_at)
  const effectiveContinuousSeconds = recoveredAfterLastActivity ? 0 : storedContinuousSeconds
  const transition = deriveTransition(existing, effectiveContinuousSeconds, policy, current)
  persistTransition(database, existing, target, transition, currentIso, idFactory)
  const continuousEyeSeconds = transition.recoverySource === 'timer'
    || transition.recoverySource === 'false_positive_release'
    ? 0
    : effectiveContinuousSeconds
  return {
    studentId: target.studentId,
    studentDisplayName: target.studentDisplayName,
    workspaceId: target.workspaceId,
    classId: target.classId,
    dayWindowStart: dayStart.toISOString(),
    weekWindowStart: weekStart.toISOString(),
    continuousEyeSeconds,
    dailyValidEyeSeconds,
    weeklyValidEyeSeconds,
    lastActiveAt: metrics.last_active_at,
    enforcement: {
      status: transition.status,
      reminderAt: transition.reminderAt,
      forcedRestStartedAt: transition.forcedRestStartedAt,
      forcedRestUntil: transition.forcedRestUntil,
      recoveredAt: transition.recoveredAt,
      recoverySource: transition.recoverySource,
      policy,
      offline: {
        failClosed: transition.status === 'forced_rest',
        graceSeconds: policy.offlineGraceSeconds,
        enforceUntil: transition.forcedRestUntil,
      },
    },
  }
}

function deriveTransition(existing, continuousSeconds, policy, now) {
  if (existing?.released_until && Date.parse(existing.released_until) > now.getTime()) {
    return stateFromExisting(existing, 'normal', 'false_positive_release')
  }
  if (existing?.status === 'forced_rest' && existing.forced_rest_until) {
    if (Date.parse(existing.forced_rest_until) > now.getTime()) return stateFromExisting(existing, 'forced_rest')
    return {
      status: 'normal',
      reminderAt: existing.reminder_at,
      forcedRestStartedAt: existing.forced_rest_started_at,
      forcedRestUntil: existing.forced_rest_until,
      recoveredAt: now.toISOString(),
      recoverySource: 'timer',
      releasedUntil: null,
    }
  }
  if (continuousSeconds >= policy.forceRestSeconds) {
    const startedAt = now.toISOString()
    return {
      status: 'forced_rest',
      reminderAt: existing?.reminder_at || startedAt,
      forcedRestStartedAt: startedAt,
      forcedRestUntil: new Date(now.getTime() + policy.restSeconds * 1000).toISOString(),
      recoveredAt: null,
      recoverySource: null,
      releasedUntil: null,
    }
  }
  if (continuousSeconds >= policy.reminderSeconds) {
    return {
      status: 'reminder',
      reminderAt: existing?.reminder_at || now.toISOString(),
      forcedRestStartedAt: null,
      forcedRestUntil: null,
      recoveredAt: null,
      recoverySource: null,
      releasedUntil: null,
    }
  }
  return {
    status: 'normal',
    reminderAt: null,
    forcedRestStartedAt: null,
    forcedRestUntil: null,
    recoveredAt: existing?.recovered_at || null,
    recoverySource: null,
    releasedUntil: null,
  }
}

function stateFromExisting(existing, status, recoverySource = existing.recovery_source) {
  return {
    status,
    reminderAt: existing.reminder_at,
    forcedRestStartedAt: existing.forced_rest_started_at,
    forcedRestUntil: existing.forced_rest_until,
    recoveredAt: existing.recovered_at,
    recoverySource,
    releasedUntil: existing.released_until,
  }
}

function persistTransition(database, existing, target, transition, now, idFactory) {
  database.prepare(`INSERT INTO eye_care_enforcement_states
      (id, organization_id, actor_user_id, workspace_id, status, reminder_at,
        forced_rest_started_at, forced_rest_until, recovered_at, recovery_source, released_until,
        last_evaluated_at, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(organization_id, actor_user_id, workspace_id) DO UPDATE SET
      status = excluded.status, reminder_at = excluded.reminder_at,
      forced_rest_started_at = excluded.forced_rest_started_at,
      forced_rest_until = excluded.forced_rest_until, recovered_at = excluded.recovered_at,
      recovery_source = excluded.recovery_source, released_until = excluded.released_until,
      last_evaluated_at = excluded.last_evaluated_at, updated_at = excluded.updated_at,
      version = eye_care_enforcement_states.version + 1`)
    .run(existing?.id || idFactory(), target.organizationId, target.studentId, target.workspaceId,
      transition.status, transition.reminderAt, transition.forcedRestStartedAt,
      transition.forcedRestUntil, transition.recoveredAt, transition.recoverySource,
      transition.releasedUntil, now, existing?.created_at || now, now)
}

function requireAuthScope(database, authContext) {
  const organizationId = requiredText(authContext?.organizationId, 'authContext.organizationId')
  const userId = requiredText(authContext?.userId, 'authContext.userId')
  const workspaceId = requiredText(authContext?.workspaceId, 'authContext.workspaceId')
  const user = database.prepare(`SELECT id, organization_id, display_name FROM users
    WHERE id = ? AND organization_id = ? AND status = 'active'`).get(userId, organizationId)
  const workspace = database.prepare(`SELECT * FROM workspaces
    WHERE id = ? AND organization_id = ? AND status = 'active'`).get(workspaceId, organizationId)
  if (!user || !workspace) throw domainError('RESOURCE_NOT_FOUND', '当前身份或工作空间不存在')
  return { organizationId, user, workspace, authContext: { organizationId, userId, workspaceId } }
}

function requireScopedStudent(database, scope, studentId, allowSelf = false) {
  const target = listStudentTargets(database, scope).find((item) => item.studentId === studentId)
  if (target) return target
  if (allowSelf && scope.user.id === studentId) {
    const student = database.prepare(`SELECT id, display_name FROM users
      WHERE id = ? AND organization_id = ? AND status = 'active'`).get(studentId, scope.organizationId)
    if (student) return {
      organizationId: scope.organizationId,
      studentId: student.id,
      studentDisplayName: student.display_name,
      workspaceId: scope.workspace.id,
      classId: scope.workspace.scope_type === 'class' ? scope.workspace.scope_id : null,
    }
  }
  throw domainError('RESOURCE_NOT_FOUND', '学生不在当前工作空间的有效范围内')
}

function listStudentTargets(database, scope) {
  const clauses = [`student.organization_id = ?`, `student.status = 'active'`, `membership.membership_role = 'student'`,
    `membership.status = 'active'`, `class.status = 'active'`, `class.organization_id = ?`,
    `student_workspace.organization_id = ?`, `student_workspace.scope_type = 'class'`,
    `student_workspace.scope_id = class.id`, `student_workspace.status = 'active'`]
  const values = [scope.organizationId, scope.organizationId, scope.organizationId]
  if (scope.workspace.scope_type === 'class') {
    clauses.push('class.id = ?')
    values.push(scope.workspace.scope_id)
  } else if (scope.workspace.scope_type === 'grade') {
    clauses.push('class.grade_id = ?')
    values.push(scope.workspace.scope_id)
  } else if (scope.workspace.scope_type === 'school') {
    clauses.push('class.organization_id = ?')
    values.push(scope.organizationId)
  } else if (scope.workspace.scope_type === 'own') {
    clauses.push('student.id = ?')
    values.push(scope.user.id)
  } else {
    return []
  }
  return database.prepare(`SELECT DISTINCT student.id AS student_id, student.display_name,
      class.id AS class_id, student_workspace.id AS workspace_id
    FROM users AS student
    JOIN class_memberships AS membership ON membership.user_id = student.id
    JOIN classes AS class ON class.id = membership.class_id
    JOIN workspaces AS student_workspace ON student_workspace.scope_id = class.id
    WHERE ${clauses.join(' AND ')}
    ORDER BY student.id, student_workspace.id`).all(...values).map((row) => ({
    organizationId: scope.organizationId,
    studentId: row.student_id,
    studentDisplayName: row.display_name,
    workspaceId: row.workspace_id,
    classId: row.class_id,
  }))
}

async function requireAuthorized(authorize, action, scope, resource) {
  const allowed = await authorize({
    authContext: scope.authContext,
    actor: scope.user,
    workspace: scope.workspace,
    action,
    resource,
  })
  if (!allowed) throw domainError('PERMISSION_DENIED', '当前工作空间无权执行此操作')
}

function workspaceResource(workspace) {
  return {
    organizationId: workspace.organization_id,
    workspaceId: workspace.id,
    scopeType: workspace.scope_type,
    scopeId: workspace.scope_id,
  }
}

function usageFor(database, actorId, workspaceId, kind, windowStart) {
  return Number(database.prepare(`SELECT valid_eye_seconds FROM eye_care_usage
    WHERE actor_id = ? AND workspace_id = ? AND window_kind = ? AND window_start_at = ?`)
    .get(actorId, workspaceId, kind, windowStart.toISOString())?.valid_eye_seconds || 0)
}

export function eyeCareWindowStart(value, kind) {
  if (!['day', 'week'].includes(kind)) throw new TypeError('kind 必须为 day 或 week')
  const date = normalizeDate(value)
  const shifted = new Date(date.getTime() + 4 * 60 * 60 * 1000)
  if (kind === 'week') {
    const day = shifted.getUTCDay() || 7
    shifted.setUTCDate(shifted.getUTCDate() - day + 1)
  }
  const localStart = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), 4, 0, 0, 0)
  return new Date(localStart - 8 * 60 * 60 * 1000)
}

function normalizePolicy(input = {}) {
  const policy = { ...DEFAULT_POLICY, ...(input || {}) }
  for (const key of Object.keys(DEFAULT_POLICY)) {
    if (!Number.isInteger(policy[key]) || policy[key] < 1) throw new TypeError(`${key} 必须是正整数秒数`)
  }
  if (policy.forceRestSeconds <= policy.reminderSeconds) throw new TypeError('forceRestSeconds 必须大于 reminderSeconds')
  return Object.freeze(policy)
}

function requireDatabase(database) {
  if (!database || typeof database.prepare !== 'function') throw new TypeError('db 必须是 node:sqlite 数据库')
  return database
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new TypeError('时间必须有效')
  return date
}

function requiredText(value, name, minimum = 1) {
  if (typeof value !== 'string' || value.trim().length < minimum) {
    throw domainError('VALIDATION_FAILED', `${name} 不能为空`)
  }
  return value.trim()
}

function domainError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}
