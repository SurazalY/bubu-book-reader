import { useState } from 'react'

import { cx } from '../../shared/cx.js'

export default function BookCover({ book, className }) {
  const [failed, setFailed] = useState(false)
  const available = Boolean(book?.coverUrl) && !failed

  return (
    <div className={cx('relative aspect-[3/4] rounded-xl overflow-hidden shadow-e2 bg-gradient-to-br from-[#d7b979] via-[#a88653] to-[#5b7b81]', className)}>
      <div className="absolute inset-0 bg-hero-sheen opacity-50" />
      {available ? (
        <img
          src={book.coverUrl}
          alt={book.title || '书籍封面'}
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col justify-end p-4 text-white">
          <span className="text-micro tracking-[0.22em] text-white/80">封面资源不可用</span>
          <strong className="mt-2 font-serif text-title leading-snug">{book?.title || '服务端未返回书名'}</strong>
        </div>
      )}
    </div>
  )
}
