import { useMemo, useState } from 'react'
import { cx, Icon } from '../../../components/ui.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, StatusTag, SubHead } from '../../components/Controls.jsx'
import { ConfirmModal } from '../../components/Overlay.jsx'
import { BarProgress } from '../../components/Progress.jsx'
import MiniChart from '../../components/MiniChart.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import { MODEL_BUDGET, MODEL_ROWS, MODEL_TASKS, getUsageOverview } from '../../data/fixtures/usage.js'

// 模型与成本：仅运营工作空间可见。按信息架构的说法，这一页可以比教学页更密集，
// 但颜色、圆角、状态标签与反馈方式仍沿用同一套规范。不连接真实密钥或模型。

const MODEL_STATUS = {
  on: { label: '启用中', tone: 'success' },
  standby: { label: '待命', tone: 'muted' },
  off: { label: '已停用', tone: 'danger' },
}

const TASK_STATE = {
  done: { label: '已完成', tone: 'success' },
  running: { label: '运行中', tone: 'brand' },
  retrying: { label: '重试中', tone: 'warning' },
  failed: { label: '失败', tone: 'danger' },
}

export default function Models() {
  const { workspace } = useConsole()
  const data = useMemo(() => getUsageOverview(workspace.id), [workspace.id])
  const [ask, setAsk] = useState(null)
  const budgetPct = Math.round((MODEL_BUDGET.used / MODEL_BUDGET.total) * 100)
  const trend = data.trend.week

  return (
    <PagePanel
      title="全平台 · 模型与成本"
      desc="供应商、Token、费用、延迟与失败率的运行概况。演示壳不连接真实密钥，也不发起任何模型请求。"
      toolbar={
        <>
          <Btn icon="RefreshCw" onClick={() => setAsk({ kind: 'refresh' })}>
            刷新用量
          </Btn>
          <Btn tone="primary" icon="Wallet" onClick={() => setAsk({ kind: 'budget' })}>
            调整预算
          </Btn>
        </>
      }
    >
      {/* 预算与请求概况 */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.35fr] gap-3.5">
        <GlassCard className="p-4 rounded-xl">
          <SubHead icon="Wallet" title="本月预算" extra={<span className="text-[11.5px] text-ink-400">{MODEL_BUDGET.resetAt} 重置</span>} />
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-[32px] leading-none font-bold text-ink-900 tabular-nums">
              ￥{MODEL_BUDGET.used.toLocaleString()}
            </span>
            <span className="text-[12.5px] text-ink-500">/ ￥{MODEL_BUDGET.total.toLocaleString()}</span>
          </div>
          <div className="mt-3">
            <BarProgress
              value={budgetPct}
              tone={budgetPct >= 85 ? 'warning' : 'brand'}
              hint={`按当前速度预计月底用到 ￥${Math.round(MODEL_BUDGET.used * 1.42).toLocaleString()}`}
            />
          </div>
          <div className="mt-3 pt-3 border-t border-ink-150/70 grid grid-cols-3 gap-2">
            {[
              ['输入 Token', '2.43 亿'],
              ['输出 Token', '0.98 亿'],
              ['缓存命中', '38%'],
            ].map(([k, v]) => (
              <div key={k}>
                <p className="text-[11px] text-ink-400">{k}</p>
                <p className="text-[13px] font-semibold text-ink-800 tabular-nums mt-0.5">{v}</p>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-4 rounded-xl min-w-0">
          <SubHead
            icon="Activity"
            title="近 7 天请求量"
            extra={<span className="text-[11.5px] text-ink-400">P95 延迟 2.4 秒 · 失败率 0.42%</span>}
          />
          <MiniChart chart={{ type: 'area', data: trend.data, labels: trend.labels }} tone="violet" height={148} />
        </GlassCard>
      </div>

      {/* 供应商与模型 */}
      <div className="mt-4">
        <SubHead
          icon="Cpu"
          title={`供应商与模型（${MODEL_ROWS.length}）`}
          extra={<span className="text-[11.5px] text-ink-400">路由份额之和为 100%，兜底模型只在主力失败时接管</span>}
        />
        <div className="rounded-xl border border-ink-150 overflow-hidden bg-white/60">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-ink-50/70 text-[11.5px] text-ink-500">
                <th className="px-3 py-2.5 font-medium">模型</th>
                <th className="px-2 py-2.5 font-medium w-[110px]">用途</th>
                <th className="px-2 py-2.5 font-medium w-[136px]">路由份额</th>
                <th className="px-2 py-2.5 font-medium w-[112px]">输入 / 输出</th>
                <th className="px-2 py-2.5 font-medium w-[76px]">缓存</th>
                <th className="px-2 py-2.5 font-medium w-[84px]">P95</th>
                <th className="px-2 py-2.5 font-medium w-[84px]">失败率</th>
                <th className="px-2 py-2.5 font-medium w-[92px]">本周费用</th>
                <th className="px-2 py-2.5 font-medium w-[88px]">状态</th>
              </tr>
            </thead>
            <tbody>
              {MODEL_ROWS.map((m) => {
                const st = MODEL_STATUS[m.status]
                const highFail = parseFloat(m.fail) >= 1
                return (
                  <tr key={m.id} className="border-t border-ink-150/70 hover:bg-white/70 transition">
                    <td className="px-3 py-2.5">
                      <p className="text-[13px] font-medium text-ink-900">{m.model}</p>
                      <p className="text-[11.5px] text-ink-400">{m.vendor}</p>
                    </td>
                    <td className="px-2 py-2.5 text-[12.5px] text-ink-700">{m.role}</td>
                    <td className="px-2 py-2.5">
                      <BarProgress value={m.share} size="sm" showValue={false} />
                      <span className="text-[11px] text-ink-500 tabular-nums">{m.share}%</span>
                    </td>
                    <td className="px-2 py-2.5 text-[12px] text-ink-600 tabular-nums">
                      {m.tokenIn}
                      <span className="text-ink-300 mx-1">/</span>
                      {m.tokenOut}
                    </td>
                    <td className="px-2 py-2.5 text-[12px] text-ink-600 tabular-nums">{m.cache}</td>
                    <td className="px-2 py-2.5 text-[12px] text-ink-600 tabular-nums">{m.p95}</td>
                    <td
                      className={cx(
                        'px-2 py-2.5 text-[12px] tabular-nums',
                        highFail ? 'text-danger-600 font-semibold' : 'text-ink-600',
                      )}
                    >
                      {m.fail}
                    </td>
                    <td className="px-2 py-2.5 text-[12.5px] text-ink-800 tabular-nums">{m.cost}</td>
                    <td className="px-2 py-2.5">
                      <StatusTag tone={st.tone} dot>
                        {st.label}
                      </StatusTag>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 失败任务与重试 */}
      <div className="mt-4">
        <SubHead icon="ServerCrash" title="批量任务与重试" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {MODEL_TASKS.map((t) => {
            const st = TASK_STATE[t.state]
            return (
              <GlassCard key={t.id} className="p-3.5 rounded-xl min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-ink-900 truncate flex-1">{t.name}</span>
                  <StatusTag tone={st.tone} dot className="shrink-0">
                    {st.label}
                  </StatusTag>
                </div>
                <p className="text-[11.5px] text-ink-400 mt-1">{t.at}</p>
                <div className="mt-2.5 flex items-baseline gap-3">
                  <span className="text-[12.5px] text-ink-700 tabular-nums">
                    共 <b className="font-semibold">{t.total}</b> 项
                  </span>
                  <span
                    className={cx(
                      'text-[12.5px] tabular-nums',
                      t.failed > 0 ? 'text-danger-600 font-semibold' : 'text-ink-500',
                    )}
                  >
                    失败 {t.failed}
                  </span>
                </div>
                {t.failed > 0 && (
                  <Btn size="sm" icon="RotateCcw" className="mt-2.5" onClick={() => setAsk({ kind: 'retry', task: t })}>
                    重试失败项
                  </Btn>
                )}
              </GlassCard>
            )
          })}
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-ink-50 border border-ink-150">
        <Icon name="Info" className="w-4 h-4 text-ink-500 mt-px shrink-0" strokeWidth={1.9} />
        <p className="text-[12px] text-ink-600 leading-relaxed">
          本页只对平台运营工作空间可见。运营维护页里的「模型与成本」只放摘要卡并跳到这里，不重复实现同一份内容。
          真实密钥、路由策略与预算告警在后端专项里定义。
        </p>
      </div>

      <ConfirmModal
        open={!!ask}
        onClose={() => setAsk(null)}
        onConfirm={() => setAsk(null)}
        tone="primary"
        confirmText={ask?.kind === 'retry' ? '重试' : ask?.kind === 'budget' ? '保存预算' : '刷新'}
        title={
          ask?.kind === 'retry'
            ? `重试「${ask.task.name}」的 ${ask.task.failed} 个失败项`
            : ask?.kind === 'budget'
              ? '调整本月预算'
              : '刷新用量数据'
        }
        desc={
          ask?.kind === 'retry'
            ? '重试只针对失败项，已成功的不会重复计费；连续三次失败会转人工处理。演示环境不写入。'
            : ask?.kind === 'budget'
              ? '预算用尽后按配置降级到更便宜的模型或暂停非关键任务，不会直接中断学生正在进行的对话。演示环境不写入。'
              : '演示壳的数据是静态的，这里只演示刷新反馈。'
        }
      />
    </PagePanel>
  )
}
