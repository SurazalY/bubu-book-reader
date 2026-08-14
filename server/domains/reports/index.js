import { createHash } from 'node:crypto'

import { DomainError, assertWorkspace, emit, json, makeId, nowIso, requirePermission, requireText, resolveContext } from '../delivery/primitives.js'
import { withTransaction } from '../../db/database.js'

const aiNotice = '本报告包含 AI 生成内容，仅供参考，不能替代教师、学校或专业人员的判断。'

const forbiddenReadingCompletionMetrics = new Set([
  'startedbookcount',
  'startedbooks',
  'booksstarted',
  'finishedbookcount',
  'finishedbooks',
  'booksfinished',
  'completedbookcount',
  'completedbooks',
  'bookscompleted',
  'readbookcount',
  'readbooks',
  'booksread',
  'pagesread',
  'readpagecount',
  'readingpages',
  'pagecount',
  'progress',
  'readingprogress',
  'progresspercent',
  'percent',
  'percentage',
  'finished',
  'completion',
  'completionpercent',
  '阅读页数',
  '已读页数',
  '阅读进度',
  '阅读完成比例',
  '完成度',
  '开始阅读书目',
  '已读书目',
  '读完书籍数',
])

function isCompletionMetric(key) {
  const normalized = String(key).replaceAll(/[_\s-]/g, '').toLowerCase()
  if (forbiddenReadingCompletionMetrics.has(normalized)) return true
  const hasReadingSubject = normalized.includes('reading')
    || normalized.includes('book')
    || normalized.includes('page')
  const hasCompletionMeaning = normalized.includes('progress')
    || normalized.includes('completion')
    || normalized.includes('finished')
    || normalized.includes('completed')
    || normalized.includes('percent')
    || normalized.includes('percentage')
  if (hasReadingSubject && hasCompletionMeaning) return true
  return (normalized.includes('阅读') && (
    normalized.includes('进度')
    || normalized.includes('完成')
    || normalized.includes('页数')
    || normalized.includes('比例')
  )) || (normalized.includes('已读') && (
    normalized.includes('页') || normalized.includes('书')
  )) || normalized.includes('读完书')
}

function sanitizeReportContent(content) {
  if (Array.isArray(content)) return content.map(sanitizeReportContent)
  if (!content || typeof content !== 'object') return content
  return Object.fromEntries(Object.entries(content)
    .filter(([key]) => !isCompletionMetric(key))
    .map(([key, value]) => [key, sanitizeReportContent(value)]))
}

function buildReadingSnapshot(db, current, studentId) {
  const rows = db.prepare(`
    SELECT summary.book_version_id, SUM(summary.effective_reading_ms) AS effective_reading_ms,
      MAX(summary.last_read_at) AS last_read_at, MAX(summary.updated_at) AS updated_at,
      MAX(summary.version) AS latest_version, book.title
    FROM reading_daily_book_summaries AS summary
    JOIN book_versions AS book_version ON book_version.id = summary.book_version_id
    JOIN books AS book ON book.id = book_version.book_id
    WHERE summary.actor_id_at_creation = ? AND summary.workspace_id_at_creation = ?
      AND summary.organization_id_at_creation = ?
      AND book_version.organization_id_at_creation = ?
      AND book.organization_id_at_creation = ?
    GROUP BY summary.book_version_id, book.title
    ORDER BY last_read_at DESC, summary.book_version_id
  `).all(
    studentId,
    current.workspace.id,
    current.workspace.organizationId,
    current.workspace.organizationId,
    current.workspace.organizationId,
  )
  const effectiveReadingMs = rows.reduce((total, row) => total + Number(row.effective_reading_ms || 0), 0)
  const latestReadingAt = rows[0]?.last_read_at || null
  const fingerprint = createHash('sha256').update(JSON.stringify(rows.map((row) => ({
    bookVersionId: row.book_version_id,
    effectiveReadingMs: row.effective_reading_ms,
    lastReadAt: row.last_read_at,
    updatedAt: row.updated_at,
    latestVersion: row.latest_version,
  })))).digest('hex')
  return {
    snapshotKey: `reading-daily:${studentId}:${fingerprint}`,
    content: {
      ...(rows.length ? { effectiveMinutes: Math.floor(effectiveReadingMs / 60_000) } : {}),
      latestReadingAt,
      highlights: rows.length
        ? rows.slice(0, 3).map((row) => `${row.title}：有效阅读 ${Math.floor(Number(row.effective_reading_ms || 0) / 60_000)} 分钟`)
        : ['当前工作空间尚无有效阅读记录'],
    },
  }
}

