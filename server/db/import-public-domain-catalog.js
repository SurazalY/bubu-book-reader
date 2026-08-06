import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { appendAuditEvent } from './reliability.js'
import { createIdentityModule } from '../domains/identity/index.js'
import { createReadingDomain } from '../domains/reading/catalog.js'

const usage = 'node server/db/import-public-domain-catalog.js --database <sqlite> --manifest <delivery_manifest.json> --actor-id <user> --workspace-id <workspace> [--public-root <public>]'

function parseArguments(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]
    const value = values[index + 1]
    if (!key?.startsWith('--') || !value || value.startsWith('--')) throw new Error(usage)
    parsed[key.slice(2)] = value
  }
  for (const required of ['database', 'manifest', 'actor-id', 'workspace-id']) {
    if (!parsed[required]) throw new Error(usage)
  }
  return parsed
}

function safeSourcePath(root, relativePath) {
  if (isAbsolute(relativePath)) throw new Error('素材清单 relativePath 不能是绝对路径')
  const candidate = resolve(root, relativePath)
  const boundary = relative(root, candidate)
  if (!boundary || boundary.startsWith('..') || isAbsolute(boundary)) throw new Error(`素材路径越界: ${relativePath}`)
  return candidate
}

function digestFile(filename) {
  return createHash('sha256').update(readFileSync(filename)).digest('hex').toUpperCase()
}

function verifyManifestFile(root, entry) {
  const filename = safeSourcePath(root, entry.relativePath)
  const stat = statSync(filename)
  if (stat.size !== entry.bytes || digestFile(filename) !== String(entry.sha256).toUpperCase()) {
    throw new Error(`素材完整性校验失败: ${entry.relativePath}`)
  }
  return filename
}

function mimeType(filename) {
  const extension = extname(filename).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.png') return 'image/png'
  if (extension === '.pdf') return 'application/pdf'
  if (extension === '.txt') return 'text/plain; charset=utf-8'
  throw new Error(`不支持的素材格式: ${extension}`)
}

function storageKey(packageName, filename) {
  return `books/${packageName}/${filename}`
}

function copyVerifiedAsset({ source, destination, expectedSha256, createdFiles }) {
  mkdirSync(dirname(destination), { recursive: true })
  if (existsSync(destination)) {
    if (digestFile(destination) !== expectedSha256) throw new Error(`目标素材已存在但内容不同: ${destination}`)
    return
  }
  copyFileSync(source, destination)
  if (digestFile(destination) !== expectedSha256) {
    unlinkSync(destination)
    throw new Error(`素材复制后校验失败: ${destination}`)
  }
  createdFiles.push(destination)
}

function splitExcerpt(text, count) {
  const paragraphs = text.split(/\r?\n\s*\r?\n/).map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const target = Math.ceil(paragraphs.reduce((total, value) => total + value.length, 0) / count)
  const pages = []
  let current = []
  let length = 0
  for (const paragraph of paragraphs) {
    if (pages.length < count - 1 && current.length && length + paragraph.length > target) {
      pages.push(current.join('\n\n'))
      current = []
      length = 0
    }
    current.push(paragraph)
    length += paragraph.length
  }
  pages.push(current.join('\n\n'))
  while (pages.length < count) pages.push('')
  return pages.slice(0, count)
}

