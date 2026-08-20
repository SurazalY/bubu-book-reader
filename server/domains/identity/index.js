import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import express from 'express'

import { MAX_PASSWORD_LENGTH } from '../../auth/password.js'
import { assertSessionSecret, validateSessionTtlMs } from '../../auth/session.js'
import { openSqliteDatabase } from '../../db/database.js'
import { HttpError, isHttpError } from '../../db/errors.js'
import { runMigrations } from '../../db/migrate.js'
import { createRuntimeKeyedRequestHash, executeIdempotent } from '../../db/reliability.js'
import { sendData, sendFailure } from '../../middleware/http.js'
import {
  createRequestContextMiddleware,
  createRequirePermissionMiddleware,
  createRequireSessionMiddleware,
  createRequireWorkspaceMiddleware,
  parseCookies,
} from '../../middleware/request-context.js'

import { computeClassLifecycle, computeGradeId } from './lifecycle.js'
import { createIdentityService, workspaceResourceScope } from './service.js'
import { RESOURCE_NOT_FOUND_MESSAGE, notFound, rejectUnknownLoginFields } from './validation.js'

export { computeClassLifecycle, computeGradeId } from './lifecycle.js'

const moduleDirectory = dirname(fileURLToPath(import.meta.url))

export function defaultMigrationDirectory() {
  return resolve(moduleDirectory, '../../db/migrations')
}

export function defaultDatabasePath() {
  return resolve(moduleDirectory, '../../data/readmate.sqlite')
}

function closeOwnedDatabase(database) {
  if (database.isOpen) {
    database.close()
  }
}

function route(handler) {
  return (req, res, next) => {
    try {
      const result = handler(req, res, next)
      if (result?.catch) {
        result.catch(next)
      }
    } catch (error) {
      next(error)
    }
  }
}

function idempotencyKey(req) {
  const value = req.get('Idempotency-Key')
  if (!value) {
    throw new HttpError(400, 'VALIDATION_FAILED', '写入请求必须提供 Idempotency-Key', {
      details: { field: 'Idempotency-Key' },
    })
  }
  return value
}

function loginScope(loginName) {
  const fingerprint = createHash('sha256')
    .update(loginName.trim().toLowerCase(), 'utf8')
    .digest('hex')
  return `auth.login:${fingerprint}`
}

function expectedVersion(req) {
  const ifMatch = req.get('If-Match')
  const fromHeader = ifMatch?.replace(/^W\//, '').replace(/^"|"$/g, '')
  const value = fromHeader || req.body?.version
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new HttpError(400, 'VALIDATION_FAILED', '必须在 If-Match 或请求体中提供正整数 version')
  }
  return parsed
}

function sendIdempotentOutcome(res, req, outcome) {
  if (outcome.payload.error) {
    return sendFailure(
      res,
      {
        status: outcome.statusCode,
        ...outcome.payload.error,
      },
      req.requestId,
    )
  }

  return sendData(res, outcome.payload.data, {
    status: outcome.statusCode,
    requestId: req.requestId,
    meta: {
      ...(outcome.payload.meta ?? {}),
      ...(outcome.replayed ? { replayed: true } : {}),
    },
  })
}

function cookieOptions(service, secure) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: service.sessionTtlMs,
  }
}

function clearCookieOptions(secure) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
  }
}

export function createIdentityModule(options = {}) {
  const sessionSecret = options.sessionSecret ?? process.env.SESSION_TOKEN_SECRET
  assertSessionSecret(sessionSecret)
  const sessionTtlMs = validateSessionTtlMs(options.sessionTtlMs)
  const database = openSqliteDatabase(options.databasePath ?? defaultDatabasePath())

  try {
    return createIdentityModuleWithDatabase({ options, sessionSecret, sessionTtlMs, database })
  } catch (error) {
    closeOwnedDatabase(database)
    throw error
  }
}

