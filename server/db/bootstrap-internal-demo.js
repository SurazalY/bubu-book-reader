import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { hashPassword } from '../auth/password.js'
import { createIdentityModule } from '../domains/identity/index.js'
import { importPublicDomainCatalog } from './import-public-domain-catalog.js'

const stable = {
  organizationId: 'internal-demo-organization',
  gradeId: 'internal-demo-grade',
  classId: 'internal-demo-class',
  workspaceId: 'internal-demo-workspace',
  schoolWorkspaceId: 'internal-demo-school-workspace',
  platformWorkspaceId: 'internal-demo-platform-workspace',
  studentId: 'internal-demo-student',
  implicatedTeacherId: 'internal-teacher-li',
  backupTeacherId: 'internal-teacher-wang',
  principalId: 'internal-principal',
  opsAdminId: 'internal-ops-admin',
}

function parseArguments(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith('--') || !values[index + 1]) throw new Error('必须提供 --database、--manifest，可选 --public-root')
    parsed[values[index].slice(2)] = values[index + 1]
  }
  if (!parsed.database || !parsed.manifest) throw new Error('必须提供 --database 与 --manifest')
  return parsed
}

function passwordHash(database, userId, password) {
  const existing = database.prepare('SELECT password_hash FROM credentials WHERE user_id = ?').get(userId)
  return existing?.password_hash || hashPassword(password)
}

function retireLegacySharedAdmin(database, updatedAt) {
  const legacyAdmin = database.prepare(`
    SELECT id, organization_id, username, display_name
    FROM users
    WHERE id = 'internal-demo-admin'
  `).get()
  if (!legacyAdmin) return
  const matchesLegacyContract = legacyAdmin.organization_id === stable.organizationId
    && legacyAdmin.username === 'internal-admin'
    && legacyAdmin.display_name === '内部联调管理员'
  if (!matchesLegacyContract) throw new Error('旧内部演示管理员账号与可退役契约冲突')
  database.prepare(`
    UPDATE users
    SET status = 'disabled', updated_at = ?, version = version + 1
    WHERE id = ? AND status <> 'disabled'
  `).run(updatedAt, legacyAdmin.id)
  database.prepare(`
    UPDATE workspace_memberships
    SET status = 'disabled', updated_at = ?, version = version + 1
    WHERE user_id = ? AND status <> 'disabled'
  `).run(updatedAt, legacyAdmin.id)
  database.prepare(`
    UPDATE role_assignments
    SET status = 'disabled', updated_at = ?, version = version + 1
    WHERE user_id = ? AND status <> 'disabled'
  `).run(updatedAt, legacyAdmin.id)
  database.prepare(`
    UPDATE sessions
    SET revoked_at = COALESCE(revoked_at, ?), updated_at = ?, version = version + 1
    WHERE user_id = ? AND revoked_at IS NULL
  `).run(updatedAt, updatedAt, legacyAdmin.id)
  database.prepare(`
    UPDATE safety_handlers
    SET active = 0, updated_at = ?, version = version + 1
    WHERE (user_id = ? OR actor_id_at_creation = ?) AND active = 1
  `).run(updatedAt, legacyAdmin.id, legacyAdmin.id)
}

function retireLegacyActor(database, { id, username, displayName }, updatedAt) {
  const actor = database.prepare(`
    SELECT id, organization_id, username, display_name
    FROM users
    WHERE id = ?
  `).get(id)
  if (!actor) return
  const matchesLegacyContract = actor.organization_id === stable.organizationId
    && actor.username === username
    && actor.display_name === displayName
  if (!matchesLegacyContract) throw new Error(`旧内部演示账号与可退役契约冲突：${id}`)
  database.prepare(`
    UPDATE users SET status = 'disabled', updated_at = ?, version = version + 1
    WHERE id = ? AND status <> 'disabled'
  `).run(updatedAt, id)
  database.prepare(`
    UPDATE workspace_memberships SET status = 'disabled', updated_at = ?, version = version + 1
    WHERE user_id = ? AND status <> 'disabled'
  `).run(updatedAt, id)
  database.prepare(`
    UPDATE role_assignments SET status = 'disabled', updated_at = ?, version = version + 1
    WHERE user_id = ? AND status <> 'disabled'
  `).run(updatedAt, id)
  database.prepare(`
    UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?), updated_at = ?, version = version + 1
    WHERE user_id = ? AND revoked_at IS NULL
  `).run(updatedAt, updatedAt, id)
  database.prepare(`
    UPDATE safety_handlers SET active = 0, updated_at = ?, version = version + 1
    WHERE (user_id = ? OR actor_id_at_creation = ?) AND active = 1
  `).run(updatedAt, id, id)
}

