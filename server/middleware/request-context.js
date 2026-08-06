import { randomUUID } from 'node:crypto'

import { HttpError } from '../db/errors.js'
import { sendFailure } from './http.js'

export function parseCookies(header) {
  if (!header) {
    return {}
  }

  return header.split(';').reduce((cookies, pair) => {
    const separator = pair.indexOf('=')
    if (separator <= 0) {
      return cookies
    }
    const key = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1).trim()
    try {
      cookies[key] = decodeURIComponent(value)
    } catch {
      cookies[key] = value
    }
    return cookies
  }, {})
}

export function createRequestContextMiddleware() {
  return (req, res, next) => {
    const incoming = req.get('X-Request-Id')
    req.requestId = incoming && /^[a-zA-Z0-9_-]{8,120}$/.test(incoming) ? incoming : randomUUID()
    res.setHeader('X-Request-Id', req.requestId)
    next()
  }
}

export function createRequireSessionMiddleware(service) {
  return (req, res, next) => {
    const token = parseCookies(req.get('Cookie'))[service.cookieName]
    const inspected = service.inspectSession(token)
    if (inspected.state !== 'active') {
      const error = new HttpError(
        401,
        inspected.state === 'expired' ? 'SESSION_EXPIRED' : 'AUTH_REQUIRED',
        inspected.state === 'expired' ? '登录会话已失效，请重新登录' : '需要有效登录会话',
      )
      return sendFailure(res, error, req.requestId)
    }
    req.identitySession = inspected.session
    return next()
  }
}

export function createRequireWorkspaceMiddleware(service) {
  return (req, res, next) => {
    try {
      const workspaceId = req.get('X-Workspace-Id')
      if (!workspaceId) {
        throw new HttpError(400, 'VALIDATION_FAILED', '受保护请求必须携带 X-Workspace-Id', {
          details: { field: 'X-Workspace-Id' },
        })
      }

      const workspace = service.resolveWorkspace(req.identitySession.user.id, workspaceId)
      if (!workspace) {
        throw new HttpError(403, 'PERMISSION_DENIED', '当前工作空间无权执行此操作')
      }

      req.workspace = workspace
      service.recordWorkspaceUse({
        actorUserId: req.identitySession.user.id,
        workspace,
        requestId: req.requestId,
      })
      return next()
    } catch (error) {
      return sendFailure(res, error, req.requestId)
    }
  }
}

export function createRequirePermissionMiddleware(service, action, getResourceScope) {
  return (req, res, next) => {
    try {
      const resourceScope = getResourceScope ? getResourceScope(req) : req.workspace
      const allowed = service.authorize({
        actor: req.identitySession.user,
        workspace: req.workspace,
        action,
        resourceScope,
      })
      if (!allowed) {
        throw new HttpError(403, 'PERMISSION_DENIED', '当前工作空间无权执行此操作')
      }
      return next()
    } catch (error) {
      return sendFailure(res, error, req.requestId)
    }
  }
}
