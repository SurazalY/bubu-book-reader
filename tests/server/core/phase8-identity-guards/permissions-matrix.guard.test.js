import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { normalizeRoleCode } from '../../../../server/domains/identity/permissions.js'

import {
  IDENTITY_PERMISSIONS_PATH,
  assertHttpStatus,
  assertOpaque404,
  classScopeGrant,
  gradeScopeGrant,
  newIdempotencyKey,
  platformScopeGrant,
  readSource,
  requestJson,
  roleAllows,
  schoolGradeGrant,
  schoolScopeGrant,
  startPhase8App,
  writeHeaders,
} from './harness.guard.test.js'

const ORG = 'org-matrix'
const CLASS_A = 'class-a'
const GRADE = 'primary:2023'

test('I. roleActions：teacher 有 shelf 无 catalog；行政无 shelf/catalog；platform 有 catalog 无 shelf', () => {
  const source = readSource(IDENTITY_PERMISSIONS_PATH)
  assert.equal(roleAllows('teacher', 'book.shelf.read', classScopeGrant(ORG, CLASS_A)), true)
  assert.equal(roleAllows('teacher', 'book.shelf.grant', classScopeGrant(ORG, CLASS_A)), true)
  assert.equal(roleAllows('teacher', 'book.shelf.revoke', classScopeGrant(ORG, CLASS_A)), true)
  assert.equal(roleAllows('teacher', 'book.catalog.import', classScopeGrant(ORG, CLASS_A)), false)
  assert.equal(roleAllows('teacher', 'book.catalog.publish', classScopeGrant(ORG, CLASS_A)), false)
  assert.equal(roleAllows('teacher', 'book.catalog.unpublish', classScopeGrant(ORG, CLASS_A)), false)
  assert.equal(roleAllows('teacher', 'book.catalog.archive', classScopeGrant(ORG, CLASS_A)), false)

  for (const role of ['school_admin', 'grade_manager']) {
    const grant = role === 'school_admin' ? schoolScopeGrant(ORG) : gradeScopeGrant(ORG, GRADE)
    assert.equal(roleAllows(role, 'book.shelf.grant', grant), false, `${role} 不得有 shelf`)
    assert.equal(roleAllows(role, 'book.catalog.publish', grant), false, `${role} 不得有 catalog`)
  }

  const platform = platformScopeGrant(ORG)
  assert.equal(roleAllows('platform_ops', 'book.catalog.import', platform), true)
  assert.equal(roleAllows('platform_ops', 'book.catalog.publish', platform), true)
  assert.equal(roleAllows('platform_ops', 'book.catalog.unpublish', platform), true)
  assert.equal(roleAllows('platform_ops', 'book.catalog.archive', platform), true)
  assert.equal(roleAllows('platform_ops', 'book.shelf.grant', platform), false)

  for (const role of ['teacher', 'grade_manager', 'school_admin']) {
    assert.equal(
      new RegExp(`${role}:\\s*\\[[\\s\\S]*?'book\\.publish'`).test(source)
        && source.slice(source.indexOf(`${role}:`)).includes("'book.publish'"),
      false,
      `${role} 不得再拥有 book.publish`,
    )
    assert.equal(roleAllows(role, 'book.publish', schoolScopeGrant(ORG)), false, `${role} book.publish`)
    assert.equal(roleAllows(role, 'book.import', schoolScopeGrant(ORG)), false, `${role} book.import`)
    assert.equal(roleAllows(role, 'book.archive', schoolScopeGrant(ORG)), false, `${role} book.archive`)
  }
})

test('I. 废止 teacher.affiliation.approve：无 action', () => {
  const source = readSource(IDENTITY_PERMISSIONS_PATH)
  assert.equal(source.includes('teacher.affiliation.approve'), false)
  assert.equal(roleAllows('teacher', 'teacher.affiliation.approve', classScopeGrant(ORG, CLASS_A)), false)
  assert.equal(roleAllows('school_admin', 'teacher.affiliation.approve', schoolScopeGrant(ORG)), false)
  assert.equal(normalizeRoleCode('teacher'), 'teacher')
})

