import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { cx } from '../../../shared/cx.js'
import { RuntimeIcon as Icon } from '../../../shared/RuntimeIcon.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, EmptyState, Field, StatusTag, SubHead } from '../../components/Controls.jsx'
import { Modal } from '../../components/Overlay.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import {
  SAFETY_CHAIN_STATE,
  SAFETY_EVENT_STATUS,
  SAFETY_RISK_META,
  formatSafetyDeadline,
} from '../../../adapters/safety.js'
import useSafetyEvent from '../../state/useSafetyEvent.js'

// 事件详情：顺序是拍板过的五段，不许换位置——
// 1 风险摘要与当前状态 → 2 触发消息与最小必要上下文 → 3 通知与排除人员
// → 4 处理时间线 → 5 线下处理记录与结果
//
// 误报关闭、事件关闭与查看扩展上下文都必须填说明（按钮在说明为空时禁用）。

const ACTIONS = {
  take: { label: '接手事件', icon: 'Hand', tone: 'primary', need: false, desc: '接手后你成为当前负责人，处理时限重新计时。' },
  transfer: {
    label: '转交',
    icon: 'ArrowRightLeft',
    tone: 'plain',
    need: true,
    desc: '转交给下一级责任人，必须写清为什么转交；原负责人的处理记录会保留。',
  },
  review: {
    label: '提交复核',
    icon: 'ClipboardCheck',
    tone: 'primary',
    need: true,
    desc: '提交给复核人，需要写清已经做了什么、学生当前状态如何。',
  },
  close: {
    label: '关闭事件',
    icon: 'CircleCheck',
    tone: 'primary',
    need: true,
    desc: '关闭前必须填写处理结果说明；关闭后仍可查看，但不再计时。',
  },
  false: {
    label: '标记误报',
    icon: 'CircleSlash',
    tone: 'plain',
    need: true,
    desc: '误报会终止处理链，必须写明为什么判定为误报（例如触发内容其实是书里的情节）。',
  },
  more: {
    label: '填写用途并查看更多',
    icon: 'FileSearch',
    tone: 'plain',
    need: true,
    desc: '扩展上下文属于最小必要之外的内容，必须填写用途；每次查看都会记入审计并显示水印。',
  },
}

