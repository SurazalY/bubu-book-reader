import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { hashPassword } from '../../../server/auth/password.js'
import { createReadmateApplication } from '../../../server/app.js'
import { grantBookToClass, loginBody } from '../helpers/phase8-old-fixture.js'
import { createReadingDomain } from '../../../server/domains/reading/catalog.js'

function identityFixture() {
  const suffix = randomUUID()
  const organizationId = `organization-${suffix}`
  const classId = `class-${suffix}`
  const gradeId = `grade-${suffix}`
  const workspaceId = `workspace-${suffix}`
  const studentId = `student-${suffix}`
  const adminId = `admin-${suffix}`
  const password = randomBytes(24).toString('base64url')
  const passwordHash = hashPassword(password)
  const users = [
    { id: studentId, username: `student-${suffix}`, displayName: '缓存守卫学生', roleCode: 'student', scopeType: 'class', scopeId: classId },
    { id: adminId, username: `admin-${suffix}`, displayName: '缓存守卫管理员', roleCode: 'school_admin', scopeType: 'class', scopeId: classId },
  ]
  return {
    organizationId,
    schoolCode: organizationId,
    classId,
    gradeId,
    workspaceId,
    studentId,
    adminId,
    password,
    users,
    seed: {
      organizations: [{ id: organizationId, name: '缓存守卫联调学校' }],
      users: users.map(({ id, username, displayName }) => ({ id, organizationId, username, displayName })),
      workspaces: [{
        id: workspaceId,
        organizationId,
        code: 'class-teacher',
        name: '缓存守卫联调班级',
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
      classes: [{ id: classId, organizationId, gradeId, name: '缓存守卫一班' }],
      classMemberships: [
        { id: randomUUID(), classId, userId: studentId, membershipRole: 'student' },
        { id: randomUUID(), classId, userId: adminId, membershipRole: 'teacher' },
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

function cookieHeader(jar) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
}

async function requestJson(baseUrl, jar, path, options = {}) {
  const headers = new Headers(options.headers)
  if (jar.size) headers.set('Cookie', cookieHeader(jar))
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
    body: loginBody(fixture, user),
  })
  assert.equal(response.status, 200, JSON.stringify(response.payload))
  return jar
}

function makeAsset(storageKey, mimeType, bytes, extra = {}) {
  return {
    storageKey,
    usageLabel: 'asset-cache-guard',
    mimeType,
    bytes,
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    ...extra,
  }
}

async function startHarness(t) {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-asset-cache-'))
  const databasePath = join(directory, 'asset-cache.sqlite')
  const publicAssetDirectory = join(directory, 'public')
  const cover = makeAsset(
    'books/asset-cache/cover.jpg',
    'image/jpeg',
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
    { width: 80, height: 100 },
  )
  const sourcePdf = makeAsset(
    'books/asset-cache/source.pdf',
    'application/pdf',
    Buffer.from('%PDF-1.4\nD10-asset-cache-source-pdf-fixture-bytes\n%%EOF\n'),
  )
  const sourceText = makeAsset(
    'books/asset-cache/source.txt',
    'text/plain',
    Buffer.from('D10-asset-cache-source-text-fixture'),
  )
  mkdirSync(join(publicAssetDirectory, 'books', 'asset-cache'), { recursive: true })
  writeFileSync(join(publicAssetDirectory, cover.storageKey), cover.bytes)
  writeFileSync(join(publicAssetDirectory, sourcePdf.storageKey), sourcePdf.bytes)
  writeFileSync(join(publicAssetDirectory, sourceText.storageKey), sourceText.bytes)
  const assetsByKey = new Map([
    [cover.storageKey, cover],
    [sourcePdf.storageKey, sourcePdf],
    [sourceText.storageKey, sourceText],
  ])
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
    title: '缓存守卫测试书',
    label: 'asset-cache-v1',
    sourceFormat: 'pdf',
    assets: [
      { ...sourcePdf, assetType: 'source_pdf' },
      { ...cover, assetType: 'cover' },
      { ...sourceText, assetType: 'source_text' },
    ],
    pages: [{
      pageNo: 1,
      width: 1024,
      height: 768,
      textContent: '缓存守卫书页',
      blocks: [],
    }],
  })
  await reading.publishBook(created.bookId)
  grantBookToClass(application.database, {
    bookId: created.bookId,
    classId: fixture.classId,
    organizationId: fixture.organizationId,
    actorId: fixture.adminId,
    bookVersionId: created.versionId,
  })
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
    cover,
    sourcePdf,
    sourceText,
    book: created,
    origin: `http://127.0.0.1:${server.address().port}`,
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
    databasePath,
  }
}

async function fetchAsset(origin, jar, url, extraHeaders = {}) {
  const headers = {
    Cookie: cookieHeader(jar),
    ...extraHeaders,
  }
  return fetch(`${origin}${url}`, { headers })
}

