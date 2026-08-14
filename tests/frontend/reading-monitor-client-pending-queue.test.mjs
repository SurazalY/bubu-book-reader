import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_PENDING_BYTES,
  MAX_PENDING_RECORDS,
  createPendingStore,
  pendingScopeKey,
  pendingUsage,
} from '../../src/student/reading-monitor/pendingStore.js'
import { createPendingQueue } from '../../src/student/reading-monitor/pendingQueue.js'

function fakeIndexedDatabase() {
  const databases = new Map()
  function makeRequest(transaction, operation) {
    const request = { result: undefined, error: null, onsuccess: null, onerror: null }
    transaction.pending += 1
    queueMicrotask(() => {
      if (transaction.aborted) return
      try {
        request.result = operation()
        request.onsuccess?.()
      } catch (error) {
        request.error = error
        request.onerror?.()
        transaction.error = error
        transaction.abort()
      } finally {
        transaction.pending -= 1
        setTimeout(() => transaction.completeIfIdle(), 0)
      }
    })
    return request
  }
  function databaseFor(name) {
    if (databases.has(name)) return databases.get(name)
    const records = new Map()
    const database = {
      objectStoreNames: { contains: () => database.created },
      created: false,
      createObjectStore() {
        database.created = true
        return { createIndex() {} }
      },
      transaction() {
        const transaction = {
          pending: 0,
          aborted: false,
          completed: false,
          error: null,
          oncomplete: null,
          onabort: null,
          onerror: null,
          abort() {
            if (transaction.aborted || transaction.completed) return
            transaction.aborted = true
            queueMicrotask(() => transaction.onabort?.())
          },
          completeIfIdle() {
            if (transaction.pending || transaction.aborted || transaction.completed) return
            transaction.completed = true
            transaction.oncomplete?.()
          },
          objectStore() {
            return {
              getAll: () => makeRequest(transaction, () => [...records.values()]),
              get: (key) => makeRequest(transaction, () => records.get(key)),
              add: (record) => makeRequest(transaction, () => {
                if (records.has(record.key)) throw new Error('ConstraintError')
                records.set(record.key, structuredClone(record))
                return record.key
              }),
              delete: (key) => makeRequest(transaction, () => records.delete(key)),
            }
          },
        }
        return transaction
      },
      close() {},
    }
    databases.set(name, database)
    return database
  }
  return {
    open(name) {
      const request = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null }
      queueMicrotask(() => {
        request.result = databaseFor(name)
        if (!request.result.created) request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    },
  }
}

function summary(sessionId, revision, extra = {}) {
  return {
    schemaVersion: 1,
    sessionId,
    revision,
    fingerprint: `${revision}`.padStart(64, '0'),
    ...extra,
  }
}

const scopeA = { organizationId: 'org-a', studentId: 'student-a', workspaceId: 'workspace-a', deviceId: 'device-a' }
const scopeB = { organizationId: 'org-b', studentId: 'student-b', workspaceId: 'workspace-b', deviceId: 'device-b' }

test('IndexedDB待确认区按组织/学生/工作空间/设备隔离并在请求前完成事务', async () => {
  const store = createPendingStore({ indexedDBImpl: fakeIndexedDatabase(), databaseName: 'pending-test-isolation' })
  const first = await store.putBeforeRequest({ scope: scopeA, summary: summary('session-a', 1), idempotencyKey: 'key-a', createdAt: 1 })
  await store.putBeforeRequest({ scope: scopeB, summary: summary('session-b', 1), idempotencyKey: 'key-b', createdAt: 2 })
  assert.equal(first.inserted, true)
  assert.deepEqual((await store.list(scopeA)).map((record) => record.sessionId), ['session-a'])
  assert.deepEqual((await store.list(scopeB)).map((record) => record.sessionId), ['session-b'])
  assert.notEqual(pendingScopeKey(scopeA), pendingScopeKey(scopeB))
  await store.close()
})

test('同revision相同内容稳定重放，异内容本地冲突', async () => {
  const store = createPendingStore({ indexedDBImpl: fakeIndexedDatabase(), databaseName: 'pending-test-replay' })
  const input = { scope: scopeA, summary: summary('session-a', 1), idempotencyKey: 'key-a', createdAt: 1 }
  assert.equal((await store.putBeforeRequest(input)).inserted, true)
  assert.equal((await store.putBeforeRequest(input)).inserted, false)
  await assert.rejects(
    () => store.putBeforeRequest({ ...input, summary: summary('session-a', 1, { changed: true }) }),
    (error) => error.code === 'PENDING_REVISION_CONFLICT',
  )
  await store.close()
})

test('IndexedDB对序列化后超过2MiB的单条摘要直接显式拒绝', async () => {
  const store = createPendingStore({ indexedDBImpl: fakeIndexedDatabase(), databaseName: 'pending-test-byte-limit' })
  await assert.rejects(
    () => store.putBeforeRequest({
      scope: scopeA,
      summary: summary('session-huge', 1, { payload: 'x'.repeat(MAX_PENDING_BYTES) }),
      idempotencyKey: 'key-huge',
    }),
    (error) => error.code === 'PENDING_STORE_FULL',
  )
  assert.equal((await store.usage()).count, 0)
  await store.close()
})

function memoryStore(initial = []) {
  const records = [...initial]
  return {
    records,
    async list(scope) {
      const key = pendingScopeKey(scope)
      return records.filter((record) => record.scopeKey === key).sort((a, b) => a.createdAt - b.createdAt)
    },
    async putBeforeRequest({ scope, summary: value, idempotencyKey, createdAt = 1 }) {
      const scopeKey = pendingScopeKey(scope)
      const key = JSON.stringify([scopeKey, value.sessionId, value.revision])
      const existing = records.find((record) => record.key === key)
      if (existing) return { record: existing, inserted: false, usage: pendingUsage(records.filter((record) => record.scopeKey === scopeKey)) }
      const record = { key, scopeKey, sessionId: value.sessionId, revision: value.revision, summary: value, idempotencyKey, createdAt, byteSize: 100 }
      const scoped = records.filter((item) => item.scopeKey === scopeKey)
      if (scoped.length >= MAX_PENDING_RECORDS) throw Object.assign(new Error('已满'), { code: 'PENDING_STORE_FULL', usage: pendingUsage(scoped) })
      records.push(record)
      return { record, inserted: true, usage: pendingUsage([...scoped, record]) }
    },
    async remove(key) {
      const index = records.findIndex((record) => record.key === key)
      if (index >= 0) records.splice(index, 1)
    },
    async has(key) {
      return records.some((record) => record.key === key)
    },
    async usage(scope) {
      return pendingUsage(await this.list(scope))
    },
  }
}

test('摘要必须先原子持久化再串行请求，三种终态均删除', async () => {
  const store = memoryStore()
  const results = ['accepted', 'replayed', 'superseded']
  let active = 0
  let maxActive = 0
  const calls = []
  const queue = createPendingQueue({
    store,
    scope: scopeA,
    port: {
      async submitSummary({ summary: value }) {
        assert.equal(store.records.some((record) => record.sessionId === value.sessionId && record.revision === value.revision), true)
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setImmediate(resolve))
        active -= 1
        calls.push(value.revision)
        return { data: { result: results[value.revision - 1] } }
      },
    },
  })
  await Promise.all([1, 2, 3].map((revision) => queue.enqueue(summary('session-a', revision), { idempotencyKey: `key-${revision}`, createdAt: revision })))
  assert.deepEqual(calls, [1, 2, 3])
  assert.equal(maxActive, 1)
  assert.equal(store.records.length, 0)
})

