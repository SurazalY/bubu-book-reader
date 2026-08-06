import { cx } from '../../shared/cx.js'

const clamp = (n) => Math.max(0, Math.min(100, Number(n) || 0))

// 条状进度：青→蓝渐变填充，高光只扫「已填充部分」，空轨道不发光。
// markers 是落在条内的标记线（如教师建议位置、书签），必须画在轨道内部，
// 不能跑到封面或卡片顶部去 —— 这是之前原型翻过车的地方。
export function BarProgress({
  value,
  markers = [],
  label,
  hint,
  showValue = true,
  tone = 'brand',
  size = 'md',
  className,
}) {
  const v = clamp(value)
  const h = size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-3' : 'h-2'
  const fills = {
    brand: 'linear-gradient(90deg, #35C5E8 0%, #3B66F5 100%)',
    success: 'linear-gradient(90deg, #4BD6A8 0%, #0E9E73 100%)',
    warning: 'linear-gradient(90deg, #FFC074 0%, #F5A524 100%)',
    danger: 'linear-gradient(90deg, #FF9C86 0%, #F2553D 100%)',
  }
  return (
    <div className={className}>
      {(label || showValue) && (
        <div className="flex items-baseline justify-between gap-3 mb-1.5">
          {label && <span className="text-caption text-ink-600">{label}</span>}
          {showValue && <span className="text-caption font-semibold text-ink-800 tabular-nums">{v}%</span>}
        </div>
      )}
      <div
        className={cx('relative w-full rounded-full bg-ink-150/80 overflow-hidden', h)}
        role="progressbar"
        aria-valuenow={v}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label || '进度'}
      >
        <div
          className="console-bar-fill absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${v}%`, backgroundImage: fills[tone] || fills.brand }}
        />
        {markers.map((m, i) => {
          const p = clamp(typeof m === 'number' ? m : m.at)
          const color = (typeof m === 'object' && m.color) || '#2E51DB'
          return (
            <span
              key={i}
              className="absolute top-0 bottom-0 w-[2px] rounded-full"
              style={{ left: `calc(${p}% - 1px)`, background: color }}
              title={(typeof m === 'object' && m.title) || `标记 ${p}%`}
            />
          )
        })}
      </div>
      {hint && <p className="text-micro text-ink-400 mt-1.5">{hint}</p>}
    </div>
  )
}

// 环状进度：与条状表达同一组额度数据，可在页面上切换；趋势类数据不用环。
export function RingProgress({ value, label, sub, size = 92, stroke = 9, tone = 'brand', className }) {
  const v = clamp(value)
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const colors = { brand: '#3B66F5', success: '#0E9E73', warning: '#F5A524', danger: '#F2553D' }
  const to = colors[tone] || colors.brand
  const gid = `ring-${tone}`
  return (
    <div className={cx('inline-flex flex-col items-center gap-2', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#35C5E8" />
              <stop offset="100%" stopColor={to} />
            </linearGradient>
          </defs>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E6E9F0" strokeWidth={stroke} />
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
            className="console-ring-fill"
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
