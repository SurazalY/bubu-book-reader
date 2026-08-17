function parseJson(value, fallback) {
  if (typeof value !== 'string' || !value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function publicAsset(row) {
  if (!row) return null
  return {
    id: row.id ?? null,
    kind: row.asset_type,
    url: `/api/v1/books/assets/${encodeURIComponent(row.id)}`,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
  }
}

export function projectBooks(database, actorId, workspaceId, rows) {
  const progressStatement = database.prepare(`
    SELECT progress.last_page_no, progress.updated_from_event_at, version.page_count,
      daily.effective_reading_ms
    FROM reading_progress AS progress
    JOIN book_versions AS version ON version.id = progress.book_version_id
    LEFT JOIN (
      SELECT actor_id_at_creation, workspace_id_at_creation, book_version_id,
        SUM(effective_reading_ms) AS effective_reading_ms
      FROM reading_daily_book_summaries
      WHERE actor_id_at_creation = ? AND workspace_id_at_creation = ? AND book_version_id = ?
      GROUP BY actor_id_at_creation, workspace_id_at_creation, book_version_id
    ) AS daily
      ON daily.actor_id_at_creation = progress.actor_id
     AND daily.workspace_id_at_creation = progress.workspace_id
     AND daily.book_version_id = progress.book_version_id
    WHERE progress.actor_id = ? AND progress.workspace_id = ? AND progress.book_version_id = ?
  `)
  const classroomStatement = database.prepare(`
    SELECT session.*, participant.last_seen_at, participant.last_broadcast_id
    FROM class_sessions AS session
    JOIN assignment_classes AS assignment_class ON assignment_class.assignment_id = session.assignment_id
    JOIN class_memberships AS membership
      ON membership.class_id = assignment_class.class_id
      AND membership.user_id = ?
      AND membership.status = 'active'
    JOIN classes AS class
      ON class.id = membership.class_id
      AND class.status = 'active'
    JOIN workspaces AS workspace
      ON workspace.id = ?
      AND workspace.organization_id = class.organization_id
      AND workspace.scope_type = 'class'
      AND workspace.scope_id = class.id
      AND workspace.status = 'active'
    LEFT JOIN class_session_participants AS participant
      ON participant.class_session_id = session.id AND participant.actor_id = ?
    WHERE session.workspace_id_at_creation = ?
      AND session.locked_book_version_id = ?
      AND session.status = 'active'
    ORDER BY session.created_at DESC, session.id DESC
    LIMIT 1
  `)
  const broadcastStatement = database.prepare(`
    SELECT * FROM class_broadcasts
    WHERE class_session_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `)
  return rows.map((row) => {
    const progress = progressStatement.get(
      actorId, workspaceId, row.book_version_id,
      actorId, workspaceId, row.book_version_id,
    )
    const classroom = classroomStatement.get(actorId, workspaceId, actorId, workspaceId, row.book_version_id)
    const latestBroadcast = classroom ? broadcastStatement.get(classroom.id) : null
    const classroomMessage = parseJson(latestBroadcast?.message_json, {})
    const totalPages = row.page_count
    const currentPage = progress?.last_page_no ?? null
    const projectedProgress = {
      currentPage,
      totalPages,
      bookmarks: [],
      ...(progress?.effective_reading_ms === null || progress?.effective_reading_ms === undefined
        ? {}
        : { effectiveMinutes: Math.floor(Number(progress.effective_reading_ms) / 60_000) }),
    }
    return {
      id: row.id,
      versionId: row.book_version_id,
      title: row.title,
      grade: row.grade ?? null,
      author: row.author ?? null,
      illustrator: row.illustrator ?? null,
      sourcePage: row.source_page ?? null,
      usageLabel: row.catalog_usage_label ?? row.cover?.usage_label ?? null,
      cover: publicAsset(row.cover),
      assets: (row.assets || []).map(publicAsset),
      progress: projectedProgress,
      access: { readable: true },
      lists: [],
      classReading: classroom ? {
        id: classroom.id,
        mode: classroom.mode,
        tone: classroom.mode === 'sync' ? 'violet' : 'blue',
        connected: classroom.last_seen_at ? Date.parse(classroom.last_seen_at) >= Date.now() - 45_000 : null,
        teacher: classroom.teacher_display_name || classroom.actor_id_at_creation,
        page: classroom.synced_page_no,
        label: classroom.mode === 'sync' ? '课堂同步页面' : '课堂锁定书籍',
        desc: classroom.mode === 'sync' ? '当前跟随教师页面，仍可查看老师的选文与课堂提问。' : '必须留在这本书中，页码仍可自由控制。',
        broadcast: latestBroadcast ? {
          id: latestBroadcast.id,
          sourceRequestId: latestBroadcast.source_request_id,
          teacher: classroom.teacher_display_name || classroom.actor_id_at_creation,
          message: classroomMessage,
          createdAt: latestBroadcast.created_at,
          received: classroom.last_broadcast_id === latestBroadcast.id,
        } : null,
        teacherMarks: Array.isArray(classroomMessage.teacherMarks) ? classroomMessage.teacherMarks : [],
      } : null,
    }
  })
}

export function projectBookPage(database, page, { readRangeVersion } = {}) {
  const illustration = database.prepare(`
    SELECT id, asset_type, storage_key, mime_type, size_bytes, sha256
    FROM book_assets
    WHERE page_id = ? AND asset_type = 'page_image'
    ORDER BY created_at, id
    LIMIT 1
  `).get(page.id)
  return {
    id: page.id,
    pageNo: page.page_no,
    printedPageLabel: page.printed_page_label,
    bookVersionId: page.book_version_id,
    text: page.normalized_text,
    rawText: page.raw_text,
    width: page.width,
    height: page.height,
    readRangeVersion,
    pageImage: publicAsset(illustration),
    blocks: page.blocks.map((block) => ({
      id: block.id,
      blockId: block.id,
      kind: 'paragraph',
      text: block.normalized_text,
      rawText: block.raw_text,
      charStart: block.char_start,
      charEnd: block.char_end,
      coordinates: { x: block.x, y: block.y, width: block.width, height: block.height },
    })),
  }
}

export function projectReadingProgress(database, actorId, workspaceId, organizationId) {
  const items = database.prepare(`
    WITH daily AS (
      SELECT book_version_id, SUM(effective_reading_ms) AS effective_reading_ms,
        MAX(updated_at) AS daily_updated_at
      FROM reading_daily_book_summaries
      WHERE organization_id_at_creation = ? AND actor_id_at_creation = ?
        AND workspace_id_at_creation = ?
      GROUP BY book_version_id
    )
    SELECT version.id AS book_version_id, version.book_id, version.page_count, book.title,
      progress.last_page_no, progress.updated_at AS progress_updated_at,
      daily.effective_reading_ms, daily.daily_updated_at
    FROM book_versions AS version
    JOIN books AS book ON book.id = version.book_id
    LEFT JOIN reading_progress AS progress
      ON progress.book_version_id = version.id
     AND progress.actor_id = ? AND progress.workspace_id = ?
    LEFT JOIN daily ON daily.book_version_id = version.id
    WHERE version.organization_id_at_creation = ? AND book.organization_id_at_creation = ?
      AND (progress.id IS NOT NULL OR daily.book_version_id IS NOT NULL)
    ORDER BY COALESCE(daily.daily_updated_at, progress.updated_at) DESC, version.id
  `).all(
    organizationId, actorId, workspaceId,
    actorId, workspaceId,
    organizationId, organizationId,
  ).map((row) => ({
    bookId: row.book_id,
    bookVersionId: row.book_version_id,
    title: row.title,
    currentPage: row.last_page_no ?? null,
    totalPages: row.page_count,
    ...(row.effective_reading_ms === null
      ? {}
      : { effectiveMinutes: Math.floor(Number(row.effective_reading_ms) / 60_000) }),
    updatedAt: row.daily_updated_at ?? row.progress_updated_at,
  }))
  const measuredItems = items.filter((item) => Object.hasOwn(item, 'effectiveMinutes'))
  return {
    items,
    ...(measuredItems.length
      ? { totalEffectiveMinutes: measuredItems.reduce((total, item) => total + item.effectiveMinutes, 0) }
      : {}),
  }
}

export function projectConversations(database, organizationId, ownerUserId) {
  const conversations = database.prepare(`
    SELECT * FROM ai_conversations
    WHERE organization_id = ? AND owner_user_id = ?
    ORDER BY updated_at DESC, id DESC
  `).all(organizationId, ownerUserId)
  const messageStatement = database.prepare(`
    SELECT * FROM ai_messages
    WHERE organization_id = ? AND actor_id_at_creation = ? AND conversation_id = ?
    ORDER BY created_at, id
  `)
  const evidenceStatement = database.prepare(`
    SELECT evidence.*, COALESCE(evidence.page_number, page.page_no) AS page_no,
      block.text_content AS evidence_text
    FROM ai_message_evidence AS evidence
    LEFT JOIN book_pages AS page ON page.id = evidence.page_id
    LEFT JOIN book_blocks AS block
      ON block.id = evidence.evidence_id
     AND block.page_id = evidence.page_id
    WHERE evidence.ai_message_id = ? AND evidence.citation_verified = 1
    ORDER BY evidence.created_at, evidence.id
  `)
  const items = conversations.map((conversation) => ({
    id: conversation.id,
    conversationId: conversation.id,
    title: conversation.title,
    private: conversation.privacy_mode === 'private',
    bookVersionId: conversation.book_version_id,
    messages: messageStatement.all(organizationId, ownerUserId, conversation.id).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.created_at,
      refs: evidenceStatement.all(message.id).map((evidence) => ({
        id: evidence.evidence_id,
        pageNo: evidence.page_no,
        text: evidence.evidence_text,
        coordinates: parseJson(evidence.coordinates_json, null),
      })),
    })),
  }))
  const usage = database.prepare(`
    SELECT COALESCE(SUM(CASE WHEN reservation_state = 'settled' THEN 1 ELSE 0 END), 0) AS used
    FROM ai_usage_ledger
    WHERE organization_id = ? AND user_id = ?
  `).get(organizationId, ownerUserId)
  const dailyLimit = 20
  return {
    items,
    activeConversationId: items[0]?.id ?? null,
    quota: {
      remaining: Math.max(0, dailyLimit - Number(usage.used || 0)),
      usagePercent: Math.min(100, Math.round((Number(usage.used || 0) / dailyLimit) * 100)),
      resetAt: null,
    },
  }
}