test('I. teacher.affiliation.join_self / leave_self：允许 + 同组织越 scope 拒绝 + 跨组织 404', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const vTeacher = cookieFor(fixture.id.zeroWsTeacher)
  const allow = await requestJson(baseUrl, `/teacher/classes/${fixture.id.classA}`, {
    method: 'PUT',
    headers: writeHeaders({ cookie: vTeacher.header, key: newIdempotencyKey('m-join') }),
    body: {},
  })
  assertHttpStatus(allow, 200, 'join_self 允许')

  const over = await requestJson(baseUrl, `/teacher/classes/${fixture.id.classGraduated}`, {
    method: 'PUT',
    headers: writeHeaders({ cookie: vTeacher.header, key: newIdempotencyKey('m-join-over') }),
    body: {},
  })
  assert.ok([403, 409].includes(over.status), '同组织毕业班必须拒绝 join')

  const foreign = await requestJson(baseUrl, `/teacher/classes/${fixture.id.otherClass}`, {
    method: 'PUT',
    headers: writeHeaders({ cookie: vTeacher.header, key: newIdempotencyKey('m-join-foreign') }),
    body: {},
  })
  const missing = await requestJson(baseUrl, `/teacher/classes/${randomUUID()}`, {
    method: 'PUT',
    headers: writeHeaders({ cookie: vTeacher.header, key: newIdempotencyKey('m-join-missing') }),
    body: {},
  })
  assertOpaque404(foreign, missing, 'join_self')

  const leave = await requestJson(baseUrl, `/teacher/classes/${fixture.id.classA}`, {
    method: 'DELETE',
    headers: writeHeaders({ cookie: vTeacher.header, key: newIdempotencyKey('m-leave') }),
  })
  assertHttpStatus(leave, 200, 'leave_self 允许')
})

test('I. teacher.affiliation.force_assign / force_remove：允许 + 越 scope 403 + 跨组织 404', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const admin = cookieFor(fixture.id.schoolAdmin)
  const gm = cookieFor(fixture.id.gradeManager)
  const allow = await requestJson(baseUrl, `/classes/${fixture.id.classA}/teachers/${fixture.id.zeroWsTeacher}`, {
    method: 'PUT',
    headers: writeHeaders({
      cookie: admin.header,
      workspaceId: fixture.id.schoolAWs,
      key: newIdempotencyKey('m-force'),
    }),
    body: {},
  })
  assertHttpStatus(allow, 200, 'force_assign 允许')

  const over = await requestJson(baseUrl, `/classes/${fixture.id.classB}/teachers/${fixture.id.zeroWsTeacher}`, {
    method: 'PUT',
    headers: writeHeaders({
      cookie: gm.header,
      workspaceId: fixture.id.grade2023Ws,
      key: newIdempotencyKey('m-force-over'),
    }),
    body: {},
  })
  assertHttpStatus(over, 403, 'force_assign 跨届')

  const foreign = await requestJson(baseUrl, `/classes/${fixture.id.otherClass}/teachers/${fixture.id.zeroWsTeacher}`, {
    method: 'PUT',
    headers: writeHeaders({
      cookie: admin.header,
      workspaceId: fixture.id.schoolAWs,
      key: newIdempotencyKey('m-force-foreign'),
    }),
    body: {},
  })
  const missing = await requestJson(baseUrl, `/classes/${randomUUID()}/teachers/${fixture.id.zeroWsTeacher}`, {
    method: 'PUT',
    headers: writeHeaders({
      cookie: admin.header,
      workspaceId: fixture.id.schoolAWs,
      key: newIdempotencyKey('m-force-missing'),
    }),
    body: {},
  })
  assertOpaque404(foreign, missing, 'force_assign')

  const remove = await requestJson(baseUrl, `/classes/${fixture.id.classA}/teachers/${fixture.id.zeroWsTeacher}`, {
    method: 'DELETE',
    headers: writeHeaders({
      cookie: admin.header,
      workspaceId: fixture.id.schoolAWs,
      key: newIdempotencyKey('m-force-remove'),
    }),
  })
  assertHttpStatus(remove, 200, 'force_remove 允许')
})

