import { createElement, useEffect, useState } from 'react'

export function resolveCoverAssetUrl(book) {
  if (!book || typeof book !== 'object') return null
  if (typeof book.coverUrl === 'string' && book.coverUrl.trim()) return book.coverUrl.trim()
  const cover = book.cover
  if (cover && typeof cover === 'object' && typeof cover.url === 'string' && cover.url.trim()) {
    return cover.url.trim()
  }
  return null
}

export async function loadProtectedAsset(assetUrl, workspaceId, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof assetUrl !== 'string' || !assetUrl.trim()) {
    return { objectUrl: null, failed: true }
  }
  if (typeof workspaceId !== 'string' || !workspaceId.trim()) {
    return { objectUrl: null, failed: false }
  }

  try {
    const response = await fetchImpl(assetUrl, {
      credentials: 'include',
      headers: {
        Accept: 'image/*',
        'X-Workspace-Id': workspaceId,
      },
    })
    if (!response.ok) return { objectUrl: null, failed: true }
    const blob = await response.blob()
    if (!blob?.type || !blob.type.startsWith('image/')) return { objectUrl: null, failed: true }
    return { objectUrl: URL.createObjectURL(blob), failed: false }
  } catch {
    return { objectUrl: null, failed: true }
  }
}

export function useProtectedAssetUrl(assetUrl, workspaceId) {
  const [objectUrl, setObjectUrl] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!assetUrl) {
      setObjectUrl(null)
      setFailed(true)
      return undefined
    }
    if (!workspaceId) {
      setObjectUrl(null)
      setFailed(false)
      return undefined
    }

    let cancelled = false
    let created = null
    setFailed(false)
    setObjectUrl(null)

    loadProtectedAsset(assetUrl, workspaceId).then((result) => {
      if (cancelled) {
        if (result.objectUrl) URL.revokeObjectURL(result.objectUrl)
        return
      }
      created = result.objectUrl
      setObjectUrl(result.objectUrl)
      setFailed(result.failed)
    })

    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [assetUrl, workspaceId])

  return { objectUrl, failed }
}

export function ProtectedImage({ src, workspaceId, alt = '', className, fallback = null }) {
  const { objectUrl, failed } = useProtectedAssetUrl(src, workspaceId)
  if (!objectUrl || failed) return fallback
  return createElement('img', { src: objectUrl, alt, className })
}
