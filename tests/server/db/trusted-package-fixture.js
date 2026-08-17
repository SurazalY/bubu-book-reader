import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const STATUS_NOTE = 'OCR trusted per baseline 2026-08-17'
const PAGE_ONE_TEXT = '第一段。\n\n第二段。\n'

export function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Structurally valid PDF with the requested physical page count, so the importer can count pages for real. */
export function minimalPdf(pageCount) {
  const kids = []
  for (let index = 0; index < pageCount; index += 1) kids.push(`${3 + index} 0 R`)
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`,
    ...Array.from({ length: pageCount }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>'),
  ]
  let body = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((object, index) => {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const startxref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

function textBlocks() {
  const first = '第一段。\n\n'
  const second = '第二段。\n'
  return [
    {
      blockId: 'p0001-b001', order: 1, rawText: first, normalizedText: first,
      rawCharStart: 0, rawCharEnd: first.length, charStart: 0, charEnd: first.length, confidence: 1.0,
      sourceGeometry: { lineBBox: { x: 0, y: 0, width: 0, height: 0 }, estimated: false, usage: 'audit-only' },
    },
    {
      blockId: 'p0001-b002', order: 2, rawText: second, normalizedText: second,
      rawCharStart: first.length, rawCharEnd: first.length + second.length,
      charStart: first.length, charEnd: first.length + second.length, confidence: 1.0,
      sourceGeometry: { lineBBox: { x: 0, y: 0, width: 0, height: 0 }, estimated: false, usage: 'audit-only' },
    },
  ]
}

/**
 * Minimal synthetic trusted-baseline package: 2 physical pages (one text page with two blocks,
 * one blank page), a real 2-page PDF, a cover and the two trusted provenance files.
 */
export function createTrustedPackage({ bookId = 'book-042', grade = 3 } = {}) {
  const versionId = `${bookId}-trusted-v1`
  const root = mkdtempSync(path.join(tmpdir(), 'book-package-v2-trusted-'))
  mkdirSync(path.join(root, 'assets'))
  mkdirSync(path.join(root, 'content'))
  mkdirSync(path.join(root, 'provenance'))
  const source = minimalPdf(2)
  const cover = Buffer.from('ffd8ffdb00', 'hex')
  const content = {
    schemaVersion: 'book-pages/v2',
    bookId,
    pages: [
      {
        pageNo: 1, printedPageLabel: null, width: 468, height: 671,
        rawText: PAGE_ONE_TEXT, normalizedText: PAGE_ONE_TEXT, blocks: textBlocks(),
      },
      { pageNo: 2, printedPageLabel: null, width: 468, height: 671, rawText: '', normalizedText: '', blocks: [] },
    ],
  }
  const quality = {
    schemaVersion: 'book-package-quality/v2',
    bookId,
    versionId,
    status: 'trusted-baseline',
    statusNote: STATUS_NOTE,
    automatic: {
      pageCount: 2, successfulPages: 2, failedPages: [], emptyPages: [2], blankPages: [2],
      blankPageCount: 1, textPageCount: 1, blockCount: 2, lowConfidenceBlocks: [],
      estimatedGeometryBlocks: 0, runtimeDependsOnGeometry: false,
      confidenceSignal: 'unavailable-fixed-1.0',
      structuralChecks: {
        pageSequenceContiguous: true, exactlyOneFilePerPage: true, pageFilesReadableUtf8: true,
        pdfPresent: true, pdfPageCountMatchesOcrPageCount: true, sourcePdfSha256MatchesRecord: true,
      },
    },
    humanReview: {
      performed: false,
      reason: `${STATUS_NOTE}: OCR is treated as trusted input; no per-page human quality review was run.`,
    },
  }
  const files = new Map([
    ['assets/source.pdf', source],
    ['assets/cover.jpg', cover],
    ['content/pages.json', jsonBytes(content)],
    ['content/corrections.json', jsonBytes({
      schemaVersion: 'ocr-corrections/v1', bookId, normalizationVersion: 'raw-exact-ledger-v1', corrections: [],
    })],
    ['quality-report.json', jsonBytes(quality)],
    ['provenance/ocr-source.json', jsonBytes({
      schemaVersion: 'book-package-ocr-source/v2', jobId: bookId, sourceSha256: sha256(source),
      pageCount: 2, renderDpi: 200, modelRoute: 'unrecorded-antigravity-v1',
      pipelineVersion: 'ocr-antigravity-v1', createdAt: '2026-08-17T00:00:00+08:00',
      originalRecordSha256: '1'.repeat(64),
    })],
    ['provenance/ocr-report.json', jsonBytes({
      schemaVersion: 'book-package-ocr-report/v2', jobId: bookId, status: 'complete',
      sourceSha256: sha256(source), sourceSizeBytes: source.length, pageCount: 2, completedPages: 2,
      failedPages: 0, failedPageNos: [], renderDpi: 200, terminalPageCount: 2,
      validation: {
        pageSequenceContiguous: true, exactlyOneFilePerPage: true, pageFilesReadableUtf8: true,
        pdfPresent: true, pdfPageCountMatchesOcrPageCount: true, sourcePdfSha256MatchesRecord: true,
      },
      errorCount: 0, completedAt: '2026-08-17T00:00:00+08:00', originalReportSha256: '2'.repeat(64),
    })],
    ['provenance/ocr-pages-index.json', jsonBytes({
      schemaVersion: 'book-package-ocr-pages-index/v1', bookId, jobRelativePath: `jobs/${bookId}/pages`,
      pages: [
        { pageNo: 1, file: 'page-0001.txt', kind: 'text', sizeBytes: Buffer.byteLength(PAGE_ONE_TEXT, 'utf8'), sha256: sha256(Buffer.from(PAGE_ONE_TEXT, 'utf8')) },
        { pageNo: 2, file: 'page-0002.blank', kind: 'blank', sizeBytes: 0, sha256: sha256(Buffer.alloc(0)) },
      ],
    })],
    ['provenance/trusted-baseline.json', jsonBytes({
      schemaVersion: 'book-package-trusted-baseline/v1', bookId,
      syntheticFields: [{ field: 'ocr.modelRoute', value: 'unrecorded-antigravity-v1', reason: 'no model metadata in archive' }],
    })],
    ['provenance/ocr-prompt.md', Buffer.from('# not applicable for the trusted baseline\n', 'utf8')],
  ])
  for (const [relativePath, bytes] of files) writeFileSync(path.join(root, relativePath), bytes)
  const manifest = {
    schemaVersion: 'book-package/v2',
    bookId,
    versionId,
    title: '可信基线合成测试书',
    grade,
    pageCount: 2,
    source: {
      asset: 'assets/source.pdf', mimeType: 'application/pdf', sha256: sha256(source),
      sizeBytes: source.length, pdfPageCount: 2,
    },
    cover: {
      asset: 'assets/cover.jpg', mimeType: 'image/jpeg', sha256: sha256(cover),
      sizeBytes: cover.length, width: 600, height: 872, sourcePageNo: 1,
    },
    ocr: {
      jobId: bookId, modelRoute: 'unrecorded-antigravity-v1', coordinateSystem: 'none-trusted-text-baseline',
      geometryUsage: 'audit-only-estimated', pipelineVersion: 'ocr-antigravity-v1',
      promptVersion: 'not-applicable-trusted-baseline', promptAsset: 'provenance/ocr-prompt.md',
      promptSha256: sha256(files.get('provenance/ocr-prompt.md')),
      parserVersion: 'book-package-v2-trusted-builder-v1',
      sourceRecordSha256: sha256(files.get('provenance/ocr-source.json')),
      reportSha256: sha256(files.get('provenance/ocr-report.json')),
    },
    provenance: {
      pagesIndex: { path: 'provenance/ocr-pages-index.json', sha256: sha256(files.get('provenance/ocr-pages-index.json')) },
      trustedBaseline: { path: 'provenance/trusted-baseline.json', sha256: sha256(files.get('provenance/trusted-baseline.json')) },
    },
    normalization: { version: 'raw-exact-ledger-v1', policy: 'raw-exact-unless-ledger-reviewed' },
    content: { path: 'content/pages.json', sha256: sha256(files.get('content/pages.json')) },
    corrections: { path: 'content/corrections.json', sha256: sha256(files.get('content/corrections.json')) },
    quality: {
      report: 'quality-report.json', sha256: sha256(files.get('quality-report.json')),
      status: 'trusted-baseline', statusNote: STATUS_NOTE, automatic: { emptyPages: [2] },
    },
    rights: { usage: 'internal-default-catalog' },
  }
  writeFileSync(path.join(root, 'manifest.json'), jsonBytes(manifest))
  return {
    root,
    bookId,
    versionId,
    grade,
    title: manifest.title,
    pageCount: manifest.pageCount,
    coverSha256: manifest.cover.sha256,
    sourceSha256: manifest.source.sha256,
    read(relativePath) {
      return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'))
    },
    rewrite(relativePath, value) {
      writeFileSync(path.join(root, relativePath), jsonBytes(value))
    },
    sha256Of(relativePath) {
      return sha256(readFileSync(path.join(root, relativePath)))
    },
    updateManifest(mutate) {
      const current = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'))
      mutate(current)
      writeFileSync(path.join(root, 'manifest.json'), jsonBytes(current))
    },
    close() { rmSync(root, { recursive: true, force: true }) },
  }
}
