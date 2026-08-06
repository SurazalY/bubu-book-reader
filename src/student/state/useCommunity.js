import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createStudentApi } from '../../api/student.js'

const emptyDraft = {
  id: null,
  scope: 'class',
  bookId: '',
  title: '',
  text: '',
  quote: null,
  cover: { type: 'text', tone: 'paper' },
  from: null,
}

const displayStatus = {
  submitted: 'pending',
  class_approved: 'pending',
  approved: 'published',
  rejected: 'returned',
  delisted: 'offline',
}

function clock() {
  const date = new Date()
  return `今天 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatAt(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function daysSince(value) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return 0
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000))
}

function reactionMap(reactions) {
  return (Array.isArray(reactions) ? reactions : []).reduce((result, reaction) => {
    if (reaction?.type) result[reaction.type] = Number(reaction.count) || 0
    return result
  }, {})
}

function latestReview(reviews) {
  const list = Array.isArray(reviews) ? reviews : []
  return list.length ? list[list.length - 1] : null
}

function toCommunityPost(source, studentId, booksById) {
  const reactions = reactionMap(source?.reactions)
  const viewerReactionTypes = Array.isArray(source?.viewerReactionTypes) ? source.viewerReactionTypes : []
  const review = latestReview(source?.reviews)
  const quote = source?.quote && typeof source.quote === 'object'
    ? { bookId: source.quote.bookId, page: source.quote.page, text: source.quote.text }
    : null
  const authorId = source?.author?.id || null
  return {
    id: source?.id || null,
    authorId: authorId === studentId ? 'me' : authorId,
    author: source?.author || null,
    scope: source?.scope === 'school' ? 'school' : 'class',
    classId: source?.classId || null,
    bookId: quote?.bookId || null,
    book: booksById.get(quote?.bookId) || null,
    title: source?.title || '',
    text: source?.body || '',
    quote,
    cover: { type: 'text', tone: 'paper' },
    status: displayStatus[source?.status] || 'pending',
    serverStatus: source?.status || 'submitted',
    at: formatAt(source?.createdAt),
    days: daysSince(source?.createdAt),
    likes: reactions.appreciate || 0,
    liked: viewerReactionTypes.includes('appreciate'),
    reactions,
    mine: viewerReactionTypes,
    picked: false,
    review: review
      ? {
          who: review.stage === 'school' ? '学校管理员' : '老师',
          at: formatAt(review.createdAt),
          reason: review.reason,
        }
      : null,
    reviews: Array.isArray(source?.reviews) ? source.reviews : [],
    createdAt: source?.createdAt || null,
    updatedAt: source?.updatedAt || null,
  }
}

function reactionTotal(post) {
  return Object.values(post?.reactions || {}).reduce((sum, count) => sum + (Number(count) || 0), 0)
}

export default function useCommunity({ workspaceId, studentId, books = [], api: suppliedApi } = {}) {
  const api = useMemo(() => suppliedApi || createStudentApi(), [suppliedApi])
  const booksById = useMemo(() => new Map(books.map((book) => [book.id, book])), [books])
  const [posts, setPosts] = useState([])
  const [state, setState] = useState({ status: 'idle', error: null })
  const [draft, setDraft] = useState(emptyDraft)
  const [draftSavedAt, setDraftSavedAt] = useState('')
  const [flash, setFlash] = useState(null)
  const saveTimer = useRef(null)
  const requestSequence = useRef(0)
  const writeSequence = useRef(0)

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setPosts([])
      setState({ status: 'idle', error: null })
      return []
    }
    const requestId = ++requestSequence.current
    setState((current) => ({ status: 'loading', error: current.status === 'ready' ? null : current.error }))
    try {
      const response = await api.listCommunityPosts({ workspaceId, query: { scope: 'all' } })
      const items = Array.isArray(response.data?.items) ? response.data.items : []
      const nextPosts = items.map((item) => toCommunityPost(item, studentId, booksById)).filter((item) => item.id)
      if (requestId === requestSequence.current) {
        setPosts(nextPosts)
        setState({ status: 'ready', error: null })
      }
      return nextPosts
    } catch (error) {
      if (requestId === requestSequence.current) {
        setPosts([])
        setState({ status: 'error', error })
      }
      return []
    }
  }, [api, booksById, studentId, workspaceId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  const writeOptions = useCallback((prefix) => ({
    workspaceId,
    idempotencyKey: `${prefix}-${Date.now().toString(36)}-${++writeSequence.current}`,
  }), [workspaceId])

  const patchDraft = useCallback((patch) => {
    setDraft((current) => ({ ...current, ...patch }))
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => setDraftSavedAt(clock()), 450)
  }, [])

  const startDraft = useCallback((seed = {}) => {
    setDraft({ ...emptyDraft, ...seed })
    setDraftSavedAt('')
  }, [])

  const clearDraft = useCallback(() => {
    setDraft(emptyDraft)
    setDraftSavedAt('')
  }, [])

  const getPost = useCallback((id) => posts.find((post) => post.id === id) || null, [posts])

  const editPost = useCallback((id) => {
    const post = posts.find((item) => item.id === id)
    if (!post) return
    setDraft({
      id: post.id,
      scope: post.scope,
      bookId: post.bookId || '',
      title: post.title,
      text: post.text,
      quote: post.quote,
      cover: post.cover,
      from: post.status,
    })
    setDraftSavedAt('')
  }, [posts])

  const saveDraft = useCallback(() => {
    setDraftSavedAt(clock())
    setFlash({ tone: 'muted', text: '草稿暂存在本次编辑会话，发布时会提交到真实社区。' })
    return true
  }, [])

  const publishDraft = useCallback(async () => {
    if (!workspaceId || !draft.bookId || !draft.quote || !draft.title.trim() || !draft.text.trim()) {
      setFlash({ tone: 'danger', text: '请选择书中引文，并补全标题和正文后再提交。' })
      return false
    }
    try {
      await api.createCommunityPost({
        scope: draft.scope,
        title: draft.title,
        body: draft.text,
        quote: {
          bookId: draft.bookId,
          page: draft.quote.page,
          text: draft.quote.text,
        },
      }, writeOptions('community-post'))
      clearDraft()
      setFlash({ tone: 'success', text: '已提交给老师审核，刷新后会显示真实审核状态。' })
      await refresh()
      return true
    } catch (error) {
      setFlash({ tone: 'danger', text: error?.message || '提交失败，请稍后重试。' })
      return false
    }
  }, [api, clearDraft, draft, refresh, workspaceId, writeOptions])

  const toggleRemoteReaction = useCallback(async (id, reactionType) => {
    const post = posts.find((item) => item.id === id)
    if (!post || !workspaceId) return false
    try {
      if (post.mine.includes(reactionType)) {
        await api.removeCommunityReaction(id, { reactionType }, writeOptions('community-reaction-remove'))
      } else {
        await api.reactToCommunityPost(id, { reactionType }, writeOptions('community-reaction'))
      }
      await refresh()
      return true
    } catch (error) {
      setFlash({ tone: 'danger', text: error?.message || '互动没有保存成功，请稍后重试。' })
      return false
    }
  }, [api, posts, refresh, workspaceId, writeOptions])

  const toggleLike = useCallback((id) => toggleRemoteReaction(id, 'appreciate'), [toggleRemoteReaction])
  const toggleSave = useCallback((id) => toggleRemoteReaction(id, 'bookmark'), [toggleRemoteReaction])
  const toggleReaction = useCallback((id, reactionType) => toggleRemoteReaction(id, reactionType), [toggleRemoteReaction])
  const isSaved = useCallback((id) => Boolean(getPost(id)?.mine.includes('bookmark')), [getPost])
  const withdrawPost = useCallback(() => {
    setFlash({ tone: 'muted', text: '已提交内容的撤回接口尚未开放，当前不会伪造本地撤回结果。' })
    return false
  }, [])
  const dismissFlash = useCallback(() => setFlash(null), [])

  const getFeed = useCallback((scope, { query = '', sort = 'latest', range = 'all' } = {}) => {
    const keyword = query.trim().toLowerCase()
    const visible = posts.filter((post) => post.scope === scope && post.status === 'published')
    const filtered = visible.filter((post) => {
      if (range === 'today' && post.days !== 0) return false
      if (range === 'week' && post.days > 7) return false
      if (range === 'month' && post.days > 30) return false
      return !keyword || `${post.title}\n${post.text}\n${post.quote?.text || ''}`.toLowerCase().includes(keyword)
    })
    return [...filtered].sort((left, right) => {
      if (sort === 'warm') return reactionTotal(right) - reactionTotal(left) || (right.createdAt || '').localeCompare(left.createdAt || '')
      if (sort === 'picked') return Number(right.picked) - Number(left.picked) || (right.createdAt || '').localeCompare(left.createdAt || '')
      return (right.createdAt || '').localeCompare(left.createdAt || '')
    })
  }, [posts])

  const mine = useMemo(() => posts.filter((post) => post.authorId === 'me'), [posts])
  const savedPosts = useMemo(() => posts.filter((post) => post.mine.includes('bookmark')), [posts])
  const getBookPosts = useCallback((bookId) => posts.filter((post) => post.bookId === bookId && post.status === 'published'), [posts])

  return {
    posts,
    loading: state.status === 'loading',
    error: state.error,
    empty: state.status === 'ready' && posts.length === 0,
    ready: state.status === 'ready',
    refresh,
    flash,
    dismissFlash,
    draft,
    draftSavedAt,
    patchDraft,
    startDraft,
    clearDraft,
    saveDraft,
    publishDraft,
    editPost,
    withdrawPost,
    getPost,
    getFeed,
    getBookPosts,
    mine,
    savedPosts,
    toggleLike,
    toggleSave,
    isSaved,
    toggleReaction,
  }
}
