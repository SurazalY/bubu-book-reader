import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import vm from 'node:vm'

import { createCommunityDomain } from '../../../server/domains/community/index.js'
import { createReportsDomain } from '../../../server/domains/reports/index.js'
import { createDeliveryDomain, createLocalDeliveryAdapter, DeliveryAdapterError } from '../../../server/domains/delivery/index.js'
import { DomainError } from '../../../server/domains/delivery/primitives.js'
import { enqueueOutboxEvent } from '../../../server/db/reliability.js'

const reliabilityMigration = { path: new URL('../../../server/db/migrations/002_reliability.sql', import.meta.url) }
const migrations = [
  { path: new URL('../../../server/db/migrations/030_community_reports_delivery.sql', import.meta.url) },
  { path: new URL('../../../server/db/migrations/031_summary_link_revocations.sql', import.meta.url) },
  { path: new URL('../../../server/db/migrations/032_contact_workspace_delivery_claims.sql', import.meta.url) },
  { path: new URL('../../../server/db/migrations/033_community_multistage_review.sql', import.meta.url) },
]
const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const pngSha256 = createHash('sha256').update(pngBytes).digest('hex')
const communitySubmitPermissions = ['community.submit']
const reportPermissions = ['report.generate', 'report.review', 'report.send']

function applyMigrationSequence(db) {
  db.exec('CREATE TABLE IF NOT EXISTS test_schema_migrations (migration_name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  for (const migration of [reliabilityMigration, ...migrations]) {
    const migrationName = migration.path.href
    if (db.prepare('SELECT 1 FROM test_schema_migrations WHERE migration_name = ?').get(migrationName)) continue
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(readFileSync(migration.path, 'utf8'))
      db.prepare('INSERT INTO test_schema_migrations (migration_name, applied_at) VALUES (?, ?)').run(migrationName, '2026-08-05T00:00:00.000Z')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

function createFixture({ permissions = communitySubmitPermissions, adapterMode = 'success', adapter, canAccessStudent, claimLeaseMs, miniProgramReceiptVerifier, summaryLinkSigningKey = randomBytes(32), initialNow, outboxFactory } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'reader-e-domain-'))
  const databasePath = join(directory, 'state.sqlite')
  const db = new DatabaseSync(databasePath)
  applyMigrationSequence(db)
  applyMigrationSequence(db)
  let activeActor = { id: 'student-1', permissions: [...permissions] }
  let activeNow = initialNow ? new Date(initialNow) : null
  const authorizedStudents = new Set(['student-1', 'student-2'])
  const workspace = {
    id: 'class-1',
    organizationId: 'school-1',
    snapshot: { classId: 'class-1' },
    organizationSnapshot: { schoolId: 'school-1' },
    canAccessStudent: (studentId, authorizedActor) => canAccessStudent
      ? canAccessStudent({ studentId, actor: authorizedActor, db })
      : authorizedStudents.has(studentId)
  }
  const outbox = typeof outboxFactory === 'function' ? outboxFactory(db) : undefined
  const common = { db, actor: () => activeActor, workspace, outbox, idGenerator: randomUUID, adapter: adapter || createLocalDeliveryAdapter({ mode: adapterMode }), claimLeaseMs, miniProgramReceiptVerifier, summaryLinkSigningKey, clock: activeNow ? () => new Date(activeNow) : undefined }
  return {
    db,
    databasePath,
    community: createCommunityDomain(common),
    reports: createReportsDomain(common),
    delivery: createDeliveryDomain(common),
    become(id, nextPermissions) { activeActor = { id, permissions: [...nextPermissions] } },
    setNow(value) { activeNow = new Date(value) },
    close() { db.close(); rmSync(directory, { recursive: true, force: true }) }
  }
}

