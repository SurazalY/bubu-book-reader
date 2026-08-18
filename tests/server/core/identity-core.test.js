import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { hashPassword, MAX_PASSWORD_LENGTH } from '../../../server/auth/password.js'
import { MAX_SESSION_TTL_MS } from '../../../server/auth/session.js'
import { openSqliteDatabase, withTransaction } from '../../../server/db/database.js'
import { HttpError } from '../../../server/db/errors.js'
import { listMigrationFiles, runMigrations } from '../../../server/db/migrate.js'
import {
  createIdempotencyRequestHash,
  executeIdempotent,
  executeIdempotentAsync,
  reconcileIdempotency,
  stableSerialize,
} from '../../../server/db/reliability.js'
import { importIdentitySeed, SeedConflictError } from '../../../server/db/seed.js'
import { createPermissionEvaluator } from '../../../server/domains/identity/permissions.js'
import {
  createIdentityTestApp,
  defaultMigrationDirectory,
} from '../../../server/domains/identity/index.js'

const importSeedCli = fileURLToPath(new URL('../../../server/db/import-seed.js', import.meta.url))
const projectRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))

function createTemporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-b-core-'))
  return {
    directory,
    filename: join(directory, 'core.sqlite'),
  }
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

function createSeed() {
  const suffix = randomUUID()
  const schoolId = randomUUID()
  const platformOrganizationId = randomUUID()
  const gradeAId = randomUUID()
  const gradeBId = randomUUID()
  const classAId = randomUUID()
  const classBId = randomUUID()
  const studentId = randomUUID()
  const otherStudentId = randomUUID()
  const classTeacherId = randomUUID()
  const gradeManagerId = randomUUID()
  const schoolAdminId = randomUUID()
  const operatorId = randomUUID()
  const studentWorkspaceId = randomUUID()
  const classWorkspaceId = randomUUID()
  const gradeWorkspaceId = randomUUID()
  const schoolWorkspaceId = randomUUID()
  const platformWorkspaceId = randomUUID()
  const password = randomBytes(32).toString('base64url')
  const passwordHash = hashPassword(password)

  const studentUsername = `student-${suffix}`
  const otherStudentUsername = `student-other-${suffix}`
  const classTeacherUsername = `teacher-${suffix}`
  const gradeManagerUsername = `grade-${suffix}`
  const schoolAdminUsername = `school-${suffix}`
  const operatorUsername = `operator-${suffix}`

  const schoolUsers = [
    [studentId, studentUsername, `student-${suffix}`],
    [otherStudentId, otherStudentUsername, `student-other-${suffix}`],
    [classTeacherId, classTeacherUsername, `teacher-${suffix}`],
    [gradeManagerId, gradeManagerUsername, `grade-${suffix}`],
    [schoolAdminId, schoolAdminUsername, `school-${suffix}`],
  ]

  return {
    schoolId,
    platformOrganizationId,
    gradeAId,
    gradeBId,
    classAId,
    classBId,
    studentId,
    otherStudentId,
    classTeacherId,
    gradeManagerId,
    schoolAdminId,
    operatorId,
    studentWorkspaceId,
    classWorkspaceId,
    gradeWorkspaceId,
    schoolWorkspaceId,
    platformWorkspaceId,
    password,
    studentUsername,
    otherStudentUsername,
    classTeacherUsername,
    gradeManagerUsername,
    schoolAdminUsername,
    operatorUsername,
    seed: {
      organizations: [
        { id: schoolId, name: `school-${suffix}` },
        { id: platformOrganizationId, name: `platform-${suffix}` },
      ],
      users: [
        ...schoolUsers.map(([id, username, displayName]) => ({
          id,
          organizationId: schoolId,
          username,
          displayName,
        })),
        {
          id: operatorId,
          organizationId: platformOrganizationId,
          username: operatorUsername,
          displayName: `operator-${suffix}`,
        },
      ],
      workspaces: [
        {
          id: studentWorkspaceId,
          organizationId: schoolId,
          code: 'class-teacher',
          name: `student-space-${suffix}`,
          scopeType: 'own',
          scopeId: studentId,
        },
        {
          id: classWorkspaceId,
          organizationId: schoolId,
          code: 'class-teacher',
          name: `class-space-${suffix}`,
          scopeType: 'class',
          scopeId: classAId,
        },
        {
          id: gradeWorkspaceId,
          organizationId: schoolId,
          code: 'grade-admin',
          name: `grade-space-${suffix}`,
          scopeType: 'grade',
          scopeId: gradeAId,
        },
        {
          id: schoolWorkspaceId,
          organizationId: schoolId,
          code: 'school-admin',
          name: `school-space-${suffix}`,
          scopeType: 'school',
          scopeId: schoolId,
        },
        {
          id: platformWorkspaceId,
          organizationId: platformOrganizationId,
          code: 'platform-ops',
          name: `platform-space-${suffix}`,
          scopeType: 'platform',
          scopeId: 'platform',
        },
      ],
      workspaceMemberships: [
        { id: randomUUID(), userId: studentId, workspaceId: studentWorkspaceId },
        { id: randomUUID(), userId: classTeacherId, workspaceId: classWorkspaceId },
        { id: randomUUID(), userId: gradeManagerId, workspaceId: gradeWorkspaceId },
        { id: randomUUID(), userId: schoolAdminId, workspaceId: schoolWorkspaceId },
        { id: randomUUID(), userId: operatorId, workspaceId: platformWorkspaceId },
      ],
      roleAssignments: [
        {
          id: randomUUID(),
          organizationId: schoolId,
          userId: studentId,
          workspaceId: studentWorkspaceId,
          roleCode: 'student',
          scopeType: 'own',
          scopeId: studentId,
        },
        {
          id: randomUUID(),
          organizationId: schoolId,
          userId: classTeacherId,
          workspaceId: classWorkspaceId,
          roleCode: 'teacher',
          scopeType: 'class',
          scopeId: classAId,
        },
        {
          id: randomUUID(),
          organizationId: schoolId,
          userId: gradeManagerId,
          workspaceId: gradeWorkspaceId,
          roleCode: 'grade_manager',
          scopeType: 'grade',
          scopeId: gradeAId,
        },
        {
          id: randomUUID(),
          organizationId: schoolId,
          userId: schoolAdminId,
          workspaceId: schoolWorkspaceId,
          roleCode: 'school_admin',
          scopeType: 'school',
          scopeId: schoolId,
        },
        {
          id: randomUUID(),
          organizationId: platformOrganizationId,
          userId: operatorId,
          workspaceId: platformWorkspaceId,
          roleCode: 'platform_ops',
          scopeType: 'platform',
          scopeId: 'platform',
        },
      ],
      classes: [
        {
          id: classAId,
          organizationId: schoolId,
          gradeId: gradeAId,
          name: `class-a-${suffix}`,
        },
        {
          id: classBId,
          organizationId: schoolId,
          gradeId: gradeBId,
          name: `class-b-${suffix}`,
        },
      ],
      classMemberships: [
        { id: randomUUID(), classId: classAId, userId: studentId, membershipRole: 'student' },
        { id: randomUUID(), classId: classBId, userId: otherStudentId, membershipRole: 'student' },
        { id: randomUUID(), classId: classAId, userId: classTeacherId, membershipRole: 'teacher' },
      ],
      credentials: [
        ...[studentId, otherStudentId, classTeacherId, gradeManagerId, schoolAdminId, operatorId].map((userId) => ({
          id: randomUUID(),
          userId,
          passwordHash,
        })),
      ],
    },
  }
}

