import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

const TIMING_MARKERS = [
  'closeAndWait',
  'reader_close',
  'session-summaries',
  'lease',
  'reading-monitor',
]

test('个人中心挂载 Me.jsx，并有调用 createAuthApi.logout 的退出登录入口', async () => {
  const [app, me, auth] = await Promise.all([
    source('../../src/student/StudentApp.jsx'),
    source('../../src/student/pages/Me.jsx'),
    source('../../src/api/auth.js'),
  ])

  assert.match(app, /import Me from '\.\/pages\/Me\.jsx'/)
  assert.match(app, /path="me" element={<Me \/>}/)

  assert.match(me, /退出登录/)
  assert.match(me, /from ['"]\.\.\/\.\.\/api\/auth\.js['"]/)
  assert.match(me, /createAuthApi\(/)
  assert.match(me, /authApi\.logout\(/)
  assert.match(me, /navigate\(\s*['"]\/student\/login['"]\s*,\s*\{\s*replace:\s*true\s*\}\s*\)/)
  assert.doesNotMatch(me, /<Link[^>]*to=["']\/student\/login["']/)
  assert.doesNotMatch(me, /to=["']\/student\/login["']/)

  assert.match(auth, /client\.post\('\/auth\/logout'/)
  assert.match(auth, /idempotencyKey\('auth-logout'\)/)
})

test('Me.jsx 退出路径不包含任何阅读计时处理', async () => {
  const me = await source('../../src/student/pages/Me.jsx')
  for (const marker of TIMING_MARKERS) {
    assert.doesNotMatch(me, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('设置页退出登录调用 authApi.logout()', async () => {
  const settings = await source('../../src/student/pages/settings/AccountSettings.jsx')
  assert.match(settings, /createAuthApi\(/)
  assert.match(settings, /authApi\.logout\(/)
  assert.doesNotMatch(settings, /<Link[^>]*to=["']\/student\/login["']/)
})
