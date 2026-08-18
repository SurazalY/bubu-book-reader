/**
 * T8.3A 共享夹具。本文件只导出助手，不注册 test()，避免被其它守卫 import 时重复挂载。
 * 禁止改业务实现。会话 cookie 用既有 createServerSession，不是第二套鉴权。
 */
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { hashPassword } from '../../../../server/auth/password.js'
import { createServerSession } from '../../../../server/auth/session.js'
import { createIdentityTestApp } from '../../../../server/domains/identity/index.js'
import * as identityIndex from '../../../../server/domains/identity/index.js'
import * as identityService from '../../../../server/domains/identity/service.js'
import * as classScope from '../../../../server/domains/identity/class-scope.js'
import * as permissions from '../../../../server/domains/identity/permissions.js'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(dirname(dirname(dirname(here))))

export const REAL_DATABASE_PATH = join(projectRoot, 'server', 'data', 'readmate.sqlite')
export const IDENTITY_INDEX_PATH = join(projectRoot, 'server', 'domains', 'identity', 'index.js')
export const IDENTITY_SERVICE_PATH = join(projectRoot, 'server', 'domains', 'identity', 'service.js')
export const IDENTITY_PERMISSIONS_PATH = join(projectRoot, 'server', 'domains', 'identity', 'permissions.js')
export const INTEGRATION_ROUTER_PATH = join(projectRoot, 'server', 'http', 'integration-router.js')

export const LOGIN_FAILURE_MESSAGE = '学校、账号或密码错误'
export const ONBOARDING_PATH = '/student/onboarding'
export const SELECT_CLASS_PATH = '/console/select-class'

export function isRealDatabasePath(filename) {
  return String(filename).replace(/\\/g, '/').toLowerCase() === REAL_DATABASE_PATH.replace(/\\/g, '/').toLowerCase()
}

export function readSource(pathname) {
  return readFileSync(pathname, 'utf8')
}

export function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

