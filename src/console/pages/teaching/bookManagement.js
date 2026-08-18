export const HUMAN_REVIEW_REQUIRED_MESSAGE = '这本书的质量闸门未通过，需要人工复核后才能重新发布。'
export const OUT_OF_SCOPE_CLASSES_PREFIX = '这些班级超出你的管理范围'
export const CLASS_SHELF_EMPTY_MESSAGE = '暂无已投放图书，请联系任课教师'
export const CLASS_SHELF_API_MISSING_MESSAGE = 'console API 缺少班级书架方法 getClassShelf / putClassShelfBook / deleteClassShelfBook，T8.6B 停手'

export function createWriteKeyBag(randomUUID = () => globalThis.crypto.randomUUID()) {
  const keys = new Map()
  return {
    take(scope) {
      if (!keys.has(scope)) keys.set(scope, `${scope}:${randomUUID()}`)
      return keys.get(scope)
    },
    clear(scope) {
      keys.delete(scope)
    },
    peek(scope) {
      return keys.get(scope) || null
    },
  }
}

export function visibilityWriteBody(scope, classIds) {
  if (scope === 'organization') return { scope: 'organization' }
  return { scope: 'classes', classIds: Array.isArray(classIds) ? classIds : [] }
}

export function classDisplayName(item) {
  const name = typeof item?.name === 'string' ? item.name.trim() : ''
  return name || '已删除的班级'
}

export function requireClassShelfApi(api) {
  if (
    typeof api?.getClassShelf !== 'function'
    || typeof api?.putClassShelfBook !== 'function'
    || typeof api?.deleteClassShelfBook !== 'function'
  ) {
    throw new Error(CLASS_SHELF_API_MISSING_MESSAGE)
  }
  return api
}

export function canManageClassShelf(workspace) {
  return workspace?.scopeType === 'class' && typeof workspace?.scopeId === 'string' && Boolean(workspace.scopeId.trim())
}

export function classIdOfWorkspace(workspace) {
  return canManageClassShelf(workspace) ? workspace.scopeId : null
}

export function readTeacherCount(payload) {
  if (payload == null || typeof payload !== 'object') return null
  const candidates = [payload.teacherCount, payload.data?.teacherCount]
  for (const value of candidates) {
    if (value == null || value === '') continue
    const count = Number(value)
    if (Number.isInteger(count) && count >= 0) return count
  }
  return null
}

export function formatClassTeacherCount(teacherCount) {
  if (teacherCount == null || teacherCount === '') return '本班有 — 位教师可管理'
  const count = Number(teacherCount)
  if (!Number.isInteger(count) || count < 0) return '本班有 — 位教师可管理'
  return `本班有 ${count} 位教师可管理`
}

export function shelfItemsOf(payload) {
  if (Array.isArray(payload?.items)) return payload.items
  if (Array.isArray(payload?.data?.items)) return payload.data.items
  if (Array.isArray(payload)) return payload
  return []
}

export function shelfBookIdSet(items) {
  const ids = new Set()
  for (const item of Array.isArray(items) ? items : []) {
    const id = typeof item?.bookId === 'string' && item.bookId.trim()
      ? item.bookId
      : (typeof item?.id === 'string' && item.id.trim() ? item.id : '')
    if (id) ids.add(id)
  }
  return ids
}

export function isBookOnClassShelf(items, bookId) {
  return typeof bookId === 'string' && bookId.trim() ? shelfBookIdSet(items).has(bookId) : false
}

export function formatBookWriteError(error, action = 'write') {
  if (error?.code === 'HUMAN_REVIEW_REQUIRED') return HUMAN_REVIEW_REQUIRED_MESSAGE
  const deniedIds = Array.isArray(error?.details?.classIds)
    ? error.details.classIds.filter((id) => typeof id === 'string' && id.trim())
    : []
  if (error?.code === 'PERMISSION_DENIED' && deniedIds.length) {
    return `${OUT_OF_SCOPE_CLASSES_PREFIX}：${deniedIds.join('、')}`
  }
  if (error?.code === 'PERMISSION_DENIED') {
    if (action === 'grant') return '你没有权限把这本书投放到本班。'
    if (action === 'revoke') return '你没有权限从本班撤下这本书。'
    return action === 'visibility' ? '你没有权限修改这本书的可见范围。' : '你没有权限执行这个发布操作。'
  }
  if (error?.code === 'RESOURCE_NOT_FOUND') {
    if (action === 'grant') return '这本书不存在、未发布，或不在当前可投放范围。'
    if (action === 'revoke') return '这本书不存在，或当前不在本班书架上。'
    if (action === 'unpublish') return '这本书不存在，或当前不是已发布状态，无法下架。'
    if (action === 'publish') return '这本书不存在，或当前不是可发布的草稿。'
    return '这本书不在当前组织中。'
  }
  if (error?.code === 'IDEMPOTENCY_CONFLICT') return '这次操作与之前的请求冲突，请关闭后重试。'
  if (error?.code === 'VALIDATION_FAILED') return error.message || '提交内容不符合要求，请检查后重试。'
  return error?.message || '操作失败，请稍后重试。'
}

