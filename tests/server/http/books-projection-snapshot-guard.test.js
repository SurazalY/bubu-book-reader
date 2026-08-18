/**
 * T5.1 独立守卫：冻住当前 GET /books 投影，以及计时摘要表 / DTO。
 * 只写测试，实施方不得改本文件。
 *
 * 冻结规则（投影，允许 T5.1 新增字段）：
 * 1. FROZEN_BOOK_KEYS 来自对本仓库当前实现的真实 HTTP 实测，不是猜的。
 * 2. 缺 key / 改名 / 消失 → 红。
 * 3. 新增 key → 不红。每个冻结 key 必须 Object.hasOwn；禁止 deepEqual(Object.keys)。
 * 4. 已有字段记录允许的 JS 类型（含 null）。类型集合变窄，或变成另一种非 null 类型 → 红。
 *    「现在是 null」不冻成「必须永远 null」。
 * 5. 嵌套对象冻已有 key，同样允许新增、禁止缺失。
 * 6. 学生 GET /books 必须 200 且至少 1 本书。被断言的读路径不注入 authorize: () => true。
 *
 * 计时三表是冻结契约：列消失 / 改名 / 改 type / 改 notnull / 改 pk / 新增列 → 红。
 * T5.1 不得往这三张表上加 reader_mode。
 */
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { hashPassword } from '../../../server/auth/password.js'
import { createReadmateApplication } from '../../../server/app.js'
import { createReadingDomain } from '../../../server/domains/reading/catalog.js'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const BUSINESS_DB = join(REPO_ROOT, 'server', 'data', 'readmate.sqlite')

// 2026-08-18 对当前实现两次 HTTP 实测得到的顶层 key（有封面书 / 无封面文本书一致）。
const FROZEN_BOOK_KEYS = Object.freeze([
  'id',
  'versionId',
  'title',
  'grade',
  'author',
  'illustrator',
  'sourcePage',
  'usageLabel',
  'cover',
  'assets',
  'progress',
  'access',
  'lists',
  'classReading',
])

// 允许集合含 null 的字段，都在 HTTP 上测到过 null 与非 null（classReading 的 object 见源码注释）。
const FROZEN_BOOK_KEY_TYPES = Object.freeze({
  id: Object.freeze(['string']),
  versionId: Object.freeze(['string']),
  title: Object.freeze(['string']),
  grade: Object.freeze(['number', 'null']),
  author: Object.freeze(['string', 'null']),
  illustrator: Object.freeze(['string', 'null']),
  sourcePage: Object.freeze(['string', 'null']),
  usageLabel: Object.freeze(['string', 'null']),
  cover: Object.freeze(['object', 'null']),
  assets: Object.freeze(['array']),
  progress: Object.freeze(['object']),
  access: Object.freeze(['object']),
  lists: Object.freeze(['array']),
  classReading: Object.freeze(['object', 'null']),
})

const FROZEN_PROGRESS_KEYS = Object.freeze(['currentPage', 'totalPages', 'bookmarks'])
const FROZEN_PROGRESS_KEY_TYPES = Object.freeze({
  currentPage: Object.freeze(['number', 'null']),
  totalPages: Object.freeze(['number']),
  bookmarks: Object.freeze(['array']),
})
const FROZEN_PROGRESS_FORBIDDEN_KEYS = Object.freeze(['percent', 'effectiveMinutes', 'finished'])
const FROZEN_BOOK_FORBIDDEN_KEYS = Object.freeze(['finished'])

const FROZEN_ACCESS_KEYS = Object.freeze(['readable'])
const FROZEN_ACCESS_KEY_TYPES = Object.freeze({
  readable: Object.freeze(['boolean']),
})

