import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { createSchoolbagBridge, createSchoolbagSimulator } from '../../../server/domains/bridge/schoolbag.js'
import { createReadingDomain, shanghaiWindowStart } from '../../../server/domains/reading/catalog.js'
import { createReadingMonitoringDomain } from '../../../server/domains/reading/monitoring.js'
import { transaction } from '../../../server/domains/reading/sql.js'
import { createTeachingDomain } from '../../../server/domains/teaching/classroom.js'

function createFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'bubu-c-reading-'))
  const db = new DatabaseSync(path.join(directory, 'reading.sqlite'))
  db.exec(`CREATE TABLE organizations (id TEXT PRIMARY KEY);
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE classes (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL);
    CREATE TABLE role_assignments (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, role_code TEXT NOT NULL, scope_id TEXT NOT NULL);`)
  for (const file of ['010_reading_catalog.sql', '011_reading_activity.sql', '012_teaching_bridge.sql', '013_reading_security_scopes.sql', '014_book_catalog_metadata.sql', '015_classroom_participation.sql']) {
    db.exec(readFileSync(new URL(`../../../server/db/migrations/${file}`, import.meta.url), 'utf8'))
  }
  let index = 0
  let now = new Date('2026-08-04T20:01:00.000Z')
  const auditEvents = []
  const outboxEvents = []
  const dependencies = {
    db,
    actor: { id: 'student-1' },
    workspace: { id: 'class-1', organizationId: 'org-1' },
    authorize: async () => true,
    audit: (event) => auditEvents.push(event),
    outbox: { enqueue: (event) => outboxEvents.push(event) },
    idFactory: () => `id-${++index}`,
    now: () => now,
  }
  return {
    db,
    directory,
    dependencies,
    auditEvents,
    outboxEvents,
    setNow(value) { now = new Date(value) },
    close() { db.close(); rmSync(directory, { recursive: true, force: true }) },
  }
}

function createAssetStoreFixture(fixture) {
  const usageLabel = 'local integration/internal test'
  const definitions = [
    { storageKey: 'local-integration/internal-test/source.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF local integration internal test') },
    { storageKey: 'local-integration/internal-test/cover.png', mimeType: 'image/png', bytes: Buffer.from('cover local integration internal test') },
    { storageKey: 'local-integration/internal-test/page-1.png', mimeType: 'image/png', bytes: Buffer.from('page image local integration internal test') },
  ]
  const metadata = new Map()
  definitions.forEach((definition, index) => {
    const objectPath = path.join(fixture.directory, `asset-${index}.bin`)
    writeFileSync(objectPath, definition.bytes)
    metadata.set(definition.storageKey, {
      storageKey: definition.storageKey,
      usageLabel,
      mimeType: definition.mimeType,
      sizeBytes: definition.bytes.length,
      sha256: createHash('sha256').update(readFileSync(objectPath)).digest('hex'),
    })
  })
  return {
    usageLabel,
    metadata,
    assetMetadataVerifier: async ({ storageKey }) => metadata.get(storageKey),
  }
}

function createClassroomResourceAuthorizer(db) {
  return async ({ actor, workspace, action, resource }) => {
    if (!['assignment.manage', 'classroom.read', 'classroom.control'].includes(action)) return true
    const roles = db.prepare('SELECT role_code, scope_id FROM role_assignments WHERE user_id = ?').all(actor.id)
    if (roles.some((role) => role.role_code === 'school_admin' && role.scope_id === workspace.organizationId)) return true
    let classIds = resource.classIds || []
    if (classIds.length === 0 && resource.assignmentId) {
      classIds = db.prepare('SELECT class_id FROM assignment_classes WHERE assignment_id = ?').all(resource.assignmentId).map((row) => row.class_id)
    }
    if (classIds.length === 0 && resource.classSessionId) {
      classIds = db.prepare(`SELECT ac.class_id FROM class_sessions s
        JOIN assignment_classes ac ON ac.assignment_id = s.assignment_id WHERE s.id = ?`).all(resource.classSessionId).map((row) => row.class_id)
    }
    if (classIds.length === 0) return false
    const actualClasses = classIds.map((classId) => db.prepare(`SELECT id FROM classes
      WHERE id = ? AND organization_id = ? AND workspace_id = ?`).get(classId, workspace.organizationId, workspace.id))
    if (actualClasses.some((entry) => !entry)) return false
    const teacherScopes = new Set(roles.filter((role) => role.role_code === 'class_teacher').map((role) => role.scope_id))
    return classIds.every((classId) => teacherScopes.has(classId))
  }
}

