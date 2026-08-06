import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { withTransaction } from './database.js'

const migrationFilePattern = /^(\d{3})_[a-z0-9][a-z0-9_-]*\.sql$/i

export class MigrationIntegrityError extends Error {
  constructor(message) {
    super(message)
    this.name = 'MigrationIntegrityError'
  }
}

export function listMigrationFiles(migrationDirectory) {
  if (!existsSync(migrationDirectory)) {
    throw new Error(`迁移目录不存在: ${migrationDirectory}`)
  }

  const filenames = readdirSync(migrationDirectory).filter((filename) => filename.endsWith('.sql'))
  for (const filename of filenames) {
    if (!migrationFilePattern.test(filename)) {
      throw new MigrationIntegrityError(`迁移文件名必须使用三位序号: ${filename}`)
    }
  }

  return filenames
    .sort((left, right) => left.localeCompare(right))
    .map((filename) => {
      const source = readFileSync(join(migrationDirectory, filename), 'utf8')
      return {
        id: filename,
        source,
        checksum: createHash('sha256').update(source, 'utf8').digest('hex'),
      }
    })
}

export function runMigrations(database, migrationDirectory, now = new Date().toISOString()) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)

  const applied = []
  const alreadyApplied = []
  const migrations = listMigrationFiles(migrationDirectory)

  for (const migration of migrations) {
    const existing = database
      .prepare('SELECT checksum FROM schema_migrations WHERE id = ?')
      .get(migration.id)

    if (existing) {
      if (existing.checksum !== migration.checksum) {
        throw new MigrationIntegrityError(`已执行迁移被修改: ${migration.id}`)
      }
      alreadyApplied.push(migration.id)
      continue
    }

    const source = migration.source
      .replace(/^\s*BEGIN\s+IMMEDIATE\s*;\s*$/im, '')
      .replace(/^\s*COMMIT\s*;\s*$/im, '')

    withTransaction(database, () => {
      database.exec(source)
      database
        .prepare('INSERT INTO schema_migrations (id, checksum, applied_at) VALUES (?, ?, ?)')
        .run(migration.id, migration.checksum, now)
    })
    applied.push(migration.id)
  }

  return {
    applied,
    alreadyApplied,
    migrationCount: migrations.length,
  }
}
