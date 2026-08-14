import { useEffect, useMemo, useSyncExternalStore } from 'react'

import { createConsoleApi } from '../../api/console.js'
import { ApiError, asApiError } from '../../api/envelope.js'

const POLL_INTERVAL_MS = 5 * 60 * 1_000
const ROOT_FIELDS = Object.freeze(['generatedAt', 'dataUpdatedAt', 'statDate', 'class', 'summary', 'trend', 'students'])
const CLASS_FIELDS = Object.freeze(['classId', 'displayName', 'activeStudentCount'])
const SUMMARY_FIELDS = Object.freeze([
  'checkedInStudentCount',
  'checkInRateBasisPoints',
  'totalEffectiveReadingSeconds',
  'perCapitaEffectiveReadingSeconds',
  'skipStudentCount',
  'rereadStudentCount',
])
const TREND_FIELDS = Object.freeze([
  'statDate',
  'checkedInStudentCount',
  'activeStudentCount',
  'checkInRateBasisPoints',
  'perCapitaEffectiveReadingSeconds',
])
const STUDENT_FIELDS = Object.freeze([
  'studentId',
  'displayName',
  'todayEffectiveReadingSeconds',
  'checkedIn',
  'streakDays',
  'hadSkip',
  'hadReread',
  'lastReadAt',
  'lastWeek',
  'recentDays',
  'lastReading',
])
const LAST_WEEK_FIELDS = Object.freeze([
  'totalEffectiveReadingSeconds',
  'dailyAverageEffectiveReadingSeconds',
  'todayDeltaSeconds',
  'comparisonState',
])
const RECENT_DAY_FIELDS = Object.freeze(['statDate', 'effectiveReadingSeconds', 'checkedIn'])
const LAST_READING_FIELDS = Object.freeze(['bookId', 'bookVersionId', 'title', 'lastPageNo', 'totalPages'])
const COMPARISON_STATES = new Set(['more', 'close', 'growth_space', 'no_baseline'])

function invalidResponse(message) {
  throw new ApiError({
    code: 'INVALID_RESPONSE',
    message: `班级阅读统计响应不符合约定：${message}`,
    retryable: false,
  })
}

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalidResponse(`${label} 必须是对象`)
  return value
}

function requireExactFields(value, fields, label) {
  const record = requireRecord(value, label)
  const actual = Object.keys(record).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalidResponse(`${label} 字段集合不正确`)
  }
  return record
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) invalidResponse(`${label} 必须是非空字符串`)
  return value
}

function requireDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalidResponse(`${label} 必须是 YYYY-MM-DD`)
  return value
}

function requireTimestamp(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null
  const text = requireString(value, label)
  if (!Number.isFinite(Date.parse(text))) invalidResponse(`${label} 必须是有效时间`)
  return text
}

function requireInteger(value, label, { nullable = false, signed = false, min = 0 } = {}) {
  if (nullable && value === null) return null
  if (!Number.isSafeInteger(value) || (!signed && value < min)) invalidResponse(`${label} 必须是合法整数`)
  return value
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') invalidResponse(`${label} 必须是布尔值`)
  return value
}

function assertSevenAscending(items, requestedDate, label) {
  if (!Array.isArray(items) || items.length !== 7) invalidResponse(`${label} 必须恰好包含 7 天`)
  let previous = ''
  items.forEach((item, index) => {
    if (index > 0 && item.statDate <= previous) invalidResponse(`${label} 必须按统计日升序`)
    previous = item.statDate
  })
  if (items[6].statDate !== requestedDate) invalidResponse(`${label} 最后一项必须是请求统计日`)
}