function createIdentityModuleWithDatabase({ options, sessionSecret, sessionTtlMs, database }) {
  const migrations = runMigrations(database, options.migrationDirectory ?? defaultMigrationDirectory())
  const service = createIdentityService({
    database,
    sessionSecret,
    sessionTtlMs,
    cookieName: options.cookieName,
    permissionPolicy: options.permissionPolicy,
  })
  const secureCookie = options.cookieSecure ?? process.env.NODE_ENV === 'production'
  const router = express.Router()
  const requireSession = createRequireSessionMiddleware(service)
  const requireWorkspace = createRequireWorkspaceMiddleware(service)
  const requireAccountRead = createRequirePermissionMiddleware(
    service,
    'account.read',
    (req) => service.getUserScope(req.params.id, req.workspace),
  )
  const requireAccountManage = createRequirePermissionMiddleware(
    service,
    'account.manage',
    (req) => service.getUserScope(req.params.id, req.workspace),
  )
  const requireClassCreate = createRequirePermissionMiddleware(
    service,
    'class.create',
    (req) => {
      const gradeId = computeGradeId(req.body?.stage, req.body?.entryYear)
      return {
        type: 'grade',
        id: gradeId,
        organizationId: req.workspace.organizationId,
        gradeId,
      }
    },
  )
  const requireClassDirectory = createRequirePermissionMiddleware(
    service,
    'class.directory.read',
    (req) => workspaceResourceScope(req.identitySession.user, req.workspace),
  )
  const requireClassRead = createRequirePermissionMiddleware(
    service,
    'class.read',
    (req) => service.getClassScope(req.params.classId, req.workspace),
  )

  router.use(express.json({ limit: '1mb' }))
  router.use(createRequestContextMiddleware())

  router.get(
    '/health',
    route((req, res) => sendData(res, service.health(), { requestId: req.requestId })),
  )

  router.post(
    '/auth/login',
    route((req, res) => {
      rejectUnknownLoginFields(req.body)
      const loginName = typeof req.body?.loginName === 'string' ? req.body.loginName.trim() : ''
      const password = typeof req.body?.password === 'string' ? req.body.password : ''
      if (!loginName || !password) {
        throw new HttpError(400, 'VALIDATION_FAILED', 'loginName 与 password 均为必填项')
      }
      if (password.length > MAX_PASSWORD_LENGTH) {
        throw new HttpError(400, 'VALIDATION_FAILED', `password 不能超过 ${MAX_PASSWORD_LENGTH} 个字符`)
      }

      const key = idempotencyKey(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: loginScope(loginName),
        request: { loginName },
        requestHash: createRuntimeKeyedRequestHash(sessionSecret, {
          loginName: loginName.toLowerCase(),
          password,
        }),
        operation: ({ createdAt }) =>
          service.login({
            loginName,
            password,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
          }),
      })
      if (outcome.sessionId) {
        const token = service.reissueSession(outcome.sessionId)
        if (!token) {
          throw new HttpError(401, 'AUTH_REQUIRED', '登录会话已失效，请重新登录')
        }
        res.cookie(service.cookieName, token, cookieOptions(service, secureCookie))
      }
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.post(
    '/auth/logout',
    route((req, res) => {
      const key = idempotencyKey(req)
      const token = parseCookies(req.get('Cookie'))[service.cookieName]
      const inspected = service.inspectSession(token)
      if (!inspected.sessionId) {
        throw new HttpError(401, 'AUTH_REQUIRED', '需要有效登录会话')
      }

      const outcome = executeIdempotent(database, {
        key,
        scope: `auth.logout:${inspected.sessionId}`,
        request: { sessionId: inspected.sessionId },
        operation: ({ createdAt }) => {
          if (inspected.state !== 'active') {
            throw new HttpError(401, 'SESSION_EXPIRED', '登录会话已失效，请重新登录')
          }
          return service.logout({
            sessionId: inspected.session.id,
            actor: inspected.session.user,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
          })
        },
      })
      res.clearCookie(service.cookieName, clearCookieOptions(secureCookie))
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.get(
    '/session',
    requireSession,
    route((req, res) => {
      const workspaces = service.listWorkspaces(req.identitySession.user.id)
      const navigation = service.navigationForUser(req.identitySession.user, workspaces)
      return sendData(
        res,
        {
          user: req.identitySession.user,
          workspaces,
          activeWorkspaceId: navigation.defaultWorkspaceId ?? null,
          navigation,
        },
        { requestId: req.requestId },
      )
    }),
  )

  router.post(
    '/me/password',
    requireSession,
    route((req, res) => {
      const key = idempotencyKey(req)
      const userId = req.identitySession.user.id
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.me.password:${userId}`,
        request: {},
        requestHash: createRuntimeKeyedRequestHash(sessionSecret, {
          userId,
          oldPassword: req.body?.oldPassword,
          newPassword: req.body?.newPassword,
        }),
        operation: ({ createdAt }) =>
          service.changeOwnPassword({
            actor: req.identitySession.user,
            sessionId: req.identitySession.id,
            oldPassword: req.body?.oldPassword,
            newPassword: req.body?.newPassword,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.patch(
    '/me/profile',
    requireSession,
    route((req, res) => {
      const key = idempotencyKey(req)
      const userId = req.identitySession.user.id
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.me.profile:${userId}`,
        request: { displayName: req.body?.displayName },
        operation: ({ createdAt }) =>
          service.updateOwnProfile({
            actor: req.identitySession.user,
            displayName: req.body?.displayName,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.get(
    '/workspaces',
    requireSession,
    route((req, res) =>
      sendData(res, service.listWorkspaces(req.identitySession.user.id), { requestId: req.requestId }),
    ),
  )

  router.get(
    '/onboarding/me',
    requireSession,
    route((req, res) => sendData(res, service.getOnboardingMe(req.identitySession.user), { requestId: req.requestId })),
  )

  router.post(
    '/onboarding/enrollment-requests',
    requireSession,
    route((req, res) => {
      const key = idempotencyKey(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.enrollment.request:${req.identitySession.user.id}`,
        request: { classId: req.body?.classId },
        operation: ({ createdAt }) =>
          service.createEnrollmentRequest({
            actor: req.identitySession.user,
            classId: req.body?.classId,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.get(
    '/teacher/class-directory',
    requireSession,
    route((req, res) =>
      sendData(
        res,
        { items: service.listTeacherDirectory({ actor: req.identitySession.user, now: new Date().toISOString() }) },
        { requestId: req.requestId },
      ),
    ),
  )

  router.put(
    '/teacher/classes/:classId',
    requireSession,
    route((req, res) => {
      const key = idempotencyKey(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.teacher.join:${req.identitySession.user.id}:${req.params.classId}`,
        request: { classId: req.params.classId },
        operation: ({ createdAt }) =>
          service.joinTeacherClass({
            actor: req.identitySession.user,
            classId: req.params.classId,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.delete(
    '/teacher/classes/:classId',
    requireSession,
    route((req, res) => {
      const key = idempotencyKey(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.teacher.leave:${req.identitySession.user.id}:${req.params.classId}`,
        request: { classId: req.params.classId },
        operation: ({ createdAt }) =>
          service.leaveTeacherClass({
            actor: req.identitySession.user,
            classId: req.params.classId,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.get(
    '/registration/:token',
    route((req, res) =>
      sendData(res, service.inspectRegistrationToken(req.params.token, new Date().toISOString()), { requestId: req.requestId }),
    ),
  )

  router.post(
    '/registration/:token',
    route((req, res) => {
      const key = idempotencyKey(req)
      const tokenHash = createHash('sha256').update(String(req.params.token), 'utf8').digest('hex')
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.registration.consume:${tokenHash}`,
        request: { loginName: req.body?.loginName, displayName: req.body?.displayName, classId: req.body?.classId },
        requestHash: createRuntimeKeyedRequestHash(sessionSecret, {
          tokenHash,
          loginName: req.body?.loginName,
          displayName: req.body?.displayName,
          classId: req.body?.classId,
          classIds: req.body?.classIds,
          password: req.body?.password,
        }),
        operation: ({ createdAt }) =>
          service.consumeRegistration({
            token: req.params.token,
            body: req.body,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.post(
    '/password-resets/:token/consume',
    route((req, res) => {
      const key = idempotencyKey(req)
      const tokenHash = createHash('sha256').update(String(req.params.token), 'utf8').digest('hex')
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.password_reset.consume:${tokenHash}`,
        request: {},
        requestHash: createRuntimeKeyedRequestHash(sessionSecret, {
          tokenHash,
          newPassword: req.body?.newPassword,
        }),
        operation: ({ createdAt }) =>
          service.consumePasswordReset({
            token: req.params.token,
            newPassword: req.body?.newPassword,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.get(
    '/classes',
    requireSession,
    requireWorkspace,
    requireClassDirectory,
    route((req, res) =>
      sendData(
        res,
        { items: service.listManagedClasses({ actor: req.identitySession.user, workspace: req.workspace, now: new Date().toISOString() }) },
        { requestId: req.requestId },
      ),
    ),
  )

  router.get(
    '/classes/:classId',
    requireSession,
    requireWorkspace,
    requireClassRead,
    route((req, res) =>
      sendData(
        res,
        service.getClassDetail({
          actor: req.identitySession.user,
          workspace: req.workspace,
          classId: req.params.classId,
          now: new Date().toISOString(),
        }),
        { requestId: req.requestId },
      ),
    ),
  )

  router.post(
    '/classes',
    requireSession,
    requireWorkspace,
    requireClassCreate,
    route((req, res) => {
      const key = idempotencyKey(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.class.create:${req.identitySession.user.id}:${req.workspace.id}`,
        request: {
          name: req.body?.name,
          stage: req.body?.stage,
          entryYear: req.body?.entryYear,
          classNumber: req.body?.classNumber,
        },
        operation: ({ createdAt }) =>
          service.createClass({
            name: req.body?.name,
            stage: req.body?.stage,
            entryYear: req.body?.entryYear,
            classNumber: req.body?.classNumber,
            actor: req.identitySession.user,
            workspace: req.workspace,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.patch(
    '/classes/:classId',
    requireSession,
    requireWorkspace,
    route((req, res) => {
      const key = idempotencyKey(req)
      const version = expectedVersion(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.class.update:${req.identitySession.user.id}:${req.workspace.id}:${req.params.classId}`,
        request: {
          name: req.body?.name,
          stage: req.body?.stage,
          entryYear: req.body?.entryYear,
          classNumber: req.body?.classNumber,
          version,
        },
        operation: ({ createdAt }) =>
          service.updateClass({
            classId: req.params.classId,
            name: req.body?.name,
            stage: req.body?.stage,
            entryYear: req.body?.entryYear,
            classNumber: req.body?.classNumber,
            expectedVersion: version,
            actor: req.identitySession.user,
            workspace: req.workspace,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.delete(
    '/classes/:classId',
    requireSession,
    requireWorkspace,
    route((req, res) => {
      const key = idempotencyKey(req)
      const version = expectedVersion(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.class.disable:${req.identitySession.user.id}:${req.params.classId}`,
        request: { version },
        operation: ({ createdAt }) =>
          service.setClassDisabled({
            classId: req.params.classId,
            expectedVersion: version,
            actor: req.identitySession.user,
            workspace: req.workspace,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
            restore: false,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.post(
    '/classes/:classId/restore',
    requireSession,
    requireWorkspace,
    route((req, res) => {
      const key = idempotencyKey(req)
      const version = expectedVersion(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.class.restore:${req.identitySession.user.id}:${req.params.classId}`,
        request: { version },
        operation: ({ createdAt }) =>
          service.setClassDisabled({
            classId: req.params.classId,
            expectedVersion: version,
            actor: req.identitySession.user,
            workspace: req.workspace,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
            restore: true,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.put(
    '/classes/:classId/teachers/:userId',
    requireSession,
    requireWorkspace,
    route((req, res) => {
      const key = idempotencyKey(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.teacher.force_assign:${req.identitySession.user.id}:${req.params.classId}:${req.params.userId}`,
        request: { classId: req.params.classId, userId: req.params.userId },
        operation: ({ createdAt }) =>
          service.forceTeacherAffiliation({
            actor: req.identitySession.user,
            workspace: req.workspace,
            classId: req.params.classId,
            userId: req.params.userId,
            assign: true,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.delete(
    '/classes/:classId/teachers/:userId',
    requireSession,
    requireWorkspace,
    route((req, res) => {
      const key = idempotencyKey(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.teacher.force_remove:${req.identitySession.user.id}:${req.params.classId}:${req.params.userId}`,
        request: { classId: req.params.classId, userId: req.params.userId },
        operation: ({ createdAt }) =>
          service.forceTeacherAffiliation({
            actor: req.identitySession.user,
            workspace: req.workspace,
            classId: req.params.classId,
            userId: req.params.userId,
            assign: false,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.get(
    '/classes/:classId/enrollment-requests',
    requireSession,
    requireWorkspace,
    route((req, res) =>
      sendData(
        res,
        {
          items: service.listClassEnrollmentRequests({
            actor: req.identitySession.user,
            workspace: req.workspace,
            classId: req.params.classId,
            status: req.query.status,
            now: new Date().toISOString(),
          }),
        },
        { requestId: req.requestId },
      ),
    ),
  )

  router.post(
    '/enrollment-requests/:id/approve',
    requireSession,
    requireWorkspace,
    route((req, res) => {
      const key = idempotencyKey(req)
      const version = expectedVersion(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.enrollment.approve:${req.params.id}`,
        request: { version },
        operation: ({ createdAt }) =>
          service.decideEnrollment({
            actor: req.identitySession.user,
            workspace: req.workspace,
            enrollmentId: req.params.id,
            decision: 'approve',
            expectedVersion: version,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.post(
    '/enrollment-requests/:id/reject',
    requireSession,
    requireWorkspace,
    route((req, res) => {
      const key = idempotencyKey(req)
      const version = expectedVersion(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.enrollment.reject:${req.params.id}`,
        request: { version, reason: req.body?.reason },
        operation: ({ createdAt }) =>
          service.decideEnrollment({
            actor: req.identitySession.user,
            workspace: req.workspace,
            requestId: req.requestId,
            enrollmentId: req.params.id,
            decision: 'reject',
            expectedVersion: version,
            reason: req.body?.reason,
            idempotencyKey: key,
            now: createdAt,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.patch(
    '/students/:userId/class',
    requireSession,
    requireWorkspace,
    route((req, res) => {
      const key = idempotencyKey(req)
      const version = expectedVersion(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.student.correct:${req.identitySession.user.id}:${req.params.userId}`,
        request: { targetClassId: req.body?.targetClassId, version, reason: req.body?.reason },
        operation: ({ createdAt }) =>
          service.correctStudentClass({
            actor: req.identitySession.user,
            workspace: req.workspace,
            userId: req.params.userId,
            targetClassId: req.body?.targetClassId,
            expectedVersion: version,
            reason: req.body?.reason,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.get(
    '/registration-credentials',
    requireSession,
    requireWorkspace,
    route((req, res) =>
      sendData(
        res,
        {
          items: service.listRegistrationCredentials({
            actor: req.identitySession.user,
            workspace: req.workspace,
            expectedRole: req.query.expectedRole,
            now: new Date().toISOString(),
          }),
        },
        { requestId: req.requestId },
      ),
    ),
  )

  router.post(
    '/registration-credentials',
    requireSession,
    requireWorkspace,
    route((req, res) => {
      const key = idempotencyKey(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.registration.issue:${req.identitySession.user.id}:${req.workspace.id}`,
        request: {
          expectedRole: req.body?.expectedRole,
          expiresAt: req.body?.expiresAt,
          maxUses: req.body?.maxUses,
        },
        operation: ({ createdAt }) =>
          service.issueRegistrationCredential({
            actor: req.identitySession.user,
            workspace: req.workspace,
            body: req.body,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.post(
    '/registration-credentials/:id/revoke',
    requireSession,
    requireWorkspace,
    route((req, res) => {
      const key = idempotencyKey(req)
      const version = expectedVersion(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.registration.revoke:${req.params.id}`,
        request: { version, reason: req.body?.reason },
        operation: ({ createdAt }) =>
          service.revokeRegistrationCredential({
            actor: req.identitySession.user,
            workspace: req.workspace,
            credentialId: req.params.id,
            expectedVersion: version,
            reason: req.body?.reason,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.get(
    '/users/:userId/password-reset-credentials',
    requireSession,
    requireWorkspace,
    route((req, res) =>
      sendData(
        res,
        {
          items: service.listPasswordResetCredentials({
            actor: req.identitySession.user,
            workspace: req.workspace,
            targetUserId: req.params.userId,
            now: new Date().toISOString(),
          }),
        },
        { requestId: req.requestId },
      ),
    ),
  )

  router.post(
    '/users/:userId/password-reset-credentials',
    requireSession,
    requireWorkspace,
    route((req, res) => {
      const key = idempotencyKey(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.password_reset.issue:${req.identitySession.user.id}:${req.params.userId}`,
        request: { targetUserId: req.params.userId },
        operation: ({ createdAt }) =>
          service.issuePasswordReset({
            actor: req.identitySession.user,
            workspace: req.workspace,
            targetUserId: req.params.userId,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.get(
    '/users/:userId/temp-password',
    requireSession,
    requireWorkspace,
    route((req, res) =>
      sendData(
        res,
        service.getIssuedTempPassword({
          actor: req.identitySession.user,
          workspace: req.workspace,
          targetUserId: req.params.userId,
        }),
        { requestId: req.requestId },
      ),
    ),
  )

  router.post(
    '/users/:userId/password-reset',
    requireSession,
    requireWorkspace,
    route((req, res) => {
      const key = idempotencyKey(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.temp_password.issue:${req.identitySession.user.id}:${req.params.userId}`,
        request: { targetUserId: req.params.userId },
        operation: ({ createdAt }) =>
          service.issueVisibleTempPassword({
            actor: req.identitySession.user,
            workspace: req.workspace,
            targetUserId: req.params.userId,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.put(
    '/organizations/:organizationId/school-admins/:userId',
    requireSession,
    requireWorkspace,
    route((req, res) => {
      const key = idempotencyKey(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.school_admin.assign:${req.params.organizationId}:${req.params.userId}`,
        request: { organizationId: req.params.organizationId, userId: req.params.userId },
        operation: ({ createdAt }) =>
          service.assignSchoolAdmin({
            actor: req.identitySession.user,
            workspace: req.workspace,
            organizationId: req.params.organizationId,
            userId: req.params.userId,
            bodyOrganizationId: req.body?.organizationId,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
            remove: false,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.delete(
    '/organizations/:organizationId/school-admins/:userId',
    requireSession,
    requireWorkspace,
    route((req, res) => {
      const key = idempotencyKey(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.school_admin.remove:${req.params.organizationId}:${req.params.userId}`,
        request: { organizationId: req.params.organizationId, userId: req.params.userId },
        operation: ({ createdAt }) =>
          service.assignSchoolAdmin({
            actor: req.identitySession.user,
            workspace: req.workspace,
            organizationId: req.params.organizationId,
            userId: req.params.userId,
            bodyOrganizationId: req.body?.organizationId,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
            remove: true,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.put(
    '/grade-cohorts/:gradeId/managers/:userId',
    requireSession,
    requireWorkspace,
    route((req, res) => {
      const key = idempotencyKey(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.grade_manager.assign:${req.params.gradeId}:${req.params.userId}`,
        request: { gradeId: req.params.gradeId, userId: req.params.userId },
        operation: ({ createdAt }) =>
          service.assignGradeManager({
            actor: req.identitySession.user,
            workspace: req.workspace,
            gradeId: req.params.gradeId,
            userId: req.params.userId,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
            remove: false,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.delete(
    '/grade-cohorts/:gradeId/managers/:userId',
    requireSession,
    requireWorkspace,
    route((req, res) => {
      const key = idempotencyKey(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.grade_manager.remove:${req.params.gradeId}:${req.params.userId}`,
        request: { gradeId: req.params.gradeId, userId: req.params.userId },
        operation: ({ createdAt }) =>
          service.assignGradeManager({
            actor: req.identitySession.user,
            workspace: req.workspace,
            gradeId: req.params.gradeId,
            userId: req.params.userId,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
            remove: true,
          }),
      })
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.get(
    '/users/:id',
    requireSession,
    requireWorkspace,
    requireAccountRead,
    route((req, res) => sendData(res, service.getUser(req.params.id, req.workspace), { requestId: req.requestId })),
  )

  router.patch(
    '/users/:id',
    requireSession,
    requireWorkspace,
    requireAccountManage,
    route((req, res) => {
      const key = idempotencyKey(req)
      const version = expectedVersion(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.user.update:${req.identitySession.user.id}:${req.workspace.id}:${req.params.id}`,
        request: {
          displayName: req.body?.displayName,
          version,
        },
        operation: ({ createdAt }) =>
          service.updateUser({
            userId: req.params.id,
            displayName: req.body?.displayName,
            expectedVersion: version,
            actor: req.identitySession.user,
            workspace: req.workspace,
            requestId: req.requestId,
            idempotencyKey: key,
            now: createdAt,
          }),
      })
      if (outcome.payload.data?.version) {
        res.setHeader('ETag', `"${outcome.payload.data.version}"`)
      }
      return sendIdempotentOutcome(res, req, outcome)
    }),
  )

  router.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error)
    }
    if (isHttpError(error)) {
      return sendFailure(res, error, req.requestId)
    }
    return sendFailure(
      res,
      new HttpError(503, 'DEPENDENCY_UNAVAILABLE', '服务暂时不可用，请稍后重试', { retryable: true }),
      req.requestId,
    )
  })

  return {
    router,
    database,
    migrations,
    service,
    close: () => closeOwnedDatabase(database),
  }
}

export function sendApiNotFound(req, res) {
  return sendFailure(res, notFound(RESOURCE_NOT_FOUND_MESSAGE), req.requestId)
}

export function createIdentityTestApp(options = {}) {
  const module = createIdentityModule(options)
  const app = express()
  app.use('/api/v1', module.router)
  app.use('/api/v1', sendApiNotFound)
  return { app, module }
}
