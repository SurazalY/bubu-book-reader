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

import { createIdentityService } from './service.js'

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

function loginScope(username) {
  const fingerprint = createHash('sha256').update(username.trim().toLowerCase(), 'utf8').digest('hex')
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
    (req) => service.getUserScope(req.params.id),
  )
  const requireAccountManage = createRequirePermissionMiddleware(
    service,
    'account.manage',
    (req) => service.getUserScope(req.params.id),
  )
  const requireSchoolClassManage = createRequirePermissionMiddleware(
    service,
    'class.manage',
    (req) => ({
      type: 'school',
      id: req.workspace.organizationId,
      organizationId: req.workspace.organizationId,
    }),
  )
  const requireClassAccountManage = createRequirePermissionMiddleware(
    service,
    'account.manage',
    (req) => service.getClassScope(req.body?.classId),
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
      const username = typeof req.body?.username === 'string' ? req.body.username.trim() : ''
      const password = typeof req.body?.password === 'string' ? req.body.password : ''
      if (!username || !password) {
        throw new HttpError(400, 'VALIDATION_FAILED', 'username 与 password 均为必填项')
      }
      if (password.length > MAX_PASSWORD_LENGTH) {
        throw new HttpError(400, 'VALIDATION_FAILED', `password 不能超过 ${MAX_PASSWORD_LENGTH} 个字符`)
      }

      const key = idempotencyKey(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: loginScope(username),
        request: { username },
        requestHash: createRuntimeKeyedRequestHash(sessionSecret, {
          username: username.toLowerCase(),
          password,
        }),
        operation: ({ createdAt }) =>
          service.login({
            username,
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
          activeWorkspaceId: navigation.defaultWorkspaceId ?? workspaces[0]?.id ?? null,
          navigation,
        },
        { requestId: req.requestId },
      )
    }),
  )

  router.get(
    '/workspaces',
    requireSession,
    route((req, res) =>
      sendData(res, service.listWorkspaces(req.identitySession.user.id), { requestId: req.requestId }),
    ),
  )

  router.post(
    '/classes',
    requireSession,
    requireWorkspace,
    requireSchoolClassManage,
    route((req, res) => {
      const key = idempotencyKey(req)
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.class.create:${req.identitySession.user.id}:${req.workspace.id}`,
        request: { name: req.body?.name, gradeId: req.body?.gradeId },
        operation: ({ createdAt }) =>
          service.createClass({
            name: req.body?.name,
            gradeId: req.body?.gradeId,
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

  router.post(
    '/students',
    requireSession,
    requireWorkspace,
    requireClassAccountManage,
    route((req, res) => {
      const key = idempotencyKey(req)
      const request = {
        classId: req.body?.classId,
        username: req.body?.username,
        displayName: req.body?.displayName,
      }
      const outcome = executeIdempotent(database, {
        key,
        scope: `identity.student.create:${req.identitySession.user.id}:${req.workspace.id}:${req.body?.classId ?? ''}`,
        request,
        requestHash: createRuntimeKeyedRequestHash(sessionSecret, {
          ...request,
          password: req.body?.password,
        }),
        operation: ({ createdAt }) =>
          service.createStudent({
            ...request,
            password: req.body?.password,
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

  router.get(
    '/users/:id',
    requireSession,
    requireWorkspace,
    requireAccountRead,
    route((req, res) => sendData(res, service.getUser(req.params.id), { requestId: req.requestId })),
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

export function createIdentityTestApp(options = {}) {
  const module = createIdentityModule(options)
  const app = express()
  app.use('/api/v1', module.router)
  return { app, module }
}