function prepareStableDemoIdentities(database, updatedAt) {
  const student = database.prepare(`
    SELECT organization_id, username, display_name
    FROM users WHERE id = ?
  `).get(stable.studentId)
  if (student) {
    const known = student.organization_id === stable.organizationId
      && student.username === 'internal-student'
      && ['内部联调学生', '林小竹'].includes(student.display_name)
    if (!known) throw new Error('内部演示学生账号与稳定升级契约冲突')
    database.prepare(`
      UPDATE users SET display_name = '林小竹', updated_at = ?, version = version + 1
      WHERE id = ? AND display_name <> '林小竹'
    `).run(updatedAt, stable.studentId)
  }
  const classroom = database.prepare(`
    SELECT organization_id, name FROM classes WHERE id = ?
  `).get(stable.classId)
  if (classroom) {
    const known = classroom.organization_id === stable.organizationId
      && ['内部联调一班', '三年级一班'].includes(classroom.name)
    if (!known) throw new Error('内部演示班级与稳定升级契约冲突')
    database.prepare(`
      UPDATE classes SET name = '三年级一班', updated_at = ?, version = version + 1
      WHERE id = ? AND name <> '三年级一班'
    `).run(updatedAt, stable.classId)
  }
  retireLegacyActor(database, {
    id: 'internal-demo-teacher',
    username: 'internal-teacher',
    displayName: '内部联调教师',
  }, updatedAt)
  retireLegacyActor(database, {
    id: 'internal-school-admin',
    username: 'internal-school-admin',
    displayName: '内部联调学校管理员',
  }, updatedAt)
}

function rotateDemoCredentials(database, userIds, password, updatedAt) {
  for (const userId of userIds) {
    const updated = database.prepare(`
      UPDATE credentials
      SET password_hash = ?, updated_at = ?, version = version + 1
      WHERE user_id = ?
    `).run(hashPassword(password), updatedAt, userId)
    if (updated.changes !== 1) throw new Error(`内部演示账号缺少可轮换凭据：${userId}`)
  }
  database.prepare(`
    UPDATE sessions
    SET revoked_at = COALESCE(revoked_at, ?), updated_at = ?, version = version + 1
    WHERE user_id IN (${userIds.map(() => '?').join(', ')}) AND revoked_at IS NULL
  `).run(updatedAt, updatedAt, ...userIds)
}

