export const CLASS_STAGES = Object.freeze([
  { value: 'primary', label: '小学' },
  { value: 'junior', label: '初中' },
  { value: 'senior', label: '高中' },
])

export const GRADE_MANAGER_SCOPE_NOTE =
  '年级主任只能管理本届班级与本届学生。签发教师凭据、重置教师密码是本校账号支持，不表示可以跨届管班或管理书架。'

export function resolveLoginDestination(navigation) {
  const path = navigation?.defaultPath
  if (typeof path !== 'string') return null
  const trimmed = path.trim()
  if (!trimmed.startsWith('/')) return null
  return trimmed
}

export function teacherJoinNeedsConfirm(teacherCount) {
  return Number(teacherCount) > 0
}

export function teacherJoinConfirmMessage(teacherCount) {
  const count = Number(teacherCount) || 0
  return `本班已有 ${count} 位教师，加入后将共同管理`
}

export function teacherCountLabel(teacherCount) {
  if (teacherCount === undefined || teacherCount === null || teacherCount === '') return null
  const count = Number(teacherCount)
  if (!Number.isFinite(count)) return null
  return `本班有 ${count} 位教师可管理`
}

export function buildCreateClassBody(form = {}) {
  return {
    name: String(form.name ?? '').trim(),
    stage: String(form.stage ?? '').trim(),
    entryYear: Number(form.entryYear),
    classNumber: Number(form.classNumber),
  }
}

export function canCreateClass(scopeType) {
  return scopeType === 'school' || scopeType === 'grade'
}

export function canManageRegistration(scopeType) {
  return scopeType === 'school' || scopeType === 'grade' || scopeType === 'platform'
}

export function canIssueTeacherAccountSupport(scopeType) {
  return scopeType === 'school' || scopeType === 'grade' || scopeType === 'platform'
}

export function canIssueStudentPasswordReset(scopeType) {
  return scopeType === 'school' || scopeType === 'grade' || scopeType === 'class'
}

export function accountCodeSuffix(accountCode, providedSuffix) {
  if (typeof providedSuffix === 'string' && providedSuffix.trim()) {
    return providedSuffix.trim().slice(-4)
  }
  if (typeof accountCode === 'string' && accountCode.trim()) {
    return accountCode.trim().slice(-4)
  }
  return '----'
}

export function seedAvatarTone(seed) {
  const text = String(seed || 'account')
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0
  }
  const tones = ['#2E8C86', '#7C6BD8', '#C9852A', '#3E9E8F', '#6E5CD0']
  return tones[hash % tones.length]
}

export function stageLabel(stage) {
  return CLASS_STAGES.find((item) => item.value === stage)?.label || stage || '未返回学段'
}

export function formatIsoTime(value) {
  if (typeof value !== 'string' || !value.trim()) return '未返回时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
}

export function registrationJoinPath(rawToken) {
  if (typeof rawToken !== 'string' || !rawToken.trim()) return null
  return `/join/${rawToken.trim()}`
}

export const REGISTRATION_PAGE_PATH = '/student/register'

export const INTERNAL_CREDENTIAL_ID_NOTE = '内部编号，不是注册码'

export function registrationRoleLabel(expectedRole) {
  if (expectedRole === 'teacher') return '教师'
  if (expectedRole === 'student') return '学生'
  return expectedRole || '未返回角色'
}

export function joinedClassIdsFromWorkspaces(payload) {
  return unwrapList(payload)
    .filter((item) => item?.scopeType === 'class' && typeof item.scopeId === 'string' && item.scopeId.trim())
    .map((item) => item.scopeId.trim())
}

export function mergeIssuedCredentialRow(items, issued, expectedRole) {
  const list = Array.isArray(items) ? items : []
  if (!issued?.id) return list
  if (expectedRole && issued.expectedRole && issued.expectedRole !== expectedRole) return list
  if (list.some((item) => item?.id === issued.id)) return list
  return [{
    id: issued.id,
    expectedRole: issued.expectedRole,
    successfulUseCount: issued.successfulUseCount ?? 0,
    maxUses: issued.maxUses ?? null,
    revokedAt: issued.revokedAt ?? null,
    version: issued.version,
  }, ...list]
}

export function revealedRegistrationToken(issued, itemId) {
  if (!issued || issued.id !== itemId) return null
  if (typeof issued.rawToken !== 'string' || !issued.rawToken.trim()) return null
  return issued.rawToken.trim()
}

export function applyWriteTeacherCount(items, classId, teacherCount) {
  return (items || []).map((item) => (
    item?.id === classId ? { ...item, teacherCount } : item
  ))
}

export function unwrapList(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.items)) return payload.items
  return []
}