async function createPublishedBook(fixture, overrides = {}) {
  const reading = createReadingDomain({ ...fixture.dependencies, ...overrides })
  const created = await reading.createBookVersion({
    title: 'local integration/internal test book', label: 'v1', sourceFormat: 'pdf',
    pages: [{ pageNo: 1, width: 1024, height: 768, textContent: '第一段正文', blocks: [] }],
  })
  await reading.publishBook(created.bookId)
  return { reading, ...created }
}

test('书籍坐标、设备租约和离线阅读事件真实持久化且幂等', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const reading = createReadingDomain(fixture.dependencies)
  const created = await reading.createBookVersion({
    title: 'local integration/internal test book', label: 'v1', sourceFormat: 'pdf',
    pages: [{ pageNo: 1, width: 1024, height: 768, textContent: '第一段正文', blocks: [{ blockKey: 'p1', paragraphId: 'paragraph-1', textContent: '第一段正文', charStart: 0, charEnd: 5, x: 10, y: 20, width: 300, height: 40 }] }],
  })
  await reading.publishBook(created.bookId)
  const page = await reading.getPage(created.bookId, 1)
  assert.equal(page.blocks[0].paragraph_id, 'paragraph-1')
  assert.equal(page.blocks[0].x, 10)

  fixture.setNow('2026-08-04T19:58:00.000Z')
  await reading.acquireLease({ deviceId: 'tablet-a', bookVersionId: created.versionId })
  await assert.rejects(() => reading.acquireLease({ deviceId: 'tablet-b', bookVersionId: created.versionId }), { code: 'READING_LEASE_HELD' })
  const takeover = await reading.takeOverLease({ deviceId: 'tablet-b', bookVersionId: created.versionId })
  assert.equal(takeover.takeover, true)
  fixture.setNow('2026-08-04T20:01:00.000Z')

  const events = [
    { id: 'event-before-reset', schemaVersion: 1, deviceId: 'tablet-b', bookVersionId: created.versionId, pageNo: 1, eventType: 'page_stay', clientOccurredAt: '2026-08-04T19:59:00.000Z', foreground: true, screenOn: true, offlineSequence: 1, durationMs: 60000, classSessionId: null, payload: {} },
    { id: 'event-after-reset', schemaVersion: 1, deviceId: 'tablet-b', bookVersionId: created.versionId, pageNo: 1, eventType: 'page_stay', clientOccurredAt: '2026-08-04T20:00:00.000Z', foreground: true, screenOn: true, offlineSequence: 2, durationMs: 60000, classSessionId: null, payload: {} },
    { id: 'event-background', schemaVersion: 1, deviceId: 'tablet-b', bookVersionId: created.versionId, pageNo: 1, eventType: 'page_stay', clientOccurredAt: '2026-08-04T20:01:00.000Z', foreground: false, screenOn: true, offlineSequence: 3, durationMs: 60000, classSessionId: null, payload: {} },
  ]
  const first = await reading.ingestEventsBatch({ events })
  const replay = await reading.ingestEventsBatch({ events })
  assert.deepEqual(first, { accepted: events.map((event) => event.id), replayed: [] })
  assert.deepEqual(replay, { accepted: [], replayed: events.map((event) => event.id) })
  assert.deepEqual(
    fixture.db.prepare(`SELECT valid_reading_seconds, valid_eye_seconds FROM reading_events
      ORDER BY offline_sequence`).all().map((row) => ({ ...row })),
    [
      { valid_reading_seconds: 0, valid_eye_seconds: 60 },
      { valid_reading_seconds: 0, valid_eye_seconds: 60 },
      { valid_reading_seconds: 0, valid_eye_seconds: 0 },
    ],
  )
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM reading_progress').get().count, 0)
  const eyeCare = await reading.getEyeCareStatus()
  assert.equal(eyeCare.dailyValidEyeSeconds, 60)
  assert.equal(eyeCare.continuousEyeSeconds, 120)
  assert.equal(shanghaiWindowStart(new Date('2026-08-04T20:00:00.000Z'), 'day').toISOString(), '2026-08-04T20:00:00.000Z')
  await reading.archiveBook(created.bookId)
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM book_hidden_evidence_snapshots').get().count, 1)
  await assert.rejects(() => reading.getPage(created.bookId, 1), { code: 'RESOURCE_NOT_FOUND' })
})

