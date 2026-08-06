import { useState } from 'react'
import { Link } from 'react-router-dom'
import { cx, Icon } from '../../components/ui.jsx'
import { GlassCard, GlassPanel } from '../components/Glass.jsx'
import PageHead from '../components/PageHead.jsx'
import { useStudent } from '../state/StudentContext.jsx'
import useEyeCarePrivacy from '../state/useEyeCarePrivacy.js'

// 教师交互（规格 §10.5 + §7.5）：通知、书目安排、审核结果、私密会话访问申请与访问记录。
// 红线 8：这一页不出现任何安全事件、报警或风险等级——学生看到的只有老师主动发起的事。
const TABS = [
  { key: 'notices', label: '通知与安排', icon: 'Bell' },
  { key: 'requests', label: '访问申请', icon: 'ShieldQuestion' },
  { key: 'logs', label: '访问记录', icon: 'History' },
]

const STATE_TEXT = {
  approved: { text: '你已同意', tone: 'text-[#2C8B76]', icon: 'Check' },
  denied: { text: '你已拒绝', tone: 'text-ink-500', icon: 'X' },
  timeout_auto_approved: { text: '已按超时规则授权', tone: 'text-ink-500', icon: 'Clock' },
  student_approved: { text: '你已同意授权', tone: 'text-[#2C8B76]', icon: 'Check' },
}

const PRIVACY_RULES = [
  '普通私密对话需要先征得你的同意，学校老师不能直接查看。',
  '授权只在规定时间内有效，谁在何时因何查看都会留下访问记录。',
  '安全标记会话只会按用途开放最小上下文，不在这里展示安全事件详情。',
]