export function createReportsDomain({ db, actor, workspace, outbox, audit, clock, idGenerator, transactionRunner } = {}) {
  if (!db?.prepare) throw new Error('createReportsDomain requires db.prepare')
  const context = () => resolveContext({ actor, workspace })
  const id = () => makeId(idGenerator)
  const now = () => nowIso(clock)
  const runInTransaction = transactionRunner || ((operation) => withTransaction(db, operation))

  return {
    generateReport({ studentId, snapshotKey, content, aiGenerated, forceNewVersion = false }) {
      const current = context()
      requirePermission(current, 'report.generate')
      const safeStudentId = requireText(studentId, 'studentId', 120)
      const readingSnapshot = snapshotKey === undefined && content === undefined
        ? buildReadingSnapshot(db, current, safeStudentId)
        : null
      const safeSnapshotKey = requireText(snapshotKey ?? readingSnapshot?.snapshotKey, 'snapshotKey', 300)
      const reportContent = sanitizeReportContent(content ?? readingSnapshot?.content)
      const reportAiGenerated = aiGenerated ?? readingSnapshot === null
      const report = db.prepare('SELECT * FROM reports WHERE organization_id_at_creation = ? AND workspace_id_at_creation = ? AND student_id = ? AND generated_from_snapshot_key = ?').get(current.workspace.organizationId, current.workspace.id, safeStudentId, safeSnapshotKey)
      const authorizeStudent = () => {
        if (typeof current.workspace.canAccessStudent !== 'function' || !current.workspace.canAccessStudent(safeStudentId, current.actor)) {
          throw new DomainError('RESOURCE_NOT_FOUND', '学生不存在或不在当前工作空间')
        }
      }
      if (report && !forceNewVersion) {
        runInTransaction(authorizeStudent)
        return this.getReport(report.id)
      }
      const reportId = runInTransaction(() => {
        authorizeStudent()
        const createdAt = now()
        const nextReportId = report?.id || id()
        if (!report) db.prepare(`INSERT INTO reports (id, organization_id_at_creation, workspace_id_at_creation, actor_id_at_creation, student_id, status, generated_from_snapshot_key, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, 'generated', ?, ?, ?, 1)`).run(nextReportId, current.workspace.organizationId, current.workspace.id, current.actor.id, safeStudentId, safeSnapshotKey, createdAt, createdAt)
        const versionNumber = db.prepare('SELECT COALESCE(MAX(version_number), 0) AS value FROM report_versions WHERE report_id = ?').get(nextReportId).value + 1
        const versionId = id()
        db.prepare(`INSERT INTO report_versions (id, report_id, version_number, content_json, ai_generated, ai_notice, generated_by_id, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(versionId, nextReportId, versionNumber, json(reportContent), reportAiGenerated ? 1 : 0, reportAiGenerated ? aiNotice : '', current.actor.id, createdAt, createdAt)
        db.prepare('UPDATE reports SET status = ?, current_version_id = ?, updated_at = ?, version = version + 1 WHERE id = ?').run('generated', versionId, createdAt, nextReportId)
        emit(db, outbox, 'report.generated', { reportId: nextReportId, versionId, workspaceId: current.workspace.id }, { aggregateType: 'report', aggregateId: nextReportId, dedupeKey: `report.generated:${versionId}`, createdAt })
        audit?.({ eventType: 'report.generated', resourceType: 'report', resourceId: nextReportId })
        return nextReportId
      })
      return this.getReport(reportId)
    },

    listReports() {
      const current = context()
      requirePermission(current, 'report.generate')
      return db.prepare(`
        SELECT report.*, version.version_number, version.content_json, version.ai_generated, version.ai_notice, version.reviewed_at
        FROM reports AS report
        LEFT JOIN report_versions AS version ON version.id = report.current_version_id
        WHERE report.organization_id_at_creation = ? AND report.workspace_id_at_creation = ?
        ORDER BY report.updated_at DESC
      `).all(current.workspace.organizationId, current.workspace.id).map((row) => ({
        id: row.id,
        studentId: row.student_id,
        status: row.status,
        currentVersionId: row.current_version_id,
        versionId: row.current_version_id,
        versionNumber: row.version_number,
        snapshotKey: row.generated_from_snapshot_key,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        content: row.content_json ? sanitizeReportContent(JSON.parse(row.content_json)) : null,
        aiGenerated: Boolean(row.ai_generated),
        aiNotice: row.ai_notice,
        reviewedAt: row.reviewed_at,
      }))
    },

    getReport(reportId) {
      const current = context()
      requirePermission(current, 'report.generate')
      const report = assertWorkspace(db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId), current.workspace)
      const versions = db.prepare('SELECT * FROM report_versions WHERE report_id = ? ORDER BY version_number').all(reportId).map((version) => ({
        ...version,
        content: sanitizeReportContent(JSON.parse(version.content_json)),
        ai_generated: Boolean(version.ai_generated),
      }))
      return { ...report, versions }
    },

    reviewReport({ reportId, versionId }) {
      const current = context()
      requirePermission(current, 'report.review')
      const report = assertWorkspace(db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId), current.workspace)
      const version = db.prepare('SELECT * FROM report_versions WHERE id = ? AND report_id = ?').get(versionId || report.current_version_id, reportId)
      if (!version) throw new DomainError('RESOURCE_NOT_FOUND', '报告版本不存在')
      runInTransaction(() => {
        const reviewedAt = now()
        db.prepare('UPDATE report_versions SET reviewed_by_id = ?, reviewed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(current.actor.id, reviewedAt, reviewedAt, version.id)
        db.prepare('UPDATE reports SET status = ?, current_version_id = ?, updated_at = ?, version = version + 1 WHERE id = ?').run('reviewed', version.id, reviewedAt, reportId)
        emit(db, outbox, 'report.reviewed', { reportId, versionId: version.id, workspaceId: current.workspace.id }, { aggregateType: 'report', aggregateId: reportId, dedupeKey: `report.reviewed:${version.id}`, createdAt: reviewedAt })
        audit?.({ eventType: 'report.reviewed', resourceType: 'report', resourceId: reportId })
      })
      return this.getReport(reportId)
    }
  }
}