test('业务写入与 outbox 同事务，事件入队失败时不留下半成品', async (context) => {
  const failingOutbox = (failedType) => (db) => ({
    enqueue(event) {
      if (event.type === failedType) throw new Error(`forced outbox failure: ${failedType}`)
      return enqueueOutboxEvent(db, event)
    }
  })

  const reportFixture = createFixture({ permissions: reportPermissions, outboxFactory: failingOutbox('report.generated') })
  context.after(() => reportFixture.close())
  assert.throws(() => reportFixture.reports.generateReport({ studentId: 'student-1', snapshotKey: 'atomic-report', content: { minutes: 10 } }), /forced outbox failure/)
  assert.equal(reportFixture.db.prepare('SELECT COUNT(*) AS count FROM reports').get().count, 0)
  assert.equal(reportFixture.db.prepare('SELECT COUNT(*) AS count FROM report_versions').get().count, 0)

  const communityFixture = createFixture({ outboxFactory: failingOutbox('community.post_submitted') })
  context.after(() => communityFixture.close())
  assert.throws(() => communityFixture.community.submitPost({ title: '原子投稿', body: '事件失败时不保留投稿' }), /forced outbox failure/)
  assert.equal(communityFixture.db.prepare('SELECT COUNT(*) AS count FROM community_posts').get().count, 0)

  const deliveryFixture = createFixture({ permissions: reportPermissions, outboxFactory: failingOutbox('report.delivery_queued') })
  context.after(() => deliveryFixture.close())
  const report = await deliveryFixture.reports.generateReport({ studentId: 'student-1', snapshotKey: 'atomic-delivery', content: { minutes: 15 } })
  const reviewed = await deliveryFixture.reports.reviewReport({ reportId: report.id })
  const contact = deliveryFixture.delivery.createContact({ studentId: 'student-1', displayName: '脱敏家长', destination: 'atomic-destination', channel: 'sms' })
  await assert.rejects(() => deliveryFixture.delivery.queueDelivery({ reportVersionId: reviewed.current_version_id, parentContactId: contact.id }), /forced outbox failure/)
  assert.equal(deliveryFixture.db.prepare('SELECT COUNT(*) AS count FROM report_deliveries').get().count, 0)
  assert.equal(deliveryFixture.db.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE topic = 'report.delivery_queued'").get().count, 0)
})

test('安全链接接受隔离运行域传入的标准二进制签名密钥', async (context) => {
  const foreignSigningKey = vm.runInNewContext('new Uint8Array(32).fill(7)')
  const fixture = createFixture({ permissions: reportPermissions, summaryLinkSigningKey: foreignSigningKey })
  context.after(() => fixture.close())
  const report = fixture.reports.generateReport({ studentId: 'student-1', snapshotKey: 'foreign-realm-signing-key', content: { minutes: 8 } })
  const reviewed = fixture.reports.reviewReport({ reportId: report.id })
  const contact = fixture.delivery.createContact({ studentId: 'student-1', displayName: '脱敏家长', destination: 'foreign-realm-destination', channel: 'summary_link' })
  const queued = await fixture.delivery.queueDelivery({ reportVersionId: reviewed.current_version_id, parentContactId: contact.id })

  assert.equal(queued.status, 'queued')
  assert.ok(queued.linkToken)
})

async function expectDomainError(callback, code) {
  await assert.rejects(async () => callback(), (error) => error instanceof DomainError && error.code === code)
}

test('032 前向迁移保留旧投递数据并将旧联系人隔离为未归属', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'reader-e-migration-'))
  const db = new DatabaseSync(join(directory, 'migration.sqlite'))
  context.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }) })
  db.exec(readFileSync(migrations[0].path, 'utf8'))
  db.exec(readFileSync(migrations[1].path, 'utf8'))
  const createdAt = '2026-08-05T10:00:00.000Z'
  db.prepare(`INSERT INTO parent_contacts (id, organization_id_at_creation, student_id, display_name, destination, channel, created_at, updated_at, version) VALUES ('legacy-contact', 'school-1', 'student-1', '旧联系人', 'legacy-destination', 'sms', ?, ?, 1)`).run(createdAt, createdAt)
  db.prepare(`INSERT INTO report_deliveries (id, report_version_id, parent_contact_id, channel, status, attempt_count, max_attempts, created_at, updated_at, version) VALUES ('legacy-delivery', 'legacy-version', 'legacy-contact', 'sms', 'sent', 1, 3, ?, ?, 1)`).run(createdAt, createdAt)
  db.prepare(`INSERT INTO delivery_attempts (id, delivery_id, attempt_number, adapter_name, outcome, provider_reference, created_at) VALUES ('legacy-attempt', 'legacy-delivery', 1, 'legacy-adapter', 'sent', 'legacy-reference', ?)`).run(createdAt)
  db.exec(readFileSync(migrations[2].path, 'utf8'))
  assert.equal(db.prepare(`SELECT workspace_id_at_creation FROM parent_contacts WHERE id = 'legacy-contact'`).get().workspace_id_at_creation, '__legacy_unscoped__')
  assert.equal(db.prepare(`SELECT status FROM report_deliveries WHERE id = 'legacy-delivery'`).get().status, 'sent')
  assert.deepEqual({ ...db.prepare(`SELECT adapter_phase, reconciliation_status FROM delivery_attempts WHERE id = 'legacy-attempt'`).get() }, { adapter_phase: 'legacy', reconciliation_status: 'none' })
})

