import { cx } from '../../shared/cx.js'

const clamp = (n) => Math.max(0, Math.min(100, Number(n) || 0))

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
