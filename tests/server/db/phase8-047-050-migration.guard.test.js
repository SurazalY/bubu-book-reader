import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { bootstrapInternalDemo } from '../../../server/db/bootstrap-internal-demo.js'
import { openSqliteDatabase } from '../../../server/db/database.js'
import { listMigrationFiles, runMigrations } from '../../../server/db/migrate.js'

const NOW = '2026-08-18T09:00:00.000Z'
const OLDER = '2026-01-01T00:00:00.000Z'
const PHASE8_PREFIXES = ['047_', '048_', '049_', '050_']
const ORG_ID = 'internal-demo-organization'
const CLASS_ID = 'internal-demo-class'
const LEGACY_GRADE_ID = 'internal-demo-grade'
const ACTOR_ID = 'internal-principal'

const REAL_DATABASE_PATH = path.resolve(
  fileURLToPath(new URL('../../../server/data/readmate.sqlite', import.meta.url)),
)
const migrationDirectory = fileURLToPath(new URL('../../../server/db/migrations/', import.meta.url))

const BASELINE_USERS = [
  { id: 'internal-demo-student', username: 'internal-student', displayName: '林小竹' },
  { id: 'internal-ops-admin', username: 'internal-ops-admin', displayName: '内部联调运营管理员' },
  { id: 'internal-principal', username: 'internal-principal', displayName: '陈校长' },
  { id: 'internal-teacher-li', username: 'internal-teacher-li', displayName: '李老师' },
  { id: 'internal-teacher-wang', username: 'internal-teacher-wang', displayName: '王老师' },
]

const EXPECTED_047_COLUMNS = {
  organizations: ['school_code'],
  users: ['login_name', 'account_code'],
  classes: ['stage', 'entry_year', 'class_number'],
}

const REGISTRATION_CREDENTIAL_COLUMNS = [
  'id',
  'organization_id',
  'secret_hash',
  'expected_role',
  'scope_type',
  'scope_id',
  'expires_at',
  'max_uses',
  'successful_use_count',
  'revoked_at',
  'revoked_by',
  'revoked_reason',
  'created_by_user_id',
  'created_workspace_id',
  'created_at',
  'updated_at',
  'version',
]

const REGISTRATION_USE_COLUMNS = [
  'id',
  'credential_id',
  'organization_id',
  'expected_role',
  'created_user_id',
  'request_id',
  'used_at',
]

const ENROLLMENT_REQUEST_COLUMNS = [
  'id',
  'organization_id',
  'student_user_id',
  'class_id',
  'status',
  'requested_at',
  'decided_at',
  'decided_by',
  'decision_reason',
  'created_at',
  'updated_at',
  'version',
]

const PASSWORD_RESET_COLUMNS = [
  'id',
  'organization_id',
  'target_user_id',
  'secret_hash',
  'expires_at',
  'used_at',
  'revoked_at',
  'revoked_by',
  'revoked_reason',
  'created_by_user_id',
  'created_workspace_id',
  'created_at',
  'updated_at',
  'version',
]

const FROZEN_READING_TABLES = ['reading_summary_sessions', 'reading_daily_book_summaries']

function assertNotRealDatabasePath(databasePath) {
  const resolved = path.resolve(databasePath)
  assert.notEqual(
    resolved,
    REAL_DATABASE_PATH,
    `守卫测试不得打开真实业务库 ${REAL_DATABASE_PATH}，实际打开: ${resolved}`,
  )
  assert.ok(
    !resolved.toLowerCase().replaceAll('\\', '/').endsWith('/server/data/readmate.sqlite'),
    `守卫测试数据库路径不得指向 server/data/readmate.sqlite，实际: ${resolved}`,
  )
}

function listSqlFilenames(directory) {
  return readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()
}

function findMigrationIdByPrefix(directory, prefix) {
  const matches = listSqlFilenames(directory).filter((name) => name.startsWith(prefix))
  assert.equal(
    matches.length,
    1,
    `必须恰好存在一个 ${prefix}* 迁移文件，实际: ${matches.join(', ') || '无'}`,
  )
  return matches[0]
}

function requirePhase8MigrationIds(directory = migrationDirectory) {
  return PHASE8_PREFIXES.map((prefix) => findMigrationIdByPrefix(directory, prefix))
}

function temporaryDatabase(prefix) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix))
  const databasePath = path.join(directory, 'phase8-guard.sqlite')
  assertNotRealDatabasePath(databasePath)
  let db = openSqliteDatabase(databasePath)
  return {
    directory,
    databasePath,
    get db() {
      return db
    },
    closeDatabase() {
      if (db) {
        try {
          db.close()
        } catch {}
        db = null
      }
    },
    reopen() {
      this.closeDatabase()
      assertNotRealDatabasePath(databasePath)
      db = openSqliteDatabase(databasePath)
      return db
    },
    close() {
      this.closeDatabase()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

function stageMigrationsBefore047(targetDirectory) {
  mkdirSync(targetDirectory, { recursive: true })
  for (const filename of listSqlFilenames(migrationDirectory).filter((name) => name < '047_')) {
    copyFileSync(path.join(migrationDirectory, filename), path.join(targetDirectory, filename))
  }
}

function stagePhase8Prefixes(targetDirectory, prefixes = PHASE8_PREFIXES) {
  const ids = []
  for (const prefix of prefixes) {
    const id = findMigrationIdByPrefix(migrationDirectory, prefix)
    copyFileSync(path.join(migrationDirectory, id), path.join(targetDirectory, id))
    ids.push(id)
  }
  return ids
}

function tableExists(db, name) {
  return db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name).count === 1
}

function columnNames(db, table) {
  assert.equal(tableExists(db, table), true, `表 ${table} 必须存在`)
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name)
}

function assertTableColumns(db, table, required) {
  const names = columnNames(db, table)
  for (const column of required) {
    assert.ok(names.includes(column), `${table} 必须包含列 ${column}，实际: ${names.join(', ')}`)
  }
}

