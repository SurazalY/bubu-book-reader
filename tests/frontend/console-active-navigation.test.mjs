import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveConsoleNavigation } from '../../src/console/components/shell/activeNavigation.js'
import { canAccessConsolePath } from '../../src/console/state/consoleAccess.js'

const nav = [
  { key: 'home', path: '/console/home' },
  {
    key: 'teaching',
    groups: [{ items: [
      { key: 'arrangements', path: '/console/teaching/arrangements' },
      { key: 'reader', path: '/console/teaching/reader' },
    ] }],
  },
  {
    key: 'classes',
    groups: [{ items: [
      { key: 'overview', path: '/console/classes/overview' },
      { key: 'eyecare', path: '/console/classes/eyecare' },
    ] }],
  },
]

test('最长子路由决定权限端一级栏与二级栏高亮', () => {
  assert.deepEqual(resolveConsoleNavigation(nav, '/console/teaching/arrangements/arr-1'), {
    top: nav[1], leafKey: 'arrangements', path: '/console/teaching/arrangements',
  })
  assert.deepEqual(resolveConsoleNavigation(nav, '/console/teaching/reader/book-1'), {
    top: nav[1], leafKey: 'reader', path: '/console/teaching/reader',
  })
  assert.deepEqual(resolveConsoleNavigation(nav, '/console/classes/eyecare'), {
    top: nav[2], leafKey: 'eyecare', path: '/console/classes/eyecare',
  })
})

test('平台审计只向平台工作空间开放，普通工作空间在前端即被拒绝', () => {
  assert.equal(canAccessConsolePath({ scopeType: 'platform' }, '/console/platform/audit'), true)
  assert.equal(canAccessConsolePath({ scopeType: 'school' }, '/console/platform/audit'), false)
  assert.equal(canAccessConsolePath({ scopeType: 'class' }, '/console/platform/audit'), false)
  assert.equal(canAccessConsolePath({ scopeType: 'platform' }, '/console/home'), false)
})
