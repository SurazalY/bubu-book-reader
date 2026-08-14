import { useEffect, useMemo, useSyncExternalStore } from 'react'

import { buildStudentReaderUrl, createStudentApi } from '../../api/student.js'
import { ApiError, asApiError } from '../../api/envelope.js'

const SELF_FIELDS = Object.freeze([
  'generatedAt',
  'dataUpdatedAt',
  'statDate',
  'todayEffectiveReadingSeconds',
  'checkIn',
  'streakDays',
  'comparisonState',
  'lastReading',
])
const CHECK_IN_FIELDS = Object.freeze(['checked', 'thresholdSeconds', 'remainingSeconds'])
const LAST_READING_FIELDS = Object.freeze([
  'bookId',
  'bookVersionId',
  'title',
  'lastPageNo',
  'totalPages',
  'lastReadAt',
])
const COMPARISON_STATES = new Set(['more', 'close', 'growth_space', 'no_baseline'])

function invalidResponse(message) {
  throw new ApiError({
    code: 'INVALID_RESPONSE',
    message: `阅读统计响应不符合约定：${message}`,
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

function requireTimestamp(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null
  const text = requireString(value, label)
  if (!Number.isFinite(Date.parse(text))) invalidResponse(`${label} 必须是有效时间`)
  return text
}

function requireInteger(value, label, { min = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) invalidResponse(`${label} 必须是大于等于 ${min} 的整数`)
  return value
}

export function parseStudentReadingStatistics(payload) {
  const source = requireExactFields(payload, SELF_FIELDS, 'self')
  const checkIn = requireExactFields(source.checkIn, CHECK_IN_FIELDS, 'checkIn')
  if (typeof checkIn.checked !== 'boolean') invalidResponse('checkIn.checked 必须是布尔值')
  if (checkIn.thresholdSeconds !== 300) invalidResponse('checkIn.thresholdSeconds 必须是 300')
  requireInteger(checkIn.remainingSeconds, 'checkIn.remainingSeconds')
  if (checkIn.remainingSeconds > checkIn.thresholdSeconds) invalidResponse('checkIn.remainingSeconds 超出阈值')
  if (checkIn.checked !== (checkIn.remainingSeconds === 0)) invalidResponse('checkIn.checked 与 remainingSeconds 不一致')
  if (!COMPARISON_STATES.has(source.comparisonState)) invalidResponse('comparisonState 非法')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source.statDate)) invalidResponse('statDate 必须是 YYYY-MM-DD')

  let lastReading = null
  if (source.lastReading !== null) {
    const reading = requireExactFields(source.lastReading, LAST_READING_FIELDS, 'lastReading')
    const lastPageNo = requireInteger(reading.lastPageNo, 'lastReading.lastPageNo', { min: 1 })
    const totalPages = requireInteger(reading.totalPages, 'lastReading.totalPages', { min: 1 })
    if (lastPageNo > totalPages) invalidResponse('lastReading.lastPageNo 超出书籍总页数')
    lastReading = {
      bookId: requireString(reading.bookId, 'lastReading.bookId'),
      bookVersionId: requireString(reading.bookVersionId, 'lastReading.bookVersionId'),
      title: requireString(reading.title, 'lastReading.title'),
      lastPageNo,
      totalPages,
      lastReadAt: requireTimestamp(reading.lastReadAt, 'lastReading.lastReadAt'),
    }
  }

  return Object.freeze({
    generatedAt: requireTimestamp(source.generatedAt, 'generatedAt'),
    dataUpdatedAt: requireTimestamp(source.dataUpdatedAt, 'dataUpdatedAt', { nullable: true }),
    statDate: source.statDate,
    todayEffectiveReadingSeconds: requireInteger(source.todayEffectiveReadingSeconds, 'todayEffectiveReadingSeconds'),
    checkIn: Object.freeze({
      checked: checkIn.checked,
      thresholdSeconds: checkIn.thresholdSeconds,
      remainingSeconds: checkIn.remainingSeconds,
    }),
    streakDays: requireInteger(source.streakDays, 'streakDays'),
    comparisonState: source.comparisonState,
    lastReading: lastReading ? Object.freeze(lastReading) : null,
  })
}

export const normalizeStudentReadingStatistics = parseStudentReadingStatistics

export function createStudentReadingStatisticsApi(client) {
  const api = createStudentApi(client)
  return { getSummary: (options = {}) => api.getReadingStatisticsSelf(options) }
}

function isForbidden(error) {
  return error?.status === 403 || error?.code === 'PERMISSION_DENIED'
}

export function createDailyReadingBriefController({ api, workspaceId } = {}) {
  if (!api?.getSummary) throw new TypeError('daily reading brief api.getSummary is required')
  let active = false
  let requestVersion = 0
  let state = {
    resource: { status: 'loading', data: null, error: null, meta: {} },
    isRefreshing: false,
  }
  const listeners = new Set()
  const emit = (next) => {
    state = next
    listeners.forEach((listener) => listener())
  }

  const refresh = async () => {
    if (!workspaceId) return null
    const version = ++requestVersion
    const previousData = state.resource.data
    emit({
      resource: previousData
        ? { ...state.resource, status: state.resource.status === 'stale' ? 'stale' : 'ready', error: null }
        : { status: 'loading', data: null, error: null, meta: {} },
      isRefreshing: Boolean(previousData),
    })
    try {
      const response = await api.getSummary({ workspaceId })
      if (!active || version !== requestVersion) return null
      const data = parseStudentReadingStatistics(response.data)
      emit({ resource: { status: 'ready', data, error: null, meta: response.meta || {} }, isRefreshing: false })
      return data
    } catch (cause) {
      if (!active || version !== requestVersion) return null
      const error = asApiError(cause)
      if (isForbidden(error)) {
        emit({ resource: { status: 'forbidden', data: null, error, meta: {} }, isRefreshing: false })
      } else if (previousData) {
        emit({ resource: { status: 'stale', data: previousData, error, meta: state.resource.meta }, isRefreshing: false })
      } else {
        emit({ resource: { status: 'error', data: null, error, meta: {} }, isRefreshing: false })
      }
      return null
    }
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
      void refresh()
    },
    stop() {
      active = false
      requestVersion += 1
    },
    refresh,
    retry: refresh,
  }
}

export default function useReadingStatistics(workspaceId, { api: apiOverride } = {}) {
  const api = useMemo(() => apiOverride || createStudentReadingStatisticsApi(), [apiOverride])
  const controller = useMemo(
    () => createDailyReadingBriefController({ api, workspaceId }),
    [api, workspaceId],
  )
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  useEffect(() => {
    controller.start()
    return () => controller.stop()
  }, [controller])

  const lastReading = snapshot.resource.data?.lastReading || null
  const continueReadingUrl = lastReading ? buildStudentReaderUrl(lastReading) : null
  return {
    ...snapshot.resource,
    resource: snapshot.resource,
    dailyReadingBriefResource: snapshot.resource,
    isRefreshing: snapshot.isRefreshing,
    refresh: controller.refresh,
    reload: controller.refresh,
    retry: controller.retry,
    continueReadingUrl,
    buildContinueReadingUrl: buildStudentReaderUrl,
  }
}
