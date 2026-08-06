import { useCallback, useMemo } from 'react'

import { createApiClient } from '../../api/client.js'
import { useApiResource } from '../../api/useApiResource.js'

export function createConsoleConversationApi(client = createApiClient()) {
  return {
    search: (options = {}) => client.get('/console/conversations', options),
    getConversation: (ownerUserId, conversationId, options = {}) => client.get(
      `/console/conversations/${encodeURIComponent(ownerUserId)}/${encodeURIComponent(conversationId)}`,
      options,
    ),
  }
}

export function buildConsoleConversationQuery(query = {}) {
  const text = typeof query.text === 'string' ? query.text.trim() : ''
  const bookVersionIds = [...new Set((Array.isArray(query.bookVersionIds) ? query.bookVersionIds : [])
    .map((value) => String(value).trim())
    .filter(Boolean))]
  return {
    ...(text ? { text } : {}),
    ...(bookVersionIds.length ? { bookVersionIds: bookVersionIds.join(','), bookMode: query.bookMode === 'AND' ? 'AND' : 'OR' } : {}),
  }
}

export function normalizeConversationIndex(payload) {
  return {
    classes: asArray(payload?.classes).map((classItem) => ({
      id: classItem?.id || '',
      name: classItem?.name || '未命名班级',
      students: asArray(classItem?.students).map((student) => ({
        id: student?.id || '',
        displayName: student?.displayName || '未命名学生',
        conversations: asArray(student?.conversations).map((conversation) => ({
          ...conversation,
          title: conversation?.title || '新的对话',
          private: conversation?.privacyMode === 'private',
        })),
      })),
    })),
    query: payload?.query || {},
  }
}

export function normalizeConversationDetail(payload) {
  return {
    ...(payload || {}),
    messages: asArray(payload?.messages).map((message) => ({
      ...message,
      text: message?.content ?? message?.text ?? '',
      refs: asArray(message?.citations || message?.refs),
    })),
    accessMode: payload?.accessMode || null,
    watermark: payload?.watermark || null,
  }
}

export default function useConversationData({ workspaceId, query, ownerUserId, conversationId, purpose, client } = {}) {
  const api = useMemo(() => createConsoleConversationApi(client || createApiClient()), [client])
  const normalizedQuery = useMemo(() => buildConsoleConversationQuery(query), [query])
  const loadIndex = useCallback(async () => {
    if (!workspaceId) return { data: normalizeConversationIndex(null), meta: {} }
    const response = await api.search({ workspaceId, query: normalizedQuery })
    return { data: normalizeConversationIndex(response.data), meta: response.meta || {} }
  }, [api, normalizedQuery, workspaceId])
  const loadDetail = useCallback(async () => {
    if (!workspaceId || !ownerUserId || !conversationId) return { data: null, meta: {} }
    const response = await api.getConversation(ownerUserId, conversationId, {
      workspaceId,
      query: purpose ? { purpose } : undefined,
    })
    return { data: normalizeConversationDetail(response.data), meta: response.meta || {} }
  }, [api, conversationId, ownerUserId, purpose, workspaceId])
  const index = useApiResource(loadIndex)
  const detail = useApiResource(loadDetail)
  return useMemo(() => ({ index, detail, reload: async () => Promise.all([index.reload(), detail.reload()]) }), [detail, index])
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}
