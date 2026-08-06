import { cx } from '../../shared/cx.js'

const clamp = (n) => Math.max(0, Math.min(100, Number(n) || 0))

// 书签聚合：位置相近的书签合成一根线，避免书签多时糊成一片。
// 规格原文「蓝色细线表示书签位置，书签过多时聚合显示」。
function clusterMarks(marks, tolerance) {
  const list = marks
    .map((m) => (typeof m === 'number' ? { at: m } : m))
    .map((m) => ({ ...m, at: clamp(m.at) }))
    .sort((a, b) => a.at - b.at)
  const out = []
  for (const m of list) {
    const last = out[out.length - 1]
    if (last && m.at - last.at <= tolerance) {
      last.count += 1
      last.pages.push(m.page)
      last.at = (last.at * (last.count - 1) + m.at) / last.count
    } else {
      out.push({ at: m.at, count: 1, pages: [m.page] })
    }
  }
  return out
}

// 阅读进度条：
// - 已读用绿色荧光段，未读用淡粉段，两段在「同一条带」内；
// - 书签是落在轨道内部的蓝色细线，绝不允许画到封面顶部（Kimi 原型的返工点）；
// - 完全未读时不显示进度条；
// - 进度不能只靠颜色表达，必须同时给百分比或页码。
export function BookProgress({
  percent,
  page,
  totalPages,
  bookmarks = [],
  size = 'md',
  showText = true,
  className,
}) {
  const hasProgress = Number.isFinite(Number(percent))
  const v = clamp(percent)
  const unread = v <= 0
  const h = size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-3' : 'h-2'
  const tol = size === 'sm' ? 6 : 4
  const marks = clusterMarks(bookmarks, tol)

  if (!hasProgress) {
    return showText ? <p className={cx('text-micro text-ink-400', className)}>服务端未返回阅读进度</p> : null
  }

  if (unread) {
    return showText ? (
      <p className={cx('text-micro text-ink-400', className)}>尚未开始阅读</p>
    ) : null
  }

  return (
    <div className={className}>
      <div
        className={cx('student-track relative w-full rounded-full overflow-hidden', h)}
        role="progressbar"
        aria-valuenow={v}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="阅读进度"
      >
        <div className="student-bar-fill absolute inset-y-0 left-0 rounded-full" style={{ width: `${v}%` }} />
        {marks.map((m, i) => (
          <span
            key={i}
            className={cx('student-bookmark absolute top-0 bottom-0 rounded-full', m.count > 1 ? 'w-[3px]' : 'w-[2px]')}
            style={{ left: `calc(${m.at}% - 1px)` }}
            title={
              m.count > 1
                ? `${m.count} 个书签（第 ${m.pages.filter(Boolean).join('、')} 页）`
                : `书签${m.pages[0] ? ` · 第 ${m.pages[0]} 页` : ''}`
            }
          />
        ))}
      </div>
      {showText && (
        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <span className="text-micro text-ink-500 tabular-nums">
            {page && totalPages ? `第 ${page} / ${totalPages} 页` : '已读'}
          </span>
          <span className="text-micro font-semibold text-ink-700 tabular-nums">{v}%</span>
        </div>
      )}
    </div>
  )
}

// 环状进度：只给 AI 剩余额度与护眼比例这类「总量固定」的数据；
// 时间趋势类数据用折线或面积，不强行画成环。
export function RingProgress({ value, label, sub, size = 92, stroke = 9, tone = 'mint', className }) {
  const v = clamp(value)
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const ends = { mint: '#2FB79A', sky: '#3B77E8', apricot: '#F2A33E', danger: '#F2553D' }
  const to = ends[tone] || ends.mint
  const gid = `student-ring-${tone}`
  return (
    <div className={cx('inline-flex flex-col items-center gap-2', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#7FE0C4" />
              <stop offset="100%" stopColor={to} />
            </linearGradient>
          </defs>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E9E6DE" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={`url(#${gid})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - v / 100)}
            className="student-ring-fill"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-h3 font-bold text-ink-900 tabular-nums leading-none">{v}%</span>
          {sub && <span className="text-micro text-ink-400 mt-1">{sub}</span>}
        </div>
      </div>
      {label && <span className="text-caption text-ink-600">{label}</span>}
    </div>
  )
}
