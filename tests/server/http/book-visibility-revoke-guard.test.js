// F-1 删除侧校验 + F-4 逃生通道的收口测试。
//
// 纪律与既有可见范围测试一致：
// 1. 全部走真实 HTTP —— app.listen(0) + 真实登录 Cookie + 真实 X-Workspace-Id。
//    绝不注入假的 authorize（server/domains/reading/sql.js 的默认值返回 true，
//    直接调领域函数等于什么都没测）。authorize: () => true 只出现在造书夹具里。
// 2. 断言不只看状态码，凡是「不得被破坏」的都直查 book_access_grants 行。
// 3. 测试库一律建在 mkdtempSync(tmpdir()) 下，不碰业务库。
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { hashPassword } from '../../../server/auth/password.js'
import { createReadmateApplication } from '../../../server/app.js'
import { createReadingDomain } from '../../../server/domains/reading/catalog.js'

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function revokeFixture() {
  const suffix = randomUUID().slice(0, 8)
  const id = (name) => `${name}-${suffix}`

  const organizationId = id('org')
  const gradeOneId = id('grade-one')
  const gradeTwoId = id('grade-two')
  const classAId = id('class-a')
  const classBId = id('class-b')
  const classCId = id('class-c')
  // 两个空班，专门用来造「悬空 grants」：一个运行期停用，一个直接删除。
  const classToDisableId = id('class-to-disable')
  const classToDeleteId = id('class-to-delete')
  const wsAId = id('ws-class-a')
  const wsBId = id('ws-class-b')
  const wsSchoolId = id('ws-school')
  const wsGradeTwoId = id('ws-grade-two')

  const password = randomBytes(24).toString('base64url')
  const passwordHash = hashPassword(password)
  const people = {
    studentA: { id: id('student-a'), displayName: 'A 班学生' },
    studentB: { id: id('student-b'), displayName: 'B 班学生' },
    teacherA: { id: id('teacher-a'), displayName: 'A 班班主任' },
    gradeAdminTwo: { id: id('grade-admin-two'), displayName: '二年级主任' },
    admin: { id: id('school-admin'), displayName: '校长' },
  }
  for (const [key, person] of Object.entries(people)) person.username = `${key}-${suffix}`

  return {
    password,
    people,
    organizationId,
    gradeOneId,
    gradeTwoId,
    classAId,
    classBId,
    classCId,
    classToDisableId,
    classToDeleteId,
    wsAId,
    wsBId,
    wsSchoolId,
    wsGradeTwoId,
    seed: {
      organizations: [{ id: organizationId, name: '删除侧校验测试学校' }],
      users: Object.values(people).map(({ id: userId, username, displayName }) => ({
        id: userId, organizationId, username, displayName,
      })),
      workspaces: [
        { id: wsAId, organizationId, code: 'class-teacher', name: 'A 班', scopeType: 'class', scopeId: classAId },
        { id: wsBId, organizationId, code: 'class-teacher', name: 'B 班', scopeType: 'class', scopeId: classBId },
        { id: wsSchoolId, organizationId, code: 'school-admin', name: '校务', scopeType: 'school', scopeId: organizationId },
        { id: wsGradeTwoId, organizationId, code: 'grade-group', name: '二年级组', scopeType: 'grade', scopeId: gradeTwoId },
      ],
      workspaceMemberships: [
        { id: randomUUID(), userId: people.studentA.id, workspaceId: wsAId },
        { id: randomUUID(), userId: people.studentB.id, workspaceId: wsBId },
        { id: randomUUID(), userId: people.teacherA.id, workspaceId: wsAId },
        { id: randomUUID(), userId: people.gradeAdminTwo.id, workspaceId: wsGradeTwoId },
        { id: randomUUID(), userId: people.admin.id, workspaceId: wsSchoolId },
      ],
      classes: [
        { id: classAId, organizationId, gradeId: gradeOneId, name: '一年级 A 班' },
        { id: classBId, organizationId, gradeId: gradeOneId, name: '一年级 B 班' },
        { id: classCId, organizationId, gradeId: gradeTwoId, name: '二年级 C 班' },
        { id: classToDisableId, organizationId, gradeId: gradeTwoId, name: '待停用空班' },
        { id: classToDeleteId, organizationId, gradeId: gradeTwoId, name: '待删除空班' },
      ],
      classMemberships: [
        { id: randomUUID(), classId: classAId, userId: people.studentA.id, membershipRole: 'student' },
        { id: randomUUID(), classId: classBId, userId: people.studentB.id, membershipRole: 'student' },
        { id: randomUUID(), classId: classAId, userId: people.teacherA.id, membershipRole: 'teacher' },
      ],
      roleAssignments: [
        { id: randomUUID(), organizationId, userId: people.studentA.id, workspaceId: wsAId, roleCode: 'student', scopeType: 'class', scopeId: classAId },
        { id: randomUUID(), organizationId, userId: people.studentB.id, workspaceId: wsBId, roleCode: 'student', scopeType: 'class', scopeId: classBId },
        { id: randomUUID(), organizationId, userId: people.teacherA.id, workspaceId: wsAId, roleCode: 'class_teacher', scopeType: 'class', scopeId: classAId },
        { id: randomUUID(), organizationId, userId: people.gradeAdminTwo.id, workspaceId: wsGradeTwoId, roleCode: 'grade_admin', scopeType: 'grade', scopeId: gradeTwoId },
        { id: randomUUID(), organizationId, userId: people.admin.id, workspaceId: wsSchoolId, roleCode: 'school_admin', scopeType: 'school', scopeId: organizationId },
      ],
      credentials: Object.values(people).map(({ id: userId }) => ({ id: randomUUID(), userId, passwordHash })),
    },
  }
}

