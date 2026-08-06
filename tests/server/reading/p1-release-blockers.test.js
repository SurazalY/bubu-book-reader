import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { createSchoolbagBridge, createSchoolbagSimulator } from '../../../server/domains/bridge/schoolbag.js'
import { createReadingDomain } from '../../../server/domains/reading/catalog.js'

function createFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'bubu-c-p1-'))
  const db = new DatabaseSync(path.join(directory, 'p1.sqlite'))
  db.exec('CREATE TABLE organizations (id TEXT PRIMARY KEY); CREATE TABLE users (id TEXT PRIMARY KEY); CREATE TABLE classes (id TEXT PRIMARY KEY);')
  const migrationDirectory = new URL('../../../server/db/migrations/', import.meta.url)
  const migrations = readdirSync(migrationDirectory).filter((file) => /^01[0-3].*\.sql$/.test(file)).sort()
  for (const file of migrations) db.exec(readFileSync(new URL(file, migrationDirectory), 'utf8'))
  let idIndex = 0
  let now = new Date('2026-08-05T10:00:00.000Z')
  const dependencies = {
    db,
    actor: { id: 'student-1' },
    workspace: { id: 'class-1', organizationId: 'org-1' },
    authorize: async () => true,
    audit: async () => undefined,
    idFactory: () => `p1-id-${++idIndex}`,
    now: () => now,
  }
  return {
    db,
    dependencies,
    setNow(value) { now = new Date(value) },
    close() { db.close(); rmSync(directory, { recursive: true, force: true }) },
  }
}

async function createBook(fixture) {
  const reading = createReadingDomain(fixture.dependencies)
  const created = await reading.createBookVersion({
    title: 'local integration/internal test P1 book', label: 'p1-v1', sourceFormat: 'text',
    pages: [{ pageNo: 1, width: 100, height: 100, textContent: 'local integration/internal test', blocks: [] }],
  })
  await reading.publishBook(created.bookId)
  return { reading, ...created }
}

function annotationEvent(bookVersionId, overrides = {}) {
  return {
    id: 'annotation-event-1', schemaVersion: 1, deviceId: 'tablet-1', bookVersionId, pageNo: 1,
    eventType: 'annotation', clientOccurredAt: '2026-08-05T10:00:00.000Z', durationMs: 30000,
    foreground: true, screenOn: true, offlineSequence: 1, classSessionId: null,
    payload: {
      annotationId: 'annotation-1', blockIds: ['block-1'], selectionRange: { startOffset: 0, endOffset: 5 },
      contentHash: '1'.repeat(64),
    },
    ...overrides,
  }
}

test('P1: 同事件 ID 修改 annotation 业务 payload 必须冲突', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const book = await createBook(fixture)
  await book.reading.acquireLease({ deviceId: 'tablet-1', bookVersionId: book.versionId })
  const original = annotationEvent(book.versionId)
  await book.reading.ingestEventsBatch({ events: [original] })
  const changed = { ...original, payload: { ...original.payload, contentHash: '2'.repeat(64) } }
  await assert.rejects(() => book.reading.ingestEventsBatch({ events: [changed] }), { code: 'IDEMPOTENCY_CONFLICT' })
})

test('P1: 未知 payload 字段必须拒绝而不是忽略', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const book = await createBook(fixture)
  await book.reading.acquireLease({ deviceId: 'tablet-1', bookVersionId: book.versionId })
  const event = annotationEvent(book.versionId, { payload: { ...annotationEvent(book.versionId).payload, unknownBusinessField: 'ignored-before-fix' } })
  await assert.rejects(() => book.reading.ingestEventsBatch({ events: [event] }), { code: 'VALIDATION_FAILED' })
})