test('I. student.enrollment.review：允许 + 越 scope 403 + 跨组织 404', async (t) => {
  const { fixture, baseUrl, cookieFor, module } = await startPhase8App(t)
  const allow = await requestJson(baseUrl, `/enrollment-requests/${fixture.pendingEnrollment.id}/approve`, {
    method: 'POST',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.classTeacher).header,
      workspaceId: fixture.id.classAWs,
      key: newIdempotencyKey('m-review'),
      ifMatch: 1,
    }),
    body: { version: 1 },
  })
  assertHttpStatus(allow, 200, '本班审批允许')

  const sameOrgOtherClass = randomUUID()
  module.database
    .prepare(
      `INSERT INTO student_enrollment_requests (
        id, organization_id, student_user_id, class_id, status, requested_at, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, 1)`,
    )
    .run(
      sameOrgOtherClass,
      fixture.id.schoolA,
      fixture.id.unverifiedStaff,
      fixture.id.classB,
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
    )
  const over = await requestJson(baseUrl, `/enrollment-requests/${sameOrgOtherClass}/approve`, {
    method: 'POST',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.classTeacher).header,
      workspaceId: fixture.id.classAWs,
      key: newIdempotencyKey('m-review-over'),
      ifMatch: 1,
    }),
    body: { version: 1 },
  })
  assertHttpStatus(over, 403, '同组织审别班必须 403')

  const foreignId = randomUUID()
  module.database
    .prepare(
      `INSERT INTO student_enrollment_requests (
        id, organization_id, student_user_id, class_id, status, requested_at, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, 1)`,
    )
    .run(
      foreignId,
      fixture.id.schoolB,
      fixture.id.otherStudent,
      fixture.id.otherClass,
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
    )
  const foreign = await requestJson(baseUrl, `/enrollment-requests/${foreignId}/approve`, {
    method: 'POST',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.classTeacher).header,
      workspaceId: fixture.id.classAWs,
      key: newIdempotencyKey('m-review-foreign'),
      ifMatch: 1,
    }),
    body: { version: 1 },
  })
  const missing = await requestJson(baseUrl, `/enrollment-requests/${randomUUID()}/approve`, {
    method: 'POST',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.classTeacher).header,
      workspaceId: fixture.id.classAWs,
      key: newIdempotencyKey('m-review-missing'),
      ifMatch: 1,
    }),
    body: { version: 1 },
  })
  assertOpaque404(foreign, missing, 'enrollment.review')
})

test('I. 10.2 写动作在 roleActions 中的允许/拒绝抽样', () => {
  const school = schoolScopeGrant(ORG)
  const schoolGrade = schoolGradeGrant(ORG, GRADE)
  const grade = gradeScopeGrant(ORG, GRADE)
  const klass = classScopeGrant(ORG, CLASS_A)

  assert.equal(roleAllows('school_admin', 'class.create', schoolGrade), true, '校长 class.create')
  assert.equal(roleAllows('grade_manager', 'class.create', grade), true, '年级主任 class.create')
  assert.equal(roleAllows('teacher', 'class.create', klass), false, '教师不得 class.create')

  assert.equal(roleAllows('school_admin', 'teacher.affiliation.force_assign', school), true)
  assert.equal(roleAllows('grade_manager', 'teacher.affiliation.force_assign', grade), true)
  assert.equal(roleAllows('teacher', 'teacher.affiliation.force_assign', klass), false)
  assert.equal(roleAllows('school_admin', 'teacher.affiliation.force_remove', school), true)
  assert.equal(roleAllows('teacher', 'teacher.affiliation.force_remove', klass), false)

  assert.equal(roleAllows('teacher', 'student.enrollment.review', klass), true)
  assert.equal(roleAllows('school_admin', 'student.enrollment.review', school), true)
  assert.equal(roleAllows('teacher', 'student.affiliation.correct', klass), false)

  assert.equal(roleAllows('school_admin', 'registration.student.issue', school), true)
  assert.equal(roleAllows('grade_manager', 'registration.student.issue', grade), true)
  assert.equal(roleAllows('teacher', 'registration.student.issue', klass), false)
  assert.equal(roleAllows('school_admin', 'registration.teacher.issue', school), true)
  assert.equal(roleAllows('teacher', 'registration.teacher.issue', klass), false)

  assert.equal(roleAllows('teacher', 'password_reset.student.issue', klass), true)
  assert.equal(roleAllows('grade_manager', 'password_reset.student.issue', grade), true)
  assert.equal(roleAllows('school_admin', 'password_reset.teacher.issue', school), true)
  assert.equal(roleAllows('teacher', 'password_reset.teacher.issue', klass), false)
})