async function startHarness(t) {
  const database = createTemporaryDatabase()
  const { app, module } = createIdentityTestApp({
    databasePath: database.filename,
    sessionSecret: randomBytes(48).toString('base64url'),
    cookieSecure: false,
  })
  const fixture = createSeed()
  module.service.importSeed(fixture.seed)
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
  })

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    module.close()
    removeTemporaryDatabase(database)
  })

  return {
    fixture,
    module,
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
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
    setCookie: response.headers.get('set-cookie') ?? '',
    etag: response.headers.get('etag'),
  }
}

async function login(baseUrl, schoolCode, loginName, password, key) {
  return requestJson(baseUrl, '/auth/login', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: { schoolCode, loginName, password },
  })
}

async function updateUser(baseUrl, userId, cookie, workspaceId, key, displayName, version) {
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

test('migrations apply once and replay without mutation against a temporary SQLite file', () => {
  const temporary = createTemporaryDatabase()
  const database = openSqliteDatabase(temporary.filename)
  try {
    const expectedMigrationCount = listMigrationFiles(defaultMigrationDirectory()).length
    const first = runMigrations(database, defaultMigrationDirectory())
    const second = runMigrations(database, defaultMigrationDirectory())
    assert.equal(first.applied.length, expectedMigrationCount)
    assert.equal(second.applied.length, 0)
    assert.equal(second.alreadyApplied.length, expectedMigrationCount)
  } finally {
    database.close()
    removeTemporaryDatabase(temporary)
  }
})

test('004 migrates 003 idempotency records to pending and succeeded without rewriting history', () => {
  const temporary = createTemporaryDatabase()
  const migrationDirectory = join(temporary.directory, 'migrations')
  const sourceDirectory = defaultMigrationDirectory()
  mkdirSync(migrationDirectory)
  for (const filename of readdirSync(sourceDirectory).filter((filename) => /^00[0-3]_/.test(filename))) {
    copyFileSync(join(sourceDirectory, filename), join(migrationDirectory, filename))
  }
  const database = openSqliteDatabase(temporary.filename)
  try {
    const initial = runMigrations(database, migrationDirectory)
    assert.equal(initial.applied.length, 4)
    const now = new Date().toISOString()
    const requestHash = createIdempotencyRequestHash({ operation: 'legacy-migration' })
    const insertLegacyRecord = database.prepare(`
      INSERT INTO idempotency_records (
        id, scope_key, idempotency_key, request_hash, status_code, response_json, session_id,
        created_at, updated_at, version, state, lease_token, lease_expires_at, attempt_count
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?, ?, 1)
    `)
    insertLegacyRecord.run(
      randomUUID(),
      'test.migration',
      'legacy-completed-key',
      requestHash,
      200,
      JSON.stringify({ data: { completed: true } }),
      now,
      now,
      'completed',
      null,
      null,
    )
    insertLegacyRecord.run(
      randomUUID(),
      'test.migration',
      'legacy-processing-key',
      createIdempotencyRequestHash({ operation: 'legacy-pending' }),
      202,
      JSON.stringify({ data: { status: 'processing' } }),
      now,
      now,
      'processing',
      'legacy-lease',
      new Date(Date.now() + 30_000).toISOString(),
    )

    const migration004 = '004_idempotency_lifecycle_and_scope_integrity.sql'
    copyFileSync(join(sourceDirectory, migration004), join(migrationDirectory, migration004))
    const upgraded = runMigrations(database, migrationDirectory)
    assert.deepEqual(upgraded.applied, [migration004])
    const states = database
      .prepare('SELECT idempotency_key, state, external_effect_started FROM idempotency_records ORDER BY idempotency_key')
      .all()
      .map((record) => ({ ...record }))
    assert.deepEqual(states, [
      { idempotency_key: 'legacy-completed-key', state: 'succeeded', external_effect_started: 0 },
      { idempotency_key: 'legacy-processing-key', state: 'pending', external_effect_started: 0 },
    ])
  } finally {
    database.close()
    if (existsSync(migrationDirectory)) {
      for (const filename of readdirSync(migrationDirectory)) {
        unlinkSync(join(migrationDirectory, filename))
      }
      rmdirSync(migrationDirectory)
    }
    removeTemporaryDatabase(temporary)
  }
})

test('HTTP login persists sessions, protects the login idempotency hash, and enforces input bounds', async (t) => {
  const { fixture, baseUrl, module } = await startHarness(t)
  const key = 'login-student-success'
  const response = await login(baseUrl, fixture.schoolId, fixture.studentUsername, fixture.password, key)

  assert.equal(response.status, 200)
  assert.equal(response.payload.data.user.id, fixture.studentId)
  assert.equal(response.payload.data.workspaces[0].id, fixture.studentWorkspaceId)
  assert.equal(response.payload.data.activeWorkspaceId, fixture.studentWorkspaceId)
  assert.equal(response.payload.data.navigation.defaultPath, '/student/home')
  assert.deepEqual(response.payload.data.navigation.entries, [
    { kind: 'student', path: '/student/home', workspaceId: fixture.studentWorkspaceId },
  ])
  assert.ok(response.cookie)
  assert.match(response.setCookie, /HttpOnly/)
  assert.equal(module.database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 1)
  const session = await requestJson(baseUrl, '/session', { headers: { Cookie: response.cookie } })
  assert.equal(session.status, 200)
  assert.equal(session.payload.data.navigation.defaultPath, '/student/home')

  const persistedRequest = module.database
    .prepare('SELECT request_hash FROM idempotency_records WHERE idempotency_key = ?')
    .get(key)
  const unsafePasswordHash = createHash('sha256')
    .update(stableSerialize({ username: fixture.studentUsername, password: fixture.password }), 'utf8')
    .digest('hex')
  assert.notEqual(persistedRequest.request_hash, unsafePasswordHash)

  const health = await requestJson(baseUrl, '/health')
  assert.equal(health.status, 200)
  assert.equal(health.payload.data.database, 'sqlite')
  assert.equal(health.payload.data.migrations, listMigrationFiles(defaultMigrationDirectory()).length)

  const excessivePassword = 'x'.repeat(MAX_PASSWORD_LENGTH + 1)
  const excessive = await login(baseUrl, fixture.schoolId, fixture.studentUsername, excessivePassword, 'login-password-too-long')
  assert.equal(excessive.status, 400)
  assert.equal(excessive.payload.error.code, 'VALIDATION_FAILED')
  assert.equal(module.database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 1)

  const failedPassword = randomBytes(32).toString('base64url')
  const failed = await login(baseUrl, fixture.schoolId, fixture.studentUsername, failedPassword, 'login-student-failure')
  assert.equal(failed.status, 401)
  assert.equal(failed.payload.error.code, 'AUTH_REQUIRED')
  assert.equal(module.database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 1)
  assert.equal(
    module.database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'auth.login.failed'").get().count,
    1,
  )
  assert.throws(
    () => module.database.prepare("UPDATE audit_events SET outcome = 'changed'").run(),
    /append-only/,
  )

  const logoutHeaders = {
    Cookie: response.cookie,
    'Idempotency-Key': 'logout-student-success',
  }
  const logout = await requestJson(baseUrl, '/auth/logout', { method: 'POST', headers: logoutHeaders })
  assert.equal(logout.status, 200)
  assert.equal(logout.payload.data.loggedOut, true)

  const logoutReplay = await requestJson(baseUrl, '/auth/logout', { method: 'POST', headers: logoutHeaders })
  assert.equal(logoutReplay.status, 200)
  assert.equal(logoutReplay.payload.meta.replayed, true)

  const endedSession = await requestJson(baseUrl, '/session', { headers: { Cookie: response.cookie } })
  assert.equal(endedSession.status, 401)
  assert.equal(endedSession.payload.error.code, 'SESSION_EXPIRED')
})

test('disabled organizations block fresh login, replayed login, existing sessions, and school workspaces', async (t) => {
  const { fixture, baseUrl, module } = await startHarness(t)
  const key = 'login-before-organization-disable'
  const activeLogin = await login(baseUrl, fixture.schoolId, fixture.studentUsername, fixture.password, key)
  assert.equal(activeLogin.status, 200)

  module.database
    .prepare('UPDATE organizations SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?')
    .run('disabled', new Date().toISOString(), fixture.schoolId)

  const freshLogin = await login(baseUrl, fixture.schoolId, fixture.studentUsername, fixture.password, 'login-after-organization-disable')
  assert.equal(freshLogin.status, 401)
  assert.equal(freshLogin.payload.error.code, 'AUTH_REQUIRED')

  const replayedLogin = await login(baseUrl, fixture.schoolId, fixture.studentUsername, fixture.password, key)
  assert.equal(replayedLogin.status, 401)
  assert.equal(replayedLogin.payload.error.code, 'AUTH_REQUIRED')

  const existingSession = await requestJson(baseUrl, '/session', { headers: { Cookie: activeLogin.cookie } })
  assert.equal(existingSession.status, 401)
  assert.equal(existingSession.payload.error.code, 'AUTH_REQUIRED')
  assert.deepEqual(module.service.listWorkspaces(fixture.studentId), [])
  assert.equal(module.service.resolveWorkspace(fixture.studentId, fixture.studentWorkspaceId), null)

  const platformLogin = await login(baseUrl, fixture.platformOrganizationId, fixture.operatorUsername, fixture.password, 'platform-login-after-school-disable')
  assert.equal(platformLogin.status, 200)
  assert.equal(platformLogin.payload.data.workspaces[0].id, fixture.platformWorkspaceId)
})

test('a legacy forged cross-organization class membership cannot expand class scope or authorize HTTP access', async (t) => {
  const { fixture, baseUrl, module } = await startHarness(t)
  const foreignOrganizationId = randomUUID()
  const foreignUserId = randomUUID()
  const now = new Date().toISOString()
  const foreignUsername = `foreign-user-${randomUUID()}`
  module.database
    .prepare('INSERT INTO organizations (id, name, school_code, status, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, 1)')
    .run(foreignOrganizationId, `foreign-${randomUUID()}`, `foreign-${randomUUID().slice(0, 8)}`, 'active', now, now)
  module.database
    .prepare(`
      INSERT INTO users (id, organization_id, username, display_name, status, created_at, updated_at, version, login_name, account_code)
      VALUES (?, ?, ?, ?, 'active', ?, ?, 1, ?, ?)
    `)
    .run(foreignUserId, foreignOrganizationId, foreignUsername, foreignUsername, now, now, foreignUsername, `F${randomUUID().slice(0, 7)}`)
  const insertForgedMembership = module.database
    .prepare(`
      INSERT INTO class_memberships (id, class_id, user_id, membership_role, status, created_at, updated_at, version)
      VALUES (?, ?, ?, 'student', 'active', ?, ?, 1)
    `)
  assert.throws(
    () => insertForgedMembership.run(randomUUID(), fixture.classAId, foreignUserId, now, now),
    /same organization/,
  )
  module.database.exec(`
    DROP TRIGGER class_memberships_require_active_same_organization_insert;
    DROP TRIGGER class_memberships_require_active_same_organization_update;
  `)
  insertForgedMembership.run(randomUUID(), fixture.classAId, foreignUserId, now, now)

  const scope = module.service.getUserScope(foreignUserId)
  assert.equal(scope.classIds.includes(fixture.classAId), false)

  const teacherLogin = await login(baseUrl, fixture.schoolId, fixture.classTeacherUsername, fixture.password, 'login-cross-org-class-teacher')
  const read = await requestJson(baseUrl, `/users/${foreignUserId}`, {
    headers: {
      Cookie: teacherLogin.cookie,
      'X-Workspace-Id': fixture.classWorkspaceId,
    },
  })
  assert.equal(read.status, 404)
  assert.equal(read.payload.error.code, 'RESOURCE_NOT_FOUND')

  const update = await updateUser(
    baseUrl,
    foreignUserId,
    teacherLogin.cookie,
    fixture.classWorkspaceId,
    'cross-org-class-update',
    `should-not-update-${randomUUID()}`,
    1,
  )
  assert.equal(update.status, 404)
  assert.equal(update.payload.error.code, 'RESOURCE_NOT_FOUND')
})

test('class, grade, own, school, and platform scopes use persisted memberships without widening student actions', async (t) => {
  const { fixture, baseUrl, module } = await startHarness(t)
  const studentScope = module.service.getUserScope(fixture.studentId)
  assert.equal(studentScope.ownerId, fixture.studentId)
  assert.equal(studentScope.organizationId, fixture.schoolId)
  assert.deepEqual(studentScope.classIds, [fixture.classAId])
  assert.deepEqual(studentScope.gradeIds, [fixture.gradeAId])
  const studentLogin = await login(baseUrl, fixture.schoolId, fixture.studentUsername, fixture.password, 'login-student-permission')
  const denied = await requestJson(baseUrl, `/users/${fixture.otherStudentId}`, {
    headers: {
      Cookie: studentLogin.cookie,
      'X-Workspace-Id': fixture.studentWorkspaceId,
    },
  })
  assert.equal(denied.status, 403)
  assert.equal(denied.payload.error.code, 'PERMISSION_DENIED')

  const missingWorkspace = await requestJson(baseUrl, `/users/${fixture.otherStudentId}`, {
    headers: { Cookie: studentLogin.cookie },
  })
  assert.equal(missingWorkspace.status, 400)
  assert.equal(missingWorkspace.payload.error.code, 'VALIDATION_FAILED')

  for (const action of ['book.read', 'integration.launch', 'integration.return']) {
    assert.equal(
      module.service.authorize({
        actor: { id: fixture.studentId },
        workspace: { id: fixture.studentWorkspaceId, organizationId: fixture.schoolId },
        action,
        resourceScope: module.service.getUserScope(fixture.studentId),
      }),
      true,
    )
  }

  const teacherLogin = await login(baseUrl, fixture.schoolId, fixture.classTeacherUsername, fixture.password, 'login-class-teacher')
  assert.equal(teacherLogin.payload.data.activeWorkspaceId, fixture.classWorkspaceId)
  assert.equal(teacherLogin.payload.data.navigation.defaultPath, '/console/home')
  assert.deepEqual(teacherLogin.payload.data.navigation.entries, [
    { kind: 'console', path: '/console/home', workspaceId: fixture.classWorkspaceId },
  ])
  const classAllowed = await updateUser(
    baseUrl,
    fixture.studentId,
    teacherLogin.cookie,
    fixture.classWorkspaceId,
    'class-manage-own-class',
    `class-allowed-${randomUUID()}`,
    1,
  )
  assert.equal(classAllowed.status, 200)
  assert.equal(classAllowed.payload.data.version, 2)
  const classDenied = await updateUser(
    baseUrl,
    fixture.otherStudentId,
    teacherLogin.cookie,
    fixture.classWorkspaceId,
    'class-manage-other-class',
    `class-denied-${randomUUID()}`,
    1,
  )
  assert.equal(classDenied.status, 403)

  const gradeLogin = await login(baseUrl, fixture.schoolId, fixture.gradeManagerUsername, fixture.password, 'login-grade-manager')
  const gradeAllowed = await updateUser(
    baseUrl,
    fixture.studentId,
    gradeLogin.cookie,
    fixture.gradeWorkspaceId,
    'grade-manage-own-grade',
    `grade-allowed-${randomUUID()}`,
    2,
  )
  assert.equal(gradeAllowed.status, 200)
  assert.equal(gradeAllowed.payload.data.version, 3)
  const gradeDenied = await updateUser(
    baseUrl,
    fixture.otherStudentId,
    gradeLogin.cookie,
    fixture.gradeWorkspaceId,
    'grade-manage-other-grade',
    `grade-denied-${randomUUID()}`,
    1,
  )
  assert.equal(gradeDenied.status, 403)

  const schoolLogin = await login(baseUrl, fixture.schoolId, fixture.schoolAdminUsername, fixture.password, 'login-school-admin')
  const schoolAllowed = await updateUser(
    baseUrl,
    fixture.otherStudentId,
    schoolLogin.cookie,
    fixture.schoolWorkspaceId,
    'school-manage-student',
    `school-allowed-${randomUUID()}`,
    1,
  )
  assert.equal(schoolAllowed.status, 200)
  assert.equal(schoolAllowed.payload.data.version, 2)

  const platformLogin = await login(baseUrl, fixture.platformOrganizationId, fixture.operatorUsername, fixture.password, 'login-platform-operator')
  const platformDisplayName = `platform-allowed-${randomUUID()}`
  const platformAllowed = await updateUser(
    baseUrl,
    fixture.otherStudentId,
    platformLogin.cookie,
    fixture.platformWorkspaceId,
    'platform-manage-student',
    platformDisplayName,
    2,
  )
  assert.equal(platformAllowed.status, 200)
  assert.equal(platformAllowed.payload.data.version, 3)

  const crossOrganizationTimestamp = new Date().toISOString()
  module.database
    .prepare(`
      INSERT INTO workspace_memberships (id, user_id, workspace_id, status, created_at, updated_at, version)
      VALUES (?, ?, ?, 'active', ?, ?, 1)
    `)
    .run(randomUUID(), fixture.operatorId, fixture.studentWorkspaceId, crossOrganizationTimestamp, crossOrganizationTimestamp)
  assert.throws(
    () =>
      module.database
        .prepare(`
          INSERT INTO role_assignments (
            id, organization_id, user_id, workspace_id, role_code, scope_type, scope_id,
            status, created_at, updated_at, version
          ) VALUES (?, ?, ?, ?, 'platform_ops', 'platform', 'platform', 'active', ?, ?, 1)
        `)
        .run(
          randomUUID(),
          fixture.platformOrganizationId,
          fixture.operatorId,
          fixture.studentWorkspaceId,
          crossOrganizationTimestamp,
          crossOrganizationTimestamp,
        ),
    /same organization/,
  )
  const crossOrganizationWorkspace = await requestJson(baseUrl, `/users/${fixture.otherStudentId}`, {
    headers: {
      Cookie: platformLogin.cookie,
      'X-Workspace-Id': fixture.studentWorkspaceId,
    },
  })
  assert.equal(crossOrganizationWorkspace.status, 403)

  const replay = await updateUser(
    baseUrl,
    fixture.otherStudentId,
    platformLogin.cookie,
    fixture.platformWorkspaceId,
    'platform-manage-student',
    platformDisplayName,
    2,
  )
  assert.equal(replay.status, 200)
  assert.equal(replay.payload.meta.replayed, true)

  const idempotencyConflict = await updateUser(
    baseUrl,
    fixture.otherStudentId,
    platformLogin.cookie,
    fixture.platformWorkspaceId,
    'platform-manage-student',
    `conflict-${randomUUID()}`,
    3,
  )
  assert.equal(idempotencyConflict.status, 409)
  assert.equal(idempotencyConflict.payload.error.code, 'IDEMPOTENCY_CONFLICT')

  const versionConflict = await updateUser(
    baseUrl,
    fixture.otherStudentId,
    platformLogin.cookie,
    fixture.platformWorkspaceId,
    'platform-stale-version',
    `stale-${randomUUID()}`,
    1,
  )
  assert.equal(versionConflict.status, 409)
  assert.equal(versionConflict.payload.error.code, 'VERSION_CONFLICT')

  const ownOnly = createPermissionEvaluator({ own_manager: ['account.manage'] })
  const ownAssignment = [
    {
      organizationId: fixture.schoolId,
      workspaceId: fixture.studentWorkspaceId,
      roleCode: 'own_manager',
      scopeType: 'own',
      scopeId: fixture.studentId,
    },
  ]
  assert.equal(
    ownOnly({
      assignments: ownAssignment,
      action: 'account.manage',
      resourceScope: module.service.getUserScope(fixture.studentId),
      actorUserId: fixture.studentId,
      authContext: { workspaceId: fixture.studentWorkspaceId, organizationId: fixture.schoolId },
    }),
    true,
  )
  assert.equal(
    ownOnly({
      assignments: ownAssignment,
      action: 'account.manage',
      resourceScope: module.service.getUserScope(fixture.otherStudentId),
      actorUserId: fixture.studentId,
      authContext: { workspaceId: fixture.studentWorkspaceId, organizationId: fixture.schoolId },
    }),
    false,
  )

  assert.equal(
    module.database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'identity.user.updated'").get().count,
    4,
  )
  assert.equal(module.database.prepare('SELECT COUNT(*) AS count FROM outbox_events').get().count, 4)
})

test('session TTL rejects invalid values before opening the database', () => {
  for (const invalidTtl of [-1, Number.NaN, MAX_SESSION_TTL_MS + 1]) {
    const temporary = createTemporaryDatabase()
    try {
      assert.throws(
        () =>
          createIdentityTestApp({
            databasePath: temporary.filename,
            sessionSecret: randomBytes(48).toString('base64url'),
            sessionTtlMs: invalidTtl,
          }),
        /sessionTtlMs/,
      )
      assert.equal(existsSync(temporary.filename), false)
    } finally {
      removeTemporaryDatabase(temporary)
    }
  }
})

test('seed import is strict on drift and the JSON CLI reports nonzero failure without raw credentials', () => {
  const temporary = createTemporaryDatabase()
  const cliTemporary = createTemporaryDatabase()
  const database = openSqliteDatabase(temporary.filename)
  const fixture = createSeed()
  const seedFile = join(cliTemporary.directory, 'seed.json')
  try {
    runMigrations(database, defaultMigrationDirectory())
    const first = importIdentitySeed(database, fixture.seed)
    const second = importIdentitySeed(database, fixture.seed)
    assert.ok(first.inserted > 0)
    assert.equal(second.inserted, 0)
    assert.ok(second.unchanged > 0)

    const drifted = structuredClone(fixture.seed)
    drifted.users[0].displayName = `drift-${randomUUID()}`
    assert.throws(() => importIdentitySeed(database, drifted), SeedConflictError)
    const rawCredential = structuredClone(fixture.seed)
    rawCredential.credentials[0].password = fixture.password
    assert.throws(() => importIdentitySeed(database, rawCredential), /credential 只接受/)

    writeFileSync(seedFile, JSON.stringify(fixture.seed), 'utf8')

    const cliFirst = spawnSync(process.execPath, [importSeedCli, '--file', seedFile, '--database', cliTemporary.filename], {
      cwd: projectRoot,
      encoding: 'utf8',
    })
    assert.equal(cliFirst.status, 0)
    assert.ok(JSON.parse(cliFirst.stdout).import.inserted > 0)

    const cliReplay = spawnSync(process.execPath, [importSeedCli, '--file', seedFile, '--database', cliTemporary.filename], {
      cwd: projectRoot,
      encoding: 'utf8',
    })
    assert.equal(cliReplay.status, 0)
    assert.equal(JSON.parse(cliReplay.stdout).import.inserted, 0)

    writeFileSync(seedFile, JSON.stringify(drifted), 'utf8')
    const cliConflict = spawnSync(process.execPath, [importSeedCli, '--file', seedFile, '--database', cliTemporary.filename], {
      cwd: projectRoot,
      encoding: 'utf8',
    })
    assert.equal(cliConflict.status, 1)
    assert.match(cliConflict.stderr, /稳定 ID 已存在/)
    assert.equal(cliConflict.stderr.includes(fixture.password), false)
  } finally {
    if (database.isOpen) {
      database.close()
    }
    if (existsSync(seedFile)) {
      unlinkSync(seedFile)
    }
    removeTemporaryDatabase(temporary)
    removeTemporaryDatabase(cliTemporary)
  }
})

test('async idempotency reserves outside external work, replays successes, and recovers expired leases', async () => {
  const temporary = createTemporaryDatabase()
  const database = openSqliteDatabase(temporary.filename)
  try {
    runMigrations(database, defaultMigrationDirectory())

    let releaseFirst
    const firstRelease = new Promise((resolve) => {
      releaseFirst = resolve
    })
    let signalStarted
    const firstStarted = new Promise((resolve) => {
      signalStarted = resolve
    })
    let executions = 0
    const first = executeIdempotentAsync(database, {
      key: 'async-concurrent-key',
      scope: 'test.async',
      request: { operation: 'concurrent' },
      operation: async () => {
        executions += 1
        assert.equal(database.isTransaction, false)
        signalStarted()
        await firstRelease
        return { statusCode: 200, payload: { data: { completed: true } } }
      },
    })

    await firstStarted
    await assert.rejects(
      executeIdempotentAsync(database, {
        key: 'async-concurrent-key',
        scope: 'test.async',
        request: { operation: 'different' },
        operation: async () => ({ statusCode: 200, payload: { data: { shouldNotRun: true } } }),
      }),
      (error) => error?.code === 'IDEMPOTENCY_CONFLICT',
    )
    const pending = await executeIdempotentAsync(database, {
      key: 'async-concurrent-key',
      scope: 'test.async',
      request: { operation: 'concurrent' },
      operation: async () => {
        throw new Error('a pending reservation must not invoke the second operation')
      },
    })
    assert.equal(pending.state, 'pending')
    assert.equal(pending.statusCode, 202)
    assert.equal(pending.payload.meta.retryable, true)
    assert.equal(executions, 1)

    releaseFirst()
    const completed = await first
    assert.equal(completed.state, 'succeeded')
    assert.equal(completed.replayed, false)
    const replayed = await executeIdempotentAsync(database, {
      key: 'async-concurrent-key',
      scope: 'test.async',
      request: { operation: 'concurrent' },
      operation: async () => {
        executions += 1
        return { statusCode: 200, payload: { data: { shouldNotRun: true } } }
      },
    })
    assert.equal(replayed.replayed, true)
    assert.equal(executions, 1)

    const recoveryRequest = { operation: 'recovery' }
    const oldTimestamp = new Date(Date.now() - 60_000).toISOString()
    const expiredTimestamp = new Date(Date.now() - 1_000).toISOString()
    database
      .prepare(`
        INSERT INTO idempotency_records (
          id, scope_key, idempotency_key, request_hash, status_code, response_json, session_id,
          created_at, updated_at, version, state, lease_owner, lease_epoch, lease_until, attempt_count
        ) VALUES (?, ?, ?, ?, 202, ?, NULL, ?, ?, 1, 'pending', ?, 1, ?, 1)
      `)
      .run(
        randomUUID(),
        'test.async',
        'async-expired-key',
        createIdempotencyRequestHash(recoveryRequest),
        JSON.stringify({ data: { status: 'pending' } }),
        oldTimestamp,
        oldTimestamp,
        'abandoned-lease',
        expiredTimestamp,
      )
    const recovered = await executeIdempotentAsync(database, {
      key: 'async-expired-key',
      scope: 'test.async',
      request: recoveryRequest,
      operation: async ({ recovered: wasRecovered }) => {
        assert.equal(wasRecovered, true)
        return { statusCode: 200, payload: { data: { recovered: true } } }
      },
    })
    assert.equal(recovered.recovered, true)

    const startedRecoveryRequest = { operation: 'started-recovery' }
    database
      .prepare(`
        INSERT INTO idempotency_records (
          id, scope_key, idempotency_key, request_hash, status_code, response_json, session_id,
          created_at, updated_at, version, state, lease_owner, lease_epoch, lease_until,
          external_effect_started, attempt_count
        ) VALUES (?, ?, ?, ?, 202, ?, NULL, ?, ?, 1, 'pending', ?, 1, ?, 1, 1)
      `)
      .run(
        randomUUID(),
        'test.async',
        'async-expired-after-effect-key',
        createIdempotencyRequestHash(startedRecoveryRequest),
        JSON.stringify({ data: { status: 'pending' } }),
        oldTimestamp,
        oldTimestamp,
        'abandoned-external-lease',
        expiredTimestamp,
      )
    let expiredAfterEffectExecutions = 0
    const expiredAfterEffect = await executeIdempotentAsync(database, {
      key: 'async-expired-after-effect-key',
      scope: 'test.async',
      request: startedRecoveryRequest,
      operation: async () => {
        expiredAfterEffectExecutions += 1
        return { statusCode: 200, payload: { data: { mustNotRun: true } } }
      },
    })
    assert.equal(expiredAfterEffect.state, 'unknown')
    assert.equal(expiredAfterEffect.reconciliationRequired, true)
    assert.equal(expiredAfterEffectExecutions, 0)

    let releaseMarkedOriginal
    const markedOriginalRelease = new Promise((resolve) => {
      releaseMarkedOriginal = resolve
    })
    let signalMarkedOriginal
    const markedOriginalStarted = new Promise((resolve) => {
      signalMarkedOriginal = resolve
    })
    let markedOriginalExecutions = 0
    let duplicateMarkedExecutions = 0
    let markedClock = oldTimestamp
    const markedOriginal = executeIdempotentAsync(database, {
      key: 'async-expired-original-completes-key',
      scope: 'test.async',
      request: { operation: 'expired-original-completes' },
      leaseMs: 1_000,
      now: () => markedClock,
      operation: async ({ markExternalSideEffectStarted }) => {
        markedOriginalExecutions += 1
        markExternalSideEffectStarted()
        signalMarkedOriginal()
        await markedOriginalRelease
        return { statusCode: 200, payload: { data: { originalCompleted: true } } }
      },
    })
    await markedOriginalStarted
    markedClock = new Date().toISOString()
    const expiredDuplicate = await executeIdempotentAsync(database, {
      key: 'async-expired-original-completes-key',
      scope: 'test.async',
      request: { operation: 'expired-original-completes' },
      leaseMs: 1_000,
      operation: async () => {
        duplicateMarkedExecutions += 1
        return { statusCode: 200, payload: { data: { mustNotRun: true } } }
      },
    })
    assert.equal(expiredDuplicate.state, 'unknown')
    assert.equal(expiredDuplicate.reconciliationRequired, true)
    assert.equal(duplicateMarkedExecutions, 0)
    releaseMarkedOriginal()
    await assert.rejects(markedOriginal, (error) => error?.code === 'IDEMPOTENCY_LEASE_LOST')
    assert.equal(markedOriginalExecutions, 1)
    const completedMarkedRecord = database
      .prepare('SELECT state, lease_owner FROM idempotency_records WHERE idempotency_key = ?')
      .get('async-expired-original-completes-key')
    assert.equal(completedMarkedRecord.state, 'unknown')
    assert.equal(completedMarkedRecord.lease_owner, null)

    assert.throws(
      () =>
        executeIdempotent(database, {
          key: 'sync-promise-key',
          scope: 'test.sync',
          request: { operation: 'promise' },
          operation: async () => ({ statusCode: 200, payload: { data: {} } }),
        }),
      /只支持同步操作/,
    )
    assert.throws(() => withTransaction(database, () => Promise.resolve()), /返回了 Promise/)
    assert.equal(database.isTransaction, false)
  } finally {
    database.close()
    removeTemporaryDatabase(temporary)
  }
})

test('async idempotency persists classified failures and blocks blind replay after unknown external results', async () => {
  const temporary = createTemporaryDatabase()
  const database = openSqliteDatabase(temporary.filename)
  try {
    runMigrations(database, defaultMigrationDirectory())
    let classifiedExecutions = 0
    let receivedIdempotencyKey = null
    const failed = await executeIdempotentAsync(database, {
      key: 'classified-failure-key',
      scope: 'test.async.lifecycle',
      request: { operation: 'classified-failure' },
      operation: async ({ idempotencyKey }) => {
        classifiedExecutions += 1
        receivedIdempotencyKey = idempotencyKey
        throw new HttpError(503, 'UPSTREAM_TEMPORARY_FAILURE', '上游确认未完成', { retryable: true })
      },
    })
    assert.equal(failed.state, 'failed')
    assert.equal(failed.payload.error.code, 'UPSTREAM_TEMPORARY_FAILURE')
    assert.equal(receivedIdempotencyKey, 'classified-failure-key')
    const failedRecord = database
      .prepare('SELECT state, retryable, failure_code, failure_reason FROM idempotency_records WHERE idempotency_key = ?')
      .get('classified-failure-key')
    assert.equal(failedRecord.state, 'failed')
    assert.equal(failedRecord.retryable, 1)
    assert.equal(failedRecord.failure_code, 'UPSTREAM_TEMPORARY_FAILURE')
    assert.ok(failedRecord.failure_reason)

    let releaseRetry
    const retryRelease = new Promise((resolve) => {
      releaseRetry = resolve
    })
    let signalRetryStarted
    const retryStarted = new Promise((resolve) => {
      signalRetryStarted = resolve
    })
    const retryPromise = executeIdempotentAsync(database, {
      key: 'classified-failure-key',
      scope: 'test.async.lifecycle',
      request: { operation: 'classified-failure' },
      operation: async ({ idempotencyKey }) => {
        classifiedExecutions += 1
        assert.equal(idempotencyKey, 'classified-failure-key')
        signalRetryStarted()
        await retryRelease
        return { statusCode: 201, payload: { data: { retried: true } } }
      },
    })
    await retryStarted
    const concurrentClaim = await executeIdempotentAsync(database, {
      key: 'classified-failure-key',
      scope: 'test.async.lifecycle',
      request: { operation: 'classified-failure' },
      operation: async () => {
        throw new Error('a concurrent failed retry must not invoke the second operation')
      },
    })
    assert.equal(concurrentClaim.state, 'pending')
    assert.equal(classifiedExecutions, 2)
    releaseRetry()
    const retried = await retryPromise
    assert.equal(retried.statusCode, 201)
    assert.equal(classifiedExecutions, 2)
    const succeededReplay = await executeIdempotentAsync(database, {
      key: 'classified-failure-key',
      scope: 'test.async.lifecycle',
      request: { operation: 'classified-failure' },
      operation: async () => {
        classifiedExecutions += 1
        return { statusCode: 200, payload: { data: { mustNotRun: true } } }
      },
    })
    assert.equal(succeededReplay.state, 'succeeded')
    assert.equal(succeededReplay.replayed, true)
    assert.equal(classifiedExecutions, 2)

    let unknownExecutions = 0
    const unknown = await executeIdempotentAsync(database, {
      key: 'unknown-failure-key',
      scope: 'test.async.lifecycle',
      request: { operation: 'unknown-failure' },
      operation: async ({ idempotencyKey, markExternalSideEffectStarted }) => {
        unknownExecutions += 1
        assert.equal(idempotencyKey, 'unknown-failure-key')
        markExternalSideEffectStarted()
        throw new HttpError(503, 'UPSTREAM_TEMPORARY_FAILURE', '上游调用后连接中断', { retryable: true })
      },
    })
    assert.equal(unknown.state, 'unknown')
    assert.equal(unknown.statusCode, 503)
    assert.equal(unknown.payload.error.code, 'DEPENDENCY_UNAVAILABLE')
    const unknownRecord = database
      .prepare('SELECT state, retryable, reconciliation_required, external_effect_started FROM idempotency_records WHERE idempotency_key = ?')
      .get('unknown-failure-key')
    assert.equal(unknownRecord.state, 'unknown')
    assert.equal(unknownRecord.retryable, 0)
    assert.equal(unknownRecord.reconciliation_required, 1)
    assert.equal(unknownRecord.external_effect_started, 1)

    const unknownReplay = await executeIdempotentAsync(database, {
      key: 'unknown-failure-key',
      scope: 'test.async.lifecycle',
      request: { operation: 'unknown-failure' },
      operation: async () => {
        unknownExecutions += 1
        return { statusCode: 200, payload: { data: { mustNotRun: true } } }
      },
    })
    assert.equal(unknownReplay.state, 'unknown')
    assert.equal(unknownReplay.replayed, true)
    assert.equal(unknownExecutions, 1)

    const reconciled = reconcileIdempotency(database, {
      key: 'unknown-failure-key',
      scope: 'test.async.lifecycle',
      request: { operation: 'unknown-failure' },
      resolution: {
        state: 'succeeded',
        sideEffectStatus: 'completed',
        providerReference: 'provider:test:unknown-failure-key',
        outcome: { statusCode: 200, payload: { data: { reconciled: true } } },
      },
    })
    assert.equal(reconciled.state, 'succeeded')
    assert.equal(reconciled.reconciled, true)
    const reconciledReplay = await executeIdempotentAsync(database, {
      key: 'unknown-failure-key',
      scope: 'test.async.lifecycle',
      request: { operation: 'unknown-failure' },
      operation: async () => {
        unknownExecutions += 1
        return { statusCode: 200, payload: { data: { mustNotRunAfterReconcile: true } } }
      },
    })
    assert.equal(reconciledReplay.state, 'succeeded')
    assert.equal(reconciledReplay.replayed, true)
    assert.equal(unknownExecutions, 1)

    let unclassifiedExecutions = 0
    const unclassified = await executeIdempotentAsync(database, {
      key: 'unclassified-failure-key',
      scope: 'test.async.lifecycle',
      request: { operation: 'unclassified-failure' },
      operation: async () => {
        unclassifiedExecutions += 1
        throw new Error('unclassified failure')
      },
    })
    assert.equal(unclassified.state, 'unknown')
    assert.equal(
      database
        .prepare('SELECT external_effect_started FROM idempotency_records WHERE idempotency_key = ?')
        .get('unclassified-failure-key').external_effect_started,
      0,
    )
    const unclassifiedReplay = await executeIdempotentAsync(database, {
      key: 'unclassified-failure-key',
      scope: 'test.async.lifecycle',
      request: { operation: 'unclassified-failure' },
      operation: async () => {
        unclassifiedExecutions += 1
        return { statusCode: 200, payload: { data: { mustNotRun: true } } }
      },
    })
    assert.equal(unclassifiedReplay.state, 'unknown')
    assert.equal(unclassifiedReplay.replayed, true)
    assert.equal(unclassifiedExecutions, 1)
  } finally {
    database.close()
    removeTemporaryDatabase(temporary)
  }
})
