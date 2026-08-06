import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import { bootstrapInternalDemo } from '../../../server/db/bootstrap-internal-demo.js'
import { createIdentityModule, defaultMigrationDirectory } from '../../../server/domains/identity/index.js'
import { listMigrationFiles } from '../../../server/db/migrate.js'

function createBootstrapFixture(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  const databasePath = join(directory, 'demo.sqlite')
  const manifestPath = join(directory, 'delivery_manifest.json')
  writeFileSync(
    manifestPath,
    JSON.stringify({
      label: 'PUBLIC DOMAIN / INTERNAL TEST MATERIAL',
      books: [],
      files: [],
    }),
    'utf8',
  )
  return {
    directory,
    databasePath,
    manifestPath,
    publicRoot: join(directory, 'public'),
  }
}

function assertDatabaseFilesReleasable(databasePath) {
  for (const filename of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (!existsSync(filename)) continue
    const renamed = `${filename}.released`
    renameSync(filename, renamed)
    unlinkSync(renamed)
  }
}

function bootstrapOptions(fixture) {
  return {
    databasePath: fixture.databasePath,
    manifestPath: fixture.manifestPath,
    publicRoot: fixture.publicRoot,
    password: randomBytes(18).toString('base64url'),
  }
}

test('bootstrapInternalDemo 成功返回后立即释放数据库及 WAL/SHM', async () => {
  const fixture = createBootstrapFixture('readmate-bootstrap-release-success-')
  let completed = false
  try {
    await bootstrapInternalDemo(bootstrapOptions(fixture))
    assertDatabaseFilesReleasable(fixture.databasePath)
    completed = true
  } finally {
    if (completed) rmSync(fixture.directory, { recursive: true, force: true })
  }
})

test('bootstrapInternalDemo 初始化失败后也释放已取得所有权的数据库连接', async () => {
  const fixture = createBootstrapFixture('readmate-bootstrap-release-failure-')
  const database = new DatabaseSync(fixture.databasePath)
  database.exec(`
    CREATE TABLE schema_migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)
  const firstMigration = listMigrationFiles(defaultMigrationDirectory())[0]
  database.prepare('INSERT INTO schema_migrations (id, checksum, applied_at) VALUES (?, ?, ?)').run(
    firstMigration.id,
    'invalid-checksum',
    new Date().toISOString(),
  )
  database.close()

  let completed = false
  try {
    await assert.rejects(
      bootstrapInternalDemo(bootstrapOptions(fixture)),
      /已执行迁移被修改/,
    )
    assertDatabaseFilesReleasable(fixture.databasePath)
    completed = true
  } finally {
    if (completed) rmSync(fixture.directory, { recursive: true, force: true })
  }
})

test('identity close 可重复调用且释放自有数据库连接', () => {
  const fixture = createBootstrapFixture('readmate-identity-close-idempotent-')
  let completed = false
  try {
    const identity = createIdentityModule({
      databasePath: fixture.databasePath,
      sessionSecret: randomBytes(48).toString('base64url'),
      cookieSecure: false,
    })
    identity.close()
    identity.close()
    assertDatabaseFilesReleasable(fixture.databasePath)
    completed = true
  } finally {
    if (completed) rmSync(fixture.directory, { recursive: true, force: true })
  }
})
