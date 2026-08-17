import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createClock } from '../../src/student/reading-monitor/clock.js'
import { createReadingMonitorCoordinator } from '../../src/student/reading-monitor/coordinator.js'
import {
  MAX_PENDING_BYTES,
  MAX_PENDING_RECORDS,
  pendingScopeKey,
  pendingUsage,
} from '../../src/student/reading-monitor/pendingStore.js'
import { createStableView } from '../../src/student/reading-monitor/view.js'

async function waitUntil(predicate, { timeoutMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error(`waitUntil timed out after ${timeoutMs}ms`)
}

function schedulerHarness(startWall) {
  let wallMs = startWall
  let monotonicMs = 0
  let nextId = 0
  const tasks = new Map()
  const clock = createClock({ wallNow: () => wallMs, monotonicNow: () => monotonicMs })
  const scheduler = {
    setTimeout(callback, delayMs) {
      nextId += 1
      tasks.set(nextId, { at: wallMs + delayMs, callback })
      return nextId
    },
    clearTimeout(id) {
      tasks.delete(id)
    },
  }
  async function settle() {
    for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve))
  }
  async function advance(ms) {
    const target = wallMs + ms
    while (true) {
      const due = [...tasks.entries()].sort((a, b) => a[1].at - b[1].at).find(([, task]) => task.at <= target)
      if (!due) break
      const [id, task] = due
      tasks.delete(id)
      monotonicMs += task.at - wallMs
      wallMs = task.at
      task.callback()
      await settle()
    }
    monotonicMs += target - wallMs
    wallMs = target
    await settle()
  }
  async function advanceWithoutCallbacks(ms) {
    wallMs += ms
    monotonicMs += ms
    await settle()
  }
  async function runDueCallbacksLate() {
    while (true) {
      const due = [...tasks.entries()].sort((a, b) => a[1].at - b[1].at).find(([, task]) => task.at <= wallMs)
      if (!due) break
      const [id, task] = due
      tasks.delete(id)
      task.callback()
      await settle()
    }
  }
  return { clock, scheduler, advance, advanceWithoutCallbacks, runDueCallbacksLate, settle, wallNow: () => wallMs }
}

function memoryStore() {
  const records = []
  return {
    records,
    async list(scope) {
      const key = pendingScopeKey(scope)
      return records.filter((record) => record.scopeKey === key).sort((a, b) => a.createdAt - b.createdAt)
    },
    async usage(scope) {
      return pendingUsage(await this.list(scope))
    },
    async putBeforeRequest({ scope, summary, idempotencyKey, createdAt }) {
      const scopeKey = pendingScopeKey(scope)
      const key = JSON.stringify([scopeKey, summary.sessionId, summary.revision])
      const record = { key, scopeKey, sessionId: summary.sessionId, revision: summary.revision, summary, idempotencyKey, createdAt, byteSize: 200 }
      const usage = pendingUsage(records)
      if (usage.count + 1 > MAX_PENDING_RECORDS || usage.bytes + record.byteSize > MAX_PENDING_BYTES) {
        throw Object.assign(new Error('已满'), { code: 'PENDING_STORE_FULL', usage })
      }
      records.push(record)
      return { record, inserted: true, usage: pendingUsage(records) }
    },
    async remove(key) {
      const index = records.findIndex((record) => record.key === key)
      if (index >= 0) records.splice(index, 1)
    },
    async has(key) {
      return records.some((record) => record.key === key)
    },
  }
}

const scope = { organizationId: 'org-1', studentId: 'student-1', workspaceId: 'workspace-1', deviceId: 'device-1' }
const view = (pageNo) => createStableView({ layout: 'single', pageNos: [pageNo] })

