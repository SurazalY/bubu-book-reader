import { useEffect, useRef, useState } from 'react'
import { Icon, cx } from '../../../components/ui.jsx'
import { StatusTag } from '../../components/Controls.jsx'
import { TRUSTED, TRUSTED_STATE, ASSIST_DEMO_COUNTDOWN, ASSIST_TIMEOUT_LABEL } from '../../data/fixtures/me.js'

// 登录页的两个子视图（Plan_2 P3，Codex 第 82 轮拍板）：
//  · ForgotView —— 忘记密码：输账号 → 两条出路（管理员重置 / 走可信辅助账号）
//  · AssistView —— 教师辅助登录：输账号 → 选可信教师 → 发起请求 → 等待 → 同意／拒绝／超时
// 三条硬规则：
//  ① 超时即失败，绝不自动同意；
//  ② 可信人员只放行一次登录，不能代操作、看不到密码；
//  ③ 真实令牌、通知与一次性凭证签发属后端，这里只做可点击的壳。

// 与主视图同一套胶囊输入框样式（母版：无 label、只有 placeholder、边框极淡）
const fieldBase = 'console-field flex items-center gap-3.5 rounded-[24px] border px-6 h-16 transition backdrop-blur-sm'
const fieldIdle = 'border-white/75 bg-white/62 focus-within:border-brand-300/70 focus-within:bg-white/75'

// navigator.platform 会返回 Win32 这种技术串，不能直接给用户看；发给对方的设备
// 描述是对方判断要不要放行的主要依据，必须是人看得懂的话。
function readableDevice() {
  if (typeof navigator === 'undefined') return '本机浏览器'
  const ua = navigator.userAgent || ''
  const os = /Windows/i.test(ua)
    ? 'Windows'
    : /Android/i.test(ua)
      ? 'Android 平板'
      : /iPad|iPhone|iPod/i.test(ua)
        ? 'iPad / iPhone'
        : /Mac OS X/i.test(ua)
          ? 'macOS'
          : '其他设备'
  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /Chrome\//i.test(ua)
      ? 'Chrome'
      : /Firefox\//i.test(ua)
        ? 'Firefox'
        : /Safari\//i.test(ua)
          ? 'Safari'
          : '浏览器'
  return `${os} · ${browser}`
}

const SCHOOL_ADMIN_CONTACT = [
  ['学校管理员', '王主任 · 教务处'],
  ['校内内线', '8021'],
  ['邮箱', '未配置'],
  ['在岗时间', '工作日 08:00～17:00'],
]

const AVATAR_TONE = {
  brand: 'bg-brand-100 text-brand-700',
  cyan: 'bg-[#DCEFEC] text-[#2E8C86]',
  violet: 'bg-[#EAE4FA] text-[#6E5CD0]',
  muted: 'bg-ink-100 text-ink-500',
}

export function SubViewHead({ icon, title, desc, onBack }) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onBack}
        className="absolute left-0 top-1 inline-flex items-center gap-1 text-caption text-ink-500 hover:text-brand-600 transition"
      >
        <Icon name="ArrowLeft" className="w-4 h-4" strokeWidth={1.8} />
        返回登录
      </button>
      <div className="flex flex-col items-center text-center pt-9">
        <span className="w-12 h-12 rounded-2xl bg-white/70 border border-white/80 flex items-center justify-center">
          <Icon name={icon} className="w-6 h-6 text-brand-500" strokeWidth={1.7} />
        </span>
        <h2 className="font-serif text-[26px] leading-tight font-bold text-ink-900 mt-4">{title}</h2>
        <p className="text-caption text-ink-500 mt-2 max-w-[420px] leading-relaxed">{desc}</p>
      </div>
    </div>
  )
}

function AccountField({ value, onChange, placeholder = '账号 / 工号' }) {
  return (
    <div className={cx(fieldBase, fieldIdle)}>
      <Icon name="User" className="w-5 h-5 text-ink-400 shrink-0" strokeWidth={1.6} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="账号或工号"
        autoComplete="username"
        className="flex-1 bg-transparent text-base text-ink-800 placeholder:text-ink-400 outline-none"
      />
    </div>
  )
}