const FROZEN_PUBLIC_ASSET_KEYS = Object.freeze(['id', 'kind', 'url', 'mimeType', 'sizeBytes', 'sha256'])
const FROZEN_PUBLIC_ASSET_KEY_TYPES = Object.freeze({
  id: Object.freeze(['string', 'null']),
  kind: Object.freeze(['string']),
  url: Object.freeze(['string']),
  mimeType: Object.freeze(['string']),
  sizeBytes: Object.freeze(['number']),
  sha256: Object.freeze(['string']),
})

// 主控口误写成「16 个」；列出的名字与 src/student/reading-monitor/summary.js 实测都是这 15 个。
const FROZEN_FINGERPRINT_FIELDS = Object.freeze([
  'schemaVersion',
  'sessionId',
  'revision',
  'leaseId',
  'bookVersionId',
  'statDate',
  'startedAt',
  'measuredThroughAt',
  'cumulativeEffectiveMs',
  'hadSkip',
  'hadReread',
  'lastPageNo',
  'pageCoverage',
  'endedAt',
  'endReason',
])

const READER_MODE_RE = /readerMode|reader_mode/

// 下列列快照来自临时库 PRAGMA table_info，不是手抄迁移文件。
const FROZEN_TABLE_COLUMNS = Object.freeze({
  reading_summary_sessions: Object.freeze([
    freezeColumn('id', 'TEXT', 0, 1),
    freezeColumn('organization_id_at_creation', 'TEXT', 1, 0),
    freezeColumn('actor_id_at_creation', 'TEXT', 1, 0),
    freezeColumn('workspace_id_at_creation', 'TEXT', 1, 0),
    freezeColumn('class_id_at_creation', 'TEXT', 1, 0),
    freezeColumn('device_id', 'TEXT', 1, 0),
    freezeColumn('book_version_id', 'TEXT', 1, 0),
    freezeColumn('lease_id_at_start', 'TEXT', 1, 0),
    freezeColumn('stat_date', 'TEXT', 1, 0),
    freezeColumn('started_at', 'TEXT', 1, 0),
    freezeColumn('latest_revision', 'INTEGER', 1, 0),
    freezeColumn('latest_fingerprint', 'TEXT', 1, 0),
    freezeColumn('revision_fingerprints_json', 'TEXT', 1, 0),
    freezeColumn('cumulative_effective_ms', 'INTEGER', 1, 0),
    freezeColumn('had_skip', 'INTEGER', 1, 0),
    freezeColumn('had_reread', 'INTEGER', 1, 0),
    freezeColumn('last_page_no', 'INTEGER', 1, 0),
    freezeColumn('measured_through_at', 'TEXT', 1, 0),
    freezeColumn('ended_at', 'TEXT', 0, 0),
    freezeColumn('end_reason', 'TEXT', 0, 0),
    freezeColumn('status', 'TEXT', 1, 0),
    freezeColumn('created_at', 'TEXT', 1, 0),
    freezeColumn('updated_at', 'TEXT', 1, 0),
    freezeColumn('version', 'INTEGER', 1, 0),
  ]),
  reading_daily_book_summaries: Object.freeze([
    freezeColumn('id', 'TEXT', 0, 1),
    freezeColumn('organization_id_at_creation', 'TEXT', 1, 0),
    freezeColumn('actor_id_at_creation', 'TEXT', 1, 0),
    freezeColumn('workspace_id_at_creation', 'TEXT', 1, 0),
    freezeColumn('class_id_at_creation', 'TEXT', 1, 0),
    freezeColumn('book_version_id', 'TEXT', 1, 0),
    freezeColumn('stat_date', 'TEXT', 1, 0),
    freezeColumn('effective_reading_ms', 'INTEGER', 1, 0),
    freezeColumn('had_skip', 'INTEGER', 1, 0),
    freezeColumn('had_reread', 'INTEGER', 1, 0),
    freezeColumn('last_read_at', 'TEXT', 0, 0),
    freezeColumn('last_page_no', 'INTEGER', 1, 0),
    freezeColumn('created_at', 'TEXT', 1, 0),
    freezeColumn('updated_at', 'TEXT', 1, 0),
    freezeColumn('version', 'INTEGER', 1, 0),
  ]),
  reading_progress: Object.freeze([
    freezeColumn('id', 'TEXT', 0, 1),
    freezeColumn('actor_id', 'TEXT', 1, 0),
    freezeColumn('workspace_id', 'TEXT', 1, 0),
    freezeColumn('book_version_id', 'TEXT', 1, 0),
    freezeColumn('last_page_no', 'INTEGER', 1, 0),
    freezeColumn('valid_reading_seconds', 'INTEGER', 1, 0),
    freezeColumn('updated_from_event_at', 'TEXT', 1, 0),
    freezeColumn('created_at', 'TEXT', 1, 0),
    freezeColumn('updated_at', 'TEXT', 1, 0),
    freezeColumn('version', 'INTEGER', 1, 0),
  ]),
})

