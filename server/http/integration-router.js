import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'

import express from 'express'

import { withTransaction } from '../db/database.js'
import { HttpError, isHttpError } from '../db/errors.js'
import { appendAuditEvent, enqueueOutboxEvent, executeIdempotent, executeIdempotentAsync } from '../db/reliability.js'
import { createCommunityDomain } from '../domains/community/index.js'
import { createDeliveryDomain, openPublicSummaryLink } from '../domains/delivery/index.js'
import { createConversationDomain } from '../domains/ai/conversations.js'
import { createPrivacyDomain } from '../domains/privacy/index.js'
import { createReadingDomain } from '../domains/reading/catalog.js'
import { createEyeCareDomain } from '../domains/reading/eyecare.js'
import { createStudentLibraryDomain } from '../domains/reading/library-objects.js'
import { createReadingMonitoringDomain } from '../domains/reading/monitoring.js'
import { createReadingStatisticsDomain } from '../domains/reading/statistics.js'
import { createReportsDomain } from '../domains/reports/index.js'
import { dispatchSafetyNotificationOutbox } from '../domains/safety/notifications.js'
import { createTeachingDomain } from '../domains/teaching/classroom.js'
import { createRequireSessionMiddleware, createRequireWorkspaceMiddleware, createRequestContextMiddleware, parseCookies } from '../middleware/request-context.js'
import { sendData, sendFailure } from '../middleware/http.js'
import { renderPublicSummaryPage, sanitizePublicSummary } from './public-summary-page.js'
import { createAiRuntime, createConversation, deriveAiRequestScope } from '../integration/ai-runtime.js'
import { createRequestDomainDependencies, workspaceResourceScope } from '../integration/context.js'
import {
  projectAssignments,
  projectBookPage,
  projectBooks,
  projectCommunityPosts,
  projectConversations,
  projectReadingProgress,
  projectSafetyDetail,
  projectSafetyEvents,
  projectUsageSummary,
} from '../integration/projections.js'

const DEVICE_COOKIE = 'readmate_device'
// Persistent device identity across browser restarts; independent of login session TTL.
const DEVICE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60
const MANUAL_DEMO_EVIDENCE = Object.freeze([
  {
    text: '李老师最近经常当着同学说我没用，我一到他的课就特别害怕。',
    confidence: 0.91,
    reasons: ['bullying', 'school_avoidance'],
  },
  {
    text: '这种情况持续很久了，我晚上经常睡不着，也越来越不敢去学校。',
    confidence: 0.92,
    reasons: ['sustained_distress', 'sleep_disruption', 'school_avoidance'],
  },
  {
    text: '我现在每天都很难受，觉得没有人愿意帮我，也不知道还能坚持多久。',
    confidence: 0.94,
    reasons: ['sustained_distress', 'hopelessness'],
  },
])
const errorStatus = {
  AUTH_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  PERMISSION_DENIED: 403,
  RESOURCE_NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  STATE_CONFLICT: 409,
  PRIVACY_CONSENT_REQUIRED: 403,
  SAFETY_MINIMUM_CONTEXT_AVAILABLE: 409,
  READING_LEASE_REQUIRED: 409,
  READING_LEASE_HELD: 409,
  STALE_READ_RANGE: 409,
  LEASE_REQUIRED: 409,
  LEASE_CONFLICT: 409,
  REVISION_GAP: 409,
  REVISION_CONFLICT: 409,
  SUMMARY_REGRESSION: 409,
  STAT_DATE_MISMATCH: 409,
  FUTURE_TIME_REJECTED: 422,
  CLASSROOM_CONTROL_REQUIRED: 409,
  CLASSROOM_CONTROL_HELD: 409,
  IDEMPOTENCY_LEASE_LOST: 409,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  VALIDATION_FAILED: 422,
  INVALID_REQUEST: 422,
  HUMAN_REVIEW_REQUIRED: 422,
  ASSET_INTEGRITY_MISMATCH: 409,
  RATE_LIMITED: 429,
  MODEL_CANDIDATES_UNAVAILABLE: 503,
  MODEL_PROVIDER_FAILED: 503,
  DEPENDENCY_UNAVAILABLE: 503,
}

function route(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

function resolveStoredAsset(publicAssetDirectory, storageKey) {
  if (typeof publicAssetDirectory !== 'string' || !publicAssetDirectory) {
    throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', '书籍资产目录未配置')
  }
  if (typeof storageKey !== 'string' || !storageKey || isAbsolute(storageKey)) {
    throw new HttpError(409, 'ASSET_INTEGRITY_MISMATCH', '书籍资产存储键无效')
  }
  const root = resolve(publicAssetDirectory)
  const filename = resolve(root, storageKey)
  const boundary = relative(root, filename)
  if (!boundary || boundary.startsWith('..') || isAbsolute(boundary)) {
    throw new HttpError(409, 'ASSET_INTEGRITY_MISMATCH', '书籍资产存储键越界')
  }
  return filename
}

function byteRange(header, size) {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2])) throw new HttpError(416, 'VALIDATION_FAILED', 'Range 仅支持单个 bytes 区间')
  let start
  let end
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new HttpError(416, 'VALIDATION_FAILED', 'Range 后缀长度无效')
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    throw new HttpError(416, 'VALIDATION_FAILED', 'Range 超出资产边界')
  }
  return { start, end: Math.min(end, size - 1) }
}

function writeKey(req) {
  const value = req.get('Idempotency-Key')
  if (!value) throw new HttpError(400, 'VALIDATION_FAILED', '写入请求必须提供 Idempotency-Key')
  return value
}

function sendOutcome(res, req, outcome) {
  if (outcome.payload?.error) {
    return sendFailure(res, { status: outcome.statusCode, ...outcome.payload.error }, req.requestId)
  }
  return sendData(res, outcome.payload.data, {
    status: outcome.statusCode,
    requestId: req.requestId,
    meta: outcome.replayed ? { replayed: true } : {},
  })
}

async function domainWriteOutcome(statusCode, operation) {
  try {
    return { statusCode, payload: { data: await operation() } }
  } catch (error) {
    throw asHttpError(error)
  }
}

function asHttpError(error) {
  if (isHttpError(error)) return error
  const code = error?.code || (error instanceof TypeError ? 'VALIDATION_FAILED' : 'DEPENDENCY_UNAVAILABLE')
  const status = errorStatus[code] || (error instanceof TypeError ? 422 : 503)
  const safeMessage = status >= 500 ? '服务暂时不可用，请稍后重试' : error.message
  return new HttpError(status, code, safeMessage, {
    retryable: status >= 500,
    details: error?.details,
  })
}

function requirePermission(identityService, action) {
  return (req, res, next) => {
    const allowed = identityService.authorize({
      actor: req.identitySession.user,
      workspace: req.workspace,
      action,
      resourceScope: workspaceResourceScope(req.workspace, req.identitySession.user.id),
    })
    if (!allowed) return sendFailure(res, new HttpError(403, 'PERMISSION_DENIED', '当前工作空间无权执行此操作'), req.requestId)
    return next()
  }
}

function requestAuthContext(req) {
  return {
    organizationId: req.workspace.organizationId,
    userId: req.identitySession.user.id,
    workspaceId: req.workspace.id,
  }
}

function requestCan(identityService, req, action) {
  return identityService.authorize({
    actor: req.identitySession.user,
    workspace: req.workspace,
    action,
    resourceScope: workspaceResourceScope(req.workspace, req.identitySession.user.id),
  })
}

function communityReviewCapabilities(identityService, req) {
  const resourceScope = workspaceResourceScope(req.workspace, req.identitySession.user.id)
  const authorize = (action) => identityService.authorize({
    actor: req.identitySession.user,
    workspace: req.workspace,
    action,
    resourceScope,
  })
  return {
    canReviewClass: authorize('community.review.class'),
    canReviewSchool: authorize('community.review.school'),
  }
}

function safetyDetailForRequest(identityService, req, database, eventId) {
  const detail = projectSafetyDetail(database, req.workspace.organizationId, eventId)
  if (!detail) return null
  const resourceScope = workspaceResourceScope(req.workspace, req.identitySession.user.id)
  const can = (action) => identityService.authorize({
    actor: req.identitySession.user,
    workspace: req.workspace,
    action,
    resourceScope,
  })
  const availableActions = []
  if (detail.eventId && detail.status === 'awaiting_human_acceptance' && can('safety.accept')) {
    availableActions.push('take')
  }
  if (
    detail.eventId &&
    detail.status === 'working' &&
    detail.acceptedByUserId === req.identitySession.user.id &&
    can('safety.close')
  ) {
    availableActions.push('close', 'false')
  }
  return {
    ...detail,
    viewer: {
      id: req.identitySession.user.id,
      displayName: req.identitySession.user.displayName,
    },
    watermark: req.identitySession.user.displayName,
    availableActions,
  }
}

