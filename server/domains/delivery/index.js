import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { DomainError, emit, makeId, nowIso, requirePermission, requireText, resolveContext } from './primitives.js'

const channels = new Set(['sms', 'summary_link', 'mini_program'])
const receiptKinds = new Set(['opened', 'read'])
const dayMs = 24 * 60 * 60 * 1000
const hardMaxSummaryLinkTtlMs = 30 * dayMs

function secureSummaryLinkExpiry({ channel, linkExpiresAt, createdAt, defaultTtlMs, maxTtlMs }) {
  if (channel !== 'summary_link') return linkExpiresAt
  const createdAtMs = Date.parse(createdAt)
  const expiresAtMs = linkExpiresAt ? Date.parse(linkExpiresAt) : createdAtMs + defaultTtlMs
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= createdAtMs || expiresAtMs - createdAtMs > maxTtlMs) {
    throw new DomainError('VALIDATION_FAILED', '安全链接过期时间无效')
  }
  return new Date(expiresAtMs).toISOString()
}

function signingKeyBytes(signingKey) {
  if (typeof signingKey === 'string') signingKey = Buffer.from(signingKey, 'utf8')
  if (!ArrayBuffer.isView(signingKey) || signingKey.byteLength < 32) return null
  return Buffer.from(signingKey.buffer, signingKey.byteOffset, signingKey.byteLength)
}

function createSignedSummaryLinkToken({ deliveryId, expiresAt, nonce, signingKey }) {
  const payload = Buffer.from(JSON.stringify({ deliveryId, expiresAt, nonce }), 'utf8').toString('base64url')
  const signature = createHmac('sha256', signingKey).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function validSummaryLinkToken({ storedHash, linkToken, signingKey, deliveryId, expiresAt }) {
  if (typeof linkToken !== 'string' || !/^[a-f0-9]{64}$/.test(storedHash || '') || !signingKey) return false
  const suppliedHash = createHash('sha256').update(linkToken).digest()
  const expectedHash = Buffer.from(storedHash, 'hex')
  if (suppliedHash.length !== expectedHash.length || !timingSafeEqual(suppliedHash, expectedHash)) return false
  const [payload, suppliedSignature, extraPart] = linkToken.split('.')
  if (!payload || !suppliedSignature || extraPart !== undefined) return false
  const expectedSignature = createHmac('sha256', signingKey).update(payload).digest()
  const suppliedSignatureBytes = Buffer.from(suppliedSignature, 'base64url')
  if (suppliedSignatureBytes.length !== expectedSignature.length || !timingSafeEqual(suppliedSignatureBytes, expectedSignature)) return false
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return claims.deliveryId === deliveryId && claims.expiresAt === expiresAt && typeof claims.nonce === 'string' && claims.nonce.length >= 32
  } catch {
    return false
  }
}

function receiptTimestamp(value, fallback) {
  if (value === undefined) return fallback
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new DomainError('VALIDATION_FAILED', '回执时间无效')
  return new Date(timestamp).toISOString()
}