function coordinatorFixture({
  startWall = Date.parse('2026-08-10T08:00:00.000Z'),
  submitSummary,
  renewLease,
  scopeInput = scope,
  cryptoImpl = webcrypto,
  onError,
} = {}) {
  const time = schedulerHarness(startWall)
  const store = memoryStore()
  let ids = 0
  const submissions = []
  const coordinator = createReadingMonitorCoordinator({
    clock: time.clock,
    scheduler: time.scheduler,
    pendingStore: store,
    scope: scopeInput,
    bookVersionId: 'version-1',
    initialView: view(10),
    initialReaderMode: 'text',
    readerReady: true,
    idFactory(prefix) {
      ids += 1
      return `${prefix}:${ids}`
    },
    cryptoImpl,
    onError,
    ports: {
      acquireLease: async () => ({ leaseId: 'lease-1', deviceId: 'device-1', expiresAt: new Date(time.wallNow() + 90_000).toISOString() }),
      renewLease: async (input) => renewLease
        ? renewLease(input)
        : ({ leaseId: input.leaseId, renewedAt: new Date(time.wallNow()).toISOString(), expiresAt: new Date(time.wallNow() + 90_000).toISOString() }),
      submitSummary: async (input) => {
        submissions.push(input)
        return submitSummary ? submitSummary(input, submissions.length) : { data: { result: 'accepted' } }
      },
    },
  })
  return { coordinator, submissions, store, time }
}

test('待确认区设备隔离键只使用acquire返回的可信设备', async () => {
  const scopeWithoutDevice = { organizationId: 'org-1', studentId: 'student-1', workspaceId: 'workspace-1' }
  const fixture = coordinatorFixture({ scopeInput: scopeWithoutDevice })
  await fixture.coordinator.start()
  await fixture.coordinator.flush()
  assert.equal(fixture.submissions[0].scope.deviceId, 'device-1')
  await fixture.coordinator.close('reader_close')
  await fixture.coordinator.stop()
})

test('统计日边界先以stat_date_change结束旧会话，再建新会话', async () => {
  const start = Date.parse('2026-08-09T19:59:50.000Z') // 北京03:59:50
  const fixture = coordinatorFixture({ startWall: start })
  await fixture.coordinator.start()
  const oldSessionId = fixture.coordinator.getState().sessionId
  await fixture.time.advance(10_000)
  await fixture.coordinator.waitIdle()
  await waitUntil(() => fixture.submissions[0]?.summary?.endReason === 'stat_date_change')
  const state = fixture.coordinator.getState()
  assert.notEqual(state.sessionId, oldSessionId)
  assert.equal(state.statDate, '2026-08-10')
  assert.equal(fixture.submissions[0].summary.endReason, 'stat_date_change')
  assert.equal(fixture.submissions[0].summary.endedAt, '2026-08-09T20:00:00.000Z')
  assert.equal(fixture.submissions[0].summary.statDate, '2026-08-09')
  await fixture.coordinator.flush()
  assert.equal(fixture.submissions.at(-1).summary.statDate, '2026-08-10')
  await fixture.coordinator.stop()
})

test('租约结束原因由服务端权威关闭，客户端只提交截止前的开放摘要', async () => {
  const fixture = coordinatorFixture({
    renewLease: async () => {
      throw Object.assign(new Error('租约已过期'), { code: 'LEASE_REQUIRED' })
    },
  })
  await fixture.coordinator.start()
  await fixture.time.advance(60_000)
  assert.equal(fixture.coordinator.getState().closed, true)
  await fixture.coordinator.waitIdle()
  await waitUntil(() => fixture.submissions.length >= 1)
  assert.equal(fixture.submissions.at(-1).summary.measuredThroughAt, new Date(fixture.time.wallNow()).toISOString())
  assert.equal(fixture.submissions.at(-1).summary.cumulativeEffectiveMs, 60_000)
  assert.equal(fixture.submissions.at(-1).summary.endedAt, null)
  assert.equal(fixture.submissions.at(-1).summary.endReason, null)
  await fixture.coordinator.stop()
})

