import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RuntimeIcon as Icon } from '../../../shared/RuntimeIcon.jsx'
import { cx } from '../../../shared/cx.js'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, EmptyState, Field, IconBtn, SearchBox, Select, StatusTag, SubHead } from '../../components/Controls.jsx'
import { ConfirmModal, SideSheet } from '../../components/Overlay.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import {
  CHANNELS,
  REACH_STATES,
  RECIPIENT_SCOPES,
  SEND_DEFAULT_NOTE,
  SEND_MODES,
  SEND_RULES,
  SEND_STATES,
} from '../../state/useReportsData.js'
import useReportsData from '../../state/useReportsData.js'

// 家长发送：规则概览 + 发送记录 + 失败重试 + 触达结果（Codex 第 78 轮分工）。
// 发起发送不在这一页 —— 那是报告详情的事，这里只看「发过什么、结果如何」。
//
// 两个字段绝对不能合并：
//   发送状态 = 待发送 / 发送中 / 成功 / 失败（「重试」是失败行上的按钮，不是状态）
//   触达状态 = 未打开 / 已打开 / 已确认阅读；纯短信拿不到 → 显示「不可获知」

const RULE_TONE = {
  success: 'bg-success-50 text-success-700 border-success-100',
  brand: 'bg-brand-50 text-brand-700 border-brand-100',
  muted: 'bg-ink-100 text-ink-600 border-ink-200',
}

// Plan_2 P8：「本校配置」与「产品内置」必须一眼分得出来，
// 否则演示时容易把培新小学的选择说成产品行为。
const SOURCE_LABEL = {
  school: { text: '本校配置', icon: 'Building2' },
  product: { text: '产品内置', icon: 'Package' },
}

