import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { openSqliteDatabase } from './database.js'
import { runMigrations } from './migrate.js'
import { importIdentitySeed } from './seed.js'

const moduleDirectory = dirname(fileURLToPath(import.meta.url))

function usage() {
  return '用法: node server/db/import-seed.js --file <seed.json> [--database <sqlite-path>]'
}

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      return { help: true }
    }
    if (argument === '--file' || argument === '--database') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} 必须提供路径`)
      }
      options[argument.slice(2)] = value
      index += 1
      continue
    }
    throw new Error(`不支持的参数: ${argument}`)
  }
  if (!options.file) {
    throw new Error('--file 为必填参数')
  }
  return options
}

function defaultDatabasePath() {
  return process.env.DATABASE_PATH ?? resolve(moduleDirectory, '../data/readmate.sqlite')
}

function readSeedFile(filename) {
  try {
    return JSON.parse(readFileSync(filename, 'utf8'))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('seed JSON 格式无效')
    }
    throw error
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(`${usage()}\n`)
    return
  }

  const seed = readSeedFile(options.file)
  const database = openSqliteDatabase(options.database ?? defaultDatabasePath())
  try {
    const migrations = runMigrations(database, resolve(moduleDirectory, 'migrations'))
    const summary = importIdentitySeed(database, seed)
    process.stdout.write(`${JSON.stringify({ migrations, import: summary })}\n`)
  } finally {
    database.close()
  }
}

try {
  main()
} catch (error) {
  process.stderr.write(`seed import failed: ${error.message}\n`)
  process.exitCode = 1
}