test('租约过期回调迟到30秒也不会计入expiresAt之后的时长', async () => {
  const fixture = coordinatorFixture({
    renewLease: async () => {
      throw Object.assign(new Error('网络失败'), { code: 'NETWORK_ERROR' })
    },
  })
  const startedAt = fixture.time.wallNow()
  await fixture.coordinator.start()
  await fixture.time.advance(60_000)
  await fixture.time.advance(15_000)
  await fixture.time.advance(10_000)
  await fixture.time.advanceWithoutCallbacks(35_000)
  await fixture.time.runDueCallbacksLate()
  await fixture.coordinator.waitIdle()
  await waitUntil(() => {
    const summary = fixture.submissions.at(-1)?.summary
    return summary?.cumulativeEffectiveMs === 90_000
      && summary?.measuredThroughAt === new Date(startedAt + 90_000).toISOString()
  })
  const finalSummary = fixture.submissions.at(-1).summary
  assert.equal(finalSummary.measuredThroughAt, new Date(startedAt + 90_000).toISOString())
  assert.equal(finalSummary.cumulativeEffectiveMs, 90_000)
  assert.equal(finalSummary.endedAt, null)
  assert.equal(finalSummary.endReason, null)
  const submissionCount = fixture.submissions.length
  await fixture.coordinator.close('reader_close')
  assert.equal(fixture.submissions.length, submissionCount)
  await fixture.coordinator.stop()
})

function preloadPending(store, { count, totalBytes }) {
  const scopeKey = pendingScopeKey(scope)
  const byteSize = totalBytes == null ? 200 : totalBytes
  for (let index = 0; index < count; index += 1) {
    store.records.push({
      key: `existing-${index}`,
      scopeKey,
      sessionId: `old-${index}`,
      revision: 1,
      summary: { sessionId: `old-${index}`, revision: 1 },
      idempotencyKey: `old-key-${index}`,
      createdAt: index,
      byteSize,
    })
  }
}

async function assertCapacityBoundaryStopsAccumulation(preload) {
  const fixture = coordinatorFixture({
    submitSummary: async () => {
      throw Object.assign(new Error('断网'), { code: 'NETWORK_ERROR' })
    },
  })
  preloadPending(fixture.store, preload)
  await fixture.coordinator.start()
  await fixture.time.advance(10_000)
  await fixture.coordinator.flush()
  const fullState = fixture.coordinator.getState()
  const cumulativeAtFull = fullState.activity.cumulativeEffectiveMs
  assert.equal((await fixture.store.usage(scope)).full, true)
  assert.equal(fullState.activity.segmentActive, false)
  assert.equal(fullState.pendingCapacity.blocked, true)
  assert.equal(fullState.pendingCapacity.usage.full, true)
  assert.equal(fullState.error?.code, 'PENDING_STORE_FULL')
  await fixture.time.advance(10_000)
  await fixture.coordinator.confirmedInteraction()
  assert.equal(fixture.coordinator.getState().activity.cumulativeEffectiveMs, cumulativeAtFull)
  await fixture.coordinator.stop()
}

test('第512条刚达记录硬上限时立即停止新增有效累计', async () => {
  await assertCapacityBoundaryStopsAccumulation({ count: MAX_PENDING_RECORDS - 1 })
})

test('字节数刚达2MiB硬上限时立即停止新增有效累计', async () => {
  await assertCapacityBoundaryStopsAccumulation({ count: 1, totalBytes: MAX_PENDING_BYTES - 200 })
})

