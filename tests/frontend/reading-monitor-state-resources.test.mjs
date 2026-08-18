import assert from 'node:assert/strict'
import test from 'node:test'

import { ApiError } from '../../src/api/envelope.js'
import { buildStudentReaderUrl } from '../../src/api/student.js'
import {
  createDailyReadingBriefController,
  parseStudentReadingStatistics,
} from '../../src/student/state/useReadingStatistics.js'
import {
  buildReadingClassOptions,
  createScopedReadingStatisticsController,
  parseScopedReadingStatistics,
  statDateAtBeijingFour,
} from '../../src/console/state/useReadingStatistics.js'

const dates = ['2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10']

function selfDto(overrides = {}) {
  return {
    generatedAt: '2026-08-10T09:00:00.000Z',
    dataUpdatedAt: '2026-08-10T08:58:10.000Z',
    statDate: '2026-08-10',
    todayEffectiveReadingSeconds: 299,
    checkIn: { checked: false, thresholdSeconds: 300, remainingSeconds: 1 },
    streakDays: 0,
    comparisonState: 'no_baseline',
    lastReading: {
      bookId: 'book / 1',
      bookVersionId: 'version?1',
      title: '书名',
      lastPageNo: 300,
      totalPages: 300,
      lastReadAt: '2026-08-10T08:58:10.000Z',
    },
    ...overrides,
  }
}