export function projectCommunityPosts(database, { organizationId, workspace, actorId, scope = 'all', canReviewClass = false, canReviewSchool = false }) {
  const classId = workspace.scopeType === 'class' ? workspace.scopeId : null
  const includeOwn = scope === 'all'
  const classReviewClause = canReviewClass && classId
    ? " OR (post.status = 'submitted' AND post.class_id_at_creation = ?)"
    : ''
  const schoolReviewClause = canReviewSchool
    ? " OR (post.scope = 'school' AND post.status = 'class_approved')"
    : ''
  const parameters = [organizationId, classId, classId]
  if (includeOwn) parameters.push(actorId, workspace.id)
  if (canReviewClass && classId) parameters.push(classId)
  const rows = database.prepare(`
    SELECT post.*, user.display_name AS author_name
    FROM community_posts AS post
    JOIN users AS user ON user.id = post.author_id AND user.organization_id = post.organization_id_at_creation
    WHERE post.organization_id_at_creation = ?
      AND (
        (post.status = 'approved' AND (post.scope = 'school' OR (? IS NOT NULL AND post.scope = 'class' AND post.class_id_at_creation = ?)))
        ${includeOwn ? 'OR (post.author_id = ? AND post.workspace_id_at_creation = ?)' : ''}
        ${classReviewClause}
        ${schoolReviewClause}
      )
    ORDER BY post.created_at DESC, post.id DESC
  `).all(...parameters)
  const reactions = database.prepare(`
    SELECT reaction_type, COUNT(*) AS count
    FROM post_reactions WHERE post_id = ? GROUP BY reaction_type
  `)
  const viewerReactions = database.prepare('SELECT reaction_type FROM post_reactions WHERE post_id = ? AND actor_id = ?')
  const reviews = database.prepare(`
    SELECT review_stage AS stage, decision, reason, reviewer_id AS reviewerId,
      workspace_id_at_review AS workspaceId, class_id_at_review AS classId, created_at AS createdAt
    FROM post_reviews WHERE post_id = ? ORDER BY created_at, id
  `)
  return rows
    .filter((row) => scope === 'all' || (scope === 'pending'
      ? (canReviewClass && row.status === 'submitted' && row.class_id_at_creation === classId) || (canReviewSchool && row.scope === 'school' && row.status === 'class_approved')
      : row.scope === scope))
    .map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      status: row.status,
      scope: row.scope,
      classId: row.class_id_at_creation,
      workspaceId: row.workspace_id_at_creation,
      quote: row.quote_book_id ? { bookId: row.quote_book_id, page: row.quote_page, text: row.quote_text } : null,
      aiAssisted: Boolean(row.ai_assisted),
      author: { id: row.author_id, displayName: row.author_name },
      reactions: reactions.all(row.id).map((reaction) => ({ type: reaction.reaction_type, count: reaction.count })),
      viewerReactionTypes: viewerReactions.all(row.id, actorId).map((reaction) => reaction.reaction_type),
      reviews: reviews.all(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
}

export function projectAssignments(database, organizationId, workspaceId) {
  const rows = database.prepare(`
    SELECT assignment.*, book.title AS book_title,
      GROUP_CONCAT(class.id) AS class_ids, GROUP_CONCAT(class.name) AS class_names
    FROM reading_assignments AS assignment
    JOIN book_versions AS version ON version.id = assignment.book_version_id
    JOIN books AS book ON book.id = version.book_id
    LEFT JOIN assignment_classes AS link ON link.assignment_id = assignment.id
    LEFT JOIN classes AS class ON class.id = link.class_id AND class.organization_id = assignment.organization_id_at_creation
    WHERE assignment.organization_id_at_creation = ? AND assignment.workspace_id_at_creation = ?
    GROUP BY assignment.id
    ORDER BY assignment.created_at DESC
  `).all(organizationId, workspaceId)
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    book: { id: row.book_version_id, title: row.book_title },
    class: { id: row.class_ids?.split(',')[0] ?? null, name: row.class_names?.split(',')[0] ?? null },
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.ends_at && Date.parse(row.ends_at) < Date.now() ? 'ended' : 'scheduled',
  }))
}

