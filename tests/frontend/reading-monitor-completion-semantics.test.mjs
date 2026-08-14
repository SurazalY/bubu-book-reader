import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { toStudentRuntimeDto } from '../../src/adapters/student.js'
import { buildPersonalBookCollection } from '../../src/student/state/usePersonalReadingAdapter.js'
import { sanitizeReportMetrics } from '../../src/console/state/useReportsData.js'
import { scanRuntimeGraph } from './runtime-import-scan.mjs'

test('直接打开末页只保留位置，不产生完成度或读完语义', () => {
  const runtime = toStudentRuntimeDto({
    session: { activeWorkspaceId: 'workspace-1', user: { id: 'student-1' } },
    books: { items: [{
      id: 'book-1',
      versionId: 'version-1',
      title: '末页测试书',
      progress: { currentPage: 300, totalPages: 300, percent: 100 },
      finished: true,
    }] },
    progress: {},
    eyeCare: {},
  })
  assert.equal(runtime.books[0].progress.currentPage, 300)
  assert.equal(runtime.books[0].progress.totalPages, 300)
  assert.equal(Object.hasOwn(runtime.books[0].progress, 'percent'), false)
  assert.equal(Object.hasOwn(runtime.books[0], 'finished'), false)

  const books = buildPersonalBookCollection([{ ...runtime.books[0], percent: 100, finished: true }], {
    shelf: [], bookmarks: [], favorites: [],
  })
  assert.equal(books[0].progress.currentPage, 300)
  assert.equal(Object.hasOwn(books[0], 'percent'), false)
  assert.equal(Object.hasOwn(books[0], 'finished'), false)
})

test('可达旧消费者不再访问页码完成度、读完或旧事件阅读秒数字段', async () => {
  const paths = [
    '../../src/adapters/student.js',
    '../../src/student/state/usePersonalReadingAdapter.js',
    '../../src/student/components/Progress.jsx',
    '../../src/student/components/BookCard.jsx',
    '../../src/student/pages/Shelf.jsx',
    '../../src/student/pages/BookDetail.jsx',
    '../../src/student/pages/Footprint.jsx',
    '../../src/student/pages/Me.jsx',
    '../../src/student/pages/Ranking.jsx',
    '../../src/student/pages/Lists.jsx',
    '../../src/student/pages/ListDetail.jsx',
    '../../src/student/pages/Usage.jsx',
    '../../src/student/pages/Level.jsx',
    '../../src/console/pages/accounts/StudentDetail.jsx',
    '../../src/console/pages/teaching/BookLibrary.jsx',
    '../../src/console/pages/teaching/BookDetail.jsx',
  ]
  const sources = await Promise.all(paths.map((path) => readFile(new URL(path, import.meta.url), 'utf8')))
  for (const source of sources) {
    assert.doesNotMatch(source, /BookProgress|validReadingSeconds|\.progress\??\.percent|\bstatisticsData\.byBook\b/)
    assert.doesNotMatch(source, /\b(?:book|b|runtime)\.finished\b|\.filter\([^\n]*finished/)
  }
})

test('报告指标移除页数、完成度与开始书目，仅保留非旧阅读指标', () => {
  assert.deepEqual(sanitizeReportMetrics([
    { key: 'pagesRead', label: '已读页数', value: 20, unit: '页' },
    { key: 'startedBookCount', label: '已读书目', value: 2, unit: '本' },
    { key: 'completionPercent', label: '阅读进度', value: 100, unit: '%' },
    { key: 'effectiveMinutes', label: '有效阅读', value: 30, unit: '分钟' },
  ]), [{ key: 'effectiveMinutes', label: '有效阅读', value: 30, unit: '分钟' }])
})

test('Foundation 仍不可达，且不再保留被物理移除的 BookProgress 示例', async () => {
  const graph = scanRuntimeGraph('src/student/StudentApp.jsx')
  assert.equal(graph.modules.includes('src/student/pages/Foundation.jsx'), false)
  assert.equal(graph.modules.includes('src/student/pages/Settings.jsx'), false)
  const source = await readFile(new URL('../../src/student/pages/Foundation.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /BookProgress/)
})
