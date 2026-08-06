function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function listFrom(value) {
  const source = asRecord(value)
  return asArray(source.items || source.results || value)
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? null
}

function safePublicUrl(value) {
  if (typeof value !== 'string') return null
  const url = value.trim()
  if (!url || /^(?:file:|[a-z]:[\\/]|\\\\)/i.test(url)) return null
  return url
}

function datePart(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''
}

function timePart(value) {
  const match = typeof value === 'string' ? value.match(/T(\d{2}:\d{2})/) : null
  return match?.[1] || ''
}

function numberOrNull(value) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function toStatus(rawStatus, startsAt, endsAt, now) {
  if (rawStatus === 'paused') return 'paused'
  if (rawStatus === 'ended' || rawStatus === 'done') return 'done'
  const startsAtMs = Date.parse(startsAt)
  const endsAtMs = Date.parse(endsAt)
  if (Number.isFinite(startsAtMs) && startsAtMs > now) return 'upcoming'
  if (Number.isFinite(endsAtMs) && endsAtMs < now) return 'done'
  return 'running'
}

function toBook(raw) {
  const source = asRecord(raw)
  const cover = asRecord(source.cover)
  const coverAsset = asArray(source.assets).map(asRecord).find((asset) => asset.kind === 'cover')
  return {
    id: firstValue(source.id, source.bookId),
    versionId: firstValue(source.versionId, source.bookVersionId),
    title: firstValue(source.title, '服务端未返回书名'),
    author: firstValue(source.author, '服务端未返回作者'),
    coverUrl: safePublicUrl(firstValue(cover.url, source.coverUrl, coverAsset?.url)),
  }
}

function toAssignment(raw, booksByVersion, now) {
  const source = asRecord(raw)
  const rawBook = asRecord(source.book)
  const rawClass = asRecord(source.class || source.klass)
  const rawClasses = asArray(source.classes).map(asRecord)
  const classItems = rawClasses.length ? rawClasses : rawClass.id || rawClass.name ? [rawClass] : []
  const bookVersionId = firstValue(rawBook.id, source.bookVersionId)
  const catalogBook = booksByVersion.get(bookVersionId)
  const startsAt = firstValue(source.startsAt, source.start)
  const endsAt = firstValue(source.endsAt, source.end)
  return {
    id: firstValue(source.id, source.assignmentId),
    bookId: firstValue(catalogBook?.id, rawBook.bookId, source.bookId),
    bookVersionId,
    title: firstValue(rawBook.title, catalogBook?.title, source.bookTitle, '服务端未返回书名'),
    chapter: firstValue(source.title, source.chapter, ''),
    type: source.type === 'free' || source.type === 'guide' ? source.type : 'class',
    status: toStatus(source.status, startsAt, endsAt, now),
    classIds: classItems.map((item) => firstValue(item.id, item.classId)).filter(Boolean),
    classNames: classItems.map((item) => firstValue(item.name, item.className)).filter(Boolean),
    owner: firstValue(asRecord(source.owner).displayName, source.ownerName, ''),
    start: datePart(startsAt),
    end: datePart(endsAt),
    startTime: timePart(startsAt),
    joined: numberOrNull(firstValue(source.joined, source.participantCount)),
    total: numberOrNull(firstValue(source.total, source.targetCount)),
    progress: numberOrNull(firstValue(source.progress, source.progressPercent)),
  }
}

export const ASSIGNMENT_TYPES = [
  { key: 'class', label: '班级共读', tone: 'brand', desc: '全班同一进度，教师可开课堂同步' },
  { key: 'free', label: '自由阅读', tone: 'violet', desc: '学生自选时间，只约束起止与书目' },
  { key: 'guide', label: '导读课', tone: 'cyan', desc: '教师带读，配合章节讲解与提问' },
]

export const ASSIGNMENT_STATUS = {
  running: { label: '进行中', tone: 'success' },
  upcoming: { label: '未开始', tone: 'brand' },
  done: { label: '已结束', tone: 'muted' },
  paused: { label: '已暂停', tone: 'warning' },
}

export function toAssignmentsDto({ assignments, books, workspaces, workspaceId, now = Date.now() }) {
  const bookItems = listFrom(books).map(toBook).filter((book) => book.id && book.versionId)
  const booksByVersion = new Map(bookItems.map((book) => [book.versionId, book]))
  const currentWorkspace = listFrom(workspaces).map(asRecord).find((workspace) => workspace.id === workspaceId)
  const classes = currentWorkspace?.scopeType === 'class' && currentWorkspace.scopeId
    ? [{ id: currentWorkspace.scopeId, name: firstValue(currentWorkspace.scopeLabel, currentWorkspace.name, currentWorkspace.scopeId) }]
    : []
  return {
    arrangements: listFrom(assignments).map((assignment) => toAssignment(assignment, booksByVersion, now)).filter((item) => item.id),
    books: bookItems,
    classes,
    workspaceScope: currentWorkspace ? { type: currentWorkspace.scopeType || null, id: currentWorkspace.scopeId || null } : null,
  }
}

function requireText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} 不能为空`)
  return value.trim()
}

function scheduleDate(value, field) {
  const date = requireText(value, field)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError(`${field} 必须是 YYYY-MM-DD`)
  return date
}

export function toAssignmentCreateBody({ book, classIds, title, start, end, startTime }) {
  const sourceBook = asRecord(book)
  const bookVersionId = requireText(sourceBook.versionId, 'bookVersionId')
  const scopedClassIds = [...new Set(asArray(classIds).map((classId) => requireText(classId, 'classId')))]
  if (!scopedClassIds.length) throw new TypeError('阅读安排至少覆盖一个班级')
  const startsOn = scheduleDate(start, 'start')
  const endsOn = scheduleDate(end, 'end')
  const time = requireText(startTime, 'startTime')
  if (!/^\d{2}:\d{2}$/.test(time)) throw new TypeError('startTime 必须是 HH:mm')
  if (endsOn < startsOn) throw new TypeError('结束日期不能早于开始日期')
  return {
    bookVersionId,
    classIds: scopedClassIds,
    title: requireText(title, 'title'),
    startsAt: `${startsOn}T${time}:00+08:00`,
    endsAt: `${endsOn}T23:59:00+08:00`,
  }
}
