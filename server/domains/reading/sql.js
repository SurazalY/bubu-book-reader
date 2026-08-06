import { randomUUID } from 'node:crypto'

export function createDomainContext(dependencies = {}) {
  if (!dependencies.db || typeof dependencies.db.prepare !== 'function') {
    throw new TypeError('C 领域模块需要注入 node:sqlite 兼容的 db.prepare 接口')
  }

  const now = dependencies.now || (() => new Date())
  return {
    db: dependencies.db,
    actor: dependencies.actor,
    workspace: dependencies.workspace,
    authorize: dependencies.authorize || (async () => true),
    audit: dependencies.audit || (() => undefined),
    outbox: dependencies.outbox,
    idFactory: dependencies.idFactory || randomUUID,
    now: () => normalizeDate(now()),
  }
}

export function normalizeDate(value) {
  const result = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(result.getTime())) throw new TypeError('时间必须是有效日期')
  return result
}

export function isoNow(context) {
  return context.now().toISOString()
}

export function run(db, sql, values = {}) {
  return db.prepare(sql).run(values)
}

export function one(db, sql, values = {}) {
  return db.prepare(sql).get(values)
}

export function all(db, sql, values = {}) {
  return db.prepare(sql).all(values)
}

export function transaction(db, operation) {
  if (typeof operation !== 'function') throw new TypeError('transaction operation 必须是同步函数')
  db.exec('BEGIN IMMEDIATE')
  try {
    if (operation.constructor?.name === 'AsyncFunction') {
      const error = new TypeError('SQLite 事务回调必须同步执行，不能使用 async callback')
      error.code = 'ASYNC_TRANSACTION_CALLBACK'
      throw error
    }
    const result = operation()
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => undefined)
      const error = new TypeError('SQLite 事务回调不能返回 Promise')
      error.code = 'ASYNC_TRANSACTION_CALLBACK'
      throw error
    }
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function assertString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} 不能为空`)
  return value.trim()
}

export function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} 必须是正整数`)
  return value
}

export function uniqueRows(rows, key) {
  const seen = new Set()
  for (const row of rows) {
    const value = row[key]
    if (seen.has(value)) throw new TypeError(`${key} 不能重复`)
    seen.add(value)
  }
}
