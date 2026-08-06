export function formatReadingMinutes(value) {
  const minutes = Number(value)
  if (!Number.isFinite(minutes) || minutes <= 0) return null
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  return hours > 0 ? `${hours} 小时 ${rest} 分` : `${rest} 分钟`
}
