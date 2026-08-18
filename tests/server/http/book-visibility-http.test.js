import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { hashPassword } from '../../../server/auth/password.js'
import { createReadmateApplication } from '../../../server/app.js'
import { createReadingDomain } from '../../../server/domains/reading/catalog.js'
import {
  currentBookVersionSubquery,
  resolveCurrentBookVersionId,
} from '../../../server/domains/reading/visibility.js'

function identityFixture() {
  const suffix = randomUUID()
  const organizationId = `organization-${suffix}`
  const foreignOrganizationId = `foreign-organization-${suffix}`
  const gradeId = `grade-${suffix}`
  const otherGradeId = `other-grade-${suffix}`
  const classAId = `class-a-${suffix}`
  const classBId = `class-b-${suffix}`
  const classCId = `class-c-${suffix}`
  const foreignClassId = `foreign-class-${suffix}`
  const workspaceAId = `workspace-a-${suffix}`
  const workspaceBId = `workspace-b-${suffix}`
  const schoolWorkspaceId = `workspace-school-${suffix}`
  const gradeWorkspaceId = `workspace-grade-${suffix}`
  const studentAId = `student-a-${suffix}`
  const studentBId = `student-b-${suffix}`
  const teacherAId = `teacher-a-${suffix}`
  const gradeManagerId = `grade-manager-${suffix}`
  const adminId = `school-admin-${suffix}`
  const password = randomBytes(24).toString('base64url')
  const passwordHash = hashPassword(password)
  const users = [
    { id: studentAId, username: `student-a-${suffix}`, displayName: 'A 班学生' },
    { id: studentBId, username: `student-b-${suffix}`, displayName: 'B 班学生' },
    // class_teacher 是别名，必须经 permissions.js 的归一化才会被判成教师。
    { id: teacherAId, username: `teacher-a-${suffix}`, displayName: 'A 班班主任' },
    { id: gradeManagerId, username: `grade-manager-${suffix}`, displayName: '年级组长' },
    { id: adminId, username: `school-admin-${suffix}`, displayName: '校长' },
  ]
  return {
    organizationId,
    foreignOrganizationId,
    gradeId,
    otherGradeId,
    classAId,
    classBId,
    classCId,
    foreignClassId,
    workspaceAId,
    workspaceBId,
    schoolWorkspaceId,
    gradeWorkspaceId,
    studentAId,
    studentBId,
    teacherAId,
    gradeManagerId,
    adminId,
    password,
    users,
    userByRole: {
      studentA: users.find((user) => user.id === studentAId),
      studentB: users.find((user) => user.id === studentBId),
      teacherA: users.find((user) => user.id === teacherAId),
      gradeManager: users.find((user) => user.id === gradeManagerId),
      admin: users.find((user) => user.id === adminId),
    },
    seed: {
      organizations: [
        { id: organizationId, name: '可见范围联调学校' },
        { id: foreignOrganizationId, name: '可见范围外校' },
      ],
      users: users.map(({ id, username, displayName }) => ({ id, organizationId, username, displayName })),
      workspaces: [
        { id: workspaceAId, organizationId, code: 'class-teacher', name: 'A 班', scopeType: 'class', scopeId: classAId },
        { id: workspaceBId, organizationId, code: 'class-teacher', name: 'B 班', scopeType: 'class', scopeId: classBId },
        { id: schoolWorkspaceId, organizationId, code: 'school-admin', name: '校务', scopeType: 'school', scopeId: organizationId },
        { id: gradeWorkspaceId, organizationId, code: 'grade-group', name: '年级组', scopeType: 'grade', scopeId: gradeId },
      ],
      workspaceMemberships: [
        { id: randomUUID(), userId: studentAId, workspaceId: workspaceAId },
        { id: randomUUID(), userId: studentBId, workspaceId: workspaceBId },
        { id: randomUUID(), userId: teacherAId, workspaceId: workspaceAId },
        { id: randomUUID(), userId: gradeManagerId, workspaceId: gradeWorkspaceId },
        { id: randomUUID(), userId: adminId, workspaceId: schoolWorkspaceId },
      ],
      classes: [
        { id: classAId, organizationId, gradeId, name: '一年级 A 班' },
        { id: classBId, organizationId, gradeId, name: '一年级 B 班' },
        { id: classCId, organizationId, gradeId: otherGradeId, name: '二年级空班' },
        { id: foreignClassId, organizationId: foreignOrganizationId, gradeId: null, name: '外校班级' },
      ],
      classMemberships: [
        { id: randomUUID(), classId: classAId, userId: studentAId, membershipRole: 'student' },
        { id: randomUUID(), classId: classBId, userId: studentBId, membershipRole: 'student' },
        { id: randomUUID(), classId: classAId, userId: teacherAId, membershipRole: 'teacher' },
      ],
      roleAssignments: [
        { id: randomUUID(), organizationId, userId: studentAId, workspaceId: workspaceAId, roleCode: 'student', scopeType: 'class', scopeId: classAId },
        { id: randomUUID(), organizationId, userId: studentBId, workspaceId: workspaceBId, roleCode: 'student', scopeType: 'class', scopeId: classBId },
        { id: randomUUID(), organizationId, userId: teacherAId, workspaceId: workspaceAId, roleCode: 'class_teacher', scopeType: 'class', scopeId: classAId },
        { id: randomUUID(), organizationId, userId: gradeManagerId, workspaceId: gradeWorkspaceId, roleCode: 'grade_group', scopeType: 'grade', scopeId: gradeId },
        { id: randomUUID(), organizationId, userId: adminId, workspaceId: schoolWorkspaceId, roleCode: 'school_admin', scopeType: 'school', scopeId: organizationId },
      ],
      credentials: users.map(({ id }) => ({ id: randomUUID(), userId: id, passwordHash })),
    },
  }
}

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

