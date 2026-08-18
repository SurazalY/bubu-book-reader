import assert from 'node:assert/strict'
import test from 'node:test'

import {
  IDENTITY_INDEX_PATH,
  assertErrorCode,
  assertHttpStatus,
  countActiveStudentMemberships,
  extractRouteBlock,
  newIdempotencyKey,
  readSource,
  requestJson,
  startPhase8App,
  writeHeaders,
} from './harness.guard.test.js'

test('B. identity router 不得再注册 POST /students（无兼容 handler / 假 404 分支）', () => {
  const source = readSource(IDENTITY_INDEX_PATH)
  const block = extractRouteBlock(source, 'post', '/students')
  assert.equal(block, '', '必须删除 POST /students 路由，不得保留兼容 handler 或假 404 分支')
  assert.equal(
    /router\.post\(\s*['"`]\/students['"`]/.test(source),
    false,
    'identity/index.js 不得再出现 router.post("/students")',
  )
})

test('B. POST /students 必须由标准不存在路由返回 404，且不能再物化已入班学生', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  const before = countActiveStudentMemberships(module.database, fixture.id.classA)
  const { header } = cookieFor(fixture.id.classTeacher)
  const response = await requestJson(baseUrl, '/students', {
    method: 'POST',
    headers: writeHeaders({
      cookie: header,
      workspaceId: fixture.id.classAWs,
      key: newIdempotencyKey('post-students'),
    }),
    body: {
      classId: fixture.id.classA,
      username: `ghost-${fixture.suffix}`,
      displayName: '不该被创建的学生',
      password: fixture.password,
    },
  })
  assertHttpStatus(response, 404, '退役 POST /students')
  assertErrorCode(response, 'RESOURCE_NOT_FOUND', '必须是标准 JSON 404，不得是 Express HTML 或缺路由兜底')
  const after = countActiveStudentMemberships(module.database, fixture.id.classA)
  assert.equal(after, before, 'POST /students 不得再物化已入班学生')
  const created = module.database
    .prepare('SELECT COUNT(*) AS count FROM users WHERE display_name = ?')
    .get('不该被创建的学生').count
  assert.equal(created, 0, '不得因该 POST 创建用户')
})