function BigBtn({ children, onClick, tone = 'primary', disabled, icon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'w-full h-14 rounded-[22px] inline-flex items-center justify-center gap-2 text-h2 font-semibold transition duration-220 ease-soft disabled:opacity-45 disabled:pointer-events-none',
        tone === 'primary'
          ? 'console-login-btn text-white hover:brightness-[1.04] active:scale-[0.995]'
          : 'border border-white/75 bg-white/62 text-ink-700 hover:bg-white/80',
      )}
    >
      {icon && <Icon name={icon} className="w-4.5 h-4.5" strokeWidth={1.8} />}
      {children}
    </button>
  )
}

// ── 忘记密码 ──────────────────────────────────────────────────────
export function ForgotView({ onBack, onGoAssist }) {
  const [account, setAccount] = useState('')
  const [showContact, setShowContact] = useState(false)
  const ready = account.trim().length > 0

  return (
    <>
      <SubViewHead
        icon="KeyRound"
        title="找回登录方式"
        desc="先确认是哪个账号，再选一条找回路径。前端壳不实现真实改密，真实环境会走学校管理员或可信辅助账号。"
        onBack={onBack}
      />

      <div className="mt-9">
        <AccountField value={account} onChange={setAccount} />
        {!ready && <p className="mt-2.5 pl-2 text-micro text-ink-400">先填账号或工号，下面两条路径才会启用。</p>}

        <div className="mt-6 space-y-3">
          <PathCard
            icon="UserRoundCheck"
            title="请可信辅助账号放行一次登录"
            desc="向你预设的同校可信教师或管理员发起请求，对方确认后签发一次性登录凭证；对方看不到你的密码，也不能代你操作。"
            action="选择可信人员"
            disabled={!ready}
            onClick={() => onGoAssist(account.trim())}
          />
          <PathCard
            icon="LifeBuoy"
            title="联系学校管理员重置密码"
            desc="管理员在组织账号里重置后，你下次登录需要设置新密码；重置动作会留一条变更审计。"
            action={showContact ? '收起联系方式' : '查看联系方式'}
            disabled={!ready}
            tone="plain"
            hint="演示环境不发起真实工单"
            onClick={() => setShowContact((v) => !v)}
          >
            {showContact && (
              <div className="mt-3 rounded-xl border border-white/80 bg-white/72 px-3.5 py-3">
                {SCHOOL_ADMIN_CONTACT.map(([k, v]) => (
                  <ReqRow key={k} label={k} value={v} />
                ))}
                <p className="mt-1.5 text-micro text-ink-400">以上为演示数据，真实环境会读学校配置的管理员信息。</p>
              </div>
            )}
          </PathCard>
        </div>
      </div>
    </>
  )
}

