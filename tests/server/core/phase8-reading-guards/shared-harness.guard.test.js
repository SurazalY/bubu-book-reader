// T8.4A 共享夹具。只服务本目录守卫；禁止在 beforeEach / 共享 bootstrap 里给所有书 grant 所有班。
// D-22 的 projectAssignments 由 T8.5 接线同一共享谓词 isBookVisibleToAudience，本包不改 projections.js。
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { openSqliteDatabase } from '../../../../server/db/database.js'
import { runMigrations } from '../../../../server/db/migrate.js'
import { importIdentitySeed } from '../../../../server/db/seed.js'
import { createReadingDomain } from '../../../../server/domains/reading/catalog.js'
import { createReadingMonitoringDomain } from '../../../../server/domains/reading/monitoring.js'
import { resolveCurrentBookVersionId } from '../../../../server/domains/reading/visibility.js'

export const NOW = '2026-08-18T10:00:00.000Z'
export const LEASE_UNAVAILABLE_MESSAGE = '书籍不存在或当前不可读取'
export const CLASS_LOCAL_GRANT_METHOD = 'grantClassLocalShelf'
export const CLASS_LOCAL_REVOKE_METHOD = 'revokeClassLocalShelf'
export const FROZEN_READING_TABLES = ['reading_summary_sessions', 'reading_daily_book_summaries']

export const REAL_DATABASE_PATH = path.resolve(
  fileURLToPath(new URL('../../../../server/data/readmate.sqlite', import.meta.url)),
)
export const MIGRATION_DIRECTORY = fileURLToPath(new URL('../../../../server/db/migrations/', import.meta.url))
export const CATALOG_SOURCE_PATH = fileURLToPath(new URL('../../../../server/domains/reading/catalog.js', import.meta.url))
export const VISIBILITY_SOURCE_PATH = fileURLToPath(new URL('../../../../server/domains/reading/visibility.js', import.meta.url))
export const MONITORING_SOURCE_PATH = fileURLToPath(new URL('../../../../server/domains/reading/monitoring.js', import.meta.url))
export const ROUTER_SOURCE_PATH = fileURLToPath(new URL('../../../../server/http/integration-router.js', import.meta.url))

export function assertNotRealDatabasePath(databasePath) {
  const resolved = path.resolve(databasePath)
  assert.notEqual(resolved, REAL_DATABASE_PATH, `守卫测试不得打开真实业务库 ${REAL_DATABASE_PATH}，实际打开: ${resolved}`)
  assert.ok(
    !resolved.toLowerCase().replaceAll('\\', '/').endsWith('/server/data/readmate.sqlite'),
    `守卫测试数据库路径不得指向 server/data/readmate.sqlite，实际: ${resolved}`,
  )
}

export function studentAudience(classIds) {
  return { bypassClassGrants: false, allowUnpublished: false, classIds }
}

export function teacherAudience(classIds = []) {
  return { bypassClassGrants: true, allowUnpublished: false, classIds }
}

export function platformAudience(classIds = []) {
  return { bypassClassGrants: true, allowUnpublished: true, classIds }
}

export function assertAudienceShape(audience) {
  assert.equal(audience.unrestricted, undefined, 'resolveBookAudience 不得再返回 unrestricted')
  assert.equal(typeof audience.bypassClassGrants, 'boolean', 'audience 必须含 bypassClassGrants')
  assert.equal(typeof audience.allowUnpublished, 'boolean', 'audience 必须含 allowUnpublished')
  assert.ok(Array.isArray(audience.classIds), 'audience.classIds 必须是数组')
}

export function assertLeaseUnavailable(error) {
  assert.equal(error?.code, 'RESOURCE_NOT_FOUND', `期望 RESOURCE_NOT_FOUND，实际 ${error?.code}: ${error?.message}`)
  assert.equal(error?.message, LEASE_UNAVAILABLE_MESSAGE)
  assert.notEqual(error?.code, 'PERMISSION_DENIED', '不得用 403/PERMISSION_DENIED 泄露书籍存在性')
  return true
}