test('学生投稿经过基础图片校验、人工审核后才能轻互动或收藏', async (context) => {
  const fixture = createFixture()
  context.after(() => fixture.close())
  await expectDomainError(() => fixture.community.submitPost({ title: '读书心得', body: '内容', images: [{ mimeType: 'image/svg+xml', sizeBytes: 100, sha256: 'a'.repeat(64), originalName: 'unsafe.svg' }] }), 'VALIDATION_FAILED')
  await expectDomainError(() => fixture.community.submitPost({ title: '读书心得', body: '内容', images: [{ mimeType: 'image/png', sizeBytes: pngBytes.length, sha256: 'a'.repeat(64), originalName: 'forged.png', bytes: pngBytes }] }), 'VALIDATION_FAILED')
  const post = await fixture.community.submitPost({ title: '读书心得', body: '我读到了新的细节', images: [{ mimeType: 'image/png', sizeBytes: pngBytes.length, sha256: pngSha256, originalName: 'note.png', bytes: pngBytes }] })
  await expectDomainError(() => fixture.community.react({ postId: post.id, reactionType: 'bookmark' }), 'VERSION_CONFLICT')
  fixture.become('teacher-1', ['community.moderate'])
  await fixture.community.reviewPost({ postId: post.id, decision: 'approved', reason: '人工复核通过' })
  fixture.become('student-2', communitySubmitPermissions)
  const firstReaction = await fixture.community.react({ postId: post.id, reactionType: 'bookmark' })
  const duplicateReaction = await fixture.community.react({ postId: post.id, reactionType: 'bookmark' })
  assert.equal(firstReaction.created, true)
  assert.equal(duplicateReaction.created, false)
  assert.equal(duplicateReaction.post.reactions.find((item) => item.reactionType === 'bookmark').count, 1)
  await expectDomainError(() => fixture.community.removeReaction({ postId: post.id, reactionType: 'unknown' }), 'VALIDATION_FAILED')
  const foreignCommunity = createCommunityDomain({ db: fixture.db, actor: () => ({ id: 'student-2', permissions: communitySubmitPermissions }), workspace: { id: 'class-2', organizationId: 'school-1' } })
  await expectDomainError(() => foreignCommunity.removeReaction({ postId: post.id, reactionType: 'bookmark' }), 'RESOURCE_NOT_FOUND')
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM post_reactions WHERE post_id = ? AND actor_id = ?').get(post.id, 'student-2').count, 1)
})

test('权限默认拒绝且跨工作空间操作被拒绝', async (context) => {
  const fixture = createFixture({ permissions: communitySubmitPermissions })
  context.after(() => fixture.close())
  const post = await fixture.community.submitPost({ title: '读书心得', body: '内容' })
  await expectDomainError(() => fixture.community.reviewPost({ postId: post.id, decision: 'approved', reason: '越权' }), 'PERMISSION_DENIED')
  fixture.become('teacher-1', ['community.moderate'])
  const foreignCommunity = createCommunityDomain({ db: fixture.db, actor: () => ({ id: 'teacher-1', permissions: ['community.moderate'] }), workspace: { id: 'class-2', organizationId: 'school-1' } })
  await expectDomainError(() => foreignCommunity.reviewPost({ postId: post.id, decision: 'approved', reason: '跨空间' }), 'RESOURCE_NOT_FOUND')
  const denyByDefault = createCommunityDomain({ db: fixture.db, actor: () => ({ id: 'actor-without-permissions' }), workspace: { id: 'class-1', organizationId: 'school-1' } })
  await expectDomainError(() => denyByDefault.submitPost({ title: '无授权投稿', body: '应拒绝' }), 'PERMISSION_DENIED')
  const unresolvedAsyncPermission = createCommunityDomain({ db: fixture.db, actor: () => ({ id: 'actor-with-async-can', can: async () => true }), workspace: { id: 'class-1', organizationId: 'school-1' } })
  await expectDomainError(() => unresolvedAsyncPermission.submitPost({ title: '异步权限未解析', body: '应拒绝' }), 'PERMISSION_DENIED')
})

test('报告版本必须人工审核，失败重试真实落库，短信不产生打开或已读', async (context) => {
  const fixture = createFixture({ permissions: reportPermissions, adapterMode: 'failure' })
  context.after(() => fixture.close())
  const generated = await fixture.reports.generateReport({ studentId: 'student-1', snapshotKey: 'reading-v1', content: { minutes: 35 } })
  assert.equal(generated.versions[0].ai_generated, true)
  assert.match(generated.versions[0].ai_notice, /AI/)
  const reused = await fixture.reports.generateReport({ studentId: 'student-1', snapshotKey: 'reading-v1', content: { minutes: 35 } })
  const revised = await fixture.reports.generateReport({ studentId: 'student-1', snapshotKey: 'reading-v1', content: { minutes: 36 }, forceNewVersion: true })
  assert.equal(reused.versions.length, 1)
  assert.equal(revised.versions.length, 2)
  const contact = fixture.delivery.createContact({ studentId: 'student-1', displayName: '脱敏家长', destination: 'test-sms-destination', channel: 'sms' })
  await expectDomainError(() => fixture.delivery.queueDelivery({ reportVersionId: generated.current_version_id, parentContactId: contact.id }), 'HUMAN_REVIEW_REQUIRED')
  const reviewed = await fixture.reports.reviewReport({ reportId: generated.id })
  const queued = await fixture.delivery.queueDelivery({ reportVersionId: reviewed.current_version_id, parentContactId: contact.id, maxAttempts: 2 })
  const firstFailure = await fixture.delivery.processDelivery({ deliveryId: queued.id })
  assert.equal(firstFailure.status, 'retry_scheduled')
  const secondFailure = await fixture.delivery.processDelivery({ deliveryId: queued.id })
  assert.equal(secondFailure.status, 'failed')
  assert.equal(secondFailure.attempt_count, 2)
  assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM delivery_attempts WHERE delivery_id = ?').get(queued.id).count, 2)
  await expectDomainError(() => fixture.delivery.processDelivery({ deliveryId: queued.id }), 'VERSION_CONFLICT')
  await expectDomainError(() => fixture.delivery.recordReceipt({ deliveryId: queued.id, kind: 'opened', externalEventId: 'sms-open-1' }), 'VALIDATION_FAILED')
})