function freezeColumn(name, type, notnull, pk) {
  return Object.freeze({ name, type, notnull, pk })
}

function jsType(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function assertFrozenKeysPresent(value, frozenKeys, label) {
  assert.equal(value !== null && typeof value === 'object' && !Array.isArray(value), true, `${label} 必须是普通对象`)
  for (const key of frozenKeys) {
    assert.equal(Object.hasOwn(value, key), true, `${label} 缺少冻结字段 ${key}`)
  }
}

function assertAllowedType(value, allowed, label) {
  const actual = jsType(value)
  assert.equal(
    allowed.includes(actual),
    true,
    `${label} 类型 ${actual} 不在允许集合 [${allowed.join(', ')}]`,
  )
}

function assertPublicAssetShape(asset, label) {
  assertFrozenKeysPresent(asset, FROZEN_PUBLIC_ASSET_KEYS, label)
  for (const key of FROZEN_PUBLIC_ASSET_KEYS) {
    assertAllowedType(asset[key], FROZEN_PUBLIC_ASSET_KEY_TYPES[key], `${label}.${key}`)
  }
}

function pragmaColumns(database, tableName) {
  return database.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => ({
    name: row.name,
    type: row.type,
    notnull: row.notnull,
    pk: row.pk,
  }))
}

function extractFrozenStringArray(source, constName) {
  const matched = source.match(new RegExp(`const ${constName} = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`))
  assert.ok(matched, `找不到 ${constName} = Object.freeze([...])`)
  return [...matched[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
}

function extractExportFunction(source, name) {
  const startToken = `export function ${name}`
  const start = source.indexOf(startToken)
  assert.notEqual(start, -1, `找不到 export function ${name}`)
  const after = source.slice(start + startToken.length)
  const nextExport = after.search(/\nexport function /)
  return nextExport === -1 ? source.slice(start) : source.slice(start, start + startToken.length + nextExport)
}

function extractFunction(source, name) {
  const startToken = `function ${name}`
  const start = source.indexOf(startToken)
  assert.notEqual(start, -1, `找不到 function ${name}`)
  const after = source.slice(start + startToken.length)
  const nextFn = after.search(/\nfunction /)
  return nextFn === -1 ? source.slice(start) : source.slice(start, start + startToken.length + nextFn)
}

function identityFixture() {
  const suffix = randomUUID()
  const organizationId = `organization-${suffix}`
  const classId = `class-${suffix}`
  const gradeId = `grade-${suffix}`
  const workspaceId = `workspace-${suffix}`
  const studentId = `student-${suffix}`
  const teacherId = `teacher-${suffix}`
  const adminId = `admin-${suffix}`
  const password = randomBytes(24).toString('base64url')
  const passwordHash = hashPassword(password)
  const users = [
    { id: studentId, username: `student-${suffix}`, displayName: '投影快照学生', roleCode: 'student', scopeType: 'class', scopeId: classId },
    { id: teacherId, username: `teacher-${suffix}`, displayName: '投影快照教师', roleCode: 'teacher', scopeType: 'class', scopeId: classId },
    { id: adminId, username: `admin-${suffix}`, displayName: '投影快照管理员', roleCode: 'school_admin', scopeType: 'class', scopeId: classId },
  ]
  return {
    organizationId,
    classId,
    gradeId,
    workspaceId,
    studentId,
    teacherId,
    adminId,
    password,
    users,
    seed: {
      organizations: [{ id: organizationId, name: '投影快照学校' }],
      users: users.map(({ id, username, displayName }) => ({ id, organizationId, username, displayName })),
      workspaces: [{
        id: workspaceId,
        organizationId,
        code: 'class-teacher',
        name: '投影快照班级',
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
      classes: [{ id: classId, organizationId, gradeId, name: '投影快照一班' }],
      classMemberships: [
        { id: randomUUID(), classId, userId: studentId, membershipRole: 'student' },
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
    usageLabel: 'projection-snapshot-guard',
    mimeType,
    bytes,
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    ...extra,
  }
}

async function startHarness(t) {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-books-projection-snapshot-'))
  const databasePath = join(directory, 'books-projection-snapshot.sqlite')
  const publicAssetDirectory = join(directory, 'public')
  const cover = makeAsset(
    'books/projection-snapshot/cover.jpg',
    'image/jpeg',
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
    { width: 80, height: 100 },
  )
  const sourcePdf = makeAsset(
    'books/projection-snapshot/source.pdf',
    'application/pdf',
    Buffer.from('%PDF-1.4\nprojection-snapshot-guard\n%%EOF\n'),
  )
  mkdirSync(join(publicAssetDirectory, 'books', 'projection-snapshot'), { recursive: true })
  writeFileSync(join(publicAssetDirectory, cover.storageKey), cover.bytes)
  writeFileSync(join(publicAssetDirectory, sourcePdf.storageKey), sourcePdf.bytes)
  const assetsByKey = new Map([
    [cover.storageKey, cover],
    [sourcePdf.storageKey, sourcePdf],
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
    title: '投影快照测试书',
    label: `projection-snapshot-${randomUUID()}`,
    sourceFormat: 'pdf',
    catalogGrade: 3,
    metadata: {
      author: '快照作者',
      illustrator: '快照绘者',
      sourcePage: 'https://example.test/projection-snapshot',
      usageLabel: 'catalog-usage',
      rights: { note: 'projection-snapshot-guard' },
    },
    assets: [
      { ...sourcePdf, assetType: 'source_pdf' },
      { ...cover, assetType: 'cover' },
    ],
    pages: [{
      pageNo: 1,
      width: 1024,
      height: 768,
      textContent: '投影快照书页',
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

test('学生 GET /books 投影快照：冻结 key 必须在，允许新增，类型不得改种', async (t) => {
  const harness = await startHarness(t)
  assert.notEqual(harness.databasePath, BUSINESS_DB)
  assert.equal(
    harness.databasePath.includes('server\\data\\readmate.sqlite')
      || harness.databasePath.includes('server/data/readmate.sqlite'),
    false,
  )

  const student = harness.fixture.users.find((user) => user.id === harness.fixture.studentId)
  const jar = await login(harness.baseUrl, harness.fixture, student)
  const books = await requestJson(harness.baseUrl, jar, '/books', {
    workspaceId: harness.fixture.workspaceId,
  })
  assert.equal(books.status, 200, JSON.stringify(books.payload))
  const items = books.payload?.data?.items
  assert.equal(Array.isArray(items), true, 'GET /books 必须是 payload.data.items[]')
  assert.equal(items.length >= 1, true, '学生 GET /books 至少要有 1 本书才能拍快照')

  const item = items.find((entry) => entry.id === harness.book.bookId) || items[0]
  assertFrozenKeysPresent(item, FROZEN_BOOK_KEYS, 'GET /books item')
  for (const key of FROZEN_BOOK_KEYS) {
    assertAllowedType(item[key], FROZEN_BOOK_KEY_TYPES[key], `GET /books item.${key}`)
  }
  for (const key of FROZEN_BOOK_FORBIDDEN_KEYS) {
    assert.equal(Object.hasOwn(item, key), false, `GET /books item 禁止出现 ${key}`)
  }

  assertFrozenKeysPresent(item.progress, FROZEN_PROGRESS_KEYS, 'GET /books item.progress')
  for (const key of FROZEN_PROGRESS_KEYS) {
    assertAllowedType(item.progress[key], FROZEN_PROGRESS_KEY_TYPES[key], `GET /books item.progress.${key}`)
  }
  for (const key of FROZEN_PROGRESS_FORBIDDEN_KEYS) {
    assert.equal(
      Object.hasOwn(item.progress, key),
      false,
      `默认 GET /books item.progress 禁止出现 ${key}（完成度禁令 B-2 §5）`,
    )
  }

  assertFrozenKeysPresent(item.access, FROZEN_ACCESS_KEYS, 'GET /books item.access')
  for (const key of FROZEN_ACCESS_KEYS) {
    assertAllowedType(item.access[key], FROZEN_ACCESS_KEY_TYPES[key], `GET /books item.access.${key}`)
  }

  // 夹具故意造带封面的书：cover===null 时锁不住形状，必须从 HTTP 拿到非 null cover。
  assert.equal(item.cover === null, false, '快照夹具书的 cover 必须非 null，才能冻住 cover 形状')
  assertPublicAssetShape(item.cover, 'GET /books item.cover')
  assert.equal(Array.isArray(item.assets) && item.assets.length >= 1, true, '快照夹具书至少要有 1 个 asset')
  for (const [index, asset] of item.assets.entries()) {
    assertPublicAssetShape(asset, `GET /books item.assets[${index}]`)
  }
})

test('计时摘要三表列快照不得增删改名改类型改 notnull', async (t) => {
  const harness = await startHarness(t)
  for (const [tableName, frozen] of Object.entries(FROZEN_TABLE_COLUMNS)) {
    assert.deepEqual(
      pragmaColumns(harness.application.database, tableName),
      [...frozen],
      `${tableName} 列契约被改动（含新增列）`,
    )
  }
})

test('FINGERPRINT_FIELDS 顺序冻结，计时写路径不得出现 reader_mode', () => {
  const fingerprintSource = readFileSync(
    join(REPO_ROOT, 'src', 'student', 'reading-monitor', 'summary.js'),
    'utf8',
  )
  const monitoringSource = readFileSync(
    join(REPO_ROOT, 'server', 'domains', 'reading', 'monitoring.js'),
    'utf8',
  )
  const projectionsSource = readFileSync(
    join(REPO_ROOT, 'server', 'integration', 'projections.js'),
    'utf8',
  )

  assert.deepEqual(
    extractFrozenStringArray(fingerprintSource, 'FINGERPRINT_FIELDS'),
    [...FROZEN_FINGERPRINT_FIELDS],
  )
  assert.equal(FROZEN_FINGERPRINT_FIELDS.includes('readerMode'), false)
  assert.doesNotMatch(fingerprintSource, READER_MODE_RE)

  assert.doesNotMatch(monitoringSource, READER_MODE_RE)
  const projectBooks = extractExportFunction(projectionsSource, 'projectBooks')
  assert.doesNotMatch(projectBooks, READER_MODE_RE)
  const writeReadingPosition = extractFunction(monitoringSource, 'writeReadingPosition')
  assert.match(writeReadingPosition, /INSERT INTO reading_progress/)
  assert.match(writeReadingPosition, /DO UPDATE SET/)
  assert.doesNotMatch(writeReadingPosition, READER_MODE_RE)
  assert.doesNotMatch(writeReadingPosition, /reader_mode/)
})
