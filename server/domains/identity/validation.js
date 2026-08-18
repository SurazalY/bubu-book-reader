import { createHash } from 'node:crypto'

import { HttpError } from '../../db/errors.js'

export const LOGIN_FAILURE_MESSAGE = '学校、账号或密码错误'
export const ACCOUNT_NOT_FOUND_MESSAGE = '账号不存在'
export const CLASS_NOT_FOUND_MESSAGE = '班级不存在'
export const REGISTRATION_NOT_FOUND_MESSAGE = '注册凭据不存在'
export const PASSWORD_RESET_NOT_FOUND_MESSAGE = '重置凭据不存在'
export const ENROLLMENT_NOT_FOUND_MESSAGE = '入班申请不存在'
export const RESOURCE_NOT_FOUND_MESSAGE = '资源不存在'

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const STAGES = new Set(['primary', 'junior', 'senior'])

export function notFound(message) {
  return new HttpError(404, 'RESOURCE_NOT_FOUND', message)
}

export function validationFailed(message, details = {}) {
  return new HttpError(400, 'VALIDATION_FAILED', message, { details })
}

export function permissionDenied(message = '当前身份无权执行此操作') {
  return new HttpError(403, 'PERMISSION_DENIED', message)
}

export function resourceConflict(message, details = {}) {
  return new HttpError(409, 'RESOURCE_CONFLICT', message, { details })
}

export function versionConflict(details = {}) {
  return new HttpError(409, 'VERSION_CONFLICT', '资源版本冲突，请刷新后重试', { details })
}

export function invariantViolation(message) {
  return new HttpError(500, 'IDENTITY_INVARIANT_VIOLATION', message)
}

export function trimString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function requireTrimmed(value, field, { min = 1, max = 100 } = {}) {
  const normalized = trimString(value)
  if (normalized.length < min || normalized.length > max) {
    throw validationFailed(`${field} 必须为 ${min} 到 ${max} 个字符`, { field })
  }
  return normalized
}

export function parseIdentifier(value, field, { min, max }) {
  const normalized = trimString(value)
  if (normalized.length < min || normalized.length > max || !IDENTIFIER_PATTERN.test(normalized)) {
    throw validationFailed(`${field} 格式无效`, { field })
  }
  return normalized
}

export function parseSchoolCode(value) {
  return parseIdentifier(value, 'schoolCode', { min: 2, max: 64 })
}

export function parseLoginName(value) {
  return parseIdentifier(value, 'loginName', { min: 3, max: 32 })
}

export function parseDisplayName(value) {
  return requireTrimmed(value, 'displayName', { min: 1, max: 100 })
}

export function parseClassName(value) {
  return requireTrimmed(value, 'name', { min: 1, max: 100 })
}

export function parseStage(value) {
  const stage = trimString(value)
  if (!STAGES.has(stage)) {
    throw validationFailed('stage 必须是 primary、junior 或 senior', { field: 'stage' })
  }
  return stage
}

export function parseEntryYear(value) {
  const year = Number(value)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw validationFailed('entryYear 必须是 2000 到 2100 的整数', { field: 'entryYear' })
  }
  return year
}

export function parseClassNumber(value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1 || number > 99) {
    throw validationFailed('classNumber 必须是 1 到 99 的整数', { field: 'classNumber' })
  }
  return number
}

export function parseReason(value, { optional = false } = {}) {
  const reason = trimString(value)
  if (!reason) {
    if (optional) return null
    throw validationFailed('reason 必须为 1 到 500 个字符', { field: 'reason' })
  }
  if (reason.length > 500) {
    throw validationFailed('reason 必须为 1 到 500 个字符', { field: 'reason' })
  }
  return reason
}

export function parseMaxUses(value) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  const maxUses = Number(value)
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10000) {
    throw validationFailed('maxUses 必须是 1 到 10000 的整数', { field: 'maxUses' })
  }
  return maxUses
}

export function parseExpiresAt(value) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw validationFailed('expiresAt 必须是有效的 ISO 8601 时间', { field: 'expiresAt' })
  }
  return value
}

export function parseExpectedRole(value) {
  const role = trimString(value)
  if (role !== 'student' && role !== 'teacher') {
    throw validationFailed('expectedRole 必须是 student 或 teacher', { field: 'expectedRole' })
  }
  return role
}

export function rejectInjectedIdentityFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return
  }
  for (const field of ['role', 'organizationId', 'scopeId']) {
    if (Object.hasOwn(body, field)) {
      throw validationFailed('请求体不得声明 role、organizationId 或 scopeId', { field })
    }
  }
}

export function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

export function addDays(now, days) {
  return new Date(Date.parse(now) + days * 24 * 60 * 60 * 1000).toISOString()
}

export function addMinutes(now, minutes) {
  return new Date(Date.parse(now) + minutes * 60 * 1000).toISOString()
}

export function accountCodeFromUserId(userId) {
  return `U${String(userId).replace(/-/g, '').slice(0, 12).toUpperCase()}`
}

export function loginNameSuggestions(base, taken) {
  const occupied = new Set([...taken].map((name) => String(name).toLowerCase()))
  const suggestions = []
  let suffix = 2
  while (suggestions.length < 3 && suffix < 10_000) {
    const label = String(suffix)
    const maxBase = Math.max(1, 32 - 1 - label.length)
    const truncated = base.length > maxBase ? base.slice(0, maxBase) : base
    const candidate = `${truncated}-${label}`
    if (!occupied.has(candidate.toLowerCase())) {
      suggestions.push(candidate)
      occupied.add(candidate.toLowerCase())
    }
    suffix += 1
  }
  return suggestions
}