test('P1: selection 与 ai_question 完整业务 payload 参与事件指纹', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const book = await createBook(fixture)
  await book.reading.acquireLease({ deviceId: 'tablet-1', bookVersionId: book.versionId })
  const selection = {
    id: 'selection-event-1', schemaVersion: 1, deviceId: 'tablet-1', bookVersionId: book.versionId,
    pageNo: 1, eventType: 'selection', clientOccurredAt: '2026-08-05T10:00:00.000Z', durationMs: 1000,
    foreground: true, screenOn: true, offlineSequence: 2, classSessionId: null,
    payload: {
      selectionId: 'selection-1', blockIds: ['block-2', 'block-1'],
      selectionRange: { startOffset: 1, endOffset: 9 }, textHash: '3'.repeat(64),
    },
  }
  await book.reading.ingestEventsBatch({ events: [selection] })
  await assert.rejects(() => book.reading.ingestEventsBatch({
    events: [{ ...selection, payload: { ...selection.payload, selectionRange: { startOffset: 2, endOffset: 9 } } }],
  }), { code: 'IDEMPOTENCY_CONFLICT' })

  const question = {
    id: 'ai-question-event-1', schemaVersion: 1, deviceId: 'tablet-1', bookVersionId: book.versionId,
    pageNo: 1, eventType: 'ai_question', clientOccurredAt: '2026-08-05T10:00:01.000Z', durationMs: 1000,
    foreground: true, screenOn: true, offlineSequence: 3, classSessionId: 'class-session-1',
    payload: {
      questionId: 'question-1', conversationId: 'conversation-1', messageId: 'message-1',
      questionHash: '4'.repeat(64), blockIds: ['block-1'], selectionRange: { startOffset: 0, endOffset: 5 },
    },
  }
  await book.reading.ingestEventsBatch({ events: [question] })
  await assert.rejects(() => book.reading.ingestEventsBatch({
    events: [{ ...question, payload: { ...question.payload, questionHash: '5'.repeat(64) } }],
  }), { code: 'IDEMPOTENCY_CONFLICT' })
})

test('P1: 不支持 eventType 与未知顶层字段必须明确拒绝', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const book = await createBook(fixture)
  await book.reading.acquireLease({ deviceId: 'tablet-1', bookVersionId: book.versionId })
  await assert.rejects(() => book.reading.ingestEventsBatch({
    events: [{ ...annotationEvent(book.versionId), id: 'unsupported', eventType: 'teleport' }],
  }), { code: 'VALIDATION_FAILED' })
  await assert.rejects(() => book.reading.ingestEventsBatch({
    events: [{ ...annotationEvent(book.versionId), id: 'unknown-top-level', serverTrusted: true }],
  }), { code: 'VALIDATION_FAILED' })
})

test('P0: 无租约设备事件不得进入统计', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const book = await createBook(fixture)
  const event = annotationEvent(book.versionId, { id: 'no-lease', deviceId: 'unknown-tablet' })
  await assert.rejects(() => book.reading.ingestEventsBatch({ events: [event] }), { code: 'READING_LEASE_REQUIRED' })
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM reading_events').get().count, 0)
})

test('P0: 2035 未来事件不得进入统计', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const book = await createBook(fixture)
  await book.reading.acquireLease({ deviceId: 'tablet-1', bookVersionId: book.versionId })
  const event = annotationEvent(book.versionId, { id: 'future-2035', clientOccurredAt: '2035-01-01T00:00:00.000Z' })
  await assert.rejects(() => book.reading.ingestEventsBatch({ events: [event] }), { code: 'VALIDATION_FAILED' })
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM reading_events').get().count, 0)
})