export function newIdempotencyKey(label) {
  const ascii = String(label ?? 'key')
    .replace(/[^\x20-\x7E]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${ascii || 'key'}-${randomUUID()}`
}

export function extractPermissionActionsForRoute(source, method, path) {
  const block = extractRouteBlock(source, method, path)
  const names = [...block.matchAll(/\brequire[A-Za-z0-9]+\b/g)].map((match) => match[0])
  const actions = []
  for (const name of names) {
    const matched = source.match(
      new RegExp(`const ${name} = createRequirePermissionMiddleware\\(\\s*service,\\s*['"]([^'"]+)['"]`),
    )
    if (matched) {
      actions.push(matched[1])
    }
  }
  return { block, actions }
}

export function extractPermissionMiddleware(source, action) {
  const escaped = String(action).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `createRequirePermissionMiddleware\\(\\s*service,\\s*['"]${escaped}['"][\\s\\S]*?\\n  \\)`,
    'm',
  )
  return source.match(pattern)?.[0] ?? ''
}

export function extractRouteBlock(source, method, path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`router\\.${method}\\(\\s*['\`]${escaped}['\`][\\s\\S]*?\\n  \\)`, 'm')
  return source.match(pattern)?.[0] ?? ''
}

export function getClassLifecycleFn() {
  const candidates = [
    identityIndex.computeClassLifecycle,
    identityIndex.resolveClassLifecycle,
    identityService.computeClassLifecycle,
    identityService.resolveClassLifecycle,
    classScope.computeClassLifecycle,
    classScope.resolveClassLifecycle,
    permissions.computeClassLifecycle,
  ]
  return candidates.find((fn) => typeof fn === 'function') ?? null
}

export function requireLifecycleFn() {
  const fn = getClassLifecycleFn()
  assert.equal(
    typeof fn,
    'function',
    'identity 必须导出 computeClassLifecycle({ stage, entryYear, now })（或 resolveClassLifecycle），禁止依赖机器当前日期',
  )
  return fn
}

function createTemporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-t83a-'))
  return {
    directory,
    filename: join(directory, 'phase8-identity.sqlite'),
  }
}

function removeTemporaryDatabase(database) {
  rmSync(database.directory, { recursive: true, force: true })
}

export function createPhase8Seed() {
  const suffix = randomBytes(4).toString('hex')
  const password = `Pw.${randomBytes(12).toString('base64url')}`
  const passwordHash = hashPassword(password)
  const id = {
    schoolA: randomUUID(),
    schoolB: randomUUID(),
    enrolledStudent: randomUUID(),
    pendingStudent: randomUUID(),
    classBStudent: randomUUID(),
    classTeacher: randomUUID(),
    classBTeacher: randomUUID(),
    zeroWsTeacher: randomUUID(),
    historicalTeacher: randomUUID(),
    unverifiedStaff: randomUUID(),
    gradeManager: randomUUID(),
    schoolAdmin: randomUUID(),
    operator: randomUUID(),
    otherAdmin: randomUUID(),
    otherTeacher: randomUUID(),
    otherStudent: randomUUID(),
    classA: randomUUID(),
    classB: randomUUID(),
    classDisabled: randomUUID(),
    classGraduated: randomUUID(),
    classUpcoming: randomUUID(),
    otherClass: randomUUID(),
    enrolledOwnWs: randomUUID(),
    classBStudentOwnWs: randomUUID(),
    otherStudentOwnWs: randomUUID(),
    classAWs: randomUUID(),
    classBWs: randomUUID(),
    classDisabledWs: randomUUID(),
    classGraduatedWs: randomUUID(),
    classUpcomingWs: randomUUID(),
    otherClassWs: randomUUID(),
    grade2023Ws: randomUUID(),
    grade2024Ws: randomUUID(),
    schoolAWs: randomUUID(),
    schoolBWs: randomUUID(),
    platformAWs: randomUUID(),
  }

  const login = {
    enrolledStudent: `enr${suffix}`,
    pendingStudent: `pnd${suffix}`,
    classBStudent: `stb${suffix}`,
    classTeacher: `tca${suffix}`,
    classBTeacher: `tcb${suffix}`,
    zeroWsTeacher: `tv0${suffix}`,
    historicalTeacher: `thx${suffix}`,
    unverifiedStaff: `stf${suffix}`,
    gradeManager: `gma${suffix}`,
    schoolAdmin: `adm${suffix}`,
    operator: `ops${suffix}`,
    otherAdmin: `adb${suffix}`,
    otherTeacher: `otc${suffix}`,
    otherStudent: `osb${suffix}`,
  }

  const schoolCodeA = `sa${suffix}`
  const schoolCodeB = `sb${suffix}`

  const schoolAUsers = [
    [id.enrolledStudent, login.enrolledStudent, '在班学生'],
    [id.pendingStudent, login.pendingStudent, '待审学生'],
    [id.classBStudent, login.classBStudent, 'B班学生'],
    [id.classTeacher, login.classTeacher, 'A班教师'],
    [id.classBTeacher, login.classBTeacher, 'B班教师'],
    [id.zeroWsTeacher, login.zeroWsTeacher, '零班教师'],
    [id.historicalTeacher, login.historicalTeacher, '历史教师'],
    [id.unverifiedStaff, login.unverifiedStaff, '未验证职员'],
    [id.gradeManager, login.gradeManager, '年级主任'],
    [id.schoolAdmin, login.schoolAdmin, '校长'],
    [id.operator, login.operator, '技术团队'],
  ]

  const schoolBUsers = [
    [id.otherAdmin, login.otherAdmin, '外校校长'],
    [id.otherTeacher, login.otherTeacher, '外校教师'],
    [id.otherStudent, login.otherStudent, '外校学生'],
  ]

  const classA = {
    id: id.classA,
    organizationId: id.schoolA,
    name: `一班-${suffix}`,
    stage: 'primary',
    entryYear: 2023,
    classNumber: 1,
    gradeId: 'primary:2023',
  }
  const classB = {
    id: id.classB,
    organizationId: id.schoolA,
    name: `跨届班-${suffix}`,
    stage: 'primary',
    entryYear: 2024,
    classNumber: 1,
    gradeId: 'primary:2024',
  }

  return {
    suffix,
    password,
    schoolCodeA,
    schoolCodeB,
    login,
    id,
    classA,
    classB,
    seed: {
      organizations: [
        { id: id.schoolA, name: `学校A-${suffix}`, schoolCode: schoolCodeA },
        { id: id.schoolB, name: `学校B-${suffix}`, schoolCode: schoolCodeB },
      ],
      users: [
        ...schoolAUsers.map(([userId, loginName, displayName]) => ({
          id: userId,
          organizationId: id.schoolA,
          username: userId,
          loginName,
          displayName,
        })),
        ...schoolBUsers.map(([userId, loginName, displayName]) => ({
          id: userId,
          organizationId: id.schoolB,
          username: userId,
          loginName,
          displayName,
        })),
      ],
      workspaces: [
        {
          id: id.enrolledOwnWs,
          organizationId: id.schoolA,
          code: 'class-teacher',
          name: `student-own-${suffix}`,
          scopeType: 'own',
          scopeId: id.enrolledStudent,
        },
        {
          id: id.classBStudentOwnWs,
          organizationId: id.schoolA,
          code: 'class-teacher',
          name: `student-b-own-${suffix}`,
          scopeType: 'own',
          scopeId: id.classBStudent,
        },
        {
          id: id.otherStudentOwnWs,
          organizationId: id.schoolB,
          code: 'class-teacher',
          name: `other-student-own-${suffix}`,
          scopeType: 'own',
          scopeId: id.otherStudent,
        },
        {
          id: id.classAWs,
          organizationId: id.schoolA,
          code: 'class-teacher',
          name: `class-a-${suffix}`,
          scopeType: 'class',
          scopeId: id.classA,
        },
        {
          id: id.classBWs,
          organizationId: id.schoolA,
          code: 'class-teacher',
          name: `class-b-${suffix}`,
          scopeType: 'class',
          scopeId: id.classB,
        },
        {
          id: id.classDisabledWs,
          organizationId: id.schoolA,
          code: 'class-teacher',
          name: `class-disabled-${suffix}`,
          scopeType: 'class',
          scopeId: id.classDisabled,
          status: 'disabled',
        },
        {
          id: id.classGraduatedWs,
          organizationId: id.schoolA,
          code: 'class-teacher',
          name: `class-graduated-${suffix}`,
          scopeType: 'class',
          scopeId: id.classGraduated,
        },
        {
          id: id.classUpcomingWs,
          organizationId: id.schoolA,
          code: 'class-teacher',
          name: `class-upcoming-${suffix}`,
          scopeType: 'class',
          scopeId: id.classUpcoming,
        },
        {
          id: id.otherClassWs,
          organizationId: id.schoolB,
          code: 'class-teacher',
          name: `other-class-${suffix}`,
          scopeType: 'class',
          scopeId: id.otherClass,
        },
        {
          id: id.grade2023Ws,
          organizationId: id.schoolA,
          code: 'grade-admin',
          name: `grade-2023-${suffix}`,
          scopeType: 'grade',
          scopeId: 'primary:2023',
        },
        {
          id: id.grade2024Ws,
          organizationId: id.schoolA,
          code: 'grade-admin',
          name: `grade-2024-${suffix}`,
          scopeType: 'grade',
          scopeId: 'primary:2024',
        },
        {
          id: id.schoolAWs,
          organizationId: id.schoolA,
          code: 'school-admin',
          name: `school-a-${suffix}`,
          scopeType: 'school',
          scopeId: id.schoolA,
        },
        {
          id: id.schoolBWs,
          organizationId: id.schoolB,
          code: 'school-admin',
          name: `school-b-${suffix}`,
          scopeType: 'school',
          scopeId: id.schoolB,
        },
        {
          id: id.platformAWs,
          organizationId: id.schoolA,
          code: 'platform-ops',
          name: `platform-a-${suffix}`,
          scopeType: 'platform',
          scopeId: id.schoolA,
        },
      ],
      workspaceMemberships: [
        { id: randomUUID(), userId: id.enrolledStudent, workspaceId: id.enrolledOwnWs },
        { id: randomUUID(), userId: id.enrolledStudent, workspaceId: id.classAWs },
        { id: randomUUID(), userId: id.classBStudent, workspaceId: id.classBStudentOwnWs },
        { id: randomUUID(), userId: id.classBStudent, workspaceId: id.classBWs },
        { id: randomUUID(), userId: id.classTeacher, workspaceId: id.classAWs },
        { id: randomUUID(), userId: id.classBTeacher, workspaceId: id.classBWs },
        {
          id: randomUUID(),
          userId: id.historicalTeacher,
          workspaceId: id.classAWs,
          status: 'disabled',
        },
        { id: randomUUID(), userId: id.gradeManager, workspaceId: id.grade2023Ws },
        { id: randomUUID(), userId: id.schoolAdmin, workspaceId: id.schoolAWs },
        { id: randomUUID(), userId: id.operator, workspaceId: id.platformAWs },
        { id: randomUUID(), userId: id.otherAdmin, workspaceId: id.schoolBWs },
        { id: randomUUID(), userId: id.otherTeacher, workspaceId: id.otherClassWs },
        { id: randomUUID(), userId: id.otherStudent, workspaceId: id.otherStudentOwnWs },
        { id: randomUUID(), userId: id.otherStudent, workspaceId: id.otherClassWs },
      ],
      roleAssignments: [
        {
          id: randomUUID(),
          organizationId: id.schoolA,
          userId: id.enrolledStudent,
          workspaceId: id.enrolledOwnWs,
          roleCode: 'student',
          scopeType: 'own',
          scopeId: id.enrolledStudent,
        },
        {
          id: randomUUID(),
          organizationId: id.schoolA,
          userId: id.enrolledStudent,
          workspaceId: id.classAWs,
          roleCode: 'student',
          scopeType: 'class',
          scopeId: id.classA,
        },
        {
          id: randomUUID(),
          organizationId: id.schoolA,
          userId: id.classBStudent,
          workspaceId: id.classBStudentOwnWs,
          roleCode: 'student',
          scopeType: 'own',
          scopeId: id.classBStudent,
        },
        {
          id: randomUUID(),
          organizationId: id.schoolA,
          userId: id.classBStudent,
          workspaceId: id.classBWs,
          roleCode: 'student',
          scopeType: 'class',
          scopeId: id.classB,
        },
        {
          id: randomUUID(),
          organizationId: id.schoolA,
          userId: id.classTeacher,
          workspaceId: id.classAWs,
          roleCode: 'teacher',
          scopeType: 'class',
          scopeId: id.classA,
        },
        {
          id: randomUUID(),
          organizationId: id.schoolA,
          userId: id.classBTeacher,
          workspaceId: id.classBWs,
          roleCode: 'teacher',
          scopeType: 'class',
          scopeId: id.classB,
        },
        {
          id: randomUUID(),
          organizationId: id.schoolA,
          userId: id.historicalTeacher,
          workspaceId: id.classAWs,
          roleCode: 'teacher',
          scopeType: 'class',
          scopeId: id.classA,
          status: 'disabled',
        },
        {
          id: randomUUID(),
          organizationId: id.schoolA,
          userId: id.gradeManager,
          workspaceId: id.grade2023Ws,
          roleCode: 'grade_manager',
          scopeType: 'grade',
          scopeId: 'primary:2023',
        },
        {
          id: randomUUID(),
          organizationId: id.schoolA,
          userId: id.schoolAdmin,
          workspaceId: id.schoolAWs,
          roleCode: 'school_admin',
          scopeType: 'school',
          scopeId: id.schoolA,
        },
        {
          id: randomUUID(),
          organizationId: id.schoolA,
          userId: id.operator,
          workspaceId: id.platformAWs,
          roleCode: 'platform_ops',
          scopeType: 'platform',
          scopeId: id.schoolA,
        },
        {
          id: randomUUID(),
          organizationId: id.schoolB,
          userId: id.otherAdmin,
          workspaceId: id.schoolBWs,
          roleCode: 'school_admin',
          scopeType: 'school',
          scopeId: id.schoolB,
        },
        {
          id: randomUUID(),
          organizationId: id.schoolB,
          userId: id.otherTeacher,
          workspaceId: id.otherClassWs,
          roleCode: 'teacher',
          scopeType: 'class',
          scopeId: id.otherClass,
        },
        {
          id: randomUUID(),
          organizationId: id.schoolB,
          userId: id.otherStudent,
          workspaceId: id.otherStudentOwnWs,
          roleCode: 'student',
          scopeType: 'own',
          scopeId: id.otherStudent,
        },
        {
          id: randomUUID(),
          organizationId: id.schoolB,
          userId: id.otherStudent,
          workspaceId: id.otherClassWs,
          roleCode: 'student',
          scopeType: 'class',
          scopeId: id.otherClass,
        },
      ],
      classes: [
        classA,
        classB,
        {
          id: id.classDisabled,
          organizationId: id.schoolA,
          name: `停用班-${suffix}`,
          stage: 'primary',
          entryYear: 2023,
          classNumber: 2,
          gradeId: 'primary:2023',
          status: 'disabled',
        },
        {
          id: id.classGraduated,
          organizationId: id.schoolA,
          name: `毕业班-${suffix}`,
          stage: 'primary',
          entryYear: 2018,
          classNumber: 1,
          gradeId: 'primary:2018',
        },
        {
          id: id.classUpcoming,
          organizationId: id.schoolA,
          name: `未开学班-${suffix}`,
          stage: 'primary',
          entryYear: 2026,
          classNumber: 1,
          gradeId: 'primary:2026',
        },
        {
          id: id.otherClass,
          organizationId: id.schoolB,
          name: `外校班-${suffix}`,
          stage: 'primary',
          entryYear: 2023,
          classNumber: 1,
          gradeId: 'primary:2023',
        },
      ],
      classMemberships: [
        {
          id: randomUUID(),
          classId: id.classA,
          userId: id.enrolledStudent,
          membershipRole: 'student',
        },
        {
          id: randomUUID(),
          classId: id.classB,
          userId: id.classBStudent,
          membershipRole: 'student',
        },
        {
          id: randomUUID(),
          classId: id.classA,
          userId: id.classTeacher,
          membershipRole: 'teacher',
        },
        {
          id: randomUUID(),
          classId: id.classB,
          userId: id.classBTeacher,
          membershipRole: 'teacher',
        },
        {
          id: randomUUID(),
          classId: id.classA,
          userId: id.historicalTeacher,
          membershipRole: 'teacher',
          status: 'disabled',
        },
        {
          id: randomUUID(),
          classId: id.otherClass,
          userId: id.otherStudent,
          membershipRole: 'student',
        },
        {
          id: randomUUID(),
          classId: id.otherClass,
          userId: id.otherTeacher,
          membershipRole: 'teacher',
        },
      ],
      credentials: [...schoolAUsers, ...schoolBUsers].map(([userId]) => ({
        id: randomUUID(),
        userId,
        passwordHash,
      })),
    },
  }
}

export function insertRegistrationCredential(database, record) {
  const rawToken = record.rawToken ?? randomBytes(32).toString('base64url')
  const secretHash = sha256Hex(rawToken)
  const now = record.now ?? new Date().toISOString()
  const id = record.id ?? randomUUID()
  database
    .prepare(
      `INSERT INTO registration_credentials (
        id, organization_id, secret_hash, expected_role, scope_type, scope_id,
        expires_at, max_uses, successful_use_count, revoked_at, revoked_by, revoked_reason,
        created_by_user_id, created_workspace_id, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      id,
      record.organizationId,
      secretHash,
      record.expectedRole,
      record.scopeType,
      record.scopeId,
      record.expiresAt,
      record.maxUses ?? null,
      record.successfulUseCount ?? 0,
      record.revokedAt ?? null,
      record.revokedBy ?? null,
      record.revokedReason ?? null,
      record.createdByUserId,
      record.createdWorkspaceId,
      now,
      now,
    )
  return { id, rawToken, secretHash }
}

export function insertRegistrationUse(database, record) {
  const now = record.usedAt ?? new Date().toISOString()
  database
    .prepare(
      `INSERT INTO registration_credential_uses (
        id, credential_id, organization_id, expected_role, created_user_id, request_id, used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.id ?? randomUUID(),
      record.credentialId,
      record.organizationId,
      record.expectedRole,
      record.createdUserId,
      record.requestId ?? `t83a-${randomUUID()}`,
      now,
    )
}

export function insertEnrollmentRequest(database, record) {
  const now = record.now ?? new Date().toISOString()
  const id = record.id ?? randomUUID()
  database
    .prepare(
      `INSERT INTO student_enrollment_requests (
        id, organization_id, student_user_id, class_id, status, requested_at,
        decided_at, decided_by, decision_reason, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      record.organizationId,
      record.studentUserId,
      record.classId,
      record.status ?? 'pending',
      record.requestedAt ?? now,
      record.decidedAt ?? null,
      record.decidedBy ?? null,
      record.decisionReason ?? null,
      now,
      now,
      record.version ?? 1,
    )
  return { id, version: record.version ?? 1 }
}

export function insertPasswordResetCredential(database, record) {
  const rawToken = record.rawToken ?? randomBytes(32).toString('base64url')
  const secretHash = sha256Hex(rawToken)
  const now = record.now ?? new Date().toISOString()
  const id = record.id ?? randomUUID()
  database
    .prepare(
      `INSERT INTO password_reset_credentials (
        id, organization_id, target_user_id, secret_hash, expires_at, used_at,
        revoked_at, revoked_by, revoked_reason, created_by_user_id, created_workspace_id,
        created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      id,
      record.organizationId,
      record.targetUserId,
      secretHash,
      record.expiresAt,
      record.usedAt ?? null,
      record.revokedAt ?? null,
      record.revokedBy ?? null,
      record.revokedReason ?? null,
      record.createdByUserId,
      record.createdWorkspaceId,
      now,
      now,
    )
  return { id, rawToken, secretHash }
}

function insertPhase8Extras(database, fixture) {
  const now = new Date().toISOString()
  const week = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const halfYear = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString()
  const expired = new Date(Date.now() - 60 * 1000).toISOString()

  fixture.pendingEnrollment = insertEnrollmentRequest(database, {
    organizationId: fixture.id.schoolA,
    studentUserId: fixture.id.pendingStudent,
    classId: fixture.id.classA,
  })

  const vEvidence = insertRegistrationCredential(database, {
    organizationId: fixture.id.schoolA,
    expectedRole: 'teacher',
    scopeType: 'school',
    scopeId: fixture.id.schoolA,
    expiresAt: week,
    maxUses: 1,
    successfulUseCount: 1,
    createdByUserId: fixture.id.schoolAdmin,
    createdWorkspaceId: fixture.id.schoolAWs,
  })
  insertRegistrationUse(database, {
    credentialId: vEvidence.id,
    organizationId: fixture.id.schoolA,
    expectedRole: 'teacher',
    createdUserId: fixture.id.zeroWsTeacher,
  })
  fixture.zeroWsTeacherCredential = vEvidence

  fixture.studentRegister = insertRegistrationCredential(database, {
    organizationId: fixture.id.schoolA,
    expectedRole: 'student',
    scopeType: 'grade',
    scopeId: 'primary:2023',
    expiresAt: halfYear,
    maxUses: null,
    createdByUserId: fixture.id.gradeManager,
    createdWorkspaceId: fixture.id.grade2023Ws,
  })
  fixture.teacherRegister = insertRegistrationCredential(database, {
    organizationId: fixture.id.schoolA,
    expectedRole: 'teacher',
    scopeType: 'school',
    scopeId: fixture.id.schoolA,
    expiresAt: week,
    maxUses: 1,
    createdByUserId: fixture.id.schoolAdmin,
    createdWorkspaceId: fixture.id.schoolAWs,
  })
  fixture.revokedRegister = insertRegistrationCredential(database, {
    organizationId: fixture.id.schoolA,
    expectedRole: 'student',
    scopeType: 'grade',
    scopeId: 'primary:2023',
    expiresAt: halfYear,
    revokedAt: now,
    revokedBy: fixture.id.schoolAdmin,
    revokedReason: 'revoked-for-guard',
    createdByUserId: fixture.id.schoolAdmin,
    createdWorkspaceId: fixture.id.schoolAWs,
  })
  fixture.expiredRegister = insertRegistrationCredential(database, {
    organizationId: fixture.id.schoolA,
    expectedRole: 'student',
    scopeType: 'grade',
    scopeId: 'primary:2023',
    expiresAt: expired,
    createdByUserId: fixture.id.schoolAdmin,
    createdWorkspaceId: fixture.id.schoolAWs,
  })
  fixture.exhaustedRegister = insertRegistrationCredential(database, {
    organizationId: fixture.id.schoolA,
    expectedRole: 'teacher',
    scopeType: 'school',
    scopeId: fixture.id.schoolA,
    expiresAt: week,
    maxUses: 1,
    successfulUseCount: 1,
    createdByUserId: fixture.id.schoolAdmin,
    createdWorkspaceId: fixture.id.schoolAWs,
  })
  fixture.studentRegisterB = insertRegistrationCredential(database, {
    organizationId: fixture.id.schoolB,
    expectedRole: 'student',
    scopeType: 'grade',
    scopeId: 'primary:2023',
    expiresAt: halfYear,
    maxUses: null,
    createdByUserId: fixture.id.otherAdmin,
    createdWorkspaceId: fixture.id.schoolBWs,
  })
}

export async function startPhase8App(t) {
  const temporary = createTemporaryDatabase()
  assert.equal(isRealDatabasePath(temporary.filename), false, '临时库路径不得是 server/data/readmate.sqlite')
  const sessionSecret = randomBytes(48).toString('base64url')
  const { app, module } = createIdentityTestApp({
    databasePath: temporary.filename,
    sessionSecret,
    cookieSecure: false,
  })
  const fixture = createPhase8Seed()
  module.service.importSeed(fixture.seed)
  insertPhase8Extras(module.database, fixture)

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  const port = server.address().port
  assert.notEqual(port, 5191, '独立端口禁止 5191')

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    module.close()
    removeTemporaryDatabase(temporary)
  })

  return {
    fixture,
    module,
    sessionSecret,
    databasePath: temporary.filename,
    port,
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
    cookieFor(userId) {
      const session = createServerSession(module.database, { userId, sessionSecret })
      return {
        header: `${module.service.cookieName}=${session.token}`,
        session,
      }
    },
  }
}

export async function requestJson(baseUrl, path, options = {}) {
  const headers = new Headers(options.headers)
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { parseError: true, raw: text.slice(0, 400) }
    }
  }
  return {
    status: response.status,
    payload,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null,
    setCookie: response.headers.get('set-cookie') ?? '',
    etag: response.headers.get('etag'),
    text,
  }
}

