import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cx, Icon } from '../../../components/ui.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, EmptyState, SearchBox, StatusTag, SubHead, Tabs } from '../../components/Controls.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import usePrivacyEyeCareData from '../../state/usePrivacyEyeCareData.js'

const APPLY_KIND = {
  view: { label: '查看申请', tone: 'violet', icon: 'Eye' },
}

const APPLY_STATE = {
  pending: { label: '等待学生处理', tone: 'warning' },
  approved: { label: '学生已同意', tone: 'success' },
  denied: { label: '学生已拒绝', tone: 'danger' },
  expired: { label: '申请已过期', tone: 'muted' },
}

// 隐私访问：三页签在顶部切换。三条硬要求：
// 1）原文页显示查看者与时间水印（在学生会话页实现，这里给出留痕记录）
// 2）禁止批量导出全班原始会话 —— 导出按钮置灰并说明原因，不是只写一句提示
// 3）访问记录可按人员、学生、时间与用途查询

const TONE_ICON = {
  violet: 'bg-[#F0ECFB] text-[#7C6BD8]',
  danger: 'bg-danger-50 text-danger-600',
  muted: 'bg-ink-100 text-ink-500',
}

// 会话标题：私密会话在任何列表里都只显示「私密会话 #编号」
function titleOf(sessionId) {
  if (!sessionId) return '未指定具体会话（按学生范围申请）'
  return `会话 #${String(sessionId).slice(-4)}`
}