export function projectUsageSummary(database, organizationId, workspaceId) {
  const classCount = database.prepare(`
    SELECT COUNT(DISTINCT class_id) AS count FROM assignment_classes
    JOIN reading_assignments ON reading_assignments.id = assignment_classes.assignment_id
    WHERE reading_assignments.organization_id_at_creation = ? AND reading_assignments.workspace_id_at_creation = ?
  `).get(organizationId, workspaceId).count
  const reading = database.prepare(`
    SELECT COUNT(*) AS reading_count, COUNT(DISTINCT actor_id_at_creation) AS active_readers
    FROM reading_daily_book_summaries
    WHERE organization_id_at_creation = ? AND workspace_id_at_creation = ?
      AND effective_reading_ms > 0
  `).get(organizationId, workspaceId)
  const pendingSafetyCount = database.prepare(`
    SELECT COUNT(*) AS count
    FROM safety_events
    WHERE organization_id = ? AND status NOT IN ('closed', 'false_positive_closed')
  `).get(organizationId).count
  return {
    metrics: {
      classCount,
      effectiveReadingCount: reading.reading_count,
      activeReaders: reading.active_readers,
      pendingSafetyCount,
    },
    series: {},
  }
}

export function projectSafetyEvents(database, organizationId) {
  return database.prepare(`
    SELECT COALESCE(event.id, task.id) AS id, task.id AS review_task_id,
      COALESCE(event.status, task.status) AS status, event.risk_level,
      event.summary_for_staff, task.created_at, task.updated_at
    FROM safety_review_tasks AS task
    LEFT JOIN safety_events AS event ON event.review_task_id = task.id
    WHERE task.organization_id = ?
    ORDER BY task.created_at DESC, task.id DESC
  `).all(organizationId).map((row) => ({
    id: row.id,
    reviewTaskId: row.review_task_id,
    status: row.status,
    riskLevel: row.risk_level,
    summaryForStaff: row.summary_for_staff,
    pendingCount: 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export function projectSafetyDetail(database, organizationId, eventOrTaskId) {
  const row = database.prepare(`
    SELECT task.*, event.id AS event_id, event.status AS event_status, event.reason_code AS event_reason_code,
      event.risk_level, event.summary_for_staff, event.notification_chain_json,
      event.accepted_by_user_id, event.accepted_at, event.closure_outcome,
      event.resolution_note, event.closed_by_user_id, event.closed_at,
      owner.display_name AS student_name, closer.display_name AS closed_by_name,
      (
        SELECT class.id
        FROM class_memberships AS membership
        JOIN classes AS class ON class.id = membership.class_id AND class.organization_id = task.organization_id
        WHERE membership.user_id = task.actor_id_at_creation AND membership.status = 'active'
        ORDER BY membership.created_at, membership.id
        LIMIT 1
      ) AS class_id,
      (
        SELECT class.name
        FROM class_memberships AS membership
        JOIN classes AS class ON class.id = membership.class_id AND class.organization_id = task.organization_id
        WHERE membership.user_id = task.actor_id_at_creation AND membership.status = 'active'
        ORDER BY membership.created_at, membership.id
        LIMIT 1
      ) AS class_name,
      book.id AS book_id, book.title AS book_title
    FROM safety_review_tasks AS task
    JOIN users AS owner ON owner.id = task.actor_id_at_creation AND owner.organization_id = task.organization_id
    JOIN ai_conversations AS conversation
      ON conversation.id = task.conversation_id
     AND conversation.organization_id = task.organization_id
     AND conversation.owner_user_id = task.actor_id_at_creation
    LEFT JOIN book_versions AS version ON version.id = conversation.book_version_id
    LEFT JOIN books AS book
      ON book.id = version.book_id
     AND book.organization_id_at_creation = task.organization_id
    LEFT JOIN safety_events AS event ON event.review_task_id = task.id
    LEFT JOIN users AS closer ON closer.id = event.closed_by_user_id AND closer.organization_id = task.organization_id
    WHERE task.organization_id = ? AND (task.id = ? OR event.id = ?)
  `).get(organizationId, eventOrTaskId, eventOrTaskId)
  if (!row) return null
  const triggerReasons = parseJson(row.trigger_reasons_json, [])
  const source = triggerReasons.some((reason) => reason?.source === 'manual_demo_test') ? 'manual_demo_test' : null
  const policy = parseJson(row.policy_snapshot_json, {})
  const threshold = Number(policy.confidenceThreshold ?? 0.8)
  const evidence = database.prepare(`
    SELECT evidence.ai_message_id AS id, evidence.confidence, evidence.trigger,
      message.role, message.content, message.created_at
    FROM safety_review_evidence AS evidence
    JOIN ai_messages AS message ON message.id = evidence.ai_message_id
      AND message.organization_id = evidence.organization_id
      AND message.actor_id_at_creation = evidence.owner_user_id
      AND message.conversation_id = evidence.conversation_id
    WHERE evidence.review_task_id = ? AND evidence.organization_id = ?
      AND evidence.owner_user_id = ? AND evidence.conversation_id = ?
    ORDER BY evidence.created_at, evidence.ai_message_id
  `).all(row.id, organizationId, row.actor_id_at_creation, row.conversation_id)
  const implicated = database.prepare(`
    SELECT candidate.candidate_user_id AS id, user.display_name, candidate.reason
    FROM safety_implicated_candidates AS candidate
    LEFT JOIN users AS user ON user.id = candidate.candidate_user_id AND user.organization_id = ?
    WHERE candidate.review_task_id = ?
    ORDER BY candidate.created_at, candidate.id
  `).all(organizationId, row.id)
  const notificationRecipients = row.event_id ? database.prepare(`
    SELECT recipient.user_id, user.display_name, recipient.role_code, recipient.scope_type,
      recipient.scope_id, recipient.status, recipient.planned_at, recipient.dispatched_at,
      recipient.delivered_at, recipient.read_at
    FROM safety_notification_recipients AS recipient
    JOIN users AS user
      ON user.id = recipient.user_id
     AND user.organization_id = recipient.organization_id
    WHERE recipient.organization_id = ? AND recipient.safety_event_id = ?
    ORDER BY recipient.planned_at, recipient.id
  `).all(organizationId, row.event_id).map((recipient) => ({
    userId: recipient.user_id,
    displayName: recipient.display_name,
    role: recipient.role_code,
    scopeType: recipient.scope_type,
    scopeId: recipient.scope_id,
    deliveryStatus: recipient.status,
    state: recipient.status,
    plannedAt: recipient.planned_at,
    dispatchedAt: recipient.dispatched_at,
    deliveredAt: recipient.delivered_at,
    readAt: recipient.read_at,
    at: recipient.read_at ?? recipient.delivered_at ?? recipient.dispatched_at ?? recipient.planned_at,
  })) : []
  const dispatchedNotifications = notificationRecipients.filter((recipient) =>
    ['dispatched', 'delivered', 'read'].includes(recipient.deliveryStatus))
  const deliveredNotifications = notificationRecipients.filter((recipient) =>
    ['delivered', 'read'].includes(recipient.deliveryStatus))
  const timeline = row.event_id ? database.prepare(`
    SELECT audit.event_type, audit.actor_user_id, actor.display_name AS actor_name,
      audit.outcome, audit.reason_code, audit.created_at
    FROM audit_events AS audit
    LEFT JOIN users AS actor ON actor.id = audit.actor_user_id AND actor.organization_id = ?
    WHERE audit.resource_type = 'safety_event' AND audit.resource_id = ?
    ORDER BY audit.created_at, audit.id
  `).all(organizationId, row.event_id).map((item) => ({
    eventType: item.event_type,
    actorName: item.actor_name ?? item.actor_user_id,
    reason: item.reason_code,
    outcome: item.outcome,
    createdAt: item.created_at,
  })) : []
  return {
    id: row.event_id ?? row.id,
    eventId: row.event_id,
    reviewTaskId: row.id,
    conversationId: row.conversation_id,
    status: row.event_status ?? row.status,
    reviewStatus: row.status,
    riskLevel: row.risk_level,
    summaryForStaff: row.summary_for_staff,
    reviewResult: row.event_reason_code ?? row.reason_code,
    source,
    displayLabel: source === 'manual_demo_test' ? '演示测试事件' : null,
    threshold,
    qualifyingMessageCount: evidence.filter((item) => Number(item.confidence) >= threshold).length,
    requiredQualifiedMessages: Number(policy.requiredQualifiedMessages ?? 3),
    policy,
    student: { id: row.actor_id_at_creation, displayName: row.student_name },
    class: row.class_id ? { id: row.class_id, displayName: row.class_name } : null,
    book: row.book_id ? { id: row.book_id, title: row.book_title } : null,
    hiddenBefore: 0,
    hiddenAfter: 0,
    evidenceMessages: evidence.map((item) => ({
      id: item.id,
      role: item.role,
      content: item.content,
      createdAt: item.created_at,
      confidence: item.confidence,
      trigger: item.trigger,
    })),
    implicatedCandidates: implicated,
    notificationTargets: notificationRecipients,
    dispatchedNotifications,
    deliveredNotifications,
    notified: dispatchedNotifications,
    chain: notificationRecipients,
    acceptedByUserId: row.accepted_by_user_id,
    acceptedAt: row.accepted_at,
    closedByUserId: row.closed_by_user_id,
    closedAt: row.closed_at,
    result: row.closed_at ? {
      tone: row.closure_outcome === 'false_positive_closed' ? 'muted' : 'success',
      label: row.closure_outcome === 'false_positive_closed' ? '误报已关闭' : '事件已关闭',
      summary: row.resolution_note,
      actor: { id: row.closed_by_user_id, displayName: row.closed_by_name },
    } : null,
    timeline,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
