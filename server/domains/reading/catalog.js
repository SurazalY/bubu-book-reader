import { createHash } from 'node:crypto'
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
} from './sql.js'
import {
  closeReadingSummarySessionsForLease,
  findLatestLeaseSession,
  isReadingLeaseWorkStale,
} from './monitoring.js'

const MAX_EVENT_SECONDS = 120
const DEFAULT_MAX_OFFLINE_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_CONFIGURABLE_OFFLINE_AGE_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_FUTURE_CLOCK_SKEW_MS = 2 * 60 * 1000
const MAX_CONFIGURABLE_FUTURE_CLOCK_SKEW_MS = 10 * 60 * 1000
const DEFAULT_OFFLINE_LEASE_GRACE_MS = 5 * 60 * 1000
const MAX_CONFIGURABLE_OFFLINE_LEASE_GRACE_MS = 30 * 60 * 1000
const SUPPORTED_ASSET_TYPES = new Set(['source_pdf', 'source_epub', 'source_text', 'cover', 'page_image'])
const PACKAGE_QUALITY_STATUSES = new Set(['human-review-pending', 'human-review-failed', 'passed', 'trusted-baseline'])
// D1：可发布的 book-package/v2 质量状态 —— 人工闸门通过，或 OCR 按可信基线验收。
const PUBLISHABLE_PACKAGE_QUALITY_STATUSES = new Set(['passed', 'trusted-baseline'])
const EVENT_TOP_LEVEL_FIELDS = new Set([
  'id', 'schemaVersion', 'deviceId', 'bookVersionId', 'pageNo', 'eventType', 'clientOccurredAt',
  'durationMs', 'foreground', 'screenOn', 'offlineSequence', 'classSessionId', 'payload',
])
const EVENT_PAYLOAD_FIELDS = new Map([
  ['page_stay', new Set(['blockId'])],
  ['page_turn', new Set(['fromPageNo', 'direction', 'blockId'])],
  ['selection', new Set(['selectionId', 'blockIds', 'selectionRange', 'textHash'])],
  ['bookmark', new Set(['bookmarkId', 'blockId', 'operation'])],
  ['annotation', new Set(['annotationId', 'blockIds', 'selectionRange', 'contentHash', 'operation'])],
  ['ai_question', new Set(['questionId', 'conversationId', 'messageId', 'questionHash', 'blockIds', 'selectionRange'])],
  ['class_sync', new Set(['syncSequence', 'controlDeviceId', 'lockedBookVersionId'])],
])

