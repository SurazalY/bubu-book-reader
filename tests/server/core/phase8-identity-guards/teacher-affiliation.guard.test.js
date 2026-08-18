import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import {
  IDENTITY_INDEX_PATH,
  IDENTITY_PERMISSIONS_PATH,
  IDENTITY_SERVICE_PATH,
  assertCompleteTriple,
  assertErrorCode,
  assertHttpStatus,
  assertOpaque404,
  countSchoolScopeTeacherRoles,
  loadStudentTriple,
  loadTeacherTriple,
  newIdempotencyKey,
  readSource,
  requestJson,
  startPhase8App,
  writeHeaders,
} from './harness.guard.test.js'

test('D. join_self：session-only + V，立即生效，已 active 则 200 幂等且不得产生第二组', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  const { header } = cookieFor(fixture.id.classTeacher)
  const first = await requestJson(baseUrl, `/teacher/classes/${fixture.id.classA}`, {
    method: 'PUT',
    headers: writeHeaders({ cookie: header, key: newIdempotencyKey('join-idem-1') }),
    body: {},
  })
  assertHttpStatus(first, 200, '已 active 再 join')
  const second = await requestJson(baseUrl, `/teacher/classes/${fixture.id.classA}`, {
    method: 'PUT',
    headers: writeHeaders({ cookie: header, key: newIdempotencyKey('join-idem-2') }),
    body: {},
  })
  assertHttpStatus(second, 200, 'join 幂等')
  const triple = loadTeacherTriple(module.database, {
    userId: fixture.id.classTeacher,
    classId: fixture.id.classA,
  })
  assertCompleteTriple(triple, 'active', '幂等 join')
})

test('D. leave_self：不要求 X-Workspace-Id；完整 active → 同事务停用三者 200', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  const { header } = cookieFor(fixture.id.classTeacher)
  const response = await requestJson(baseUrl, `/teacher/classes/${fixture.id.classA}`, {
    method: 'DELETE',
    headers: writeHeaders({ cookie: header, key: newIdempotencyKey('leave-active') }),
  })
  assertHttpStatus(response, 200, 'leave_self 完整 active')
  assertCompleteTriple(
    loadTeacherTriple(module.database, { userId: fixture.id.classTeacher, classId: fixture.id.classA }),
    'disabled',
    'leave 后',
  )
})

test('D. leave_self：完整 disabled 或三者皆无 → 200 no-op；不得因 disabled/absent 先 403', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const historical = cookieFor(fixture.id.historicalTeacher)
  const disabled = await requestJson(baseUrl, `/teacher/classes/${fixture.id.classA}`, {
    method: 'DELETE',
    headers: writeHeaders({ cookie: historical.header, key: newIdempotencyKey('leave-disabled') }),
  })
  assertHttpStatus(disabled, 200, '完整 disabled 必须 200 no-op')
  assert.notEqual(disabled.status, 403, '不得因 disabled 先 403')

  const absent = cookieFor(fixture.id.zeroWsTeacher)
  const empty = await requestJson(baseUrl, `/teacher/classes/${fixture.id.classA}`, {
    method: 'DELETE',
    headers: writeHeaders({ cookie: absent.header, key: newIdempotencyKey('leave-absent') }),
  })
  assertHttpStatus(empty, 200, '三者皆无必须 200 no-op')
  assert.notEqual(empty.status, 403, '不得因 absent 先 403')
})

test('D. leave_self：残缺三元组 → 500 IDENTITY_INVARIANT_VIOLATION，且不自动修', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  module.database.prepare('DELETE FROM role_assignments WHERE user_id = ? AND scope_id = ?').run(
    fixture.id.classTeacher,
    fixture.id.classA,
  )
  const before = loadTeacherTriple(module.database, {
    userId: fixture.id.classTeacher,
    classId: fixture.id.classA,
  })
  assert.equal(before.roleAssignments.length, 0)
  assert.equal(before.memberships.length, 1)
  const { header } = cookieFor(fixture.id.classTeacher)
  const response = await requestJson(baseUrl, `/teacher/classes/${fixture.id.classA}`, {
    method: 'DELETE',
    headers: writeHeaders({ cookie: header, key: newIdempotencyKey('leave-broken') }),
  })
  assertHttpStatus(response, 500, '残缺 leave')
  assertErrorCode(response, 'IDENTITY_INVARIANT_VIOLATION', '残缺 leave')
  const after = loadTeacherTriple(module.database, {
    userId: fixture.id.classTeacher,
    classId: fixture.id.classA,
  })
  assert.equal(after.memberships.length, before.memberships.length, '残缺不得自动补/删 class_memberships')
  assert.equal(after.workspaceMemberships.length, before.workspaceMemberships.length, '残缺不得自动修 workspace')
  assert.equal(after.roleAssignments.length, 0, '不得自动补 role_assignments')
})

