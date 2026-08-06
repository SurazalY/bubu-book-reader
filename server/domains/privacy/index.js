import { randomUUID } from 'node:crypto'

const DEFAULT_REQUEST_TTL_SECONDS = 24 * 60 * 60
const DEFAULT_GRANT_TTL_SECONDS = 15 * 60

export function createPrivacyDomain(dependencies = {}) {
  const database = requireDatabase(dependencies.db)
  const now = dependencies.now || (() => new Date())
  const idFactory = dependencies.idFactory || randomUUID
  const authorize = dependencies.authorize || (async () => true)
  const audit = dependencies.audit || (async () => undefined)
  const requestTtlSeconds = positiveSeconds(dependencies.requestTtlSeconds, DEFAULT_REQUEST_TTL_SECONDS, 'requestTtlSeconds')
  const grantTtlSeconds = positiveSeconds(dependencies.grantTtlSeconds, DEFAULT_GRANT_TTL_SECONDS, 'grantTtlSeconds')

  async function createAccessRequest({ authContext, conversationId, purpose, expiresInSeconds } = {}) {
    const scope = requireAuthScope(database, authContext)
    const target = requireConversationTarget(database, scope, requiredText(conversationId, 'conversationId'))
    await requireAuthorized(authorize, 'privacy.request', scope, target)
    if (target.privacyMode !== 'private') throw domainError('STATE_CONFLICT', '当前会话不是私密会话')
    if (findActiveSafetyReview(database, target)) {
      throw domainError('SAFETY_MINIMUM_CONTEXT_AVAILABLE', '安全标记会话应按用途查看最小上下文')
    }
    const normalizedPurpose = requiredText(purpose, 'purpose', 4)
    const ttlSeconds = positiveSeconds(expiresInSeconds, requestTtlSeconds, 'expiresInSeconds')
    const current = normalizeDate(now())
    const currentIso = current.toISOString()
    const expiresAt = new Date(current.getTime() + ttlSeconds * 1000).toISOString()
    const id = idFactory()
    try {
      database.prepare(`INSERT INTO privacy_access_requests
        (id, organization_id, organization_id_at_creation, actor_id_at_creation,
          conversation_id, requester_user_id, status, purpose, expires_at,
          created_at, updated_at, version)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, 1)`)
        .run(id, scope.organizationId, scope.organizationId, scope.user.id,
          target.conversationId, scope.user.id, normalizedPurpose, expiresAt, currentIso, currentIso)
    } catch (error) {
      if (/UNIQUE constraint failed/i.test(String(error?.message))) {
        throw domainError('STATE_CONFLICT', '该会话已有待处理访问申请')
      }
      throw error
    }
    await audit({
      eventType: 'privacy.access.requested',
      resourceType: 'ai_conversation',
      resourceId: target.conversationId,
      actorId: scope.user.id,
      workspaceId: scope.workspace.id,
      details: { requestId: id, purpose: normalizedPurpose, expiresAt },
    })
    return {
      id,
      conversationId: target.conversationId,
      ownerUserId: target.ownerUserId,
      requesterUserId: scope.user.id,
      status: 'pending',
      purpose: normalizedPurpose,
      expiresAt,
      createdAt: currentIso,
    }
  }

  async function listOwnerRequests({ authContext } = {}) {
    const scope = requireAuthScope(database, authContext)
    await requireAuthorized(authorize, 'privacy.requests.read_self', scope, {
      organizationId: scope.organizationId,
      ownerUserId: scope.user.id,
    })
    const autoApproved = autoApproveExpiredRequests(database, {
      organizationId: scope.organizationId,
      ownerUserId: scope.user.id,
      current: normalizeDate(now()),
      grantTtlSeconds,
      idFactory,
    })
    if (autoApproved.length > 0) {
      await audit({
        eventType: 'privacy.access.timeout_approved',
        resourceType: 'user',
        resourceId: scope.user.id,
        actorId: scope.user.id,
        workspaceId: scope.workspace.id,
        details: { requestIds: autoApproved },
      })
    }
    const rows = database.prepare(`SELECT access_request.*, requester.display_name AS requester_display_name
      FROM privacy_access_requests AS access_request
      JOIN privacy_access_request_scopes AS request_scope
        ON request_scope.request_id = access_request.id
       AND request_scope.organization_id = ?
       AND request_scope.owner_user_id = ?
      JOIN users AS requester
        ON requester.id = access_request.requester_user_id
       AND requester.organization_id = request_scope.organization_id
      ORDER BY access_request.created_at DESC, access_request.id DESC`)
      .all(scope.organizationId, scope.user.id)
    return { items: rows.map(publicRequest) }
  }

  async function listRequesterRequests({ authContext } = {}) {
    const scope = requireAuthScope(database, authContext)
    await requireAuthorized(authorize, 'privacy.requests.read_scoped', scope, workspaceResource(scope.workspace))
    const rows = database.prepare(`SELECT access_request.*, owner.display_name AS owner_display_name,
        request_scope.owner_user_id
      FROM privacy_access_requests AS access_request
      JOIN privacy_access_request_scopes AS request_scope
        ON request_scope.request_id = access_request.id
       AND request_scope.organization_id = ?
      JOIN users AS owner
        ON owner.id = request_scope.owner_user_id AND owner.organization_id = request_scope.organization_id
      WHERE access_request.requester_user_id = ?
      ORDER BY access_request.created_at DESC, access_request.id DESC`)
      .all(scope.organizationId, scope.user.id)
      .filter((row) => ownerWithinWorkspace(database, scope, row.owner_user_id))
    return { items: rows.map((row) => ({ ...publicRequest(row), ownerDisplayName: row.owner_display_name })) }
  }

  async function resolveAccessRequest({ authContext, requestId, decision } = {}) {
    const scope = requireAuthScope(database, authContext)
    const normalizedDecision = decision === 'approved' || decision === 'denied' ? decision : null
    if (!normalizedDecision) throw domainError('VALIDATION_FAILED', 'decision 必须为 approved 或 denied')
    const request = database.prepare(`SELECT access_request.*, request_scope.owner_user_id
      FROM privacy_access_requests AS access_request
      JOIN privacy_access_request_scopes AS request_scope ON request_scope.request_id = access_request.id
      WHERE access_request.id = ? AND request_scope.organization_id = ? AND request_scope.owner_user_id = ?`)
      .get(requiredText(requestId, 'requestId'), scope.organizationId, scope.user.id)
    if (!request) throw domainError('RESOURCE_NOT_FOUND', '访问申请不存在')
    await requireAuthorized(authorize, 'privacy.request.resolve_self', scope, {
      organizationId: scope.organizationId,
      ownerUserId: scope.user.id,
      conversationId: request.conversation_id,
    })
    if (request.status !== 'pending') throw domainError('STATE_CONFLICT', '访问申请已经处理')
    const current = normalizeDate(now())
    if (request.expires_at && Date.parse(request.expires_at) <= current.getTime()) {
      const autoApproved = autoApproveExpiredRequests(database, {
        organizationId: scope.organizationId,
        ownerUserId: scope.user.id,
        conversationId: request.conversation_id,
        requesterUserId: request.requester_user_id,
        current,
        grantTtlSeconds,
        idFactory,
      })
      if (autoApproved.length > 0) {
        await audit({
          eventType: 'privacy.access.timeout_approved',
          resourceType: 'privacy_access_request',
          resourceId: request.id,
          actorId: scope.user.id,
          workspaceId: scope.workspace.id,
          details: { conversationId: request.conversation_id },
        })
      }
      throw domainError('STATE_CONFLICT', '访问申请已按超时规则自动同意')
    }
    const currentIso = current.toISOString()
    database.exec('BEGIN IMMEDIATE')
    try {
      const updated = database.prepare(`UPDATE privacy_access_requests
        SET status = ?, resolved_by_user_id = ?, resolved_at = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND organization_id = ? AND status = 'pending'`)
        .run(normalizedDecision, scope.user.id, currentIso, currentIso, request.id, scope.organizationId)
      if (updated.changes !== 1) throw domainError('STATE_CONFLICT', '访问申请已经处理')
      database.prepare(`INSERT INTO privacy_access_decisions
        (request_id, organization_id, owner_user_id, conversation_id, decided_by_user_id,
          decision, decision_source, decided_at, created_at, updated_at, version)
        VALUES (?, ?, ?, ?, ?, ?, 'student', ?, ?, ?, 1)`)
        .run(request.id, scope.organizationId, scope.user.id, request.conversation_id,
          scope.user.id, normalizedDecision, currentIso, currentIso, currentIso)
      if (normalizedDecision === 'approved') {
        insertGrant(database, {
          id: idFactory(),
          request,
          organizationId: scope.organizationId,
          ownerUserId: scope.user.id,
          source: 'student_approved',
          current,
          grantTtlSeconds,
        })
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    await audit({
      eventType: `privacy.access.${normalizedDecision}`,
      resourceType: 'privacy_access_request',
      resourceId: request.id,
      actorId: scope.user.id,
      workspaceId: scope.workspace.id,
      details: { conversationId: request.conversation_id },
    })
    return { id: request.id, status: normalizedDecision, resolvedAt: currentIso }
  }

  async function viewConversation({ authContext, conversationId, purpose } = {}) {
    const scope = requireAuthScope(database, authContext)
    const target = requireConversationTarget(database, scope, requiredText(conversationId, 'conversationId'))
    const normalizedPurpose = requiredText(purpose, 'purpose', 4)
    await requireAuthorized(authorize, 'privacy.conversation.view', scope, target)
    if (target.privacyMode !== 'private') throw domainError('STATE_CONFLICT', '该入口只处理私密会话')
    const current = normalizeDate(now())
    const currentIso = current.toISOString()
    const activeReview = findActiveSafetyReview(database, target)
    let accessMode
    let requestId = null
    let messages
    let studentVisible
    if (activeReview) {
      const implicated = database.prepare(`SELECT 1
        FROM safety_implicated_candidates AS candidate
        WHERE candidate.review_task_id = ? AND candidate.candidate_user_id = ?
          AND candidate.excluded_from_notification = 1 LIMIT 1`)
        .get(activeReview.id, scope.user.id)
      if (implicated) throw domainError('IMPLICATED_VIEWER_EXCLUDED', '涉事人员不能查看该安全会话')
      accessMode = 'safety_minimum_context'
      studentVisible = 0
      messages = safetyEvidenceMessages(database, target, activeReview)
    } else {
      const autoApproved = autoApproveExpiredRequests(database, {
        organizationId: scope.organizationId,
        ownerUserId: target.ownerUserId,
        conversationId: target.conversationId,
        requesterUserId: scope.user.id,
        current,
        grantTtlSeconds,
        idFactory,
      })
      if (autoApproved.length > 0) {
        await audit({
          eventType: 'privacy.access.timeout_approved',
          resourceType: 'ai_conversation',
          resourceId: target.conversationId,
          actorId: scope.user.id,
          workspaceId: scope.workspace.id,
          details: { requestIds: autoApproved },
        })
      }
      const grant = database.prepare(`SELECT * FROM privacy_access_grants
        WHERE organization_id = ? AND owner_user_id = ? AND conversation_id = ?
          AND requester_user_id = ? AND expires_at > ?
        ORDER BY granted_at DESC, id DESC LIMIT 1`)
        .get(scope.organizationId, target.ownerUserId, target.conversationId, scope.user.id, currentIso)
      if (!grant) throw domainError('PRIVACY_CONSENT_REQUIRED', '普通私密会话必须先获得学生授权')
      accessMode = grant.grant_source
      requestId = grant.request_id
      studentVisible = 1
      messages = conversationMessages(database, target)
    }
    const watermark = `${scope.user.display_name}（${scope.user.id}） · ${currentIso}`
    database.prepare(`INSERT INTO privacy_access_history
      (id, organization_id, owner_user_id, conversation_id, viewer_user_id, request_id,
        access_mode, purpose, watermark, context_message_count, student_visible,
        accessed_at, created_at, updated_at, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(idFactory(), scope.organizationId, target.ownerUserId, target.conversationId,
        scope.user.id, requestId, accessMode, normalizedPurpose, watermark, messages.length,
        studentVisible, currentIso, currentIso, currentIso)
    await audit({
      eventType: 'privacy.conversation.viewed',
      resourceType: 'ai_conversation',
      resourceId: target.conversationId,
      actorId: scope.user.id,
      workspaceId: scope.workspace.id,
      details: { accessMode, purpose: normalizedPurpose, contextMessageCount: messages.length },
    })
    return {
      conversationId: target.conversationId,
      title: target.title,
      accessMode,
      purpose: normalizedPurpose,
      watermark,
      messages,
    }
  }

  async function listOwnerAccessHistory({ authContext } = {}) {
    const scope = requireAuthScope(database, authContext)
    await requireAuthorized(authorize, 'privacy.history.read_self', scope, {
      organizationId: scope.organizationId,
      ownerUserId: scope.user.id,
    })
    const rows = database.prepare(`SELECT history.*, viewer.display_name AS viewer_display_name
      FROM privacy_access_history AS history
      JOIN users AS viewer ON viewer.id = history.viewer_user_id AND viewer.organization_id = history.organization_id
      WHERE history.organization_id = ? AND history.owner_user_id = ? AND history.student_visible = 1
      ORDER BY history.accessed_at DESC, history.id DESC`)
      .all(scope.organizationId, scope.user.id)
      .filter((row) => ownerWithinWorkspace(database, scope, row.owner_user_id))
    return { items: rows.map(publicHistory) }
  }

  async function listScopedAccessHistory({ authContext } = {}) {
    const scope = requireAuthScope(database, authContext)
    await requireAuthorized(authorize, 'privacy.history.read_scoped', scope, workspaceResource(scope.workspace))
    const rows = database.prepare(`SELECT history.*, viewer.display_name AS viewer_display_name,
        owner.display_name AS owner_display_name
      FROM privacy_access_history AS history
      JOIN users AS viewer ON viewer.id = history.viewer_user_id AND viewer.organization_id = history.organization_id
      JOIN users AS owner ON owner.id = history.owner_user_id AND owner.organization_id = history.organization_id
      WHERE history.organization_id = ? AND history.viewer_user_id = ?
      ORDER BY history.accessed_at DESC, history.id DESC`)
      .all(scope.organizationId, scope.user.id)
    return { items: rows.map((row) => ({ ...publicHistory(row), ownerDisplayName: row.owner_display_name })) }
  }

  return {
    createAccessRequest,
    listOwnerRequests,
    listRequesterRequests,
    resolveAccessRequest,
    viewConversation,
    listOwnerAccessHistory,
    listScopedAccessHistory,
  }
}

function autoApproveExpiredRequests(database, options) {
  const currentIso = options.current.toISOString()
  const clauses = [`request_scope.organization_id = ?`, `access_request.status = 'pending'`,
    `access_request.expires_at IS NOT NULL`, `access_request.expires_at <= ?`]
  const values = [options.organizationId, currentIso]
  if (options.ownerUserId) {
    clauses.push('request_scope.owner_user_id = ?')
    values.push(options.ownerUserId)
  }
  if (options.conversationId) {
    clauses.push('request_scope.conversation_id = ?')
    values.push(options.conversationId)
  }
  if (options.requesterUserId) {
    clauses.push('access_request.requester_user_id = ?')
    values.push(options.requesterUserId)
  }
  const rows = database.prepare(`SELECT access_request.*, request_scope.owner_user_id
    FROM privacy_access_requests AS access_request
    JOIN privacy_access_request_scopes AS request_scope ON request_scope.request_id = access_request.id
    WHERE ${clauses.join(' AND ')}
    ORDER BY access_request.created_at, access_request.id`).all(...values)
  const approved = []
  for (const request of rows) {
    database.exec('BEGIN IMMEDIATE')
    try {
      const updated = database.prepare(`UPDATE privacy_access_requests
        SET status = 'approved', resolved_by_user_id = ?, resolved_at = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND organization_id = ? AND status = 'pending'`)
        .run(request.owner_user_id, currentIso, currentIso, request.id, options.organizationId)
      if (updated.changes === 1) {
        database.prepare(`INSERT INTO privacy_access_decisions
          (request_id, organization_id, owner_user_id, conversation_id, decided_by_user_id,
            decision, decision_source, decided_at, created_at, updated_at, version)
          VALUES (?, ?, ?, ?, ?, 'approved', 'timeout_auto_approved', ?, ?, ?, 1)`)
          .run(request.id, options.organizationId, request.owner_user_id, request.conversation_id,
            request.owner_user_id, currentIso, currentIso, currentIso)
        insertGrant(database, {
          id: options.idFactory(),
          request,
          organizationId: options.organizationId,
          ownerUserId: request.owner_user_id,
          source: 'timeout_auto_approved',
          current: options.current,
          grantTtlSeconds: options.grantTtlSeconds,
        })
        approved.push(request.id)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  return approved
}

function insertGrant(database, options) {
  const grantedAt = options.current.toISOString()
  const expiresAt = new Date(options.current.getTime() + options.grantTtlSeconds * 1000).toISOString()
  database.prepare(`INSERT INTO privacy_access_grants
    (id, request_id, organization_id, owner_user_id, conversation_id, requester_user_id,
      grant_source, granted_at, expires_at, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
    .run(options.id, options.request.id, options.organizationId, options.ownerUserId,
      options.request.conversation_id, options.request.requester_user_id, options.source,
      grantedAt, expiresAt, grantedAt, grantedAt)
}

function requireAuthScope(database, authContext) {
  const organizationId = requiredText(authContext?.organizationId, 'authContext.organizationId')
  const userId = requiredText(authContext?.userId, 'authContext.userId')
  const workspaceId = requiredText(authContext?.workspaceId, 'authContext.workspaceId')
  const user = database.prepare(`SELECT id, organization_id, display_name FROM users
    WHERE id = ? AND organization_id = ? AND status = 'active'`).get(userId, organizationId)
  const workspace = database.prepare(`SELECT * FROM workspaces
    WHERE id = ? AND organization_id = ? AND status = 'active'`).get(workspaceId, organizationId)
  if (!user || !workspace) throw domainError('RESOURCE_NOT_FOUND', '当前身份或工作空间不存在')
  return { organizationId, user, workspace, authContext: { organizationId, userId, workspaceId } }
}

function requireConversationTarget(database, scope, conversationId) {
  const conversation = database.prepare(`SELECT conversation.*, owner.display_name AS owner_display_name
    FROM ai_conversations AS conversation
    JOIN users AS owner
      ON owner.id = conversation.owner_user_id
     AND owner.organization_id = conversation.organization_id
     AND owner.status = 'active'
    WHERE conversation.id = ? AND conversation.organization_id = ?`)
    .get(conversationId, scope.organizationId)
  if (!conversation || !ownerWithinWorkspace(database, scope, conversation.owner_user_id)) {
    throw domainError('RESOURCE_NOT_FOUND', '会话不存在于当前工作空间范围')
  }
  return {
    organizationId: scope.organizationId,
    conversationId: conversation.id,
    ownerUserId: conversation.owner_user_id,
    ownerDisplayName: conversation.owner_display_name,
    privacyMode: conversation.privacy_mode,
    title: conversation.title,
  }
}

function ownerWithinWorkspace(database, scope, ownerUserId) {
  if (scope.workspace.scope_type === 'own') return ownerUserId === scope.user.id
  if (scope.workspace.scope_type === 'platform') return false
  const clauses = [`membership.user_id = ?`, `membership.membership_role = 'student'`,
    `membership.status = 'active'`, `class.status = 'active'`, `class.organization_id = ?`]
  const values = [ownerUserId, scope.organizationId]
  if (scope.workspace.scope_type === 'class') {
    clauses.push('class.id = ?')
    values.push(scope.workspace.scope_id)
  } else if (scope.workspace.scope_type === 'grade') {
    clauses.push('class.grade_id = ?')
    values.push(scope.workspace.scope_id)
  } else if (scope.workspace.scope_type === 'school') {
    clauses.push('class.organization_id = ?')
    values.push(scope.organizationId)
  } else {
    return false
  }
  return Boolean(database.prepare(`SELECT 1
    FROM class_memberships AS membership
    JOIN classes AS class ON class.id = membership.class_id
    WHERE ${clauses.join(' AND ')} LIMIT 1`).get(...values))
}

function findActiveSafetyReview(database, target) {
  return database.prepare(`SELECT id, initial_message_id
    FROM safety_review_tasks
    WHERE organization_id = ? AND actor_id_at_creation = ? AND conversation_id = ?
      AND status <> 'false_positive_closed'
    ORDER BY created_at DESC, id DESC LIMIT 1`)
    .get(target.organizationId, target.ownerUserId, target.conversationId)
}

function safetyEvidenceMessages(database, target, review) {
  const rows = database.prepare(`SELECT message.id, message.role, message.content, message.created_at
    FROM safety_review_evidence AS evidence
    JOIN ai_messages AS message
      ON message.id = evidence.ai_message_id
     AND message.organization_id = evidence.organization_id
     AND message.actor_id_at_creation = evidence.owner_user_id
     AND message.conversation_id = evidence.conversation_id
    WHERE evidence.review_task_id = ? AND evidence.organization_id = ?
      AND evidence.owner_user_id = ? AND evidence.conversation_id = ?
    ORDER BY message.created_at, message.id`)
    .all(review.id, target.organizationId, target.ownerUserId, target.conversationId)
  if (rows.length > 0) return rows.map(publicMessage)
  const fallback = database.prepare(`SELECT id, role, content, created_at FROM ai_messages
    WHERE id = ? AND organization_id = ? AND actor_id_at_creation = ? AND conversation_id = ?`)
    .get(review.initial_message_id, target.organizationId, target.ownerUserId, target.conversationId)
  return fallback ? [publicMessage(fallback)] : []
}

function conversationMessages(database, target) {
  return database.prepare(`SELECT id, role, content, created_at FROM ai_messages
    WHERE organization_id = ? AND actor_id_at_creation = ? AND conversation_id = ?
    ORDER BY created_at, id`)
    .all(target.organizationId, target.ownerUserId, target.conversationId).map(publicMessage)
}

function publicMessage(row) {
  return { id: row.id, role: row.role, content: row.content, createdAt: row.created_at }
}

function publicRequest(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    requesterUserId: row.requester_user_id,
    requesterDisplayName: row.requester_display_name,
    status: row.status,
    purpose: row.purpose,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  }
}

function publicHistory(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    viewerUserId: row.viewer_user_id,
    viewerDisplayName: row.viewer_display_name,
    accessMode: row.access_mode,
    purpose: row.purpose,
    watermark: row.watermark,
    contextMessageCount: row.context_message_count,
    accessedAt: row.accessed_at,
  }
}

async function requireAuthorized(authorize, action, scope, resource) {
  const allowed = await authorize({
    authContext: scope.authContext,
    actor: scope.user,
    workspace: scope.workspace,
    action,
    resource,
  })
  if (!allowed) throw domainError('PERMISSION_DENIED', '当前工作空间无权执行此操作')
}

function workspaceResource(workspace) {
  return {
    organizationId: workspace.organization_id,
    workspaceId: workspace.id,
    scopeType: workspace.scope_type,
    scopeId: workspace.scope_id,
  }
}

function positiveSeconds(value, fallback, name) {
  const result = value === undefined || value === null ? fallback : value
  if (!Number.isInteger(result) || result < 1) throw new TypeError(`${name} 必须是正整数秒数`)
  return result
}

function requireDatabase(database) {
  if (!database || typeof database.prepare !== 'function') throw new TypeError('db 必须是 node:sqlite 数据库')
  return database
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new TypeError('时间必须有效')
  return date
}

function requiredText(value, name, minimum = 1) {
  if (typeof value !== 'string' || value.trim().length < minimum) {
    throw domainError('VALIDATION_FAILED', `${name} 不能为空`)
  }
  return value.trim()
}

function domainError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}