function readingTableSnapshot(db) {
  const snapshot = {}
  for (const table of FROZEN_READING_TABLES) {
    assert.equal(tableExists(db, table), true, `冻结表 ${table} 在 043 之后必须存在`)
    snapshot[table] = {
      columns: db.prepare(`PRAGMA table_info(${table})`).all().map((column) => ({
        cid: column.cid,
        name: column.name,
        type: column.type,
        notnull: column.notnull,
        dflt_value: column.dflt_value,
        pk: column.pk,
      })),
      sql: db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)?.sql ?? null,
    }
  }
  return snapshot
}

function grantCount(db) {
  return db.prepare(`SELECT COUNT(*) AS count FROM book_access_grants`).get().count
}

function schemaHasPrefix(db, prefix) {
  return db.prepare(`SELECT COUNT(*) AS count FROM schema_migrations WHERE id LIKE ?`).get(`${prefix}%`).count
}

function insertBaseline046Shape(db, options = {}) {
  const {
    bookCount = 49,
    extraCurrentVersionLock = true,
    includeDraftAndArchived = false,
    extraLegacyClass = false,
    existingGrant = false,
    publishedBookWithoutVersion = false,
  } = options

  db.prepare(`INSERT INTO organizations (id, name, status, created_at, updated_at, version)
    VALUES (?, '读伴公共领域内部联调学校', 'active', ?, ?, 1)`).run(ORG_ID, NOW, NOW)

  const insertUser = db.prepare(`INSERT INTO users
    (id, organization_id, username, display_name, status, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, 'active', ?, ?, 1)`)
  for (const user of BASELINE_USERS) {
    insertUser.run(user.id, ORG_ID, user.username, user.displayName, NOW, NOW)
  }

  db.prepare(`INSERT INTO classes
    (id, organization_id, grade_id, name, status, created_at, updated_at, version)
    VALUES (?, ?, ?, '三年级一班', 'active', ?, ?, 1)`).run(CLASS_ID, ORG_ID, LEGACY_GRADE_ID, NOW, NOW)

  if (extraLegacyClass) {
    db.prepare(`INSERT INTO classes
      (id, organization_id, grade_id, name, status, created_at, updated_at, version)
      VALUES ('legacy-second-class', ?, 'legacy-grade-2', '四年级二班', 'active', ?, ?, 1)`).run(ORG_ID, NOW, NOW)
  }

  db.prepare(`INSERT INTO class_memberships
    (id, class_id, user_id, membership_role, status, created_at, updated_at, version)
    VALUES ('class-member-internal-student', ?, 'internal-demo-student', 'student', 'active', ?, ?, 1)`)
    .run(CLASS_ID, NOW, NOW)

  const insertBook = db.prepare(`INSERT INTO books
    (id, organization_id_at_creation, actor_id_at_creation, title, status, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)`)
  const insertVersion = db.prepare(`INSERT INTO book_versions
    (id, book_id, organization_id_at_creation, actor_id_at_creation, label, source_format,
     page_count, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, ?, 'text', 10, ?, ?, 1)`)

  for (let index = 1; index <= bookCount; index += 1) {
    const bookId = `book-${String(index).padStart(4, '0')}`
    const versionId = `version-${String(index).padStart(4, '0')}`
    insertBook.run(bookId, ORG_ID, ACTOR_ID, `Book ${index}`, 'published', NOW, NOW)
    insertVersion.run(versionId, bookId, ORG_ID, ACTOR_ID, 'v1', NOW, NOW)
  }

  if (extraCurrentVersionLock) {
    insertVersion.run('version-zzzz-older', 'book-0001', ORG_ID, ACTOR_ID, 'v0', OLDER, OLDER)
    insertVersion.run('version-zzzz-same-time', 'book-0002', ORG_ID, ACTOR_ID, 'v1b', NOW, NOW)
  }

  if (includeDraftAndArchived) {
    insertBook.run('book-draft', ORG_ID, ACTOR_ID, 'Draft Book', 'draft', NOW, NOW)
    insertVersion.run('version-draft', 'book-draft', ORG_ID, ACTOR_ID, 'v1', NOW, NOW)
    insertBook.run('book-archived', ORG_ID, ACTOR_ID, 'Archived Book', 'archived', NOW, NOW)
    insertVersion.run('version-archived', 'book-archived', ORG_ID, ACTOR_ID, 'v1', NOW, NOW)
  }

  if (publishedBookWithoutVersion) {
    insertBook.run('book-orphan-published', ORG_ID, ACTOR_ID, 'Orphan published', 'published', NOW, NOW)
  }

  if (existingGrant) {
    db.prepare(`INSERT INTO book_access_grants (
        id, book_version_id, grantee_type, grantee_id, organization_id_at_creation,
        actor_id_at_creation, created_at, updated_at, version
      ) VALUES ('preexisting-grant', 'version-0001', 'class', ?, ?, 'pre-050-actor', ?, ?, 1)`)
      .run(CLASS_ID, ORG_ID, NOW, NOW)
  }

  return db.prepare(`SELECT rowid, id, username FROM users ORDER BY rowid`).all()
}

function insert047Class(db, values) {
  assertTableColumns(db, 'classes', EXPECTED_047_COLUMNS.classes)
  const row = {
    id: 'class-extra',
    organizationId: ORG_ID,
    name: '额外班',
    status: 'active',
    stage: 'primary',
    entryYear: 2024,
    classNumber: 2,
    gradeId: 'primary:2024',
    now: NOW,
    ...values,
  }
  db.prepare(`INSERT INTO classes (
      id, organization_id, grade_id, name, status, stage, entry_year, class_number,
      created_at, updated_at, version
    ) VALUES (
      :id, :organizationId, :gradeId, :name, :status, :stage, :entryYear, :classNumber,
      :now, :now, 1
    )`).run(row)
}

