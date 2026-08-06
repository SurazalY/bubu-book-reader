import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError, apiErrorHandler, requestContext, sendData, sendFailure } from '../../../server/http/api.js'

function responseDouble() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    set(name, value) {
      this.headers[name] = value
      return this
    },
    status(value) {
      this.statusCode = value
      return this
    },
    json(value) {
      this.body = value
      return this
    },
  }
}

test('request context accepts only bounded safe caller request ids', () => {
  const accepted = responseDouble()
  const acceptedReq = { get: () => 'client:request-42' }
  requestContext(acceptedReq, accepted, () => {})
  assert.equal(acceptedReq.requestId, 'client:request-42')
  assert.equal(accepted.headers['X-Request-Id'], 'client:request-42')

  const replaced = responseDouble()
  const replacedReq = { get: () => 'bad\nheader' }
  requestContext(replacedReq, replaced, () => {})
  assert.match(replacedReq.requestId, /^req_[0-9a-f-]{36}$/)
})

test('success envelope contains request metadata and optional cursor', () => {
  const response = responseDouble()
  sendData(response, { id: 'book-1' }, { requestId: 'req-1', nextCursor: null })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.body.data, { id: 'book-1' })
  assert.equal(response.body.meta.requestId, 'req-1')
  assert.equal(response.body.meta.nextCursor, null)
  assert.match(response.body.meta.serverTime, /^\d{4}-\d{2}-\d{2}T/)
})

test('known API errors preserve safe details and status', () => {
  const response = responseDouble()
  sendFailure(
    response,
    new ApiError('PERMISSION_DENIED', '当前工作空间无权执行此操作', {
      details: { action: 'book.read' },
    }),
    'req-2',
  )

  assert.equal(response.statusCode, 403)
  assert.deepEqual(response.body.error, {
    code: 'PERMISSION_DENIED',
    message: '当前工作空间无权执行此操作',
    retryable: false,
    details: { action: 'book.read' },
    requestId: 'req-2',
  })
})

test('unexpected errors never expose internal messages or secrets', () => {
  const response = responseDouble()
  const req = { requestId: 'req-3' }
  apiErrorHandler(new Error('AI_API_KEY=secret-value database path C:/private.db'), req, response, () => {})

  assert.equal(response.statusCode, 503)
  assert.equal(response.body.error.code, 'DEPENDENCY_UNAVAILABLE')
  assert.equal(response.body.error.retryable, true)
  assert.doesNotMatch(JSON.stringify(response.body), /secret-value|private\.db/)
})
