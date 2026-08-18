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
import { resolveCurrentBookVersionId } from '../../../server/domains/reading/visibility.js'

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function revokeFixture() {
  const suffix = randomUUID().slice(0, 8)
  const id = (name) => `${name}-${suffix}`

  const organizationId = id('org')
  const schoolCode = `rvk${suffix}`
  const gradeOneId = 'primary:2023'
  const gradeTwoId = 'primary:2024'
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
  for (const [key, person] of Object.entries(people)) {
    person.username = `${key}-${suffix}`
    person.loginName = person.username
    person.schoolCode = schoolCode
  }

  return {
    password,
    people,
    schoolCode,
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
      organizations: [{ id: organizationId, name: '删除侧校验测试学校', schoolCode }],
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
        { id: classAId, organizationId, gradeId: gradeOneId, name: '一年级 A 班', stage: 'primary', entryYear: 2023, classNumber: 1 },
        { id: classBId, organizationId, gradeId: gradeOneId, name: '一年级 B 班', stage: 'primary', entryYear: 2023, classNumber: 2 },
        { id: classCId, organizationId, gradeId: gradeTwoId, name: '二年级 C 班', stage: 'primary', entryYear: 2024, classNumber: 1 },
        { id: classToDisableId, organizationId, gradeId: gradeTwoId, name: '待停用空班', stage: 'primary', entryYear: 2024, classNumber: 2 },
        { id: classToDeleteId, organizationId, gradeId: gradeTwoId, name: '待删除空班', stage: 'primary', entryYear: 2024, classNumber: 3 },
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
        { id: randomUUID(), organizationId, userId: people.gradeAdminTwo.id, workspaceId: wsGradeTwoId, roleCode: 'grade_manager', scopeType: 'grade', scopeId: gradeTwoId },
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
    body: { schoolCode: person.schoolCode, loginName: person.loginName ?? person.username, password: fixture.password },
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
    grantCurrentBookToClass: (options) => grantCurrentBookToClass(application.database, options),
    putShelf: (jar, workspaceId, classId, bookId) => putShelf(baseUrl, jar, workspaceId, classId, bookId),
    deleteShelf: (jar, workspaceId, classId, bookId) => deleteShelf(baseUrl, jar, workspaceId, classId, bookId),
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

async function putShelf(baseUrl, jar, workspaceId, classId, bookId) {
  return request(baseUrl, jar, `/classes/${classId}/shelf/${bookId}`, {
    method: 'PUT',
    workspaceId,
    idempotencyKey: `revoke-shelf-put-${bookId}-${randomUUID()}`,
    body: {},
  })
}

async function deleteShelf(baseUrl, jar, workspaceId, classId, bookId) {
  return request(baseUrl, jar, `/classes/${classId}/shelf/${bookId}`, {
    method: 'DELETE',
    workspaceId,
    idempotencyKey: `revoke-shelf-del-${bookId}-${randomUUID()}`,
  })
}

function grantCurrentBookToClass(database, { bookId, classId, organizationId, actorId, granteeType = 'class' }) {
  if (!bookId || !classId || !organizationId || !actorId) {
    throw new Error('grantCurrentBookToClass 不得推断组织/班级')
  }
  const bookVersionId = resolveCurrentBookVersionId(database, { bookId, organizationId })
  assert.ok(bookVersionId, `grantCurrentBookToClass 需要当前版本：bookId=${bookId}`)
  const now = new Date().toISOString()
  database.prepare(`
    INSERT INTO book_access_grants (
      id, book_version_id, grantee_type, grantee_id,
      organization_id_at_creation, actor_id_at_creation, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(randomUUID(), bookVersionId, granteeType, classId, organizationId, actorId, now, now)
  return bookVersionId
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

test('F-1 需求 1/2/8：C 班 grant 后，A 班教师的旧 organization/DELETE 他班都被拒，C 班 grant 仍在', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const viaOrganization = await harness.createBook('已投放 C 班的书（organization 攻击）')
  const viaClasses = await harness.createBook('已投放 C 班的书（覆盖攻击）')

  for (const book of [viaOrganization, viaClasses]) {
    harness.grantCurrentBookToClass({
      bookId: book.bookId,
      classId: fixture.classCId,
      organizationId: fixture.organizationId,
      actorId: fixture.people.admin.id,
    })
    assert.deepEqual(grantedClassIds(database, book.bookId), [fixture.classCId])
  }

  const teacherAJar = await harness.login(fixture.people.teacherA)
  const studentAJar = await harness.login(fixture.people.studentA)
  const studentBJar = await harness.login(fixture.people.studentB)

  const widened = await setVisibility(baseUrl, teacherAJar, fixture.wsAId, viaOrganization.bookId, {
    scope: 'organization',
  })
  assert.equal(widened.status, 404, `organization 必须 404：${JSON.stringify(widened.payload)}`)
  assert.equal(widened.payload.error.code, 'RESOURCE_NOT_FOUND')
  assert.deepEqual(
    grantedClassIds(database, viaOrganization.bookId),
    [fixture.classCId],
    '被拒的 organization 请求不得删掉 C 班 grants 行',
  )
  assertStudentBlocked(
    await probeStudent(baseUrl, studentBJar, fixture.wsBId, viaOrganization),
    'organization 被拒后 B 班学生（原因：只 grant 他班）',
  )
  assertStudentBlocked(
    await probeStudent(baseUrl, studentAJar, fixture.wsAId, viaOrganization),
    'organization 被拒后 A 班学生（原因：只 grant 他班）',
  )

  const hijacked = await harness.deleteShelf(teacherAJar, fixture.wsAId, fixture.classCId, viaClasses.bookId)
  assert.equal(hijacked.status, 403, `DELETE 他班必须 403：${JSON.stringify(hijacked.payload)}`)
  assert.equal(hijacked.payload.error.code, 'PERMISSION_DENIED')
  assert.deepEqual(
    grantedClassIds(database, viaClasses.bookId),
    [fixture.classCId],
    '被拒的 DELETE 不得覆盖 C 班 grants 行',
  )
})

test('F-1 需求 3/4：教师可投放/撤下本班；撤下后默认全闭，不得 organization 全开', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const book = await harness.createBook('班主任自己投放再自己撤下的书')

  const teacherAJar = await harness.login(fixture.people.teacherA)
  const studentAJar = await harness.login(fixture.people.studentA)
  const studentBJar = await harness.login(fixture.people.studentB)

  assertStudentBlocked(await probeStudent(baseUrl, studentAJar, fixture.wsAId, book), '投放前 A 班学生（原因：无 grant）')
  const restricted = await harness.putShelf(teacherAJar, fixture.wsAId, fixture.classAId, book.bookId)
  assert.equal(restricted.status, 200, `无 grants 时投放本班必须 200：${JSON.stringify(restricted.payload)}`)
  assert.deepEqual(grantedClassIds(database, book.bookId), [fixture.classAId])
  assertStudentSees(await probeStudent(baseUrl, studentAJar, fixture.wsAId, book), '投放到 A 班后 A 班学生')
  assertStudentBlocked(await probeStudent(baseUrl, studentBJar, fixture.wsBId, book), '投放到 A 班后 B 班学生（原因：只 grant 他班）')

  const reopened = await setVisibility(baseUrl, teacherAJar, fixture.wsAId, book.bookId, { scope: 'organization' })
  assert.equal(reopened.status, 404, `旧 organization 必须 404：${JSON.stringify(reopened.payload)}`)
  assert.deepEqual(grantedClassIds(database, book.bookId), [fixture.classAId], 'organization 404 不得清空本班 grant')

  const revoked = await harness.deleteShelf(teacherAJar, fixture.wsAId, fixture.classAId, book.bookId)
  assert.equal(revoked.status, 200, `撤下本班必须 200：${JSON.stringify(revoked.payload)}`)
  assert.deepEqual(grantRows(database, book.bookId), [], '本班 grant 必须被清空')
  assertStudentBlocked(await probeStudent(baseUrl, studentAJar, fixture.wsAId, book), '撤下后 A 班学生（原因：无 grant）')
  assertStudentBlocked(await probeStudent(baseUrl, studentBJar, fixture.wsBId, book), '撤下后 B 班学生（原因：无 grant）')
})

test('F-1 需求 5：悬空 grants 对学生不可见（原因：学生不在该班）；旧 organization 不得再清空', async (t) => {
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
    harness.grantCurrentBookToClass({
      bookId: book.bookId,
      classId,
      organizationId: fixture.organizationId,
      actorId: fixture.people.admin.id,
    })
    assert.deepEqual(grantedClassIds(database, book.bookId), [classId])
  }
  database.prepare("UPDATE classes SET status = 'disabled' WHERE id = ?").run(fixture.classToDisableId)
  database.prepare('DELETE FROM classes WHERE id = ?').run(fixture.classToDeleteId)
  assertStudentBlocked(await probeStudent(baseUrl, studentAJar, fixture.wsAId, disabledBook), '悬空 grants（停用班，原因：学生不在该班）')
  assertStudentBlocked(await probeStudent(baseUrl, studentAJar, fixture.wsAId, deletedBook), '悬空 grants（删除班，原因：学生不在该班）')

  const clearedByAdmin = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, disabledBook.bookId, {
    scope: 'organization',
  })
  assert.equal(clearedByAdmin.status, 404, `旧 organization 必须 404：${JSON.stringify(clearedByAdmin.payload)}`)
  assert.deepEqual(grantedClassIds(database, disabledBook.bookId), [fixture.classToDisableId])
  assertStudentBlocked(await probeStudent(baseUrl, studentAJar, fixture.wsAId, disabledBook), 'organization 404 后仍不可见')

  const clearedByTeacher = await setVisibility(baseUrl, teacherAJar, fixture.wsAId, deletedBook.bookId, {
    scope: 'organization',
  })
  assert.equal(clearedByTeacher.status, 404, `教师旧 organization 必须 404：${JSON.stringify(clearedByTeacher.payload)}`)
  assert.deepEqual(grantedClassIds(database, deletedBook.bookId), [fixture.classToDeleteId])
})

test('F-1 需求 6：校长不得改班级书架；旧 visibility 任意组合都 404 且不得改 grants', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const book = await harness.createBook('校长任意组合书')

  const teacherAJar = await harness.login(fixture.people.teacherA)
  const adminJar = await harness.login(fixture.people.admin)

  const byTeacher = await harness.putShelf(teacherAJar, fixture.wsAId, fixture.classAId, book.bookId)
  assert.equal(byTeacher.status, 200, JSON.stringify(byTeacher.payload))

  const steps = [
    { body: { scope: 'classes', classIds: [fixture.classCId] } },
    { body: { scope: 'classes', classIds: [fixture.classAId, fixture.classBId] } },
    { body: { scope: 'organization' } },
    { body: { scope: 'classes', classIds: [fixture.classAId, fixture.classBId, fixture.classCId] } },
    { body: { scope: 'classes', classIds: [fixture.classBId] } },
  ]
  for (const [index, step] of steps.entries()) {
    const response = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, step.body)
    assert.equal(response.status, 404, `第 ${index + 1} 步旧 visibility 必须 404：${JSON.stringify(response.payload)}`)
    assert.deepEqual(grantedClassIds(database, book.bookId), [fixture.classAId], `第 ${index + 1} 步不得改教师投放的 A 班 grant`)
  }
  const adminShelf = await harness.putShelf(adminJar, fixture.wsSchoolId, fixture.classCId, book.bookId)
  assert.equal(adminShelf.status, 403, `校长无 C workspace 不得改书架：${JSON.stringify(adminShelf.payload)}`)
  assert.deepEqual(grantedClassIds(database, book.bookId), [fixture.classAId])
})

// 收紧的边界：删除侧校验按「操作者授权范围」判定，与角色无关。年级范围操作者的正向能力
// （授权本年级班）没有被误伤，但它同样不能顺手抹掉别年级已有的授权。
test('F-1 收紧的边界：年级主任对本届/跨届书架都必须 403，不得改既有他班 grant', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const freshBook = await harness.createBook('无 grants 的书')
  const gradeOneBook = await harness.createBook('已被投放到一年级两个班的书')

  const gradeTwoJar = await harness.login(fixture.people.gradeAdminTwo)

  const ownGrade = await harness.putShelf(gradeTwoJar, fixture.wsGradeTwoId, fixture.classCId, freshBook.bookId)
  assert.equal(ownGrade.status, 403, `二年级主任授权本届班必须 403：${JSON.stringify(ownGrade.payload)}`)
  assert.deepEqual(grantedClassIds(database, freshBook.bookId), [])

  harness.grantCurrentBookToClass({
    bookId: gradeOneBook.bookId,
    classId: fixture.classAId,
    organizationId: fixture.organizationId,
    actorId: fixture.people.teacherA.id,
  })
  harness.grantCurrentBookToClass({
    bookId: gradeOneBook.bookId,
    classId: fixture.classBId,
    organizationId: fixture.organizationId,
    actorId: fixture.people.teacherA.id,
  })
  const crossGradeRevoke = await harness.deleteShelf(gradeTwoJar, fixture.wsGradeTwoId, fixture.classAId, gradeOneBook.bookId)
  assert.equal(crossGradeRevoke.status, 403, `跨届撤书架必须 403：${JSON.stringify(crossGradeRevoke.payload)}`)
  assert.equal(crossGradeRevoke.payload.error.code, 'PERMISSION_DENIED')
  assert.deepEqual(
    grantedClassIds(database, gradeOneBook.bookId),
    [fixture.classAId, fixture.classBId].sort(),
    '被拒的请求不得改动既有 grants',
  )
})

// ===========================================================================
// F-4：scope=organization 这条逃生通道必须清得掉任何 grantee_type
// ===========================================================================

test('F-4 需求 7：非 class 类型 grant 不得当可见；旧 organization 不得清除', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const book = await harness.createBook('被非 class grants 卡住的书')

  const adminJar = await harness.login(fixture.people.admin)
  const studentAJar = await harness.login(fixture.people.studentA)
  assertStudentBlocked(await probeStudent(baseUrl, studentAJar, fixture.wsAId, book), '插入前（原因：无 grant）')

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

  const reopened = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, { scope: 'organization' })
  assert.equal(reopened.status, 404, JSON.stringify(reopened.payload))
  assert.equal(grantRows(database, book.bookId).length, 1, '旧 organization 不得清除非 class grants')
  assertStudentBlocked(await probeStudent(baseUrl, studentAJar, fixture.wsAId, book), 'organization 404 后仍不可见')
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

  const teacherAJar = await harness.login(fixture.people.teacherA)
  const applied = await harness.putShelf(teacherAJar, fixture.wsAId, fixture.classAId, book.bookId)
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