test('I. registration.student.issue / teacher.issue：允许 + 越 scope 403 + 跨组织 404', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const admin = cookieFor(fixture.id.schoolAdmin)
  const teacher = cookieFor(fixture.id.classTeacher)
  const allowStudent = await requestJson(baseUrl, '/registration-credentials', {
    method: 'POST',
    headers: writeHeaders({
      cookie: admin.header,
      workspaceId: fixture.id.schoolAWs,
      key: newIdempotencyKey('m-reg-student'),
    }),
    body: { expectedRole: 'student' },
  })
  assertHttpStatus(allowStudent, 201, '校长签发学生凭据')

  const teacherIssueStudent = await requestJson(baseUrl, '/registration-credentials', {
    method: 'POST',
    headers: writeHeaders({
      cookie: teacher.header,
      workspaceId: fixture.id.classAWs,
      key: newIdempotencyKey('m-reg-teacher-over'),
    }),
    body: { expectedRole: 'student' },
  })
  assertHttpStatus(teacherIssueStudent, 403, '教师不得签发学生凭据')

  const allowTeacher = await requestJson(baseUrl, '/registration-credentials', {
    method: 'POST',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.gradeManager).header,
      workspaceId: fixture.id.grade2023Ws,
      key: newIdempotencyKey('m-reg-teacher'),
    }),
    body: { expectedRole: 'teacher' },
  })
  assertHttpStatus(allowTeacher, 201, '年级主任签发教师凭据（school 例外）')

  const foreign = await requestJson(baseUrl, `/registration-credentials/${fixture.studentRegisterB.id}/revoke`, {
    method: 'POST',
    headers: writeHeaders({
      cookie: admin.header,
      workspaceId: fixture.id.schoolAWs,
      key: newIdempotencyKey('m-reg-foreign'),
    }),
    body: { version: 1, reason: '跨组织撤销' },
  })
  const missing = await requestJson(baseUrl, `/registration-credentials/${randomUUID()}/revoke`, {
    method: 'POST',
    headers: writeHeaders({
      cookie: admin.header,
      workspaceId: fixture.id.schoolAWs,
      key: newIdempotencyKey('m-reg-missing'),
    }),
    body: { version: 1, reason: '不存在撤销' },
  })
  assertOpaque404(foreign, missing, 'registration revoke')
})

test('I. password_reset.student.issue / teacher.issue：允许 + 越 scope 403 + 跨组织 404', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const teacher = cookieFor(fixture.id.classTeacher)
  const gm = cookieFor(fixture.id.gradeManager)
  const allowStudent = await requestJson(baseUrl, `/users/${fixture.id.enrolledStudent}/password-reset-credentials`, {
    method: 'POST',
    headers: writeHeaders({
      cookie: teacher.header,
      workspaceId: fixture.id.classAWs,
      key: newIdempotencyKey('m-reset-student'),
    }),
    body: {},
  })
  assertHttpStatus(allowStudent, 201, '教师重置本班学生')

  const over = await requestJson(baseUrl, `/users/${fixture.id.classBStudent}/password-reset-credentials`, {
    method: 'POST',
    headers: writeHeaders({
      cookie: teacher.header,
      workspaceId: fixture.id.classAWs,
      key: newIdempotencyKey('m-reset-over'),
    }),
    body: {},
  })
  assertHttpStatus(over, 403, '教师不得重置他班学生')

  const allowTeacher = await requestJson(baseUrl, `/users/${fixture.id.classTeacher}/password-reset-credentials`, {
    method: 'POST',
    headers: writeHeaders({
      cookie: gm.header,
      workspaceId: fixture.id.grade2023Ws,
      key: newIdempotencyKey('m-reset-teacher'),
    }),
    body: {},
  })
  assertHttpStatus(allowTeacher, 201, '年级主任重置本校教师')

  const foreign = await requestJson(baseUrl, `/users/${fixture.id.otherStudent}/password-reset-credentials`, {
    method: 'POST',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.schoolAdmin).header,
      workspaceId: fixture.id.schoolAWs,
      key: newIdempotencyKey('m-reset-foreign'),
    }),
    body: {},
  })
  const missing = await requestJson(baseUrl, `/users/${randomUUID()}/password-reset-credentials`, {
    method: 'POST',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.schoolAdmin).header,
      workspaceId: fixture.id.schoolAWs,
      key: newIdempotencyKey('m-reset-missing'),
    }),
    body: {},
  })
  assertOpaque404(foreign, missing, 'password_reset.issue')
})

