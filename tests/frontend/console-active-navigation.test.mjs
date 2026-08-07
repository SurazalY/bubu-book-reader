import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveConsoleNavigation } from '../../src/console/components/shell/activeNavigation.js'
import { canAccessConsolePath } from '../../src/console/state/consoleAccess.js'
import { PLATFORM_NAV_ITEMS, SCHOOL_NAV_ITEMS } from '../../src/console/state/navigation.js'

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

test('权限端所有业务一级项都有真实二级入口', () => {
  const schoolBusinessItems = SCHOOL_NAV_ITEMS.filter((item) => item.key !== 'home')
  assert.deepEqual(schoolBusinessItems.map((item) => item.key), ['accounts', 'teaching', 'classes', 'usage', 'community', 'reports', 'safety'])

  for (const item of schoolBusinessItems) {
    const leaves = item.groups?.flatMap((group) => group.items || []) || []
    assert.ok(leaves.length > 0, `${item.key} 应显示二级功能栏`)
    for (const leaf of leaves) {
      assert.equal(canAccessConsolePath({ scopeType: 'school' }, leaf.path), true, `${leaf.path} 必须是学校权限端已挂载页面`)
    }
  }

  const platformLeaves = PLATFORM_NAV_ITEMS[0].groups.flatMap((group) => group.items || [])
  assert.deepEqual(platformLeaves.map((item) => item.path), ['/console/platform/audit'])
  assert.equal(canAccessConsolePath({ scopeType: 'platform' }, platformLeaves[0].path), true)
})

test('单页面业务模块和平台审计也能解析出二级选中态', () => {
  assert.equal(resolveConsoleNavigation(SCHOOL_NAV_ITEMS, '/console/community').leafKey, 'community.review')
  assert.equal(resolveConsoleNavigation(SCHOOL_NAV_ITEMS, '/console/safety/event-1').leafKey, 'safety.events')
  assert.equal(resolveConsoleNavigation(PLATFORM_NAV_ITEMS, '/console/platform/audit').leafKey, 'platform.audit')
})