async function login(baseUrl, fixture, user) {
  const jar = new Map()
  const response = await request(baseUrl, jar, '/auth/login', {
    method: 'POST',
    idempotencyKey: `login-${user.id}-${randomUUID()}`,
    body: { username: user.username, password: fixture.password },
  })
  assert.equal(response.status, 200, JSON.stringify(response.payload))
  return jar
}

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

async function createBook(application, fixture, { title, published = true, cover }) {
  const reading = createReadingDomain({
    db: application.database,
    actor: { id: fixture.adminId },
    workspace: { id: fixture.schoolWorkspaceId, organizationId: fixture.organizationId },
    authorize: async () => true,
    audit: async () => undefined,
    assetMetadataVerifier: async ({ storageKey }) => {
      if (storageKey !== cover.storageKey) throw new Error('未登记的测试资产键')
      return cover
    },
    idFactory: randomUUID,
    now: () => new Date(),
  })
  const created = await reading.createBookVersion({
    title,
    label: `visibility-${randomUUID()}`,
    sourceFormat: 'text',
    assets: [{ ...cover, assetType: 'source_text' }],
    pages: pages(title),
  })
  if (published) await reading.publishBook(created.bookId)
  const asset = application.database.prepare(
    "SELECT id FROM book_assets WHERE book_version_id = ? AND asset_type = 'source_text'",
  ).get(created.versionId)
  return { ...created, assetId: asset.id }
}

function grantCount(database, bookId) {
  return database.prepare(`
    SELECT COUNT(*) AS count FROM book_access_grants AS grant_row
    JOIN book_versions AS version ON version.id = grant_row.book_version_id
    WHERE version.book_id = ?
  `).get(bookId).count
}

function stubModelProvider() {
  const requests = []
  return {
    requests,
    provider: {
      listCandidates: async () => [{ id: 'visibility-model' }],
      generate: async ({ request: modelRequest }) => {
        requests.push(modelRequest)
        return {
          answer: '这段正文讲了测试书的内容。',
          responseType: 'answer',
          citations: [{
            evidenceId: modelRequest.sources[0].evidenceId,
            pageNumber: modelRequest.sources[0].pageNumber,
          }],
          privacy: { detected: false, confidence: 0, category: 'none', urgency: 'none' },
          danger: { detected: false, confidence: 0, category: 'none', urgency: 'none' },
          implicatedCandidates: [],
          usage: { inputTokens: 12, outputTokens: 8, cachedTokens: 0, costMicros: 16 },
          spoilerRisk: false,
        }
      },
    },
  }
}

