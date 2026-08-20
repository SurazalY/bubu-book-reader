/**
 * 把 scripts/sample-accounts.json 写入空库，生成可登录的示例账号。
 *
 * 官方 `npm run seed:identity` 只接受已经算好的 scrypt 哈希，明文口令会被拒绝。
 * `npm run bootstrap:internal` 也不会读取这份清单。所以对接方需要这一层薄封装：
 * 读取明文默认口令、哈希、跑迁移、再调用既有导入器。
 *
 * 用法：
 *   node scripts/import-sample-accounts.mjs --database <sqlite路径>
 *   node scripts/import-sample-accounts.mjs --database <sqlite路径> --file scripts/sample-accounts.json
 *
 * 可用环境变量 SAMPLE_ACCOUNTS_PASSWORD 覆盖清单里的 defaultPassword。
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { hashPassword } from '../server/auth/password.js'
import { openSqliteDatabase } from '../server/db/database.js'
import { runMigrations } from '../server/db/migrate.js'
import { importIdentitySeed } from '../server/db/seed.js'

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(moduleDirectory, '..')
const defaultFile = resolve(projectRoot, 'scripts/sample-accounts.json')
const migrationDirectory = resolve(projectRoot, 'server/db/migrations')

function usage() {
  return '用法: node scripts/import-sample-accounts.mjs --database <sqlite-path> [--file <sample-accounts.json>]'
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
  if (!options.database) {
    throw new Error('--database 为必填参数，避免误写入默认库')
  }
  return options
}

function readSampleFile(filename) {
  try {
    return JSON.parse(readFileSync(filename, 'utf8'))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('示例账号清单 JSON 格式无效')
    }
    throw error
  }
}

function pickUserFields(user) {
  return {
    id: user.id,
    organizationId: user.organizationId,
    username: user.username,
    displayName: user.displayName,
    loginName: user.loginName ?? user.username,
    accountCode: user.accountCode,
    status: user.status,
  }
}

function buildSeed(source, passwordHashValue, existingUserIds) {
  const users = Array.isArray(source.users) ? source.users : []
  if (users.length === 0) {
    throw new Error('示例账号清单缺少 users')
  }
  const existing = existingUserIds instanceof Set ? existingUserIds : new Set()
  return {
    organizations: source.organizations,
    users: users.map(pickUserFields),
    workspaces: source.workspaces,
    workspaceMemberships: source.workspaceMemberships,
    classes: source.classes,
    classMemberships: source.classMemberships,
    roleAssignments: source.roleAssignments,
    credentials: users
      .filter((user) => !existing.has(user.id))
      .map((user) => ({
        id: `credential-${user.id}`,
        userId: user.id,
        passwordHash: passwordHashValue,
      })),
  }
}

function existingCredentialUserIds(database) {
  try {
    return new Set(
      database.prepare('SELECT user_id AS userId FROM credentials').all().map((row) => row.userId),
    )
  } catch {
    return new Set()
  }
}

function resolvePassword(source) {
  const fromEnv = process.env.SAMPLE_ACCOUNTS_PASSWORD
  const password = typeof fromEnv === 'string' && fromEnv.length > 0
    ? fromEnv
    : source.defaultPassword
  if (typeof password !== 'string' || password.length < 6) {
    throw new Error('defaultPassword 或 SAMPLE_ACCOUNTS_PASSWORD 至少需要 6 个字符')
  }
  return password
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(`${usage()}\n`)
    return
  }

  const filePath = resolve(options.file ?? defaultFile)
  const databasePath = resolve(options.database)
  const source = readSampleFile(filePath)
  const password = resolvePassword(source)

  const database = openSqliteDatabase(databasePath)
  try {
    const migrations = runMigrations(database, migrationDirectory)
    const existing = existingCredentialUserIds(database)
    const needsPasswordHash = (source.users ?? []).some((user) => !existing.has(user.id))
    const seed = buildSeed(
      source,
      needsPasswordHash ? hashPassword(password) : null,
      existing,
    )
    const summary = importIdentitySeed(database, seed)
    const accounts = seed.users.map((user) => ({
      loginName: user.loginName,
      displayName: user.displayName,
    }))
    process.stdout.write(`${JSON.stringify({
      file: filePath,
      database: databasePath,
      migrations,
      import: summary,
      accounts,
      passwordSource: process.env.SAMPLE_ACCOUNTS_PASSWORD ? 'SAMPLE_ACCOUNTS_PASSWORD' : 'defaultPassword',
    }, null, 2)}\n`)
  } finally {
    database.close()
  }
}

try {
  main()
} catch (error) {
  process.stderr.write(`sample account import failed: ${error.message}\n`)
  process.exitCode = 1
}
