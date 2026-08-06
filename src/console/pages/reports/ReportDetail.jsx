import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { RuntimeIcon as Icon } from '../../../shared/RuntimeIcon.jsx'
import { cx } from '../../../shared/cx.js'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, Chip, EmptyState, Field, StatusTag, SubHead } from '../../components/Controls.jsx'
import { ConfirmModal, Modal } from '../../components/Overlay.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import {
  CHANNELS,
  FLOW_RULES,
  RECIPIENT_SCOPES,
  REPORT_STATUS,
  REPORT_TYPES,
  SOURCE_META,
} from '../../state/useReportsData.js'
import useReportsData from '../../state/useReportsData.js'

// 报告详情：左侧报告预览（A4 纸感），右侧流程信息与发送设置。
//
// 三条硬要求：
// 1. 系统固定评价 / 教师手写 / AI 草稿必须能分辨，AI 段带免责声明
// 2. 双流程切换器只是「流程演示」，必须写明教师不能逐份改学校规则，真正的规则在模板与规则页
// 3. 当前规则、下一处理人、流程状态与发送状态都要显示

const SRC_STYLE = {
  fixed: { bar: 'bg-ink-300', tag: 'bg-ink-100 text-ink-600 border-ink-200' },
  teacher: { bar: 'bg-brand-400', tag: 'bg-brand-50 text-brand-700 border-brand-100' },
  ai: { bar: 'bg-accent-400', tag: 'bg-accent-50 text-accent-700 border-accent-100' },
}

