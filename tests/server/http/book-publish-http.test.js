import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { hashPassword } from '../../../server/auth/password.js'
import { createReadmateApplication } from '../../../server/app.js'
import { createReadingDomain } from '../../../server/domains/reading/catalog.js'
import { workspaceResourceScope } from '../../../server/integration/context.js'

function identityFixture() {
  const suffix = randomUUID()
  const organizationId = `organization-${suffix}`
  const foreignOrganizationId = `foreign-organization-${suffix}`
  const classId = `class-${suffix}`
  const gradeId = `grade-${suffix}`
  const workspaceId = `workspace-${suffix}`
  const studentId = `student-${suffix}`
  const teacherId = `teacher-${suffix}`
  const adminId = `admin-${suffix}`
  const foreignAdminId = `foreign-admin-${suffix}`
  const password = randomBytes(24).toString('base64url')
  const passwordHash = hashPassword(password)
  const users = [
    { id: studentId, username: `student-${suffix}`, displayName: '发布权限学生', roleCode: 'student', scopeType: 'class', scopeId: classId },
    { id: teacherId, username: `teacher-${suffix}`, displayName: '发布权限教师', roleCode: 'teacher', scopeType: 'class', scopeId: classId },
    { id: adminId, username: `admin-${suffix}`, displayName: '发布权限管理员', roleCode: 'school_admin', scopeType: 'class', scopeId: classId },
  ]
  return {
    organizationId,
    foreignOrganizationId,
    classId,
    gradeId,
    workspaceId,
    studentId,
    teacherId,
    adminId,
    foreignAdminId,
    password,
    users,
    seed: {
      organizations: [
        { id: organizationId, name: '发布权限联调学校' },
        { id: foreignOrganizationId, name: '发布权限外校' },
      ],
      users: [
        ...users.map(({ id, username, displayName }) => ({ id, organizationId, username, displayName })),
        { id: foreignAdminId, organizationId: foreignOrganizationId, username: `foreign-${suffix}`, displayName: '外校管理员' },
      ],
      workspaces: [{
        id: workspaceId,
        organizationId,
        code: 'class-teacher',
        name: '发布权限联调班级',
        scopeType: 'class',
        scopeId: classId,
      }],
      workspaceMemberships: users.map(({ id }) => ({ id: randomUUID(), userId: id, workspaceId })),
      roleAssignments: users.map(({ id, roleCode, scopeType, scopeId }) => ({
        id: randomUUID(),
        organizationId,
        userId: id,
        workspaceId,
        roleCode,
        scopeType,
        scopeId,
      })),
      classes: [{ id: classId, organizationId, gradeId, name: '发布权限一班' }],
      classMemberships: [
        { id: randomUUID(), classId, userId: studentId, membershipRole: 'student' },
        { id: randomUUID(), classId, userId: teacherId, membershipRole: 'teacher' },
      ],
      credentials: [
        ...users.map(({ id }) => ({ id: randomUUID(), userId: id, passwordHash })),
        { id: randomUUID(), userId: foreignAdminId, passwordHash },
      ],
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

async function requestJson(baseUrl, jar, path, options = {}) {
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
  const payload = await response.json()
  return { status: response.status, payload }
}

async function login(baseUrl, fixture, user) {
  const jar = new Map()
  const response = await requestJson(baseUrl, jar, '/auth/login', {
    method: 'POST',
    idempotencyKey: `login-${user.id}`,
    body: { username: user.username, password: fixture.password },
  })
  assert.equal(response.status, 200, JSON.stringify(response.payload))
  return jar
}

function bookStatus(database, bookId) {
  return database.prepare('SELECT status, version FROM books WHERE id = ?').get(bookId)
}

function auditCount(database, eventType, resourceId) {
  return database.prepare(
    'SELECT COUNT(*) AS count FROM audit_events WHERE event_type = ? AND resource_id = ?',
  ).get(eventType, resourceId).count
}

function readingDomain(application, actorId, workspaceId, organizationId, extras = {}) {
  return createReadingDomain({
    db: application.database,
    actor: { id: actorId },
    workspace: { id: workspaceId, organizationId },
    authorize: async () => true,
    audit: async () => undefined,
    assetMetadataVerifier: extras.assetMetadataVerifier,
    idFactory: randomUUID,
    now: () => new Date(),
  })
}

function textPages() {
  return [{
    pageNo: 1,
    width: 1024,
    height: 768,
    textContent: '发布权限测试书页',
    blocks: [{
      blockKey: 'page-1-paragraph-1',
      paragraphId: 'paragraph-1',
      textContent: '发布权限测试书页',
      charStart: 0,
      charEnd: 8,
      x: 80,
      y: 100,
      width: 760,
      height: 120,
    }],
  }]
}

async function createTextBook(application, fixture, { published = true, organizationId, actorId, workspaceId } = {}) {
  const reading = readingDomain(
    application,
    actorId || fixture.adminId,
    workspaceId || fixture.workspaceId,
    organizationId || fixture.organizationId,
  )
  const created = await reading.createBookVersion({
    title: published ? '已发布测试书' : '草稿测试书',
    label: `text-${randomUUID()}`,
    sourceFormat: 'text',
    pages: textPages(),
  })
  if (published) await reading.publishBook(created.bookId)
  return created
}

async function createTrustedBaselineBook(application, fixture, sourcePdf, { published = false } = {}) {
  const reading = readingDomain(
    application,
    fixture.adminId,
    fixture.workspaceId,
    fixture.organizationId,
    {
      assetMetadataVerifier: async ({ storageKey }) => {
        if (storageKey !== sourcePdf.storageKey) throw new Error('未登记的测试资产键')
        return sourcePdf
      },
    },
  )
  const created = await reading.createBookVersion({
    title: '可信基线往返测试书',
    label: `trusted-${randomUUID()}`,
    sourceFormat: 'pdf',
    packageMetadata: {
      format: 'book-package/v2',
      releaseSha256: 'b'.repeat(64),
      normalizationVersion: 'raw-exact-ledger-v1',
      qualityStatus: 'trusted-baseline',
      provenance: { manifestSha256: 'b'.repeat(64) },
    },
    assets: [{ ...sourcePdf, assetType: 'source_pdf' }],
    pages: [{
      pageNo: 1,
      width: 468,
      height: 671,
      textContent: '可信基线正文',
      blocks: [],
    }],
  })
  if (published) await reading.publishBook(created.bookId)
  return created
}

async function startHarness(t) {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-book-publish-http-'))
  const databasePath = join(directory, 'book-publish.sqlite')
  const publicAssetDirectory = join(directory, 'public')
  const sourcePdf = {
    storageKey: 'books/publish-http/source.pdf',
    usageLabel: 'INTERNAL PILOT ONLY',
    mimeType: 'application/pdf',
    bytes: Buffer.from('%PDF-1.4\nD10-book-publish-http-source-pdf\n%%EOF\n'),
  }
  sourcePdf.sizeBytes = sourcePdf.bytes.length
  sourcePdf.sha256 = createHash('sha256').update(sourcePdf.bytes).digest('hex')
  mkdirSync(join(publicAssetDirectory, 'books', 'publish-http'), { recursive: true })
  writeFileSync(join(publicAssetDirectory, sourcePdf.storageKey), sourcePdf.bytes)
  const fixture = identityFixture()
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
  return {
    application,
    fixture,
    sourcePdf,
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
  }
}

test('workspaceResourceScope 为 class 工作空间带上 classId，供 scopeAllows 比对', () => {
  const ownerId = 'teacher-1'
  const workspace = {
    scopeType: 'class',
    scopeId: 'class-1',
    organizationId: 'org-1',
  }
  assert.deepEqual(workspaceResourceScope(workspace, ownerId), {
    type: 'class',
    id: 'class-1',
    scopeType: 'class',
    scopeId: 'class-1',
    organizationId: 'org-1',
    ownerId,
    classId: 'class-1',
  })
})

test('学生带合法会话和工作空间头调用发布/下架必须 403', async (t) => {
  const { application, fixture, baseUrl } = await startHarness(t)
  const published = await createTextBook(application, fixture, { published: true })
  const student = fixture.users.find((user) => user.id === fixture.studentId)
  const jar = await login(baseUrl, fixture, student)

  const publish = await requestJson(baseUrl, jar, `/books/${published.bookId}/publish`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: `student-publish-${published.bookId}`,
    body: {},
  })
  assert.equal(publish.status, 403, JSON.stringify(publish.payload))
  assert.equal(publish.payload.error.code, 'PERMISSION_DENIED')
  assert.equal(bookStatus(application.database, published.bookId).status, 'published')

  const unpublish = await requestJson(baseUrl, jar, `/books/${published.bookId}/unpublish`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: `student-unpublish-${published.bookId}`,
    body: {},
  })
  assert.equal(unpublish.status, 403, JSON.stringify(unpublish.payload))
  assert.equal(unpublish.payload.error.code, 'PERMISSION_DENIED')
  assert.equal(bookStatus(application.database, published.bookId).status, 'published')
})

test('class 范围教师经真实 HTTP 发布和下架，并写入审计', async (t) => {
  const { application, fixture, baseUrl } = await startHarness(t)
  const published = await createTextBook(application, fixture, { published: true })
  const draft = await createTextBook(application, fixture, { published: false })
  const teacher = fixture.users.find((user) => user.id === fixture.teacherId)
  const jar = await login(baseUrl, fixture, teacher)

  const unpublished = await requestJson(baseUrl, jar, `/books/${published.bookId}/unpublish`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: `teacher-unpublish-${published.bookId}`,
    body: {},
  })
  assert.equal(unpublished.status, 200, JSON.stringify(unpublished.payload))
  assert.equal(unpublished.payload.data.bookId, published.bookId)
  assert.equal(unpublished.payload.data.status, 'draft')
  assert.equal(bookStatus(application.database, published.bookId).status, 'draft')
  assert.equal(auditCount(application.database, 'book.unpublished', published.bookId), 1)

  const republished = await requestJson(baseUrl, jar, `/books/${published.bookId}/publish`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: `teacher-publish-${published.bookId}`,
    body: {},
  })
  assert.equal(republished.status, 200, JSON.stringify(republished.payload))
  assert.equal(republished.payload.data.status, 'published')
  assert.equal(bookStatus(application.database, published.bookId).status, 'published')
  assert.equal(auditCount(application.database, 'book.published', published.bookId), 1)

  const firstPublish = await requestJson(baseUrl, jar, `/books/${draft.bookId}/publish`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: `teacher-publish-${draft.bookId}`,
    body: {},
  })
  assert.equal(firstPublish.status, 200, JSON.stringify(firstPublish.payload))
  assert.equal(bookStatus(application.database, draft.bookId).status, 'published')
})

