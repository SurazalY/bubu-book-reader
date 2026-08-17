import { useEffect, useState } from 'react'

import { cx } from '../../shared/cx.js'
import { useStudent } from '../state/StudentContext.jsx'

function useProtectedCoverUrl(coverUrl) {
  const { runtime } = useStudent()
  const workspaceId = runtime.data?.workspaceId
  const [objectUrl, setObjectUrl] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!coverUrl) {
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

    fetch(coverUrl, {
      credentials: 'include',
      headers: {
        Accept: 'image/*',
        'X-Workspace-Id': workspaceId,
      },
    }).then((response) => {
      if (!response.ok) throw new Error(`封面资源响应 ${response.status}`)
      return response.blob()
    }).then((blob) => {
      if (cancelled) return
      if (!blob.type.startsWith('image/')) throw new Error('封面资源不是图片')
      created = URL.createObjectURL(blob)
      if (cancelled) {
        URL.revokeObjectURL(created)
        return
      }
      setObjectUrl(created)
    }).catch(() => {
      if (cancelled) return
      setObjectUrl(null)
      setFailed(true)
    })

    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [coverUrl, workspaceId])

  return { objectUrl, failed }
}

export default function BookCover({ book, className }) {
  const { objectUrl, failed } = useProtectedCoverUrl(book?.coverUrl)
  const available = Boolean(objectUrl) && !failed
  const unavailable = Boolean(!book?.coverUrl || failed)

  return (
    <div className={cx('relative aspect-[3/4] rounded-xl overflow-hidden shadow-e2 bg-gradient-to-br from-[#d7b979] via-[#a88653] to-[#5b7b81]', className)}>
      <div className="absolute inset-0 bg-hero-sheen opacity-50" />
      {available ? (
        <img
          src={objectUrl}
          alt={book.title || '书籍封面'}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col justify-end p-4 text-white">
          {unavailable && (
            <span className="text-micro tracking-[0.22em] text-white/80">封面资源不可用</span>
          )}
          <strong className="mt-2 font-serif text-title leading-snug">{book?.title || '服务端未返回书名'}</strong>
        </div>
      )}
    </div>
  )
}