test('真实书目资产同事务登记、校验并按组织范围提供查询端口', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const assetStore = createAssetStoreFixture(fixture)
  const reading = createReadingDomain({ ...fixture.dependencies, assetMetadataVerifier: assetStore.assetMetadataVerifier })
  const source = assetStore.metadata.get('local-integration/internal-test/source.pdf')
  const cover = assetStore.metadata.get('local-integration/internal-test/cover.png')
  const pageImage = assetStore.metadata.get('local-integration/internal-test/page-1.png')
  const created = await reading.createBookVersion({
    title: 'Alice excerpt local integration/internal test', label: 'internal-test-v1', sourceFormat: 'pdf',
    assets: [
      { ...source, assetType: 'source_pdf' },
      { ...cover, assetType: 'cover', width: 600, height: 800 },
    ],
    pages: [{
      pageNo: 1, width: 1024, height: 768, textContent: 'public domain excerpt local integration/internal test', blocks: [],
      assets: [{ ...pageImage, assetType: 'page_image', width: 1024, height: 768 }],
    }],
  })
  await reading.publishBook(created.bookId)
  const books = await reading.listBooks()
  assert.equal(books[0].cover.storage_key, cover.storageKey)
  assert.equal(books[0].cover.usage_label, assetStore.usageLabel)
  const assets = await reading.getBookVersionAssets(created.versionId)
  assert.deepEqual(assets.map((asset) => asset.asset_type), ['source_pdf', 'cover', 'page_image'])
  assert.equal(assets.find((asset) => asset.asset_type === 'page_image').page_no, 1)
  assert.ok(assets.every((asset) => asset.usage_label === 'local integration/internal test'))

  await assert.rejects(() => reading.createBookVersion({
    bookId: 'forged-book', versionId: 'forged-version', title: 'forged local integration/internal test', label: 'v1', sourceFormat: 'pdf',
    assets: [{ ...source, assetType: 'source_pdf', sha256: '0'.repeat(64) }],
    pages: [{ pageNo: 1, width: 100, height: 100, textContent: '', blocks: [] }],
  }), { code: 'ASSET_INTEGRITY_MISMATCH' })
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM books WHERE id = 'forged-book'").get().count, 0)

  const otherOrganization = createReadingDomain({
    ...fixture.dependencies,
    workspace: { id: 'class-other', organizationId: 'org-2' },
    assetMetadataVerifier: assetStore.assetMetadataVerifier,
  })
  await assert.rejects(() => otherOrganization.getBookVersionAssets(created.versionId), { code: 'RESOURCE_NOT_FOUND' })

  await assert.rejects(() => reading.createBookVersion({
    bookId: 'half-book', versionId: 'half-version', title: 'rollback local integration/internal test', label: 'v1', sourceFormat: 'pdf',
    assets: [{ ...source, assetType: 'source_pdf' }],
    pages: [{ pageNo: 1, width: 100, height: 100, textContent: 'invalid block', blocks: [{ blockKey: 'bad', charStart: 5, charEnd: 2, x: 0, y: 0, width: 1, height: 1 }] }],
  }))
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM books WHERE id = 'half-book'").get().count, 0)
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM book_assets WHERE book_version_id = 'half-version'").get().count, 0)
})