export function previewVisibilityImpact(references, { scope, classIds } = {}) {
  const arrangements = Array.isArray(references?.arrangements) ? references.arrangements : []
  const classroomSessions = Array.isArray(references?.classroomSessions) ? references.classroomSessions : []
  if (scope === 'organization') {
    return {
      affectedArrangementCount: 0,
      affectedClassroomSessionCount: 0,
      losingClasses: [],
      arrangements: [],
      classroomSessions: [],
    }
  }
  const allowed = new Set(Array.isArray(classIds) ? classIds : [])
  const losing = new Map()
  const affected = (entries) => entries
    .map((entry) => ({
      entry,
      blocked: (entry?.classes || []).filter((item) => item?.id && !allowed.has(item.id)),
    }))
    .filter(({ blocked }) => blocked.length > 0)
    .map(({ entry, blocked }) => {
      for (const item of blocked) losing.set(item.id, item)
      return { ...entry, blockedClasses: blocked }
    })
  const blockedArrangements = affected(arrangements)
  const blockedSessions = affected(classroomSessions)
  return {
    affectedArrangementCount: blockedArrangements.length,
    affectedClassroomSessionCount: blockedSessions.length,
    losingClasses: [...losing.values()],
    arrangements: blockedArrangements,
    classroomSessions: blockedSessions,
  }
}

export function describeVisibilityImpact(preview, { arrangementTotal = 0 } = {}) {
  if (!preview) return '保存将更新这本书的可见范围。阅读安排不会被删除。'
  const losingNames = preview.losingClasses.map((item) => classDisplayName(item)).filter(Boolean)
  if (preview.affectedArrangementCount > 0 && losingNames.length) {
    return `还有 ${preview.affectedArrangementCount} 个阅读安排引用本书，收窄后这些班的学生将无法打开：${losingNames.join('、')}。阅读安排不会被删除。`
  }
  if (arrangementTotal > 0 && losingNames.length) {
    return `还有 ${arrangementTotal} 个阅读安排引用本书，收窄后这些班的学生将无法打开：${losingNames.join('、')}。阅读安排不会被删除。`
  }
  if (preview.affectedClassroomSessionCount > 0 && losingNames.length) {
    return `还有 ${preview.affectedClassroomSessionCount} 个课堂锁书引用本书，收窄后这些班的学生将无法打开：${losingNames.join('、')}。阅读安排不会被删除。`
  }
  if (losingNames.length) {
    return `收窄后这些班的学生将无法打开：${losingNames.join('、')}。阅读安排不会被删除。`
  }
  if (arrangementTotal > 0) {
    return `还有 ${arrangementTotal} 个阅读安排引用本书。按你勾选的班级保存后，未入选班级的学生将无法打开。阅读安排不会被删除。`
  }
  return '将按你选择的范围保存。当前没有阅读安排或课堂锁书会因此失去访问。阅读安排不会被删除。'
}

export function describeVisibilitySaveResult(impact) {
  if (!impact) return '可见范围已保存。'
  const losing = Array.isArray(impact.losingClasses) ? impact.losingClasses.map((item) => classDisplayName(item)) : []
  const arrangementCount = Number(impact.affectedArrangementCount) || 0
  const sessionCount = Number(impact.affectedClassroomSessionCount) || 0
  if (!arrangementCount && !sessionCount && !losing.length) {
    return '可见范围已保存。当前没有阅读安排或课堂锁书失去访问。'
  }
  const affected = []
  if (arrangementCount) affected.push(`${arrangementCount} 个阅读安排`)
  if (sessionCount) affected.push(`${sessionCount} 个课堂锁书`)
  const affectedText = affected.length ? `受到影响的有${affected.join('、')}。` : ''
  const losingText = losing.length ? `失去访问的班级：${losing.join('、')}。` : ''
  return `可见范围已保存。${affectedText}${losingText}阅读安排没有被删除。`
}
