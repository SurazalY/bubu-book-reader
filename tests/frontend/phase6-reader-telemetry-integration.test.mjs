import assert from 'node:assert/strict'
import { randomUUID, webcrypto } from 'node:crypto'
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
  return { clock, scheduler, advance, settle, wallNow: () => wallMs }
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

const defaultScope = { organizationId: 'org-1', studentId: 'student-1', workspaceId: 'workspace-1', deviceId: 'device-1' }
const view = (pageNo) => createStableView({ layout: 'single', pageNos: [pageNo] })

let globalSessionCounter = 0

function createCoordinatorHarness({
  startWall = Date.parse('2026-08-10T08:00:00.000Z'),
  bookVersionId = 'version-1',
  initialPage = 5,
  initialReaderMode = 'original',
  scope = defaultScope,
  submitHandler,
} = {}) {
  const time = schedulerHarness(startWall)
  const store = memoryStore()
  const submissions = []
  const stateChanges = []
  const errors = []

  const ports = {
    acquireLease: async () => ({
      leaseId: `lease-${bookVersionId}-${++globalSessionCounter}`,
      deviceId: scope.deviceId,
      expiresAt: new Date(time.wallNow() + 90_000).toISOString(),
    }),
    renewLease: async (input) => ({
      leaseId: input.leaseId,
      renewedAt: new Date(time.wallNow()).toISOString(),
      expiresAt: new Date(time.wallNow() + 90_000).toISOString(),
    }),
    submitSummary: async (input) => {
      submissions.push(input)
      if (submitHandler) return submitHandler(input, submissions.length)
      return { data: { result: 'accepted' } }
    },
  }

  const coordinator = createReadingMonitorCoordinator({
    clock: time.clock,
    scheduler: time.scheduler,
    pendingStore: store,
    scope,
    bookVersionId,
    initialView: view(initialPage),
    initialReaderMode,
    readerReady: true,
    initiallyVisible: true,
    idFactory(prefix) {
      return `${prefix}:${bookVersionId}:${++globalSessionCounter}`
    },
    cryptoImpl: webcrypto,
    ports,
    onError(error, context) {
      errors.push({ error, context })
    },
    onStateChange(event) {
      stateChanges.push(event)
    },
  })

  return {
    time,
    store,
    coordinator,
    submissions,
    stateChanges,
    errors,
  }
}

test('T6.1 模式切换不重复计时：同一 session 内 PDF/OCR 来回切换保持唯一 sessionId 与租约且单页分别独立累加', async (t) => {
  const harness = createCoordinatorHarness({
    initialPage: 10,
    initialReaderMode: 'original',
  })
  t.after(() => harness.coordinator.stop())

  await harness.coordinator.start()
  const initialSessionId = harness.coordinator.getState().sessionId
  const initialLeaseId = harness.coordinator.getState().lease.leaseId
  assert.ok(initialSessionId, '会话必须已启动')
  assert.ok(initialLeaseId, '租约必须已获取')

  // 1. 原版 PDF 模式停留 20 秒
  await harness.time.advance(20_000)

  // 2. 切换为 OCR 文字模式 (text)
  await harness.coordinator.setReaderMode('text')
  assert.equal(harness.coordinator.getState().sessionId, initialSessionId, '模式切换不得改变 sessionId')
  assert.equal(harness.coordinator.getState().lease.leaseId, initialLeaseId, '模式切换不得更换租约')

  // 3. OCR 文字模式停留 30 秒
  await harness.time.advance(30_000)

  // 4. 再次切换回原版 PDF 模式 (original)
  await harness.coordinator.setReaderMode('original')
  assert.equal(harness.coordinator.getState().sessionId, initialSessionId, '再次切换不得改变 sessionId')

  // 5. 原版 PDF 模式继续停留 10 秒
  await harness.time.advance(10_000)

  // 6. 主动触发 flush 持久化快照
  await harness.coordinator.flush()

  assert.equal(harness.submissions.length, 1, '应产生一次提交')
  const summary = harness.submissions[0].summary
  assert.equal(summary.sessionId, initialSessionId)
  assert.equal(summary.revision, 1)
  assert.equal(summary.lastPageNo, 10)
  assert.equal(summary.cumulativeEffectiveMs, 60_000, '总有效阅读毫秒数应恰好为 60 秒')

  // 验证第 10 页覆盖数据：effectiveOriginalMs = 30s, effectiveTextMs = 30s, 两者之和等于总有效时长
  assert.deepEqual(summary.pageCoverage, [
    {
      pageNo: 10,
      effectiveOriginalMs: 30_000,
      effectiveTextMs: 30_000,
      confirmedInteractions: 0,
    },
  ])
  assert.equal(
    summary.pageCoverage[0].effectiveOriginalMs + summary.pageCoverage[0].effectiveTextMs,
    summary.cumulativeEffectiveMs,
    '单页双模式有效覆盖之和必须严格等于会话累计有效毫秒',
  )

  // 验证冻结禁令：摘要顶层字段不得包含 readerMode
  assert.equal(Object.hasOwn(summary, 'readerMode'), false, '不得把 readerMode 写入摘要顶层')
})