export function writeHeaders({ cookie, workspaceId, key, ifMatch } = {}) {
  const headers = {}
  if (cookie) headers.Cookie = cookie
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId
  if (key) headers['Idempotency-Key'] = key
  if (ifMatch !== undefined) headers['If-Match'] = String(ifMatch)
  return headers
}

export async function loginWithSchool(baseUrl, { schoolCode, loginName, password }, key = newIdempotencyKey('login')) {
  return requestJson(baseUrl, '/auth/login', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { schoolCode, loginName, password },
  })
}

export async function loginWithUsername(baseUrl, { username, password }, key = newIdempotencyKey('legacy-login')) {
  return requestJson(baseUrl, '/auth/login', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { username, password },
  })
}

export function assertHttpStatus(response, expected, detail) {
  assert.equal(
    response.status,
    expected,
    `${detail ?? 'HTTP 状态'} 期望 ${expected}，实际 ${response.status} body=${JSON.stringify(response.payload)?.slice(0, 500)}`,
  )
}

export function errorOf(response) {
  return response.payload?.error ?? {}
}

export function assertErrorCode(response, code, detail) {
  assert.equal(errorOf(response).code, code, `${detail ?? 'error.code'} 期望 ${code}，实际 ${errorOf(response).code}`)
}