function parseLastReading(value, label) {
  if (value === null) return null
  const source = requireExactFields(value, LAST_READING_FIELDS, label)
  const lastPageNo = requireInteger(source.lastPageNo, `${label}.lastPageNo`, { min: 1 })
  const totalPages = requireInteger(source.totalPages, `${label}.totalPages`, { min: 1 })
  if (lastPageNo > totalPages) invalidResponse(`${label}.lastPageNo 超出书籍总页数`)
  return Object.freeze({
    bookId: requireString(source.bookId, `${label}.bookId`),
    bookVersionId: requireString(source.bookVersionId, `${label}.bookVersionId`),
    title: requireString(source.title, `${label}.title`),
    lastPageNo,
    totalPages,
  })
}

export function parseScopedReadingStatistics(payload) {
  const source = requireExactFields(payload, ROOT_FIELDS, 'scope')
  const statDate = requireDate(source.statDate, 'statDate')
  const classValue = requireExactFields(source.class, CLASS_FIELDS, 'class')
  const summary = requireExactFields(source.summary, SUMMARY_FIELDS, 'summary')
  const activeStudentCount = requireInteger(classValue.activeStudentCount, 'class.activeStudentCount')
  const parsedSummary = Object.freeze({
    checkedInStudentCount: requireInteger(summary.checkedInStudentCount, 'summary.checkedInStudentCount'),
    checkInRateBasisPoints: requireInteger(summary.checkInRateBasisPoints, 'summary.checkInRateBasisPoints', { nullable: true }),
    totalEffectiveReadingSeconds: requireInteger(summary.totalEffectiveReadingSeconds, 'summary.totalEffectiveReadingSeconds'),
    perCapitaEffectiveReadingSeconds: requireInteger(summary.perCapitaEffectiveReadingSeconds, 'summary.perCapitaEffectiveReadingSeconds', { nullable: true }),
    skipStudentCount: requireInteger(summary.skipStudentCount, 'summary.skipStudentCount'),
    rereadStudentCount: requireInteger(summary.rereadStudentCount, 'summary.rereadStudentCount'),
  })
  if (activeStudentCount === 0) {
    if (parsedSummary.checkInRateBasisPoints !== null || parsedSummary.perCapitaEffectiveReadingSeconds !== null) {
      invalidResponse('空班级 rate/perCapita 必须为 null')
    }
  } else if (parsedSummary.checkInRateBasisPoints === null || parsedSummary.perCapitaEffectiveReadingSeconds === null) {
    invalidResponse('非空班级 rate/perCapita 不能为 null')
  }

  if (!Array.isArray(source.trend)) invalidResponse('trend 必须是数组')
  const trend = source.trend.map((entry, index) => {
    const item = requireExactFields(entry, TREND_FIELDS, `trend[${index}]`)
    return Object.freeze({
      statDate: requireDate(item.statDate, `trend[${index}].statDate`),
      checkedInStudentCount: requireInteger(item.checkedInStudentCount, `trend[${index}].checkedInStudentCount`),
      activeStudentCount: requireInteger(item.activeStudentCount, `trend[${index}].activeStudentCount`),
      checkInRateBasisPoints: requireInteger(item.checkInRateBasisPoints, `trend[${index}].checkInRateBasisPoints`, { nullable: true }),
      perCapitaEffectiveReadingSeconds: requireInteger(item.perCapitaEffectiveReadingSeconds, `trend[${index}].perCapitaEffectiveReadingSeconds`, { nullable: true }),
    })
  })
  assertSevenAscending(trend, statDate, 'trend')

  if (!Array.isArray(source.students)) invalidResponse('students 必须是数组')
  const students = source.students.map((entry, index) => {
    const item = requireExactFields(entry, STUDENT_FIELDS, `students[${index}]`)
    const lastWeek = requireExactFields(item.lastWeek, LAST_WEEK_FIELDS, `students[${index}].lastWeek`)
    if (!COMPARISON_STATES.has(lastWeek.comparisonState)) invalidResponse(`students[${index}].lastWeek.comparisonState 非法`)
    const totalLastWeek = requireInteger(lastWeek.totalEffectiveReadingSeconds, `students[${index}].lastWeek.totalEffectiveReadingSeconds`)
    const todayDeltaSeconds = requireInteger(lastWeek.todayDeltaSeconds, `students[${index}].lastWeek.todayDeltaSeconds`, { nullable: true, signed: true })
    if (totalLastWeek === 0 && (todayDeltaSeconds !== null || lastWeek.comparisonState !== 'no_baseline')) {
      invalidResponse(`students[${index}].lastWeek 无基线语义不正确`)
    }
    if (totalLastWeek > 0 && todayDeltaSeconds === null) invalidResponse(`students[${index}].lastWeek.todayDeltaSeconds 缺失`)
    if (!Array.isArray(item.recentDays)) invalidResponse(`students[${index}].recentDays 必须是数组`)
    const recentDays = item.recentDays.map((entryDay, dayIndex) => {
      const day = requireExactFields(entryDay, RECENT_DAY_FIELDS, `students[${index}].recentDays[${dayIndex}]`)
      return Object.freeze({
        statDate: requireDate(day.statDate, `students[${index}].recentDays[${dayIndex}].statDate`),
        effectiveReadingSeconds: requireInteger(day.effectiveReadingSeconds, `students[${index}].recentDays[${dayIndex}].effectiveReadingSeconds`),
        checkedIn: requireBoolean(day.checkedIn, `students[${index}].recentDays[${dayIndex}].checkedIn`),
      })
    })
    assertSevenAscending(recentDays, statDate, `students[${index}].recentDays`)
    return Object.freeze({
      studentId: requireString(item.studentId, `students[${index}].studentId`),
      displayName: requireString(item.displayName, `students[${index}].displayName`),
      todayEffectiveReadingSeconds: requireInteger(item.todayEffectiveReadingSeconds, `students[${index}].todayEffectiveReadingSeconds`),
      checkedIn: requireBoolean(item.checkedIn, `students[${index}].checkedIn`),
      streakDays: requireInteger(item.streakDays, `students[${index}].streakDays`),
      hadSkip: requireBoolean(item.hadSkip, `students[${index}].hadSkip`),
      hadReread: requireBoolean(item.hadReread, `students[${index}].hadReread`),
      lastReadAt: requireTimestamp(item.lastReadAt, `students[${index}].lastReadAt`, { nullable: true }),
      lastWeek: Object.freeze({
        totalEffectiveReadingSeconds: totalLastWeek,
        dailyAverageEffectiveReadingSeconds: requireInteger(lastWeek.dailyAverageEffectiveReadingSeconds, `students[${index}].lastWeek.dailyAverageEffectiveReadingSeconds`),
        todayDeltaSeconds,
        comparisonState: lastWeek.comparisonState,
      }),
      recentDays: Object.freeze(recentDays),
      lastReading: parseLastReading(item.lastReading, `students[${index}].lastReading`),
    })
  })

  return Object.freeze({
    generatedAt: requireTimestamp(source.generatedAt, 'generatedAt'),
    dataUpdatedAt: requireTimestamp(source.dataUpdatedAt, 'dataUpdatedAt', { nullable: true }),
    statDate,
    class: Object.freeze({
      classId: requireString(classValue.classId, 'class.classId'),
      displayName: requireString(classValue.displayName, 'class.displayName'),
      activeStudentCount,
    }),
    summary: parsedSummary,
    trend: Object.freeze(trend),
    students: Object.freeze(students),
  })
}

