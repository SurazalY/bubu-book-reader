import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

import {
  assertAuditOmitsSecrets,
  assertErrorCode,
  assertHttpStatus,
  errorOf,
  loadStudentTriple,
  newIdempotencyKey,
  requestJson,
  startPhase8App,
  writeHeaders,
} from './harness.guard.test.js'

function issueHeaders(harness, userId, workspaceId, key) {
  return writeHeaders({
    cookie: harness.cookieFor(userId).header,
    workspaceId,
    key: key ?? newIdempotencyKey('reg-issue'),
  })
}

test('E. teacher/student 凭据分开；body 出现 role/organizationId/scopeId → 400', async (t) => {
  const harness = await startPhase8App(t)
  const { fixture, baseUrl } = harness
  const injected = await requestJson(baseUrl, `/registration/${fixture.studentRegister.rawToken}`, {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey('reg-inject') },
    body: {
      loginName: `inj${fixture.suffix}`,
      displayName: '注入角色',
      password: fixture.password,
      classId: fixture.id.classA,
      role: 'teacher',
      organizationId: fixture.id.schoolB,
      scopeId: fixture.id.schoolB,
    },
  })
  assertHttpStatus(injected, 400, 'role/org/scope 注入')
  assertErrorCode(injected, 'VALIDATION_FAILED', '注入')
})

test('E. 组织只从 token 反查；公开消费原文不落库、不进审计', async (t) => {
  const { fixture, baseUrl, module } = await startPhase8App(t)
  const loginName = `nw${fixture.suffix}`
  const response = await requestJson(baseUrl, `/registration/${fixture.studentRegister.rawToken}`, {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey('reg-student') },
    body: {
      loginName,
      displayName: '新学生',
      password: fixture.password,
      classId: fixture.id.classA,
    },
  })
  assertHttpStatus(response, 201, '学生注册')
  const user = module.database.prepare('SELECT * FROM users WHERE login_name = ?').get(loginName)
  assert.ok(user, '必须创建用户')
  assert.equal(user.organization_id, fixture.id.schoolA, '组织必须来自 token')
  const pending = module.database
    .prepare(
      `SELECT COUNT(*) AS count FROM student_enrollment_requests
       WHERE student_user_id = ? AND status = 'pending'`,
    )
    .get(user.id).count
  assert.equal(pending, 1, '注册后必须有一条 pending')
  const triple = loadStudentTriple(module.database, { userId: user.id, classId: fixture.id.classA })
  assert.equal(triple.memberships.length, 0, '注册后零 class membership')
  assert.equal(triple.workspaceMemberships.length, 0, '注册后零 workspace membership')
  assert.equal(triple.roleAssignments.length, 0, '注册后零 student role')
  const stored = JSON.stringify(module.database.prepare('SELECT * FROM registration_credentials').all())
  assert.equal(stored.includes(fixture.studentRegister.rawToken), false, '原文不得落库')
  assertAuditOmitsSecrets(module.database, [fixture.studentRegister.rawToken, fixture.password])
})

test('E. 撤销/到期/用尽公开端统一 404', async (t) => {
  const { fixture, baseUrl } = await startPhase8App(t)
  const missing = await requestJson(baseUrl, `/registration/${randomBytes(32).toString('base64url')}`)
  const revoked = await requestJson(baseUrl, `/registration/${fixture.revokedRegister.rawToken}`)
  const expired = await requestJson(baseUrl, `/registration/${fixture.expiredRegister.rawToken}`)
  const exhausted = await requestJson(baseUrl, `/registration/${fixture.exhaustedRegister.rawToken}`)
  for (const [title, response] of [
    ['不存在', missing],
    ['撤销', revoked],
    ['到期', expired],
    ['用尽', exhausted],
  ]) {
    assertHttpStatus(response, 404, title)
    assertErrorCode(response, 'RESOURCE_NOT_FOUND', title)
  }
  assert.equal(errorOf(revoked).message, errorOf(missing).message, '撤销与不存在同文案')
  assert.equal(errorOf(expired).message, errorOf(missing).message, '到期与不存在同文案')
  assert.equal(errorOf(exhausted).message, errorOf(missing).message, '用尽与不存在同文案')
})

