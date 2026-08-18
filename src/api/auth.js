import { createApiClient } from './client.js'

function idempotencyKey(prefix) {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('当前浏览器无法生成安全请求标识')
  }
  return `${prefix}:${globalThis.crypto.randomUUID()}`
}

export function createAuthApi(client = createApiClient()) {
  return {
    login: ({ schoolCode, loginName, password } = {}, options = {}) =>
      client.post('/auth/login', {
        ...options,
        idempotencyKey: options.idempotencyKey || idempotencyKey('auth-login'),
        body: { schoolCode, loginName, password },
      }),
    logout: (options = {}) =>
      client.post('/auth/logout', {
        ...options,
        idempotencyKey: options.idempotencyKey || idempotencyKey('auth-logout'),
      }),
  }
}
