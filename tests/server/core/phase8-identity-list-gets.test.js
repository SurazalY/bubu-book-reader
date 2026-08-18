/**
 * T8.3 列表 GET 热修。覆盖 09 §12.2 三条管理端 GET。
 * 不改 T8.3A 守卫目录；只复用其临时库夹具。
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import {
  ACCOUNT_NOT_FOUND_MESSAGE,
  CLASS_NOT_FOUND_MESSAGE,
} from '../../../server/domains/identity/validation.js'
import {
  assertErrorCode,
  assertHttpStatus,
  assertOpaque404,
  errorOf,
  insertPasswordResetCredential,
  requestJson,
  startPhase8App,
  writeHeaders,
} from './phase8-identity-guards/harness.guard.test.js'

function itemsOf(response) {
  const items = response.payload?.data?.items
  assert.ok(Array.isArray(items), `响应必须是 { data: { items } }，实际 ${JSON.stringify(response.payload)?.slice(0, 400)}`)
  return items
}

function secretKeyHits(value) {
  const hits = []
  const walk = (node, path) => {
    if (node == null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${path}[${index}]`))
      return
    }
    for (const [key, child] of Object.entries(node)) {
      if (/^(secretHash|secret_hash|rawToken|raw_token|hash)$/i.test(key)) {
        hits.push(`${path}.${key}`)
      }
      walk(child, `${path}.${key}`)
    }
  }
  walk(value, 'payload')
  return hits
}

function assertNoSecrets(response, secrets, detail) {
  const keys = secretKeyHits(response.payload)
  assert.deepEqual(keys, [], `${detail}: 列表不得含 hash/rawToken 键 ${keys.join(', ')}`)
  const text = JSON.stringify(response.payload)
  for (const secret of secrets.filter(Boolean)) {
    assert.equal(text.includes(secret), false, `${detail}: 列表不得回显秘密片段`)
  }
}

test('GET /classes/:classId/enrollment-requests：本班允许、越 scope 403、跨组织 404', async (t) => {
  const { fixture, module, baseUrl, cookieFor } = await startPhase8App(t)
  const teacher = cookieFor(fixture.id.classTeacher)
  const student = module.database
    .prepare('SELECT display_name, account_code FROM users WHERE id = ?')
    .get(fixture.id.pendingStudent)

  const allow = await requestJson(baseUrl, `/classes/${fixture.id.classA}/enrollment-requests`, {
    headers: writeHeaders({ cookie: teacher.header, workspaceId: fixture.id.classAWs }),
  })
  assertHttpStatus(allow, 200, '本班入班申请列表允许')
  const items = itemsOf(allow)
  assert.equal(items.length, 1, '默认只列 pending')
  const item = items[0]
  assert.equal(item.id, fixture.pendingEnrollment.id)
  assert.equal(item.status, 'pending')
  assert.equal(item.version, 1)
  assert.equal(typeof item.requestedAt, 'string')
  assert.equal(item.class.id, fixture.id.classA)
  assert.equal(item.student.id, fixture.id.pendingStudent)
  assert.equal(item.student.displayName, student.display_name)
  assert.equal(item.student.avatarSeed, student.account_code)
  assert.equal(item.student.accountCodeSuffix, String(student.account_code).slice(-4))
  assert.equal(Object.hasOwn(item.student, 'accountCode'), false, '审批只展示尾 4 位，不得另给 accountCode 字段')
  assertNoSecrets(allow, [], 'enrollment allow')

  const over = await requestJson(baseUrl, `/classes/${fixture.id.classB}/enrollment-requests`, {
    headers: writeHeaders({ cookie: teacher.header, workspaceId: fixture.id.classAWs }),
  })
  assertHttpStatus(over, 403, '同组织列他班必须 403')
  assertErrorCode(over, 'PERMISSION_DENIED', '同组织列他班')

  const foreign = await requestJson(baseUrl, `/classes/${fixture.id.otherClass}/enrollment-requests`, {
    headers: writeHeaders({ cookie: teacher.header, workspaceId: fixture.id.classAWs }),
  })
  const missing = await requestJson(baseUrl, `/classes/${randomUUID()}/enrollment-requests`, {
    headers: writeHeaders({ cookie: teacher.header, workspaceId: fixture.id.classAWs }),
  })
  assertOpaque404(foreign, missing, 'enrollment list')
  assert.equal(errorOf(foreign).message, CLASS_NOT_FOUND_MESSAGE)
})

test('GET /registration-credentials：校长允许、教师越 scope 403、不回显 hash/rawToken', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const admin = cookieFor(fixture.id.schoolAdmin)
  const teacher = cookieFor(fixture.id.classTeacher)

  const missingRole = await requestJson(baseUrl, '/registration-credentials', {
    headers: writeHeaders({ cookie: admin.header, workspaceId: fixture.id.schoolAWs }),
  })
  assertHttpStatus(missingRole, 400, 'expectedRole 必填')
  assertErrorCode(missingRole, 'VALIDATION_FAILED', 'expectedRole 必填')

  const allow = await requestJson(baseUrl, '/registration-credentials?expectedRole=student', {
    headers: writeHeaders({ cookie: admin.header, workspaceId: fixture.id.schoolAWs }),
  })
  assertHttpStatus(allow, 200, '校长列学生凭据允许')
  const items = itemsOf(allow)
  assert.ok(
    items.some((row) => row.id === fixture.studentRegister.id),
    '本校学生凭据必须出现',
  )
  assert.equal(
    items.some((row) => row.id === fixture.studentRegisterB.id),
    false,
    '外校凭据不得出现',
  )
  assert.ok(items.every((row) => row.expectedRole === 'student'))
  const listed = items.find((row) => row.id === fixture.studentRegister.id)
  assert.equal(listed.status, 'active')
  assert.equal(listed.successfulUseCount, 0)
  assert.equal(listed.maxUses, null)
  assertNoSecrets(allow, [fixture.studentRegister.rawToken, fixture.studentRegister.secretHash], 'registration allow')

  const over = await requestJson(baseUrl, '/registration-credentials?expectedRole=student', {
    headers: writeHeaders({ cookie: teacher.header, workspaceId: fixture.id.classAWs }),
  })
  assertHttpStatus(over, 403, '教师不得列注册凭据')
  assertErrorCode(over, 'PERMISSION_DENIED', '教师列注册凭据')
})

test('GET /users/:userId/password-reset-credentials：本班允许、越 scope 403、跨组织 404', async (t) => {
  const { fixture, module, baseUrl, cookieFor } = await startPhase8App(t)
  const teacher = cookieFor(fixture.id.classTeacher)
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
  const ownReset = insertPasswordResetCredential(module.database, {
    organizationId: fixture.id.schoolA,
    targetUserId: fixture.id.enrolledStudent,
    expiresAt,
    createdByUserId: fixture.id.classTeacher,
    createdWorkspaceId: fixture.id.classAWs,
  })
  insertPasswordResetCredential(module.database, {
    organizationId: fixture.id.schoolB,
    targetUserId: fixture.id.otherStudent,
    expiresAt,
    createdByUserId: fixture.id.otherAdmin,
    createdWorkspaceId: fixture.id.schoolBWs,
  })

  const allow = await requestJson(
    baseUrl,
    `/users/${fixture.id.enrolledStudent}/password-reset-credentials`,
    { headers: writeHeaders({ cookie: teacher.header, workspaceId: fixture.id.classAWs }) },
  )
  assertHttpStatus(allow, 200, '教师列本班学生重置凭据允许')
  const items = itemsOf(allow)
  assert.equal(items.length, 1)
  assert.equal(items[0].id, ownReset.id)
  assert.equal(items[0].status, 'active')
  assert.equal(items[0].expiresAt, expiresAt)
  assert.equal(items[0].createdByUserId, fixture.id.classTeacher)
  assertNoSecrets(allow, [ownReset.rawToken, ownReset.secretHash], 'password-reset allow')

  const over = await requestJson(baseUrl, `/users/${fixture.id.classBStudent}/password-reset-credentials`, {
    headers: writeHeaders({ cookie: teacher.header, workspaceId: fixture.id.classAWs }),
  })
  assertHttpStatus(over, 403, '教师不得列他班学生重置凭据')
  assertErrorCode(over, 'PERMISSION_DENIED', '教师列他班重置凭据')

  const foreign = await requestJson(baseUrl, `/users/${fixture.id.otherStudent}/password-reset-credentials`, {
    headers: writeHeaders({ cookie: teacher.header, workspaceId: fixture.id.classAWs }),
  })
  const missing = await requestJson(baseUrl, `/users/${randomUUID()}/password-reset-credentials`, {
    headers: writeHeaders({ cookie: teacher.header, workspaceId: fixture.id.classAWs }),
  })
  assertOpaque404(foreign, missing, 'password-reset list')
  assert.equal(errorOf(foreign).message, ACCOUNT_NOT_FOUND_MESSAGE)
})
