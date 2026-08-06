import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createConsoleApi } from '../../api/console.js'
import { mapCommunityReviewAction, partitionConsoleCommunityPosts, toConsoleCommunityPost } from './communityRuntime.js'

function toBook(source) {
  return {
    id: source?.id || source?.bookId || null,
    title: source?.title || source?.name || '',
    author: source?.author || source?.authorName || '',
  }
}

export default function useConsoleCommunityRuntime({ workspaceId, className, api: suppliedApi } = {}) {
  const api = useMemo(() => suppliedApi || createConsoleApi(), [suppliedApi])
  const [state, setState] = useState({ status: 'idle', postsByTab: { pending: [], class: [], school: [] }, books: [], error: null })
  const writeSequence = useRef(0)

  const refresh = useCallback(async () => {
    if (!workspaceId) return
    setState((current) => ({ ...current, status: 'loading', error: null }))
    try {
      const [postsResponse, booksResponse] = await Promise.all([
        api.listCommunityPosts({ workspaceId, query: { scope: 'all' } }),
        api.listBooks({ workspaceId }),
      ])
      const books = (Array.isArray(booksResponse.data?.items) ? booksResponse.data.items : []).map(toBook).filter((book) => book.id)
      const booksById = new Map(books.map((book) => [book.id, book]))
      const posts = (Array.isArray(postsResponse.data?.items) ? postsResponse.data.items : [])
        .map((post) => toConsoleCommunityPost(post, { booksById, className }))
        .filter((post) => post.id)
      setState({ status: 'ready', postsByTab: partitionConsoleCommunityPosts(posts), books, error: null })
    } catch (error) {
      setState((current) => ({ ...current, status: 'error', error }))
    }
  }, [api, className, workspaceId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const review = useCallback(async (post, action) => {
    const body = mapCommunityReviewAction(action)
    if (!body || !workspaceId || !post?.id) return false
    try {
      await api.reviewCommunityPost(post.id, body, {
        workspaceId,
        idempotencyKey: `community-review-${Date.now().toString(36)}-${++writeSequence.current}`,
      })
      await refresh()
      return true
    } catch (error) {
      setState((current) => ({ ...current, status: 'error', error }))
      return false
    }
  }, [api, refresh, workspaceId])

  return {
    ...state,
    loading: state.status === 'loading',
    ready: state.status === 'ready',
    refresh,
    review,
  }
}
