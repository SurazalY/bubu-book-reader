import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { toStudentAiDto } from '../../adapters/student.js'
import { createStudentApi } from '../../api/student.js'
import { useApiResource } from '../../api/useApiResource.js'
import { buildConversationWriteOptions, createConversationApi } from './useConversationManager.js'

export function createStudentAiMessagePayload({ text, quotes, bookId, conversationId, currentPageNo, readRangeVersion, safeMode, startFresh }) {
  const normalizedQuotes = quotes || []
  const selections = normalizedQuotes.flatMap((quote) => Array.isArray(quote.selections) ? quote.selections : [])
  const payload = {
    text,
    bookId,
    currentPageNo,
    readRangeVersion,
    selections,
    safeMode: Boolean(safeMode),
  }
  if (!startFresh && conversationId) payload.conversationId = conversationId
  return payload
}

export function resolveFreshConversationSelection({ startingFresh, freshConversationId, chats }) {
  if (!startingFresh || !freshConversationId) return null
  return chats.some((chat) => chat.id === freshConversationId) ? freshConversationId : null
}

export function toClassroomBroadcastConversation(broadcast, bookId) {
  const payload = broadcast?.message || broadcast || {}
  const question = typeof payload.question === 'string' ? payload.question : payload.question?.text || payload.text || '教师发起了课堂提问'
  const answer = typeof payload.answer === 'string' ? payload.answer : payload.answer?.text || payload.reply || payload.text || '课堂回答暂不可用'
  const teacher = broadcast?.teacher || payload.teacher || '任课教师'
  const broadcastId = broadcast?.id || broadcast?.sourceRequestId
  const at = broadcast?.createdAt || '刚刚'
  return {
    id: `chat-class-${broadcastId}`,
    title: `${teacher}的课堂提问`,
    bookId,
    private: false,
    classroom: true,
    at,
    messages: [
      {
        id: `${broadcastId}:teacher`,
        role: 'teacher',
        at,
        teacher,
        text: question,
        quotes: payload.question?.quotes || payload.quotes || [],
        sendState: 'sent',
      },
      {
        id: `${broadcastId}:assistant`,
        role: 'classAi',
        at,
        text: answer,
        refs: payload.answer?.refs || payload.refs || [],
        typing: false,
        stopped: false,
        feedback: null,
      },
    ],
  }
}