test('D. leave_self / join_self：class 不存在与跨组织同码同文案 404', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const { header } = cookieFor(fixture.id.zeroWsTeacher)
  const missing = await requestJson(baseUrl, `/teacher/classes/${randomUUID()}`, {
    method: 'PUT',
    headers: writeHeaders({ cookie: header, key: newIdempotencyKey('join-missing') }),
    body: {},
  })
  const foreign = await requestJson(baseUrl, `/teacher/classes/${fixture.id.otherClass}`, {
    method: 'PUT',
    headers: writeHeaders({ cookie: header, key: newIdempotencyKey('join-foreign') }),
    body: {},
  })
  assertOpaque404(foreign, missing, 'join_self')

  const leaveMissing = await requestJson(baseUrl, `/teacher/classes/${randomUUID()}`, {
    method: 'DELETE',
    headers: writeHeaders({ cookie: header, key: newIdempotencyKey('leave-missing') }),
  })
  const leaveForeign = await requestJson(baseUrl, `/teacher/classes/${fixture.id.otherClass}`, {
    method: 'DELETE',
    headers: writeHeaders({ cookie: header, key: newIdempotencyKey('leave-foreign') }),
  })
  assertOpaque404(leaveForeign, leaveMissing, 'leave_self')
})

test('D. 外校 / disabled / graduated 拒绝加入', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const { header } = cookieFor(fixture.id.zeroWsTeacher)
  const disabled = await requestJson(baseUrl, `/teacher/classes/${fixture.id.classDisabled}`, {
    method: 'PUT',
    headers: writeHeaders({ cookie: header, key: newIdempotencyKey('join-disabled') }),
    body: {},
  })
  assert.ok([403, 409].includes(disabled.status), `disabled 班必须拒绝，实际 ${disabled.status}`)
  assert.notEqual(disabled.status, 200)

  const graduated = await requestJson(baseUrl, `/teacher/classes/${fixture.id.classGraduated}`, {
    method: 'PUT',
    headers: writeHeaders({ cookie: header, key: newIdempotencyKey('join-graduated') }),
    body: {},
  })
  assert.ok([403, 409].includes(graduated.status), `graduated 班必须拒绝，实际 ${graduated.status}`)
  assert.notEqual(graduated.status, 200)
})

test('D. 并发两个 join 最终只有一组三元组', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  const { header } = cookieFor(fixture.id.zeroWsTeacher)
  const [left, right] = await Promise.all([
    requestJson(baseUrl, `/teacher/classes/${fixture.id.classA}`, {
      method: 'PUT',
      headers: writeHeaders({ cookie: header, key: newIdempotencyKey('join-race-a') }),
      body: {},
    }),
    requestJson(baseUrl, `/teacher/classes/${fixture.id.classA}`, {
      method: 'PUT',
      headers: writeHeaders({ cookie: header, key: newIdempotencyKey('join-race-b') }),
      body: {},
    }),
  ])
  assert.ok(left.status === 200 || right.status === 200, '并发 join 至少一次成功')
  assertCompleteTriple(
    loadTeacherTriple(module.database, { userId: fixture.id.zeroWsTeacher, classId: fixture.id.classA }),
    'active',
    '并发 join',
  )
})

test('D. 任一表故意缺失时不自动修，报不变量错误', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  module.database
    .prepare('DELETE FROM class_memberships WHERE user_id = ? AND class_id = ? AND membership_role = ?')
    .run(fixture.id.classTeacher, fixture.id.classA, 'teacher')
  const { header } = cookieFor(fixture.id.classTeacher)
  const join = await requestJson(baseUrl, `/teacher/classes/${fixture.id.classA}`, {
    method: 'PUT',
    headers: writeHeaders({ cookie: header, key: newIdempotencyKey('join-broken') }),
    body: {},
  })
  assertHttpStatus(join, 500, '残缺 join')
  assertErrorCode(join, 'IDENTITY_INVARIANT_VIOLATION', '残缺 join')
  const after = loadTeacherTriple(module.database, {
    userId: fixture.id.classTeacher,
    classId: fixture.id.classA,
  })
  assert.equal(after.memberships.length, 0, '不得自动补回缺失的 class_memberships')
})

