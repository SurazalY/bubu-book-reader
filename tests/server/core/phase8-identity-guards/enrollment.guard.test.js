import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertCompleteTriple,
  assertErrorCode,
  assertHttpStatus,
  insertEnrollmentRequest,
  loadStudentTriple,
  newIdempotencyKey,
  requestJson,
  startPhase8App,
  writeHeaders,
} from './harness.guard.test.js'

test('F. 注册后零成员关系、一条 pending', async (t) => {
  const { fixture, baseUrl, module } = await startPhase8App(t)
  const loginName = `ap${fixture.suffix}`
  const response = await requestJson(baseUrl, `/registration/${fixture.studentRegister.rawToken}`, {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey('enroll-reg') },
    body: {
      loginName,
      displayName: '待审新人',
      password: fixture.password,
      classId: fixture.id.classA,
    },
  })
  assertHttpStatus(response, 201, '学生注册')
  const user = module.database.prepare('SELECT id FROM users WHERE login_name = ?').get(loginName)
  const pending = module.database
    .prepare('SELECT * FROM student_enrollment_requests WHERE student_user_id = ?')
    .all(user.id)
  assert.equal(pending.length, 1)
  assert.equal(pending[0].status, 'pending')
  const triple = loadStudentTriple(module.database, { userId: user.id, classId: fixture.id.classA })
  assert.equal(triple.memberships.length + triple.workspaceMemberships.length + triple.roleAssignments.length, 0)
})

test('F. 批准一次性建学生三关系', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  const { header } = cookieFor(fixture.id.classTeacher)
  const response = await requestJson(baseUrl, `/enrollment-requests/${fixture.pendingEnrollment.id}/approve`, {
    method: 'POST',
    headers: writeHeaders({
      cookie: header,
      workspaceId: fixture.id.classAWs,
      key: newIdempotencyKey('approve'),
      ifMatch: 1,
    }),
    body: { version: 1 },
  })
  assertHttpStatus(response, 200, '批准')
  assertCompleteTriple(
    loadStudentTriple(module.database, { userId: fixture.id.pendingStudent, classId: fixture.id.classA }),
    'active',
    '批准后学生三关系',
  )
  const row = module.database
    .prepare('SELECT status FROM student_enrollment_requests WHERE id = ?')
    .get(fixture.pendingEnrollment.id)
  assert.equal(row.status, 'approved')
})

test('F. 拒绝后可新申请；终态不可改 → 409 VERSION_CONFLICT', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  const { header } = cookieFor(fixture.id.classTeacher)
  const rejected = await requestJson(baseUrl, `/enrollment-requests/${fixture.pendingEnrollment.id}/reject`, {
    method: 'POST',
    headers: writeHeaders({
      cookie: header,
      workspaceId: fixture.id.classAWs,
      key: newIdempotencyKey('reject'),
      ifMatch: 1,
    }),
    body: { version: 1, reason: '先拒绝' },
  })
  assertHttpStatus(rejected, 200, '拒绝')
  const reapply = await requestJson(baseUrl, '/onboarding/enrollment-requests', {
    method: 'POST',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.pendingStudent).header,
      key: newIdempotencyKey('reapply'),
    }),
    body: { classId: fixture.id.classA },
  })
  assertHttpStatus(reapply, 201, '拒绝后新申请')
  const rows = module.database
    .prepare('SELECT status FROM student_enrollment_requests WHERE student_user_id = ? ORDER BY requested_at, id')
    .all(fixture.id.pendingStudent)
  assert.ok(rows.some((row) => row.status === 'rejected'), '旧拒绝行保留')
  assert.ok(rows.some((row) => row.status === 'pending'), '必须新建 pending')

  const mutate = await requestJson(baseUrl, `/enrollment-requests/${fixture.pendingEnrollment.id}/approve`, {
    method: 'POST',
    headers: writeHeaders({
      cookie: header,
      workspaceId: fixture.id.classAWs,
      key: newIdempotencyKey('approve-terminal'),
      ifMatch: 2,
    }),
    body: { version: 2 },
  })
  assertHttpStatus(mutate, 409, '终态不可改')
  assertErrorCode(mutate, 'VERSION_CONFLICT', '终态')
})

