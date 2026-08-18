import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { normalizeRoleCode } from '../../../../server/domains/identity/permissions.js'

import {
  IDENTITY_INDEX_PATH,
  IDENTITY_PERMISSIONS_PATH,
  assertHttpStatus,
  assertOpaque404,
  extractPermissionActionsForRoute,
  extractPermissionMiddleware,
  newIdempotencyKey,
  readSource,
  requestJson,
  requireLifecycleFn,
  startPhase8App,
  writeHeaders,
} from './harness.guard.test.js'

test('H. POST /classes 必须用 class.create，resourceScope 必须带服务端计算的 gradeId', () => {
  const source = readSource(IDENTITY_INDEX_PATH)
  const { block, actions } = extractPermissionActionsForRoute(source, 'post', '/classes')
  assert.ok(block.length > 0, 'POST /classes 必须仍挂在 identity router')
  assert.ok(
    actions.includes('class.create'),
    `POST /classes 必须授权引号动作 class.create，不得只靠 idempotency scope 字符串命中；实际: ${actions.join(',') || '无 permission middleware'}`,
  )
  assert.equal(actions.includes('class.manage'), false, '禁止继续授权 class.manage')
  const middleware = extractPermissionMiddleware(source, 'class.create')
  assert.ok(middleware.length > 0, '必须存在 class.create 的 permission middleware')
  assert.match(middleware, /gradeId/, 'resourceScope 必须带服务端计算的 gradeId')
  assert.equal(
    /type:\s*['"]school['"]/.test(middleware) && !/gradeId/.test(middleware),
    false,
    '禁止继续提交纯 school 形、无 gradeId 的 resourceScope',
  )
})

test('H. POST /classes body 为 {name,stage,entryYear,classNumber}，服务端生成 gradeId', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  const response = await requestJson(baseUrl, '/classes', {
    method: 'POST',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.schoolAdmin).header,
      workspaceId: fixture.id.schoolAWs,
      key: newIdempotencyKey('class-create'),
    }),
    body: { name: '新一班', stage: 'primary', entryYear: 2023, classNumber: 9 },
  })
  assertHttpStatus(response, 201, '校长建班')
  const created = response.payload.data
  assert.equal(created.gradeId, 'primary:2023', 'gradeId 必须由服务端生成')
  assert.equal(created.stage, 'primary')
  assert.equal(created.entryYear, 2023)
  assert.equal(created.classNumber, 9)
  const row = module.database.prepare('SELECT * FROM classes WHERE id = ?').get(created.id)
  assert.equal(row.grade_id, 'primary:2023')
  assert.equal(row.stage, 'primary')
  assert.equal(row.entry_year, 2023)
  assert.equal(row.class_number, 9)
})

test('H. PATCH 改届别须带 version，并对变更前/后 scope 都校验', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  const version = module.database.prepare('SELECT version FROM classes WHERE id = ?').get(fixture.id.classA).version
  const missingVersion = await requestJson(baseUrl, `/classes/${fixture.id.classA}`, {
    method: 'PATCH',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.schoolAdmin).header,
      workspaceId: fixture.id.schoolAWs,
      key: newIdempotencyKey('class-patch-no-ver'),
    }),
    body: { stage: 'primary', entryYear: 2024, classNumber: 1 },
  })
  assertHttpStatus(missingVersion, 400, '改届别缺 version')

  const gmCross = await requestJson(baseUrl, `/classes/${fixture.id.classA}`, {
    method: 'PATCH',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.gradeManager).header,
      workspaceId: fixture.id.grade2023Ws,
      key: newIdempotencyKey('class-patch-gm'),
      ifMatch: version,
    }),
    body: { stage: 'primary', entryYear: 2024, classNumber: 1, version },
  })
  assertHttpStatus(gmCross, 403, '变更后 scope 超出年级主任届别')
})

test('H. DELETE/restore 软停用 class+workspace，成员与 grants 保留', async (t) => {
  const { fixture, baseUrl, module, cookieFor } = await startPhase8App(t)
  const now = new Date().toISOString()
  module.database
    .prepare(
      `INSERT INTO books (id, organization_id_at_creation, actor_id_at_creation, title, status, created_at, updated_at, version)
       VALUES (?, ?, ?, 'guard-book', 'published', ?, ?, 1)`,
    )
    .run('book-t83a', fixture.id.schoolA, fixture.id.schoolAdmin, now, now)
  module.database
    .prepare(
      `INSERT INTO book_versions (
        id, book_id, organization_id_at_creation, actor_id_at_creation, label, source_format, page_count, created_at, updated_at, version
      ) VALUES (?, 'book-t83a', ?, ?, 'v1', 'text', 1, ?, ?, 1)`,
    )
    .run('ver-t83a', fixture.id.schoolA, fixture.id.schoolAdmin, now, now)
  module.database
    .prepare(
      `INSERT INTO book_access_grants (
        id, book_version_id, grantee_type, grantee_id, organization_id_at_creation, actor_id_at_creation, created_at, updated_at, version
      ) VALUES (?, 'ver-t83a', 'class', ?, ?, ?, ?, ?, 1)`,
    )
    .run('grant-t83a', fixture.id.classA, fixture.id.schoolA, fixture.id.schoolAdmin, now, now)

  const version = module.database.prepare('SELECT version FROM classes WHERE id = ?').get(fixture.id.classA).version
  const membersBefore = module.database
    .prepare('SELECT COUNT(*) AS count FROM class_memberships WHERE class_id = ?')
    .get(fixture.id.classA).count
  const disabled = await requestJson(baseUrl, `/classes/${fixture.id.classA}`, {
    method: 'DELETE',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.schoolAdmin).header,
      workspaceId: fixture.id.schoolAWs,
      key: newIdempotencyKey('class-disable'),
      ifMatch: version,
    }),
    body: { version },
  })
  assertHttpStatus(disabled, 200, '软停用')
  const classRow = module.database.prepare('SELECT status FROM classes WHERE id = ?').get(fixture.id.classA)
  const wsRow = module.database.prepare('SELECT status FROM workspaces WHERE id = ?').get(fixture.id.classAWs)
  assert.equal(classRow.status, 'disabled')
  assert.equal(wsRow.status, 'disabled')
  const membersAfter = module.database
    .prepare('SELECT COUNT(*) AS count FROM class_memberships WHERE class_id = ?')
    .get(fixture.id.classA).count
  const grants = module.database.prepare('SELECT COUNT(*) AS count FROM book_access_grants WHERE id = ?').get('grant-t83a').count
  assert.equal(membersAfter, membersBefore, '成员必须保留')
  assert.equal(grants, 1, 'grants 必须保留')

  const restored = await requestJson(baseUrl, `/classes/${fixture.id.classA}/restore`, {
    method: 'POST',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.schoolAdmin).header,
      workspaceId: fixture.id.schoolAWs,
      key: newIdempotencyKey('class-restore'),
      ifMatch: version + 1,
    }),
    body: { version: version + 1 },
  })
  assertHttpStatus(restored, 200, '恢复')
  assert.equal(module.database.prepare('SELECT status FROM classes WHERE id = ?').get(fixture.id.classA).status, 'active')
  assert.equal(module.database.prepare('SELECT status FROM workspaces WHERE id = ?').get(fixture.id.classAWs).status, 'active')
})

