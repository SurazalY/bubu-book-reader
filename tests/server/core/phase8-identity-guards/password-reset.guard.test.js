import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import {
  assertAuditOmitsSecrets,
  assertHttpStatus,
  assertOpaque404,
  errorOf,
  insertPasswordResetCredential,
  newIdempotencyKey,
  requestJson,
  startPhase8App,
  writeHeaders,
} from './harness.guard.test.js'

function issueReset(baseUrl, cookie, workspaceId, targetUserId, key) {
  return requestJson(baseUrl, `/users/${targetUserId}/password-reset-credentials`, {
    method: 'POST',
    headers: writeHeaders({ cookie, workspaceId, key: key ?? newIdempotencyKey('reset-issue') }),
    body: {},
  })
}

test('G. 密码重置矩阵：教师对本班学生允许，对他班学生/本校教师拒绝', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const teacher = cookieFor(fixture.id.classTeacher)
  const allow = await issueReset(baseUrl, teacher.header, fixture.id.classAWs, fixture.id.enrolledStudent)
  assertHttpStatus(allow, 201, '教师重置本班学生')
  assert.ok(allow.payload.data.rawToken, '签发必须一次性返回 rawToken')

  const otherClass = await issueReset(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.classBStudent,
    newIdempotencyKey('reset-other-class'),
  )
  assertHttpStatus(otherClass, 403, '教师不得重置他班学生')

  const teacherTarget = await issueReset(
    baseUrl,
    teacher.header,
    fixture.id.classAWs,
    fixture.id.classBTeacher,
    newIdempotencyKey('reset-teacher'),
  )
  assertHttpStatus(teacherTarget, 403, '教师不得重置教师')
})

test('G. 密码重置矩阵：年级主任对本届学生+本校教师允许，跨届学生拒绝', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const gm = cookieFor(fixture.id.gradeManager)
  const student = await issueReset(baseUrl, gm.header, fixture.id.grade2023Ws, fixture.id.enrolledStudent)
  assertHttpStatus(student, 201, 'GM 重置本届学生')
  const teacher = await issueReset(
    baseUrl,
    gm.header,
    fixture.id.grade2023Ws,
    fixture.id.classTeacher,
    newIdempotencyKey('gm-reset-teacher'),
  )
  assertHttpStatus(teacher, 201, 'GM 重置本校教师（school 例外）')
  const otherGrade = await issueReset(
    baseUrl,
    gm.header,
    fixture.id.grade2023Ws,
    fixture.id.classBStudent,
    newIdempotencyKey('gm-reset-cross'),
  )
  assertHttpStatus(otherGrade, 403, 'GM 不得重置跨届学生')
})

test('G. 密码重置矩阵：校长全校允许；platform 对校长允许；跨组织 404', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const admin = cookieFor(fixture.id.schoolAdmin)
  const operator = cookieFor(fixture.id.operator)
  const schoolStudent = await issueReset(baseUrl, admin.header, fixture.id.schoolAWs, fixture.id.classBStudent)
  assertHttpStatus(schoolStudent, 201, '校长重置全校学生')
  const schoolTeacher = await issueReset(
    baseUrl,
    admin.header,
    fixture.id.schoolAWs,
    fixture.id.classBTeacher,
    newIdempotencyKey('admin-reset-teacher'),
  )
  assertHttpStatus(schoolTeacher, 201, '校长重置本校教师')
  const principal = await issueReset(
    baseUrl,
    operator.header,
    fixture.id.platformAWs,
    fixture.id.schoolAdmin,
    newIdempotencyKey('ops-reset-admin'),
  )
  assertHttpStatus(principal, 201, 'platform 重置校长')

  const foreign = await issueReset(
    baseUrl,
    admin.header,
    fixture.id.schoolAWs,
    fixture.id.otherStudent,
    newIdempotencyKey('reset-foreign'),
  )
  const missing = await issueReset(
    baseUrl,
    admin.header,
    fixture.id.schoolAWs,
    randomUUID(),
    newIdempotencyKey('reset-missing'),
  )
  assertOpaque404(foreign, missing, '校长重置跨组织/不存在')
})