test('F. 重复 pending / 已有 active 班 / 教师审别班 / grade_manager 跨届 全部拒绝', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  const duplicate = await requestJson(baseUrl, '/onboarding/enrollment-requests', {
    method: 'POST',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.pendingStudent).header,
      key: newIdempotencyKey('dup-pending'),
    }),
    body: { classId: fixture.id.classA },
  })
  assert.ok([400, 409].includes(duplicate.status), `重复 pending 必须拒绝，实际 ${duplicate.status}`)

  const alreadyIn = await requestJson(baseUrl, '/onboarding/enrollment-requests', {
    method: 'POST',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.enrolledStudent).header,
      key: newIdempotencyKey('already-in'),
    }),
    body: { classId: fixture.id.classB },
  })
  assert.ok([400, 409].includes(alreadyIn.status), `已有 active 班必须拒绝，实际 ${alreadyIn.status}`)

  const otherClassPending = insertEnrollmentRequest(module.database, {
    organizationId: fixture.id.schoolA,
    studentUserId: fixture.id.unverifiedStaff,
    classId: fixture.id.classB,
  })
  const otherClass = await requestJson(baseUrl, `/enrollment-requests/${otherClassPending.id}/approve`, {
    method: 'POST',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.classTeacher).header,
      workspaceId: fixture.id.classAWs,
      key: newIdempotencyKey('review-other-class'),
      ifMatch: 1,
    }),
    body: { version: 1 },
  })
  assertHttpStatus(otherClass, 403, '教师审别班')

  const gmCross = await requestJson(baseUrl, `/enrollment-requests/${otherClassPending.id}/approve`, {
    method: 'POST',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.gradeManager).header,
      workspaceId: fixture.id.grade2023Ws,
      key: newIdempotencyKey('gm-cross-review'),
      ifMatch: 1,
    }),
    body: { version: 1 },
  })
  assertHttpStatus(gmCross, 403, '年级主任跨届审批')
})

test('F. If-Match 优先于 body version：If-Match 当前 + body 过期 → 200', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const { header } = cookieFor(fixture.id.classTeacher)
  const response = await requestJson(baseUrl, `/enrollment-requests/${fixture.pendingEnrollment.id}/approve`, {
    method: 'POST',
    headers: writeHeaders({
      cookie: header,
      workspaceId: fixture.id.classAWs,
      key: newIdempotencyKey('if-match-wins'),
      ifMatch: 1,
    }),
    body: { version: 99 },
  })
  assertHttpStatus(response, 200, 'If-Match 优先并按当前 version 成功')
})

test('F. 并发两个批准：只有一次物化学生三关系，另一次 409', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  const { header } = cookieFor(fixture.id.classTeacher)
  const [left, right] = await Promise.all([
    requestJson(baseUrl, `/enrollment-requests/${fixture.pendingEnrollment.id}/approve`, {
      method: 'POST',
      headers: writeHeaders({
        cookie: header,
        workspaceId: fixture.id.classAWs,
        key: newIdempotencyKey('approve-race-a'),
        ifMatch: 1,
      }),
      body: { version: 1 },
    }),
    requestJson(baseUrl, `/enrollment-requests/${fixture.pendingEnrollment.id}/approve`, {
      method: 'POST',
      headers: writeHeaders({
        cookie: header,
        workspaceId: fixture.id.classAWs,
        key: newIdempotencyKey('approve-race-b'),
        ifMatch: 1,
      }),
      body: { version: 1 },
    }),
  ])
  const statuses = [left.status, right.status].sort()
  assert.ok(statuses.includes(200), '并发批准必须有一次成功')
  assert.equal(statuses.filter((status) => status === 200).length, 1, '并发批准不得两次成功')
  assert.ok(statuses.includes(409), '另一次必须 409 VERSION_CONFLICT')
  assertCompleteTriple(
    loadStudentTriple(module.database, { userId: fixture.id.pendingStudent, classId: fixture.id.classA }),
    'active',
    '并发批准后',
  )
})

test('F. If-Match 优先于 body version：If-Match 过期 + body 当前 → 409 VERSION_CONFLICT', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const { header } = cookieFor(fixture.id.classTeacher)
  const response = await requestJson(baseUrl, `/enrollment-requests/${fixture.pendingEnrollment.id}/approve`, {
    method: 'POST',
    headers: writeHeaders({
      cookie: header,
      workspaceId: fixture.id.classAWs,
      key: newIdempotencyKey('if-match-stale'),
      ifMatch: 99,
    }),
    body: { version: 1 },
  })
  assertHttpStatus(response, 409, 'If-Match 过期必须 409，不得改用 body version 成功')
  assertErrorCode(response, 'VERSION_CONFLICT', 'If-Match 过期')
})