function insertRegistrationCredential(db, overrides = {}) {
  assertTableColumns(db, 'registration_credentials', REGISTRATION_CREDENTIAL_COLUMNS)
  const row = {
    id: 'reg-cred-1',
    organizationId: ORG_ID,
    secretHash: 'a'.repeat(64),
    expectedRole: 'student',
    scopeType: 'school',
    scopeId: ORG_ID,
    expiresAt: '2026-12-31T00:00:00.000Z',
    maxUses: null,
    successfulUseCount: 0,
    revokedAt: null,
    revokedBy: null,
    revokedReason: null,
    createdByUserId: ACTOR_ID,
    createdWorkspaceId: 'ws-school',
    now: NOW,
    ...overrides,
  }
  db.prepare(`INSERT INTO registration_credentials (
      id, organization_id, secret_hash, expected_role, scope_type, scope_id, expires_at,
      max_uses, successful_use_count, revoked_at, revoked_by, revoked_reason,
      created_by_user_id, created_workspace_id, created_at, updated_at, version
    ) VALUES (
      :id, :organizationId, :secretHash, :expectedRole, :scopeType, :scopeId, :expiresAt,
      :maxUses, :successfulUseCount, :revokedAt, :revokedBy, :revokedReason,
      :createdByUserId, :createdWorkspaceId, :now, :now, 1
    )`).run(row)
}

function insertRegistrationUse(db, overrides = {}) {
  assertTableColumns(db, 'registration_credential_uses', REGISTRATION_USE_COLUMNS)
  const row = {
    id: 'reg-use-1',
    credentialId: 'reg-cred-1',
    organizationId: ORG_ID,
    expectedRole: 'student',
    createdUserId: 'internal-demo-student',
    requestId: 'req-1',
    usedAt: NOW,
    ...overrides,
  }
  db.prepare(`INSERT INTO registration_credential_uses (
      id, credential_id, organization_id, expected_role, created_user_id, request_id, used_at
    ) VALUES (
      :id, :credentialId, :organizationId, :expectedRole, :createdUserId, :requestId, :usedAt
    )`).run(row)
}

function insertEnrollmentRequest(db, overrides = {}) {
  assertTableColumns(db, 'student_enrollment_requests', ENROLLMENT_REQUEST_COLUMNS)
  const row = {
    id: 'enroll-1',
    organizationId: ORG_ID,
    studentUserId: 'internal-demo-student',
    classId: CLASS_ID,
    status: 'pending',
    requestedAt: NOW,
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    now: NOW,
    ...overrides,
  }
  db.prepare(`INSERT INTO student_enrollment_requests (
      id, organization_id, student_user_id, class_id, status, requested_at,
      decided_at, decided_by, decision_reason, created_at, updated_at, version
    ) VALUES (
      :id, :organizationId, :studentUserId, :classId, :status, :requestedAt,
      :decidedAt, :decidedBy, :decisionReason, :now, :now, 1
    )`).run(row)
}

function seedSchoolWorkspace(db, workspaceId = 'ws-school') {
  db.prepare(`INSERT INTO workspaces (
      id, organization_id, code, name, scope_type, scope_id, status, created_at, updated_at, version
    ) VALUES (?, ?, 'school-admin', '学校工作空间', 'school', ?, 'active', ?, ?, 1)`)
    .run(workspaceId, ORG_ID, ORG_ID, NOW, NOW)
}

function applyPhase8AndAssert(db, stagedDirectory, { prefixes = PHASE8_PREFIXES, now = NOW } = {}) {
  const ids = stagePhase8Prefixes(stagedDirectory, prefixes)
  const result = runMigrations(db, stagedDirectory, now)
  for (const id of ids) {
    assert.ok(result.applied.includes(id), `runMigrations.applied 必须包含 ${id}，实际: ${result.applied.join(', ') || '空'}`)
  }
  return { ids, result }
}

function openFreshWithPhase8(t, { now = NOW } = {}) {
  const fixture = temporaryDatabase('phase8-fresh-')
  t.after(() => fixture.close())
  const phase8Ids = requirePhase8MigrationIds()
  const result = runMigrations(fixture.db, migrationDirectory, now)
  for (const id of phase8Ids) {
    assert.ok(
      result.applied.includes(id),
      `全新库 runMigrations.applied 必须包含 ${id}，实际: ${result.applied.join(', ')}`,
    )
  }
  return { fixture, phase8Ids, result }
}

function openStaged046(t, { now = NOW, seed } = {}) {
  const fixture = temporaryDatabase('phase8-staged-')
  t.after(() => fixture.close())
  const staged = path.join(fixture.directory, 'migrations')
  stageMigrationsBefore047(staged)
  runMigrations(fixture.db, staged, now)
  const users = seed ? seed(fixture.db) : undefined
  return { fixture, staged, users }
}

function assert047Backfill(db, usersBefore) {
  assertTableColumns(db, 'organizations', EXPECTED_047_COLUMNS.organizations)
  assertTableColumns(db, 'users', EXPECTED_047_COLUMNS.users)
  assertTableColumns(db, 'classes', EXPECTED_047_COLUMNS.classes)

  const organization = db.prepare(`SELECT school_code FROM organizations WHERE id = ?`).get(ORG_ID)
  assert.equal(organization.school_code, 'internal-demo')

  const classroom = db.prepare(`
    SELECT stage, entry_year, class_number, grade_id
    FROM classes WHERE id = ?
  `).get(CLASS_ID)
  assert.equal(classroom.stage, 'primary')
  assert.equal(classroom.entry_year, 2023)
  assert.equal(classroom.class_number, 1)
  assert.equal(classroom.grade_id, 'primary:2023')

  for (const user of usersBefore) {
    const row = db.prepare(`SELECT login_name, account_code FROM users WHERE id = ?`).get(user.id)
    assert.equal(row.login_name, user.username, `${user.id} login_name 必须回填 username 原值`)
    assert.equal(
      row.account_code,
      `A${String(user.rowid).padStart(7, '0')}`,
      `${user.id} account_code 必须按稳定 rowid 生成 A+7 位十进制`,
    )
  }

  assert.throws(() => {
    db.prepare(`UPDATE users SET login_name = '' WHERE id = 'internal-demo-student'`).run()
  }, 'UPDATE 空 login_name 必须被触发器拒绝')
  assert.throws(() => {
    db.prepare(`UPDATE users SET account_code = '' WHERE id = 'internal-demo-student'`).run()
  }, 'UPDATE 空 account_code 必须被触发器拒绝')
}

