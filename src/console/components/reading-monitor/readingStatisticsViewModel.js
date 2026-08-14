export const STUDENT_READING_FILTERS = Object.freeze([
  { value: 'all', label: '全部学生' },
  { value: 'checked', label: '已打卡' },
  { value: 'unchecked', label: '未打卡' },
  { value: 'skip', label: '今日有跳读' },
  { value: 'reread', label: '今日有回读' },
])

const COMPARISON_STATES = new Set(['more', 'close', 'growth_space', 'no_baseline'])
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
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

function hasString(value) {
  return typeof value === 'string' && value.length > 0
}

function validNullableTimestamp(value) {
  return value === null || hasString(value)
}

export function normalizeStudentName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('zh-CN')
}

export function stableSortStudents(students) {
  return [...students].sort((left, right) => {
    const byName = collator.compare(
      normalizeStudentName(left.displayName),
      normalizeStudentName(right.displayName),
    )
    if (byName !== 0) return byName
    return collator.compare(String(left.studentId), String(right.studentId))
  })
}

export function filterAndSortStudents(students, { keyword = '', filter = 'all' } = {}) {
  const normalizedKeyword = normalizeStudentName(keyword)
  const filtered = students.filter((student) => {
    if (normalizedKeyword && !normalizeStudentName(student.displayName).includes(normalizedKeyword)) return false
    if (filter === 'checked') return student.checkedIn === true
    if (filter === 'unchecked') return student.checkedIn === false
    if (filter === 'skip') return student.hadSkip === true
    if (filter === 'reread') return student.hadReread === true
    return true
  })
  return stableSortStudents(filtered)
}

export function formatMonitorDuration(seconds) {
  if (!isNonNegativeInteger(seconds)) return '—'
  if (seconds === 0) return '0 分钟'
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  if (minutes === 0) return `${remainder} 秒`
  if (remainder === 0) return `${minutes} 分钟`
  return `${minutes} 分 ${remainder} 秒`
}

export function formatBasisPoints(basisPoints) {
  if (basisPoints === null) return '—'
  if (!isNonNegativeInteger(basisPoints)) return '—'
  const percentage = basisPoints / 100
  return `${Number.isInteger(percentage) ? percentage : percentage.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`
}

export function formatMonitorTimestamp(value) {
  if (value === null) return '暂无汇总更新时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间数据无法识别'
  return timestampFormatter.format(date)
}

export function describeTeacherComparison(lastWeek) {
  if (lastWeek.comparisonState === 'no_baseline' || lastWeek.todayDeltaSeconds === null) {
    return '暂无可比较的上周基线'
  }
  if (lastWeek.todayDeltaSeconds === 0) return '截至目前，今日与上周日均持平'
  const direction = lastWeek.todayDeltaSeconds > 0 ? '多' : '少'
  return `截至目前，今日较上周日均${direction} ${formatMonitorDuration(Math.abs(lastWeek.todayDeltaSeconds))}`
}

function validateTrendPoint(point, prefix, invalid) {
  if (!point || typeof point !== 'object') {
    invalid.push(prefix)
    return
  }
  if (!hasString(point.statDate)) invalid.push(`${prefix}.statDate`)
  for (const key of ['checkedInStudentCount', 'activeStudentCount']) {
    if (!isNonNegativeInteger(point[key])) invalid.push(`${prefix}.${key}`)
  }
  for (const key of ['checkInRateBasisPoints', 'perCapitaEffectiveReadingSeconds']) {
    if (point[key] !== null && !isNonNegativeInteger(point[key])) invalid.push(`${prefix}.${key}`)
  }
}

function validateStudent(student, index, invalid, statDate) {
  const prefix = `students[${index}]`
  if (!student || typeof student !== 'object') {
    invalid.push(prefix)
    return
  }
  if (!hasString(student.studentId)) invalid.push(`${prefix}.studentId`)
  if (!hasString(student.displayName)) invalid.push(`${prefix}.displayName`)
  for (const key of ['todayEffectiveReadingSeconds', 'streakDays']) {
    if (!isNonNegativeInteger(student[key])) invalid.push(`${prefix}.${key}`)
  }
  for (const key of ['checkedIn', 'hadSkip', 'hadReread']) {
    if (typeof student[key] !== 'boolean') invalid.push(`${prefix}.${key}`)
  }
  if (!validNullableTimestamp(student.lastReadAt)) invalid.push(`${prefix}.lastReadAt`)

  const lastWeek = student.lastWeek
  if (!lastWeek || typeof lastWeek !== 'object') {
    invalid.push(`${prefix}.lastWeek`)
  } else {
    for (const key of ['totalEffectiveReadingSeconds', 'dailyAverageEffectiveReadingSeconds']) {
      if (!isNonNegativeInteger(lastWeek[key])) invalid.push(`${prefix}.lastWeek.${key}`)
    }
    if (lastWeek.todayDeltaSeconds !== null && !Number.isSafeInteger(lastWeek.todayDeltaSeconds)) {
      invalid.push(`${prefix}.lastWeek.todayDeltaSeconds`)
    }
    if (!COMPARISON_STATES.has(lastWeek.comparisonState)) invalid.push(`${prefix}.lastWeek.comparisonState`)
  }

  if (!Array.isArray(student.recentDays) || student.recentDays.length !== 7) {
    invalid.push(`${prefix}.recentDays`)
  } else {
    student.recentDays.forEach((day, dayIndex) => {
      const dayPrefix = `${prefix}.recentDays[${dayIndex}]`
      if (!day || typeof day !== 'object') {
        invalid.push(dayPrefix)
        return
      }
      if (!hasString(day.statDate)) invalid.push(`${dayPrefix}.statDate`)
      if (!isNonNegativeInteger(day.effectiveReadingSeconds)) invalid.push(`${dayPrefix}.effectiveReadingSeconds`)
      if (typeof day.checkedIn !== 'boolean') invalid.push(`${dayPrefix}.checkedIn`)
    })
    for (let dayIndex = 1; dayIndex < student.recentDays.length; dayIndex += 1) {
      const previousDate = student.recentDays[dayIndex - 1]?.statDate
      const currentDate = student.recentDays[dayIndex]?.statDate
      if (previousDate && currentDate && previousDate >= currentDate) {
        invalid.push(`${prefix}.recentDays.order`)
        break
      }
    }
    if (student.recentDays.at(-1)?.statDate !== statDate) invalid.push(`${prefix}.recentDays.lastDate`)
  }

  if (student.lastReading !== null) {
    const reading = student.lastReading
    if (!reading || typeof reading !== 'object') {
      invalid.push(`${prefix}.lastReading`)
    } else {
      for (const key of ['bookId', 'bookVersionId', 'title']) {
        if (!hasString(reading[key])) invalid.push(`${prefix}.lastReading.${key}`)
      }
      if (!Number.isSafeInteger(reading.lastPageNo) || reading.lastPageNo <= 0) invalid.push(`${prefix}.lastReading.lastPageNo`)
      if (!Number.isSafeInteger(reading.totalPages) || reading.totalPages <= 0) invalid.push(`${prefix}.lastReading.totalPages`)
      if (Number.isSafeInteger(reading.lastPageNo) && Number.isSafeInteger(reading.totalPages) && reading.lastPageNo > reading.totalPages) {
        invalid.push(`${prefix}.lastReading.lastPageNo.range`)
      }
    }
  }
}