export function loadTeacherTriple(database, { userId, classId }) {
  return {
    memberships: database
      .prepare(
        `SELECT id, status, version FROM class_memberships
         WHERE user_id = ? AND class_id = ? AND membership_role = 'teacher'
         ORDER BY id`,
      )
      .all(userId, classId),
    workspaceMemberships: database
      .prepare(
        `SELECT wm.id, wm.status, wm.version, wm.workspace_id
         FROM workspace_memberships wm
         JOIN workspaces w ON w.id = wm.workspace_id
         WHERE wm.user_id = ? AND w.scope_type = 'class' AND w.scope_id = ?
         ORDER BY wm.id`,
      )
      .all(userId, classId),
    roleAssignments: database
      .prepare(
        `SELECT id, status, version, scope_type, scope_id, role_code, workspace_id
         FROM role_assignments
         WHERE user_id = ? AND scope_type = 'class' AND scope_id = ?
           AND role_code IN ('teacher', 'class_teacher')
         ORDER BY id`,
      )
      .all(userId, classId),
  }
}

export function loadStudentTriple(database, { userId, classId }) {
  return {
    memberships: database
      .prepare(
        `SELECT id, status, version FROM class_memberships
         WHERE user_id = ? AND class_id = ? AND membership_role = 'student'
         ORDER BY id`,
      )
      .all(userId, classId),
    workspaceMemberships: database
      .prepare(
        `SELECT wm.id, wm.status, wm.version, wm.workspace_id
         FROM workspace_memberships wm
         JOIN workspaces w ON w.id = wm.workspace_id
         WHERE wm.user_id = ? AND w.scope_type = 'class' AND w.scope_id = ?
         ORDER BY wm.id`,
      )
      .all(userId, classId),
    roleAssignments: database
      .prepare(
        `SELECT id, status, version, scope_type, scope_id, role_code
         FROM role_assignments
         WHERE user_id = ? AND scope_type = 'class' AND scope_id = ?
           AND role_code = 'student'
         ORDER BY id`,
      )
      .all(userId, classId),
  }
}

