import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('学生四个底栏入口连接冻结页面且书架个人主页不导入演示数据', async () => {
  const app = await readFile(new URL('../../src/student/StudentApp.jsx', import.meta.url), 'utf8')
  const shelf = await readFile(new URL('../../src/student/pages/Shelf.jsx', import.meta.url), 'utf8')
  const me = await readFile(new URL('../../src/student/pages/Me.jsx', import.meta.url), 'utf8')
  for (const route of ['home', 'shelf', 'community', 'me']) assert.match(app, new RegExp(`path="${route}"`))
  assert.doesNotMatch(`${shelf}\n${me}`, /\.\.\/data\//)
  assert.match(shelf, /runtime\.data\?\.books/)
  assert.match(me, /useReadingStatistics|useReadingLibrary|useEyeCarePrivacy/)
})

test('权限端栏目根路径进入真实页面且安全入口不加载 fixture 列表', async () => {
  const app = await readFile(new URL('../../src/console/ConsoleApp.jsx', import.meta.url), 'utf8')
  const context = await readFile(new URL('../../src/console/state/ConsoleContext.jsx', import.meta.url), 'utf8')
  const access = await readFile(new URL('../../src/console/state/consoleAccess.js', import.meta.url), 'utf8')
  for (const route of ['teaching/arrangements', 'classes/overview', 'classes/eyecare', 'usage/sessions', 'usage/privacy', 'community', 'reports', 'safety']) {
    assert.match(app, new RegExp(`path="${route}"`))
  }
  assert.match(app, /function SafetyIndex/)
  assert.match(app, /path="platform\/audit"/)
  assert.match(app, /workspace\?\.scopeType === 'platform'/)
  assert.doesNotMatch(app, /SafetyList/)
  const visibleNav = context.slice(context.indexOf('const NAV_ITEMS'), context.indexOf('const PLATFORM_NAV_ITEMS'))
  assert.doesNotMatch(visibleNav, /key: 'accounts'|usage\/overview|usage\/quota|usage\/models|reports\/templates/)
  assert.match(access, /'\/console\/teaching\/books'/)
  assert.match(context, /PLATFORM_NAV_ITEMS[\s\S]*\/console\/platform\/audit/)
})
