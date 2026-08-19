import { ApiError, asApiError, unwrapApiEnvelope } from './envelope.js'

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// session-only：只要 cookie，不要 X-Workspace-Id。学生可能没有工作空间。
// 与 POST /onboarding/enrollment-requests 同一通道；禁止把改密/改名当成受保护写请求去补工作空间头。
const SESSION_ONLY_PATHS = new Set([
  '/auth/login',
  '/auth/logout',
  '/session',
  '/onboarding/me',
  '/onboarding/enrollment-requests',
  '/me/password',
  '/me/profile',
])

function requestPathname(path) {
  return String(path || '').split('?')[0]
}

function isSessionOnlyPath(path) {
  return SESSION_ONLY_PATHS.has(requestPathname(path))
}

function joinUrl(baseUrl, path) {
  if (/^https?:\/\//i.test(path)) return path
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

function appendQuery(url, query) {
  if (!query) return url
  const search = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    search.set(key, String(value))
  })
  const value = search.toString()
  return value ? `${url}${url.includes('?') ? '&' : '?'}${value}` : url
}

async function readPayload(response) {
  const contentType = response.headers?.get?.('content-type') || ''
  if (contentType.includes('application/json')) return response.json()
  const text = await response.text()
  return text ? { error: { message: text } } : null
}

export function createApiClient({ fetchImpl = globalThis.fetch, baseUrl = '/api/v1' } = {}) {
  async function request(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase()
    const isWrite = WRITE_METHODS.has(method)
    if (typeof fetchImpl !== 'function') {
      throw new ApiError({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: '当前运行环境没有可用的网络请求能力',
        retryable: false,
      })
    }
    if (isWrite && !options.idempotencyKey) {
      throw new ApiError({
        code: 'VALIDATION_FAILED',
        message: '所有写请求都必须提供 Idempotency-Key',
        retryable: false,
      })
    }

    const headers = {
      Accept: 'application/json',
      ...(options.headers || {}),
    }
    if (options.workspaceId && !isSessionOnlyPath(path)) headers['X-Workspace-Id'] = options.workspaceId
    if (isSessionOnlyPath(path) && headers['X-Workspace-Id']) delete headers['X-Workspace-Id']
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'

    let response
    try {
      response = await fetchImpl(appendQuery(joinUrl(baseUrl, path), options.query), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: 'include',
        signal: options.signal,
      })
    } catch (error) {
      throw asApiError(error)
    }

    const requestId = response.headers?.get?.('x-request-id') || null
    let payload
    try {
      payload = await readPayload(response)
    } catch (error) {
      throw new ApiError({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: '服务响应无法解析，请稍后重试',
        retryable: response.status >= 500,
        requestId,
        status: response.status,
        cause: error,
      })
    }

    return unwrapApiEnvelope(payload, { status: response.status, requestId })
  }

  return {
    request,
    get: (path, options = {}) => request(path, { ...options, method: 'GET' }),
    post: (path, options = {}) => request(path, { ...options, method: 'POST' }),
    put: (path, options = {}) => request(path, { ...options, method: 'PUT' }),
    patch: (path, options = {}) => request(path, { ...options, method: 'PATCH' }),
    delete: (path, options = {}) => request(path, { ...options, method: 'DELETE' }),
  }
}