export function assertCompleteTriple(triple, status, label) {
  assert.equal(triple.memberships.length, 1, `${label}: class_memberships 必须恰好 1 行`)
  assert.equal(triple.workspaceMemberships.length, 1, `${label}: workspace_memberships 必须恰好 1 行`)
  assert.equal(triple.roleAssignments.length, 1, `${label}: role_assignments 必须恰好 1 行`)
  assert.equal(triple.memberships[0].status, status, `${label}: class_memberships.status`)
  assert.equal(triple.workspaceMemberships[0].status, status, `${label}: workspace_memberships.status`)
  assert.equal(triple.roleAssignments[0].status, status, `${label}: role_assignments.status`)
}

export function countSchoolScopeTeacherRoles(database, userId) {
  return database
    .prepare(
      `SELECT COUNT(*) AS count FROM role_assignments
       WHERE user_id = ? AND scope_type = 'school'
         AND role_code IN ('teacher', 'class_teacher')`,
    )
    .get(userId).count
}

export function countActiveStudentMemberships(database, classId) {
  return database
    .prepare(
      `SELECT COUNT(*) AS count FROM class_memberships
       WHERE class_id = ? AND membership_role = 'student' AND status = 'active'`,
    )
    .get(classId).count
}

export function actorUser(database, userId) {
  const row = database
    .prepare('SELECT id, organization_id, username, display_name, status, version FROM users WHERE id = ?')
    .get(userId)
  assert.ok(row, `用户必须存在: ${userId}`)
  return {
    id: row.id,
    organizationId: row.organization_id,
    username: row.username,
    displayName: row.display_name,
    status: row.status,
    version: row.version,
  }
}