test('投递审核绑定目标报告版本，已审核旧版本可发送而未审核新版本被拒绝', async (context) => {
  const fixture = createFixture({ permissions: reportPermissions, adapterMode: 'success' })
  context.after(() => fixture.close())
  const first = await fixture.reports.generateReport({ studentId: 'student-1', snapshotKey: 'reading-version-review', content: { minutes: 20 } })
  const reviewed = await fixture.reports.reviewReport({ reportId: first.id })
  const reviewedVersionId = reviewed.current_version_id
  const revised = await fixture.reports.generateReport({ studentId: 'student-1', snapshotKey: 'reading-version-review', content: { minutes: 25 }, forceNewVersion: true })
  const contact = fixture.delivery.createContact({ studentId: 'student-1', displayName: '脱敏家长', destination: 'version-review-destination', channel: 'sms' })
  const wrongStudentContact = fixture.delivery.createContact({ studentId: 'student-2', displayName: '错收件人', destination: 'wrong-student-destination', channel: 'sms' })
  const foreignDelivery = createDeliveryDomain({ db: fixture.db, actor: () => ({ id: 'teacher-2', permissions: ['report.send'] }), workspace: { id: 'class-2', organizationId: 'school-1', canAccessStudent: (studentId) => studentId === 'student-1' } })
  const wrongWorkspaceContact = foreignDelivery.createContact({ studentId: 'student-1', displayName: '跨班联系人', destination: 'wrong-workspace-destination', channel: 'sms' })
  const oldVersionDelivery = await fixture.delivery.queueDelivery({ reportVersionId: reviewedVersionId, parentContactId: contact.id })
  assert.equal(oldVersionDelivery.status, 'queued')
  await expectDomainError(() => fixture.delivery.queueDelivery({ reportVersionId: reviewedVersionId, parentContactId: wrongStudentContact.id }), 'VALIDATION_FAILED')
  await expectDomainError(() => fixture.delivery.queueDelivery({ reportVersionId: reviewedVersionId, parentContactId: wrongWorkspaceContact.id }), 'RESOURCE_NOT_FOUND')
  await expectDomainError(() => fixture.delivery.queueDelivery({ reportVersionId: revised.current_version_id, parentContactId: contact.id }), 'HUMAN_REVIEW_REQUIRED')
})

test('报告、学生、联系人和工作空间在同一事务授权关系中绑定', async (context) => {
  const authorizationTransactions = []
  const fixture = createFixture({
    permissions: reportPermissions,
    canAccessStudent: ({ studentId, actor, db }) => {
      authorizationTransactions.push(db.isTransaction)
      return actor.id === 'student-1' && studentId === 'student-1'
    }
  })
  context.after(() => fixture.close())
  const report = await fixture.reports.generateReport({ studentId: 'student-1', snapshotKey: 'transactional-recipient-binding', content: { minutes: 24 } })
  const reviewed = await fixture.reports.reviewReport({ reportId: report.id })
  const contact = fixture.delivery.createContact({ studentId: 'student-1', displayName: '脱敏家长', destination: 'transaction-bound-destination', channel: 'sms' })
  assert.equal(fixture.db.prepare('SELECT workspace_id_at_creation FROM parent_contacts WHERE id = ?').get(contact.id).workspace_id_at_creation, 'class-1')
  const queued = await fixture.delivery.queueDelivery({ reportVersionId: reviewed.current_version_id, parentContactId: contact.id })
  assert.equal(queued.status, 'queued')
  assert.deepEqual(authorizationTransactions, [true, true, true, true, false])

  const missingStudentRelation = createDeliveryDomain({ db: fixture.db, actor: () => ({ id: 'teacher-1', permissions: ['report.send'] }), workspace: { id: 'class-1', organizationId: 'school-1' } })
  await expectDomainError(() => missingStudentRelation.createContact({ studentId: 'student-1', displayName: '无关系联系人', destination: 'missing-relation-destination', channel: 'sms' }), 'PERMISSION_DENIED')
  const deniedStudentRelation = createDeliveryDomain({ db: fixture.db, actor: () => ({ id: 'teacher-1', permissions: ['report.send'] }), workspace: { id: 'class-1', organizationId: 'school-1', canAccessStudent: () => false } })
  await expectDomainError(() => deniedStudentRelation.getDelivery(queued.id), 'PERMISSION_DENIED')
  await expectDomainError(() => deniedStudentRelation.processDelivery({ deliveryId: queued.id }), 'PERMISSION_DENIED')
  await expectDomainError(() => deniedStudentRelation.unsubscribeContact({ contactId: contact.id }), 'PERMISSION_DENIED')
  await expectDomainError(() => deniedStudentRelation.recordReceipt({ deliveryId: queued.id, kind: 'opened', externalEventId: 'denied-student-receipt' }), 'PERMISSION_DENIED')
})