test('离线事件按时间并集重算护眼，乱序上传不写阅读进度且冲突不静默重放', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  fixture.setNow('2026-08-04T20:00:00.000Z')
  const book = await createPublishedBook(fixture)
  const lease = await book.reading.acquireLease({ deviceId: 'tablet-a', bookVersionId: book.versionId })
  fixture.setNow('2026-08-04T20:01:00.000Z')
  const monitoring = createReadingMonitoringDomain(fixture.dependencies)
  await monitoring.renewLease({
    leaseId: lease.leaseId,
    deviceId: 'tablet-a',
    body: { schemaVersion: 1, bookVersionId: book.versionId },
  })
  fixture.setNow('2026-08-04T20:20:00.000Z')
  const events = [
    { id: 'latest-small-page', schemaVersion: 1, deviceId: 'tablet-a', bookVersionId: book.versionId, pageNo: 2, eventType: 'page_stay', clientOccurredAt: '2026-08-04T20:02:00.000Z', foreground: true, screenOn: true, offlineSequence: 3, durationMs: 60000, classSessionId: null, payload: {} },
    { id: 'overlap-later', schemaVersion: 1, deviceId: 'tablet-a', bookVersionId: book.versionId, pageNo: 9, eventType: 'page_stay', clientOccurredAt: '2026-08-04T20:00:30.000Z', foreground: true, screenOn: true, offlineSequence: 2, durationMs: 60000, classSessionId: null, payload: {} },
    { id: 'overlap-earlier', schemaVersion: 1, deviceId: 'tablet-a', bookVersionId: book.versionId, pageNo: 8, eventType: 'page_stay', clientOccurredAt: '2026-08-04T20:00:00.000Z', foreground: true, screenOn: true, offlineSequence: 1, durationMs: 60000, classSessionId: null, payload: {} },
  ]
  await book.reading.ingestEventsBatch({ events })
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM reading_events WHERE valid_reading_seconds = 0').get().count, 3)
  assert.equal(fixture.db.prepare(`SELECT COUNT(*) AS count FROM reading_progress
    WHERE actor_id = 'student-1' AND workspace_id = 'class-1' AND book_version_id = ?`).get(book.versionId).count, 0)
  assert.equal((await book.reading.getEyeCareStatus()).dailyValidEyeSeconds, 150)
  assert.deepEqual(await book.reading.ingestEventsBatch({ events: [events[0]] }), { accepted: [], replayed: ['latest-small-page'] })

  await assert.rejects(() => book.reading.ingestEventsBatch({ events: [{ ...events[0], pageNo: 3 }] }), { code: 'IDEMPOTENCY_CONFLICT' })
  const otherActor = createReadingDomain({ ...fixture.dependencies, actor: { id: 'student-2' } })
  await assert.rejects(() => otherActor.ingestEventsBatch({ events: [events[0]] }), { code: 'IDEMPOTENCY_CONFLICT' })
  const otherWorkspace = createReadingDomain({ ...fixture.dependencies, workspace: { id: 'class-2', organizationId: 'org-1' } })
  await assert.rejects(() => otherWorkspace.ingestEventsBatch({ events: [events[0]] }), { code: 'IDEMPOTENCY_CONFLICT' })
  await assert.rejects(() => book.reading.ingestEventsBatch({ events: [{ ...events[2], id: 'sequence-collision' }] }), { code: 'IDEMPOTENCY_CONFLICT' })
  await otherActor.acquireLease({ deviceId: 'tablet-a', bookVersionId: book.versionId })
  const actorScopedSequence = {
    ...events[2], id: 'student-2-own-sequence', pageNo: 1,
    clientOccurredAt: '2026-08-04T20:20:00.000Z',
  }
  assert.deepEqual(await otherActor.ingestEventsBatch({ events: [actorScopedSequence] }), { accepted: ['student-2-own-sequence'], replayed: [] })
})

