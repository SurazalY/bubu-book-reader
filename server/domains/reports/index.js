import { createHash } from 'node:crypto'

import { DomainError, assertWorkspace, emit, json, makeId, nowIso, requirePermission, requireText, resolveContext } from '../delivery/primitives.js'
import { withTransaction } from '../../db/database.js'

const aiNotice = '本报告包含 AI 生成内容，仅供参考，不能替代教师、学校或专业人员的判断。'

function buildReadingSnapshot(db, current, studentId) {
  const rows = db.prepare(`
    SELECT progress.book_version_id, progress.last_page_no, progress.valid_reading_seconds,
      progress.updated_from_event_at, progress.version, book.title
    FROM reading_progress AS progress
    JOIN book_versions AS book_version ON book_version.id = progress.book_version_id
    JOIN books AS book ON book.id = book_version.book_id
    WHERE progress.actor_id = ? AND progress.workspace_id = ?
      AND book_version.organization_id_at_creation = ?
      AND book.organization_id_at_creation = ?
    ORDER BY progress.updated_from_event_at DESC, progress.book_version_id
  `).all(studentId, current.workspace.id, current.workspace.organizationId, current.workspace.organizationId)
  const validReadingSeconds = rows.reduce((total, row) => total + Number(row.valid_reading_seconds || 0), 0)
  const latestReadingAt = rows[0]?.updated_from_event_at || null
  const fingerprint = createHash('sha256').update(JSON.stringify(rows.map((row) => ({
    bookVersionId: row.book_version_id,
    lastPageNo: row.last_page_no,
    validReadingSeconds: row.valid_reading_seconds,
    updatedFromEventAt: row.updated_from_event_at,
    version: row.version,
  })))).digest('hex')
  return {
    snapshotKey: `reading-progress:${studentId}:${fingerprint}`,
    content: {
      effectiveMinutes: Math.floor(validReadingSeconds / 60),
      pagesRead: rows.reduce((total, row) => total + Number(row.last_page_no || 0), 0),
      startedBookCount: rows.length,
      latestReadingAt,
      highlights: rows.length
        ? rows.slice(0, 3).map((row) => `${row.title}：读到第 ${row.last_page_no} 页，有效阅读 ${Math.floor(Number(row.valid_reading_seconds || 0) / 60)} 分钟`)
        : ['当前工作空间尚无有效阅读进度'],
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
      const reportContent = content ?? readingSnapshot?.content
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
        content: row.content_json ? JSON.parse(row.content_json) : null,
        aiGenerated: Boolean(row.ai_generated),
        aiNotice: row.ai_notice,
        reviewedAt: row.reviewed_at,
      }))
    },

    getReport(reportId) {
      const current = context()
      requirePermission(current, 'report.generate')
      const report = assertWorkspace(db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId), current.workspace)
      const versions = db.prepare('SELECT * FROM report_versions WHERE report_id = ? ORDER BY version_number').all(reportId).map((version) => ({ ...version, content: JSON.parse(version.content_json), ai_generated: Boolean(version.ai_generated) }))
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
