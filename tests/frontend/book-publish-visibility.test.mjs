import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createConsoleApi } from '../../src/api/console.js'
import { createStage4ConsoleApi, mergeManagedBookItems } from '../../src/api/stage4.js'
import {
  bookGradeValue,
  DRAFT_BOOK_READER_HINT,
  filterLibraryBooks,
} from '../../src/console/pages/teaching/bookLibraryFilters.js'
import { loadBookVisibility } from '../../src/console/state/useBookVisibility.js'
import {
  HUMAN_REVIEW_REQUIRED_MESSAGE,
  OUT_OF_SCOPE_CLASSES_PREFIX,
  createWriteKeyBag,
  describeVisibilityImpact,
  formatBookWriteError,
  previewVisibilityImpact,
  visibilityWriteBody,
} from '../../src/console/pages/teaching/bookManagement.js'
import { findBareProtectedCoverDisplays } from './book-cover-protected-asset.test.mjs'

function response(data, meta = {}) {
  return Promise.resolve({ data, meta })
}

test('发布、下架、设置可见范围三个写操作都带 Idempotency-Key', async () => {
  const calls = []
  const api = createConsoleApi({
    post(path, options) {
      calls.push({ method: 'POST', path, options })
      return response({ bookId: 'book-005', status: path.endsWith('/publish') ? 'published' : 'draft' })
    },
    put(path, options) {
      calls.push({ method: 'PUT', path, options })
      return response({ bookId: 'book-005', scope: 'organization', classIds: [] })
    },
  })

  await api.publishBook('book-005', { workspaceId: 'ws-1', idempotencyKey: 'publish-key-1' })
  await api.unpublishBook('book-005', { workspaceId: 'ws-1', idempotencyKey: 'unpublish-key-1' })
  await api.setBookVisibility('book-005', { scope: 'organization' }, {
    workspaceId: 'ws-1',
    idempotencyKey: 'visibility-key-1',
  })

  assert.deepEqual(calls.map((call) => [call.method, call.path, call.options.idempotencyKey, call.options.workspaceId]), [
    ['POST', '/books/book-005/publish', 'publish-key-1', 'ws-1'],
    ['POST', '/books/book-005/unpublish', 'unpublish-key-1', 'ws-1'],
    ['PUT', '/books/book-005/visibility', 'visibility-key-1', 'ws-1'],
  ])
  assert.equal(calls[2].options.body.scope, 'organization')
  assert.equal(Object.hasOwn(calls[2].options.body, 'classIds'), false)
})