async function startHarness(t) {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-book-visibility-http-'))
  const databasePath = join(directory, 'book-visibility.sqlite')
  const publicAssetDirectory = join(directory, 'public')
  const cover = {
    storageKey: 'books/visibility/source.txt',
    usageLabel: 'INTERNAL PILOT ONLY',
    mimeType: 'text/plain',
    bytes: Buffer.from('可见范围联调用书籍源资产', 'utf8'),
  }
  cover.sizeBytes = cover.bytes.length
  cover.sha256 = createHash('sha256').update(cover.bytes).digest('hex')
  mkdirSync(join(publicAssetDirectory, 'books', 'visibility'), { recursive: true })
  writeFileSync(join(publicAssetDirectory, cover.storageKey), cover.bytes)
  const fixture = identityFixture()
  const model = stubModelProvider()
  const application = createReadmateApplication({
    databasePath,
    sessionSecret: randomBytes(48).toString('base64url'),
    cookieSecure: false,
    serveStatic: false,
    publicAssetDirectory,
    modelProvider: model.provider,
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
    fixture,
    cover,
    model,
    baseUrl,
    createBook: (options) => createBook(application, fixture, { cover, ...options }),
  }
}

// 学生读一本书的四个入口：列表、书页、资产、AI 消息。
async function readAllEntries(baseUrl, jar, workspaceId, book) {
  const list = await request(baseUrl, jar, '/books', { workspaceId })
  const page = await request(baseUrl, jar, `/books/${book.bookId}/pages/1`, { workspaceId })
  const asset = await request(baseUrl, jar, `/books/assets/${book.assetId}`, { workspaceId })
  const ai = await request(baseUrl, jar, '/ai/messages', {
    method: 'POST',
    workspaceId,
    idempotencyKey: `ai-${book.bookId}-${randomUUID()}`,
    body: {
      bookId: book.bookId,
      currentPageNo: 1,
      readRangeVersion: page.payload?.data?.readRangeVersion ?? 'read-range-v2:unavailable',
      text: '这一页讲了什么？',
      safeMode: true,
    },
  })
  return {
    list,
    page,
    asset,
    ai,
    listed: (list.payload?.data?.items ?? []).some((item) => item.id === book.bookId),
  }
}

async function setVisibility(baseUrl, jar, workspaceId, bookId, body, key = randomUUID()) {
  return request(baseUrl, jar, `/books/${bookId}/visibility`, {
    method: 'PUT',
    workspaceId,
    idempotencyKey: `visibility-${bookId}-${key}`,
    body,
  })
}

test('grants 到别班后，本班学生四个入口全部表现为书不存在（404，不是 403）', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl } = harness
  const restricted = await harness.createBook({ title: '限定 B 班的书' })
  const open = await harness.createBook({ title: '全组织可见的书' })

  const adminJar = await login(baseUrl, fixture, fixture.userByRole.admin)
  const applied = await setVisibility(baseUrl, adminJar, fixture.schoolWorkspaceId, restricted.bookId, {
    scope: 'classes',
    classIds: [fixture.classBId],
  })
  assert.equal(applied.status, 200, JSON.stringify(applied.payload))
  assert.equal(applied.payload.data.scope, 'classes')
  assert.deepEqual(applied.payload.data.classIds, [fixture.classBId])

  const studentAJar = await login(baseUrl, fixture, fixture.userByRole.studentA)
  const blocked = await readAllEntries(baseUrl, studentAJar, fixture.workspaceAId, restricted)
  assert.equal(blocked.listed, false, JSON.stringify(blocked.list.payload))
  assert.equal(blocked.page.status, 404, JSON.stringify(blocked.page.payload))
  assert.equal(blocked.page.payload.error.code, 'RESOURCE_NOT_FOUND')
  assert.equal(blocked.asset.status, 404, JSON.stringify(blocked.asset.payload))
  assert.equal(blocked.asset.payload.error.code, 'RESOURCE_NOT_FOUND')
  assert.equal(blocked.ai.status, 404, JSON.stringify(blocked.ai.payload))
  assert.equal(blocked.ai.payload.error.code, 'RESOURCE_NOT_FOUND')
  assert.equal(harness.model.requests.length, 0, '不可见书不得进入模型调用')

  // 可见范围详情是教师端读接口：学生对不可见书与可见书都拿到同一个 404，不泄露存在性也不泄露授权名单。
  const restrictedVisibility = await request(baseUrl, studentAJar, `/books/${restricted.bookId}/visibility`, {
    workspaceId: fixture.workspaceAId,
  })
  assert.equal(restrictedVisibility.status, 404, JSON.stringify(restrictedVisibility.payload))
  const openVisibility = await request(baseUrl, studentAJar, `/books/${open.bookId}/visibility`, {
    workspaceId: fixture.workspaceAId,
  })
  assert.equal(openVisibility.status, 404, JSON.stringify(openVisibility.payload))
  assert.equal(restrictedVisibility.payload.error.code, openVisibility.payload.error.code)

  // 学生书架（GET /reading/library）同样按组织列出全部已发布书，必须过同一个谓词。
  const shelf = await request(baseUrl, studentAJar, '/reading/library', { workspaceId: fixture.workspaceAId })
  assert.equal(shelf.status, 200, JSON.stringify(shelf.payload))
  const shelfBookIds = shelf.payload.data.shelf.map((entry) => entry.bookId)
  assert.equal(shelfBookIds.includes(restricted.bookId), false, '不可见书不得带着书名与封面出现在学生书架上')
  assert.equal(shelfBookIds.includes(open.bookId), true, '无 grants 行的书必须仍在书架上')

  // 默认分支：没有任何 grants 行的书仍然全组织可见，不能被一起过滤掉。
  const stillVisible = await readAllEntries(baseUrl, studentAJar, fixture.workspaceAId, open)
  assert.equal(stillVisible.listed, true, JSON.stringify(stillVisible.list.payload))
  assert.equal(stillVisible.page.status, 200, JSON.stringify(stillVisible.page.payload))
  assert.equal(stillVisible.asset.status, 200)
  assert.equal(stillVisible.ai.status, 200, JSON.stringify(stillVisible.ai.payload))
})