function scopeDto(overrides = {}) {
  const recentDays = dates.map((statDate) => ({ statDate, effectiveReadingSeconds: 0, checkedIn: false }))
  return {
    generatedAt: '2026-08-10T09:00:00.000Z',
    dataUpdatedAt: '2026-08-10T08:58:10.000Z',
    statDate: '2026-08-10',
    class: { classId: 'class-1', displayName: '五年级一班', activeStudentCount: 1 },
    summary: {
      checkedInStudentCount: 0,
      checkInRateBasisPoints: 0,
      totalEffectiveReadingSeconds: 299,
      perCapitaEffectiveReadingSeconds: 299,
      skipStudentCount: 0,
      rereadStudentCount: 0,
    },
    trend: dates.map((statDate) => ({
      statDate,
      checkedInStudentCount: 0,
      activeStudentCount: 1,
      checkInRateBasisPoints: 0,
      perCapitaEffectiveReadingSeconds: 0,
    })),
    students: [{
      studentId: 'student-1',
      displayName: '阿布',
      todayEffectiveReadingSeconds: 299,
      checkedIn: false,
      streakDays: 0,
      hadSkip: false,
      hadReread: false,
      lastReadAt: null,
      lastWeek: {
        totalEffectiveReadingSeconds: 0,
        dailyAverageEffectiveReadingSeconds: 0,
        todayDeltaSeconds: null,
        comparisonState: 'no_baseline',
      },
      recentDays,
      lastReading: null,
    }],
    ...overrides,
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))
const sevenDatesEnding = (statDate) => Array.from({ length: 7 }, (_, index) => {
  const date = new Date(`${statDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - 6 + index)
  return date.toISOString().slice(0, 10)
})

test('self DTO is strict and final page only builds an exact position URL', () => {
  const parsed = parseStudentReadingStatistics(selfDto())
  assert.equal(parsed.todayEffectiveReadingSeconds, 299)
  assert.equal(parsed.lastReading.lastPageNo, 300)
  assert.equal('finished' in parsed.lastReading, false)
  assert.equal('percent' in parsed.lastReading, false)
  assert.equal(
    buildStudentReaderUrl(parsed.lastReading),
    '/student/reader/book%20%2F%201?versionId=version%3F1&pageNo=300',
  )
  const growthSpace = parseStudentReadingStatistics(selfDto({ comparisonState: 'growth_space' }))
  assert.equal(growthSpace.comparisonState, 'growth_space')
  assert.throws(() => parseStudentReadingStatistics(selfDto({ comparisonState: 'less' })), /comparisonState/)
  assert.throws(() => parseStudentReadingStatistics({ ...selfDto(), totalEffectiveReadingSeconds: 0 }), /字段集合不正确/)
  assert.throws(() => parseStudentReadingStatistics(selfDto({ todayEffectiveReadingSeconds: undefined })), /合法整数|大于等于/)
  assert.throws(() => buildStudentReaderUrl({ ...parsed.lastReading, lastPageNo: 301 }), /within the declared book bounds/)
})

test('self controller keeps the last good fact stale and never advances dataUpdatedAt on failure', async () => {
  let response = { data: selfDto(), meta: { requestId: 'request-1' } }
  const controller = createDailyReadingBriefController({
    workspaceId: 'workspace-1',
    api: { getSummary: async () => {
      if (response instanceof Error) throw response
      return response
    } },
  })
  controller.start()
  await flush()
  const ready = controller.getState().resource
  assert.equal(ready.status, 'ready')
  assert.equal(ready.data.dataUpdatedAt, '2026-08-10T08:58:10.000Z')

  response = new ApiError({ code: 'DEPENDENCY_UNAVAILABLE', message: 'offline', retryable: true })
  await controller.refresh()
  const stale = controller.getState().resource
  assert.equal(stale.status, 'stale')
  assert.equal(stale.data, ready.data)
  assert.equal(stale.data.dataUpdatedAt, '2026-08-10T08:58:10.000Z')

  response = new ApiError({ code: 'PERMISSION_DENIED', message: 'denied', status: 403 })
  await controller.refresh()
  assert.equal(controller.getState().resource.status, 'forbidden')
  assert.equal(controller.getState().resource.data, null)
  controller.stop()
})

test('scope DTO requires exact seven-day series and honest empty-class null metrics', () => {
  assert.equal(parseScopedReadingStatistics(scopeDto()).trend.length, 7)
  const growthSpaceStudent = {
    ...scopeDto().students[0],
    lastWeek: {
      totalEffectiveReadingSeconds: 600,
      dailyAverageEffectiveReadingSeconds: 85,
      todayDeltaSeconds: -20,
      comparisonState: 'growth_space',
    },
  }
  assert.equal(parseScopedReadingStatistics(scopeDto({ students: [growthSpaceStudent] })).students[0].lastWeek.comparisonState, 'growth_space')
  assert.throws(() => parseScopedReadingStatistics(scopeDto({
    students: [{ ...growthSpaceStudent, lastWeek: { ...growthSpaceStudent.lastWeek, comparisonState: 'less' } }],
  })), /comparisonState/)
  assert.throws(() => parseScopedReadingStatistics(scopeDto({ trend: scopeDto().trend.slice(1) })), /恰好包含 7 天/)
  assert.throws(() => parseScopedReadingStatistics(scopeDto({ pagesRead: 20 })), /字段集合不正确/)
  const empty = parseScopedReadingStatistics(scopeDto({
    dataUpdatedAt: null,
    class: { classId: 'class-1', displayName: '空班', activeStudentCount: 0 },
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
  }))
  assert.equal(empty.summary.checkInRateBasisPoints, null)
  assert.equal(empty.summary.perCapitaEffectiveReadingSeconds, null)
})

test('scope controller composes classes, polls only while visible, refreshes immediately on return, and retains stale data', async () => {
  let visibilityState = 'visible'
  let visibilityListener = () => {}
  let timerCallback = null
  let pollMs = null
  let requestCount = 0
  let fail = false
  const visibility = {
    getState: () => visibilityState,
    subscribe(listener) {
      visibilityListener = listener
      return () => { visibilityListener = () => {} }
    },
  }
  const scheduler = {
    setInterval(callback, ms) {
      timerCallback = callback
      pollMs = ms
      return 1
    },
    clearInterval() {
      timerCallback = null
    },
  }
  const controller = createScopedReadingStatisticsController({
    workspaceId: 'workspace-1',
    api: {
      listStudents: async () => ({
        data: { items: [
          { id: 'student-z', classId: 'class-2', className: '六年级二班' },
          { id: 'student-a', classId: 'class-1', className: '五年级一班' },
          { id: 'student-b', classId: 'class-1', className: '五年级一班' },
        ] },
        meta: {},
      }),
      getSummary: async ({ classId, statDate }) => {
        requestCount += 1
        if (fail) throw new ApiError({ code: 'DEPENDENCY_UNAVAILABLE', message: 'offline' })
        const responseDates = sevenDatesEnding(statDate)
        const base = scopeDto()
        return { data: scopeDto({
          statDate,
          class: { classId, displayName: classId === 'class-1' ? '五年级一班' : '六年级二班', activeStudentCount: 1 },
          trend: responseDates.map((date) => ({
            statDate: date,
            checkedInStudentCount: 0,
            activeStudentCount: 1,
            checkInRateBasisPoints: 0,
            perCapitaEffectiveReadingSeconds: 0,
          })),
          students: base.students.map((student) => ({
            ...student,
            recentDays: responseDates.map((date) => ({ statDate: date, effectiveReadingSeconds: 0, checkedIn: false })),
          })),
        }), meta: { requestId: `r-${requestCount}` } }
      },
    },
    initialClassId: 'class-1',
    initialStatDate: '2026-08-10',
    scheduler,
    visibility,
  })
  controller.start()
  await flush()
  assert.deepEqual(controller.getState().classOptions, [
    { classId: 'class-1', displayName: '五年级一班' },
    { classId: 'class-2', displayName: '六年级二班' },
  ])
  assert.equal(controller.getState().resource.status, 'ready')
  assert.equal(pollMs, 300_000)
  assert.equal(typeof timerCallback, 'function')

  timerCallback()
  await flush()
  assert.equal(requestCount, 2)
  visibilityState = 'hidden'
  visibilityListener()
  assert.equal(timerCallback, null)
  visibilityState = 'visible'
  visibilityListener()
  await flush()
  assert.equal(requestCount, 3)
  assert.equal(typeof timerCallback, 'function')

  controller.setClassId('class-2')
  assert.equal(controller.getState().selectedClassId, 'class-2')
  assert.equal(controller.getState().resource.status, 'loading')
  assert.equal(controller.getState().resource.data, null)
  await flush()
  assert.equal(controller.getState().resource.data.class.classId, 'class-2')
  controller.setStatDate('2026-08-11')
  assert.equal(controller.getState().resource.status, 'loading')
  assert.equal(controller.getState().resource.data, null)
  await flush()
  assert.equal(controller.getState().resource.data.statDate, '2026-08-11')

  const readyData = controller.getState().resource.data
  fail = true
  await controller.refresh()
  assert.equal(controller.getState().resource.status, 'stale')
  assert.equal(controller.getState().resource.data, readyData)
  assert.equal(controller.getState().resource.data.dataUpdatedAt, '2026-08-10T08:58:10.000Z')
  controller.stop()
})

test('class option and Beijing 04:00 helpers are deterministic', () => {
  assert.deepEqual(buildReadingClassOptions({ items: [
    { classId: 'b', className: '二班' },
    { classId: 'a', className: '一班' },
    { classId: 'a', className: '一班' },
    { classId: null, className: '无班级' },
  ] }), [
    { classId: 'a', displayName: '一班' },
    { classId: 'b', displayName: '二班' },
  ])
  assert.equal(statDateAtBeijingFour(Date.parse('2026-08-09T19:59:59.000Z')), '2026-08-09')
  assert.equal(statDateAtBeijingFour(Date.parse('2026-08-09T20:00:00.000Z')), '2026-08-10')
})