test('E. 人数上限最后一名额并发只有一个成功；失败不计 use', async (t) => {
  const { fixture, baseUrl, module } = await startPhase8App(t)
  const token = fixture.teacherRegister.rawToken
  const before = module.database
    .prepare('SELECT successful_use_count FROM registration_credentials WHERE id = ?')
    .get(fixture.teacherRegister.id).successful_use_count
  const [left, right] = await Promise.all([
    requestJson(baseUrl, `/registration/${token}`, {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey('reg-race-a') },
      body: { loginName: `ra${fixture.suffix}`, displayName: '并发甲', password: fixture.password },
    }),
    requestJson(baseUrl, `/registration/${token}`, {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey('reg-race-b') },
      body: { loginName: `rb${fixture.suffix}`, displayName: '并发乙', password: fixture.password },
    }),
  ])
  const statuses = [left.status, right.status].sort()
  assert.ok(statuses.includes(201), '并发必须有一个成功')
  assert.equal(statuses.filter((status) => status === 201).length, 1, '最后一名额只能成功一次')
  const after = module.database
    .prepare('SELECT successful_use_count FROM registration_credentials WHERE id = ?')
    .get(fixture.teacherRegister.id).successful_use_count
  assert.equal(after, before + 1, '失败不得增加 successful_use_count')
})

test('E. 同 loginName 跨校与同校一律冲突；同校冲突 409 + details.suggestions 3 个', async (t) => {
  const { fixture, baseUrl } = await startPhase8App(t)
  const conflict = await requestJson(baseUrl, `/registration/${fixture.studentRegister.rawToken}`, {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey('reg-conflict') },
    body: {
      loginName: fixture.login.enrolledStudent,
      displayName: '重名',
      password: fixture.password,
      classId: fixture.id.classA,
    },
  })
  assertHttpStatus(conflict, 409, '同校 loginName 冲突')
  assertErrorCode(conflict, 'RESOURCE_CONFLICT', '同校冲突')
  const suggestions = conflict.payload.error.details?.suggestions
  assert.ok(Array.isArray(suggestions), '必须返回 details.suggestions')
  assert.equal(suggestions.length, 3, '建议必须恰好 3 个')
  assert.equal(suggestions[0], `${fixture.login.enrolledStudent}-2`)
  assert.equal(suggestions[1], `${fixture.login.enrolledStudent}-3`)
  assert.equal(suggestions[2], `${fixture.login.enrolledStudent}-4`)

  const cross = await requestJson(baseUrl, `/registration/${fixture.studentRegisterB.rawToken}`, {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey('reg-cross-school') },
    body: {
      loginName: fixture.login.enrolledStudent,
      displayName: '跨校同名',
      password: fixture.password,
      classId: fixture.id.otherClass,
    },
  })
  assertHttpStatus(cross, 409, '同 loginName 跨校必须被全局唯一拒绝')
  assertErrorCode(cross, 'RESOURCE_CONFLICT', '跨校同名')
})

test('E. 教师/学生默认 TTL 与 max_uses 可被显式覆盖', async (t) => {
  const harness = await startPhase8App(t)
  const { fixture, baseUrl, module } = harness
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
  const teacherIssue = await requestJson(baseUrl, '/registration-credentials', {
    method: 'POST',
    headers: issueHeaders(harness, fixture.id.schoolAdmin, fixture.id.schoolAWs, newIdempotencyKey('issue-override')),
    body: { expectedRole: 'teacher', maxUses: 5, expiresAt },
  })
  assertHttpStatus(teacherIssue, 201, '显式覆盖教师凭据')
  const teacherRow = module.database
    .prepare('SELECT * FROM registration_credentials WHERE id = ?')
    .get(teacherIssue.payload.data.id)
  assert.equal(teacherRow.max_uses, 5, 'maxUses 显式覆盖')
  assert.equal(teacherRow.expires_at, expiresAt, 'expiresAt 显式覆盖')

  const studentIssue = await requestJson(baseUrl, '/registration-credentials', {
    method: 'POST',
    headers: issueHeaders(harness, fixture.id.schoolAdmin, fixture.id.schoolAWs, newIdempotencyKey('issue-student-override')),
    body: { expectedRole: 'student', maxUses: 20, expiresAt },
  })
  assertHttpStatus(studentIssue, 201, '显式覆盖学生凭据')
  const studentRow = module.database
    .prepare('SELECT * FROM registration_credentials WHERE id = ?')
    .get(studentIssue.payload.data.id)
  assert.equal(studentRow.max_uses, 20)
  assert.equal(studentRow.expires_at, expiresAt)
})