test('grants 到本班后，本班学生四个入口全部可读；别班学生仍然 404', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl } = harness
  const book = await harness.createBook({ title: '限定 A 班的书' })

  const teacherJar = await login(baseUrl, fixture, fixture.userByRole.teacherA)
  const applied = await setVisibility(baseUrl, teacherJar, fixture.workspaceAId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId],
  })
  assert.equal(applied.status, 200, JSON.stringify(applied.payload))

  const studentAJar = await login(baseUrl, fixture, fixture.userByRole.studentA)
  const allowed = await readAllEntries(baseUrl, studentAJar, fixture.workspaceAId, book)
  assert.equal(allowed.listed, true, JSON.stringify(allowed.list.payload))
  assert.equal(allowed.page.status, 200, JSON.stringify(allowed.page.payload))
  assert.equal(allowed.asset.status, 200)
  assert.equal(allowed.ai.status, 200, JSON.stringify(allowed.ai.payload))

  const studentBJar = await login(baseUrl, fixture, fixture.userByRole.studentB)
  const denied = await readAllEntries(baseUrl, studentBJar, fixture.workspaceBId, book)
  assert.equal(denied.listed, false, JSON.stringify(denied.list.payload))
  assert.equal(denied.page.status, 404, JSON.stringify(denied.page.payload))
  assert.equal(denied.asset.status, 404, JSON.stringify(denied.asset.payload))
  assert.equal(denied.ai.status, 404, JSON.stringify(denied.ai.payload))

  // 恢复全组织可见后，别班学生立刻恢复可读。
  const reopened = await setVisibility(baseUrl, teacherJar, fixture.workspaceAId, book.bookId, { scope: 'organization' })
  assert.equal(reopened.status, 200, JSON.stringify(reopened.payload))
  assert.equal(reopened.payload.data.scope, 'organization')
  assert.deepEqual(reopened.payload.data.classIds, [])
  assert.equal(grantCount(harness.application.database, book.bookId), 0)
  const reopenedRead = await readAllEntries(baseUrl, studentBJar, fixture.workspaceBId, book)
  assert.equal(reopenedRead.listed, true, JSON.stringify(reopenedRead.list.payload))
  assert.equal(reopenedRead.page.status, 200)
  assert.equal(reopenedRead.asset.status, 200)
})

test('教师与管理角色不受 grants 与发布状态过滤；学生仍然只看已发布且被授权的书', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl } = harness
  const restricted = await harness.createBook({ title: '只给 B 班的书' })
  const draft = await harness.createBook({ title: '草稿书', published: false })

  const adminJar = await login(baseUrl, fixture, fixture.userByRole.admin)
  const applied = await setVisibility(baseUrl, adminJar, fixture.schoolWorkspaceId, restricted.bookId, {
    scope: 'classes',
    classIds: [fixture.classBId],
  })
  assert.equal(applied.status, 200, JSON.stringify(applied.payload))

  const teacherJar = await login(baseUrl, fixture, fixture.userByRole.teacherA)
  const teacherList = await request(baseUrl, teacherJar, '/books', { workspaceId: fixture.workspaceAId })
  assert.equal(teacherList.status, 200, JSON.stringify(teacherList.payload))
  const teacherBookIds = teacherList.payload.data.items.map((item) => item.id)
  assert.ok(teacherBookIds.includes(restricted.bookId), '教师必须看到只授权给别班的书')

  const teacherDrafts = await request(baseUrl, teacherJar, '/books?status=draft', { workspaceId: fixture.workspaceAId })
  assert.equal(teacherDrafts.status, 200, JSON.stringify(teacherDrafts.payload))
  assert.deepEqual(teacherDrafts.payload.data.items.map((item) => item.id), [draft.bookId])

  // 学生带 ?status=draft 不得列出草稿：口径被锁死回 published。
  const studentAJar = await login(baseUrl, fixture, fixture.userByRole.studentA)
  const studentDrafts = await request(baseUrl, studentAJar, '/books?status=draft', { workspaceId: fixture.workspaceAId })
  assert.equal(studentDrafts.status, 200, JSON.stringify(studentDrafts.payload))
  const studentDraftIds = studentDrafts.payload.data.items.map((item) => item.id)
  assert.equal(studentDraftIds.includes(draft.bookId), false, '学生不得通过 status=draft 列出草稿书')
  assert.equal(studentDraftIds.includes(restricted.bookId), false, '学生不得看到只授权给别班的书')
})