function assert050BaselineGrants(db, { now = NOW } = {}) {
  assert.equal(grantCount(db), 49, '当前基线形 050 必须恰好插入 49 行 grants')
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS count FROM book_access_grants WHERE grantee_type <> 'class'`).get().count,
    0,
    '050 不得创建 organization 或其他非 class grant',
  )
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS count FROM book_access_grants WHERE id NOT LIKE 'phase8-backfill-050:%'`).get().count,
    0,
    '050 grant id 必须全部使用 phase8-backfill-050:<versionId>:<classId>',
  )
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS count FROM book_access_grants
      WHERE actor_id_at_creation <> 'phase8-migration-050'`).get().count,
    0,
    '050 actor 必须全部为 phase8-migration-050',
  )
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS count FROM book_access_grants
      WHERE created_at <> ? OR updated_at <> ?`).get(now, now).count,
    0,
    '050 时间必须取 runMigrations 的 now',
  )

  const createdAtWins = db.prepare(`SELECT * FROM book_access_grants
    WHERE id = 'phase8-backfill-050:version-0001:internal-demo-class'`).get()
  assert.ok(createdAtWins, 'book-0001 当前版本必须按 created_at DESC 选 version-0001，不得选更旧的 version-zzzz-older')
  assert.equal(createdAtWins.book_version_id, 'version-0001')
  assert.equal(createdAtWins.grantee_id, CLASS_ID)

  const idDescWins = db.prepare(`SELECT * FROM book_access_grants
    WHERE id = 'phase8-backfill-050:version-zzzz-same-time:internal-demo-class'`).get()
  assert.ok(idDescWins, 'created_at 相同时必须按 id DESC 选 version-zzzz-same-time，不得选 version-0002')
  assert.equal(idDescWins.book_version_id, 'version-zzzz-same-time')

  assert.equal(
    db.prepare(`SELECT COUNT(*) AS count FROM book_access_grants
      WHERE book_version_id IN ('version-zzzz-older', 'version-0002')`).get().count,
    0,
    '050 不得给非当前版本插 grant',
  )
}

function runBootstrapOnFreshMigrated(t) {
  const { fixture } = openFreshWithPhase8(t)
  fixture.closeDatabase()
  const password = randomBytes(24).toString('base64url')
  return bootstrapInternalDemo({
    databasePath: fixture.databasePath,
    manifestPath: path.join(fixture.directory, 'unused-manifest.json'),
    publicRoot: path.join(fixture.directory, 'public'),
    password,
    catalogImporter: async () => ({
      imported: [],
      unchanged: [],
      publicRoot: path.join(fixture.directory, 'public'),
    }),
  }).then(() => fixture.reopen())
}

test('12. 守卫测试不接触真实业务数据库', (t) => {
  assert.ok(existsSync(migrationDirectory), '必须能读到 server/db/migrations')
  const fixture = temporaryDatabase('phase8-no-real-db-')
  t.after(() => fixture.close())
  assertNotRealDatabasePath(fixture.databasePath)
  runMigrations(fixture.db, migrationDirectory, NOW)
  assertNotRealDatabasePath(fixture.databasePath)
})

test('1. 全新库执行 047～050：文件存在、applied 含四 id、表和列存在', (t) => {
  const { fixture, phase8Ids, result } = openFreshWithPhase8(t)
  assert.equal(result.applied.filter((id) => PHASE8_PREFIXES.some((prefix) => id.startsWith(prefix))).length, 4)
  assert.deepEqual(
    listMigrationFiles(migrationDirectory).map((item) => item.id).filter((id) => PHASE8_PREFIXES.some((prefix) => id.startsWith(prefix))),
    phase8Ids,
  )

  assertTableColumns(fixture.db, 'organizations', EXPECTED_047_COLUMNS.organizations)
  assertTableColumns(fixture.db, 'users', EXPECTED_047_COLUMNS.users)
  assertTableColumns(fixture.db, 'classes', EXPECTED_047_COLUMNS.classes)
  assertTableColumns(fixture.db, 'registration_credentials', REGISTRATION_CREDENTIAL_COLUMNS)
  assertTableColumns(fixture.db, 'registration_credential_uses', REGISTRATION_USE_COLUMNS)
  assertTableColumns(fixture.db, 'student_enrollment_requests', ENROLLMENT_REQUEST_COLUMNS)
  assertTableColumns(fixture.db, 'password_reset_credentials', PASSWORD_RESET_COLUMNS)
  assert.equal(tableExists(fixture.db, 'book_access_grants'), true, '050 必须继续使用既有 book_access_grants，不得另造表')
})

test('2. 046 副本升级至 050：staged <047_ 先跑，插入 046 形基线，再挂 047～050', (t) => {
  const { fixture, staged, users } = openStaged046(t, {
    seed: (db) => insertBaseline046Shape(db, { includeDraftAndArchived: true }),
  })
  assert.equal(schemaHasPrefix(fixture.db, '047_'), 0)
  assert.ok(!columnNames(fixture.db, 'organizations').includes('school_code'))
  assert.equal(grantCount(fixture.db), 0)

  applyPhase8AndAssert(fixture.db, staged)
  assert047Backfill(fixture.db, users)
  assert050BaselineGrants(fixture.db)
})