test('书籍与安排按不可变组织范围拒绝跨组织访问', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const book = await createPublishedBook(fixture)
  const otherOrganizationDependencies = {
    ...fixture.dependencies,
    workspace: { id: 'class-other', organizationId: 'org-2' },
  }
  const otherReading = createReadingDomain(otherOrganizationDependencies)
  await assert.rejects(() => otherReading.getPage(book.bookId, 1), { code: 'RESOURCE_NOT_FOUND' })
  await assert.rejects(() => otherReading.archiveBook(book.bookId), { code: 'RESOURCE_NOT_FOUND' })
  const otherTeaching = createTeachingDomain({ ...otherOrganizationDependencies, actor: { id: 'teacher-2' } })
  await assert.rejects(() => otherTeaching.createAssignment({ title: '越权安排', bookVersionId: book.versionId, classIds: ['class-other'] }), { code: 'RESOURCE_NOT_FOUND' })
})

test('多班安排、唯一课堂控制端和单次 AI 广播 outbox', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const book = await createPublishedBook(fixture)
  let assignmentAuthorization
  const teaching = createTeachingDomain({
    ...fixture.dependencies,
    actor: { id: 'teacher-1' },
    authorize: async ({ action, resource }) => {
      if (action === 'assignment.manage') assignmentAuthorization = resource
      return true
    },
  })
  const assignment = await teaching.createAssignment({ title: '共读安排', bookVersionId: book.versionId, classIds: ['class-a', 'class-b'] })
  assert.deepEqual(assignment.classIds, ['class-a', 'class-b'])
  assert.deepEqual(assignmentAuthorization, { bookVersionId: book.versionId, classIds: ['class-a', 'class-b'] })
  assert.equal(fixture.outboxEvents.filter((event) => event.type === 'reading.assignment.created').length, 1)
  assert.equal(fixture.auditEvents.filter((event) => event.eventType === 'reading.assignment.created').length, 1)
  const session = await teaching.startClassSession({ assignmentId: assignment.assignmentId, pageNo: 2 })
  await teaching.claimControl({ classSessionId: session.sessionId, deviceId: 'teacher-tablet' })
  await assert.rejects(() => teaching.claimControl({ classSessionId: session.sessionId, deviceId: 'teacher-web' }), { code: 'CLASSROOM_CONTROL_HELD' })
  await teaching.synchronizePage({ classSessionId: session.sessionId, deviceId: 'teacher-tablet', pageNo: 3 })
  const first = await teaching.enqueueAiBroadcast({ classSessionId: session.sessionId, deviceId: 'teacher-tablet', sourceRequestId: 'ai-request-1', message: { answer: '同一条课堂回答' } })
  const replay = await teaching.enqueueAiBroadcast({ classSessionId: session.sessionId, deviceId: 'teacher-tablet', sourceRequestId: 'ai-request-1', message: { answer: '不应再调用 AI' } })
  assert.equal(first.replayed, false)
  assert.deepEqual(replay, { broadcastId: first.broadcastId, replayed: true })
  const secondSession = await teaching.startClassSession({ assignmentId: assignment.assignmentId, pageNo: 1 })
  await teaching.claimControl({ classSessionId: secondSession.sessionId, deviceId: 'teacher-tablet' })
  const sameRequestOtherClassroom = await teaching.enqueueAiBroadcast({ classSessionId: secondSession.sessionId, deviceId: 'teacher-tablet', sourceRequestId: 'ai-request-1', message: { answer: '另一个课堂独立广播' } })
  assert.equal(sameRequestOtherClassroom.replayed, false)
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM class_broadcast_outbox').get().count, 2)
  assert.equal((await teaching.getClassroomState(session.sessionId)).synced_page_no, 3)

  const otherWorkspace = createTeachingDomain({
    ...fixture.dependencies,
    actor: { id: 'teacher-1' },
    workspace: { id: 'class-2', organizationId: 'org-1' },
  })
  await assert.rejects(() => otherWorkspace.startClassSession({ assignmentId: assignment.assignmentId }), { code: 'RESOURCE_NOT_FOUND' })
  await assert.rejects(() => otherWorkspace.claimControl({ classSessionId: session.sessionId, deviceId: 'teacher-tablet' }), { code: 'RESOURCE_NOT_FOUND' })
  await assert.rejects(() => otherWorkspace.getClassroomState(session.sessionId), { code: 'RESOURCE_NOT_FOUND' })
})

