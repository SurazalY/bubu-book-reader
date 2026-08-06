import { cx } from '../../shared/cx.js'

// 首页四个数据块里的小图。母版要求：数据稳定后保持安静，只在首次加载／范围切换时
// 自然生长，所以生长动画统一挂 console-grow（reduce-motion 下自动失效）。
//
// 折线／面积用 viewBox + preserveAspectRatio="none" 横向铺满，描线一律 non-scaling-stroke
// 保证不被拉粗；数据点改用绝对定位的 HTML 圆点，避免非等比缩放把圆压成椭圆。

const TONES = {
  brand: { line: '#3B66F5', soft: 'rgba(59,102,245,0.16)' },
  violet: { line: '#8B7BE8', soft: 'rgba(139,123,232,0.18)' },
  cyan: { line: '#2FB6A8', soft: 'rgba(47,182,168,0.18)' },
  accent: { line: '#F0A83C', soft: 'rgba(240,168,60,0.18)' },
}

const niceTop = (max) => {
  if (max <= 8) return Math.max(4, Math.ceil(max / 2) * 2)
  const pow = Math.pow(10, Math.floor(Math.log10(max)))
  return Math.ceil(max / (pow / 2)) * (pow / 2)
}

const fmt = (n) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : `${n}`)

function AxisY({ top, rows = 4 }) {
  const ticks = Array.from({ length: rows + 1 }, (_, i) => Math.round((top / rows) * (rows - i)))
  return (
    <div className="flex flex-col justify-between text-[9px] leading-none text-ink-300 tabular-nums pr-1.5 w-7 text-right shrink-0">
      {ticks.map((t, i) => (
        <span key={i}>{fmt(t)}</span>
      ))}
    </div>
  )
}

function AxisX({ labels }) {
  return (
    <div className="flex justify-between text-[9px] leading-none text-ink-300 tabular-nums mt-1.5">
      {labels.map((l) => (
        <span key={l}>{l}</span>
      ))}
    </div>
  )
}

// 折线：带端点圆点，最后一个点略大（母版里当前值那个点更明显）
function LineChart({ data, labels, tone, height }) {
  const c = TONES[tone] || TONES.brand
  const top = niceTop(Math.max(...data))
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * 100,
    y: 100 - (v / top) * 100,
  }))
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
  return (
    <div>
      <div className="flex" style={{ height }}>
        <AxisY top={top} />
        <div className="relative flex-1">
          <Grid />
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="console-grow-line absolute inset-0 w-full h-full overflow-visible"
          >
            <path
              d={d}
              fill="none"
              stroke={c.line}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {pts.map((p, i) => (
            <span
              key={i}
              className="absolute rounded-full bg-white console-grow"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: i === pts.length - 1 ? 7 : 5,
                height: i === pts.length - 1 ? 7 : 5,
                transform: 'translate(-50%,-50%)',
                border: `2px solid ${c.line}`,
              }}
            />
          ))}
        </div>
      </div>
      <div className="pl-7">
        {/* 窄卡片里 7 个日期会挤到重叠，超过 5 个就隔一个显示；整页宽度够时全部显示 */}
        <AxisX labels={labels.length > 5 && height <= 96 ? labels.filter((_, i) => i % 2 === 0) : labels} />
      </div>
    </div>
  )
}