export function countTable(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)
}

export function countBookGrants(db, { bookId, organizationId, classId, granteeType } = {}) {
  const rows = db.prepare(`
    SELECT grant_row.grantee_type AS granteeType, grant_row.grantee_id AS granteeId
    FROM book_access_grants AS grant_row
    JOIN book_versions AS version ON version.id = grant_row.book_version_id
    WHERE version.book_id = ?
      AND version.organization_id_at_creation = ?
  `).all(bookId, organizationId)
  return rows.filter((row) => {
    if (classId && row.granteeId !== classId) return false
    if (granteeType && row.granteeType !== granteeType) return false
    return true
  }).length
}

export function grantCurrentBookToClass(db, {
  bookId,
  classId,
  organizationId,
  actorId,
  granteeType = 'class',
  now = NOW,
}) {
  const bookVersionId = resolveCurrentBookVersionId(db, { bookId, organizationId })
  assert.ok(bookVersionId, `grantCurrentBookToClass 需要当前版本：bookId=${bookId}`)
  db.prepare(`
    INSERT INTO book_access_grants (
      id, book_version_id, grantee_type, grantee_id,
      organization_id_at_creation, actor_id_at_creation, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    `grant-${randomUUID()}`,
    bookVersionId,
    granteeType,
    classId,
    organizationId,
    actorId,
    now,
    now,
  )
  return bookVersionId
}

export function requireClassLocalShelfApi(reading) {
  assert.equal(
    typeof reading[CLASS_LOCAL_GRANT_METHOD],
    'function',
    `createReadingDomain 必须提供 ${CLASS_LOCAL_GRANT_METHOD}({ bookId, classId })；T8.4B 按此名字实现 class-local PUT`,
  )
  assert.equal(
    typeof reading[CLASS_LOCAL_REVOKE_METHOD],
    'function',
    `createReadingDomain 必须提供 ${CLASS_LOCAL_REVOKE_METHOD}({ bookId, classId })；T8.4B 按此名字实现 class-local DELETE`,
  )
}

function pages(title) {
  return [1, 2].map((pageNo) => ({
    pageNo,
    width: 1024,
    height: 768,
    textContent: `${title} 第 ${pageNo} 页正文，足够引用。`,
    blocks: [{
      blockKey: `page-${pageNo}-paragraph-1`,
      paragraphId: `paragraph-${pageNo}`,
      textContent: `${title} 第 ${pageNo} 页正文，足够引用。`,
      charStart: 0,
      charEnd: 16,
      x: 80,
      y: 100,
      width: 760,
      height: 120,
    }],
  }))
}

function identitySeed(ids) {
  const user = (id, organizationId, displayName) => ({
    id,
    organizationId,
    username: id,
    displayName,
  })
  const membership = (userId, workspaceId) => ({ id: randomUUID(), userId, workspaceId })
  const role = (userId, workspaceId, roleCode, scopeType, scopeId, organizationId = ids.organizationId) => ({
    id: randomUUID(),
    organizationId,
    userId,
    workspaceId,
    roleCode,
    scopeType,
    scopeId,
  })
  const classMember = (classId, userId, membershipRole = 'student') => ({
    id: randomUUID(),
    classId,
    userId,
    membershipRole,
  })

  return {
    organizations: [
      { id: ids.organizationId, name: 'T8.4A 本校', schoolCode: `home-${ids.suffix}` },
      { id: ids.foreignOrganizationId, name: 'T8.4A 外校', schoolCode: `foreign-${ids.suffix}` },
    ],
    users: [
      user(ids.studentA, ids.organizationId, 'A 班学生'),
      user(ids.studentB, ids.organizationId, 'B 班学生'),
      user(ids.studentOrphan, ids.organizationId, '无班级学生'),
      user(ids.teacherA, ids.organizationId, 'A 班教师'),
      user(ids.teacherB, ids.organizationId, 'B 班教师'),
      user(ids.schoolAdmin, ids.organizationId, '校长'),
      user(ids.gradeManager, ids.organizationId, '年级主任'),
      user(ids.platformOps, ids.organizationId, '平台运维'),
      user(ids.foreignStudent, ids.foreignOrganizationId, '外校学生'),
    ],
    workspaces: [
      { id: ids.wsClassA, organizationId: ids.organizationId, code: 'class-teacher', name: 'A 班', scopeType: 'class', scopeId: ids.classAId },
      { id: ids.wsClassB, organizationId: ids.organizationId, code: 'class-teacher', name: 'B 班', scopeType: 'class', scopeId: ids.classBId },
      { id: ids.wsSchool, organizationId: ids.organizationId, code: 'school-admin', name: '校务', scopeType: 'school', scopeId: ids.organizationId },
      { id: ids.wsGrade, organizationId: ids.organizationId, code: 'grade-admin', name: '年级', scopeType: 'grade', scopeId: ids.gradeId },
      { id: ids.wsPlatform, organizationId: ids.organizationId, code: 'platform-ops', name: '平台', scopeType: 'platform', scopeId: ids.platformScopeId },
      {
        id: ids.wsForeignClass,
        organizationId: ids.foreignOrganizationId,
        code: 'class-teacher',
        name: '外校班',
        scopeType: 'class',
        scopeId: ids.foreignClassId,
      },
    ],
    classes: [
      {
        id: ids.classAId,
        organizationId: ids.organizationId,
        gradeId: ids.gradeId,
        name: '一年级 A 班',
        stage: 'primary',
        entryYear: 2023,
        classNumber: 1,
      },
      {
        id: ids.classBId,
        organizationId: ids.organizationId,
        gradeId: ids.gradeId,
        name: '一年级 B 班',
        stage: 'primary',
        entryYear: 2023,
        classNumber: 2,
      },
      {
        id: ids.foreignClassId,
        organizationId: ids.foreignOrganizationId,
        gradeId: ids.foreignGradeId,
        name: '外校班级',
        stage: 'primary',
        entryYear: 2023,
        classNumber: 1,
      },
    ],
    workspaceMemberships: [
      membership(ids.studentA, ids.wsClassA),
      membership(ids.studentB, ids.wsClassB),
      membership(ids.teacherA, ids.wsClassA),
      membership(ids.teacherB, ids.wsClassB),
      membership(ids.schoolAdmin, ids.wsSchool),
      membership(ids.gradeManager, ids.wsGrade),
      membership(ids.platformOps, ids.wsPlatform),
      membership(ids.foreignStudent, ids.wsForeignClass),
    ],
    classMemberships: [
      classMember(ids.classAId, ids.studentA),
      classMember(ids.classBId, ids.studentB),
      classMember(ids.classAId, ids.teacherA, 'teacher'),
      classMember(ids.classBId, ids.teacherB, 'teacher'),
      classMember(ids.foreignClassId, ids.foreignStudent),
    ],
    roleAssignments: [
      role(ids.studentA, ids.wsClassA, 'student', 'class', ids.classAId),
      role(ids.studentB, ids.wsClassB, 'student', 'class', ids.classBId),
      role(ids.teacherA, ids.wsClassA, 'teacher', 'class', ids.classAId),
      role(ids.teacherB, ids.wsClassB, 'teacher', 'class', ids.classBId),
      role(ids.schoolAdmin, ids.wsSchool, 'school_admin', 'school', ids.organizationId),
      role(ids.gradeManager, ids.wsGrade, 'grade_manager', 'grade', ids.gradeId),
      role(ids.platformOps, ids.wsPlatform, 'platform_ops', 'platform', ids.platformScopeId),
      role(ids.foreignStudent, ids.wsForeignClass, 'student', 'class', ids.foreignClassId, ids.foreignOrganizationId),
    ],
  }
}

export function createHarness(t) {
  const suffix = randomUUID().slice(0, 8)
  const id = (name) => `${name}-${suffix}`
  const ids = {
    suffix,
    organizationId: id('org-home'),
    foreignOrganizationId: id('org-foreign'),
    classAId: id('class-a'),
    classBId: id('class-b'),
    foreignClassId: id('class-foreign'),
    gradeId: 'primary:2023',
    foreignGradeId: 'primary:2023',
    platformScopeId: id('platform-scope'),
    wsClassA: id('ws-class-a'),
    wsClassB: id('ws-class-b'),
    wsSchool: id('ws-school'),
    wsGrade: id('ws-grade'),
    wsPlatform: id('ws-platform'),
    wsForeignClass: id('ws-foreign-class'),
    studentA: id('student-a'),
    studentB: id('student-b'),
    studentOrphan: id('student-orphan'),
    teacherA: id('teacher-a'),
    teacherB: id('teacher-b'),
    schoolAdmin: id('school-admin'),
    gradeManager: id('grade-manager'),
    platformOps: id('platform-ops'),
    foreignStudent: id('foreign-student'),
  }

  const directory = mkdtempSync(path.join(tmpdir(), 'readmate-t84a-'))
  const databasePath = path.join(directory, 't8-4a-guard.sqlite')
  assertNotRealDatabasePath(databasePath)
  const db = openSqliteDatabase(databasePath)
  runMigrations(db, MIGRATION_DIRECTORY, NOW)
  importIdentitySeed(db, identitySeed(ids), NOW)

  let nowMs = Date.parse(NOW)
  let seq = 0
  const authorizeCalls = []
  const auditCalls = []

  const close = () => {
    try {
      db.close()
    } catch {}
    rmSync(directory, { recursive: true, force: true })
  }
  t.after(close)

  const harness = {
    db,
    ids,
    directory,
    databasePath,
    authorizeCalls,
    auditCalls,
    now: () => new Date(nowMs),
    setNow(value) {
      nowMs = typeof value === 'number' ? value : Date.parse(value)
    },
    advanceMs(ms) {
      nowMs += ms
    },
    close,
    domain(actorId, workspaceId, organizationId, extras = {}) {
      const actions = extras.actions || authorizeCalls
      return createReadingDomain({
        db,
        actor: { id: actorId },
        workspace: { id: workspaceId, organizationId },
        authorize: async ({ action }) => {
          actions.push(action)
          return extras.authorize ? extras.authorize({ action }) : true
        },
        audit: async (event) => {
          auditCalls.push(event)
        },
        idFactory: extras.idFactory || (() => `t84a-${++seq}-${suffix}`),
        now: () => new Date(nowMs),
      })
    },
    studentDomain(which = 'A', extras) {
      return which === 'B'
        ? harness.domain(ids.studentB, ids.wsClassB, ids.organizationId, extras)
        : harness.domain(ids.studentA, ids.wsClassA, ids.organizationId, extras)
    },
    teacherDomain(which = 'A', extras) {
      return which === 'B'
        ? harness.domain(ids.teacherB, ids.wsClassB, ids.organizationId, extras)
        : harness.domain(ids.teacherA, ids.wsClassA, ids.organizationId, extras)
    },
    platformDomain(extras) {
      return harness.domain(ids.platformOps, ids.wsPlatform, ids.organizationId, extras)
    },
    schoolAdminDomain(extras) {
      return harness.domain(ids.schoolAdmin, ids.wsSchool, ids.organizationId, extras)
    },
    gradeManagerDomain(extras) {
      return harness.domain(ids.gradeManager, ids.wsGrade, ids.organizationId, extras)
    },
    foreignStudentDomain(extras) {
      return harness.domain(ids.foreignStudent, ids.wsForeignClass, ids.foreignOrganizationId, extras)
    },
    monitoring(actorId, workspaceId, organizationId) {
      return createReadingMonitoringDomain({
        db,
        actor: { id: actorId },
        workspace: { id: workspaceId, organizationId },
        authorize: async () => true,
        audit: async (event) => {
          auditCalls.push(event)
        },
        now: () => new Date(nowMs),
      })
    },
    async createBook({ title, status = 'published', organizationId = ids.organizationId } = {}) {
      const reading = harness.platformDomain()
      const created = await reading.createBookVersion({
        title,
        label: `t84a-${randomUUID().slice(0, 8)}`,
        sourceFormat: 'text',
        pages: pages(title),
      })
      if (status === 'published' || status === 'archived') {
        await reading.publishBook(created.bookId)
      }
      if (status === 'archived') {
        await reading.archiveBook(created.bookId)
      }
      if (organizationId !== ids.organizationId) {
        db.prepare('UPDATE books SET organization_id_at_creation = ? WHERE id = ?').run(organizationId, created.bookId)
        db.prepare('UPDATE book_versions SET organization_id_at_creation = ? WHERE id = ?').run(organizationId, created.versionId)
      }
      return { ...created, title, status: db.prepare('SELECT status FROM books WHERE id = ?').get(created.bookId).status }
    },
    insertLaterVersion({ bookId, organizationId = ids.organizationId, offsetMs = 60_000 }) {
      const versionId = `later-${randomUUID()}`
      const at = new Date(Date.parse(NOW) + offsetMs).toISOString()
      db.prepare(`
        INSERT INTO book_versions (
          id, book_id, organization_id_at_creation, actor_id_at_creation, label, source_format,
          page_count, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, 'text', 2, ?, ?, 1)
      `).run(versionId, bookId, organizationId, ids.platformOps, `later-${suffix}`, at, at)
      for (const pageNo of [1, 2]) {
        db.prepare(`
          INSERT INTO book_pages (
            id, book_version_id, page_no, text_content, width, height, created_at, updated_at, version
          ) VALUES (?, ?, ?, ?, 1024, 768, ?, ?, 1)
        `).run(`${versionId}:page:${pageNo}`, versionId, pageNo, `后版本第 ${pageNo} 页`, at, at)
      }
      return { versionId }
    },
    insertSourceTextAsset({ versionId, assetId = `asset-${randomUUID()}` }) {
      db.prepare(`
        INSERT INTO book_assets (
          id, book_version_id, page_id, asset_type, storage_key, usage_label, mime_type,
          size_bytes, sha256, created_at, updated_at, version
        ) VALUES (?, ?, NULL, 'source_text', ?, 'INTERNAL PILOT ONLY', 'text/plain', 12, ?, ?, ?, 1)
      `).run(assetId, versionId, `books/t84a/${assetId}.txt`, 'a'.repeat(64), NOW, NOW)
      return assetId
    },
    insertCommunityPost({
      postId = `post-${randomUUID()}`,
      bookId,
      quoteText,
      workspaceId = ids.wsClassA,
      classId = ids.classAId,
      organizationId = ids.organizationId,
      authorId = ids.studentA,
    }) {
      db.prepare(`
        INSERT INTO community_posts (
          id, organization_id_at_creation, workspace_id_at_creation, class_id_at_creation,
          actor_id_at_creation, author_id, scope, title, body, quote_book_id, quote_page, quote_text,
          status, ai_assisted, organization_snapshot_json, workspace_snapshot_json,
          created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, 'class', ?, ?, ?, 1, ?, 'approved', 0, '{}', '{}', ?, ?, 1)
      `).run(
        postId,
        organizationId,
        workspaceId,
        classId,
        authorId,
        authorId,
        '旧帖引用',
        '这是一条不改库的旧社区帖',
        bookId,
        quoteText,
        NOW,
        NOW,
      )
      return postId
    },
    installLeaseWriteProbe() {
      const writes = []
      const originalPrepare = db.prepare.bind(db)
      const originalExec = db.exec.bind(db)
      db.prepare = (sql) => {
        const statement = originalPrepare(sql)
        const originalRun = statement.run.bind(statement)
        statement.run = (...args) => {
          if (
            /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)
            && /\b(active_reading_leases|reading_device_lease_history|audit_events)\b/i.test(sql)
          ) {
            writes.push({ kind: 'run', sql })
          }
          return originalRun(...args)
        }
        return statement
      }
      db.exec = (sql) => {
        if (/\bBEGIN\b/i.test(sql)) writes.push({ kind: 'begin', sql })
        return originalExec(sql)
      }
      return writes
    },
  }

  return harness
}