export function createReadingDomain(dependencies) {
  const context = createDomainContext(dependencies)
  const maxOfflineAgeMs = boundedIntegerConfig(
    dependencies.maxOfflineAgeMs, DEFAULT_MAX_OFFLINE_AGE_MS, 60 * 1000,
    MAX_CONFIGURABLE_OFFLINE_AGE_MS, 'maxOfflineAgeMs',
  )
  const futureClockSkewMs = boundedIntegerConfig(
    dependencies.futureClockSkewMs, DEFAULT_FUTURE_CLOCK_SKEW_MS, 0,
    MAX_CONFIGURABLE_FUTURE_CLOCK_SKEW_MS, 'futureClockSkewMs',
  )
  const offlineLeaseGraceMs = boundedIntegerConfig(
    dependencies.offlineLeaseGraceMs, DEFAULT_OFFLINE_LEASE_GRACE_MS, 0,
    MAX_CONFIGURABLE_OFFLINE_LEASE_GRACE_MS, 'offlineLeaseGraceMs',
  )
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

  return {
    async createBookVersion(input) {
      await authorize('book.import')
      const pages = Array.isArray(input.pages) ? input.pages : []
      if (pages.length === 0) throw new TypeError('书籍版本至少需要一页')
      uniqueRows(pages, 'pageNo')
      const now = isoNow(context)
      const bookId = input.bookId || context.idFactory()
      const versionId = input.versionId || context.idFactory()
      const title = assertString(input.title, 'title')
      const label = assertString(input.label, 'label')
      const sourceFormat = assertString(input.sourceFormat, 'sourceFormat')
      if (!['pdf', 'epub', 'text'].includes(sourceFormat)) throw new TypeError('sourceFormat 必须为 pdf、epub 或 text')
      const packageMetadata = normalizePackageMetadata(input.packageMetadata, sourceFormat)
      const catalogGrade = normalizeCatalogGrade(input.catalogGrade)
      const preparedAssets = await prepareAssets(input, pages, dependencies.assetMetadataVerifier)
      const metadata = input.metadata ? {
        author: assertString(input.metadata.author, 'metadata.author'),
        illustrator: input.metadata.illustrator ? assertString(input.metadata.illustrator, 'metadata.illustrator') : null,
        sourcePage: assertString(input.metadata.sourcePage, 'metadata.sourcePage'),
        usageLabel: assertString(input.metadata.usageLabel, 'metadata.usageLabel'),
        rightsJson: JSON.stringify(input.metadata.rights || {}),
      } : null

      transaction(context.db, () => {
        run(context.db, `INSERT INTO books (id, organization_id_at_creation, actor_id_at_creation, title, status, created_at, updated_at, version)
          VALUES (:id, :organizationId, :actorId, :title, 'draft', :now, :now, 1)`, {
          id: bookId, organizationId: organizationId(), actorId: actorId(), title, now,
        })
        run(context.db, `INSERT INTO book_versions (
            id, book_id, organization_id_at_creation, actor_id_at_creation, label, source_format,
            page_count, package_format, release_sha256, normalization_version,
            package_quality_status, content_provenance_json, created_at, updated_at, version
          ) VALUES (
            :id, :bookId, :organizationId, :actorId, :label, :sourceFormat,
            :pageCount, :packageFormat, :releaseSha256, :normalizationVersion,
            :packageQualityStatus, :contentProvenanceJson, :now, :now, 1
          )`, {
          id: versionId, bookId, organizationId: organizationId(), actorId: actorId(), label, sourceFormat,
          pageCount: pages.length, ...packageMetadata, now,
        })
        if (metadata) {
          run(context.db, `INSERT INTO book_catalog_metadata (
            book_id, author, illustrator, source_page, usage_label, rights_json,
            created_at, updated_at, version
          ) VALUES (
            :bookId, :author, :illustrator, :sourcePage, :usageLabel, :rightsJson,
            :now, :now, 1
          )`, { bookId, ...metadata, now })
        }
        if (catalogGrade !== null) {
          run(context.db, `INSERT INTO book_catalog_metadata (book_id, grade, created_at, updated_at, version)
            VALUES (:bookId, :grade, :now, :now, 1)
            ON CONFLICT(book_id) DO UPDATE SET grade = excluded.grade,
              updated_at = excluded.updated_at, version = book_catalog_metadata.version + 1`, {
            bookId, grade: catalogGrade, now,
          })
        }
        const pageIds = new Map()
        for (const page of pages) pageIds.set(page.pageNo, insertPage(context, versionId, page, now))
        for (const asset of preparedAssets) {
          insertAsset(context, versionId, asset.pageNo ? pageIds.get(asset.pageNo) : null, asset, now)
        }
      })
      await context.audit({ eventType: 'book.imported', actorId: actorId(), workspaceId: workspaceId(), resourceId: bookId })
      return { bookId, versionId }
    },

    async listBooks(input = {}) {
      await authorize('book.read')
      const status = input.status || 'published'
      if (!['draft', 'published', 'archived'].includes(status)) throw new TypeError('status 无效')
      const books = all(context.db, `SELECT b.*, v.id AS book_version_id, v.label AS version_label,
          v.source_format, v.page_count, metadata.author, metadata.illustrator,
          metadata.source_page, metadata.usage_label AS catalog_usage_label, metadata.rights_json,
          metadata.grade
        FROM books b
        JOIN book_versions v ON v.id = (
          SELECT latest.id FROM book_versions latest
          WHERE latest.book_id = b.id AND latest.organization_id_at_creation = :organizationId
          ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
        )
        LEFT JOIN book_catalog_metadata AS metadata ON metadata.book_id = b.id
        WHERE b.organization_id_at_creation = :organizationId AND b.status = :status
        ORDER BY b.created_at DESC, b.id`, { organizationId: organizationId(), status })
      return books.map((book) => {
        const assets = all(context.db, `SELECT id, asset_type, storage_key, usage_label, mime_type,
            size_bytes, sha256, width, height
          FROM book_assets WHERE book_version_id = :bookVersionId
            AND page_id IS NULL AND asset_type IN ('source_pdf', 'source_epub', 'source_text', 'cover')
          ORDER BY CASE asset_type WHEN 'source_pdf' THEN 0 WHEN 'source_epub' THEN 0
            WHEN 'source_text' THEN 0 ELSE 1 END, created_at, id`, { bookVersionId: book.book_version_id })
        return { ...book, assets, cover: assets.find((asset) => asset.asset_type === 'cover') || null }
      })
    },

    async getBookVersionAssets(bookVersionId) {
      const normalizedVersionId = assertString(bookVersionId, 'bookVersionId')
      await authorize('book.read', { bookVersionId: normalizedVersionId })
      requireScopedBookVersion(context.db, normalizedVersionId, organizationId(), true)
      return all(context.db, `SELECT a.id, a.asset_type, a.storage_key, a.usage_label, a.mime_type, a.size_bytes, a.sha256,
          a.width, a.height, a.page_id, p.page_no
        FROM book_assets a
        JOIN book_versions v ON v.id = a.book_version_id
        JOIN books b ON b.id = v.book_id
        LEFT JOIN book_pages p ON p.id = a.page_id AND p.book_version_id = v.id
        WHERE a.book_version_id = :bookVersionId AND v.organization_id_at_creation = :organizationId
          AND b.organization_id_at_creation = :organizationId AND b.status = 'published'
        ORDER BY CASE a.asset_type WHEN 'source_pdf' THEN 0 WHEN 'source_epub' THEN 0
          WHEN 'source_text' THEN 0 WHEN 'cover' THEN 1 ELSE 2 END, p.page_no, a.id`, {
        bookVersionId: normalizedVersionId, organizationId: organizationId(),
      })
    },

    async getBookAsset(assetId) {
      const normalizedAssetId = assertString(assetId, 'assetId')
      await authorize('book.read', { assetId: normalizedAssetId })
      const asset = one(context.db, `SELECT asset.*, version.book_id
        FROM book_assets AS asset
        JOIN book_versions AS version ON version.id = asset.book_version_id
        JOIN books AS book ON book.id = version.book_id
        WHERE asset.id = :assetId
          AND version.organization_id_at_creation = :organizationId
          AND book.organization_id_at_creation = :organizationId
          AND book.status = 'published'`, { assetId: normalizedAssetId, organizationId: organizationId() })
      if (!asset) throw scopedResourceNotFound('书籍资产不存在或当前不可读取')
      return asset
    },

    async getPage(bookId, pageNo, bookVersionId = null) {
      await authorize('book.read', { bookId, bookVersionId })
      const pageNumber = assertPositiveInteger(pageNo, 'pageNo')
      const page = one(context.db, `SELECT p.*, v.book_id FROM book_pages p
        JOIN book_versions v ON v.id = p.book_version_id
        JOIN books b ON b.id = v.book_id
        WHERE v.book_id = :bookId AND p.page_no = :pageNo AND b.status = 'published'
          AND b.organization_id_at_creation = :organizationId
          AND (:bookVersionId IS NULL OR v.id = :bookVersionId)
        ORDER BY v.created_at DESC, v.id DESC
        LIMIT 1`, { bookId, pageNo: pageNumber, organizationId: organizationId(), bookVersionId })
      if (!page) {
        const error = new Error('书页不存在或当前不可读取')
        error.code = 'RESOURCE_NOT_FOUND'
        throw error
      }
      return { ...page, blocks: all(context.db, 'SELECT * FROM book_blocks WHERE page_id = :pageId ORDER BY char_start, block_key', { pageId: page.id }) }
    },

    async publishBook(bookId) {
      await authorize('book.publish', { bookId })
      const now = isoNow(context)
      const latest = one(context.db, `SELECT version.* FROM book_versions AS version
        JOIN books AS book ON book.id = version.book_id
        WHERE version.book_id = :bookId
          AND version.organization_id_at_creation = :organizationId
          AND book.organization_id_at_creation = :organizationId
        ORDER BY version.created_at DESC, version.id DESC LIMIT 1`, {
        bookId, organizationId: organizationId(),
      })
      if (latest?.package_format === 'book-package/v2') {
        if (!PUBLISHABLE_PACKAGE_QUALITY_STATUSES.has(latest.package_quality_status)) {
          const error = new Error('book-package/v2 尚未通过人工质量闸门，也不是可信基线包')
          error.code = 'HUMAN_REVIEW_REQUIRED'
          throw error
        }
        const sourcePdf = one(context.db, `SELECT id FROM book_assets
          WHERE book_version_id = :versionId AND page_id IS NULL AND asset_type = 'source_pdf'
          LIMIT 1`, { versionId: latest.id })
        if (!sourcePdf) throw validationFailed('book-package/v2 发布前必须登记源 PDF 资产')
      }
      const result = run(context.db, `UPDATE books SET status = 'published', updated_at = :now, version = version + 1
        WHERE id = :bookId AND organization_id_at_creation = :organizationId AND status = 'draft'`, {
        bookId, organizationId: organizationId(), now,
      })
      if (result.changes !== 1) throw scopedResourceNotFound('书籍不存在于当前组织或不是可发布草稿')
      await context.audit({ eventType: 'book.published', actorId: actorId(), workspaceId: workspaceId(), resourceId: bookId })
    },

    async archiveBook(bookId) {
      await authorize('book.archive', { bookId })
      const now = isoNow(context)
      transaction(context.db, () => {
        const book = one(context.db, `SELECT * FROM books
          WHERE id = :bookId AND organization_id_at_creation = :organizationId`, { bookId, organizationId: organizationId() })
        if (!book) throw scopedResourceNotFound('书籍不存在于当前组织')
        const versions = all(context.db, `SELECT * FROM book_versions
          WHERE book_id = :bookId AND organization_id_at_creation = :organizationId`, { bookId, organizationId: organizationId() })
        for (const version of versions) {
          const history = one(context.db, 'SELECT id FROM reading_events WHERE book_version_id = :versionId LIMIT 1', { versionId: version.id })
          if (history) {
            const pages = all(context.db, 'SELECT id, page_no, text_content, width, height FROM book_pages WHERE book_version_id = :versionId ORDER BY page_no', { versionId: version.id })
            run(context.db, `INSERT INTO book_hidden_evidence_snapshots (id, book_id, book_version_id, snapshot_json, hidden_at, organization_id_at_creation, actor_id_at_creation, created_at, updated_at, version)
              VALUES (:id, :bookId, :versionId, :snapshotJson, :now, :organizationId, :actorId, :now, :now, 1)
              ON CONFLICT(book_version_id) DO NOTHING`, {
              id: context.idFactory(), bookId, versionId: version.id, snapshotJson: JSON.stringify({ book, version, pages }), now,
              organizationId: organizationId(), actorId: actorId(),
            })
          }
        }
        run(context.db, `UPDATE books SET status = 'archived', updated_at = :now, version = version + 1
          WHERE id = :bookId AND organization_id_at_creation = :organizationId`, { bookId, organizationId: organizationId(), now })
      })
      await context.audit({ eventType: 'book.archived', actorId: actorId(), workspaceId: workspaceId(), resourceId: bookId })
    },

    async acquireLease(input) {
      await authorize('reading.read_self', { bookVersionId: input.bookVersionId })
      const deviceId = assertString(input.deviceId, 'deviceId')
      const bookVersionId = assertString(input.bookVersionId, 'bookVersionId')
      requireScopedBookVersion(context.db, bookVersionId, organizationId())
      const nowDate = context.now()
      const now = nowDate.toISOString()
      const expiresAt = new Date(nowDate.getTime() + 90 * 1000).toISOString()
      const lease = transaction(context.db, () => {
        const expired = all(context.db, `SELECT * FROM active_reading_leases
          WHERE actor_id = :actorId AND released_at IS NULL AND expires_at <= :now`, { actorId: actorId(), now })
        for (const expiredLease of expired) {
          closeLeaseHistory(context, expiredLease.id, expiredLease.expires_at, now, 'lease_ended')
          closeReadingSummarySessionsForLease(context.db, {
            leaseId: expiredLease.id,
            endedAt: expiredLease.expires_at,
            endReason: 'lease_ended',
            updatedAt: now,
          })
        }
        run(context.db, `UPDATE active_reading_leases SET released_at = :now, updated_at = :now, version = version + 1
          WHERE actor_id = :actorId AND released_at IS NULL AND expires_at <= :now`, { actorId: actorId(), now })
        const active = one(context.db, `SELECT * FROM active_reading_leases
          WHERE actor_id = :actorId AND released_at IS NULL AND expires_at > :now`, { actorId: actorId(), now })
        if (active && active.device_id !== deviceId) {
          const leaseSession = findLatestLeaseSession(context.db, {
            leaseId: active.id,
            organizationId: organizationId(),
            actorId: actorId(),
          })
          const stale = isReadingLeaseWorkStale(active, leaseSession, nowDate.getTime())
          if (!stale && leaseSession) {
            const error = new Error('另一台阅读设备仍在活跃提交，不能抢占')
            error.code = 'READING_LEASE_HELD'
            throw error
          }
          if (!stale && !leaseSession && !input.takeover) {
            const error = new Error('另一台阅读设备仍持有租约，请显式接管')
            error.code = 'READING_LEASE_HELD'
            throw error
          }
        }
        if (active && active.device_id === deviceId) {
          const currentHistory = one(context.db, `SELECT * FROM reading_device_lease_history
            WHERE lease_id = :leaseId ORDER BY valid_from DESC, id DESC LIMIT 1`, { leaseId: active.id })
          const sameHistoryScope = currentHistory
            && currentHistory.organization_id === organizationId()
            && currentHistory.workspace_id === workspaceId()
            && currentHistory.actor_id === actorId()
            && currentHistory.device_id === deviceId
            && currentHistory.book_version_id === bookVersionId
          if (sameHistoryScope) {
            closeReadingSummarySessionsForLease(context.db, {
              leaseId: active.id,
              endedAt: now,
              endReason: 'lease_taken_over',
              updatedAt: now,
            })
            return { leaseId: active.id, expiresAt: active.expires_at, takeover: false }
          }
          run(context.db, `UPDATE active_reading_leases
            SET released_at = :now, updated_at = :now, version = version + 1
            WHERE id = :id`, { id: active.id, now })
          closeLeaseHistory(context, active.id, now, now, 'lease_taken_over')
          closeReadingSummarySessionsForLease(context.db, {
            leaseId: active.id,
            endedAt: now,
            endReason: 'lease_taken_over',
            updatedAt: now,
          })
        }
        if (active && active.device_id !== deviceId) {
          run(context.db, `UPDATE active_reading_leases SET released_at = :now, updated_at = :now, version = version + 1 WHERE id = :id`, { id: active.id, now })
          closeLeaseHistory(context, active.id, now, now, 'lease_taken_over')
          closeReadingSummarySessionsForLease(context.db, {
            leaseId: active.id,
            endedAt: now,
            endReason: 'lease_taken_over',
            updatedAt: now,
          })
        }
        const leaseId = context.idFactory()
        run(context.db, `INSERT INTO active_reading_leases (id, actor_id, workspace_id, device_id, book_version_id, acquired_at, expires_at, created_at, updated_at, version)
          VALUES (:id, :actorId, :workspaceId, :deviceId, :bookVersionId, :now, :expiresAt, :now, :now, 1)`, {
          id: leaseId, actorId: actorId(), workspaceId: workspaceId(), deviceId, bookVersionId, now, expiresAt,
        })
        insertLeaseHistory(context, leaseId, organizationId(), workspaceId(), actorId(), deviceId, bookVersionId, now, expiresAt)
        return { leaseId, expiresAt, takeover: false }
      })
      const latestSequence = one(context.db, `SELECT COALESCE(MAX(offline_sequence), 0) AS value
        FROM reading_events
        WHERE organization_id_at_creation = :organizationId
          AND actor_id_at_creation = :actorId
          AND device_id = :deviceId`, {
        organizationId: organizationId(),
        actorId: actorId(),
        deviceId,
      })
      return {
        ...lease,
        nextOfflineSequence: Number(latestSequence?.value || 0) + 1,
      }
    },

    async takeOverLease(input) {
      const result = await this.acquireLease({ ...input, takeover: true })
      return { ...result, takeover: true }
    },

    async ingestEventsBatch(input) {
      await authorize('reading.read_self')
      const events = Array.isArray(input.events) ? input.events : []
      if (events.length === 0) throw new TypeError('events 不能为空')
      uniqueRows(events, 'id')
      const result = transaction(context.db, () => {
        const accepted = []
        const replayed = []
        for (const event of events) {
          const eventId = assertString(event.id, 'event.id')
          const normalized = normalizeEvent(event)
          const fingerprint = eventFingerprint(normalized, {
            actorId: actorId(), organizationId: organizationId(), workspaceId: workspaceId(),
          })
          const known = one(context.db, 'SELECT * FROM reading_events WHERE id = :id', { id: eventId })
          if (known) {
            const sameScope = known.actor_id_at_creation === actorId()
              && known.workspace_id_at_creation === workspaceId()
              && known.organization_id_at_creation === organizationId()
            if (sameScope && known.event_fingerprint === fingerprint) {
              replayed.push(eventId)
              continue
            }
            throw idempotencyConflict(eventId, '事件 ID 已存在，但作用域或规范化载荷不一致')
          }
          requireScopedBookVersion(context.db, normalized.bookVersionId, organizationId())
          validateEventTimeAndLease(context, normalized, {
            actorId: actorId(), organizationId: organizationId(), workspaceId: workspaceId(),
            maxOfflineAgeMs, futureClockSkewMs, offlineLeaseGraceMs,
          })
          const sequenceOwner = one(context.db, `SELECT id FROM reading_events
            WHERE organization_id_at_creation = :organizationId AND actor_id_at_creation = :actorId
              AND device_id = :deviceId AND offline_sequence = :offlineSequence`, {
            organizationId: organizationId(), actorId: actorId(), deviceId: normalized.deviceId,
            offlineSequence: normalized.offlineSequence,
          })
          if (sequenceOwner) throw idempotencyConflict(eventId, '同一作用域、设备和离线序号已绑定其他事件 ID')
          const metrics = deriveMetrics(normalized)
          const receivedAt = isoNow(context)
          run(context.db, `INSERT INTO reading_events (id, organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation, device_id, book_version_id, page_no, event_type, client_occurred_at, received_at, foreground, screen_on, offline_sequence, event_fingerprint, payload_json, valid_reading_seconds, valid_eye_seconds, created_at, updated_at, version)
            VALUES (:id, :organizationId, :actorId, :workspaceId, :deviceId, :bookVersionId, :pageNo, :eventType, :clientOccurredAt, :receivedAt, :foreground, :screenOn, :offlineSequence, :fingerprint, :payloadJson, :validReadingSeconds, :validEyeSeconds, :receivedAt, :receivedAt, 1)`, {
            id: eventId, organizationId: organizationId(), actorId: actorId(), workspaceId: workspaceId(), receivedAt, fingerprint,
            deviceId: normalized.deviceId, bookVersionId: normalized.bookVersionId, pageNo: normalized.pageNo,
            eventType: normalized.eventType, clientOccurredAt: normalized.clientOccurredAt,
            foreground: normalized.foreground, screenOn: normalized.screenOn,
            offlineSequence: normalized.offlineSequence, payloadJson: normalized.payloadJson, ...metrics,
          })
          accepted.push(eventId)
        }
        const recalculatedAt = isoNow(context)
        if (accepted.length > 0) recomputeEyeCare(context, actorId(), workspaceId(), recalculatedAt)
        return { accepted, replayed }
      })
      await context.audit({ eventType: 'reading.events.ingested', actorId: actorId(), workspaceId: workspaceId(), resourceId: actorId(), outcome: result })
      return result
    },

    async getEyeCareStatus() {
      await authorize('reading.read_self')
      const now = context.now()
      const dayStart = shanghaiWindowStart(now, 'day')
      const weekStart = shanghaiWindowStart(now, 'week')
      const state = one(context.db, `SELECT continuous_eye_seconds, last_active_at FROM eye_care_states
        WHERE actor_id = :actorId AND workspace_id = :workspaceId`, { actorId: actorId(), workspaceId: workspaceId() })
      return {
        dayWindowStart: dayStart.toISOString(),
        weekWindowStart: weekStart.toISOString(),
        dailyValidEyeSeconds: usageFor(context.db, actorId(), workspaceId(), 'day', dayStart),
        weeklyValidEyeSeconds: usageFor(context.db, actorId(), workspaceId(), 'week', weekStart),
        continuousEyeSeconds: state?.continuous_eye_seconds || 0,
      }
    },
  }
}