test('教师可取任意发布状态书籍的资产，学生取草稿书资产仍然 404', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl } = harness
  const book = await harness.createBook({ title: '会被下架的书' })

  const teacherJar = await login(baseUrl, fixture, fixture.userByRole.teacherA)
  const studentAJar = await login(baseUrl, fixture, fixture.userByRole.studentA)

  const publishedForStudent = await request(baseUrl, studentAJar, `/books/assets/${book.assetId}`, {
    workspaceId: fixture.workspaceAId,
  })
  assert.equal(publishedForStudent.status, 200)

  const unpublished = await request(baseUrl, teacherJar, `/books/${book.bookId}/unpublish`, {
    method: 'POST',
    workspaceId: fixture.workspaceAId,
    idempotencyKey: `unpublish-${book.bookId}`,
    body: {},
  })
  assert.equal(unpublished.status, 200, JSON.stringify(unpublished.payload))

  const teacherAsset = await request(baseUrl, teacherJar, `/books/assets/${book.assetId}`, {
    workspaceId: fixture.workspaceAId,
  })
  assert.equal(teacherAsset.status, 200, '教师下架后仍要能取到资产，否则书库封面会变占位图')

  const studentAsset = await request(baseUrl, studentAJar, `/books/assets/${book.assetId}`, {
    workspaceId: fixture.workspaceAId,
  })
  assert.equal(studentAsset.status, 404, JSON.stringify(studentAsset.payload))
  assert.equal(studentAsset.payload.error.code, 'RESOURCE_NOT_FOUND')

  const studentPage = await request(baseUrl, studentAJar, `/books/${book.bookId}/pages/1`, {
    workspaceId: fixture.workspaceAId,
  })
  assert.equal(studentPage.status, 404, '放宽只针对资产，getPage 对所有角色仍限 published')
  const teacherPage = await request(baseUrl, teacherJar, `/books/${book.bookId}/pages/1`, {
    workspaceId: fixture.workspaceAId,
  })
  assert.equal(teacherPage.status, 404, 'getPage 的 published 约束对教师也不放宽')
})

test('PUT 可见范围要求幂等键，同键重放不产生第二行 grants', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, application } = harness
  const book = await harness.createBook({ title: '幂等测试书' })
  const teacherJar = await login(baseUrl, fixture, fixture.userByRole.teacherA)

  const missingKey = await request(baseUrl, teacherJar, `/books/${book.bookId}/visibility`, {
    method: 'PUT',
    workspaceId: fixture.workspaceAId,
    body: { scope: 'classes', classIds: [fixture.classAId] },
  })
  assert.equal(missingKey.status, 400, JSON.stringify(missingKey.payload))
  assert.equal(missingKey.payload.error.code, 'VALIDATION_FAILED')
  assert.equal(grantCount(application.database, book.bookId), 0)

  const key = 'fixed-key'
  const first = await setVisibility(baseUrl, teacherJar, fixture.workspaceAId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId],
  }, key)
  assert.equal(first.status, 200, JSON.stringify(first.payload))
  assert.equal(first.payload.meta.replayed, undefined)
  assert.equal(grantCount(application.database, book.bookId), 1)

  const replay = await setVisibility(baseUrl, teacherJar, fixture.workspaceAId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId],
  }, key)
  assert.equal(replay.status, 200, JSON.stringify(replay.payload))
  assert.equal(replay.payload.meta.replayed, true)
  assert.equal(grantCount(application.database, book.bookId), 1)
  assert.equal(
    application.database.prepare(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'book.visibility.updated' AND resource_id = ?",
    ).get(book.bookId).count,
    1,
  )
})

