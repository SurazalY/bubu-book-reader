import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookCover, cx, Icon } from '../../components/ui.jsx'
import { GlassCard, GlassPanel } from '../components/Glass.jsx'
import PageHead from '../components/PageHead.jsx'
import { useStudent } from '../state/StudentContext.jsx'
import usePersonalReadingAdapter, { formatMinutes } from '../state/usePersonalReadingAdapter.js'

const FOOTPRINT_PERIODS = [
  { key: 'week', label: '本周', days: 7 },
  { key: 'month', label: '本月', days: 30 },
  { key: 'year', label: '今年', days: 365 },
]

const READING_GLOSSARY = [
  { term: '有效阅读', desc: '只统计前台、亮屏且有交互的阅读区间，重叠设备不会重复累计。', icon: 'BookOpen' },
  { term: '护眼时长', desc: '记录有效用眼状态，用于提示休息，不会生成同学排名。', icon: 'Eye' },
]

function dateKey(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function startOfPeriod(now, days) {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - days + 1)
  return start
}

function buildBars(events, now) {
  const minutesByDay = new Map()
  events.forEach((event) => {
    const key = dateKey(event.occurredAt)
    if (!key) return
    minutesByDay.set(key, (minutesByDay.get(key) || 0) + Number(event.validReadingSeconds || 0) / 60)
  })
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now)
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - 6 + index)
    return {
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      minutes: Math.round(minutesByDay.get(dateKey(date)) || 0),
    }
  })
}

