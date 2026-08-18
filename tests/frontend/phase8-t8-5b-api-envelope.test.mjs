import assert from 'node:assert/strict'
import test from 'node:test'

import { createAuthApi } from '../../src/api/auth.js'
import { createConsoleApi } from '../../src/api/console.js'
import { createStudentApi } from '../../src/api/student.js'

test('T8.5B login envelope 只提交 schoolCode+loginName+password', async () => {
  const calls = []
  const api = createAuthApi({
    post(path, options) {
      calls.push({ path, options })
      return Promise.resolve({ data: { ok: true }, meta: {} })
    },
  })
  await api.login(
    { schoolCode: 'internal-demo', loginName: 'teacher-a', password: 'secret' },
    { idempotencyKey: 'auth-login-t85b' },
  )
  assert.deepEqual(calls, [{
    path: '/auth/login',
    options: {
      idempotencyKey: 'auth-login-t85b',
      body: { schoolCode: 'internal-demo', loginName: 'teacher-a', password: 'secret' },
    },
  }])
})

test('T8.5B console shelf envelope 打 class-local 路径且无 visibility', async () => {
  const calls = []
  const api = createConsoleApi({
    get(path, options) {
      calls.push({ method: 'GET', path, options })
      return Promise.resolve({ data: { items: [] }, meta: {} })
    },
    put(path, options) {
      calls.push({ method: 'PUT', path, options })
      return Promise.resolve({ data: { bookId: 'book-1' }, meta: {} })
    },
    delete(path, options) {
      calls.push({ method: 'DELETE', path, options })
      return Promise.resolve({ data: { bookId: 'book-1' }, meta: {} })
    },
  })
  await api.getClassShelf('class-1', { workspaceId: 'ws-1' })
  await api.putClassShelfBook('class-1', 'book-1', { workspaceId: 'ws-1', idempotencyKey: 'shelf-put' })
  await api.deleteClassShelfBook('class-1', 'book-1', { workspaceId: 'ws-1', idempotencyKey: 'shelf-del' })
  assert.equal(typeof api.getBookVisibility, 'undefined')
  assert.equal(typeof api.setBookVisibility, 'undefined')
  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ['GET', '/classes/class-1/shelf'],
    ['PUT', '/classes/class-1/shelf/book-1'],
    ['DELETE', '/classes/class-1/shelf/book-1'],
  ])
})

test('T8.5B student registration/onboarding envelope', async () => {
  const calls = []
  const api = createStudentApi({
    get(path, options) {
      calls.push({ method: 'GET', path, options })
      return Promise.resolve({ data: {}, meta: {} })
    },
    post(path, options) {
      calls.push({ method: 'POST', path, options })
      return Promise.resolve({ data: {}, meta: {} })
    },
  })
  await api.getRegistration('token-1')
  await api.registerWithToken('token-1', { loginName: 'stu1', displayName: '学生', password: 'secret', classId: 'class-1' }, {
    idempotencyKey: 'reg-1',
  })
  await api.getOnboardingMe()
  await api.getMyEnrollment()
  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ['GET', '/registration/token-1'],
    ['POST', '/registration/token-1'],
    ['GET', '/onboarding/me'],
    ['GET', '/onboarding/me'],
  ])
})
