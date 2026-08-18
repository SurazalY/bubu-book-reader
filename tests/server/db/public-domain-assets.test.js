import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { bootstrapInternalDemo } from '../../../server/db/bootstrap-internal-demo.js'
import { importPublicDomainCatalog } from '../../../server/db/import-public-domain-catalog.js'

function writeFixture(root, relativePath, content, extra = {}) {
  const filename = join(root, ...relativePath.split('/'))
  mkdirSync(dirname(filename), { recursive: true })
  writeFileSync(filename, content)
  const bytes = readFileSync(filename)
  return {
    relativePath,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    ...extra,
  }
}

function createMaterialManifest(directory) {
  const packageName = 'alice_fixture_public_domain_internal_test'
  const title = 'Alice Fixture'
  const sourcePage = 'https://example.invalid/alice-fixture'
  const prefix = `${packageName}/`
  const files = [
    writeFixture(directory, `${prefix}metadata/sources_and_rights.json`, JSON.stringify({
      book: { title, author: 'Fixture Author', illustrator: 'Fixture Illustrator' },
      sources: { projectGutenbergBookPage: sourcePage },
    })),
    writeFixture(directory, `${prefix}metadata/layout_coordinates.json`, JSON.stringify({
      pageSizePoints: { width: 792, height: 612 },
      pages: [1, 2, 3, 4].map((page) => ({
        page,
        elements: [{ type: 'text', id: `page-${page}`, x: 46, y: 100, width: 450, height: 400 }],
      })),
    })),
    writeFixture(directory, `${prefix}source/fixed_layout_excerpt_source.txt`, 'First page.\n\nSecond page.\n\nThird page.\n\nFourth page.'),
    writeFixture(directory, `${prefix}pdf/fixed_layout_test_excerpt.pdf`, Buffer.from('%PDF-fixture'), { pdfPages: 4 }),
    writeFixture(directory, `${prefix}assets/cover_original.jpg`, Buffer.from('cover-fixture'), { image: { width: 10, height: 10 } }),
    writeFixture(directory, `${prefix}assets/illustration_01_original.png`, Buffer.from('illustration-one'), { image: { width: 10, height: 10 } }),
    writeFixture(directory, `${prefix}assets/illustration_02_original.png`, Buffer.from('illustration-two'), { image: { width: 10, height: 10 } }),
  ]
  const manifestPath = join(directory, 'delivery_manifest.json')
  writeFileSync(manifestPath, JSON.stringify({
    label: 'PUBLIC DOMAIN / INTERNAL TEST MATERIAL',
    books: [{ package: packageName, title, sourcePage }],
    files,
  }))
  return { manifestPath, packageName }
}

test('书目已存在但公开封面丢失时幂等导入会恢复素材', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-public-assets-'))
  const databasePath = join(directory, 'readmate.sqlite')
  const publicRoot = join(directory, 'public')
  const password = randomBytes(24).toString('base64url')
  const { manifestPath, packageName } = createMaterialManifest(directory)
  context.after(() => rmSync(directory, { recursive: true, force: true }))

  await bootstrapInternalDemo({
    databasePath,
    manifestPath,
    publicRoot,
    password,
    catalogImporter: async () => ({ imported: [], unchanged: [], publicRoot }),
  })
  await importPublicDomainCatalog({
    databasePath,
    manifestPath,
    actorId: 'internal-ops-admin',
    workspaceId: 'internal-demo-platform-workspace',
    publicRoot,
  })

  const coverPath = join(publicRoot, 'books', packageName, 'cover_original.jpg')
  assert.equal(existsSync(coverPath), true)
  unlinkSync(coverPath)

  const replay = await importPublicDomainCatalog({
    databasePath,
    manifestPath,
    actorId: 'internal-ops-admin',
    workspaceId: 'internal-demo-platform-workspace',
    publicRoot,
  })

  assert.equal(replay.unchanged.length, 1)
  assert.equal(existsSync(coverPath), true)
  assert.equal(readFileSync(coverPath, 'utf8'), 'cover-fixture')
})
