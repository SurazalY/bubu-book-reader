import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function readStudentSource(relativePath) {
  return readFile(new URL(`../../src/student/${relativePath}`, import.meta.url), 'utf8')
}

function assertContains(source, pattern, label) {
  assert.ok(pattern.test(source), label)
}

test('Reader ready 态保留冻结翻页、AI、课堂、吉祥物与抽屉结构', async () => {
  const reader = await readStudentSource('pages/Reader.jsx')

  for (const component of [
    'HTMLFlipBook',
    'AiPanel',
    'ClassroomAura',
    'ClassroomBar',
    'MascotDock',
    'ReaderMissing',
  ]) {
    assertContains(reader, new RegExp(`<${component}\\b|function ${component}\\b`), component)
  }

  for (const className of [
    'student-flip-shell',
    'student-flip',
    'student-drawer',
    'student-drawer-body',
    'student-drawer-row',
    'student-drawer-teacher',
  ]) {
    assertContains(reader, new RegExp(className), className)
  }
  assert.doesNotMatch(reader, /ReaderStatePage/)
  assert.doesNotMatch(reader, /from ['"][^'"]*(?:data|fixtures|demo)/)
})

test('Home ready 态保留冻结五列书架、浮动书单与卡片结构', async () => {
  const [home, card, cover, page, navigation, overlays] = await Promise.all([
    readStudentSource('pages/Home.jsx'),
    readStudentSource('components/BookCard.jsx'),
    readStudentSource('components/BookCover.jsx'),
    readStudentSource('components/BookPage.jsx'),
    readStudentSource('components/BottomNav.jsx'),
    readStudentSource('components/ReaderOverlays.jsx'),
  ])

  assert.ok(
    home.match(/grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5/g)?.length >= 2,
    '快捷入口与书架都应保留冻结五列响应式结构',
  )
  assertContains(home, /student-list-move absolute -top-2 right-3/, 'Home 浮动书单按钮')
  assertContains(home, /student-stagger group relative flex items-center gap-3 p-3/, 'Home 书单卡片')
  assertContains(card, /student-book-card student-stagger group flex cursor-pointer flex-col p-3 text-left/, 'BookCard 外层结构')
  assertContains(card, /<BookCover\s+book={book}\s+className="student-cover"/, 'BookCard 原封面结构')
  assertContains(cover, /relative aspect-\[3\/4\] rounded-xl overflow-hidden shadow-e2/, 'BookCover 冻结比例与层次')
  assertContains(card, /className="student-like absolute right-2 top-2/, 'BookCard 收藏按钮')
  assertContains(page, /import PageArt from '.\/PageArt\.jsx'/, 'BookPage PageArt 导入')
  assertContains(page, /<PageArt\s+kind={figure\.kind}\s+src={figure\.url}\s*\/>/, 'BookPage PageArt 渲染')
  assertContains(navigation, /student-navbar/, 'BottomNav 导航结构')
  assertContains(overlays, /student-sel-toolbar/, 'ReaderOverlays 选文工具栏')
  assertContains(overlays, /student-tray/, 'ReaderOverlays 跨页托盘')
})