test('学生课堂加入、同步、广播回执、掉线与结束状态形成同一持久闭环', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const book = await createPublishedBook(fixture)
  const teacher = createTeachingDomain({ ...fixture.dependencies, actor: { id: 'teacher-1', displayName: '林老师' } })
  const assignment = await teacher.createAssignment({ title: '课堂状态闭环', bookVersionId: book.versionId, classIds: ['class-a'] })
  const session = await teacher.startClassSession({ assignmentId: assignment.assignmentId, pageNo: 1 })
  await teacher.claimControl({ classSessionId: session.sessionId, deviceId: 'teacher-device', ttlSeconds: 120 })
  await teacher.lockBook({ classSessionId: session.sessionId, deviceId: 'teacher-device', bookVersionId: book.versionId })

  const student = createTeachingDomain({ ...fixture.dependencies, actor: { id: 'student-1', displayName: '小布' } })
  const joined = await student.joinClassSession({ classSessionId: session.sessionId })
  assert.equal(joined.mode, 'lock')
  assert.equal(joined.connected, true)

  await teacher.synchronizePage({ classSessionId: session.sessionId, deviceId: 'teacher-device', pageNo: 3 })
  const broadcast = await teacher.enqueueAiBroadcast({
    classSessionId: session.sessionId,
    deviceId: 'teacher-device',
    sourceRequestId: 'classroom-ai-once',
    message: { question: '白兔出现前后有什么变化？', answer: '同一条课堂回答', refs: [{ pageNo: 3 }] },
  })
  const studentState = await student.getClassroomState(session.sessionId)
  assert.equal(studentState.mode, 'sync')
  assert.equal(studentState.page, 3)
  assert.equal(studentState.broadcast.id, broadcast.broadcastId)
  assert.equal(studentState.broadcast.message.answer, '同一条课堂回答')
  assert.equal(studentState.participants.connected, 1)

  await student.acknowledgeBroadcast({ classSessionId: session.sessionId, broadcastId: broadcast.broadcastId })
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM class_broadcast_receipts WHERE class_broadcast_id = ? AND actor_id = ?').get(broadcast.broadcastId, 'student-1').count, 1)

  fixture.setNow('2026-08-04T20:02:01.000Z')
  const offlineState = await teacher.getClassroomState(session.sessionId)
  assert.equal(offlineState.participants.offline, 1)

  await teacher.endClassSession({ classSessionId: session.sessionId, deviceId: 'teacher-device' })
  const endedState = await student.getClassroomState(session.sessionId)
  assert.equal(endedState.mode, 'ended')
  assert.equal(endedState.status, 'ended')
  assert.equal(fixture.auditEvents.some((event) => event.eventType === 'classroom.broadcast.received'), true)
  assert.equal(fixture.auditEvents.some((event) => event.eventType === 'classroom.session.ended'), true)
})

test('阅读安排与 outbox、审计同事务，通知入队失败时不留下半成品', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const book = await createPublishedBook(fixture)
  const teaching = createTeachingDomain({
    ...fixture.dependencies,
    actor: { id: 'teacher-1' },
    outbox: { enqueue: () => { throw new Error('forced assignment outbox failure') } },
  })

  await assert.rejects(
    () => teaching.createAssignment({ title: '不应残留的安排', bookVersionId: book.versionId, classIds: ['class-a'] }),
    /forced assignment outbox failure/,
  )
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM reading_assignments WHERE title = '不应残留的安排'").get().count, 0)
  assert.equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM assignment_classes WHERE class_id = 'class-a'").get().count, 0)
})

