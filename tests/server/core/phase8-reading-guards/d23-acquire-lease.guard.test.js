import assert from 'node:assert/strict'
import test from 'node:test'

import { READING_LEASE_TTL_MS } from '../../../../server/domains/reading/monitoring.js'
import {
  assertLeaseUnavailable,
  countTable,
  createHarness,
  grantCurrentBookToClass,
  LEASE_UNAVAILABLE_MESSAGE,
} from './shared-harness.guard.test.js'

function snapshotLeaseWrites(harness) {
  return {
    leases: countTable(harness.db, 'active_reading_leases'),
    history: countTable(harness.db, 'reading_device_lease_history'),
    audits: harness.auditCalls.length,
  }
}

function assertNoLeaseSideEffects(harness, before, writes) {
  assert.equal(countTable(harness.db, 'active_reading_leases'), before.leases, 'active lease 不得新增')
  assert.equal(countTable(harness.db, 'reading_device_lease_history'), before.history, 'lease history 不得新增')
  assert.equal(harness.auditCalls.length, before.audits, 'audit 不得新增')
  assert.equal(
    writes.filter((item) => item.kind === 'run').length,
    0,
    '失败路径不得对 lease/history/audit 发出写 SQL',
  )
}

test('D-23 acquireLease：published + 本班 grant → 成功并产生 lease', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '可租的书', status: 'published' })
  grantCurrentBookToClass(harness.db, {
    bookId: book.bookId,
    classId: harness.ids.classAId,
    organizationId: harness.ids.organizationId,
    actorId: harness.ids.teacherA,
  })
  const before = snapshotLeaseWrites(harness)
  const result = await harness.studentDomain().acquireLease({
    deviceId: 'device-granted',
    bookVersionId: book.versionId,
  })
  assert.ok(result.leaseId, '必须返回 leaseId')
  assert.equal(countTable(harness.db, 'active_reading_leases'), before.leases + 1)
  const row = harness.db.prepare('SELECT book_version_id, actor_id FROM active_reading_leases WHERE id = ?').get(result.leaseId)
  assert.equal(row.book_version_id, book.versionId)
  assert.equal(row.actor_id, harness.ids.studentA)
})

test('D-23 acquireLease：published + 无 grant → 404「书籍不存在或当前不可读取」，且不得写 lease', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '无授权不可租', status: 'published' })
  const writes = harness.installLeaseWriteProbe()
  const before = snapshotLeaseWrites(harness)
  const writeCountBefore = writes.length
  await assert.rejects(
    () => harness.studentDomain().acquireLease({
      deviceId: 'device-no-grant',
      bookVersionId: book.versionId,
    }),
    assertLeaseUnavailable,
  )
  assertNoLeaseSideEffects(harness, before, writes.slice(writeCountBefore))
})

test('D-23 acquireLease：draft + 本班 grant → 404，失败只归因发布状态', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '草稿不可租', status: 'draft' })
  grantCurrentBookToClass(harness.db, {
    bookId: book.bookId,
    classId: harness.ids.classAId,
    organizationId: harness.ids.organizationId,
    actorId: harness.ids.teacherA,
  })
  const writes = harness.installLeaseWriteProbe()
  const before = snapshotLeaseWrites(harness)
  const writeCountBefore = writes.length
  await assert.rejects(
    () => harness.studentDomain().acquireLease({
      deviceId: 'device-draft',
      bookVersionId: book.versionId,
    }),
    assertLeaseUnavailable,
  )
  assertNoLeaseSideEffects(harness, before, writes.slice(writeCountBefore))
})

test('D-23 acquireLease：外组织版本 → 同码同文案 404，不泄露存在性', async (t) => {
  const harness = createHarness(t)
  const homeBook = await harness.createBook({ title: '本校书', status: 'published' })
  grantCurrentBookToClass(harness.db, {
    bookId: homeBook.bookId,
    classId: harness.ids.classAId,
    organizationId: harness.ids.organizationId,
    actorId: harness.ids.teacherA,
  })
  const foreignBook = await harness.createBook({
    title: '外校书',
    status: 'published',
    organizationId: harness.ids.foreignOrganizationId,
  })
  const writes = harness.installLeaseWriteProbe()
  const before = snapshotLeaseWrites(harness)
  const writeCountBefore = writes.length
  await assert.rejects(
    () => harness.studentDomain().acquireLease({
      deviceId: 'device-foreign',
      bookVersionId: foreignBook.versionId,
    }),
    (error) => {
      assertLeaseUnavailable(error)
      assert.equal(error.message, LEASE_UNAVAILABLE_MESSAGE, '外组织与不存在必须同文案')
      return true
    },
  )
  assertNoLeaseSideEffects(harness, before, writes.slice(writeCountBefore))
})