// 阅读足迹（规格 §10.3）：周／月／年三个周期 + 有效阅读总量、阅读天数与趋势。
// 「有效阅读」和「护眼时长」是两套口径，这一页必须分开解释，不能混成一个数字。
export default function Footprint() {
  const { runtime } = useStudent()
  const { books, library, statistics } = usePersonalReadingAdapter({
    workspaceId: runtime.data?.workspaceId,
    books: runtime.data?.books || [],
  })
  const [period, setPeriod] = useState('week')
  const periodMeta = FOOTPRINT_PERIODS.find((item) => item.key === period) || FOOTPRINT_PERIODS[0]
  const data = useMemo(() => {
    const now = new Date()
    const start = startOfPeriod(now, periodMeta.days)
    const events = (library.footprints || []).filter((event) => {
      const occurredAt = new Date(event.occurredAt)
      return !Number.isNaN(occurredAt.getTime()) && occurredAt >= start && Number(event.validReadingSeconds || 0) > 0
    })
    const minutes = Math.round(events.reduce((sum, event) => sum + Number(event.validReadingSeconds || 0) / 60, 0))
    const days = new Set(events.map((event) => dateKey(event.occurredAt)).filter(Boolean)).size
    return {
      label: periodMeta.label,
      minutes,
      days,
      finished: books.filter((book) => book.finished).length,
      note: '来自已保存的有效阅读事件',
      bars: buildBars(events, now),
    }
  }, [books, library.footprints, periodMeta.days, periodMeta.label])
  const max = Math.max(...data.bars.map((b) => b.minutes), 1)
  const activeBars = data.bars.filter((b) => b.minutes > 0).length
  const avg = activeBars ? Math.round(data.minutes / activeBars) : 0
  const topBooks = books.filter((book) => book.minutes > 0)
    .slice()
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 3)

  return (
    <div className="flex-1 space-y-4">
      <PageHead
        title="阅读足迹"
        desc="这里只统计你自己的有效阅读，不和同学比较，也没有名次。"
      >
        <div className="student-segment inline-flex rounded-full p-1">
          {FOOTPRINT_PERIODS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setPeriod(item.key)}
              aria-pressed={period === item.key}
              className={cx(
                'rounded-full px-4 py-2 text-caption transition',
                period === item.key ? 'student-segment--on font-semibold text-ink-900' : 'text-ink-500 hover:text-ink-800',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </PageHead>

      <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={`${data.label}有效阅读`} value={formatMinutes(data.minutes, { zero: '0 分钟' })} note={data.note} />
          <Stat label="阅读天数" value={`${data.days} 天`} note="产生过有效阅读的天数" />
          <Stat label="读完的书" value={`${data.finished} 本`} note="当前已经读到最后一页的书" />
          <Stat label="平均每次" value={formatMinutes(avg, { zero: '0 分钟' })} note="有阅读的那些天的平均值" />
        </div>

        {/* 周期趋势用柱状：环形只给总量固定的数据（额度、护眼余量） */}
        <div className="mt-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-title font-semibold text-ink-900">{data.label}的分布</h2>
            <span className="text-micro text-ink-400">单位：分钟</span>
          </div>
          <ul className="mt-4 flex items-end gap-2.5" style={{ height: 168 }}>
            {data.bars.map((b, i) => {
              const h = Math.round((b.minutes / max) * 128)
              return (
                <li key={b.label} className="student-stagger flex flex-1 flex-col items-center justify-end gap-2" style={{ '--i': i }}>
                  <span className="text-micro font-semibold text-ink-700 tabular-nums">
                    {b.minutes ? b.minutes : '—'}
                  </span>
                  {b.minutes > 0 ? (
                    <span className="student-foot-bar w-full rounded-lg" style={{ height: Math.max(h, 8) }} />
                  ) : (
                    <span className="student-foot-bar--empty w-full rounded-lg" style={{ height: 8 }} />
                  )}
                  <span className="text-micro text-ink-500">{b.label}</span>
                </li>
              )
            })}
          </ul>
        </div>
      </GlassPanel>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
          <h2 className="font-serif text-h3 font-bold text-ink-900">两个时间不是一回事</h2>
          <div className="mt-4 space-y-3">
            {READING_GLOSSARY.map((g) => (
              <div key={g.term} className="flex gap-3 rounded-xl bg-white/62 px-4 py-3.5">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/80 text-ink-500">
                  <Icon name={g.icon} className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-title font-semibold text-ink-900">{g.term}</span>
                  <span className="mt-0.5 block text-caption leading-relaxed text-ink-500">{g.desc}</span>
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-micro text-ink-400 tabular-nums">
            今天护眼时长 {formatMinutes((statistics.data?.eyeCare?.todayValidEyeSeconds || 0) / 60)}，其中有效阅读的部分才会算进上面的足迹。
          </p>
          <Link
            to="/student/me/usage"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/72 px-4 py-2 text-caption font-semibold text-ink-700 transition hover:bg-white"
          >
            看用量与护眼
            <Icon name="ChevronRight" className="h-4 w-4" />
          </Link>
        </GlassPanel>

        <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-serif text-h3 font-bold text-ink-900">读得最久的三本</h2>
            <Link to="/student/shelf" className="text-caption font-semibold text-ink-500 hover:text-ink-900">
              去书架看看
            </Link>
          </div>
          <ul className="mt-4 space-y-2.5">
            {topBooks.map((b, i) => (
              <li key={b.id} className="student-stagger" style={{ '--i': i }}>
                <Link
                  to={`/student/books/${b.id}`}
                  className="group flex items-center gap-3 rounded-xl bg-white/62 px-3.5 py-3 transition hover:bg-white/90"
                >
                  <BookCover book={b} className="w-[40px] shrink-0 rounded-md shadow-e1" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-serif text-title font-bold text-ink-900">{b.title}</span>
                    <span className="mt-0.5 block text-micro text-ink-400 tabular-nums">
                      已读 {b.percent}% · {formatMinutes(b.minutes)}
                    </span>
                  </span>
                  <Icon name="ChevronRight" className="h-4 w-4 shrink-0 text-ink-300 transition group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-micro text-ink-400">
            累计 {formatMinutes((statistics.data?.totalEffectiveReadingSeconds || 0) / 60)}，开始读过 {statistics.data?.levelInput?.startedBookCount || 0} 本。
          </p>
        </GlassPanel>
      </div>
    </div>
  )
}

function Stat({ label, value, note }) {
  return (
    <GlassCard className="px-4 py-3.5">
      <span className="text-micro text-ink-500">{label}</span>
      <p className="mt-1.5 font-serif text-h2 font-bold text-ink-900 tabular-nums">{value}</p>
      <p className="mt-1 text-micro leading-relaxed text-ink-400">{note}</p>
    </GlassCard>
  )
}