test('课堂权限以真实班级资源覆盖授权教师、学校管理员和越权角色', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  fixture.db.exec(`INSERT INTO classes (id, organization_id, workspace_id) VALUES
      ('class-a', 'org-1', 'class-1'), ('class-b', 'org-1', 'class-1'), ('class-c', 'org-1', 'class-1');
    INSERT INTO role_assignments (id, user_id, role_code, scope_id) VALUES
      ('role-teacher-a', 'teacher-authorized', 'class_teacher', 'class-a'),
      ('role-admin', 'school-admin', 'school_admin', 'org-1'),
      ('role-outsider', 'teacher-outside', 'class_teacher', 'class-c');`)
  const book = await createPublishedBook(fixture)
  const authorize = createClassroomResourceAuthorizer(fixture.db)

  const teacher = createTeachingDomain({ ...fixture.dependencies, actor: { id: 'teacher-authorized' }, authorize })
  const teacherAssignment = await teacher.createAssignment({ title: 'authorized resource sample', bookVersionId: book.versionId, classIds: ['class-a'] })
  const teacherSession = await teacher.startClassSession({ assignmentId: teacherAssignment.assignmentId, pageNo: 1 })
  await teacher.claimControl({ classSessionId: teacherSession.sessionId, deviceId: 'teacher-device' })
  assert.equal((await teacher.getClassroomState(teacherSession.sessionId)).classIds[0], 'class-a')

  const administrator = createTeachingDomain({ ...fixture.dependencies, actor: { id: 'school-admin' }, authorize })
  const adminAssignment = await administrator.createAssignment({ title: 'school admin resource sample', bookVersionId: book.versionId, classIds: ['class-a', 'class-b'] })
  const adminSession = await administrator.startClassSession({ assignmentId: adminAssignment.assignmentId, pageNo: 1 })
  await administrator.claimControl({ classSessionId: adminSession.sessionId, deviceId: 'admin-device' })
  assert.deepEqual((await administrator.getClassroomState(adminSession.sessionId)).classIds.sort(), ['class-a', 'class-b'])

  const outsider = createTeachingDomain({ ...fixture.dependencies, actor: { id: 'teacher-outside' }, authorize })
  await assert.rejects(() => outsider.createAssignment({ title: 'denied resource sample', bookVersionId: book.versionId, classIds: ['class-a'] }), { code: 'PERMISSION_DENIED' })
  await assert.rejects(() => outsider.getClassroomState(teacherSession.sessionId), { code: 'PERMISSION_DENIED' })
})

