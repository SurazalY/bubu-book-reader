import assert from 'node:assert/strict'
import test from 'node:test'

import {
  IDENTITY_INDEX_PATH,
  INTEGRATION_ROUTER_PATH,
  assertCompleteTriple,
  assertHttpStatus,
  countSchoolScopeTeacherRoles,
  extractRouteBlock,
  loadTeacherTriple,
  newIdempotencyKey,
  readSource,
  requestJson,
  startPhase8App,
  writeHeaders,
} from './harness.guard.test.js'

const SESSION_ONLY = [
  ['get', '/onboarding/me'],
  ['get', '/teacher/class-directory'],
  ['put', '/teacher/classes/:classId'],
  ['delete', '/teacher/classes/:classId'],
  ['post', '/me/password'],
  ['patch', '/me/profile'],
]

test('C. session-only 路由只挂 identity router，且不经过 requireWorkspace', () => {
  const identity = readSource(IDENTITY_INDEX_PATH)
  const integration = readSource(INTEGRATION_ROUTER_PATH)
  for (const [method, path] of SESSION_ONLY) {
    const block = extractRouteBlock(identity, method, path)
    assert.ok(block.length > 0, `identity router 必须挂载 ${method.toUpperCase()} ${path}`)
    assert.match(block, /requireSession/, `${path} 必须是 session-only（requireSession）`)
    assert.equal(
      /requireWorkspace/.test(block),
      false,
      `${path} 必须在任何 requireWorkspace 之前，且不得调用 requireWorkspace`,
    )
    assert.equal(
      /service\.authorize\(/.test(block),
      false,
      `${path} 不得复用 service.authorize（V 禁止走现网 authorize 链）`,
    )
    assert.equal(
      new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(integration),
      false,
      `integration-router 不得挂载 ${path}`,
    )
  }
})

test('C. 零 workspace pending 学生可 GET /onboarding/me（无 X-Workspace-Id）', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const { header } = cookieFor(fixture.id.pendingStudent)
  const response = await requestJson(baseUrl, '/onboarding/me', {
    headers: writeHeaders({ cookie: header }),
  })
  assertHttpStatus(response, 200, 'pending 学生 onboarding/me')
  const role = response.payload.data.role ?? response.payload.data.expectedRole ?? response.payload.data.registrationRole
  assert.equal(role, 'student', 'onboarding/me 必须给出学生基础身份')
  assert.equal(response.payload.data.activeWorkspaceId ?? null, null)
})

test('C. 零 workspace 的 V 教师可 GET /teacher/class-directory（无 X-Workspace-Id）', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const { header } = cookieFor(fixture.id.zeroWsTeacher)
  const response = await requestJson(baseUrl, '/teacher/class-directory', {
    headers: writeHeaders({ cookie: header }),
  })
  assertHttpStatus(response, 200, 'V 教师班级目录')
  const items = response.payload.data.items ?? response.payload.data.classes ?? response.payload.data
  assert.ok(Array.isArray(items), '目录必须返回班级数组')
  const classA = items.find((item) => item.id === fixture.id.classA)
  assert.ok(classA, '目录必须包含本校 active 未毕业班')
  assert.equal(typeof classA.teacherCount, 'number', '目录必须返回 teacherCount')
  assert.equal(classA.studentCount, undefined, '教师目录不得返回学生数')
  assert.equal(
    items.some((item) => item.id === fixture.id.classGraduated),
    false,
    '毕业班不得进入教师自助加入目录',
  )
  assert.equal(
    items.some((item) => item.id === fixture.id.otherClass),
    false,
    '外校班不得出现在本校目录',
  )
})

test('C. 零 workspace 的 V 教师可 PUT join，且不得为 V 创建 school 范围 teacher role', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  const { header } = cookieFor(fixture.id.zeroWsTeacher)
  const response = await requestJson(baseUrl, `/teacher/classes/${fixture.id.classA}`, {
    method: 'PUT',
    headers: writeHeaders({ cookie: header, key: newIdempotencyKey('join-self') }),
    body: {},
  })
  assertHttpStatus(response, 200, 'join_self')
  const triple = loadTeacherTriple(module.database, {
    userId: fixture.id.zeroWsTeacher,
    classId: fixture.id.classA,
  })
  assertCompleteTriple(triple, 'active', 'join_self 后')
  assert.equal(
    countSchoolScopeTeacherRoles(module.database, fixture.id.zeroWsTeacher),
    0,
    '不得为 V 创建 school 范围 teacher role',
  )
  assert.ok(
    response.payload.data.workspaceId || response.payload.data.activeWorkspaceId,
    'join 响应必须返回可用 workspaceId',
  )
})

test('C. 教师调用 GET /classes → 403', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const { header } = cookieFor(fixture.id.classTeacher)
  const response = await requestJson(baseUrl, '/classes', {
    headers: writeHeaders({ cookie: header, workspaceId: fixture.id.classAWs }),
  })
  assertHttpStatus(response, 403, '教师不得走管理目录 GET /classes')
  assert.equal(errorOfCode(response), 'PERMISSION_DENIED')
})

function errorOfCode(response) {
  return response.payload?.error?.code
}

test('C. GET /classes 仅 S/G 可访问', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const admin = cookieFor(fixture.id.schoolAdmin)
  const gm = cookieFor(fixture.id.gradeManager)
  const adminRes = await requestJson(baseUrl, '/classes', {
    headers: writeHeaders({ cookie: admin.header, workspaceId: fixture.id.schoolAWs }),
  })
  assertHttpStatus(adminRes, 200, '校长 GET /classes')
  const gmRes = await requestJson(baseUrl, '/classes', {
    headers: writeHeaders({ cookie: gm.header, workspaceId: fixture.id.grade2023Ws }),
  })
  assertHttpStatus(gmRes, 200, '年级主任 GET /classes')
})

test('C. 已入班教师看本班走 GET /classes/:classId + C', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const { header } = cookieFor(fixture.id.classTeacher)
  const response = await requestJson(baseUrl, `/classes/${fixture.id.classA}`, {
    headers: writeHeaders({ cookie: header, workspaceId: fixture.id.classAWs }),
  })
  assertHttpStatus(response, 200, '教师看本班详情')
  const item = response.payload.data
  for (const key of ['id', 'name', 'stage', 'entryYear', 'classNumber', 'gradeId', 'currentGrade', 'lifecycle', 'status', 'version']) {
    assert.ok(key in item, `class DTO 必须包含 ${key}`)
  }
  assert.equal(item.id, fixture.id.classA)
  assert.equal(item.gradeId, 'primary:2023')
})
