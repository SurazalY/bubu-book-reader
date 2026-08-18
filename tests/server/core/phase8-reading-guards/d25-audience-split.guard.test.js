import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isBookVisibleToAudience,
  resolveBookAudience,
} from '../../../../server/domains/reading/visibility.js'
import {
  assertAudienceShape,
  createHarness,
  grantCurrentBookToClass,
  platformAudience,
  teacherAudience,
} from './shared-harness.guard.test.js'

test('D-25：resolveBookAudience 不再返回 unrestricted，改为 bypassClassGrants/allowUnpublished/classIds', (t) => {
  const harness = createHarness(t)
  const audience = resolveBookAudience(harness.db, {
    organizationId: harness.ids.organizationId,
    userId: harness.ids.studentA,
    workspaceId: harness.ids.wsClassA,
  })
  assertAudienceShape(audience)
})

test('D-25：platform 的 audience 为 bypassClassGrants=true 且 allowUnpublished=true', (t) => {
  const harness = createHarness(t)
  const audience = resolveBookAudience(harness.db, {
    organizationId: harness.ids.organizationId,
    userId: harness.ids.platformOps,
    workspaceId: harness.ids.wsPlatform,
  })
  assertAudienceShape(audience)
  assert.equal(audience.bypassClassGrants, true)
  assert.equal(audience.allowUnpublished, true)
})

test('D-25：teacher 的 audience 为 bypassClassGrants=true 且 allowUnpublished=false', (t) => {
  const harness = createHarness(t)
  const audience = resolveBookAudience(harness.db, {
    organizationId: harness.ids.organizationId,
    userId: harness.ids.teacherA,
    workspaceId: harness.ids.wsClassA,
  })
  assertAudienceShape(audience)
  assert.equal(audience.bypassClassGrants, true)
  assert.equal(audience.allowUnpublished, false)
})

test('D-25：student 的 audience 为 bypassClassGrants=false 且 allowUnpublished=false', (t) => {
  const harness = createHarness(t)
  const audience = resolveBookAudience(harness.db, {
    organizationId: harness.ids.organizationId,
    userId: harness.ids.studentA,
    workspaceId: harness.ids.wsClassA,
  })
  assertAudienceShape(audience)
  assert.equal(audience.bypassClassGrants, false)
  assert.equal(audience.allowUnpublished, false)
  assert.deepEqual(audience.classIds, [harness.ids.classAId])
})

test('D-25：校长不得因 BOOK_LIBRARY_MANAGEMENT_ROLES 进入书库 audience', (t) => {
  const harness = createHarness(t)
  const audience = resolveBookAudience(harness.db, {
    organizationId: harness.ids.organizationId,
    userId: harness.ids.schoolAdmin,
    workspaceId: harness.ids.wsSchool,
  })
  assertAudienceShape(audience)
  assert.equal(audience.bypassClassGrants, false, '校长无书库旁路')
  assert.equal(audience.allowUnpublished, false, '校长不得看 draft')
})

test('D-25：年级主任不得因 BOOK_LIBRARY_MANAGEMENT_ROLES 进入书库 audience', (t) => {
  const harness = createHarness(t)
  const audience = resolveBookAudience(harness.db, {
    organizationId: harness.ids.organizationId,
    userId: harness.ids.gradeManager,
    workspaceId: harness.ids.wsGrade,
  })
  assertAudienceShape(audience)
  assert.equal(audience.bypassClassGrants, false, '年级主任无书库旁路')
  assert.equal(audience.allowUnpublished, false, '年级主任不得看 draft')
})

test('D-25：bypassClassGrants=true 只绕过 class grant，不可以把 draft 当成可见书', async (t) => {
  const harness = createHarness(t)
  const draft = await harness.createBook({ title: '教师不可列的草稿', status: 'draft' })
  grantCurrentBookToClass(harness.db, {
    bookId: draft.bookId,
    classId: harness.ids.classAId,
    organizationId: harness.ids.organizationId,
    actorId: harness.ids.teacherA,
  })
  assert.equal(
    isBookVisibleToAudience(harness.db, {
      bookId: draft.bookId,
      organizationId: harness.ids.organizationId,
      audience: teacherAudience([harness.ids.classAId]),
    }),
    true,
    '谓词只回答 grant 旁路；draft 门由入口用 allowUnpublished 另判',
  )
  const listed = await harness.teacherDomain().listBooks({ status: 'draft' })
  assert.equal(
    listed.some((book) => book.id === draft.bookId),
    false,
    '教师书库不得列出 draft：bypassClassGrants 不可以当成 allowUnpublished',
  )
})