function stableId(prefix, organizationId, packageName) {
  return `${prefix}-${createHash('sha256').update(`${organizationId}:${packageName}`).digest('hex').slice(0, 24)}`
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

function selectedEntry(entries, relativePath) {
  const entry = entries.get(relativePath.replaceAll('\\', '/'))
  if (!entry) throw new Error(`素材清单缺少文件: ${relativePath}`)
  return entry
}

function bookDefinition({ manifestRoot, manifest, packageName, publicRoot, createdFiles }) {
  const entries = new Map(manifest.files.map((entry) => [entry.relativePath.replaceAll('\\', '/'), entry]))
  const prefix = `${packageName}/`
  const rightsEntry = selectedEntry(entries, `${prefix}metadata/sources_and_rights.json`)
  const layoutEntry = selectedEntry(entries, `${prefix}metadata/layout_coordinates.json`)
  const excerptEntry = selectedEntry(entries, `${prefix}source/fixed_layout_excerpt_source.txt`)
  const pdfEntry = selectedEntry(entries, `${prefix}pdf/fixed_layout_test_excerpt.pdf`)
  const coverEntry = selectedEntry(entries, `${prefix}assets/cover_original.jpg`)
  const illustrationOneEntry = [...entries.values()].find((entry) => entry.relativePath.replaceAll('\\', '/') === `${prefix}assets/illustration_01_original${packageName.startsWith('alice') ? '.png' : '.jpg'}`)
  const illustrationTwoEntry = [...entries.values()].find((entry) => entry.relativePath.replaceAll('\\', '/').startsWith(`${prefix}assets/illustration_02_original.`))
  if (!illustrationOneEntry || !illustrationTwoEntry) throw new Error(`素材清单缺少插图: ${packageName}`)

  const rights = JSON.parse(readFileSync(verifyManifestFile(manifestRoot, rightsEntry), 'utf8'))
  const layout = JSON.parse(readFileSync(verifyManifestFile(manifestRoot, layoutEntry), 'utf8'))
  const excerpt = readFileSync(verifyManifestFile(manifestRoot, excerptEntry), 'utf8')
  const pages = splitExcerpt(excerpt, Number(pdfEntry.pdfPages || 4))
  const assetEntries = [
    { entry: pdfEntry, filename: 'fixed_layout_test_excerpt.pdf', assetType: 'source_pdf' },
    { entry: coverEntry, filename: 'cover_original.jpg', assetType: 'cover', image: coverEntry.image },
    { entry: illustrationOneEntry, filename: `illustration_01_original${extname(illustrationOneEntry.relativePath)}`, assetType: 'page_image', pageNo: 2, image: illustrationOneEntry.image },
    { entry: illustrationTwoEntry, filename: `illustration_02_original${extname(illustrationTwoEntry.relativePath)}`, assetType: 'page_image', pageNo: 3, image: illustrationTwoEntry.image },
  ]
  const metadataByStorageKey = new Map()
  for (const asset of assetEntries) {
    const source = verifyManifestFile(manifestRoot, asset.entry)
    const key = storageKey(packageName, asset.filename)
    const destination = resolve(publicRoot, key)
    copyVerifiedAsset({ source, destination, expectedSha256: String(asset.entry.sha256).toUpperCase(), createdFiles })
    metadataByStorageKey.set(key, {
      storageKey: key,
      usageLabel: manifest.label,
      mimeType: mimeType(asset.filename),
      sizeBytes: asset.entry.bytes,
      sha256: String(asset.entry.sha256).toLowerCase(),
      width: asset.image?.width,
      height: asset.image?.height,
      assetType: asset.assetType,
      pageNo: asset.pageNo,
    })
  }
  const pageWidth = Number(layout.pageSizePoints?.width || 792)
  const pageHeight = Number(layout.pageSizePoints?.height || 612)
  return {
    title: rights.book.title,
    label: 'public-domain-internal-test-v1',
    sourceFormat: 'pdf',
    metadata: {
      author: rights.book.author,
      illustrator: rights.book.illustrator,
      sourcePage: rights.sources.projectGutenbergBookPage,
      usageLabel: manifest.label,
      rights,
    },
    assets: [...metadataByStorageKey.values()].filter((asset) => !asset.pageNo),
    pages: pages.map((textContent, index) => {
      const pageNo = index + 1
      const textElement = layout.pages.find((page) => page.page === pageNo)?.elements.find((element) => element.type === 'text' && element.id !== 'page_number')
      const pageAssets = [...metadataByStorageKey.values()].filter((asset) => asset.pageNo === pageNo)
      return {
        pageNo,
        width: pageWidth,
        height: pageHeight,
        textContent,
        blocks: [{
          blockKey: `page-${pageNo}-text`,
          paragraphId: `page-${pageNo}-paragraph`,
          textContent,
          charStart: 0,
          charEnd: textContent.length,
          x: Number(textElement?.x || 46),
          y: Math.max(0, pageHeight - Number(textElement?.y || 512)),
          width: Number(textElement?.width || 450),
          height: Math.max(80, pageHeight - 160),
        }],
        assets: pageAssets,
      }
    }),
    metadataByStorageKey,
  }
}

export async function importPublicDomainCatalog({ databasePath, manifestPath, actorId, workspaceId, publicRoot = 'public' }) {
  const resolvedManifest = resolve(manifestPath)
  const manifestRoot = dirname(resolvedManifest)
  const resolvedPublicRoot = resolve(publicRoot)
  const manifest = JSON.parse(readFileSync(resolvedManifest, 'utf8'))
  if (manifest.label !== 'PUBLIC DOMAIN / INTERNAL TEST MATERIAL' || !Array.isArray(manifest.books) || !Array.isArray(manifest.files)) {
    throw new Error('素材清单不是允许的公共领域内部联调包')
  }
  const identity = createIdentityModule({
    databasePath: resolve(databasePath),
    sessionSecret: randomBytes(48).toString('base64url'),
    cookieSecure: false,
  })
  const createdFiles = []
  try {
    const actor = identity.service.getUser(actorId)
    const workspace = identity.service.resolveWorkspace(actorId, workspaceId)
    if (!workspace) throw new Error('导入账号无权进入指定工作空间')
    const scope = resourceScope(workspace, actor.id)
    const authorize = async ({ action, resource }) => identity.service.authorize({
      actor,
      workspace,
      action,
      resourceScope: { ...scope, ...resource, organizationId: workspace.organizationId },
    })
    const imported = []
    const unchanged = []
    for (const book of manifest.books) {
      const packageName = book.package
      const bookId = stableId('book', workspace.organizationId, packageName)
      const versionId = stableId('version', workspace.organizationId, packageName)
      const existing = identity.database.prepare(`
        SELECT book.title, book.status, metadata.source_page
        FROM books AS book
        LEFT JOIN book_catalog_metadata AS metadata ON metadata.book_id = book.id
        WHERE book.id = ? AND book.organization_id_at_creation = ?
      `).get(bookId, workspace.organizationId)
      if (existing) {
        if (existing.title !== book.title || existing.source_page !== book.sourcePage || existing.status !== 'published') {
          throw new Error(`稳定书目 ID 已存在但内容不一致: ${packageName}`)
        }
        bookDefinition({ manifestRoot, manifest, packageName, publicRoot: resolvedPublicRoot, createdFiles })
        unchanged.push(bookId)
        continue
      }
      const definition = bookDefinition({ manifestRoot, manifest, packageName, publicRoot: resolvedPublicRoot, createdFiles })
      const reading = createReadingDomain({
        db: identity.database,
        actor,
        workspace,
        authorize,
        idFactory: randomUUID,
        assetMetadataVerifier: async ({ storageKey: key }) => definition.metadataByStorageKey.get(key),
        audit: (event) => appendAuditEvent(identity.database, {
          eventType: event.eventType,
          actorUserId: actor.id,
          workspaceId: workspace.id,
          resourceType: 'book',
          resourceId: event.resourceId,
          scopeSnapshot: scope,
        }),
      })
      await reading.createBookVersion({ bookId, versionId, ...definition })
      await reading.publishBook(bookId)
      imported.push(bookId)
    }
    return { imported, unchanged, publicRoot: resolvedPublicRoot }
  } catch (error) {
    for (const filename of createdFiles.reverse()) {
      if (existsSync(filename)) unlinkSync(filename)
    }
    throw error
  } finally {
    identity.close()
  }
}

const entrypoint = typeof process !== 'undefined' && process.argv[1] ? resolve(process.argv[1]) : null
if (entrypoint === fileURLToPath(import.meta.url)) {
  const argumentsMap = parseArguments(process.argv.slice(2))
  importPublicDomainCatalog({
    databasePath: argumentsMap.database,
    manifestPath: argumentsMap.manifest,
    actorId: argumentsMap['actor-id'],
    workspaceId: argumentsMap['workspace-id'],
    publicRoot: argumentsMap['public-root'] || 'public',
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`)
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