export function validateReadingStatisticsData(data) {
  if (!data || typeof data !== 'object') return ['data']
  const invalid = []

  for (const key of ['generatedAt', 'statDate']) {
    if (!hasString(data[key])) invalid.push(key)
  }
  if (!validNullableTimestamp(data.dataUpdatedAt)) invalid.push('dataUpdatedAt')

  if (!data.class || typeof data.class !== 'object') {
    invalid.push('class')
  } else {
    if (!hasString(data.class.classId)) invalid.push('class.classId')
    if (!hasString(data.class.displayName)) invalid.push('class.displayName')
    if (!isNonNegativeInteger(data.class.activeStudentCount)) invalid.push('class.activeStudentCount')
  }

  if (!data.summary || typeof data.summary !== 'object') {
    invalid.push('summary')
  } else {
    for (const key of ['checkedInStudentCount', 'totalEffectiveReadingSeconds', 'skipStudentCount', 'rereadStudentCount']) {
      if (!isNonNegativeInteger(data.summary[key])) invalid.push(`summary.${key}`)
    }
    for (const key of ['checkInRateBasisPoints', 'perCapitaEffectiveReadingSeconds']) {
      if (data.summary[key] !== null && !isNonNegativeInteger(data.summary[key])) invalid.push(`summary.${key}`)
    }
  }

  if (!Array.isArray(data.trend) || data.trend.length !== 7) {
    invalid.push('trend')
  } else {
    data.trend.forEach((point, index) => validateTrendPoint(point, `trend[${index}]`, invalid))
    for (let index = 1; index < data.trend.length; index += 1) {
      const previousDate = data.trend[index - 1]?.statDate
      const currentDate = data.trend[index]?.statDate
      if (previousDate && currentDate && previousDate >= currentDate) {
        invalid.push('trend.order')
        break
      }
    }
    if (data.trend.at(-1)?.statDate !== data.statDate) invalid.push('trend.lastDate')
  }

  if (!Array.isArray(data.students)) {
    invalid.push('students')
  } else {
    data.students.forEach((student, index) => validateStudent(student, index, invalid, data.statDate))
  }

  if (data.class && data.summary && Array.isArray(data.students)) {
    if (data.class.activeStudentCount === 0) {
      if (data.summary.checkInRateBasisPoints !== null) invalid.push('summary.checkInRateBasisPoints.emptyClass')
      if (data.summary.perCapitaEffectiveReadingSeconds !== null) invalid.push('summary.perCapitaEffectiveReadingSeconds.emptyClass')
      for (const key of ['checkedInStudentCount', 'totalEffectiveReadingSeconds', 'skipStudentCount', 'rereadStudentCount']) {
        if (data.summary[key] !== 0) invalid.push(`summary.${key}.emptyClass`)
      }
      if (data.students.length !== 0) invalid.push('students.emptyClass')
    } else {
      if (data.summary.checkInRateBasisPoints === null) invalid.push('summary.checkInRateBasisPoints.nonEmptyClass')
      if (data.summary.perCapitaEffectiveReadingSeconds === null) invalid.push('summary.perCapitaEffectiveReadingSeconds.nonEmptyClass')
    }
  }

  return invalid
}

export function buildReadingStatisticsViewModel(data, controls = {}) {
  const invalidFields = validateReadingStatisticsData(data)
  if (invalidFields.length > 0) return { valid: false, invalidFields }

  return {
    valid: true,
    data,
    students: filterAndSortStudents(data.students, controls),
    updateLabel: formatMonitorTimestamp(data.dataUpdatedAt),
    checkInRateLabel: formatBasisPoints(data.summary.checkInRateBasisPoints),
    perCapitaLabel: data.summary.perCapitaEffectiveReadingSeconds === null
      ? '—'
      : formatMonitorDuration(data.summary.perCapitaEffectiveReadingSeconds),
    emptyClass: data.class.activeStudentCount === 0,
  }
}
