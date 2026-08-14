import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createApiClient } from '../../api/client.js'
import { asApiError } from '../../api/envelope.js'

const EMPTY_LIBRARY = Object.freeze({
  shelf: Object.freeze([]),
  favorites: Object.freeze([]),
  lists: Object.freeze([]),
  bookmarks: Object.freeze([]),
  excerpts: Object.freeze([]),
  annotations: Object.freeze([]),
})

export function normalizeReadingLibrary(value) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    shelf: Array.isArray(source.shelf) ? source.shelf : [],
    favorites: Array.isArray(source.favorites) ? source.favorites : [],
    lists: Array.isArray(source.lists) ? source.lists : [],
    bookmarks: Array.isArray(source.bookmarks) ? source.bookmarks : [],
    excerpts: Array.isArray(source.excerpts) ? source.excerpts : [],
    annotations: Array.isArray(source.annotations) ? source.annotations : [],
  }
}

export function hasLibraryData(value) {
  return Object.values(normalizeReadingLibrary(value)).some((items) => items.length > 0)
}

export function createReadingLibraryApi(client = createApiClient()) {
  const objectApi = (name) => ({
    create: (body, options = {}) => client.post(`/reading/library/${name}`, { ...options, body }),
    update: (id, body, options = {}) => client.patch(`/reading/library/${name}/${encodeURIComponent(id)}`, { ...options, body }),
    remove: (id, body, options = {}) => client.delete(`/reading/library/${name}/${encodeURIComponent(id)}`, { ...options, body }),
  })
  const favorites = objectApi('favorites')
  const bookmarks = objectApi('bookmarks')
  const excerpts = objectApi('excerpts')
  const annotations = objectApi('annotations')

  return {
    getSnapshot: (options = {}) => client.get('/reading/library', options),
    createFavorite: favorites.create,
    updateFavorite: favorites.update,
    deleteFavorite: favorites.remove,
    createList: (body, options = {}) => client.post('/reading/library/lists', { ...options, body }),
    updateList: (id, body, options = {}) => client.patch(`/reading/library/lists/${encodeURIComponent(id)}`, { ...options, body }),
    deleteList: (id, body, options = {}) => client.delete(`/reading/library/lists/${encodeURIComponent(id)}`, { ...options, body }),
    addListItem: (listId, body, options = {}) => client.post(`/reading/library/lists/${encodeURIComponent(listId)}/items`, { ...options, body }),
    updateListItem: (id, body, options = {}) => client.patch(`/reading/library/list-items/${encodeURIComponent(id)}`, { ...options, body }),
    deleteListItem: (id, body, options = {}) => client.delete(`/reading/library/list-items/${encodeURIComponent(id)}`, { ...options, body }),
    createBookmark: bookmarks.create,
    updateBookmark: bookmarks.update,
    deleteBookmark: bookmarks.remove,
    createExcerpt: excerpts.create,
    updateExcerpt: excerpts.update,
    deleteExcerpt: excerpts.remove,
    createAnnotation: annotations.create,
    updateAnnotation: annotations.update,
    deleteAnnotation: annotations.remove,
  }
}

function newWriteKey(prefix, sequence) {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('当前浏览器无法生成安全的阅读对象写入标识')
  }
  return `${prefix}-${sequence}-${globalThis.crypto.randomUUID()}`
}

export default function useReadingLibrary({ workspaceId, api: suppliedApi } = {}) {
  const api = useMemo(() => suppliedApi || createReadingLibraryApi(), [suppliedApi])
  const requestVersion = useRef(0)
  const writeSequence = useRef(0)
  const [state, setState] = useState({ status: workspaceId ? 'loading' : 'idle', data: EMPTY_LIBRARY, error: null, meta: {} })
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      const data = normalizeReadingLibrary(null)
      setState({ status: 'idle', data, error: null, meta: {} })
      return data
    }
    const version = ++requestVersion.current
    setState((current) => ({ ...current, status: 'loading', error: null }))
    try {
      const response = await api.getSnapshot({ workspaceId })
      const data = normalizeReadingLibrary(response.data)
      if (version === requestVersion.current) {
        setState({ status: hasLibraryData(data) ? 'ready' : 'empty', data, error: null, meta: response.meta || {} })
      }
      return data
    } catch (error) {
      const apiError = asApiError(error)
      if (version === requestVersion.current) {
        setState({ status: 'error', data: normalizeReadingLibrary(null), error: apiError, meta: {} })
      }
      throw apiError
    }
  }, [api, workspaceId])

  useEffect(() => {
    void refresh().catch(() => undefined)
  }, [refresh])

  const writeOptions = useCallback((prefix) => {
    writeSequence.current += 1
    return {
      workspaceId,
      idempotencyKey: newWriteKey(prefix, writeSequence.current),
    }
  }, [workspaceId])

  const mutate = useCallback(async (method, args, prefix) => {
    if (!workspaceId) throw new Error('当前账号没有可用工作空间')
    setSaving(true)
    try {
      const response = await api[method](...args, writeOptions(prefix))
      await refresh()
      return response.data
    } catch (error) {
      const apiError = asApiError(error)
      setState((current) => ({ ...current, status: 'error', error: apiError }))
      throw apiError
    } finally {
      setSaving(false)
    }
  }, [api, refresh, workspaceId, writeOptions])

  const actions = useMemo(() => ({
    createFavorite: (input) => mutate('createFavorite', [input], 'reading-favorite-create'),
    updateFavorite: (id, input) => mutate('updateFavorite', [id, input], 'reading-favorite-update'),
    deleteFavorite: (id, expectedVersion) => mutate('deleteFavorite', [id, { expectedVersion }], 'reading-favorite-delete'),
    createList: (input) => mutate('createList', [input], 'reading-list-create'),
    updateList: (id, input) => mutate('updateList', [id, input], 'reading-list-update'),
    deleteList: (id, expectedVersion) => mutate('deleteList', [id, { expectedVersion }], 'reading-list-delete'),
    addListItem: (listId, input) => mutate('addListItem', [listId, input], 'reading-list-item-create'),
    updateListItem: (id, input) => mutate('updateListItem', [id, input], 'reading-list-item-update'),
    deleteListItem: (id, expectedVersion) => mutate('deleteListItem', [id, { expectedVersion }], 'reading-list-item-delete'),
    createBookmark: (input) => mutate('createBookmark', [input], 'reading-bookmark-create'),
    updateBookmark: (id, input) => mutate('updateBookmark', [id, input], 'reading-bookmark-update'),
    deleteBookmark: (id, expectedVersion) => mutate('deleteBookmark', [id, { expectedVersion }], 'reading-bookmark-delete'),
    createExcerpt: (input) => mutate('createExcerpt', [input], 'reading-excerpt-create'),
    updateExcerpt: (id, input) => mutate('updateExcerpt', [id, input], 'reading-excerpt-update'),
    deleteExcerpt: (id, expectedVersion) => mutate('deleteExcerpt', [id, { expectedVersion }], 'reading-excerpt-delete'),
    createAnnotation: (input) => mutate('createAnnotation', [input], 'reading-annotation-create'),
    updateAnnotation: (id, input) => mutate('updateAnnotation', [id, input], 'reading-annotation-update'),
    deleteAnnotation: (id, expectedVersion) => mutate('deleteAnnotation', [id, { expectedVersion }], 'reading-annotation-delete'),
  }), [mutate])

  return {
    ...state,
    ...state.data,
    saving,
    refresh,
    ...actions,
  }
}