test('D-25：教师书库只列 published；draft/archived 只对 platform', async (t) => {
  const harness = createHarness(t)
  const published = await harness.createBook({ title: '已发布无投放', status: 'published' })
  const draft = await harness.createBook({ title: '仅平台草稿', status: 'draft' })
  const archived = await harness.createBook({ title: '仅平台归档', status: 'archived' })

  const teacherPublished = await harness.teacherDomain().listBooks({ status: 'published' })
  assert.equal(
    teacherPublished.some((book) => book.id === published.bookId),
    true,
    '教师可列 published（绕过 class grant）',
  )
  const teacherDraft = await harness.teacherDomain().listBooks({ status: 'draft' })
  assert.equal(teacherDraft.some((book) => book.id === draft.bookId), false, '教师不得列 draft')
  const teacherArchived = await harness.teacherDomain().listBooks({ status: 'archived' })
  assert.equal(teacherArchived.some((book) => book.id === archived.bookId), false, '教师不得列 archived')

  const platformDraft = await harness.platformDomain().listBooks({ status: 'draft' })
  assert.equal(platformDraft.some((book) => book.id === draft.bookId), true, 'platform 可列 draft')
  const platformArchived = await harness.platformDomain().listBooks({ status: 'archived' })
  assert.equal(platformArchived.some((book) => book.id === archived.bookId), true, 'platform 可列 archived')
})

test('D-25：教师取 draft 资产必须 404，不得靠旧 unrestricted 放行', async (t) => {
  const harness = createHarness(t)
  const draft = await harness.createBook({ title: '教师不可取的草稿资产', status: 'draft' })
  const assetId = harness.insertSourceTextAsset({ versionId: draft.versionId })
  await assert.rejects(
    () => harness.teacherDomain().getBookAsset(assetId),
    (error) => {
      assert.equal(error.code, 'RESOURCE_NOT_FOUND')
      assert.match(error.message, /不存在或当前不可读取/)
      return true
    },
  )
})

test('D-25：新发布图书不自动投放（publish 不得自动写 grant）', async (t) => {
  const harness = createHarness(t)
  const draft = await harness.createBook({ title: '刚发布未投放', status: 'draft' })
  await harness.platformDomain().publishBook(draft.bookId)
  const grants = Number(harness.db.prepare(`
    SELECT COUNT(*) AS count
    FROM book_access_grants AS grant_row
    JOIN book_versions AS version ON version.id = grant_row.book_version_id
    WHERE version.book_id = ?
  `).get(draft.bookId).count)
  assert.equal(grants, 0, '新发布不得自动插入 book_access_grants')
  assert.equal(
    isBookVisibleToAudience(harness.db, {
      bookId: draft.bookId,
      organizationId: harness.ids.organizationId,
      audience: { bypassClassGrants: false, allowUnpublished: false, classIds: [harness.ids.classAId] },
    }),
    false,
    '无自动 grant 时学生对新发布书不可见',
  )
})

test('D-25：bypassClassGrants=true 在仅有他班 grant 时仍可见，且这只是 grant 旁路', async (t) => {
  const harness = createHarness(t)
  const published = await harness.createBook({ title: '平台旁路书', status: 'published' })
  grantCurrentBookToClass(harness.db, {
    bookId: published.bookId,
    classId: harness.ids.classBId,
    organizationId: harness.ids.organizationId,
    actorId: harness.ids.teacherB,
  })
  assert.equal(
    isBookVisibleToAudience(harness.db, {
      bookId: published.bookId,
      organizationId: harness.ids.organizationId,
      audience: platformAudience(),
    }),
    true,
    'bypassClassGrants=true 必须绕过 class grant；旧 unrestricted 缺席时这里会变成 false',
  )
})