test('P0: 事件按发生时间匹配已释放租约历史并拒绝租约前后越界', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const book = await createBook(fixture)
  await book.reading.acquireLease({ deviceId: 'tablet-1', bookVersionId: book.versionId, ttlSeconds: 15 })
  fixture.setNow('2026-08-05T10:00:10.000Z')
  await book.reading.takeOverLease({ deviceId: 'tablet-2', bookVersionId: book.versionId })
  fixture.setNow('2026-08-05T10:07:00.000Z')

  const historical = annotationEvent(book.versionId, {
    id: 'historical-valid', clientOccurredAt: '2026-08-05T10:00:05.000Z', offlineSequence: 10,
  })
  assert.deepEqual(await book.reading.ingestEventsBatch({ events: [historical] }), {
    accepted: ['historical-valid'], replayed: [],
  })
  await assert.rejects(() => book.reading.ingestEventsBatch({ events: [annotationEvent(book.versionId, {
    id: 'before-lease', clientOccurredAt: '2026-08-05T09:59:59.000Z', offlineSequence: 11,
  })] }), { code: 'READING_LEASE_REQUIRED' })
  await assert.rejects(() => book.reading.ingestEventsBatch({ events: [annotationEvent(book.versionId, {
    id: 'after-grace', clientOccurredAt: '2026-08-05T10:05:11.000Z', offlineSequence: 12,
  })] }), { code: 'READING_LEASE_REQUIRED' })
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM reading_events').get().count, 1)
  assert.equal(fixture.db.prepare('SELECT valid_reading_seconds FROM reading_progress').get().valid_reading_seconds, 30)
})

test('P0: 过旧事件和越过配置硬上限均被拒绝', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const book = await createBook(fixture)
  await book.reading.acquireLease({ deviceId: 'tablet-1', bookVersionId: book.versionId })
  await assert.rejects(() => book.reading.ingestEventsBatch({ events: [annotationEvent(book.versionId, {
    id: 'too-old', clientOccurredAt: '2026-06-01T00:00:00.000Z', offlineSequence: 13,
  })] }), { code: 'VALIDATION_FAILED' })
  assert.throws(() => createReadingDomain({
    ...fixture.dependencies, maxOfflineAgeMs: 31 * 24 * 60 * 60 * 1000,
  }), /maxOfflineAgeMs/)
  assert.throws(() => createReadingDomain({
    ...fixture.dependencies, futureClockSkewMs: 10 * 60 * 1000 + 1,
  }), /futureClockSkewMs/)
  assert.throws(() => createReadingDomain({
    ...fixture.dependencies, offlineLeaseGraceMs: 30 * 60 * 1000 + 1,
  }), /offlineLeaseGraceMs/)
})

test('P1: offline sequence 唯一键和查询均包含 organization', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const firstBook = await createBook(fixture)
  await firstBook.reading.acquireLease({ deviceId: 'shared-tablet', bookVersionId: firstBook.versionId })
  const firstEvent = annotationEvent(firstBook.versionId, {
    id: 'org-1-event', deviceId: 'shared-tablet', offlineSequence: 91,
  })
  await firstBook.reading.ingestEventsBatch({ events: [firstEvent] })

  fixture.setNow('2026-08-05T10:01:00.000Z')
  const otherDependencies = {
    ...fixture.dependencies,
    workspace: { id: 'class-2', organizationId: 'org-2' },
  }
  const otherReading = createReadingDomain(otherDependencies)
  const otherBook = await otherReading.createBookVersion({
    title: 'local integration/internal test org-2 book', label: 'p1-v1', sourceFormat: 'text',
    pages: [{ pageNo: 1, width: 100, height: 100, textContent: 'local integration/internal test', blocks: [] }],
  })
  await otherReading.publishBook(otherBook.bookId)
  await otherReading.acquireLease({ deviceId: 'shared-tablet', bookVersionId: otherBook.versionId })
  const secondEvent = annotationEvent(otherBook.versionId, {
    id: 'org-2-event', deviceId: 'shared-tablet', clientOccurredAt: '2026-08-05T10:01:00.000Z', offlineSequence: 91,
  })
  assert.deepEqual(await otherReading.ingestEventsBatch({ events: [secondEvent] }), {
    accepted: ['org-2-event'], replayed: [],
  })
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM reading_events').get().count, 2)
})