test('E. 教师默认 7 天 max_uses=1；学生默认 180 天 max_uses=NULL', async (t) => {
  const harness = await startPhase8App(t)
  const { fixture, baseUrl, module } = harness
  const teacherIssue = await requestJson(baseUrl, '/registration-credentials', {
    method: 'POST',
    headers: issueHeaders(harness, fixture.id.schoolAdmin, fixture.id.schoolAWs, newIdempotencyKey('issue-teacher')),
    body: { expectedRole: 'teacher' },
  })
  assertHttpStatus(teacherIssue, 201, '签发教师凭据')
  assert.ok(teacherIssue.payload.data.rawToken, 'rawToken 只出现一次')
  const teacherRow = module.database
    .prepare('SELECT * FROM registration_credentials WHERE id = ?')
    .get(teacherIssue.payload.data.id)
  assert.equal(teacherRow.max_uses, 1)
  const teacherMs = Date.parse(teacherRow.expires_at) - Date.parse(teacherRow.created_at)
  assert.ok(Math.abs(teacherMs - 7 * 24 * 60 * 60 * 1000) < 5000, '教师默认 7 天')

  const studentIssue = await requestJson(baseUrl, '/registration-credentials', {
    method: 'POST',
    headers: issueHeaders(harness, fixture.id.schoolAdmin, fixture.id.schoolAWs, newIdempotencyKey('issue-student')),
    body: { expectedRole: 'student' },
  })
  assertHttpStatus(studentIssue, 201, '签发学生凭据')
  const studentRow = module.database
    .prepare('SELECT * FROM registration_credentials WHERE id = ?')
    .get(studentIssue.payload.data.id)
  assert.equal(studentRow.max_uses, null, '学生默认 max_uses=NULL')
  const studentMs = Date.parse(studentRow.expires_at) - Date.parse(studentRow.created_at)
  assert.ok(Math.abs(studentMs - 180 * 24 * 60 * 60 * 1000) < 5000, '学生默认 180 天')
  assert.equal(
    JSON.stringify(module.database.prepare('SELECT * FROM registration_credentials').all()).includes(
      teacherIssue.payload.data.rawToken,
    ),
    false,
    '签发原文不得落库',
  )
})

test('E. grade_manager 签发学生凭据必须是自己的 grade scope，body 改 scopeId → 400', async (t) => {
  const harness = await startPhase8App(t)
  const { fixture, baseUrl, module } = harness
  const injected = await requestJson(baseUrl, '/registration-credentials', {
    method: 'POST',
    headers: issueHeaders(harness, fixture.id.gradeManager, fixture.id.grade2023Ws, newIdempotencyKey('gm-scope')),
    body: { expectedRole: 'student', scopeId: 'primary:2024' },
  })
  assertHttpStatus(injected, 400, 'GM 改 scopeId')
  assertErrorCode(injected, 'VALIDATION_FAILED', 'GM scopeId')

  const ok = await requestJson(baseUrl, '/registration-credentials', {
    method: 'POST',
    headers: issueHeaders(harness, fixture.id.gradeManager, fixture.id.grade2023Ws, newIdempotencyKey('gm-student')),
    body: { expectedRole: 'student' },
  })
  assertHttpStatus(ok, 201, 'GM 签发本届学生凭据')
  const row = module.database.prepare('SELECT * FROM registration_credentials WHERE id = ?').get(ok.payload.data.id)
  assert.equal(row.scope_type, 'grade')
  assert.equal(row.scope_id, 'primary:2023')
})

test('E. grade_manager 可签发教师凭据（school 例外），但不能跨届建班/改学生', async (t) => {
  const harness = await startPhase8App(t)
  const { fixture, baseUrl } = harness
  const issueTeacher = await requestJson(baseUrl, '/registration-credentials', {
    method: 'POST',
    headers: issueHeaders(harness, fixture.id.gradeManager, fixture.id.grade2023Ws, newIdempotencyKey('gm-teacher')),
    body: { expectedRole: 'teacher' },
  })
  assertHttpStatus(issueTeacher, 201, 'GM 签发教师凭据')

  const createOtherGrade = await requestJson(baseUrl, '/classes', {
    method: 'POST',
    headers: issueHeaders(harness, fixture.id.gradeManager, fixture.id.grade2023Ws, newIdempotencyKey('gm-class')),
    body: { name: '跨届班', stage: 'primary', entryYear: 2024, classNumber: 8 },
  })
  assertHttpStatus(createOtherGrade, 403, 'GM 不得跨届建班')

  const membership = harness.module.database
    .prepare(
      `SELECT version FROM class_memberships
       WHERE user_id = ? AND membership_role = 'student' AND status = 'active'`,
    )
    .get(fixture.id.classBStudent)
  const correct = await requestJson(baseUrl, `/students/${fixture.id.classBStudent}/class`, {
    method: 'PATCH',
    headers: issueHeaders(harness, fixture.id.gradeManager, fixture.id.grade2023Ws, newIdempotencyKey('gm-correct')),
    body: { targetClassId: fixture.id.classA, version: membership.version, reason: '跨届改学生' },
  })
  assertHttpStatus(correct, 403, 'GM 不得跨届改学生')
})
