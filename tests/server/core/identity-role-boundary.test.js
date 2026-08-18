import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { hashPassword } from '../../../server/auth/password.js'
import { createIdentityTestApp } from '../../../server/domains/identity/index.js'

function createTemporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-role-boundary-'))
  return { directory, filename: join(directory, 'roles.sqlite') }
}

function removeTemporaryDatabase(database) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const candidate = `${database.filename}${suffix}`
    if (existsSync(candidate)) {
      unlinkSync(candidate)
    }
  }
  rmdirSync(database.directory)
}

function createTwoSchoolSeed() {
  const organizationAId = randomUUID()
  const organizationBId = randomUUID()
  const adminAId = randomUUID()
  const adminBId = randomUUID()
  const targetAId = randomUUID()
  const targetBId = randomUUID()
  const workspaceAId = randomUUID()
  const workspaceBId = randomUUID()
  const password = randomBytes(32).toString('base64url')
  const passwordHash = hashPassword(password)
  const suffix = randomUUID()
  const users = [
    { id: adminAId, organizationId: organizationAId, username: `admin-a-${suffix}`, displayName: 'admin-a' },
    { id: adminBId, organizationId: organizationBId, username: `admin-b-${suffix}`, displayName: 'admin-b' },
    { id: targetAId, organizationId: organizationAId, username: `target-a-${suffix}`, displayName: 'target-a' },
    { id: targetBId, organizationId: organizationBId, username: `target-b-${suffix}`, displayName: 'target-b' },
  ]

  return {
    organizationAId,
    organizationBId,
    adminAId,
    adminBId,
    targetAId,
    targetBId,
    workspaceAId,
    workspaceBId,
    password,
    adminAUsername: users[0].username,
    adminBUsername: users[1].username,
    seed: {
      organizations: [
        { id: organizationAId, name: `school-a-${suffix}` },
        { id: organizationBId, name: `school-b-${suffix}` },
      ],
      users,
      workspaces: [
        {
          id: workspaceAId,
          organizationId: organizationAId,
          code: 'school-admin',
          name: `workspace-a-${suffix}`,
          scopeType: 'school',
          scopeId: organizationAId,
        },
        {
          id: workspaceBId,
          organizationId: organizationBId,
          code: 'school-admin',
          name: `workspace-b-${suffix}`,
          scopeType: 'school',
          scopeId: organizationBId,
        },
      ],
      workspaceMemberships: [
        { id: randomUUID(), userId: adminAId, workspaceId: workspaceAId },
        { id: randomUUID(), userId: adminBId, workspaceId: workspaceBId },
      ],
      roleAssignments: [
        {
          id: randomUUID(),
          organizationId: organizationAId,
          userId: adminAId,
          workspaceId: workspaceAId,
          roleCode: 'school_admin',
          scopeType: 'school',
          scopeId: organizationAId,
        },
        {
          id: randomUUID(),
          organizationId: organizationBId,
          userId: adminBId,
          workspaceId: workspaceBId,
          roleCode: 'school_admin',
          scopeType: 'school',
          scopeId: organizationBId,
        },
      ],
      credentials: users.map((user) => ({ id: randomUUID(), userId: user.id, passwordHash })),
    },
  }
}

async function requestJson(baseUrl, path, options = {}) {
  const headers = new Headers(options.headers)
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  return {
    status: response.status,
    payload: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null,
  }
}

async function login(baseUrl, schoolCode, loginName, password, key) {
  return requestJson(baseUrl, '/auth/login', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { schoolCode, loginName, password },
  })
}

async function updateUser(baseUrl, fixture, userId, cookie, workspaceId, key, displayName, version = 1) {
  return requestJson(baseUrl, `/users/${userId}`, {
    method: 'PATCH',
    headers: {
      Cookie: cookie,
      'X-Workspace-Id': workspaceId,
      'Idempotency-Key': key,
    },
    body: { displayName, version },
  })
}

