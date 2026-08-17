import assert from 'node:assert/strict'
import test from 'node:test'

import { createActivityTracker } from '../../src/student/reading-monitor/activity.js'
import { createClock } from '../../src/student/reading-monitor/clock.js'
import { createStableView } from '../../src/student/reading-monitor/view.js'

function harness(startWall = Date.parse('2026-08-10T08:00:00.000Z')) {
  let wallMs = startWall
  let monotonicMs = 0
  const clock = createClock({ wallNow: () => wallMs, monotonicNow: () => monotonicMs })
  return {
    clock,
    advance(ms) {
      wallMs += ms
      monotonicMs += ms
    },
  }
}

const page = (pageNo) => createStableView({ layout: 'single', pageNos: [pageNo] })

function activeTracker(testClock, initialPage = 1) {
  return createActivityTracker({ clock: testClock, initialView: page(initialPage), initialReaderMode: 'text', ready: true, leaseValid: true })
}

test('有效停留4:59、5:00与8:00的单段上限正确', () => {
  const time = harness()
  const tracker = activeTracker(time.clock)
  time.advance(299_000)
  assert.equal(tracker.measure().cumulativeEffectiveMs, 299_000)
  time.advance(1_000)
  assert.equal(tracker.measure().cumulativeEffectiveMs, 300_000)
  time.advance(180_000)
  assert.equal(tracker.measure().cumulativeEffectiveMs, 300_000)
})

test('真实确认交互切段后可重新获得5分钟，仅后台时间为0', () => {
  const time = harness()
  const tracker = activeTracker(time.clock)
  time.advance(300_000)
  tracker.confirmedInteraction()
  time.advance(120_000)
  assert.equal(tracker.measure().cumulativeEffectiveMs, 420_000)
  tracker.setVisible(false)
  time.advance(180_000)
  assert.equal(tracker.measure().cumulativeEffectiveMs, 420_000)
  tracker.setVisible(true)
  time.advance(30_000)
  assert.equal(tracker.measure().cumulativeEffectiveMs, 450_000)
})

test('逐页有效覆盖按阅读模式分账且确认交互记到显式锚点页', () => {
  const time = harness()
  const tracker = activeTracker(time.clock, 1)
  time.advance(10_000)
  tracker.setReaderMode('original')
  time.advance(5_000)
  tracker.move(page(2), 'student_adjacent')
  time.advance(7_000)
  tracker.confirmedInteraction([1])
  assert.deepEqual(tracker.getState().pageCoverage, [
    { pageNo: 1, effectiveOriginalMs: 5_000, effectiveTextMs: 10_000, confirmedInteractions: 1 },
    { pageNo: 2, effectiveOriginalMs: 7_000, effectiveTextMs: 0, confirmedInteractions: 0 },
  ])
  assert.equal(tracker.getState().cumulativeEffectiveMs, 22_000)
})

test('租约失效或待确认区满载后停止新增累计', () => {
  const time = harness()
  const tracker = activeTracker(time.clock)
  time.advance(10_000)
  tracker.setLeaseValid(false)
  time.advance(50_000)
  assert.equal(tracker.measure().cumulativeEffectiveMs, 10_000)
  tracker.setLeaseValid(true)
  time.advance(5_000)
  tracker.setStorageAvailable(false)
  time.advance(50_000)
  assert.equal(tracker.measure().cumulativeEffectiveMs, 15_000)
})

test('跳读需要连续两个相邻视图均大于0且小于5秒', () => {
  const time = harness()
  const tracker = activeTracker(time.clock, 1)
  time.advance(4_999)
  tracker.move(page(2), 'student_adjacent')
  assert.equal(tracker.getState().hadSkip, false)
  time.advance(4_999)
  tracker.move(page(3), 'student_adjacent')
  assert.equal(tracker.getState().hadSkip, true)

  const boundaryTime = harness()
  const boundary = activeTracker(boundaryTime.clock, 1)
  boundaryTime.advance(4_999)
  boundary.move(page(2), 'student_adjacent')
  boundaryTime.advance(5_000)
  boundary.move(page(3), 'student_adjacent')
  assert.equal(boundary.getState().hadSkip, false)
})

test('定位、恢复、教师同步和布局变化不构成跳读', () => {
  for (const source of ['student_jump', 'restore_position', 'teacher_sync', 'layout_change', 'system_restore']) {
    const time = harness()
    const tracker = activeTracker(time.clock, 1)
    time.advance(1_000)
    tracker.move(page(2), source)
    time.advance(1_000)
    tracker.move(page(3), source)
    assert.equal(tracker.getState().hadSkip, false, source)
  }
})

test('回退正好3页且目标视图有效停留超过30秒才记录回读', () => {
  const exact = harness()
  const exactTracker = activeTracker(exact.clock, 10)
  exactTracker.move(page(7), 'student_jump')
  exact.advance(30_000)
  exactTracker.move(page(8), 'student_adjacent')
  assert.equal(exactTracker.getState().hadReread, false)

  const over = harness()
  const overTracker = activeTracker(over.clock, 10)
  overTracker.move(page(7), 'student_jump')
  over.advance(20_000)
  overTracker.setVisible(false)
  over.advance(90_000)
  overTracker.setVisible(true)
  over.advance(10_001)
  overTracker.move(page(8), 'student_adjacent')
  assert.equal(overTracker.getState().hadReread, true)
})

test('回退2页、教师同步或恢复位置都不建立回读候选', () => {
  const cases = [
    [10, 8, 'student_jump'],
    [10, 5, 'teacher_sync'],
    [10, 5, 'restore_position'],
  ]
  for (const [from, to, source] of cases) {
    const time = harness()
    const tracker = activeTracker(time.clock, from)
    tracker.move(page(to), source)
    time.advance(31_000)
    tracker.move(page(to + 1), 'student_adjacent')
    assert.equal(tracker.getState().hadReread, false, source)
  }
})