test('3. 重复启动 alreadyApplied：第二次 applied=[]，alreadyApplied 含 047～050', (t) => {
  const { fixture, phase8Ids } = openFreshWithPhase8(t)
  const second = runMigrations(fixture.db, migrationDirectory, NOW)
  assert.deepEqual(second.applied, [])
  for (const id of phase8Ids) {
    assert.ok(second.alreadyApplied.includes(id), `第二次 alreadyApplied 必须包含 ${id}`)
  }
})

test('4. checksum 稳定：两次 checksum 相等且长度 64', (t) => {
  const { fixture, phase8Ids } = openFreshWithPhase8(t)
  const first = phase8Ids.map((id) => fixture.db.prepare(`SELECT id, checksum FROM schema_migrations WHERE id = ?`).get(id))
  for (const row of first) {
    assert.ok(row, `${row?.id ?? '047-050'} 必须写入 schema_migrations`)
    assert.equal(row.checksum.length, 64)
  }
  runMigrations(fixture.db, migrationDirectory, NOW)
  for (const row of first) {
    const again = fixture.db.prepare(`SELECT checksum FROM schema_migrations WHERE id = ?`).get(row.id)
    assert.equal(again.checksum, row.checksum)
    assert.equal(again.checksum.length, 64)
  }
})

test('5. 047 登录/班级字段回填与唯一索引', (t) => {
  const { fixture, staged, users } = openStaged046(t, { seed: (db) => insertBaseline046Shape(db) })
  applyPhase8AndAssert(fixture.db, staged, { prefixes: ['047_'] })
  assert047Backfill(fixture.db, users)
  assert.equal(tableExists(fixture.db, 'registration_credentials'), false, '047 不得夹带注册凭据表')
  assert.equal(grantCount(fixture.db), 0, '047 不得写 grants')

  seedSchoolWorkspace(fixture.db, 'ws-school')
  assert.throws(() => {
    fixture.db.prepare(`INSERT INTO organizations (id, name, status, school_code, created_at, updated_at, version)
      VALUES ('org-dup-code', 'B', 'active', 'INTERNAL-DEMO', ?, ?, 1)`).run(NOW, NOW)
  }, 'school_code 必须全局唯一且 NOCASE')

  assert.throws(() => {
    fixture.db.prepare(`INSERT INTO users (
        id, organization_id, username, display_name, status, login_name, account_code,
        created_at, updated_at, version
      ) VALUES ('user-dup-login', ?, 'uuid-dup-login', 'Dup', 'active', 'INTERNAL-STUDENT', 'A0000991', ?, ?, 1)`)
      .run(ORG_ID, NOW, NOW)
  }, '(organization_id, login_name) 必须唯一且 NOCASE')

  assert.throws(() => {
    fixture.db.prepare(`INSERT INTO users (
        id, organization_id, username, display_name, status, login_name, account_code,
        created_at, updated_at, version
      ) VALUES ('user-dup-code', ?, 'uuid-dup-code', 'Dup', 'active', 'otherlogin', ?, ?, ?, 1)`)
      .run(ORG_ID, `A${String(users[0].rowid).padStart(7, '0')}`, NOW, NOW)
  }, '(organization_id, account_code) 必须唯一且能拒绝冲突')

  assert.throws(() => {
    insert047Class(fixture.db, { id: 'class-dup-number', classNumber: 1, entryYear: 2023, gradeId: 'primary:2023' })
  }, '(organization_id, grade_id, class_number) 必须唯一')

  assert.throws(() => {
    fixture.db.prepare(`INSERT INTO workspaces (
        id, organization_id, code, name, scope_type, scope_id, status, created_at, updated_at, version
      ) VALUES ('ws-dup-scope', ?, 'class-teacher', '重复 scope', 'school', ?, 'active', ?, ?, 1)`)
      .run(ORG_ID, ORG_ID, NOW, NOW)
  }, 'active 且 organization-scoped workspace 的 (organization_id, scope_type, scope_id) 必须唯一')
})

test('6. 048 注册凭据表与唯一/角色约束，无默认 token', (t) => {
  const { fixture, staged } = openStaged046(t, { seed: (db) => insertBaseline046Shape(db) })
  applyPhase8AndAssert(fixture.db, staged, { prefixes: ['047_', '048_'] })
  assertTableColumns(fixture.db, 'registration_credentials', REGISTRATION_CREDENTIAL_COLUMNS)
  assertTableColumns(fixture.db, 'registration_credential_uses', REGISTRATION_USE_COLUMNS)
  assert.equal(
    fixture.db.prepare(`SELECT COUNT(*) AS count FROM registration_credentials`).get().count,
    0,
    '048 不得预置业务 token 行',
  )
  assert.equal(
    fixture.db.prepare(`SELECT COUNT(*) AS count FROM registration_credential_uses`).get().count,
    0,
    '048 不得预置 credential use 行',
  )
  assert.equal(
    fixture.db.prepare(`SELECT COUNT(*) AS count FROM users`).get().count,
    5,
    '048 不得创建用户',
  )

  seedSchoolWorkspace(fixture.db, 'ws-school')
  insertRegistrationCredential(fixture.db)
  assert.throws(() => {
    insertRegistrationCredential(fixture.db, { id: 'reg-cred-dup-hash', secretHash: 'a'.repeat(64) })
  }, 'secret_hash 必须唯一')
  assert.throws(() => {
    insertRegistrationCredential(fixture.db, { id: 'reg-cred-bad-role', secretHash: 'b'.repeat(64), expectedRole: 'admin' })
  }, 'expected_role 只允许 student|teacher')
  assert.throws(() => {
    insertRegistrationCredential(fixture.db, { id: 'reg-cred-bad-scope', secretHash: 'c'.repeat(64), scopeType: 'class' })
  }, 'scope_type 只允许 school|grade')
  assert.throws(() => {
    insertRegistrationCredential(fixture.db, { id: 'reg-cred-bad-hash', secretHash: 'not-sha256' })
  }, 'secret_hash 必须是 SHA-256 十六进制')
  assert.throws(() => {
    insertRegistrationCredential(fixture.db, { id: 'reg-cred-zero-uses', secretHash: 'd'.repeat(64), maxUses: 0 })
  }, 'max_uses 必须是可空正整数')

  insertRegistrationUse(fixture.db)
  assert.throws(() => {
    insertRegistrationUse(fixture.db, { id: 'reg-use-2', requestId: 'req-2' })
  }, 'registration_credential_uses.created_user_id 必须唯一')
})

