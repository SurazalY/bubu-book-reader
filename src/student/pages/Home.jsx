import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { cx } from '../../shared/cx.js'
import { RuntimeIcon as Icon } from '../../shared/RuntimeIcon.jsx'
import { formatReadingMinutes } from '../../shared/format.js'
import { GlassCard, GlassPanel } from '../components/Glass.jsx'
import BookCard from '../components/BookCard.jsx'
import BookCover from '../components/BookCover.jsx'
import Clock from '../components/Clock.jsx'
import { HOME_LIST_LIMIT, useStudent } from '../state/StudentContext.jsx'

// 主页（规格 §4）：时钟 → 五快捷入口 → 「我喜欢的书」→ 自定义书单。
// 红线：不放教师通知、AI 额度、护眼状态、最近心得与社区推荐，它们各归个人主页与社区；
// 读书排行只比自己的书，不出现任何同学比较或班级百分位（Codex 第 85 轮拍板）。
//
export default function Home() {
  const { student, runtime } = useStudent()
  const books = runtime.data?.books || []
  const lists = runtime.data?.homeLists || []
  const summary = runtime.data?.readingSummary || {}
  const level = student?.level || {}
  const ready = runtime.status === 'ready'
  const loading = runtime.status === 'loading'
  const error = runtime.status === 'error'
  const empty = ready && books.length === 0

  const likedBooks = useMemo(
    () => books.filter((book) => book.liked),
    [books],
  )
  const topBook = useMemo(
    () => [...books]
      .filter((book) => Number.isFinite(book.progress?.effectiveMinutes))
      .sort((left, right) => (right.progress.effectiveMinutes || 0) - (left.progress.effectiveMinutes || 0))[0],
    [books],
  )
  const shown = lists.slice(0, HOME_LIST_LIMIT)
  const folded = lists.length - shown.length

  const shortcuts = [
    {
      key: 'time',
      label: '有效阅读总时间',
      value: loading ? '正在读取' : formatReadingMinutes(summary.effectiveMinutes) || '服务端未返回',
      hint: '由服务端按有效阅读规则计算。',
      icon: 'Timer',
      tint: '#2FA38C',
      soft: 'rgba(214, 242, 232, 0.9)',
      to: '/student/me/footprint',
    },
    {
      key: 'level',
      label: '阅读等级',
      value: loading ? '正在读取' : level.value != null ? `Lv.${level.value}${level.title ? ` ${level.title}` : ''}` : '服务端未返回',
      hint: '等级只表达服务端返回的个人成长数据。',
      icon: 'Sparkles',
      tint: '#8B7BE0',
      soft: 'rgba(232, 228, 250, 0.9)',
      to: '/student/me/level',
    },
    {
      key: 'download',
      label: '本地下载',
      value: loading ? '正在读取' : summary.downloadedBookCount != null ? `${summary.downloadedBookCount} 本` : '服务端未返回',
      hint: '仅根据书架 API 中可用的下载状态显示。',
      icon: 'Download',
      tint: '#3B77E8',
      soft: 'rgba(220, 233, 252, 0.9)',
      to: '/student/shelf',
    },
    {
      key: 'recent',
      label: '最近阅读',
      value: loading ? '正在读取' : summary.startedBookCount != null ? `${summary.startedBookCount} 本` : '服务端未返回',
      hint: '由服务端阅读进度汇总返回。',
      icon: 'Clock',
      tint: '#4E9BD8',
      soft: 'rgba(219, 238, 250, 0.9)',
      to: '/student/shelf',
    },
    {
      key: 'ranking',
      label: '读书排行 · 本周最多',
      value: loading ? '正在读取' : topBook?.title || '暂无可比较数据',
      hint: '只排自己读过的书，按有效阅读时间，不和同学比较。',
      icon: 'BarChart3',
      tint: '#2FA38C',
      soft: 'rgba(216, 241, 231, 0.9)',
      to: '/student/home/ranking',
    },
  ]

  return (
    <div className="space-y-6 pb-2">
      <Clock className="student-enter px-1 pt-1" />

      {/* 五快捷入口：母版是一行五张等宽玻璃卡，数值旁必须能看到口径说明或详情入口 */}
      <section className="student-enter grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {shortcuts.map((s, i) => (
          <Link
            key={s.key}
            to={s.to}
            title={s.hint}
            className="student-stagger student-quick group block rounded-xl"
            style={{ '--i': i }}
          >
            <GlassCard className="flex h-full items-center gap-3 px-3.5 py-3.5">
              <span
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full"
                style={{ background: s.soft, color: s.tint }}
              >
                <Icon name={s.icon} className="h-[21px] w-[21px]" strokeWidth={1.9} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-micro text-ink-500">{s.label}</span>
                <span className="mt-0.5 block truncate text-title font-bold text-ink-900">{s.value}</span>
              </span>
              <Icon
                name="ChevronRight"
                className="ml-auto h-4 w-4 shrink-0 text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-ink-500"
              />
            </GlassCard>
          </Link>
        ))}
      </section>

      {error && <ConnectionNotice error={runtime.error} onRetry={runtime.reload} />}

      {/* 我喜欢的书：系统书单，固定排在自定义书单之前 */}
      <section className="student-enter">
        <SectionHead
          icon="Heart"
          title="我喜欢的书"
          count={ready ? likedBooks.length : 0}
          to="/student/lists/liked"
          moreLabel="查看全部"
          hideMore={!ready || likedBooks.length === 0}
        />
        {loading ? (
          <BookRailSkeleton />
        ) : error ? (
          <EmptyHint icon="CloudOff" title="喜欢的书暂未显示" desc="书架请求失败时不会显示本地演示书目。" />
        ) : likedBooks.length > 0 ? (
          <div className="student-rail mt-3 flex gap-3 overflow-x-auto pb-2">
            {likedBooks.map((book, i) => (
              <BookCard key={book.id} book={book} layout="rail" index={i} />
            ))}
          </div>
        ) : (
          <EmptyHint
            icon="Heart"
            title="还没有喜欢的书"
            desc={empty ? '服务端返回了空书架，导入书籍后会在这里出现。' : '服务端还没有返回被标记为喜欢的书。'}
          />
        )}
      </section>

      {/* 我的书单：自定义书单，母版是一行三张宽卡 + 右侧封面缩略堆叠 */}
      <section className="student-enter pb-1">
        <SectionHead
          icon="ListMusic"
          title="我的书单"
          count={ready ? lists.length : 0}
          to="/student/lists"
          moreLabel={folded > 0 ? `全部书单（还有 ${folded} 个）` : '管理书单'}
          hideMore={!ready || lists.length === 0}
        />
        {loading ? (
          <ListSkeleton />
        ) : error ? (
          <EmptyHint icon="CloudOff" title="书单暂未显示" desc="请求失败时不会从过渡数据补齐书单。" />
        ) : shown.length > 0 ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((list, i) => (
              <ListCard
                key={list.id}
                list={list}
                index={i}
                canUp={false}
                canDown={false}
              />
            ))}
          </div>
        ) : (
          <EmptyHint
            icon="ListPlus"
            title="还没有自己的书单"
            desc="服务端尚未返回书单，创建后会在这里显示。"
          />
        )}
      </section>

      {/* 新账号引导：空状态下如果只摆两条提示，下方会露出大片背景（Kimi 反例同款），
          所以给一排真实可点的入门书，既把版面撑住也真的有用 */}
      {ready && (
        <section className="student-enter pb-1">
          <div className="flex items-center gap-2.5 px-1">
            <Icon name="Sparkle" className="h-[18px] w-[18px] text-[#2FA38C]" strokeWidth={2} />
            <h2 className="font-serif text-h3 font-bold text-ink-900">书架</h2>
            <span className="text-micro text-ink-400">这里只展示书架 API 返回的真实书籍</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {books.slice(0, 5).map((book, i) => <BookCard key={book.id} book={book} index={i} />)}
          </div>
          {empty && <EmptyHint icon="Library" title="书架暂时没有书" desc="服务端返回了空书架，导入书籍后会在这里出现。" />}
        </section>
      )}
    </div>
  )
}

