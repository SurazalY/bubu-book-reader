import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createConsoleApi } from '../../src/api/console.js'
import {
  CLASS_SHELF_API_MISSING_MESSAGE,
  CLASS_SHELF_EMPTY_MESSAGE,
  canManageClassShelf,
  classIdOfWorkspace,
  createWriteKeyBag,
  formatBookWriteError,
  formatClassTeacherCount,
  isBookOnClassShelf,
  readTeacherCount,
  requireClassShelfApi,
  shelfBookIdSet,
  shelfItemsOf,
} from '../../src/console/pages/teaching/bookManagement.js'
import { loadClassShelf } from '../../src/console/state/useBookVisibility.js'
import { grantClassShelfBook, revokeClassShelfBook } from '../../src/console/state/useBookWriteActions.js'

function response(data, meta = {}) {
  return Promise.resolve({ data, meta })
}

async function source(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8')
}

test('T8.6B console.js 已有 class-local shelf 三方法，缺方法则停手', () => {
  const api = createConsoleApi()
  assert.equal(typeof api.getClassShelf, 'function')
  assert.equal(typeof api.putClassShelfBook, 'function')
  assert.equal(typeof api.deleteClassShelfBook, 'function')
  assert.equal(typeof api.getBookVisibility, 'undefined')
  assert.equal(typeof api.setBookVisibility, 'undefined')
  assert.equal(requireClassShelfApi(api), api)
  assert.throws(
    () => requireClassShelfApi({}),
    (error) => error instanceof Error && error.message === CLASS_SHELF_API_MISSING_MESSAGE,
  )
})

test('T8.6B 只有 class workspace 能管理本班书架', () => {
  assert.equal(canManageClassShelf({ scopeType: 'class', scopeId: 'class-1' }), true)
  assert.equal(classIdOfWorkspace({ scopeType: 'class', scopeId: 'class-1' }), 'class-1')
  assert.equal(canManageClassShelf({ scopeType: 'school', scopeId: 'org-1' }), false)
  assert.equal(canManageClassShelf({ scopeType: 'grade', scopeId: 'grade-1' }), false)
  assert.equal(canManageClassShelf({ scopeType: 'platform', scopeId: 'platform' }), false)
  assert.equal(canManageClassShelf({ scopeType: 'class', scopeId: '   ' }), false)
  assert.equal(classIdOfWorkspace({ scopeType: 'school', scopeId: 'org-1' }), null)
})

test('T8.6B 空书架文案与 teacherCount 常驻提示', () => {
  assert.equal(CLASS_SHELF_EMPTY_MESSAGE, '暂无已投放图书，请联系任课教师')
  assert.equal(formatClassTeacherCount(2), '本班有 2 位教师可管理')
  assert.equal(formatClassTeacherCount(0), '本班有 0 位教师可管理')
  assert.equal(formatClassTeacherCount(null), '本班有 — 位教师可管理')
  assert.equal(readTeacherCount({ teacherCount: 3 }), 3)
  assert.equal(readTeacherCount({ data: { teacherCount: 1 } }), 1)
  assert.equal(readTeacherCount({ teacherCount: null }), null)
  assert.equal(readTeacherCount({ items: [] }), null)
})

test('T8.6B loadClassShelf 只打 GET /classes/:id/shelf，不打 visibility / GET /classes', async () => {
  const calls = []
  const api = {
    getClassShelf(classId, options) {
      calls.push({ method: 'GET', classId, options })
      return response({ items: [{ bookId: 'book-1', title: '已投放' }], teacherCount: 2 })
    },
    listAuthorizedClasses() {
      throw new Error('不得调用 listAuthorizedClasses')
    },
    getBookVisibility() {
      throw new Error('不得调用 getBookVisibility')
    },
    putClassShelfBook() {
      throw new Error('load 不得写')
    },
    deleteClassShelfBook() {
      throw new Error('load 不得写')
    },
  }

  const empty = await loadClassShelf(api, { workspaceId: 'ws-1' })
  assert.deepEqual(empty.data, { items: [], teacherCount: null, classId: null })
  assert.equal(calls.length, 0)

  const loaded = await loadClassShelf(api, { workspaceId: 'ws-1', classId: 'class-1' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].classId, 'class-1')
  assert.equal(calls[0].options.workspaceId, 'ws-1')
  assert.equal(loaded.data.classId, 'class-1')
  assert.equal(loaded.data.teacherCount, 2)
  assert.equal(isBookOnClassShelf(loaded.data.items, 'book-1'), true)
  assert.equal(isBookOnClassShelf(loaded.data.items, 'book-2'), false)
})

test('T8.6B 投放 PUT / 撤下 DELETE 只打本班路径，写后读取 teacherCount', async () => {
  const calls = []
  const api = createConsoleApi({
    put(path, options) {
      calls.push({ method: 'PUT', path, options })
      return response({ bookId: 'book-1', classId: 'class-1', teacherCount: 2 })
    },
    delete(path, options) {
      calls.push({ method: 'DELETE', path, options })
      return response({ bookId: 'book-1', classId: 'class-1', teacherCount: 2 })
    },
  })

  const granted = await grantClassShelfBook(api, {
    workspaceId: 'ws-1',
    classId: 'class-1',
    bookId: 'book-1',
    idempotencyKey: 'shelf-put-1',
  })
  const revoked = await revokeClassShelfBook(api, {
    workspaceId: 'ws-1',
    classId: 'class-1',
    bookId: 'book-1',
    idempotencyKey: 'shelf-del-1',
  })

  assert.equal(granted.teacherCount, 2)
  assert.equal(revoked.teacherCount, 2)
  assert.deepEqual(calls.map((call) => [call.method, call.path, call.options.idempotencyKey, call.options.workspaceId]), [
    ['PUT', '/classes/class-1/shelf/book-1', 'shelf-put-1', 'ws-1'],
    ['DELETE', '/classes/class-1/shelf/book-1', 'shelf-del-1', 'ws-1'],
  ])
  assert.equal(Object.hasOwn(calls[0].options, 'body') ? Array.isArray(calls[0].options.body?.classIds) : false, false)
})