// ---------------------------------------------------------------------------
// HTTP 客户端
// ---------------------------------------------------------------------------

function rememberCookies(jar, response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)
  for (const value of values) {
    const [pair] = value.split(';')
    const separator = pair.indexOf('=')
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1))
  }
}

async function request(baseUrl, jar, path, options = {}) {
  const headers = new Headers(options.headers)
  if (jar.size) headers.set('Cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '))
  if (options.workspaceId) headers.set('X-Workspace-Id', options.workspaceId)
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  rememberCookies(jar, response)
  const raw = await response.text()
  let payload = null
  try {
    payload = raw ? JSON.parse(raw) : null
  } catch {
    payload = { raw }
  }
  return { status: response.status, payload }
}

async function login(baseUrl, fixture, person) {
  const jar = new Map()
  const response = await request(baseUrl, jar, '/auth/login', {
    method: 'POST',
    idempotencyKey: `login-${person.id}-${randomUUID()}`,
    body: { username: person.username, password: fixture.password },
  })
  assert.equal(response.status, 200, JSON.stringify(response.payload))
  return jar
}

// ---------------------------------------------------------------------------
// 造书夹具（authorize: () => true 只用于搭台，不用于任何被断言的路径）
// ---------------------------------------------------------------------------

function pages(prefix) {
  return [1, 2].map((pageNo) => ({
    pageNo,
    width: 1024,
    height: 768,
    textContent: `${prefix} 第 ${pageNo} 页正文`,
    blocks: [{
      blockKey: `page-${pageNo}-paragraph-1`,
      paragraphId: `paragraph-${pageNo}`,
      textContent: `${prefix} 第 ${pageNo} 页正文`,
      charStart: 0,
      charEnd: 10,
      x: 80,
      y: 100,
      width: 760,
      height: 120,
    }],
  }))
}