function SectionHead({ icon, title, count, to, moreLabel, hideMore }) {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <Icon name={icon} className="h-[18px] w-[18px] text-[#2FA38C]" strokeWidth={2} />
      <h2 className="font-serif text-h3 font-bold text-ink-900">{title}</h2>
      {count > 0 && <span className="text-micro text-ink-400 tabular-nums">{count}</span>}
      {!hideMore && (
        <Link
          to={to}
          className="group ml-auto inline-flex items-center gap-1 text-caption text-ink-500 transition hover:text-ink-800"
        >
          {moreLabel}
          <Icon name="ChevronRight" className="h-4 w-4 transition group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  )
}

// 书单卡：左侧名称与本数，右侧三张封面缩略堆叠（母版长相）；
// 顺序调整按钮平时不出现，hover 或键盘聚焦时才浮出来，避免主页出现一堆操作按钮
function ListCard({ list, index, canUp, canDown }) {
  const books = list.books || []
  const preview = books.slice(0, 3)
  const minutes = books.reduce((sum, book) => sum + (book.progress?.effectiveMinutes || 0), 0)
  return (
    <GlassCard className="student-stagger group relative flex items-center gap-3 p-3" style={{ '--i': index }}>
      <Link to={`/student/lists/${list.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-title font-semibold text-ink-900">{list.name}</span>
          <span className="mt-1 block text-micro text-ink-500 tabular-nums">
            {books.length} 本
            {minutes > 0 && (
              <>
                <span className="mx-1.5 text-ink-300">·</span>
                已读 {formatReadingMinutes(minutes)}
              </>
            )}
          </span>
        </span>
        <span className="flex shrink-0 items-center">
          {preview.map((b, i) => (
            <span
              key={b.id}
              className="student-list-thumb"
              style={{ marginLeft: i === 0 ? 0 : -18, zIndex: preview.length - i }}
            >
              <BookCover book={b} className="w-[42px] rounded-md shadow-e1" />
            </span>
          ))}
        </span>
        <Icon name="ChevronRight" className="h-4 w-4 shrink-0 text-ink-300 transition group-hover:text-ink-500" />
      </Link>
      <span className="student-list-move absolute -top-2 right-3 flex items-center gap-1 rounded-full bg-white/94 px-1.5 py-1 shadow-e1">
        <MoveBtn dir="up" disabled={!canUp} name={list.name} />
        <MoveBtn dir="down" disabled={!canDown} name={list.name} />
      </span>
    </GlassCard>
  )
}

function MoveBtn({ dir, disabled, name }) {
  const up = dir === 'up'
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`调整「${name || '此书单'}」顺序的写入接口尚未接入`}
      title="书单排序写入接口尚未接入，未修改本地或服务端数据"
      className={cx(
        'grid h-6 w-6 place-items-center rounded-full transition',
        disabled ? 'text-ink-200' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-800',
      )}
    >
      <Icon name={up ? 'ChevronUp' : 'ChevronDown'} className="h-4 w-4" strokeWidth={2.2} />
    </button>
  )
}

// 空状态：克制的一行说明 + 一个去处，不用大面积营销卡（规格 §4.3）
function EmptyHint({ icon, title, desc, action }) {
  return (
    <GlassPanel tone="card" className="mt-3 flex items-center gap-3.5 rounded-xl px-4 py-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/70 text-ink-400">
        <Icon name={icon} className="h-[19px] w-[19px]" strokeWidth={1.9} />
      </span>
      <span className="min-w-0">
        <span className="block text-title font-semibold text-ink-800">{title}</span>
        <span className="mt-0.5 block text-caption text-ink-500">{desc}</span>
      </span>
      {action && (
        <Link
          to={action.to}
          className="ml-auto shrink-0 rounded-full border border-white/70 bg-white/72 px-3.5 py-2 text-caption font-semibold text-ink-700 transition hover:bg-white/90"
        >
          {action.label}
        </Link>
      )}
    </GlassPanel>
  )
}

function ConnectionNotice({ error, onRetry }) {
  return (
    <GlassPanel tone="card" className="student-enter flex items-center gap-3 rounded-xl border border-warning-100 bg-warning-50/75 px-4 py-3">
      <Icon name="CloudOff" className="h-5 w-5 shrink-0 text-warning-600" />
      <span className="min-w-0 flex-1">
        <span className="block text-caption font-semibold text-ink-800">阅读数据暂不可用</span>
        <span className="mt-0.5 block truncate text-micro text-ink-500">{error?.code || 'DEPENDENCY_UNAVAILABLE'}：{error?.message || '服务端没有返回可用数据'}</span>
      </span>
      <button type="button" onClick={onRetry} className="rounded-full border border-white/80 bg-white px-3 py-1.5 text-micro font-semibold text-ink-700 transition hover:bg-ink-50">
        重试
      </button>
    </GlassPanel>
  )
}

function BookRailSkeleton() {
  return (
    <div className="student-rail mt-3 flex gap-3 overflow-hidden pb-2">
      {[0, 1, 2, 3, 4, 5].map((index) => <div key={index} className="student-glass h-[306px] w-[178px] shrink-0 animate-pulse rounded-xl border border-white/68 bg-white/70" />)}
    </div>
  )
}

function ListSkeleton() {
  return <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((index) => <div key={index} className="student-glass h-[72px] animate-pulse rounded-xl border border-white/68 bg-white/70" />)}</div>
}
