import { randomUUID } from 'node:crypto'

const ACTIVE_REVIEW_STATUSES = new Set([
  'pending_secondary_review',
  'review_claimed',
  'pending_human_confirmation',
  'awaiting_human_acceptance',
])

export class ConversationDomainError extends Error {
  constructor(code, message, details = null) {
    super(message)
    this.name = 'ConversationDomainError'
    this.code = code
    this.details = details
  }
}

export function generateConversationTitle({ title, text, selection } = {}) {
  const explicit = normalizeText(title)
  if (explicit) return explicit.slice(0, 40)
  const source = normalizeText(text) || normalizeText(selection?.text) || '新的对话'
  return source.length > 40 ? `${source.slice(0, 39)}…` : source
}

export function createConversationDomain(dependencies = {}) {
  const database = requireDatabase(dependencies.db)
  const now = dependencies.now || (() => new Date())
  const idFactory = dependencies.idFactory || randomUUID
  const authorize = dependencies.authorize || (async () => true)
  const audit = dependencies.audit || (async () => {})

  async function createConversation({ authContext, input = {} } = {}) {
    const scope = requireAuthScope(database, authContext)
    const book = requireBookVersion(database, scope.organizationId, requiredText(input.bookVersionId, 'bookVersionId'))
    await requireAuthorized(authorize, 'ai.conversation.create', scope, {
      organizationId: scope.organizationId,
      ownerUserId: scope.user.id,
      bookVersionId: book.versionId,
    })
    const currentIso = normalizeDate(now()).toISOString()
    const id = idFactory()
    const title = generateConversationTitle({ title: input.title, text: input.initialText, selection: input.selection })
    const titleSource = normalizeText(input.title) ? 'manual' : 'auto'
    const context = normalizeContext(input, book.versionId)
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare(`INSERT INTO ai_conversations
        (id, organization_id, organization_id_at_creation, owner_user_id, actor_id_at_creation,
          book_version_id, title, summary_json, privacy_mode, created_at, updated_at, version,
          title_source, deleted_at, deleted_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 'standard', ?, ?, 1, ?, NULL, NULL)`)
        .run(id, scope.organizationId, scope.organizationId, scope.user.id, scope.user.id,
          book.versionId, title, currentIso, currentIso, titleSource)
      const contextUpdate = database.prepare(`UPDATE ai_conversation_contexts
        SET page_number = ?, selection_json = ?, citations_json = ?, updated_at = ?
        WHERE organization_id = ? AND owner_user_id = ? AND conversation_id = ? AND book_version_id = ?`)
        .run(context.pageNumber, JSON.stringify(context.selection), JSON.stringify(context.citations), currentIso,
          scope.organizationId, scope.user.id, id, book.versionId)
      if (contextUpdate.changes !== 1) throw domainError('STATE_CONFLICT', '会话上下文初始化失败')
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    await writeAudit(audit, scope, 'ai.conversation.created', id, null, 1, { bookVersionId: book.versionId })
    return readConversationRow(database, scope.organizationId, scope.user.id, id)
  }

  async function listOwnConversations({ authContext, includeDeleted = false } = {}) {
    const scope = requireAuthScope(database, authContext)
    await requireAuthorized(authorize, 'ai.conversation.read_self', scope, {
      organizationId: scope.organizationId,
      ownerUserId: scope.user.id,
    })
    const rows = database.prepare(`${conversationSelect()}
      WHERE conversation.organization_id = ? AND conversation.owner_user_id = ?
        AND (? = 1 OR conversation.deleted_at IS NULL)
      ORDER BY conversation.updated_at DESC, conversation.id DESC`)
      .all(scope.organizationId, scope.user.id, includeDeleted ? 1 : 0)
      .map(publicConversation)
    return {
      items: rows.filter((row) => !row.deleted),
      trash: includeDeleted ? rows.filter((row) => row.deleted) : [],
    }
  }

  async function renameConversation({ authContext, conversationId, title, expectedVersion } = {}) {
    const normalizedTitle = requiredText(title, 'title').slice(0, 40)
    return updateConversation({
      authContext,
      conversationId,
      expectedVersion,
      permission: 'ai.conversation.rename_self',
      eventType: 'ai.conversation.renamed',
      apply: ({ scope, target, currentIso, version }) => database.prepare(`UPDATE ai_conversations
        SET title = ?, title_source = 'manual', updated_at = ?, version = version + 1
        WHERE organization_id = ? AND owner_user_id = ? AND id = ? AND version = ? AND deleted_at IS NULL`)
        .run(normalizedTitle, currentIso, scope.organizationId, scope.user.id, target.id, version),
    })
  }

  async function setPrivacyMode({ authContext, conversationId, privacyMode, expectedVersion } = {}) {
    const normalizedMode = normalizeText(privacyMode)
    if (!['standard', 'private'].includes(normalizedMode)) {
      throw domainError('VALIDATION_FAILED', 'privacyMode 必须为 standard 或 private')
    }
    return updateConversation({
      authContext,
      conversationId,
      expectedVersion,
      permission: 'ai.conversation.privacy_self',
      eventType: 'ai.conversation.privacy_changed',
      details: { privacyMode: normalizedMode },
      apply: ({ scope, target, currentIso, version }) => database.prepare(`UPDATE ai_conversations
        SET privacy_mode = ?, updated_at = ?, version = version + 1
        WHERE organization_id = ? AND owner_user_id = ? AND id = ? AND version = ? AND deleted_at IS NULL`)
        .run(normalizedMode, currentIso, scope.organizationId, scope.user.id, target.id, version),
    })
  }

  async function updateConversationContext({ authContext, conversationId, context = {}, expectedVersion, expectedContextVersion } = {}) {
    const scope = requireAuthScope(database, authContext)
    const target = requireOwnedConversation(database, scope, conversationId)
    const version = requireVersion(expectedVersion)
    const contextVersion = requireVersion(expectedContextVersion)
    if (target.version !== version || target.context.version !== contextVersion) throw versionConflict()
    const nextContext = normalizeContext({
      pageNumber: context.pageNumber,
      selection: context.selection,
      citations: context.citations,
    }, target.bookVersionId)
    await requireAuthorized(authorize, 'ai.conversation.context_self', scope, target)
    const currentIso = normalizeDate(now()).toISOString()
    database.exec('BEGIN IMMEDIATE')
    try {
      const conversationUpdate = database.prepare(`UPDATE ai_conversations
        SET updated_at = ?, version = version + 1
        WHERE organization_id = ? AND owner_user_id = ? AND id = ? AND version = ? AND deleted_at IS NULL`)
        .run(currentIso, scope.organizationId, scope.user.id, target.id, version)
      const contextUpdate = database.prepare(`UPDATE ai_conversation_contexts
        SET page_number = ?, selection_json = ?, citations_json = ?, updated_at = ?, version = version + 1
        WHERE organization_id = ? AND owner_user_id = ? AND conversation_id = ? AND version = ?`)
        .run(nextContext.pageNumber, JSON.stringify(nextContext.selection), JSON.stringify(nextContext.citations), currentIso,
          scope.organizationId, scope.user.id, target.id, contextVersion)
      if (conversationUpdate.changes !== 1 || contextUpdate.changes !== 1) throw versionConflict()
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    await writeAudit(audit, scope, 'ai.conversation.context_updated', target.id, version, version + 1)
    return readConversationRow(database, scope.organizationId, scope.user.id, target.id)
  }

  async function softDeleteConversation({ authContext, conversationId, expectedVersion } = {}) {
    return updateConversation({
      authContext,
      conversationId,
      expectedVersion,
      permission: 'ai.conversation.delete_self',
      eventType: 'ai.conversation.deleted',
      allowDeleted: false,
      apply: ({ scope, target, currentIso, version }) => database.prepare(`UPDATE ai_conversations
        SET deleted_at = ?, deleted_by_user_id = ?, updated_at = ?, version = version + 1
        WHERE organization_id = ? AND owner_user_id = ? AND id = ? AND version = ? AND deleted_at IS NULL`)
        .run(currentIso, scope.user.id, currentIso, scope.organizationId, scope.user.id, target.id, version),
    })
  }

  async function restoreConversation({ authContext, conversationId, expectedVersion } = {}) {
    return updateConversation({
      authContext,
      conversationId,
      expectedVersion,
      permission: 'ai.conversation.restore_self',
      eventType: 'ai.conversation.restored',
      allowDeleted: true,
      requireDeleted: true,
      apply: ({ scope, target, currentIso, version }) => database.prepare(`UPDATE ai_conversations
        SET deleted_at = NULL, deleted_by_user_id = NULL, updated_at = ?, version = version + 1
        WHERE organization_id = ? AND owner_user_id = ? AND id = ? AND version = ? AND deleted_at IS NOT NULL`)
        .run(currentIso, scope.organizationId, scope.user.id, target.id, version),
    })
  }

  async function getConversation({ authContext, ownerUserId, conversationId, purpose } = {}) {
    const scope = requireAuthScope(database, authContext)
    const ownerId = requiredText(ownerUserId || scope.user.id, 'ownerUserId')
    const target = readConversationRow(database, scope.organizationId, ownerId, requiredText(conversationId, 'conversationId'))
    if (!target || target.deleted) throw resourceNotFound()
    if (ownerId !== scope.user.id && !targetInWorkspaceScope(database, scope, ownerId)) throw resourceNotFound()
    await requireAuthorized(authorize, ownerId === scope.user.id ? 'ai.conversation.read_self' : 'ai.conversation.read_scoped', scope, target)
    let accessMode = ownerId === scope.user.id ? 'owner' : 'standard'
    let messages
    if (ownerId !== scope.user.id && hasSafetyMinimumContext(database, target)) {
      accessMode = 'safety_minimum_context'
      messages = safetyMinimumMessages(database, target)
    } else if (ownerId !== scope.user.id && target.privacyMode === 'private') {
      const normalizedPurpose = requiredText(purpose, 'purpose', 4)
      const currentIso = normalizeDate(now()).toISOString()
      const grant = database.prepare(`SELECT id FROM privacy_access_grants
        WHERE organization_id = ? AND owner_user_id = ? AND conversation_id = ?
          AND requester_user_id = ? AND expires_at > ?
        ORDER BY granted_at DESC, id DESC LIMIT 1`)
        .get(scope.organizationId, ownerId, target.id, scope.user.id, currentIso)
      if (!grant) throw domainError('PRIVACY_CONSENT_REQUIRED', '普通私密会话必须先获得学生授权')
      accessMode = 'student_approved'
      messages = conversationMessages(database, target)
      target.purpose = normalizedPurpose
    } else {
      messages = conversationMessages(database, target)
    }
    await writeAudit(audit, scope, 'ai.conversation.viewed', target.id, target.version, target.version, {
      ownerUserId: ownerId,
      accessMode,
      purpose: normalizeText(purpose) || null,
    })
    const viewedAt = normalizeDate(now()).toISOString()
    return {
      ...target,
      accessMode,
      messages,
      watermark: `${scope.user.displayName}（${scope.user.id}） · ${viewedAt}`,
      safetyContext: accessMode === 'safety_minimum_context'
        ? readSafetyContext(database, target)
        : null,
    }
  }

  async function searchScopedConversationIndex({ authContext, query = {} } = {}) {
    const scope = requireAuthScope(database, authContext)
    await requireAuthorized(authorize, 'ai.conversation.search_scoped', scope, workspaceResource(scope.workspace))
    const normalizedQuery = normalizeSearchQuery(query)
    const rows = database.prepare(`${conversationSelect(`,
        owner.display_name AS owner_display_name,
        class.id AS class_id,
        class.name AS class_name`)}
      JOIN users AS owner
        ON owner.id = conversation.owner_user_id
       AND owner.organization_id = conversation.organization_id
       AND owner.status = 'active'
      JOIN class_memberships AS membership
        ON membership.user_id = owner.id
       AND membership.membership_role = 'student'
       AND membership.status = 'active'
      JOIN classes AS class
        ON class.id = membership.class_id
       AND class.organization_id = conversation.organization_id
       AND class.status = 'active'
      WHERE conversation.organization_id = ? AND conversation.deleted_at IS NULL
        AND (? = '' OR lower(conversation.title) LIKE ? OR lower(owner.display_name) LIKE ?
          OR lower(class.name) LIKE ? OR lower(book.title) LIKE ?)
        AND (? = 'school' OR (? = 'class' AND class.id = ?) OR (? = 'grade' AND class.grade_id = ?)
          OR (? = 'own' AND owner.id = ?))
      ORDER BY class.name, owner.display_name, conversation.updated_at DESC, conversation.id DESC`)
      .all(
        scope.organizationId,
        normalizedQuery.text,
        normalizedQuery.like, normalizedQuery.like, normalizedQuery.like, normalizedQuery.like,
        scope.workspace.scope_type,
        scope.workspace.scope_type, scope.workspace.scope_id,
        scope.workspace.scope_type, scope.workspace.scope_id,
        scope.workspace.scope_type, scope.user.id,
      )
    const selectedBooks = new Set(normalizedQuery.bookVersionIds)
    const byStudent = new Map()
    for (const row of rows) {
      const key = `${row.class_id}:${row.owner_user_id}`
      if (!byStudent.has(key)) byStudent.set(key, [])
      byStudent.get(key).push(row)
    }
    const classes = new Map()
    for (const studentRows of byStudent.values()) {
      const available = new Set(studentRows.map((row) => row.book_version_id))
      if (selectedBooks.size > 0 && normalizedQuery.bookMode === 'AND'
        && ![...selectedBooks].every((bookId) => available.has(bookId))) continue
      const filtered = selectedBooks.size === 0
        ? studentRows
        : studentRows.filter((row) => selectedBooks.has(row.book_version_id))
      if (filtered.length === 0) continue
      const first = filtered[0]
      if (!classes.has(first.class_id)) classes.set(first.class_id, { id: first.class_id, name: first.class_name, students: [] })
      classes.get(first.class_id).students.push({
        id: first.owner_user_id,
        displayName: first.owner_display_name,
        conversations: filtered.map(publicConversation),
      })
    }
    return { classes: [...classes.values()], query: normalizedQuery.public }
  }

  async function updateConversation(options) {
    const scope = requireAuthScope(database, options.authContext)
    const target = requireOwnedConversation(database, scope, options.conversationId, options.allowDeleted)
    if (options.requireDeleted && !target.deleted) throw domainError('STATE_CONFLICT', '会话不在最近删除中')
    const version = requireVersion(options.expectedVersion)
    if (target.version !== version) throw versionConflict()
    await requireAuthorized(authorize, options.permission, scope, target)
    const currentIso = normalizeDate(now()).toISOString()
    const result = options.apply({ scope, target, currentIso, version })
    if (result.changes !== 1) throw versionConflict()
    await writeAudit(audit, scope, options.eventType, target.id, version, version + 1, options.details)
    return readConversationRow(database, scope.organizationId, scope.user.id, target.id)
  }

  return {
    createConversation,
    getConversation,
    listOwnConversations,
    renameConversation,
    restoreConversation,
    searchScopedConversationIndex,
    setPrivacyMode,
    softDeleteConversation,
    updateConversationContext,
  }
}

function conversationSelect(extraColumns = '') {
  return `SELECT conversation.*, context.page_number, context.selection_json, context.citations_json,
      context.version AS context_version, book.id AS book_id, book.title AS book_title${extraColumns}
    FROM ai_conversations AS conversation
    JOIN ai_conversation_contexts AS context
      ON context.organization_id = conversation.organization_id
     AND context.owner_user_id = conversation.owner_user_id
     AND context.conversation_id = conversation.id
     AND context.book_version_id = conversation.book_version_id
    JOIN book_versions AS version
      ON version.id = conversation.book_version_id
     AND version.organization_id_at_creation = conversation.organization_id
    JOIN books AS book
      ON book.id = version.book_id
     AND book.organization_id_at_creation = conversation.organization_id`
}

function readConversationRow(database, organizationId, ownerUserId, conversationId) {
  const row = database.prepare(`${conversationSelect()}
    WHERE conversation.organization_id = ? AND conversation.owner_user_id = ? AND conversation.id = ?`)
    .get(organizationId, ownerUserId, conversationId)
  return row ? publicConversation(row) : null
}

function publicConversation(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    ownerUserId: row.owner_user_id,
    title: row.title || '新的对话',
    titleSource: row.title_source,
    privacyMode: row.privacy_mode,
    bookId: row.book_id,
    bookVersionId: row.book_version_id,
    bookTitle: row.book_title,
    context: {
      pageNumber: row.page_number,
      selection: parseJson(row.selection_json, {}),
      citations: parseJson(row.citations_json, []),
      version: row.context_version,
    },
    deleted: Boolean(row.deleted_at),
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  }
}

