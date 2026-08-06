import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { BookCover, cx, Icon } from '../../components/ui.jsx'
import { formatReadingMinutes } from '../../shared/format.js'
import { GlassPanel } from '../components/Glass.jsx'
import { useStudent } from '../state/StudentContext.jsx'

// 我的读书排行（规格 §4.2）：只比较同一学生读过的不同书籍。
// 红线：不出现同学排名、班级百分位或人气榜；Codex 第 85 轮拍板口径是「个人听歌排行」那种。
export default function Ranking() {
  const { runtime } = useStudent()
  const loading = runtime.status === 'loading'
  const failed = runtime.status === 'error'
  const rows = useMemo(() => (runtime.data?.books || [])
    .map((book) => ({
      ...book,
      effectiveMinutes: Number(book?.progress?.effectiveMinutes) || 0,
    }))
    .filter((book) => book.effectiveMinutes > 0)
    .sort((left, right) => right.effectiveMinutes - left.effectiveMinutes), [runtime.data?.books])
  const top = rows[0]
  const minutesOf = (book) => book.effectiveMinutes

  return (
    <div className="flex-1 space-y-4">
      <div className="student-enter flex items-center gap-3">
        <Link
          to="/student/home"
          className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/72 px-4 py-2 text-caption font-semibold text-ink-600 transition hover:bg-white/90 hover:text-ink-900"
        >
          <Icon name="ArrowLeft" className="h-4 w-4" />
          返回主页
        </Link>
      </div>

      <GlassPanel tone="solid" sheen className="student-enter rounded-2xl p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-h1 font-bold text-ink-900">我的读书排行</h1>
            <p className="mt-1.5 text-caption text-ink-500">
              只排你自己读过的书，按服务端返回的累计有效阅读时间。这里不和同学比较，也没有班级名次。
            </p>
          </div>
          <div className="student-segment inline-flex rounded-full p-1" aria-label="当前统计范围">
            <span className="student-segment--on rounded-full px-4 py-2 text-caption font-semibold text-ink-900">累计</span>
          </div>
        </div>
        <p className="mt-3 text-micro text-ink-400">当前接口只返回累计口径；有效阅读只统计真实翻页与停留。</p>

        {loading ? (
          <div className="mt-6 rounded-xl bg-white/58 px-6 py-10 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white/75 text-ink-300">
              <Icon name="LoaderCircle" className="h-6 w-6 animate-spin" strokeWidth={1.8} />
            </span>
            <p className="mt-3 text-title font-semibold text-ink-800">正在读取个人阅读统计</p>
          </div>
        ) : rows.length > 0 ? (
          <ol className="mt-5 space-y-2.5">
            {rows.map((book, i) => {
              const minutes = minutesOf(book)
              const ratio = top ? Math.max(6, Math.round((minutes / minutesOf(top)) * 100)) : 0
              return (
                <li key={book.id} className="student-stagger" style={{ '--i': i }}>
                  <Link
                    to={`/student/books/${book.id}`}
                    className="group flex items-center gap-3.5 rounded-xl bg-white/62 px-3.5 py-3 transition hover:bg-white/88"
                  >
                    <span
                      className={cx(
                        'w-6 shrink-0 text-center font-serif text-title font-bold tabular-nums',
                        i === 0 ? 'text-[#2FA38C]' : 'text-ink-400',
                      )}
                    >
                      {i + 1}
                    </span>
                    <BookCover book={book} className="w-[44px] shrink-0 rounded-md shadow-e1" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate font-serif text-title font-bold text-ink-900">{book.title}</span>
                        <span className="shrink-0 text-micro text-ink-400">{book.author}</span>
                      </span>
                      <span className="student-rank-track mt-2 block h-1.5 w-full rounded-full">
                        <span className="student-rank-fill block h-full rounded-full" style={{ width: `${ratio}%` }} />
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-caption font-semibold text-ink-800 tabular-nums">
                        {formatReadingMinutes(minutes) || '0 分钟'}
                      </span>
                      <span className="mt-0.5 block text-micro text-ink-400 tabular-nums">
                        {Number.isFinite(Number(book.progress?.percent)) ? `已读 ${book.progress.percent}%` : '进度由服务端计算'}
                      </span>
                    </span>
                    <Icon
                      name="ChevronRight"
                      className="h-4 w-4 shrink-0 text-ink-300 transition group-hover:translate-x-0.5"
                    />
                  </Link>
                </li>
              )
            })}
          </ol>
        ) : (
          <div className="mt-6 rounded-xl bg-white/58 px-6 py-10 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white/75 text-ink-300">
              <Icon name="BarChart3" className="h-6 w-6" strokeWidth={1.8} />
            </span>
            <p className="mt-3 text-title font-semibold text-ink-800">
              {failed ? '阅读统计暂不可用' : '还没有有效阅读记录'}
            </p>
            <p className="mt-1.5 text-caption text-ink-500">
              {failed ? '请求失败时不会回退到本地演示排行。' : '读过的书会按累计有效阅读时间自动排进来。'}
            </p>
            <Link
              to="/student/shelf"
              className="mt-4 inline-block rounded-full border border-white/70 bg-white/75 px-4 py-2 text-caption font-semibold text-ink-700 transition hover:bg-white"
            >
              去书架挑一本
            </Link>
          </div>
        )}
      </GlassPanel>
    </div>
  )
}