function sqliteTransaction(db, operation) {
  if (db.isTransaction) return operation()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = operation()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function requireStudentAuthorization(current, studentId) {
  const allowed = typeof current.workspace.canAccessStudent === 'function'
    && current.workspace.canAccessStudent(studentId, current.actor) === true
  if (!allowed) throw new DomainError('PERMISSION_DENIED', '当前工作空间无权访问该学生')
}

export function createLocalDeliveryAdapter({ mode = 'success', name = 'local-recording-adapter' } = {}) {
  if (!['success', 'failure'].includes(mode)) throw new Error('local delivery adapter mode must be success or failure')
  return {
    name,
    async send({ deliveryId, attemptNumber }) {
      const providerMessageId = `${name}:${deliveryId}:${attemptNumber}`
      return mode === 'success'
        ? { ok: true, providerReference: providerMessageId, providerMessageId }
        : { ok: false, providerReference: providerMessageId, failureCode: 'LOCAL_CONFIGURED_FAILURE' }
    }
  }
}

export class DeliveryAdapterError extends Error {
  constructor(message, { outcome = 'unknown', phase = 'unknown', failureCode = 'ADAPTER_ERROR', providerReference = null, providerMessageId = null } = {}) {
    super(message)
    this.name = 'DeliveryAdapterError'
    this.outcome = outcome
    this.phase = phase
    this.failureCode = failureCode
    this.providerReference = providerReference
    this.providerMessageId = providerMessageId
  }
}

export function openPublicSummaryLink({ db, deliveryId, linkToken, summaryLinkSigningKey, clock, idGenerator } = {}) {
  if (!db?.prepare) throw new Error('openPublicSummaryLink requires db.prepare')
  const signingKey = signingKeyBytes(summaryLinkSigningKey)
  if (!signingKey) throw new DomainError('DEPENDENCY_UNAVAILABLE', '安全链接签名密钥未配置')
  const processedAt = nowIso(clock)
  return sqliteTransaction(db, () => {
    const delivery = db.prepare(`
      SELECT
        delivery.id, delivery.status, delivery.channel, delivery.link_expires_at,
        delivery.link_token_hash, delivery.first_opened_at,
        report.id AS report_id, report.status AS report_status,
        version.id AS report_version_id, version.content_json, version.ai_generated,
        version.ai_notice, version.reviewed_at,
        student.display_name AS student_display_name
      FROM report_deliveries AS delivery
      JOIN report_versions AS version ON version.id = delivery.report_version_id
      JOIN reports AS report ON report.id = version.report_id
      JOIN users AS student ON student.id = report.student_id
      WHERE delivery.id = ? AND delivery.channel = 'summary_link'
    `).get(deliveryId)
    if (!delivery || db.prepare('SELECT 1 FROM delivery_link_revocations WHERE delivery_id = ?').get(deliveryId)) {
      throw new DomainError('PERMISSION_DENIED', '安全链接无效或已失效')
    }
    if (!validSummaryLinkToken({ storedHash: delivery.link_token_hash, linkToken, signingKey, deliveryId, expiresAt: delivery.link_expires_at })) {
      throw new DomainError('PERMISSION_DENIED', '安全链接无效或已失效')
    }
    if (delivery.status !== 'sent' || !delivery.reviewed_at) throw new DomainError('VERSION_CONFLICT', '报告尚未完成发送或审核')
    if (delivery.link_expires_at && new Date(delivery.link_expires_at) <= new Date(processedAt)) {
      throw new DomainError('VERSION_CONFLICT', '安全链接已过期')
    }
    if (delivery.first_opened_at) throw new DomainError('VERSION_CONFLICT', '安全链接不可重复打开')
    const updated = db.prepare(`UPDATE report_deliveries SET first_opened_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'sent' AND first_opened_at IS NULL`).run(processedAt, processedAt, deliveryId)
    if (updated.changes !== 1) throw new DomainError('VERSION_CONFLICT', '安全链接已被打开')
    const receiptId = makeId(idGenerator)
    const externalEventId = `summary-link-open:${receiptId}`
    db.prepare(`INSERT INTO delivery_receipts (id, delivery_id, receipt_kind, external_event_id, received_at, created_at, updated_at, version) VALUES (?, ?, 'opened', ?, ?, ?, ?, 1)`).run(receiptId, deliveryId, externalEventId, processedAt, processedAt, processedAt)
    emit(db, null, 'report.delivery_receipt', { deliveryId, receiptId, kind: 'opened' }, { aggregateType: 'report_delivery', aggregateId: deliveryId, dedupeKey: `report.delivery_receipt:${receiptId}`, createdAt: processedAt })
    return {
      deliveryId,
      openedAt: processedAt,
      expiresAt: delivery.link_expires_at,
      student: { displayName: delivery.student_display_name },
      report: {
        id: delivery.report_id,
        versionId: delivery.report_version_id,
        status: delivery.report_status,
        content: JSON.parse(delivery.content_json),
        aiGenerated: Boolean(delivery.ai_generated),
        aiNotice: delivery.ai_notice,
        reviewedAt: delivery.reviewed_at,
      },
    }
  })
}

export function createDeliveryDomain({ db, actor, workspace, outbox, audit, clock, idGenerator, tokenGenerator = () => randomBytes(32).toString('base64url'), claimTokenGenerator = () => randomBytes(16).toString('hex'), claimLeaseMs = 5 * 60 * 1000, transactionRunner, summaryLinkSigningKey, summaryLinkTtlMs = dayMs, maxSummaryLinkTtlMs = 7 * dayMs, miniProgramReceiptVerifier, adapter = createLocalDeliveryAdapter() } = {}) {
  if (!db?.prepare) throw new Error('createDeliveryDomain requires db.prepare')
  if (!Number.isInteger(summaryLinkTtlMs) || !Number.isInteger(maxSummaryLinkTtlMs) || summaryLinkTtlMs <= 0 || summaryLinkTtlMs > maxSummaryLinkTtlMs || maxSummaryLinkTtlMs > hardMaxSummaryLinkTtlMs) throw new Error('invalid summary link TTL configuration')
  if (!Number.isInteger(claimLeaseMs) || claimLeaseMs < 1000 || claimLeaseMs > 15 * 60 * 1000) throw new Error('invalid delivery claim lease configuration')
  const context = () => resolveContext({ actor, workspace })
  const id = () => makeId(idGenerator)
  const now = () => nowIso(clock)
  const signingKey = signingKeyBytes(summaryLinkSigningKey)
  const runInTransaction = transactionRunner || ((operation) => sqliteTransaction(db, operation))
  if (typeof runInTransaction !== 'function') throw new Error('createDeliveryDomain requires a transaction runner')
  const getContact = (contactId, current) => {
    const contact = db.prepare('SELECT * FROM parent_contacts WHERE id = ?').get(contactId)
    if (!contact || contact.organization_id_at_creation !== current.workspace.organizationId || contact.workspace_id_at_creation !== current.workspace.id) throw new DomainError('RESOURCE_NOT_FOUND', '家长联系人不存在')
    requireStudentAuthorization(current, contact.student_id)
    return contact
  }

  return {
    listContacts() {
      const current = context()
      requirePermission(current, 'report.send')
      return db.prepare(`
        SELECT id, student_id, display_name, destination, channel, unsubscribed_at, created_at, updated_at
        FROM parent_contacts
        WHERE organization_id_at_creation = ? AND workspace_id_at_creation = ?
        ORDER BY created_at DESC
      `).all(current.workspace.organizationId, current.workspace.id).filter((contact) => {
        try {
          requireStudentAuthorization(current, contact.student_id)
          return true
        } catch {
          return false
        }
      })
    },

    listDeliveries() {
      const current = context()
      requirePermission(current, 'report.send')
      return db.prepare(`
        SELECT
          delivery.id, delivery.status, delivery.channel, delivery.attempt_count,
          delivery.max_attempts, delivery.link_expires_at, delivery.first_opened_at,
          delivery.first_read_at, delivery.provider_message_id, delivery.last_provider_reference,
          delivery.created_at, delivery.updated_at,
          contact.id AS parent_contact_id, contact.student_id, contact.display_name,
          contact.destination, report.id AS report_id
        FROM report_deliveries AS delivery
        JOIN parent_contacts AS contact ON contact.id = delivery.parent_contact_id
        JOIN report_versions AS version ON version.id = delivery.report_version_id
        JOIN reports AS report ON report.id = version.report_id
        WHERE contact.organization_id_at_creation = ? AND contact.workspace_id_at_creation = ?
          AND report.organization_id_at_creation = ? AND report.workspace_id_at_creation = ?
          AND contact.student_id = report.student_id
        ORDER BY delivery.created_at DESC
      `).all(
        current.workspace.organizationId,
        current.workspace.id,
        current.workspace.organizationId,
        current.workspace.id,
      ).filter((delivery) => {
        try {
          requireStudentAuthorization(current, delivery.student_id)
          return true
        } catch {
          return false
        }
      })
    },

    createContact({ studentId, displayName, destination, channel }) {
      const current = context()
      return runInTransaction(() => {
        requirePermission(current, 'report.send')
        if (!channels.has(channel)) throw new DomainError('VALIDATION_FAILED', '触达渠道无效')
        const authorizedStudentId = requireText(studentId, 'studentId', 120)
        requireStudentAuthorization(current, authorizedStudentId)
        const createdAt = now()
        const contactId = id()
        db.prepare(`INSERT INTO parent_contacts (id, organization_id_at_creation, workspace_id_at_creation, student_id, display_name, destination, channel, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(contactId, current.workspace.organizationId, current.workspace.id, authorizedStudentId, requireText(displayName, 'displayName', 120), requireText(destination, 'destination', 500), channel, createdAt, createdAt)
        audit?.({ eventType: 'parent.contact.created', resourceType: 'parent_contact', resourceId: contactId })
        return { id: contactId, channel, unsubscribedAt: null }
      })
    },

    unsubscribeContact({ contactId }) {
      const current = context()
      requirePermission(current, 'report.send')
      getContact(contactId, current)
      const unsubscribedAt = now()
      db.prepare('UPDATE parent_contacts SET unsubscribed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(unsubscribedAt, unsubscribedAt, contactId)
      db.prepare(`UPDATE report_deliveries SET status = 'unsubscribed', updated_at = ?, version = version + 1 WHERE parent_contact_id = ? AND status IN ('queued', 'retry_scheduled', 'failed')`).run(unsubscribedAt, contactId)
      return { contactId, unsubscribedAt }
    },

    async queueDelivery({ reportVersionId, parentContactId, maxAttempts = 3, linkExpiresAt = null }) {
      const current = context()
      const queued = runInTransaction(() => {
        requirePermission(current, 'report.send')
        if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw new DomainError('VALIDATION_FAILED', '最大重试次数必须在 1 到 3 之间')
        const reportVersion = db.prepare('SELECT r.*, rv.reviewed_at AS target_version_reviewed_at FROM reports r JOIN report_versions rv ON rv.report_id = r.id WHERE rv.id = ?').get(reportVersionId)
        if (!reportVersion || reportVersion.workspace_id_at_creation !== current.workspace.id || reportVersion.organization_id_at_creation !== current.workspace.organizationId) throw new DomainError('RESOURCE_NOT_FOUND', '报告版本不存在或不在当前工作空间')
        requireStudentAuthorization(current, reportVersion.student_id)
        if (!reportVersion.target_version_reviewed_at) throw new DomainError('HUMAN_REVIEW_REQUIRED', '目标报告版本须经人工审核后才能发送')
        const contact = getContact(parentContactId, current)
        if (contact.organization_id_at_creation !== reportVersion.organization_id_at_creation || contact.workspace_id_at_creation !== reportVersion.workspace_id_at_creation || contact.student_id !== reportVersion.student_id) throw new DomainError('VALIDATION_FAILED', '报告、学生、联系人和工作空间归属不一致')
        const createdAt = now()
        const deliveryId = id()
        const effectiveLinkExpiresAt = secureSummaryLinkExpiry({ channel: contact.channel, linkExpiresAt, createdAt, defaultTtlMs: summaryLinkTtlMs, maxTtlMs: maxSummaryLinkTtlMs })
        if (contact.channel === 'summary_link' && !signingKey) throw new DomainError('DEPENDENCY_UNAVAILABLE', '安全链接签名密钥未配置')
        const nonce = contact.channel === 'summary_link' ? tokenGenerator() : null
        if (contact.channel === 'summary_link' && (typeof nonce !== 'string' || nonce.length < 32)) throw new DomainError('DEPENDENCY_UNAVAILABLE', '安全链接随机源不可用')
        const linkToken = contact.channel === 'summary_link' ? createSignedSummaryLinkToken({ deliveryId, expiresAt: effectiveLinkExpiresAt, nonce, signingKey }) : null
        const linkTokenHash = linkToken ? createHash('sha256').update(linkToken).digest('hex') : null
        const status = contact.unsubscribed_at ? 'unsubscribed' : 'queued'
        db.prepare(`INSERT INTO report_deliveries (id, report_version_id, parent_contact_id, channel, status, attempt_count, max_attempts, link_expires_at, link_token_hash, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 1)`).run(deliveryId, reportVersionId, parentContactId, contact.channel, status, maxAttempts, effectiveLinkExpiresAt, linkTokenHash, createdAt, createdAt)
        emit(db, outbox, 'report.delivery_queued', { deliveryId, reportVersionId, parentContactId, workspaceId: current.workspace.id }, { aggregateType: 'report_delivery', aggregateId: deliveryId, dedupeKey: `report.delivery_queued:${deliveryId}`, createdAt })
        audit?.({ eventType: 'report.delivery.queued', resourceType: 'report_delivery', resourceId: deliveryId })
        return { deliveryId, linkToken }
      })
      return { ...this.getDelivery(queued.deliveryId), linkToken: queued.linkToken }
    },

    getDelivery(deliveryId) {
      const current = context()
      const row = db.prepare(`SELECT rd.*, pc.organization_id_at_creation AS contact_organization_id, pc.workspace_id_at_creation AS contact_workspace_id, pc.student_id AS contact_student_id, r.organization_id_at_creation AS report_organization_id, r.workspace_id_at_creation AS report_workspace_id, r.student_id AS report_student_id FROM report_deliveries rd JOIN parent_contacts pc ON pc.id = rd.parent_contact_id JOIN report_versions rv ON rv.id = rd.report_version_id JOIN reports r ON r.id = rv.report_id WHERE rd.id = ?`).get(deliveryId)
      if (!row || row.contact_organization_id !== current.workspace.organizationId || row.contact_workspace_id !== current.workspace.id || row.report_organization_id !== current.workspace.organizationId || row.report_workspace_id !== current.workspace.id || row.contact_student_id !== row.report_student_id) throw new DomainError('RESOURCE_NOT_FOUND', '发送任务不存在')
      requireStudentAuthorization(current, row.report_student_id)
      return row
    },

    async revokeSummaryLink({ deliveryId, reason }) {
      const current = context()
      requirePermission(current, 'report.send')
      const delivery = this.getDelivery(deliveryId)
      if (delivery.channel !== 'summary_link') throw new DomainError('VALIDATION_FAILED', '仅安全链接可以撤销')
      runInTransaction(() => {
        const nextRevokedAt = now()
        db.prepare(`INSERT INTO delivery_link_revocations (id, delivery_id, revoked_by_id, reason, revoked_at, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT(delivery_id) DO NOTHING`).run(id(), deliveryId, current.actor.id, requireText(reason, 'reason', 500), nextRevokedAt, nextRevokedAt, nextRevokedAt)
        emit(db, outbox, 'report.delivery_link_revoked', { deliveryId, workspaceId: current.workspace.id }, { aggregateType: 'report_delivery', aggregateId: deliveryId, dedupeKey: `report.delivery_link_revoked:${deliveryId}`, createdAt: nextRevokedAt })
      })
      const revocation = db.prepare('SELECT revoked_at, reason FROM delivery_link_revocations WHERE delivery_id = ?').get(deliveryId)
      return { deliveryId, revokedAt: revocation.revoked_at, reason: revocation.reason }
    },

    async processDelivery({ deliveryId }) {
      const current = context()
      const claimed = runInTransaction(() => {
        requirePermission(current, 'report.send')
        const delivery = this.getDelivery(deliveryId)
        if (!['queued', 'retry_scheduled'].includes(delivery.status)) throw new DomainError('VERSION_CONFLICT', '发送任务当前不可处理', { status: delivery.status })
        const contact = getContact(delivery.parent_contact_id, current)
        const startedAt = now()
        if (contact.unsubscribed_at) {
          const unsubscribed = db.prepare(`UPDATE report_deliveries SET status = 'unsubscribed', updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND status IN ('queued', 'retry_scheduled')`).run(startedAt, deliveryId, delivery.version)
          if (unsubscribed.changes !== 1) throw new DomainError('VERSION_CONFLICT', '发送任务状态已变化')
          return { terminal: true }
        }
        if (delivery.link_expires_at && new Date(delivery.link_expires_at) <= new Date(startedAt)) {
          const expired = db.prepare(`UPDATE report_deliveries SET status = 'expired', updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND status IN ('queued', 'retry_scheduled')`).run(startedAt, deliveryId, delivery.version)
          if (expired.changes !== 1) throw new DomainError('VERSION_CONFLICT', '发送任务状态已变化')
          return { terminal: true }
        }
        const attemptNumber = delivery.attempt_count + 1
        const claimToken = claimTokenGenerator()
        if (typeof claimToken !== 'string' || claimToken.length < 24) throw new DomainError('DEPENDENCY_UNAVAILABLE', '发送任务领取令牌生成失败')
        const claimExpiresAt = new Date(Date.parse(startedAt) + claimLeaseMs).toISOString()
        const providerIdempotencyKey = `${deliveryId}:${attemptNumber}`
        const claim = db.prepare(`UPDATE report_deliveries SET status = 'sending', attempt_count = ?, claim_token = ?, claim_started_at = ?, claim_expires_at = ?, provider_idempotency_key = ?, reconciliation_status = 'none', updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND status IN ('queued', 'retry_scheduled')`).run(attemptNumber, claimToken, startedAt, claimExpiresAt, providerIdempotencyKey, startedAt, deliveryId, delivery.version)
        if (claim.changes !== 1) throw new DomainError('VERSION_CONFLICT', '发送任务已被其它执行器领取')
        return { terminal: false, delivery, contact, attemptNumber, claimToken, providerIdempotencyKey }
      })
      if (claimed.terminal) return this.getDelivery(deliveryId)
      const { delivery, contact, attemptNumber, claimToken, providerIdempotencyKey } = claimed
      let result
      let adapterError = null
      try {
        result = await adapter.send({ deliveryId, attemptNumber, channel: delivery.channel, destination: contact.destination, providerIdempotencyKey })
      } catch (error) {
        adapterError = error
      }
      const completedAt = now()
      const deterministicFailure = adapterError instanceof DeliveryAdapterError && adapterError.outcome === 'failed' && adapterError.phase === 'before_submit'
      const knownResult = deterministicFailure || (!adapterError && result && typeof result.ok === 'boolean')
      if (!knownResult) {
        const providerReference = adapterError?.providerReference || providerIdempotencyKey
        const providerMessageId = adapterError?.providerMessageId || null
        const failureCode = adapterError?.failureCode || 'ADAPTER_RESULT_UNKNOWN'
        const adapterPhase = adapterError?.phase || 'unknown'
        runInTransaction(() => {
          const frozen = db.prepare(`UPDATE report_deliveries SET status = 'unknown_reconciliation', claim_token = NULL, reconciliation_status = 'unknown', last_provider_reference = ?, provider_message_id = ?, updated_at = ?, version = version + 1 WHERE id = ? AND claim_token = ? AND status = 'sending'`).run(providerReference, providerMessageId, completedAt, deliveryId, claimToken)
          if (frozen.changes !== 1) throw new DomainError('VERSION_CONFLICT', '发送结果冻结冲突，必须人工核对')
          db.prepare(`INSERT INTO delivery_attempts (id, delivery_id, attempt_number, adapter_name, outcome, provider_reference, provider_idempotency_key, provider_message_id, adapter_phase, reconciliation_status, failure_code, created_at, updated_at) VALUES (?, ?, ?, ?, 'unknown', ?, ?, ?, ?, 'pending', ?, ?, ?)`).run(id(), deliveryId, attemptNumber, adapter.name, providerReference, providerIdempotencyKey, providerMessageId, adapterPhase, failureCode, completedAt, completedAt)
          db.prepare(`INSERT INTO delivery_reconciliation_events (id, delivery_id, attempt_number, event_type, provider_idempotency_key, provider_reference, provider_message_id, failure_code, actor_id, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(id(), deliveryId, attemptNumber, adapterPhase === 'after_submit' ? 'adapter_after_submit_unknown' : 'adapter_result_unknown', providerIdempotencyKey, providerReference, providerMessageId, failureCode, current.actor.id, completedAt, completedAt)
          emit(db, outbox, 'report.delivery_unknown', { deliveryId, attemptNumber, providerIdempotencyKey, workspaceId: current.workspace.id }, { aggregateType: 'report_delivery', aggregateId: deliveryId, dedupeKey: `report.delivery_unknown:${deliveryId}:${attemptNumber}`, createdAt: completedAt })
        })
        throw new DomainError('DEPENDENCY_UNAVAILABLE', '发送结果未知，必须先完成对账', { deliveryId, providerIdempotencyKey, reconciliationRequired: true })
      }
      const normalizedResult = deterministicFailure
        ? { ok: false, providerReference: adapterError.providerReference || providerIdempotencyKey, providerMessageId: adapterError.providerMessageId, failureCode: adapterError.failureCode }
        : result
      const providerReference = normalizedResult.providerReference || providerIdempotencyKey
      const providerMessageId = normalizedResult.providerMessageId || null
      const adapterPhase = deterministicFailure ? 'before_submit' : 'provider_result'
      const status = normalizedResult.ok ? 'sent' : (attemptNumber < delivery.max_attempts ? 'retry_scheduled' : 'failed')
      runInTransaction(() => {
        const finalized = db.prepare(`UPDATE report_deliveries SET status = ?, claim_token = NULL, claim_started_at = NULL, claim_expires_at = NULL, reconciliation_status = 'none', last_provider_reference = ?, provider_message_id = ?, updated_at = ?, version = version + 1 WHERE id = ? AND claim_token = ? AND status = 'sending' AND reconciliation_status = 'none'`).run(status, providerReference, providerMessageId, completedAt, deliveryId, claimToken)
        if (finalized.changes !== 1) throw new DomainError('VERSION_CONFLICT', '发送结果落库冲突，必须人工核对')
        db.prepare(`INSERT INTO delivery_attempts (id, delivery_id, attempt_number, adapter_name, outcome, provider_reference, provider_idempotency_key, provider_message_id, adapter_phase, reconciliation_status, failure_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, ?, ?)`).run(id(), deliveryId, attemptNumber, adapter.name, normalizedResult.ok ? 'sent' : 'failed', providerReference, providerIdempotencyKey, providerMessageId, adapterPhase, normalizedResult.failureCode || null, completedAt, completedAt)
        const eventType = normalizedResult.ok ? 'report.delivery_sent' : 'report.delivery_failed'
        emit(db, outbox, eventType, { deliveryId, attemptNumber, status, providerIdempotencyKey, workspaceId: current.workspace.id }, { aggregateType: 'report_delivery', aggregateId: deliveryId, dedupeKey: `${eventType}:${deliveryId}:${attemptNumber}`, createdAt: completedAt })
      })
      return this.getDelivery(deliveryId)
    },

    async markExpiredClaimUnknown({ deliveryId }) {
      const current = context()
      requirePermission(current, 'report.send')
      const delivery = this.getDelivery(deliveryId)
      const checkedAt = now()
      if (delivery.status !== 'sending' || delivery.reconciliation_status !== 'none' || !delivery.claim_expires_at || new Date(delivery.claim_expires_at) > new Date(checkedAt)) throw new DomainError('VERSION_CONFLICT', '发送任务领取尚未过期或已进入对账')
      runInTransaction(() => {
        const marked = db.prepare(`UPDATE report_deliveries SET status = 'unknown_reconciliation', claim_token = NULL, reconciliation_status = 'unknown', updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND status = 'sending' AND reconciliation_status = 'none'`).run(checkedAt, deliveryId, delivery.version)
        if (marked.changes !== 1) throw new DomainError('VERSION_CONFLICT', '发送任务状态已变化')
        db.prepare(`INSERT INTO delivery_attempts (id, delivery_id, attempt_number, adapter_name, outcome, provider_reference, provider_idempotency_key, provider_message_id, adapter_phase, reconciliation_status, failure_code, created_at, updated_at) VALUES (?, ?, ?, ?, 'unknown', ?, ?, ?, 'claim_lease_expired', 'pending', 'CLAIM_LEASE_EXPIRED', ?, ?)`).run(id(), deliveryId, delivery.attempt_count, adapter.name, delivery.last_provider_reference || delivery.provider_idempotency_key, delivery.provider_idempotency_key, delivery.provider_message_id, checkedAt, checkedAt)
        db.prepare(`INSERT INTO delivery_reconciliation_events (id, delivery_id, attempt_number, event_type, provider_idempotency_key, provider_reference, provider_message_id, failure_code, actor_id, created_at, updated_at, version) VALUES (?, ?, ?, 'claim_lease_expired', ?, ?, ?, 'CLAIM_LEASE_EXPIRED', ?, ?, ?, 1)`).run(id(), deliveryId, delivery.attempt_count, delivery.provider_idempotency_key, delivery.last_provider_reference, delivery.provider_message_id, current.actor.id, checkedAt, checkedAt)
        emit(db, outbox, 'report.delivery_unknown', { deliveryId, attemptNumber: delivery.attempt_count, providerIdempotencyKey: delivery.provider_idempotency_key, workspaceId: current.workspace.id }, { aggregateType: 'report_delivery', aggregateId: deliveryId, dedupeKey: `report.delivery_unknown:${deliveryId}:${delivery.attempt_count}`, createdAt: checkedAt })
      })
      return this.getDelivery(deliveryId)
    },

    async reconcileDelivery({ deliveryId, outcome, providerReference, providerMessageId = null, failureCode = null }) {
      const current = context()
      requirePermission(current, 'report.send')
      if (!['sent', 'failed'].includes(outcome)) throw new DomainError('VALIDATION_FAILED', '对账结果无效')
      const delivery = this.getDelivery(deliveryId)
      if (delivery.status !== 'unknown_reconciliation' || delivery.reconciliation_status !== 'unknown') throw new DomainError('VERSION_CONFLICT', '发送任务不在待对账状态')
      const reconciledAt = now()
      const stableProviderReference = providerReference || delivery.last_provider_reference || delivery.provider_idempotency_key
      const stableProviderMessageId = providerMessageId || delivery.provider_message_id
      const status = outcome === 'sent' ? 'sent' : (delivery.attempt_count < delivery.max_attempts ? 'retry_scheduled' : 'failed')
      const reconciliationStatus = outcome === 'sent' ? 'confirmed_sent' : 'confirmed_failed'
      runInTransaction(() => {
        const reconciledAttempt = db.prepare(`UPDATE delivery_attempts SET outcome = ?, provider_reference = ?, provider_message_id = ?, adapter_phase = 'reconciled', reconciliation_status = ?, failure_code = ?, updated_at = ? WHERE delivery_id = ? AND attempt_number = ? AND outcome = 'unknown' AND reconciliation_status = 'pending'`).run(outcome, stableProviderReference, stableProviderMessageId, reconciliationStatus, failureCode, reconciledAt, deliveryId, delivery.attempt_count)
        if (reconciledAttempt.changes !== 1) throw new DomainError('VERSION_CONFLICT', '发送尝试对账状态已变化')
        const reconciled = db.prepare(`UPDATE report_deliveries SET status = ?, claim_token = NULL, claim_started_at = NULL, claim_expires_at = NULL, reconciliation_status = ?, last_provider_reference = ?, provider_message_id = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND status = 'unknown_reconciliation' AND reconciliation_status = 'unknown'`).run(status, reconciliationStatus, stableProviderReference, stableProviderMessageId, reconciledAt, deliveryId, delivery.version)
        if (reconciled.changes !== 1) throw new DomainError('VERSION_CONFLICT', '发送任务对账状态已变化')
        db.prepare(`INSERT INTO delivery_reconciliation_events (id, delivery_id, attempt_number, event_type, provider_idempotency_key, provider_reference, provider_message_id, failure_code, actor_id, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(id(), deliveryId, delivery.attempt_count, `reconciled_${outcome}`, delivery.provider_idempotency_key, stableProviderReference, stableProviderMessageId, failureCode, current.actor.id, reconciledAt, reconciledAt)
        emit(db, outbox, 'report.delivery_reconciled', { deliveryId, attemptNumber: delivery.attempt_count, outcome, status, providerIdempotencyKey: delivery.provider_idempotency_key, workspaceId: current.workspace.id }, { aggregateType: 'report_delivery', aggregateId: deliveryId, dedupeKey: `report.delivery_reconciled:${deliveryId}:${delivery.attempt_count}:${outcome}`, createdAt: reconciledAt })
      })
      return this.getDelivery(deliveryId)
    },

    async recordReceipt({ deliveryId, kind, externalEventId, receivedAt, linkToken, verification }) {
      const current = context()
      const delivery = this.getDelivery(deliveryId)
      if (!receiptKinds.has(kind)) throw new DomainError('VALIDATION_FAILED', '回执类型无效')
      const eventId = requireText(externalEventId, 'externalEventId', 300)
      const processedAt = now()
      const receivedTimestamp = receiptTimestamp(receivedAt, processedAt)
      if (delivery.channel === 'sms') throw new DomainError('VALIDATION_FAILED', '纯短信不支持打开或已读回执')
      if (delivery.channel === 'summary_link') {
        if (db.prepare('SELECT 1 FROM delivery_link_revocations WHERE delivery_id = ?').get(deliveryId)) throw new DomainError('PERMISSION_DENIED', '安全链接已撤销')
        if (!validSummaryLinkToken({ storedHash: delivery.link_token_hash, linkToken, signingKey, deliveryId, expiresAt: delivery.link_expires_at })) throw new DomainError('PERMISSION_DENIED', '安全链接令牌无效')
      }
      if (delivery.channel === 'mini_program') {
        if (typeof miniProgramReceiptVerifier !== 'function') throw new DomainError('PERMISSION_DENIED', '小程序回执未通过验证')
        let verified = false
        try {
          verified = await miniProgramReceiptVerifier({ deliveryId, kind, externalEventId: eventId, receivedAt: receivedTimestamp, verification })
        } catch {
          verified = false
        }
        if (!verified) throw new DomainError('PERMISSION_DENIED', '小程序回执未通过验证')
      }
      if (delivery.status !== 'sent') throw new DomainError('VERSION_CONFLICT', '仅已发送任务可接收回执')
      if (delivery.link_expires_at && new Date(delivery.link_expires_at) <= new Date(processedAt)) {
        db.prepare(`UPDATE report_deliveries SET status = 'expired', updated_at = ?, version = version + 1 WHERE id = ?`).run(processedAt, deliveryId)
        throw new DomainError('VERSION_CONFLICT', '安全链接已过期')
      }
      if (delivery.channel === 'summary_link' && kind === 'opened' && delivery.first_opened_at) throw new DomainError('VERSION_CONFLICT', '安全链接不可重复打开')
      const exists = db.prepare('SELECT id FROM delivery_receipts WHERE delivery_id = ? AND external_event_id = ?').get(deliveryId, eventId)
      if (exists) return { accepted: true, duplicate: true, delivery: this.getDelivery(deliveryId) }
      const createdAt = processedAt
      db.prepare(`INSERT INTO delivery_receipts (id, delivery_id, receipt_kind, external_event_id, received_at, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`).run(id(), deliveryId, kind, eventId, receivedTimestamp, createdAt, createdAt)
      const openedAt = kind === 'opened' && !delivery.first_opened_at ? receivedTimestamp : delivery.first_opened_at
      const readAt = kind === 'read' && !delivery.first_read_at ? receivedTimestamp : delivery.first_read_at
      db.prepare('UPDATE report_deliveries SET first_opened_at = ?, first_read_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(openedAt, readAt, createdAt, deliveryId)
      return { accepted: true, duplicate: false, delivery: this.getDelivery(deliveryId) }
    }
  }
}