test('7. 049 审批与重置表 + pending 部分唯一 + 学生单 active 班', (t) => {
  const { fixture, staged } = openStaged046(t, { seed: (db) => insertBaseline046Shape(db) })
  applyPhase8AndAssert(fixture.db, staged, { prefixes: ['047_', '048_', '049_'] })
  assertTableColumns(fixture.db, 'student_enrollment_requests', ENROLLMENT_REQUEST_COLUMNS)
  assertTableColumns(fixture.db, 'password_reset_credentials', PASSWORD_RESET_COLUMNS)
  assert.equal(tableExists(fixture.db, 'reading_summary_sessions'), true)
  assert.equal(tableExists(fixture.db, 'reading_daily_book_summaries'), true)

  seedSchoolWorkspace(fixture.db, 'ws-school')
  insertEnrollmentRequest(fixture.db, { status: 'pending' })
  assert.throws(() => {
    insertEnrollmentRequest(fixture.db, { id: 'enroll-2', classId: CLASS_ID, status: 'pending' })
  }, '每名学生最多一条 pending enrollment')

  insert047Class(fixture.db, { id: 'class-second-active', classNumber: 2, entryYear: 2024, gradeId: 'primary:2024' })
  assert.throws(() => {
    fixture.db.prepare(`INSERT INTO class_memberships (
        id, class_id, user_id, membership_role, status, created_at, updated_at, version
      ) VALUES ('class-member-student-second', 'class-second-active', 'internal-demo-student', 'student', 'active', ?, ?, 1)`)
      .run(NOW, NOW)
  }, "class_memberships(user_id) 在 membership_role='student' AND status='active' 条件下必须唯一")
})

test('8. 050 grants 回填：基线 49 行、draft 不回填、id/actor 格式与当前版本口径', (t) => {
  const { fixture, staged } = openStaged046(t, {
    seed: (db) => insertBaseline046Shape(db, { includeDraftAndArchived: true }),
  })
  applyPhase8AndAssert(fixture.db, staged)
  assert050BaselineGrants(fixture.db)
  assert.equal(
    fixture.db.prepare(`SELECT COUNT(*) AS count FROM book_access_grants
      WHERE book_version_id IN ('version-draft', 'version-archived')`).get().count,
    0,
    '050 不得给 draft/archived 书插 grant',
  )
})

test('9. 当前基线形预期 49 行', (t) => {
  const { fixture, staged } = openStaged046(t, { seed: (db) => insertBaseline046Shape(db) })
  applyPhase8AndAssert(fixture.db, staged)
  assert.equal(grantCount(fixture.db), 49)
  assert.equal(
    fixture.db.prepare(`SELECT COUNT(*) AS count FROM books WHERE status = 'published'`).get().count,
    49,
  )
  assert.equal(
    fixture.db.prepare(`SELECT COUNT(*) AS count FROM classes WHERE id = ? AND status = 'active'`).get(CLASS_ID).count,
    1,
  )
})

test('10. 050 不重复插入：第二次 alreadyApplied，checksum 不变，grants 仍 49', (t) => {
  const { fixture, staged } = openStaged046(t, { seed: (db) => insertBaseline046Shape(db) })
  const first = applyPhase8AndAssert(fixture.db, staged)
  assert.equal(grantCount(fixture.db), 49)
  const checksums = first.ids.map((id) => fixture.db.prepare(`SELECT id, checksum FROM schema_migrations WHERE id = ?`).get(id))
  const second = runMigrations(fixture.db, staged, NOW)
  assert.deepEqual(second.applied, [])
  for (const id of first.ids) {
    assert.ok(second.alreadyApplied.includes(id), `第二次 alreadyApplied 必须包含 ${id}`)
  }
  for (const row of checksums) {
    const again = fixture.db.prepare(`SELECT checksum FROM schema_migrations WHERE id = ?`).get(row.id)
    assert.equal(again.checksum, row.checksum)
    assert.equal(again.checksum.length, 64)
  }
  assert.equal(grantCount(fixture.db), 49)
})

test('11. 不修改冻结阅读表 reading_summary_sessions / reading_daily_book_summaries', (t) => {
  const { fixture, staged } = openStaged046(t, { seed: (db) => insertBaseline046Shape(db) })
  const before = readingTableSnapshot(fixture.db)
  applyPhase8AndAssert(fixture.db, staged)
  const after = readingTableSnapshot(fixture.db)
  assert.deepEqual(after, before, '047～050 不得改变两张冻结阅读表的列集或建表 SQL')
})

test('050 空库（0 published × 0 班）允许插入 0 行', (t) => {
  const { fixture } = openFreshWithPhase8(t)
  assert.equal(fixture.db.prepare(`SELECT COUNT(*) AS count FROM books WHERE status = 'published'`).get().count, 0)
  assert.equal(fixture.db.prepare(`SELECT COUNT(*) AS count FROM classes`).get().count, 0)
  assert.equal(grantCount(fixture.db), 0, '空库与基线 49 行是不同用例：空库允许 0 行')
})