test('安全链接限制 TTL 并校验签名，撤销、过期和重复打开均失败', async (context) => {
  const baseTime = '2026-08-05T10:00:00.000Z'
  const fixture = createFixture({ permissions: reportPermissions, adapterMode: 'success', initialNow: baseTime })
  context.after(() => fixture.close())
  const report = await fixture.reports.generateReport({ studentId: 'student-1', snapshotKey: 'reading-v2', content: { minutes: 40 } })
  const reviewed = await fixture.reports.reviewReport({ reportId: report.id })
  const contact = fixture.delivery.createContact({ studentId: 'student-1', displayName: '脱敏家长', destination: 'safe-link-destination', channel: 'summary_link' })
  const unsignedDelivery = createDeliveryDomain({ db: fixture.db, actor: () => ({ id: 'teacher-1', permissions: ['report.send'] }), workspace: { id: 'class-1', organizationId: 'school-1', canAccessStudent: (studentId) => studentId === 'student-1' } })
  await expectDomainError(() => unsignedDelivery.queueDelivery({ reportVersionId: reviewed.current_version_id, parentContactId: contact.id }), 'DEPENDENCY_UNAVAILABLE')
  const sent = await fixture.delivery.queueDelivery({ reportVersionId: reviewed.current_version_id, parentContactId: contact.id })
  assert.ok(sent.linkToken)
  assert.notEqual(sent.linkToken, sent.link_token_hash)
  assert.equal(fixture.db.prepare('SELECT link_token_hash FROM report_deliveries WHERE id = ?').get(sent.id).link_token_hash, createHash('sha256').update(sent.linkToken).digest('hex'))
  assert.equal(Date.parse(sent.link_expires_at) - Date.parse(sent.created_at), 24 * 60 * 60 * 1000)
  await expectDomainError(() => fixture.delivery.queueDelivery({ reportVersionId: reviewed.current_version_id, parentContactId: contact.id, linkExpiresAt: '2020-01-01T00:00:00.000Z' }), 'VALIDATION_FAILED')
  await expectDomainError(() => fixture.delivery.queueDelivery({ reportVersionId: reviewed.current_version_id, parentContactId: contact.id, linkExpiresAt: new Date(Date.parse(baseTime) + 8 * 24 * 60 * 60 * 1000).toISOString() }), 'VALIDATION_FAILED')
  await fixture.delivery.processDelivery({ deliveryId: sent.id })
  const foreignDelivery = createDeliveryDomain({ db: fixture.db, actor: () => ({ id: 'teacher-1', permissions: ['report.send'] }), workspace: { id: 'class-2', organizationId: 'school-1', canAccessStudent: (studentId) => studentId === 'student-1' }, adapter: createLocalDeliveryAdapter({ mode: 'success' }) })
  await expectDomainError(() => foreignDelivery.getDelivery(sent.id), 'RESOURCE_NOT_FOUND')
  await expectDomainError(() => foreignDelivery.processDelivery({ deliveryId: sent.id }), 'RESOURCE_NOT_FOUND')
  await expectDomainError(() => foreignDelivery.recordReceipt({ deliveryId: sent.id, kind: 'opened', externalEventId: 'foreign-open-1', linkToken: sent.linkToken }), 'RESOURCE_NOT_FOUND')
  await expectDomainError(() => fixture.delivery.recordReceipt({ deliveryId: sent.id, kind: 'opened', externalEventId: 'missing-token' }), 'PERMISSION_DENIED')
  await expectDomainError(() => fixture.delivery.recordReceipt({ deliveryId: sent.id, kind: 'opened', externalEventId: 'wrong-token', linkToken: 'wrong-token' }), 'PERMISSION_DENIED')
  const wrongSigningKeyDelivery = createDeliveryDomain({ db: fixture.db, actor: () => ({ id: 'receipt-service', permissions: ['report.send'] }), workspace: { id: 'class-1', organizationId: 'school-1', canAccessStudent: (studentId) => studentId === 'student-1' }, summaryLinkSigningKey: randomBytes(32) })
  await expectDomainError(() => wrongSigningKeyDelivery.recordReceipt({ deliveryId: sent.id, kind: 'opened', externalEventId: 'wrong-signing-key', linkToken: sent.linkToken }), 'PERMISSION_DENIED')
  const opened = await fixture.delivery.recordReceipt({ deliveryId: sent.id, kind: 'opened', externalEventId: 'open-1', linkToken: sent.linkToken })
  await expectDomainError(() => fixture.delivery.recordReceipt({ deliveryId: sent.id, kind: 'opened', externalEventId: 'open-again', linkToken: sent.linkToken }), 'VERSION_CONFLICT')
  const read = await fixture.delivery.recordReceipt({ deliveryId: sent.id, kind: 'read', externalEventId: 'read-1', linkToken: sent.linkToken })
  assert.equal(opened.duplicate, false)
  assert.equal(read.delivery.first_opened_at, opened.delivery.first_opened_at)
  assert.ok(read.delivery.first_read_at)
  const expiresSoon = new Date(Date.parse(baseTime) + 60 * 60 * 1000).toISOString()
  const expiring = await fixture.delivery.queueDelivery({ reportVersionId: reviewed.current_version_id, parentContactId: contact.id, linkExpiresAt: expiresSoon })
  await fixture.delivery.processDelivery({ deliveryId: expiring.id })
  fixture.setNow(new Date(Date.parse(expiresSoon) + 1000).toISOString())
  await expectDomainError(() => fixture.delivery.recordReceipt({ deliveryId: expiring.id, kind: 'opened', externalEventId: 'expired-open', linkToken: expiring.linkToken, receivedAt: baseTime }), 'VERSION_CONFLICT')
  assert.equal(fixture.delivery.getDelivery(expiring.id).status, 'expired')
  const revocable = await fixture.delivery.queueDelivery({ reportVersionId: reviewed.current_version_id, parentContactId: contact.id })
  await fixture.delivery.processDelivery({ deliveryId: revocable.id })
  await fixture.delivery.revokeSummaryLink({ deliveryId: revocable.id, reason: '家长联系人变更' })
  await expectDomainError(() => fixture.delivery.recordReceipt({ deliveryId: revocable.id, kind: 'opened', externalEventId: 'revoked-open', linkToken: revocable.linkToken }), 'PERMISSION_DENIED')
})

