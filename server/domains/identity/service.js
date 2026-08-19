import { randomBytes, randomUUID } from 'node:crypto'

import { HttpError } from '../../db/errors.js'
import { appendAuditEvent, enqueueOutboxEvent, readCoreHealth } from '../../db/reliability.js'
import { importIdentitySeed } from '../../db/seed.js'
import { hashPassword, isPasswordInputAllowed, MAX_PASSWORD_LENGTH, verifyPassword } from '../../auth/password.js'
import {
  assertSessionSecret,
  createServerSession,
  inspectServerSession,
  reissueSessionToken,
  revokeServerSession,
  validateSessionTtlMs,
} from '../../auth/session.js'
import { computeClassLifecycle, computeGradeId } from './lifecycle.js'
import { createPermissionEvaluator, normalizeRoleCode } from './permissions.js'
import {
  accountCodeExists,
  countActiveTeacherClasses,
  createClassWithWorkspace,
  findActiveStudentMembership,
  findClassById,
  findClassWorkspace,
  findCredentialByLoginName,
  findEnrollmentRequestById,
  findGradeWorkspace,
  findLoginName,
  findOrganizationById,
  findPasswordResetByHash,
  findPendingEnrollmentForUser,
  findRegistrationByHash,
  findRegistrationById,
  findSchoolWorkspace,
  findUserById,
  findUserScope,
  findWorkspaceForUser,
  hasActiveGradeManagerAssignment,
  hasStudentRegistrationUse,
  hasStudentRoleEvidence,
  hasTeacherRegistrationUse,
  hasTeacherRoleEvidence,
  listActiveRoleAssignments,
  listLoginNamesInOrganization,
  listOrganizationClasses,
  listEnrollmentRequestsForClass,
  listPasswordResetCredentialMetadata,
  listPendingEnrollmentRequestsForUser,
  listRegistrationCredentialMetadata,
  listWorkspacesForUser,
  loadStudentTriple,
  loadTeacherTriple,
  revokeAllSessionsForUser,
  updatePasswordHash,
  updateUserDisplayName,
} from './repository.js'
import {
  ACCOUNT_NOT_FOUND_MESSAGE,
  CLASS_NOT_FOUND_MESSAGE,
  ENROLLMENT_NOT_FOUND_MESSAGE,
  LOGIN_FAILURE_MESSAGE,
  PASSWORD_RESET_NOT_FOUND_MESSAGE,
  REGISTRATION_NOT_FOUND_MESSAGE,
  accountCodeFromUserId,
  addDays,
  addMinutes,
  invariantViolation,
  loginNameSuggestions,
  notFound,
  parseClassName,
  parseClassNumber,
  parseDisplayName,
  parseEntryYear,
  parseExpectedRole,
  parseExpiresAt,
  parseLoginName,
  parseMaxUses,
  parseReason,
  parseStage,
  permissionDenied,
  rejectInjectedIdentityFields,
  resourceConflict,
  sha256Hex,
  trimString,
  validationFailed,
  versionConflict,
} from './validation.js'

export { computeClassLifecycle, computeGradeId } from './lifecycle.js'

function publicUser(user) {
  return {
    id: user.id,
    organizationId: user.organizationId,
    username: user.username,
    displayName: user.displayName,
    status: user.status,
    version: user.version,
  }
}

function invalidCredentialsOutcome() {
  return {
    statusCode: 401,
    payload: {
      error: {
        code: 'AUTH_REQUIRED',
        message: LOGIN_FAILURE_MESSAGE,
        retryable: false,
        details: {},
      },
    },
  }
}

const consoleEntryActions = [
  'reading.read_scope',
  'safety.review',
  'community.moderate',
  'report.generate',
  'audit.read_platform',
]

export function workspaceResourceScope(actor, workspace) {
  return {
    type: workspace.scopeType,
    id: workspace.scopeId,
    scopeType: workspace.scopeType,
    scopeId: workspace.scopeId,
    organizationId: workspace.organizationId,
    ownerId: workspace.scopeType === 'own' ? actor.id : undefined,
    classId: workspace.scopeType === 'class' ? workspace.scopeId : undefined,
    gradeId: workspace.scopeType === 'grade' ? workspace.scopeId : undefined,
  }
}

function classifyTriple(triple) {
  const counts = [triple.memberships.length, triple.workspaceMemberships.length, triple.roleAssignments.length]
  if (counts.every((count) => count === 0)) return 'absent'
  if (counts.some((count) => count !== 1)) return 'broken'
  const statuses = [triple.memberships[0].status, triple.workspaceMemberships[0].status, triple.roleAssignments[0].status]
  if (statuses.every((status) => status === 'active')) return 'active'
  if (statuses.every((status) => status === 'disabled')) return 'disabled'
  return 'broken'
}

function classDto(klass, now) {
  const lifecycle = computeClassLifecycle({ stage: klass.stage, entryYear: klass.entryYear, now })
  return {
    id: klass.id,
    name: klass.name,
    stage: klass.stage,
    entryYear: klass.entryYear,
    classNumber: klass.classNumber,
    gradeId: klass.gradeId,
    currentGrade: lifecycle.currentGrade,
    lifecycle: lifecycle.lifecycle,
    status: klass.status,
    version: klass.version,
  }
}

function classResourceScope(klass) {
  return {
    type: 'class',
    id: klass.id,
    organizationId: klass.organizationId,
    classId: klass.id,
    gradeId: klass.gradeId,
  }
}

function schoolResourceScope(organizationId, gradeId) {
  return {
    type: 'school',
    id: organizationId,
    organizationId,
    ...(gradeId ? { gradeId } : {}),
  }
}

function opaqueClassNotFound() {
  return notFound(CLASS_NOT_FOUND_MESSAGE)
}

function opaqueAccountNotFound() {
  return notFound(ACCOUNT_NOT_FOUND_MESSAGE)
}

const ENROLLMENT_LIST_STATUSES = new Set(['pending', 'approved', 'rejected'])

function accountCodeSuffix(accountCode) {
  const value = typeof accountCode === 'string' ? accountCode : ''
  return value.slice(-4)
}

function registrationCredentialStatus(row, now) {
  if (row.revokedAt) return 'revoked'
  if (row.expiresAt <= now) return 'expired'
  if (row.maxUses != null && row.successfulUseCount >= row.maxUses) return 'exhausted'
  return 'active'
}

function passwordResetCredentialStatus(row, now) {
  if (row.revokedAt) return 'revoked'
  if (row.usedAt) return 'used'
  if (row.expiresAt <= now) return 'expired'
  return 'active'
}

