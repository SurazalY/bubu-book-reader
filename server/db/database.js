import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

function isPromiseLike(value) {
  return value && typeof value.then === 'function'
}

export function assertSynchronousOperation(operation, name = '操作') {
  if (typeof operation !== 'function') {
    throw new TypeError(`${name} 必须是函数`)
  }
  if (operation.constructor?.name === 'AsyncFunction') {
    throw new TypeError(`${name} 只支持同步操作；异步领域调用必须使用 executeIdempotentAsync`)
  }
}

function runSynchronously(operation, name) {
  assertSynchronousOperation(operation, name)
  const result = operation()
  if (isPromiseLike(result)) {
    throw new TypeError(`${name} 返回了 Promise；异步领域调用必须使用 executeIdempotentAsync`)
  }
  return result
}

export function openSqliteDatabase(filename) {
  if (typeof filename !== 'string' || filename.trim() === '') {
    throw new Error('SQLite 数据库路径不能为空')
  }

  const databasePath = filename === ':memory:' ? filename : resolve(filename)
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true })
  }

  const database = new DatabaseSync(databasePath, { timeout: 5000 })
  database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
  return database
}

export function withTransaction(database, operation) {
  if (database.isTransaction) {
    return runSynchronously(operation, 'withTransaction')
  }

  assertSynchronousOperation(operation, 'withTransaction')
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = runSynchronously(operation, 'withTransaction')
    database.exec('COMMIT')
    return result
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {}
    throw error
  }
}