test('role assignments stay inside their organization for SQLite writes and HTTP target access', async (t) => {
  const temporary = createTemporaryDatabase()
  const fixture = createTwoSchoolSeed()
  const { app, module } = createIdentityTestApp({
    databasePath: temporary.filename,
    sessionSecret: randomBytes(48).toString('base64url'),
    cookieSecure: false,
  })
  module.service.importSeed(fixture.seed)
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    module.close()
    removeTemporaryDatabase(temporary)
  })

  const loginA = await login(baseUrl, fixture.organizationAId, fixture.adminAUsername, fixture.password, 'role-boundary-login-a')
  const loginB = await login(baseUrl, fixture.organizationBId, fixture.adminBUsername, fixture.password, 'role-boundary-login-b')
  assert.equal(loginA.status, 200)
  assert.equal(loginB.status, 200)

  const ownSchoolRead = await requestJson(baseUrl, `/users/${fixture.targetBId}`, {
    headers: { Cookie: loginB.cookie, 'X-Workspace-Id': fixture.workspaceBId },
  })
  assert.equal(ownSchoolRead.status, 200)
  const otherSchoolRead = await requestJson(baseUrl, `/users/${fixture.targetAId}`, {
    headers: { Cookie: loginB.cookie, 'X-Workspace-Id': fixture.workspaceBId },
  })
  assert.equal(otherSchoolRead.status, 404)
  assert.equal(otherSchoolRead.payload.error.code, 'RESOURCE_NOT_FOUND')
  assert.equal(otherSchoolRead.payload.error.message, '账号不存在')

  const columns = module.database.prepare('PRAGMA table_info(role_assignments)').all().map((record) => record.name)
  const now = new Date().toISOString()
  if (columns.includes('organization_id')) {
    const insertOrganizationBoundAssignment = module.database.prepare(`
      INSERT INTO role_assignments (
        id, organization_id, user_id, workspace_id, role_code, scope_type, scope_id,
        status, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, 'school_admin', 'school', ?, 'active', ?, ?, 1)
    `)
    assert.throws(
      () =>
        insertOrganizationBoundAssignment.run(
          randomUUID(),
          fixture.organizationBId,
          fixture.adminAId,
          fixture.workspaceAId,
          fixture.organizationBId,
          now,
          now,
        ),
      /same organization|FOREIGN KEY/,
    )
    module.database.exec(`
      DROP TRIGGER role_assignments_require_same_organization_insert;
      DROP TRIGGER role_assignments_require_same_organization_update;
      PRAGMA foreign_keys = OFF;
    `)
    insertOrganizationBoundAssignment.run(
      randomUUID(),
      fixture.organizationBId,
      fixture.adminAId,
      fixture.workspaceAId,
      fixture.organizationBId,
      now,
      now,
    )
    module.database.exec('PRAGMA foreign_keys = ON;')
  } else {
    module.database
      .prepare(`
        INSERT INTO role_assignments (
          id, user_id, workspace_id, role_code, scope_type, scope_id,
          status, created_at, updated_at, version
        ) VALUES (?, ?, ?, 'school_admin', 'school', ?, 'active', ?, ?, 1)
      `)
      .run(randomUUID(), fixture.adminAId, fixture.workspaceAId, fixture.organizationBId, now, now)
  }

  const forgedRead = await requestJson(baseUrl, `/users/${fixture.targetBId}`, {
    headers: { Cookie: loginA.cookie, 'X-Workspace-Id': fixture.workspaceAId },
  })
  assert.equal(forgedRead.status, 404)
  assert.equal(forgedRead.payload.error.code, 'RESOURCE_NOT_FOUND')
  assert.equal(forgedRead.payload.error.message, '账号不存在')
  const forgedUpdate = await updateUser(
    baseUrl,
    fixture,
    fixture.targetBId,
    loginA.cookie,
    fixture.workspaceAId,
    'role-boundary-forged-update',
    'must-not-change',
  )
  assert.equal(forgedUpdate.status, 404)
  assert.equal(forgedUpdate.payload.error.code, 'RESOURCE_NOT_FOUND')
  assert.equal(forgedUpdate.payload.error.message, '账号不存在')
  assert.equal(module.database.prepare('SELECT display_name FROM users WHERE id = ?').get(fixture.targetBId).display_name, 'target-b')

  module.database
    .prepare("UPDATE workspaces SET status = 'disabled', version = version + 1, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), fixture.workspaceBId)
  const disabledWorkspace = await requestJson(baseUrl, `/users/${fixture.targetBId}`, {
    headers: { Cookie: loginB.cookie, 'X-Workspace-Id': fixture.workspaceBId },
  })
  assert.equal(disabledWorkspace.status, 403)

  module.database
    .prepare("UPDATE workspaces SET status = 'active', version = version + 1, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), fixture.workspaceBId)
  module.database
    .prepare("UPDATE organizations SET status = 'disabled', version = version + 1, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), fixture.organizationBId)
  const disabledOrganization = await requestJson(baseUrl, `/users/${fixture.targetBId}`, {
    headers: { Cookie: loginB.cookie, 'X-Workspace-Id': fixture.workspaceBId },
  })
  assert.equal(disabledOrganization.status, 401)
})
