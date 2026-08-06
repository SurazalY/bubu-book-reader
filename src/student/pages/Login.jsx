import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createAuthApi } from '../../api/auth.js'
import { RuntimeIcon as Icon } from '../../shared/RuntimeIcon.jsx'
import { cx } from '../../shared/cx.js'
import { GlassPanel } from '../components/Glass.jsx'
import { BrandMark, DiamondRule } from '../components/BrandMark.jsx'

const FIELD =
  'student-field h-16 w-full rounded-[24px] border border-white/70 bg-white/55 px-14 text-title text-ink-800 placeholder:text-ink-400 outline-none transition focus:border-white/90 focus:bg-white/70'

const STATES = {
  normal: { icon: 'Wifi', text: '网络连接正常', tone: 'text-[#3E9E8F]', textTone: 'text-ink-500' },
  error: { icon: 'CircleAlert', text: '登录没有成功，请查看提示', tone: 'text-[#D0492F]', textTone: 'text-[#D0492F]' },
  locked: { icon: 'ShieldAlert', text: '这个账号暂时不能登录', tone: 'text-[#D0492F]', textTone: 'text-[#D0492F]' },
}

const authApi = createAuthApi()

export default function Login() {
  const nav = useNavigate()
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [status, setStatus] = useState('normal')
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function clearFeedback() {
    setStatus('normal')
    setFeedback('')
  }

  async function submit(event) {
    event.preventDefault()
    const username = account.trim()
    if (!username || !password) {
      setStatus('error')
      setFeedback('请输入账号和密码')
      return
    }
    setSubmitting(true)
    try {
      const response = await authApi.login(username, password)
      const destination = response.data?.navigation?.defaultPath
      if (!destination) throw new Error('当前账号没有可用的读伴入口，请联系学校管理员')
      clearFeedback()
      nav(destination, { replace: true })
    } catch (cause) {
      setStatus(cause?.code === 'ACCOUNT_RESTRICTED' ? 'locked' : 'error')
      setFeedback(cause?.message || '登录服务暂不可用，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const state = STATES[status]

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-10">
      <GlassPanel
        tone="crystal"
        sheen
        className="student-crystal-card student-enter w-[620px] max-w-full rounded-[40px] px-12 py-11"
      >
        <div className="flex justify-center">
          <BrandMark size={30} textClass="text-h2" />
        </div>

        <h1 className="mt-7 text-center font-serif text-[40px] font-bold leading-tight text-ink-900 tracking-[0.16em]">
          欢迎回来
        </h1>
        <DiamondRule className="mt-4" />

        <form className="mt-9 space-y-4" onSubmit={submit}>
          <div className="relative">
            <Icon name="User" className="pointer-events-none absolute left-6 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-400" />
            <input
              className={FIELD}
              placeholder="账号 / 学号"
              aria-label="账号或学号"
              value={account}
              onChange={(event) => {
                setAccount(event.target.value)
                clearFeedback()
              }}
              autoComplete="username"
            />
          </div>
          <div className="relative">
            <Icon name="Lock" className="pointer-events-none absolute left-6 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-400" />
            <input
              className={FIELD}
              type={showPwd ? 'text' : 'password'}
              placeholder="密码"
              aria-label="密码"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                clearFeedback()
              }}
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPwd((visible) => !visible)}
              aria-label={showPwd ? '隐藏密码' : '显示密码'}
              className="absolute right-6 top-1/2 -translate-y-1/2 text-ink-400 transition hover:text-ink-600"
            >
              <Icon name={showPwd ? 'Eye' : 'EyeOff'} className="h-[18px] w-[18px]" />
            </button>
          </div>

          {feedback && (
            <p className="flex items-center gap-2 pl-2 text-caption text-[#D0492F]">
              <Icon name="CircleAlert" className="h-4 w-4" />
              {feedback}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="student-primary-btn h-16 w-full rounded-[24px] text-title font-semibold text-white disabled:opacity-60"
          >
            {submitting ? '正在登录…' : '登录'}
          </button>
        </form>

        <div className="mt-5 flex items-center justify-between text-caption">
          <button
            type="button"
            onClick={() => {
              setStatus('normal')
              setFeedback('请联系班主任或学校管理员重置密码')
            }}
            className="text-ink-500 transition hover:text-ink-800"
          >
            忘记密码
          </button>
          <span className="h-4 w-px bg-ink-200" />
          <button
            type="button"
            onClick={() => {
              setStatus('normal')
              setFeedback('教师辅助登录尚未开放，请使用学校账号或联系班主任')
            }}
            className="font-semibold text-[#3E9E8F] transition hover:text-[#2F8375]"
          >
            老师帮我登录
          </button>
        </div>

        <div className="mt-8 flex items-stretch overflow-hidden rounded-[18px] border border-white/60 bg-white/50 text-caption text-ink-500" role="status">
          <span className={cx('flex flex-1 items-center justify-center gap-2 px-4 py-3', state.textTone)}>
            <Icon name={state.icon} className={cx('h-4 w-4', state.tone)} />
            {state.text}
          </span>
          <span className="w-px bg-white/70" />
          <span className="flex flex-1 items-center justify-center gap-2 px-4 py-3">
            <Icon name="Headphones" className="h-4 w-4 text-ink-400" />
            遇到问题请找班主任
          </span>
        </div>
      </GlassPanel>
    </div>
  )
}
