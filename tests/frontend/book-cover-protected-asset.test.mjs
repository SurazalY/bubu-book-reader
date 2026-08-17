import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const coverUrl = new URL('../../src/student/components/BookCover.jsx', import.meta.url)
const cardUrl = new URL('../../src/student/components/BookCard.jsx', import.meta.url)
const homeUrl = new URL('../../src/student/pages/Home.jsx', import.meta.url)
const uiCoverUrl = new URL('../../src/components/ui.jsx', import.meta.url)

test('学生首页与书架封面走受保护资产接口，不回退公开 /covers/', async () => {
  const [cover, card, home] = await Promise.all([
    readFile(coverUrl, 'utf8'),
    readFile(cardUrl, 'utf8'),
    readFile(homeUrl, 'utf8'),
  ])

  assert.match(card, /import BookCover from '\.\/BookCover\.jsx'/)
  assert.match(home, /import BookCover from '\.\.\/components\/BookCover\.jsx'/)
  assert.match(cover, /book\?\.coverUrl/)
  assert.match(cover, /'X-Workspace-Id': workspaceId/)
  assert.match(cover, /credentials:\s*['"]include['"]/)
  assert.match(cover, /URL\.createObjectURL/)
  assert.doesNotMatch(cover, /covers\/\$\{/)
  assert.doesNotMatch(cover, /BASE_URL\}covers/)
  assert.doesNotMatch(cover, /\/covers\//)
})

test('共享 ui BookCover 的公开 /covers/ 回退不得被学生首页与书架卡片使用', async () => {
  const ui = await readFile(uiCoverUrl, 'utf8')
  assert.match(ui, /covers\/\$\{book\.id\}\.jpg/)
})
