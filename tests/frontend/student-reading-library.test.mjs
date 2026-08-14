import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function loadLibraryHook() {
  return import('../../src/student/state/useReadingLibrary.js')
}

test('学生阅读对象 API 只调用真实路由并透传工作空间与幂等键', async () => {
  const { createReadingLibraryApi } = await loadLibraryHook()
  const calls = []
  const client = {}
  for (const method of ['get', 'post', 'patch', 'delete']) {
    client[method] = async (path, options) => {
      calls.push({ method: method.toUpperCase(), path, options })
      return { data: {}, meta: {} }
    }
  }
  const api = createReadingLibraryApi(client)
  const readOptions = { workspaceId: 'workspace-a' }
  const writeOptions = { workspaceId: 'workspace-a', idempotencyKey: 'write-1' }

  await api.getSnapshot(readOptions)
  await api.createFavorite({ bookVersionId: 'version-a', position: 0 }, writeOptions)
  await api.updateFavorite('favorite-a', { expectedVersion: 1, position: 2 }, writeOptions)
  await api.deleteFavorite('favorite-a', { expectedVersion: 2 }, writeOptions)
  await api.createList({ name: '暑期书单', position: 0 }, writeOptions)
  await api.addListItem('list-a', { bookVersionId: 'version-a', position: 0 }, writeOptions)
  await api.createBookmark({ bookVersionId: 'version-a', pageNo: 1, label: '这里' }, writeOptions)
  await api.createExcerpt({ bookVersionId: 'version-a', pageNo: 1, quoteText: '原文' }, writeOptions)
  await api.createAnnotation({ bookVersionId: 'version-a', pageNo: 1, body: '批注' }, writeOptions)

  assert.deepEqual(calls, [
    { method: 'GET', path: '/reading/library', options: readOptions },
    { method: 'POST', path: '/reading/library/favorites', options: { ...writeOptions, body: { bookVersionId: 'version-a', position: 0 } } },
    { method: 'PATCH', path: '/reading/library/favorites/favorite-a', options: { ...writeOptions, body: { expectedVersion: 1, position: 2 } } },
    { method: 'DELETE', path: '/reading/library/favorites/favorite-a', options: { ...writeOptions, body: { expectedVersion: 2 } } },
    { method: 'POST', path: '/reading/library/lists', options: { ...writeOptions, body: { name: '暑期书单', position: 0 } } },
    { method: 'POST', path: '/reading/library/lists/list-a/items', options: { ...writeOptions, body: { bookVersionId: 'version-a', position: 0 } } },
    { method: 'POST', path: '/reading/library/bookmarks', options: { ...writeOptions, body: { bookVersionId: 'version-a', pageNo: 1, label: '这里' } } },
    { method: 'POST', path: '/reading/library/excerpts', options: { ...writeOptions, body: { bookVersionId: 'version-a', pageNo: 1, quoteText: '原文' } } },
    { method: 'POST', path: '/reading/library/annotations', options: { ...writeOptions, body: { bookVersionId: 'version-a', pageNo: 1, body: '批注' } } },
  ])
})

test('阅读对象空态来自真实接口结果，不导入 fixture 或 localStorage 业务真相', async () => {
  const source = await readFile(new URL('../../src/student/state/useReadingLibrary.js', import.meta.url), 'utf8')
  assert.match(source, /api\.getSnapshot/)
  assert.match(source, /status:\s*hasLibraryData\(data\)\s*\?\s*'ready'\s*:\s*'empty'/)
  assert.doesNotMatch(source, /localStorage|fixture|mock|\.\.\/data\//i)
})

test('服务端空响应规范化为六个真实空集合，旧足迹不能把空资源变为 ready', async () => {
  const { hasLibraryData, normalizeReadingLibrary } = await loadLibraryHook()
  assert.deepEqual(normalizeReadingLibrary(null), {
    shelf: [],
    favorites: [],
    lists: [],
    bookmarks: [],
    excerpts: [],
    annotations: [],
  })
  assert.deepEqual(normalizeReadingLibrary({ footprints: [{ pageNo: 1, eventType: 'page_stay' }] }), {
    shelf: [],
    favorites: [],
    lists: [],
    bookmarks: [],
    excerpts: [],
    annotations: [],
  })
  assert.equal(hasLibraryData({ footprints: [{ pageNo: 1, eventType: 'page_stay' }] }), false)
})