function insertPage(context, versionId, page, now) {
  const pageNo = assertPositiveInteger(page.pageNo, 'page.pageNo')
  const width = Number(page.width)
  const height = Number(page.height)
  if (!(width > 0 && height > 0)) throw new TypeError('page.width 和 page.height 必须大于 0')
  const pageId = page.id || context.idFactory()
  const normalizedText = typeof page.normalizedText === 'string'
    ? page.normalizedText
    : typeof page.textContent === 'string' ? page.textContent : ''
  const rawText = typeof page.rawText === 'string' ? page.rawText : normalizedText
  run(context.db, `INSERT INTO book_pages (
      id, book_version_id, page_no, text_content, width, height, raw_text, normalized_text, printed_page_label,
      created_at, updated_at, version
    ) VALUES (
      :id, :versionId, :pageNo, :normalizedText, :width, :height, :rawText, :normalizedText, :printedPageLabel,
      :now, :now, 1
    )`, {
    id: pageId,
    versionId,
    pageNo,
    rawText,
    normalizedText,
    printedPageLabel: page.printedPageLabel == null ? null : assertString(page.printedPageLabel, 'page.printedPageLabel'),
    width,
    height,
    now,
  })
  const blocks = Array.isArray(page.blocks) ? page.blocks : []
  uniqueRows(blocks, 'blockKey')
  for (const block of blocks) {
    const coordinates = ['x', 'y', 'width', 'height'].reduce((result, key) => ({ ...result, [key]: Number(block[key]) }), {})
    if (coordinates.x < 0 || coordinates.y < 0 || coordinates.width < 0 || coordinates.height < 0) throw new TypeError('文字坐标不能为负数')
    const normalizedBlockText = typeof block.normalizedText === 'string'
      ? block.normalizedText
      : typeof block.textContent === 'string' ? block.textContent : ''
    const rawBlockText = typeof block.rawText === 'string' ? block.rawText : normalizedBlockText
    const sourceGeometryJson = block.sourceGeometry == null ? null : JSON.stringify(block.sourceGeometry)
    const geometryUsage = block.geometryUsage ?? null
    const blockParameters = {
      id: block.id || context.idFactory(), pageId, blockKey: assertString(block.blockKey, 'block.blockKey'), paragraphId: block.paragraphId || null,
      rawBlockText, normalizedBlockText, charStart: Number.isInteger(block.charStart) ? block.charStart : 0,
      charEnd: Number.isInteger(block.charEnd) ? block.charEnd : 0,
      sourceConfidence: block.sourceConfidence == null ? null : Number(block.sourceConfidence),
      sourceGeometryJson, geometryUsage, ...coordinates, now,
    }
    run(context.db, `INSERT INTO book_blocks (
        id, page_id, block_key, paragraph_id, text_content, char_start, char_end,
        x, y, width, height, raw_text, normalized_text, source_confidence,
        source_geometry_json, geometry_usage, created_at, updated_at, version
      ) VALUES (
        :id, :pageId, :blockKey, :paragraphId, :normalizedBlockText, :charStart, :charEnd,
        :x, :y, :width, :height, :rawBlockText, :normalizedBlockText, :sourceConfidence,
        :sourceGeometryJson, :geometryUsage, :now, :now, 1
      )`, blockParameters)
  }
  return pageId
}