export default function ReportDetail() {
  const { reportId } = useParams()
  const { workspace, canAccessPath } = useConsole()
  const navigate = useNavigate()
  const resource = useReportsData(workspace?.id)
  const report = resource.data?.reports.find((item) => item.id === reportId)

  const isAdmin = ['school', 'platform'].includes(workspace?.scopeType)
  const canParents = canAccessPath('/console/reports/parents')
  const [ask, setAsk] = useState(null)
  const [done, setDone] = useState(null)
  const [actionError, setActionError] = useState(null)

  const student = useMemo(() => report?.student || null, [report])
  const klass = useMemo(() => (report?.className ? { name: report.className } : null), [report])
  const book = useMemo(() => (report?.bookTitle ? { title: report.bookTitle } : null), [report])

  if (!report) {
    const loading = resource.status === 'loading'
    return (
      <PagePanel title={loading ? '报告详情' : '报告不存在'} desc={loading ? '正在读取真实报告数据。' : '这份报告可能已被删除，或不在当前工作空间的可见范围内。'}>
        <EmptyState
          icon={loading ? 'LoaderCircle' : 'FileSearch'}
          title={loading ? '正在读取报告' : resource.status === 'error' ? '报告暂时无法读取' : '找不到这份报告'}
          desc={loading ? '报告内容会在读取完成后显示。' : resource.status === 'error' ? resource.error.message : '请回到报告中心重新选择；学校汇总报告只有校级管理与平台运营可见。'}
          action={
            <Btn tone="primary" icon="ArrowLeft" onClick={() => navigate('/console/reports')}>
              {resource.status === 'error' ? '回到报告中心' : '回到报告中心'}
            </Btn>
          }
        />
      </PagePanel>
    )
  }

  const rule = report.flowRule || 'review'
  const status = report.status || 'confirm'
  const channel = CHANNELS[report.sendSummary?.channel] ? report.sendSummary.channel : 'link'
  const scope = RECIPIENT_SCOPES[report.sendSummary?.scope] ? report.sendSummary.scope : 'primary'
  const st = REPORT_STATUS[status]
  const ty = REPORT_TYPES[report.type]
  const flow = FLOW_RULES[rule]
  const locked = status === 'generating'
  const canTrack = channel ? CHANNELS[channel].canTrack : false

  // 动作按「学校规则 × 当前身份」给，和拍板表格一一对应
  const actions = []
  if (!locked) {
    if (isAdmin && ['confirm', 'review', 'withdrawn'].includes(status)) {
      actions.push({ key: 'review', label: '确认审核', tone: 'primary', icon: 'CheckCheck' })
    }
    if (canParents) actions.push({ key: 'records', label: '家长发送与记录', tone: 'plain', icon: 'ListChecks' })
  }

  const run = async (key) => {
    setAsk(null)
    setActionError(null)
    try {
      if (key === 'review') {
        await resource.reviewReport(report.id, report.versionId || report.version)
        setDone({ title: '审核已完成', desc: '当前版本已由服务端标记为人工审核，并写入审核审计与待处理事件。家长发送任务仍需在家长发送页单独创建。' })
      }
    } catch (error) {
      setActionError(error.message)
    }
  }

  const nextHandler = handlerOf(rule, status, report)

  return (
    <PagePanel
      title={`${report.title}`}
      desc={`${ty.label} · ${report.no} · ${report.period}`}
      toolbar={
        <>
          <Btn icon="ArrowLeft" onClick={() => navigate('/console/reports')}>
            返回报告中心
          </Btn>
          {student && (
            <Btn icon="UserRound" onClick={() => navigate(`/console/accounts/students/${student.id}`)}>
              学生详情
            </Btn>
          )}
        </>
      }
    >
      {actionError && (
        <NoteBar tone="danger" icon="CircleX" title="操作未完成">
          {actionError}
        </NoteBar>
      )}
      {/* 异常状态先说清楚，再看正文 */}
      {status === 'generating' && (
        <NoteBar tone="muted" icon="LoaderCircle" title="生成中">
          {report.generatingNote}
        </NoteBar>
      )}
      {status === 'failed' && (
        <NoteBar tone="danger" icon="CircleX" title="发送失败">
          {report.failNote}
        </NoteBar>
      )}
      {status === 'withdrawn' && (
        <NoteBar tone="warning" icon="Undo2" title="已撤回">
          {report.withdrawNote || '这份报告已被退回或撤回，修改后需要重新走一次流程。'}
        </NoteBar>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-4 items-start">
        {/* ── 左：A4 纸感预览 ───────────────────────────── */}
        <div className="console-enter min-w-0">
          <div className="flex items-center gap-2 mb-2.5">
            <Icon name="FileText" className="w-4 h-4 text-[#3E9E8F]" strokeWidth={1.9} />
            <h3 className="text-[13.5px] font-semibold text-ink-800">报告预览</h3>
            <StatusTag tone={st.tone} dot className="ml-1">
              {st.label}
            </StatusTag>
            <div className="flex-1" />
            <span className="text-[11.5px] text-ink-400">{report.version === '——' ? '暂无版本' : `当前 ${report.version}`}</span>
          </div>

          <div className="console-paper rounded-xl px-8 py-9 sm:px-10">
            {/* 纸头 */}
            <div className="text-center pb-4 border-b border-ink-150">
              <p className="text-[11.5px] tracking-[0.28em] text-ink-400">培新小学 · 读伴整书阅读</p>
              <h2 className="font-serif text-[23px] font-bold text-ink-900 mt-2 leading-snug">{report.title}</h2>
              <p className="text-[12px] text-ink-500 mt-2">
                {report.period}
                {klass && ` · ${klass.name}`}
                {book && ` · 关联书目《${book.title}》`}
              </p>
            </div>

            {locked ? (
              <div className="py-14 text-center">
                <Icon name="LoaderCircle" className="w-7 h-7 text-ink-300 mx-auto" strokeWidth={1.6} />
                <p className="text-[13px] text-ink-500 mt-3">报告正在生成，完成后这里会显示正文。</p>
              </div>
            ) : (
              <>
                {report.metrics.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 py-5 border-b border-ink-150">
                    {report.metrics.map((m) => (
                      <div key={m.label}>
                        <p className="text-[11.5px] text-ink-400">{m.label}</p>
                        <p className="mt-1 flex items-baseline gap-1">
                          <span className="font-serif text-[24px] leading-none font-bold text-ink-900 tabular-nums">
                            {m.value}
                          </span>
                          {m.unit && <span className="text-[11.5px] text-ink-500">{m.unit}</span>}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-5 space-y-5">
                  {report.sections.map((s) => {
                    const meta = SOURCE_META[s.source]
                    const style = SRC_STYLE[s.source]
                    return (
                      <section key={s.title} className="relative pl-3.5">
                        <span className={cx('absolute left-0 top-1 bottom-1 w-[3px] rounded-full', style.bar)} />
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-serif text-[15px] font-bold text-ink-900">{s.title}</h3>
                          <span
                            className={cx(
                              'inline-flex items-center h-[19px] px-1.5 rounded border text-[10.5px] font-medium',
                              style.tag,
                            )}
                          >
                            {meta.label}
                          </span>
                        </div>
                        <div className="mt-2 space-y-2">
                          {s.paragraphs.map((p, i) => (
                            <p key={i} className="text-[13px] leading-[1.95] text-ink-800 indent-[2em]">
                              {p}
                            </p>
                          ))}
                        </div>
                        {s.source === 'ai' && (
                          <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-accent-700 bg-accent-50/70 border border-accent-100 rounded-lg px-2.5 py-1.5">
                            <Icon name="Info" className="w-3.5 h-3.5 mt-px shrink-0" strokeWidth={2} />
                            AI 生成，仅供参考；不作为学生评价依据，发布前由教师确认。
                          </p>
                        )}
                      </section>
                    )
                  })}
                </div>

                <div className="mt-7 pt-3.5 border-t border-ink-150 flex items-center gap-3 text-[11px] text-ink-400">
                  <span>{report.no}</span>
                  <span>·</span>
                  <span>最近更新 {report.updatedAt}</span>
                  <div className="flex-1" />
                  <span>第 1 / 1 页</span>
                </div>
              </>
            )}
          </div>

          <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px] text-ink-400">
            <Icon name="Printer" className="w-3.5 h-3.5" strokeWidth={1.8} />
            导出与打印本轮前端壳未实现（不是产品不支持），后续按学校需求再定版式。
          </p>
        </div>

        {/* ── 右：流程信息 + 发送设置 ────────────────────── */}
        <div className="console-enter space-y-3.5 min-w-0">
          {/* 当前审批流程只读展示服务端返回的规则 */}
          <GlassCard className="p-3.5 rounded-xl">
            <SubHead icon="GitBranch" title="审批流程" extra={<StatusTag tone="accent">当前规则</StatusTag>} />
            <p className="text-[11.5px] text-ink-500 leading-relaxed">
              报告页只读取学校已经设置好的流程，教师不能逐份更换规则。模板与规则的真实读取接口暂未开放，当前不跳转到静态页面。
            </p>
            <div className="mt-2.5 flex items-center gap-1.5">
              {Object.values(FLOW_RULES).map((f) => (
                <Chip key={f.key} active={rule === f.key} disabled>
                  {f.label}
                </Chip>
              ))}
            </div>

            <div className="mt-3 rounded-lg border border-ink-150 overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-ink-50/70 text-[11px] text-ink-500">
                    <th className="px-2.5 py-2 font-medium w-[74px]">身份</th>
                    <th className="px-2.5 py-2 font-medium">可执行动作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className={cx('border-t border-ink-150/70', !isAdmin && 'bg-brand-50/50')}>
                    <td className="px-2.5 py-2 text-[12px] text-ink-700">
                      教师侧{!isAdmin && <span className="text-brand-600 font-medium">（当前）</span>}
                    </td>
                    <td className="px-2.5 py-2 text-[12px] text-ink-600">{flow.teacher.join(' · ')}</td>
                  </tr>
                  <tr className={cx('border-t border-ink-150/70', isAdmin && 'bg-brand-50/50')}>
                    <td className="px-2.5 py-2 text-[12px] text-ink-700">
                      管理员侧{isAdmin && <span className="text-brand-600 font-medium">（当前）</span>}
                    </td>
                    <td className="px-2.5 py-2 text-[12px] text-ink-600">{flow.admin.join(' · ')}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-3 pt-2.5 border-t border-ink-150/70">
              <Field label="当前规则" labelWidth="w-[68px]">
                {flow.label}
              </Field>
              <Field label="流程状态" labelWidth="w-[68px]">
                <StatusTag tone={st.tone} dot>
                  {st.label}
                </StatusTag>
              </Field>
              <Field label="下一处理人" labelWidth="w-[68px]">
                {nextHandler}
              </Field>
            </div>
          </GlassCard>

          {/* 版本 */}
          <GlassCard className="p-3.5 rounded-xl">
            <SubHead icon="History" title={`版本（${report.versions.length}）`} />
            {report.versions.length === 0 ? (
              <p className="text-[12px] text-ink-500">报告还没生成完成，暂无版本记录。</p>
            ) : (
              <ol className="relative pl-4">
                <span className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-ink-150" aria-hidden="true" />
                {report.versions.map((v, i) => (
                  <li key={v.v} className="relative pb-3 last:pb-0">
                    <span
                      className={cx(
                        'absolute -left-4 top-1 w-[11px] h-[11px] rounded-full border-2 border-white',
                        i === 0 ? 'bg-brand-500' : 'bg-ink-300',
                      )}
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] font-semibold text-ink-800 tabular-nums">{v.v}</span>
                      <span className="text-[11.5px] text-ink-400">{v.at}</span>
                      <span className="text-[11.5px] text-ink-500">{v.by}</span>
                    </div>
                    <p className="text-[11.5px] text-ink-600 leading-relaxed mt-0.5">{v.note}</p>
                  </li>
                ))}
              </ol>
            )}
          </GlassCard>

          {/* 发送设置 */}
          <GlassCard className="p-3.5 rounded-xl">
            <SubHead icon="Send" title="发送设置" />
            {report.type === 'school' ? (
              <p className="text-[12px] text-ink-600 leading-relaxed">
                学校范围汇总报告不发家长，只在学校内部留档；这里没有发送设置。
              </p>
            ) : (
              <>
                <p className="text-[11.5px] text-ink-500 mb-2">{report.sendSummary.hint}</p>
                <Field label="当前通道" labelWidth="w-[68px]">
                  {CHANNELS[channel].label}
                </Field>
                <Field label="接收范围" labelWidth="w-[68px]">
                  {RECIPIENT_SCOPES[scope].label}
                </Field>
                <p className="text-[11px] text-ink-500 mt-1">{RECIPIENT_SCOPES[scope].desc}</p>
                <p className="text-[11.5px] text-ink-600 mt-3 leading-relaxed">
                  发送任务、联系人和重试状态只在「家长发送」页通过正式接口创建与读取，本页不会把本地选择当作业务写入。
                </p>
                {canParents && (
                  <Btn className="mt-3" icon="Send" onClick={() => navigate('/console/reports/parents')}>
                    前往家长发送
                  </Btn>
                )}

                {!canTrack && (
                  <p className="mt-2.5 flex items-start gap-1.5 text-[11px] text-ink-500 bg-ink-50 border border-ink-150 rounded-lg px-2.5 py-1.5">
                    <Icon name="Info" className="w-3.5 h-3.5 mt-px shrink-0 text-ink-400" strokeWidth={2} />
                    纯短信只能拿到运营商送达结果，看不到家长是否打开，家长发送页的触达状态会显示「不可获知」。
                  </p>
                )}
              </>
            )}

          </GlassCard>

          {/* 可执行操作单独一张卡：学校汇总报告没有发送设置，但仍然有审批动作，
              放在发送设置卡里会和「不发家长」那句说明看起来自相矛盾 */}
          {actions.length > 0 && (
            <GlassCard className="p-3.5 rounded-xl">
              <SubHead
                icon="MousePointerClick"
                title="可执行操作"
                extra={<span className="text-[11px] text-ink-400">{isAdmin ? '管理员侧' : '教师侧'}</span>}
              />
              <p className="text-[11.5px] text-ink-500 leading-relaxed mb-2.5">
                按服务端返回的学校规则「{flow.label}」与你的身份给出；只有有正式接口的动作才会在这里出现。
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {actions.map((a) => (
                  <Btn
                    key={a.key}
                    tone={a.tone}
                    icon={a.icon}
                    onClick={() => (a.key === 'records' ? navigate('/console/reports/parents') : setAsk(a))}
                  >
                    {a.label}
                  </Btn>
                ))}
              </div>
            </GlassCard>
          )}

          {/* 内容边界 */}
          <GlassCard className="p-3.5 rounded-xl">
            <SubHead icon="ShieldCheck" title="内容边界" />
            <ul className="space-y-1.5">
              {[
                '默认不发送学生原始对话，只发数据摘要与教师评价',
                '未经学校确认的安全事件不会写进任何家长报告',
                'AI 段落必须保留免责声明，教师确认前不发送',
              ].map((t) => (
                <li key={t} className="flex items-start gap-1.5 text-[11.5px] text-ink-600 leading-relaxed">
                  <Icon name="Check" className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#3E9E8F]" strokeWidth={2.4} />
                  {t}
                </li>
              ))}
            </ul>
          </GlassCard>
        </div>
      </div>

      <ConfirmModal
        open={!!ask}
        onClose={() => setAsk(null)}
        onConfirm={() => run(ask.key)}
        title={ask ? `${ask.label}？` : ''}
        confirmText={ask?.label || '确认'}
        tone={ask?.key === 'reject' ? 'danger' : 'primary'}
        desc={ask ? askText(ask.key) : ''}
      />

      <Modal
        open={!!done}
        onClose={() => setDone(null)}
        icon="CircleCheck"
        title={done?.title || ''}
        desc={done?.desc}
        width="max-w-[440px]"
        footer={
          <>
            <Btn onClick={() => setDone(null)}>留在本页</Btn>
            {canParents && (
              <Btn tone="primary" onClick={() => navigate('/console/reports/parents')}>
                去看发送记录
              </Btn>
            )}
          </>
        }
      >
        <p className="text-[13px] text-ink-700 leading-relaxed">
          当前状态为 <b>{REPORT_STATUS[status].label}</b>，页面会在服务端响应后重新读取最新数据。
        </p>
      </Modal>
    </PagePanel>
  )
}

function handlerOf(rule, status, report) {
  if (status === 'published') return '——（已完成）'
  if (status === 'generating') return '系统（生成中）'
  if (rule === 'review') {
    if (status === 'review') return '培新小学 · 学校管理员（通过并发送）'
    if (status === 'withdrawn') return `${report.nextHandler}（修改后重新提交）`
    return `${report.nextHandler}（提交审核）`
  }
  if (status === 'failed') return `${report.nextHandler}（重试发送）`
  return `${report.nextHandler}（确认发送）`
}

function askText(key) {
  switch (key) {
    case 'review':
      return '确认后服务端会将当前版本标记为已审核，并同步写入审计与待处理事件。此操作不会直接创建或发送家长触达任务。'
    default:
      return ''
  }
}

const NOTE_TONE = {
  danger: 'bg-danger-50/80 border-danger-100 text-danger-700',
  warning: 'bg-warning-50/80 border-warning-100 text-warning-700',
  muted: 'bg-ink-100/70 border-ink-200 text-ink-600',
}

function NoteBar({ tone, icon, title, children }) {
  return (
    <div className={cx('console-enter mb-3.5 flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border', NOTE_TONE[tone])}>
      <Icon name={icon} className="w-4 h-4 mt-px shrink-0" strokeWidth={1.9} />
      <p className="text-[12.5px] leading-relaxed">
        <b>{title}：</b>
        <span className="text-ink-700">{children}</span>
      </p>
    </div>
  )
}