function conversationMessages(database, target) {
  const rows = database.prepare(`SELECT id, role, content, privacy_detected, privacy_confidence,
      danger_detected, danger_confidence, created_at
    FROM ai_messages
    WHERE organization_id = ? AND actor_id_at_creation = ? AND conversation_id = ?
    ORDER BY created_at, id`).all(target.organizationId, target.ownerUserId, target.id)
  return rows.map(publicMessage)
}

function safetyMinimumMessages(database, target) {
  const rows = database.prepare(`SELECT DISTINCT message.id, message.role, message.content,
      message.privacy_detected, message.privacy_confidence, message.danger_detected,
      message.danger_confidence, message.created_at
    FROM safety_review_tasks AS review
    JOIN safety_review_evidence AS evidence
      ON evidence.organization_id = review.organization_id
     AND evidence.owner_user_id = review.actor_id_at_creation
     AND evidence.conversation_id = review.conversation_id
     AND evidence.review_task_id = review.id
    JOIN ai_messages AS message
      ON message.organization_id = evidence.organization_id
     AND message.actor_id_at_creation = evidence.owner_user_id
     AND message.conversation_id = evidence.conversation_id
     AND message.id = evidence.ai_message_id
    WHERE review.organization_id = ? AND review.actor_id_at_creation = ? AND review.conversation_id = ?
    ORDER BY message.created_at, message.id`).all(target.organizationId, target.ownerUserId, target.id)
  return rows.map(publicMessage)
}

