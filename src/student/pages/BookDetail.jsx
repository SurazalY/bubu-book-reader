import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BookCover, cx, GenreTag, Icon } from '../../components/ui.jsx'
import { buildStudentReaderUrl } from '../../api/student.js'
import { GlassCard, GlassPanel } from '../components/Glass.jsx'
import { useStudent } from '../state/StudentContext.jsx'
import useReadingLibrary from '../state/useReadingLibrary.js'
import useRefreshStudentRuntimeOnMount from '../state/useRefreshStudentRuntimeOnMount.js'
import { useStudentCommunity } from '../community/CommunityRuntimeContext.jsx'

function formatMinutes(value, { zero = '0 分钟' } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const minutes = Math.round(value)
  if (minutes <= 0) return zero
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

function toDetailBook(raw, { grade, library }) {
  if (!raw) return null
  const progress = raw.progress || {}
  const bookmarks = library.bookmarks.filter((item) => item.bookVersionId === raw.versionId)
  const excerpts = library.excerpts.filter((item) => item.bookVersionId === raw.versionId)
  const annotations = library.annotations.filter((item) => item.bookVersionId === raw.versionId)
  const classroom = raw.classReading
  return {
    ...raw,
    genre: raw.genre || '阅读书目',
    grade: raw.grade || grade || '当前年级',
    subject: raw.subject || '整本书阅读',
    blurb: raw.blurb || raw.description || '书籍资料由服务端真实书目返回。',
    page: Number.isSafeInteger(progress.currentPage) ? progress.currentPage : null,
    totalPages: Number.isSafeInteger(progress.totalPages) ? progress.totalPages : null,
    minutes: Number.isFinite(progress.effectiveMinutes) ? progress.effectiveMinutes : null,
    bookmarks: bookmarks.map((item) => item.pageNo).filter(Number.isFinite),
    highlights: excerpts.length,
    notes: annotations.length,
    classReading: classroom
      ? {
          state: classroom.mode === 'ended' ? 'history' : 'current',
          teacher: classroom.teacher || '教师',
          teacherPage: classroom.page || 0,
          range: classroom.label || '课堂共读',
          goal: classroom.desc || '课堂共读状态由服务端返回。',
          joined: classroom.joined || 0,
          classSize: classroom.classSize || 0,
        }
      : null,
  }
}

// 书籍详情（规格 §5.4）：所有书都先进这里，再由学生点「开始阅读」或「继续阅读」。
// 最近页码只用于恢复位置；不换算完成百分比，也不与教师建议位置比较。
export default function BookDetail() {
  const { bookId } = useParams()
  const navigate = useNavigate()
  useRefreshStudentRuntimeOnMount()
  const { runtime, student, prefs } = useStudent()
  const { community } = useStudentCommunity()
  const library = useReadingLibrary({ workspaceId: runtime.data?.workspaceId })
  const rawBook = runtime.data?.books?.find((item) => item.id === bookId) || null
  const book = useMemo(
    () => toDetailBook(rawBook, { grade: student?.grade, library }),
    [library.annotations, library.bookmarks, library.excerpts, rawBook, student?.grade],
  )
  const favorite = library.favorites.find((item) => item.bookVersionId === book?.versionId) || null

  const toggleLike = async () => {
    if (!book?.versionId || library.saving) return
    if (favorite) {
      await library.deleteFavorite(favorite.id, favorite.version)
      return
    }
    await library.createFavorite({ bookVersionId: book.versionId, position: library.favorites.length })
  }

  if (!book) {
    return (
      <GlassPanel tone="solid" className="student-enter flex-1 rounded-2xl px-8 py-10">
        <h1 className="font-serif text-h1 font-bold text-ink-900">这本书暂时打不开</h1>
        <p className="mt-2 text-caption text-ink-500">它可能已经不在你的书架里了。回书架看看现在可以读哪些书。</p>
        <Link
          to="/student/shelf"
          className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/75 px-4 py-2.5 text-caption font-semibold text-ink-700 transition hover:bg-white"
        >
          <Icon name="ArrowLeft" className="h-4 w-4" />
          返回书架
        </Link>
      </GlassPanel>
    )
  }

  const liked = Boolean(favorite)
  const cls = book.classReading
  // 直接读社区那一份帖子（Stage 5）：详情页列的就是社区里真实存在的内容，点进去必然是同一篇
  const posts = community.getBookPosts(book.id)
  const hasPosition = Number.isSafeInteger(book.page)
  const readerUrl = hasPosition && book.versionId
    ? buildStudentReaderUrl({
        bookId: book.id,
        bookVersionId: book.versionId,
        lastPageNo: book.page,
        totalPages: book.totalPages,
      })
    : `/student/reader/${encodeURIComponent(book.id)}`

  return (
    <div className="flex-1 space-y-4">
      {/* 顶栏：二级页没有底部导航，返回入口必须一直在 */}
      <div className="student-enter flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/student/shelf')}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/72 px-4 py-2 text-caption font-semibold text-ink-600 transition hover:bg-white/90 hover:text-ink-900"
        >
          <Icon name="ArrowLeft" className="h-4 w-4" />
          返回书架
        </button>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 text-micro text-ink-600">
          <Icon
            name={book.downloaded ? 'HardDriveDownload' : 'Cloud'}
            className={cx('h-4 w-4', book.downloaded ? 'text-[#3B77E8]' : 'text-ink-400')}
            strokeWidth={1.9}
          />
          {book.downloaded ? '已下载到本机，断网也能读' : '在线阅读，可下载后离线读'}
        </span>
      </div>

      <GlassPanel tone="solid" sheen className="student-enter rounded-2xl p-6">
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* 左：封面与阅读入口 */}
          <div className="w-full shrink-0 lg:w-[212px]">
            <FlyingCover book={book} flight={null} clear={() => {}} reduce={prefs.reduceMotion} />
            {/* 按钮底色是低饱和淡蓝淡紫渐变，白字对比度不够（第一轮自检的返工点），
                所以文字用深墨色 */}
            <Link
              to={readerUrl}
              className="student-primary-btn mt-4 flex w-full items-center justify-center gap-2 rounded-full py-3 text-title font-semibold text-ink-900"
            >
              <Icon name="BookOpen" className="h-[18px] w-[18px]" strokeWidth={2.1} />
              打开阅读器
            </Link>
            {hasPosition && (
              <p className="mt-2 text-center text-micro text-ink-500 tabular-nums">
                上次位置：第 {book.page} 页
              </p>
            )}
            <button
              type="button"
              onClick={() => void toggleLike()}
              disabled={library.saving}
              aria-pressed={liked}
              className={cx(
                'mt-3 flex w-full items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-caption font-semibold transition',
                liked
                  ? 'border-[#F4C6D2] bg-[#FDF1F4] text-[#D3536F]'
                  : 'border-white/70 bg-white/72 text-ink-600 hover:bg-white/90',
              )}
            >
              <Icon name="Heart" className="h-4 w-4" fill={liked ? 'currentColor' : 'none'} strokeWidth={liked ? 0 : 2} />
              {liked ? '已在我喜欢的书' : '加入我喜欢的书'}
            </button>
          </div>

          {/* 右：资料与自己的阅读情况 */}
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-display font-bold leading-tight text-ink-900">{book.title}</h1>
            <p className="mt-1.5 text-title text-ink-600">{book.author}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <GenreTag genre={book.genre} />
              <span className="rounded-full bg-white/70 px-2.5 py-1 text-micro font-semibold text-ink-600">
                {book.grade} 年级
              </span>
              <span className="rounded-full bg-white/70 px-2.5 py-1 text-micro font-semibold text-ink-600">
                {book.subject}
              </span>
              <span className="rounded-full bg-white/70 px-2.5 py-1 text-micro text-ink-500 tabular-nums">
                {book.totalPages ? `全书 ${book.totalPages} 页` : '总页数未返回'}
              </span>
            </div>
            <p className="mt-4 text-base leading-relaxed text-ink-600">{book.blurb}</p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <GlassCard className="p-4">
                <p className="text-micro text-ink-500">最近阅读位置</p>
                <p className="mt-1.5 text-h2 font-bold text-ink-900 tabular-nums">
                  {hasPosition ? `第 ${book.page} 页` : '暂无记录'}
                </p>
                <p className="mt-1 text-micro text-ink-400">页码只用于下次继续打开，不表示完成度。</p>
              </GlassCard>
              <GlassCard className="p-4">
                <p className="text-micro text-ink-500">有效阅读时间</p>
                <p className="mt-1.5 text-h2 font-bold text-ink-900 tabular-nums">
                  {formatMinutes(book.minutes, { zero: '0 分钟' }) || '暂未返回'}
                </p>
                <p className="mt-1 text-micro text-ink-400">只统计真实翻页与停留，打开书不计入。</p>
              </GlassCard>
            </div>

            {/* 书签、摘录、心得入口：详情页只给入口，内容页归 Stage 6 */}
            <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
              {[
                { to: '/student/me/highlights', icon: 'Bookmark', label: '书签', value: `${book.bookmarks.length} 处` },
                { to: '/student/me/highlights', icon: 'Quote', label: '摘录', value: `${book.highlights} 条` },
                { to: '/student/me/notes', icon: 'PenLine', label: '我的心得', value: book.notes ? `${book.notes} 篇` : '还没写' },
              ].map((item) => (
                <Link
                  key={item.label}
                  to={item.to}
                  className="group flex items-center gap-2.5 rounded-xl bg-white/62 px-3.5 py-3 transition hover:bg-white/85"
                >
                  <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0 text-[#2FA38C]" strokeWidth={1.9} />
                  <span className="min-w-0">
                    <span className="block text-micro text-ink-500">{item.label}</span>
                    <span className="block truncate text-caption font-semibold text-ink-800">{item.value}</span>
                  </span>
                  <Icon
                    name="ChevronRight"
                    className="ml-auto h-4 w-4 shrink-0 text-ink-300 transition group-hover:translate-x-0.5"
                  />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </GlassPanel>

      {/* 教师建议位置与学生最近位置都是事实，不换算比例或推断差距。 */}
      {cls && (
        <GlassPanel tone="card" className="student-enter rounded-2xl p-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <Icon
              name={cls.state === 'current' ? 'Users' : 'History'}
              className={cx('h-[19px] w-[19px]', cls.state === 'current' ? 'text-[#3B77E8]' : 'text-ink-400')}
              strokeWidth={2}
            />
            <h2 className="font-serif text-h3 font-bold text-ink-900">
              {cls.state === 'current' ? '班级共读中' : '历史共读'}
            </h2>
            <span className="rounded-full bg-white/72 px-2.5 py-1 text-micro text-ink-600">{cls.teacher} 安排</span>
            <span className="rounded-full bg-white/72 px-2.5 py-1 text-micro text-ink-600 tabular-nums">{cls.range}</span>
            {cls.state === 'history' && (
              <span className="text-micro text-ink-500">共读已结束，这本书仍可以继续读。</span>
            )}
          </div>

          <p className="mt-3 text-caption text-ink-600">
            <span className="font-semibold text-ink-800">阅读目标：</span>
            {cls.goal}
          </p>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl bg-white/60 px-4 py-3.5">
              <p className="flex items-center justify-between text-micro text-ink-500">
                <span>老师建议位置</span>
                <span className="font-semibold text-ink-700 tabular-nums">
                  {cls.teacherPage ? `第 ${cls.teacherPage} 页` : '暂未指定'}
                </span>
              </p>
              <p className="mt-2 text-micro text-ink-500">这是课堂安排的位置提示，不代表个人完成情况。</p>
            </div>
            <div className="rounded-xl bg-white/60 px-4 py-3.5">
              <p className="flex items-center justify-between text-micro text-ink-500">
                <span>我的最近位置</span>
                <span className="font-semibold text-ink-700 tabular-nums">
                  {hasPosition ? `第 ${book.page} 页` : '暂无记录'}
                </span>
              </p>
              <p className="mt-2 text-micro text-ink-500">继续阅读会从服务端保存的这一位置打开。</p>
            </div>
          </div>

          <p className="mt-3 flex items-center gap-1.5 text-micro text-ink-500 tabular-nums">
            <Icon name="UserCheck" className="h-4 w-4 text-ink-400" strokeWidth={1.9} />
            班级 {cls.joined}／{cls.classSize} 人已参与阅读（产生过有效阅读记录才计入）
          </p>
        </GlassPanel>
      )}

      {/* 相关共读社区内容：轻量入口，不把完整信息流塞进详情页 */}
      <GlassPanel tone="card" className="student-enter rounded-2xl p-5">
        <div className="flex items-center gap-2.5">
          <Icon name="MessagesSquare" className="h-[19px] w-[19px] text-[#2FA38C]" strokeWidth={2} />
          <h2 className="font-serif text-h3 font-bold text-ink-900">这本书的共读内容</h2>
          <Link
            to="/student/community"
            className="group ml-auto inline-flex items-center gap-1 text-caption text-ink-500 transition hover:text-ink-800"
          >
            去共读社区
            <Icon name="ChevronRight" className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </Link>
        </div>
        {posts.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {posts.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/student/community/${p.id}`}
                  className="flex items-center gap-3 rounded-xl bg-white/60 px-3.5 py-3 transition hover:bg-white/85"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-caption font-semibold text-ink-800">{p.title}</span>
                    <span className="mt-0.5 block text-micro text-ink-500">
                      {p.authorId === 'me' ? '我发布的' : p.author?.displayName || '同学发布的'}
                      <span className="mx-1.5 text-ink-300">·</span>
                      {p.scope === 'school' ? '学校社区' : '班级社区'}
                      <span className="mx-1.5 text-ink-300">·</span>
                      {p.at}
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-micro text-ink-500 tabular-nums">
                    <Icon name="ThumbsUp" className="h-3.5 w-3.5 text-ink-400" strokeWidth={1.9} />
                    {p.likes}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-xl bg-white/55 px-3.5 py-3 text-caption text-ink-500">
            还没有同学发布和这本书有关的内容，你可以写下第一篇心得再投稿。
          </p>
        )}
      </GlassPanel>

      {/* 同类的书：无班级共读的书详情页内容少，下方会露出大片背景（Kimi 反例），
          这一块既把版面撑住，也是学生真用得上的去处 */}
      <SimilarBooks book={book} books={runtime.data?.books || []} />
    </div>
  )
}

function SimilarBooks({ book, books }) {
  const similar = books.filter((item) => item.id !== book.id && (item.subject || '整本书阅读') === book.subject).slice(0, 5)
  if (similar.length === 0) return null
  return (
    <GlassPanel tone="card" className="student-enter rounded-2xl p-5">
      <div className="flex items-center gap-2.5">
        <Icon name="Library" className="h-[19px] w-[19px] text-[#2FA38C]" strokeWidth={2} />
        <h2 className="font-serif text-h3 font-bold text-ink-900">同一类的书</h2>
        <span className="text-micro text-ink-400">{book.genre}</span>
        <Link
          to="/student/shelf"
          className="group ml-auto inline-flex items-center gap-1 text-caption text-ink-500 transition hover:text-ink-800"
        >
          去书架
          <Icon name="ChevronRight" className="h-4 w-4 transition group-hover:translate-x-0.5" />
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
        {similar.map((b, i) => (
          <Link
            key={b.id}
            to={`/student/books/${b.id}`}
            className="student-stagger flex items-center gap-2.5 rounded-xl bg-white/60 p-2.5 transition hover:bg-white/85"
            style={{ '--i': i }}
          >
            <BookCover book={b} className="w-[38px] shrink-0 rounded-md shadow-e1" />
            <span className="min-w-0">
              <span className="block truncate text-caption font-semibold text-ink-800">{b.title}</span>
              <span className="mt-0.5 block truncate text-micro text-ink-500">{b.author}</span>
            </span>
          </Link>
        ))}
      </div>
    </GlassPanel>
  )
}

// 封面从书架位置平滑放大移动到详情页（规格 §12 动效）。
// 做法是 FLIP：先把克隆封面按起点位置反向变换，再在下一帧还原为终点位置。
// 「减少动态效果」下完全不播这段，直接静态显示。
function FlyingCover({ book, flight, clear, reduce }) {
  const holder = useRef(null)
  const clone = useRef(null)
  const [flying, setFlying] = useState(() => (!reduce && flight?.id === book.id ? flight.rect : null))

  useEffect(() => {
    // 过渡只在进入详情页的第一帧用一次，用完立刻清掉，避免返回书架后又复用旧坐标
    clear()
  }, [clear])

  useLayoutEffect(() => {
    if (!flying) return undefined
    const el = clone.current
    const box = holder.current
    if (!el || !box) {
      setFlying(null)
      return undefined
    }
    const to = box.getBoundingClientRect()
    el.style.top = `${to.top}px`
    el.style.left = `${to.left}px`
    el.style.width = `${to.width}px`
    el.style.height = `${to.height}px`
    el.style.transformOrigin = 'top left'
    el.style.transform = `translate(${flying.left - to.left}px, ${flying.top - to.top}px) scale(${
      flying.width / to.width
    }, ${flying.height / to.height})`
    const raf = requestAnimationFrame(() => {
      el.style.transition = 'transform 0.42s cubic-bezier(0.16, 1, 0.3, 1)'
      el.style.transform = 'translate(0px, 0px) scale(1, 1)'
    })
    const done = window.setTimeout(() => setFlying(null), 520)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(done)
    }
  }, [flying])

  return (
    <>
      <div ref={holder} className={cx('transition-opacity', flying && 'opacity-0')}>
        <BookCover book={book} className="student-cover shadow-e3" />
      </div>
      {flying && (
        <div ref={clone} className="pointer-events-none fixed z-50">
          <BookCover book={book} className="student-cover h-full w-full shadow-e3" />
        </div>
      )}
    </>
  )
}
