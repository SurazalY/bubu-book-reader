const HTTP_ERROR_CODES = Object.freeze({
  400: 'VALIDATION_FAILED',
  401: 'AUTH_REQUIRED',
  403: 'PERMISSION_DENIED',
  404: 'RESOURCE_NOT_FOUND',
  409: 'VERSION_CONFLICT',
  429: 'RATE_LIMITED',
  503: 'DEPENDENCY_UNAVAILABLE',
})

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function fallbackCode(status) {
  return HTTP_ERROR_CODES[status] || 'DEPENDENCY_UNAVAILABLE'
}

export class ApiError extends Error {
  constructor({ code, message, retryable = false, details = {}, requestId = null, status = null, cause = undefined }) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ApiError'
    this.code = code
    this.retryable = Boolean(retryable)
    this.details = isRecord(details) ? details : {}
    this.requestId = requestId
    this.status = status
  }
}

export function unwrapApiEnvelope(payload, { status = 200, requestId = null } = {}) {
  if (isRecord(payload) && Object.prototype.hasOwnProperty.call(payload, 'data')) {
    return {
      data: payload.data,
      meta: isRecord(payload.meta) ? payload.meta : {},
    }
  }

  if (isRecord(payload) && isRecord(payload.error)) {
    const error = payload.error
    throw new ApiError({
      code: typeof error.code === 'string' ? error.code : fallbackCode(status),
      message: typeof error.message === 'string' ? error.message : '请求未能完成',
      retryable: Boolean(error.retryable),
      details: error.details,
      requestId: error.requestId || requestId,
      status,
    })
  }

  throw new ApiError({
    code: fallbackCode(status),
    message: '服务返回的数据不符合约定的成功或失败信封',
    retryable: status >= 500,
    requestId,
    status,
  })
}

export function asApiError(error) {
  if (error instanceof ApiError) return error
  return new ApiError({
    code: 'DEPENDENCY_UNAVAILABLE',
    message: '服务暂不可用，请稍后重试',
    retryable: true,
    cause: error,
  })
}