test('T6.2 切换不丢会话：模式切换与翻页后多次定时提交 revision 严格连续递增 (1, 2, 3...)', async (t) => {
  const harness = createCoordinatorHarness({
    initialPage: 1,
    initialReaderMode: 'original',
  })
  t.after(() => harness.coordinator.stop())

  await harness.coordinator.start()
  const sessionId = harness.coordinator.getState().sessionId

  // 1. 第 1 页 original 模式阅读 15 秒并触发定时 tick
  await harness.time.advance(15_000)
  await harness.coordinator.flush()
  assert.equal(harness.submissions.length, 1)
  assert.equal(harness.submissions[0].summary.revision, 1)
  assert.equal(harness.submissions[0].summary.cumulativeEffectiveMs, 15_000)

  // 2. 切换到 text 模式继续阅读 20 秒并触发定时 tick
  await harness.coordinator.setReaderMode('text')
  await harness.time.advance(20_000)
  await harness.coordinator.flush()
  assert.equal(harness.submissions.length, 2)
  assert.equal(harness.submissions[1].summary.revision, 2)
  assert.equal(harness.submissions[1].summary.cumulativeEffectiveMs, 35_000)
  assert.equal(harness.submissions[1].summary.sessionId, sessionId)

  // 3. 翻页到第 2 页继续阅读 25 秒并触发定时 tick
  await harness.coordinator.move(view(2), 'student_adjacent')
  await harness.time.advance(25_000)
  await harness.coordinator.flush()
  assert.equal(harness.submissions.length, 3)
  assert.equal(harness.submissions[2].summary.revision, 3)
  assert.equal(harness.submissions[2].summary.cumulativeEffectiveMs, 60_000)
  assert.equal(harness.submissions[2].summary.lastPageNo, 2)

  // 4. 切回 original 模式继续阅读 10 秒并触发定时 tick
  await harness.coordinator.setReaderMode('original')
  await harness.time.advance(10_000)
  await harness.coordinator.flush()
  assert.equal(harness.submissions.length, 4)
  assert.equal(harness.submissions[3].summary.revision, 4)
  assert.equal(harness.submissions[3].summary.cumulativeEffectiveMs, 70_000)

  // 验证 revision 严格为 [1, 2, 3, 4]，没有任何 gap
  const revisions = harness.submissions.map((item) => item.summary.revision)
  assert.deepEqual(revisions, [1, 2, 3, 4], 'revision 序列必须连续递增')
  assert.equal(harness.errors.length, 0, '全流程不产生任何协调器错误')

  // 验证多页与双模式累积 pageCoverage 完整性
  assert.deepEqual(harness.submissions[3].summary.pageCoverage, [
    { pageNo: 1, effectiveOriginalMs: 15_000, effectiveTextMs: 20_000, confirmedInteractions: 0 },
    { pageNo: 2, effectiveOriginalMs: 10_000, effectiveTextMs: 25_000, confirmedInteractions: 0 },
  ])
})