test('班级校验：外校班级与超出授权范围的班级都被拒，学生无权写入', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, application } = harness
  const book = await harness.createBook({ title: '班级校验书' })
  const teacherJar = await login(baseUrl, fixture, fixture.userByRole.teacherA)

  const foreign = await setVisibility(baseUrl, teacherJar, fixture.workspaceAId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.foreignClassId],
  })
  assert.equal(foreign.status, 403, JSON.stringify(foreign.payload))
  assert.equal(foreign.payload.error.code, 'PERMISSION_DENIED')
  assert.equal(grantCount(application.database, book.bookId), 0)

  const outOfScope = await setVisibility(baseUrl, teacherJar, fixture.workspaceAId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId, fixture.classCId],
  })
  assert.equal(outOfScope.status, 403, JSON.stringify(outOfScope.payload))
  assert.equal(outOfScope.payload.error.code, 'PERMISSION_DENIED')
  assert.equal(grantCount(application.database, book.bookId), 0)

  const otherClassInSameGrade = await setVisibility(baseUrl, teacherJar, fixture.workspaceAId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classBId],
  })
  assert.equal(otherClassInSameGrade.status, 403, 'class 范围教师不能授权给同年级的别班')

  const gradeJar = await login(baseUrl, fixture, fixture.userByRole.gradeManager)
  const gradeScoped = await setVisibility(baseUrl, gradeJar, fixture.gradeWorkspaceId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId, fixture.classBId],
  })
  assert.equal(gradeScoped.status, 200, JSON.stringify(gradeScoped.payload))
  const gradeOutOfScope = await setVisibility(baseUrl, gradeJar, fixture.gradeWorkspaceId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classCId],
  })
  assert.equal(gradeOutOfScope.status, 403, '年级范围不能跨到别年级的班')

  const adminJar = await login(baseUrl, fixture, fixture.userByRole.admin)
  const schoolScoped = await setVisibility(baseUrl, adminJar, fixture.schoolWorkspaceId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classCId],
  })
  assert.equal(schoolScoped.status, 200, '学校范围可以授权本组织任意班级')

  // 学生对存在与不存在的书都统一 403（权限不足），不通过状态码泄露书是否存在。
  const studentAJar = await login(baseUrl, fixture, fixture.userByRole.studentA)
  const studentWrite = await setVisibility(baseUrl, studentAJar, fixture.workspaceAId, book.bookId, {
    scope: 'organization',
  })
  assert.equal(studentWrite.status, 403, JSON.stringify(studentWrite.payload))
  const studentWriteMissing = await setVisibility(baseUrl, studentAJar, fixture.workspaceAId, 'book-does-not-exist', {
    scope: 'organization',
  })
  assert.equal(studentWriteMissing.status, 403, JSON.stringify(studentWriteMissing.payload))
  assert.equal(studentWrite.payload.error.code, studentWriteMissing.payload.error.code)
})

