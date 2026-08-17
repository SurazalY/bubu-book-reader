import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { loadBookPackageV2 } from '../../../server/db/import-book-package-v2.js'
import { createTrustedPackage } from './trusted-package-fixture.js'

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function createPackage() {
  const root = mkdtempSync(path.join(tmpdir(), 'book-package-v2-'))
  mkdirSync(path.join(root, 'assets'))
  mkdirSync(path.join(root, 'content'))
  mkdirSync(path.join(root, 'provenance'))
  const source = Buffer.from('%PDF-1.4\nlocal integration test fixture\n%%EOF\n')
  const content = {
    schemaVersion: 'book-pages/v2',
    bookId: 'book-025',
    pages: [{
      pageNo: 1,
      printedPageLabel: null,
      width: 100,
      height: 200,
      rawText: '原文',
      normalizedText: '正文',
      blocks: [{
        blockId: 'p0001-b001', order: 1, rawText: '原文', normalizedText: '正文',
        rawCharStart: 0, rawCharEnd: 2, charStart: 0, charEnd: 2, confidence: 0.99,
        sourceGeometry: {
          lineBBox: { x: 0, y: 0, width: 100, height: 200 }, estimated: true, usage: 'audit-only',
        },
      }],
    }],
  }
  const corrections = {
    schemaVersion: 'ocr-corrections/v1',
    bookId: 'book-025',
    normalizationVersion: 'raw-exact-ledger-v1',
    corrections: [{
      pageNo: 1, blockOrder: 1, rawText: '原文', rawSha256: sha256(Buffer.from('原文', 'utf8')), normalizedText: '正文', reason: '人工校订',
      reviewer: 'reviewer', reviewedAt: '2026-08-15T20:00:00+08:00',
    }],
  }
  const quality = {
    schemaVersion: 'book-package-quality/v2',
    bookId: 'book-025',
    versionId: 'book-025-test-v2',
    automatic: {
      pageCount: 1, successfulPages: 1, failedPages: [], emptyPages: [], lowConfidenceBlocks: [],
      blockCount: 1, estimatedGeometryBlocks: 1, runtimeDependsOnGeometry: false,
    },
    humanReview: {
      schemaVersion: 'book-package-human-review/v1', bookId: 'book-025', status: 'passed',
      samplePages: [1], requiredReviewPages: [], reviewer: 'reviewer',
      reviewedAt: '2026-08-15T20:00:00+08:00', evidencePath: 'evidence/book-025', notes: '', findings: [],
    },
    status: 'passed',
  }
  const files = new Map([
    ['assets/source.pdf', source],
    ['content/pages.json', jsonBytes(content)],
    ['content/corrections.json', jsonBytes(corrections)],
    ['quality-report.json', jsonBytes(quality)],
    ['provenance/ocr-source.json', jsonBytes({
      schemaVersion: 'book-package-ocr-source/v2', jobId: 'book-025', sourceSha256: sha256(source),
      pageCount: 1, renderDpi: 200, modelRoute: 'test-model', pipelineVersion: 'text-ocr-v1',
      createdAt: '2026-08-15T00:00:00+08:00', originalRecordSha256: '1'.repeat(64),
    })],
    ['provenance/ocr-report.json', jsonBytes({
      schemaVersion: 'book-package-ocr-report/v2', jobId: 'book-025', status: 'complete',
      sourceSha256: sha256(source), sourceSizeBytes: source.length, pageCount: 1, completedPages: 1,
      failedPages: 0, failedPageNos: [], renderDpi: 200, terminalPageCount: 1,
      validation: { sourceSha256: true, pageFilesExactAndUnique: true }, errorCount: 0,
      completedAt: '2026-08-15T01:00:00+08:00', originalReportSha256: '2'.repeat(64),
    })],
    ['provenance/ocr-prompt.md', Buffer.from('# test OCR prompt\n', 'utf8')],
  ])
  for (const [relativePath, bytes] of files) writeFileSync(path.join(root, relativePath), bytes)
  const manifest = {
    schemaVersion: 'book-package/v2',
    bookId: 'book-025',
    versionId: 'book-025-test-v2',
    title: '世界神话传说',
    pageCount: 1,
    source: {
      asset: 'assets/source.pdf', mimeType: 'application/pdf', sha256: sha256(source),
      sizeBytes: source.length, pdfPageCount: 1,
    },
    ocr: {
      jobId: 'job-025', modelRoute: 'test-model', coordinateSystem: 'pixel top-left',
      geometryUsage: 'audit-only-estimated',
      pipelineVersion: 'text-ocr-v1', promptVersion: 'luna-ocr-v1',
      promptAsset: 'provenance/ocr-prompt.md', promptSha256: sha256(files.get('provenance/ocr-prompt.md')),
      parserVersion: 'book-package-v2-builder-v1',
      sourceRecordSha256: sha256(files.get('provenance/ocr-source.json')),
      reportSha256: sha256(files.get('provenance/ocr-report.json')),
    },
    normalization: { version: 'raw-exact-ledger-v1', policy: 'raw-exact-unless-ledger-reviewed' },
    content: { path: 'content/pages.json', sha256: sha256(files.get('content/pages.json')) },
    corrections: { path: 'content/corrections.json', sha256: sha256(files.get('content/corrections.json')) },
    quality: { report: 'quality-report.json', sha256: sha256(files.get('quality-report.json')), status: 'passed' },
    rights: { usage: 'internal-pilot-only' },
  }
  writeFileSync(path.join(root, 'manifest.json'), jsonBytes(manifest))
  return {
    root,
    rewrite(relativePath, value) {
      writeFileSync(path.join(root, relativePath), jsonBytes(value))
    },
    read(relativePath) {
      return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'))
    },
    close() { rmSync(root, { recursive: true, force: true }) },
  }
}

