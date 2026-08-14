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

function numberOrNull(...values) {
  const value = firstValue(...values)
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function booleanValue(...values) {
  const value = firstValue(...values)
  return value === true || value === 1 || value === 'true'
}

function toStudent(raw) {
  const source = asRecord(raw)
  const profile = asRecord(source.profile)
  return {
    id: firstValue(source.id, source.userId),
    name: firstValue(source.displayName, source.name, profile.displayName),
    avatarUrl: firstValue(source.avatarUrl, profile.avatarUrl),
    grade: firstValue(source.grade, profile.grade),
    className: firstValue(source.className, profile.className),
    level: asRecord(source.level),
  }
}

function assetUrl(raw) {
  const source = asRecord(raw)
  const value = typeof raw === 'string' ? raw : firstValue(source.url, source.href, source.src, source.assetUrl, source.path)
  if (typeof value !== 'string' || !value.trim()) return null
  const normalized = value.trim()
  if (/^(?:file:|[a-z]:[\\/]|\\\\)/i.test(normalized)) return null
  return normalized
}

function toAsset(raw) {
  const source = asRecord(raw)
  const url = assetUrl(raw)
  if (!url) return null
  return {
    id: firstValue(source.id, source.assetId),
    kind: firstValue(source.kind, source.type),
    url,
  }
}

function toBookmark(value) {
  const source = asRecord(value)
  return numberOrNull(value, source.pageNo, source.page, source.at)
}

function toBookPosition(raw) {
  const source = asRecord(raw)
  return {
    currentPage: numberOrNull(source.currentPage, source.pageNo, source.page),
    totalPages: numberOrNull(source.totalPages, source.pageCount, source.total),
    effectiveMinutes: numberOrNull(source.effectiveMinutes, source.readingMinutes, source.minutes),
    bookmarks: asArray(source.bookmarks).map(toBookmark).filter((value) => value !== null),
  }
}

function toBookListReference(raw) {
  const source = asRecord(raw)
  return {
    id: firstValue(source.id, source.listId, typeof raw === 'string' ? raw : null),
    name: firstValue(source.name, source.title),
  }
}

function toTeacherMark(raw) {
  const source = asRecord(raw)
  return {
    key: firstValue(source.key, source.id),
    page: numberOrNull(source.page, source.pageNo),
    text: firstValue(source.text, source.quote, source.content),
    teacher: firstValue(source.teacher, source.teacherName),
  }
}

function toClassReading(raw) {
  const source = asRecord(raw)
  const mode = firstValue(source.mode, source.state)
  if (!mode) return null
  const connectedValue = firstValue(source.connected, source.isConnected)
  const broadcast = asRecord(source.broadcast)
  return {
    mode,
    state: mode,
    tone: firstValue(source.tone, mode === 'sync' ? 'violet' : 'blue'),
    connected: connectedValue == null ? null : booleanValue(connectedValue),
    teacher: firstValue(source.teacher, source.teacherName),
    page: numberOrNull(source.page, source.pageNo),
    label: firstValue(source.label, source.title, mode === 'sync' ? '课堂同步页面' : mode === 'lock' ? '课堂锁定书籍' : '课堂状态'),
    desc: firstValue(source.description, source.desc, '课堂状态由服务端返回。'),
    endAt: firstValue(source.endAt, source.endsAt),
    broadcast: Object.keys(broadcast).length ? broadcast : null,
    teacherMarks: asArray(source.teacherMarks || source.marks).map(toTeacherMark).filter((mark) => mark.page && mark.text),
    joined: numberOrNull(source.joined, source.participantCount),
    classSize: numberOrNull(source.classSize, source.totalStudents),
  }
}

function toBook(raw) {
  const source = asRecord(raw)
  const cover = toAsset(source.cover || source.coverUrl)
  const progress = toBookPosition(source.progress || source.readingProgress)
  const classReading = toClassReading(source.classReading || source.classSession)
  return {
    id: firstValue(source.id, source.bookId),
    versionId: firstValue(source.versionId, source.bookVersionId),
    title: firstValue(source.title, source.name),
    author: firstValue(source.author, source.authorName),
    cover,
    coverUrl: cover?.url || null,
    assets: asArray(source.assets).map(toAsset).filter(Boolean),
    progress,
    minutes: progress.effectiveMinutes,
    page: progress.currentPage,
    totalPages: progress.totalPages,
    bookmarks: progress.bookmarks,
    access: asRecord(source.access),
    liked: booleanValue(source.liked, source.isLiked),
    downloaded: booleanValue(source.downloaded, source.isDownloaded),
    lists: asArray(source.lists || source.collections).map(toBookListReference).filter((item) => item.id || item.name),
    classReading,
  }
}

function toHomeList(raw, books) {
  const source = asRecord(raw)
  const rawIds = asArray(source.bookIds || source.books).map((item) => firstValue(asRecord(item).id, asRecord(item).bookId, item))
  const bookIds = rawIds.filter(Boolean)
  return {
    id: firstValue(source.id, source.listId, source.name),
    name: firstValue(source.name, source.title),
    description: firstValue(source.description, source.note),
    books: books.filter((book) => bookIds.includes(book.id)),
  }
}

function deriveListsFromBookMembership(books) {
  const groups = new Map()
  books.forEach((book) => {
    book.lists.forEach((list) => {
      const key = list.id || list.name
      if (!key) return
      const current = groups.get(key) || { id: list.id || key, name: list.name || null, description: null, books: [] }
      current.books.push(book)
      groups.set(key, current)
    })
  })
  return [...groups.values()]
}

function toReadingSummary(raw, books) {
  const source = asRecord(raw)
  const summary = asRecord(source.summary)
  const knownBookMinutes = books.map((book) => book.progress.effectiveMinutes).filter(Number.isFinite)
  const minutesFromBooks = knownBookMinutes.length
    ? knownBookMinutes.reduce((total, minutes) => total + minutes, 0)
    : null
  return {
    effectiveMinutes: numberOrNull(source.totalEffectiveMinutes, source.effectiveMinutes, summary.totalEffectiveMinutes, summary.effectiveMinutes, minutesFromBooks),
    downloadedBookCount: numberOrNull(source.downloadedBookCount, summary.downloadedBookCount, books.filter((book) => book.downloaded).length),
  }
}

function toReaderBlock(raw) {
  const source = asRecord(raw)
  const text = firstValue(source.text, source.content, typeof raw === 'string' ? raw : null)
  if (typeof text !== 'string' || !text.trim()) return null
  const blockId = firstValue(source.blockId, source.id)
  return {
    ...(blockId ? { id: blockId, blockId } : {}),
    kind: firstValue(source.kind, source.type, 'paragraph'),
    text,
  }
}

export function toReaderPageDto(raw) {
  const source = asRecord(raw)
  const content = asRecord(source.content)
  const blocks = asArray(source.blocks || content.blocks || source.paragraphs)
    .map(toReaderBlock)
    .filter(Boolean)
  const plainText = firstValue(source.text, content.text)
  if (!blocks.length && typeof plainText === 'string' && plainText.trim()) {
    blocks.push({ kind: 'paragraph', text: plainText })
  }
  const illustration = toAsset(source.illustration || source.figure || content.illustration)
  return {
    no: numberOrNull(source.pageNo, source.no, source.page),
    chapter: firstValue(source.chapter, source.chapterTitle, content.chapter),
    blocks,
    illustration,
    figure: illustration ? { ...illustration, caption: firstValue(asRecord(source.figure).caption, asRecord(source.illustration).caption, content.caption) } : null,
  }
}

function toAiQuote(raw) {
  const source = asRecord(raw)
  return {
    key: firstValue(source.key, source.id, source.quoteId),
    page: numberOrNull(source.page, source.pageNo),
    title: firstValue(source.title, source.bookTitle),
    text: firstValue(source.text, source.quote, source.content),
  }
}

function toAiMessage(raw) {
  const source = asRecord(raw)
  const rawRole = firstValue(source.role, source.senderRole, 'assistant')
  const role = rawRole === 'user' ? 'student' : rawRole === 'assistant' ? 'assistant' : rawRole
  return {
    id: firstValue(source.id, source.messageId),
    role,
    text: firstValue(source.text, source.content, ''),
    at: firstValue(source.at, source.createdAt, source.time),
    teacher: firstValue(source.teacher, source.teacherName),
    quotes: asArray(source.quotes).map(toAiQuote),
    refs: asArray(source.refs || source.references).map(toAiQuote),
    sendState: firstValue(source.sendState, source.status),
    typing: false,
    stopped: booleanValue(source.stopped),
    feedback: firstValue(source.feedback),
  }
}

function toAiConversation(raw) {
  const source = asRecord(raw)
  const context = asRecord(source.context)
  return {
    id: firstValue(source.id, source.conversationId),
    title: firstValue(source.title, source.name),
    private: source.privacyMode === 'private' || booleanValue(source.private, source.isPrivate),
    classroom: booleanValue(source.classroom, source.isClassroom),
    bookId: firstValue(source.bookId),
    bookVersionId: firstValue(source.bookVersionId),
    pageNumber: numberOrNull(context.pageNumber),
    quotes: context.selection && Object.keys(context.selection).length ? [context.selection] : [],
    refs: asArray(context.citations),
    contextVersion: numberOrNull(context.version),
    version: numberOrNull(source.version),
    deletedAt: firstValue(source.deletedAt),
    messages: asArray(source.messages || source.items).map(toAiMessage),
  }
}

export function toStudentAiDto(raw, meta = {}) {
  const source = asRecord(raw)
  const metadata = asRecord(meta)
  const quota = asRecord(source.quota || metadata.quota)
  const conversations = [
    ...asArray(source.items),
    ...asArray(source.trash),
  ].map(toAiConversation).filter((conversation) => conversation.id)
  return {
    chats: conversations.filter((conversation) => !conversation.deletedAt),
    trash: conversations.filter((conversation) => conversation.deletedAt),
    activeId: firstValue(source.activeId, source.activeConversationId),
    unread: numberOrNull(source.unread, source.unreadCount),
    safeMode: booleanValue(source.safeMode),
    quota: {
      remaining: numberOrNull(quota.remaining, quota.remainingQuestions),
      usagePercent: numberOrNull(quota.usagePercent, quota.percent),
      resetAt: firstValue(quota.resetAt, quota.resetsAt),
    },
  }
}

export function toStudentRuntimeDto({ session, books, progress, eyeCare }) {
  const sessionData = asRecord(session)
  const booksData = asRecord(books)
  const bookItems = listFrom(books).map(toBook).filter((book) => book.id)
  const explicitLists = asArray(booksData.lists || booksData.collections).map((list) => toHomeList(list, bookItems)).filter((list) => list.id)
  return {
    workspaceId: firstValue(sessionData.activeWorkspaceId, sessionData.workspaceId),
    student: toStudent(sessionData.user || sessionData.actor || sessionData),
    books: bookItems,
    homeLists: explicitLists.length ? explicitLists : deriveListsFromBookMembership(bookItems),
    readingSummary: toReadingSummary(progress, bookItems),
    readingProgress: asArray(asRecord(progress).items || asRecord(progress).progress || progress),
    eyeCare: asRecord(eyeCare),
  }
}
