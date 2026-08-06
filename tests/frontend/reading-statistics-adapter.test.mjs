import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  createStudentReadingStatisticsApi,
  normalizeStudentReadingStatistics,
} from '../../src/student/state/useReadingStatistics.js'
import {
  createConsoleReadingStatisticsApi,
  normalizeScopedReadingStatistics,
} from '../../src/console/state/useReadingStatistics.js'

test('学生阅读统计适配器只读取真实 API，并保留等级输入、按书排行与最近阅读', async () => {
  const calls = []
  const client = {
    get(path, options) {
      calls.push({ path, options })
      return Promise.resolve({ data: { totalEffectiveReadingSeconds: 300 }, meta: { requestId: 'request-1' } })
    },
  }
  const api = createStudentReadingStatisticsApi(client)
  await api.getSummary({ workspaceId: 'workspace-a' })
  assert.deepEqual(calls, [{ path: '/reading/statistics/self', options: { workspaceId: 'workspace-a' } }])

  const value = normalizeStudentReadingStatistics({
    totalEffectiveReadingSeconds: 300,
    todayEffectiveReadingSeconds: 240,
    weekEffectiveReadingSeconds: 300,
    readingDays: 2,
    byBook: [{ bookId: 'book-a', bookVersionId: 'version-a', title: '真实书籍 A', effectiveReadingSeconds: 300 }],
    recentReading: [{ bookId: 'book-a', title: '真实书籍 A', lastReadAt: '2026-08-06T04:00:00.000Z' }],
    levelInput: { totalEffectiveReadingSeconds: 300, readingDays: 2, startedBookCount: 1 },
  })
  assert.equal(value.totalEffectiveReadingSeconds, 300)
  assert.equal(value.byBook[0].title, '真实书籍 A')
  assert.equal(value.recentReading[0].lastReadAt, '2026-08-06T04:00:00.000Z')
  assert.deepEqual(value.levelInput, { totalEffectiveReadingSeconds: 300, readingDays: 2, startedBookCount: 1 })
})

test('权限端统计适配器传递班级、学生、书籍和时间范围，不生成竞争性学生排行', async () => {
  const calls = []
  const client = {
    get(path, options) { calls.push({ path, options }); return Promise.resolve({ data: {}, meta: {} }) },
  }
  const api = createConsoleReadingStatisticsApi(client)
  await api.getSummary({
    workspaceId: 'workspace-a',
    query: { classId: 'class-a', studentId: 'student-a', bookVersionId: 'version-a', from: 'from', to: 'to' },
  })
  assert.equal(calls[0].path, '/reading/statistics/scope')
  assert.equal(calls[0].options.query.classId, 'class-a')
  assert.equal(calls[0].options.query.studentId, 'student-a')

  const value = normalizeScopedReadingStatistics({
    participantCount: 2,
    effectiveReadingSeconds: 240,
    trend: [{ windowStartAt: '2026-08-05T20:00:00.000Z', effectiveReadingSeconds: 240, participantCount: 2 }],
    anomalousStays: [{ eventId: 'event-1', studentId: 'student-a', observedSeconds: 600 }],
    eyeCareStatuses: [{ studentId: 'student-a2', status: 'reminder' }],
    studentRanking: [{ studentId: 'student-a' }],
  })
  assert.equal(value.participantCount, 2)
  assert.equal(value.trend[0].effectiveReadingSeconds, 240)
  assert.equal(Object.hasOwn(value, 'studentRanking'), false)
})

test('生产统计状态模块不导入 fixture、mock、MOOC 或 localStorage 业务真相', async () => {
  const sources = await Promise.all([
    readFile(new URL('../../src/student/state/useReadingStatistics.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/console/state/useReadingStatistics.js', import.meta.url), 'utf8'),
  ])
  for (const source of sources) {
    assert.doesNotMatch(source, /(?:data\/fixtures|\bMOOC\b|\bmock\b|localStorage)/i)
  }
})