function normalizeCatalogGrade(value) {
  if (value === undefined || value === null) return null
  if (!Number.isInteger(value) || value < 1 || value > 6) throw new TypeError('catalogGrade 必须是 1 到 6 的整数')
  return value
}

function normalizePackageMetadata(value, sourceFormat) {
  if (value == null) {
    return {
      packageFormat: null,
      releaseSha256: null,
      normalizationVersion: null,
      packageQualityStatus: null,
      contentProvenanceJson: null,
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('packageMetadata 必须是对象')
  const allowed = new Set(['format', 'releaseSha256', 'normalizationVersion', 'qualityStatus', 'provenance'])
  const unknown = Object.keys(value).filter((field) => !allowed.has(field))
  if (unknown.length) throw new TypeError(`packageMetadata 包含未知字段: ${unknown.join(', ')}`)
  if (value.format !== 'book-package/v2' || sourceFormat !== 'pdf') throw new TypeError('book-package/v2 只接受 PDF 源格式')
  const releaseSha256 = assertString(value.releaseSha256, 'packageMetadata.releaseSha256').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(releaseSha256)) throw new TypeError('packageMetadata.releaseSha256 必须是 64 位小写十六进制')
  const normalizationVersion = assertString(value.normalizationVersion, 'packageMetadata.normalizationVersion')
  const packageQualityStatus = assertString(value.qualityStatus, 'packageMetadata.qualityStatus')
  if (!PACKAGE_QUALITY_STATUSES.has(packageQualityStatus)) {
    throw new TypeError('packageMetadata.qualityStatus 无效')
  }
  if (!value.provenance || typeof value.provenance !== 'object' || Array.isArray(value.provenance)) {
    throw new TypeError('packageMetadata.provenance 必须是对象')
  }
  return {
    packageFormat: value.format,
    releaseSha256,
    normalizationVersion,
    packageQualityStatus,
    contentProvenanceJson: JSON.stringify(value.provenance),
  }
}

function insertAsset(context, versionId, pageId, asset, now) {
  run(context.db, `INSERT INTO book_assets (id, book_version_id, page_id, asset_type, storage_key, usage_label, mime_type,
      size_bytes, sha256, width, height, created_at, updated_at, version)
    VALUES (:id, :versionId, :pageId, :assetType, :storageKey, :usageLabel, :mimeType,
      :sizeBytes, :sha256, :width, :height, :now, :now, 1)`, {
    id: asset.id || context.idFactory(), versionId, pageId, assetType: asset.assetType,
    storageKey: asset.storageKey, usageLabel: asset.usageLabel, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes,
    sha256: asset.sha256, width: asset.width, height: asset.height, now,
  })
}

async function prepareAssets(input, pages, verifier) {
  const requestedAssets = []
  for (const asset of Array.isArray(input.assets) ? input.assets : []) requestedAssets.push({ asset, pageNo: null })
  for (const page of pages) {
    for (const asset of Array.isArray(page.assets) ? page.assets : []) requestedAssets.push({ asset, pageNo: page.pageNo })
  }
  if (requestedAssets.length === 0) return []
  if (typeof verifier !== 'function') {
    const error = new Error('登记书籍资产前必须注入 assetMetadataVerifier')
    error.code = 'ASSET_VERIFIER_REQUIRED'
    throw error
  }
  const prepared = []
  for (const requested of requestedAssets) {
    const claimed = normalizeAssetMetadata(requested.asset, requested.pageNo)
    const actual = normalizeVerifiedAssetMetadata(await verifier({ storageKey: claimed.storageKey, assetType: claimed.assetType }))
    if (claimed.mimeType !== actual.mimeType || claimed.sizeBytes !== actual.sizeBytes || claimed.sha256 !== actual.sha256) {
      const error = new Error('书籍资产的 MIME、大小或 SHA256 与存储对象不一致')
      error.code = 'ASSET_INTEGRITY_MISMATCH'
      throw error
    }
    prepared.push(claimed)
  }
  return prepared
}

function normalizeAssetMetadata(asset, pageNo) {
  if (!asset || typeof asset !== 'object') throw new TypeError('asset 必须是对象')
  const assetType = assertString(asset.assetType, 'asset.assetType')
  if (!SUPPORTED_ASSET_TYPES.has(assetType)) throw new TypeError('asset.assetType 不受支持')
  if (assetType === 'page_image' && !pageNo) throw new TypeError('page_image 必须登记在具体页面下')
  if (assetType !== 'page_image' && pageNo) throw new TypeError('页面资产当前仅支持 page_image')
  const storageKey = assertStorageKey(asset.storageKey)
  const usageLabel = assertString(asset.usageLabel, 'asset.usageLabel')
  const mimeType = assertMimeType(asset.mimeType, assetType)
  const sizeBytes = Number(asset.sizeBytes)
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) throw new TypeError('asset.sizeBytes 必须是正整数')
  const sha256 = assertString(asset.sha256, 'asset.sha256').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new TypeError('asset.sha256 必须是 64 位十六进制')
  const width = optionalPositiveNumber(asset.width, 'asset.width')
  const height = optionalPositiveNumber(asset.height, 'asset.height')
  return { id: asset.id, assetType, storageKey, usageLabel, mimeType, sizeBytes, sha256, width, height, pageNo }
}