test('bootstrap：全新库跑完全部迁移后演示数据必须含第二班', async (t) => {
  const db = await runBootstrapOnFreshMigrated(t)
  assert.ok(
    db.prepare(`SELECT COUNT(*) AS count FROM classes
      WHERE id <> 'internal-demo-class'`).get().count >= 1,
    '演示数据必须含第二班',
  )
})

test('bootstrap：必须有 grade workspace（code=grade-admin, scope_type=grade）', async (t) => {
  const db = await runBootstrapOnFreshMigrated(t)
  assert.ok(
    db.prepare(`SELECT COUNT(*) AS count FROM workspaces
      WHERE code = 'grade-admin' AND scope_type = 'grade'`).get().count >= 1,
    "必须有 grade workspace（code='grade-admin', scope_type='grade'）",
  )
})

test('bootstrap：必须有 grade_manager 账号与对应 role assignment', async (t) => {
  const db = await runBootstrapOnFreshMigrated(t)
  const assignment = db.prepare(`
    SELECT role_assignments.user_id
    FROM role_assignments
    JOIN users ON users.id = role_assignments.user_id
    WHERE role_assignments.role_code = 'grade_manager'
      AND role_assignments.status = 'active'
      AND users.status = 'active'
  `).get()
  assert.ok(assignment, '必须有 grade_manager 账号与对应 active role assignment')
})

test('负例：046 副本已有 2 个旧班时 047 必须失败', (t) => {
  const { fixture, staged } = openStaged046(t, {
    seed: (db) => insertBaseline046Shape(db, { extraLegacyClass: true, bookCount: 1, extraCurrentVersionLock: false }),
  })
  assert.equal(fixture.db.prepare(`SELECT COUNT(*) AS count FROM classes`).get().count, 2)
  assert.ok(!columnNames(fixture.db, 'classes').includes('stage'))
  const ids = stagePhase8Prefixes(staged, ['047_'])
  assert.throws(() => runMigrations(fixture.db, staged, NOW), '046 副本已有 2 个旧班时，047 必须失败停止，不得按中文班名猜测回填')
  assert.equal(schemaHasPrefix(fixture.db, '047_'), 0, `${ids[0]} 失败时不得写入 schema_migrations`)
  assert.ok(!columnNames(fixture.db, 'classes').includes('stage'))
})

test('负例：046 副本已有 1 条 grant 时 050 必须失败', (t) => {
  const { fixture, staged } = openStaged046(t, {
    seed: (db) => insertBaseline046Shape(db, { existingGrant: true }),
  })
  assert.equal(grantCount(fixture.db), 1)
  stagePhase8Prefixes(staged)
  assert.throws(() => runMigrations(fixture.db, staged, NOW), '执行前 grants != 0 时 050 必须失败停止，禁止 ON CONFLICT 掩盖')
  assert.equal(schemaHasPrefix(fixture.db, '050_'), 0)
  assert.equal(grantCount(fixture.db), 1, '050 失败时不得删除既有 grant')
  assert.ok(fixture.db.prepare(`SELECT id FROM book_access_grants WHERE id = 'preexisting-grant'`).get())
})

test('负例：046 副本某 published 书没有 version 时 050 必须失败', (t) => {
  const { fixture, staged } = openStaged046(t, {
    seed: (db) => insertBaseline046Shape(db, { publishedBookWithoutVersion: true }),
  })
  assert.ok(
    fixture.db.prepare(`SELECT id FROM books WHERE id = 'book-orphan-published' AND status = 'published'`).get(),
  )
  assert.equal(
    fixture.db.prepare(`SELECT COUNT(*) AS count FROM book_versions WHERE book_id = 'book-orphan-published'`).get().count,
    0,
  )
  stagePhase8Prefixes(staged)
  assert.throws(() => runMigrations(fixture.db, staged, NOW), '任一 published 书解析不出当前版本时 050 必须失败停止')
  assert.equal(schemaHasPrefix(fixture.db, '050_'), 0)
})

test('负例：046 副本某学生已有 2 条 active class_memberships 时 049 必须失败', (t) => {
  const { fixture, staged } = openStaged046(t, {
    seed: (db) => insertBaseline046Shape(db, { bookCount: 1, extraCurrentVersionLock: false }),
  })
  applyPhase8AndAssert(fixture.db, staged, { prefixes: ['047_', '048_'] })
  insert047Class(fixture.db, { id: 'class-before-049', classNumber: 2, entryYear: 2024, gradeId: 'primary:2024' })
  fixture.db.prepare(`INSERT INTO class_memberships (
      id, class_id, user_id, membership_role, status, created_at, updated_at, version
    ) VALUES ('class-member-student-second', 'class-before-049', 'internal-demo-student', 'student', 'active', ?, ?, 1)`)
    .run(NOW, NOW)
  assert.equal(
    fixture.db.prepare(`SELECT COUNT(*) AS count FROM class_memberships
      WHERE user_id = 'internal-demo-student' AND membership_role = 'student' AND status = 'active'`).get().count,
    2,
  )
  stagePhase8Prefixes(staged, ['049_'])
  assert.throws(() => runMigrations(fixture.db, staged, NOW), '迁移前若已有学生多 active 班，049 必须停止，不得任选一条保留')
  assert.equal(schemaHasPrefix(fixture.db, '049_'), 0)
  assert.equal(
    fixture.db.prepare(`SELECT COUNT(*) AS count FROM class_memberships
      WHERE user_id = 'internal-demo-student' AND membership_role = 'student' AND status = 'active'`).get().count,
    2,
    '049 失败时不得删减已有多班关系',
  )
})