export async function bootstrapInternalDemo({
  databasePath,
  manifestPath,
  publicRoot = 'public',
  password,
  catalogImporter = importPublicDomainCatalog,
  rotateExistingCredentials = false,
}) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('INTERNAL_DEMO_PASSWORD 至少需要 12 个字符')
  if (typeof rotateExistingCredentials !== 'boolean') throw new TypeError('rotateExistingCredentials 必须是布尔值')
  const identity = createIdentityModule({
    databasePath: resolve(databasePath),
    sessionSecret: randomBytes(48).toString('base64url'),
    cookieSecure: false,
  })
  const users = [
    { id: stable.studentId, username: 'internal-student', displayName: '林小竹', roleCode: 'student' },
    { id: stable.implicatedTeacherId, username: 'internal-teacher-li', displayName: '李老师', roleCode: 'teacher' },
    { id: stable.backupTeacherId, username: 'internal-teacher-wang', displayName: '王老师', roleCode: 'teacher' },
    { id: stable.principalId, username: 'internal-principal', displayName: '陈校长', roleCode: 'school_admin' },
    { id: stable.opsAdminId, username: 'internal-ops-admin', displayName: '内部联调运营管理员', roleCode: 'platform_ops' },
  ]
  try {
    const preparedAt = new Date().toISOString()
    identity.database.exec('BEGIN IMMEDIATE')
    try {
      prepareStableDemoIdentities(identity.database, preparedAt)
      identity.database.exec('COMMIT')
    } catch (error) {
      identity.database.exec('ROLLBACK')
      throw error
    }
    identity.service.importSeed({
      organizations: [{ id: stable.organizationId, name: '读伴公共领域内部联调学校' }],
      users: users.map((user) => ({ id: user.id, organizationId: stable.organizationId, username: user.username, displayName: user.displayName })),
      workspaces: [
        {
          id: stable.workspaceId,
          organizationId: stable.organizationId,
          code: 'class-teacher',
          name: '公共领域素材联调班级',
          scopeType: 'class',
          scopeId: stable.classId,
        },
        {
          id: stable.schoolWorkspaceId,
          organizationId: stable.organizationId,
          code: 'school-admin',
          name: '公共领域素材联调学校管理',
          scopeType: 'school',
          scopeId: stable.organizationId,
        },
        {
          id: stable.platformWorkspaceId,
          organizationId: stable.organizationId,
          code: 'platform-ops',
          name: '读伴平台技术运维',
          scopeType: 'platform',
          scopeId: 'readmate-platform',
        },
      ],
      workspaceMemberships: [
        { id: `membership-${stable.studentId}`, userId: stable.studentId, workspaceId: stable.workspaceId },
        { id: `membership-${stable.implicatedTeacherId}`, userId: stable.implicatedTeacherId, workspaceId: stable.workspaceId },
        { id: `membership-${stable.backupTeacherId}`, userId: stable.backupTeacherId, workspaceId: stable.workspaceId },
        { id: 'membership-internal-principal', userId: stable.principalId, workspaceId: stable.schoolWorkspaceId },
        { id: 'membership-internal-ops-admin', userId: stable.opsAdminId, workspaceId: stable.platformWorkspaceId },
      ],
      classes: [{ id: stable.classId, organizationId: stable.organizationId, gradeId: stable.gradeId, name: '三年级一班' }],
      classMemberships: [
        { id: 'class-member-internal-student', classId: stable.classId, userId: stable.studentId, membershipRole: 'student' },
        { id: 'class-member-internal-teacher-li', classId: stable.classId, userId: stable.implicatedTeacherId, membershipRole: 'teacher' },
        { id: 'class-member-internal-teacher-wang', classId: stable.classId, userId: stable.backupTeacherId, membershipRole: 'teacher' },
      ],
      roleAssignments: [
        ...users.slice(0, 3).map((user) => ({
          id: `role-${user.id}`,
          organizationId: stable.organizationId,
          userId: user.id,
          workspaceId: stable.workspaceId,
          roleCode: user.roleCode,
          scopeType: 'class',
          scopeId: stable.classId,
        })),
        {
          id: 'role-internal-principal',
          organizationId: stable.organizationId,
          userId: stable.principalId,
          workspaceId: stable.schoolWorkspaceId,
          roleCode: 'school_admin',
          scopeType: 'school',
          scopeId: stable.organizationId,
        },
        {
          id: 'role-internal-ops-admin',
          organizationId: stable.organizationId,
          userId: stable.opsAdminId,
          workspaceId: stable.platformWorkspaceId,
          roleCode: 'platform_ops',
          scopeType: 'platform',
          scopeId: 'readmate-platform',
        },
      ],
      credentials: users.map((user) => ({
        id: `credential-${user.id}`,
        userId: user.id,
        passwordHash: passwordHash(identity.database, user.id, password),
      })),
    })
    const updatedAt = new Date().toISOString()
    identity.database.exec('BEGIN IMMEDIATE')
    try {
      retireLegacySharedAdmin(identity.database, updatedAt)
      if (rotateExistingCredentials) rotateDemoCredentials(identity.database, users.map((user) => user.id), password, updatedAt)
      const expectedHandlers = [
        {
          id: 'internal-demo-class-safety-handler-li',
          organizationId: stable.organizationId,
          actorId: stable.principalId,
          userId: stable.implicatedTeacherId,
          scopeType: 'class',
          scopeId: stable.classId,
          handlerLevel: 1,
        },
        {
          id: 'internal-demo-class-safety-handler-wang',
          organizationId: stable.organizationId,
          actorId: stable.principalId,
          userId: stable.backupTeacherId,
          scopeType: 'class',
          scopeId: stable.classId,
          handlerLevel: 2,
        },
        {
          id: 'internal-demo-school-safety-handler-principal',
          organizationId: stable.organizationId,
          actorId: stable.principalId,
          userId: stable.principalId,
          scopeType: 'school',
          scopeId: stable.organizationId,
          handlerLevel: 3,
        },
      ]
      for (const expectedHandler of expectedHandlers) {
        const existingHandler = identity.database.prepare(`
          SELECT id, organization_id, actor_id_at_creation, user_id, scope_type, scope_id, handler_level
          FROM safety_handlers
          WHERE id = ?
        `).get(expectedHandler.id)
        if (existingHandler) {
          const matches = existingHandler.organization_id === expectedHandler.organizationId
            && existingHandler.actor_id_at_creation === expectedHandler.actorId
            && existingHandler.user_id === expectedHandler.userId
            && existingHandler.scope_type === expectedHandler.scopeType
            && existingHandler.scope_id === expectedHandler.scopeId
            && existingHandler.handler_level === expectedHandler.handlerLevel
          if (!matches) throw new Error('内部演示安全处置人记录与稳定初始化契约冲突')
          identity.database.prepare(`
            UPDATE safety_handlers
            SET active = 1, updated_at = ?, version = version + 1
            WHERE id = ? AND active = 0
          `).run(updatedAt, expectedHandler.id)
          continue
        }
        identity.database.prepare(`
          INSERT INTO safety_handlers (
            id, organization_id, organization_id_at_creation, actor_id_at_creation,
            user_id, scope_type, scope_id, handler_level, active, created_at, updated_at, version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1)
        `).run(
          expectedHandler.id,
          expectedHandler.organizationId,
          expectedHandler.organizationId,
          expectedHandler.actorId,
          expectedHandler.userId,
          expectedHandler.scopeType,
          expectedHandler.scopeId,
          expectedHandler.handlerLevel,
          updatedAt,
          updatedAt,
        )
      }
      identity.database.exec('COMMIT')
    } catch (error) {
      identity.database.exec('ROLLBACK')
      throw error
    }
  } finally {
    identity.close()
  }
  const catalog = await catalogImporter({
    databasePath,
    manifestPath,
    actorId: stable.principalId,
    workspaceId: stable.schoolWorkspaceId,
    publicRoot,
  })
  return {
    users: users.map(({ username, displayName }) => ({ username, displayName })),
    workspaceId: stable.workspaceId,
    schoolWorkspaceId: stable.schoolWorkspaceId,
    platformWorkspaceId: stable.platformWorkspaceId,
    credentialsRotated: rotateExistingCredentials,
    catalog,
  }
}

const entrypoint = typeof process !== 'undefined' && process.argv[1] ? resolve(process.argv[1]) : null
if (entrypoint === fileURLToPath(import.meta.url)) {
  const argumentsMap = parseArguments(process.argv.slice(2))
  bootstrapInternalDemo({
    databasePath: argumentsMap.database,
    manifestPath: argumentsMap.manifest,
    publicRoot: argumentsMap['public-root'] || 'public',
    password: process.env.INTERNAL_DEMO_PASSWORD,
    rotateExistingCredentials: argumentsMap['rotate-credentials'] === 'true',
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`)
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
