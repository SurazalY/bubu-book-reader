import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { loadProtectedAsset } from '../../src/shared/useProtectedAssetUrl.js'

const srcDir = fileURLToPath(new URL('../../src/', import.meta.url))
const coverUrl = new URL('../../src/student/components/BookCover.jsx', import.meta.url)
const cardUrl = new URL('../../src/student/components/BookCard.jsx', import.meta.url)
const homeUrl = new URL('../../src/student/pages/Home.jsx', import.meta.url)
const uiCoverUrl = new URL('../../src/components/ui.jsx', import.meta.url)
const hookUrl = new URL('../../src/shared/useProtectedAssetUrl.js', import.meta.url)
const postCardUrl = new URL('../../src/student/components/PostCard.jsx', import.meta.url)
const bookLibraryUrl = new URL('../../src/console/pages/teaching/BookLibrary.jsx', import.meta.url)

const BARE_IMG_SRC = /<img\b[\s\S]{0,800}?\bsrc=\s*\{\s*(?:[A-Za-z_$][\w$]*\??\.)?(?:coverUrl|cover\?\.url|cover\.url)\s*\}/g
const BARE_IMG_TEMPLATE = /<img\b[\s\S]{0,800}?\bsrc=\s*\{\s*`[\s\S]*?\$\{[\s\S]*?(?:coverUrl|cover\?\.url|cover\.url)/g
const BARE_CSS_URL = /url\(\s*(?:["'`]\$\{|\$\{)[\s\S]*?(?:coverUrl|cover\?\.url|cover\.url)/g

export function findBareProtectedCoverDisplays(source) {
  const findings = []
  for (const pattern of [BARE_IMG_SRC, BARE_IMG_TEMPLATE, BARE_CSS_URL]) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(source))) {
      findings.push(match[0].replace(/\s+/g, ' ').slice(0, 160))
    }
  }
  return findings
}

async function listSourceFiles(dir = srcDir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      files.push(...await listSourceFiles(full))
    } else if (entry.isFile() && (extname(entry.name) === '.js' || extname(entry.name) === '.jsx')) {
      files.push(full)
    }
  }
  return files
}

test('学生首页与书架封面走受保护资产接口，不回退公开 /covers/', async () => {
  const [cover, card, home, hook] = await Promise.all([
    readFile(coverUrl, 'utf8'),
    readFile(cardUrl, 'utf8'),
    readFile(homeUrl, 'utf8'),
    readFile(hookUrl, 'utf8'),
  ])

  assert.match(card, /import BookCover from '\.\/BookCover\.jsx'/)
  assert.match(home, /import BookCover from '\.\.\/components\/BookCover\.jsx'/)
  assert.match(cover, /import \{ useProtectedAssetUrl \} from '\.\.\/\.\.\/shared\/useProtectedAssetUrl\.js'/)
  assert.match(cover, /book\?\.coverUrl/)
  assert.match(hook, /'X-Workspace-Id': workspaceId/)
  assert.match(hook, /credentials:\s*['"]include['"]/)
  assert.match(hook, /URL\.createObjectURL/)
  assert.match(hook, /URL\.revokeObjectURL/)
  assert.doesNotMatch(cover, /covers\/\$\{/)
  assert.doesNotMatch(cover, /BASE_URL\}covers/)
  assert.doesNotMatch(cover, /\/covers\//)
})

test('共享 ui BookCover 走带头 fetch，且不再出现公开 /covers/ 回退', async () => {
  const ui = await readFile(uiCoverUrl, 'utf8')
  assert.match(ui, /useProtectedAssetUrl/)
  assert.match(ui, /resolveCoverAssetUrl\(book\)/)
  assert.doesNotMatch(ui, /covers\/\$\{book\.id\}\.jpg/)
  assert.doesNotMatch(ui, /BASE_URL\}covers/)
  assert.doesNotMatch(ui, /\/covers\//)
})

test('教师端书库封面走带头 fetch，不把受保护 URL 写入 CSS url()', async () => {
  const library = await readFile(bookLibraryUrl, 'utf8')
  assert.match(library, /useProtectedAssetUrl/)
  assert.match(library, /'X-Workspace-Id'|useProtectedAssetUrl\(/)
  assert.doesNotMatch(library, /url\(\$\{/)
  assert.doesNotMatch(library, /backgroundImage:\s*`url\(/)
})

test('社区帖卡不再使用公开 /covers/ 字面量', async () => {
  const postCard = await readFile(postCardUrl, 'utf8')
  assert.match(postCard, /useProtectedAssetUrl/)
  assert.match(postCard, /book\?\.coverUrl/)
  assert.doesNotMatch(postCard, /covers\/\$\{book\.id\}\.jpg/)
  assert.doesNotMatch(postCard, /BASE_URL\}covers/)
})

test('源码里不存在把受保护封面 URL 直接塞进裸 img src 或 CSS url() 的展示位', async () => {
  const files = await listSourceFiles()
  const violations = []
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const findings = findBareProtectedCoverDisplays(source)
    if (findings.length) {
      violations.push(`${relative(srcDir, file).replaceAll('\\', '/')}: ${findings.join(' | ')}`)
    }
  }
  assert.equal(violations.length, 0, `发现绕过共享 hook 的封面展示位:\n${violations.join('\n')}`)
})

test('资产接口返回 404 时 loadProtectedAsset 降级为失败且不抛异常', async () => {
  const calls = []
  const result = await loadProtectedAsset('/api/v1/books/assets/missing', 'workspace-1', {
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return { ok: false, status: 404, blob: async () => { throw new Error('404 不应读取 body') } }
    },
  })
  assert.equal(result.failed, true)
  assert.equal(result.objectUrl, null)
  assert.equal(calls[0].options.credentials, 'include')
  assert.equal(calls[0].options.headers['X-Workspace-Id'], 'workspace-1')
  assert.equal(calls[0].options.headers.Accept, 'image/*')
})

test('资产接口 403/400 与网络错误同样降级，不把异常抛给调用方', async () => {
  const denied = await loadProtectedAsset('/api/v1/books/assets/denied', 'workspace-1', {
    fetchImpl: async () => ({ ok: false, status: 403, blob: async () => new Blob() }),
  })
  const badRequest = await loadProtectedAsset('/api/v1/books/assets/bad', 'workspace-1', {
    fetchImpl: async () => ({ ok: false, status: 400, blob: async () => new Blob() }),
  })
  const offline = await loadProtectedAsset('/api/v1/books/assets/offline', 'workspace-1', {
    fetchImpl: async () => { throw new TypeError('Failed to fetch') },
  })
  assert.deepEqual(denied, { objectUrl: null, failed: true })
  assert.deepEqual(badRequest, { objectUrl: null, failed: true })
  assert.deepEqual(offline, { objectUrl: null, failed: true })
})

test('ui BookCover 与教师书库在失败时走占位而不是抛异常', async () => {
  const [ui, library, hook] = await Promise.all([
    readFile(uiCoverUrl, 'utf8'),
    readFile(bookLibraryUrl, 'utf8'),
    readFile(hookUrl, 'utf8'),
  ])
  assert.match(hook, /catch\s*\{/)
  assert.match(hook, /failed:\s*true/)
  assert.match(ui, /const available = Boolean\(objectUrl\) && !failed/)
  assert.match(ui, /available &&/)
  assert.match(library, /const available = Boolean\(objectUrl\) && !failed/)
  assert.match(library, /\(!url \|\| failed\)/)
})
