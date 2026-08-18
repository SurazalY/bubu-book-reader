import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { hashPassword } from '../../../server/auth/password.js'
import { createReadmateApplication } from '../../../server/app.js'
import { createReadingDomain } from '../../../server/domains/reading/catalog.js'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const BUSINESS_DB = join(REPO_ROOT, 'server', 'data', 'readmate.sqlite')
const EXPECTED_COLUMNS = Object.freeze([
  'organization_id',
  'user_id',
  'book_version_id',
  'mode',
  'updated_at',
])

function identityFixture() {
  const suffix = randomUUID()
  const organizationId = `organization-${suffix}`
  const classId = `class-${suffix}`
  const gradeId = `grade-${suffix}`
  const workspaceId = `workspace-${suffix}`
  const studentId = `student-${suffix}`
  const peerStudentId = `peer-student-${suffix}`
  const teacherId = `teacher-${suffix}`
  const adminId = `admin-${suffix}`
  const password = randomBytes(24).toString('base64url')
  const passwordHash = hashPassword(password)
  const users = [
    { id: studentId, username: `student-${suffix}`, displayName: '偏好学生甲', roleCode: 'student', scopeType: 'class', scopeId: classId },
    { id: peerStudentId, username: `peer-${suffix}`, displayName: '偏好学生乙', roleCode: 'student', scopeType: 'class', scopeId: classId },
    { id: teacherId, username: `teacher-${suffix}`, displayName: '偏好教师', roleCode: 'teacher', scopeType: 'class', scopeId: classId },
    { id: adminId, username: `admin-${suffix}`, displayName: '偏好管理员', roleCode: 'school_admin', scopeType: 'class', scopeId: classId },
  ]
  return {
    organizationId,
    classId,
    gradeId,
    workspaceId,
    studentId,
    peerStudentId,
    teacherId,
    adminId,
    password,
    users,
    seed: {
      organizations: [{ id: organizationId, name: '偏好测试学校' }],
      users: users.map(({ id, username, displayName }) => ({ id, organizationId, username, displayName })),
      workspaces: [{
        id: workspaceId,
        organizationId,
        code: 'class-teacher',
        name: '偏好测试班级',
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
      classes: [{ id: classId, organizationId, gradeId, name: '偏好测试一班' }],
      classMemberships: [
        { id: randomUUID(), classId, userId: studentId, membershipRole: 'student' },
        { id: randomUUID(), classId, userId: peerStudentId, membershipRole: 'student' },
        { id: randomUUID(), classId, userId: teacherId, membershipRole: 'teacher' },
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

function makeAsset(storageKey, mimeType, bytes, extra = {}) {
  return {
    storageKey,
    usageLabel: 'reader-preference-http',
    mimeType,
    bytes,
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    ...extra,
  }
}

async function startHarness(t) {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-reader-preference-'))
  const databasePath = join(directory, 'reader-preference.sqlite')
  const publicAssetDirectory = join(directory, 'public')
  const sourcePdf = makeAsset(
    'books/reader-preference/source.pdf',
    'application/pdf',
    Buffer.from('%PDF-1.4\nreader-preference\n%%EOF\n'),
  )
  mkdirSync(join(publicAssetDirectory, 'books', 'reader-preference'), { recursive: true })
  writeFileSync(join(publicAssetDirectory, sourcePdf.storageKey), sourcePdf.bytes)
  const assetsByKey = new Map([[sourcePdf.storageKey, sourcePdf]])
  const fixture = identityFixture()
  const application = createReadmateApplication({
    databasePath,
    sessionSecret: randomBytes(48).toString('base64url'),
    cookieSecure: false,
    serveStatic: false,
    publicAssetDirectory,
  })
  application.identity.service.importSeed(fixture.seed)
  const reading = createReadingDomain({
    db: application.database,
    actor: { id: fixture.adminId },
    workspace: { id: fixture.workspaceId, organizationId: fixture.organizationId },
    authorize: async () => true,
    audit: async () => undefined,
    assetMetadataVerifier: async ({ storageKey }) => {
      const asset = assetsByKey.get(storageKey)
      if (!asset) throw new Error('未登记的测试资产键')
      return asset
    },
    idFactory: randomUUID,
    now: () => new Date(),
  })
  const created = await reading.createBookVersion({
    title: '偏好测试书',
    label: `reader-preference-${randomUUID()}`,
    sourceFormat: 'pdf',
    catalogGrade: 3,
    metadata: {
      author: '偏好作者',
      illustrator: '偏好绘者',
      sourcePage: 'https://example.test/reader-preference',
      usageLabel: 'catalog-usage',
      rights: { note: 'reader-preference-http' },
    },
    assets: [{ ...sourcePdf, assetType: 'source_pdf' }],
    pages: [{
      pageNo: 1,
      width: 1024,
      height: 768,
      textContent: '偏好测试书页',
      blocks: [],
    }],
  })
  await reading.publishBook(created.bookId)
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
    book: created,
    databasePath,
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
  }
}

function findBook(items, bookId) {
  return items.find((item) => item.id === bookId) || items[0]
}

test('新表 reader_mode_preferences 只有契约五列，且未占用 030', async (t) => {
  const harness = await startHarness(t)
  assert.notEqual(harness.databasePath, BUSINESS_DB)
  const columns = harness.application.database
    .prepare('PRAGMA table_info(reader_mode_preferences)')
    .all()
    .map((row) => row.name)
  assert.deepEqual(columns, [...EXPECTED_COLUMNS])
  const applied = harness.application.database
    .prepare('SELECT id FROM schema_migrations WHERE id LIKE ?')
    .all('030%')
    .map((row) => row.id)
  assert.equal(applied.includes('030_community_reports_delivery.sql'), true)
  assert.equal(applied.some((id) => id.startsWith('030_reader')), false)
  const created = harness.application.database
    .prepare('SELECT id FROM schema_migrations WHERE id = ?')
    .get('046_reader_mode_preferences.sql')
  assert.ok(created)
})

test('无偏好时 GET /books 带 preferredReaderMode=null，且不塞进 progress', async (t) => {
  const harness = await startHarness(t)
  const student = harness.fixture.users.find((user) => user.id === harness.fixture.studentId)
  const jar = await login(harness.baseUrl, harness.fixture, student)
  const books = await requestJson(harness.baseUrl, jar, '/books', {
    workspaceId: harness.fixture.workspaceId,
  })
  assert.equal(books.status, 200, JSON.stringify(books.payload))
  const item = findBook(books.payload?.data?.items, harness.book.bookId)
  assert.equal(Object.hasOwn(item, 'preferredReaderMode'), true)
  assert.equal(item.preferredReaderMode, null)
  assert.equal(Object.hasOwn(item, 'readerMode'), false)
  assert.equal(Object.hasOwn(item.progress, 'preferredReaderMode'), false)
  assert.equal(Object.hasOwn(item.progress, 'mode'), false)
  assert.equal(Object.hasOwn(item.progress, 'percent'), false)
  assert.equal(Object.hasOwn(item.progress, 'finished'), false)
})

test('学生 PUT 偏好后刷新 GET /books 仍带本人偏好，且不能写别人的行', async (t) => {
  const harness = await startHarness(t)
  const student = harness.fixture.users.find((user) => user.id === harness.fixture.studentId)
  const peer = harness.fixture.users.find((user) => user.id === harness.fixture.peerStudentId)
  const teacher = harness.fixture.users.find((user) => user.id === harness.fixture.teacherId)
  const studentJar = await login(harness.baseUrl, harness.fixture, student)
  const peerJar = await login(harness.baseUrl, harness.fixture, peer)
  const teacherJar = await login(harness.baseUrl, harness.fixture, teacher)

  const missingKey = await requestJson(harness.baseUrl, studentJar, '/reading/reader-preference', {
    method: 'PUT',
    workspaceId: harness.fixture.workspaceId,
    body: { bookVersionId: harness.book.versionId, mode: 'text' },
  })
  assert.equal(missingKey.status, 400, JSON.stringify(missingKey.payload))

  const invalidMode = await requestJson(harness.baseUrl, studentJar, '/reading/reader-preference', {
    method: 'PUT',
    workspaceId: harness.fixture.workspaceId,
    idempotencyKey: `pref-invalid-${randomUUID()}`,
    body: { bookVersionId: harness.book.versionId, mode: 'pdf' },
  })
  assert.equal(invalidMode.status, 422, JSON.stringify(invalidMode.payload))

  const teacherWrite = await requestJson(harness.baseUrl, teacherJar, '/reading/reader-preference', {
    method: 'PUT',
    workspaceId: harness.fixture.workspaceId,
    idempotencyKey: `pref-teacher-${randomUUID()}`,
    body: { bookVersionId: harness.book.versionId, mode: 'text' },
  })
  assert.equal(teacherWrite.status, 403, JSON.stringify(teacherWrite.payload))

  const written = await requestJson(harness.baseUrl, studentJar, '/reading/reader-preference', {
    method: 'PUT',
    workspaceId: harness.fixture.workspaceId,
    idempotencyKey: `pref-self-${randomUUID()}`,
    body: {
      bookVersionId: harness.book.versionId,
      mode: 'text',
      userId: harness.fixture.peerStudentId,
      user: harness.fixture.peerStudentId,
    },
  })
  assert.equal(written.status, 200, JSON.stringify(written.payload))
  assert.equal(written.payload.data.userId, harness.fixture.studentId)
  assert.equal(written.payload.data.mode, 'text')
  assert.equal(written.payload.data.bookVersionId, harness.book.versionId)

  const row = harness.application.database.prepare(`
    SELECT user_id, mode FROM reader_mode_preferences WHERE book_version_id = ?
  `).all(harness.book.versionId)
  assert.equal(row.length, 1)
  assert.equal(row[0].user_id, harness.fixture.studentId)
  assert.equal(row[0].mode, 'text')

  const refreshed = await requestJson(harness.baseUrl, studentJar, '/books', {
    workspaceId: harness.fixture.workspaceId,
  })
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.payload))
  const ownBook = findBook(refreshed.payload.data.items, harness.book.bookId)
  assert.equal(ownBook.preferredReaderMode, 'text')
  assert.equal(Object.hasOwn(ownBook.progress, 'preferredReaderMode'), false)

  const peerBooks = await requestJson(harness.baseUrl, peerJar, '/books', {
    workspaceId: harness.fixture.workspaceId,
  })
  assert.equal(peerBooks.status, 200, JSON.stringify(peerBooks.payload))
  assert.equal(findBook(peerBooks.payload.data.items, harness.book.bookId).preferredReaderMode, null)
})