function normalizeVerifiedAssetMetadata(asset) {
  if (!asset || typeof asset !== 'object') throw new TypeError('assetMetadataVerifier 必须返回元数据')
  const mimeType = assertString(asset.mimeType, 'verifiedAsset.mimeType').toLowerCase()
  const sizeBytes = Number(asset.sizeBytes)
  const sha256 = assertString(asset.sha256, 'verifiedAsset.sha256').toLowerCase()
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new TypeError('assetMetadataVerifier 返回的大小或 SHA256 无效')
  }
  return { mimeType, sizeBytes, sha256 }
}

function assertStorageKey(value) {
  const storageKey = assertString(value, 'asset.storageKey')
  if (/^(?:[a-zA-Z]:[\\/]|[\\/]|[a-zA-Z][a-zA-Z0-9+.-]*:)/.test(storageKey) || storageKey.split(/[\\/]+/).includes('..')) {
    throw new TypeError('asset.storageKey 必须是存储系统内的相对键，不能是本机路径')
  }
  return storageKey
}

function assertMimeType(value, assetType) {
  const mimeType = assertString(value, 'asset.mimeType').toLowerCase()
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mimeType)) throw new TypeError('asset.mimeType 格式无效')
  if (assetType === 'source_pdf' && mimeType !== 'application/pdf') throw new TypeError('source_pdf 必须使用 application/pdf')
  if (assetType === 'source_epub' && mimeType !== 'application/epub+zip') throw new TypeError('source_epub 必须使用 application/epub+zip')
  if (assetType === 'source_text' && mimeType !== 'text/plain') throw new TypeError('source_text 必须使用 text/plain')
  if (['cover', 'page_image'].includes(assetType) && !mimeType.startsWith('image/')) throw new TypeError(`${assetType} 必须使用 image MIME`)
  return mimeType
}

