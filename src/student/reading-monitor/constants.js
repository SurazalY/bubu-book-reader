export const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
export const STAT_DATE_CUTOFF_HOUR = 4
export const MAX_CONTINUOUS_EFFECTIVE_MS = 300_000
export const SKIP_VIEW_MAX_MS = 5_000
export const REREAD_VIEW_MIN_MS = 30_000
export const SUMMARY_INTERVAL_MS = 300_000

export const MOVEMENT_SOURCES = Object.freeze([
  'student_adjacent',
  'student_jump',
  'restore_position',
  'teacher_sync',
  'layout_change',
  'system_restore',
])

export const STUDENT_MOVEMENT_SOURCES = Object.freeze(['student_adjacent', 'student_jump'])

export const SESSION_END_REASONS = Object.freeze([
  'reader_close',
  'identity_change',
  'workspace_change',
  'book_change',
  'stat_date_change',
  'lease_ended',
  'lease_taken_over',
  'account_deleted',
])

export function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new TypeError(`${label}不是受控枚举值`)
  return value
}