test('满载后drain必须低于80%压力线才恢复计时', async () => {
  let acceptsRemaining = 0
  const fixture = coordinatorFixture({
    submitSummary: async () => {
      if (acceptsRemaining > 0) {
        acceptsRemaining -= 1
        return { data: { result: 'accepted' } }
      }
      throw Object.assign(new Error('断网'), { code: 'NETWORK_ERROR' })
    },
  })
  preloadPending(fixture.store, { count: MAX_PENDING_RECORDS - 1 })
  await fixture.coordinator.start()
  await fixture.time.advance(10_000)
  await fixture.coordinator.flush()
  const cumulativeAtFull = fixture.coordinator.getState().activity.cumulativeEffectiveMs

  acceptsRemaining = 102
  await fixture.coordinator.drain()
  assert.equal((await fixture.store.usage(scope)).count, 410)
  assert.equal((await fixture.store.usage(scope)).pressure, true)
  assert.equal(fixture.coordinator.getState().pendingCapacity.blocked, true)
  assert.equal(fixture.coordinator.getState().activity.segmentActive, false)

  acceptsRemaining = 1
  await fixture.coordinator.drain()
  assert.equal((await fixture.store.usage(scope)).count, 409)
  assert.equal((await fixture.store.usage(scope)).pressure, false)
  assert.equal(fixture.coordinator.getState().pendingCapacity.blocked, false)
  assert.equal(fixture.coordinator.getState().activity.segmentActive, true)
  await fixture.time.advance(10_000)
  await fixture.coordinator.confirmedInteraction()
  assert.equal(fixture.coordinator.getState().activity.cumulativeEffectiveMs, cumulativeAtFull + 10_000)
  await fixture.coordinator.stop()
})

test('tickDirect抛错后定时链仍会进行下一次尝试', async () => {
  let digestCalls = 0
  const tickErrors = []
  const fixture = coordinatorFixture({
    cryptoImpl: {
      subtle: {
        digest(algorithm, data) {
          digestCalls += 1
          if (digestCalls === 1) {
            return Promise.reject(Object.assign(new Error('摘要指纹计算失败'), { code: 'DIGEST_FAILED' }))
          }
          return webcrypto.subtle.digest(algorithm, data)
        },
      },
    },
    onError(error, context) {
      tickErrors.push({ error, context })
    },
  })
  await fixture.coordinator.start()
  await fixture.time.advance(300_000)
  await fixture.coordinator.waitIdle()
  assert.equal(fixture.submissions.length, 0)
  assert.equal(digestCalls, 1)
  assert.equal(tickErrors.at(-1)?.context?.phase, 'summary_tick')
  assert.equal(fixture.coordinator.getState().error?.code, 'DIGEST_FAILED')
  await fixture.time.advance(15_000)
  await fixture.coordinator.waitIdle()
  await waitUntil(() => fixture.submissions.length >= 1)
  assert.ok(fixture.submissions.length >= 1)
  assert.equal(fixture.submissions.at(-1).summary.revision, 1)
  await fixture.coordinator.stop()
})

test('摘要提交LEASE_CONFLICT后定时链不永久停摆', async () => {
  let calls = 0
  const fixture = coordinatorFixture({
    submitSummary: async () => {
      calls += 1
      if (calls === 1) throw Object.assign(new Error('当前学生已有其他 open 摘要会话'), { code: 'LEASE_CONFLICT' })
      return { data: { result: 'accepted' } }
    },
  })
  await fixture.coordinator.start()
  await fixture.time.advance(300_000)
  await fixture.coordinator.waitIdle()
  await waitUntil(() => calls >= 1 && fixture.submissions.length >= 1)
  assert.equal(calls, 1)
  assert.equal(fixture.submissions.length, 1)
  await fixture.time.advance(300_000)
  await fixture.coordinator.waitIdle()
  await waitUntil(() => calls >= 2 && fixture.submissions.length >= 2)
  assert.ok(calls >= 2)
  assert.ok(fixture.submissions.length >= 2)
  await fixture.coordinator.stop()
})

test('约5分钟、后台、网络恢复和关闭均触发累计摘要', async () => {
  const fixture = coordinatorFixture()
  await fixture.coordinator.start()
  await fixture.time.advance(300_000)
  await fixture.coordinator.waitIdle()
  await waitUntil(() => fixture.submissions.length >= 1)
  assert.ok(fixture.submissions.length >= 1)
  const beforeClose = fixture.submissions.length
  fixture.coordinator.move(view(11), 'student_adjacent')
  await fixture.coordinator.flush()
  assert.ok(fixture.submissions.length > beforeClose)
  const closed = await fixture.coordinator.close('reader_close', { waitForTerminal: true })
  assert.equal(closed.confirmed, true)
  assert.equal(fixture.submissions.at(-1).summary.endReason, 'reader_close')
  await fixture.coordinator.stop()
})