function publicMessage(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    privacy: { detected: Boolean(row.privacy_detected), confidence: row.privacy_confidence },
    danger: { detected: Boolean(row.danger_detected), confidence: row.danger_confidence },
    createdAt: row.created_at,
  }
}

function hasSafetyMinimumContext(database, target) {
  const rows = database.prepare(`SELECT status FROM safety_review_tasks
    WHERE organization_id = ? AND actor_id_at_creation = ? AND conversation_id = ?`)
    .all(target.organizationId, target.ownerUserId, target.id)
  if (rows.some((row) => ACTIVE_REVIEW_STATUSES.has(row.status))) return true
  return Boolean(database.prepare(`SELECT 1 AS present
    FROM safety_events AS event
    JOIN safety_review_tasks AS review
      ON review.id = event.review_task_id
     AND review.organization_id = event.organization_id
     AND review.actor_id_at_creation = event.actor_id_at_creation
    WHERE review.organization_id = ? AND review.actor_id_at_creation = ? AND review.conversation_id = ?
      AND event.status <> 'false_positive_closed'
    LIMIT 1`).get(target.organizationId, target.ownerUserId, target.id))
}

function readSafetyContext(database, target) {
  const row = database.prepare(`SELECT review.id AS review_task_id, review.status AS review_status,
      event.id AS event_id, event.status AS event_status, event.risk_level
    FROM safety_review_tasks AS review
    LEFT JOIN safety_events AS event
      ON event.review_task_id = review.id
     AND event.organization_id = review.organization_id
     AND event.actor_id_at_creation = review.actor_id_at_creation
    WHERE review.organization_id = ? AND review.actor_id_at_creation = ? AND review.conversation_id = ?
    ORDER BY review.created_at DESC, review.id DESC LIMIT 1`)
    .get(target.organizationId, target.ownerUserId, target.id)
  if (!row) return null
  return {
    id: row.event_id || row.review_task_id,
    reviewTaskId: row.review_task_id,
    eventId: row.event_id || null,
    status: row.event_status || row.review_status,
    riskLevel: row.risk_level || null,
  }
}