test('可见范围班级选择器走 GET /classes，不走旧的 listClasses 拼装', async () => {
  const calls = []
  const api = createConsoleApi({
    get(path, options) {
      calls.push({ path, options })
      return response({ items: [{ id: 'class-empty', name: '新建空班', gradeId: 'grade-1', studentCount: 0 }] })
    },
  })

  const result = await api.listAuthorizedClasses({ workspaceId: 'ws-1' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, '/classes')
  assert.equal(calls[0].options.workspaceId, 'ws-1')
  assert.equal(result.data.items[0].studentCount, 0)

  const [consoleApi, visibilityHook, panel, detail, library, stage4] = await Promise.all([
    readFile(new URL('../../src/api/console.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/console/state/useBookVisibility.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/console/pages/teaching/BookVisibilityPanel.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/console/pages/teaching/BookDetail.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/console/pages/teaching/BookLibrary.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/api/stage4.js', import.meta.url), 'utf8'),
  ])

  assert.match(consoleApi, /listAuthorizedClasses:\s*\(options = \{\}\) => client\.get\('\/classes'/)
  assert.match(visibilityHook, /listAuthorizedClasses/)
  assert.match(visibilityHook, /getBookVisibility/)
  assert.doesNotMatch(visibilityHook, /listClasses\(/)
  assert.doesNotMatch(visibilityHook, /\/students/)
  assert.doesNotMatch(panel, /listClasses\(/)
  assert.doesNotMatch(panel, /from ['"].*api\/stage4/)
  assert.doesNotMatch(detail, /listClasses\(/)
  assert.doesNotMatch(library, /listClasses\(/)
  assert.match(stage4, /async listClasses\(options = \{\}\) \{\s*const response = await api\.listStudents/)
})

test('收窄可见范围会基于 references 给出提示，而不是无声保存', () => {
  const references = {
    arrangements: [
      {
        assignmentId: 'a-1',
        title: '第一章',
        classes: [
          { id: 'class-a', name: '一年级 A 班' },
          { id: 'class-b', name: '一年级 B 班' },
        ],
      },
    ],
    classroomSessions: [
      {
        sessionId: 's-1',
        classes: [{ id: 'class-a', name: '一年级 A 班' }],
      },
    ],
  }

  const preview = previewVisibilityImpact(references, { scope: 'classes', classIds: ['class-b'] })
  assert.equal(preview.affectedArrangementCount, 1)
  assert.equal(preview.affectedClassroomSessionCount, 1)
  assert.deepEqual(preview.losingClasses.map((item) => item.id), ['class-a'])
  assert.match(
    describeVisibilityImpact(preview, { arrangementTotal: 1 }),
    /还有 1 个阅读安排引用本书，收窄后这些班的学生将无法打开/,
  )

  const widen = previewVisibilityImpact(references, { scope: 'organization' })
  assert.equal(widen.affectedArrangementCount, 0)
  assert.equal(widen.losingClasses.length, 0)
})

test('可见范围编辑页在保存前弹出确认，文案锁住 references 提示', async () => {
  const panel = await readFile(new URL('../../src/console/pages/teaching/BookVisibilityPanel.jsx', import.meta.url), 'utf8')
  assert.match(panel, /previewVisibilityImpact/)
  assert.match(panel, /describeVisibilityImpact/)
  assert.match(panel, /<ConfirmModal/)
  assert.match(panel, /保存前确认影响/)
  assert.match(panel, /classesError/)
  assert.match(panel, /班级列表读取失败，当前可见范围可以查看，但暂时不能编辑/)
  assert.doesNotMatch(panel, /listClasses\(/)
  assert.doesNotMatch(panel, /assignment\.delete|删除阅读安排/)
})

test('新增封面展示位没有裸 img 取受保护资产', async () => {
  const files = [
    '../../src/console/pages/teaching/BookLibrary.jsx',
    '../../src/console/pages/teaching/BookDetail.jsx',
    '../../src/console/pages/teaching/BookVisibilityPanel.jsx',
  ]
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    assert.deepEqual(findBareProtectedCoverDisplays(source), [])
  }
})

test('同一次写操作重试复用同一个 Idempotency-Key，新操作换新键', () => {
  let sequence = 0
  const bag = createWriteKeyBag(() => `uuid-${++sequence}`)
  const first = bag.take('publish:book-005')
  const retry = bag.take('publish:book-005')
  assert.equal(first, retry)
  assert.equal(first, 'publish:book-005:uuid-1')
  bag.clear('publish:book-005')
  const next = bag.take('publish:book-005')
  assert.equal(next, 'publish:book-005:uuid-2')
})

test('422 HUMAN_REVIEW_REQUIRED 与 403 details.classIds 给出可读提示', () => {
  assert.equal(
    formatBookWriteError({ code: 'HUMAN_REVIEW_REQUIRED', message: 'HUMAN_REVIEW_REQUIRED' }, 'publish'),
    HUMAN_REVIEW_REQUIRED_MESSAGE,
  )
  assert.doesNotMatch(HUMAN_REVIEW_REQUIRED_MESSAGE, /HUMAN_REVIEW_REQUIRED/)
  assert.match(
    formatBookWriteError({ code: 'PERMISSION_DENIED', details: { classIds: ['class-x', 'class-y'] } }, 'visibility'),
    new RegExp(`${OUT_OF_SCOPE_CLASSES_PREFIX}：class-x、class-y`),
  )
  assert.doesNotMatch(
    formatBookWriteError({ code: 'PERMISSION_DENIED', details: { classIds: ['class-x'] } }, 'visibility'),
    /没有权限$/,
  )
})

test('organization 写体不带 classIds，classes 写体带 classIds', () => {
  assert.deepEqual(visibilityWriteBody('organization', ['class-a']), { scope: 'organization' })
  assert.deepEqual(visibilityWriteBody('classes', ['class-a', 'class-b']), {
    scope: 'classes',
    classIds: ['class-a', 'class-b'],
  })
})

test('教师端书库按投影字段 grade 筛选，缺年级只进全部与未标注', () => {
  const source = [
    { id: 'book-3', title: '三年级读本', author: '甲', grade: 3, status: 'published' },
    { id: 'book-5', title: '五年级读本', author: '乙', grade: 5, status: 'draft' },
    { id: 'book-missing', title: '无年级读本', author: '丙', grade: null, status: 'published' },
    { id: 'book-string', title: '四年级读本', author: '丁', grade: '4', status: 'published' },
  ]

  assert.deepEqual(filterLibraryBooks(source, { grade: 'all' }).map((book) => book.id), source.map((book) => book.id))
  assert.deepEqual(filterLibraryBooks(source, { grade: '3' }).map((book) => book.id), ['book-3'])
  assert.deepEqual(filterLibraryBooks(source, { grade: '4' }).map((book) => book.id), ['book-string'])
  assert.deepEqual(filterLibraryBooks(source, { grade: 'unspecified' }).map((book) => book.id), ['book-missing'])
  assert.equal(filterLibraryBooks(source, { grade: '3' }).some((book) => book.id === 'book-missing'), false)
  assert.equal(bookGradeValue({ grade: 6 }), 6)
  assert.equal(bookGradeValue({ grade: null }), null)
  assert.equal(bookGradeValue({}), null)
})

test('书库管理列表分别请求 published 与 draft，班级选择器不在这条链上', async () => {
  const calls = []
  const api = createStage4ConsoleApi({
    get(path, options) {
      calls.push({ path, query: options.query })
      if (options.query?.status === 'draft') return response({ items: [] })
      return response({ items: [{ id: 'book-1', title: '已发布', grade: 3 }] })
    },
  })

  const result = await api.loadSurface('bookLibrary', { workspaceId: 'ws-1' })
  assert.equal(result.status, 'ready')
  assert.equal(result.data.items[0].status, 'published')
  assert.equal(result.data.items[0].grade, 3)
  assert.deepEqual(calls.map((call) => [call.path, call.query.status]), [
    ['/books', 'published'],
    ['/books', 'draft'],
  ])
  assert.equal(calls.some((call) => call.path === '/students' || call.path === '/classes'), false)
})

test('教师端管理书目合并 published 与 draft，重复 id 以 published 为准', () => {
  const items = mergeManagedBookItems(
    [{ id: 'book-1', title: '已发布' }, { id: 'book-2', title: '也在草稿里' }],
    [{ id: 'book-2', title: '草稿副本' }, { id: 'book-3', title: '仅草稿' }],
  )
  assert.deepEqual(items.map((book) => [book.id, book.status]), [
    ['book-2', 'published'],
    ['book-3', 'draft'],
    ['book-1', 'published'],
  ])
})

test('书目详情会回退到 draft 列表，避免下架后详情空白', async () => {
  const calls = []
  const api = createStage4ConsoleApi({
    get(path, options) {
      calls.push({ path, query: options.query })
      if (options.query?.status === 'published') return response({ items: [] })
      return response({ items: [{ id: 'book-draft', title: '草稿书' }] })
    },
  })

  const result = await api.getBook('book-draft', { workspaceId: 'ws-1' })
  assert.equal(result.data.status, 'draft')
  assert.equal(result.data.title, '草稿书')
  assert.deepEqual(calls.map((call) => call.query.status), ['published', 'draft'])
})

test('教师端发布管理页面不引用学生端筛选，也不走旧 listClasses', async () => {
  const [library, detail, panel, filters] = await Promise.all([
    readFile(new URL('../../src/console/pages/teaching/BookLibrary.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/console/pages/teaching/BookDetail.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/console/pages/teaching/BookVisibilityPanel.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/console/pages/teaching/bookLibraryFilters.js', import.meta.url), 'utf8'),
  ])
  for (const source of [library, detail, panel, filters]) {
    assert.doesNotMatch(source, /src\/student|student\/pages\/shelfFilters/)
    assert.doesNotMatch(source, /listClasses\(/)
  }
  assert.match(library, /filterLibraryBooks/)
  assert.match(library, /<ConfirmModal/)
  assert.match(detail, /<BookVisibilityPanel/)
  assert.match(detail, /<ConfirmModal/)
  assert.match(filters, /book\?\.grade/)
})

test('关联阅读安排行保留参与完成率，空值显示破折号', async () => {
  const detail = await readFile(new URL('../../src/console/pages/teaching/BookDetail.jsx', import.meta.url), 'utf8')
  assert.match(
    detail,
    /<span className="text-\[11\.5px\] text-ink-500 tabular-nums shrink-0">\{plan\.progress === null \? '—' : `\$\{plan\.progress\}%`\}<\/span>/,
  )
})

test('草稿书在书库卡片、列表行和详情页都禁用教师阅读器', async () => {
  const [detail, library] = await Promise.all([
    readFile(new URL('../../src/console/pages/teaching/BookDetail.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/console/pages/teaching/BookLibrary.jsx', import.meta.url), 'utf8'),
  ])
  assert.match(detail, /DRAFT_BOOK_READER_HINT/)
  assert.match(detail, /用教师阅读器打开/)
  assert.match(library, /function TeacherReaderButton/)
  assert.match(library, /DRAFT_BOOK_READER_HINT/)
  assert.equal(DRAFT_BOOK_READER_HINT, '这本书当前是草稿，重新发布后才能在阅读器里打开。')
  assert.equal((library.match(/TeacherReaderButton/g) || []).length >= 3, true)
})

test('GET /classes 失败时仍返回可见范围，GET /visibility 失败则整次加载失败', async () => {
  const visibilityOk = {
    async getBookVisibility() {
      return { data: { scope: 'organization', classIds: [], classes: [] }, meta: {} }
    },
    async listAuthorizedClasses() {
      const error = new Error('没有权限读取班级列表')
      error.status = 403
      throw error
    },
  }
  const partial = await loadBookVisibility(visibilityOk, { workspaceId: 'ws-1', bookId: 'book-1' })
  assert.equal(partial.data.visibility.scope, 'organization')
  assert.deepEqual(partial.data.classes, [])
  assert.ok(partial.data.classesError)

  const visibilityFail = {
    async getBookVisibility() {
      throw new Error('可见范围读取失败')
    },
    async listAuthorizedClasses() {
      return { data: { items: [{ id: 'class-1', name: '一年级 A 班' }] }, meta: {} }
    },
  }
  await assert.rejects(
    () => loadBookVisibility(visibilityFail, { workspaceId: 'ws-1', bookId: 'book-1' }),
    /可见范围读取失败/,
  )
})