test('负例：047 之后 INSERT 空 school_code 必须被触发器拒绝', (t) => {
  const { fixture } = openFreshWithPhase8(t)
  assertTableColumns(fixture.db, 'organizations', EXPECTED_047_COLUMNS.organizations)
  assert.throws(() => {
    fixture.db.prepare(`INSERT INTO organizations (id, name, status, school_code, created_at, updated_at, version)
      VALUES ('org-empty-code', 'Empty', 'active', '', ?, ?, 1)`).run(NOW, NOW)
  }, '不得用应用层默认值代替数据库拒绝空 school_code')
  assert.throws(() => {
    fixture.db.prepare(`INSERT INTO organizations (id, name, status, created_at, updated_at, version)
      VALUES ('org-null-code', 'Null', 'active', ?, ?, 1)`).run(NOW, NOW)
  }, '以后创建组织必须显式提供 school_code，NULL 也必须被拒绝')
})

test('负例：047 之后 INSERT 非法 stage 必须被触发器拒绝', (t) => {
  const { fixture, staged } = openStaged046(t, {
    seed: (db) => insertBaseline046Shape(db, { bookCount: 1, extraCurrentVersionLock: false }),
  })
  applyPhase8AndAssert(fixture.db, staged, { prefixes: ['047_'] })
  assertTableColumns(fixture.db, 'classes', EXPECTED_047_COLUMNS.classes)
  assert.throws(() => {
    insert047Class(fixture.db, { id: 'class-bad-stage', stage: 'kindergarten', gradeId: 'kindergarten:2024' })
  }, 'stage 只允许 primary|junior|senior')
  assert.throws(() => {
    insert047Class(fixture.db, { id: 'class-bad-year', entryYear: 99, gradeId: 'primary:99' })
  }, 'entry_year 必须是四位整数')
  assert.throws(() => {
    insert047Class(fixture.db, { id: 'class-bad-number', classNumber: 0, gradeId: 'primary:2024' })
  }, 'class_number 必须是正整数')
})

test('负例：047 之后 INSERT 错误 grade_id 必须被触发器拒绝', (t) => {
  const { fixture, staged } = openStaged046(t, {
    seed: (db) => insertBaseline046Shape(db, { bookCount: 1, extraCurrentVersionLock: false }),
  })
  applyPhase8AndAssert(fixture.db, staged, { prefixes: ['047_'] })
  assertTableColumns(fixture.db, 'classes', EXPECTED_047_COLUMNS.classes)
  assert.throws(() => {
    insert047Class(fixture.db, { id: 'class-bad-grade', stage: 'primary', entryYear: 2024, gradeId: 'junior:2024' })
  }, "grade_id 必须等于 stage || ':' || entry_year")
  assert.throws(() => {
    fixture.db.prepare(`UPDATE classes SET grade_id = 'internal-demo-grade' WHERE id = ?`).run(CLASS_ID)
  }, 'UPDATE 错误 grade_id 也必须被触发器拒绝')
})

test('负例：049 之后同一学生第二条 pending enrollment 必须失败', (t) => {
  const { fixture, staged } = openStaged046(t, {
    seed: (db) => insertBaseline046Shape(db, { bookCount: 1, extraCurrentVersionLock: false }),
  })
  applyPhase8AndAssert(fixture.db, staged, { prefixes: ['047_', '048_', '049_'] })
  assertTableColumns(fixture.db, 'student_enrollment_requests', ENROLLMENT_REQUEST_COLUMNS)
  insertEnrollmentRequest(fixture.db, { id: 'enroll-pending-a', status: 'pending' })
  assert.throws(() => {
    insertEnrollmentRequest(fixture.db, { id: 'enroll-pending-b', status: 'pending' })
  }, '同一学生第二条 pending enrollment 必须失败')
})

test('负例：049 之后同一学生第二条 active student membership 必须失败', (t) => {
  const { fixture, staged } = openStaged046(t, {
    seed: (db) => insertBaseline046Shape(db, { bookCount: 1, extraCurrentVersionLock: false }),
  })
  applyPhase8AndAssert(fixture.db, staged, { prefixes: ['047_', '048_', '049_'] })
  insert047Class(fixture.db, { id: 'class-after-049', classNumber: 2, entryYear: 2024, gradeId: 'primary:2024' })
  assert.throws(() => {
    fixture.db.prepare(`INSERT INTO class_memberships (
        id, class_id, user_id, membership_role, status, created_at, updated_at, version
      ) VALUES ('class-member-student-after-049', 'class-after-049', 'internal-demo-student', 'student', 'active', ?, ?, 1)`)
      .run(NOW, NOW)
  }, '同一学生第二条 active student membership 必须失败')
})

test('负例：050 不得给 draft 书或 disabled 班插 grant', (t) => {
  const { fixture, staged } = openStaged046(t, {
    seed: (db) => insertBaseline046Shape(db, { includeDraftAndArchived: true }),
  })
  applyPhase8AndAssert(fixture.db, staged, { prefixes: ['047_', '048_', '049_'] })
  insert047Class(fixture.db, {
    id: 'class-disabled',
    status: 'disabled',
    classNumber: 2,
    entryYear: 2024,
    gradeId: 'primary:2024',
  })
  insert047Class(fixture.db, {
    id: 'class-graduated',
    status: 'active',
    classNumber: 3,
    entryYear: 2010,
    gradeId: 'primary:2010',
  })
  applyPhase8AndAssert(fixture.db, staged, { prefixes: ['050_'] })
  assert.equal(grantCount(fixture.db), 49)
  assert.equal(
    fixture.db.prepare(`SELECT COUNT(*) AS count FROM book_access_grants
      WHERE book_version_id IN ('version-draft', 'version-archived')`).get().count,
    0,
    '050 不得给 draft/archived 书插 grant',
  )
  assert.equal(
    fixture.db.prepare(`SELECT COUNT(*) AS count FROM book_access_grants
      WHERE grantee_id IN ('class-disabled', 'class-graduated')`).get().count,
    0,
    '050 不得给 disabled/graduated 班插 grant',
  )
})