export const normalizeScopedReadingStatistics = parseScopedReadingStatistics

function studentItems(payload) {
  if (!payload || !Array.isArray(payload.items)) invalidResponse('班级选项响应必须包含 items')
  return payload.items
}

export function buildReadingClassOptions(payload) {
  const classes = new Map()
  studentItems(payload).forEach((student, index) => {
    const source = requireRecord(student, `studentOptions[${index}]`)
    if (typeof source.classId !== 'string' || !source.classId.trim()) return
    const classId = source.classId.trim()
    const displayName = typeof source.className === 'string' && source.className.trim()
      ? source.className.trim()
      : classId
    const current = classes.get(classId)
    if (!current || displayName.localeCompare(current.displayName, 'zh-CN') < 0) {
      classes.set(classId, { classId, displayName })
    }
  })
  return Object.freeze([...classes.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName, 'zh-CN') || left.classId.localeCompare(right.classId, 'en')))
}

export function statDateAtBeijingFour(now = Date.now()) {
  const timestamp = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(timestamp)) throw new TypeError('now must be a valid timestamp')
  return new Date(timestamp + 4 * 60 * 60 * 1_000).toISOString().slice(0, 10)
}

export function createConsoleReadingStatisticsApi(client) {
  const api = createConsoleApi(client)
  return {
    listStudents: (options = {}) => api.listStudents(options),
    getSummary: ({ workspaceId, classId, statDate, signal } = {}) => api.getReadingStatisticsScope(
      { classId, statDate },
      { workspaceId, signal },
    ),
  }
}