function safetyEventAccess(identityService, req, database, eventOrTaskId) {
  const event = database.prepare(`
    SELECT event.id, task.id AS review_task_id
    FROM safety_review_tasks AS task
    LEFT JOIN safety_events AS event ON event.review_task_id = task.id
    WHERE task.organization_id = ? AND (task.id = ? OR event.id = ?)
  `).get(req.workspace.organizationId, eventOrTaskId, eventOrTaskId)
  if (!event) return { exists: false, allowed: false }
  const implicated = database.prepare(`
    SELECT 1 FROM safety_implicated_candidates
    WHERE review_task_id = ? AND candidate_user_id = ?
  `).get(event.review_task_id, req.identitySession.user.id)
  if (implicated) return { exists: true, allowed: false }
  if (requestCan(identityService, req, 'safety.review')) return { exists: true, allowed: true }
  if (!event.id) return { exists: true, allowed: false }
  const recipient = database.prepare(`
    SELECT 1
    FROM safety_notification_recipients AS recipient
    WHERE recipient.organization_id = ? AND recipient.safety_event_id = ? AND recipient.user_id = ?
      AND (
        (recipient.scope_type = 'class' AND ? = 'class' AND recipient.scope_id = ?)
        OR (recipient.scope_type = 'grade' AND ? = 'grade' AND recipient.scope_id = ?)
        OR (recipient.scope_type = 'school' AND ? = 'school' AND recipient.scope_id = ?)
      )
  `).get(
    req.workspace.organizationId,
    event.id,
    req.identitySession.user.id,
    req.workspace.scopeType,
    req.workspace.scopeId,
    req.workspace.scopeType,
    req.workspace.scopeId,
    req.workspace.scopeType,
    req.workspace.scopeId,
  )
  return { exists: true, allowed: Boolean(recipient) }
}

function requireCommunityReview(identityService) {
  return (req, res, next) => {
    const capabilities = communityReviewCapabilities(identityService, req)
    if (!capabilities.canReviewClass && !capabilities.canReviewSchool) {
      return sendFailure(res, new HttpError(403, 'PERMISSION_DENIED', '当前工作空间无权审核社区投稿'), req.requestId)
    }
    req.communityReviewCapabilities = capabilities
    return next()
  }
}

function signDeviceId(deviceId, secret) {
  const signature = createHmac('sha256', secret).update(deviceId).digest('base64url')
  return `${deviceId}.${signature}`
}

function readDeviceId(req, secret) {
  const token = parseCookies(req.get('Cookie'))[DEVICE_COOKIE]
  if (!token) return null
  const separator = token.lastIndexOf('.')
  if (separator <= 0) return null
  const deviceId = token.slice(0, separator)
  const supplied = Buffer.from(token.slice(separator + 1), 'base64url')
  const expected = createHmac('sha256', secret).update(deviceId).digest()
  return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? deviceId : null
}

function deviceCookieOptions(cookieSecure) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(cookieSecure),
    path: '/',
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
  }
}

function ensureDeviceCookie(req, res, sessionSecret, cookieSecure) {
  const deviceId = readDeviceId(req, sessionSecret) || randomUUID()
  res.cookie(DEVICE_COOKIE, signDeviceId(deviceId, sessionSecret), deviceCookieOptions(cookieSecure))
  return deviceId
}

function domainForRequest(req, database, identityService) {
  const dependencies = createRequestDomainDependencies({ database, identityService, req })
  return {
    dependencies,
    reading: createReadingDomain(dependencies),
    conversations: createConversationDomain(dependencies),
    privacy: createPrivacyDomain(dependencies),
    eyeCare: createEyeCareDomain(dependencies),
    library: createStudentLibraryDomain(dependencies),
    readingMonitoring: createReadingMonitoringDomain(dependencies),
    readingStatistics: createReadingStatisticsDomain(dependencies),
    teaching: createTeachingDomain(dependencies),
    community: createCommunityDomain(dependencies),
    reports: createReportsDomain(dependencies),
    delivery: createDeliveryDomain({
      ...dependencies,
      adapter: req.integrationOptions?.deliveryAdapter,
      summaryLinkSigningKey: req.integrationOptions?.summaryLinkSigningKey ?? process.env.SUMMARY_LINK_SIGNING_KEY,
      miniProgramReceiptVerifier: req.integrationOptions?.miniProgramReceiptVerifier,
    }),
  }
}

function normalizeImages(images) {
  return Array.isArray(images) ? images.map((image) => ({
    ...image,
    bytes: typeof image?.bytesBase64 === 'string' ? Uint8Array.from(Buffer.from(image.bytesBase64, 'base64')) : image?.bytes,
  })) : []
}

function addAiAudit(database, req, result) {
  withTransaction(database, () => {
    appendAuditEvent(database, {
      eventType: 'ai.message.completed',
      actorUserId: req.identitySession.user.id,
      workspaceId: req.workspace.id,
      requestId: req.requestId,
      idempotencyKey: req.get('Idempotency-Key'),
      resourceType: 'ai_conversation',
      resourceId: result.conversationId,
      scopeSnapshot: workspaceResourceScope(req.workspace, req.identitySession.user.id),
    })
    enqueueOutboxEvent(database, {
      topic: 'ai.message.completed',
      aggregateType: 'ai_conversation',
      aggregateId: result.conversationId,
      payload: { conversationId: result.conversationId, messageId: result.messageId, reviewTaskId: result.reviewTaskId },
      dedupeKey: `ai.message.completed:${result.requestId}`,
    })
  })
}