test('I. class.create：允许 + 越 scope 403 + 跨组织 404', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const allow = await requestJson(baseUrl, '/classes', {
    method: 'POST',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.schoolAdmin).header,
      workspaceId: fixture.id.schoolAWs,
      key: newIdempotencyKey('m-class-create'),
    }),
    body: { name: '矩阵班', stage: 'primary', entryYear: 2023, classNumber: 11 },
  })
  assertHttpStatus(allow, 201, '校长建班')
  assert.equal(allow.payload.data.gradeId, 'primary:2023')

  const over = await requestJson(baseUrl, '/classes', {
    method: 'POST',
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.gradeManager).header,
      workspaceId: fixture.id.grade2023Ws,
      key: newIdempotencyKey('m-class-over'),
    }),
    body: { name: '跨届矩阵班', stage: 'primary', entryYear: 2024, classNumber: 11 },
  })
  assertHttpStatus(over, 403, '年级主任跨届建班')

  const foreign = await requestJson(baseUrl, `/classes/${fixture.id.otherClass}`, {
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.schoolAdmin).header,
      workspaceId: fixture.id.schoolAWs,
    }),
  })
  const missing = await requestJson(baseUrl, `/classes/${randomUUID()}`, {
    headers: writeHeaders({
      cookie: cookieFor(fixture.id.schoolAdmin).header,
      workspaceId: fixture.id.schoolAWs,
    }),
  })
  assertOpaque404(foreign, missing, 'class.create 关联读取')
})

test('I. 行政角色指派：platform 指派校长 / 校长指派年级主任；越权 403；跨组织 404', async (t) => {
  const { fixture, baseUrl, cookieFor } = await startPhase8App(t)
  const operator = cookieFor(fixture.id.operator)
  const admin = cookieFor(fixture.id.schoolAdmin)
  const teacher = cookieFor(fixture.id.classTeacher)

  const assignPrincipal = await requestJson(
    baseUrl,
    `/organizations/${fixture.id.schoolA}/school-admins/${fixture.id.zeroWsTeacher}`,
    {
      method: 'PUT',
      headers: writeHeaders({
        cookie: operator.header,
        workspaceId: fixture.id.platformAWs,
        key: newIdempotencyKey('m-assign-admin'),
      }),
      body: { organizationId: fixture.id.schoolA },
    },
  )
  assertHttpStatus(assignPrincipal, 200, 'platform 指派校长')

  const schoolAssignsPrincipal = await requestJson(
    baseUrl,
    `/organizations/${fixture.id.schoolA}/school-admins/${fixture.id.classBTeacher}`,
    {
      method: 'PUT',
      headers: writeHeaders({
        cookie: admin.header,
        workspaceId: fixture.id.schoolAWs,
        key: newIdempotencyKey('m-admin-self'),
      }),
      body: { organizationId: fixture.id.schoolA },
    },
  )
  assertHttpStatus(schoolAssignsPrincipal, 403, '校长不得指派校长')

  const foreignAdmin = await requestJson(
    baseUrl,
    `/organizations/${fixture.id.schoolB}/school-admins/${fixture.id.otherTeacher}`,
    {
      method: 'PUT',
      headers: writeHeaders({
        cookie: operator.header,
        workspaceId: fixture.id.platformAWs,
        key: newIdempotencyKey('m-admin-foreign'),
      }),
      body: { organizationId: fixture.id.schoolB },
    },
  )
  const missingAdmin = await requestJson(
    baseUrl,
    `/organizations/${randomUUID()}/school-admins/${fixture.id.zeroWsTeacher}`,
    {
      method: 'PUT',
      headers: writeHeaders({
        cookie: operator.header,
        workspaceId: fixture.id.platformAWs,
        key: newIdempotencyKey('m-admin-missing'),
      }),
      body: {},
    },
  )
  assertOpaque404(foreignAdmin, missingAdmin, 'school_admin.assignment')

  const assignGm = await requestJson(baseUrl, `/grade-cohorts/primary:2024/managers/${fixture.id.zeroWsTeacher}`, {
    method: 'PUT',
    headers: writeHeaders({
      cookie: admin.header,
      workspaceId: fixture.id.schoolAWs,
      key: newIdempotencyKey('m-assign-gm'),
    }),
    body: {},
  })
  assertHttpStatus(assignGm, 200, '校长指派年级主任')

  const teacherAssignsGm = await requestJson(baseUrl, `/grade-cohorts/primary:2023/managers/${fixture.id.classBTeacher}`, {
    method: 'PUT',
    headers: writeHeaders({
      cookie: teacher.header,
      workspaceId: fixture.id.classAWs,
      key: newIdempotencyKey('m-gm-teacher'),
    }),
    body: {},
  })
  assertHttpStatus(teacherAssignsGm, 403, '教师不得指派年级主任')
})