test('T8.6B 同一次投放/撤下重试复用同一个 Idempotency-Key', () => {
  let sequence = 0
  const bag = createWriteKeyBag(() => `uuid-${++sequence}`)
  const first = bag.take('shelf-grant:class-1:book-1')
  const retry = bag.take('shelf-grant:class-1:book-1')
  assert.equal(first, retry)
  bag.clear('shelf-grant:class-1:book-1')
  const next = bag.take('shelf-grant:class-1:book-1')
  assert.equal(next, 'shelf-grant:class-1:book-1:uuid-2')
})

test('T8.6B 书架写错误可读，不提全局发布', () => {
  assert.equal(
    formatBookWriteError({ code: 'PERMISSION_DENIED' }, 'grant'),
    '你没有权限把这本书投放到本班。',
  )
  assert.equal(
    formatBookWriteError({ code: 'PERMISSION_DENIED' }, 'revoke'),
    '你没有权限从本班撤下这本书。',
  )
  assert.doesNotMatch(formatBookWriteError({ code: 'PERMISSION_DENIED' }, 'grant'), /发布|下架|可见范围/)
})

test('T8.6B 书架 items 解析与本班判定', () => {
  assert.deepEqual([...shelfBookIdSet(shelfItemsOf({ items: [{ id: 'a' }, { bookId: 'b' }] }))].sort(), ['a', 'b'])
  assert.equal(isBookOnClassShelf([{ bookId: 'book-9' }], 'book-9'), true)
  assert.equal(isBookOnClassShelf([], 'book-9'), false)
})

test('T8.6B 教学页删除全局发布/旧 visibility，改本班投放且校长年级无入口', async () => {
  const files = {
    library: await source('../../src/console/pages/teaching/BookLibrary.jsx'),
    detail: await source('../../src/console/pages/teaching/BookDetail.jsx'),
    panel: await source('../../src/console/pages/teaching/BookVisibilityPanel.jsx'),
    importPage: await source('../../src/console/pages/teaching/BookImport.jsx'),
    reader: await source('../../src/console/pages/teaching/TeacherReader.jsx'),
    visibilityHook: await source('../../src/console/state/useBookVisibility.js'),
    writeHook: await source('../../src/console/state/useBookWriteActions.js'),
  }

  for (const [name, text] of Object.entries(files)) {
    assert.doesNotMatch(text, /getBookVisibility|setBookVisibility/, `${name} 不得再调旧 visibility`)
    assert.doesNotMatch(text, /listAuthorizedClasses/, `${name} 不得打 GET /classes 并集`)
    assert.doesNotMatch(text, /演示环境/, `${name} 不得再写演示环境不写入`)
    assert.doesNotMatch(text, /全组织可见|scope:\s*'organization'|全局发布/, `${name} 不得保留全组织/全局发布入口`)
  }

  assert.doesNotMatch(files.library, /unpublishBook|publishBook/)
  assert.doesNotMatch(files.detail, /unpublishBook|publishBook/)
  assert.doesNotMatch(files.writeHook, /publishBook|unpublishBook|setBookVisibility/)
  assert.match(files.writeHook, /putClassShelfBook/)
  assert.match(files.writeHook, /deleteClassShelfBook/)
  assert.match(files.visibilityHook, /getClassShelf/)
  assert.match(files.library, /投放本班/)
  assert.match(files.library, /从本班撤下/)
  assert.match(files.library, /canManageClassShelf/)
  assert.match(files.library, /ClassTeacherCountBanner/)
  assert.match(files.library, /CLASS_SHELF_EMPTY_MESSAGE|暂无已投放图书，请联系任课教师/)
  assert.match(files.panel, /formatClassTeacherCount/)
  assert.match(files.panel, /ClassTeacherCountBanner/)
  assert.match(files.panel, /CLASS_SHELF_EMPTY_MESSAGE|暂无已投放图书，请联系任课教师/)
  assert.match(files.panel, /applyTeacherCount/)
  assert.match(files.panel, /canManageClassShelf/)
  assert.match(files.detail, /canManageClassShelf/)
  assert.match(files.detail, /<BookVisibilityPanel/)
  assert.doesNotMatch(files.detail, /<ConfirmModal/)
  assert.doesNotMatch(files.library, /title="下架"|title="重新发布"/)
  assert.doesNotMatch(files.importPage, /已提交导入/)
  assert.match(files.importPage, /学校端本期不提供书库导入/)
  assert.doesNotMatch(files.panel, /pending|approved|teacher\.affiliation\.approve/)
  assert.doesNotMatch(files.library, /pending|approved|teacher\.affiliation\.approve/)
})

test('T8.6B 校长/年级主任源码路径没有本班投放按钮的无条件渲染', async () => {
  const library = await source('../../src/console/pages/teaching/BookLibrary.jsx')
  const detail = await source('../../src/console/pages/teaching/BookDetail.jsx')
  const panel = await source('../../src/console/pages/teaching/BookVisibilityPanel.jsx')
  assert.match(library, /manageShelf &&/)
  assert.match(detail, /manageShelf && published/)
  assert.match(panel, /if \(!manage\) return null/)
})
