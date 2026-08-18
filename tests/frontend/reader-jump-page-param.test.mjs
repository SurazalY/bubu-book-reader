import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SRC_ROOT = join(ROOT, 'src')
const READER_PAGE_QUERY = /\/student\/reader\/[^'"\s`]*\?page=/
const READER_PAGE_NO_QUERY = /\/student\/reader\/[^'"\s`]*\?pageNo=/g

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

async function walkSourceFiles(dirPath, collected = []) {
  const entries = await readdir(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const child = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      await walkSourceFiles(child, collected)
      continue
    }
    if (/\.(js|jsx|mjs|ts|tsx)$/.test(entry.name)) collected.push(child)
  }
  return collected
}

test('摘录页两处跳阅读器用 pageNo，不再写 ?page=', async () => {
  const highlights = await source('../../src/student/pages/Highlights.jsx')
  const jumps = highlights.match(/`\/student\/reader\/\$\{g\.bookId\}\?pageNo=\$\{item\.pageNo\}`/g)
  assert.equal(jumps?.length, 2, '书签页码与摘录「去看这一页」都必须带 pageNo')
  assert.doesNotMatch(highlights, /`\/student\/reader\/\$\{g\.bookId\}\?page=\$\{item\.pageNo\}`/)
  assert.doesNotMatch(highlights, READER_PAGE_QUERY)
})

test('社区帖详情跳阅读器用 pageNo，不再写 ?page=', async () => {
  const postDetail = await source('../../src/student/pages/PostDetail.jsx')
  assert.match(postDetail, /`\/student\/reader\/\$\{book\.id\}\?pageNo=\$\{post\.quote\.page\}`/)
  assert.doesNotMatch(postDetail, /`\/student\/reader\/\$\{book\.id\}\?page=\$\{post\.quote\.page\}`/)
  assert.doesNotMatch(postDetail, READER_PAGE_QUERY)
})

test('src 里跳进学生阅读器的查询参数不得再用 ?page=', async () => {
  const files = await walkSourceFiles(SRC_ROOT)
  const offenders = []
  let pageNoJumps = 0
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    if (READER_PAGE_QUERY.test(text)) offenders.push(relative(ROOT, file))
    pageNoJumps += text.match(READER_PAGE_NO_QUERY)?.length ?? 0
    READER_PAGE_NO_QUERY.lastIndex = 0
  }
  assert.deepEqual(offenders, [])
  assert.ok(pageNoJumps >= 3, `至少应有摘录两处与帖详情一处 pageNo 跳转，实际 ${pageNoJumps}`)
})

test('阅读器位置解析只认 pageNo，与跳转参数对齐', async () => {
  const view = await source('../../src/student/reading-monitor/view.js')
  assert.match(view, /queryValues\(params, 'pageNo'\)/)
  assert.doesNotMatch(view, /queryValues\(params, 'page'\)/)
})
