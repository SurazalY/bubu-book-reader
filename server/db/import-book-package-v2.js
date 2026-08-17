import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

import { createIdentityModule } from '../domains/identity/index.js'
import { createReadingDomain } from '../domains/reading/catalog.js'
import { appendAuditEvent } from './reliability.js'

const USAGE = 'node server/db/import-book-package-v2.js --database <sqlite> --package <directory> --actor-id <user> --workspace-id <workspace> --public-root <asset-directory> [--accept-trusted]'
const MANIFEST_FIELDS = new Set([
  'schemaVersion', 'bookId', 'versionId', 'title', 'pageCount', 'source', 'ocr',
  'normalization', 'content', 'corrections', 'quality', 'rights',
])
// trusted-baseline 包在 book-package/v2 之上新增的根级字段；对 passed 包保持可选，
// 这样旧包（只有 MANIFEST_FIELDS）与新包都能通过同一套字段集合校验。
const MANIFEST_TRUSTED_FIELDS = new Set(['grade', 'cover', 'provenance'])
const TRUSTED_QUALITY_STATUS = 'trusted-baseline'
const TRUSTED_AUDIT_REASON_CODE = 'TRUSTED_BASELINE_HUMAN_REVIEW_WAIVED'
const SUPPORTED_RIGHTS_USAGE = new Set(['internal-pilot-only', 'internal-default-catalog'])
const SUPPORTED_PIPELINE_VERSIONS = new Set(['text-ocr-v1', 'ocr-antigravity-v1'])
const SUPPORTED_PARSER_VERSIONS = new Set(['book-package-v2-builder-v1', 'book-package-v2-trusted-builder-v1'])
const COVER_ASSET_PATH = 'assets/cover.jpg'
const COVER_STORAGE_FILENAME = 'cover.jpg'

function parseArguments(values) {
  const parsed = { 'accept-trusted': false }
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index]
    if (!key?.startsWith('--')) throw new Error(USAGE)
    if (key === '--accept-trusted') {
      parsed['accept-trusted'] = true
      continue
    }
    const value = values[index + 1]
    if (!value || value.startsWith('--')) throw new Error(USAGE)
    parsed[key.slice(2)] = value
    index += 1
  }
  for (const required of ['database', 'package', 'actor-id', 'workspace-id', 'public-root']) {
    if (!parsed[required]) throw new Error(USAGE)
  }
  return parsed
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sha256File(filename) {
  return sha256Bytes(readFileSync(filename))
}