test('book-package/v2 只接受已过人工闸门且可追溯的精确页块', async (t) => {
  const fixture = createPackage()
  t.after(() => fixture.close())
  const loaded = await loadBookPackageV2(fixture.root, { pdfPageCount: async () => 1 })
  assert.equal(loaded.manifest.bookId, 'book-025')
  assert.equal(loaded.definition.packageMetadata.qualityStatus, 'passed')
  assert.deepEqual(loaded.definition.pages[0].blocks[0], {
    id: 'book-025-test-v2:p0001-b001',
    blockKey: 'p0001-b001',
    paragraphId: null,
    rawText: '原文',
    normalizedText: '正文',
    charStart: 0,
    charEnd: 2,
    sourceConfidence: 0.99,
    sourceGeometry: {
      lineBBox: { x: 0, y: 0, width: 100, height: 200 }, estimated: true, usage: 'audit-only',
    },
    geometryUsage: 'audit-only',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  })
})

test('book-package/v2 内容被改写后必须因 SHA-256 不一致失败', async (t) => {
  const fixture = createPackage()
  t.after(() => fixture.close())
  const content = fixture.read('content/pages.json')
  content.pages[0].normalizedText = '被篡改'
  fixture.rewrite('content/pages.json', content)
  await assert.rejects(
    () => loadBookPackageV2(fixture.root, { pdfPageCount: async () => 1 }),
    /content SHA-256 校验失败/,
  )
})

test('book-package/v2 即使哈希重算，缺少逐块校订台账仍不得导入', async (t) => {
  const fixture = createPackage()
  t.after(() => fixture.close())
  const corrections = fixture.read('content/corrections.json')
  corrections.corrections = []
  fixture.rewrite('content/corrections.json', corrections)
  const manifest = fixture.read('manifest.json')
  manifest.corrections.sha256 = sha256(readFileSync(path.join(fixture.root, 'content/corrections.json')))
  fixture.rewrite('manifest.json', manifest)
  await assert.rejects(
    () => loadBookPackageV2(fixture.root, { pdfPageCount: async () => 1 }),
    /缺少精确审核校订记录/,
  )
})

test('book-package/v2 重算包哈希也不能伪造校订原文哈希', async (t) => {
  const fixture = createPackage()
  t.after(() => fixture.close())
  const corrections = fixture.read('content/corrections.json')
  corrections.corrections[0].rawSha256 = '0'.repeat(64)
  fixture.rewrite('content/corrections.json', corrections)
  const manifest = fixture.read('manifest.json')
  manifest.corrections.sha256 = sha256(readFileSync(path.join(fixture.root, 'content/corrections.json')))
  fixture.rewrite('manifest.json', manifest)
  await assert.rejects(
    () => loadBookPackageV2(fixture.root, { pdfPageCount: async () => 1 }),
    /rawSha256 与 rawText 不一致/,
  )
})

