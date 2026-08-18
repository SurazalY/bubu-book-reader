import assert from 'node:assert/strict'
import test from 'node:test'

import { isBookVisibleToAudience } from '../../../../server/domains/reading/visibility.js'
import {
  createHarness,
  grantCurrentBookToClass,
  studentAudience,
} from './shared-harness.guard.test.js'

test('默认全闭：无 grants 时 isBookVisibleToAudience 必须为 false（删除「无任何 grants 即 true」）', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '无授权书' })
  assert.equal(countGrants(harness, book.bookId), 0, '本用例不得预置 grant')
  assert.equal(
    isBookVisibleToAudience(harness.db, {
      bookId: book.bookId,
      organizationId: harness.ids.organizationId,
      audience: studentAudience([harness.ids.classAId]),
    }),
    false,
    '无 grants 必须不可见；当前默认全开会让这里变 true',
  )
  const listed = await harness.studentDomain().listBooks({ status: 'published' })
  assert.equal(
    listed.some((item) => item.id === book.bookId),
    false,
    '学生 listBooks 也必须遵循默认全闭，不得因旧谓词把无 grant 书列出来',
  )
})

test('默认全闭：仅他班 class grant 时本班学生不可见', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '只给 B 班的书' })
  grantCurrentBookToClass(harness.db, {
    bookId: book.bookId,
    classId: harness.ids.classBId,
    organizationId: harness.ids.organizationId,
    actorId: harness.ids.teacherB,
  })
  assert.equal(
    isBookVisibleToAudience(harness.db, {
      bookId: book.bookId,
      organizationId: harness.ids.organizationId,
      audience: studentAudience([harness.ids.classAId]),
    }),
    false,
    '只授权他班时本班必须不可见',
  )
})

test('默认全闭：本班 class grant + published 时学生可见', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '已投放 A 班的书', status: 'published' })
  grantCurrentBookToClass(harness.db, {
    bookId: book.bookId,
    classId: harness.ids.classAId,
    organizationId: harness.ids.organizationId,
    actorId: harness.ids.teacherA,
  })
  assert.equal(
    isBookVisibleToAudience(harness.db, {
      bookId: book.bookId,
      organizationId: harness.ids.organizationId,
      audience: studentAudience([harness.ids.classAId]),
    }),
    true,
    '本班 class grant 且 published 必须可见',
  )
})

test('默认全闭：audience.classIds 为空必须不可见', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '空班级集合书' })
  grantCurrentBookToClass(harness.db, {
    bookId: book.bookId,
    classId: harness.ids.classAId,
    organizationId: harness.ids.organizationId,
    actorId: harness.ids.teacherA,
  })
  assert.equal(
    isBookVisibleToAudience(harness.db, {
      bookId: book.bookId,
      organizationId: harness.ids.organizationId,
      audience: studentAudience([]),
    }),
    false,
    'classIds 为空不得可见，包括无班级学生',
  )
})

test('默认全闭：未知 grantee_type 不得当可见，也不得靠兼容兜底变 true', async (t) => {
  const harness = createHarness(t)
  const book = await harness.createBook({ title: '未知类型授权书' })
  grantCurrentBookToClass(harness.db, {
    bookId: book.bookId,
    classId: harness.ids.classAId,
    organizationId: harness.ids.organizationId,
    actorId: harness.ids.teacherA,
    granteeType: 'subject',
  })
  assert.equal(countGrants(harness, book.bookId), 1, '只插了一条未知类型 grant')
  assert.equal(
    isBookVisibleToAudience(harness.db, {
      bookId: book.bookId,
      organizationId: harness.ids.organizationId,
      audience: studentAudience([harness.ids.classAId]),
    }),
    false,
    '未知 grantee_type 不得视为 class grant，也不得因「无 class grant 即全开」兼容兜底变 true',
  )
})

function countGrants(harness, bookId) {
  return Number(harness.db.prepare(`
    SELECT COUNT(*) AS count
    FROM book_access_grants AS grant_row
    JOIN book_versions AS version ON version.id = grant_row.book_version_id
    WHERE version.book_id = ?
  `).get(bookId).count)
}