test('D-23：已取得租约后撤下，现有 lease 可按 90 秒规则续到自然结束，结束后新 acquire 404', async (t) => {
  const harness = createHarness(t)
  assert.equal(READING_LEASE_TTL_MS, 90 * 1000)
  const book = await harness.createBook({ title: '撤下后仍可续的书', status: 'published' })
  grantCurrentBookToClass(harness.db, {
    bookId: book.bookId,
    classId: harness.ids.classAId,
    organizationId: harness.ids.organizationId,
    actorId: harness.ids.teacherA,
  })
  const acquired = await harness.studentDomain().acquireLease({
    deviceId: 'device-keep',
    bookVersionId: book.versionId,
  })
  const leaseBeforeRevoke = harness.db.prepare(
    'SELECT id, released_at, expires_at FROM active_reading_leases WHERE id = ?',
  ).get(acquired.leaseId)
  assert.equal(leaseBeforeRevoke.released_at, null)

  harness.db.prepare(`
    DELETE FROM book_access_grants
    WHERE grantee_type = 'class' AND grantee_id = ? AND book_version_id = ?
  `).run(harness.ids.classAId, book.versionId)

  const stillOpen = harness.db.prepare(
    'SELECT released_at FROM active_reading_leases WHERE id = ?',
  ).get(acquired.leaseId)
  assert.equal(stillOpen.released_at, null, '撤下不得强制踢出已有 lease')

  harness.advanceMs(30_000)
  const renewed = await harness.monitoring(
    harness.ids.studentA,
    harness.ids.wsClassA,
    harness.ids.organizationId,
  ).renewLease({
    leaseId: acquired.leaseId,
    deviceId: 'device-keep',
    body: { schemaVersion: 1, bookVersionId: book.versionId },
  })
  assert.equal(renewed.leaseId, acquired.leaseId)

  await assert.rejects(
    () => harness.studentDomain('B').acquireLease({
      deviceId: 'device-other-student',
      bookVersionId: book.versionId,
    }),
    assertLeaseUnavailable,
  )

  harness.setNow(new Date(Date.parse(renewed.expiresAt) + 1000).toISOString())
  await assert.rejects(
    () => harness.studentDomain().acquireLease({
      deviceId: 'device-keep',
      bookVersionId: book.versionId,
    }),
    assertLeaseUnavailable,
  )
})

test('D-23：可见性前置必须在任何 lease 写事务之前', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '前置必须先于事务', status: 'published' })
  const writes = harness.installLeaseWriteProbe()
  const before = writes.length
  await assert.rejects(
    () => harness.studentDomain().acquireLease({
      deviceId: 'device-before-tx',
      bookVersionId: book.versionId,
    }),
    assertLeaseUnavailable,
  )
  const after = writes.slice(before)
  assert.equal(
    after.filter((item) => item.kind === 'begin').length,
    0,
    '不可见时不得进入 BEGIN IMMEDIATE 的 lease 写事务',
  )
  assert.equal(after.filter((item) => item.kind === 'run').length, 0)
})

test('D-23：takeOverLease 委托 acquire，自动受同一可见性约束', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '接管也要验可见性', status: 'published' })
  const writes = harness.installLeaseWriteProbe()
  const before = snapshotLeaseWrites(harness)
  const writeCountBefore = writes.length
  await assert.rejects(
    () => harness.studentDomain().takeOverLease({
      deviceId: 'device-takeover',
      bookVersionId: book.versionId,
    }),
    assertLeaseUnavailable,
  )
  assertNoLeaseSideEffects(harness, before, writes.slice(writeCountBefore))
})