test('发布接口要求幂等键，重放不二次变更也不二次审计', async (t) => {
  const { application, fixture, baseUrl } = await startHarness(t)
  const draft = await createTextBook(application, fixture, { published: false })
  const teacher = fixture.users.find((user) => user.id === fixture.teacherId)
  const jar = await login(baseUrl, fixture, teacher)

  const missingKey = await requestJson(baseUrl, jar, `/books/${draft.bookId}/publish`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    body: {},
  })
  assert.equal(missingKey.status, 400, JSON.stringify(missingKey.payload))
  assert.equal(missingKey.payload.error.code, 'VALIDATION_FAILED')
  assert.equal(bookStatus(application.database, draft.bookId).status, 'draft')

  const missingUnpublishKey = await requestJson(baseUrl, jar, `/books/${draft.bookId}/unpublish`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    body: {},
  })
  assert.equal(missingUnpublishKey.status, 400, JSON.stringify(missingUnpublishKey.payload))
  assert.equal(missingUnpublishKey.payload.error.code, 'VALIDATION_FAILED')

  const key = `publish-once-${draft.bookId}`
  const first = await requestJson(baseUrl, jar, `/books/${draft.bookId}/publish`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: key,
    body: {},
  })
  assert.equal(first.status, 200, JSON.stringify(first.payload))
  assert.equal(first.payload.meta.replayed, undefined)
  const afterFirst = bookStatus(application.database, draft.bookId)
  assert.equal(afterFirst.status, 'published')
  assert.equal(auditCount(application.database, 'book.published', draft.bookId), 1)

  const replay = await requestJson(baseUrl, jar, `/books/${draft.bookId}/publish`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: key,
    body: {},
  })
  assert.equal(replay.status, 200, JSON.stringify(replay.payload))
  assert.equal(replay.payload.meta.replayed, true)
  const afterReplay = bookStatus(application.database, draft.bookId)
  assert.equal(afterReplay.status, 'published')
  assert.equal(afterReplay.version, afterFirst.version)
  assert.equal(auditCount(application.database, 'book.published', draft.bookId), 1)
})