function formatTime(value) {
  if (!value || Number.isNaN(Date.parse(value))) return '时间信息暂不可用'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

export default function TeacherHub() {
  const { runtime } = useStudent()
  const workspaceId = runtime.data?.workspaceId
  const privacy = useEyeCarePrivacy({ workspaceId })
  const [tab, setTab] = useState('notices')
  const [feedback, setFeedback] = useState(null)
  const requests = privacy.data?.requests || []
  const pending = requests.filter((request) => request.status === 'pending')
  const answered = requests.filter((request) => request.status !== 'pending')
  const logs = privacy.data?.accessHistory || []
  const decisionBusy = privacy.decisionState.status === 'loading'
  const errorText = privacy.decisionState.error?.message || privacy.error?.message
  const respond = async (requestId, decision) => {
    setFeedback(null)
    try {
      await privacy.resolveRequest(requestId, decision)
      setFeedback(decision === 'approved' ? '已同意这一次访问申请。' : '已拒绝这一次访问申请。')
    } catch (error) {
      setFeedback(error?.message || '处理申请失败，请稍后重试。')
    }
  }

  return (
    <div className="flex-1 space-y-4">
      <PageHead
        title="教师交互"
        desc="老师的通知、书目安排、投稿结果，以及老师想看你私密对话时的申请，都在这里。"
      >
        <div className="student-segment inline-flex rounded-full p-1">
          {TABS.map((t) => {
            const count = t.key === 'requests' ? pending.length : 0
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-pressed={tab === t.key}
                className={cx(
                  'flex items-center gap-1.5 rounded-full px-4 py-2 text-caption transition',
                  tab === t.key ? 'student-segment--on font-semibold text-ink-900' : 'text-ink-500 hover:text-ink-800',
                )}
              >
                <Icon name={t.icon} className="h-4 w-4" />
                {t.label}
                {count > 0 && <span className="student-badge tabular-nums">{count}</span>}
              </button>
            )
          })}
        </div>
      </PageHead>

      {(feedback || errorText) && (
        <div className="student-enter flex items-center justify-between gap-3 rounded-xl bg-white/82 px-4 py-3">
          <span className="flex items-center gap-2 text-caption text-ink-700">
            <Icon name="Check" className="h-4 w-4 text-[#2C8B76]" />
            {feedback || errorText}
          </span>
          <button type="button" onClick={() => setFeedback(null)} className="text-micro text-ink-400 hover:text-ink-700">
            知道了
          </button>
        </div>
      )}

      {tab === 'notices' && (
        <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-serif text-h3 font-bold text-ink-900">
              通知与安排
              <span className="ml-2 text-caption font-normal text-ink-500 tabular-nums">
                独立通知流暂未开放
              </span>
            </h2>
          </div>
          <div className="mt-4 rounded-xl bg-white/58 px-6 py-8 text-center">
            <p className="text-title font-semibold text-ink-800">暂时没有可展示的通知</p>
            <p className="mt-1.5 text-caption text-ink-500">阅读安排会直接出现在书架，私密访问申请会显示在「访问申请」中。</p>
            <Link to="/student/shelf" className="mt-3 inline-flex rounded-full border border-white/70 bg-white/78 px-3.5 py-1.5 text-micro font-semibold text-ink-700 transition hover:bg-white">
              去书架查看安排
            </Link>
          </div>
        </GlassPanel>
      )}

      {tab === 'requests' && (
        <div className="space-y-4">
          <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
            <h2 className="font-serif text-h3 font-bold text-ink-900">
              等你决定
              <span className="ml-2 text-caption font-normal text-ink-500 tabular-nums">{pending.length} 条</span>
            </h2>

            {pending.length ? (
              <ul className="mt-4 space-y-3">
                {pending.map((r, i) => (
                  <li key={r.id} className="student-stagger rounded-xl bg-white/70 px-4 py-4" style={{ '--i': i }}>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-title font-semibold text-ink-900">
                        {r.requesterDisplayName || '一位老师'}想看你的一个私密对话
                      </span>
                      <span className="text-micro text-ink-400">
                        申请于 {formatTime(r.createdAt)}
                      </span>
                    </div>
                    <dl className="mt-2.5 grid gap-1.5 text-caption text-ink-600 sm:grid-cols-2">
                      <Field label="想看哪一个" value="一段私密对话" />
                      <Field label="为什么要看" value={r.purpose} />
                      <Field label="申请时间" value={formatTime(r.createdAt)} />
                      <Field label="什么时候过期" value={formatTime(r.expiresAt)} />
                    </dl>
                    <p className="mt-2 text-micro text-ink-400">超时后将按学校隐私规则处理，并在访问记录中保留结果。</p>
                    <div className="mt-3.5 flex flex-wrap gap-2.5">
                      <button
                        type="button"
                        onClick={() => respond(r.id, 'approved')}
                        disabled={decisionBusy}
                        className="student-btn-primary rounded-full px-5 py-2 text-caption font-semibold"
                      >
                        同意这一次
                      </button>
                      <button
                        type="button"
                        onClick={() => respond(r.id, 'denied')}
                        disabled={decisionBusy}
                        className="rounded-full border border-white/70 bg-white/72 px-5 py-2 text-caption font-semibold text-ink-700 transition hover:bg-white"
                      >
                        拒绝
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-4 rounded-xl bg-white/58 px-6 py-8 text-center">
                <p className="text-title font-semibold text-ink-800">没有等你处理的申请</p>
                <p className="mt-1.5 text-caption text-ink-500">老师想看你的私密对话时会先来问你。</p>
              </div>
            )}
          </GlassPanel>

          <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
            <h2 className="font-serif text-h3 font-bold text-ink-900">私密对话的规则</h2>
            <ul className="mt-3 space-y-1.5">
              {PRIVACY_RULES.map((t) => (
                <li key={t} className="flex gap-2 text-caption leading-relaxed text-ink-600">
                  <Icon name="Dot" className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                  {t}
                </li>
              ))}
            </ul>
            {answered.length > 0 && (
              <p className="mt-3 text-micro text-ink-400">
                已处理 {answered.length} 条申请，结果都记在「访问记录」里。
              </p>
            )}
          </GlassPanel>
        </div>
      )}

      {tab === 'logs' && (
        <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
          <h2 className="font-serif text-h3 font-bold text-ink-900">访问记录</h2>
          <p className="mt-1.5 text-caption text-ink-500">
            谁、什么时候、因为什么看过你的哪一个对话，都留在这里，随时可以回看。
          </p>
          <ul className="mt-4 space-y-2.5">
            {logs.map((l, i) => {
              const s = STATE_TEXT[l.accessMode] || STATE_TEXT.student_approved
              return (
                <li key={l.id} className="student-stagger" style={{ '--i': i }}>
                  <GlassCard className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 px-4 py-3.5">
                    <span className="text-title font-semibold text-ink-900">{l.viewerDisplayName || '一位已授权老师'}</span>
                    <span className={cx('flex items-center gap-1 text-micro font-semibold', s.tone)}>
                      <Icon name={s.icon} className="h-3.5 w-3.5" />
                      {s.text}
                    </span>
                    <span className="text-micro text-ink-400">{formatTime(l.accessedAt)}</span>
                    <span className="w-full text-caption text-ink-600">
                      一段私密对话 · 用途：{l.purpose}
                    </span>
                  </GlassCard>
                </li>
              )
            })}
          </ul>
        </GlassPanel>
      )}
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-ink-400">{label}</dt>
      <dd className="min-w-0 text-ink-700">{value}</dd>
    </div>
  )
}