test('trusted-baseline 包在 --accept-trusted 下被接受且保留真实质量状态', async (t) => {
  const fixture = createTrustedPackage()
  t.after(() => fixture.close())
  const loaded = await loadBookPackageV2(fixture.root, { acceptTrusted: true })
  assert.equal(loaded.manifest.bookId, fixture.bookId)
  assert.equal(loaded.definition.packageMetadata.qualityStatus, 'trusted-baseline')
  assert.equal(loaded.definition.catalogGrade, fixture.grade)
  assert.equal(typeof loaded.coverPath, 'string')
  assert.equal(loaded.definition.pages.length, 2)
  assert.equal(loaded.definition.pages[1].normalizedText, '')
  assert.deepEqual(loaded.definition.pages[1].blocks, [])
  assert.deepEqual(loaded.definition.pages[0].blocks.map((block) => block.blockKey), ['p0001-b001', 'p0001-b002'])
  assert.deepEqual(
    loaded.definition.pages[0].blocks.map((block) => [block.charStart, block.charEnd]),
    [[0, 6], [6, 11]],
  )
  assert.equal(
    loaded.definition.pages[0].blocks.every((block) => block.x === 0 && block.y === 0 && block.width === 0 && block.height === 0),
    true,
  )
})

test('trusted-baseline 包在没有 --accept-trusted 时必须被人工闸门拒绝', async (t) => {
  const fixture = createTrustedPackage()
  t.after(() => fixture.close())
  await assert.rejects(
    () => loadBookPackageV2(fixture.root),
    (error) => error.code === 'HUMAN_REVIEW_REQUIRED' && /accept-trusted/.test(error.message),
  )
})

test('--accept-trusted 不放宽 passed 路径：未过人工闸门的包仍被拒绝', async (t) => {
  const fixture = createPackage()
  t.after(() => fixture.close())
  const quality = fixture.read('quality-report.json')
  quality.humanReview.status = 'failed'
  fixture.rewrite('quality-report.json', quality)
  const manifest = fixture.read('manifest.json')
  manifest.quality.sha256 = sha256(readFileSync(path.join(fixture.root, 'quality-report.json')))
  fixture.rewrite('manifest.json', manifest)
  await assert.rejects(
    () => loadBookPackageV2(fixture.root, { pdfPageCount: async () => 1, acceptTrusted: true }),
    /人工复核证据不满足发布闸门/,
  )
})

test('trusted-baseline 包不得伪造人工复核记录', async (t) => {
  const fixture = createTrustedPackage()
  t.after(() => fixture.close())
  const quality = fixture.read('quality-report.json')
  quality.humanReview = { performed: true, reason: '声称已复核' }
  fixture.rewrite('quality-report.json', quality)
  fixture.updateManifest((manifest) => {
    manifest.quality.sha256 = fixture.sha256Of('quality-report.json')
  })
  await assert.rejects(
    () => loadBookPackageV2(fixture.root, { acceptTrusted: true }),
    /不得声明已完成人工复核/,
  )
})

test('trusted-baseline 包缺少 grade 必须被拒绝', async (t) => {
  const fixture = createTrustedPackage()
  t.after(() => fixture.close())
  fixture.updateManifest((manifest) => { delete manifest.grade })
  await assert.rejects(
    () => loadBookPackageV2(fixture.root, { acceptTrusted: true }),
    /必须提供 grade、cover 与 provenance/,
  )
})

test('trusted-baseline 包物理页缺号必须被拒绝', async (t) => {
  const fixture = createTrustedPackage()
  t.after(() => fixture.close())
  const content = fixture.read('content/pages.json')
  content.pages[1].pageNo = 3
  fixture.rewrite('content/pages.json', content)
  fixture.updateManifest((manifest) => {
    manifest.content.sha256 = fixture.sha256Of('content/pages.json')
  })
  await assert.rejects(
    () => loadBookPackageV2(fixture.root, { acceptTrusted: true }),
    /物理页 2 顺序或 blocks 无效/,
  )
})

test('trusted-baseline 包文件哈希不符必须被拒绝', async (t) => {
  const fixture = createTrustedPackage()
  t.after(() => fixture.close())
  const content = fixture.read('content/pages.json')
  content.pages[0].normalizedText = '被篡改'
  fixture.rewrite('content/pages.json', content)
  await assert.rejects(
    () => loadBookPackageV2(fixture.root, { acceptTrusted: true }),
    /content SHA-256 校验失败/,
  )
})

test('trusted-baseline 包封面哈希不符必须被拒绝', async (t) => {
  const fixture = createTrustedPackage()
  t.after(() => fixture.close())
  fixture.updateManifest((manifest) => { manifest.cover.sha256 = '0'.repeat(64) })
  await assert.rejects(
    () => loadBookPackageV2(fixture.root, { acceptTrusted: true }),
    /cover SHA-256 校验失败/,
  )
})

test('trusted-baseline 包 PDF 物理页数与 pageCount 不符必须被拒绝', async (t) => {
  const fixture = createTrustedPackage()
  t.after(() => fixture.close())
  await assert.rejects(
    () => loadBookPackageV2(fixture.root, { acceptTrusted: true, pdfPageCount: async () => 3 }),
    /源 PDF 物理页数与发布包不一致/,
  )
})