test('trusted-baseline v2 包经真实 HTTP 下架后再发布能通过质量闸门', async (t) => {
  const { application, fixture, baseUrl, sourcePdf } = await startHarness(t)
  const created = await createTrustedBaselineBook(application, fixture, sourcePdf, { published: true })
  assert.equal(bookStatus(application.database, created.bookId).status, 'published')
  const version = application.database.prepare(
    'SELECT package_format, package_quality_status FROM book_versions WHERE book_id = ?',
  ).get(created.bookId)
  assert.equal(version.package_format, 'book-package/v2')
  assert.equal(version.package_quality_status, 'trusted-baseline')

  const teacher = fixture.users.find((user) => user.id === fixture.teacherId)
  const jar = await login(baseUrl, fixture, teacher)

  const unpublished = await requestJson(baseUrl, jar, `/books/${created.bookId}/unpublish`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: `roundtrip-unpublish-${created.bookId}`,
    body: {},
  })
  assert.equal(unpublished.status, 200, JSON.stringify(unpublished.payload))
  assert.equal(bookStatus(application.database, created.bookId).status, 'draft')

  const republished = await requestJson(baseUrl, jar, `/books/${created.bookId}/publish`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: `roundtrip-publish-${created.bookId}`,
    body: {},
  })
  assert.equal(republished.status, 200, JSON.stringify(republished.payload))
  assert.notEqual(republished.payload.error?.code, 'HUMAN_REVIEW_REQUIRED', JSON.stringify(republished.payload))
  assert.equal(republished.payload.data.status, 'published')
  assert.equal(bookStatus(application.database, created.bookId).status, 'published')
  assert.equal(auditCount(application.database, 'book.unpublished', created.bookId), 1)
  assert.equal(auditCount(application.database, 'book.published', created.bookId), 1)
})

