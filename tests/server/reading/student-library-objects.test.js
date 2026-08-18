import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { appendAuditEvent } from '../../../server/db/reliability.js'
import { openSqliteDatabase } from '../../../server/db/database.js'
import { runMigrations } from '../../../server/db/migrate.js'
import { grantBookToClass } from '../helpers/phase8-old-fixture.js'

async function loadDomain() {
  return import('../../../server/domains/reading/library-objects.js')
}

function insertIdentity(db, { organizationId, workspaceId, actorId, username }) {
  const now = '2026-08-06T05:00:00.000Z'
  db.prepare(`INSERT INTO organizations (id, name, school_code, status, created_at, updated_at, version)
    VALUES (?, ?, ?, 'active', ?, ?, 1)`).run(organizationId, `${organizationId} school`, organizationId, now, now)
  db.prepare(`INSERT INTO users (id, organization_id, username, display_name, status, created_at, updated_at, version, login_name, account_code)
    VALUES (?, ?, ?, ?, 'active', ?, ?, 1, ?, ?)`).run(actorId, organizationId, username, `${actorId} display`, now, now, username, `A-${actorId}`)
  db.prepare(`INSERT INTO workspaces (id, organization_id, code, name, scope_type, scope_id, status, created_at, updated_at, version)
    VALUES (?, ?, 'class-teacher', ?, 'class', ?, 'active', ?, ?, 1)`).run(workspaceId, organizationId, `${workspaceId} workspace`, `${workspaceId}-class`, now, now)
  db.prepare(`INSERT INTO workspace_memberships (id, user_id, workspace_id, status, created_at, updated_at, version)
    VALUES (?, ?, ?, 'active', ?, ?, 1)`).run(`${workspaceId}:${actorId}`, actorId, workspaceId, now, now)
  db.prepare(`INSERT INTO classes (id, organization_id, grade_id, name, status, created_at, updated_at, version)
    VALUES (?, ?, 'grade-a', ?, 'active', ?, ?, 1)`).run(`${workspaceId}-class`, organizationId, `${workspaceId} class`, now, now)
  db.prepare(`INSERT INTO class_memberships (id, class_id, user_id, membership_role, status, created_at, updated_at, version)
    VALUES (?, ?, ?, 'student', 'active', ?, ?, 1)`).run(`${workspaceId}-class:${actorId}`, `${workspaceId}-class`, actorId, now, now)
}

function insertBook(db, { organizationId, actorId, bookId, versionId, title }) {
  const now = '2026-08-06T05:00:00.000Z'
  db.prepare(`INSERT INTO books (id, organization_id_at_creation, actor_id_at_creation, title, status, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, 'published', ?, ?, 1)`).run(bookId, organizationId, actorId, title, now, now)
  db.prepare(`INSERT INTO book_versions (id, book_id, organization_id_at_creation, actor_id_at_creation, label, source_format, page_count, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, 'v1', 'text', 2, ?, ?, 1)`).run(versionId, bookId, organizationId, actorId, now, now)
  const insertPage = db.prepare(`INSERT INTO book_pages (id, book_version_id, page_no, text_content, width, height, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, 100, 100, ?, ?, 1)`)
  insertPage.run(`${versionId}:page:1`, versionId, 1, '第一段真实正文，可以保存为摘录。', now, now)
  insertPage.run(`${versionId}:page:2`, versionId, 2, '第二页真实正文。', now, now)
  const insertBlock = db.prepare(`INSERT INTO book_blocks (
    id, page_id, block_key, paragraph_id, text_content, char_start, char_end,
    x, y, width, height, created_at, updated_at, version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 100, 20, ?, ?, 1)`)
  insertBlock.run(`${versionId}:block:1`, `${versionId}:page:1`, 'paragraph-1', 'paragraph-1', '第一段真实正文，可以保存为摘录。', 0, 16, now, now)
  insertBlock.run(`${versionId}:block:2`, `${versionId}:page:2`, 'paragraph-2', 'paragraph-2', '第二页真实正文。', 0, 8, now, now)
  grantBookToClass(db, {
    bookId,
    classId: `${organizationId === 'org-a' ? 'workspace-a' : 'workspace-b'}-class`,
    organizationId,
    actorId,
    now,
    bookVersionId: versionId,
  })
}

function createFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'readmate-library-objects-'))
  const db = openSqliteDatabase(path.join(directory, 'library.sqlite'))
  const migrationDirectory = fileURLToPath(new URL('../../../server/db/migrations', import.meta.url))
  runMigrations(db, migrationDirectory, '2026-08-06T05:00:00.000Z')
  insertIdentity(db, { organizationId: 'org-a', workspaceId: 'workspace-a', actorId: 'student-a', username: 'student-a' })
  insertIdentity(db, { organizationId: 'org-b', workspaceId: 'workspace-b', actorId: 'student-b', username: 'student-b' })
  insertBook(db, { organizationId: 'org-a', actorId: 'student-a', bookId: 'book-a', versionId: 'version-a', title: '真实书籍 A' })
  insertBook(db, { organizationId: 'org-b', actorId: 'student-b', bookId: 'book-b', versionId: 'version-b', title: '真实书籍 B' })

  const eventAt = '2026-08-06T05:05:00.000Z'
  db.prepare(`INSERT INTO reading_events (
      id, organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation,
      device_id, book_version_id, page_no, event_type, client_occurred_at, received_at,
      foreground, screen_on, offline_sequence, event_fingerprint, payload_json,
      valid_reading_seconds, valid_eye_seconds, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, 'device-a', ?, 1, 'page_stay', ?, ?, 1, 1, 1, ?, '{}', 45, 45, ?, ?, 1)`)
    .run('event-a', 'org-a', 'student-a', 'workspace-a', 'version-a', eventAt, eventAt, 'a'.repeat(64), eventAt, eventAt)
  db.prepare(`INSERT INTO reading_progress (
      id, actor_id, workspace_id, book_version_id, last_page_no, valid_reading_seconds,
      updated_from_event_at, created_at, updated_at, version
    ) VALUES ('progress-a', 'student-a', 'workspace-a', 'version-a', 1, 45, ?, ?, ?, 1)`)
    .run(eventAt, eventAt, eventAt)
  db.prepare(`INSERT INTO reading_assignments (
      id, organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation,
      book_version_id, title, starts_at, ends_at, created_at, updated_at, version
    ) VALUES ('assignment-a', 'org-a', 'student-a', 'workspace-a', 'version-a', '本周真实安排', NULL, NULL, ?, ?, 1)`)
    .run(eventAt, eventAt)

  let sequence = 0
  const audit = (event) => appendAuditEvent(db, {
    ...event,
    id: `audit-${++sequence}`,
    actorUserId: event.actorUserId ?? 'student-a',
    workspaceId: event.workspaceId ?? 'workspace-a',
    scopeSnapshot: event.scopeSnapshot ?? {},
  })
  const dependencies = {
    db,
    actor: { id: 'student-a' },
    workspace: { id: 'workspace-a', organizationId: 'org-a' },
    authorize: async ({ action }) => action === 'reading.read_self',
    audit,
    idFactory: () => `object-${++sequence}`,
    now: () => new Date('2026-08-06T05:10:00.000Z'),
  }
  return {
    db,
    directory,
    dependencies,
    close() {
      db.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('喜欢、书单、书签、摘录和批注同域持久化，旧事件不作为页面证据返回', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const { createStudentLibraryDomain } = await loadDomain()
  const library = createStudentLibraryDomain(fixture.dependencies)

  const favorite = await library.createFavorite({ bookVersionId: 'version-a', position: 0 })
  const readingList = await library.createList({ name: '暑期书单', position: 0 })
  const listItem = await library.addListItem({ listId: readingList.id, bookVersionId: 'version-a', position: 0 })
  const bookmark = await library.createBookmark({ bookVersionId: 'version-a', pageNo: 1, label: '第一次看到这里' })
  const excerpt = await library.createExcerpt({
    bookVersionId: 'version-a', pageNo: 1, quoteText: '真实正文', note: '值得重读', position: 0,
  })
  const annotation = await library.createAnnotation({
    bookVersionId: 'version-a', pageNo: 1, quoteText: '第一段真实正文', body: '这里写得很有画面感', color: 'violet', position: 0,
  })
  const snapshot = await library.getSnapshot()

  assert.equal(snapshot.shelf.length, 1)
  assert.equal(snapshot.shelf[0].bookVersionId, 'version-a')
  assert.equal(snapshot.shelf[0].progress.lastPageNo, 1)
  assert.equal(Object.hasOwn(snapshot.shelf[0].progress, 'validReadingSeconds'), false)
  assert.deepEqual(snapshot.shelf[0].arrangementIds, ['assignment-a'])
  assert.deepEqual(snapshot.favorites.map((item) => item.id), [favorite.id])
  assert.equal(snapshot.lists[0].items[0].id, listItem.id)
  assert.equal(snapshot.bookmarks[0].id, bookmark.id)
  assert.equal(snapshot.excerpts[0].id, excerpt.id)
  assert.equal(snapshot.annotations[0].id, annotation.id)
  assert.equal(Object.hasOwn(snapshot, 'footprints'), false)
  const source = readFileSync(new URL('../../../server/domains/reading/library-objects.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\breading_events\b|\bfootprints\b/)
  assert.equal(fixture.db.prepare("SELECT valid_eye_seconds FROM reading_events WHERE id = 'event-a'").get().valid_eye_seconds, 45)
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count, 6)
})

test('摘录与批注锚点必须完整且精确匹配同页正文块，无锚点旧写入仍兼容', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const { createStudentLibraryDomain } = await loadDomain()
  const library = createStudentLibraryDomain(fixture.dependencies)

  const legacyExcerpt = await library.createExcerpt({
    bookVersionId: 'version-a', pageNo: 1, quoteText: '真实正文', note: '旧客户端无锚点写入', position: 0,
  })
  assert.equal(legacyExcerpt.blockId, null)

  const anchoredAnnotation = await library.createAnnotation({
    bookVersionId: 'version-a', pageNo: 1, blockId: 'version-a:block:1', charStart: 3, charEnd: 7,
    quoteText: '真实正文', body: '块内偏移正确', color: 'violet', position: 0,
  })
  assert.equal(anchoredAnnotation.blockId, 'version-a:block:1')

  await assert.rejects(
    () => library.createExcerpt({
      bookVersionId: 'version-a', pageNo: 1, blockId: 'version-a:block:2', charStart: 3, charEnd: 7,
      quoteText: '真实正文', note: '跨页块不应通过', position: 1,
    }),
    { code: 'VALIDATION_FAILED' },
  )
  await assert.rejects(
    () => library.createAnnotation({
      bookVersionId: 'version-a', pageNo: 1, blockId: 'version-a:block:1', charStart: 0, charEnd: 4,
      quoteText: '真实正文', body: '页内但偏移错误', color: 'violet', position: 1,
    }),
    { code: 'VALIDATION_FAILED' },
  )
  await assert.rejects(
    () => library.createExcerpt({
      bookVersionId: 'version-a', pageNo: 1, blockId: 'version-a:block:1', quoteText: '真实正文', note: '锚点不能残缺', position: 1,
    }),
    /blockId、charStart 与 charEnd 必须同时提供/,
  )
})

test('排序修改删除要求当前版本与当前租户归属', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const { createStudentLibraryDomain } = await loadDomain()
  const library = createStudentLibraryDomain(fixture.dependencies)
  const first = await library.createList({ name: '第一书单', position: 0 })
  const second = await library.createList({ name: '第二书单', position: 1 })
  const updated = await library.updateList({ listId: first.id, expectedVersion: first.version, name: '改名后的书单', position: 2 })
  assert.equal(updated.version, 2)
  await assert.rejects(
    () => library.updateList({ listId: first.id, expectedVersion: first.version, position: 3 }),
    { code: 'VERSION_CONFLICT' },
  )

  const otherTenant = createStudentLibraryDomain({
    ...fixture.dependencies,
    actor: { id: 'student-b' },
    workspace: { id: 'workspace-b', organizationId: 'org-b' },
  })
  await assert.rejects(
    () => otherTenant.updateList({ listId: second.id, expectedVersion: second.version, name: '越权改名' }),
    { code: 'RESOURCE_NOT_FOUND' },
  )
  assert.equal(fixture.db.prepare('SELECT name FROM student_reading_lists WHERE id = ?').get(second.id).name, '第二书单')

  const item = await library.addListItem({ listId: second.id, bookVersionId: 'version-a', position: 0 })
  const moved = await library.updateListItem({ itemId: item.id, expectedVersion: item.version, position: 4 })
  assert.equal(moved.position, 4)
  await library.deleteListItem({ itemId: item.id, expectedVersion: moved.version })
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM student_reading_list_items WHERE id = ?').get(item.id).count, 0)

  const favorite = await library.createFavorite({ bookVersionId: 'version-a', position: 0 })
  const movedFavorite = await library.updateFavorite({ favoriteId: favorite.id, expectedVersion: favorite.version, position: 3 })
  await assert.rejects(
    () => library.deleteFavorite({ favoriteId: favorite.id, expectedVersion: favorite.version }),
    { code: 'VERSION_CONFLICT' },
  )
  await library.deleteFavorite({ favoriteId: favorite.id, expectedVersion: movedFavorite.version })

  const bookmark = await library.createBookmark({ bookVersionId: 'version-a', pageNo: 1, label: '旧标签' })
  const updatedBookmark = await library.updateBookmark({ bookmarkId: bookmark.id, expectedVersion: bookmark.version, label: '新标签' })
  await assert.rejects(
    () => library.deleteBookmark({ bookmarkId: bookmark.id, expectedVersion: bookmark.version }),
    { code: 'VERSION_CONFLICT' },
  )
  await library.deleteBookmark({ bookmarkId: bookmark.id, expectedVersion: updatedBookmark.version })

  const excerpt = await library.createExcerpt({ bookVersionId: 'version-a', pageNo: 1, quoteText: '真实正文', note: '旧笔记' })
  const updatedExcerpt = await library.updateExcerpt({ excerptId: excerpt.id, expectedVersion: excerpt.version, note: '新笔记', position: 2 })
  assert.equal(updatedExcerpt.note, '新笔记')
  await library.deleteExcerpt({ excerptId: excerpt.id, expectedVersion: updatedExcerpt.version })

  const annotation = await library.createAnnotation({ bookVersionId: 'version-a', pageNo: 1, body: '旧批注' })
  const updatedAnnotation = await library.updateAnnotation({ annotationId: annotation.id, expectedVersion: annotation.version, body: '新批注', color: 'green' })
  await assert.rejects(
    () => otherTenant.updateAnnotation({ annotationId: annotation.id, expectedVersion: updatedAnnotation.version, body: '越权批注' }),
    { code: 'RESOURCE_NOT_FOUND' },
  )
  await library.deleteAnnotation({ annotationId: annotation.id, expectedVersion: updatedAnnotation.version })

  await library.deleteList({ listId: second.id, expectedVersion: second.version })
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM student_reading_lists WHERE id = ?').get(second.id).count, 0)
})

test('审计写入失败会回滚领域写入，跨组织数据不会泄露', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const { createStudentLibraryDomain } = await loadDomain()
  const brokenAudit = createStudentLibraryDomain({
    ...fixture.dependencies,
    audit: () => { throw new Error('audit unavailable') },
  })
  await assert.rejects(() => brokenAudit.createFavorite({ bookVersionId: 'version-a', position: 0 }), /audit unavailable/)
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM student_book_favorites').get().count, 0)

  const otherTenant = createStudentLibraryDomain({
    ...fixture.dependencies,
    actor: { id: 'student-b' },
    workspace: { id: 'workspace-b', organizationId: 'org-b' },
  })
  const otherSnapshot = await otherTenant.getSnapshot()
  assert.equal(Object.hasOwn(otherSnapshot, 'footprints'), false)
  assert.equal(otherSnapshot.shelf[0].bookVersionId, 'version-b')
})