function requireAuthScope(database, authContext) {
  const organizationId = requiredText(authContext?.organizationId, 'authContext.organizationId')
  const userId = requiredText(authContext?.userId, 'authContext.userId')
  const workspaceId = requiredText(authContext?.workspaceId, 'authContext.workspaceId')
  const row = database.prepare(`SELECT user.id AS user_id, user.display_name,
      workspace.id AS workspace_id, workspace.organization_id, workspace.scope_type, workspace.scope_id
    FROM users AS user
    JOIN organizations AS organization
      ON organization.id = user.organization_id AND organization.status = 'active'
    JOIN workspace_memberships AS membership
      ON membership.user_id = user.id AND membership.status = 'active'
    JOIN workspaces AS workspace
      ON workspace.id = membership.workspace_id
     AND workspace.organization_id = user.organization_id
     AND workspace.status = 'active'
    WHERE user.id = ? AND user.organization_id = ? AND user.status = 'active' AND workspace.id = ?`)
    .get(userId, organizationId, workspaceId)
  if (!row) throw domainError('AUTH_SCOPE_INVALID', '当前账号、组织或工作空间不可用')
  return {
    organizationId,
    user: { id: row.user_id, displayName: row.display_name },
    workspace: { id: row.workspace_id, scope_type: row.scope_type, scope_id: row.scope_id },
    authContext: { organizationId, userId, workspaceId },
  }
}

