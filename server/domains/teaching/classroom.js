import {
  all,
  assertPositiveInteger,
  assertString,
  createDomainContext,
  isoNow,
  one,
  run,
  transaction,
  uniqueRows,
} from '../reading/sql.js'
import { emit } from '../delivery/primitives.js'

export function createTeachingDomain(dependencies) {
  const context = createDomainContext(dependencies)
  const actorId = () => assertString(context.actor?.id, 'actor.id')
  const workspaceId = () => assertString(context.workspace?.id, 'workspace.id')
  const organizationId = () => assertString(context.workspace?.organizationId, 'workspace.organizationId')

  async function authorize(action, resource = {}) {
    const allowed = await context.authorize({ actor: context.actor, workspace: context.workspace, action, resource })
    if (!allowed) {
      const error = new Error('当前工作空间无权执行此操作')
      error.code = 'PERMISSION_DENIED'
      throw error
    }
  }

  async function requireControl(sessionId, deviceId) {
    const now = isoNow(context)
    const client = one(context.db, `SELECT c.* FROM class_session_clients c
      JOIN class_sessions s ON s.id = c.class_session_id
      WHERE c.class_session_id = :sessionId AND c.lease_expires_at > :now
        AND s.organization_id_at_creation = :organizationId AND s.workspace_id_at_creation = :workspaceId`, {
      sessionId, now, organizationId: organizationId(), workspaceId: workspaceId(),
    })
    if (!client || client.actor_id !== actorId() || client.device_id !== deviceId) {
      const error = new Error('当前设备不是该课堂的控制端')
      error.code = 'CLASSROOM_CONTROL_REQUIRED'
      throw error
    }
  }

  return {
    async createAssignment(input) {
      const classIds = Array.isArray(input.classIds) ? input.classIds.map((value) => assertString(value, 'classId')) : []
      if (classIds.length === 0) throw new TypeError('阅读安排至少覆盖一个班级')
      uniqueRows(classIds.map((id) => ({ id })), 'id')
      const bookVersionId = assertString(input.bookVersionId, 'bookVersionId')
      await authorize('assignment.manage', { bookVersionId, classIds })
      requireScopedBookVersion(context.db, bookVersionId, organizationId())
      const assignmentId = input.id || context.idFactory()
      const now = isoNow(context)
      transaction(context.db, () => {
        run(context.db, `INSERT INTO reading_assignments (id, organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation, book_version_id, title, starts_at, ends_at, created_at, updated_at, version)
          VALUES (:id, :organizationId, :actorId, :workspaceId, :bookVersionId, :title, :startsAt, :endsAt, :now, :now, 1)`, {
          id: assignmentId, organizationId: organizationId(), actorId: actorId(), workspaceId: workspaceId(),
          bookVersionId, title: assertString(input.title, 'title'),
          startsAt: input.startsAt || null, endsAt: input.endsAt || null, now,
        })
        for (const classId of classIds) {
          run(context.db, `INSERT INTO assignment_classes (id, assignment_id, class_id, created_at, updated_at, version)
            VALUES (:id, :assignmentId, :classId, :now, :now, 1)`, { id: context.idFactory(), assignmentId, classId, now })
        }
        emit(context.db, context.outbox, 'reading.assignment.created', {
          assignmentId,
          bookVersionId,
          classIds,
          workspaceId: workspaceId(),
        }, {
          aggregateType: 'reading_assignment',
          aggregateId: assignmentId,
          dedupeKey: `reading.assignment.created:${assignmentId}`,
          createdAt: now,
        })
        const auditResult = context.audit({
          eventType: 'reading.assignment.created',
          actorId: actorId(),
          workspaceId: workspaceId(),
          resourceType: 'reading_assignment',
          resourceId: assignmentId,
        })
        if (auditResult && typeof auditResult.then === 'function') {
          throw new TypeError('阅读安排事务中的 audit 必须是同步数据库操作')
        }
      })
      return { assignmentId, classIds }
    },

    async startClassSession(input) {
      await authorize('classroom.control', { assignmentId: input.assignmentId })
      const assignmentId = assertString(input.assignmentId, 'assignmentId')
      const assignment = one(context.db, `SELECT * FROM reading_assignments
        WHERE id = :assignmentId AND organization_id_at_creation = :organizationId
          AND workspace_id_at_creation = :workspaceId`, {
        assignmentId, organizationId: organizationId(), workspaceId: workspaceId(),
      })
      if (!assignment) throw resourceNotFound('阅读安排不存在于当前工作空间')
      const sessionId = input.id || context.idFactory()
      const now = isoNow(context)
      run(context.db, `INSERT INTO class_sessions (id, assignment_id, organization_id_at_creation, workspace_id_at_creation, actor_id_at_creation, locked_book_version_id, synced_page_no, status, mode, teacher_display_name, created_at, updated_at, version)
        VALUES (:id, :assignmentId, :organizationId, :workspaceId, :actorId, :bookVersionId, :pageNo, 'active', 'lock', :teacherDisplayName, :now, :now, 1)`, {
        id: sessionId, assignmentId, organizationId: organizationId(), workspaceId: workspaceId(), actorId: actorId(), bookVersionId: assignment.book_version_id,
        pageNo: input.pageNo ? assertPositiveInteger(input.pageNo, 'pageNo') : null,
        teacherDisplayName: context.actor?.displayName || context.actor?.display_name || actorId(), now,
      })
      return { sessionId, assignmentId, bookVersionId: assignment.book_version_id }
    },

    async claimControl(input) {
      await authorize('classroom.control', { classSessionId: input.classSessionId })
      const sessionId = assertString(input.classSessionId, 'classSessionId')
      const deviceId = assertString(input.deviceId, 'deviceId')
      const ttlSeconds = Number.isInteger(input.ttlSeconds) ? input.ttlSeconds : 90
      if (ttlSeconds < 15 || ttlSeconds > 300) throw new TypeError('ttlSeconds 必须在 15 到 300 秒之间')
      const nowDate = context.now()
      const now = nowDate.toISOString()
      const expiresAt = new Date(nowDate.getTime() + ttlSeconds * 1000).toISOString()
      const result = transaction(context.db, () => {
        const session = getScopedSession(context.db, sessionId, organizationId(), workspaceId(), true)
        if (!session) throw resourceNotFound('课堂不存在于当前工作空间或已结束')
        const current = one(context.db, `SELECT c.* FROM class_session_clients c
          JOIN class_sessions s ON s.id = c.class_session_id
          WHERE c.class_session_id = :sessionId AND s.organization_id_at_creation = :organizationId
            AND s.workspace_id_at_creation = :workspaceId`, {
          sessionId, organizationId: organizationId(), workspaceId: workspaceId(),
        })
        if (current && current.lease_expires_at > now && (current.actor_id !== actorId() || current.device_id !== deviceId)) {
          const error = new Error('课堂已由另一台设备控制')
          error.code = 'CLASSROOM_CONTROL_HELD'
          throw error
        }
        if (current) {
          run(context.db, `UPDATE class_session_clients SET actor_id = :actorId, device_id = :deviceId, lease_expires_at = :expiresAt,
            updated_at = :now, version = version + 1
            WHERE id = :id AND class_session_id = :sessionId
              AND EXISTS (SELECT 1 FROM class_sessions s WHERE s.id = class_session_clients.class_session_id
                AND s.organization_id_at_creation = :organizationId AND s.workspace_id_at_creation = :workspaceId)`, {
            id: current.id, sessionId, organizationId: organizationId(), workspaceId: workspaceId(),
            actorId: actorId(), deviceId, expiresAt, now,
          })
          return { clientId: current.id, expiresAt }
        }
        const clientId = context.idFactory()
        run(context.db, `INSERT INTO class_session_clients (id, class_session_id, actor_id, device_id, lease_expires_at, created_at, updated_at, version)
          VALUES (:id, :sessionId, :actorId, :deviceId, :expiresAt, :now, :now, 1)`, { id: clientId, sessionId, actorId: actorId(), deviceId, expiresAt, now })
        return { clientId, expiresAt }
      })
      await context.audit({ eventType: 'classroom.control.claimed', actorId: actorId(), workspaceId: workspaceId(), resourceId: sessionId })
      return result
    },

    async synchronizePage(input) {
      await authorize('classroom.control', { classSessionId: input.classSessionId })
      const sessionId = assertString(input.classSessionId, 'classSessionId')
      const deviceId = assertString(input.deviceId, 'deviceId')
      const pageNo = assertPositiveInteger(input.pageNo, 'pageNo')
      await requireControl(sessionId, deviceId)
      const now = isoNow(context)
      const result = run(context.db, `UPDATE class_sessions SET synced_page_no = :pageNo, mode = 'sync', updated_at = :now, version = version + 1
        WHERE id = :sessionId AND organization_id_at_creation = :organizationId
          AND workspace_id_at_creation = :workspaceId AND status = 'active'`, {
        sessionId, organizationId: organizationId(), workspaceId: workspaceId(), pageNo, now,
      })
      if (result.changes !== 1) throw resourceNotFound('课堂不存在于当前工作空间或已结束')
      await context.audit({ eventType: 'classroom.page.synced', actorId: actorId(), workspaceId: workspaceId(), resourceId: sessionId })
      return { pageNo }
    },

    async lockBook(input) {
      await authorize('classroom.control', { classSessionId: input.classSessionId })
      const sessionId = assertString(input.classSessionId, 'classSessionId')
      const deviceId = assertString(input.deviceId, 'deviceId')
      const bookVersionId = assertString(input.bookVersionId, 'bookVersionId')
      requireScopedBookVersion(context.db, bookVersionId, organizationId())
      await requireControl(sessionId, deviceId)
      const now = isoNow(context)
      const result = run(context.db, `UPDATE class_sessions SET locked_book_version_id = :bookVersionId, mode = 'lock', updated_at = :now, version = version + 1
        WHERE id = :sessionId AND organization_id_at_creation = :organizationId
          AND workspace_id_at_creation = :workspaceId AND status = 'active'`, {
        sessionId, organizationId: organizationId(), workspaceId: workspaceId(), bookVersionId, now,
      })
      if (result.changes !== 1) throw resourceNotFound('课堂不存在于当前工作空间或已结束')
      await context.audit({ eventType: 'classroom.book.locked', actorId: actorId(), workspaceId: workspaceId(), resourceId: sessionId })
      return { bookVersionId }
    },

    async endClassSession(input) {
      await authorize('classroom.control', { classSessionId: input.classSessionId })
      const sessionId = assertString(input.classSessionId, 'classSessionId')
      const deviceId = assertString(input.deviceId, 'deviceId')
      await requireControl(sessionId, deviceId)
      const now = isoNow(context)
      const result = run(context.db, `UPDATE class_sessions SET status = 'ended', ended_at = :now, updated_at = :now, version = version + 1
        WHERE id = :sessionId AND organization_id_at_creation = :organizationId
          AND workspace_id_at_creation = :workspaceId AND status = 'active'`, {
        sessionId, organizationId: organizationId(), workspaceId: workspaceId(), now,
      })
      if (result.changes !== 1) throw resourceNotFound('课堂不存在于当前工作空间或已结束')
      await context.audit({ eventType: 'classroom.session.ended', actorId: actorId(), workspaceId: workspaceId(), resourceId: sessionId })
      return { sessionId, status: 'ended', endedAt: now }
    },

    async joinClassSession(input) {
      const sessionId = assertString(input.classSessionId, 'classSessionId')
      await authorize('classroom.read', { classSessionId: sessionId })
      const session = getScopedSession(context.db, sessionId, organizationId(), workspaceId(), true)
      if (!session) throw resourceNotFound('课堂不存在于当前工作空间或已结束')
      const now = isoNow(context)
      const participant = one(context.db, `SELECT * FROM class_session_participants
        WHERE class_session_id = :sessionId AND actor_id = :actorId`, { sessionId, actorId: actorId() })
      if (participant) {
        run(context.db, `UPDATE class_session_participants SET last_seen_at = :now, updated_at = :now, version = version + 1
          WHERE id = :id`, { id: participant.id, now })
      } else {
        run(context.db, `INSERT INTO class_session_participants
          (id, class_session_id, actor_id, joined_at, last_seen_at, created_at, updated_at, version)
          VALUES (:id, :sessionId, :actorId, :now, :now, :now, :now, 1)`, {
          id: context.idFactory(), sessionId, actorId: actorId(), now,
        })
        await context.audit({ eventType: 'classroom.participant.joined', actorId: actorId(), workspaceId: workspaceId(), resourceId: sessionId })
      }
      return this.getClassroomState(sessionId)
    },

    async acknowledgeBroadcast(input) {
      const sessionId = assertString(input.classSessionId, 'classSessionId')
      const broadcastId = assertString(input.broadcastId, 'broadcastId')
      await authorize('classroom.read', { classSessionId: sessionId })
      const broadcast = one(context.db, `SELECT b.id FROM class_broadcasts b
        JOIN class_sessions s ON s.id = b.class_session_id
        WHERE b.id = :broadcastId AND b.class_session_id = :sessionId
          AND s.organization_id_at_creation = :organizationId AND s.workspace_id_at_creation = :workspaceId`, {
        broadcastId, sessionId, organizationId: organizationId(), workspaceId: workspaceId(),
      })
      if (!broadcast) throw resourceNotFound('课堂广播不存在于当前工作空间')
      const now = isoNow(context)
      const receipt = one(context.db, `SELECT id FROM class_broadcast_receipts
        WHERE class_broadcast_id = :broadcastId AND actor_id = :actorId`, { broadcastId, actorId: actorId() })
      transaction(context.db, () => {
        if (!receipt) {
          run(context.db, `INSERT INTO class_broadcast_receipts
            (id, class_session_id, class_broadcast_id, actor_id, received_at, created_at, updated_at, version)
            VALUES (:id, :sessionId, :broadcastId, :actorId, :now, :now, :now, 1)`, {
            id: context.idFactory(), sessionId, broadcastId, actorId: actorId(), now,
          })
        }
        run(context.db, `UPDATE class_session_participants SET last_seen_at = :now, last_broadcast_id = :broadcastId,
          updated_at = :now, version = version + 1 WHERE class_session_id = :sessionId AND actor_id = :actorId`, {
          now, broadcastId, sessionId, actorId: actorId(),
        })
      })
      if (!receipt) await context.audit({ eventType: 'classroom.broadcast.received', actorId: actorId(), workspaceId: workspaceId(), resourceId: broadcastId })
      return { broadcastId, receivedAt: now, replayed: Boolean(receipt) }
    },

    async enqueueAiBroadcast(input) {
      await authorize('classroom.control', { classSessionId: input.classSessionId })
      const sessionId = assertString(input.classSessionId, 'classSessionId')
      const deviceId = assertString(input.deviceId, 'deviceId')
      const sourceRequestId = assertString(input.sourceRequestId, 'sourceRequestId')
      if (!input.message || typeof input.message !== 'object') throw new TypeError('message 必须是已完成的一次 AI 调用结果')
      await requireControl(sessionId, deviceId)
      const now = isoNow(context)
      const result = transaction(context.db, () => {
        const existing = one(context.db, `SELECT b.id FROM class_broadcasts b
          JOIN class_sessions s ON s.id = b.class_session_id
          WHERE b.class_session_id = :sessionId AND b.source_request_id = :sourceRequestId
            AND s.organization_id_at_creation = :organizationId AND s.workspace_id_at_creation = :workspaceId`, {
          sessionId, sourceRequestId, organizationId: organizationId(), workspaceId: workspaceId(),
        })
        if (existing) return { broadcastId: existing.id, replayed: true }
        const broadcastId = context.idFactory()
        run(context.db, `INSERT INTO class_broadcasts (id, class_session_id, source_request_id, actor_id_at_creation, message_json, created_at, updated_at, version)
          VALUES (:id, :sessionId, :sourceRequestId, :actorId, :messageJson, :now, :now, 1)`, {
          id: broadcastId, sessionId, sourceRequestId, actorId: actorId(), messageJson: JSON.stringify(input.message), now,
        })
        run(context.db, `INSERT INTO class_broadcast_outbox (id, class_broadcast_id, event_type, payload_json, status, created_at, updated_at, version)
          VALUES (:id, :broadcastId, 'class.ai.broadcast.ready', :payloadJson, 'pending', :now, :now, 1)`, {
          id: context.idFactory(), broadcastId, payloadJson: JSON.stringify({ classSessionId: sessionId, broadcastId }), now,
        })
        return { broadcastId, replayed: false }
      })
      await context.audit({ eventType: 'classroom.ai.broadcast.enqueued', actorId: actorId(), workspaceId: workspaceId(), resourceId: result.broadcastId, outcome: result })
      return result
    },

    async getClassroomState(sessionId) {
      await authorize('classroom.read', { classSessionId: sessionId })
      const session = getScopedSession(context.db, sessionId, organizationId(), workspaceId())
      if (!session) throw resourceNotFound('课堂不存在于当前工作空间')
      const now = context.now()
      const connectedSince = new Date(now.getTime() - 45_000).toISOString()
      const participants = one(context.db, `SELECT COUNT(*) AS joined,
        SUM(CASE WHEN last_seen_at >= :connectedSince THEN 1 ELSE 0 END) AS connected,
        SUM(CASE WHEN last_seen_at < :connectedSince THEN 1 ELSE 0 END) AS offline
        FROM class_session_participants WHERE class_session_id = :sessionId`, { sessionId, connectedSince })
      const currentParticipant = one(context.db, `SELECT * FROM class_session_participants
        WHERE class_session_id = :sessionId AND actor_id = :actorId`, { sessionId, actorId: actorId() })
      const latestBroadcast = one(context.db, `SELECT * FROM class_broadcasts
        WHERE class_session_id = :sessionId ORDER BY created_at DESC, id DESC LIMIT 1`, { sessionId })
      return {
        ...session,
        mode: session.status === 'ended' ? 'ended' : session.mode,
        page: session.synced_page_no,
        teacher: session.teacher_display_name || session.actor_id_at_creation,
        connected: currentParticipant ? currentParticipant.last_seen_at >= connectedSince : null,
        participants: {
          joined: participants?.joined || 0,
          connected: participants?.connected || 0,
          offline: participants?.offline || 0,
          abnormal: 0,
        },
        broadcast: latestBroadcast ? {
          id: latestBroadcast.id,
          sourceRequestId: latestBroadcast.source_request_id,
          message: parseJson(latestBroadcast.message_json, {}),
          createdAt: latestBroadcast.created_at,
          received: currentParticipant?.last_broadcast_id === latestBroadcast.id,
        } : null,
        classIds: all(context.db, `SELECT ac.class_id FROM assignment_classes ac
          JOIN reading_assignments a ON a.id = ac.assignment_id
          WHERE ac.assignment_id = :assignmentId AND a.organization_id_at_creation = :organizationId
            AND a.workspace_id_at_creation = :workspaceId`, {
          assignmentId: session.assignment_id, organizationId: organizationId(), workspaceId: workspaceId(),
        }).map((row) => row.class_id),
      }
    },
  }
}

function getScopedSession(db, sessionId, organizationId, workspaceId, activeOnly = false) {
  return one(db, `SELECT * FROM class_sessions
    WHERE id = :sessionId AND organization_id_at_creation = :organizationId
      AND workspace_id_at_creation = :workspaceId ${activeOnly ? "AND status = 'active'" : ''}`, {
    sessionId, organizationId, workspaceId,
  })
}

function requireScopedBookVersion(db, bookVersionId, organizationId) {
  const version = one(db, `SELECT v.id FROM book_versions v
    JOIN books b ON b.id = v.book_id
    WHERE v.id = :bookVersionId AND v.organization_id_at_creation = :organizationId
      AND b.organization_id_at_creation = :organizationId`, { bookVersionId, organizationId })
  if (!version) throw resourceNotFound('书籍版本不存在于当前组织')
}

function resourceNotFound(message) {
  const error = new Error(message)
  error.code = 'RESOURCE_NOT_FOUND'
  return error
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}
