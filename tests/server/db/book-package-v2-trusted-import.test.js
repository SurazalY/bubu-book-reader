import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import { bootstrapInternalDemo } from '../../../server/db/bootstrap-internal-demo.js'
import { importBookPackageV2 } from '../../../server/db/import-book-package-v2.js'
import { createReadingDomain } from '../../../server/domains/reading/catalog.js'
import { projectBooks } from '../../../server/integration/projections.js'
import { grantBookToClass } from '../helpers/phase8-old-fixture.js'
import { createTrustedPackage } from './trusted-package-fixture.js'

const ACTOR_ID = 'internal-ops-admin'
const WORKSPACE_ID = 'internal-demo-platform-workspace'
const ORGANIZATION_ID = 'internal-demo-organization'

async function createEnvironment(context) {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-trusted-import-'))
  const databasePath = join(directory, 'readmate.sqlite')
  const publicRoot = join(directory, 'public')
  const openedDatabases = []
  // Windows keeps the SQLite file locked until every handle is closed, so the temporary
  // directory can only be removed after the assertion connections are closed.
  context.after(() => {
    for (const database of openedDatabases) database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  await bootstrapInternalDemo({
    databasePath,
    manifestPath: join(directory, 'catalog-manifest-not-used.json'),
    publicRoot,
    password: randomBytes(24).toString('base64url'),
    catalogImporter: async () => ({ imported: [], unchanged: [], publicRoot }),
  })
  return { directory, databasePath, publicRoot, openedDatabases }
}

function openDatabase(environment) {
  const database = new DatabaseSync(environment.databasePath)
  environment.openedDatabases.push(database)
  return database
}

function importTrusted(environment, fixture, options = {}) {
  return importBookPackageV2({
    databasePath: environment.databasePath,
    packageDirectory: fixture.root,
    actorId: ACTOR_ID,
    workspaceId: WORKSPACE_ID,
    publicRoot: environment.publicRoot,
    ...options,
  })
}

function readingDomain(database, overrides = {}) {
  let sequence = 0
  return createReadingDomain({
    db: database,
    actor: { id: ACTOR_ID },
    workspace: { id: WORKSPACE_ID, organizationId: ORGANIZATION_ID, scopeType: 'platform', scopeId: 'readmate-platform' },
    authorize: async () => true,
    audit: async () => undefined,
    idFactory: () => `trusted-test-${++sequence}`,
    ...overrides,
  })
}

function pdfAsset(versionId) {
  return {
    id: `${versionId}:asset:source-pdf`,
    assetType: 'source_pdf',
    storageKey: `books/pilot/${versionId}/source.pdf`,
    usageLabel: 'INTERNAL PILOT ONLY',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    sha256: 'a'.repeat(64),
  }
}

function packageDefinition(bookId, versionId, qualityStatus) {
  return {
    bookId,
    versionId,
    title: `质量闸门测试书 ${qualityStatus}`,
    label: versionId,
    sourceFormat: 'pdf',
    packageMetadata: {
      format: 'book-package/v2',
      releaseSha256: 'b'.repeat(64),
      normalizationVersion: 'raw-exact-ledger-v1',
      qualityStatus,
      provenance: { manifestSha256: 'b'.repeat(64) },
    },
    pages: [{
      pageNo: 1,
      printedPageLabel: null,
      width: 468,
      height: 671,
      rawText: '正文',
      normalizedText: '正文',
      blocks: [{
        blockKey: 'p0001-b001',
        rawText: '正文',
        normalizedText: '正文',
        charStart: 0,
        charEnd: 2,
        sourceConfidence: 1,
        sourceGeometry: { lineBBox: { x: 0, y: 0, width: 0, height: 0 }, estimated: false, usage: 'audit-only' },
        geometryUsage: 'audit-only',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      }],
    }],
    assets: [pdfAsset(versionId)],
  }
}

test('trusted-baseline 包用 --accept-trusted 端到端导入并登记封面与年级', async (t) => {
  const environment = await createEnvironment(t)
  const fixture = createTrustedPackage()
  t.after(() => fixture.close())

  const result = await importTrusted(environment, fixture, { acceptTrusted: true })
  assert.equal(result.imported, true)
  assert.equal(result.bookId, fixture.bookId)

  const database = openDatabase(environment)
  const book = database.prepare('SELECT * FROM books WHERE id = ?').get(fixture.bookId)
  assert.equal(book.status, 'published')
  assert.equal(book.title, fixture.title)
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM book_pages WHERE book_version_id = ?').get(fixture.versionId).count,
    fixture.pageCount,
  )
  const blank = database.prepare('SELECT normalized_text, raw_text FROM book_pages WHERE book_version_id = ? AND page_no = 2').get(fixture.versionId)
  assert.equal(blank.normalized_text, '')
  assert.equal(blank.raw_text, '')

  const version = database.prepare('SELECT package_format, package_quality_status FROM book_versions WHERE id = ?').get(fixture.versionId)
  assert.equal(version.package_format, 'book-package/v2')
  assert.equal(version.package_quality_status, 'trusted-baseline')

  const grade = database.prepare('SELECT grade FROM book_catalog_metadata WHERE book_id = ?').get(fixture.bookId)
  assert.equal(grade.grade, fixture.grade)

  const assets = database.prepare(`SELECT asset_type, storage_key, mime_type, size_bytes, sha256, width, height
    FROM book_assets WHERE book_version_id = ? ORDER BY asset_type`).all(fixture.versionId)
  assert.deepEqual(assets.map((asset) => asset.asset_type), ['cover', 'source_pdf'])
  const cover = assets.find((asset) => asset.asset_type === 'cover')
  assert.equal(cover.storage_key, `books/pilot/${fixture.bookId}/${fixture.versionId}/cover.jpg`)
  assert.equal(cover.mime_type, 'image/jpeg')
  assert.equal(cover.sha256, fixture.coverSha256)
  assert.equal(cover.width, 600)
  assert.equal(cover.height, 872)
  assert.equal(/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(cover.storage_key), false)
  assert.equal(existsSync(join(environment.publicRoot, ...cover.storage_key.split('/'))), true)

  const exemption = database.prepare(`SELECT event_type, reason_code, resource_id, scope_snapshot_json
    FROM audit_events WHERE event_type = 'book.package.trusted_baseline_accepted' AND resource_id = ?`).get(fixture.bookId)
  assert.equal(exemption.reason_code, 'TRUSTED_BASELINE_HUMAN_REVIEW_WAIVED')
  const snapshot = JSON.parse(exemption.scope_snapshot_json)
  assert.equal(snapshot.packageQualityStatus, 'trusted-baseline')
  assert.equal(snapshot.humanReviewPerformed, false)
  assert.equal(snapshot.versionId, fixture.versionId)
})

test('trusted-baseline 包在没有 --accept-trusted 时导入被拒绝且不落库不落盘', async (t) => {
  const environment = await createEnvironment(t)
  const fixture = createTrustedPackage()
  t.after(() => fixture.close())

  await assert.rejects(
    () => importTrusted(environment, fixture),
    (error) => error.code === 'HUMAN_REVIEW_REQUIRED',
  )

  const database = openDatabase(environment)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM books').get().count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM book_assets').get().count, 0)
  assert.equal(existsSync(join(environment.publicRoot, 'books', 'pilot', fixture.bookId)), false)
})

