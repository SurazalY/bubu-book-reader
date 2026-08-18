import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { toStudentRuntimeDto } from '../../src/adapters/student.js'
import { filterShelfBooks } from '../../src/student/pages/shelfFilters.js'

function idsOf(books) {
  return books.map((book) => book.id)
}

function assertSubsetOfSource(result, source) {
  const sourceIds = new Set(idsOf(source))
  assert.equal(result.length <= source.length, true)
  assert.deepEqual(result.filter((book) => !sourceIds.has(book.id)), [])
  assert.equal(result.every((book) => source.includes(book)), true)
}

test('书架渲染集合等于数据源返回集合，年级筛选只做子集不过入新书', () => {
  const source = [
    { id: 'book-3', title: '三年级读本', author: '甲', grade: 3 },
    { id: 'book-5', title: '五年级读本', author: '乙', grade: 5 },
    { id: 'book-missing', title: '无年级读本', author: '丙', grade: null },
    { id: 'book-string', title: '四年级读本', author: '丁', grade: '4' },
  ]

  const all = filterShelfBooks(source, { group: 'all', option: 'all', query: '' })
  assert.deepEqual(idsOf(all), idsOf(source))
  assertSubsetOfSource(all, source)

  const grade3 = filterShelfBooks(source, { group: 'grade', option: '3', query: '' })
  assert.deepEqual(idsOf(grade3), ['book-3'])
  assertSubsetOfSource(grade3, source)

  const grade4 = filterShelfBooks(source, { group: 'grade', option: '4', query: '' })
  assert.deepEqual(idsOf(grade4), ['book-string'])
  assertSubsetOfSource(grade4, source)

  const grade1 = filterShelfBooks(source, { group: 'grade', option: '1', query: '' })
  assert.deepEqual(idsOf(grade1), [])
  assertSubsetOfSource(grade1, source)

  assert.equal(all.some((book) => book.id === 'book-missing'), true)
  assert.equal(grade3.some((book) => book.id === 'book-missing'), false)
  assert.equal(grade4.some((book) => book.id === 'book-missing'), false)
})

test('学生书目适配器把投影字段 grade 带到前端书对象，缺失则为 null', () => {
  const runtime = toStudentRuntimeDto({
    session: { user: { id: 'student-1' } },
    books: {
      items: [
        { id: 'with-grade', title: '有年级', grade: 2 },
        { id: 'nested-grade', title: '嵌套年级', metadata: { grade: 6 } },
        { id: 'no-grade', title: '缺年级' },
      ],
    },
    progress: { items: [] },
    eyeCare: {},
  })

  assert.equal(runtime.books[0].grade, 2)
  assert.equal(runtime.books[1].grade, 6)
  assert.equal(runtime.books[2].grade, null)
})

test('书籍详情年级胶囊在两级都缺失时不渲染，禁止当前年级 年级半截文案', async () => {
  const detail = await readFile(new URL('../../src/student/pages/BookDetail.jsx', import.meta.url), 'utf8')

  assert.match(detail, /grade:\s*raw\.grade\s*\|\|\s*grade\s*\|\|\s*null/)
  assert.doesNotMatch(detail, /当前年级/)
  assert.match(
    detail,
    /\{book\.grade\s*&&\s*\(\s*<span className="rounded-full bg-white\/70 px-2\.5 py-1 text-micro font-semibold text-ink-600">\s*\{book\.grade\} 年级\s*<\/span>\s*\)\}/,
  )
})

test('书架页只渲染 runtime.books，筛选点击不请求书目、不导入演示书库', async () => {
  const shelf = await readFile(new URL('../../src/student/pages/Shelf.jsx', import.meta.url), 'utf8')
  const filters = await readFile(new URL('../../src/student/pages/shelfFilters.js', import.meta.url), 'utf8')

  assert.match(shelf, /runtime\.data\?\.books/)
  assert.match(shelf, /filterShelfBooks\(books, \{ group, option, query \}\)/)
  assert.match(filters, /key: 'grade'/)
  assert.match(filters, /label: `\$\{grade\} 年级`/)
  assert.doesNotMatch(shelf, /from ['"].*data\/library/)
  assert.doesNotMatch(shelf, /from ['"].*data\/books/)
  assert.doesNotMatch(shelf, /from ['"].*demoStudent/)
  assert.doesNotMatch(filters, /from ['"].*data\/library/)
  assert.doesNotMatch(filters, /from ['"].*data\/books/)
  assert.match(shelf, /onClick=\{\(\) => patchShelfView\(\{ group: g\.key, option: o\.key \}\)\}/)
  assert.doesNotMatch(shelf, /listBooks|refreshInBackground|runtime\.reload|runtime\.refresh\(/)
})