function requireBookVersion(database, organizationId, bookVersionId) {
  const row = database.prepare(`SELECT version.id AS version_id, book.id AS book_id, book.title
    FROM book_versions AS version
    JOIN books AS book
      ON book.id = version.book_id
     AND book.organization_id_at_creation = version.organization_id_at_creation
    WHERE version.id = ? AND version.organization_id_at_creation = ? AND book.status = 'published'`)
    .get(bookVersionId, organizationId)
  if (!row) throw resourceNotFound()
  return { versionId: row.version_id, bookId: row.book_id, title: row.title }
}

function requireOwnedConversation(database, scope, conversationId, allowDeleted = false) {
  const target = readConversationRow(database, scope.organizationId, scope.user.id, requiredText(conversationId, 'conversationId'))
  if (!target || (!allowDeleted && target.deleted)) throw resourceNotFound()
  return target
}

function targetInWorkspaceScope(database, scope, ownerUserId) {
  if (scope.workspace.scope_type === 'school') return scope.workspace.scope_id === scope.organizationId
  if (scope.workspace.scope_type === 'own') return ownerUserId === scope.user.id
  const row = database.prepare(`SELECT 1 AS allowed
    FROM class_memberships AS membership
    JOIN classes AS class
      ON class.id = membership.class_id
     AND class.organization_id = ?
     AND class.status = 'active'
    WHERE membership.user_id = ? AND membership.membership_role = 'student' AND membership.status = 'active'
      AND ((? = 'class' AND class.id = ?) OR (? = 'grade' AND class.grade_id = ?))
    LIMIT 1`).get(
      scope.organizationId,
      ownerUserId,
      scope.workspace.scope_type, scope.workspace.scope_id,
      scope.workspace.scope_type, scope.workspace.scope_id,
    )
  return Boolean(row)
}