test('网络和revision/权限/租约冲突保留记录并停止后续串行修订', async () => {
  for (const code of ['NETWORK_ERROR', 'REVISION_CONFLICT', 'PERMISSION_DENIED', 'LEASE_CONFLICT']) {
    const store = memoryStore()
    const queue = createPendingQueue({
      store,
      scope: scopeA,
      port: { submitSummary: async () => { throw Object.assign(new Error(code), { code }) } },
    })
    const outcome = await queue.enqueue(summary('session-a', 1), { idempotencyKey: 'key-1' })
    assert.equal(outcome.confirmed, false, code)
    assert.equal(store.records.length, 1, code)
    assert.equal(queue.getLastError().code, code)
  }
})

test('512条或2MiB是硬上限，80%压力阈值可观测', () => {
  const records80 = Array.from({ length: Math.ceil(MAX_PENDING_RECORDS * 0.8) }, (_, index) => ({ byteSize: 1, key: String(index) }))
  assert.equal(pendingUsage(records80).pressure, true)
  assert.equal(pendingUsage(Array.from({ length: MAX_PENDING_RECORDS }, () => ({ byteSize: 1 }))).full, true)
  assert.equal(pendingUsage([{ byteSize: MAX_PENDING_BYTES }]).full, true)
})

test('满载时先尝试drain，仍无法排空则显式失败而不覆盖', async () => {
  const scopeKey = pendingScopeKey(scopeA)
  const full = Array.from({ length: MAX_PENDING_RECORDS }, (_, index) => ({
    key: `existing-${index}`, scopeKey, sessionId: `old-${index}`, revision: 1,
    summary: summary(`old-${index}`, 1), idempotencyKey: `old-key-${index}`, createdAt: index, byteSize: 100,
  }))
  const store = memoryStore(full)
  const queue = createPendingQueue({
    store,
    scope: scopeA,
    port: { submitSummary: async () => { throw Object.assign(new Error('断网'), { code: 'NETWORK_ERROR' }) } },
  })
  await assert.rejects(
    () => queue.enqueue(summary('new-session', 1), { idempotencyKey: 'new-key' }),
    (error) => error.code === 'PENDING_STORE_FULL',
  )
  assert.equal(store.records.length, MAX_PENDING_RECORDS)
  assert.equal(store.records.some((record) => record.sessionId === 'new-session'), false)
})
