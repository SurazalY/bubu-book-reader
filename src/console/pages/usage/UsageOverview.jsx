import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cx, Icon } from '../../../components/ui.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, Chip, SubHead } from '../../components/Controls.jsx'
import MiniChart from '../../components/MiniChart.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import { DEMO_THRESHOLDS, getUsageOverview } from '../../data/fixtures/usage.js'

// 用量概览：按交付说明的阅读顺序「总量 → 趋势 → 范围分布 → 异常」排。
// 两条硬要求：同一组额度数据支持条状／环状切换（时间趋势仍是折线，不强行画成环），
// 点分布里的某一段能下钻到已经带好筛选的额度管理页。

const TONE_CHIP = {
  brand: 'bg-brand-50 text-brand-600',
  violet: 'bg-[#F0ECFB] text-[#7C6BD8]',
  cyan: 'bg-[#E4F5F2] text-[#2E8C86]',
  accent: 'bg-accent-50 text-accent-600',
}

const KPI_ICON = {
  calls: 'MessagesSquare',
  limited: 'BatteryWarning',
  near: 'TrendingUp',
  avg: 'Users',
  req: 'Activity',
  token: 'Cpu',
  cost: 'Wallet',
  fail: 'ServerCrash',
}

const ANOMALY_TONE = {
  danger: { box: 'bg-danger-50/70 border-danger-100', ic: 'bg-danger-100/70 text-danger-600' },
  warning: { box: 'bg-warning-50/70 border-warning-100', ic: 'bg-warning-100/70 text-warning-600' },
  accent: { box: 'bg-accent-50/70 border-accent-100', ic: 'bg-accent-100/70 text-accent-600' },
  muted: { box: 'bg-ink-50 border-ink-150', ic: 'bg-ink-100 text-ink-500' },
}

