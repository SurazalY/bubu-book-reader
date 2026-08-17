import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import test from 'node:test'

import { createClock } from '../../src/student/reading-monitor/clock.js'
import { SESSION_END_REASONS } from '../../src/student/reading-monitor/constants.js'
import { createLeaseController } from '../../src/student/reading-monitor/leaseController.js'
import { canonicalSummaryValues, createRevisionCursor, createSummaryRevision } from '../../src/student/reading-monitor/summary.js'

function scheduledHarness(startWall = Date.parse('2026-08-10T08:00:00.000Z')) {
  let wallMs = startWall
  let monotonicMs = 0
  let sequence = 0
  const tasks = new Map()
  const clock = createClock({ wallNow: () => wallMs, monotonicNow: () => monotonicMs })
  const scheduler = {
    setTimeout(callback, delayMs) {
      sequence += 1
      tasks.set(sequence, { at: wallMs + delayMs, callback })
      return sequence
    },
    clearTimeout(id) {
      tasks.delete(id)
    },
  }
  async function advance(ms) {
    const target = wallMs + ms
    while (true) {
      const due = [...tasks.entries()].sort((left, right) => left[1].at - right[1].at).find(([, task]) => task.at <= target)
      if (!due) break
      const [id, task] = due
      tasks.delete(id)
      monotonicMs += task.at - wallMs
      wallMs = task.at
      task.callback()
      await new Promise((resolve) => setImmediate(resolve))
    }
    monotonicMs += target - wallMs
    wallMs = target
    await new Promise((resolve) => setImmediate(resolve))
  }
  async function advanceWithoutCallbacks(ms) {
    wallMs += ms
    monotonicMs += ms
    await new Promise((resolve) => setImmediate(resolve))
  }
  async function runDueCallbacksLate() {
    while (true) {
      const due = [...tasks.entries()].sort((left, right) => left[1].at - right[1].at).find(([, task]) => task.at <= wallMs)
      if (!due) break
      const [id, task] = due
      tasks.delete(id)
      task.callback()
      await new Promise((resolve) => setImmediate(resolve))
    }
  }
  return { clock, scheduler, advance, advanceWithoutCallbacks, runDueCallbacksLate, wallNow: () => wallMs }
}

const scope = { organizationId: 'org-1', studentId: 'student-1', workspaceId: 'workspace-1', deviceId: 'device-1' }

test('租约按权威expiresAt在剩30/15/5秒窗口续租重试', async () => {
  const time = scheduledHarness()
  const renewTimes = []
  const renewKeys = []
  let attempt = 0
  const controller = createLeaseController({
    clock: time.clock,
    scheduler: time.scheduler,
    scope,
    bookVersionId: 'version-1',
    idFactory: (prefix) => `${prefix}:key`,
    port: {
      acquireLease: async () => ({ leaseId: 'lease-1', expiresAt: new Date(time.wallNow() + 90_000).toISOString() }),
      renewLease: async ({ idempotencyKey }) => {
        renewTimes.push(time.wallNow())
        renewKeys.push(idempotencyKey)
        attempt += 1
        if (attempt < 3) throw Object.assign(new Error('网络失败'), { code: 'NETWORK_ERROR' })
        return { leaseId: 'lease-1', renewedAt: new Date(time.wallNow()).toISOString(), expiresAt: new Date(time.wallNow() + 90_000).toISOString() }
      },
    },
  })
  const startedAt = time.wallNow()
  await controller.start()
  await time.advance(60_000)
  await time.advance(15_000)
  await time.advance(10_000)
  assert.deepEqual(renewTimes.map((value) => value - startedAt), [60_000, 75_000, 85_000])
  assert.equal(new Set(renewKeys).size, 1)
  assert.equal(controller.isValid(), true)
  assert.equal(controller.current().expiresAtMs, time.wallNow() + 90_000)
})