test('G. 重置码 30 分钟、撤销、单次；失败密码不消费；旧 session 全失效', async (t) => {
  const { fixture, baseUrl, module, cookieFor, sessionSecret } = await startPhase8App(t)
  const now = Date.now()
  const active = insertPasswordResetCredential(module.database, {
    organizationId: fixture.id.schoolA,
    targetUserId: fixture.id.enrolledStudent,
    expiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
    createdByUserId: fixture.id.classTeacher,
    createdWorkspaceId: fixture.id.classAWs,
  })
  const expired = insertPasswordResetCredential(module.database, {
    organizationId: fixture.id.schoolA,
    targetUserId: fixture.id.enrolledStudent,
    expiresAt: new Date(now - 1000).toISOString(),
    createdByUserId: fixture.id.classTeacher,
    createdWorkspaceId: fixture.id.classAWs,
  })
  const revoked = insertPasswordResetCredential(module.database, {
    organizationId: fixture.id.schoolA,
    targetUserId: fixture.id.enrolledStudent,
    expiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
    revokedAt: new Date(now).toISOString(),
    revokedBy: fixture.id.classTeacher,
    revokedReason: 'guard-revoke',
    createdByUserId: fixture.id.classTeacher,
    createdWorkspaceId: fixture.id.classAWs,
  })

  const expiredRes = await requestJson(baseUrl, `/password-resets/${expired.rawToken}/consume`, {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey('consume-expired') },
    body: { newPassword: `${fixture.password}-x` },
  })
  const revokedRes = await requestJson(baseUrl, `/password-resets/${revoked.rawToken}/consume`, {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey('consume-revoked') },
    body: { newPassword: `${fixture.password}-x` },
  })
  const missing = await requestJson(baseUrl, `/password-resets/${randomUUID().replace(/-/g, '')}/consume`, {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey('consume-missing') },
    body: { newPassword: `${fixture.password}-x` },
  })
  assertHttpStatus(expiredRes, 404, '过期')
  assertHttpStatus(revokedRes, 404, '撤销')
  assertHttpStatus(missing, 404, '不存在')
  assert.equal(errorOf(expiredRes).code, 'RESOURCE_NOT_FOUND', '过期必须是标准 JSON 404')
  assert.equal(errorOf(revokedRes).code, 'RESOURCE_NOT_FOUND', '撤销必须是标准 JSON 404')
  assert.equal(errorOf(missing).code, 'RESOURCE_NOT_FOUND', '不存在必须是标准 JSON 404')
  assert.equal(errorOf(expiredRes).message, errorOf(missing).message)
  assert.equal(errorOf(revokedRes).message, errorOf(missing).message)
  assert.ok(errorOf(missing).message, '公开重置 404 必须有统一文案')

  const failed = await requestJson(baseUrl, `/password-resets/${active.rawToken}/consume`, {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey('consume-bad-pw') },
    body: { newPassword: '' },
  })
  assertHttpStatus(failed, 400, '失败密码')
  const unused = module.database.prepare('SELECT used_at FROM password_reset_credentials WHERE id = ?').get(active.id)
  assert.equal(unused.used_at, null, '失败密码不得消费 token')

  const firstSession = cookieFor(fixture.id.enrolledStudent)
  const secondSession = cookieFor(fixture.id.enrolledStudent)
  const newPassword = `${fixture.password}-new`
  const consumed = await requestJson(baseUrl, `/password-resets/${active.rawToken}/consume`, {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey('consume-ok') },
    body: { newPassword },
  })
  assertHttpStatus(consumed, 200, '首次消费')
  const replay = await requestJson(baseUrl, `/password-resets/${active.rawToken}/consume`, {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey('consume-replay') },
    body: { newPassword },
  })
  assertHttpStatus(replay, 404, '单次消费后再用统一 404')

  const firstProbe = await requestJson(baseUrl, '/session', { headers: { Cookie: firstSession.header } })
  const secondProbe = await requestJson(baseUrl, '/session', { headers: { Cookie: secondSession.header } })
  assertHttpStatus(firstProbe, 401, '旧 session 1')
  assertHttpStatus(secondProbe, 401, '旧 session 2')
  assert.ok(sessionSecret, 'sessionSecret 仅用于夹具签发，不进审计断言')
})

test('G. 审计不含 token/password/hash', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  const issued = await issueReset(
    baseUrl,
    cookieFor(fixture.id.classTeacher).header,
    fixture.id.classAWs,
    fixture.id.enrolledStudent,
  )
  assertHttpStatus(issued, 201, '签发以便检查审计')
  const rawToken = issued.payload.data.rawToken
  const consumed = await requestJson(baseUrl, `/password-resets/${rawToken}/consume`, {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey('audit-consume') },
    body: { newPassword: `${fixture.password}-z` },
  })
  assert.ok([200, 404].includes(consumed.status), '消费路由必须存在才能验证审计')
  const secretHash = module.database
    .prepare('SELECT secret_hash FROM password_reset_credentials ORDER BY created_at DESC LIMIT 1')
    .get()?.secret_hash
  const passwordHash = module.database
    .prepare('SELECT password_hash FROM credentials WHERE user_id = ?')
    .get(fixture.id.enrolledStudent)?.password_hash
  assertAuditOmitsSecrets(module.database, [rawToken, fixture.password, `${fixture.password}-z`, secretHash, passwordHash])
})
