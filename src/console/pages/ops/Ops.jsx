import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cx, Icon } from '../../../components/ui.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, Chip, Field, IconBtn, StatusTag, SubHead } from '../../components/Controls.jsx'
import { ConfirmModal, SideSheet } from '../../components/Overlay.jsx'
import { BarProgress } from '../../components/Progress.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import {
  AUDITS,
  AUDIT_LEVEL,
  FAILED_TASKS,
  FEEDBACK,
  FEEDBACK_STATE,
  INCIDENTS,
  INCIDENT_STATE,
  MODEL_SUMMARY,
  OPS_KPIS,
  OPS_SECTIONS,
  PROVIDER_STATE,
  SCHOOLS,
  SCHOOL_STATE,
  TASK_STATE,
} from '../../data/fixtures/ops.js'

// 运营维护（仅平台运营）：单页五区 + 顶部锚点，信息密度比教学页高，
// 但颜色、圆角、状态标签、反馈样式全部沿用同一套 token。
//
// 「模型与成本」不在这里重复实现，只放一张摘要卡跳 #/console/usage/models。

export default function Ops() {
  const { workspace } = useConsole()
  const navigate = useNavigate()
  const refs = useRef({})
  const [active, setActive] = useState('schools')
  const [ask, setAsk] = useState(null)
  const [retried, setRetried] = useState([])
  const [auditOpen, setAuditOpen] = useState(null)

  const jump = (key) => {
    setActive(key)
    refs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <PagePanel
      title={`${workspace.scopeLabel} · 运营维护`}
      desc="内部技术页面：多学校运行、失败任务与重试、审计与原文访问、系统异常、反馈与跨校内容异常五个区。极高风险操作必须填写用途。"
      toolbar={
        <Btn icon="Cpu" onClick={() => navigate('/console/usage/models')}>
          模型与成本明细
        </Btn>
      }
    >
      {/* 顶部锚点：五区快跳 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {OPS_SECTIONS.map((s, i) => (
          <Chip key={s.key} active={active === s.key} onClick={() => jump(s.key)}>
            <span className="inline-flex items-center gap-1.5">
              <span className="text-ink-400 tabular-nums">{i + 1}</span>
              {s.label}
            </span>
          </Chip>
        ))}
      </div>

      {/* KPI 一行 */}
      <div className="mt-3.5 grid grid-cols-2 xl:grid-cols-4 gap-3">
        {OPS_KPIS.map((k) => (
          <GlassCard key={k.key} className="p-3 rounded-xl min-w-0">
            <p className="text-[12px] font-medium text-ink-600 truncate">{k.label}</p>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="font-serif text-[26px] leading-none font-bold text-ink-900 tabular-nums">{k.value}</span>
              <span className="text-[11.5px] text-ink-500">{k.unit}</span>
            </div>
            <p className="text-[11px] text-ink-400 mt-1.5">{k.note}</p>
          </GlassCard>
        ))}
      </div>

      {/* 模型与成本：只放摘要，明细跳技术页 */}
      <GlassCard className="console-enter mt-3 p-3.5 rounded-xl">
        <SubHead
          icon="Cpu"
          title="模型与成本（摘要）"
          extra={
            <Btn size="sm" tone="ghost" iconRight="ArrowUpRight" onClick={() => navigate('/console/usage/models')}>
              打开明细
            </Btn>
          }
        />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
          <div>
            <p className="text-[11.5px] text-ink-400 mb-1.5">供应商状态</p>
            <div className="space-y-1.5">
              {MODEL_SUMMARY.providers.map((p) => (
                <div key={p.name} className="flex items-center gap-2">
                  <StatusTag tone={PROVIDER_STATE[p.state].tone} dot>
                    {PROVIDER_STATE[p.state].label}
                  </StatusTag>
                  <span className="text-[12.5px] font-medium text-ink-800">{p.name}</span>
                  <span className="text-[11.5px] text-ink-500 truncate">{p.note}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11.5px] text-ink-400 mb-1.5">近期费用</p>
            <div className="flex items-baseline gap-1.5">
              <span className="font-serif text-[24px] leading-none font-bold text-ink-900 tabular-nums">
                {MODEL_SUMMARY.cost.value}
              </span>
              <span className="text-[11.5px] text-ink-500">{MODEL_SUMMARY.cost.unit}</span>
            </div>
            <div className="mt-2">
              <BarProgress value={MODEL_SUMMARY.cost.percent} hint={MODEL_SUMMARY.cost.note} />
            </div>
          </div>
          <div>
            <p className="text-[11.5px] text-ink-400 mb-1.5">调用失败率</p>
            <div className="flex items-baseline gap-1.5">
              <span className="font-serif text-[24px] leading-none font-bold text-ink-900 tabular-nums">
                {MODEL_SUMMARY.fail.value}
              </span>
              <span className="text-[11.5px] text-ink-500">{MODEL_SUMMARY.fail.unit}</span>
            </div>
            <p className="text-[11.5px] text-ink-500 leading-relaxed mt-1.5">{MODEL_SUMMARY.fail.note}</p>
          </div>
        </div>
      </GlassCard>

      {/* 1 多学校运行 */}
      <Section idx={1} section={OPS_SECTIONS[0]} refs={refs}>
        <p className="text-[11.5px] text-ink-500 mb-2">
          演示数据只列出主要 5 所（共 12 所接入），其余 7 所运行正常且无待处理事项。
        </p>
        <div className="rounded-xl border border-ink-150 overflow-hidden bg-white/60">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-ink-50/70 text-[11.5px] text-ink-500">
                <th className="px-3 py-2 font-medium">学校</th>
                <th className="px-2 py-2 font-medium w-[86px]">学生</th>
                <th className="px-2 py-2 font-medium w-[76px]">班级</th>
                <th className="px-2 py-2 font-medium w-[112px]">本月阅读</th>
                <th className="px-2 py-2 font-medium w-[100px]">运行状态</th>
                <th className="px-2 py-2 font-medium w-[130px]">对接人</th>
                <th className="px-2 py-2 font-medium">备注</th>
              </tr>
            </thead>
            <tbody>
              {SCHOOLS.map((s) => (
                <tr key={s.id} className="border-t border-ink-150/70 hover:bg-white/80 transition">
                  <td className="px-3 py-2 text-[12.5px] font-medium text-ink-900">{s.name}</td>
                  <td className="px-2 py-2 text-[12px] text-ink-700 tabular-nums">{s.students}</td>
                  <td className="px-2 py-2 text-[12px] text-ink-700 tabular-nums">{s.classes}</td>
                  <td className="px-2 py-2 text-[12px] text-ink-700 tabular-nums">
                    {s.monthMinutes ? `${(s.monthMinutes / 10000).toFixed(2)} 万分钟` : '—'}
                  </td>
                  <td className="px-2 py-2">
                    <StatusTag tone={SCHOOL_STATE[s.state].tone} dot>
                      {SCHOOL_STATE[s.state].label}
                    </StatusTag>
                  </td>
                  <td className="px-2 py-2 text-[12px] text-ink-600">{s.contact}</td>
                  <td className="px-2 py-2 text-[11.5px] text-ink-500 leading-relaxed">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 2 失败任务与重试 */}
      <Section idx={2} section={OPS_SECTIONS[1]} refs={refs}>
        <div className="space-y-2.5">
          {FAILED_TASKS.map((t) => {
            const done = retried.includes(t.id)
            const ts = TASK_STATE[t.state]
            return (
              <div key={t.id} className="rounded-xl border border-ink-150 bg-white/70 px-3.5 py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusTag tone={done ? 'success' : ts.tone} dot>
                    {done ? '已重试成功' : ts.label}
                  </StatusTag>
                  <span className="text-[13px] font-semibold text-ink-900">{t.type}</span>
                  <span className="text-[11.5px] text-ink-500 truncate">{t.target}</span>
                  <div className="flex-1" />
                  <span className="text-[11.5px] text-ink-400 tabular-nums">
                    {t.at} · 已重试 {t.retries} 次
                  </span>
                  {t.canRetry && !done && (
                    <Btn size="sm" tone="primary" icon="RefreshCcw" onClick={() => setAsk(t)}>
                      重试
                    </Btn>
                  )}
                </div>
                <p className="text-[12.5px] text-ink-700 leading-relaxed mt-1.5">失败原因：{t.reason}</p>
                <p className="text-[11.5px] text-ink-500 leading-relaxed mt-1">处理建议：{t.fix}</p>
              </div>
            )
          })}
        </div>
      </Section>

      {/* 3 审计与原文访问 */}
      <Section idx={3} section={OPS_SECTIONS[2]} refs={refs}>
        <p className="text-[11.5px] text-ink-500 leading-relaxed mb-2">
          常规操作自动记录修改前后状态；原文访问与彻底清除属极高风险操作，必须填写用途，记录不可删除。
        </p>
        <div className="rounded-xl border border-ink-150 overflow-hidden bg-white/60">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-ink-50/70 text-[11.5px] text-ink-500">
                <th className="px-3 py-2 font-medium w-[104px]">时间</th>
                <th className="px-2 py-2 font-medium w-[168px]">操作人</th>
                <th className="px-2 py-2 font-medium w-[176px]">动作</th>
                <th className="px-2 py-2 font-medium">对象与用途</th>
                <th className="px-2 py-2 font-medium w-[92px]">级别</th>
                <th className="px-2 py-2 font-medium w-[52px] text-right">详情</th>
              </tr>
            </thead>
            <tbody>
              {AUDITS.map((a, i) => (
                <tr key={i} className="border-t border-ink-150/70 hover:bg-white/80 transition">
                  <td className="px-3 py-2 text-[11.5px] text-ink-500 tabular-nums">{a.at}</td>
                  <td className="px-2 py-2">
                    <p className="text-[12.5px] text-ink-800">{a.actor}</p>
                    <p className="text-[11px] text-ink-400">{a.role}</p>
                  </td>
                  <td className="px-2 py-2 text-[12px] text-ink-700">{a.action}</td>
                  <td className="px-2 py-2">
                    <p className="text-[12px] text-ink-700 truncate">{a.target}</p>
                    <p className="text-[11px] text-ink-500 truncate">
                      {a.purpose !== '——' ? `用途：${a.purpose}` : a.diff ? `变更：${a.diff}` : '——'}
                    </p>
                  </td>
                  <td className="px-2 py-2">
                    <StatusTag tone={AUDIT_LEVEL[a.level].tone} dot={a.level === 'high'}>
                      {AUDIT_LEVEL[a.level].label}
                    </StatusTag>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <IconBtn icon="Info" title="查看审计详情" onClick={() => setAuditOpen(a)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 4 系统异常 */}
      <Section idx={4} section={OPS_SECTIONS[3]} refs={refs}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {INCIDENTS.map((n) => (
            <GlassCard key={n.id} className="p-3.5 rounded-xl flex flex-col">
              <div className="flex items-center gap-2">
                <span
                  className={cx(
                    'inline-flex items-center h-[20px] px-1.5 rounded-md border text-[10.5px] font-bold tabular-nums',
                    n.tone === 'danger'
                      ? 'bg-danger-50 text-danger-700 border-danger-100'
                      : n.tone === 'warning'
                        ? 'bg-warning-50 text-warning-700 border-warning-100'
                        : 'bg-ink-100 text-ink-600 border-ink-200',
                  )}
                >
                  {n.level}
                </span>
                <StatusTag tone={INCIDENT_STATE[n.state].tone} dot>
                  {INCIDENT_STATE[n.state].label}
                </StatusTag>
                <span className="ml-auto text-[11px] text-ink-400">{n.at}</span>
              </div>
              <p className="text-[13px] font-semibold text-ink-900 leading-snug mt-2">{n.title}</p>
              <p className="text-[11.5px] text-ink-600 leading-relaxed mt-1.5 flex-1">影响：{n.impact}</p>
              <p className="text-[11.5px] text-ink-500 leading-relaxed mt-1.5 pt-1.5 border-t border-ink-150/70">
                处置：{n.action}
              </p>
            </GlassCard>
          ))}
        </div>
      </Section>

      {/* 5 反馈与跨校内容异常 */}
      <Section idx={5} section={OPS_SECTIONS[4]} refs={refs}>
        <div className="space-y-2.5">
          {FEEDBACK.map((f) => (
            <div key={f.id} className="rounded-xl border border-ink-150 bg-white/70 px-3.5 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusTag tone={f.kind === '跨校内容异常' ? 'warning' : 'brand'}>{f.kind}</StatusTag>
                <span className="text-[12.5px] font-medium text-ink-800">{f.from}</span>
                <span className="text-[11.5px] text-ink-400">{f.at}</span>
                <div className="flex-1" />
                <StatusTag tone={FEEDBACK_STATE[f.state].tone} dot>
                  {FEEDBACK_STATE[f.state].label}
                </StatusTag>
              </div>
              <p className="text-[12.5px] text-ink-700 leading-relaxed mt-1.5">{f.text}</p>
              <p className="text-[11.5px] text-ink-500 leading-relaxed mt-1">处理：{f.note}</p>
            </div>
          ))}
        </div>
      </Section>

      <ConfirmModal
        open={!!ask}
        onClose={() => setAsk(null)}
        onConfirm={() => {
          setRetried((v) => [...v, ask.id])
          setAsk(null)
        }}
        title="重试这个任务？"
        confirmText="重试"
        tone="primary"
        desc={
          ask
            ? `${ask.type} · ${ask.target}。失败原因：${ask.reason}。${ask.fix}。重试会重新取数，不会复用上次的失败结果。`
            : ''
        }
      />

      <SideSheet
        open={!!auditOpen}
        onClose={() => setAuditOpen(null)}
        title="审计记录"
        desc={auditOpen ? `${auditOpen.at} · ${auditOpen.actor}` : ''}
        width="w-[400px]"
        footer={<Btn onClick={() => setAuditOpen(null)}>关闭</Btn>}
      >
        {auditOpen && (
          <>
            <Field label="操作人">
              {auditOpen.actor}（{auditOpen.role}）
            </Field>
            <Field label="动作">{auditOpen.action}</Field>
            <Field label="对象">{auditOpen.target}</Field>
            <Field label="风险级别">
              <StatusTag tone={AUDIT_LEVEL[auditOpen.level].tone} dot={auditOpen.level === 'high'}>
                {AUDIT_LEVEL[auditOpen.level].label}
              </StatusTag>
            </Field>
            {auditOpen.purpose !== '——' && <Field label="填写用途">{auditOpen.purpose}</Field>}
            {auditOpen.diff && <Field label="变更前后">{auditOpen.diff}</Field>}
            <p className="text-[11.5px] text-ink-500 leading-relaxed mt-2.5 bg-ink-50 border border-ink-150 rounded-lg px-3 py-2.5">
              审计记录不可编辑、不可删除。涉及学生原文的访问会同时在学生的隐私访问历史里出现，学生本人可以看到「谁在什么时候看过」。
            </p>
          </>
        )}
      </SideSheet>
    </PagePanel>
  )
}

function Section({ idx, section, refs, children }) {
  return (
    <div ref={(el) => (refs.current[section.key] = el)} className="console-enter mt-5 scroll-mt-4">
      <SubHead icon={section.icon} title={`${idx} · ${section.label}`} />
      {children}
    </div>
  )
}