export function auditText(database) {
  return JSON.stringify(database.prepare('SELECT * FROM audit_events').all())
}

export function assertAuditOmitsSecrets(database, secrets) {
  const blob = auditText(database)
  for (const secret of secrets.filter(Boolean)) {
    assert.equal(blob.includes(secret), false, `审计不得包含秘密片段 ${String(secret).slice(0, 12)}`)
  }
}

export function assertOpaque404(left, right, detail) {
  assertHttpStatus(left, 404, `${detail}: 跨组织`)
  assertHttpStatus(right, 404, `${detail}: 不存在`)
  assertErrorCode(left, 'RESOURCE_NOT_FOUND', `${detail}: 跨组织`)
  assertErrorCode(right, 'RESOURCE_NOT_FOUND', `${detail}: 不存在`)
  assert.equal(
    errorOf(left).message,
    errorOf(right).message,
    `${detail}: 跨组织与不存在必须同文案`,
  )
  assert.ok(errorOf(left).message, `${detail}: 404 必须有文案`)
}

export function roleAllows(roleCode, action, grant) {
  return permissions.createPermissionEvaluator()({
    assignments: [
      {
        roleCode,
        workspaceId: grant.workspaceId,
        organizationId: grant.organizationId,
        scopeType: grant.scopeType,
        scopeId: grant.scopeId,
      },
    ],
    action,
    resourceScope: grant.resourceScope,
    actorUserId: grant.actorUserId ?? 'actor-1',
    authContext: {
      workspaceId: grant.workspaceId,
      organizationId: grant.organizationId,
    },
  })
}