test('grants 写入的 book_version_id 与过滤读取解析的当前版本同源，旧版本不能绕过', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, application } = harness
  const book = await harness.createBook({ title: '多版本书' })

  // 追加一个更晚创建的版本，制造“旧版本 / 当前版本”分叉。
  const laterVersionId = `later-version-${randomUUID()}`
  const laterCreatedAt = new Date(Date.now() + 60_000).toISOString()
  application.database.prepare(`
    INSERT INTO book_versions (
      id, book_id, organization_id_at_creation, actor_id_at_creation, label, source_format,
      page_count, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, 'text', 2, ?, ?, 1)
  `).run(laterVersionId, book.bookId, fixture.organizationId, fixture.adminId, `later-${randomUUID()}`, laterCreatedAt, laterCreatedAt)
  for (const pageNo of [1, 2]) {
    application.database.prepare(`
      INSERT INTO book_pages (
        id, book_version_id, page_no, text_content, width, height, raw_text, normalized_text,
        created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, 1024, 768, ?, ?, ?, ?, 1)
    `).run(randomUUID(), laterVersionId, pageNo, `新版本第 ${pageNo} 页`, `新版本第 ${pageNo} 页`, `新版本第 ${pageNo} 页`, laterCreatedAt, laterCreatedAt)
  }

  const expectedVersionId = resolveCurrentBookVersionId(application.database, {
    bookId: book.bookId,
    organizationId: fixture.organizationId,
  })
  assert.equal(expectedVersionId, laterVersionId, '当前版本解析必须取更晚创建的版本')

  const adminJar = await login(baseUrl, fixture, fixture.userByRole.admin)
  const applied = await setVisibility(baseUrl, adminJar, fixture.schoolWorkspaceId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId],
  })
  assert.equal(applied.status, 200, JSON.stringify(applied.payload))
  assert.equal(applied.payload.data.bookVersionId, expectedVersionId)
  const storedVersionIds = application.database.prepare(`
    SELECT DISTINCT book_version_id AS id FROM book_access_grants AS grant_row
    JOIN book_versions AS version ON version.id = grant_row.book_version_id
    WHERE version.book_id = ?
  `).all(book.bookId).map((row) => row.id)
  assert.deepEqual(storedVersionIds, [expectedVersionId])

  // listBooks 的“当前版本”与写入版本必须是同一个（同一个 SQL 生成器）。
  const listedForTeacher = await request(baseUrl, adminJar, '/books', { workspaceId: fixture.schoolWorkspaceId })
  const listedBook = listedForTeacher.payload.data.items.find((item) => item.id === book.bookId)
  assert.equal(listedBook.versionId, expectedVersionId)
  assert.equal(
    currentBookVersionSubquery('b.id').replace('b.id', ':bookId'),
    currentBookVersionSubquery(':bookId'),
    '两处版本解析必须来自同一个 SQL 生成器',
  )

  // 别班学生既不能读当前版本，也不能通过显式指定旧版本绕过。
  const studentBJar = await login(baseUrl, fixture, fixture.userByRole.studentB)
  const currentVersionPage = await request(baseUrl, studentBJar, `/books/${book.bookId}/pages/1`, {
    workspaceId: fixture.workspaceBId,
  })
  assert.equal(currentVersionPage.status, 404, JSON.stringify(currentVersionPage.payload))
  const oldVersionPage = await request(
    baseUrl,
    studentBJar,
    `/books/${book.bookId}/pages/1?versionId=${encodeURIComponent(book.versionId)}`,
    { workspaceId: fixture.workspaceBId },
  )
  assert.equal(oldVersionPage.status, 404, '显式指定旧版本不得绕过班级可见范围')
  const oldVersionAsset = await request(baseUrl, studentBJar, `/books/assets/${book.assetId}`, {
    workspaceId: fixture.workspaceBId,
  })
  assert.equal(oldVersionAsset.status, 404, '挂在旧版本上的资产也不得绕过班级可见范围')

  // A 班学生仍然读得到（正向分支没有被这条加固破坏）。
  const studentAJar = await login(baseUrl, fixture, fixture.userByRole.studentA)
  const allowedPage = await request(baseUrl, studentAJar, `/books/${book.bookId}/pages/1`, {
    workspaceId: fixture.workspaceAId,
  })
  assert.equal(allowedPage.status, 200, JSON.stringify(allowedPage.payload))
})

test('GET /books/:bookId/visibility 返回当前范围与课堂锁书、阅读安排引用', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, application } = harness
  const book = await harness.createBook({ title: '被安排引用的书' })
  const teacherJar = await login(baseUrl, fixture, fixture.userByRole.teacherA)

  const assignment = await request(baseUrl, teacherJar, '/assignments', {
    method: 'POST',
    workspaceId: fixture.workspaceAId,
    idempotencyKey: `assignment-${book.bookId}`,
    body: {
      bookVersionId: book.versionId,
      title: 'A 班共读安排',
      classIds: [fixture.classAId],
    },
  })
  assert.equal(assignment.status, 201, JSON.stringify(assignment.payload))

  const session = await request(baseUrl, teacherJar, '/classroom/sessions', {
    method: 'POST',
    workspaceId: fixture.workspaceAId,
    idempotencyKey: `session-${book.bookId}`,
    body: { assignmentId: assignment.payload.data.assignmentId ?? assignment.payload.data.id },
  })
  assert.equal(session.status, 201, JSON.stringify(session.payload))

  const before = await request(baseUrl, teacherJar, `/books/${book.bookId}/visibility`, {
    workspaceId: fixture.workspaceAId,
  })
  assert.equal(before.status, 200, JSON.stringify(before.payload))
  assert.equal(before.payload.data.scope, 'organization')
  assert.deepEqual(before.payload.data.classIds, [])
  assert.equal(before.payload.data.references.arrangements.length, 1)
  assert.deepEqual(
    before.payload.data.references.arrangements[0].classes.map((entry) => entry.id),
    [fixture.classAId],
  )
  assert.equal(before.payload.data.references.classroomSessions.length, 1, '课堂锁书引用必须被查出来')
  assert.equal(before.payload.data.references.classroomSessions[0].bookVersionId, book.versionId)

  // 收窄到 A 班时 A 班的安排不受影响；只保留别的班时必须给出会失去访问的引用。
  const keepA = await setVisibility(baseUrl, teacherJar, fixture.workspaceAId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId],
  })
  assert.equal(keepA.status, 200, JSON.stringify(keepA.payload))
  assert.equal(keepA.payload.data.impact.affectedArrangementCount, 0)

  const adminJar = await login(baseUrl, fixture, fixture.userByRole.admin)
  const dropA = await setVisibility(baseUrl, adminJar, fixture.schoolWorkspaceId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classBId],
  })
  assert.equal(dropA.status, 200, JSON.stringify(dropA.payload))
  assert.equal(dropA.payload.data.impact.affectedArrangementCount, 1)
  assert.equal(dropA.payload.data.impact.affectedClassroomSessionCount, 1)
  assert.deepEqual(dropA.payload.data.impact.losingClasses.map((entry) => entry.id), [fixture.classAId])
  // 明确不做级联清理：安排本身仍然存在。
  assert.equal(
    application.database.prepare('SELECT COUNT(*) AS count FROM reading_assignments WHERE book_version_id = ?')
      .get(book.versionId).count,
    1,
  )
})