function PathCard({ icon, title, desc, action, onClick, disabled, tone = 'primary', hint, children }) {
  return (
    <div
      className={cx(
        'rounded-[22px] border px-5 py-4 transition',
        disabled ? 'border-white/55 bg-white/40 opacity-60' : 'border-white/75 bg-white/62',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl bg-white/75 border border-white/80 flex items-center justify-center shrink-0">
          <Icon name={icon} className="w-[18px] h-[18px] text-brand-500" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-ink-800">{title}</p>
          <p className="text-caption text-ink-500 leading-relaxed mt-1">{desc}</p>
          <div className="mt-3 flex items-center gap-2.5">
            <button
              type="button"
              disabled={disabled}
              onClick={onClick}
              className={cx(
                'h-9 px-4 rounded-full text-[12.5px] font-semibold transition disabled:pointer-events-none',
                tone === 'primary'
                  ? 'bg-brand-600 text-white hover:bg-brand-700'
                  : 'border border-ink-200 bg-white/80 text-ink-700 hover:border-ink-300',
              )}
            >
              {action}
            </button>
            {hint && <span className="text-micro text-ink-400">{hint}</span>}
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

// ── 教师辅助登录 ──────────────────────────────────────────────────
// step: account → pick → waiting → approved / rejected / expired
export function AssistView({ onBack, onApproved, presetAccount = '' }) {
  const [step, setStep] = useState(presetAccount ? 'pick' : 'account')
  const [account, setAccount] = useState(presetAccount)
  const [picked, setPicked] = useState(null)
  const [left, setLeft] = useState(ASSIST_DEMO_COUNTDOWN)
  const timer = useRef(null)

  // 等待态倒计时：走到 0 是「超时失效」，不是自动同意（拍板明确）
  useEffect(() => {
    if (step !== 'waiting') return undefined
    setLeft(ASSIST_DEMO_COUNTDOWN)
    timer.current = setInterval(() => {
      setLeft((v) => {
        if (v <= 1) {
          clearInterval(timer.current)
          setStep('expired')
          return 0
        }
        return v - 1
      })
    }, 1000)
    return () => clearInterval(timer.current)
  }, [step])

  const candidates = TRUSTED
  const device = readableDevice()
  const now = new Date().toLocaleString('zh-CN', { hour12: false, month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  if (step === 'account') {
    return (
      <>
        <SubViewHead
          icon="UserRoundCheck"
          title="教师辅助登录"
          desc="先确认要登录的账号，我们会列出这个账号预设的可信人员。可信人员只能放行一次登录，看不到你的密码。"
          onBack={onBack}
        />
        <div className="mt-9">
          <AccountField value={account} onChange={setAccount} />
          <div className="mt-6">
            <BigBtn icon="ArrowRight" disabled={!account.trim()} onClick={() => setStep('pick')}>
              下一步：选择可信人员
            </BigBtn>
          </div>
          <p className="mt-3 text-center text-micro text-ink-400">
            没有预设可信人员？请联系学校管理员重置密码。
          </p>
        </div>
      </>
    )
  }

  if (step === 'pick') {
    return (
      <>
        <SubViewHead
          icon="Users"
          title="选择一位可信人员"
          desc={`账号 ${account} 的可信辅助账号如下。选择后对方会收到一条确认请求，${ASSIST_TIMEOUT_LABEL}。`}
          onBack={onBack}
        />
        <ul className="mt-7 space-y-2.5">
          {candidates.map((t) => {
            const st = TRUSTED_STATE[t.state]
            const usable = t.state === 'active'
            const on = picked === t.id
            return (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={!usable}
                  onClick={() => setPicked(t.id)}
                  className={cx(
                    'w-full text-left rounded-[20px] border px-4 py-3 flex items-center gap-3 transition',
                    !usable
                      ? 'border-white/55 bg-white/40 opacity-60 cursor-not-allowed'
                      : on
                        ? 'border-brand-300 bg-white/85 ring-2 ring-brand-200'
                        : 'border-white/75 bg-white/62 hover:bg-white/78',
                  )}
                >
                  <span
                    className={cx(
                      'w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-semibold shrink-0',
                      AVATAR_TONE[t.tone] || AVATAR_TONE.muted,
                    )}
                  >
                    {t.initial}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[13.5px] font-semibold text-ink-800">{t.name}</span>
                      <StatusTag tone={st.tone} dot>
                        {st.label}
                      </StatusTag>
                    </span>
                    <span className="block text-micro text-ink-500 mt-0.5 truncate">
                      {t.duty} · {t.school}
                    </span>
                    {!usable && <span className="block text-micro text-warning-600 mt-0.5">{t.disabledNote || st.note}</span>}
                  </span>
                  {on && <Icon name="Check" className="w-4 h-4 text-brand-600 shrink-0" strokeWidth={2.4} />}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="mt-6">
          <BigBtn icon="Send" disabled={!picked} onClick={() => setStep('waiting')}>
            发起辅助登录请求
          </BigBtn>
        </div>
        <p className="mt-3 text-center text-micro text-ink-400">
          对方会看到你的账号、设备与发起时间，必须明确确认才会放行。
        </p>
      </>
    )
  }

  const who = candidates.find((t) => t.id === picked)

  if (step === 'waiting') {
    const mm = String(Math.floor(left / 60)).padStart(2, '0')
    const ss = String(left % 60).padStart(2, '0')
    return (
      <>
        <SubViewHead
          icon="Hourglass"
          title="等待对方确认"
          desc={`请求已发给 ${who?.name}。对方在自己的界面上会收到一条小窗提醒，确认后你才能登录一次。`}
          onBack={onBack}
        />
        <div className="mt-7 rounded-[22px] border border-white/75 bg-white/62 px-5 py-4">
          <ReqRow label="申请账号" value={account} />
          <ReqRow label="发起设备" value={device} />
          <ReqRow label="发起时间" value={now} />
          <ReqRow label="放行人" value={`${who?.name} · ${who?.duty}`} />
        </div>
        <div className="mt-5 flex items-center justify-center gap-2.5">
          <Icon name="Timer" className="w-4 h-4 text-brand-500" strokeWidth={1.8} />
          <span className="text-h2 font-semibold text-ink-800 tabular-nums">
            {mm}:{ss}
          </span>
          <span className="text-caption text-ink-500">后自动失效</span>
        </div>
        <p className="mt-2 text-center text-micro text-warning-600">超时不会自动放行，只会失效并需要重新发起。</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <BigBtn tone="plain" onClick={() => setStep('pick')}>
            换一位可信人员
          </BigBtn>
          <BigBtn tone="plain" onClick={onBack}>
            取消请求
          </BigBtn>
        </div>
        {/* 壳阶段没有真实推送：这一行让验收可以走完三种结局 */}
        <div className="mt-6 pt-4 border-t border-white/70">
          <p className="text-micro text-ink-400 text-center mb-2.5">壳演示：模拟对方的处理结果</p>
          <div className="flex items-center justify-center gap-2">
            <MiniBtn onClick={() => setStep('approved')}>对方同意</MiniBtn>
            <MiniBtn onClick={() => setStep('rejected')}>对方拒绝</MiniBtn>
            <MiniBtn onClick={() => setStep('expired')}>直接超时</MiniBtn>
          </div>
        </div>
      </>
    )
  }

  const results = {
    approved: {
      icon: 'ShieldCheck',
      title: '已放行一次登录',
      tone: 'text-[#2E8C86]',
      desc: `${who?.name} 已确认你的身份。本次是一次性登录，进入后请尽快在个人主页修改密码；这次辅助登录会记进你的登录记录。`,
      primary: { label: '进入控制台', action: onApproved, icon: 'ArrowRight' },
    },
    rejected: {
      icon: 'ShieldX',
      title: '对方拒绝了这次请求',
      tone: 'text-danger-600',
      desc: '可能是对方不确认这台设备。可以换一位可信人员，或联系学校管理员重置密码。',
      primary: { label: '换一位可信人员', action: () => setStep('pick'), icon: 'RotateCcw' },
    },
    expired: {
      icon: 'TimerOff',
      title: '请求已超时失效',
      tone: 'text-ink-500',
      desc: '没有人在有效期内确认，请求自动失效 —— 系统不会因为超时就放行。可以重新发起，或联系学校管理员。',
      primary: { label: '重新发起请求', action: () => setStep('pick'), icon: 'RotateCcw' },
    },
  }
  const r = results[step]

  return (
    <>
      <SubViewHead icon={r.icon} title={r.title} desc={r.desc} onBack={onBack} />
      <div className="mt-7 rounded-[22px] border border-white/75 bg-white/62 px-5 py-4">
        <ReqRow label="申请账号" value={account} />
        <ReqRow label="放行人" value={who ? `${who.name} · ${who.duty}` : '——'} />
        <ReqRow label="处理结果" value={r.title} valueClass={r.tone} />
      </div>
      <div className="mt-6">
        <BigBtn icon={r.primary.icon} onClick={r.primary.action}>
          {r.primary.label}
        </BigBtn>
      </div>
    </>
  )
}

function ReqRow({ label, value, valueClass }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <span className="w-[68px] shrink-0 text-micro text-ink-400">{label}</span>
      <span className={cx('text-caption font-medium break-all', valueClass || 'text-ink-800')}>{value}</span>
    </div>
  )
}

function MiniBtn({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-7 px-3 rounded-full border border-ink-200 bg-white/80 text-micro text-ink-600 hover:border-brand-300 hover:text-brand-600 transition"
    >
      {children}
    </button>
  )
}