export function createIntegrationRouter({ database, identityService, sessionSecret, modelProvider, reviewProvider, quotaPolicy, deliveryAdapter, summaryLinkSigningKey, miniProgramReceiptVerifier, cookieSecure, publicAssetDirectory, internalDemoMode = false } = {}) {
  const router = express.Router()
  const requireSession = createRequireSessionMiddleware(identityService)
  const requireWorkspace = createRequireWorkspaceMiddleware(identityService)
  const aiRuntime = createAiRuntime({ database, sessionSecret, modelProvider, reviewProvider, quotaPolicy })
  dispatchSafetyNotificationOutbox(database)

  router.use(express.json({ limit: '2mb' }))
  router.use(createRequestContextMiddleware())
  router.get('/public/summary-links/:deliveryId', route((req, res) => {
    res.set('Cache-Control', 'no-store')
    res.set('Referrer-Policy', 'no-referrer')
    const result = sanitizePublicSummary(openPublicSummaryLink({
      db: database,
      deliveryId: req.params.deliveryId,
      linkToken: req.query.token,
      summaryLinkSigningKey: summaryLinkSigningKey ?? process.env.SUMMARY_LINK_SIGNING_KEY,
    }))
    if ((req.get('Accept') || '').includes('text/html')) {
      res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
      return res.status(200).type('html').send(renderPublicSummaryPage(result))
    }
    return sendData(res, result, { requestId: req.requestId })
  }))
  router.use(requireSession)
  router.use(requireWorkspace)
  router.use((req, res, next) => {
    req.integrationOptions = { deliveryAdapter, summaryLinkSigningKey, miniProgramReceiptVerifier }
    next()
  })

  const writeReadingLibrary = (statusCode, operation) => route(async (req, res) => {
    const key = writeKey(req)
    const { library } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `reading.library:${req.workspace.organizationId}:${req.identitySession.user.id}:${req.workspace.id}:${req.method}:${req.path}`,
      request: req.body || {},
      operation: () => domainWriteOutcome(statusCode, () => operation(library, req)),
    })
    return sendOutcome(res, req, outcome)
  })

  router.post('/internal-demo/manual-safety/evidence', route(async (req, res) => {
    if (!internalDemoMode) throw new HttpError(403, 'PERMISSION_DENIED', '内部演示安全入口未启用')
    if (!requestCan(identityService, req, 'ai.conversation.create')) {
      throw new HttpError(403, 'PERMISSION_DENIED', '只有学生本人可以记录受控演示证据')
    }
    const key = writeKey(req)
    const stage = Number(req.body?.stage)
    const controlledEvidence = MANUAL_DEMO_EVIDENCE[stage - 1]
    if (!controlledEvidence) throw new HttpError(422, 'VALIDATION_FAILED', '演示证据阶段必须是 1、2 或 3')
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `manual-demo-safety:${req.workspace.organizationId}:${req.identitySession.user.id}`,
      request: req.body,
      operation: async () => {
        let conversationId = req.body?.conversationId
        if (!conversationId) {
          const scope = deriveAiRequestScope(database, {
            organizationId: req.workspace.organizationId,
            ownerUserId: req.identitySession.user.id,
            workspaceId: req.workspace.id,
            bookId: req.body?.bookId,
            currentPageNo: req.body?.currentPageNo,
          })
          if (!scope) throw new HttpError(404, 'RESOURCE_NOT_FOUND', '当前书页不存在或不在可读范围')
          conversationId = randomUUID()
          createConversation(database, {
            id: conversationId,
            organizationId: req.workspace.organizationId,
            ownerUserId: req.identitySession.user.id,
            bookVersionId: scope.bookVersionId,
            title: '校园困扰与求助',
            createdAt: new Date().toISOString(),
          })
        }
        const evidence = await aiRuntime.safetyService.recordManualDemoEvidence({
          authContext: {
            organizationId: req.workspace.organizationId,
            userId: req.identitySession.user.id,
            ownerUserId: req.identitySession.user.id,
          },
          request: {
            conversationId,
            userMessage: controlledEvidence.text,
            privacy: { detected: false, confidence: 0, category: 'none', urgency: 'none' },
            danger: {
              detected: true,
              confidence: controlledEvidence.confidence,
              category: 'student_wellbeing',
              urgency: 'high',
              reasons: controlledEvidence.reasons,
            },
            candidateUserIds: req.body?.implicatedStableAccountIds,
          },
        })
        let secondaryReview = null
        if (evidence.reviewTaskId) {
          secondaryReview = await aiRuntime.safetyService.runSecondaryReview({
            authContext: {
              organizationId: req.workspace.organizationId,
              userId: req.identitySession.user.id,
              ownerUserId: req.identitySession.user.id,
            },
            reviewTaskId: evidence.reviewTaskId,
            reviewProvider: aiRuntime.reviewProvider,
          })
          if (secondaryReview.safetyEvent?.id) {
            dispatchSafetyNotificationOutbox(database, { eventId: secondaryReview.safetyEvent.id })
            appendAuditEvent(database, {
              eventType: 'safety.event.manual_demo_created',
              actorUserId: req.identitySession.user.id,
              workspaceId: req.workspace.id,
              requestId: req.requestId,
              idempotencyKey: key,
              resourceType: 'safety_event',
              resourceId: secondaryReview.safetyEvent.id,
              outcome: 'manual_demo_test',
              scopeSnapshot: workspaceResourceScope(req.workspace, req.identitySession.user.id),
            })
          }
        }
        return {
          statusCode: 200,
          payload: {
            data: {
              ...evidence,
              secondaryReview,
              safetyEvent: secondaryReview?.safetyEvent || null,
              safety: evidence.reviewTaskId
                ? projectSafetyDetail(database, req.workspace.organizationId, evidence.reviewTaskId)
                : null,
            },
          },
        }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.get('/students', requirePermission(identityService, 'account.read'), route((req, res) => {
    const scopeType = req.workspace.scopeType
    const scopeId = req.workspace.scopeId
    if (!['class', 'grade', 'school'].includes(scopeType)) {
      throw new HttpError(403, 'PERMISSION_DENIED', '当前工作空间不提供学生名单')
    }
    const scopeSql = scopeType === 'class'
      ? 'class.id = ?'
      : scopeType === 'grade'
        ? 'class.grade_id = ?'
        : 'class.organization_id = ?'
    const rows = database.prepare(`
      SELECT DISTINCT
        student.id,
        student.display_name AS displayName,
        class.id AS classId,
        class.name AS className
      FROM users AS student
      JOIN class_memberships AS membership
        ON membership.user_id = student.id AND membership.membership_role = 'student' AND membership.status = 'active'
      JOIN classes AS class
        ON class.id = membership.class_id AND class.status = 'active'
      WHERE student.organization_id = ? AND student.status = 'active'
        AND class.organization_id = ? AND ${scopeSql}
      ORDER BY student.display_name, student.id
    `).all(req.workspace.organizationId, req.workspace.organizationId, scopeId)
    return sendData(res, { items: rows }, { requestId: req.requestId })
  }))

  router.get('/books', route(async (req, res) => {
    const { reading } = domainForRequest(req, database, identityService)
    const rows = await reading.listBooks({ status: req.query.status || 'published' })
    return sendData(res, { items: projectBooks(database, req.identitySession.user.id, req.workspace.id, rows) }, { requestId: req.requestId })
  }))

  router.get('/books/assets/:assetId', route(async (req, res) => {
    const { reading } = domainForRequest(req, database, identityService)
    const asset = await reading.getBookAsset(req.params.assetId)
    const filename = resolveStoredAsset(publicAssetDirectory, asset.storage_key)
    let stat
    try {
      stat = statSync(filename)
    } catch {
      throw new HttpError(404, 'RESOURCE_NOT_FOUND', '书籍资产文件不存在')
    }
    if (!stat.isFile() || stat.size !== Number(asset.size_bytes)) {
      throw new HttpError(409, 'ASSET_INTEGRITY_MISMATCH', '书籍资产文件大小与登记值不一致')
    }
    let range
    try {
      range = byteRange(req.get('Range'), stat.size)
    } catch (error) {
      if (error instanceof HttpError && error.status === 416) {
        res.set('Content-Range', `bytes */${stat.size}`)
      }
      throw error
    }
    res.set({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
      'Content-Type': asset.mime_type,
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    })
    if (range) {
      res.status(206)
      res.set('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`)
      res.set('Content-Length', String(range.end - range.start + 1))
      await pipeline(createReadStream(filename, range), res)
      return
    }
    res.set('Content-Length', String(stat.size))
    await pipeline(createReadStream(filename), res)
  }))

  router.get('/books/:bookId/pages/:pageNo', route(async (req, res) => {
    const { reading } = domainForRequest(req, database, identityService)
    const page = await reading.getPage(req.params.bookId, Number(req.params.pageNo), req.query.versionId || null)
    const scope = deriveAiRequestScope(database, {
      organizationId: req.workspace.organizationId,
      ownerUserId: req.identitySession.user.id,
      workspaceId: req.workspace.id,
      bookId: req.params.bookId,
      bookVersionId: page.book_version_id,
      currentPageNo: page.page_no,
    })
    if (!scope) throw new HttpError(404, 'RESOURCE_NOT_FOUND', '当前书页不存在或不在可读范围')
    return sendData(res, projectBookPage(database, page, { readRangeVersion: scope.readRangeVersion }), { requestId: req.requestId })
  }))

  router.get('/reading/progress', route((req, res) => sendData(res,
    projectReadingProgress(database, req.identitySession.user.id, req.workspace.id, req.workspace.organizationId),
    { requestId: req.requestId },
  )))

  router.get('/eyecare/status', route(async (req, res) => {
    const { eyeCare } = domainForRequest(req, database, identityService)
    return sendData(res, await eyeCare.getStudentStatus({ authContext: requestAuthContext(req) }), { requestId: req.requestId })
  }))

  router.get('/eyecare/students', route(async (req, res) => {
    const { eyeCare } = domainForRequest(req, database, identityService)
    return sendData(res, await eyeCare.listScopedStudents({ authContext: requestAuthContext(req) }), { requestId: req.requestId })
  }))

  router.post('/eyecare/students/:studentId/release-false-positive', route(async (req, res) => {
    const key = writeKey(req)
    const { eyeCare } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `eyecare.release:${req.workspace.organizationId}:${req.workspace.id}:${req.params.studentId}`,
      request: req.body,
      operation: () => domainWriteOutcome(200, () => eyeCare.releaseFalsePositive({
          authContext: requestAuthContext(req),
          studentId: req.params.studentId,
          falsePositive: req.body?.falsePositive,
          reason: req.body?.reason,
        })),
    })
    return sendOutcome(res, req, outcome)
  }))

  router.get('/reading/statistics/self', route(async (req, res) => {
    const { readingStatistics } = domainForRequest(req, database, identityService)
    return sendData(res, await readingStatistics.getStudentSummary(requestAuthContext(req)), { requestId: req.requestId })
  }))

  router.get('/reading/statistics/scope', route(async (req, res) => {
    const { readingStatistics } = domainForRequest(req, database, identityService)
    return sendData(res, await readingStatistics.getScopedSummary(requestAuthContext(req), req.query), { requestId: req.requestId })
  }))

  router.post('/reading/lease', route(async (req, res) => {
    const key = writeKey(req)
    const deviceId = ensureDeviceCookie(req, res, sessionSecret, cookieSecure)
    const { reading } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `reading.lease:${req.workspace.organizationId}:${req.identitySession.user.id}:${req.workspace.id}`,
      request: { bookVersionId: req.body?.bookVersionId, takeover: Boolean(req.body?.takeover) },
      operation: async () => {
        try {
          const lease = req.body?.takeover
            ? await reading.takeOverLease({ bookVersionId: req.body?.bookVersionId, deviceId })
            : await reading.acquireLease({ bookVersionId: req.body?.bookVersionId, deviceId })
          return { statusCode: 200, payload: { data: { ...lease, deviceId } } }
        } catch (error) {
          throw asHttpError(error)
        }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.post('/reading/lease/:leaseId/renew', route(async (req, res) => {
    const key = writeKey(req)
    const deviceId = readDeviceId(req, sessionSecret)
    if (!deviceId) throw new HttpError(409, 'LEASE_REQUIRED', '阅读设备绑定已失效，请重新获取阅读租约')
    const { readingMonitoring } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `reading.lease.renew:${req.workspace.organizationId}:${req.identitySession.user.id}:${req.workspace.id}:${deviceId}:${req.params.leaseId}`,
      request: { leaseId: req.params.leaseId, body: req.body },
      operation: () => domainWriteOutcome(200, () => readingMonitoring.renewLease({
        leaseId: req.params.leaseId,
        deviceId,
        body: req.body,
      })),
    })
    return sendOutcome(res, req, outcome)
  }))

  router.post('/reading/session-summaries', route(async (req, res) => {
    const key = writeKey(req)
    const deviceId = readDeviceId(req, sessionSecret)
    if (!deviceId) throw new HttpError(409, 'LEASE_REQUIRED', '阅读设备绑定已失效，请重新获取阅读租约')
    const { readingMonitoring } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `reading.summary:${req.workspace.organizationId}:${req.identitySession.user.id}:${req.workspace.id}:${deviceId}`,
      request: req.body,
      operation: () => domainWriteOutcome(200, () => readingMonitoring.acceptSessionSummary({
        deviceId,
        body: req.body,
      })),
    })
    return sendOutcome(res, req, outcome)
  }))

  router.post('/reading/events/batch', route(async (req, res) => {
    const key = writeKey(req)
    const deviceId = readDeviceId(req, sessionSecret)
    if (!deviceId) throw new HttpError(401, 'AUTH_REQUIRED', '阅读设备绑定已失效，请重新获取阅读租约')
    const { reading } = domainForRequest(req, database, identityService)
    const events = Array.isArray(req.body?.events) ? req.body.events.map((event) => ({ ...event, deviceId })) : []
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `reading.events:${req.workspace.organizationId}:${req.identitySession.user.id}:${req.workspace.id}:${deviceId}`,
      request: { events },
      operation: async () => {
        try {
          return { statusCode: 200, payload: { data: await reading.ingestEventsBatch({ events }) } }
        } catch (error) {
          throw asHttpError(error)
        }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.get('/reading/library', route(async (req, res) => {
    const { library } = domainForRequest(req, database, identityService)
    return sendData(res, await library.getSnapshot(), { requestId: req.requestId })
  }))

  router.post('/reading/library/favorites', writeReadingLibrary(201, (library, req) => library.createFavorite(req.body || {})))
  router.patch('/reading/library/favorites/:favoriteId', writeReadingLibrary(200, (library, req) => library.updateFavorite({
    ...(req.body || {}), favoriteId: req.params.favoriteId,
  })))
  router.delete('/reading/library/favorites/:favoriteId', writeReadingLibrary(200, (library, req) => library.deleteFavorite({
    ...(req.body || {}), favoriteId: req.params.favoriteId,
  })))

  router.post('/reading/library/lists', writeReadingLibrary(201, (library, req) => library.createList(req.body || {})))
  router.patch('/reading/library/lists/:listId', writeReadingLibrary(200, (library, req) => library.updateList({
    ...(req.body || {}), listId: req.params.listId,
  })))
  router.delete('/reading/library/lists/:listId', writeReadingLibrary(200, (library, req) => library.deleteList({
    ...(req.body || {}), listId: req.params.listId,
  })))
  router.post('/reading/library/lists/:listId/items', writeReadingLibrary(201, (library, req) => library.addListItem({
    ...(req.body || {}), listId: req.params.listId,
  })))
  router.patch('/reading/library/list-items/:itemId', writeReadingLibrary(200, (library, req) => library.updateListItem({
    ...(req.body || {}), itemId: req.params.itemId,
  })))
  router.delete('/reading/library/list-items/:itemId', writeReadingLibrary(200, (library, req) => library.deleteListItem({
    ...(req.body || {}), itemId: req.params.itemId,
  })))

  router.post('/reading/library/bookmarks', writeReadingLibrary(201, (library, req) => library.createBookmark(req.body || {})))
  router.patch('/reading/library/bookmarks/:bookmarkId', writeReadingLibrary(200, (library, req) => library.updateBookmark({
    ...(req.body || {}), bookmarkId: req.params.bookmarkId,
  })))
  router.delete('/reading/library/bookmarks/:bookmarkId', writeReadingLibrary(200, (library, req) => library.deleteBookmark({
    ...(req.body || {}), bookmarkId: req.params.bookmarkId,
  })))

  router.post('/reading/library/excerpts', writeReadingLibrary(201, (library, req) => library.createExcerpt(req.body || {})))
  router.patch('/reading/library/excerpts/:excerptId', writeReadingLibrary(200, (library, req) => library.updateExcerpt({
    ...(req.body || {}), excerptId: req.params.excerptId,
  })))
  router.delete('/reading/library/excerpts/:excerptId', writeReadingLibrary(200, (library, req) => library.deleteExcerpt({
    ...(req.body || {}), excerptId: req.params.excerptId,
  })))

  router.post('/reading/library/annotations', writeReadingLibrary(201, (library, req) => library.createAnnotation(req.body || {})))
  router.patch('/reading/library/annotations/:annotationId', writeReadingLibrary(200, (library, req) => library.updateAnnotation({
    ...(req.body || {}), annotationId: req.params.annotationId,
  })))
  router.delete('/reading/library/annotations/:annotationId', writeReadingLibrary(200, (library, req) => library.deleteAnnotation({
    ...(req.body || {}), annotationId: req.params.annotationId,
  })))

  router.get('/ai/conversations', route(async (req, res) => {
    const { conversations } = domainForRequest(req, database, identityService)
    const result = await conversations.listOwnConversations({
      authContext: requestAuthContext(req),
      includeDeleted: req.query.includeDeleted === '1' || req.query.includeDeleted === 'true',
    })
    const projected = projectConversations(database, req.workspace.organizationId, req.identitySession.user.id)
    const projectedById = new Map(projected.items.map((item) => [item.id, item]))
    const enrich = (item) => ({ ...item, messages: projectedById.get(item.id)?.messages || [] })
    return sendData(res, {
      ...result,
      items: result.items.map(enrich),
      trash: result.trash.map(enrich),
      activeConversationId: result.items[0]?.id || null,
      quota: projected.quota,
    }, { requestId: req.requestId })
  }))

  router.get('/ai/conversations/:conversationId', route(async (req, res) => {
    const { conversations } = domainForRequest(req, database, identityService)
    return sendData(res, await conversations.getConversation({
      authContext: requestAuthContext(req),
      conversationId: req.params.conversationId,
    }), { requestId: req.requestId })
  }))

  router.post('/ai/conversations', route(async (req, res) => {
    const key = writeKey(req)
    const { conversations } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `ai.conversation.create:${req.workspace.organizationId}:${req.identitySession.user.id}:${req.workspace.id}`,
      request: req.body,
      operation: () => domainWriteOutcome(201, () => conversations.createConversation({ authContext: requestAuthContext(req), input: req.body })),
    })
    return sendOutcome(res, req, outcome)
  }))

  router.patch('/ai/conversations/:conversationId', route(async (req, res) => {
    const key = writeKey(req)
    const { conversations } = domainForRequest(req, database, identityService)
    const action = req.body?.action
    const operation = action === 'rename'
      ? () => conversations.renameConversation({
        authContext: requestAuthContext(req), conversationId: req.params.conversationId,
        title: req.body?.title, expectedVersion: req.body?.expectedVersion,
      })
      : action === 'set_privacy'
        ? () => conversations.setPrivacyMode({
          authContext: requestAuthContext(req), conversationId: req.params.conversationId,
          privacyMode: req.body?.privacyMode, expectedVersion: req.body?.expectedVersion,
        })
        : action === 'update_context'
          ? () => conversations.updateConversationContext({
            authContext: requestAuthContext(req), conversationId: req.params.conversationId,
            context: req.body?.context, expectedVersion: req.body?.expectedVersion,
            expectedContextVersion: req.body?.expectedContextVersion,
          })
          : null
    if (!operation) throw new HttpError(422, 'VALIDATION_FAILED', '未知的会话更新动作')
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `ai.conversation.update:${req.workspace.organizationId}:${req.identitySession.user.id}:${req.params.conversationId}`,
      request: req.body,
      operation: () => domainWriteOutcome(200, operation),
    })
    return sendOutcome(res, req, outcome)
  }))

  router.delete('/ai/conversations/:conversationId', route(async (req, res) => {
    const key = writeKey(req)
    const { conversations } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `ai.conversation.delete:${req.workspace.organizationId}:${req.identitySession.user.id}:${req.params.conversationId}`,
      request: req.body,
      operation: () => domainWriteOutcome(200, () => conversations.softDeleteConversation({
        authContext: requestAuthContext(req), conversationId: req.params.conversationId,
        expectedVersion: req.body?.expectedVersion,
      })),
    })
    return sendOutcome(res, req, outcome)
  }))

  router.post('/ai/conversations/:conversationId/restore', route(async (req, res) => {
    const key = writeKey(req)
    const { conversations } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `ai.conversation.restore:${req.workspace.organizationId}:${req.identitySession.user.id}:${req.params.conversationId}`,
      request: req.body,
      operation: () => domainWriteOutcome(200, () => conversations.restoreConversation({
        authContext: requestAuthContext(req), conversationId: req.params.conversationId,
        expectedVersion: req.body?.expectedVersion,
      })),
    })
    return sendOutcome(res, req, outcome)
  }))

  router.get('/console/conversations', route(async (req, res) => {
    const { conversations } = domainForRequest(req, database, identityService)
    const bookVersionIds = typeof req.query.bookVersionIds === 'string'
      ? req.query.bookVersionIds.split(',').map((value) => value.trim()).filter(Boolean)
      : []
    return sendData(res, await conversations.searchScopedConversationIndex({
      authContext: requestAuthContext(req),
      query: { text: req.query.text, bookVersionIds, bookMode: req.query.bookMode },
    }), { requestId: req.requestId })
  }))

  router.get('/console/conversations/:ownerUserId/:conversationId', route(async (req, res) => {
    const { conversations } = domainForRequest(req, database, identityService)
    return sendData(res, await conversations.getConversation({
      authContext: requestAuthContext(req),
      ownerUserId: req.params.ownerUserId,
      conversationId: req.params.conversationId,
      purpose: req.query.purpose,
    }), { requestId: req.requestId })
  }))

  router.get('/privacy/access-requests', route(async (req, res) => {
    const { privacy } = domainForRequest(req, database, identityService)
    const authContext = requestAuthContext(req)
    const result = requestCan(identityService, req, 'privacy.requests.read_self')
      ? await privacy.listOwnerRequests({ authContext })
      : await privacy.listRequesterRequests({ authContext })
    return sendData(res, result, { requestId: req.requestId })
  }))

  router.post('/privacy/access-requests', route(async (req, res) => {
    const key = writeKey(req)
    const { privacy } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `privacy.request:${req.workspace.organizationId}:${req.identitySession.user.id}:${req.body?.conversationId}`,
      request: req.body,
      operation: () => domainWriteOutcome(201, () => privacy.createAccessRequest({
        authContext: requestAuthContext(req), conversationId: req.body?.conversationId, purpose: req.body?.purpose,
      })),
    })
    return sendOutcome(res, req, outcome)
  }))

  router.post('/privacy/access-requests/:requestId/decision', route(async (req, res) => {
    const key = writeKey(req)
    const { privacy } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `privacy.decision:${req.workspace.organizationId}:${req.identitySession.user.id}:${req.params.requestId}`,
      request: req.body,
      operation: () => domainWriteOutcome(200, () => privacy.resolveAccessRequest({
        authContext: requestAuthContext(req), requestId: req.params.requestId, decision: req.body?.decision,
      })),
    })
    return sendOutcome(res, req, outcome)
  }))

  router.post('/privacy/conversations/:conversationId/access', route(async (req, res) => {
    const key = writeKey(req)
    const { privacy } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `privacy.view:${req.workspace.organizationId}:${req.identitySession.user.id}:${req.params.conversationId}`,
      request: req.body,
      operation: () => domainWriteOutcome(200, () => privacy.viewConversation({
        authContext: requestAuthContext(req), conversationId: req.params.conversationId, purpose: req.body?.purpose,
      })),
    })
    return sendOutcome(res, req, outcome)
  }))

  router.get('/privacy/access-history', route(async (req, res) => {
    const { privacy } = domainForRequest(req, database, identityService)
    const authContext = requestAuthContext(req)
    const result = requestCan(identityService, req, 'privacy.history.read_self')
      ? await privacy.listOwnerAccessHistory({ authContext })
      : await privacy.listScopedAccessHistory({ authContext })
    return sendData(res, result, { requestId: req.requestId })
  }))

  router.post('/ai/messages', route(async (req, res) => {
    const key = writeKey(req)
    const scope = deriveAiRequestScope(database, {
      organizationId: req.workspace.organizationId,
      ownerUserId: req.identitySession.user.id,
      workspaceId: req.workspace.id,
      bookId: req.body?.bookId,
      currentPageNo: req.body?.currentPageNo,
    })
    if (!scope) throw new HttpError(404, 'RESOURCE_NOT_FOUND', '当前书页不存在或不在可读范围')
    if (req.body?.readRangeVersion !== scope.readRangeVersion) {
      throw new HttpError(409, 'STALE_READ_RANGE', '已读范围已变化，请刷新当前书页后重试')
    }
    let conversationId = req.body?.conversationId
    const ownedConversation = conversationId && database.prepare(`
      SELECT id FROM ai_conversations WHERE id = ? AND organization_id = ? AND owner_user_id = ?
    `).get(conversationId, req.workspace.organizationId, req.identitySession.user.id)
    if (conversationId && !ownedConversation) throw new HttpError(404, 'RESOURCE_NOT_FOUND', '对话不存在')
    if (!conversationId) {
      conversationId = randomUUID()
      createConversation(database, {
        id: conversationId,
        organizationId: req.workspace.organizationId,
        ownerUserId: req.identitySession.user.id,
        bookVersionId: scope.bookVersionId,
        title: String(req.body?.text || '').slice(0, 40) || '新的阅读对话',
        createdAt: new Date().toISOString(),
      })
    }
    const result = await aiRuntime.aiService.answer({
      authContext: {
        organizationId: req.workspace.organizationId,
        userId: req.identitySession.user.id,
        workspaceId: req.workspace.id,
      },
      request: {
        idempotencyKey: key,
        conversationId,
        bookVersionId: scope.bookVersionId,
        currentPageId: scope.currentPageId,
        readRangeVersion: scope.readRangeVersion,
        question: req.body?.text,
        selections: req.body?.selections,
        serviceMode: req.body?.safeMode ? 'safe' : 'balanced',
      },
    })
    let secondaryReview = null
    if (result.reviewTaskId) {
      secondaryReview = await aiRuntime.safetyService.runSecondaryReview({
        authContext: { organizationId: req.workspace.organizationId, userId: req.identitySession.user.id, ownerUserId: req.identitySession.user.id },
        reviewTaskId: result.reviewTaskId,
        reviewProvider: aiRuntime.reviewProvider,
      })
      if (secondaryReview.safetyEvent?.id) {
        dispatchSafetyNotificationOutbox(database, { eventId: secondaryReview.safetyEvent.id })
      }
    }
    addAiAudit(database, req, result)
    const safety = result.reviewTaskId ? projectSafetyDetail(database, req.workspace.organizationId, result.reviewTaskId) : null
    return sendData(res, { ...result, secondaryReview, safety }, { requestId: req.requestId })
  }))

  router.get('/community/posts', route((req, res) => {
    const capabilities = communityReviewCapabilities(identityService, req)
    const scope = ['all', 'class', 'school', 'pending'].includes(req.query?.scope) ? req.query.scope : 'all'
    return sendData(res, {
      items: projectCommunityPosts(database, {
        organizationId: req.workspace.organizationId,
        workspace: req.workspace,
        actorId: req.identitySession.user.id,
        scope,
        ...capabilities,
      }),
    }, { requestId: req.requestId })
  }))

  router.post('/community/posts', route((req, res) => {
    const key = writeKey(req)
    const { community } = domainForRequest(req, database, identityService)
    const outcome = executeIdempotent(database, {
      key,
      scope: `community.post:${req.workspace.organizationId}:${req.identitySession.user.id}:${req.workspace.id}`,
      request: req.body,
      operation: ({ createdAt }) => {
        const post = community.submitPost({ ...req.body, images: normalizeImages(req.body?.images) })
        appendAuditEvent(database, {
          eventType: 'community.post.submitted',
          actorUserId: req.identitySession.user.id,
          workspaceId: req.workspace.id,
          requestId: req.requestId,
          idempotencyKey: key,
          resourceType: 'community_post',
          resourceId: post.id,
          scopeSnapshot: workspaceResourceScope(req.workspace, req.identitySession.user.id),
          afterVersion: post.version,
          createdAt,
        })
        return { statusCode: 201, payload: { data: post } }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.post('/community/posts/:postId/review', requireCommunityReview(identityService), route((req, res) => {
    const key = writeKey(req)
    const { community } = domainForRequest(req, database, identityService)
    const outcome = executeIdempotent(database, {
      key,
      scope: `community.review:${req.workspace.organizationId}:${req.workspace.id}:${req.params.postId}`,
      request: req.body,
      operation: ({ createdAt }) => {
        const post = community.reviewPost({ postId: req.params.postId, decision: req.body?.decision, reason: req.body?.reason })
        appendAuditEvent(database, {
          eventType: 'community.post.reviewed',
          actorUserId: req.identitySession.user.id,
          workspaceId: req.workspace.id,
          requestId: req.requestId,
          idempotencyKey: key,
          resourceType: 'community_post',
          resourceId: post.id,
          scopeSnapshot: workspaceResourceScope(req.workspace, req.identitySession.user.id),
          beforeVersion: Math.max(1, Number(post.version) - 1),
          afterVersion: post.version,
          createdAt,
        })
        return { statusCode: 200, payload: { data: post } }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.post('/community/posts/:postId/reactions', requirePermission(identityService, 'community.submit'), route((req, res) => {
    const key = writeKey(req)
    const { community } = domainForRequest(req, database, identityService)
    const outcome = executeIdempotent(database, {
      key,
      scope: `community.reaction:${req.workspace.organizationId}:${req.identitySession.user.id}:${req.workspace.id}:${req.params.postId}:${req.body?.reactionType || ''}`,
      request: req.body,
      operation: ({ createdAt }) => {
        const reaction = community.react({ postId: req.params.postId, reactionType: req.body?.reactionType })
        if (reaction.created) {
          appendAuditEvent(database, {
            eventType: 'community.post.reacted',
            actorUserId: req.identitySession.user.id,
            workspaceId: req.workspace.id,
            requestId: req.requestId,
            idempotencyKey: key,
            resourceType: 'community_post',
            resourceId: req.params.postId,
            scopeSnapshot: workspaceResourceScope(req.workspace, req.identitySession.user.id),
            createdAt,
          })
        }
        return { statusCode: reaction.created ? 201 : 200, payload: { data: reaction } }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.delete('/community/posts/:postId/reactions', requirePermission(identityService, 'community.submit'), route((req, res) => {
    const key = writeKey(req)
    const { community } = domainForRequest(req, database, identityService)
    const outcome = executeIdempotent(database, {
      key,
      scope: `community.reaction.remove:${req.workspace.organizationId}:${req.identitySession.user.id}:${req.workspace.id}:${req.params.postId}:${req.body?.reactionType || ''}`,
      request: req.body,
      operation: ({ createdAt }) => {
        const reaction = community.removeReaction({ postId: req.params.postId, reactionType: req.body?.reactionType })
        if (reaction.removed) {
          appendAuditEvent(database, {
            eventType: 'community.post.reaction_removed',
            actorUserId: req.identitySession.user.id,
            workspaceId: req.workspace.id,
            requestId: req.requestId,
            idempotencyKey: key,
            resourceType: 'community_post',
            resourceId: req.params.postId,
            scopeSnapshot: workspaceResourceScope(req.workspace, req.identitySession.user.id),
            createdAt,
          })
        }
        return { statusCode: 200, payload: { data: reaction } }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.get('/usage/summary', requirePermission(identityService, 'reading.read_scope'), route((req, res) => sendData(res,
    projectUsageSummary(database, req.workspace.organizationId, req.workspace.id),
    { requestId: req.requestId },
  )))

  router.get('/assignments', requirePermission(identityService, 'assignment.read'), route((req, res) => sendData(res,
    { items: projectAssignments(database, req.workspace.organizationId, req.workspace.id) },
    { requestId: req.requestId },
  )))

  router.post('/assignments', requirePermission(identityService, 'assignment.manage'), route(async (req, res) => {
    const key = writeKey(req)
    const { teaching } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `assignment.create:${req.workspace.organizationId}:${req.workspace.id}`,
      request: req.body,
      operation: async () => {
        try {
          return { statusCode: 201, payload: { data: await teaching.createAssignment(req.body) } }
        } catch (error) {
          throw asHttpError(error)
        }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.post('/classroom/sessions', requirePermission(identityService, 'classroom.control'), route(async (req, res) => {
    const key = writeKey(req)
    const { teaching } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `classroom.session.create:${req.workspace.organizationId}:${req.workspace.id}`,
      request: req.body,
      operation: async () => {
        try {
          return { statusCode: 201, payload: { data: await teaching.startClassSession(req.body) } }
        } catch (error) {
          throw asHttpError(error)
        }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.post('/classroom/sessions/:sessionId/control', requirePermission(identityService, 'classroom.control'), route(async (req, res) => {
    const key = writeKey(req)
    const deviceId = ensureDeviceCookie(req, res, sessionSecret, cookieSecure)
    const { teaching } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `classroom.control.claim:${req.workspace.organizationId}:${req.workspace.id}:${req.params.sessionId}`,
      request: { sessionId: req.params.sessionId, ttlSeconds: req.body?.ttlSeconds },
      operation: async () => {
        try {
          return {
            statusCode: 200,
            payload: { data: { ...await teaching.claimControl({ classSessionId: req.params.sessionId, deviceId, ttlSeconds: req.body?.ttlSeconds }), deviceId } },
          }
        } catch (error) {
          throw asHttpError(error)
        }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.patch('/classroom/sessions/:sessionId/page', requirePermission(identityService, 'classroom.control'), route(async (req, res) => {
    const key = writeKey(req)
    const deviceId = readDeviceId(req, sessionSecret)
    if (!deviceId) throw new HttpError(401, 'AUTH_REQUIRED', '课堂控制设备绑定已失效，请重新领取控制权')
    const { teaching } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `classroom.page.sync:${req.workspace.organizationId}:${req.workspace.id}:${req.params.sessionId}`,
      request: { pageNo: req.body?.pageNo },
      operation: async () => {
        try {
          return { statusCode: 200, payload: { data: await teaching.synchronizePage({ classSessionId: req.params.sessionId, deviceId, pageNo: req.body?.pageNo }) } }
        } catch (error) {
          throw asHttpError(error)
        }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.patch('/classroom/sessions/:sessionId/book-lock', requirePermission(identityService, 'classroom.control'), route(async (req, res) => {
    const key = writeKey(req)
    const deviceId = readDeviceId(req, sessionSecret)
    if (!deviceId) throw new HttpError(401, 'AUTH_REQUIRED', '课堂控制设备绑定已失效，请重新领取控制权')
    const { teaching } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `classroom.book.lock:${req.workspace.organizationId}:${req.workspace.id}:${req.params.sessionId}`,
      request: { bookVersionId: req.body?.bookVersionId },
      operation: async () => {
        try {
          return { statusCode: 200, payload: { data: await teaching.lockBook({ classSessionId: req.params.sessionId, deviceId, bookVersionId: req.body?.bookVersionId }) } }
        } catch (error) {
          throw asHttpError(error)
        }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.post('/classroom/sessions/:sessionId/broadcasts', requirePermission(identityService, 'classroom.control'), route(async (req, res) => {
    const key = writeKey(req)
    const deviceId = readDeviceId(req, sessionSecret)
    if (!deviceId) throw new HttpError(401, 'AUTH_REQUIRED', '课堂控制设备绑定已失效，请重新领取控制权')
    const { teaching } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `classroom.broadcast:${req.workspace.organizationId}:${req.workspace.id}:${req.params.sessionId}`,
      request: req.body,
      operation: async () => {
        try {
          return {
            statusCode: 201,
            payload: { data: await teaching.enqueueAiBroadcast({ classSessionId: req.params.sessionId, deviceId, sourceRequestId: req.body?.sourceRequestId, message: req.body?.message }) },
          }
        } catch (error) {
          throw asHttpError(error)
        }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.post('/classroom/sessions/:sessionId/end', requirePermission(identityService, 'classroom.control'), route(async (req, res) => {
    const key = writeKey(req)
    const deviceId = readDeviceId(req, sessionSecret)
    if (!deviceId) throw new HttpError(401, 'AUTH_REQUIRED', '课堂控制设备绑定已失效，请重新领取控制权')
    const { teaching } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `classroom.session.end:${req.workspace.organizationId}:${req.workspace.id}:${req.params.sessionId}`,
      request: { sessionId: req.params.sessionId },
      operation: async () => {
        try {
          return { statusCode: 200, payload: { data: await teaching.endClassSession({ classSessionId: req.params.sessionId, deviceId }) } }
        } catch (error) {
          throw asHttpError(error)
        }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.post('/classroom/sessions/:sessionId/join', requirePermission(identityService, 'classroom.read'), route(async (req, res) => {
    const key = writeKey(req)
    const { teaching } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `classroom.participant.join:${req.workspace.organizationId}:${req.workspace.id}:${req.params.sessionId}:${req.identitySession.user.id}`,
      request: { sessionId: req.params.sessionId },
      operation: async () => {
        try {
          return { statusCode: 200, payload: { data: await teaching.joinClassSession({ classSessionId: req.params.sessionId }) } }
        } catch (error) {
          throw asHttpError(error)
        }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.post('/classroom/sessions/:sessionId/broadcasts/:broadcastId/received', requirePermission(identityService, 'classroom.read'), route(async (req, res) => {
    const key = writeKey(req)
    const { teaching } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `classroom.broadcast.received:${req.workspace.organizationId}:${req.workspace.id}:${req.params.sessionId}:${req.params.broadcastId}:${req.identitySession.user.id}`,
      request: { sessionId: req.params.sessionId, broadcastId: req.params.broadcastId },
      operation: async () => {
        try {
          return { statusCode: 200, payload: { data: await teaching.acknowledgeBroadcast({ classSessionId: req.params.sessionId, broadcastId: req.params.broadcastId }) } }
        } catch (error) {
          throw asHttpError(error)
        }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.get('/classroom/sessions/:sessionId', requirePermission(identityService, 'classroom.read'), route(async (req, res) => {
    const { teaching } = domainForRequest(req, database, identityService)
    try {
      return sendData(res, await teaching.getClassroomState(req.params.sessionId), { requestId: req.requestId })
    } catch (error) {
      throw asHttpError(error)
    }
  }))

  router.get('/safety/events', route((req, res) => {
    const items = projectSafetyEvents(database, req.workspace.organizationId)
      .filter((event) => safetyEventAccess(identityService, req, database, event.id).allowed)
    if (!requestCan(identityService, req, 'safety.review') && items.length === 0) {
      throw new HttpError(403, 'PERMISSION_DENIED', '当前工作空间无权查看学校安全事件')
    }
    return sendData(res, { items }, { requestId: req.requestId })
  }))

  router.get('/safety/events/:eventId', route((req, res) => {
    const access = safetyEventAccess(identityService, req, database, req.params.eventId)
    if (!access.exists) throw new HttpError(404, 'RESOURCE_NOT_FOUND', '安全事件不存在')
    if (!access.allowed) throw new HttpError(403, 'PERMISSION_DENIED', '当前账号已被回避或不在事件通知链中')
    const detail = safetyDetailForRequest(identityService, req, database, req.params.eventId)
    if (!detail) throw new HttpError(404, 'RESOURCE_NOT_FOUND', '安全事件不存在')
    return sendData(res, detail, { requestId: req.requestId })
  }))

  router.post('/safety/events/:eventId/accept', requirePermission(identityService, 'safety.accept'), route((req, res) => {
    const key = writeKey(req)
    const outcome = executeIdempotent(database, {
      key,
      scope: `safety.accept:${req.workspace.organizationId}:${req.params.eventId}`,
      request: req.body,
      operation: ({ createdAt }) => {
        const event = projectSafetyDetail(database, req.workspace.organizationId, req.params.eventId)
        if (!event?.eventId) throw new HttpError(404, 'RESOURCE_NOT_FOUND', '正式安全事件不存在')
        if (event.status !== 'awaiting_human_acceptance') throw new HttpError(409, 'VERSION_CONFLICT', '安全事件当前状态不可接手')
        database.prepare(`
          UPDATE safety_events SET status = 'working', accepted_by_user_id = ?, accepted_at = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND organization_id = ? AND status = 'awaiting_human_acceptance'
        `).run(req.identitySession.user.id, createdAt, createdAt, event.eventId, req.workspace.organizationId)
        appendAuditEvent(database, {
          eventType: 'safety.event.accepted', actorUserId: req.identitySession.user.id, workspaceId: req.workspace.id,
          requestId: req.requestId, idempotencyKey: key, resourceType: 'safety_event', resourceId: event.eventId,
          scopeSnapshot: workspaceResourceScope(req.workspace, req.identitySession.user.id), createdAt,
        })
        enqueueOutboxEvent(database, {
          topic: 'safety.event.accepted', aggregateType: 'safety_event', aggregateId: event.eventId,
          payload: { eventId: event.eventId, acceptedByUserId: req.identitySession.user.id },
          dedupeKey: `safety.event.accepted:${event.eventId}`, createdAt,
        })
        return { statusCode: 200, payload: { data: safetyDetailForRequest(identityService, req, database, event.eventId) } }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.post('/safety/events/:eventId/close', requirePermission(identityService, 'safety.close'), route((req, res) => {
    const key = writeKey(req)
    const outcomeCode = req.body?.outcome
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
    if (!['closed', 'false_positive_closed'].includes(outcomeCode)) {
      throw new HttpError(422, 'VALIDATION_FAILED', '关闭结果必须是正常关闭或误报关闭')
    }
    if (!note || note.length > 2000) {
      throw new HttpError(422, 'VALIDATION_FAILED', '关闭说明必须填写且不超过 2000 字')
    }
    const outcome = executeIdempotent(database, {
      key,
      scope: `safety.close:${req.workspace.organizationId}:${req.params.eventId}`,
      request: { outcome: outcomeCode, note },
      operation: ({ createdAt }) => {
        const event = projectSafetyDetail(database, req.workspace.organizationId, req.params.eventId)
        if (!event?.eventId) throw new HttpError(404, 'RESOURCE_NOT_FOUND', '正式安全事件不存在')
        if (event.status !== 'working' || event.acceptedByUserId !== req.identitySession.user.id) {
          throw new HttpError(409, 'VERSION_CONFLICT', '只有当前负责人可以关闭处理中的安全事件')
        }
        const updated = database.prepare(`
          UPDATE safety_events
          SET status = ?, closure_outcome = ?, resolution_note = ?, closed_by_user_id = ?,
            closed_at = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND organization_id = ? AND status = 'working' AND accepted_by_user_id = ?
        `).run(
          outcomeCode,
          outcomeCode,
          note,
          req.identitySession.user.id,
          createdAt,
          createdAt,
          event.eventId,
          req.workspace.organizationId,
          req.identitySession.user.id,
        )
        if (updated.changes !== 1) throw new HttpError(409, 'VERSION_CONFLICT', '安全事件状态已变化，请刷新后重试')
        const eventType = outcomeCode === 'false_positive_closed' ? 'safety.event.false_positive_closed' : 'safety.event.closed'
        appendAuditEvent(database, {
          eventType,
          actorUserId: req.identitySession.user.id,
          workspaceId: req.workspace.id,
          requestId: req.requestId,
          idempotencyKey: key,
          resourceType: 'safety_event',
          resourceId: event.eventId,
          outcome: outcomeCode,
          scopeSnapshot: workspaceResourceScope(req.workspace, req.identitySession.user.id),
          createdAt,
        })
        enqueueOutboxEvent(database, {
          topic: eventType,
          aggregateType: 'safety_event',
          aggregateId: event.eventId,
          payload: { eventId: event.eventId, outcome: outcomeCode, closedByUserId: req.identitySession.user.id },
          dedupeKey: `${eventType}:${event.eventId}`,
          createdAt,
        })
        return { statusCode: 200, payload: { data: safetyDetailForRequest(identityService, req, database, event.eventId) } }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.get('/audit/events', requirePermission(identityService, 'audit.read_platform'), route((req, res) => {
    const requestedLimit = Number.parseInt(req.query.limit, 10)
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50
    const resourceId = typeof req.query.resourceId === 'string' && req.query.resourceId.trim()
      ? req.query.resourceId.trim()
      : null
    const rows = resourceId ? database.prepare(`
      SELECT audit.id, audit.event_type, audit.actor_user_id, actor.display_name AS actor_name,
        audit.workspace_id, workspace.name AS workspace_name, audit.resource_type, audit.resource_id,
        audit.outcome, audit.reason_code, audit.created_at
      FROM audit_events AS audit
      LEFT JOIN users AS actor ON actor.id = audit.actor_user_id
      LEFT JOIN workspaces AS workspace ON workspace.id = audit.workspace_id
      WHERE audit.resource_id = ?
      ORDER BY audit.created_at DESC, audit.id DESC
      LIMIT ?
    `).all(resourceId, limit) : database.prepare(`
      SELECT audit.id, audit.event_type, audit.actor_user_id, actor.display_name AS actor_name,
        audit.workspace_id, workspace.name AS workspace_name, audit.resource_type, audit.resource_id,
        audit.outcome, audit.reason_code, audit.created_at
      FROM audit_events AS audit
      LEFT JOIN users AS actor ON actor.id = audit.actor_user_id
      LEFT JOIN workspaces AS workspace ON workspace.id = audit.workspace_id
      ORDER BY audit.created_at DESC, audit.id DESC
      LIMIT ?
    `).all(limit)
    return sendData(res, { items: rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      actorUserId: row.actor_user_id,
      actorDisplayName: row.actor_name,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      outcome: row.outcome,
      reasonCode: row.reason_code,
      createdAt: row.created_at,
    })) }, { requestId: req.requestId })
  }))

  router.post('/reports', route((req, res) => {
    const key = writeKey(req)
    const { reports } = domainForRequest(req, database, identityService)
    const outcome = executeIdempotent(database, {
      key,
      scope: `report.generate:${req.workspace.organizationId}:${req.identitySession.user.id}:${req.workspace.id}`,
      request: req.body,
      operation: () => ({ statusCode: 201, payload: { data: reports.generateReport(req.body) } }),
    })
    return sendOutcome(res, req, outcome)
  }))

  router.get('/reports', route((req, res) => {
    const { reports } = domainForRequest(req, database, identityService)
    return sendData(res, { items: reports.listReports() }, { requestId: req.requestId })
  }))

  router.get('/reports/:reportId', route((req, res) => {
    const { reports } = domainForRequest(req, database, identityService)
    return sendData(res, reports.getReport(req.params.reportId), { requestId: req.requestId })
  }))

  router.post('/reports/:reportId/review', route((req, res) => {
    const key = writeKey(req)
    const { reports } = domainForRequest(req, database, identityService)
    const outcome = executeIdempotent(database, {
      key,
      scope: `report.review:${req.workspace.organizationId}:${req.params.reportId}`,
      request: req.body,
      operation: () => ({ statusCode: 200, payload: { data: reports.reviewReport({ reportId: req.params.reportId, versionId: req.body?.versionId }) } }),
    })
    return sendOutcome(res, req, outcome)
  }))

  router.post('/parent-contacts', requirePermission(identityService, 'report.send'), route((req, res) => {
    const key = writeKey(req)
    const { delivery } = domainForRequest(req, database, identityService)
    const outcome = executeIdempotent(database, {
      key,
      scope: `parent-contact.create:${req.workspace.organizationId}:${req.workspace.id}:${req.identitySession.user.id}`,
      request: req.body,
      operation: () => ({ statusCode: 201, payload: { data: delivery.createContact(req.body) } }),
    })
    return sendOutcome(res, req, outcome)
  }))

  router.get('/parent-contacts', requirePermission(identityService, 'report.send'), route((req, res) => {
    const { delivery } = domainForRequest(req, database, identityService)
    const items = delivery.listContacts().map((contact) => ({
      id: contact.id,
      studentId: contact.student_id,
      displayName: contact.display_name,
      destination: contact.destination,
      channel: contact.channel,
      unsubscribedAt: contact.unsubscribed_at,
      createdAt: contact.created_at,
      updatedAt: contact.updated_at,
    }))
    return sendData(res, { items }, { requestId: req.requestId })
  }))

  router.post('/reports/:reportId/deliveries', route(async (req, res) => {
    const key = writeKey(req)
    const { delivery } = domainForRequest(req, database, identityService)
    const reportVersion = database.prepare(`
      SELECT version.id
      FROM report_versions AS version
      JOIN reports AS report ON report.id = version.report_id
      WHERE version.id = ? AND report.id = ?
        AND report.organization_id_at_creation = ? AND report.workspace_id_at_creation = ?
    `).get(req.body?.reportVersionId, req.params.reportId, req.workspace.organizationId, req.workspace.id)
    if (!reportVersion) throw new HttpError(404, 'RESOURCE_NOT_FOUND', '报告版本不存在或与目标报告不一致')
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `report.delivery:${req.workspace.organizationId}:${req.params.reportId}`,
      request: req.body,
      operation: async () => {
        try {
          const queued = await delivery.queueDelivery(req.body)
          const { linkToken, ...deliveryData } = queued
          const publicUrl = linkToken ? `/public/summary-links/${encodeURIComponent(queued.id)}?token=${encodeURIComponent(linkToken)}` : null
          return { statusCode: 201, payload: { data: { ...deliveryData, publicUrl } } }
        } catch (error) {
          throw asHttpError(error)
        }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.get('/deliveries/:deliveryId', requirePermission(identityService, 'report.send'), route((req, res) => {
    const { delivery } = domainForRequest(req, database, identityService)
    try {
      return sendData(res, delivery.getDelivery(req.params.deliveryId), { requestId: req.requestId })
    } catch (error) {
      throw asHttpError(error)
    }
  }))

  router.get('/deliveries', requirePermission(identityService, 'report.send'), route((req, res) => {
    const { delivery } = domainForRequest(req, database, identityService)
    const items = delivery.listDeliveries().map((item) => ({
      id: item.id,
      reportId: item.report_id,
      studentId: item.student_id,
      parentContact: {
        id: item.parent_contact_id,
        displayName: item.display_name,
        destination: item.destination,
      },
      channel: item.channel,
      status: item.status,
      attemptCount: item.attempt_count,
      maxAttempts: item.max_attempts,
      expiresAt: item.link_expires_at,
      firstOpenedAt: item.first_opened_at,
      firstReadAt: item.first_read_at,
      providerMessageId: item.provider_message_id,
      providerReference: item.last_provider_reference,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }))
    return sendData(res, { items }, { requestId: req.requestId })
  }))

  router.post('/deliveries/:deliveryId/process', requirePermission(identityService, 'report.send'), route(async (req, res) => {
    const key = writeKey(req)
    const { delivery } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `report.delivery.process:${req.workspace.organizationId}:${req.workspace.id}:${req.params.deliveryId}`,
      request: { deliveryId: req.params.deliveryId },
      operation: async () => {
        try {
          return { statusCode: 200, payload: { data: await delivery.processDelivery({ deliveryId: req.params.deliveryId }) } }
        } catch (error) {
          throw asHttpError(error)
        }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.post('/deliveries/:deliveryId/reconcile', requirePermission(identityService, 'report.send'), route(async (req, res) => {
    const key = writeKey(req)
    const { delivery } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `report.delivery.reconcile:${req.workspace.organizationId}:${req.workspace.id}:${req.params.deliveryId}`,
      request: req.body,
      operation: async () => {
        try {
          return { statusCode: 200, payload: { data: await delivery.reconcileDelivery({ deliveryId: req.params.deliveryId, ...req.body }) } }
        } catch (error) {
          throw asHttpError(error)
        }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.post('/deliveries/:deliveryId/receipts', requirePermission(identityService, 'report.send'), route(async (req, res) => {
    const key = writeKey(req)
    const { delivery } = domainForRequest(req, database, identityService)
    const outcome = await executeIdempotentAsync(database, {
      key,
      scope: `report.delivery.receipt:${req.workspace.organizationId}:${req.workspace.id}:${req.params.deliveryId}`,
      request: req.body,
      operation: async () => {
        try {
          return { statusCode: 200, payload: { data: await delivery.recordReceipt({ deliveryId: req.params.deliveryId, ...req.body }) } }
        } catch (error) {
          throw asHttpError(error)
        }
      },
    })
    return sendOutcome(res, req, outcome)
  }))

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error)
    return sendFailure(res, asHttpError(error), req.requestId)
  })

  return { router, aiRuntime }
}
