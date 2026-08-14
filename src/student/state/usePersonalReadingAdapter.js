import { useCallback, useMemo, useState } from 'react'

import useReadingLibrary from './useReadingLibrary.js'
import useReadingStatistics from './useReadingStatistics.js'

export function formatMinutes(value, { zero = '0 分钟' } = {}) {
  const minutes = Math.max(0, Math.round(Number(value) || 0))
  if (!minutes) return zero
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

function groupByBook(items) {
  return items.reduce((groups, item) => {
    if (!item.bookId) return groups
    const current = groups[item.bookId] || []
    current.push(item)
    groups[item.bookId] = current
    return groups
  }, {})
}

function finiteNumber(...values) {
  const value = values.find((item) => typeof item === 'number' && Number.isFinite(item))
  return value ?? null
}

export function buildPersonalBookCollection(runtimeBooks, libraryData) {
  const shelfByBookId = new Map((libraryData.shelf || []).map((item) => [item.bookId, item]))
  const bookmarksByBookId = groupByBook(libraryData.bookmarks || [])
  const favorites = new Set((libraryData.favorites || []).map((item) => item.bookId))
  const runtimeByBookId = new Map((runtimeBooks || []).map((book) => [book.id, book]))
  const orderedIds = [
    ...(runtimeBooks || []).map((book) => book.id),
    ...(libraryData.shelf || []).map((item) => item.bookId),
  ].filter((id, index, list) => id && list.indexOf(id) === index)

  return orderedIds.map((bookId) => {
    const runtime = runtimeByBookId.get(bookId) || {}
    const shelf = shelfByBookId.get(bookId) || {}
    const totalPages = finiteNumber(runtime.progress?.totalPages, runtime.totalPages, shelf.pageCount)
    const currentPage = finiteNumber(runtime.progress?.currentPage, runtime.page, shelf.progress?.lastPageNo)
    const effectiveMinutesValue = finiteNumber(runtime.progress?.effectiveMinutes, runtime.minutes)
    const effectiveMinutes = effectiveMinutesValue === null ? null : Math.max(0, Math.round(effectiveMinutesValue))

    return {
      id: bookId,
      versionId: runtime.versionId || shelf.bookVersionId || null,
      title: runtime.title || shelf.title || '服务端未返回书名',
      author: runtime.author || '服务端未返回作者',
      genre: runtime.genre || '整书阅读',
      subject: runtime.subject || '未分类',
      coverUrl: runtime.coverUrl || null,
      cover: runtime.cover || null,
      assets: Array.isArray(runtime.assets) ? runtime.assets : [],
      access: runtime.access || {},
      downloaded: runtime.downloaded === true,
      classReading: runtime.classReading || null,
      lists: Array.isArray(runtime.lists) ? runtime.lists : [],
      liked: favorites.has(bookId),
      progress: {
        currentPage,
        totalPages,
        effectiveMinutes,
        bookmarks: (bookmarksByBookId[bookId] || []).map((item) => item.pageNo),
      },
      minutes: effectiveMinutes,
      page: currentPage,
      totalPages,
    }
  })
}

export default function usePersonalReadingAdapter({ workspaceId, books: runtimeBooks = [] } = {}) {
  const library = useReadingLibrary({ workspaceId })
  const statistics = useReadingStatistics(workspaceId)
  const [flash, setFlash] = useState(null)
  const libraryData = library.data || {}
  const books = useMemo(
    () => buildPersonalBookCollection(runtimeBooks, libraryData),
    [libraryData, runtimeBooks],
  )
  const bookMap = useMemo(() => new Map(books.map((book) => [book.id, book])), [books])
  const lists = useMemo(
    () => (libraryData.lists || []).map((list) => ({
      ...list,
      bookIds: (list.items || []).map((item) => item.bookId).filter(Boolean),
    })),
    [libraryData.lists],
  )
  const systemLists = useMemo(() => [
    { id: 'liked', name: '我喜欢的书', icon: 'Heart' },
    { id: 'recent', name: '最近阅读', icon: 'Clock3' },
    { id: 'shelf', name: '我的书架', icon: 'Library' },
  ], [])
  const systemListBooks = useCallback((list) => {
    if (list?.id === 'liked') return books.filter((book) => book.liked)
    if (list?.id === 'recent') {
      const recentIds = statistics.data?.lastReading?.bookId ? [statistics.data.lastReading.bookId] : []
      return recentIds.map((bookId) => bookMap.get(bookId)).filter(Boolean)
    }
    return books
  }, [bookMap, books, statistics.data?.lastReading?.bookId])
  const notify = useCallback(async (operation, successText) => {
    try {
      const result = await operation()
      setFlash({ tone: 'success', text: successText })
      return result
    } catch (error) {
      setFlash({ tone: 'error', text: error?.message || '保存没有完成，请稍后重试。' })
      return null
    }
  }, [])
  const getCustomList = useCallback((listId) => lists.find((list) => list.id === listId) || null, [lists])
  const listsOfBook = useCallback((bookId) => lists.filter((list) => list.bookIds.includes(bookId)), [lists])
  const createList = useCallback((name) => notify(
    () => library.createList({ name, position: lists.length }),
    '书单已创建并保存。',
  ), [library, lists.length, notify])
  const renameList = useCallback((listId, name) => {
    const list = getCustomList(listId)
    if (!list) return Promise.resolve(null)
    return notify(
      () => library.updateList(listId, { name, expectedVersion: list.version, position: list.position }),
      '书单名称已保存。',
    )
  }, [getCustomList, library, notify])
  const moveList = useCallback((listId, direction) => {
    const index = lists.findIndex((list) => list.id === listId)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= lists.length) return Promise.resolve(null)
    const current = lists[index]
    const neighbor = lists[nextIndex]
    return notify(async () => {
      await library.updateList(current.id, { position: neighbor.position, expectedVersion: current.version })
      return library.updateList(neighbor.id, { position: current.position, expectedVersion: neighbor.version })
    }, '书单顺序已保存。')
  }, [library, lists, notify])
  const deleteList = useCallback((listId) => {
    const list = getCustomList(listId)
    if (!list) return Promise.resolve(null)
    return notify(
      () => library.deleteList(list.id, list.version),
      '书单已删除，书籍和阅读记录不会受影响。',
    )
  }, [getCustomList, library, notify])
  const addBooksToList = useCallback((listId, bookIds) => {
    const list = getCustomList(listId)
    if (!list) return Promise.resolve(null)
    return notify(async () => {
      let position = list.items.length
      for (const bookId of bookIds) {
        const book = bookMap.get(bookId)
        if (!book?.versionId) throw new Error('这本书缺少服务端版本标识，不能加入书单。')
        await library.addListItem(listId, { bookVersionId: book.versionId, position })
        position += 1
      }
    }, '选中的书已加入书单。')
  }, [bookMap, getCustomList, library, notify])
  const toggleInList = useCallback((listId, bookId) => {
    const list = getCustomList(listId)
    if (!list) return Promise.resolve(null)
    const item = (list.items || []).find((entry) => entry.bookId === bookId)
    if (item) {
      return notify(
        () => library.deleteListItem(item.id, item.version),
        '这本书已从书单移出。',
      )
    }
    const book = bookMap.get(bookId)
    if (!book?.versionId) return Promise.resolve(null)
    return notify(
      () => library.addListItem(list.id, { bookVersionId: book.versionId, position: list.items.length }),
      '这本书已加入书单。',
    )
  }, [bookMap, getCustomList, library, notify])

  const me = useMemo(() => ({
    lists,
    trash: [],
    flash,
    dismissFlash: () => setFlash(null),
    getCustomList,
    listsOfBook,
    createList,
    renameList,
    moveList,
    deleteList,
    addBooksToList,
    toggleInList,
  }), [addBooksToList, createList, deleteList, flash, getCustomList, lists, listsOfBook, moveList, renameList, toggleInList])

  return {
    books,
    bookMap,
    library,
    statistics,
    me,
    systemLists,
    systemListBooks,
  }
}
