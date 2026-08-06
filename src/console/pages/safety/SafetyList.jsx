import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cx, Icon } from '../../../components/ui.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, Chip, EmptyState, Field, IconBtn, SearchBox, Select, StatusTag, SubHead } from '../../components/Controls.jsx'
import { SideSheet } from '../../components/Overlay.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import { getClasses } from '../../data/fixtures/classes.js'
import {
  CHAIN_STATE,
  ESCALATION_CONFIG,
  EVENT_STATUS,
  RISK_LEVELS,
  eventClass,
  eventStudent,
  getEvents,
  remainText,
} from '../../data/fixtures/safety.js'

// 安全事件列表：独立一级入口，风险色明显但不刺眼（danger 只用在级别点与超时上，
// 整页不铺红底）。列表必须能看出：风险级别 / 学生 / 触发时间 / 剩余处理时间 / 当前负责人 / 状态。
//
// 状态五种：待处理 → 处理中 → 待复核 → 已关闭；误报是另一种终止结果，不进正常处理链。
// 「涉事人员被跳过」不是状态，而是升级链里的回避标记（右侧抽屉里能看到）。

const SCHOOL_ADMIN = ['school-admin', 'platform-ops']

export default function SafetyList() {
  const { workspace } = useConsole()
  const navigate = useNavigate()
  const all = useMemo(() => getEvents(workspace.id), [workspace.id])
  const classes = useMemo(() => getClasses(workspace.id), [workspace.id])

  const [risk, setRisk] = useState('all')
  const [status, setStatus] = useState('all')
  const [classId, setClassId] = useState('all')
  const [owner, setOwner] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [chainOpen, setChainOpen] = useState(false)

  const owners = useMemo(() => [...new Set(all.map((e) => e.owner))], [all])
  const riskCounts = useMemo(() => {
    const m = { all: all.length }
    for (const k of Object.keys(RISK_LEVELS)) m[k] = all.filter((e) => e.risk === k).length
    return m
  }, [all])

  const rows = useMemo(() => {
    const k = keyword.trim()
    return all.filter((e) => {
      if (risk !== 'all' && e.risk !== risk) return false
      if (status !== 'all' && e.status !== status) return false
      if (classId !== 'all' && e.classId !== classId) return false
      if (owner !== 'all' && e.owner !== owner) return false
      if (!k) return true
      return (
        e.id.includes(k) ||
        (eventStudent(e)?.name || '').includes(k) ||
        e.summary.includes(k) ||
        e.owner.includes(k)
      )
    })
  }, [all, risk, status, classId, owner, keyword])

  const open = all.filter((e) => EVENT_STATUS[e.status].flow && e.status !== 'closed')
  const overdue = open.filter((e) => e.remainMinutes < 0)
  const canEditChain = SCHOOL_ADMIN.includes(workspace.id)

  return (
    <PagePanel
      title={`${workspace.scopeLabel} · 安全事件`}
      desc="安全事件走独立入口，不混进普通消息。只展开触发消息与最小必要上下文；涉事人员一律回避，查看与处理全程留痕。"
      toolbar={
        <>
          <SearchBox value={keyword} onChange={setKeyword} placeholder="搜索事件编号、学生或负责人" width="w-[218px]" />
          <Btn icon="Network" onClick={() => setChainOpen(true)}>
            升级链
          </Btn>
        </>
      }
    >
      {all.length === 0 ? (
        <EmptyState
          icon="ShieldCheck"
          title="当前范围没有安全事件"
          desc="教研组类工作空间没有安全事件权限；如需处理，请切换到班级、年级或校级工作空间。"
        />
      ) : (
        <>
          {/* 需要先看到的两件事：还没终结几件、其中超时几件 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <Metric icon="CircleAlert" tone="danger" label="未终结事件" value={open.length} unit="件" note="待处理 / 处理中 / 待复核" />
            <Metric
              icon="TimerOff"
              tone="warning"
              label="已超时"
              value={overdue.length}
              unit="件"
              note={overdue.length ? '已向上一级发送升级提醒' : '暂无超时事件'}
            />
            <Metric
              icon="UserRoundX"
              tone="muted"
              label="涉事回避"
              value={all.filter((e) => e.excluded.length > 0).length}
              unit="件"
              note="链路中有责任人被自动跳过"
            />
            <Metric
              icon="CircleSlash"
              tone="muted"
              label="误报"
              value={all.filter((e) => e.status === 'false').length}
              unit="件"
              note="不计入学生评价，仅用于改进判定"
            />
          </div>

          {/* 风险级别胶囊 + 筛选行 */}
          <div className="mt-4 flex items-center gap-1.5 flex-wrap">
            <Chip active={risk === 'all'} count={riskCounts.all} onClick={() => setRisk('all')}>
              全部级别
            </Chip>
            {Object.entries(RISK_LEVELS).map(([k, v]) => (
              <Chip key={k} active={risk === k} count={riskCounts[k]} disabled={riskCounts[k] === 0} onClick={() => setRisk(k)}>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: v.dot }} />
                  {v.label}
                </span>
              </Chip>
            ))}
            <div className="flex-1" />
            <Select
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: '全部状态' },
                ...Object.entries(EVENT_STATUS).map(([k, v]) => ({ value: k, label: v.label })),
              ]}
              width="w-[124px]"
            />
            <Select
              value={classId}
              onChange={setClassId}
              options={[{ value: 'all', label: '全部班级' }, ...classes.map((c) => ({ value: c.id, label: c.name }))]}
              width="w-[142px]"
            />
            <Select
              value={owner}
              onChange={setOwner}
              options={[{ value: 'all', label: '全部负责人' }, ...owners.map((o) => ({ value: o, label: o }))]}
              width="w-[142px]"
            />
          </div>

          {rows.length === 0 ? (
            <EmptyState icon="SearchX" title="没有符合条件的事件" desc="换一个风险级别或状态看看。" />
          ) : (
            <div className="mt-3.5 space-y-2.5">
              {rows.map((e) => {
                const lv = RISK_LEVELS[e.risk]
                const st = EVENT_STATUS[e.status]
                const stu = eventStudent(e)
                const klass = eventClass(e)
                const rm = remainText(e)
                return (
                  <div
                    key={e.id}
                    onClick={() => navigate(`/console/safety/${e.id}`)}
                    className="console-enter group relative rounded-xl border border-ink-150 bg-white/70 hover:bg-white/90 hover:border-ink-200 transition cursor-pointer overflow-hidden"
                  >
                    {/* 风险级别只用左侧一条竖色带表达，不给整卡上红底 */}
                    <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: lv.dot }} />
                    <div className="pl-4 pr-3.5 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* 风险级别用色点 + 文字（不上底色），一行只留一个色块给状态；
                            否则「高风险 + 待处理」两块红挤在一起，就不是「明显但不刺眼」了 */}
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold whitespace-nowrap" style={{ color: lv.dot }}>
                          <span className="w-[7px] h-[7px] rounded-full" style={{ background: lv.dot }} />
                          {lv.label}
                        </span>
                        <StatusTag tone={st.tone} dot>
                          {st.label}
                        </StatusTag>
                        <span className="text-[13px] font-semibold text-ink-900">
                          {stu?.name}
                          <span className="text-ink-400 font-normal"> · {klass?.name}</span>
                        </span>
                        <span className="text-[11px] text-ink-400 tabular-nums">{e.id}</span>
                        <div className="flex-1" />
                        <span className={cx('text-[12px] font-semibold tabular-nums', REMAIN_TONE[rm.tone])}>{rm.text}</span>
                        <IconBtn icon="ChevronRight" title="查看事件详情" className="group-hover:text-brand-600" />
                      </div>

                      <p className="text-[12.5px] text-ink-600 leading-relaxed mt-1.5 line-clamp-2">{e.summary}</p>

                      <div className="mt-2 flex items-center gap-3 flex-wrap text-[11.5px] text-ink-500">
                        <span className="inline-flex items-center gap-1">
                          <Icon name="Clock" className="w-3.5 h-3.5 text-ink-400" strokeWidth={1.8} />
                          触发 {e.triggerAt}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Icon name="UserRoundCheck" className="w-3.5 h-3.5 text-ink-400" strokeWidth={1.8} />
                          当前负责人 {e.owner}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Icon name="Timer" className="w-3.5 h-3.5 text-ink-400" strokeWidth={1.8} />
                          处理时限 {e.slaHours} 小时
                        </span>
                        {e.excluded.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-ink-500 bg-ink-100 border border-ink-200 rounded-full px-2 py-px">
                            <Icon name="UserRoundX" className="w-3.5 h-3.5" strokeWidth={1.8} />
                            {e.excluded[0].name} 涉事回避，已跳过
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* 升级链抽屉：链路顺序 + 时限 + 规则；只有学校管理员与运营能改 */}
      <SideSheet
        open={chainOpen}
        onClose={() => setChainOpen(false)}
        title="安全事件升级链"
        desc={`由 ${ESCALATION_CONFIG.owner} 配置 · 更新于 ${ESCALATION_CONFIG.updatedAt}`}
        width="w-[440px]"
        footer={
          <>
            <Btn onClick={() => setChainOpen(false)}>关闭</Btn>
            {canEditChain ? (
              <Btn tone="primary" icon="PenLine" onClick={() => setChainOpen(false)}>
                编辑升级链
              </Btn>
            ) : (
              <span className="text-[11.5px] text-ink-400">只有学校管理员与平台运营能修改</span>
            )}
          </>
        }
      >
        <ol className="relative pl-5">
          <span className="absolute left-[6px] top-2 bottom-2 w-px console-chain-line" aria-hidden="true" />
          {ESCALATION_CONFIG.levels.map((l, i) => (
            <li key={l.name} className="relative pb-4 last:pb-0">
              <span className="absolute -left-5 top-1 w-[13px] h-[13px] rounded-full bg-white border-2 border-brand-300 flex items-center justify-center">
                <span className="w-[5px] h-[5px] rounded-full bg-brand-500" />
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-ink-900">{l.name}</span>
                <span className="text-[11px] text-ink-400 tabular-nums">第 {i + 1} 级</span>
                {i === ESCALATION_CONFIG.levels.length - 1 && <StatusTag tone="muted">最终责任人</StatusTag>}
              </div>
              <p className="text-[12px] text-ink-600 leading-relaxed mt-0.5">{l.desc}</p>
              <p className="text-[11.5px] text-ink-400 mt-0.5">{l.sla}</p>
            </li>
          ))}
        </ol>

        <SubHead icon="Scale" title="生效规则" className="mt-4" />
        <ul className="space-y-1.5">
          {ESCALATION_CONFIG.rules.map((r) => (
            <li key={r} className="flex items-start gap-1.5 text-[12px] text-ink-700 leading-relaxed">
              <Icon name="Check" className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#3E9E8F]" strokeWidth={2.4} />
              {r}
            </li>
          ))}
        </ul>

        <div className="mt-3.5 px-3 py-2.5 rounded-xl bg-ink-50 border border-ink-150">
          <Field label="待后续设计" labelWidth="w-[68px]">
            <span className="text-ink-500">{ESCALATION_CONFIG.pending}</span>
          </Field>
        </div>
      </SideSheet>
    </PagePanel>
  )
}

const REMAIN_TONE = {
  danger: 'text-danger-600',
  warning: 'text-warning-600',
  brand: 'text-brand-600',
  muted: 'text-ink-400',
}

const METRIC_TONE = {
  danger: 'bg-danger-50 text-danger-600',
  warning: 'bg-warning-50 text-warning-600',
  muted: 'bg-ink-100 text-ink-500',
}

function Metric({ icon, tone, label, value, unit, note }) {
  return (
    <GlassCard className="p-3.5 rounded-xl min-w-0">
      <div className="flex items-center gap-2">
        <span className={cx('w-6 h-6 rounded-lg flex items-center justify-center shrink-0', METRIC_TONE[tone])}>
          <Icon name={icon} className="w-[14px] h-[14px]" strokeWidth={2} />
        </span>
        <span className="text-[12.5px] font-medium text-ink-700 truncate">{label}</span>
      </div>
      <div className="mt-2.5 flex items-baseline gap-1.5">
        <span className="font-serif text-[30px] leading-none font-bold text-ink-900 tabular-nums">{value}</span>
        <span className="text-[12px] text-ink-500">{unit}</span>
      </div>
      <p className="text-[11.5px] text-ink-400 mt-2 leading-relaxed">{note}</p>
    </GlassCard>
  )
}