export default function ParentSend() {
  const { workspace } = useConsole()
  const navigate = useNavigate()
  const resource = useReportsData(workspace?.id)
  const { deliveries: apiDeliveries = [], contacts: apiContacts = [], students = [], reports = [] } = resource.data || {}

  const [channel, setChannel] = useState('all')
  const [send, setSend] = useState('all')
  const [reach, setReach] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [openId, setOpenId] = useState(null)
  const [ask, setAsk] = useState(null)
  const [deliveryDetail, setDeliveryDetail] = useState(null)
  const [contactOpen, setContactOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [contact, setContact] = useState({ studentId: '', displayName: '', destination: '' })
  const [sessionContacts, setSessionContacts] = useState([])
  const [queue, setQueue] = useState({ reportId: '', parentContactId: '' })
  const [sessionDeliveries, setSessionDeliveries] = useState([])
  const [actionError, setActionError] = useState(null)
  // 关闭态壳子（Plan_2 P8）：实际开关在学校配置里，这里只是让人看到
  // “产品默认关闭”时这块版面长什么样，不会塌也不会变空白。
  const [scheduledOff, setScheduledOff] = useState(false)

  const contacts = useMemo(() => [...new Map([...apiContacts, ...sessionContacts].map((item) => [item.id, item])).values()], [apiContacts, sessionContacts])
  const all = useMemo(() => [...new Map([...apiDeliveries, ...sessionDeliveries].map((item) => [item.id, item])).values()], [apiDeliveries, sessionDeliveries])
  const rows = useMemo(() => {
    const k = keyword.trim()
    return all.filter((r) => {
      if (channel !== 'all' && r.channel !== channel) return false
      if (send !== 'all' && r.sendState !== send) return false
      if (reach !== 'all') {
        const val = CHANNELS[r.channel].canTrack ? r.reach || 'unopened' : 'unknown'
        if (val !== reach) return false
      }
      if (!k) return true
        const stu = r.student
        const rep = r.report
      return (
        (stu?.name || '').includes(k) ||
        (rep?.title || '').includes(k) ||
        r.recipient.name.includes(k) ||
        r.recipient.phone.includes(k)
      )
    })
  }, [all, channel, send, reach, keyword])

  const opened = all.find((r) => r.id === openId) || null
  const failed = all.filter((r) => r.sendState === 'failed')
  const tracked = all.filter((r) => CHANNELS[r.channel].canTrack)
  const readCount = tracked.filter((r) => r.reach === 'read').length
  const openDelivery = async (delivery) => {
    setOpenId(delivery.id)
    setDeliveryDetail(null)
    setActionError(null)
    try {
      setDeliveryDetail(await resource.getDelivery(delivery.id))
    } catch (error) {
      setActionError(error.message)
    }
  }
  const createContact = async () => {
    try {
      const created = await resource.createParentContact({ ...contact, channel: 'summary_link' })
      const student = students.find((item) => item.id === contact.studentId)
      setSessionContacts((items) => [...items, { ...created, ...contact, student }])
      setQueue((value) => ({ ...value, parentContactId: created.id }))
      setContact({ studentId: '', displayName: '', destination: '' })
      setContactOpen(false)
    } catch (error) {
      setActionError(error.message)
    }
  }
  const queueDelivery = async () => {
    const report = reports.find((item) => item.id === queue.reportId)
    const parentContact = contacts.find((item) => item.id === queue.parentContactId)
    if (!report || !parentContact) return
    try {
      const created = await resource.createDelivery(report.id, { reportVersionId: report.versionId, parentContactId: parentContact.id })
      setSessionDeliveries((items) => [{
        ...created,
        id: created.id,
        reportId: report.id,
        report,
        student: report.student,
        channel: created.channel === 'summary_link' ? 'link' : created.channel,
        recipient: { name: parentContact.displayName, relation: '监护人', phone: parentContact.destination },
        scope: 'custom',
        mode: 'manual',
        sendState: created.status === 'sent' ? 'success' : created.status === 'processing' ? 'sending' : 'queued',
        reach: null,
        at: created.created_at || '待发送',
        retries: created.attempt_count || 0,
        trace: '已由服务端加入发送队列',
        publicUrl: created.publicUrl,
      }, ...items])
      setQueueOpen(false)
      setQueue({ reportId: '', parentContactId: '' })
    } catch (error) {
      setActionError(error.message)
    }
  }
  const processQueuedDelivery = async (delivery) => {
    setActionError(null)
    try {
      const processed = await resource.processDelivery(delivery.id)
      setSessionDeliveries((items) => items.map((item) => item.id === delivery.id ? {
        ...item,
        ...processed,
        sendState: processed.status === 'sent' ? 'success' : processed.status === 'processing' ? 'sending' : processed.status === 'failed' ? 'failed' : item.sendState,
      } : item))
    } catch (error) {
      setActionError(error.message)
    }
  }
  const copyPublicUrl = async () => {
    const publicUrl = deliveryDetail?.publicUrl || opened?.publicUrl
    if (!publicUrl) return
    try {
      await navigator.clipboard.writeText(publicUrl)
    } catch {
      setActionError('浏览器未允许复制，请手动复制该地址。')
    }
  }

  return (
    <PagePanel
      title={`${workspace?.scopeLabel || '当前工作空间'} · 家长发送`}
                  desc="这里通过正式接口读取发送规则、历史记录与触达结果，并创建联系人和发送任务。本机仅验证本地投递适配器，正式短信和小程序仍待外部联调。"
      toolbar={
        <>
          <SearchBox value={keyword} onChange={setKeyword} placeholder="搜索学生、报告或接收人" width="w-[210px]" />
          <Btn icon="UserPlus" onClick={() => setContactOpen(true)}>
            建立摘要链接联系人
          </Btn>
          <Btn tone="primary" icon="Send" onClick={() => setQueueOpen(true)}>
            排队发送
          </Btn>
          <Btn icon="FileText" onClick={() => navigate('/console/reports')}>
            报告中心
          </Btn>
        </>
      }
    >
      {resource.status === 'loading' && (
        <div className="console-enter mb-3.5 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-ink-50/70 border border-ink-150">
          <Icon name="LoaderCircle" className="w-4 h-4 text-ink-500 shrink-0" strokeWidth={1.9} />
          <p className="text-[12.5px] text-ink-600">正在读取服务端发送队列…</p>
        </div>
      )}
      {(resource.status === 'error' || actionError) && (
        <div className="console-enter mb-3.5 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-danger-50/70 border border-danger-100">
          <Icon name="CircleX" className="w-4 h-4 text-danger-600 shrink-0" strokeWidth={1.9} />
          <p className="text-[12.5px] text-danger-700">{actionError || resource.error.message}</p>
          {resource.status === 'error' && <Btn size="sm" tone="plain" onClick={resource.reload}>重新读取</Btn>}
        </div>
      )}
      {/* 产品默认口径：放在规则卡之前，先把「默认不自动发」说清楚（Plan_2 P8） */}
      <div className="rounded-xl border border-brand-100 bg-brand-50/55 px-3.5 py-3 flex items-start gap-2.5">
        <Icon name="Info" className="w-4 h-4 mt-px shrink-0 text-brand-600" strokeWidth={1.9} />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-ink-700 leading-relaxed">{SEND_DEFAULT_NOTE}</p>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <Btn
              size="sm"
              tone={scheduledOff ? 'primary' : 'ghost'}
              icon={scheduledOff ? 'ToggleLeft' : 'ToggleRight'}
              onClick={() => setScheduledOff((v) => !v)}
            >
              {scheduledOff ? '已模拟产品默认（定时发送关闭）' : '模拟产品默认（定时发送关闭）'}
            </Btn>
            <span className="text-[11px] text-ink-400">
              只切本页预览，不修改学校配置；真实开关在报告模板与规则页
            </span>
          </div>
        </div>
      </div>

      {/* 规则概览：四张卡，前两张是本校可开关的，后两张是产品内置与强制项 */}
      <div className="mt-3.5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5">
        {SEND_RULES.map((r) => {
          // 关闭态只影响 source==='school' 的卡；产品内置项不跟着变，
          // 手动发送反而要在关闭时保持可用，否则就成了“关了就发不了”的错误印象。
          const off = scheduledOff && r.off ? r.off : null
          const state = off ? off.state : r.state
          const tone = off ? off.tone : r.tone
          const lines = off ? off.lines : r.lines
          const src = SOURCE_LABEL[r.source]
          return (
            <GlassCard key={r.key} className="console-enter p-3.5 rounded-xl flex flex-col">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-white/80 border border-ink-150 flex items-center justify-center shrink-0">
                  <Icon name={r.icon} className="w-[15px] h-[15px] text-[#3E9E8F]" strokeWidth={1.9} />
                </span>
                <span className="text-[13px] font-semibold text-ink-800">{r.title}</span>
                <span
                  className={cx(
                    'ml-auto inline-flex items-center h-[20px] px-1.5 rounded-full border text-[10.5px] font-medium whitespace-nowrap',
                    RULE_TONE[tone],
                  )}
                >
                  {state}
                </span>
              </div>

              {/* 来源与出厂口径：不让人把上面那个状态当成产品行为。
                  xl 下四列每张卡只有 ~190px，所以来源与口径各占一行：
                  挤在一行会把「产品内置」拆成「产品／内置」竖排孤字（同批次 A 二级栏那个毛病） */}
              <div className="mt-2 space-y-0.5 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <Icon name={src.icon} className="w-3.5 h-3.5 shrink-0 text-ink-400" strokeWidth={1.9} />
                  <span className="text-ink-500 whitespace-nowrap">{src.text}</span>
                </div>
                <p className="pl-5 text-ink-400 leading-relaxed">{r.productDefault}</p>
              </div>

              <ul className="mt-2.5 space-y-1.5 flex-1">
                {lines.map((l) => (
                  <li key={l} className="flex items-start gap-1.5 text-[11.5px] text-ink-600 leading-relaxed">
                    <span className="w-1 h-1 rounded-full bg-ink-300 mt-[7px] shrink-0" />
                    {l}
                  </li>
                ))}
              </ul>
            </GlassCard>
          )
        })}
      </div>

      {/* 结果小结：只用能拿到的数据算，纯短信不计入触达统计 */}
      <div className="mt-3.5 grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Metric icon="Send" tone="brand" label="发送记录" value={all.length} unit="条" note="含待发送与发送中" />
        <Metric
          icon="CircleCheck"
          tone="cyan"
          label="发送成功"
          value={all.filter((r) => r.sendState === 'success').length}
          unit="条"
          note="以运营商或平台回执为准"
        />
        <Metric
          icon="CircleX"
          tone="danger"
          label="失败待处理"
          value={failed.length}
          unit="条"
          note={failed.length ? '可在下方逐条重试' : '暂无失败记录'}
        />
        <Metric
          icon="BookOpenCheck"
          tone="accent"
          label="已确认阅读"
          value={readCount}
          unit="条"
          note={`仅统计可回执的 ${tracked.length} 条（纯短信无法获知）`}
        />
      </div>

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <SubHead icon="ListChecks" title={`发送记录（${rows.length}）`} className="mb-0" />
        <div className="flex-1" />
        <Select
          value={channel}
          onChange={setChannel}
          options={[
            { value: 'all', label: '全部通道' },
            ...Object.entries(CHANNELS).map(([k, v]) => ({ value: k, label: v.label })),
          ]}
          width="w-[172px]"
        />
        <Select
          value={send}
          onChange={setSend}
          options={[
            { value: 'all', label: '全部发送状态' },
            ...Object.entries(SEND_STATES).map(([k, v]) => ({ value: k, label: v.label })),
          ]}
          width="w-[136px]"
        />
        <Select
          value={reach}
          onChange={setReach}
          options={[
            { value: 'all', label: '全部触达状态' },
            ...Object.entries(REACH_STATES).map(([k, v]) => ({ value: k, label: v.label })),
            { value: 'unknown', label: '不可获知' },
          ]}
          width="w-[136px]"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="Inbox"
          title="没有符合条件的发送记录"
          desc="换一个通道或状态看看；定时周报会在每周一教师确认后进入这里。"
        />
      ) : (
        <div className="mt-2.5 rounded-xl border border-ink-150 overflow-hidden bg-white/60">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-ink-50/70 text-[11.5px] text-ink-500">
                <th className="px-3 py-2.5 font-medium">报告与学生</th>
                <th className="px-2 py-2.5 font-medium w-[168px]">接收人</th>
                <th className="px-2 py-2.5 font-medium w-[132px]">通道 / 方式</th>
                <th className="px-2 py-2.5 font-medium w-[92px]">发送状态</th>
                <th className="px-2 py-2.5 font-medium w-[108px]">触达状态</th>
                <th className="px-2 py-2.5 font-medium w-[92px]">时间</th>
                <th className="px-2 py-2.5 font-medium w-[104px] text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const stu = r.student
                const rep = r.report
                const ch = CHANNELS[r.channel]
                const ss = SEND_STATES[r.sendState]
                return (
                  <tr key={r.id} className="border-t border-ink-150/70 hover:bg-white/80 transition">
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => rep && navigate(`/console/reports/${rep.id}`)}
                        className="text-[13px] font-medium text-ink-900 hover:text-brand-700 truncate block max-w-[280px] text-left"
                      >
                        {rep?.title || '报告已删除'}
                      </button>
                      <p className="text-[11px] text-ink-400">
                        {stu?.name} · {stu?.className || '未分班'}
                      </p>
                    </td>
                    <td className="px-2 py-2.5">
                      <p className="text-[12.5px] text-ink-700">
                        {r.recipient.name}
                        <span className="text-ink-400">（{r.recipient.relation}）</span>
                      </p>
                      <p className="text-[11px] text-ink-400 tabular-nums whitespace-nowrap">
                        {r.recipient.phone}
                      </p>
                      <p className="text-[11px] text-ink-400 whitespace-nowrap">{RECIPIENT_SCOPES[r.scope].label}</p>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="flex items-start gap-1.5 text-[12px] text-ink-700" title={ch.note}>
                        <Icon name={ch.icon} className="w-3.5 h-3.5 mt-0.5 text-ink-400 shrink-0" strokeWidth={1.9} />
                        {/* 短名给表格，全名放 title：1280 下「短信摘要 + 安全链接」会折成三行 */}
                        <span>{ch.label.replace(' + ', '+').replace('短信摘要+安全链接', '短信+安全链接')}</span>
                      </span>
                      <p className="text-[11px] text-ink-400">{SEND_MODES[r.mode].label}</p>
                    </td>
                    <td className="px-2 py-2.5">
                        <StatusTag tone={ss.tone} dot>
                          {ss.label}
                      </StatusTag>
                    </td>
                    <td className="px-2 py-2.5">
                        <ReachCell record={r} />
                    </td>
                    <td className="px-2 py-2.5 text-[11.5px] text-ink-500 whitespace-nowrap">{r.at}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {r.sendState === 'queued' && (
                          <Btn size="sm" tone="primary" icon="Send" onClick={() => processQueuedDelivery(r)}>
                            发送
                          </Btn>
                        )}
                        {r.sendState === 'failed' && (
                          <Btn size="sm" tone="primary" icon="RefreshCcw" onClick={() => setAsk(r)}>
                            重试
                          </Btn>
                        )}
                        <IconBtn icon="Info" title="查看发送轨迹" onClick={() => openDelivery(r)} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 flex items-start gap-1.5 text-[11.5px] text-ink-500">
        <Icon name="Info" className="w-3.5 h-3.5 mt-px shrink-0 text-ink-400" strokeWidth={2} />
        纯短信只有运营商送达结果，触达状态显示「不可获知」；只有短信摘要 + 安全链接与小程序报告才能记录打开与确认阅读。
        这不是数据缺失，是通道能力本身的差别。
      </p>

      {/* 发送轨迹抽屉：一条记录看一眼就回列表，不跳页 */}
      <SideSheet
        open={!!opened}
        onClose={() => setOpenId(null)}
        title={opened ? `发送轨迹 · ${opened.student?.name}` : ''}
        desc={opened ? opened.report?.title : ''}
        width="w-[400px]"
        footer={
          <>
            <Btn onClick={() => setOpenId(null)}>关闭</Btn>
            {opened && (
              <Btn tone="primary" icon="FileText" onClick={() => navigate(`/console/reports/${opened.reportId}`)}>
                打开报告
              </Btn>
            )}
          </>
        }
      >
        {opened && (
          <>
            <Field label="通道">{CHANNELS[opened.channel].label}</Field>
            <Field label="方式">{SEND_MODES[opened.mode].label}</Field>
            <Field label="接收人">
              {opened.recipient.name}（{opened.recipient.relation}｜{opened.recipient.phone}）
            </Field>
            <Field label="范围">{RECIPIENT_SCOPES[opened.scope].label}</Field>
            <Field label="发送状态">
              <StatusTag tone={SEND_STATES[opened.sendState].tone} dot>
                {SEND_STATES[opened.sendState].label}
              </StatusTag>
            </Field>
            <Field label="触达状态">
              <ReachCell record={opened} />
            </Field>
            {(deliveryDetail?.publicUrl || opened.publicUrl) && opened.channel === 'link' && (
              <Field label="摘要链接">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate text-[11.5px]">{deliveryDetail?.publicUrl || opened.publicUrl}</span>
                  <Btn size="sm" tone="plain" icon="Copy" onClick={copyPublicUrl}>复制地址</Btn>
                </div>
              </Field>
            )}
            {opened.fail && <Field label="失败原因">{opened.fail}</Field>}
            <Field label="重试次数">{opened.retries} 次</Field>

            <SubHead icon="Route" title="轨迹" className="mt-3" />
            <p className="text-[12.5px] text-ink-700 leading-relaxed bg-ink-50 border border-ink-150 rounded-lg px-3 py-2.5">
              {opened.trace}
            </p>
            <p className="text-[11.5px] text-ink-500 mt-2.5 leading-relaxed">
              发送记录不含学生原始对话；家长看到的是报告摘要页面，不能反向查看会话。
            </p>
          </>
        )}
      </SideSheet>

      <SideSheet
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        title="建立摘要链接联系人"
        desc="联系人只用于 summary_link 触达，具体链接地址由服务端发送任务返回。"
        width="w-[400px]"
        footer={
          <>
            <Btn onClick={() => setContactOpen(false)}>取消</Btn>
            <Btn tone="primary" disabled={!contact.studentId || !contact.displayName || !contact.destination || resource.mutationState.status === 'loading'} onClick={createContact}>建立联系人</Btn>
          </>
        }
      >
        <label className="block text-[11.5px] text-ink-500 mb-1">真实学生</label>
        <Select value={contact.studentId} onChange={(studentId) => setContact((value) => ({ ...value, studentId }))} options={[{ value: '', label: '选择真实学生' }, ...students.map((student) => ({ value: student.id, label: student.name }))]} width="w-full" />
        <label className="block text-[11.5px] text-ink-500 mt-3 mb-1">联系人姓名</label>
        <input className="console-input w-full" value={contact.displayName} onChange={(event) => setContact((value) => ({ ...value, displayName: event.target.value }))} />
        <label className="block text-[11.5px] text-ink-500 mt-3 mb-1">手机号</label>
        <input className="console-input w-full" inputMode="tel" value={contact.destination} onChange={(event) => setContact((value) => ({ ...value, destination: event.target.value }))} />
      </SideSheet>

      <SideSheet
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        title="排队发送"
        desc="只可选择已审核版本与同一学生的 summary_link 联系人，发送任务由服务端创建。"
        width="w-[400px]"
        footer={
          <>
            <Btn onClick={() => setQueueOpen(false)}>取消</Btn>
            <Btn tone="primary" disabled={!queue.reportId || !queue.parentContactId || resource.mutationState.status === 'loading'} onClick={queueDelivery}>建立发送任务</Btn>
          </>
        }
      >
        <label className="block text-[11.5px] text-ink-500 mb-1">已审核报告</label>
        <Select value={queue.reportId} onChange={(reportId) => setQueue((value) => ({ ...value, reportId }))} options={[{ value: '', label: '选择已审核报告' }, ...reports.filter((report) => report.status === 'ready').map((report) => ({ value: report.id, label: report.title }))]} width="w-full" />
        <label className="block text-[11.5px] text-ink-500 mt-3 mb-1">summary_link 联系人</label>
        <Select value={queue.parentContactId} onChange={(parentContactId) => setQueue((value) => ({ ...value, parentContactId }))} options={[{ value: '', label: '选择本次建立的联系人' }, ...contacts.filter((item) => item.studentId === reports.find((report) => report.id === queue.reportId)?.studentId).map((item) => ({ value: item.id, label: item.displayName }))]} width="w-full" />
      </SideSheet>

      <ConfirmModal
        open={!!ask}
        onClose={() => setAsk(null)}
        onConfirm={async () => {
          try {
            const processed = await resource.processDelivery(ask.id)
            setSessionDeliveries((items) => items.map((item) => item.id === ask.id ? {
              ...item,
              ...processed,
              sendState: processed.status === 'sent' ? 'success' : processed.status === 'processing' ? 'sending' : processed.status === 'failed' ? 'failed' : item.sendState,
            } : item))
            setAsk(null)
          } catch (error) {
            setActionError(error.message)
          }
        }}
        title="重试发送？"
        confirmText="重试"
        tone="primary"
        desc={
          ask
            ? `上次失败原因：${ask.fail || '未知'}。已重试 ${ask.retries} 次。若原因是号码问题，请先在学生详情里更正监护人号码，否则重试仍会失败。`
            : ''
        }
      />
    </PagePanel>
  )
}

// 触达状态单元格：不可回执的通道显示「不可获知」并说明原因，不假装是「未打开」
function ReachCell({ record }) {
  const ch = CHANNELS[record.channel]
  if (!ch.canTrack) {
    return (
      <span
        title="纯短信只能拿到运营商送达结果，无法获知家长是否打开"
        className="inline-flex items-center gap-1 text-[11.5px] text-ink-400"
      >
        <Icon name="EyeOff" className="w-3.5 h-3.5" strokeWidth={1.8} />
        不可获知
      </span>
    )
  }
  if (record.sendState !== 'success') {
    return <span className="text-[11.5px] text-ink-400">——</span>
  }
  const r = REACH_STATES[record.reach || 'unopened']
  return (
    <StatusTag tone={r.tone} dot>
      {r.label}
    </StatusTag>
  )
}

const METRIC_TONE = {
  brand: 'bg-brand-50 text-brand-600',
  cyan: 'bg-[#E4F5F2] text-[#2E8C86]',
  danger: 'bg-danger-50 text-danger-600',
  accent: 'bg-accent-50 text-accent-600',
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
