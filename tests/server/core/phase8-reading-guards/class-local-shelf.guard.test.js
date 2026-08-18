import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { resolveCurrentBookVersionId } from '../../../../server/domains/reading/visibility.js'
import {
  CATALOG_SOURCE_PATH,
  CLASS_LOCAL_GRANT_METHOD,
  CLASS_LOCAL_REVOKE_METHOD,
  countBookGrants,
  createHarness,
  grantCurrentBookToClass,
  requireClassLocalShelfApi,
} from './shared-harness.guard.test.js'

test('删除全量 visibility 写模型：setBookVisibility(scope,classIds) 必须不再可用', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '禁止全量替换的书' })
  grantCurrentBookToClass(harness.db, {
    bookId: book.bookId,
    classId: harness.ids.classBId,
    organizationId: harness.ids.organizationId,
    actorId: harness.ids.teacherB,
  })
  const reading = harness.platformDomain()
  if (typeof reading.setBookVisibility === 'function') {
    let succeeded = false
    try {
      await reading.setBookVisibility({ bookId: book.bookId, scope: 'organization' })
      succeeded = true
    } catch {
      succeeded = false
    }
    assert.equal(
      succeeded,
      false,
      'setBookVisibility 必须删除或调用即失败；平台账号走 scope=organization 在旧模型会成功清空 grants',
    )
  }
  assert.equal(
    countBookGrants(harness.db, {
      bookId: book.bookId,
      organizationId: harness.ids.organizationId,
      classId: harness.ids.classBId,
      granteeType: 'class',
    }),
    1,
    '旧全量写模型失败后，他班 grant 必须仍在',
  )
})

test('class-local grant：只增本 class + 当前版本一行，200 幂等，不替换其他班', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '本班上架书' })
  const olderGrantVersionId = grantCurrentBookToClass(harness.db, {
    bookId: book.bookId,
    classId: harness.ids.classBId,
    organizationId: harness.ids.organizationId,
    actorId: harness.ids.teacherB,
  })
  const later = harness.insertLaterVersion({ bookId: book.bookId })
  const currentVersionId = resolveCurrentBookVersionId(harness.db, {
    bookId: book.bookId,
    organizationId: harness.ids.organizationId,
  })
  assert.equal(currentVersionId, later.versionId, '当前版本必须是 created_at DESC, id DESC')

  const reading = harness.teacherDomain()
  requireClassLocalShelfApi(reading)
  await reading[CLASS_LOCAL_GRANT_METHOD]({ bookId: book.bookId, classId: harness.ids.classAId })
  await reading[CLASS_LOCAL_GRANT_METHOD]({ bookId: book.bookId, classId: harness.ids.classAId })

  const classARows = harness.db.prepare(`
    SELECT grant_row.book_version_id AS bookVersionId, grant_row.grantee_id AS classId
    FROM book_access_grants AS grant_row
    JOIN book_versions AS version ON version.id = grant_row.book_version_id
    WHERE version.book_id = ?
      AND grant_row.grantee_type = 'class'
      AND grant_row.grantee_id = ?
  `).all(book.bookId, harness.ids.classAId)
  assert.equal(classARows.length, 1, '同班同书最终只能有一行 class grant')
  assert.equal(classARows[0].bookVersionId, currentVersionId, 'grant 必须写在当前版本')
  assert.equal(
    countBookGrants(harness.db, {
      bookId: book.bookId,
      organizationId: harness.ids.organizationId,
      classId: harness.ids.classBId,
      granteeType: 'class',
    }),
    1,
    '本班上架不得替换或删除他班 grant',
  )
  assert.equal(
    harness.db.prepare(`
      SELECT COUNT(*) AS count FROM book_access_grants WHERE book_version_id = ? AND grantee_id = ?
    `).get(olderGrantVersionId, harness.ids.classBId).count,
    1,
  )
})

test('class-local revoke：只删本 class grant，不动其他班、不动未知 grantee_type', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '本班撤下书' })
  grantCurrentBookToClass(harness.db, {
    bookId: book.bookId,
    classId: harness.ids.classAId,
    organizationId: harness.ids.organizationId,
    actorId: harness.ids.teacherA,
  })
  grantCurrentBookToClass(harness.db, {
    bookId: book.bookId,
    classId: harness.ids.classBId,
    organizationId: harness.ids.organizationId,
    actorId: harness.ids.teacherB,
  })
  grantCurrentBookToClass(harness.db, {
    bookId: book.bookId,
    classId: harness.ids.classAId,
    organizationId: harness.ids.organizationId,
    actorId: harness.ids.teacherA,
    granteeType: 'subject',
  })
  const reading = harness.teacherDomain()
  requireClassLocalShelfApi(reading)
  await reading[CLASS_LOCAL_REVOKE_METHOD]({ bookId: book.bookId, classId: harness.ids.classAId })
  await reading[CLASS_LOCAL_REVOKE_METHOD]({ bookId: book.bookId, classId: harness.ids.classAId })

  assert.equal(countBookGrants(harness.db, {
    bookId: book.bookId,
    organizationId: harness.ids.organizationId,
    classId: harness.ids.classAId,
    granteeType: 'class',
  }), 0, '本班 class grant 必须被删')
  assert.equal(countBookGrants(harness.db, {
    bookId: book.bookId,
    organizationId: harness.ids.organizationId,
    classId: harness.ids.classBId,
    granteeType: 'class',
  }), 1, '他班 grant 必须保留')
  assert.equal(countBookGrants(harness.db, {
    bookId: book.bookId,
    organizationId: harness.ids.organizationId,
    granteeType: 'subject',
  }), 1, '未知 grantee_type 不得被 revoke 清掉')
})