test('P0: schoolbag 跨 subject/workspace 写回必须拒绝', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  fixture.db.prepare(`INSERT INTO integration_clients (id, issuer, audience, active, created_at, updated_at, version)
    VALUES ('client-1', 'schoolbag-local', 'bubu-reader', 1, '2026-08-05T09:00:00.000Z', '2026-08-05T09:00:00.000Z', 1)`).run()
  const signingKey = Buffer.alloc(32, 9).toString('base64url')
  const returnUri = 'bubu-test://schoolbag/return'
  const simulator = createSchoolbagSimulator({ signingKey, now: fixture.dependencies.now })
  const studentOneBridge = createSchoolbagBridge({
    ...fixture.dependencies, signingKey, expectedDeviceId: 'tablet-1', allowedReturnUris: [returnUri],
  })
  const launchToken = simulator.issue({
    issuer: 'schoolbag-local', audience: 'bubu-reader', subject: 'student-1', deviceId: 'tablet-1',
    bookId: 'book-1', pageNo: 1, classSessionId: 'class-session-1', returnUri, nonce: 'launch-nonce-1',
  })
  const launch = await studentOneBridge.verifyLaunchToken(launchToken)
  const studentTwoBridge = createSchoolbagBridge({
    ...fixture.dependencies,
    actor: { id: 'student-2' }, workspace: { id: 'class-2', organizationId: 'org-1' },
    signingKey, expectedDeviceId: 'tablet-1', allowedReturnUris: [returnUri],
  })
  const crossScopeToken = simulator.issue({
    issuer: 'schoolbag-local', audience: 'bubu-reader', subject: 'student-2', deviceId: 'tablet-1',
    bookId: 'book-1', pageNo: 1, classSessionId: 'class-session-2', returnUri, nonce: 'launch-nonce-2',
  })
  await assert.rejects(() => studentTwoBridge.recordReturn({ launchId: launch.launchId, token: crossScopeToken, pageNo: 2 }), { code: 'RESOURCE_NOT_FOUND' })
})

test('P0: schoolbag 写回重新验过期并拒绝同 subject 的错误课堂令牌', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  fixture.db.prepare(`INSERT INTO integration_clients (id, issuer, audience, active, created_at, updated_at, version)
    VALUES ('client-1', 'schoolbag-local', 'bubu-reader', 1, '2026-08-05T09:00:00.000Z', '2026-08-05T09:00:00.000Z', 1)`).run()
  const signingKey = Buffer.alloc(32, 8).toString('base64url')
  const returnUri = 'bubu-test://schoolbag/return'
  const simulator = createSchoolbagSimulator({ signingKey, now: fixture.dependencies.now })
  const bridge = createSchoolbagBridge({
    ...fixture.dependencies, signingKey, expectedDeviceId: 'tablet-1', allowedReturnUris: [returnUri],
  })
  const expiring = simulator.issue({
    issuer: 'schoolbag-local', audience: 'bubu-reader', subject: 'student-1', deviceId: 'tablet-1',
    bookId: 'book-1', classSessionId: 'class-session-1', returnUri, nonce: 'expiring-nonce',
    issuedAt: '2026-08-05T10:00:00.000Z', expiresAt: '2026-08-05T10:01:00.000Z',
  })
  const expiringLaunch = await bridge.verifyLaunchToken(expiring)
  fixture.setNow('2026-08-05T10:02:00.000Z')
  await assert.rejects(() => bridge.recordReturn({ launchId: expiringLaunch.launchId, token: expiring }), { code: 'TOKEN_EXPIRED' })

  fixture.setNow('2026-08-05T10:00:00.000Z')
  const firstClass = simulator.issue({
    issuer: 'schoolbag-local', audience: 'bubu-reader', subject: 'student-1', deviceId: 'tablet-1',
    bookId: 'book-1', classSessionId: 'class-session-1', returnUri, nonce: 'class-1-nonce',
  })
  const secondClass = simulator.issue({
    issuer: 'schoolbag-local', audience: 'bubu-reader', subject: 'student-1', deviceId: 'tablet-1',
    bookId: 'book-1', classSessionId: 'class-session-2', returnUri, nonce: 'class-2-nonce',
  })
  const firstLaunch = await bridge.verifyLaunchToken(firstClass)
  await assert.rejects(() => bridge.recordReturn({ launchId: firstLaunch.launchId, token: secondClass }), { code: 'RESOURCE_NOT_FOUND' })
  await bridge.recordReturn({ launchId: firstLaunch.launchId, token: firstClass, pageNo: 2 })
  await assert.rejects(() => bridge.recordReturn({ launchId: firstLaunch.launchId, token: firstClass }), { code: 'RETURN_ALREADY_RECORDED' })
})