test('同一 trusted 包重复导入保持幂等', async (t) => {
  const environment = await createEnvironment(t)
  const fixture = createTrustedPackage()
  t.after(() => fixture.close())

  const first = await importTrusted(environment, fixture, { acceptTrusted: true })
  const second = await importTrusted(environment, fixture, { acceptTrusted: true })
  assert.equal(first.imported, true)
  assert.equal(second.imported, false)
  assert.equal(second.unchanged, true)
  assert.equal(second.releaseSha256, first.releaseSha256)

  const database = openDatabase(environment)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM books').get().count, 1)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM book_versions').get().count, 1)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM book_pages').get().count, fixture.pageCount)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM book_assets').get().count, 2)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM book_catalog_metadata').get().count, 1)
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'book.package.trusted_baseline_accepted'").get().count,
    1,
  )
  assert.deepEqual(
    readdirSync(join(environment.publicRoot, 'books', 'pilot', fixture.bookId, fixture.versionId)).sort(),
    ['cover.jpg', 'source.pdf'],
  )
})

test('GET /books 投影带出编目年级且保留既有字段', async (t) => {
  const environment = await createEnvironment(t)
  const fixture = createTrustedPackage()
  t.after(() => fixture.close())
  await importTrusted(environment, fixture, { acceptTrusted: true })

  const database = openDatabase(environment)
  grantBookToClass(database, {
    bookId: fixture.bookId,
    classId: 'internal-demo-class',
    organizationId: ORGANIZATION_ID,
    actorId: ACTOR_ID,
    bookVersionId: fixture.versionId,
  })
  const rows = await readingDomain(database).listBooks()
  const [projected] = projectBooks(database, 'internal-demo-student', 'internal-demo-workspace', rows)
  assert.equal(projected.id, fixture.bookId)
  assert.equal(projected.grade, fixture.grade)
  assert.equal(projected.title, fixture.title)
  assert.equal(projected.versionId, fixture.versionId)
  assert.equal(projected.author, null)
  assert.equal(projected.illustrator, null)
  assert.equal(projected.sourcePage, null)
  assert.equal(projected.cover.kind, 'cover')
  assert.equal(projected.assets.length, 2)
  assert.deepEqual(projected.progress, { currentPage: null, totalPages: fixture.pageCount, bookmarks: [] })
  assert.deepEqual(projected.access, { readable: true })
})

test('publishBook 接受 trusted-baseline 但仍拒绝未通过人工闸门的 v2 包', async (t) => {
  const environment = await createEnvironment(t)
  const database = openDatabase(environment)
  const trusted = packageDefinition('book-901', 'book-901-trusted-v1', 'trusted-baseline')
  const pending = packageDefinition('book-902', 'book-902-pending-v1', 'human-review-pending')
  const verified = new Map([trusted, pending].map((definition) => [
    definition.assets[0].storageKey, definition.assets[0],
  ]))
  const reading = readingDomain(database, {
    assetMetadataVerifier: async ({ storageKey }) => verified.get(storageKey),
  })

  await reading.createBookVersion({ ...trusted, catalogGrade: 4 })
  await reading.publishBook(trusted.bookId)
  assert.equal(database.prepare('SELECT status FROM books WHERE id = ?').get(trusted.bookId).status, 'published')
  assert.equal(database.prepare('SELECT grade FROM book_catalog_metadata WHERE book_id = ?').get(trusted.bookId).grade, 4)

  await reading.createBookVersion(pending)
  await assert.rejects(
    () => reading.publishBook(pending.bookId),
    (error) => error.code === 'HUMAN_REVIEW_REQUIRED',
  )
  assert.equal(database.prepare('SELECT status FROM books WHERE id = ?').get(pending.bookId).status, 'draft')
})