test('跨组织发布返回 404，对草稿下架也返回 404', async (t) => {
  const { application, fixture, baseUrl } = await startHarness(t)
  const foreignDraft = await createTextBook(application, fixture, {
    published: false,
    organizationId: fixture.foreignOrganizationId,
    actorId: fixture.foreignAdminId,
    workspaceId: fixture.workspaceId,
  })
  const localDraft = await createTextBook(application, fixture, { published: false })
  const teacher = fixture.users.find((user) => user.id === fixture.teacherId)
  const jar = await login(baseUrl, fixture, teacher)

  const crossOrg = await requestJson(baseUrl, jar, `/books/${foreignDraft.bookId}/publish`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: `cross-org-publish-${foreignDraft.bookId}`,
    body: {},
  })
  assert.equal(crossOrg.status, 404, JSON.stringify(crossOrg.payload))
  assert.equal(crossOrg.payload.error.code, 'RESOURCE_NOT_FOUND')
  assert.equal(bookStatus(application.database, foreignDraft.bookId).status, 'draft')

  const draftUnpublish = await requestJson(baseUrl, jar, `/books/${localDraft.bookId}/unpublish`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: `draft-unpublish-${localDraft.bookId}`,
    body: {},
  })
  assert.equal(draftUnpublish.status, 404, JSON.stringify(draftUnpublish.payload))
  assert.equal(draftUnpublish.payload.error.code, 'RESOURCE_NOT_FOUND')
  assert.equal(bookStatus(application.database, localDraft.bookId).status, 'draft')
})