test('P1: 013 可从 010-012 前向升级且重复执行保持数据与约束', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'bubu-c-013-'))
  const db = new DatabaseSync(path.join(directory, 'upgrade.sqlite'))
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }) })
  const migrationDirectory = new URL('../../../server/db/migrations/', import.meta.url)
  for (const file of ['010_reading_catalog.sql', '011_reading_activity.sql', '012_teaching_bridge.sql']) {
    db.exec(readFileSync(new URL(file, migrationDirectory), 'utf8'))
  }
  db.prepare(`INSERT INTO reading_events
      (id, organization_id_at_creation, actor_id_at_creation, workspace_id_at_creation, device_id,
        book_version_id, page_no, event_type, client_occurred_at, received_at, foreground, screen_on,
        offline_sequence, event_fingerprint, payload_json, valid_reading_seconds, valid_eye_seconds,
        created_at, updated_at, version)
    VALUES ('legacy-event', 'org-1', 'student-1', 'class-1', 'tablet-1', 'version-1', 1,
      'page_stay', '2026-08-05T10:00:00.000Z', '2026-08-05T10:01:00.000Z', 1, 1, 1,
      'legacy-fingerprint', '{}', 30, 30, '2026-08-05T10:01:00.000Z', '2026-08-05T10:01:00.000Z', 1)`).run()
  const migration013 = readFileSync(new URL('013_reading_security_scopes.sql', migrationDirectory), 'utf8')
  db.exec(migration013)
  db.exec(migration013)

  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM reading_events WHERE id = 'legacy-event'").get().count, 1)
  assert.deepEqual(
    db.prepare("PRAGMA index_info('reading_events_tenant_device_offline_sequence_unique')").all().map((row) => row.name),
    ['organization_id_at_creation', 'actor_id_at_creation', 'device_id', 'offline_sequence'],
  )
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'reading_events_device_offline_sequence_unique'").get().count, 0)
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('reading_device_lease_history', 'integration_launch_scopes')").get().count, 2)
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'integration_launch_scopes_immutable_%'").get().count, 2)
  db.prepare(`INSERT INTO integration_clients (id, issuer, audience, active, created_at, updated_at, version)
    VALUES ('client-1', 'local-integration', 'reader', 1, '2026-08-05T10:00:00.000Z', '2026-08-05T10:00:00.000Z', 1)`).run()
  db.prepare(`INSERT INTO integration_launches
      (id, client_id, subject_id, device_id, book_id, class_session_id, return_uri, launched_at, created_at, updated_at, version)
    VALUES ('launch-1', 'client-1', 'student-1', 'tablet-1', 'book-1', 'class-1', 'bubu-test://return',
      '2026-08-05T10:00:00.000Z', '2026-08-05T10:00:00.000Z', '2026-08-05T10:00:00.000Z', 1)`).run()
  db.prepare(`INSERT INTO integration_launch_scopes
      (launch_id, client_id, organization_id, workspace_id, actor_id, subject_student_id,
        class_session_id, book_id, device_id, token_nonce, token_fingerprint, created_at)
    VALUES ('launch-1', 'client-1', 'org-1', 'workspace-1', 'student-1', 'student-1',
      'class-1', 'book-1', 'tablet-1', 'nonce-1', 'fingerprint-1', '2026-08-05T10:00:00.000Z')`).run()
  assert.throws(() => db.prepare("UPDATE integration_launches SET subject_id = 'student-2' WHERE id = 'launch-1'").run(), /immutable/)
  assert.throws(() => db.prepare("UPDATE integration_launch_scopes SET workspace_id = 'workspace-2' WHERE launch_id = 'launch-1'").run(), /immutable/)
})