test('shelf 领域函数禁止再调用 book.publish / setBookVisibility', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '书架不得走 publish' })
  const actions = []
  const reading = harness.teacherDomain('A', { actions })
  requireClassLocalShelfApi(reading)
  await reading[CLASS_LOCAL_GRANT_METHOD]({ bookId: book.bookId, classId: harness.ids.classAId })
  await reading[CLASS_LOCAL_REVOKE_METHOD]({ bookId: book.bookId, classId: harness.ids.classAId })
  assert.ok(!actions.includes('book.publish'), `shelf 不得 authorize('book.publish')，实际: ${actions.join(',')}`)

  const source = readFileSync(CATALOG_SOURCE_PATH, 'utf8')
  for (const methodName of [CLASS_LOCAL_GRANT_METHOD, CLASS_LOCAL_REVOKE_METHOD]) {
    const body = extractAsyncMethodBody(source, methodName)
    assert.ok(body, `catalog.js 必须实现 ${methodName}`)
    assert.ok(!body.includes("authorize('book.publish'"), `${methodName} 不得调用 book.publish`)
    assert.ok(!body.includes('setBookVisibility'), `${methodName} 不得调用 setBookVisibility`)
    assert.ok(!body.includes('publishBook'), `${methodName} 不得调用 publishBook`)
  }
})

test('两个并发 PUT 同班同书最终一行', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '并发上架书' })
  const first = harness.teacherDomain('A', { idFactory: () => `put-a-${randomUUIDSlice()}` })
  const second = harness.teacherDomain('A', { idFactory: () => `put-b-${randomUUIDSlice()}` })
  requireClassLocalShelfApi(first)
  requireClassLocalShelfApi(second)
  const results = await Promise.allSettled([
    first[CLASS_LOCAL_GRANT_METHOD]({ bookId: book.bookId, classId: harness.ids.classAId }),
    second[CLASS_LOCAL_GRANT_METHOD]({ bookId: book.bookId, classId: harness.ids.classAId }),
  ])
  assert.ok(results.some((result) => result.status === 'fulfilled'), '至少一个并发 PUT 必须成功')
  assert.equal(
    countBookGrants(harness.db, {
      bookId: book.bookId,
      organizationId: harness.ids.organizationId,
      classId: harness.ids.classAId,
      granteeType: 'class',
    }),
    1,
    '并发 PUT 最终必须只有一行 class grant',
  )
})

test('一个班撤下不影响他班', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '跨班隔离撤下' })
  const teacherA = harness.teacherDomain('A')
  const teacherB = harness.teacherDomain('B')
  requireClassLocalShelfApi(teacherA)
  requireClassLocalShelfApi(teacherB)
  await teacherA[CLASS_LOCAL_GRANT_METHOD]({ bookId: book.bookId, classId: harness.ids.classAId })
  await teacherB[CLASS_LOCAL_GRANT_METHOD]({ bookId: book.bookId, classId: harness.ids.classBId })
  await teacherA[CLASS_LOCAL_REVOKE_METHOD]({ bookId: book.bookId, classId: harness.ids.classAId })
  assert.equal(countBookGrants(harness.db, {
    bookId: book.bookId,
    organizationId: harness.ids.organizationId,
    classId: harness.ids.classAId,
    granteeType: 'class',
  }), 0)
  assert.equal(countBookGrants(harness.db, {
    bookId: book.bookId,
    organizationId: harness.ids.organizationId,
    classId: harness.ids.classBId,
    granteeType: 'class',
  }), 1, 'A 班撤下不得带走 B 班 grant')
})

function extractAsyncMethodBody(source, methodName) {
  const marker = `async ${methodName}(`
  const start = source.indexOf(marker)
  if (start < 0) return null
  const brace = source.indexOf('{', start)
  if (brace < 0) return null
  let depth = 0
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(brace, index + 1)
    }
  }
  return null
}

function randomUUIDSlice() {
  return Math.random().toString(16).slice(2, 10)
}