test('H. 学年计算：固定 now 测 9 月 1 日边界、小学 6 / 初高中 3、upcoming/graduated', () => {
  const fn = requireLifecycleFn()
  const beforeSept = '2026-08-31T15:59:59.000Z'
  const onSept = '2026-08-31T16:00:00.000Z'

  const primaryBefore = fn({ stage: 'primary', entryYear: 2023, now: beforeSept })
  assert.equal(primaryBefore.lifecycle, 'active')
  assert.equal(primaryBefore.currentGrade, 3)

  const primaryOnSept = fn({ stage: 'primary', entryYear: 2023, now: onSept })
  assert.equal(primaryOnSept.lifecycle, 'active')
  assert.equal(primaryOnSept.currentGrade, 4)

  const upcomingBefore = fn({ stage: 'primary', entryYear: 2026, now: beforeSept })
  assert.equal(upcomingBefore.lifecycle, 'upcoming')
  assert.equal(upcomingBefore.currentGrade, null)

  const upcomingOnSept = fn({ stage: 'primary', entryYear: 2026, now: onSept })
  assert.equal(upcomingOnSept.lifecycle, 'active')
  assert.equal(upcomingOnSept.currentGrade, 1)

  const primaryMaxBefore = fn({ stage: 'primary', entryYear: 2020, now: beforeSept })
  assert.equal(primaryMaxBefore.lifecycle, 'active')
  assert.equal(primaryMaxBefore.currentGrade, 6)
  const primaryGraduated = fn({ stage: 'primary', entryYear: 2020, now: onSept })
  assert.equal(primaryGraduated.lifecycle, 'graduated')
  assert.equal(primaryGraduated.currentGrade, null)

  const juniorActive = fn({ stage: 'junior', entryYear: 2023, now: beforeSept })
  assert.equal(juniorActive.lifecycle, 'active')
  assert.equal(juniorActive.currentGrade, 3)
  const juniorGraduated = fn({ stage: 'junior', entryYear: 2023, now: onSept })
  assert.equal(juniorGraduated.lifecycle, 'graduated')

  const seniorActive = fn({ stage: 'senior', entryYear: 2023, now: beforeSept })
  assert.equal(seniorActive.lifecycle, 'active')
  assert.equal(seniorActive.currentGrade, 3)
  const seniorGraduated = fn({ stage: 'senior', entryYear: 2023, now: onSept })
  assert.equal(seniorGraduated.lifecycle, 'graduated')
})

test('H. grade_group → grade_manager 别名不得再映射', () => {
  const source = readSource(IDENTITY_PERMISSIONS_PATH)
  assert.equal(normalizeRoleCode('grade_group'), 'grade_group', 'grade_group 不得再映射到 grade_manager')
  assert.equal(
    /grade_group\s*:\s*['"]grade_manager['"]/.test(source),
    false,
    'roleAliases 必须移除 grade_group → grade_manager',
  )
  assert.equal(normalizeRoleCode('class_teacher'), 'teacher')
  assert.equal(normalizeRoleCode('grade_admin'), 'grade_manager')
  assert.equal(normalizeRoleCode('platform_operator'), 'platform_ops')
})

test('H. 教师不得 POST /classes；跨组织 classId 与不存在同码同文案', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const teacherCreate = await requestJson(baseUrl, '/classes', {
    method: 'POST',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.classTeacher).header,
      workspaceId: fixture.id.classAWs,
      key: newIdempotencyKey('teacher-create'),
    }),
    body: { name: '教师建班', stage: 'primary', entryYear: 2023, classNumber: 7 },
  })
  assertHttpStatus(teacherCreate, 403, '教师建班')

  const missing = await requestJson(baseUrl, `/classes/${randomUUID()}`, {
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.schoolAdmin).header,
      workspaceId: fixture.id.schoolAWs,
    }),
  })
  const foreign = await requestJson(baseUrl, `/classes/${fixture.id.otherClass}`, {
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.schoolAdmin).header,
      workspaceId: fixture.id.schoolAWs,
    }),
  })
  assertOpaque404(foreign, missing, 'GET /classes/:classId')
})
