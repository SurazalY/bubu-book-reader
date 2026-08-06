import { useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import { cx } from '../../shared/cx.js'
import { RuntimeIcon as Icon } from '../../shared/RuntimeIcon.jsx'
import { formatReadingMinutes } from '../../shared/format.js'
import BookCover from './BookCover.jsx'
import { GlassCard } from './Glass.jsx'
import { BookProgress } from './Progress.jsx'
import { useStudent } from '../state/StudentContext.jsx'

// 书籍卡（规格 §4.2）：封面、书名、作者、有效阅读时间、个人进度。
// 进度条与书签线一律走 BookProgress，颜色语义在那里统一：绿荧光已读 + 淡粉未读，
// 书签是轨道内部的蓝色细线；完全未读不画进度条，只写「尚未开始阅读」。
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
  const minutes = formatReadingMinutes(progress.effectiveMinutes)

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
          disabled
          aria-pressed={liked}
          aria-label={liked ? `《${book.title}》已在我喜欢的书中，收藏写入接口尚未接入` : `收藏《${book.title}》的写入接口尚未接入`}
          title="收藏写入接口尚未接入，未修改任何本地或服务端数据"
          className="student-like absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full"
        >
          <Icon
            name="Heart"
            className={cx('h-4 w-4 transition', liked ? 'text-[#E8607F]' : 'text-white')}
            fill={liked ? 'currentColor' : 'none'}
            strokeWidth={liked ? 0 : 2}
          />
        </button>
        {/* 已读完与已下载都放封面左下角，纵向叠放；
            放到卡内文字行会在 178px 窄卡里把时间行挤成两行（第一轮自检的返工点）*/}
        {(book.finished || book.downloaded) && (
          <span className="absolute bottom-2 left-2 flex flex-col items-start gap-1">
            {book.finished && (
              <span className="student-chip inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-micro font-semibold text-[#2FA38C]">
                <Icon name="CheckCheck" className="h-3 w-3" strokeWidth={2.4} />
                已读完
              </span>
            )}
            {book.downloaded && (
              <span className="student-chip inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-micro font-semibold text-ink-700">
                <Icon name="Download" className="h-3 w-3" strokeWidth={2.2} />
                已下载
              </span>
            )}
          </span>
        )}
      </div>

      {/* 卡内分区高度固定：一行里有的书带班级共读、有的没有，
          如果任其自适应，同一行卡片的书名、时间行、进度条会错开（第二轮自检的返工点）*/}
      <div className="mt-2.5 min-h-[44px]">
        <h3 className="truncate font-serif text-title font-bold text-ink-900">{book.title || '服务端未返回书名'}</h3>
        <p className="mt-0.5 truncate text-micro text-ink-500">{book.author || '服务端未返回作者'}</p>
      </div>

      {/* 未读的书不重复写一次「尚未开始」：时间行只留占位不写字，
          由下方进度区的「尚未开始阅读」一句话说完（第一轮自检的返工点）*/}
      <div className="mt-1.5 flex h-[18px] items-center gap-1.5 whitespace-nowrap text-micro text-ink-500">
        {minutes && (
          <>
            <Icon name="Timer" className="h-3.5 w-3.5 shrink-0 text-ink-400" strokeWidth={1.9} />
            <span className="tabular-nums">{minutes}</span>
          </>
        )}
      </div>

      <BookProgress
        className="mt-1.5"
        percent={progress.percent}
        page={progress.currentPage}
        totalPages={progress.totalPages}
        bookmarks={(progress.bookmarks || []).map((page) => ({ at: progress.totalPages ? (page / progress.totalPages) * 100 : 0, page }))}
        size="sm"
      />

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