test('小程序回执无验证或验证失败时拒绝，仅接受运行时 verifier 通过的回执', async (context) => {
  const fixture = createFixture({ permissions: reportPermissions, adapterMode: 'success' })
  context.after(() => fixture.close())
  const report = await fixture.reports.generateReport({ studentId: 'student-1', snapshotKey: 'mini-program-receipt', content: { minutes: 30 } })
  const reviewed = await fixture.reports.reviewReport({ reportId: report.id })
  const contact = fixture.delivery.createContact({ studentId: 'student-1', displayName: '脱敏家长', destination: 'mini-program-destination', channel: 'mini_program' })
  const sent = await fixture.delivery.queueDelivery({ reportVersionId: reviewed.current_version_id, parentContactId: contact.id })
  await fixture.delivery.processDelivery({ deliveryId: sent.id })
  await expectDomainError(() => fixture.delivery.recordReceipt({ deliveryId: sent.id, kind: 'opened', externalEventId: 'mini-no-verifier' }), 'PERMISSION_DENIED')
  const verifiedDelivery = createDeliveryDomain({ db: fixture.db, actor: () => ({ id: 'receipt-service', permissions: ['report.send'] }), workspace: { id: 'class-1', organizationId: 'school-1', canAccessStudent: (studentId) => studentId === 'student-1' }, miniProgramReceiptVerifier: async ({ verification }) => verification?.signature === 'local-valid' })
  await expectDomainError(() => verifiedDelivery.recordReceipt({ deliveryId: sent.id, kind: 'opened', externalEventId: 'mini-invalid', verification: { signature: 'local-invalid' } }), 'PERMISSION_DENIED')
  const accepted = await verifiedDelivery.recordReceipt({ deliveryId: sent.id, kind: 'opened', externalEventId: 'mini-valid', verification: { signature: 'local-valid' } })
  assert.equal(accepted.accepted, true)
})

