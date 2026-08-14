import { useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import { cx } from '../../shared/cx.js'
import { RuntimeIcon as Icon } from '../../shared/RuntimeIcon.jsx'
import { formatReadingMinutes } from '../../shared/format.js'
import BookCover from './BookCover.jsx'
import { GlassCard } from './Glass.jsx'
import { useStudent } from '../state/StudentContext.jsx'

// 书籍卡只展示服务端明确返回的书籍事实、有效阅读时间和最近位置。
// 最近页码只是继续阅读的位置，不能换算百分比或推断已经读完。
// 班级共读书籍额外显示班级参与人数（学生有一次有效阅读才算已参与）。
//
// 所有书籍都先进详情页再开始阅读（规格 §5.4），所以卡片点击目标是 books/:id，
// 不是 reader/:id；点击时把封面位置交给 StudentContext，详情页据此做放大过渡。
export default function BookCard({ book, layout = 'grid', index = 0 }) {
  const navigate = useNavigate()
  const { isLiked, prefs } = useStudent()
  const coverRef = useRef(null)
  const liked = isLiked(book.id)
  const progress = book.progress || {}
  const cls = book.classReading?.state ? book.classReading : null
  const minutes = Number.isFinite(progress.effectiveMinutes)
    ? formatReadingMinutes(progress.effectiveMinutes)
    : null

  const open = useCallback(() => {
    if (coverRef.current && !prefs.reduceMotion) coverRef.current.getBoundingClientRect()
    navigate(`/student/books/${book.id}`)
  }, [book.id, navigate, prefs.reduceMotion])

  return (
    <GlassCard
      className={cx(
        'student-book-card student-stagger group flex cursor-pointer flex-col p-3 text-left',
        layout === 'rail' ? 'w-[178px] shrink-0' : 'w-full',
      )}
      style={{ '--i': index }}
      role="link"
      tabIndex={0}
      aria-label={`${book.title || '服务端未返回书名'}，${book.author || '服务端未返回作者'}`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
    >
      <div ref={coverRef} className="relative shrink-0">
        <BookCover book={book} className="student-cover" />
        {/* 爱心：加入或移出「我喜欢的书」，不冒充其它书单操作 */}
        <button
          type="button"
          aria-pressed={liked}
          aria-label={`前往《${book.title}》详情管理收藏`}
          title="前往书籍详情管理「我喜欢的书」"
          onClick={(event) => {
            event.stopPropagation()
            open()
          }}
          className="student-like absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full"
        >
          <Icon
            name="Heart"
            className={cx('h-4 w-4 transition', liked ? 'text-[#E8607F]' : 'text-white')}
            fill={liked ? 'currentColor' : 'none'}
            strokeWidth={liked ? 0 : 2}
          />
        </button>
        {book.downloaded && (
          <span className="absolute bottom-2 left-2 flex flex-col items-start gap-1">
              <span className="student-chip inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-micro font-semibold text-ink-700">
                <Icon name="Download" className="h-3 w-3" strokeWidth={2.2} />
                已下载
              </span>
          </span>
        )}
      </div>

      {/* 卡内分区高度固定：一行里有的书带班级共读、有的没有，
          如果任其自适应，同一行卡片的书名、时间行、进度条会错开（第二轮自检的返工点）*/}
      <div className="mt-2.5 min-h-[44px]">
        <h3 className="truncate font-serif text-title font-bold text-ink-900">{book.title || '服务端未返回书名'}</h3>
        <p className="mt-0.5 truncate text-micro text-ink-500">{book.author || '服务端未返回作者'}</p>
      </div>

      <div className="mt-1.5 flex h-[18px] items-center gap-1.5 whitespace-nowrap text-micro text-ink-500">
        {minutes && (
          <>
            <Icon name="Timer" className="h-3.5 w-3.5 shrink-0 text-ink-400" strokeWidth={1.9} />
            <span className="tabular-nums">{minutes}</span>
          </>
        )}
      </div>
      <p className="mt-1.5 text-micro text-ink-400 tabular-nums">
        {Number.isSafeInteger(progress.currentPage) ? `上次位置：第 ${progress.currentPage} 页` : '暂无最近阅读位置'}
      </p>

      {cls && (
        <div className="mt-auto border-t border-ink-100 pt-2">
          <p className="flex items-center gap-1.5 text-micro text-ink-600">
            <Icon
              name={cls.state === 'current' ? 'Users' : 'History'}
              className={cx('h-3.5 w-3.5', cls.state === 'current' ? 'text-[#3B77E8]' : 'text-ink-400')}
              strokeWidth={2}
            />
            {cls.state === 'current' ? '班级共读中' : '历史共读'}
            <span className="text-ink-300">·</span>
            {cls.teacher || '服务端未返回教师'}
          </p>
          <p className="mt-1 whitespace-nowrap text-micro text-ink-400 tabular-nums">
            {cls.joined != null && cls.classSize != null ? `班级 ${cls.joined}/${cls.classSize} 人参与` : '参与人数由服务端返回'}
          </p>
        </div>
      )}
    </GlassCard>
  )
}