export function classScopeGrant(organizationId, classId) {
  return {
    workspaceId: 'ws-class',
    organizationId,
    scopeType: 'class',
    scopeId: classId,
    resourceScope: {
      type: 'class',
      id: classId,
      organizationId,
      classId,
    },
  }
}

export function schoolScopeGrant(organizationId) {
  return {
    workspaceId: 'ws-school',
    organizationId,
    scopeType: 'school',
    scopeId: organizationId,
    resourceScope: {
      type: 'school',
      id: organizationId,
      organizationId,
    },
  }
}

export function schoolGradeGrant(organizationId, gradeId) {
  const grant = schoolScopeGrant(organizationId)
  return {
    ...grant,
    resourceScope: {
      ...grant.resourceScope,
      gradeId,
    },
  }
}

export function gradeScopeGrant(organizationId, gradeId) {
  return {
    workspaceId: 'ws-grade',
    organizationId,
    scopeType: 'grade',
    scopeId: gradeId,
    resourceScope: {
      type: 'grade',
      id: gradeId,
      organizationId,
      gradeId,
    },
  }
}

export function platformScopeGrant(organizationId) {
  return {
    workspaceId: 'ws-platform',
    organizationId,
    scopeType: 'platform',
    scopeId: organizationId,
    resourceScope: {
      type: 'platform',
      id: organizationId,
      organizationId,
    },
  }
}

export function existsPath(pathname) {
  return existsSync(pathname)
}