test('短信发送任务使用状态和版本原子领取，第二个并发执行器不能重复外发', async (context) => {
  let releaseSend
  const sendGate = new Promise((resolve) => { releaseSend = resolve })
  let sendCalls = 0
  const providerKeys = []
  const controlledAdapter = {
    name: 'controlled-local-adapter',
    async send({ deliveryId, attemptNumber, providerIdempotencyKey }) {
      sendCalls += 1
      providerKeys.push(providerIdempotencyKey)
      await sendGate
      return { ok: true, providerReference: `controlled:${deliveryId}:${attemptNumber}`, providerMessageId: `provider-message:${deliveryId}:${attemptNumber}` }
    }
  }
  const fixture = createFixture({ permissions: reportPermissions, adapter: controlledAdapter })
  context.after(() => fixture.close())
  const report = await fixture.reports.generateReport({ studentId: 'student-1', snapshotKey: 'atomic-claim', content: { minutes: 15 } })
  const reviewed = await fixture.reports.reviewReport({ reportId: report.id })
  const contact = fixture.delivery.createContact({ studentId: 'student-1', displayName: '脱敏家长', destination: 'claim-destination', channel: 'sms' })
  const queued = await fixture.delivery.queueDelivery({ reportVersionId: reviewed.current_version_id, parentContactId: contact.id })
  assert.equal(queued.channel, 'sms')
  const firstExecution = fixture.delivery.processDelivery({ deliveryId: queued.id })
  assert.equal(sendCalls, 1)
  await expectDomainError(() => fixture.delivery.processDelivery({ deliveryId: queued.id }), 'VERSION_CONFLICT')
  releaseSend()
  const completed = await firstExecution
  assert.equal(completed.status, 'sent')
  assert.equal(completed.provider_message_id, `provider-message:${queued.id}:1`)
  assert.equal(sendCalls, 1)
  assert.deepEqual(providerKeys, [`${queued.id}:1`])
})

test('发送租约过期转待对账，迟到结果不能覆盖且对账确认发送后不再外发', async (context) => {
  const baseTime = '2026-08-05T11:00:00.000Z'
  let releaseSend
  const sendGate = new Promise((resolve) => { releaseSend = resolve })
  let sendCalls = 0
  const delayedAdapter = {
    name: 'delayed-local-adapter',
    async send({ deliveryId, attemptNumber }) {
      sendCalls += 1
      await sendGate
      return { ok: true, providerReference: `late:${deliveryId}:${attemptNumber}`, providerMessageId: 'late-provider-message-1' }
    }
  }
  const fixture = createFixture({ permissions: reportPermissions, adapter: delayedAdapter, claimLeaseMs: 1000, initialNow: baseTime })
  context.after(() => fixture.close())
  const report = await fixture.reports.generateReport({ studentId: 'student-1', snapshotKey: 'expired-claim-reconciliation', content: { minutes: 19 } })
  const reviewed = await fixture.reports.reviewReport({ reportId: report.id })
  const contact = fixture.delivery.createContact({ studentId: 'student-1', displayName: '脱敏家长', destination: 'expired-claim-destination', channel: 'sms' })
  const queued = await fixture.delivery.queueDelivery({ reportVersionId: reviewed.current_version_id, parentContactId: contact.id })
  const firstExecution = fixture.delivery.processDelivery({ deliveryId: queued.id })
  assert.equal(sendCalls, 1)
  fixture.setNow('2026-08-05T11:00:01.001Z')
  const unknown = await fixture.delivery.markExpiredClaimUnknown({ deliveryId: queued.id })
  assert.equal(unknown.status, 'unknown_reconciliation')
  assert.equal(unknown.reconciliation_status, 'unknown')
  releaseSend()
  await expectDomainError(() => firstExecution, 'VERSION_CONFLICT')
  assert.equal(sendCalls, 1)
  const reconciled = await fixture.delivery.reconcileDelivery({ deliveryId: queued.id, outcome: 'sent', providerReference: 'provider-confirmed-sent', providerMessageId: 'late-provider-message-1' })
  assert.equal(reconciled.status, 'sent')
  assert.equal(reconciled.provider_message_id, 'late-provider-message-1')
  await expectDomainError(() => fixture.delivery.processDelivery({ deliveryId: queued.id }), 'VERSION_CONFLICT')
  assert.equal(sendCalls, 1)
})