export default function useStudentAiRuntime(workspaceId, books = []) {
  const api = useMemo(() => createStudentApi(), [])
  const conversationApi = useMemo(() => createConversationApi(), [])
  const load = useCallback(async () => {
    if (!workspaceId) return { data: toStudentAiDto({ items: [] }), meta: {} }
    const response = await api.listConversations({ workspaceId })
    return { data: toStudentAiDto(response.data, response.meta), meta: response.meta }
  }, [api, workspaceId])
  const resource = useApiResource(load)
  const [activeId, setActiveId] = useState(null)
  const [startingFresh, setStartingFresh] = useState(false)
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [unreadOverride, setUnreadOverride] = useState(null)
  const [broadcastChats, setBroadcastChats] = useState([])
  const requestSequence = useRef(0)
  const freshConversationIdRef = useRef(null)

  const data = resource.data
  const chats = useMemo(() => {
    const persisted = data?.chats || []
    const broadcastIds = new Set(broadcastChats.map((chat) => chat.id))
    return [...broadcastChats, ...persisted.filter((chat) => !broadcastIds.has(chat.id))]
  }, [broadcastChats, data?.chats])
  const trash = data?.trash || []

  useEffect(() => {
    if (startingFresh) {
      const createdConversationId = resolveFreshConversationSelection({
        startingFresh,
        freshConversationId: freshConversationIdRef.current,
        chats,
      })
      if (createdConversationId) {
        setActiveId(createdConversationId)
        setStartingFresh(false)
        freshConversationIdRef.current = null
      }
      return
    }
    if (activeId && chats.some((chat) => chat.id === activeId)) return
    setActiveId(data?.activeId || chats[0]?.id || null)
  }, [activeId, chats, data?.activeId, startingFresh])

  const unsupported = useCallback((operation) => {
    setActionError({ code: 'WRITE_API_UNAVAILABLE', message: `${operation}接口尚未接入，未修改本地或服务端业务数据` })
  }, [])

  const runConversationWrite = useCallback(async (operation) => {
    setPending(true)
    setActionError(null)
    try {
      const response = await operation()
      await resource.reload()
      return response?.data || null
    } catch (error) {
      setActionError(error)
      throw error
    } finally {
      setPending(false)
    }
  }, [resource.reload])

  const send = useCallback(async ({ text, quotes, bookId, currentPageNo, readRangeVersion, safe }) => {
    if (!text?.trim() && !quotes?.length) {
      return { accepted: false, error: { code: 'QUESTION_REQUIRED', message: '请输入问题或选择原文' } }
    }
    setPending(true)
    setActionError(null)
    try {
      requestSequence.current += 1
      const response = await api.sendAiMessage(
        createStudentAiMessagePayload({
          text,
          quotes,
          bookId,
          conversationId: activeId,
          currentPageNo,
          readRangeVersion,
          safeMode: safe,
          startFresh: startingFresh,
        }),
        { workspaceId, idempotencyKey: `student-ai:${bookId}:${Date.now()}:${requestSequence.current}` },
      )
      if (startingFresh) freshConversationIdRef.current = response.data?.conversationId || null
      await resource.reload()
      return { accepted: true, data: response.data }
    } catch (error) {
      setActionError(error)
      return { accepted: false, error }
    } finally {
      setPending(false)
    }
  }, [activeId, api, resource, startingFresh, workspaceId])

  const selectChat = useCallback((id) => {
    freshConversationIdRef.current = null
    setStartingFresh(false)
    setActiveId(id)
  }, [])

  const newChat = useCallback(async (bookId) => {
    setActionError(null)
    freshConversationIdRef.current = null
    setStartingFresh(true)
    setActiveId(null)
    const book = books.find((item) => item.id === bookId)
    if (!book?.versionId) {
      setStartingFresh(false)
      setActionError({ code: 'BOOK_VERSION_REQUIRED', message: '当前书籍没有可用版本，无法创建真实对话' })
      return null
    }
    return runConversationWrite(async () => {
      const response = await conversationApi.create({
        bookVersionId: book.versionId,
        initialText: '新的对话',
      }, buildConversationWriteOptions(workspaceId, 'create'))
      freshConversationIdRef.current = response.data?.id || null
      return response
    })
  }, [books, conversationApi, runConversationWrite, workspaceId])

  const renameChat = useCallback((conversationId, title) => {
    const target = chats.find((chat) => chat.id === conversationId)
    if (!target || !title?.trim() || target.title === title.trim()) return Promise.resolve(target || null)
    return runConversationWrite(() => conversationApi.rename(
      conversationId,
      { title: title.trim(), expectedVersion: target.version },
      buildConversationWriteOptions(workspaceId, 'rename', conversationId),
    ))
  }, [chats, conversationApi, runConversationWrite, workspaceId])

  const togglePrivate = useCallback((conversationId) => {
    const target = chats.find((chat) => chat.id === conversationId)
    if (!target) return Promise.resolve(null)
    return runConversationWrite(() => conversationApi.setPrivacy(
      conversationId,
      { privacyMode: target.private ? 'standard' : 'private', expectedVersion: target.version },
      buildConversationWriteOptions(workspaceId, 'privacy', conversationId),
    ))
  }, [chats, conversationApi, runConversationWrite, workspaceId])

  const deleteChat = useCallback((conversationId) => {
    const target = chats.find((chat) => chat.id === conversationId)
    if (!target) return Promise.resolve(null)
    return runConversationWrite(async () => {
      const response = await conversationApi.remove(
        conversationId,
        { expectedVersion: target.version },
        buildConversationWriteOptions(workspaceId, 'delete', conversationId),
      )
      if (activeId === conversationId) setActiveId(null)
      return response
    })
  }, [activeId, chats, conversationApi, runConversationWrite, workspaceId])

  const restoreChat = useCallback((conversationId) => {
    const target = trash.find((chat) => chat.id === conversationId)
    if (!target) return Promise.resolve(null)
    return runConversationWrite(async () => {
      const response = await conversationApi.restore(
        conversationId,
        { expectedVersion: target.version },
        buildConversationWriteOptions(workspaceId, 'restore', conversationId),
      )
      setActiveId(conversationId)
      return response
    })
  }, [conversationApi, runConversationWrite, trash, workspaceId])

  const pushBroadcast = useCallback((broadcast, bookId) => {
    const conversation = toClassroomBroadcastConversation(broadcast, bookId)
    setBroadcastChats((current) => current.some((chat) => chat.id === conversation.id) ? current : [conversation, ...current])
    freshConversationIdRef.current = null
    setStartingFresh(false)
    setActiveId(conversation.id)
    return conversation.id
  }, [])

  const active = chats.find((chat) => chat.id === activeId) || null

  return useMemo(() => ({
    status: resource.status,
    error: actionError || resource.error,
    chats,
    trash,
    activeId,
    active,
    quota: data?.quota || { remaining: null, usagePercent: null, resetAt: null },
    unread: unreadOverride ?? data?.unread ?? 0,
    safeMode: Boolean(data?.safeMode),
    pending,
    reload: resource.reload,
    clearUnread: () => setUnreadOverride(0),
    selectChat,
    send,
    newChat,
    pushBroadcast,
    stop: () => unsupported('停止生成'),
    retry: () => unsupported('重新发送'),
    feedback: () => unsupported('反馈写入'),
    renameChat,
    togglePrivate,
    deleteChat,
    restoreChat,
  }), [
    actionError,
    active,
    activeId,
    chats,
    data?.quota,
    data?.safeMode,
    data?.unread,
    pending,
    resource.error,
    resource.reload,
    resource.status,
    newChat,
    pushBroadcast,
    renameChat,
    togglePrivate,
    deleteChat,
    restoreChat,
    selectChat,
    send,
    trash,
    unreadOverride,
    unsupported,
  ])
}