function defaultVisibility() {
  return {
    getState: () => (typeof document === 'undefined' ? 'visible' : document.visibilityState),
    subscribe(listener) {
      if (typeof document === 'undefined') return () => {}
      document.addEventListener('visibilitychange', listener)
      return () => document.removeEventListener('visibilitychange', listener)
    },
  }
}

function isForbidden(error) {
  return error?.status === 403 || error?.code === 'PERMISSION_DENIED'
}

export function createScopedReadingStatisticsController({
  api,
  workspaceId,
  initialClassId = '',
  initialStatDate,
  clock = { now: () => Date.now() },
  scheduler = globalThis,
  visibility = defaultVisibility(),
  pollIntervalMs = POLL_INTERVAL_MS,
} = {}) {
  if (!api?.listStudents || !api?.getSummary) throw new TypeError('scope api listStudents/getSummary is required')
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1_000) throw new TypeError('pollIntervalMs must be at least one second')
  let active = false
  let requestVersion = 0
  let timer = null
  let unsubscribeVisibility = () => {}
  let state = {
    resource: { status: 'loading', data: null, error: null, meta: {} },
    classOptions: Object.freeze([]),
    selectedClassId: initialClassId,
    statDate: initialStatDate || statDateAtBeijingFour(clock.now()),
    isRefreshing: false,
  }
  const listeners = new Set()
  const emit = (next) => {
    state = next
    listeners.forEach((listener) => listener())
  }
  const clearPoll = () => {
    if (timer !== null) scheduler.clearInterval(timer)
    timer = null
  }
  const schedulePoll = () => {
    clearPoll()
    if (!active || visibility.getState() !== 'visible' || !state.selectedClassId) return
    timer = scheduler.setInterval(() => void refresh(), pollIntervalMs)
  }

  const refresh = async ({ replace = false } = {}) => {
    if (!active || !workspaceId || !state.selectedClassId) return null
    const version = ++requestVersion
    const previousResource = state.resource
    const previousData = replace ? null : previousResource.data
    emit({
      ...state,
      resource: previousData
        ? { ...previousResource, status: previousResource.status === 'stale' ? 'stale' : 'ready', error: null }
        : { status: 'loading', data: null, error: null, meta: {} },
      isRefreshing: Boolean(previousData),
    })
    try {
      const response = await api.getSummary({
        workspaceId,
        classId: state.selectedClassId,
        statDate: state.statDate,
      })
      if (!active || version !== requestVersion) return null
      const data = parseScopedReadingStatistics(response.data)
      if (data.class.classId !== state.selectedClassId || data.statDate !== state.statDate) {
        invalidResponse('响应范围与当前班级或统计日不一致')
      }
      emit({ ...state, resource: { status: data.class.activeStudentCount === 0 ? 'empty' : 'ready', data, error: null, meta: response.meta || {} }, isRefreshing: false })
      return data
    } catch (cause) {
      if (!active || version !== requestVersion) return null
      const error = asApiError(cause)
      if (isForbidden(error)) {
        emit({ ...state, resource: { status: 'forbidden', data: null, error, meta: {} }, isRefreshing: false })
      } else if (previousData) {
        emit({ ...state, resource: { status: 'stale', data: previousData, error, meta: previousResource.meta }, isRefreshing: false })
      } else {
        emit({ ...state, resource: { status: 'error', data: null, error, meta: {} }, isRefreshing: false })
      }
      return null
    }
  }

  const loadClasses = async () => {
    if (!workspaceId) return
    try {
      const response = await api.listStudents({ workspaceId })
      if (!active) return
      const classOptions = buildReadingClassOptions(response.data)
      const selectedClassId = classOptions.some((item) => item.classId === state.selectedClassId)
        ? state.selectedClassId
        : classOptions[0]?.classId || ''
      emit({ ...state, classOptions, selectedClassId })
      if (!selectedClassId) {
        emit({ ...state, resource: { status: 'empty', data: null, error: null, meta: response.meta || {} }, isRefreshing: false })
        return
      }
      await refresh({ replace: true })
      schedulePoll()
    } catch (cause) {
      if (!active) return
      const error = asApiError(cause)
      emit({
        ...state,
        resource: { status: isForbidden(error) ? 'forbidden' : 'error', data: null, error, meta: {} },
        isRefreshing: false,
      })
    }
  }

  const setClassId = (classId) => {
    if (!state.classOptions.some((item) => item.classId === classId) || state.selectedClassId === classId) return
    requestVersion += 1
    emit({ ...state, selectedClassId: classId, resource: { status: 'loading', data: null, error: null, meta: {} }, isRefreshing: false })
    schedulePoll()
    void refresh({ replace: true })
  }
  const setStatDate = (statDate) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(statDate) || state.statDate === statDate) return
    requestVersion += 1
    emit({ ...state, statDate, resource: { status: 'loading', data: null, error: null, meta: {} }, isRefreshing: false })
    schedulePoll()
    void refresh({ replace: true })
  }
  const handleVisibility = () => {
    if (visibility.getState() !== 'visible') {
      clearPoll()
      return
    }
    void refresh()
    schedulePoll()
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start() {
      if (active) return
      active = true
      unsubscribeVisibility = visibility.subscribe(handleVisibility)
      void loadClasses()
    },
    stop() {
      active = false
      requestVersion += 1
      clearPoll()
      unsubscribeVisibility()
      unsubscribeVisibility = () => {}
    },
    refresh,
    retry: refresh,
    setClassId,
    setStatDate,
  }
}

export default function useReadingStatistics(workspaceId, options = {}) {
  const { api: apiOverride, initialClassId = '', initialStatDate, clock, scheduler, visibility } = options
  const api = useMemo(() => apiOverride || createConsoleReadingStatisticsApi(), [apiOverride])
  const controller = useMemo(() => createScopedReadingStatisticsController({
    api,
    workspaceId,
    initialClassId,
    initialStatDate,
    clock,
    scheduler,
    visibility,
  }), [api, clock, initialClassId, initialStatDate, scheduler, visibility, workspaceId])
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  useEffect(() => {
    controller.start()
    return () => controller.stop()
  }, [controller])
  return {
    ...snapshot.resource,
    resource: snapshot.resource,
    scopeResource: snapshot.resource,
    classOptions: snapshot.classOptions,
    selectedClassId: snapshot.selectedClassId,
    statDate: snapshot.statDate,
    isRefreshing: snapshot.isRefreshing,
    onClassChange: controller.setClassId,
    onStatDateChange: controller.setStatDate,
    onRefresh: controller.refresh,
    onRetry: controller.retry,
    refresh: controller.refresh,
    reload: controller.refresh,
  }
}