function optionalPositiveNumber(value, name) {
  if (value === undefined || value === null) return null
  const number = Number(value)
  if (!(number > 0)) throw new TypeError(`${name} 必须大于 0`)
  return number
}

function boundedIntegerConfig(value, fallback, minimum, maximum, name) {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new TypeError(`${name} 必须是 ${minimum} 到 ${maximum} 毫秒内的整数`)
  }
  return resolved
}

function normalizeEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw validationFailed('event 必须是对象')
  assertAllowedFields(event, EVENT_TOP_LEVEL_FIELDS, 'event')
  if (event.schemaVersion !== 1) throw validationFailed('event.schemaVersion 仅支持 1')
  const eventType = assertSupportedEventType(event.eventType)
  const durationMs = event.durationMs ?? 0
  if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > MAX_EVENT_SECONDS * 1000) {
    throw validationFailed(`event.durationMs 必须是 0 到 ${MAX_EVENT_SECONDS * 1000} 的整数`)
  }
  if (typeof event.foreground !== 'boolean' || typeof event.screenOn !== 'boolean') {
    throw validationFailed('event.foreground 与 event.screenOn 必须是布尔值')
  }
  const clientOccurredAt = normalizeEventDate(event.clientOccurredAt)
  const classSessionId = event.classSessionId === undefined || event.classSessionId === null
    ? null
    : assertEventString(event.classSessionId, 'event.classSessionId')
  if (eventType === 'class_sync' && !classSessionId) throw validationFailed('class_sync 必须提供 event.classSessionId')
  const payload = normalizeEventPayload(eventType, event.payload ?? {})
  const durationSeconds = Math.floor(durationMs / 1000)
  return {
    schemaVersion: event.schemaVersion,
    deviceId: assertEventString(event.deviceId, 'event.deviceId'),
    bookVersionId: assertEventString(event.bookVersionId, 'event.bookVersionId'),
    pageNo: assertEventPositiveInteger(event.pageNo, 'event.pageNo'),
    eventType,
    clientOccurredAt,
    foreground: event.foreground ? 1 : 0,
    screenOn: event.screenOn ? 1 : 0,
    offlineSequence: assertEventPositiveInteger(event.offlineSequence, 'event.offlineSequence'),
    classSessionId,
    payload,
    blockIds: eventBlockIds(payload),
    durationMs,
    payloadJson: JSON.stringify({ schemaVersion: event.schemaVersion, durationMs, durationSeconds, classSessionId, payload }),
    durationSeconds,
  }
}

function assertSupportedEventType(value) {
  const eventType = assertEventString(value, 'event.eventType')
  if (!EVENT_PAYLOAD_FIELDS.has(eventType)) throw validationFailed(`不支持的 eventType: ${eventType}`)
  return eventType
}

function normalizeEventPayload(eventType, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw validationFailed('event.payload 必须是对象')
  assertAllowedFields(payload, EVENT_PAYLOAD_FIELDS.get(eventType), `event.payload(${eventType})`)
  switch (eventType) {
    case 'page_stay':
      return optionalFields({ blockId: optionalEventString(payload.blockId, 'event.payload.blockId') })
    case 'page_turn':
      return optionalFields({
        fromPageNo: optionalPositiveInteger(payload.fromPageNo, 'event.payload.fromPageNo'),
        direction: optionalEnum(payload.direction, ['next', 'previous'], 'event.payload.direction'),
        blockId: optionalEventString(payload.blockId, 'event.payload.blockId'),
      })
    case 'selection':
      return optionalFields({
        selectionId: assertEventString(payload.selectionId, 'event.payload.selectionId'),
        blockIds: normalizeStringArray(payload.blockIds, 'event.payload.blockIds'),
        selectionRange: normalizeSelectionRange(payload.selectionRange),
        textHash: optionalHash(payload.textHash, 'event.payload.textHash'),
      })
    case 'bookmark':
      return optionalFields({
        bookmarkId: assertEventString(payload.bookmarkId, 'event.payload.bookmarkId'),
        blockId: optionalEventString(payload.blockId, 'event.payload.blockId'),
        operation: optionalEnum(payload.operation, ['create', 'delete'], 'event.payload.operation'),
      })
    case 'annotation':
      return optionalFields({
        annotationId: assertEventString(payload.annotationId, 'event.payload.annotationId'),
        blockIds: normalizeStringArray(payload.blockIds, 'event.payload.blockIds'),
        selectionRange: normalizeSelectionRange(payload.selectionRange),
        contentHash: assertHash(payload.contentHash, 'event.payload.contentHash'),
        operation: optionalEnum(payload.operation, ['create', 'update', 'delete'], 'event.payload.operation'),
      })
    case 'ai_question':
      return optionalFields({
        questionId: optionalEventString(payload.questionId, 'event.payload.questionId'),
        conversationId: assertEventString(payload.conversationId, 'event.payload.conversationId'),
        messageId: optionalEventString(payload.messageId, 'event.payload.messageId'),
        questionHash: assertHash(payload.questionHash, 'event.payload.questionHash'),
        blockIds: optionalStringArray(payload.blockIds, 'event.payload.blockIds'),
        selectionRange: optionalSelectionRange(payload.selectionRange),
      })
    case 'class_sync':
      return optionalFields({
        syncSequence: assertEventPositiveInteger(payload.syncSequence, 'event.payload.syncSequence'),
        controlDeviceId: optionalEventString(payload.controlDeviceId, 'event.payload.controlDeviceId'),
        lockedBookVersionId: optionalEventString(payload.lockedBookVersionId, 'event.payload.lockedBookVersionId'),
      })
    default:
      throw validationFailed(`不支持的 eventType: ${eventType}`)
  }
}

