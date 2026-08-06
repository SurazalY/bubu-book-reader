import { useCallback, useMemo, useState } from 'react'

import { createApiClient } from '../../api/client.js'
import { useApiResource } from '../../api/useApiResource.js'

export function createConversationApi(client = createApiClient()) {
  return {
    list: (options = {}) => client.get('/ai/conversations', options),
    get: (conversationId, options = {}) => client.get(`/ai/conversations/${encodeURIComponent(conversationId)}`, options),
    create: (body, options = {}) => client.post('/ai/conversations', { ...options, body }),
    rename: (conversationId, body, options = {}) => client.patch(`/ai/conversations/${encodeURIComponent(conversationId)}`, {
      ...options,
      body: { action: 'rename', ...body },
    }),
    setPrivacy: (conversationId, body, options = {}) => client.patch(`/ai/conversations/${encodeURIComponent(conversationId)}`, {
      ...options,
      body: { action: 'set_privacy', ...body },
    }),
    updateContext: (conversationId, body, options = {}) => client.patch(`/ai/conversations/${encodeURIComponent(conversationId)}`, {
      ...options,
      body: { action: 'update_context', ...body },
    }),
    remove: (conversationId, body, options = {}) => client.delete(`/ai/conversations/${encodeURIComponent(conversationId)}`, { ...options, body }),
    restore: (conversationId, body, options = {}) => client.post(`/ai/conversations/${encodeURIComponent(conversationId)}/restore`, { ...options, body }),
  }
}

export function buildConversationWriteOptions(workspaceId, action, conversationId = 'new') {
  const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return {
    workspaceId,
    idempotencyKey: `conversation:${action}:${conversationId}:${nonce}`,
  }
}

export function normalizeConversationSnapshot(payload) {
  const source = payload || {}
  return {
    chats: asArray(source.items).map(normalizeConversation),
    trash: asArray(source.trash).map(normalizeConversation),
    quota: {
      remaining: finiteOrNull(source.quota?.remaining),
      usagePercent: finiteOrNull(source.quota?.usagePercent),
      resetAt: source.quota?.resetAt || null,
    },
    unread: Number(source.unread) || 0,
    safeMode: Boolean(source.safeMode),
  }
}

export function normalizeConversation(item) {
  const context = item?.context || {}
  const selection = context.selection && Object.keys(context.selection).length > 0 ? [context.selection] : []
  return {
    ...item,
    id: item?.id || '',
    title: item?.title || '新的对话',
    private: item?.privacyMode === 'private',
    bookId: item?.bookId || null,
    bookVersionId: item?.bookVersionId || null,
    pageNumber: context.pageNumber ?? null,
    quotes: selection,
    refs: asArray(context.citations),
    contextVersion: context.version ?? null,
    messages: asArray(item?.messages).map(normalizeMessage),
    deletedAt: item?.deletedAt || null,
  }
}

export default function useConversationManager(workspaceId, { client } = {}) {
  const api = useMemo(() => createConversationApi(client || createApiClient()), [client])
  const load = useCallback(async () => {
    if (!workspaceId) return { data: normalizeConversationSnapshot(null), meta: {} }
    const response = await api.list({ workspaceId })
    return { data: normalizeConversationSnapshot(response.data), meta: response.meta || {} }
  }, [api, workspaceId])
  const resource = useApiResource(load)
  const [activeId, setActiveId] = useState(null)
  const [pendingAction, setPendingAction] = useState(null)
  const [actionError, setActionError] = useState(null)
  const chats = resource.data?.chats || []
  const trash = resource.data?.trash || []
  const selectedId = activeId && chats.some((chat) => chat.id === activeId) ? activeId : chats[0]?.id || null
  const active = chats.find((chat) => chat.id === selectedId) || null

  const execute = useCallback(async (action, operation) => {
    setPendingAction(action)
    setActionError(null)
    try {
      const response = await operation()
      await resource.reload()
      return response?.data || null
    } catch (error) {
      setActionError(error)
      throw error
    } finally {
      setPendingAction(null)
    }
  }, [resource.reload])

  const create = useCallback((input) => execute('create', async () => {
    const response = await api.create(input, buildConversationWriteOptions(workspaceId, 'create'))
    setActiveId(response.data?.id || null)
    return response
  }), [api, execute, workspaceId])
  const rename = useCallback((conversationId, title, expectedVersion) => execute('rename', () => api.rename(
    conversationId,
    { title, expectedVersion },
    buildConversationWriteOptions(workspaceId, 'rename', conversationId),
  )), [api, execute, workspaceId])
  const setPrivacy = useCallback((conversationId, privacyMode, expectedVersion) => execute('privacy', () => api.setPrivacy(
    conversationId,
    { privacyMode, expectedVersion },
    buildConversationWriteOptions(workspaceId, 'privacy', conversationId),
  )), [api, execute, workspaceId])
  const updateContext = useCallback((conversationId, context, expectedVersion, expectedContextVersion) => execute('context', () => api.updateContext(
    conversationId,
    { context, expectedVersion, expectedContextVersion },
    buildConversationWriteOptions(workspaceId, 'context', conversationId),
  )), [api, execute, workspaceId])
  const remove = useCallback((conversationId, expectedVersion) => execute('delete', async () => {
    const response = await api.remove(
      conversationId,
      { expectedVersion },
      buildConversationWriteOptions(workspaceId, 'delete', conversationId),
    )
    if (selectedId === conversationId) setActiveId(null)
    return response
  }), [api, execute, selectedId, workspaceId])
  const restore = useCallback((conversationId, expectedVersion) => execute('restore', async () => {
    const response = await api.restore(
      conversationId,
      { expectedVersion },
      buildConversationWriteOptions(workspaceId, 'restore', conversationId),
    )
    setActiveId(conversationId)
    return response
  }), [api, execute, workspaceId])

  return useMemo(() => ({
    ...resource,
    error: actionError || resource.error,
    chats,
    trash,
    activeId: selectedId,
    active,
    quota: resource.data?.quota || { remaining: null, usagePercent: null, resetAt: null },
    unread: resource.data?.unread || 0,
    safeMode: Boolean(resource.data?.safeMode),
    pendingAction,
    selectChat: setActiveId,
    create,
    rename,
    setPrivacy,
    updateContext,
    remove,
    restore,
  }), [
    actionError, active, chats, create, pendingAction, remove, rename, resource, restore,
    selectedId, setPrivacy, trash, updateContext,
  ])
}

function normalizeMessage(message) {
  return {
    ...message,
    text: message?.content ?? message?.text ?? '',
    at: message?.createdAt || message?.at || null,
    refs: asArray(message?.citations || message?.refs),
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function finiteOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