test('D. teacher.affiliation.approve 不得存在（无 action、无路由、无 pending 教师审批模型）', () => {
  const permissions = readSource(IDENTITY_PERMISSIONS_PATH)
  const identity = readSource(IDENTITY_INDEX_PATH)
  const service = readSource(IDENTITY_SERVICE_PATH)
  assert.equal(
    /teacher\.affiliation\.approve/.test(permissions),
    false,
    'permissions.js 不得再授予 teacher.affiliation.approve',
  )
  assert.equal(
    /affiliation\.approve|teacher-approvals|teacher_affiliation_requests/.test(`${identity}\n${service}`),
    false,
    '不得存在教师归属审批路由或 pending 模型',
  )
})

test('D. teacherCount 计完整 active 三元组；三表人数不一致 → IDENTITY_INVARIANT_VIOLATION', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  const { header } = cookieFor(fixture.id.zeroWsTeacher)
  const ok = await requestJson(baseUrl, '/teacher/class-directory', {
    headers: writeHeaders({ cookie: header }),
  })
  assertHttpStatus(ok, 200, '一致时目录')
  const items = ok.payload.data.items ?? ok.payload.data.classes ?? ok.payload.data
  const classA = items.find((item) => item.id === fixture.id.classA)
  assert.equal(classA.teacherCount, 1, '完整 active 三元组人数')

  module.database
    .prepare(
      `INSERT INTO class_memberships (
        id, class_id, user_id, membership_role, status, created_at, updated_at, version
      ) VALUES (?, ?, ?, 'teacher', 'active', ?, ?, 1)`,
    )
    .run(randomUUID(), fixture.id.classA, fixture.id.unverifiedStaff, new Date().toISOString(), new Date().toISOString())

  const broken = await requestJson(baseUrl, '/teacher/class-directory', {
    headers: writeHeaders({ cookie: header }),
  })
  assertHttpStatus(broken, 500, 'teacherCount 不一致')
  assertErrorCode(broken, 'IDENTITY_INVARIANT_VIOLATION', 'teacherCount')
})

test('D. 强制指派/移除：S/G；目标须同校已验证教师；200 幂等；教师调用 403', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  const admin = cookieFor(fixture.id.schoolAdmin)
  const gm = cookieFor(fixture.id.gradeManager)
  const teacher = cookieFor(fixture.id.classTeacher)

  const teacherForce = await requestJson(
    baseUrl,
    `/classes/${fixture.id.classA}/teachers/${fixture.id.zeroWsTeacher}`,
    {
      method: 'PUT',
      headers: writeHeaders({
        cookie: teacher.header,
        workspaceId: fixture.id.classAWs,
        key: newIdempotencyKey('force-by-teacher'),
      }),
      body: {},
    },
  )
  assertHttpStatus(teacherForce, 403, '教师调用强制指派')

  const unverified = await requestJson(
    baseUrl,
    `/classes/${fixture.id.classA}/teachers/${fixture.id.unverifiedStaff}`,
    {
      method: 'PUT',
      headers: writeHeaders({
        cookie: admin.header,
        workspaceId: fixture.id.schoolAWs,
        key: newIdempotencyKey('force-unverified'),
      }),
      body: {},
    },
  )
  assert.ok([400, 403, 409].includes(unverified.status), '未验证教师不得被强制指派')

  const assign = await requestJson(
    baseUrl,
    `/classes/${fixture.id.classA}/teachers/${fixture.id.zeroWsTeacher}`,
    {
      method: 'PUT',
      headers: writeHeaders({
        cookie: admin.header,
        workspaceId: fixture.id.schoolAWs,
        key: newIdempotencyKey('force-assign-1'),
      }),
      body: {},
    },
  )
  assertHttpStatus(assign, 200, '校长强制指派')
  assertCompleteTriple(
    loadTeacherTriple(module.database, { userId: fixture.id.zeroWsTeacher, classId: fixture.id.classA }),
    'active',
    'force_assign',
  )
  const assignAgain = await requestJson(
    baseUrl,
    `/classes/${fixture.id.classA}/teachers/${fixture.id.zeroWsTeacher}`,
    {
      method: 'PUT',
      headers: writeHeaders({
        cookie: admin.header,
        workspaceId: fixture.id.schoolAWs,
        key: newIdempotencyKey('force-assign-2'),
      }),
      body: {},
    },
  )
  assertHttpStatus(assignAgain, 200, '强制指派幂等')

  const gmOtherGrade = await requestJson(
    baseUrl,
    `/classes/${fixture.id.classB}/teachers/${fixture.id.zeroWsTeacher}`,
    {
      method: 'PUT',
      headers: writeHeaders({
        cookie: gm.header,
        workspaceId: fixture.id.grade2023Ws,
        key: newIdempotencyKey('force-gm-over'),
      }),
      body: {},
    },
  )
  assertHttpStatus(gmOtherGrade, 403, '年级主任跨届强制指派')

  const remove = await requestJson(
    baseUrl,
    `/classes/${fixture.id.classA}/teachers/${fixture.id.zeroWsTeacher}`,
    {
      method: 'DELETE',
      headers: writeHeaders({
        cookie: admin.header,
        workspaceId: fixture.id.schoolAWs,
        key: newIdempotencyKey('force-remove-1'),
      }),
    },
  )
  assertHttpStatus(remove, 200, '强制移除')
  assertCompleteTriple(
    loadTeacherTriple(module.database, { userId: fixture.id.zeroWsTeacher, classId: fixture.id.classA }),
    'disabled',
    'force_remove',
  )
})