export function createIdentityService(options) {
  const database = options.database
  const sessionSecret = options.sessionSecret
  assertSessionSecret(sessionSecret)
  const sessionTtlMs = validateSessionTtlMs(options.sessionTtlMs)
  const cookieName = options.cookieName ?? 'readmate_session'
  const evaluatePermission = createPermissionEvaluator(options.permissionPolicy)

  function login({ loginName, password, requestId, idempotencyKey, now }) {
    if (!isPasswordInputAllowed(password)) {
      throw new HttpError(400, 'VALIDATION_FAILED', `password 必须为 1 到 ${MAX_PASSWORD_LENGTH} 个字符`)
    }
    const normalizedLogin = trimString(loginName)
    if (!normalizedLogin) {
      throw validationFailed('loginName 为必填项')
    }
    const credential = findCredentialByLoginName(database, normalizedLogin)
    if (
      !credential ||
      credential.user.status !== 'active' ||
      credential.organizationStatus !== 'active' ||
      !verifyPassword(password, credential.passwordHash)
    ) {
      appendAuditEvent(database, {
        eventType: 'auth.login.failed',
        requestId,
        idempotencyKey,
        outcome: 'denied',
        reasonCode: 'INVALID_CREDENTIALS',
        createdAt: now,
      })
      return invalidCredentialsOutcome()
    }

    const workspaces = listWorkspacesForUser(database, credential.user.id)
    const navigation = navigationForUser(credential.user, workspaces)
    const session = createServerSession(database, {
      userId: credential.user.id,
      sessionSecret,
      ttlMs: sessionTtlMs,
      now,
    })
    appendAuditEvent(database, {
      eventType: 'auth.login.succeeded',
      actorUserId: credential.user.id,
      requestId,
      idempotencyKey,
      outcome: 'succeeded',
      resourceType: 'session',
      resourceId: session.id,
      scopeSnapshot: { organizationId: credential.user.organizationId },
      createdAt: now,
    })
    return {
      statusCode: 200,
      sessionId: session.id,
      payload: {
        data: {
          user: publicUser(credential.user),
          workspaces,
          activeWorkspaceId: navigation.defaultWorkspaceId ?? null,
          navigation,
          expiresAt: session.expiresAt,
        },
      },
    }
  }

  function inspectSession(token) {
    return inspectServerSession(database, token, sessionSecret)
  }

  function reissueSession(sessionId) {
    return reissueSessionToken(database, sessionId, sessionSecret)
  }

  function resolveWorkspace(userId, workspaceId) {
    return findWorkspaceForUser(database, userId, workspaceId)
  }

  function recordWorkspaceUse({ actorUserId, workspace, requestId }) {
    appendAuditEvent(database, {
      eventType: 'workspace.used',
      actorUserId,
      workspaceId: workspace.id,
      requestId,
      resourceType: 'workspace',
      resourceId: workspace.id,
      scopeSnapshot: {
        type: workspace.scopeType,
        id: workspace.scopeId,
        organizationId: workspace.organizationId,
      },
    })
  }

  function authorize({ actor, workspace, action, resourceScope }) {
    const assignments = listActiveRoleAssignments(database, actor.id, workspace.id, workspace.organizationId)
    return evaluatePermission({
      assignments,
      action,
      resourceScope,
      actorUserId: actor.id,
      authContext: {
        workspaceId: workspace.id,
        organizationId: workspace.organizationId,
      },
    })
  }

  function requireAuthorized({ actor, workspace, action, resourceScope }) {
    if (!authorize({ actor, workspace, action, resourceScope })) {
      throw permissionDenied()
    }
  }

  function teacherVEvidence(user) {
    return (
      hasTeacherRegistrationUse(database, { userId: user.id, organizationId: user.organizationId }) ||
      hasTeacherRoleEvidence(database, { userId: user.id, organizationId: user.organizationId })
    )
  }

  function studentEvidence(user) {
    return (
      hasStudentRegistrationUse(database, { userId: user.id, organizationId: user.organizationId }) ||
      hasStudentRoleEvidence(database, { userId: user.id, organizationId: user.organizationId }) ||
      listPendingEnrollmentRequestsForUser(database, user.id).some((row) => row.status === 'pending' || row.status === 'rejected')
    )
  }

  function assertBaseIdentity(user) {
    const teacher = teacherVEvidence(user)
    const student = studentEvidence(user)
    if (teacher && student) {
      throw invariantViolation('同一账号同时存在 student 与 teacher 基础身份证据')
    }
    return { teacher, student }
  }

  function requireTeacherV(user) {
    const identity = assertBaseIdentity(user)
    if (!identity.teacher) {
      throw permissionDenied()
    }
  }

  function isVerifiedTeacher(user) {
    return teacherVEvidence(user)
  }

  function allowsGradeManagerSchoolException(actor, workspace, action) {
    const allowed = new Set([
      'registration.teacher.issue',
      'registration.teacher.revoke',
      'password_reset.teacher.issue',
      'password_reset.teacher.revoke',
    ])
    if (!allowed.has(action)) return false
    return hasActiveGradeManagerAssignment(database, {
      userId: actor.id,
      workspaceId: workspace.id,
      organizationId: workspace.organizationId,
    })
  }

  function authorizeOrGradeManagerTeacherException({ actor, workspace, action, resourceScope }) {
    if (authorize({ actor, workspace, action, resourceScope })) return
    if (allowsGradeManagerSchoolException(actor, workspace, action)) return
    throw permissionDenied()
  }

  function navigationForUser(actor, providedWorkspaces = listWorkspacesForUser(database, actor.id)) {
    const entries = []
    for (const workspace of providedWorkspaces) {
      const resourceScope = workspaceResourceScope(actor, workspace)
      if (authorize({ actor, workspace, action: 'reading.read_self', resourceScope })) {
        entries.push({ kind: 'student', path: '/student/home', workspaceId: workspace.id })
      }
      if (consoleEntryActions.some((action) => authorize({ actor, workspace, action, resourceScope }))) {
        entries.push({ kind: 'console', path: '/console/home', workspaceId: workspace.id })
      }
    }
    const defaultEntry = entries.find((entry) => entry.kind === 'console') ?? entries[0] ?? null
    if (defaultEntry) {
      return {
        defaultPath: defaultEntry.path,
        defaultWorkspaceId: defaultEntry.workspaceId,
        entries,
      }
    }

    const identity = assertBaseIdentity(actor)
    if (identity.student) {
      return {
        defaultPath: '/student/onboarding',
        defaultWorkspaceId: null,
        entries,
      }
    }
    if (identity.teacher && countActiveTeacherClasses(database, actor.id) === 0) {
      return {
        defaultPath: '/console/select-class',
        defaultWorkspaceId: null,
        entries,
      }
    }
    return {
      defaultPath: defaultEntry?.path ?? null,
      defaultWorkspaceId: defaultEntry?.workspaceId ?? null,
      entries,
    }
  }

  function getUserScope(userId, workspace) {
    const user = findUserById(database, userId)
    if (!user) {
      throw opaqueAccountNotFound()
    }
    if (workspace && workspace.scopeType !== 'platform' && user.organizationId !== workspace.organizationId) {
      throw opaqueAccountNotFound()
    }
    const scope = findUserScope(database, userId)
    if (!scope) {
      throw opaqueAccountNotFound()
    }
    return scope
  }

  function getUser(userId, workspace) {
    const user = findUserById(database, userId)
    if (!user) {
      throw opaqueAccountNotFound()
    }
    if (workspace && workspace.scopeType !== 'platform' && user.organizationId !== workspace.organizationId) {
      throw opaqueAccountNotFound()
    }
    return publicUser(user)
  }

  function getClassScope(classId, workspace) {
    const klass = findClassById(database, classId)
    if (!klass || (workspace && klass.organizationId !== workspace.organizationId)) {
      throw opaqueClassNotFound()
    }
    return classResourceScope(klass)
  }

  function knownClass(classId, organizationId) {
    const klass = findClassById(database, classId)
    if (!klass || klass.organizationId !== organizationId) {
      throw opaqueClassNotFound()
    }
    return klass
  }

  function teacherUsersForClass(classId) {
    const membershipUsers = database
      .prepare(`SELECT user_id AS userId FROM class_memberships WHERE class_id = ? AND membership_role = 'teacher'`)
      .all(classId)
      .map((row) => row.userId)
    const roleUsers = database
      .prepare(`
        SELECT user_id AS userId FROM role_assignments
        WHERE scope_type = 'class' AND scope_id = ? AND role_code IN ('teacher', 'class_teacher')
      `)
      .all(classId)
      .map((row) => row.userId)
    return [...new Set([...membershipUsers, ...roleUsers])]
  }

  function teacherCountForClass(classId) {
    const users = teacherUsersForClass(classId)
    let active = 0
    for (const userId of users) {
      const state = classifyTriple(loadTeacherTriple(database, { userId, classId }))
      if (state === 'broken') {
        throw invariantViolation('教师三元组残缺或不一致')
      }
      if (state === 'active') active += 1
    }
    return active
  }

  function studentCountForClass(classId) {
    return database
      .prepare(`SELECT COUNT(*) AS count FROM class_memberships WHERE class_id = ? AND membership_role = 'student' AND status = 'active'`)
      .get(classId).count
  }

  function pendingStudentCountForClass(classId) {
    return database
      .prepare(`SELECT COUNT(*) AS count FROM student_enrollment_requests WHERE class_id = ? AND status = 'pending'`)
      .get(classId).count
  }

  function ensureGradeWorkspace({ organizationId, gradeId, now }) {
    const existing = findGradeWorkspace(database, { organizationId, gradeId })
    if (existing) return existing
    const workspaceId = randomUUID()
    database
      .prepare(`
        INSERT INTO workspaces (
          id, organization_id, code, name, scope_type, scope_id,
          status, created_at, updated_at, version
        ) VALUES (?, ?, 'grade-admin', ?, 'grade', ?, 'active', ?, ?, 1)
      `)
      .run(workspaceId, organizationId, `grade-${gradeId}`, gradeId, now, now)
    return findGradeWorkspace(database, { organizationId, gradeId })
  }

  function writeTeacherTriple({ userId, organizationId, classId, now, status }) {
    const workspace = findClassWorkspace(database, { organizationId, classId, anyStatus: true })
    if (!workspace) {
      throw invariantViolation('班级缺少 class workspace，无法维护教师三元组')
    }
    const triple = loadTeacherTriple(database, { userId, classId })
    const state = classifyTriple(triple)
    if (state === 'broken') {
      throw invariantViolation('教师三元组残缺，已停止并拒绝自动修复')
    }
    if (status === 'active') {
      if (state === 'active') {
        return { state: 'active', workspaceId: workspace.id, noop: true }
      }
      if (state === 'disabled') {
        for (const [table, id] of [
          ['class_memberships', triple.memberships[0].id],
          ['workspace_memberships', triple.workspaceMemberships[0].id],
          ['role_assignments', triple.roleAssignments[0].id],
        ]) {
          database.prepare(`UPDATE ${table} SET status = 'active', updated_at = ?, version = version + 1 WHERE id = ?`).run(now, id)
        }
        return { state: 'active', workspaceId: workspace.id, noop: false }
      }
      database
        .prepare(`
          INSERT INTO class_memberships (id, class_id, user_id, membership_role, status, created_at, updated_at, version)
          VALUES (?, ?, ?, 'teacher', 'active', ?, ?, 1)
        `)
        .run(randomUUID(), classId, userId, now, now)
      database
        .prepare(`
          INSERT INTO workspace_memberships (id, user_id, workspace_id, status, created_at, updated_at, version)
          VALUES (?, ?, ?, 'active', ?, ?, 1)
        `)
        .run(randomUUID(), userId, workspace.id, now, now)
      database
        .prepare(`
          INSERT INTO role_assignments (
            id, organization_id, user_id, workspace_id, role_code,
            scope_type, scope_id, status, created_at, updated_at, version
          ) VALUES (?, ?, ?, ?, 'teacher', 'class', ?, 'active', ?, ?, 1)
        `)
        .run(randomUUID(), organizationId, userId, workspace.id, classId, now, now)
      return { state: 'active', workspaceId: workspace.id, noop: false }
    }

    if (state === 'disabled' || state === 'absent') {
      return { state, workspaceId: workspace.id, noop: true }
    }
    for (const [table, id] of [
      ['class_memberships', triple.memberships[0].id],
      ['workspace_memberships', triple.workspaceMemberships[0].id],
      ['role_assignments', triple.roleAssignments[0].id],
    ]) {
      database.prepare(`UPDATE ${table} SET status = 'disabled', updated_at = ?, version = version + 1 WHERE id = ?`).run(now, id)
    }
    return { state: 'disabled', workspaceId: workspace.id, noop: false }
  }

  function writeStudentTriple({ userId, organizationId, classId, now, status }) {
    const workspace = findClassWorkspace(database, { organizationId, classId, anyStatus: true })
    if (!workspace) {
      throw invariantViolation('班级缺少 class workspace，无法维护学生三元组')
    }
    const triple = loadStudentTriple(database, { userId, classId })
    const state = classifyTriple(triple)
    if (state === 'broken') {
      throw invariantViolation('学生三元组残缺，已停止并拒绝自动修复')
    }
    if (status === 'active') {
      if (state === 'active') return { state: 'active', workspaceId: workspace.id, noop: true }
      if (state === 'disabled') {
        for (const [table, id] of [
          ['class_memberships', triple.memberships[0].id],
          ['workspace_memberships', triple.workspaceMemberships[0].id],
          ['role_assignments', triple.roleAssignments[0].id],
        ]) {
          database.prepare(`UPDATE ${table} SET status = 'active', updated_at = ?, version = version + 1 WHERE id = ?`).run(now, id)
        }
        return { state: 'active', workspaceId: workspace.id, noop: false }
      }
      database
        .prepare(`
          INSERT INTO class_memberships (id, class_id, user_id, membership_role, status, created_at, updated_at, version)
          VALUES (?, ?, ?, 'student', 'active', ?, ?, 1)
        `)
        .run(randomUUID(), classId, userId, now, now)
      database
        .prepare(`
          INSERT INTO workspace_memberships (id, user_id, workspace_id, status, created_at, updated_at, version)
          VALUES (?, ?, ?, 'active', ?, ?, 1)
        `)
        .run(randomUUID(), userId, workspace.id, now, now)
      database
        .prepare(`
          INSERT INTO role_assignments (
            id, organization_id, user_id, workspace_id, role_code,
            scope_type, scope_id, status, created_at, updated_at, version
          ) VALUES (?, ?, ?, ?, 'student', 'class', ?, 'active', ?, ?, 1)
        `)
        .run(randomUUID(), organizationId, userId, workspace.id, classId, now, now)
      return { state: 'active', workspaceId: workspace.id, noop: false }
    }
    if (state === 'disabled' || state === 'absent') {
      return { state, workspaceId: workspace.id, noop: true }
    }
    for (const [table, id] of [
      ['class_memberships', triple.memberships[0].id],
      ['workspace_memberships', triple.workspaceMemberships[0].id],
      ['role_assignments', triple.roleAssignments[0].id],
    ]) {
      database.prepare(`UPDATE ${table} SET status = 'disabled', updated_at = ?, version = version + 1 WHERE id = ?`).run(now, id)
    }
    return { state: 'disabled', workspaceId: workspace.id, noop: false }
  }

  function classJoinAllowed(klass, now) {
    if (klass.status !== 'active') return false
    return computeClassLifecycle({ stage: klass.stage, entryYear: klass.entryYear, now }).lifecycle !== 'graduated'
  }

  function joinTeacherClass({ actor, classId, requestId, idempotencyKey, now }) {
    requireTeacherV(actor)
    const klass = knownClass(classId, actor.organizationId)
    if (!classJoinAllowed(klass, now)) {
      throw resourceConflict('班级当前不可加入')
    }
    const result = writeTeacherTriple({
      userId: actor.id,
      organizationId: actor.organizationId,
      classId,
      now,
      status: 'active',
    })
    appendAuditEvent(database, {
      eventType: 'identity.teacher.joined',
      actorUserId: actor.id,
      workspaceId: null,
      requestId,
      idempotencyKey,
      resourceType: 'class',
      resourceId: classId,
      scopeSnapshot: { organizationId: actor.organizationId, classId },
      createdAt: now,
    })
    return {
      statusCode: 200,
      payload: {
        data: {
          status: result.state,
          workspaceId: result.workspaceId,
          activeWorkspaceId: result.workspaceId,
          teacherCount: teacherCountForClass(classId),
        },
      },
    }
  }

  function leaveTeacherClass({ actor, classId, requestId, idempotencyKey, now }) {
    knownClass(classId, actor.organizationId)
    const triple = loadTeacherTriple(database, { userId: actor.id, classId })
    if (classifyTriple(triple) === 'broken') {
      throw invariantViolation('教师三元组残缺，已停止并拒绝自动修复')
    }
    requireTeacherV(actor)
    const result = writeTeacherTriple({
      userId: actor.id,
      organizationId: actor.organizationId,
      classId,
      now,
      status: 'disabled',
    })
    appendAuditEvent(database, {
      eventType: 'identity.teacher.left',
      actorUserId: actor.id,
      workspaceId: null,
      requestId,
      idempotencyKey,
      resourceType: 'class',
      resourceId: classId,
      scopeSnapshot: { organizationId: actor.organizationId, classId },
      createdAt: now,
    })
    return {
      statusCode: 200,
      payload: {
        data: {
          status: result.state === 'absent' ? 'absent' : result.state,
          workspaceId: result.workspaceId,
          teacherCount: teacherCountForClass(classId),
          noop: result.noop,
        },
      },
    }
  }

  function listTeacherDirectory({ actor, now }) {
    requireTeacherV(actor)
    const items = listOrganizationClasses(database, actor.organizationId)
      .filter((klass) => klass.status === 'active' && classJoinAllowed(klass, now))
      .map((klass) => {
        const dto = classDto(klass, now)
        return {
          id: dto.id,
          name: dto.name,
          stage: dto.stage,
          entryYear: dto.entryYear,
          classNumber: dto.classNumber,
          gradeId: dto.gradeId,
          currentGrade: dto.currentGrade,
          lifecycle: dto.lifecycle,
          status: dto.status,
          version: dto.version,
          teacherCount: teacherCountForClass(klass.id),
        }
      })
    return items
  }

  function listManagedClasses({ actor, workspace, now }) {
    requireAuthorized({
      actor,
      workspace,
      action: 'class.directory.read',
      resourceScope: workspaceResourceScope(actor, workspace),
    })
    const classes = listOrganizationClasses(database, workspace.organizationId).filter((klass) => {
      if (workspace.scopeType === 'grade') {
        return klass.gradeId === workspace.scopeId
      }
      return true
    })
    return classes.map((klass) => ({
      ...classDto(klass, now),
      studentCount: studentCountForClass(klass.id),
      teacherCount: teacherCountForClass(klass.id),
      pendingStudentCount: pendingStudentCountForClass(klass.id),
    }))
  }

  function getClassDetail({ actor, workspace, classId, now }) {
    const klass = knownClass(classId, workspace.organizationId)
    requireAuthorized({
      actor,
      workspace,
      action: 'class.read',
      resourceScope: classResourceScope(klass),
    })
    return classDto(klass, now)
  }

  function createClass({ name, stage, entryYear, classNumber, actor, workspace, requestId, idempotencyKey, now }) {
    const normalizedName = parseClassName(name)
    const normalizedStage = parseStage(stage)
    const normalizedEntryYear = parseEntryYear(entryYear)
    const normalizedClassNumber = parseClassNumber(classNumber)
    const gradeId = computeGradeId(normalizedStage, normalizedEntryYear)
    requireAuthorized({
      actor,
      workspace,
      action: 'class.create',
      resourceScope: {
        type: workspace.scopeType === 'grade' ? 'grade' : 'school',
        id: workspace.scopeType === 'grade' ? workspace.scopeId : workspace.organizationId,
        organizationId: workspace.organizationId,
        gradeId,
      },
    })
    const created = createClassWithWorkspace(database, {
      classId: randomUUID(),
      workspaceId: randomUUID(),
      organizationId: workspace.organizationId,
      gradeId,
      name: normalizedName,
      stage: normalizedStage,
      entryYear: normalizedEntryYear,
      classNumber: normalizedClassNumber,
      now,
    })
    ensureGradeWorkspace({ organizationId: workspace.organizationId, gradeId, now })
    appendAuditEvent(database, {
      eventType: 'identity.class.created',
      actorUserId: actor.id,
      workspaceId: workspace.id,
      requestId,
      idempotencyKey,
      resourceType: 'class',
      resourceId: created.id,
      scopeSnapshot: { organizationId: created.organizationId, gradeId, classId: created.id },
      afterVersion: created.version,
      createdAt: now,
    })
    enqueueOutboxEvent(database, {
      topic: 'identity.class.created',
      aggregateType: 'class',
      aggregateId: created.id,
      payload: { classId: created.id, organizationId: created.organizationId, version: created.version },
      dedupeKey: `identity.class.created:${created.id}`,
      createdAt: now,
    })
    return { statusCode: 201, payload: { data: classDto({ ...created, stage: normalizedStage, entryYear: normalizedEntryYear, classNumber: normalizedClassNumber }, now) } }
  }

  function updateClass({ classId, name, stage, entryYear, classNumber, expectedVersion, actor, workspace, requestId, idempotencyKey, now }) {
    const klass = knownClass(classId, workspace.organizationId)
    requireAuthorized({ actor, workspace, action: 'class.update', resourceScope: classResourceScope(klass) })
    const nextName = name === undefined ? klass.name : parseClassName(name)
    const nextStage = stage === undefined ? klass.stage : parseStage(stage)
    const nextEntryYear = entryYear === undefined ? klass.entryYear : parseEntryYear(entryYear)
    const nextClassNumber = classNumber === undefined ? klass.classNumber : parseClassNumber(classNumber)
    const nextGradeId = computeGradeId(nextStage, nextEntryYear)
    if (nextGradeId !== klass.gradeId) {
      requireAuthorized({
        actor,
        workspace,
        action: 'class.update',
        resourceScope: { ...classResourceScope(klass), gradeId: nextGradeId },
      })
    }
    const result = database
      .prepare(`
        UPDATE classes
        SET name = ?, stage = ?, entry_year = ?, class_number = ?, grade_id = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND version = ?
      `)
      .run(nextName, nextStage, nextEntryYear, nextClassNumber, nextGradeId, now, classId, expectedVersion)
    if (result.changes !== 1) {
      throw versionConflict({ expectedVersion, currentVersion: klass.version })
    }
    ensureGradeWorkspace({ organizationId: klass.organizationId, gradeId: nextGradeId, now })
    const after = findClassById(database, classId)
    appendAuditEvent(database, {
      eventType: 'identity.class.updated',
      actorUserId: actor.id,
      workspaceId: workspace.id,
      requestId,
      idempotencyKey,
      resourceType: 'class',
      resourceId: classId,
      scopeSnapshot: { organizationId: klass.organizationId, gradeId: nextGradeId, classId, previousGradeId: klass.gradeId },
      beforeVersion: klass.version,
      afterVersion: after.version,
      createdAt: now,
    })
    return { statusCode: 200, payload: { data: classDto(after, now) } }
  }

  function setClassDisabled({ classId, expectedVersion, actor, workspace, requestId, idempotencyKey, now, restore }) {
    const klass = knownClass(classId, workspace.organizationId)
    requireAuthorized({
      actor,
      workspace,
      action: restore ? 'class.restore' : 'class.disable',
      resourceScope: classResourceScope(klass),
    })
    const nextStatus = restore ? 'active' : 'disabled'
    if (klass.status === nextStatus && klass.version === expectedVersion) {
      const workspaceRow = findClassWorkspace(database, { organizationId: klass.organizationId, classId, anyStatus: true })
      if (workspaceRow && workspaceRow.status === nextStatus) {
        appendAuditEvent(database, {
          eventType: restore ? 'identity.class.restored' : 'identity.class.disabled',
          actorUserId: actor.id,
          workspaceId: workspace.id,
          requestId,
          idempotencyKey,
          resourceType: 'class',
          resourceId: classId,
          scopeSnapshot: { organizationId: klass.organizationId, classId, gradeId: klass.gradeId },
          beforeVersion: klass.version,
          afterVersion: klass.version,
          createdAt: now,
        })
        return { statusCode: 200, payload: { data: classDto(klass, now) } }
      }
    }
    const result = database
      .prepare('UPDATE classes SET status = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?')
      .run(nextStatus, now, classId, expectedVersion)
    if (result.changes !== 1) {
      throw versionConflict({ expectedVersion, currentVersion: klass.version })
    }
    const classWorkspace = findClassWorkspace(database, { organizationId: klass.organizationId, classId, anyStatus: true })
    if (classWorkspace) {
      database
        .prepare('UPDATE workspaces SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(nextStatus, now, classWorkspace.id)
    }
    const after = findClassById(database, classId)
    appendAuditEvent(database, {
      eventType: restore ? 'identity.class.restored' : 'identity.class.disabled',
      actorUserId: actor.id,
      workspaceId: workspace.id,
      requestId,
      idempotencyKey,
      resourceType: 'class',
      resourceId: classId,
      scopeSnapshot: { organizationId: klass.organizationId, classId, gradeId: klass.gradeId },
      beforeVersion: klass.version,
      afterVersion: after.version,
      createdAt: now,
    })
    return { statusCode: 200, payload: { data: classDto(after, now) } }
  }

  function forceTeacherAffiliation({ actor, workspace, classId, userId, assign, requestId, idempotencyKey, now }) {
    const klass = knownClass(classId, workspace.organizationId)
    requireAuthorized({
      actor,
      workspace,
      action: assign ? 'teacher.affiliation.force_assign' : 'teacher.affiliation.force_remove',
      resourceScope: classResourceScope(klass),
    })
    const target = findUserById(database, userId)
    if (!target || target.organizationId !== workspace.organizationId) {
      throw opaqueAccountNotFound()
    }
    if (assign) {
      if (target.status !== 'active' || !isVerifiedTeacher(target)) {
        throw resourceConflict('目标必须是同校已验证教师')
      }
      if (!classJoinAllowed(klass, now)) {
        throw resourceConflict('班级当前不可加入')
      }
    }
    const result = writeTeacherTriple({
      userId: target.id,
      organizationId: workspace.organizationId,
      classId,
      now,
      status: assign ? 'active' : 'disabled',
    })
    appendAuditEvent(database, {
      eventType: assign ? 'identity.teacher.force_assigned' : 'identity.teacher.force_removed',
      actorUserId: actor.id,
      workspaceId: workspace.id,
      requestId,
      idempotencyKey,
      resourceType: 'class',
      resourceId: classId,
      scopeSnapshot: { organizationId: workspace.organizationId, classId, targetUserId: target.id },
      createdAt: now,
    })
    return {
      statusCode: 200,
      payload: { data: { status: result.state, workspaceId: result.workspaceId, teacherCount: teacherCountForClass(classId) } },
    }
  }

  function allowedClassesForCredential(credential, now) {
    return listOrganizationClasses(database, credential.organizationId).filter((klass) => {
      if (klass.status !== 'active' || !classJoinAllowed(klass, now)) return false
      if (credential.scopeType === 'grade') return klass.gradeId === credential.scopeId
      return true
    })
  }

  function publicRegistrationState(credential, now) {
    if (
      !credential ||
      credential.revokedAt ||
      credential.expiresAt <= now ||
      (credential.maxUses !== null && credential.successfulUseCount >= credential.maxUses)
    ) {
      return null
    }
    return credential
  }

  function inspectRegistrationToken(token, now) {
    const credential = findRegistrationByHash(database, sha256Hex(token))
    const live = publicRegistrationState(credential, now)
    if (!live) {
      throw notFound(REGISTRATION_NOT_FOUND_MESSAGE)
    }
    const organization = findOrganizationById(database, live.organizationId)
    return {
      expectedRole: live.expectedRole,
      expiresAt: live.expiresAt,
      schoolName: organization?.name ?? null,
      classes: allowedClassesForCredential(live, now).map((klass) => ({
        id: klass.id,
        name: klass.name,
        stage: klass.stage,
        entryYear: klass.entryYear,
        classNumber: klass.classNumber,
        gradeId: klass.gradeId,
      })),
    }
  }

  function allocateUserIdentity(organizationId) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const userId = randomUUID()
      const accountCode = accountCodeFromUserId(userId)
      if (!accountCodeExists(database, organizationId, accountCode)) {
        return { userId, accountCode }
      }
    }
    throw new HttpError(500, 'ACCOUNT_CODE_ALLOCATION_FAILED', '账号短编号分配失败')
  }

  function consumeRegistration({ token, body, requestId, idempotencyKey, now }) {
    rejectInjectedIdentityFields(body)
    const credential = publicRegistrationState(findRegistrationByHash(database, sha256Hex(token)), now)
    if (!credential) {
      throw notFound(REGISTRATION_NOT_FOUND_MESSAGE)
    }
    const loginName = parseLoginName(body?.loginName)
    const displayName = parseDisplayName(body?.displayName)
    if (!isPasswordInputAllowed(body?.password)) {
      throw validationFailed(`password 必须为 1 到 ${MAX_PASSWORD_LENGTH} 个字符`, { field: 'password' })
    }
    if (findLoginName(database, loginName)) {
      throw resourceConflict('校内登录名已存在', {
        suggestions: loginNameSuggestions(loginName, listLoginNamesInOrganization(database, credential.organizationId)),
      })
    }
    let selectedClassIds = []
    if (credential.expectedRole === 'student') {
      const classId = trimString(body?.classId)
      if (!classId) {
        throw validationFailed('学生注册必须选择班级', { field: 'classId' })
      }
      const allowed = allowedClassesForCredential(credential, now)
      if (!allowed.some((klass) => klass.id === classId)) {
        throw resourceConflict('所选班级不在凭据允许范围内')
      }
      selectedClassIds = [classId]
    } else if (Array.isArray(body?.classIds)) {
      const allowed = new Set(allowedClassesForCredential(credential, now).map((klass) => klass.id))
      selectedClassIds = body.classIds.map((value) => trimString(value)).filter(Boolean)
      if (selectedClassIds.some((classId) => !allowed.has(classId))) {
        throw resourceConflict('所选班级不在凭据允许范围内')
      }
    }

    const claimed = database
      .prepare(`
        UPDATE registration_credentials
        SET successful_use_count = successful_use_count + 1, updated_at = ?, version = version + 1
        WHERE id = ?
          AND revoked_at IS NULL
          AND expires_at > ?
          AND (max_uses IS NULL OR successful_use_count < max_uses)
      `)
      .run(now, credential.id, now)
    if (claimed.changes !== 1) {
      throw notFound(REGISTRATION_NOT_FOUND_MESSAGE)
    }

    const { userId, accountCode } = allocateUserIdentity(credential.organizationId)
    database
      .prepare(`
        INSERT INTO users (
          id, organization_id, username, display_name, status, created_at, updated_at, version, login_name, account_code
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, 1, ?, ?)
      `)
      .run(userId, credential.organizationId, userId, displayName, now, now, loginName, accountCode)
    database
      .prepare(`
        INSERT INTO credentials (id, user_id, password_hash, created_at, updated_at, version)
        VALUES (?, ?, ?, ?, ?, 1)
      `)
      .run(randomUUID(), userId, hashPassword(body.password), now, now)
    database
      .prepare(`
        INSERT INTO registration_credential_uses (
          id, credential_id, organization_id, expected_role, created_user_id, request_id, used_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(randomUUID(), credential.id, credential.organizationId, credential.expectedRole, userId, requestId, now)

    if (credential.expectedRole === 'student') {
      database
        .prepare(`
          INSERT INTO student_enrollment_requests (
            id, organization_id, student_user_id, class_id, status, requested_at,
            created_at, updated_at, version
          ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, 1)
        `)
        .run(randomUUID(), credential.organizationId, userId, selectedClassIds[0], now, now, now)
    } else {
      for (const classId of selectedClassIds) {
        writeTeacherTriple({
          userId,
          organizationId: credential.organizationId,
          classId,
          now,
          status: 'active',
        })
      }
    }

    const user = findUserById(database, userId)
    appendAuditEvent(database, {
      eventType: 'identity.registration.consumed',
      actorUserId: userId,
      workspaceId: null,
      requestId,
      idempotencyKey,
      resourceType: 'registration_credential',
      resourceId: credential.id,
      scopeSnapshot: { organizationId: credential.organizationId, expectedRole: credential.expectedRole },
      createdAt: now,
    })
    return { statusCode: 201, payload: { data: { user: publicUser(user) } } }
  }

  function issueRegistrationCredential({ actor, workspace, body, requestId, idempotencyKey, now }) {
    if (Object.hasOwn(body ?? {}, 'scopeId')) {
      throw validationFailed('scope 由签发者身份推导，不得在请求体中指定 scopeId', { field: 'scopeId' })
    }
    const expectedRole = parseExpectedRole(body?.expectedRole)
    const organizationIdFromBody = trimString(body?.organizationId)
    if (workspace.scopeType === 'platform') {
      if (!organizationIdFromBody) {
        throw validationFailed('platform 签发必须提供 organizationId', { field: 'organizationId' })
      }
      if (organizationIdFromBody !== workspace.organizationId) {
        throw validationFailed('organizationId 必须与当前 platform workspace 组织一致', { field: 'organizationId' })
      }
    } else if (organizationIdFromBody) {
      throw validationFailed('非 platform 角色不得在请求体中提供 organizationId', { field: 'organizationId' })
    }
    const organizationId = workspace.organizationId
    const expiresAt = parseExpiresAt(body?.expiresAt) ?? addDays(now, expectedRole === 'teacher' ? 7 : 180)
    const maxUses = parseMaxUses(body?.maxUses)
    const resolvedMaxUses = maxUses === undefined ? (expectedRole === 'teacher' ? 1 : null) : maxUses
    let scopeType = 'school'
    let scopeId = organizationId
    if (expectedRole === 'student') {
      requireAuthorized({
        actor,
        workspace,
        action: 'registration.student.issue',
        resourceScope: workspace.scopeType === 'grade' ? workspaceResourceScope(actor, workspace) : schoolResourceScope(organizationId),
      })
      if (workspace.scopeType === 'grade') {
        scopeType = 'grade'
        scopeId = workspace.scopeId
      }
    } else {
      authorizeOrGradeManagerTeacherException({
        actor,
        workspace,
        action: 'registration.teacher.issue',
        resourceScope: schoolResourceScope(organizationId),
      })
    }
    const rawToken = randomBytes(32).toString('base64url')
    const id = randomUUID()
    database
      .prepare(`
        INSERT INTO registration_credentials (
          id, organization_id, secret_hash, expected_role, scope_type, scope_id,
          expires_at, max_uses, successful_use_count, created_by_user_id, created_workspace_id,
          created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1)
      `)
      .run(
        id,
        organizationId,
        sha256Hex(rawToken),
        expectedRole,
        scopeType,
        scopeId,
        expiresAt,
        resolvedMaxUses,
        actor.id,
        workspace.id,
        now,
        now,
      )
    appendAuditEvent(database, {
      eventType: 'identity.registration.issued',
      actorUserId: actor.id,
      workspaceId: workspace.id,
      requestId,
      idempotencyKey,
      resourceType: 'registration_credential',
      resourceId: id,
      scopeSnapshot: { organizationId, expectedRole, scopeType, scopeId },
      createdAt: now,
    })
    return {
      statusCode: 201,
      payload: {
        data: {
          id,
          expectedRole,
          scopeType,
          scopeId,
          expiresAt,
          maxUses: resolvedMaxUses,
          rawToken,
        },
      },
    }
  }

  function revokeRegistrationCredential({ actor, workspace, credentialId, expectedVersion, reason, requestId, idempotencyKey, now }) {
    const credential = findRegistrationById(database, credentialId)
    if (!credential || credential.organizationId !== workspace.organizationId) {
      throw notFound(REGISTRATION_NOT_FOUND_MESSAGE)
    }
    const action = credential.expectedRole === 'teacher' ? 'registration.teacher.revoke' : 'registration.student.revoke'
    const resourceScope =
      credential.scopeType === 'grade'
        ? { type: 'grade', id: credential.scopeId, organizationId: credential.organizationId, gradeId: credential.scopeId }
        : schoolResourceScope(credential.organizationId)
    if (credential.expectedRole === 'teacher') {
      authorizeOrGradeManagerTeacherException({ actor, workspace, action, resourceScope: schoolResourceScope(credential.organizationId) })
    } else {
      requireAuthorized({ actor, workspace, action, resourceScope })
    }
    if (credential.revokedAt) {
      return { statusCode: 200, payload: { data: { id: credential.id, revoked: true, version: credential.version } } }
    }
    const parsedReason = parseReason(reason)
    const result = database
      .prepare(`
        UPDATE registration_credentials
        SET revoked_at = ?, revoked_by = ?, revoked_reason = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND version = ?
      `)
      .run(now, actor.id, parsedReason, now, credential.id, expectedVersion)
    if (result.changes !== 1) {
      throw versionConflict({ expectedVersion, currentVersion: credential.version })
    }
    appendAuditEvent(database, {
      eventType: 'identity.registration.revoked',
      actorUserId: actor.id,
      workspaceId: workspace.id,
      requestId,
      idempotencyKey,
      resourceType: 'registration_credential',
      resourceId: credential.id,
      scopeSnapshot: { organizationId: credential.organizationId, reason: parsedReason },
      beforeVersion: credential.version,
      createdAt: now,
    })
    return { statusCode: 200, payload: { data: { id: credential.id, revoked: true } } }
  }

  function listRegistrationCredentials({ actor, workspace, expectedRole, now }) {
    const role = parseExpectedRole(expectedRole)
    const organizationId = workspace.organizationId
    if (role === 'student') {
      requireAuthorized({
        actor,
        workspace,
        action: 'registration.student.issue',
        resourceScope:
          workspace.scopeType === 'grade' ? workspaceResourceScope(actor, workspace) : schoolResourceScope(organizationId),
      })
    } else {
      authorizeOrGradeManagerTeacherException({
        actor,
        workspace,
        action: 'registration.teacher.issue',
        resourceScope: schoolResourceScope(organizationId),
      })
    }
    const scopeFilter =
      role === 'student' && workspace.scopeType === 'grade'
        ? { scopeType: 'grade', scopeId: workspace.scopeId }
        : {}
    return listRegistrationCredentialMetadata(database, {
      organizationId,
      expectedRole: role,
      ...scopeFilter,
    }).map((row) => ({
      id: row.id,
      expectedRole: row.expectedRole,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      expiresAt: row.expiresAt,
      maxUses: row.maxUses,
      successfulUseCount: row.successfulUseCount,
      status: registrationCredentialStatus(row, now),
      revokedAt: row.revokedAt,
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt,
      version: row.version,
    }))
  }

  function getOnboardingMe(actor) {
    const identity = assertBaseIdentity(actor)
    const role = identity.student ? 'student' : identity.teacher ? 'teacher' : null
    const requests = listPendingEnrollmentRequestsForUser(database, actor.id).map((row) => ({
      id: row.id,
      status: row.status,
      classId: row.class_id,
      requestedAt: row.requested_at,
      version: row.version,
    }))
    return {
      role,
      expectedRole: role,
      registrationRole: role,
      activeWorkspaceId: null,
      enrollmentRequests: requests,
    }
  }

  function createEnrollmentRequest({ actor, classId, requestId, idempotencyKey, now }) {
    const identity = assertBaseIdentity(actor)
    if (!identity.student) {
      throw permissionDenied()
    }
    if (findPendingEnrollmentForUser(database, actor.id)) {
      throw resourceConflict('已有待审入班申请')
    }
    if (findActiveStudentMembership(database, actor.id)) {
      throw resourceConflict('学生已有正式班级')
    }
    const klass = knownClass(classId, actor.organizationId)
    if (!classJoinAllowed(klass, now)) {
      throw resourceConflict('班级当前不可申请')
    }
    const id = randomUUID()
    database
      .prepare(`
        INSERT INTO student_enrollment_requests (
          id, organization_id, student_user_id, class_id, status, requested_at,
          created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, 1)
      `)
      .run(id, actor.organizationId, actor.id, classId, now, now, now)
    appendAuditEvent(database, {
      eventType: 'identity.enrollment.requested',
      actorUserId: actor.id,
      workspaceId: null,
      requestId,
      idempotencyKey,
      resourceType: 'student_enrollment_request',
      resourceId: id,
      scopeSnapshot: { organizationId: actor.organizationId, classId },
      createdAt: now,
    })
    return { statusCode: 201, payload: { data: { id, status: 'pending', version: 1, classId } } }
  }

  function decideEnrollment({ actor, workspace, enrollmentId, decision, expectedVersion, reason, requestId, idempotencyKey, now }) {
    const request = findEnrollmentRequestById(database, enrollmentId)
    if (!request || request.organizationId !== workspace.organizationId) {
      throw notFound(ENROLLMENT_NOT_FOUND_MESSAGE)
    }
    const klass = knownClass(request.classId, workspace.organizationId)
    requireAuthorized({
      actor,
      workspace,
      action: 'student.enrollment.review',
      resourceScope: classResourceScope(klass),
    })
    if (request.status !== 'pending') {
      throw versionConflict({ expectedVersion, currentVersion: request.version, status: request.status })
    }
    const nextStatus = decision === 'approve' ? 'approved' : 'rejected'
    const parsedReason = decision === 'reject' ? parseReason(reason, { optional: true }) : null
    const updated = database
      .prepare(`
        UPDATE student_enrollment_requests
        SET status = ?, decided_at = ?, decided_by = ?, decision_reason = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND version = ? AND status = 'pending'
      `)
      .run(nextStatus, now, actor.id, parsedReason, now, request.id, expectedVersion)
    if (updated.changes !== 1) {
      throw versionConflict({ expectedVersion, currentVersion: request.version })
    }
    if (nextStatus === 'approved') {
      if (findActiveStudentMembership(database, request.studentUserId)) {
        throw resourceConflict('学生已有正式班级')
      }
      writeStudentTriple({
        userId: request.studentUserId,
        organizationId: request.organizationId,
        classId: request.classId,
        now,
        status: 'active',
      })
    }
    appendAuditEvent(database, {
      eventType: decision === 'approve' ? 'identity.enrollment.approved' : 'identity.enrollment.rejected',
      actorUserId: actor.id,
      workspaceId: workspace.id,
      requestId,
      idempotencyKey,
      resourceType: 'student_enrollment_request',
      resourceId: request.id,
      scopeSnapshot: { organizationId: request.organizationId, classId: request.classId, reason: parsedReason },
      beforeVersion: request.version,
      createdAt: now,
    })
    return { statusCode: 200, payload: { data: { id: request.id, status: nextStatus } } }
  }

  function listClassEnrollmentRequests({ actor, workspace, classId, status, now }) {
    const klass = knownClass(classId, workspace.organizationId)
    requireAuthorized({
      actor,
      workspace,
      action: 'student.enrollment.review',
      resourceScope: classResourceScope(klass),
    })
    const filterStatus = trimString(status) || 'pending'
    if (!ENROLLMENT_LIST_STATUSES.has(filterStatus)) {
      throw validationFailed('status 必须是 pending、approved 或 rejected', { field: 'status' })
    }
    return listEnrollmentRequestsForClass(database, { classId: klass.id, status: filterStatus }).map((row) => ({
      id: row.id,
      status: row.status,
      version: row.version,
      requestedAt: row.requestedAt,
      class: classDto(klass, now),
      student: {
        id: row.studentId,
        displayName: row.studentDisplayName,
        accountCodeSuffix: accountCodeSuffix(row.studentAccountCode),
        avatarSeed: row.studentAccountCode,
      },
    }))
  }

  function correctStudentClass({ actor, workspace, userId, targetClassId, expectedVersion, reason, requestId, idempotencyKey, now }) {
    const parsedReason = parseReason(reason)
    const student = findUserById(database, userId)
    if (!student || student.organizationId !== workspace.organizationId) {
      throw opaqueAccountNotFound()
    }
    const source = findActiveStudentMembership(database, userId)
    if (!source) {
      throw opaqueAccountNotFound()
    }
    const sourceClass = knownClass(source.classId, workspace.organizationId)
    const targetClass = knownClass(targetClassId, workspace.organizationId)
    requireAuthorized({ actor, workspace, action: 'student.affiliation.correct', resourceScope: classResourceScope(sourceClass) })
    requireAuthorized({ actor, workspace, action: 'student.affiliation.correct', resourceScope: classResourceScope(targetClass) })
    if (findPendingEnrollmentForUser(database, userId)) {
      throw resourceConflict('学生仍有待审申请，不能纠错')
    }
    const sourceTriple = loadStudentTriple(database, { userId, classId: source.classId })
    if (classifyTriple(sourceTriple) === 'broken') {
      throw invariantViolation('源班学生三元组残缺，已停止')
    }
    if (targetClassId === source.classId) {
      return { statusCode: 200, payload: { data: { classId: source.classId, noop: true } } }
    }
    if (!classJoinAllowed(targetClass, now)) {
      throw resourceConflict('目标班级当前不可转入')
    }
    if (source.version !== expectedVersion) {
      throw versionConflict({ expectedVersion, currentVersion: source.version })
    }
    const targetState = classifyTriple(loadStudentTriple(database, { userId, classId: targetClassId }))
    if (targetState === 'broken') {
      throw invariantViolation('目标班学生三元组残缺，已停止')
    }
    writeStudentTriple({
      userId,
      organizationId: workspace.organizationId,
      classId: source.classId,
      now,
      status: 'disabled',
    })
    writeStudentTriple({
      userId,
      organizationId: workspace.organizationId,
      classId: targetClassId,
      now,
      status: 'active',
    })
    appendAuditEvent(database, {
      eventType: 'identity.student.class_corrected',
      actorUserId: actor.id,
      workspaceId: workspace.id,
      requestId,
      idempotencyKey,
      resourceType: 'user',
      resourceId: userId,
      scopeSnapshot: {
        organizationId: workspace.organizationId,
        sourceClassId: source.classId,
        targetClassId,
        reason: parsedReason,
      },
      createdAt: now,
    })
    return { statusCode: 200, payload: { data: { classId: targetClassId } } }
  }

  function resolveTargetAccountKind(user) {
    const identity = assertBaseIdentity(user)
    if (identity.teacher) return 'teacher'
    if (identity.student) return 'student'
    const roles = database
      .prepare(`SELECT role_code FROM role_assignments WHERE user_id = ? AND status = 'active'`)
      .all(user.id)
      .map((row) => normalizeRoleCode(row.role_code))
    if (roles.includes('school_admin')) return 'school_admin'
    if (roles.includes('grade_manager')) return 'teacher'
    throw opaqueAccountNotFound()
  }

  function issuePasswordReset({ actor, workspace, targetUserId, requestId, idempotencyKey, now }) {
    const target = findUserById(database, targetUserId)
    if (!target || (workspace.scopeType !== 'platform' && target.organizationId !== workspace.organizationId)) {
      throw opaqueAccountNotFound()
    }
    const kind = resolveTargetAccountKind(target)
    const action =
      kind === 'school_admin'
        ? 'password_reset.school_admin.issue'
        : kind === 'teacher'
          ? 'password_reset.teacher.issue'
          : 'password_reset.student.issue'
    if (kind === 'student') {
      const membership = findActiveStudentMembership(database, target.id)
      if (!membership) throw permissionDenied()
      const klass = knownClass(membership.classId, target.organizationId)
      requireAuthorized({ actor, workspace, action, resourceScope: classResourceScope(klass) })
    } else if (kind === 'teacher') {
      authorizeOrGradeManagerTeacherException({
        actor,
        workspace,
        action,
        resourceScope: schoolResourceScope(workspace.organizationId),
      })
    } else {
      requireAuthorized({
        actor,
        workspace,
        action,
        resourceScope: schoolResourceScope(target.organizationId),
      })
    }
    const rawToken = randomBytes(32).toString('base64url')
    const id = randomUUID()
    const expiresAt = addMinutes(now, 30)
    database
      .prepare(`
        INSERT INTO password_reset_credentials (
          id, organization_id, target_user_id, secret_hash, expires_at,
          created_by_user_id, created_workspace_id, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `)
      .run(id, target.organizationId, target.id, sha256Hex(rawToken), expiresAt, actor.id, workspace.id, now, now)
    appendAuditEvent(database, {
      eventType: 'identity.password_reset.issued',
      actorUserId: actor.id,
      workspaceId: workspace.id,
      requestId,
      idempotencyKey,
      resourceType: 'password_reset_credential',
      resourceId: id,
      scopeSnapshot: { organizationId: target.organizationId, targetUserId: target.id, kind },
      createdAt: now,
    })
    return { statusCode: 201, payload: { data: { id, rawToken, expiresAt } } }
  }

  function listPasswordResetCredentials({ actor, workspace, targetUserId, now }) {
    const target = findUserById(database, targetUserId)
    if (!target || (workspace.scopeType !== 'platform' && target.organizationId !== workspace.organizationId)) {
      throw opaqueAccountNotFound()
    }
    const kind = resolveTargetAccountKind(target)
    const action =
      kind === 'school_admin'
        ? 'password_reset.school_admin.issue'
        : kind === 'teacher'
          ? 'password_reset.teacher.issue'
          : 'password_reset.student.issue'
    if (kind === 'student') {
      const membership = findActiveStudentMembership(database, target.id)
      if (!membership) throw permissionDenied()
      const klass = knownClass(membership.classId, target.organizationId)
      requireAuthorized({ actor, workspace, action, resourceScope: classResourceScope(klass) })
    } else if (kind === 'teacher') {
      authorizeOrGradeManagerTeacherException({
        actor,
        workspace,
        action,
        resourceScope: schoolResourceScope(workspace.organizationId),
      })
    } else {
      requireAuthorized({
        actor,
        workspace,
        action,
        resourceScope: schoolResourceScope(target.organizationId),
      })
    }
    return listPasswordResetCredentialMetadata(database, {
      targetUserId: target.id,
      organizationId: target.organizationId,
    }).map((row) => ({
      id: row.id,
      status: passwordResetCredentialStatus(row, now),
      expiresAt: row.expiresAt,
      createdByUserId: row.createdByUserId,
    }))
  }

  function consumePasswordReset({ token, newPassword, requestId, idempotencyKey, now }) {
    if (!isPasswordInputAllowed(newPassword)) {
      throw validationFailed(`newPassword 必须为 1 到 ${MAX_PASSWORD_LENGTH} 个字符`, { field: 'newPassword' })
    }
    const credential = findPasswordResetByHash(database, sha256Hex(token))
    if (!credential || credential.usedAt || credential.revokedAt || credential.expiresAt <= now) {
      throw notFound(PASSWORD_RESET_NOT_FOUND_MESSAGE)
    }
    const claimed = database
      .prepare(`
        UPDATE password_reset_credentials
        SET used_at = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
      `)
      .run(now, now, credential.id, now)
    if (claimed.changes !== 1) {
      throw notFound(PASSWORD_RESET_NOT_FOUND_MESSAGE)
    }
    updatePasswordHash(database, credential.targetUserId, hashPassword(newPassword), now)
    revokeAllSessionsForUser(database, credential.targetUserId, now)
    appendAuditEvent(database, {
      eventType: 'identity.password_reset.consumed',
      actorUserId: credential.targetUserId,
      workspaceId: null,
      requestId,
      idempotencyKey,
      resourceType: 'password_reset_credential',
      resourceId: credential.id,
      scopeSnapshot: { organizationId: credential.organizationId, targetUserId: credential.targetUserId },
      createdAt: now,
    })
    return { statusCode: 200, payload: { data: { reset: true } } }
  }

  function upsertAdminAssignment({ userId, workspaceId, organizationId, roleCode, scopeType, scopeId, now, status }) {
    const existingMembership = database
      .prepare('SELECT id, status FROM workspace_memberships WHERE user_id = ? AND workspace_id = ?')
      .get(userId, workspaceId)
    if (existingMembership) {
      database
        .prepare('UPDATE workspace_memberships SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(status, now, existingMembership.id)
    } else if (status === 'active') {
      database
        .prepare(`
          INSERT INTO workspace_memberships (id, user_id, workspace_id, status, created_at, updated_at, version)
          VALUES (?, ?, ?, 'active', ?, ?, 1)
        `)
        .run(randomUUID(), userId, workspaceId, now, now)
    }
    const existingRole = database
      .prepare(`
        SELECT id, status FROM role_assignments
        WHERE user_id = ? AND workspace_id = ? AND role_code = ? AND scope_type = ? AND scope_id = ?
      `)
      .get(userId, workspaceId, roleCode, scopeType, scopeId)
    if (existingRole) {
      database
        .prepare('UPDATE role_assignments SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(status, now, existingRole.id)
    } else if (status === 'active') {
      database
        .prepare(`
          INSERT INTO role_assignments (
            id, organization_id, user_id, workspace_id, role_code,
            scope_type, scope_id, status, created_at, updated_at, version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 1)
        `)
        .run(randomUUID(), organizationId, userId, workspaceId, roleCode, scopeType, scopeId, now, now)
    }
  }

  function assignSchoolAdmin({ actor, workspace, organizationId, userId, bodyOrganizationId, requestId, idempotencyKey, now, remove }) {
    if (bodyOrganizationId && bodyOrganizationId !== organizationId) {
      throw validationFailed('body.organizationId 必须与路径 organizationId 一致', { field: 'organizationId' })
    }
    const organization = findOrganizationById(database, organizationId)
    if (!organization || workspace.organizationId !== organizationId) {
      throw opaqueAccountNotFound()
    }
    requireAuthorized({
      actor,
      workspace,
      action: remove ? 'school_admin.assignment.remove' : 'school_admin.assignment.assign',
      resourceScope: { type: 'platform', id: organizationId, organizationId },
    })
    const target = findUserById(database, userId)
    if (!target || target.organizationId !== organizationId || target.status !== 'active' || !isVerifiedTeacher(target)) {
      throw opaqueAccountNotFound()
    }
    const schoolWorkspace = findSchoolWorkspace(database, { organizationId })
    if (!schoolWorkspace) {
      throw invariantViolation('目标组织缺少 school workspace')
    }
    upsertAdminAssignment({
      userId,
      workspaceId: schoolWorkspace.id,
      organizationId,
      roleCode: 'school_admin',
      scopeType: 'school',
      scopeId: organizationId,
      now,
      status: remove ? 'disabled' : 'active',
    })
    appendAuditEvent(database, {
      eventType: remove ? 'identity.school_admin.removed' : 'identity.school_admin.assigned',
      actorUserId: actor.id,
      workspaceId: workspace.id,
      requestId,
      idempotencyKey,
      resourceType: 'user',
      resourceId: userId,
      scopeSnapshot: { organizationId },
      createdAt: now,
    })
    return { statusCode: 200, payload: { data: { organizationId, userId, role: 'school_admin' } } }
  }

  function assignGradeManager({ actor, workspace, gradeId, userId, requestId, idempotencyKey, now, remove }) {
    requireAuthorized({
      actor,
      workspace,
      action: remove ? 'grade_manager.assignment.remove' : 'grade_manager.assignment.assign',
      resourceScope: schoolResourceScope(workspace.organizationId, gradeId),
    })
    const target = findUserById(database, userId)
    if (!target || target.organizationId !== workspace.organizationId || target.status !== 'active' || !isVerifiedTeacher(target)) {
      throw opaqueAccountNotFound()
    }
    const gradeWorkspace = ensureGradeWorkspace({ organizationId: workspace.organizationId, gradeId, now })
    upsertAdminAssignment({
      userId,
      workspaceId: gradeWorkspace.id,
      organizationId: workspace.organizationId,
      roleCode: 'grade_manager',
      scopeType: 'grade',
      scopeId: gradeId,
      now,
      status: remove ? 'disabled' : 'active',
    })
    appendAuditEvent(database, {
      eventType: remove ? 'identity.grade_manager.removed' : 'identity.grade_manager.assigned',
      actorUserId: actor.id,
      workspaceId: workspace.id,
      requestId,
      idempotencyKey,
      resourceType: 'user',
      resourceId: userId,
      scopeSnapshot: { organizationId: workspace.organizationId, gradeId },
      createdAt: now,
    })
    return { statusCode: 200, payload: { data: { gradeId, userId, role: 'grade_manager' } } }
  }

  function updateUser({ userId, displayName, expectedVersion, actor, workspace, requestId, idempotencyKey, now }) {
    if (typeof displayName !== 'string' || displayName.trim().length === 0 || displayName.trim().length > 100) {
      throw new HttpError(400, 'VALIDATION_FAILED', 'displayName 必须为 1 到 100 个字符')
    }
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new HttpError(400, 'VALIDATION_FAILED', 'version 必须为正整数')
    }

    const before = findUserById(database, userId)
    if (!before) {
      throw opaqueAccountNotFound()
    }
    if (workspace.scopeType !== 'platform' && before.organizationId !== workspace.organizationId) {
      throw opaqueAccountNotFound()
    }
    const after = updateUserDisplayName(database, userId, displayName.trim(), expectedVersion, now)
    if (!after) {
      throw new HttpError(409, 'VERSION_CONFLICT', '账号已被其他请求更新，请刷新后重试', {
        details: { expectedVersion, currentVersion: before.version },
      })
    }

    const scopeSnapshot = {
      type: 'school',
      id: before.organizationId,
      organizationId: before.organizationId,
    }
    appendAuditEvent(database, {
      eventType: 'identity.user.updated',
      actorUserId: actor.id,
      workspaceId: workspace.id,
      requestId,
      idempotencyKey,
      resourceType: 'user',
      resourceId: after.id,
      scopeSnapshot,
      beforeVersion: before.version,
      afterVersion: after.version,
      createdAt: now,
    })
    enqueueOutboxEvent(database, {
      topic: 'identity.user.updated',
      aggregateType: 'user',
      aggregateId: after.id,
      payload: {
        userId: after.id,
        organizationId: after.organizationId,
        version: after.version,
      },
      dedupeKey: `identity.user.updated:${after.id}:${after.version}`,
      createdAt: now,
    })

    return {
      statusCode: 200,
      payload: {
        data: publicUser(after),
        meta: { version: after.version },
      },
    }
  }

  function logout({ sessionId, actor, requestId, idempotencyKey, now }) {
    revokeServerSession(database, sessionId, now)
    appendAuditEvent(database, {
      eventType: 'auth.logout',
      actorUserId: actor.id,
      requestId,
      idempotencyKey,
      resourceType: 'session',
      resourceId: sessionId,
      scopeSnapshot: { organizationId: actor.organizationId },
      createdAt: now,
    })
    return {
      statusCode: 200,
      payload: { data: { loggedOut: true } },
    }
  }

  return {
    cookieName,
    sessionTtlMs,
    login,
    inspectSession,
    reissueSession,
    resolveWorkspace,
    recordWorkspaceUse,
    authorize,
    navigationForUser,
    getUserScope,
    getClassScope,
    getUser,
    createClass,
    updateClass,
    setClassDisabled,
    updateUser,
    logout,
    joinTeacherClass,
    leaveTeacherClass,
    listTeacherDirectory,
    listManagedClasses,
    getClassDetail,
    forceTeacherAffiliation,
    inspectRegistrationToken,
    consumeRegistration,
    issueRegistrationCredential,
    revokeRegistrationCredential,
    listRegistrationCredentials,
    getOnboardingMe,
    createEnrollmentRequest,
    decideEnrollment,
    listClassEnrollmentRequests,
    correctStudentClass,
    issuePasswordReset,
    listPasswordResetCredentials,
    consumePasswordReset,
    assignSchoolAdmin,
    assignGradeManager,
    computeClassLifecycle,
    listWorkspaces: (userId) => listWorkspacesForUser(database, userId),
    importSeed: (seed) => importIdentitySeed(database, seed),
    health: () => readCoreHealth(database),
  }
}