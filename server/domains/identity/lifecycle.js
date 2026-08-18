const STAGE_LENGTH = {
  primary: 6,
  junior: 3,
  senior: 3,
}

function toInstant(now) {
  if (now instanceof Date) {
    return now
  }
  if (typeof now === 'number' && Number.isFinite(now)) {
    return new Date(now)
  }
  if (typeof now === 'string' && now.trim()) {
    const parsed = new Date(now)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }
  throw new Error('computeClassLifecycle 必须传入 now，禁止回落到机器当前日期')
}

function shanghaiCalendarDate(now) {
  const instant = toInstant(now)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const lookup = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
  }
}

export function academicStartYearAt(now) {
  const { year, month, day } = shanghaiCalendarDate(now)
  if (month > 9 || (month === 9 && day >= 1)) {
    return year
  }
  return year - 1
}

export function computeGradeId(stage, entryYear) {
  return `${stage}:${entryYear}`
}

export function computeClassLifecycle({ stage, entryYear, now }) {
  const academicStartYear = academicStartYearAt(now)
  const parsedEntryYear = Number(entryYear)
  const maxLevel = STAGE_LENGTH[stage]
  if (!maxLevel || !Number.isInteger(parsedEntryYear)) {
    return {
      lifecycle: null,
      currentGrade: null,
      academicStartYear,
    }
  }

  const level = academicStartYear - parsedEntryYear + 1
  if (level < 1) {
    return { lifecycle: 'upcoming', currentGrade: null, academicStartYear }
  }
  if (level > maxLevel) {
    return { lifecycle: 'graduated', currentGrade: null, academicStartYear }
  }
  return { lifecycle: 'active', currentGrade: level, academicStartYear }
}

export function isGraduatedClass(record, now) {
  return computeClassLifecycle({ stage: record.stage, entryYear: record.entryYear ?? record.entry_year, now }).lifecycle === 'graduated'
}