test('电子书包本地模拟器签名、权限、nonce 防重放与返回契约', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  fixture.db.prepare(`INSERT INTO integration_clients (id, issuer, audience, active, created_at, updated_at, version)
    VALUES ('client-1', 'schoolbag-local', 'bubu-reader', 1, '2026-08-04T20:00:00.000Z', '2026-08-04T20:00:00.000Z', 1)`).run()
  const signingKey = Buffer.alloc(32, 7).toString('base64url')
  const simulator = createSchoolbagSimulator({ signingKey, now: fixture.dependencies.now })
  const returnUri = 'bubu-test://schoolbag/return'
  const bridgeOptions = { ...fixture.dependencies, signingKey, actor: { id: 'student-1' }, expectedDeviceId: 'tablet-1', allowedReturnUris: [returnUri] }
  const bridge = createSchoolbagBridge(bridgeOptions)
  const token = simulator.issue({ issuer: 'schoolbag-local', audience: 'bubu-reader', subject: 'student-1', deviceId: 'tablet-1', bookId: 'book-1', pageNo: 4, classSessionId: 'session-1', returnUri, nonce: 'nonce-1' })
  const launch = await bridge.verifyLaunchToken(token)
  assert.equal(launch.context.pageNo, 4)
  await assert.rejects(() => bridge.verifyLaunchToken(token), { code: 'TOKEN_REPLAYED' })
  const returned = await bridge.recordReturn({ launchId: launch.launchId, token, pageNo: 5, eyeCareState: 'resting' })
  assert.equal(returned.returnUri, returnUri)
  const expired = simulator.issue({ issuer: 'schoolbag-local', audience: 'bubu-reader', subject: 'student-1', deviceId: 'tablet-1', bookId: 'book-1', returnUri, nonce: 'expired-nonce', issuedAt: '2026-08-04T19:00:00.000Z', expiresAt: '2026-08-04T19:01:00.000Z' })
  await assert.rejects(() => bridge.verifyLaunchToken(expired), { code: 'TOKEN_EXPIRED' })
  const deniedBridge = createSchoolbagBridge({ ...bridgeOptions, authorize: async () => false })
  const denied = simulator.issue({ issuer: 'schoolbag-local', audience: 'bubu-reader', subject: 'student-1', deviceId: 'tablet-1', bookId: 'book-1', returnUri, nonce: 'denied-nonce' })
  await assert.rejects(() => deniedBridge.verifyLaunchToken(denied), { code: 'PERMISSION_DENIED' })

  const wrongDevice = simulator.issue({ issuer: 'schoolbag-local', audience: 'bubu-reader', subject: 'student-1', deviceId: 'tablet-2', bookId: 'book-1', returnUri, nonce: 'wrong-device' })
  await assert.rejects(() => bridge.verifyLaunchToken(wrongDevice), { code: 'TOKEN_DEVICE_MISMATCH' })
  const wrongSubject = simulator.issue({ issuer: 'schoolbag-local', audience: 'bubu-reader', subject: 'student-2', deviceId: 'tablet-1', bookId: 'book-1', returnUri, nonce: 'wrong-subject' })
  await assert.rejects(() => bridge.verifyLaunchToken(wrongSubject), { code: 'TOKEN_SUBJECT_MISMATCH' })
  const tooLong = simulator.issue({ issuer: 'schoolbag-local', audience: 'bubu-reader', subject: 'student-1', deviceId: 'tablet-1', bookId: 'book-1', returnUri, nonce: 'too-long', issuedAt: '2026-08-04T20:01:00.000Z', expiresAt: '2026-08-04T20:11:00.000Z' })
  await assert.rejects(() => bridge.verifyLaunchToken(tooLong), { code: 'TOKEN_TTL_EXCEEDED' })
  const future = simulator.issue({ issuer: 'schoolbag-local', audience: 'bubu-reader', subject: 'student-1', deviceId: 'tablet-1', bookId: 'book-1', returnUri, nonce: 'future', issuedAt: '2026-08-04T20:03:00.000Z', expiresAt: '2026-08-04T20:04:00.000Z' })
  await assert.rejects(() => bridge.verifyLaunchToken(future), { code: 'TOKEN_ISSUED_IN_FUTURE' })
  const unallowedUri = simulator.issue({ issuer: 'schoolbag-local', audience: 'bubu-reader', subject: 'student-1', deviceId: 'tablet-1', bookId: 'book-1', returnUri: 'https://not-allowed.test/return', nonce: 'uri-denied' })
  await assert.rejects(() => bridge.verifyLaunchToken(unallowedUri), { code: 'RETURN_URI_DENIED' })
  assert.throws(() => createSchoolbagBridge({ ...fixture.dependencies, signingKey, expectedDeviceId: 'tablet-1' }), /allowedReturnUris/)
})

test('同步 SQLite 事务拒绝 Promise 回调并回滚已执行写入', () => {
  const fixture = createFixture()
  try {
    fixture.db.exec('CREATE TABLE transaction_probe (id TEXT PRIMARY KEY)')
    assert.throws(() => transaction(fixture.db, () => {
      fixture.db.prepare("INSERT INTO transaction_probe (id) VALUES ('before-promise')").run()
      return Promise.resolve('not-allowed')
    }), { code: 'ASYNC_TRANSACTION_CALLBACK' })
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM transaction_probe').get().count, 0)
    assert.throws(() => transaction(fixture.db, async () => {
      fixture.db.prepare("INSERT INTO transaction_probe (id) VALUES ('async-callback')").run()
    }), { code: 'ASYNC_TRANSACTION_CALLBACK' })
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM transaction_probe').get().count, 0)
  } finally {
    fixture.close()
  }
})
