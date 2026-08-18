import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  createStudentReadingStatisticsApi,
  parseStudentReadingStatistics,
} from '../../src/student/state/useReadingStatistics.js'
import {
  createConsoleReadingStatisticsApi,
  parseScopedReadingStatistics,
} from '../../src/console/state/useReadingStatistics.js'

const dates = ['2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10']

test('学生阅读统计适配器只读取严格 self，不兼容旧等级、按书排行与完成度字段', async () => {
  const calls = []
  const client = {
    get(path, options) {
      calls.push({ path, options })
      return Promise.resolve({ data: {}, meta: { requestId: 'request-1' } })
    },
  }
  const api = createStudentReadingStatisticsApi(client)
  await api.getSummary({ workspaceId: 'workspace-a' })
  assert.deepEqual(calls, [{ path: '/reading/statistics/self', options: { workspaceId: 'workspace-a' } }])

  const value = parseStudentReadingStatistics({
    generatedAt: '2026-08-10T09:00:00.000Z',
    dataUpdatedAt: null,
    statDate: '2026-08-10',
    todayEffectiveReadingSeconds: 300,
    checkIn: { checked: true, thresholdSeconds: 300, remainingSeconds: 0 },
    streakDays: 1,
    comparisonState: 'no_baseline',
    lastReading: {
      bookId: 'book-a',
      bookVersionId: 'version-a',
      title: '真实书籍 A',
      lastPageNo: 300,
      totalPages: 300,
      lastReadAt: '2026-08-10T08:58:00.000Z',
    },
  })
  assert.equal(value.todayEffectiveReadingSeconds, 300)
  assert.equal(value.lastReading.lastPageNo, 300)
  assert.equal(Object.hasOwn(value.lastReading, 'finished'), false)
  assert.equal(Object.hasOwn(value.lastReading, 'percent'), false)
  assert.throws(() => parseStudentReadingStatistics({ ...value, levelInput: {} }), /字段集合不正确/)
})

test('权限端统计适配器只传 classId/statDate，并严格拒绝旧范围和竞争排名字段', async () => {
  const calls = []
  const client = {
    get(path, options) { calls.push({ path, options }); return Promise.resolve({ data: {}, meta: {} }) },
  }
  const api = createConsoleReadingStatisticsApi(client)
  await api.getSummary({ workspaceId: 'workspace-a', classId: 'class-a', statDate: '2026-08-10' })
  assert.deepEqual(calls, [{
    path: '/reading/statistics/scope',
    options: { workspaceId: 'workspace-a', signal: undefined, query: { classId: 'class-a', statDate: '2026-08-10' } },
  }])

  const value = parseScopedReadingStatistics({
    generatedAt: '2026-08-10T09:00:00.000Z',
    dataUpdatedAt: null,
    statDate: '2026-08-10',
    class: { classId: 'class-a', displayName: '五年级一班', activeStudentCount: 0 },
    summary: {
      checkedInStudentCount: 0,
      checkInRateBasisPoints: null,
      totalEffectiveReadingSeconds: 0,
      perCapitaEffectiveReadingSeconds: null,
      skipStudentCount: 0,
      rereadStudentCount: 0,
    },
    trend: dates.map((statDate) => ({
      statDate,
      checkedInStudentCount: 0,
      activeStudentCount: 0,
      checkInRateBasisPoints: null,
      perCapitaEffectiveReadingSeconds: null,
    })),
    students: [],
  })
  assert.equal(value.trend.length, 7)
  assert.equal(value.summary.checkInRateBasisPoints, null)
  assert.throws(() => parseScopedReadingStatistics({ ...value, studentRanking: [] }), /字段集合不正确/)
})

test('生产统计状态模块不导入 fixture、mock 或 MOOC 业务真相', async () => {
  const [studentSource, consoleSource] = await Promise.all([
    readFile(new URL('../../src/student/state/useReadingStatistics.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/console/state/useReadingStatistics.js', import.meta.url), 'utf8'),
  ])
  assert.doesNotMatch(studentSource, /(?:data\/fixtures|\bMOOC\b|\bmock\b|localStorage)/i)
  assert.doesNotMatch(consoleSource, /(?:data\/fixtures|\bMOOC\b|\bmock\b)/i)
})
