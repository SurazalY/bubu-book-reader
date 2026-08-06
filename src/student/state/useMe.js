import { useCallback, useMemo, useState } from 'react'
import { BOOK_MAP, CUSTOM_LISTS, LIBRARY } from '../data/library.js'
import { PRIVACY_REQUESTS, SEED_NOTES, TEACHER_NOTICES } from '../data/me.js'

// 个人主页那一侧的业务状态：我的心得、教师通知与访问申请、自定义书单、下载。
// 全部只放内存——它们是业务数据，前端壳不能假装已经写进后端（与 useCommunity 同一口径）。
// 「我的发布与收藏」不在这里：那份数据在 useCommunity 的 mine / savedPosts，
// 两处各存一套必然对不上（Stage 5 收尾时已确认过的约定）。

let seq = 0
const uid = (p) => `${p}-${(seq += 1)}-${Date.now().toString(36)}`

function clock() {
  const d = new Date()
  return `今天 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const countWords = (t) => (t || '').replace(/\s/g, '').length

export default function useMe() {
  const [notes, setNotes] = useState(SEED_NOTES)
  const [notices, setNotices] = useState(TEACHER_NOTICES)
  const [requests, setRequests] = useState(PRIVACY_REQUESTS)
  // 访问申请处理后进访问记录，学生随时能回看「谁在什么时候因为什么看过」
  const [accessLog, setAccessLog] = useState([])
  const [lists, setLists] = useState(CUSTOM_LISTS.map((l) => ({ ...l, bookIds: [...l.bookIds] })))
  // 删除书单进「最近删除」，可以恢复；删书单不删书、不删阅读数据
  const [trash, setTrash] = useState([])
  const [downloads, setDownloads] = useState(() => new Set(LIBRARY.filter((b) => b.downloaded).map((b) => b.id)))
  const [flash, setFlash] = useState(null)

  const say = useCallback((text) => setFlash({ text, key: uid('f') }), [])
  const dismissFlash = useCallback(() => setFlash(null), [])

  // ——— 我的心得 ———
  const getNote = useCallback((id) => notes.find((n) => n.id === id) || null, [notes])

  const saveNote = useCallback((id, patch) => {
    setNotes((list) =>
      list.map((n) =>
        n.id === id
          ? { ...n, ...patch, words: countWords(patch.text ?? n.text), updatedAt: clock(), posted: false }
          : n,
      ),
    )
  }, [])

  const createNote = useCallback(() => {
    const id = uid('note')
    setNotes((list) => [
      { id, title: '', bookId: '', text: '', words: 0, updatedAt: clock(), posted: false, aiAssisted: false },
      ...list,
    ])
    return id
  }, [])

  const removeNote = useCallback((id) => setNotes((list) => list.filter((n) => n.id !== id)), [])

  // 投稿要二次确认并选书，这里只负责标记；真正生成帖子由社区那边接手
  const markNotePosted = useCallback((id) => {
    setNotes((list) => list.map((n) => (n.id === id ? { ...n, posted: true, postedAt: clock() } : n)))
  }, [])

  // ——— 教师交互 ———
  const unreadNotices = useMemo(() => notices.filter((n) => n.unread).length, [notices])
  const pendingRequests = useMemo(() => requests.filter((r) => r.state === 'pending').length, [requests])
  // 个人主页入口只显示未读数量，不把内容摊在主页上（规格 §10.2）
  const teacherBadge = unreadNotices + pendingRequests

  const readNotice = useCallback((id) => {
    setNotices((list) => list.map((n) => (n.id === id ? { ...n, unread: false } : n)))
  }, [])
  const readAllNotices = useCallback(() => setNotices((list) => list.map((n) => ({ ...n, unread: false }))), [])

  const answerRequest = useCallback(
    (id, agree) => {
      setRequests((list) => list.map((r) => (r.id === id ? { ...r, state: agree ? 'agreed' : 'refused' } : r)))
      const req = requests.find((r) => r.id === id)
      if (req) {
        setAccessLog((log) => [
          {
            id: uid('log'),
            teacher: req.teacher,
            purpose: req.purpose,
            chatTitle: req.chatTitle,
            at: clock(),
            state: agree ? 'agreed' : 'refused',
            viewedAt: '',
          },
          ...log,
        ])
      }
      say(agree ? '已同意，老师查看时会记在访问记录里' : '已拒绝，老师看不到这个对话')
    },
    [requests, say],
  )

  // ——— 书单 ———
  const allLists = lists
  const getCustomList = useCallback((id) => lists.find((l) => l.id === id) || null, [lists])

  const createList = useCallback(
    (name) => {
      const clean = (name || '').trim()
      if (!clean) return null
      const id = uid('list')
      setLists((l) => [...l, { id, name: clean, bookIds: [] }])
      say(`已创建书单「${clean}」`)
      return id
    },
    [say],
  )

  const renameList = useCallback((id, name) => {
    const clean = (name || '').trim()
    if (!clean) return
    setLists((l) => l.map((x) => (x.id === id ? { ...x, name: clean } : x)))
  }, [])

  const moveList = useCallback((id, delta) => {
    setLists((l) => {
      const from = l.findIndex((x) => x.id === id)
      const to = from + delta
      if (from < 0 || to < 0 || to >= l.length) return l
      const next = [...l]
      next.splice(to, 0, next.splice(from, 1)[0])
      return next
    })
  }, [])

  const deleteList = useCallback(
    (id) => {
      setLists((l) => {
        const target = l.find((x) => x.id === id)
        if (target) setTrash((t) => [{ ...target, deletedAt: clock() }, ...t])
        return l.filter((x) => x.id !== id)
      })
      say('书单已删除，书和阅读记录都还在')
    },
    [say],
  )

  const restoreList = useCallback(
    (id) => {
      setTrash((t) => {
        const target = t.find((x) => x.id === id)
        if (target) {
          const { deletedAt, ...rest } = target
          setLists((l) => [...l, rest])
        }
        return t.filter((x) => x.id !== id)
      })
      say('书单已恢复')
    },
    [say],
  )

  // 同一本书可以属于多个书单，所以这里是「加入／移出某一个书单」而不是互斥归类
  const toggleInList = useCallback((listId, bookId) => {
    setLists((l) =>
      l.map((x) =>
        x.id === listId
          ? {
              ...x,
              bookIds: x.bookIds.includes(bookId)
                ? x.bookIds.filter((b) => b !== bookId)
                : [...x.bookIds, bookId],
            }
          : x,
      ),
    )
  }, [])

  const addBooksToList = useCallback(
    (listId, bookIds) => {
      if (!bookIds.length) return
      setLists((l) =>
        l.map((x) =>
          x.id === listId ? { ...x, bookIds: [...x.bookIds, ...bookIds.filter((b) => !x.bookIds.includes(b))] } : x,
        ),
      )
      say(`已加入 ${bookIds.length} 本书`)
    },
    [say],
  )

  const listOf = useCallback((id) => {
    const l = lists.find((x) => x.id === id)
    return l ? l.bookIds.map((b) => BOOK_MAP.get(b)).filter(Boolean) : []
  }, [lists])

  // 一本书在哪几个自定义书单里（书单详情与批量添加都要用）
  const listsOfBook = useCallback((bookId) => lists.filter((l) => l.bookIds.includes(bookId)), [lists])

  // ——— 下载与存储 ———
  const isDownloaded = useCallback((id) => downloads.has(id), [downloads])
  const removeDownload = useCallback(
    (id) => {
      setDownloads((d) => {
        const next = new Set(d)
        next.delete(id)
        return next
      })
      say('已删除下载，阅读进度和摘录都保留')
    },
    [say],
  )
  const downloadedBooks = useMemo(() => LIBRARY.filter((b) => downloads.has(b.id)), [downloads])

  return {
    notes,
    getNote,
    createNote,
    saveNote,
    removeNote,
    markNotePosted,
    notices,
    unreadNotices,
    readNotice,
    readAllNotices,
    requests,
    pendingRequests,
    answerRequest,
    accessLog,
    teacherBadge,
    lists: allLists,
    getCustomList,
    createList,
    renameList,
    moveList,
    deleteList,
    restoreList,
    trash,
    toggleInList,
    addBooksToList,
    listOf,
    listsOfBook,
    isDownloaded,
    removeDownload,
    downloadedBooks,
    flash,
    dismissFlash,
  }
}