test('续租接管冲突立即停止，过期不会本地复活', async () => {
  const time = scheduledHarness()
  const invalid = []
  const controller = createLeaseController({
    clock: time.clock,
    scheduler: time.scheduler,
    scope,
    bookVersionId: 'version-1',
    idFactory: (prefix) => `${prefix}:key`,
    onInvalid: (event) => invalid.push(event),
    port: {
      acquireLease: async () => ({ leaseId: 'lease-1', expiresAt: new Date(time.wallNow() + 90_000).toISOString() }),
      renewLease: async () => { throw Object.assign(new Error('已接管'), { code: 'LEASE_CONFLICT' }) },
    },
  })
  await controller.start()
  await time.advance(60_000)
  assert.deepEqual(invalid.map((event) => event.reason), ['lease_taken_over'])
  assert.equal(invalid[0].invalidatedAtMs, time.wallNow())
  assert.equal(controller.current(), null)
  assert.equal(controller.isValid(), false)
})

test('过期timer迟到时仍以服务端expiresAt作为权威失效截止', async () => {
  const time = scheduledHarness()
  const invalid = []
  const controller = createLeaseController({
    clock: time.clock,
    scheduler: time.scheduler,
    scope,
    bookVersionId: 'version-1',
    idFactory: (prefix) => `${prefix}:key`,
    onInvalid: (event) => invalid.push(event),
    port: {
      acquireLease: async () => ({ leaseId: 'lease-1', expiresAt: new Date(time.wallNow() + 90_000).toISOString() }),
      renewLease: async () => { throw Object.assign(new Error('网络失败'), { code: 'NETWORK_ERROR' }) },
    },
  })
  const startedAt = time.wallNow()
  await controller.start()
  await time.advance(60_000)
  await time.advance(15_000)
  await time.advance(10_000)
  await time.advanceWithoutCallbacks(35_000)
  await time.runDueCallbacksLate()
  assert.equal(time.wallNow() - startedAt, 120_000)
  assert.equal(invalid.length, 1)
  assert.equal(invalid[0].reason, 'lease_ended')
  assert.equal(invalid[0].invalidatedAtMs, startedAt + 90_000)
  assert.equal(controller.isValid(), false)
})

test('客户端规范指纹与冻结JSON字段顺序完全一致', async () => {
  const input = {
    sessionId: 'session-1',
    revision: 2,
    leaseId: 'lease-1',
    bookVersionId: 'version-1',
    statDate: '2026-08-10',
    startedAt: '2026-08-10T08:00:00.000Z',
    measuredThroughAt: '2026-08-10T08:12:00.000Z',
    cumulativeEffectiveMs: 420_000,
    hadSkip: true,
    hadReread: false,
    lastPageNo: 18,
    pageCoverage: [{ pageNo: 18, effectiveOriginalMs: 120_000, effectiveTextMs: 300_000, confirmedInteractions: 2 }],
    endedAt: null,
    endReason: null,
  }
  const summary = await createSummaryRevision(input, { cryptoImpl: webcrypto })
  const expected = createHash('sha256').update(JSON.stringify(canonicalSummaryValues({ schemaVersion: 2, ...input }))).digest('hex')
  assert.equal(summary.fingerprint, expected)
  assert.match(summary.fingerprint, /^[0-9a-f]{64}$/)
  assert.equal(Object.hasOwn(summary, 'screenOn'), false)
})

test('revision从1严格连续，8个结束原因均受控', async () => {
  const cursor = createRevisionCursor()
  assert.equal(cursor.peek(), 1)
  cursor.commit(1)
  assert.equal(cursor.peek(), 2)
  assert.throws(() => cursor.commit(3), /期待2/)
  assert.deepEqual(SESSION_END_REASONS, [
    'reader_close', 'identity_change', 'workspace_change', 'book_change',
    'stat_date_change', 'lease_ended', 'lease_taken_over', 'account_deleted',
  ])

  const base = {
    sessionId: 'session-1', revision: 1, leaseId: 'lease-1', bookVersionId: 'version-1', statDate: '2026-08-10',
    startedAt: '2026-08-10T08:00:00.000Z', measuredThroughAt: '2026-08-10T08:01:00.000Z',
    cumulativeEffectiveMs: 60_000, hadSkip: false, hadReread: false, lastPageNo: 1, pageCoverage: [],
  }
  await assert.rejects(
    () => createSummaryRevision({ ...base, endedAt: '2026-08-10T08:01:00.000Z', endReason: 'unknown' }, { cryptoImpl: webcrypto }),
    /受控枚举/,
  )
})
