import { useEffect, useRef, useState } from 'react'
import { Icon, cx } from '../../components/ui.jsx'
import { Btn } from './Controls.jsx'
import { useConsole } from '../state/ConsoleContext.jsx'
import { ASSIST_DEMO_COUNTDOWN, ASSIST_TIMEOUT_LABEL } from '../data/fixtures/me.js'

// 收到的辅助登录请求 · 全局小窗（Plan_2 P3，Codex 第 82 轮）
// 拍板要点：对方确认不能只藏在个人主页 —— 被请求的人登录后就要看到这个小窗，
// 可以就地同意或拒绝；也可以「稍后处理」，请求仍留在个人主页列表里。
// 超时只会失效，绝不自动同意。
export default function AssistRequestToast() {
  const { assistRequests, answerAssistRequest, assistToastHidden, hideAssistToast, prefs } = useConsole()
  const pending = assistRequests.find((r) => r.state === 'pending')
  const [left, setLeft] = useState(ASSIST_DEMO_COUNTDOWN)
  const timer = useRef(null)

  useEffect(() => {
    if (!pending || assistToastHidden) return undefined
    setLeft(ASSIST_DEMO_COUNTDOWN)
    timer.current = setInterval(() => {
      setLeft((v) => {
        if (v <= 1) {
          clearInterval(timer.current)
          // 到点只标记失效，不代替任何人同意
          answerAssistRequest(pending.id, 'expired')
          return 0
        }
        return v - 1
      })
    }, 1000)
    return () => clearInterval(timer.current)
  }, [pending, assistToastHidden, answerAssistRequest])

  if (!pending || assistToastHidden) return null

  const mm = String(Math.floor(left / 60)).padStart(2, '0')
  const ss = String(left % 60).padStart(2, '0')

  return (
    <div
      className={cx(
        'fixed bottom-5 right-6 z-40 w-[352px] rounded-2xl border border-white/80 bg-white/92 shadow-e3 backdrop-blur-xl p-4',
        !prefs.reduceMotion && 'console-enter',
      )}
      role="alertdialog"
      aria-label="收到辅助登录请求"
    >
      <div className="flex items-start gap-2.5">
        <span className="w-8 h-8 rounded-xl bg-warning-50 text-warning-600 flex items-center justify-center shrink-0">
          <Icon name="UserRoundCheck" className="w-[17px] h-[17px]" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ink-900">收到辅助登录请求</p>
          <p className="text-[11.5px] text-ink-500 mt-0.5">
            确认后只放行<span className="font-semibold text-ink-700">一次</span>登录，对方看不到你的密码，也不能代你操作。
          </p>
        </div>
        <button
          type="button"
          onClick={hideAssistToast}
          className="p-1 rounded-lg text-ink-400 hover:text-ink-700 hover:bg-ink-50 transition shrink-0"
          aria-label="稍后处理"
        >
          <Icon name="X" className="w-4 h-4" strokeWidth={1.9} />
        </button>
      </div>

      <div className="mt-3 rounded-xl border border-ink-150 bg-white/70 px-3 py-2.5 space-y-1">
        <Row label="申请账号" value={pending.account} />
        <Row label="申请人" value={`${pending.name} · ${pending.duty}`} />
        <Row label="设备" value={pending.device} />
        <Row label="发起时间" value={pending.at} />
      </div>

      <div className="mt-2.5 flex items-center gap-1.5 text-[11.5px]">
        <Icon name="Timer" className="w-3.5 h-3.5 text-brand-500 shrink-0" strokeWidth={1.9} />
        <span className="text-ink-700 font-semibold tabular-nums">
          {mm}:{ss}
        </span>
        <span className="text-ink-500">后自动失效</span>
        <span className="text-ink-300">·</span>
        <span className="text-ink-400">{ASSIST_TIMEOUT_LABEL}</span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Btn tone="primary" size="sm" icon="Check" onClick={() => answerAssistRequest(pending.id, 'approved')}>
          同意放行一次
        </Btn>
        <Btn tone="danger" size="sm" icon="X" onClick={() => answerAssistRequest(pending.id, 'rejected')}>
          拒绝
        </Btn>
        <div className="flex-1" />
        <Btn tone="ghost" size="sm" onClick={hideAssistToast}>
          稍后处理
        </Btn>
      </div>
      <p className="mt-2 text-[11px] text-ink-400">
        不确认这台设备就直接拒绝；无人处理时请求只会超时失效，不会自动放行。
      </p>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="w-[56px] shrink-0 text-[11px] text-ink-400">{label}</span>
      <span className="text-[11.5px] text-ink-800 break-all">{value}</span>
    </div>
  )
}