export default function UsageOverview() {
  const { workspace, prefs, setPref } = useConsole()
  const navigate = useNavigate()
  const data = useMemo(() => getUsageOverview(workspace.id), [workspace.id])
  const [range, setRange] = useState('week')

  const trend = data.trend[range]
  const ring = prefs.chartStyle === 'ring'
  const distTotal = data.distribution.reduce((n, d) => n + d.value, 0)
  const distMax = Math.max(...data.distribution.map((d) => d.value), 1)

  return (
    <PagePanel
      title={`${workspace.scopeLabel} · 用量概览`}
      desc={`当前工作空间能看到的最高范围；下面的阈值与费用都是演示数据，不代表真实计费。`}
      toolbar={
        <>
          <div className="flex items-center gap-1.5">
            {data.ranges.map((r) => (
              <Chip key={r.key} active={range === r.key} onClick={() => setRange(r.key)}>
                {r.label}
              </Chip>
            ))}
          </div>
          <div className="console-seg" role="group" aria-label="额度数据显示方式">
            {[
              { key: 'bar', icon: 'AlignLeft', label: '条状' },
              { key: 'ring', icon: 'PieChart', label: '环状' },
            ].map((v) => (
              <button
                key={v.key}
                type="button"
                title={`额度类数据改为${v.label}显示（时间趋势始终用折线）`}
                aria-pressed={prefs.chartStyle === v.key}
                onClick={() => setPref('chartStyle', v.key)}
                className={cx('console-seg-btn', prefs.chartStyle === v.key && 'console-seg-btn--on')}
              >
                <Icon name={v.icon} className="w-3.5 h-3.5" strokeWidth={1.9} />
              </button>
            ))}
          </div>
        </>
      }
    >
      {/* 总量 */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3.5">
        {data.kpis.map((k) => (
          <GlassCard key={k.key} className="p-3.5 rounded-xl min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={cx('w-6 h-6 rounded-lg flex items-center justify-center shrink-0', TONE_CHIP[k.tone])}
              >
                <Icon name={KPI_ICON[k.key] || 'Activity'} className="w-[14px] h-[14px]" strokeWidth={2} />
              </span>
              <span className="text-[12.5px] font-medium text-ink-700 truncate">{k.label}</span>
            </div>
            <div className="mt-2.5 flex items-baseline gap-1.5">
              <span className="font-serif text-[30px] leading-none font-bold text-ink-900 tabular-nums">
                {k.value}
              </span>
              {k.unit && <span className="text-[12px] text-ink-500">{k.unit}</span>}
            </div>
            <p className="text-[11.5px] text-ink-400 mt-2">{k.note}</p>
          </GlassCard>
        ))}
      </div>

      {/* 趋势 + 范围分布 */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.45fr_1fr] gap-3.5 mt-3.5">
        <GlassCard className="p-4 rounded-xl min-w-0">
          <SubHead
            icon="ChartLine"
            title={`${data.ranges.find((r) => r.key === range).label}${data.trendUnit}趋势`}
            extra={<span className="text-[11.5px] text-ink-400">{data.trendNote}</span>}
          />
          <MiniChart chart={{ type: 'line', data: trend.data, labels: trend.labels }} tone="brand" height={172} />
        </GlassCard>

        <GlassCard className="p-4 rounded-xl min-w-0">
          <SubHead
            icon="ChartPie"
            title={data.distributionTitle}
            extra={<span className="text-[11.5px] text-ink-400">点一段可下钻</span>}
          />
          {ring ? (
            <div className="pt-1">
              <MiniChart
                chart={{ type: 'donut', segments: data.distribution }}
                onPick={(seg) => navigate(data.distribution.find((d) => d.label === seg.label).to)}
              />
              <p className="text-[11.5px] text-ink-400 mt-3">
                共 <span className="tabular-nums font-medium text-ink-600">{distTotal}</span> {data.distributionUnit}；
                点图例进入已带筛选的额度管理
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 pt-0.5">
              {data.distribution.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => navigate(d.to)}
                  className="w-full text-left group"
                  title={`查看 ${d.label} 的额度明细`}
                >
                  <div className="flex items-baseline justify-between gap-3 mb-1">
                    <span className="text-[12.5px] text-ink-700 group-hover:text-brand-600 transition truncate">
                      {d.label}
                    </span>
                    <span className="text-[12px] font-semibold text-ink-800 tabular-nums shrink-0">
                      {d.value} {data.distributionUnit}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-ink-150/80 overflow-hidden">
                    <div
                      className="console-bar-fill h-full rounded-full"
                      style={{
                        width: `${Math.max(1.5, (d.value / distMax) * 100)}%`,
                        backgroundImage: `linear-gradient(90deg, ${d.color}88 0%, ${d.color} 100%)`,
                      }}
                    />
                  </div>
                </button>
              ))}
              <p className="text-[11.5px] text-ink-400 pt-1">
                共 <span className="tabular-nums font-medium text-ink-600">{distTotal}</span> {data.distributionUnit}；
                条长按本范围内最大值归一
              </p>
            </div>
          )}
        </GlassCard>
      </div>

      {/* 异常 */}
      <div className="mt-4">
        <SubHead
          icon="TriangleAlert"
          title="需要注意的异常"
          extra={
            <span className="text-[11.5px] text-ink-400">
              演示阈值：已用 ≥{DEMO_THRESHOLDS.nearPercent}% 记为即将耗尽，周环比 ≥+
              {DEMO_THRESHOLDS.growthPercent}% 记为异常增长
            </span>
          }
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.anomalies.map((a) => {
            const t = ANOMALY_TONE[a.tone] || ANOMALY_TONE.muted
            return (
              <div key={a.key} className={cx('rounded-xl border px-3.5 py-3 flex items-start gap-3', t.box)}>
                <span className={cx('w-8 h-8 rounded-xl flex items-center justify-center shrink-0', t.ic)}>
                  <Icon name={a.icon} className="w-4 h-4" strokeWidth={1.9} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-ink-800">{a.title}</p>
                  <p className="text-[12px] text-ink-600 leading-relaxed mt-1">{a.desc}</p>
                  {a.to && (
                    <Btn size="sm" tone="ghost" icon="ArrowRight" className="mt-2 -ml-2" onClick={() => navigate(a.to)}>
                      {a.actionLabel}
                    </Btn>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </PagePanel>
  )
}