export default function Privacy() {
  const { workspace } = useConsole()
  const navigate = useNavigate()
  const privacy = usePrivacyEyeCareData({ workspaceId: workspace?.id })
  const data = useMemo(() => normalizePrivacyData(privacy.data), [privacy.data])
  const [tab, setTab] = useState('pending')
  const [keyword, setKeyword] = useState('')

  const k = keyword.trim()
  const match = (parts) => !k || parts.filter(Boolean).some((p) => p.includes(k))

  const pending = data.pending.filter((a) =>
    match([a.applicant, a.studentName, a.purpose, titleOf(a.sessionId)]),
  )
  const mine = data.mine.filter((a) => match([a.studentName, a.purpose, titleOf(a.sessionId)]))
  const history = data.history.filter((h) =>
    match([h.viewer, h.role, h.studentName, h.purpose, h.need, h.at]),
  )

  return (
    <PagePanel
      title={`${workspace?.scopeLabel || '当前工作空间'} · 隐私访问`}
      desc="普通会话在授权范围内可直接查看并自动留痕；私密会话必须申请；被安全标记后按安全规则填写用途查看。涉事人员一律不得访问。"
      toolbar={
        <>
          <SearchBox
            value={keyword}
            onChange={setKeyword}
            placeholder="按人员、学生、用途或时间查询"
            width="w-[230px]"
          />
          {/* 禁止批量导出：按钮保留但置灰，并把原因说清楚 */}
          <span title="按隐私规则，禁止批量导出全班原始会话；单条查看会留痕，导出不开放。">
            <Btn icon="Download" disabled>
              批量导出
            </Btn>
          </span>
        </>
      }
    >
      <div className="flex items-start gap-2.5 mb-3.5 px-3.5 py-2.5 rounded-xl bg-ink-50 border border-ink-150">
        <Icon name="ShieldCheck" className="w-4 h-4 text-[#3E9E8F] mt-px shrink-0" strokeWidth={1.9} />
        <p className="text-[12px] text-ink-600 leading-relaxed">
          <b className="text-ink-800">禁止批量导出全班原始会话。</b>
          单条会话可以在留痕前提下查看，原文页会显示查看者与时间水印；导出、转发与截图外发都不在产品能力范围内。
        </p>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: 'pending', label: '待处理申请', count: data.pending.length },
          { key: 'mine', label: '我的申请', count: data.mine.length },
          { key: 'history', label: '访问历史', count: data.history.length },
        ]}
        className="mb-3.5"
      />

      {tab === 'pending' &&
        (pending.length === 0 ? (
          <EmptyState
            icon="Inbox"
            title="没有需要你处理的申请"
            desc={
              privacy.status === 'loading'
                ? '正在读取真实隐私申请。'
                : privacy.error?.message || (data.pending.length === 0
                ? '当前工作空间没有班级关系，也就不会收到查看私密会话的申请。'
                : '换一个关键词试试。')
            }
          />
        ) : (
          <div className="space-y-2.5">
            {pending.map((a) => {
              const kind = APPLY_KIND[a.kind]
              const overdue = a.deadline.includes('超时')
              return (
                <div
                  key={a.id}
                  className="rounded-xl border border-ink-150 bg-white/70 px-3.5 py-3 flex items-start gap-3"
                >
                  <span
                    className={cx('w-8 h-8 rounded-xl flex items-center justify-center shrink-0', TONE_ICON[kind.tone])}
                  >
                    <Icon name={kind.icon} className="w-4 h-4" strokeWidth={1.9} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold text-ink-900">{a.applicant}</span>
                      <span className="text-[11.5px] text-ink-400">{a.applicantRole}</span>
                      <StatusTag tone={kind.tone}>{kind.label}</StatusTag>
                      <StatusTag tone={overdue ? 'danger' : 'warning'} dot>
                        {a.deadline}
                      </StatusTag>
                    </div>
                    <p className="text-[12.5px] text-ink-700 mt-1.5 leading-relaxed">
                      对象：{a.studentName}（{titleOf(a.sessionId)}）
                    </p>
                    <p className="text-[12px] text-ink-500 mt-1 leading-relaxed">用途：{a.purpose}</p>
                    <p className="text-[11px] text-ink-400 mt-1">提交于 {a.at}</p>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <span title="私密会话申请只能由学生端同意或拒绝；权限端仅展示真实申请状态。">
                      <Btn size="sm" tone="primary" disabled>
                        由学生端处理
                      </Btn>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        ))}

      {tab === 'mine' &&
        (mine.length === 0 ? (
          <EmptyState icon="Send" title="你还没有发起过申请" desc="在学生会话页遇到私密会话时，可以从那里发起查看申请。" />
        ) : (
          <div className="rounded-xl border border-ink-150 overflow-hidden bg-white/60">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-ink-50/70 text-[11.5px] text-ink-500">
                  <th className="px-3 py-2.5 font-medium w-[150px]">对象</th>
                  <th className="px-2 py-2.5 font-medium">会话与用途</th>
                  <th className="px-2 py-2.5 font-medium w-[126px]">类型</th>
                  <th className="px-2 py-2.5 font-medium w-[118px]">状态</th>
                  <th className="px-2 py-2.5 font-medium w-[126px]">提交 / 回应</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((a) => {
                  const kind = APPLY_KIND[a.kind]
                  const st = APPLY_STATE[a.state] || APPLY_STATE.pending
                  return (
                    <tr key={a.id} className="border-t border-ink-150/70 hover:bg-white/70 transition">
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => navigate(`/console/accounts/students/${a.studentId}`)}
                          className="text-[13px] font-medium text-ink-900 hover:text-brand-600 transition"
                        >
                          {a.studentName}
                        </button>
                      </td>
                      <td className="px-2 py-2.5">
                        <p className="text-[12.5px] text-ink-700">{titleOf(a.sessionId)}</p>
                        <p className="text-[11.5px] text-ink-500 mt-0.5">{a.purpose}</p>
                      </td>
                      <td className="px-2 py-2.5">
                        <StatusTag tone={kind.tone}>{kind.label}</StatusTag>
                      </td>
                      <td className="px-2 py-2.5">
                        <StatusTag tone={st.tone} dot>
                          {st.label}
                        </StatusTag>
                      </td>
                      <td className="px-2 py-2.5 text-[11.5px] text-ink-500">
                        <p>{a.at}</p>
                        {a.respondedAt && <p className="text-ink-400 mt-0.5">{a.respondedAt}</p>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}

      {tab === 'history' &&
        (history.length === 0 ? (
          <EmptyState icon="History" title="没有访问记录" desc="当前范围内还没有人查看过学生会话原文。" />
        ) : (
          <>
            <SubHead
              icon="History"
              title="访问留痕"
              extra={<span className="text-[11.5px] text-ink-400">支持按人员、学生、时间与用途查询</span>}
            />
            <ol className="relative pl-4">
              <span className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-ink-150" aria-hidden="true" />
              {history.map((h) => {
                return (
                  <li key={h.id} className="relative pb-3.5 last:pb-0">
                    <span className="absolute -left-4 top-[7px] w-[11px] h-[11px] rounded-full bg-white border-2 border-brand-300" />
                    <div className="rounded-xl border border-ink-150 bg-white/70 px-3.5 py-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-ink-900">{h.viewer}</span>
                        <span className="text-[11.5px] text-ink-400">{h.role}</span>
                        <div className="flex-1" />
                        <span className="text-[11.5px] text-ink-400 tabular-nums">{h.at}</span>
                      </div>
                      <p className="text-[12.5px] text-ink-700 mt-1.5">
                        查看了 <b className="font-semibold">{h.studentName}</b> 的「{titleOf(h.sessionId)}」
                      </p>
                      <div className="flex items-start gap-2 mt-1.5 flex-wrap">
                        <StatusTag tone="muted">{h.need}</StatusTag>
                        {h.sessionId && (
                          <Btn
                            size="sm"
                            tone="ghost"
                            icon="ArrowRight"
                            onClick={() => navigate('/console/usage/sessions')}
                          >
                            打开会话
                          </Btn>
                        )}
                      </div>
                      <p className="text-[12px] text-ink-500 mt-1.5 leading-relaxed">用途：{h.purpose}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
          </>
        ))}

    </PagePanel>
  )
}

function normalizePrivacyData(payload) {
  const requests = Array.isArray(payload?.requests) ? payload.requests : []
  const accessHistory = Array.isArray(payload?.accessHistory) ? payload.accessHistory : []
  return {
    pending: requests.filter((request) => request.requesterDisplayName && !request.ownerDisplayName).map((request) => ({
      id: request.id,
      applicant: request.requesterDisplayName,
      applicantRole: '教师或学校管理员',
      studentId: request.ownerUserId || '',
      studentName: request.ownerDisplayName || '当前学生',
      sessionId: request.conversationId,
      purpose: request.purpose,
      kind: 'view',
      state: request.status,
      deadline: request.expiresAt ? `截止 ${formatDateTime(request.expiresAt)}` : '未设置超时',
      at: formatDateTime(request.createdAt),
    })),
    mine: requests.filter((request) => request.ownerDisplayName || !request.requesterDisplayName).map((request) => ({
      id: request.id,
      studentId: request.ownerUserId || '',
      studentName: request.ownerDisplayName || '当前学生',
      sessionId: request.conversationId,
      purpose: request.purpose,
      kind: 'view',
      state: request.status,
      at: formatDateTime(request.createdAt),
      respondedAt: formatDateTime(request.resolvedAt),
    })),
    history: accessHistory.map((item) => ({
      id: item.id,
      viewer: item.viewerDisplayName || '当前查看人',
      role: '授权范围内查看',
      studentId: item.ownerUserId || '',
      studentName: item.ownerDisplayName || '当前学生',
      sessionId: item.conversationId,
      purpose: item.purpose,
      need: item.accessMode || '已授权',
      at: formatDateTime(item.accessedAt),
    })),
  }
}

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}