test('D. 行政纠错 PATCH /students/:userId/class：教师 403；源+目标对称校验；目标即当前班 200 且不掩盖残缺', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  const teacher = cookieFor(fixture.id.classTeacher)
  const admin = cookieFor(fixture.id.schoolAdmin)
  const gm = cookieFor(fixture.id.gradeManager)
  const membership = module.database
    .prepare(
      `SELECT version FROM class_memberships
       WHERE user_id = ? AND class_id = ? AND membership_role = 'student' AND status = 'active'`,
    )
    .get(fixture.id.enrolledStudent, fixture.id.classA)
  assert.ok(membership, '夹具必须有在班学生')

  const byTeacher = await requestJson(baseUrl, `/students/${fixture.id.enrolledStudent}/class`, {
    method: 'PATCH',
    headers: writeHeaders({
      cookie: teacher.header,
      workspaceId: fixture.id.classAWs,
      key: newIdempotencyKey('correct-teacher'),
    }),
    body: { targetClassId: fixture.id.classB, version: membership.version, reason: '教师不得纠错' },
  })
  assertHttpStatus(byTeacher, 403, '教师行政纠错')

  const gmCross = await requestJson(baseUrl, `/students/${fixture.id.enrolledStudent}/class`, {
    method: 'PATCH',
    headers: writeHeaders({
      cookie: gm.header,
      workspaceId: fixture.id.grade2023Ws,
      key: newIdempotencyKey('correct-gm-cross'),
    }),
    body: { targetClassId: fixture.id.classB, version: membership.version, reason: '跨届目标必须对称拒绝' },
  })
  assertHttpStatus(gmCross, 403, '年级主任目标跨届')

  const sameClass = await requestJson(baseUrl, `/students/${fixture.id.enrolledStudent}/class`, {
    method: 'PATCH',
    headers: writeHeaders({
      cookie: admin.header,
      workspaceId: fixture.id.schoolAWs,
      key: newIdempotencyKey('correct-same'),
    }),
    body: { targetClassId: fixture.id.classA, version: membership.version, reason: '目标即当前班' },
  })
  assertHttpStatus(sameClass, 200, '目标即当前班')
  assertCompleteTriple(
    loadStudentTriple(module.database, { userId: fixture.id.enrolledStudent, classId: fixture.id.classA }),
    'active',
    '目标即当前班不得重写残缺',
  )

  module.database
    .prepare(
      `DELETE FROM role_assignments
       WHERE user_id = ? AND scope_id = ? AND role_code = 'student'`,
    )
    .run(fixture.id.enrolledStudent, fixture.id.classA)
  const brokenSame = await requestJson(baseUrl, `/students/${fixture.id.enrolledStudent}/class`, {
    method: 'PATCH',
    headers: writeHeaders({
      cookie: admin.header,
      workspaceId: fixture.id.schoolAWs,
      key: newIdempotencyKey('correct-broken'),
    }),
    body: { targetClassId: fixture.id.classA, version: membership.version, reason: '残缺不得被当前班 200 掩盖' },
  })
  assertHttpStatus(brokenSame, 500, '残缺纠错')
  assertErrorCode(brokenSame, 'IDENTITY_INVARIANT_VIOLATION', '残缺纠错')
})
