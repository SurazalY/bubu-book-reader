export const DAILY_ENCOURAGEMENT_COPY = Object.freeze({
  more: '今天的阅读积累很不错，继续保持！',
  close: '今天也在稳定积累，保持这个节奏吧。',
  growth_space: '今天已经完成了一些阅读，再读一会儿会更充实。',
  no_baseline: '每一次阅读都在积累，今天也继续吧。',
})

const timestampFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

export function formatReadingDuration(seconds) {
  if (!isNonNegativeInteger(seconds)) return '—'
  if (seconds === 0) return '0 分钟'

  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  if (minutes === 0) return `${remainder} 秒`
  if (remainder === 0) return `${minutes} 分钟`
  return `${minutes} 分 ${remainder} 秒`
}

export function formatReadingMonitorTimestamp(value) {
  if (value == null) return '暂无汇总更新时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间数据无法识别'
  return timestampFormatter.format(date)
}

export function validateDailyReadingBrief(data) {
  if (!data || typeof data !== 'object') return ['data']

  const invalid = []
  if (typeof data.generatedAt !== 'string' || data.generatedAt.length === 0) invalid.push('generatedAt')
  if (typeof data.statDate !== 'string' || data.statDate.length === 0) invalid.push('statDate')
  if (!isNonNegativeInteger(data.todayEffectiveReadingSeconds)) invalid.push('todayEffectiveReadingSeconds')
  if (!isNonNegativeInteger(data.streakDays)) invalid.push('streakDays')
  if (!Object.hasOwn(DAILY_ENCOURAGEMENT_COPY, data.comparisonState)) invalid.push('comparisonState')

  const checkIn = data.checkIn
  if (!checkIn || typeof checkIn !== 'object') {
    invalid.push('checkIn')
  } else {
    if (typeof checkIn.checked !== 'boolean') invalid.push('checkIn.checked')
    if (checkIn.thresholdSeconds !== 300) {
      invalid.push('checkIn.thresholdSeconds')
    }
    if (!isNonNegativeInteger(checkIn.remainingSeconds)) invalid.push('checkIn.remainingSeconds')
    if (isNonNegativeInteger(checkIn.remainingSeconds) && checkIn.remainingSeconds > checkIn.thresholdSeconds) {
      invalid.push('checkIn.remainingSeconds.range')
    }
    if (checkIn.checked === true && checkIn.remainingSeconds !== 0) invalid.push('checkIn.checked.remaining')
    if (checkIn.checked === false && checkIn.remainingSeconds === 0) invalid.push('checkIn.unchecked.remaining')
  }

  if (data.dataUpdatedAt !== null && typeof data.dataUpdatedAt !== 'string') invalid.push('dataUpdatedAt')
  if (data.lastReading !== null) {
    const reading = data.lastReading
    if (!reading || typeof reading !== 'object') {
      invalid.push('lastReading')
    } else {
      for (const key of ['bookId', 'bookVersionId', 'title', 'lastReadAt']) {
        if (typeof reading[key] !== 'string' || reading[key].length === 0) invalid.push(`lastReading.${key}`)
      }
      if (!Number.isSafeInteger(reading.lastPageNo) || reading.lastPageNo <= 0) invalid.push('lastReading.lastPageNo')
      if (!Number.isSafeInteger(reading.totalPages) || reading.totalPages <= 0) invalid.push('lastReading.totalPages')
      if (Number.isSafeInteger(reading.lastPageNo) && Number.isSafeInteger(reading.totalPages) && reading.lastPageNo > reading.totalPages) {
        invalid.push('lastReading.lastPageNo.range')
      }
    }
  }

  return invalid
}

export function buildDailyReadingBriefViewModel(data) {
  const invalidFields = validateDailyReadingBrief(data)
  if (invalidFields.length > 0) return { valid: false, invalidFields }

  const { checkIn } = data
  const completedSeconds = Math.max(0, checkIn.thresholdSeconds - checkIn.remainingSeconds)
  const progressPercent = Math.min(100, (completedSeconds / checkIn.thresholdSeconds) * 100)
  const progressAriaValue = checkIn.checked ? 100 : Math.floor(progressPercent)

  return {
    valid: true,
    todayDuration: formatReadingDuration(data.todayEffectiveReadingSeconds),
    checked: checkIn.checked,
    thresholdDuration: formatReadingDuration(checkIn.thresholdSeconds),
    remainingDuration: formatReadingDuration(checkIn.remainingSeconds),
    progressPercent,
    progressAriaValue,
    progressLabel: checkIn.checked
      ? '今日阅读积累已达到 5 分钟'
      : `再积累 ${formatReadingDuration(checkIn.remainingSeconds)} 就达到 5 分钟`,
    streakLabel: data.streakDays > 0 ? `已连续积累 ${data.streakDays} 天` : '尚未形成连续记录',
    encouragement: DAILY_ENCOURAGEMENT_COPY[data.comparisonState],
    updateLabel: formatReadingMonitorTimestamp(data.dataUpdatedAt),
    lastReading: data.lastReading,
  }
}
