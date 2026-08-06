import { useCallback, useMemo } from 'react'

import { createApiClient } from '../../api/client.js'
import { useApiResource } from '../../api/useApiResource.js'

function numberOrZero(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

function normalizeBook(item = {}) {
  return {
    bookId: item.bookId || '',
    bookVersionId: item.bookVersionId || '',
    title: item.title || '',
    effectiveReadingSeconds: numberOrZero(item.effectiveReadingSeconds),
    lastReadAt: item.lastReadAt || null,
    lastPageNo: numberOrZero(item.lastPageNo) || 1,
    progressUpdatedAt: item.progressUpdatedAt || null,
  }
}

export function normalizeStudentReadingStatistics(payload = {}) {
  const byBook = Array.isArray(payload.byBook) ? payload.byBook.map(normalizeBook) : []
  const recentReading = Array.isArray(payload.recentReading)
    ? payload.recentReading.map(normalizeBook)
    : []
  const levelInput = payload.levelInput || {}
  return {
    generatedAt: payload.generatedAt || null,
    totalEffectiveReadingSeconds: numberOrZero(payload.totalEffectiveReadingSeconds),
    todayEffectiveReadingSeconds: numberOrZero(payload.todayEffectiveReadingSeconds),
    weekEffectiveReadingSeconds: numberOrZero(payload.weekEffectiveReadingSeconds),
    readingDays: numberOrZero(payload.readingDays),
    byBook,
    recentReading,
    levelInput: {
      totalEffectiveReadingSeconds: numberOrZero(levelInput.totalEffectiveReadingSeconds),
      readingDays: numberOrZero(levelInput.readingDays),
      startedBookCount: numberOrZero(levelInput.startedBookCount),
    },
    eyeCare: {
      continuousEyeSeconds: numberOrZero(payload.eyeCare?.continuousEyeSeconds),
      todayValidEyeSeconds: numberOrZero(payload.eyeCare?.todayValidEyeSeconds),
      weekValidEyeSeconds: numberOrZero(payload.eyeCare?.weekValidEyeSeconds),
      lastActiveAt: payload.eyeCare?.lastActiveAt || null,
      status: payload.eyeCare?.status || 'normal',
      forcedRestUntil: payload.eyeCare?.forcedRestUntil || null,
    },
  }
}

export function createStudentReadingStatisticsApi(client = createApiClient()) {
  return {
    getSummary(options = {}) {
      return client.get('/reading/statistics/self', options)
    },
  }
}

export default function useReadingStatistics(workspaceId) {
  const api = useMemo(() => createStudentReadingStatisticsApi(), [])
  const load = useCallback(async () => {
    if (!workspaceId) return { data: normalizeStudentReadingStatistics(), meta: {} }
    const response = await api.getSummary({ workspaceId })
    return { data: normalizeStudentReadingStatistics(response.data), meta: response.meta }
  }, [api, workspaceId])
  return useApiResource(load)
}
