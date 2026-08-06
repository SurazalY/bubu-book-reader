import { randomUUID } from 'node:crypto'

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

import {
  createClassWithWorkspace,
  createStudentAccount,
  findActiveClassScope,
  findActiveClassWorkspace,
  findCredentialByUsername,
  findUserById,
  findUserByUsername,
  findUserScope,
  findWorkspaceForUser,
  listActiveRoleAssignments,
  listWorkspacesForUser,
  updateUserDisplayName,
} from './repository.js'
import { createPermissionEvaluator } from './permissions.js'

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
        message: '用户名或密码错误',
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

function workspaceResourceScope(actor, workspace) {
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

export function createIdentityService(options) {
  const database = options.database
  const sessionSecret = options.sessionSecret
  assertSessionSecret(sessionSecret)
  const sessionTtlMs = validateSessionTtlMs(options.sessionTtlMs)
  const cookieName = options.cookieName ?? 'readmate_session'
  const evaluatePermission = createPermissionEvaluator(options.permissionPolicy)

  function login({ username, password, requestId, idempotencyKey, now }) {
    if (!isPasswordInputAllowed(password)) {
      throw new HttpError(400, 'VALIDATION_FAILED', `password 必须为 1 到 ${MAX_PASSWORD_LENGTH} 个字符`)
    }
    const credential = findCredentialByUsername(database, username)
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
          activeWorkspaceId: navigation.defaultWorkspaceId ?? workspaces[0]?.id ?? null,
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
    return {
      defaultPath: defaultEntry?.path ?? null,
      defaultWorkspaceId: defaultEntry?.workspaceId ?? null,
      entries,
    }
  }

  function getUserScope(userId) {
    const scope = findUserScope(database, userId)
    if (!scope) {
      throw new HttpError(404, 'RESOURCE_NOT_FOUND', '账号不存在')
    }
    return scope
  }

  function getUser(userId) {
    const user = findUserById(database, userId)
    if (!user) {
      throw new HttpError(404, 'RESOURCE_NOT_FOUND', '账号不存在')
    }
    return publicUser(user)
  }

  function getClassScope(classId) {
    const scope = findActiveClassScope(database, classId)
    if (!scope) {
      throw new HttpError(404, 'RESOURCE_NOT_FOUND', '班级不存在')
    }
    return scope
  }

  function createClass({ name, gradeId, actor, workspace, requestId, idempotencyKey, now }) {
    const normalizedName = typeof name === 'string' ? name.trim() : ''
    const normalizedGradeId = typeof gradeId === 'string' && gradeId.trim() ? gradeId.trim() : null
    if (!normalizedName || normalizedName.length > 100) {
      throw new HttpError(400, 'VALIDATION_FAILED', 'name 必须为 1 到 100 个字符')
    }
    if (normalizedGradeId?.length > 100) {
      throw new HttpError(400, 'VALIDATION_FAILED', 'gradeId 不能超过 100 个字符')
    }

    const created = createClassWithWorkspace(database, {
      classId: randomUUID(),
      workspaceId: randomUUID(),
      organizationId: workspace.organizationId,
      gradeId: normalizedGradeId,
      name: normalizedName,
      now,
    })
    const scopeSnapshot = {
      type: 'class',
      id: created.id,
      classId: created.id,
      gradeId: created.gradeId,
      organizationId: created.organizationId,
    }
    appendAuditEvent(database, {
      eventType: 'identity.class.created',
      actorUserId: actor.id,
      workspaceId: workspace.id,
      requestId,
      idempotencyKey,
      resourceType: 'class',
      resourceId: created.id,
      scopeSnapshot,
      afterVersion: created.version,
      createdAt: now,
    })
    enqueueOutboxEvent(database, {
      topic: 'identity.class.created',
      aggregateType: 'class',
      aggregateId: created.id,
      payload: {
        classId: created.id,
        organizationId: created.organizationId,
        workspaceId: created.workspaceId,
        version: created.version,
      },
      dedupeKey: `identity.class.created:${created.id}`,
      createdAt: now,
    })
    return { statusCode: 201, payload: { data: created } }
  }

  function createStudent({ classId, username, displayName, password, actor, workspace, requestId, idempotencyKey, now }) {
    const classScope = getClassScope(classId)
    if (classScope.organizationId !== workspace.organizationId) {
      throw new HttpError(404, 'RESOURCE_NOT_FOUND', '班级不存在')
    }
    const normalizedUsername = typeof username === 'string' ? username.trim() : ''
    const normalizedDisplayName = typeof displayName === 'string' ? displayName.trim() : ''
    if (!normalizedUsername || normalizedUsername.length > 100) {
      throw new HttpError(400, 'VALIDATION_FAILED', 'username 必须为 1 到 100 个字符')
    }
    if (!normalizedDisplayName || normalizedDisplayName.length > 100) {
      throw new HttpError(400, 'VALIDATION_FAILED', 'displayName 必须为 1 到 100 个字符')
    }
    if (!isPasswordInputAllowed(password)) {
      throw new HttpError(400, 'VALIDATION_FAILED', `password 必须为 1 到 ${MAX_PASSWORD_LENGTH} 个字符`)
    }
    if (findUserByUsername(database, normalizedUsername)) {
      throw new HttpError(409, 'RESOURCE_CONFLICT', '用户名已存在')
    }
    const classWorkspace = findActiveClassWorkspace(database, classScope.id, classScope.organizationId)
    if (!classWorkspace) {
      throw new HttpError(409, 'RESOURCE_CONFLICT', '班级缺少有效工作空间，无法创建学生账号')
    }

    const createdUser = createStudentAccount(database, {
      userId: randomUUID(),
      credentialId: randomUUID(),
      classMembershipId: randomUUID(),
      workspaceMembershipId: randomUUID(),
      roleAssignmentId: randomUUID(),
      organizationId: classScope.organizationId,
      classId: classScope.id,
      workspaceId: classWorkspace.id,
      username: normalizedUsername,
      displayName: normalizedDisplayName,
      passwordHash: hashPassword(password),
      now,
    })
    const scopeSnapshot = {
      type: 'class',
      id: classScope.id,
      classId: classScope.id,
      gradeId: classScope.gradeId,
      organizationId: classScope.organizationId,
    }
    appendAuditEvent(database, {
      eventType: 'identity.student.created',
      actorUserId: actor.id,
      workspaceId: workspace.id,
      requestId,
      idempotencyKey,
      resourceType: 'user',
      resourceId: createdUser.id,
      scopeSnapshot,
      afterVersion: createdUser.version,
      createdAt: now,
    })
    enqueueOutboxEvent(database, {
      topic: 'identity.student.created',
      aggregateType: 'user',
      aggregateId: createdUser.id,
      payload: {
        userId: createdUser.id,
        organizationId: createdUser.organizationId,
        classId: classScope.id,
        workspaceId: classWorkspace.id,
        version: createdUser.version,
      },
      dedupeKey: `identity.student.created:${createdUser.id}`,
      createdAt: now,
    })
    return {
      statusCode: 201,
      payload: {
        data: {
          user: publicUser(createdUser),
          classId: classScope.id,
          workspaceId: classWorkspace.id,
        },
      },
    }
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
      throw new HttpError(404, 'RESOURCE_NOT_FOUND', '账号不存在')
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
    createStudent,
    updateUser,
    logout,
    listWorkspaces: (userId) => listWorkspacesForUser(database, userId),
    importSeed: (seed) => importIdentitySeed(database, seed),
    health: () => readCoreHealth(database),
  }
}