function normalizeContext(input, bookVersionId) {
  const pageNumber = input.pageNumber === undefined || input.pageNumber === null ? null : Number(input.pageNumber)
  if (pageNumber !== null && (!Number.isInteger(pageNumber) || pageNumber <= 0)) {
    throw domainError('VALIDATION_FAILED', 'pageNumber 必须为正整数')
  }
  const selection = input.selection && typeof input.selection === 'object' && !Array.isArray(input.selection) ? input.selection : {}
  const citations = input.citations === undefined ? [] : input.citations
  if (!Array.isArray(citations)) throw domainError('VALIDATION_FAILED', 'citations 必须为数组')
  return { bookVersionId, pageNumber, selection, citations }
}

function normalizeSearchQuery(query) {
  const text = normalizeText(query.text).toLocaleLowerCase()
  const bookVersionIds = uniqueStrings(query.bookVersionIds)
  const bookMode = normalizeText(query.bookMode).toUpperCase() === 'AND' ? 'AND' : 'OR'
  return {
    text,
    like: `%${text}%`,
    bookVersionIds,
    bookMode,
    public: { text, bookVersionIds, bookMode },
  }
}

async function requireAuthorized(authorize, permission, scope, resource) {
  const allowed = await authorize({
    action: permission,
    permission,
    authContext: scope.authContext,
    resource,
  })
  if (!allowed) throw domainError('FORBIDDEN', '没有执行该操作的权限')
}

async function writeAudit(audit, scope, eventType, resourceId, beforeVersion, afterVersion, details = null) {
  await audit({
    eventType,
    resourceType: 'ai_conversation',
    resourceId,
    actorId: scope.user.id,
    workspaceId: scope.workspace.id,
    organizationId: scope.organizationId,
    beforeVersion,
    afterVersion,
    details,
  })
}

function workspaceResource(workspace) {
  return { workspaceId: workspace.id, scopeType: workspace.scope_type, scopeId: workspace.scope_id }
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function requiredText(value, name, minimumLength = 1) {
  const normalized = normalizeText(value)
  if (normalized.length < minimumLength) throw domainError('VALIDATION_FAILED', `${name} 不能为空`)
  return normalized
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeText).filter(Boolean))]
}

function requireVersion(value) {
  const version = Number(value)
  if (!Number.isInteger(version) || version < 1) throw domainError('VALIDATION_FAILED', 'expectedVersion 必须为正整数')
  return version
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw domainError('VALIDATION_FAILED', '时间无效')
  return date
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function requireDatabase(database) {
  if (!database?.prepare || !database?.exec) throw new TypeError('db 必须是 SQLite 数据库连接')
  return database
}

function domainError(code, message, details = null) {
  return new ConversationDomainError(code, message, details)
}

function resourceNotFound() {
  return domainError('RESOURCE_NOT_FOUND', '会话不存在')
}

function versionConflict() {
  return domainError('VERSION_CONFLICT', '会话已被更新，请刷新后重试')
}