// 分时柱：用 HTML 方块而不是 SVG，边缘更干脆；峰值那根加深
function BarChart({ data, labels, tone, peakIndex, height }) {
  const c = TONES[tone] || TONES.brand
  const top = niceTop(Math.max(...data))
  const peak = typeof peakIndex === 'number' ? peakIndex : data.indexOf(Math.max(...data))
  return (
    <div>
      <div className="flex" style={{ height }}>
        <AxisY top={top} />
        <div className="relative flex-1">
          <Grid />
          <div className="absolute inset-0 flex items-end gap-[3px]">
            {data.map((v, i) => (
              <span
                key={i}
                className="flex-1 rounded-[2px] console-grow-bar"
                style={{
                  height: `${Math.max(2, (v / top) * 100)}%`,
                  background: i === peak ? c.line : c.soft,
                  animationDelay: `${i * 18}ms`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="pl-7">
        <AxisX labels={labels} />
      </div>
    </div>
  )
}

// 面积：填充渐变 + 顶部描线，可带一个静态数值气泡
function AreaChart({ data, labels, tone, tip, height }) {
  const c = TONES[tone] || TONES.brand
  const top = niceTop(Math.max(...data))
  const pts = data.map((v, i) => ({ x: (i / (data.length - 1)) * 100, y: 100 - (v / top) * 100 }))
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
  const gid = `area-${tone}`
  return (
    <div>
      <div className="flex" style={{ height }}>
        <AxisY top={top} />
        <div className="relative flex-1">
          <Grid />
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="console-grow-line absolute inset-0 w-full h-full"
          >
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c.line} stopOpacity="0.28" />
                <stop offset="100%" stopColor={c.line} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <path d={`${line} L100,100 L0,100 Z`} fill={`url(#${gid})`} />
            <path
              d={line}
              fill="none"
              stroke={c.line}
              strokeWidth="2"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {tip && (
            <div
              className="absolute -translate-x-1/2 -translate-y-full console-grow"
              style={{ left: `${(tip.at / (data.length - 1)) * 100}%`, top: `${pts[tip.at].y}%` }}
            >
              <div className="mb-1.5 rounded-lg bg-white/95 border border-white shadow-e1 px-2 py-1 text-center whitespace-nowrap">
                <div className="text-[9px] leading-none text-ink-400">{tip.label}</div>
                <div className="text-[11px] leading-tight font-semibold" style={{ color: c.line }}>
                  {tip.value}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="pl-7">
        <AxisX labels={labels} />
      </div>
    </div>
  )
}

// 构成环：右侧带图例，点击图例段落由外层决定是否下钻
function DonutChart({ segments, total, onPick }) {
  const sum = segments.reduce((s, x) => s + x.value, 0) || 1
  const size = 92
  const stroke = 13
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  let acc = 0
  return (
    <div className="flex items-center gap-4 h-[86px]">
      <svg width={size} height={size} className="-rotate-90 shrink-0" role="img" aria-label="构成占比">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EDF0F6" strokeWidth={stroke} />
        {segments.map((s) => {
          const len = (s.value / sum) * c
          const el = (
            <circle
              key={s.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={`${Math.max(0, len - 2)} ${c}`}
              strokeDashoffset={-acc}
              strokeLinecap="butt"
              className="console-ring-fill"
            />
          )
          acc += len
          return el
        })}
      </svg>
      <ul className="flex-1 min-w-0 space-y-1">
        {segments.map((s) => (
          <li key={s.label}>
            <button
              type="button"
              onClick={onPick ? () => onPick(s) : undefined}
              className={cx(
                'w-full flex items-center gap-2 text-left rounded-md px-1 -mx-1 py-[1px]',
                onPick && 'hover:bg-white/70 transition',
              )}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="text-[11px] text-ink-600 truncate flex-1">{s.label}</span>
              <span className="text-[11px] font-semibold text-ink-800 tabular-nums">{s.value}</span>
            </button>
          </li>
        ))}
      </ul>
      {total != null && <span className="sr-only">共 {total} 项</span>}
    </div>
  )
}

// 三条极淡水平参考线，让数字有落点又不抢眼
function Grid() {
  return (
    <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="h-px w-full bg-ink-150/60" />
      ))}
    </div>
  )
}

// height 默认 72（首页数据块的尺寸）；整页图表可以传更大值，不影响已有调用
export default function MiniChart({ chart, tone = 'brand', onPick, height = 72 }) {
  if (!chart) return null
  if (chart.type === 'donut') return <DonutChart segments={chart.segments} onPick={onPick} />
  if (chart.type === 'bar')
    return (
      <BarChart data={chart.data} labels={chart.labels} tone={tone} peakIndex={chart.peakIndex} height={height} />
    )
  if (chart.type === 'area')
    return <AreaChart data={chart.data} labels={chart.labels} tone={tone} tip={chart.tip} height={height} />
  return <LineChart data={chart.data} labels={chart.labels} tone={tone} height={height} />
}