test('真实生命周期事件在后台、freeze和网络恢复时额外提交', async () => {
  function eventTarget(extra = {}) {
    const listeners = new Map()
    return {
      ...extra,
      addEventListener(type, listener) {
        const group = listeners.get(type) || new Set()
        group.add(listener)
        listeners.set(type, group)
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener)
      },
      dispatch(type) {
        listeners.get(type)?.forEach((listener) => listener())
      },
    }
  }
  const fixture = coordinatorFixture()
  const documentTarget = eventTarget({ visibilityState: 'visible' })
  const windowTarget = eventTarget()
  await fixture.coordinator.start()
  fixture.coordinator.attachLifecycle({ documentTarget, windowTarget })
  await fixture.time.advance(2_000)
  documentTarget.visibilityState = 'hidden'
  documentTarget.dispatch('visibilitychange')
  await fixture.coordinator.waitIdle()
  await waitUntil(() => fixture.submissions.length >= 1)
  const afterBackground = fixture.submissions.length
  assert.ok(afterBackground >= 1)
  documentTarget.dispatch('freeze')
  await fixture.coordinator.waitIdle()
  await waitUntil(() => fixture.submissions.length > afterBackground)
  assert.ok(fixture.submissions.length > afterBackground)
  documentTarget.visibilityState = 'visible'
  documentTarget.dispatch('visibilitychange')
  await fixture.time.advance(1_000)
  windowTarget.dispatch('online')
  await fixture.coordinator.waitIdle()
  await waitUntil(() => fixture.submissions.at(-1)?.summary?.revision >= 3)
  assert.ok(fixture.submissions.at(-1).summary.revision >= 3)
  await fixture.coordinator.close('reader_close')
  await fixture.coordinator.stop()
})

test('首页刷新协调在accepted终态前不解锁', async () => {
  let online = false
  const fixture = coordinatorFixture({
    submitSummary: async () => {
      if (!online) throw Object.assign(new Error('断网'), { code: 'NETWORK_ERROR' })
      return { data: { result: 'accepted' } }
    },
  })
  await fixture.coordinator.start()
  await fixture.time.advance(5_000)
  let settled = false
  const closing = fixture.coordinator.close('reader_close', { waitForTerminal: true }).then((result) => {
    settled = true
    return result
  })
  await waitUntil(() => fixture.store.records.length === 1 && settled === false)
  assert.equal(settled, false)
  assert.equal(fixture.store.records.length, 1)
  online = true
  await fixture.coordinator.drain()
  const result = await closing
  assert.equal(result.confirmed, true)
  assert.equal(fixture.store.records.length, 0)
  await fixture.coordinator.stop()
})

test('Reader所有移动调用都显式携带来源，底栏不再推导百分比或finished', async () => {
  const source = await readFile(new URL('../../src/student/pages/Reader.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /goPageNo\([^,\n)]+\)/)
  assert.match(source, /student_adjacent/)
  assert.match(source, /student_jump/)
  assert.match(source, /restore_position/)
  assert.match(source, /teacher_sync/)
  assert.match(source, /layout_change/)
  assert.match(source, /system_restore/)
  assert.doesNotMatch(source, /BookProgress|\bpercent\s*=|\bfinished\b/)
  assert.match(source, /第 \{readPage\} 页 \/ 共 \{totalPages\} 页/)
})

test('新摘要不发screenOn，旧护眼事件仅以document visibility作为代理', async () => {
  const [summarySource, telemetrySource] = await Promise.all([
    readFile(new URL('../../src/student/reading-monitor/summary.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/student/state/useReadingTelemetry.js', import.meta.url), 'utf8'),
  ])
  assert.doesNotMatch(summarySource, /screenOn/)
  assert.doesNotMatch(telemetrySource, /screenOn:\s*true/)
  assert.match(telemetrySource, /screenOn:\s*state\.visible/)
  assert.match(telemetrySource, /document\.visibilityState === 'visible'/)
})
