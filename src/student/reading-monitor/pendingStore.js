export const MAX_PENDING_RECORDS = 512
export const MAX_PENDING_BYTES = 2 * 1024 * 1024
export const PENDING_PRESSURE_RATIO = 0.8

const DATABASE_NAME = 'readmate-reading-monitor-v1'
const DATABASE_VERSION = 1
const STORE_NAME = 'pending_summaries'

function pendingError(code, message, details = {}) {
  const error = new Error(message)
  error.code = code
  Object.assign(error, details)
  return error
}

function requiredScopePart(value, label) {
  if (typeof value !== 'string' || !value) throw pendingError('PENDING_SCOPE_INVALID', `待确认区${label}不能为空`)
  return value
}

export function pendingScopeKey(scope) {
  return JSON.stringify([
    requiredScopePart(scope?.organizationId, 'organizationId'),
    requiredScopePart(scope?.studentId, 'studentId'),
    requiredScopePart(scope?.workspaceId, 'workspaceId'),
    requiredScopePart(scope?.deviceId, 'deviceId'),
  ])
}

export function serializedByteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function recordWithExactByteSize(baseRecord) {
  let byteSize = 0
  let nextByteSize = serializedByteLength({ ...baseRecord, byteSize })
  while (nextByteSize !== byteSize) {
    byteSize = nextByteSize
    nextByteSize = serializedByteLength({ ...baseRecord, byteSize })
  }
  return { ...baseRecord, byteSize }
}

export function pendingUsage(records) {
  const list = Array.isArray(records) ? records : []
  const bytes = list.reduce((total, record) => total + Number(record.byteSize || serializedByteLength(record)), 0)
  return Object.freeze({
    count: list.length,
    bytes,
    recordRatio: list.length / MAX_PENDING_RECORDS,
    byteRatio: bytes / MAX_PENDING_BYTES,
    pressure: list.length >= MAX_PENDING_RECORDS * PENDING_PRESSURE_RATIO || bytes >= MAX_PENDING_BYTES * PENDING_PRESSURE_RATIO,
    full: list.length >= MAX_PENDING_RECORDS || bytes >= MAX_PENDING_BYTES,
  })
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || pendingError('PENDING_STORE_FAILED', '待确认区请求失败'))
  })
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error || pendingError('PENDING_STORE_FAILED', '待确认区事务已取消'))
    transaction.onerror = () => reject(transaction.error || pendingError('PENDING_STORE_FAILED', '待确认区事务失败'))
  })
}

function openDatabase(indexedDBImpl, databaseName) {
  if (!indexedDBImpl?.open) return Promise.reject(pendingError('PENDING_STORE_UNAVAILABLE', '当前浏览器不支持阅读待确认区'))
  return new Promise((resolve, reject) => {
    const request = indexedDBImpl.open(databaseName, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' })
        store.createIndex('scope_created', ['scopeKey', 'createdAt', 'sessionId', 'revision'], { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || pendingError('PENDING_STORE_UNAVAILABLE', '无法打开阅读待确认区'))
    request.onblocked = () => reject(pendingError('PENDING_STORE_BLOCKED', '阅读待确认区升级被其他页面阻塞'))
  })
}

function recordsForScope(records, scopeKey) {
  return records
    .filter((record) => record.scopeKey === scopeKey)
    .sort((left, right) => left.createdAt - right.createdAt || left.sessionId.localeCompare(right.sessionId) || left.revision - right.revision)
}

export function createPendingStore({ indexedDBImpl = globalThis.indexedDB, databaseName = DATABASE_NAME } = {}) {
  let databasePromise = null
  const database = () => {
    databasePromise ||= openDatabase(indexedDBImpl, databaseName)
    return databasePromise
  }

  async function allRecords(mode = 'readonly') {
    const db = await database()
    const transaction = db.transaction(STORE_NAME, mode)
    const records = await requestResult(transaction.objectStore(STORE_NAME).getAll())
    await transactionDone(transaction)
    return records
  }

  async function list(scope) {
    const scopeKey = pendingScopeKey(scope)
    return recordsForScope(await allRecords(), scopeKey)
  }

  async function putBeforeRequest({ scope, summary, idempotencyKey, createdAt = Date.now() }) {
    const scopeKey = pendingScopeKey(scope)
    if (!summary?.sessionId || !Number.isSafeInteger(summary?.revision) || summary.revision < 1) {
      throw pendingError('PENDING_RECORD_INVALID', '待确认摘要缺少有效sessionId或revision')
    }
    if (typeof idempotencyKey !== 'string' || !idempotencyKey) throw pendingError('PENDING_RECORD_INVALID', '待确认摘要缺少稳定幂等键')
    const key = JSON.stringify([scopeKey, summary.sessionId, summary.revision])
    const baseRecord = { key, scopeKey, sessionId: summary.sessionId, revision: summary.revision, idempotencyKey, summary, createdAt }
    const record = recordWithExactByteSize(baseRecord)
    const db = await database()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      let result = null
      let explicitError = null
      const read = store.getAll()
      read.onerror = () => {
        explicitError = read.error || pendingError('PENDING_STORE_FAILED', '无法读取阅读待确认区')
        transaction.abort()
      }
      read.onsuccess = () => {
        const scoped = recordsForScope(read.result, scopeKey)
        const existing = scoped.find((item) => item.key === key)
        if (existing) {
          if (JSON.stringify(existing.summary) !== JSON.stringify(summary) || existing.idempotencyKey !== idempotencyKey) {
            explicitError = pendingError('PENDING_REVISION_CONFLICT', '同一会话修订的本地摘要内容冲突', { key })
            transaction.abort()
            return
          }
          result = { record: existing, inserted: false, usage: pendingUsage(read.result) }
          return
        }
        const usage = pendingUsage(read.result)
        if (usage.count + 1 > MAX_PENDING_RECORDS || usage.bytes + record.byteSize > MAX_PENDING_BYTES) {
          explicitError = pendingError('PENDING_STORE_FULL', '阅读待确认区已满，请联网后重试', { usage })
          transaction.abort()
          return
        }
        const add = store.add(record)
        add.onerror = () => {
          explicitError = add.error || pendingError('PENDING_STORE_FAILED', '无法持久化阅读摘要')
        }
        result = { record, inserted: true, usage: pendingUsage([...read.result, record]) }
      }
      transaction.oncomplete = () => resolve(result)
      transaction.onabort = () => reject(explicitError || transaction.error || pendingError('PENDING_STORE_FAILED', '待确认区写入事务失败'))
      transaction.onerror = () => {
        explicitError ||= transaction.error
      }
    })
  }

  async function remove(key) {
    const db = await database()
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(key)
    await transactionDone(transaction)
  }

  async function has(key) {
    const db = await database()
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const result = await requestResult(transaction.objectStore(STORE_NAME).get(key))
    await transactionDone(transaction)
    return Boolean(result)
  }

  return Object.freeze({
    putBeforeRequest,
    list,
    remove,
    has,
    async usage() {
      return pendingUsage(await allRecords())
    },
    async close() {
      const db = await databasePromise
      db?.close?.()
      databasePromise = null
    },
  })
}