test('GET /classes 按操作者授权范围列班级，空班也能列出，学生无权访问', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl } = harness

  const teacherJar = await login(baseUrl, fixture, fixture.userByRole.teacherA)
  const teacherClasses = await request(baseUrl, teacherJar, '/classes', { workspaceId: fixture.workspaceAId })
  assert.equal(teacherClasses.status, 200, JSON.stringify(teacherClasses.payload))
  assert.deepEqual(teacherClasses.payload.data.items.map((entry) => entry.id), [fixture.classAId])

  const gradeJar = await login(baseUrl, fixture, fixture.userByRole.gradeManager)
  const gradeClasses = await request(baseUrl, gradeJar, '/classes', { workspaceId: fixture.gradeWorkspaceId })
  assert.equal(gradeClasses.status, 200, JSON.stringify(gradeClasses.payload))
  assert.deepEqual(
    gradeClasses.payload.data.items.map((entry) => entry.id).sort(),
    [fixture.classAId, fixture.classBId].sort(),
  )

  const adminJar = await login(baseUrl, fixture, fixture.userByRole.admin)
  const adminClasses = await request(baseUrl, adminJar, '/classes', { workspaceId: fixture.schoolWorkspaceId })
  assert.equal(adminClasses.status, 200, JSON.stringify(adminClasses.payload))
  const adminClassIds = adminClasses.payload.data.items.map((entry) => entry.id)
  assert.deepEqual(adminClassIds.sort(), [fixture.classAId, fixture.classBId, fixture.classCId].sort())
  assert.equal(adminClassIds.includes(fixture.foreignClassId), false, '不得列出外校班级')
  const emptyClass = adminClasses.payload.data.items.find((entry) => entry.id === fixture.classCId)
  assert.equal(emptyClass.studentCount, 0, '没有学生的空班也必须能被列出来')
  const classA = adminClasses.payload.data.items.find((entry) => entry.id === fixture.classAId)
  assert.equal(classA.studentCount, 1, '学生人数只统计 membership_role=student 的在册成员')
  assert.equal(classA.gradeId, fixture.gradeId)

  const studentJar = await login(baseUrl, fixture, fixture.userByRole.studentA)
  const studentClasses = await request(baseUrl, studentJar, '/classes', { workspaceId: fixture.workspaceAId })
  assert.equal(studentClasses.status, 403, JSON.stringify(studentClasses.payload))
  assert.equal(studentClasses.payload.error.code, 'PERMISSION_DENIED')
})

test('PUT 可见范围拒绝无效 scope 与空班级列表，跨组织书籍按不存在处理', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl } = harness
  const book = await harness.createBook({ title: '参数校验书' })
  const adminJar = await login(baseUrl, fixture, fixture.userByRole.admin)

  const invalidScope = await setVisibility(baseUrl, adminJar, fixture.schoolWorkspaceId, book.bookId, { scope: 'grade' })
  assert.equal(invalidScope.status, 422, JSON.stringify(invalidScope.payload))
  assert.equal(invalidScope.payload.error.code, 'VALIDATION_FAILED')

  const emptyClasses = await setVisibility(baseUrl, adminJar, fixture.schoolWorkspaceId, book.bookId, {
    scope: 'classes',
    classIds: [],
  })
  assert.equal(emptyClasses.status, 422, JSON.stringify(emptyClasses.payload))

  const missingBook = await setVisibility(baseUrl, adminJar, fixture.schoolWorkspaceId, `missing-${randomUUID()}`, {
    scope: 'organization',
  })
  assert.equal(missingBook.status, 404, JSON.stringify(missingBook.payload))
  assert.equal(missingBook.payload.error.code, 'RESOURCE_NOT_FOUND')
})