function exactFields(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`)
  const actual = Object.keys(value)
  if (actual.length !== fields.size || actual.some((field) => !fields.has(field))) {
    throw new Error(`${label} 字段与 book-package/v2 契约不一致`)
  }
}

function boundedFields(value, required, optional, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`)
  const actual = new Set(Object.keys(value))
  for (const field of required) {
    if (!actual.has(field)) throw new Error(`${label} 字段与 book-package/v2 契约不一致`)
  }
  for (const field of actual) {
    if (!required.has(field) && !optional.has(field)) throw new Error(`${label} 字段与 book-package/v2 契约不一致`)
  }
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} 必须是正整数`)
  return value
}

function stringValue(value, label) {
  if (typeof value !== 'string' || !value) throw new Error(`${label} 必须是非空字符串`)
  return value
}

function sha256Value(value, label) {
  const normalized = stringValue(value, label)
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error(`${label} 必须是小写 SHA-256`)
  return normalized
}

function safePackageFile(packageRoot, relativePath, label) {
  const requested = stringValue(relativePath, label)
  if (isAbsolute(requested)) throw new Error(`${label} 不能是绝对路径`)
  const filename = resolve(packageRoot, requested)
  const boundary = relative(packageRoot, filename)
  if (!boundary || boundary.startsWith('..') || isAbsolute(boundary)) throw new Error(`${label} 路径越界`)
  if (!statSync(filename).isFile()) throw new Error(`${label} 不是文件`)
  return filename
}

function verifiedFile(packageRoot, relativePath, expectedSha256, label) {
  const filename = safePackageFile(packageRoot, relativePath, label)
  if (sha256File(filename) !== sha256Value(expectedSha256, `${label}.sha256`)) {
    throw new Error(`${label} SHA-256 校验失败`)
  }
  return filename
}

function readJson(filename, label) {
  let value
  try {
    value = JSON.parse(readFileSync(filename, 'utf8'))
  } catch (error) {
    throw new Error(`${label} 不是有效 JSON: ${error.message}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 根节点必须是对象`)
  return value
}

async function pdfPageCount(filename) {
  const loadingTask = getDocument({ data: new Uint8Array(readFileSync(filename)), disableWorker: true })
  try {
    return (await loadingTask.promise).numPages
  } finally {
    await loadingTask.destroy()
  }
}

function validateQualityIdentity(manifest, quality) {
  if (quality.schemaVersion !== 'book-package-quality/v2'
    || quality.bookId !== manifest.bookId
    || quality.versionId !== manifest.versionId
    || quality.automatic?.pageCount !== manifest.pageCount
    || quality.automatic?.failedPages?.length !== 0
    || quality.automatic?.runtimeDependsOnGeometry !== false) {
    throw new Error('质量报告与发布包契约不一致')
  }
}

function validateTrustedQuality(manifest, quality) {
  if (manifest.quality.status !== TRUSTED_QUALITY_STATUS || quality.status !== TRUSTED_QUALITY_STATUS) {
    throw new Error('质量报告与发布包契约不一致')
  }
  validateQualityIdentity(manifest, quality)
  stringValue(manifest.quality.statusNote, 'quality.statusNote')
  if (manifest.quality.statusNote !== quality.statusNote) throw new Error('质量报告与发布包契约不一致')
  const declared = manifest.quality.automatic?.emptyPages
  const reported = quality.automatic?.emptyPages
  if (!Array.isArray(declared) || !Array.isArray(reported)
    || declared.length !== reported.length
    || declared.some((pageNo, index) => pageNo !== reported[index]
      || !Number.isSafeInteger(pageNo) || pageNo < 1 || pageNo > manifest.pageCount)) {
    throw new Error('质量报告与发布包契约不一致')
  }
  // D1 禁止伪造人工复核：trusted 包必须显式承认"未做人工逐页质检"并给出事由。
  if (quality.humanReview?.performed !== false) throw new Error('trusted-baseline 包不得声明已完成人工复核')
  stringValue(quality.humanReview.reason, 'humanReview.reason')
}

function validateQuality(manifest, quality, acceptTrusted) {
  if (manifest.quality.status === TRUSTED_QUALITY_STATUS || quality.status === TRUSTED_QUALITY_STATUS) {
    if (!acceptTrusted) {
      const error = new Error('book-package/v2 声明 trusted-baseline，必须显式开启 --accept-trusted 才能导入')
      error.code = 'HUMAN_REVIEW_REQUIRED'
      throw error
    }
    validateTrustedQuality(manifest, quality)
    return
  }
  if (manifest.quality.status !== 'passed' || quality.status !== 'passed') {
    const error = new Error('book-package/v2 未通过人工质量闸门，禁止导入')
    error.code = 'HUMAN_REVIEW_REQUIRED'
    throw error
  }
  validateQualityIdentity(manifest, quality)
  const review = quality.humanReview
  const minimum = Math.min(30, manifest.pageCount)
  if (review?.schemaVersion !== 'book-package-human-review/v1'
    || review.bookId !== manifest.bookId
    || review.status !== 'passed'
    || !Array.isArray(review.samplePages)
    || new Set(review.samplePages).size !== review.samplePages.length
    || review.samplePages.length < minimum
    || review.samplePages.some((pageNo) => !Number.isSafeInteger(pageNo) || pageNo < 1 || pageNo > manifest.pageCount)
    || !Array.isArray(review.requiredReviewPages)
    || review.requiredReviewPages.some((pageNo) => !review.samplePages.includes(pageNo))
    || !Array.isArray(review.findings)
    || review.findings.some((finding) => finding?.severity === 'blocking')
    || !stringValue(review.reviewer, 'humanReview.reviewer')
    || !stringValue(review.reviewedAt, 'humanReview.reviewedAt')
    || !stringValue(review.evidencePath, 'humanReview.evidencePath')) {
    throw new Error('人工复核证据不满足发布闸门')
  }
  const requiredPages = new Set(quality.automatic.emptyPages || [])
  for (const block of quality.automatic.lowConfidenceBlocks || []) requiredPages.add(block.pageNo)
  for (const pageNo of requiredPages) {
    if (!review.requiredReviewPages.includes(pageNo)) throw new Error(`人工复核遗漏必审物理页 ${pageNo}`)
  }
}

function validateCorrections(manifest, corrections) {
  if (corrections.schemaVersion !== 'ocr-corrections/v1'
    || corrections.bookId !== manifest.bookId
    || corrections.normalizationVersion !== manifest.normalization.version
    || !Array.isArray(corrections.corrections)) throw new Error('校订台账身份或结构无效')
  const entries = new Map()
  for (const correction of corrections.corrections) {
    exactFields(correction, new Set([
      'pageNo', 'blockOrder', 'rawText', 'rawSha256', 'normalizedText', 'reason', 'reviewer', 'reviewedAt',
    ]), 'correction')
    const pageNo = positiveInteger(correction.pageNo, 'correction.pageNo')
    const blockOrder = positiveInteger(correction.blockOrder, 'correction.blockOrder')
    const key = `${pageNo}:${blockOrder}`
    if (entries.has(key)) throw new Error(`校订台账存在重复锚点 ${key}`)
    for (const field of ['rawText', 'normalizedText', 'reason', 'reviewer', 'reviewedAt']) {
      if (typeof correction[field] !== 'string' || !correction[field]) throw new Error(`correction.${field} 必须是非空字符串`)
    }
    if (correction.rawSha256 !== sha256Bytes(Buffer.from(correction.rawText, 'utf8'))) {
      throw new Error('correction.rawSha256 与 rawText 不一致')
    }
    entries.set(key, correction)
  }
  return entries
}

function validateOcrProvenance(manifest, source, report) {
  exactFields(source, new Set([
    'schemaVersion', 'jobId', 'sourceSha256', 'pageCount', 'renderDpi',
    'modelRoute', 'pipelineVersion', 'createdAt', 'originalRecordSha256',
  ]), 'OCR source provenance')
  if (source.schemaVersion !== 'book-package-ocr-source/v2'
    || source.jobId !== manifest.bookId
    || source.sourceSha256 !== manifest.source.sha256
    || source.pageCount !== manifest.pageCount
    || source.modelRoute !== manifest.ocr.modelRoute
    || source.pipelineVersion !== manifest.ocr.pipelineVersion
    || !Number.isSafeInteger(source.renderDpi) || source.renderDpi <= 0
    || !stringValue(source.createdAt, 'OCR source createdAt')
    || !sha256Value(source.originalRecordSha256, 'OCR source originalRecordSha256')) {
    throw new Error('OCR source provenance 与 manifest 不一致')
  }
  exactFields(report, new Set([
    'schemaVersion', 'jobId', 'status', 'sourceSha256', 'sourceSizeBytes',
    'pageCount', 'completedPages', 'failedPages', 'failedPageNos', 'renderDpi',
    'terminalPageCount', 'validation', 'errorCount', 'completedAt', 'originalReportSha256',
  ]), 'OCR report provenance')
  const validations = report.validation
  if (report.schemaVersion !== 'book-package-ocr-report/v2'
    || report.jobId !== manifest.bookId
    || report.status !== 'complete'
    || report.sourceSha256 !== manifest.source.sha256
    || report.sourceSizeBytes !== manifest.source.sizeBytes
    || report.pageCount !== manifest.pageCount
    || report.completedPages !== manifest.pageCount
    || report.terminalPageCount !== manifest.pageCount
    || report.failedPages !== 0
    || !Array.isArray(report.failedPageNos) || report.failedPageNos.length !== 0
    || report.errorCount !== 0
    || report.renderDpi !== source.renderDpi
    || !validations || typeof validations !== 'object' || Array.isArray(validations)
    || Object.keys(validations).length === 0 || Object.values(validations).some((value) => value !== true)
    || !stringValue(report.completedAt, 'OCR report completedAt')
    || !sha256Value(report.originalReportSha256, 'OCR report originalReportSha256')) {
    throw new Error('OCR report provenance 与 manifest 不一致')
  }
}

function validateContent(manifest, content, corrections) {
  if (content.schemaVersion !== 'book-pages/v2' || content.bookId !== manifest.bookId || !Array.isArray(content.pages)) {
    throw new Error('正文文件身份与结构无效')
  }
  if (content.pages.length !== manifest.pageCount) throw new Error('正文物理页数与 manifest 不一致')
  return content.pages.map((page, pageIndex) => {
    const pageNo = pageIndex + 1
    if (page?.pageNo !== pageNo || !Array.isArray(page.blocks)) throw new Error(`物理页 ${pageNo} 顺序或 blocks 无效`)
    if (!Object.hasOwn(page, 'printedPageLabel')
      || (page.printedPageLabel !== null
        && (typeof page.printedPageLabel !== 'string' || page.printedPageLabel.length < 1 || page.printedPageLabel.length > 64))) {
      throw new Error(`物理页 ${pageNo} printedPageLabel 必须显式为 null 或有界字符串`)
    }
    const width = positiveInteger(page.width, `page ${pageNo}.width`)
    const height = positiveInteger(page.height, `page ${pageNo}.height`)
    const rawText = typeof page.rawText === 'string' ? page.rawText : null
    const normalizedText = typeof page.normalizedText === 'string' ? page.normalizedText : null
    if (rawText === null || normalizedText === null) throw new Error(`物理页 ${pageNo} 缺少 rawText/normalizedText`)
    let rawCursor = 0
    let normalizedCursor = 0
    const blocks = page.blocks.map((block, blockIndex) => {
      const order = blockIndex + 1
      const expectedId = `p${String(pageNo).padStart(4, '0')}-b${String(order).padStart(3, '0')}`
      if (block?.blockId !== expectedId || block.order !== order) throw new Error(`物理页 ${pageNo} 块 ${order} 稳定锚点无效`)
      if (typeof block.rawText !== 'string' || typeof block.normalizedText !== 'string') throw new Error(`物理页 ${pageNo} 块 ${order} 文本无效`)
      const correctionKey = `${pageNo}:${order}`
      const correction = corrections.get(correctionKey)
      if (block.rawText !== block.normalizedText) {
        if (!correction
          || correction.rawText !== block.rawText
          || correction.normalizedText !== block.normalizedText) {
          throw new Error(`物理页 ${pageNo} 块 ${order} 的 normalizedText 缺少精确审核校订记录`)
        }
        corrections.delete(correctionKey)
      } else if (correction) {
        if (correction.rawText !== block.rawText || correction.normalizedText !== block.normalizedText) {
          throw new Error(`物理页 ${pageNo} 块 ${order} 与校订台账不一致`)
        }
        corrections.delete(correctionKey)
      }
      if (block.rawCharStart !== rawCursor || block.rawCharEnd !== rawCursor + block.rawText.length
        || block.charStart !== normalizedCursor || block.charEnd !== normalizedCursor + block.normalizedText.length) {
        throw new Error(`物理页 ${pageNo} 块 ${order} 偏移无效`)
      }
      if (block.sourceGeometry?.usage !== 'audit-only' || !block.sourceGeometry.lineBBox) {
        throw new Error(`物理页 ${pageNo} 块 ${order} 几何必须仅用于审计`)
      }
      const confidence = Number(block.confidence)
      if (!(confidence >= 0 && confidence <= 1)) throw new Error(`物理页 ${pageNo} 块 ${order} confidence 无效`)
      const result = {
        id: `${manifest.versionId}:${block.blockId}`,
        blockKey: block.blockId,
        paragraphId: null,
        rawText: block.rawText,
        normalizedText: block.normalizedText,
        charStart: block.charStart,
        charEnd: block.charEnd,
        sourceConfidence: confidence,
        sourceGeometry: block.sourceGeometry,
        geometryUsage: 'audit-only',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      }
      rawCursor = block.rawCharEnd
      normalizedCursor = block.charEnd
      return result
    })
    if (rawText !== blocks.map((block) => block.rawText).join('')
      || normalizedText !== blocks.map((block) => block.normalizedText).join('')) {
      throw new Error(`物理页 ${pageNo} 聚合文本与块文本不一致`)
    }
    return {
      id: `${manifest.versionId}:page:${pageNo}`,
      pageNo,
      printedPageLabel: page.printedPageLabel,
      width,
      height,
      rawText,
      normalizedText,
      blocks,
    }
  })
}

function catalogGradeOf(manifest) {
  if (manifest.grade === undefined) return null
  if (!Number.isSafeInteger(manifest.grade) || manifest.grade < 1 || manifest.grade > 6) {
    throw new Error('manifest.grade 必须是 1 到 6 的整数')
  }
  return manifest.grade
}

function verifyCover(packageRoot, manifest) {
  if (manifest.cover === undefined) return null
  exactFields(manifest.cover, new Set([
    'asset', 'mimeType', 'sha256', 'sizeBytes', 'width', 'height', 'sourcePageNo',
  ]), 'manifest.cover')
  const coverPath = verifiedFile(packageRoot, manifest.cover.asset, manifest.cover.sha256, 'cover')
  if (manifest.cover.asset !== COVER_ASSET_PATH
    || manifest.cover.mimeType !== 'image/jpeg'
    || statSync(coverPath).size !== manifest.cover.sizeBytes) throw new Error('封面元数据无效')
  positiveInteger(manifest.cover.sizeBytes, 'cover.sizeBytes')
  positiveInteger(manifest.cover.width, 'cover.width')
  positiveInteger(manifest.cover.height, 'cover.height')
  const sourcePageNo = positiveInteger(manifest.cover.sourcePageNo, 'cover.sourcePageNo')
  if (sourcePageNo > manifest.pageCount) throw new Error('封面来源物理页超出发布包页数')
  return coverPath
}

function verifyTrustedProvenance(packageRoot, manifest) {
  if (manifest.provenance === undefined) return
  exactFields(manifest.provenance, new Set(['pagesIndex', 'trustedBaseline']), 'manifest.provenance')
  for (const [key, expectedPath] of [
    ['pagesIndex', 'provenance/ocr-pages-index.json'],
    ['trustedBaseline', 'provenance/trusted-baseline.json'],
  ]) {
    const entry = manifest.provenance[key]
    exactFields(entry, new Set(['path', 'sha256']), `manifest.provenance.${key}`)
    if (entry.path !== expectedPath) throw new Error(`manifest.provenance.${key}.path 与 book-package/v2 契约不一致`)
    verifiedFile(packageRoot, entry.path, entry.sha256, `provenance.${key}`)
  }
}

export async function loadBookPackageV2(packageDirectory, dependencies = {}) {
  const acceptTrusted = dependencies.acceptTrusted === true
  const packageRoot = resolve(packageDirectory)
  const manifestPath = safePackageFile(packageRoot, 'manifest.json', 'manifest')
  const manifestBytes = readFileSync(manifestPath)
  const manifest = readJson(manifestPath, 'manifest')
  boundedFields(manifest, MANIFEST_FIELDS, MANIFEST_TRUSTED_FIELDS, 'manifest')
  if (manifest.quality?.status === TRUSTED_QUALITY_STATUS
    && [...MANIFEST_TRUSTED_FIELDS].some((field) => manifest[field] === undefined)) {
    throw new Error('trusted-baseline 包必须提供 grade、cover 与 provenance')
  }
  if (manifest.schemaVersion !== 'book-package/v2'
    || !/^book-[0-9]{3}$/.test(manifest.bookId)
    || !stringValue(manifest.versionId, 'versionId')
    || !stringValue(manifest.title, 'title')) throw new Error('manifest 身份无效')
  positiveInteger(manifest.pageCount, 'pageCount')
  if (manifest.normalization?.version !== 'raw-exact-ledger-v1'
    || manifest.normalization?.policy !== 'raw-exact-unless-ledger-reviewed'
    || !SUPPORTED_RIGHTS_USAGE.has(manifest.rights?.usage)
    || manifest.ocr?.geometryUsage !== 'audit-only-estimated') {
    throw new Error('manifest 归一化、权利或几何契约无效')
  }
  exactFields(manifest.ocr, new Set([
    'jobId', 'modelRoute', 'coordinateSystem', 'geometryUsage', 'pipelineVersion',
    'promptVersion', 'promptAsset', 'promptSha256', 'parserVersion',
    'sourceRecordSha256', 'reportSha256',
  ]), 'manifest.ocr')
  if (manifest.ocr.promptAsset !== 'provenance/ocr-prompt.md'
    || !SUPPORTED_PIPELINE_VERSIONS.has(manifest.ocr.pipelineVersion)
    || !SUPPORTED_PARSER_VERSIONS.has(manifest.ocr.parserVersion)) {
    throw new Error('OCR 管线、提示词或解析器版本契约无效')
  }
  const catalogGrade = catalogGradeOf(manifest)
  const sourcePath = verifiedFile(packageRoot, manifest.source?.asset, manifest.source?.sha256, 'source')
  if (manifest.source.asset !== 'assets/source.pdf'
    || manifest.source.mimeType !== 'application/pdf'
    || statSync(sourcePath).size !== manifest.source.sizeBytes) throw new Error('源 PDF 元数据无效')
  const coverPath = verifyCover(packageRoot, manifest)
  verifyTrustedProvenance(packageRoot, manifest)
  const countPdfPages = dependencies.pdfPageCount || pdfPageCount
  const actualPageCount = await countPdfPages(sourcePath)
  if (actualPageCount !== manifest.pageCount || actualPageCount !== manifest.source.pdfPageCount) {
    throw new Error('源 PDF 物理页数与发布包不一致')
  }
  const contentPath = verifiedFile(packageRoot, manifest.content?.path, manifest.content?.sha256, 'content')
  const correctionsPath = verifiedFile(packageRoot, manifest.corrections?.path, manifest.corrections?.sha256, 'corrections')
  const sourceProvenancePath = verifiedFile(packageRoot, 'provenance/ocr-source.json', manifest.ocr?.sourceRecordSha256, 'OCR source record')
  const reportProvenancePath = verifiedFile(packageRoot, 'provenance/ocr-report.json', manifest.ocr?.reportSha256, 'OCR report')
  verifiedFile(packageRoot, manifest.ocr?.promptAsset, manifest.ocr?.promptSha256, 'OCR prompt')
  validateOcrProvenance(
    manifest,
    readJson(sourceProvenancePath, 'OCR source record'),
    readJson(reportProvenancePath, 'OCR report'),
  )
  const qualityPath = verifiedFile(packageRoot, manifest.quality?.report, manifest.quality?.sha256, 'quality report')
  validateQuality(manifest, readJson(qualityPath, 'quality report'), acceptTrusted)
  const corrections = validateCorrections(manifest, readJson(correctionsPath, 'corrections'))
  const pages = validateContent(manifest, readJson(contentPath, 'content'), corrections)
  if (corrections.size) throw new Error('校订台账包含正文中不存在的锚点')
  const releaseSha256 = sha256Bytes(manifestBytes)
  return {
    packageRoot,
    manifest,
    manifestPath,
    sourcePath,
    coverPath,
    releaseSha256,
    definition: {
      bookId: manifest.bookId,
      versionId: manifest.versionId,
      title: manifest.title,
      label: manifest.versionId,
      sourceFormat: 'pdf',
      catalogGrade,
      packageMetadata: {
        format: 'book-package/v2',
        releaseSha256,
        normalizationVersion: manifest.normalization.version,
        qualityStatus: manifest.quality.status,
        provenance: {
          manifestSha256: releaseSha256,
          source: manifest.source,
          ocr: manifest.ocr,
          content: manifest.content,
          corrections: manifest.corrections,
          rights: manifest.rights,
        },
      },
      pages,
    },
  }
}

function resourceScope(workspace, actorId) {
  const scope = {
    type: workspace.scopeType,
    id: workspace.scopeId,
    scopeType: workspace.scopeType,
    scopeId: workspace.scopeId,
    organizationId: workspace.organizationId,
    ownerId: actorId,
  }
  if (workspace.scopeType === 'class') scope.classId = workspace.scopeId
  if (workspace.scopeType === 'grade') scope.gradeId = workspace.scopeId
  return scope
}

function copyVerifiedAsset(source, destination, expectedSha256, label) {
  mkdirSync(dirname(destination), { recursive: true })
  if (existsSync(destination)) {
    if (sha256File(destination) !== expectedSha256) throw new Error(`目标${label}已存在但内容不同: ${destination}`)
    return false
  }
  copyFileSync(source, destination)
  if (sha256File(destination) !== expectedSha256) {
    unlinkSync(destination)
    throw new Error(`${label}复制后完整性校验失败: ${destination}`)
  }
  return true
}

function packageAssets(loaded) {
  const { bookId, versionId } = loaded.manifest
  const assets = [{
    id: `${versionId}:asset:source-pdf`,
    assetType: 'source_pdf',
    storageKey: `books/pilot/${bookId}/${versionId}/source.pdf`,
    usageLabel: 'INTERNAL PILOT ONLY',
    mimeType: 'application/pdf',
    sizeBytes: loaded.manifest.source.sizeBytes,
    sha256: loaded.manifest.source.sha256,
    sourcePath: loaded.sourcePath,
    label: '源 PDF',
  }]
  if (loaded.coverPath) {
    assets.push({
      id: `${versionId}:asset:cover`,
      assetType: 'cover',
      storageKey: `books/pilot/${bookId}/${versionId}/${COVER_STORAGE_FILENAME}`,
      usageLabel: 'INTERNAL PILOT ONLY',
      mimeType: loaded.manifest.cover.mimeType,
      sizeBytes: loaded.manifest.cover.sizeBytes,
      sha256: loaded.manifest.cover.sha256,
      width: loaded.manifest.cover.width,
      height: loaded.manifest.cover.height,
      sourcePath: loaded.coverPath,
      label: '封面',
    })
  }
  return assets
}

export async function importBookPackageV2({
  databasePath,
  packageDirectory,
  actorId,
  workspaceId,
  publicRoot,
  acceptTrusted = false,
}) {
  if (typeof publicRoot !== 'string' || !publicRoot) throw new Error('--public-root 必须与运行时 PUBLIC_ASSET_DIR 指向同一资产目录')
  const loaded = await loadBookPackageV2(packageDirectory, { acceptTrusted })
  const identity = createIdentityModule({
    databasePath: resolve(databasePath),
    sessionSecret: randomBytes(48).toString('base64url'),
    cookieSecure: false,
  })
  const copiedFiles = []
  try {
    const actor = identity.service.getUser(actorId)
    const workspace = identity.service.resolveWorkspace(actorId, workspaceId)
    if (!workspace) throw new Error('导入账号无权进入指定工作空间')
    const existing = identity.database.prepare(`SELECT
        book.title, book.status, version.package_format, version.release_sha256,
        version.package_quality_status
      FROM books AS book
      JOIN book_versions AS version ON version.book_id = book.id
      WHERE book.id = ? AND version.id = ?
        AND book.organization_id_at_creation = ?
        AND version.organization_id_at_creation = ?`).get(
      loaded.manifest.bookId,
      loaded.manifest.versionId,
      workspace.organizationId,
      workspace.organizationId,
    )
    if (existing) {
      const exact = existing.title === loaded.manifest.title
        && existing.status === 'published'
        && existing.package_format === 'book-package/v2'
        && existing.release_sha256 === loaded.releaseSha256
        && existing.package_quality_status === loaded.manifest.quality.status
      if (!exact) throw new Error('稳定书籍/版本 ID 已存在，但与待导入 release 不一致')
      return {
        imported: false,
        unchanged: true,
        bookId: loaded.manifest.bookId,
        versionId: loaded.manifest.versionId,
        releaseSha256: loaded.releaseSha256,
      }
    }
    const collision = identity.database.prepare(`SELECT 1 FROM books WHERE id = ?
      UNION ALL SELECT 1 FROM book_versions WHERE id = ? LIMIT 1`).get(
      loaded.manifest.bookId,
      loaded.manifest.versionId,
    )
    if (collision) throw new Error('稳定书籍或版本 ID 已被其他资源占用')

    const assets = packageAssets(loaded)
    const registeredAssets = new Map()
    for (const asset of assets) {
      const destination = resolve(publicRoot, asset.storageKey)
      if (copyVerifiedAsset(asset.sourcePath, destination, asset.sha256, asset.label)) copiedFiles.push(destination)
      const { sourcePath, label, ...registered } = asset
      registeredAssets.set(asset.storageKey, registered)
    }
    const scope = resourceScope(workspace, actor.id)
    const authorize = async ({ action, resource }) => identity.service.authorize({
      actor,
      workspace,
      action,
      resourceScope: { ...scope, ...resource, organizationId: workspace.organizationId },
    })
    const reading = createReadingDomain({
      db: identity.database,
      actor,
      workspace,
      authorize,
      idFactory: randomUUID,
      assetMetadataVerifier: async ({ storageKey: requestedKey }) => {
        const registered = registeredAssets.get(requestedKey)
        if (!registered) throw new Error('导入过程请求了未登记的资产键')
        return registered
      },
      audit: (event) => appendAuditEvent(identity.database, {
        eventType: event.eventType,
        actorUserId: actor.id,
        workspaceId: workspace.id,
        resourceType: 'book',
        resourceId: event.resourceId,
        scopeSnapshot: scope,
      }),
    })
    await reading.createBookVersion({ ...loaded.definition, assets: [...registeredAssets.values()] })
    if (loaded.manifest.quality.status === TRUSTED_QUALITY_STATUS) {
      appendAuditEvent(identity.database, {
        eventType: 'book.package.trusted_baseline_accepted',
        actorUserId: actor.id,
        workspaceId: workspace.id,
        resourceType: 'book',
        resourceId: loaded.manifest.bookId,
        reasonCode: TRUSTED_AUDIT_REASON_CODE,
        scopeSnapshot: {
          ...scope,
          versionId: loaded.manifest.versionId,
          releaseSha256: loaded.releaseSha256,
          packageQualityStatus: loaded.manifest.quality.status,
          statusNote: loaded.manifest.quality.statusNote,
          humanReviewPerformed: false,
          acceptTrustedFlag: true,
        },
      })
    }
    await reading.publishBook(loaded.manifest.bookId)
    return {
      imported: true,
      unchanged: false,
      bookId: loaded.manifest.bookId,
      versionId: loaded.manifest.versionId,
      releaseSha256: loaded.releaseSha256,
      publicRoot: resolve(publicRoot),
    }
  } catch (error) {
    for (const copied of copiedFiles) {
      if (existsSync(copied)) unlinkSync(copied)
    }
    throw error
  } finally {
    identity.close()
  }
}

const entrypoint = typeof process !== 'undefined' && process.argv[1] ? resolve(process.argv[1]) : null
if (entrypoint === fileURLToPath(import.meta.url)) {
  const argumentsMap = parseArguments(process.argv.slice(2))
  importBookPackageV2({
    databasePath: argumentsMap.database,
    packageDirectory: argumentsMap.package,
    actorId: argumentsMap['actor-id'],
    workspaceId: argumentsMap['workspace-id'],
    publicRoot: argumentsMap['public-root'],
    acceptTrusted: argumentsMap['accept-trusted'],
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`)
  }).catch((error) => {
    process.stderr.write(`${error.code ? `${error.code}: ` : ''}${error.message}\n`)
    process.exitCode = 1
  })
}
