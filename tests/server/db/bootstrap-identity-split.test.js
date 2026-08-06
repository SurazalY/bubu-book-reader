import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { hashPassword } from '../../../server/auth/password.js'
import { verifyPassword } from '../../../server/auth/password.js'
import { bootstrapInternalDemo } from '../../../server/db/bootstrap-internal-demo.js'
import { createIdentityModule } from '../../../server/domains/identity/index.js'

const organizationId = 'internal-demo-organization'
const classId = 'internal-demo-class'
const classWorkspaceId = 'internal-demo-workspace'
const schoolWorkspaceId = 'internal-demo-school-workspace'
const platformWorkspaceId = 'internal-demo-platform-workspace'

function seedLegacySharedAdmin(databasePath, password) {
  const identity = createIdentityModule({
    databasePath,
    sessionSecret: randomBytes(48).toString('base64url'),
    cookieSecure: false,
  })
  const users = [
    { id: 'internal-demo-student', username: 'internal-student', displayName: '内部联调学生', roleCode: 'student' },
    { id: 'internal-demo-teacher', username: 'internal-teacher', displayName: '内部联调教师', roleCode: 'teacher' },
    { id: 'internal-demo-admin', username: 'internal-admin', displayName: '内部联调管理员', roleCode: 'school_admin' },
  ]
  try {
    identity.service.importSeed({
      organizations: [{ id: organizationId, name: '读伴公共领域内部联调学校' }],
      users: users.map((user) => ({ id: user.id, organizationId, username: user.username, displayName: user.displayName })),
      workspaces: [
        { id: classWorkspaceId, organizationId, code: 'class-teacher', name: '公共领域素材联调班级', scopeType: 'class', scopeId: classId },
        { id: schoolWorkspaceId, organizationId, code: 'school-admin', name: '公共领域素材联调学校管理', scopeType: 'school', scopeId: organizationId },
      ],
      workspaceMemberships: [
        ...users.map((user) => ({ id: `membership-${user.id}`, userId: user.id, workspaceId: classWorkspaceId })),
        { id: 'membership-internal-admin-school', userId: 'internal-demo-admin', workspaceId: schoolWorkspaceId },
      ],
      classes: [{ id: classId, organizationId, gradeId: 'internal-demo-grade', name: '内部联调一班' }],
      classMemberships: [
        { id: 'class-member-internal-student', classId, userId: 'internal-demo-student', membershipRole: 'student' },
        { id: 'class-member-internal-teacher', classId, userId: 'internal-demo-teacher', membershipRole: 'teacher' },
      ],
      roleAssignments: [
        ...users.map((user) => ({
          id: `role-${user.id}`,
          organizationId,
          userId: user.id,
          workspaceId: classWorkspaceId,
          roleCode: user.roleCode,
          scopeType: 'class',
          scopeId: classId,
        })),
        {
          id: 'role-internal-admin-school',
          organizationId,
          userId: 'internal-demo-admin',
          workspaceId: schoolWorkspaceId,
          roleCode: 'school_admin',
          scopeType: 'school',
          scopeId: organizationId,
        },
      ],
      credentials: users.map((user) => ({
        id: `credential-${user.id}`,
        userId: user.id,
        passwordHash: hashPassword(password),
      })),
    })
    const now = new Date().toISOString()
    identity.database.prepare(`
      INSERT INTO sessions (
        id, user_id, token_hash, expires_at, revoked_at, last_seen_at,
        created_at, updated_at, version
      ) VALUES ('legacy-admin-session', 'internal-demo-admin', 'legacy-admin-token-hash', ?, NULL, ?, ?, ?, 1)
    `).run(new Date(Date.now() + 60_000).toISOString(), now, now, now)
    identity.database.prepare(`
      INSERT INTO safety_handlers (
        id, organization_id, organization_id_at_creation, actor_id_at_creation,
        user_id, scope_type, scope_id, handler_level, active, created_at, updated_at, version
      ) VALUES (
        'internal-demo-safety-handler', ?, ?, 'internal-demo-admin',
        'internal-demo-admin', 'school', ?, 1, 1, ?, ?, 1
      )
    `).run(organizationId, organizationId, organizationId, now, now)
    identity.database.prepare(`
      INSERT INTO safety_handlers (
        id, organization_id, organization_id_at_creation, actor_id_at_creation,
        user_id, scope_type, scope_id, handler_level, active, created_at, updated_at, version
      ) VALUES (
        'internal-demo-safety-handler-teacher', ?, ?, 'internal-demo-admin',
        'internal-demo-teacher', 'class', ?, 1, 1, ?, ?, 1
      )
    `).run(organizationId, organizationId, classId, now, now)
  } finally {
    identity.close()
  }
}