test('受保护书籍资产按类型设置缓存头，并在真实 HTTP 链路上处理条件请求', async (t) => {
  const harness = await startHarness(t)
  assert.match(harness.databasePath, /asset-cache\.sqlite$/)
  assert.notEqual(harness.databasePath.includes('server\\data\\readmate.sqlite')
    || harness.databasePath.includes('server/data/readmate.sqlite'), true)

  const student = harness.fixture.users.find((user) => user.id === harness.fixture.studentId)
  const studentJar = await login(harness.baseUrl, harness.fixture, student)
  const books = await requestJson(harness.baseUrl, studentJar, '/books', { workspaceId: harness.fixture.workspaceId })
  assert.equal(books.status, 200, JSON.stringify(books.payload))
  const coverAsset = books.payload.data.items[0].assets.find((asset) => asset.kind === 'cover')
  const pdfAsset = books.payload.data.items[0].assets.find((asset) => asset.kind === 'source_pdf')
  const textAsset = books.payload.data.items[0].assets.find((asset) => asset.kind === 'source_text')
  assert.ok(coverAsset, '应登记封面资产')
  assert.ok(pdfAsset, '应登记源 PDF 资产')
  assert.ok(textAsset, '应登记源文本资产')
  const workspaceHeader = { 'X-Workspace-Id': harness.fixture.workspaceId }
  const expectedPdfEtag = `"${harness.sourcePdf.sha256}"`
  const expectedTextEtag = `"${harness.sourceText.sha256}"`

  await t.test('封面 Cache-Control 含 no-store 且不含 max-age=3600', async () => {
    const response = await fetchAsset(harness.origin, studentJar, coverAsset.url, workspaceHeader)
    assert.equal(response.status, 200)
    const cacheControl = response.headers.get('cache-control') || ''
    assert.match(cacheControl, /no-store/)
    assert.doesNotMatch(cacheControl, /max-age=3600/)
    await response.arrayBuffer()
  })

  await t.test('源 PDF Cache-Control 含 no-cache 且带非空 ETag', async () => {
    const response = await fetchAsset(harness.origin, studentJar, pdfAsset.url, workspaceHeader)
    assert.equal(response.status, 200)
    const cacheControl = response.headers.get('cache-control') || ''
    assert.match(cacheControl, /no-cache/)
    const etag = response.headers.get('etag')
    assert.ok(etag && etag.length > 0)
    assert.equal(etag, expectedPdfEtag)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), harness.sourcePdf.bytes)
  })

  await t.test('源 PDF 匹配 If-None-Match 返回 304 且无响应体', async () => {
    const response = await fetchAsset(harness.origin, studentJar, pdfAsset.url, {
      ...workspaceHeader,
      'If-None-Match': expectedPdfEtag,
    })
    assert.equal(response.status, 304)
    assert.equal(response.headers.get('etag'), expectedPdfEtag)
    assert.match(response.headers.get('cache-control') || '', /no-cache/)
    assert.equal(Buffer.from(await response.arrayBuffer()).length, 0)
  })

  await t.test('源 PDF 不匹配 If-None-Match 返回 200 完整内容', async () => {
    const response = await fetchAsset(harness.origin, studentJar, pdfAsset.url, {
      ...workspaceHeader,
      'If-None-Match': `"${'0'.repeat(64)}"`,
    })
    assert.equal(response.status, 200)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), harness.sourcePdf.bytes)
  })

  await t.test('Range 请求仍返回 206 且 Content-Range 正确', async () => {
    const response = await fetchAsset(harness.origin, studentJar, pdfAsset.url, {
      ...workspaceHeader,
      Range: 'bytes=0-5',
    })
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('content-range'), `bytes 0-5/${harness.sourcePdf.sizeBytes}`)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), harness.sourcePdf.bytes.subarray(0, 6))
  })

  await t.test('Range 加匹配 If-None-Match 返回 304 而不是 206', async () => {
    const response = await fetchAsset(harness.origin, studentJar, pdfAsset.url, {
      ...workspaceHeader,
      Range: 'bytes=0-5',
      'If-None-Match': expectedPdfEtag,
    })
    assert.equal(response.status, 304)
    assert.notEqual(response.status, 206)
    assert.equal(Buffer.from(await response.arrayBuffer()).length, 0)
  })

  await t.test('缺 X-Workspace-Id 仍返回 400', async () => {
    const response = await fetchAsset(harness.origin, studentJar, pdfAsset.url)
    assert.equal(response.status, 400)
    const payload = await response.json()
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
  })

  await t.test('完全未登录仍返回 401', async () => {
    const response = await fetch(`${harness.origin}${pdfAsset.url}`)
    assert.equal(response.status, 401)
    const payload = await response.json()
    assert.equal(payload.error.code, 'AUTH_REQUIRED')
  })

  // 锁死 fail-safe 默认：未单独枚举的类型不得再回落到 max-age（D-10 原缺陷）。
  await t.test('未枚举类型默认 no-cache+ETag，禁止把默认分支改回 max-age', async () => {
    const response = await fetchAsset(harness.origin, studentJar, textAsset.url, workspaceHeader)
    assert.equal(response.status, 200)
    const cacheControl = response.headers.get('cache-control') || ''
    assert.match(cacheControl, /no-cache/)
    assert.doesNotMatch(cacheControl, /max-age/)
    const etag = response.headers.get('etag')
    assert.ok(etag && etag.length > 0)
    assert.equal(etag, expectedTextEtag)
    await response.arrayBuffer()

    const revalidated = await fetchAsset(harness.origin, studentJar, textAsset.url, {
      ...workspaceHeader,
      'If-None-Match': expectedTextEtag,
    })
    assert.equal(revalidated.status, 304)
    assert.equal(revalidated.headers.get('etag'), expectedTextEtag)
    assert.equal(Buffer.from(await revalidated.arrayBuffer()).length, 0)
  })
})
