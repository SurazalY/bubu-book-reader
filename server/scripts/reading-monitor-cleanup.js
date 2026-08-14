import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import { openSqliteDatabase } from '../db/database.js'
import { runMigrations } from '../db/migrate.js'
import { defaultDatabasePath, defaultMigrationDirectory } from '../domains/identity/index.js'
import { cleanupReadingSummarySessions } from '../domains/reading/monitoring.js'

function usage() {
  return '用法: node server/scripts/reading-monitor-cleanup.js [--database <sqlite-path>] [--now <ISO-time>]'
}

export function parseReadingMonitorCleanupArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') return { help: true }
    if (argument === '--database' || argument === '--now') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${argument} 必须提供值`)
      options[argument.slice(2)] = value
      index += 1
      continue
    }
    throw new Error(`不支持的参数: ${argument}`)
  }
  return options
}

export function runReadingMonitorCleanup({
  databasePath = process.env.DATABASE_PATH ?? defaultDatabasePath(),
  migrationDirectory = defaultMigrationDirectory(),
  now = new Date(),
} = {}) {
  const database = openSqliteDatabase(databasePath)
  try {
    runMigrations(database, migrationDirectory)
    return cleanupReadingSummarySessions({ db: database, now })
  } finally {
    database.close()
  }
}

export function main(argv = process.argv.slice(2)) {
  const options = parseReadingMonitorCleanupArguments(argv)
  if (options.help) {
    process.stdout.write(`${usage()}\n`)
    return null
  }
  const result = runReadingMonitorCleanup({
    databasePath: options.database ?? process.env.DATABASE_PATH ?? defaultDatabasePath(),
    now: options.now ?? new Date(),
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
  return result
}

const isDirectEntry = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (isDirectEntry) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`reading monitor cleanup failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
