import assert from 'node:assert/strict'
import test from 'node:test'

import { createAuthApi } from '../../../../src/api/auth.js'
import { createConsoleApi } from '../../../../src/api/console.js'
import { createStudentApi } from '../../../../src/api/student.js'
import {
  AUTH_API_PATH,
  CONSOLE_API_PATH,
  STUDENT_API_PATH,
  readSource,
} from './shared-harness.guard.test.js'

test('F. console.js 必须有 class-local shelf API，并删除 visibility 写', () => {
  const source = readSource(CONSOLE_API_PATH)
  const api = createConsoleApi()
  assert.equal(typeof api.getClassShelf, 'function', 'createConsoleApi 必须导出 getClassShelf(classId)')
  assert.equal(typeof api.putClassShelfBook, 'function', 'createConsoleApi 必须导出 putClassShelfBook(classId, bookId)')
  assert.equal(typeof api.deleteClassShelfBook, 'function', 'createConsoleApi 必须导出 deleteClassShelfBook(classId, bookId)')
  assert.equal(typeof api.getBookVisibility, 'undefined', '必须删除 getBookVisibility')
  assert.equal(typeof api.setBookVisibility, 'undefined', '必须删除 setBookVisibility')
  assert.equal(source.includes('/visibility'), false, 'console.js 不得再调用 /books/:bookId/visibility')
  assert.match(source, /\/classes\/.*\/shelf/, 'console.js shelf API 必须打 /classes/:classId/shelf')
})

test('F. auth.js 登录体必须是 loginName+password，不得再发 username-only 或 schoolCode', () => {
  const source = readSource(AUTH_API_PATH)
  const api = createAuthApi()
  assert.equal(typeof api.login, 'function')
  assert.equal(source.includes('schoolCode'), false, 'login body 不得含 schoolCode')
  assert.match(source, /loginName/, 'login body 必须含 loginName')
  assert.equal(
    /body:\s*\{\s*username\s*,\s*password\s*\}/.test(source),
    false,
    '不得再发送 { username, password }',
  )
  const loginSource = source.slice(source.indexOf('login:'))
  assert.equal(
    /username,\s*password/.test(loginSource.slice(0, 400)),
    false,
    'createAuthApi().login 参数不得再是 username, password',
  )
})

test('F. student.js 必须有 registration / onboarding / enrollment 读方法', () => {
  const source = readSource(STUDENT_API_PATH)
  const api = createStudentApi()
  assert.equal(typeof api.getRegistration, 'function', '必须导出 getRegistration(token) → GET /registration/:token')
  assert.equal(
    typeof api.registerWithToken === 'function' || typeof api.submitRegistration === 'function',
    true,
    '必须导出 registerWithToken 或 submitRegistration → POST /registration/:token',
  )
  assert.equal(typeof api.getOnboardingMe, 'function', '必须导出 getOnboardingMe → GET /onboarding/me')
  assert.equal(
    typeof api.getMyEnrollment === 'function'
      || typeof api.getEnrollmentSelf === 'function'
      || typeof api.listMyEnrollmentRequests === 'function',
    true,
    '必须导出 enrollment 读方法（getMyEnrollment / getEnrollmentSelf / listMyEnrollmentRequests）',
  )
  assert.match(source, /\/registration\//, 'student.js 必须调用 /registration/:token')
  assert.match(source, /\/onboarding\/me/, 'student.js 必须调用 /onboarding/me')
})
