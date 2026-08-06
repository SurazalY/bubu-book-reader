import { useCallback, useMemo } from 'react'

import { createApiClient } from '../../api/client.js'
import { useApiResource } from '../../api/useApiResource.js'

function numberOrZero(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

export function normalizeScopedReadingStatistics(payload = {}) {
  return {
    generatedAt: payload.generatedAt || null,
    participantCount: numberOrZero(payload.participantCount),
    effectiveReadingSeconds: numberOrZero(payload.effectiveReadingSeconds),
    trend: Array.isArray(payload.trend) ? payload.trend.map((item) => ({
      windowStartAt: item.windowStartAt || null,
      effectiveReadingSeconds: numberOrZero(item.effectiveReadingSeconds),
      participantCount: numberOrZero(item.participantCount),
    })) : [],
    byBook: Array.isArray(payload.byBook) ? payload.byBook.map((item) => ({
      bookId: item.bookId || '',
      bookVersionId: item.bookVersionId || '',
      title: item.title || '',
      effectiveReadingSeconds: numberOrZero(item.effectiveReadingSeconds),
      participantCount: numberOrZero(item.participantCount),
    })) : [],
    anomalousStays: Array.isArray(payload.anomalousStays) ? payload.anomalousStays.map((item) => ({
      eventId: item.eventId || '',
      studentId: item.studentId || '',
      studentDisplayName: item.studentDisplayName || '',
      classId: item.classId || '',
      bookId: item.bookId || '',
      bookVersionId: item.bookVersionId || '',
      title: item.title || '',
      pageNo: numberOrZero(item.pageNo),
      occurredAt: item.occurredAt || null,
      observedSeconds: numberOrZero(item.observedSeconds),
      reason: item.reason || '',
    })) : [],
    eyeCareStatuses: Array.isArray(payload.eyeCareStatuses) ? payload.eyeCareStatuses.map((item) => ({
      studentId: item.studentId || '',
      studentDisplayName: item.studentDisplayName || '',
      classId: item.classId || '',
      workspaceId: item.workspaceId || '',
      continuousEyeSeconds: numberOrZero(item.continuousEyeSeconds),
      todayValidEyeSeconds: numberOrZero(item.todayValidEyeSeconds),
      weekValidEyeSeconds: numberOrZero(item.weekValidEyeSeconds),
      lastActiveAt: item.lastActiveAt || null,
      status: item.status || 'normal',
      forcedRestUntil: item.forcedRestUntil || null,
    })) : [],
  }
}

export function createConsoleReadingStatisticsApi(client = createApiClient()) {
  return {
    getSummary({ workspaceId, query } = {}) {
      return client.get('/reading/statistics/scope', { workspaceId, query })
    },
  }
}

export default function useReadingStatistics(workspaceId, filters = {}) {
  const api = useMemo(() => createConsoleReadingStatisticsApi(), [])
  const { classId, studentId, bookVersionId, from, to } = filters
  const load = useCallback(async () => {
    if (!workspaceId) return { data: normalizeScopedReadingStatistics(), meta: {} }
    const response = await api.getSummary({
      workspaceId,
      query: { classId, studentId, bookVersionId, from, to },
    })
    return { data: normalizeScopedReadingStatistics(response.data), meta: response.meta }
  }, [api, bookVersionId, classId, from, studentId, to, workspaceId])
  return useApiResource(load)
}