export default function SafetyDetail() {
  const { eventId } = useParams()
  const { workspace } = useConsole()
  const navigate = useNavigate()
  const resource = useSafetyEvent(eventId, workspace?.id)
  const event = resource.data

  const [expanded, setExpanded] = useState(false)
  const [ask, setAsk] = useState(null)
  const [note, setNote] = useState('')
  const [actionNotice, setActionNotice] = useState(null)
  const [actionPending, setActionPending] = useState(false)

  const student = useMemo(() => event?.student || null, [event])
  const klass = useMemo(() => event?.klass || null, [event])
  const book = useMemo(() => event?.book || null, [event])
  const context = useMemo(() => event?.context || [], [event])

  if (resource.status === 'loading') {
    return (
      <PagePanel title="正在读取安全事件" desc="安全详情只使用服务端返回的最小必要上下文。">
        <EmptyState icon="LoaderCircle" title="正在连接安全服务" desc="尚未展示静态风险判断或累计消息数。" />
      </PagePanel>
    )
  }

  if (resource.status === 'error') {
    return (
      <PagePanel title="安全详情暂不可用" desc="请求失败时不会回退到演示事件。">
        <EmptyState
          icon="CloudOff"
          title="未能读取安全事件"
          desc={`${resource.error?.code || 'DEPENDENCY_UNAVAILABLE'}：${resource.error?.message || '服务暂不可用'}`}
          action={
            <Btn tone="primary" icon="RefreshCw" onClick={resource.reload}>
              重试连接
            </Btn>
          }
        />
      </PagePanel>
    )
  }

  if (!event) {
    return (
      <PagePanel title="事件不存在" desc="这个事件可能已关闭并移出列表，或不在当前工作空间的可见范围内。">
        <EmptyState
          icon="ShieldQuestion"
          title="找不到这个安全事件"
          desc="请回到安全事件列表重新选择；被判定为涉事人员时也看不到对应事件。"
          action={
            <Btn tone="primary" icon="ArrowLeft" onClick={() => navigate('/console/safety')}>
              回到安全事件
            </Btn>
          }
        />
      </PagePanel>
    )
  }

  const lv = event.risk
    ? SAFETY_RISK_META[event.risk] || { label: event.risk, tone: 'muted', dot: '#98A2B3', desc: '风险级别由服务端返回' }
    : { label: '服务端未返回风险级别', tone: 'muted', dot: '#98A2B3', desc: '当前没有可显示的风险判断' }
  const st = event.status
    ? SAFETY_EVENT_STATUS[event.status] || { label: event.status, tone: 'muted' }
    : { label: '服务端未返回状态', tone: 'muted' }
  const rm = formatSafetyDeadline(event)
  const viewer = event.viewer?.name || workspace?.person?.name || '当前会话'
  const stamp = event.watermark || viewer
  const reviewLabel = event.reviewResult || '服务端未返回'

  const actionKeys = event.actions.filter((action) => ACTIONS[action])

  const run = async () => {
    if (ask === 'more') {
      setExpanded(true)
      setAsk(null)
      setNote('')
      return
    }
    setActionPending(true)
    setActionNotice(null)
    try {
      if (ask === 'take') {
        await resource.accept()
        setActionNotice('事件已由当前学校管理员接手，真实处理状态已保存。')
      } else if (ask === 'close' || ask === 'false') {
        await resource.close({
          outcome: ask === 'false' ? 'false_positive_closed' : 'closed',
          note: note.trim(),
        })
        setActionNotice(ask === 'false' ? '误报结论与说明已保存。' : '处理结果与关闭说明已保存。')
      }
      setAsk(null)
      setNote('')
    } catch (error) {
      setActionNotice(`${error?.code || 'DEPENDENCY_UNAVAILABLE'}：${error?.message || '处理请求失败，请刷新后重试'}`)
    } finally {
      setActionPending(false)
    }
  }

  const timeline = event.timeline

  return (
    <PagePanel
      title={`${event.displayLabel ? `${event.displayLabel} · ` : ''}${event.id || '服务端未返回事件编号'} · ${student?.name || '服务端未返回学生'} · ${lv.label}`}
      desc={`${klass?.name || '服务端未返回班级'} · 触发于 ${event.triggerAt || '服务端未返回'} · ${event.slaHours === null ? '等待服务端返回处理时限' : `处理时限 ${event.slaHours} 小时`}`}
      toolbar={
        <>
          <Btn icon="ArrowLeft" onClick={() => navigate('/console/safety')}>
            返回列表
          </Btn>
          {actionKeys.map((k) => (
            <Btn key={k} tone={ACTIONS[k].tone} icon={ACTIONS[k].icon} onClick={() => (setAsk(k), setNote(''))}>
              {ACTIONS[k].label}
            </Btn>
          ))}
        </>
      }
    >
      {actionNotice && (
        <GlassCard className="mb-3 border border-warning-100 bg-warning-50/70 px-3.5 py-2.5 text-[12px] text-warning-700">
          {actionNotice}
        </GlassCard>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-[1.55fr_1fr] gap-4 items-start">
        <div className="console-enter min-w-0 space-y-3.5">
          {/* 1 风险摘要与当前状态 */}
          <GlassCard className="p-4 rounded-xl relative overflow-hidden">
            <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: lv.dot }} />
            <SubHead
              icon="ShieldAlert"
              title="1 · 风险摘要与当前状态"
              extra={
                <span className={cx('text-[12px] font-semibold tabular-nums', REMAIN_TONE[rm.tone])}>{rm.text}</span>
              }
            />
            <div className="flex items-center gap-2 flex-wrap">
              <StatusTag tone={lv.tone} dot>
                {lv.label}
              </StatusTag>
              <StatusTag tone={st.tone}>{st.label}</StatusTag>
              <span className="text-[11.5px] text-ink-500">{lv.desc}</span>
            </div>
            <p className="text-[13px] text-ink-800 leading-[1.9] mt-2.5">{event.summary || '服务端未提供事件摘要。'}</p>
            <div className="mt-2.5 grid grid-cols-1 gap-1.5 rounded-lg border border-ink-150 bg-ink-50 px-2.5 py-2 text-[11.5px] text-ink-500 sm:grid-cols-3">
              <span>触发阈值：{event.threshold ?? '服务端未返回'}</span>
              <span>符合阈值消息：{event.qualifyingMessageCount ?? '服务端未返回'}</span>
              <span>二次复核：{reviewLabel}</span>
            </div>
            {event.reviewSummary && (
              <p className="mt-2.5 flex items-start gap-1.5 text-[11.5px] text-ink-500 bg-ink-50 border border-ink-150 rounded-lg px-2.5 py-1.5">
                <Icon name="Bot" className="w-3.5 h-3.5 mt-px shrink-0 text-ink-400" strokeWidth={1.9} />
                {event.reviewSummary}
              </p>
            )}
            {event.ownerNote && (
              <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-warning-700 bg-warning-50/70 border border-warning-100 rounded-lg px-2.5 py-1.5">
                <Icon name="UserRoundX" className="w-3.5 h-3.5 mt-px shrink-0" strokeWidth={1.9} />
                {event.ownerNote}
              </p>
            )}
          </GlassCard>

          {/* 2 触发消息与最小必要上下文 */}
          <GlassCard className="p-4 rounded-xl relative overflow-hidden">
            <SubHead
              icon="MessageSquareWarning"
              title="2 · 触发消息与最小必要上下文"
              extra={<span className="text-[11.5px] text-ink-400">触发消息 + 前后各 2 条</span>}
            />

            <div className="relative rounded-xl border border-ink-150 bg-white/70 px-3.5 py-3 overflow-hidden">
              {/* 查看水印：与学生会话页同一套做法，留痕可见但不挡阅读 */}
              <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.055] select-none">
                {[
                  ['6%', '8%'],
                  ['52%', '34%'],
                  ['12%', '62%'],
                  ['56%', '86%'],
                ].map(([left, top]) => (
                  <span
                    key={`${left}${top}`}
                    className="absolute text-[15px] font-semibold whitespace-nowrap"
                    style={{ left, top, transform: 'rotate(-26deg)' }}
                  >
                    {stamp}
                  </span>
                ))}
              </div>

              {expanded ? (
                <p className="relative text-center text-[11px] text-brand-600 mb-3">
                  已按填写的用途展开更多历史（本次查看已记入审计）
                </p>
              ) : (
                <CutLine text={event.hiddenBefore == null ? '服务端未返回未展开消息数' : `此前 ${event.hiddenBefore} 条消息未展开`} />
              )}

              {context.map((m, i) => (
                <div key={i} className="relative mb-[18px] last:mb-0">
                  <div className="flex items-center gap-2 mb-1.5 text-[11.5px] text-ink-400">
                    <span
                      className={cx(
                        'w-[19px] h-[19px] rounded-full text-[10px] text-white flex items-center justify-center shrink-0',
                        m.role === 'stu'
                          ? 'bg-gradient-to-br from-[#F3B76B] to-[#EC8A4C]'
                          : 'bg-gradient-to-br from-[#8E9CF0] to-[#3C6FE0]',
                      )}
                    >
                      {m.role === 'stu' ? student?.name?.slice(0, 1) || '?' : '伴'}
                    </span>
                    <b className="font-semibold text-ink-600">{m.role === 'stu' ? student?.name : '读伴'}</b>
                    <span>{m.at}</span>
                    {m.trigger && (
                      <span className="text-[10.5px] font-semibold text-danger-600 bg-danger-50 rounded px-1.5 py-px">
                        触发消息
                      </span>
                    )}
                  </div>
                  {m.quote && (
                    <div className="mb-2 pl-3 pr-3 py-2 rounded-r-lg border-l-[3px] border-accent-500 bg-accent-50/50">
                      <p className="text-[11px] text-ink-500 mb-1">
                        选中原文 ·{' '}
                        <span className="font-semibold text-accent-600">
                          第 {m.quote.page} 页 {m.quote.chapter}
                        </span>
                      </p>
                      <p className="text-[12.5px] text-ink-700 leading-relaxed">{m.quote.text}</p>
                    </div>
                  )}
                  <div
                    className={cx(
                      'rounded-xl px-3.5 py-2.5 text-[13px] leading-[1.75] text-ink-800 border',
                      m.role === 'stu' ? 'bg-[#FBF7F1] border-[#F0E6D8]' : 'bg-[#F7F9FE] border-brand-100',
                      m.trigger && 'ring-[1.5px] ring-danger-100',
                    )}
                  >
                    {m.text}
                  </div>
                </div>
              ))}

              {!expanded && <CutLine text={`其后 ${event.hiddenAfter} 条消息未展开`} />}

              <div className="relative flex items-center justify-center gap-2 flex-wrap pt-1">
                {!expanded ? (
                  <Btn icon="FileSearch" onClick={() => (setAsk('more'), setNote(''))}>
                    填写用途并查看更多
                  </Btn>
                ) : (
                  <Btn icon="PanelTopClose" onClick={() => setExpanded(false)}>
                    收回到最小必要上下文
                  </Btn>
                )}
                {event.sessionId && (
                  <Btn icon="MessagesSquare" onClick={() => navigate('/console/usage/sessions')}>
                    在会话页打开
                  </Btn>
                )}
              </div>
            </div>

            <p className="mt-2.5 text-[11.5px] text-ink-500 leading-relaxed">
              这里只保留最小必要证据，且独立保存 —— 学生删除普通会话不会删掉它。原文不可导出、不可转发。
            </p>
          </GlassCard>

          {/* 3 当前通知与排除人员 */}
          <GlassCard className="p-4 rounded-xl">
            <SubHead icon="BellRing" title="3 · 当前通知与排除人员" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <p className="text-[11.5px] text-ink-400 mb-1.5">
                  通知对象（{event.notificationTargets.length}）· 已派发（{event.notified.length}）· 已送达（{event.delivered.length}）
                </p>
                <ul className="space-y-1.5">
                  {event.notificationTargets.map((n) => {
                    const notificationState = SAFETY_CHAIN_STATE[n.state] || SAFETY_CHAIN_STATE.planned
                    return (
                      <li
                        key={n.id || n.name}
                        className="flex items-center gap-2 rounded-lg border border-ink-150 bg-white/70 px-2.5 py-1.5"
                      >
                      <span className="console-avatar w-[22px] h-[22px] rounded-lg text-[10.5px] text-white flex items-center justify-center shrink-0">
                        {n.name.slice(0, 1)}
                      </span>
                      <span className="text-[12.5px] text-ink-800 truncate">{n.name}</span>
                      <span className="text-[11px] text-ink-400 truncate">{n.role}</span>
                      <div className="flex-1" />
                      <span className="text-[11px] text-ink-400 whitespace-nowrap">{n.at}</span>
                      <StatusTag tone={notificationState.tone}>
                        {notificationState.label}
                      </StatusTag>
                    </li>
                    )
                  })}
                </ul>
              </div>
              <div>
                <p className="text-[11.5px] text-ink-400 mb-1.5">回避人员（{event.excluded.length}）</p>
                {event.excluded.length === 0 ? (
                  <p className="text-[12px] text-ink-500 rounded-lg border border-dashed border-ink-200 px-2.5 py-2.5">
                    本事件没有涉事人员，按正常升级链通知。
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {event.excluded.map((x) => (
                      <li key={x.name} className="rounded-lg border border-ink-200 bg-ink-50 px-2.5 py-2">
                        <div className="flex items-center gap-2">
                          <Icon name="UserRoundX" className="w-3.5 h-3.5 text-ink-400 shrink-0" strokeWidth={1.9} />
                          <span className="text-[12.5px] text-ink-600 line-through">{x.name}</span>
                          <span className="text-[11px] text-ink-400">{x.role}</span>
                        </div>
                        <p className="text-[11.5px] text-ink-500 leading-relaxed mt-1">{x.reason}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </GlassCard>

          {/* 4 处理时间线 */}
          <GlassCard className="p-4 rounded-xl">
            <SubHead icon="History" title={`4 · 处理时间线（${timeline.length}）`} />
            <ol className="relative pl-4">
              <span className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-ink-150" aria-hidden="true" />
              {timeline.map((t, i) => (
                <li key={i} className="relative pb-3 last:pb-0">
                  <span
                    className={cx(
                      'absolute -left-4 top-1 w-[11px] h-[11px] rounded-full border-2 border-white',
                      i === timeline.length - 1 ? 'bg-brand-500' : 'bg-ink-300',
                    )}
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11.5px] text-ink-400 tabular-nums">{t.at}</span>
                    <span className="text-[12.5px] font-medium text-ink-800">{t.actor}</span>
                    <span className="text-[12.5px] text-ink-700">{t.action}</span>
                  </div>
                  {t.note && <p className="text-[11.5px] text-ink-500 leading-relaxed mt-0.5">{t.note}</p>}
                </li>
              ))}
            </ol>
            <p className="mt-2 text-[11.5px] text-ink-400">系统记录实际查看人、接手人、处理人、时间与结果，记录不可删除。</p>
          </GlassCard>

          {/* 5 线下处理记录与结果 */}
          <GlassCard className="p-4 rounded-xl">
            <SubHead icon="NotebookPen" title="5 · 线下处理记录与结果" />
            {event.offline ? (
              <div className="rounded-xl border border-ink-150 bg-white/70 px-3.5 py-3">
                <div className="flex items-center gap-2 text-[11.5px] text-ink-400">
                  <span className="text-[12.5px] font-medium text-ink-700">{event.offline.by}</span>
                  <span>{event.offline.at}</span>
                </div>
                <p className="text-[13px] text-ink-800 leading-[1.9] mt-1.5">{event.offline.text}</p>
              </div>
            ) : (
              <p className="text-[12.5px] text-ink-500 rounded-xl border border-dashed border-ink-200 px-3.5 py-4">
                还没有线下记录。与学生或家长沟通后请补一条 —— 这是后续复核与交接的唯一依据。
              </p>
            )}

            {event.result ? (
              <div
                className={cx(
                  'mt-3 flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border',
                  event.result.tone === 'success'
                    ? 'bg-success-50/70 border-success-100'
                    : 'bg-ink-100/70 border-ink-200',
                )}
              >
                <Icon
                  name={event.result.tone === 'success' ? 'CircleCheck' : 'CircleSlash'}
                  className={cx(
                    'w-4 h-4 mt-px shrink-0',
                    event.result.tone === 'success' ? 'text-success-600' : 'text-ink-500',
                  )}
                  strokeWidth={1.9}
                />
                <p className="text-[12.5px] leading-relaxed">
                  <b className="text-ink-800">{event.result.label}：</b>
                  <span className="text-ink-700">{event.result.text}</span>
                </p>
              </div>
            ) : (
              <p className="mt-3 flex items-start gap-1.5 text-[11.5px] text-ink-500">
                <Icon name="Info" className="w-3.5 h-3.5 mt-px shrink-0 text-ink-400" strokeWidth={2} />
                事件尚未终结：未经学校确认的安全事件不会写入任何家长报告，也不在学生端显示报警状态。
              </p>
            )}
          </GlassCard>
        </div>

        {/* 右栏：事件资料 + 本事件的升级链 */}
        <div className="console-enter space-y-3.5 min-w-0">
          <GlassCard className="p-3.5 rounded-xl">
            <SubHead icon="ClipboardList" title="事件资料" />
            <Field label="事件编号" labelWidth="w-[68px]">
              <span className="tabular-nums">{event.id}</span>
            </Field>
            <Field label="学生" labelWidth="w-[68px]">
              <button
                type="button"
                onClick={() => navigate(`/console/accounts/students/${student.id}`)}
                className="text-brand-700 hover:underline"
              >
                {student?.name}
              </button>
              <span className="text-ink-400"> · 学号 {student?.no}</span>
            </Field>
            <Field label="班级" labelWidth="w-[68px]">
              {klass?.name}
            </Field>
            {book && (
              <Field label="关联书目" labelWidth="w-[68px]">
                <button
                  type="button"
                  onClick={() => navigate(`/console/teaching/books/${book.id}`)}
                  className="text-brand-700 hover:underline"
                >
                  《{book.title}》
                </button>
              </Field>
            )}
            <Field label="触发时间" labelWidth="w-[68px]">
              {event.triggerAt}
            </Field>
            <Field label="当前负责人" labelWidth="w-[68px]">
              {event.owner}
            </Field>
            <Field label="剩余时间" labelWidth="w-[68px]">
              <span className={cx('font-semibold', REMAIN_TONE[rm.tone])}>{rm.text}</span>
            </Field>
          </GlassCard>

          <GlassCard className="p-3.5 rounded-xl">
            <SubHead
              icon="Network"
              title="本事件升级链"
              extra={<span className="text-[11px] text-ink-400">{event.escalation.owner || '服务端未返回升级链配置'}</span>}
            />
            <ol className="relative pl-5">
              {event.chain.map((c, i) => {
                const cs = SAFETY_CHAIN_STATE[c.state] || SAFETY_CHAIN_STATE.waiting
                const skip = c.state === 'skipped'
                return (
                  <li key={c.id || c.name} className="relative pb-3.5 last:pb-0">
                    {i < event.chain.length - 1 && (
                      <span
                        className={cx(
                          'absolute -left-[14px] top-4 bottom-0 w-px',
                          skip ? 'console-chain-line--skip' : 'console-chain-line',
                        )}
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={cx(
                        'absolute -left-5 top-1 w-[13px] h-[13px] rounded-full border-2 flex items-center justify-center',
                        c.state === 'current'
                          ? 'border-warning-400 bg-warning-50'
                          : c.state === 'done'
                            ? 'border-success-400 bg-success-50'
                            : 'border-ink-200 bg-white',
                      )}
                    >
                      {c.state === 'done' && <Icon name="Check" className="w-2 h-2 text-success-600" strokeWidth={4} />}
                      {skip && <Icon name="X" className="w-2 h-2 text-ink-400" strokeWidth={4} />}
                      {c.state === 'current' && <span className="w-[5px] h-[5px] rounded-full bg-warning-500" />}
                    </span>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={cx(
                          'text-[12.5px] font-semibold',
                          skip ? 'text-ink-400 line-through' : 'text-ink-900',
                        )}
                      >
                        {c.name}
                      </span>
                      <span className="text-[11px] text-ink-400">{c.role}</span>
                      <StatusTag tone={cs.tone}>{cs.label}</StatusTag>
                    </div>
                    {/* skipped 的 note 就是「涉事回避」，与上面标签重复，不再读一遍 */}
                    <p className="text-[11.5px] text-ink-500 mt-0.5">
                      {c.at}
                      {c.note && !skip && ` · ${c.note}`}
                    </p>
                  </li>
                )
              })}
            </ol>
            <p className="mt-2 pt-2.5 border-t border-ink-150/70 text-[11.5px] text-ink-500 leading-relaxed">
              最终责任人是校长／书记层级，不再继续向上升级；涉事人员自动跳过，不通知也不可访问。
            </p>
            <Btn className="mt-2.5" icon="Network" onClick={() => navigate('/console/safety')}>
              查看完整升级链配置
            </Btn>
          </GlassCard>
        </div>
      </div>

      {/* 动作弹窗：需要说明的动作在说明为空时禁用主按钮 */}
      <Modal
        open={!!ask}
        onClose={() => (setAsk(null), setNote(''))}
        icon={ask ? ACTIONS[ask].icon : 'CircleHelp'}
        title={ask ? ACTIONS[ask].label : ''}
        desc={ask ? `${event.id} · ${student?.name}` : ''}
        width="max-w-[520px]"
        footer={
          <>
            <Btn onClick={() => (setAsk(null), setNote(''))}>取消</Btn>
            <Btn
              tone={ask === 'false' ? 'danger' : 'primary'}
              disabled={actionPending || (ask ? ACTIONS[ask].need && !note.trim() : true)}
              onClick={run}
            >
              {ask ? ACTIONS[ask].label : '确认'}
            </Btn>
          </>
        }
      >
        {ask && (
          <>
            <p className="text-[13px] text-ink-700 leading-relaxed">{ACTIONS[ask].desc}</p>
            {ACTIONS[ask].need && (
              <>
                <label className="block text-[12px] text-ink-500 mt-3 mb-1">
                  {ask === 'more' ? '查看用途' : '说明'}
                  <span className="text-danger-600">（必填）</span>
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder={
                    ask === 'more'
                      ? '例如：确认最近一周是否还有类似表达，用于判断是否联系监护人'
                      : '写清做了什么、学生当前状态如何，或为什么判定为误报'
                  }
                  className="console-input resize-none"
                />
                {!note.trim() && <p className="text-[11.5px] text-ink-400 mt-1">说明会写进处理时间线与审计记录，不能留空。</p>}
              </>
            )}
          </>
        )}
      </Modal>
    </PagePanel>
  )
}

function CutLine({ text }) {
  return (
    <div className="relative flex items-center gap-2.5 my-3.5 text-[11px] text-ink-400">
      <span className="h-px flex-1 bg-ink-150" />
      {text}
      <span className="h-px flex-1 bg-ink-150" />
    </div>
  )
}

const REMAIN_TONE = {
  danger: 'text-danger-600',
  warning: 'text-warning-600',
  brand: 'text-brand-600',
  muted: 'text-ink-400',
}
