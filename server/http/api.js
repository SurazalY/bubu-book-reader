import { randomUUID } from 'node:crypto'

const ERROR_STATUS = Object.freeze({
  AUTH_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  PERMISSION_DENIED: 403,
  RESOURCE_NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  VALIDATION_FAILED: 422,
  HUMAN_REVIEW_REQUIRED: 422,
  RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
})

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/

export class ApiError extends Error {
  constructor(code, message, options = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = options.status ?? ERROR_STATUS[code] ?? 500
    this.retryable = options.retryable ?? false
    this.details = options.details ?? {}
    this.cause = options.cause
  }
}

export function requestContext(req, res, next) {
  const forwarded = req.get('X-Request-Id')
  const requestId = forwarded && SAFE_REQUEST_ID.test(forwarded) ? forwarded : `req_${randomUUID()}`
  req.requestId = requestId
  res.set('X-Request-Id', requestId)
  next()
}

export function sendData(res, data, options = {}) {
  const meta = {
    requestId: options.requestId,
    serverTime: new Date().toISOString(),
  }
  if (Object.hasOwn(options, 'nextCursor')) meta.nextCursor = options.nextCursor
  return res.status(options.status ?? 200).json({ data, meta })
}

export function sendFailure(res, error, requestId) {
  const apiError = normalizeError(error)
  return res.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.message,
      retryable: apiError.retryable,
      details: apiError.details,
      requestId,
    },
  })
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

export function apiErrorHandler(error, req, res, next) {
  if (res.headersSent) return next(error)
  return sendFailure(res, error, req.requestId)
}

function normalizeError(error) {
  if (error instanceof ApiError) return error
  return new ApiError('DEPENDENCY_UNAVAILABLE', '服务暂时不可用，请稍后重试', {
    retryable: true,
    cause: error,
  })
}