test('适配器确定失败异常落失败尝试，重试使用新的稳定供应商幂等键', async (context) => {
  const providerKeys = []
  const deterministicAdapter = {
    name: 'deterministic-throw-adapter',
    async send({ deliveryId, attemptNumber, providerIdempotencyKey }) {
      providerKeys.push(providerIdempotencyKey)
      if (attemptNumber === 1) throw new DeliveryAdapterError('提交前明确失败', { outcome: 'failed', phase: 'before_submit', failureCode: 'LOCAL_CONFIRMED_NOT_SENT', providerReference: providerIdempotencyKey })
      return { ok: true, providerReference: `sent:${deliveryId}:${attemptNumber}`, providerMessageId: `provider-message:${attemptNumber}` }
    }
  }
  const fixture = createFixture({ permissions: reportPermissions, adapter: deterministicAdapter })
  context.after(() => fixture.close())
  const report = await fixture.reports.generateReport({ studentId: 'student-1', snapshotKey: 'deterministic-adapter-throw', content: { minutes: 18 } })
  const reviewed = await fixture.reports.reviewReport({ reportId: report.id })
  const contact = fixture.delivery.createContact({ studentId: 'student-1', displayName: '脱敏家长', destination: 'deterministic-throw-destination', channel: 'sms' })
  const queued = await fixture.delivery.queueDelivery({ reportVersionId: reviewed.current_version_id, parentContactId: contact.id })
  const retryable = await fixture.delivery.processDelivery({ deliveryId: queued.id })
  assert.equal(retryable.status, 'retry_scheduled')
  assert.equal(retryable.attempt_count, 1)
  assert.deepEqual({ ...fixture.db.prepare('SELECT outcome, adapter_phase, reconciliation_status FROM delivery_attempts WHERE delivery_id = ? AND attempt_number = 1').get(queued.id) }, { outcome: 'failed', adapter_phase: 'before_submit', reconciliation_status: 'none' })
  const sent = await fixture.delivery.processDelivery({ deliveryId: queued.id })
  assert.equal(sent.status, 'sent')
  assert.deepEqual(providerKeys, [`${queued.id}:1`, `${queued.id}:2`])
})

test('适配器提交后异常进入未知对账，确认未发送后才允许下一幂等尝试', async (context) => {
  const providerKeys = []
  const unknownAdapter = {
    name: 'unknown-throw-adapter',
    async send({ deliveryId, attemptNumber, providerIdempotencyKey }) {
      providerKeys.push(providerIdempotencyKey)
      if (attemptNumber === 1) throw new DeliveryAdapterError('供应商提交后连接中断', { outcome: 'unknown', phase: 'after_submit', failureCode: 'PROVIDER_RESPONSE_LOST', providerReference: providerIdempotencyKey, providerMessageId: 'provider-message-unknown-1' })
      return { ok: true, providerReference: `sent:${deliveryId}:${attemptNumber}`, providerMessageId: `provider-message:${attemptNumber}` }
    }
  }
  const fixture = createFixture({ permissions: reportPermissions, adapter: unknownAdapter })
  context.after(() => fixture.close())
  const report = await fixture.reports.generateReport({ studentId: 'student-1', snapshotKey: 'unknown-adapter-throw', content: { minutes: 22 } })
  const reviewed = await fixture.reports.reviewReport({ reportId: report.id })
  const contact = fixture.delivery.createContact({ studentId: 'student-1', displayName: '脱敏家长', destination: 'unknown-throw-destination', channel: 'sms' })
  const queued = await fixture.delivery.queueDelivery({ reportVersionId: reviewed.current_version_id, parentContactId: contact.id })
  await expectDomainError(() => fixture.delivery.processDelivery({ deliveryId: queued.id }), 'DEPENDENCY_UNAVAILABLE')
  const unknown = fixture.delivery.getDelivery(queued.id)
  assert.equal(unknown.status, 'unknown_reconciliation')
  assert.equal(unknown.reconciliation_status, 'unknown')
  assert.equal(unknown.attempt_count, 1)
  assert.equal(unknown.provider_idempotency_key, `${queued.id}:1`)
  assert.equal(unknown.provider_message_id, 'provider-message-unknown-1')
  assert.equal(unknown.claim_token, null)
  assert.ok(Date.parse(unknown.claim_expires_at) > Date.parse(unknown.claim_started_at))
  assert.deepEqual({ ...fixture.db.prepare('SELECT outcome, adapter_phase, reconciliation_status, provider_message_id FROM delivery_attempts WHERE delivery_id = ? AND attempt_number = 1').get(queued.id) }, { outcome: 'unknown', adapter_phase: 'after_submit', reconciliation_status: 'pending', provider_message_id: 'provider-message-unknown-1' })
  await expectDomainError(() => fixture.delivery.processDelivery({ deliveryId: queued.id }), 'VERSION_CONFLICT')
  assert.deepEqual(providerKeys, [`${queued.id}:1`])
  const released = await fixture.delivery.reconcileDelivery({ deliveryId: queued.id, outcome: 'failed', providerReference: 'provider-confirmed-not-sent', providerMessageId: 'provider-message-unknown-1', failureCode: 'PROVIDER_CONFIRMED_NOT_SENT' })
  assert.equal(released.status, 'retry_scheduled')
  assert.equal(released.reconciliation_status, 'confirmed_failed')
  assert.deepEqual({ ...fixture.db.prepare('SELECT outcome, adapter_phase, reconciliation_status FROM delivery_attempts WHERE delivery_id = ? AND attempt_number = 1').get(queued.id) }, { outcome: 'failed', adapter_phase: 'reconciled', reconciliation_status: 'confirmed_failed' })
  const sent = await fixture.delivery.processDelivery({ deliveryId: queued.id })
  assert.equal(sent.status, 'sent')
  assert.deepEqual(providerKeys, [`${queued.id}:1`, `${queued.id}:2`])
})