async function createBook(application, fixture, asset, title) {
  const reading = createReadingDomain({
    db: application.database,
    actor: { id: fixture.people.admin.id },
    workspace: { id: fixture.wsSchoolId, organizationId: fixture.organizationId },
    authorize: async () => true,
    audit: async () => undefined,
    assetMetadataVerifier: async ({ storageKey }) => {
      if (storageKey !== asset.storageKey) throw new Error('未登记的测试资产键')
      return asset
    },
    idFactory: randomUUID,
    now: () => new Date(),
  })
  const created = await reading.createBookVersion({
    title,
    label: `revoke-${randomUUID()}`,
    sourceFormat: 'text',
    assets: [{ ...asset, assetType: 'source_text' }],
    pages: pages(title),
  })
  await reading.publishBook(created.bookId)
  const assetRow = application.database.prepare(
    "SELECT id FROM book_assets WHERE book_version_id = ? AND asset_type = 'source_text'",
  ).get(created.versionId)
  return { ...created, assetId: assetRow.id, title }
}

async function startHarness(t) {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-visibility-revoke-'))
  const databasePath = join(directory, 'revoke.sqlite')
  const publicAssetDirectory = join(directory, 'public')
  const asset = {
    storageKey: 'books/revoke/source.txt',
    usageLabel: 'INTERNAL PILOT ONLY',
    mimeType: 'text/plain',
    bytes: Buffer.from('删除侧授权范围校验测试用书籍源资产', 'utf8'),
  }
  asset.sizeBytes = asset.bytes.length
  asset.sha256 = createHash('sha256').update(asset.bytes).digest('hex')
  mkdirSync(join(publicAssetDirectory, 'books', 'revoke'), { recursive: true })
  writeFileSync(join(publicAssetDirectory, asset.storageKey), asset.bytes)

  const fixture = revokeFixture()
  const application = createReadmateApplication({
    databasePath,
    sessionSecret: randomBytes(48).toString('base64url'),
    cookieSecure: false,
    serveStatic: false,
    publicAssetDirectory,
  })
  application.identity.service.importSeed(fixture.seed)
  const server = await new Promise((resolve) => {
    const listener = application.app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    application.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`
  return {
    application,
    database: application.database,
    fixture,
    baseUrl,
    createBook: (title) => createBook(application, fixture, asset, title),
    login: (person) => login(baseUrl, fixture, person),
  }
}

// ---------------------------------------------------------------------------
// 共用探针
// ---------------------------------------------------------------------------

async function setVisibility(baseUrl, jar, workspaceId, bookId, body) {
  return request(baseUrl, jar, `/books/${bookId}/visibility`, {
    method: 'PUT',
    workspaceId,
    idempotencyKey: `revoke-visibility-${bookId}-${randomUUID()}`,
    body,
  })
}

function grantedClassIds(database, bookId) {
  return database.prepare(`
    SELECT grant_row.grantee_id AS granteeId FROM book_access_grants AS grant_row
    JOIN book_versions AS version ON version.id = grant_row.book_version_id
    WHERE version.book_id = ? AND grant_row.grantee_type = 'class'
    ORDER BY grant_row.grantee_id
  `).all(bookId).map((row) => row.granteeId)
}

function grantRows(database, bookId) {
  return database.prepare(`
    SELECT grant_row.grantee_type AS granteeType, grant_row.grantee_id AS granteeId
    FROM book_access_grants AS grant_row
    JOIN book_versions AS version ON version.id = grant_row.book_version_id
    WHERE version.book_id = ?
    ORDER BY grant_row.grantee_type, grant_row.grantee_id
  `).all(bookId)
}

async function probeStudent(baseUrl, jar, workspaceId, book) {
  const list = await request(baseUrl, jar, '/books', { workspaceId })
  const page = await request(baseUrl, jar, `/books/${book.bookId}/pages/1`, { workspaceId })
  const asset = await request(baseUrl, jar, `/books/assets/${book.assetId}`, { workspaceId })
  return {
    listed: (list.payload?.data?.items ?? []).some((item) => item.id === book.bookId),
    page,
    asset,
  }
}

function assertStudentSees(probe, label) {
  assert.equal(probe.listed, true, `${label}：可见书必须出现在 GET /books`)
  assert.equal(probe.page.status, 200, `${label}：书页应 200，实际 ${probe.page.status}`)
  assert.equal(probe.asset.status, 200, `${label}：资产应 200，实际 ${probe.asset.status}`)
}

function assertStudentBlocked(probe, label) {
  assert.equal(probe.listed, false, `${label}：不可见书不得出现在 GET /books`)
  assert.equal(probe.page.status, 404, `${label}：书页必须 404，实际 ${probe.page.status}`)
  assert.equal(probe.asset.status, 404, `${label}：资产必须 404，实际 ${probe.asset.status}`)
}

// ===========================================================================
// F-1：删除侧的授权范围校验
// ===========================================================================

test('F-1 需求 1/2/8：校长限定到 C 班后，A 班班主任的 organization 与 classes:[A 班] 都被 403，C 班 grants 行仍在', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const viaOrganization = await harness.createBook('校长限定给 C 班的书（organization 攻击）')
  const viaClasses = await harness.createBook('校长限定给 C 班的书（classes 覆盖攻击）')

  const adminJar = await harness.login(fixture.people.admin)
  for (const book of [viaOrganization, viaClasses]) {
    const restricted = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, {
      scope: 'classes',
      classIds: [fixture.classCId],
    })
    assert.equal(restricted.status, 200, JSON.stringify(restricted.payload))
    assert.deepEqual(grantedClassIds(database, book.bookId), [fixture.classCId])
  }

  const teacherAJar = await harness.login(fixture.people.teacherA)
  const studentAJar = await harness.login(fixture.people.studentA)
  const studentBJar = await harness.login(fixture.people.studentB)

  // 需求 1：放开到全组织 —— 等于把书授权给包含 B 班、C 班在内的所有班，必须 403。
  const widened = await setVisibility(baseUrl, teacherAJar, fixture.wsAId, viaOrganization.bookId, {
    scope: 'organization',
  })
  assert.equal(widened.status, 403, `organization 必须 403：${JSON.stringify(widened.payload)}`)
  assert.equal(widened.payload.error.code, 'PERMISSION_DENIED')
  // 需求 8：details.classIds 装的是「要移除、却不在操作者授权范围内」的班级。
  assert.deepEqual(widened.payload.error.details.classIds, [fixture.classCId])
  assert.deepEqual(
    grantedClassIds(database, viaOrganization.bookId),
    [fixture.classCId],
    '被拒的 organization 请求不得删掉校长设置的 grants 行',
  )
  assertStudentBlocked(
    await probeStudent(baseUrl, studentBJar, fixture.wsBId, viaOrganization),
    'organization 被拒后 B 班学生',
  )
  assertStudentBlocked(
    await probeStudent(baseUrl, studentAJar, fixture.wsAId, viaOrganization),
    'organization 被拒后 A 班学生',
  )

  // 需求 2：收窄到自己班 —— 等价于删掉 C 班的授权，必须 403。
  const hijacked = await setVisibility(baseUrl, teacherAJar, fixture.wsAId, viaClasses.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId],
  })
  assert.equal(hijacked.status, 403, `classes:[A 班] 必须 403：${JSON.stringify(hijacked.payload)}`)
  assert.equal(hijacked.payload.error.code, 'PERMISSION_DENIED')
  assert.deepEqual(hijacked.payload.error.details.classIds, [fixture.classCId])
  assert.deepEqual(
    grantedClassIds(database, viaClasses.bookId),
    [fixture.classCId],
    '被拒的 classes 请求不得覆盖校长设置的 grants 行',
  )
})

test('F-1 需求 3/4：书无 grants 时班主任可限定到本班，且他本人随后可以撤销回全组织可见', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const book = await harness.createBook('班主任自己限定再自己撤销的书')

  const teacherAJar = await harness.login(fixture.people.teacherA)
  const studentAJar = await harness.login(fixture.people.studentA)
  const studentBJar = await harness.login(fixture.people.studentB)

  // 需求 4：本功能的主用例不能被删除侧校验误伤 —— 无 grants 时没有任何班级被移除。
  const restricted = await setVisibility(baseUrl, teacherAJar, fixture.wsAId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId],
  })
  assert.equal(restricted.status, 200, `无 grants 时限定到本班必须 200：${JSON.stringify(restricted.payload)}`)
  assert.deepEqual(grantedClassIds(database, book.bookId), [fixture.classAId])
  assertStudentSees(await probeStudent(baseUrl, studentAJar, fixture.wsAId, book), '限定到 A 班后 A 班学生')
  assertStudentBlocked(await probeStudent(baseUrl, studentBJar, fixture.wsBId, book), '限定到 A 班后 B 班学生')

  // 需求 3：撤销自己的操作必须可行 —— 被移除的 A 班在他自己的授权范围内。
  const reopened = await setVisibility(baseUrl, teacherAJar, fixture.wsAId, book.bookId, { scope: 'organization' })
  assert.equal(reopened.status, 200, `撤销自己的限定必须 200：${JSON.stringify(reopened.payload)}`)
  assert.equal(reopened.payload.data.scope, 'organization')
  assert.deepEqual(grantRows(database, book.bookId), [], 'grants 必须被清空')
  assertStudentSees(await probeStudent(baseUrl, studentBJar, fixture.wsBId, book), '撤销后 B 班学生')
})

test('F-1 需求 5：悬空 grants（班级已停用 / 已删除）不锁死可见范围，校长与班主任都能一键清除', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const disabledBook = await harness.createBook('grants 指向已停用班级的书')
  const deletedBook = await harness.createBook('grants 指向已删除班级的书')

  const adminJar = await harness.login(fixture.people.admin)
  const teacherAJar = await harness.login(fixture.people.teacherA)
  const studentAJar = await harness.login(fixture.people.studentA)

  for (const [book, classId] of [
    [disabledBook, fixture.classToDisableId],
    [deletedBook, fixture.classToDeleteId],
  ]) {
    const restricted = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, {
      scope: 'classes',
      classIds: [classId],
    })
    assert.equal(restricted.status, 200, JSON.stringify(restricted.payload))
    assert.deepEqual(grantedClassIds(database, book.bookId), [classId])
  }
  // 运行期解散一个班、删除另一个班：两个 grants 都变成悬空引用，
  // 因此都不在任何人（包括校长）的 listAuthorizedClasses 结果里。
  database.prepare("UPDATE classes SET status = 'disabled' WHERE id = ?").run(fixture.classToDisableId)
  database.prepare('DELETE FROM classes WHERE id = ?').run(fixture.classToDeleteId)
  assertStudentBlocked(await probeStudent(baseUrl, studentAJar, fixture.wsAId, disabledBook), '悬空 grants（停用班）')
  assertStudentBlocked(await probeStudent(baseUrl, studentAJar, fixture.wsAId, deletedBook), '悬空 grants（删除班）')

  // 校长清停用班的悬空 grants。
  const clearedByAdmin = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, disabledBook.bookId, {
    scope: 'organization',
  })
  assert.equal(clearedByAdmin.status, 200, `悬空 grants 必须可被清除：${JSON.stringify(clearedByAdmin.payload)}`)
  assert.deepEqual(grantRows(database, disabledBook.bookId), [])
  assertStudentSees(await probeStudent(baseUrl, studentAJar, fixture.wsAId, disabledBook), '清除停用班悬空 grants 后')

  // 豁免不只对校长生效：class 范围的班主任同样能清掉指向已删除班级的悬空 grants，
  // 否则这本书会变成谁都改不了可见范围的永久死锁。
  const clearedByTeacher = await setVisibility(baseUrl, teacherAJar, fixture.wsAId, deletedBook.bookId, {
    scope: 'organization',
  })
  assert.equal(clearedByTeacher.status, 200, `班主任也必须能清悬空 grants：${JSON.stringify(clearedByTeacher.payload)}`)
  assert.deepEqual(grantRows(database, deletedBook.bookId), [])
  assertStudentSees(await probeStudent(baseUrl, studentAJar, fixture.wsAId, deletedBook), '清除删除班悬空 grants 后')
})

test('F-1 需求 6：校长（school 范围）授权集合覆盖本组织全部班级，任意组合都能操作', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const book = await harness.createBook('校长任意组合书')

  const teacherAJar = await harness.login(fixture.people.teacherA)
  const adminJar = await harness.login(fixture.people.admin)

  // 先由班主任限定到 A 班，制造「grants 由别人设置」的前置状态。
  const byTeacher = await setVisibility(baseUrl, teacherAJar, fixture.wsAId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId],
  })
  assert.equal(byTeacher.status, 200, JSON.stringify(byTeacher.payload))

  const steps = [
    { body: { scope: 'classes', classIds: [fixture.classCId] }, grants: [fixture.classCId] },
    { body: { scope: 'classes', classIds: [fixture.classAId, fixture.classBId] }, grants: [fixture.classAId, fixture.classBId].sort() },
    { body: { scope: 'organization' }, grants: [] },
    { body: { scope: 'classes', classIds: [fixture.classAId, fixture.classBId, fixture.classCId] }, grants: [fixture.classAId, fixture.classBId, fixture.classCId].sort() },
    { body: { scope: 'classes', classIds: [fixture.classBId] }, grants: [fixture.classBId] },
    { body: { scope: 'organization' }, grants: [] },
  ]
  for (const [index, step] of steps.entries()) {
    const response = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, step.body)
    assert.equal(response.status, 200, `第 ${index + 1} 步：${JSON.stringify(response.payload)}`)
    assert.deepEqual(grantedClassIds(database, book.bookId), step.grants, `第 ${index + 1} 步 grants 行不符`)
  }
})

// 收紧的边界：删除侧校验按「操作者授权范围」判定，与角色无关。年级范围操作者的正向能力
// （授权本年级班）没有被误伤，但它同样不能顺手抹掉别年级已有的授权。
test('F-1 收紧的边界：年级范围操作者仍可授权本年级班，但不能连带移除别年级的既有授权', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const freshBook = await harness.createBook('无 grants 的书')
  const gradeOneBook = await harness.createBook('已被限定到一年级两个班的书')

  const adminJar = await harness.login(fixture.people.admin)
  const gradeTwoJar = await harness.login(fixture.people.gradeAdminTwo)

  // 正向能力未被误伤：书上没有任何 grants 时，二年级主任可以授权给本年级的 C 班。
  const ownGrade = await setVisibility(baseUrl, gradeTwoJar, fixture.wsGradeTwoId, freshBook.bookId, {
    scope: 'classes',
    classIds: [fixture.classCId],
  })
  assert.equal(ownGrade.status, 200, `二年级主任授权本年级班必须 200：${JSON.stringify(ownGrade.payload)}`)
  assert.deepEqual(grantedClassIds(database, freshBook.bookId), [fixture.classCId])

  // 收紧生效：同一个请求打在「已被限定到一年级 A/B 班」的书上时，
  // 意味着要移除两个不在他授权范围内的班级授权，必须 403。
  const seeded = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, gradeOneBook.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId, fixture.classBId],
  })
  assert.equal(seeded.status, 200, JSON.stringify(seeded.payload))
  const crossGradeRevoke = await setVisibility(baseUrl, gradeTwoJar, fixture.wsGradeTwoId, gradeOneBook.bookId, {
    scope: 'classes',
    classIds: [fixture.classCId],
  })
  assert.equal(crossGradeRevoke.status, 403, `跨年级移除必须 403：${JSON.stringify(crossGradeRevoke.payload)}`)
  assert.equal(crossGradeRevoke.payload.error.code, 'PERMISSION_DENIED')
  assert.deepEqual(
    crossGradeRevoke.payload.error.details.classIds,
    [fixture.classAId, fixture.classBId].sort(),
  )
  assert.deepEqual(
    grantedClassIds(database, gradeOneBook.bookId),
    [fixture.classAId, fixture.classBId].sort(),
    '被拒的请求不得改动既有 grants',
  )
})

// ===========================================================================
// F-4：scope=organization 这条逃生通道必须清得掉任何 grantee_type
// ===========================================================================

test('F-4 需求 7：非 class 类型的 grants 行也会被 scope=organization 清除，书恢复对学生可见', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const book = await harness.createBook('被非 class grants 卡住的书')

  const adminJar = await harness.login(fixture.people.admin)
  const studentAJar = await harness.login(fixture.people.studentA)
  assertStudentSees(await probeStudent(baseUrl, studentAJar, fixture.wsAId, book), '插入前')

  // book_access_grants.grantee_type 没有 CHECK 约束，今天也没有 HTTP 路径能造出非 class 行
  //（setBookVisibility 写死 'class'），所以这里直接插一行，模拟「设计文档里正在讨论的新
  // grantee_type 落地之后」的状态。
  const now = new Date().toISOString()
  database.prepare(`
    INSERT INTO book_access_grants (
      id, book_version_id, grantee_type, grantee_id,
      organization_id_at_creation, actor_id_at_creation, created_at, updated_at, version
    ) VALUES (?, ?, 'user', ?, ?, ?, ?, ?, 1)
  `).run(
    randomUUID(),
    book.versionId,
    fixture.people.studentB.id,
    fixture.organizationId,
    fixture.people.admin.id,
    now,
    now,
  )

  // 可见性谓词有意不过滤 grantee_type：未知类型按「受限」处理，方向是 fail closed。
  assertStudentBlocked(await probeStudent(baseUrl, studentAJar, fixture.wsAId, book), '插入非 class grants 后')

  // 逃生通道必须在任何 grantee_type 下都有效。
  const reopened = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, { scope: 'organization' })
  assert.equal(reopened.status, 200, JSON.stringify(reopened.payload))
  assert.deepEqual(
    grantRows(database, book.bookId),
    [],
    'scope=organization 必须清除本书全部版本的全部 grants 行，不限 grantee_type',
  )
  assertStudentSees(await probeStudent(baseUrl, studentAJar, fixture.wsAId, book), '恢复全组织可见后')
})

test('F-4 边界：scope=classes 只改班级维度，不牵连非 class 类型的 grants 行', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const book = await harness.createBook('同时有 class 与非 class grants 的书')

  const adminJar = await harness.login(fixture.people.admin)
  const now = new Date().toISOString()
  database.prepare(`
    INSERT INTO book_access_grants (
      id, book_version_id, grantee_type, grantee_id,
      organization_id_at_creation, actor_id_at_creation, created_at, updated_at, version
    ) VALUES (?, ?, 'user', ?, ?, ?, ?, ?, 1)
  `).run(
    randomUUID(),
    book.versionId,
    fixture.people.studentB.id,
    fixture.organizationId,
    fixture.people.admin.id,
    now,
    now,
  )

  const applied = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId],
  })
  assert.equal(applied.status, 200, JSON.stringify(applied.payload))
  assert.deepEqual(
    grantRows(database, book.bookId).map((row) => `${row.granteeType}:${row.granteeId}`),
    [`class:${fixture.classAId}`, `user:${fixture.people.studentB.id}`],
    'scope=classes 只重写 class 行；清除全部类型是 organization 这条逃生通道专属的语义',
  )

  // 被授权班的学生仍然读得到（非 class 行不影响 class 授权的匹配）。
  const studentAJar = await harness.login(fixture.people.studentA)
  assertStudentSees(await probeStudent(baseUrl, studentAJar, fixture.wsAId, book), 'class 授权与非 class 行共存时')
})