function seedStage3SplitIdentities(databasePath, password) {
  const identity = createIdentityModule({
    databasePath,
    sessionSecret: randomBytes(48).toString('base64url'),
    cookieSecure: false,
  })
  try {
    identity.service.importSeed({
      workspaces: [{
        id: platformWorkspaceId,
        organizationId,
        code: 'platform-ops',
        name: '读伴平台技术运维',
        scopeType: 'platform',
        scopeId: 'readmate-platform',
      }],
      users: [
        { id: 'internal-school-admin', organizationId, username: 'internal-school-admin', displayName: '内部联调学校管理员' },
        { id: 'internal-ops-admin', organizationId, username: 'internal-ops-admin', displayName: '内部联调运营管理员' },
      ],
      workspaceMemberships: [
        { id: 'membership-internal-school-admin', userId: 'internal-school-admin', workspaceId: schoolWorkspaceId },
        { id: 'membership-internal-ops-admin', userId: 'internal-ops-admin', workspaceId: platformWorkspaceId },
      ],
      roleAssignments: [
        {
          id: 'role-internal-school-admin', organizationId, userId: 'internal-school-admin', workspaceId: schoolWorkspaceId,
          roleCode: 'school_admin', scopeType: 'school', scopeId: organizationId,
        },
        {
          id: 'role-internal-ops-admin', organizationId, userId: 'internal-ops-admin', workspaceId: platformWorkspaceId,
          roleCode: 'platform_ops', scopeType: 'platform', scopeId: 'readmate-platform',
        },
      ],
      credentials: [
        { id: 'credential-internal-school-admin', userId: 'internal-school-admin', passwordHash: hashPassword(password) },
        { id: 'credential-internal-ops-admin', userId: 'internal-ops-admin', passwordHash: hashPassword(password) },
      ],
    })
  } finally {
    identity.close()
  }
}