test('T6.3 可见性与生命周期：切后台暂停计时、切前台恢复，关闭阅读器发出 reader_close 终态', async (t) => {
  const harness = createCoordinatorHarness({
    initialPage: 3,
    initialReaderMode: 'text',
  })
  t.after(() => harness.coordinator.stop())

  const fakeDocument = {
    visibilityState: 'visible',
    listeners: new Map(),
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set())
      this.listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      this.listeners.get(type)?.delete(fn)
    },
    dispatch(type) {
      for (const fn of this.listeners.get(type) || []) fn()
    },
  }
  const fakeWindow = {
    listeners: new Map(),
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set())
      this.listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      this.listeners.get(type)?.delete(fn)
    },
    dispatch(type) {
      for (const fn of this.listeners.get(type) || []) fn()
    },
  }

  const detach = harness.coordinator.attachLifecycle({
    documentTarget: fakeDocument,
    windowTarget: fakeWindow,
  })
  t.after(() => detach())

  await harness.coordinator.start()

  // 1. 前台阅读 20 秒
  await harness.time.advance(20_000)

  // 2. 模拟切到后台 (hidden)
  fakeDocument.visibilityState = 'hidden'
  fakeDocument.dispatch('visibilitychange')
  await harness.time.settle()
  await harness.coordinator.waitIdle()

  // 切后台触发 snapshot
  assert.equal(harness.submissions.length, 1)
  assert.equal(harness.submissions[0].summary.cumulativeEffectiveMs, 20_000)

  // 3. 在后台停留 100 秒（不应计入有效时长）
  await harness.time.advance(100_000)

  // 4. 模拟切回前台 (visible)
  fakeDocument.visibilityState = 'visible'
  fakeDocument.dispatch('visibilitychange')
  await harness.time.settle()
  await harness.coordinator.waitIdle()

  // 5. 在前台继续阅读 15 秒
  await harness.time.advance(15_000)
  await harness.coordinator.flush()

  assert.equal(harness.submissions.length, 2)
  assert.equal(harness.submissions[1].summary.revision, 2)
  assert.equal(harness.submissions[1].summary.cumulativeEffectiveMs, 35_000, '后台停留的 100 秒绝不计入有效阅读时长')

  // 6. 模拟关闭阅读器 (close with reader_close)
  const closeResult = await harness.coordinator.close('reader_close')
  assert.equal(closeResult.confirmed, true)
  assert.equal(closeResult.summary.endReason, 'reader_close')
  assert.ok(closeResult.summary.endedAt, '终态摘要必须包含 endedAt')
  assert.equal(harness.coordinator.getState().closed, true)
  assert.equal(harness.coordinator.getState().active, false)
})

test('T6.4 双模式确认交互分账：original/text 交互计数与停留时长正确累积', async (t) => {
  const harness = createCoordinatorHarness({
    initialPage: 7,
    initialReaderMode: 'original',
  })
  t.after(() => harness.coordinator.stop())

  await harness.coordinator.start()

  // 在 original 模式停留 10 秒并确认交互
  await harness.time.advance(10_000)
  await harness.coordinator.confirmedInteraction([7])

  // 切换到 text 模式停留 20 秒并确认交互
  await harness.coordinator.setReaderMode('text')
  await harness.time.advance(20_000)
  await harness.coordinator.confirmedInteraction([7])

  const state = harness.coordinator.getState()
  const coverage = state.activity.pageCoverage.find((entry) => entry.pageNo === 7)
  assert.deepEqual(coverage, {
    pageNo: 7,
    effectiveOriginalMs: 10_000,
    effectiveTextMs: 20_000,
    confirmedInteractions: 2,
  })
})

test('T6.5 跨书切换会话隔离：关闭第一本书触发 book_change 终态，打开第二本书产生新会话与新租约', async (t) => {
  // 1. 书籍 1
  const harness1 = createCoordinatorHarness({
    bookVersionId: 'version-book-1',
    initialPage: 1,
  })
  await harness1.coordinator.start()
  await harness1.time.advance(25_000)
  const closeResult1 = await harness1.coordinator.close('book_change')
  await harness1.coordinator.stop()

  assert.equal(closeResult1.summary.bookVersionId, 'version-book-1')
  assert.equal(closeResult1.summary.endReason, 'book_change')
  assert.equal(closeResult1.summary.cumulativeEffectiveMs, 25_000)

  // 2. 书籍 2
  const harness2 = createCoordinatorHarness({
    bookVersionId: 'version-book-2',
    initialPage: 1,
  })
  await harness2.coordinator.start()
  await harness2.time.advance(15_000)
  const closeResult2 = await harness2.coordinator.close('reader_close')
  await harness2.coordinator.stop()

  assert.equal(closeResult2.summary.bookVersionId, 'version-book-2')
  assert.notEqual(closeResult2.summary.sessionId, closeResult1.summary.sessionId, '跨书必须使用独立 session_id')
  assert.notEqual(closeResult2.summary.leaseId, closeResult1.summary.leaseId, '跨书必须使用独立租约')
  assert.equal(closeResult2.summary.cumulativeEffectiveMs, 15_000)
})