function assertAllowedFields(value, allowed, name) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  if (unknown.length > 0) throw validationFailed(`${name} 包含未知字段: ${unknown.sort().join(', ')}`)
}

function optionalFields(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function assertEventString(value, name) {
  try {
    return assertString(value, name)
  } catch {
    throw validationFailed(`${name} 不能为空`)
  }
}

function optionalEventString(value, name) {
  if (value === undefined || value === null) return undefined
  return assertEventString(value, name)
}

function assertEventPositiveInteger(value, name) {
  try {
    return assertPositiveInteger(value, name)
  } catch {
    throw validationFailed(`${name} 必须是正整数`)
  }
}

function optionalPositiveInteger(value, name) {
  if (value === undefined || value === null) return undefined
  return assertEventPositiveInteger(value, name)
}

function optionalEnum(value, allowed, name) {
  if (value === undefined || value === null) return undefined
  if (!allowed.includes(value)) throw validationFailed(`${name} 必须是 ${allowed.join('、')} 之一`)
  return value
}

function normalizeStringArray(value, name) {
  if (!Array.isArray(value) || value.length === 0) throw validationFailed(`${name} 必须是非空字符串数组`)
  const normalized = value.map((entry) => assertEventString(entry, `${name}[]`))
  return [...new Set(normalized)].sort()
}

function optionalStringArray(value, name) {
  if (value === undefined || value === null) return undefined
  return normalizeStringArray(value, name)
}

function normalizeSelectionRange(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validationFailed('event.payload.selectionRange 必须是对象')
  assertAllowedFields(value, new Set(['startOffset', 'endOffset']), 'event.payload.selectionRange')
  if (!Number.isInteger(value.startOffset) || value.startOffset < 0
    || !Number.isInteger(value.endOffset) || value.endOffset < value.startOffset) {
    throw validationFailed('selectionRange 必须满足 0 <= startOffset <= endOffset')
  }
  return { startOffset: value.startOffset, endOffset: value.endOffset }
}

function optionalSelectionRange(value) {
  if (value === undefined || value === null) return undefined
  return normalizeSelectionRange(value)
}

function assertHash(value, name) {
  const hash = assertEventString(value, name).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(hash)) throw validationFailed(`${name} 必须是 64 位十六进制 SHA256`)
  return hash
}

function optionalHash(value, name) {
  if (value === undefined || value === null) return undefined
  return assertHash(value, name)
}

function normalizeEventDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw validationFailed('event.clientOccurredAt 必须是有效时间')
  return date.toISOString()
}

function eventBlockIds(payload) {
  if (Array.isArray(payload.blockIds)) return payload.blockIds
  return payload.blockId ? [payload.blockId] : []
}

function insertLeaseHistory(context, leaseId, organizationId, workspaceId, actorId, deviceId, bookVersionId, validFrom, validUntil) {
  run(context.db, `INSERT INTO reading_device_lease_history
      (id, lease_id, organization_id, workspace_id, actor_id, device_id, book_version_id,
        valid_from, valid_until, created_at, updated_at, version)
    VALUES (:id, :leaseId, :organizationId, :workspaceId, :actorId, :deviceId, :bookVersionId,
      :validFrom, :validUntil, :validFrom, :validFrom, 1)`, {
    id: context.idFactory(), leaseId, organizationId, workspaceId, actorId, deviceId, bookVersionId, validFrom, validUntil,
  })
}

function closeLeaseHistory(context, leaseId, validUntil, updatedAt, endReason = null) {
  const hasEndReason = context.db.prepare("SELECT 1 FROM pragma_table_info('reading_device_lease_history') WHERE name = 'end_reason'").get()
  run(context.db, `UPDATE reading_device_lease_history
    SET valid_until = CASE WHEN valid_until > :validUntil THEN :validUntil ELSE valid_until END,
      ${hasEndReason ? 'end_reason = COALESCE(end_reason, :endReason),' : ''}
      updated_at = :updatedAt, version = version + 1
    WHERE lease_id = :leaseId AND valid_from <= :validUntil`, {
    leaseId,
    validUntil,
    updatedAt,
    ...(hasEndReason ? { endReason } : {}),
  })
}

function validateEventTimeAndLease(context, event, options) {
  const occurredAt = new Date(event.clientOccurredAt)
  const now = context.now()
  if (occurredAt.getTime() > now.getTime() + options.futureClockSkewMs) {
    throw validationFailed('事件发生时间超过允许的未来时钟偏差')
  }
  if (occurredAt.getTime() < now.getTime() - options.maxOfflineAgeMs) {
    throw validationFailed('事件超过允许的最大离线补传年龄')
  }
  const candidates = all(context.db, `SELECT id, valid_from, valid_until FROM reading_device_lease_history
    WHERE organization_id = :organizationId AND actor_id = :actorId AND workspace_id = :workspaceId
      AND device_id = :deviceId AND book_version_id = :bookVersionId AND valid_from <= :occurredAt
    ORDER BY valid_from DESC, id DESC`, {
    organizationId: options.organizationId, actorId: options.actorId, workspaceId: options.workspaceId,
    deviceId: event.deviceId, bookVersionId: event.bookVersionId, occurredAt: event.clientOccurredAt,
  })
  const matched = candidates.some((lease) => occurredAt.getTime() <= new Date(lease.valid_until).getTime() + options.offlineLeaseGraceMs)
  if (!matched) {
    const error = new Error('事件发生时没有匹配的可信阅读设备租约历史')
    error.code = 'READING_LEASE_REQUIRED'
    throw error
  }
}