test('内部演示初始化升级稳定师生校长身份并保留运营边界', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-bootstrap-identity-split-'))
  const databasePath = join(directory, 'identity.sqlite')
  const password = randomBytes(24).toString('base64url')
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  seedLegacySharedAdmin(databasePath, password)
  seedStage3SplitIdentities(databasePath, password)

  const result = await bootstrapInternalDemo({
    databasePath,
    manifestPath: join(directory, 'unused-manifest.json'),
    publicRoot: join(directory, 'public'),
    password,
    catalogImporter: async () => ({ imported: [], unchanged: [], publicRoot: join(directory, 'public') }),
  })

  assert.deepEqual(result.users.map((user) => user.username), [
    'internal-student',
    'internal-teacher-li',
    'internal-teacher-wang',
    'internal-principal',
    'internal-ops-admin',
  ])
  assert.equal(result.schoolWorkspaceId, schoolWorkspaceId)
  assert.equal(result.platformWorkspaceId, platformWorkspaceId)

  const interveningIdentity = createIdentityModule({
    databasePath,
    sessionSecret: randomBytes(48).toString('base64url'),
    cookieSecure: false,
  })
  try {
    interveningIdentity.database.prepare(`
      UPDATE safety_handlers SET active = 0
      WHERE id = 'internal-demo-class-safety-handler'
    `).run()
  } finally {
    interveningIdentity.close()
  }
  await bootstrapInternalDemo({
    databasePath,
    manifestPath: join(directory, 'unused-manifest.json'),
    publicRoot: join(directory, 'public'),
    password,
    rotateExistingCredentials: true,
    catalogImporter: async () => ({ imported: [], unchanged: [], publicRoot: join(directory, 'public') }),
  })

  const identity = createIdentityModule({
    databasePath,
    sessionSecret: randomBytes(48).toString('base64url'),
    cookieSecure: false,
  })
  try {
    assert.deepEqual(
      identity.database.prepare(`
        SELECT id, status FROM users
        WHERE id IN ('internal-demo-admin', 'internal-demo-teacher', 'internal-school-admin', 'internal-teacher-li', 'internal-teacher-wang', 'internal-principal', 'internal-ops-admin')
        ORDER BY id
      `).all().map((row) => ({ ...row })),
      [
        { id: 'internal-demo-admin', status: 'disabled' },
        { id: 'internal-demo-teacher', status: 'disabled' },
        { id: 'internal-ops-admin', status: 'active' },
        { id: 'internal-principal', status: 'active' },
        { id: 'internal-school-admin', status: 'disabled' },
        { id: 'internal-teacher-li', status: 'active' },
        { id: 'internal-teacher-wang', status: 'active' },
      ],
    )
    assert.equal(identity.database.prepare(`
      SELECT COUNT(*) AS count FROM workspace_memberships
      WHERE user_id = 'internal-demo-admin' AND status = 'active'
    `).get().count, 0)
    assert.equal(identity.database.prepare(`
      SELECT COUNT(*) AS count FROM role_assignments
      WHERE user_id = 'internal-demo-admin' AND status = 'active'
    `).get().count, 0)
    assert.equal(identity.database.prepare(`
      SELECT COUNT(*) AS count FROM sessions
      WHERE user_id = 'internal-demo-admin' AND revoked_at IS NULL
    `).get().count, 0)
    assert.equal(identity.database.prepare(`
      SELECT COUNT(*) AS count FROM safety_handlers
      WHERE (user_id = 'internal-demo-admin' OR actor_id_at_creation = 'internal-demo-admin') AND active = 1
    `).get().count, 0)
    const rotatedCredentials = identity.database.prepare(`
      SELECT user_id, password_hash FROM credentials
      WHERE user_id IN ('internal-demo-student', 'internal-teacher-li', 'internal-teacher-wang', 'internal-principal', 'internal-ops-admin')
    `).all()
    assert.equal(rotatedCredentials.length, 5)
    assert.equal(rotatedCredentials.every((credential) => verifyPassword(password, credential.password_hash)), true)

    assert.deepEqual(
      identity.database.prepare(`
        SELECT users.id, users.username, users.display_name AS displayName, classes.name AS className
        FROM users
        LEFT JOIN class_memberships ON class_memberships.user_id = users.id AND class_memberships.status = 'active'
        LEFT JOIN classes ON classes.id = class_memberships.class_id
        WHERE users.id IN ('internal-demo-student', 'internal-teacher-li', 'internal-teacher-wang')
        ORDER BY users.id
      `).all().map((row) => ({ ...row })),
      [
        { id: 'internal-demo-student', username: 'internal-student', displayName: '林小竹', className: '三年级一班' },
        { id: 'internal-teacher-li', username: 'internal-teacher-li', displayName: '李老师', className: '三年级一班' },
        { id: 'internal-teacher-wang', username: 'internal-teacher-wang', displayName: '王老师', className: '三年级一班' },
      ],
    )
    const schoolAdmin = identity.service.getUser('internal-principal')
    assert.equal(schoolAdmin.displayName, '陈校长')
    const schoolWorkspace = identity.service.resolveWorkspace(schoolAdmin.id, schoolWorkspaceId)
    const opsAdmin = identity.service.getUser('internal-ops-admin')
    const platformWorkspace = identity.service.resolveWorkspace(opsAdmin.id, platformWorkspaceId)
    assert.ok(schoolWorkspace)
    assert.ok(platformWorkspace)
    assert.equal(identity.service.resolveWorkspace(schoolAdmin.id, platformWorkspaceId), null)
    assert.equal(identity.service.resolveWorkspace(opsAdmin.id, schoolWorkspaceId), null)
    assert.equal(identity.service.authorize({
      actor: schoolAdmin,
      workspace: schoolWorkspace,
      action: 'safety.accept',
      resourceScope: { type: 'school', id: organizationId, organizationId },
    }), true)
    assert.equal(identity.service.authorize({
      actor: schoolAdmin,
      workspace: schoolWorkspace,
      action: 'audit.read_platform',
      resourceScope: { type: 'platform', id: 'readmate-platform', organizationId },
    }), false)
    assert.equal(identity.service.authorize({
      actor: opsAdmin,
      workspace: platformWorkspace,
      action: 'audit.read_platform',
      resourceScope: { type: 'platform', id: 'readmate-platform', organizationId: 'another-school' },
    }), true)
    assert.equal(identity.service.authorize({
      actor: opsAdmin,
      workspace: platformWorkspace,
      action: 'safety.accept',
      resourceScope: { type: 'school', id: organizationId, organizationId },
    }), false)
    assert.deepEqual(
      identity.database.prepare(`
        SELECT user_id, scope_type, scope_id, handler_level
        FROM safety_handlers
        WHERE active = 1
        ORDER BY handler_level, user_id
      `).all().map((row) => ({ ...row })),
      [
        { user_id: 'internal-teacher-li', scope_type: 'class', scope_id: classId, handler_level: 1 },
        { user_id: 'internal-teacher-wang', scope_type: 'class', scope_id: classId, handler_level: 2 },
        { user_id: 'internal-principal', scope_type: 'school', scope_id: organizationId, handler_level: 3 },
      ],
    )
  } finally {
    identity.close()
  }
})
