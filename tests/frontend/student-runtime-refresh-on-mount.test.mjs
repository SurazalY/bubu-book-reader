import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { ApiError } from '../../src/api/envelope.js'
import {
  nextStateAfterBackgroundFailure,
  nextStateAfterBackgroundSuccess,
} from '../../src/api/useApiResource.js'
import { buildPersonalBookCollection } from '../../src/student/state/usePersonalReadingAdapter.js'

function toDetailProgressView(rawBook) {
  const progress = rawBook?.progress || {}
  return {
    page: Number.isSafeInteger(progress.currentPage) ? progress.currentPage : null,
    minutes: Number.isFinite(progress.effectiveMinutes) ? progress.effectiveMinutes : null,
  }
}

function createStudentRuntimeLoader(initialBooks, freshBooks) {
  let callCount = 0
  return async () => {
    callCount += 1
    return {
      data: {
        workspaceId: 'workspace-a',
        books: callCount === 1 ? initialBooks : freshBooks,
      },
      meta: { requestId: `request-${callCount}` },
    }
  }
}

async function simulateProviderBackgroundRefresh(previousState, loader) {
  const result = await loader()
  return nextStateAfterBackgroundSuccess(previousState, result)
}

test('后台刷新成功时不进入 loading，且用服务端新进度覆盖旧 books', async () => {
  const staleBooks = [{
    id: 'book-001',
    versionId: 'version-001',
    title: '和大人一起读·儿童歌谣',
    progress: { currentPage: 5, totalPages: 98, effectiveMinutes: 2 },
  }]
  const freshBooks = [{
    id: 'book-001',
    versionId: 'version-001',
    title: '和大人一起读·儿童歌谣',
    progress: { currentPage: 21, totalPages: 98, effectiveMinutes: 7 },
  }]
  const loader = createStudentRuntimeLoader(staleBooks, freshBooks)

  const providerState = {
    status: 'ready',
    data: { workspaceId: 'workspace-a', books: staleBooks },
    error: null,
    meta: { requestId: 'request-0' },
  }

  await loader()
  const refreshed = await simulateProviderBackgroundRefresh(providerState, loader)

  assert.equal(providerState.status, 'ready')
  assert.equal(refreshed.status, 'ready')
  assert.notEqual(refreshed.data.books[0].progress.currentPage, 5)
  assert.equal(refreshed.data.books[0].progress.currentPage, 21)
  assert.equal(refreshed.data.books[0].progress.effectiveMinutes, 7)
})

test('从阅读器返回详情页：Provider 仍持旧 runtime，详情页挂载后台刷新后页码与有效阅读时长更新', async () => {
  const bookId = 'book-001'
  const staleRuntimeBooks = [{
    id: bookId,
    versionId: 'version-001',
    title: '和大人一起读·儿童歌谣',
    progress: { currentPage: 5, totalPages: 98, effectiveMinutes: 2 },
  }]
  const freshRuntimeBooks = [{
    id: bookId,
    versionId: 'version-001',
    title: '和大人一起读·儿童歌谣',
    progress: { currentPage: 21, totalPages: 98, effectiveMinutes: 7 },
  }]

  const providerRuntime = {
    status: 'ready',
    data: { workspaceId: 'workspace-a', books: staleRuntimeBooks },
    error: null,
    meta: {},
  }

  const beforeReturn = toDetailProgressView(providerRuntime.data.books.find((book) => book.id === bookId))
  assert.deepEqual(beforeReturn, { page: 5, minutes: 2 })

  const loader = createStudentRuntimeLoader(staleRuntimeBooks, freshRuntimeBooks)
  await loader()
  const afterRefresh = await simulateProviderBackgroundRefresh(providerRuntime, loader)
  providerRuntime.data = afterRefresh.data

  const afterReturn = toDetailProgressView(providerRuntime.data.books.find((book) => book.id === bookId))
  assert.deepEqual(afterReturn, { page: 21, minutes: 7 })
})

test('书架/书单页与详情页共用 runtime.books，后台刷新后 buildPersonalBookCollection 同步新进度', async () => {
  const staleBooks = [{
    id: 'book-001',
    versionId: 'version-001',
    title: '和大人一起读·儿童歌谣',
    progress: { currentPage: 5, totalPages: 98, effectiveMinutes: 2 },
  }]
  const freshBooks = [{
    id: 'book-001',
    versionId: 'version-001',
    title: '和大人一起读·儿童歌谣',
    progress: { currentPage: 21, totalPages: 98, effectiveMinutes: 7 },
  }]
  const loader = createStudentRuntimeLoader(staleBooks, freshBooks)
  await loader()
  const refreshed = await simulateProviderBackgroundRefresh({ status: 'ready', data: { books: staleBooks } }, loader)
  const collection = buildPersonalBookCollection(refreshed.data.books, { shelf: [], favorites: [], lists: [], bookmarks: [], excerpts: [], annotations: [] })
  assert.equal(collection[0].page, 21)
  assert.equal(collection[0].minutes, 7)
})

test('后台刷新失败且已有旧数据时保持 ready，不把页面打回空态', () => {
  const previous = {
    status: 'ready',
    data: { books: [{ id: 'book-001', progress: { currentPage: 5, effectiveMinutes: 2 } }] },
    error: null,
    meta: {},
  }
  const next = nextStateAfterBackgroundFailure(previous, new ApiError({ code: 'DEPENDENCY_UNAVAILABLE', message: 'offline', retryable: true }))
  assert.equal(next.status, 'ready')
  assert.equal(next.data.books[0].progress.currentPage, 5)
  assert.equal(next.error.code, 'DEPENDENCY_UNAVAILABLE')
})

test('展示阅读进度的学生页在挂载时调用 useRefreshStudentRuntimeOnMount', async () => {
  const pages = [
    '../../src/student/pages/BookDetail.jsx',
    '../../src/student/pages/Shelf.jsx',
    '../../src/student/pages/Lists.jsx',
    '../../src/student/pages/ListDetail.jsx',
    '../../src/student/pages/Ranking.jsx',
  ]
  const sources = await Promise.all(pages.map((page) => readFile(new URL(page, import.meta.url), 'utf8')))
  for (const source of sources) {
    assert.match(source, /useRefreshStudentRuntimeOnMount\(\)/)
    assert.match(source, /import useRefreshStudentRuntimeOnMount/)
  }
})

test('useRefreshStudentRuntimeOnMount 只在挂载时触发 refreshInBackground，不因 runtime 更新循环请求', async () => {
  const source = await readFile(new URL('../../src/student/state/useRefreshStudentRuntimeOnMount.js', import.meta.url), 'utf8')
  assert.match(source, /refreshInBackground/)
  assert.match(source, /useEffect\(\(\) => \{[\s\S]*refreshInBackground\.current/, '挂载 effect 通过 ref 调用后台刷新')
  assert.doesNotMatch(source, /\[runtime\.refreshInBackground\]/)
})