function deriveMetrics(event) {
  const activeTypes = new Set(['page_stay', 'page_turn', 'selection', 'bookmark', 'annotation', 'ai_question', 'class_sync'])
  const active = event.foreground === 1 && event.screenOn === 1 && activeTypes.has(event.eventType)
  return { validReadingSeconds: 0, validEyeSeconds: active ? event.durationSeconds : 0 }
}

function eventFingerprint(event, scope) {
  return createHash('sha256').update(JSON.stringify({
    schema_version: event.schemaVersion,
    event_type: event.eventType,
    actor_id: scope.actorId,
    organization_id: scope.organizationId,
    workspace_id: scope.workspaceId,
    device_id: event.deviceId,
    book_version_id: event.bookVersionId,
    page_no: event.pageNo,
    block_ids: event.blockIds,
    occurred_at: event.clientOccurredAt,
    duration_ms: event.durationMs,
    class_session_id: event.classSessionId,
    payload: event.payload,
    foreground: event.foreground,
    screen_on: event.screenOn,
    offline_sequence: event.offlineSequence,
  })).digest('hex')
}

function validationFailed(message) {
  const error = new TypeError(message)
  error.code = 'VALIDATION_FAILED'
  return error
}

function idempotencyConflict(eventId, message) {
  const error = new Error(message)
  error.code = 'IDEMPOTENCY_CONFLICT'
  error.details = { eventId }
  return error
}

function scopedResourceNotFound(message) {
  const error = new Error(message)
  error.code = 'RESOURCE_NOT_FOUND'
  return error
}

function requireScopedBookVersion(db, bookVersionId, organizationId, publishedOnly = false) {
  const version = one(db, `SELECT v.id FROM book_versions v
    JOIN books b ON b.id = v.book_id
    WHERE v.id = :bookVersionId AND v.organization_id_at_creation = :organizationId
      AND b.organization_id_at_creation = :organizationId ${publishedOnly ? "AND b.status = 'published'" : ''}`, { bookVersionId, organizationId })
  if (!version) {
    const error = new Error('书籍版本不存在于当前组织')
    error.code = 'RESOURCE_NOT_FOUND'
    throw error
  }
}

function recomputeEyeCare(context, actorId, workspaceId, now) {
  const rows = all(context.db, `SELECT * FROM reading_events
    WHERE actor_id_at_creation = :actorId AND workspace_id_at_creation = :workspaceId
      AND valid_eye_seconds > 0 ORDER BY client_occurred_at, id`, { actorId, workspaceId })
  const intervals = mergeEventIntervals(rows, 'valid_eye_seconds')
  run(context.db, 'DELETE FROM eye_care_usage WHERE actor_id = :actorId AND workspace_id = :workspaceId', { actorId, workspaceId })
  for (const kind of ['day', 'week']) {
    for (const [windowStart, seconds] of allocateWindowSeconds(intervals, kind)) {
      run(context.db, `INSERT INTO eye_care_usage (id, actor_id, workspace_id, window_start_at, window_kind, valid_eye_seconds, created_at, updated_at, version)
        VALUES (:id, :actorId, :workspaceId, :windowStart, :kind, :seconds, :now, :now, 1)`, {
        id: context.idFactory(), actorId, workspaceId, windowStart, kind, seconds, now,
      })
    }
  }
  const continuous = continuousEyeState(intervals)
  run(context.db, `INSERT INTO eye_care_states (actor_id, workspace_id, continuous_eye_seconds, last_active_at, created_at, updated_at, version)
    VALUES (:actorId, :workspaceId, :seconds, :lastActiveAt, :now, :now, 1)
    ON CONFLICT(actor_id, workspace_id) DO UPDATE SET continuous_eye_seconds = excluded.continuous_eye_seconds,
      last_active_at = excluded.last_active_at, updated_at = excluded.updated_at, version = version + 1`, {
    actorId, workspaceId, seconds: continuous.seconds, lastActiveAt: continuous.lastActiveAt, now,
  })
}

function mergeEventIntervals(rows, secondsColumn) {
  const intervals = rows
    .filter((row) => row[secondsColumn] > 0)
    .map((row) => {
      const start = new Date(row.client_occurred_at).getTime()
      return { start, end: start + row[secondsColumn] * 1000 }
    })
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const merged = []
  for (const interval of intervals) {
    const previous = merged.at(-1)
    if (!previous || interval.start > previous.end) merged.push({ ...interval })
    else previous.end = Math.max(previous.end, interval.end)
  }
  return merged
}

function allocateWindowSeconds(intervals, kind) {
  const windowMilliseconds = new Map()
  const unitMs = kind === 'day' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
  for (const interval of intervals) {
    let cursor = interval.start
    while (cursor < interval.end) {
      const windowStart = shanghaiWindowStart(new Date(cursor), kind)
      const nextWindow = windowStart.getTime() + unitMs
      const sliceEnd = Math.min(interval.end, nextWindow)
      const key = windowStart.toISOString()
      windowMilliseconds.set(key, (windowMilliseconds.get(key) || 0) + sliceEnd - cursor)
      cursor = sliceEnd
    }
  }
  return new Map([...windowMilliseconds].map(([key, milliseconds]) => [key, Math.floor(milliseconds / 1000)]))
}

function continuousEyeState(intervals) {
  if (intervals.length === 0) return { seconds: 0, lastActiveAt: null }
  let seconds = Math.floor((intervals.at(-1).end - intervals.at(-1).start) / 1000)
  for (let index = intervals.length - 2; index >= 0; index -= 1) {
    if (intervals[index + 1].start - intervals[index].end > MAX_EVENT_SECONDS * 1000) break
    seconds += Math.floor((intervals[index].end - intervals[index].start) / 1000)
  }
  return { seconds, lastActiveAt: new Date(intervals.at(-1).end).toISOString() }
}

function usageFor(db, actorId, workspaceId, kind, windowStart) {
  return one(db, `SELECT valid_eye_seconds FROM eye_care_usage
    WHERE actor_id = :actorId AND workspace_id = :workspaceId AND window_kind = :kind AND window_start_at = :windowStart`, {
    actorId, workspaceId, kind, windowStart: windowStart.toISOString(),
  })?.valid_eye_seconds || 0
}

export function shanghaiWindowStart(value, kind) {
  const date = new Date(value)
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000 - 4 * 60 * 60 * 1000)
  if (kind === 'week') {
    const day = shifted.getUTCDay() || 7
    shifted.setUTCDate(shifted.getUTCDate() - day + 1)
  }
  const localStart = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), 4, 0, 0, 0)
  return new Date(localStart - 8 * 60 * 60 * 1000)
}
