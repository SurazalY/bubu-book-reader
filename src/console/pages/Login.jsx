import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createAuthApi } from '../../api/auth.js'
import { RuntimeIcon as Icon } from '../../shared/RuntimeIcon.jsx'
import { cx } from '../../shared/cx.js'
import { GlassPanel } from '../components/Glass.jsx'
import { BrandMark, DiamondRule } from '../components/BrandMark.jsx'
import { resolveLoginDestination } from './accounts/identityUi.js'

const states = {
  normal: { icon: 'Wifi', text: '网络连接正常', iconClass: 'text-[#3E9E8F]', textClass: 'text-ink-600' },
  error: { icon: 'AlertCircle', text: '登录没有成功，请查看提示', iconClass: 'text-warning-600', textClass: 'text-warning-600' },
  locked: { icon: 'ShieldAlert', text: '账号已被限制登录', iconClass: 'text-danger-500', textClass: 'text-danger-600' },
}

const fieldBase =
  'console-field flex items-center gap-3.5 rounded-[24px] border px-6 h-16 transition backdrop-blur-sm'

const authApi = createAuthApi()

export default function Login() {
  const navigate = useNavigate()
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [status, setStatus] = useState('normal')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function clearFeedback() {
    setStatus('normal')
    setNote('')
  }

  async function submit(event) {
    event.preventDefault()
    const loginName = account.trim()
    if (!loginName || !password) {
      setStatus('error')
      setNote('请输入账号和密码')
      return
    }
    setSubmitting(true)
    try {
      const response = await authApi.login({ loginName, password })
      const destination = resolveLoginDestination(response.data?.navigation)
      clearFeedback()
      if (destination) navigate(destination, { replace: true })
    } catch (cause) {
      setStatus(cause?.code === 'ACCOUNT_RESTRICTED' ? 'locked' : 'error')
      setNote(cause?.message || '登录服务暂不可用，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const state = states[status]
  const invalid = status === 'error'

  return (
    <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 py-12">
      <GlassPanel
        tone="crystal"
        sheen
        className="console-enter console-login-card w-full max-w-[620px] rounded-[40px] px-8 pb-10 pt-16 sm:px-10"
      >
        <div className="flex flex-col items-center text-center">
          <BrandMark size={46} textClass="text-[38px] leading-none" />
          <h1
            className="font-serif text-[40px] leading-tight font-bold text-ink-900 mt-8"
            style={{ letterSpacing: '0.16em' }}
          >
            欢迎回来
          </h1>
          <DiamondRule className="mt-5" />
        </div>

        <form onSubmit={submit} noValidate className="mt-12">
          <div
            className={cx(
              fieldBase,
              invalid
                ? 'border-danger-500/45 bg-danger-50/45'
                : 'border-white/75 bg-white/62 focus-within:border-brand-300/70 focus-within:bg-white/75',
            )}
          >
            <Icon name="IdCard" className="w-5 h-5 text-ink-400 shrink-0" strokeWidth={1.6} />
            <input
              value={account}
              onChange={(event) => {
                setAccount(event.target.value)
                clearFeedback()
              }}
              placeholder="账号"
              aria-label="账号"
              autoComplete="username"
              className="flex-1 bg-transparent text-base text-ink-800 placeholder:text-ink-400 outline-none"
            />
          </div>

          <div
            className={cx(
              fieldBase,
              'mt-5',
              invalid
                ? 'border-danger-500/45 bg-danger-50/45'
                : 'border-white/75 bg-white/62 focus-within:border-brand-300/70 focus-within:bg-white/75',
            )}
          >
            <Icon name="Lock" className="w-5 h-5 text-ink-400 shrink-0" strokeWidth={1.6} />
            <input
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                clearFeedback()
              }}
              placeholder="密码"
              aria-label="密码"
              autoComplete="current-password"
              className="flex-1 bg-transparent text-base text-ink-800 placeholder:text-ink-400 outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPwd((visible) => !visible)}
              className="p-1 rounded-lg text-ink-400 hover:text-brand-500 transition"
              aria-label={showPwd ? '隐藏密码' : '显示密码'}
            >
              <Icon name={showPwd ? 'Eye' : 'EyeOff'} className="w-5 h-5" strokeWidth={1.6} />
            </button>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="console-login-btn mt-7 w-full h-16 rounded-[24px] text-h2 font-semibold text-white transition duration-220 ease-soft hover:brightness-[1.04] active:scale-[0.995] disabled:opacity-60"
          >
            {submitting ? '正在登录…' : '登录'}
          </button>
        </form>

        <div className="mt-7 grid grid-cols-[1fr_auto_1fr] items-center text-sm">
          <button
            type="button"
            onClick={() => {
              setStatus('normal')
              setNote('教师或校长请联系学校管理员重置密码，管理员会把新密码告诉你')
            }}
            className="justify-self-start text-ink-500 hover:text-brand-600 transition"
          >
            忘记密码
          </button>
          <span className="w-px h-3.5 bg-ink-200 mx-8" />
          <button
            type="button"
            onClick={() => {
              setStatus('normal')
              setNote('教师辅助登录尚未开放，请使用学校账号或联系管理员')
            }}
            className="justify-self-end text-[#3E9E8F] hover:text-[#2F7D71] transition"
          >
            教师辅助登录
          </button>
        </div>
        {note && <p className={cx('mt-3 text-center text-micro', status === 'error' || status === 'locked' ? 'text-danger-600' : 'text-ink-500')}>{note}</p>}
        <Link
          to="/student/register"
          className="mt-5 block text-center text-sm font-semibold text-[#3E9E8F] hover:text-[#2F7D71] transition"
        >
          凭据注册
        </Link>

        <div
          className="console-enter mt-11 flex w-full items-center justify-center gap-5 rounded-full border border-white/65 bg-white/50 px-6 py-3.5 backdrop-blur-md"
          role="status"
        >
          <span className="inline-flex items-center gap-2 text-caption whitespace-nowrap">
            <Icon name={state.icon} className={cx('w-4 h-4 shrink-0', state.iconClass)} strokeWidth={1.8} />
            <span className={state.textClass}>{state.text}</span>
          </span>
          <span className="w-px h-3.5 shrink-0 bg-ink-200" />
          <span className="inline-flex items-center gap-2 text-caption text-ink-500 whitespace-nowrap">
            <Icon name="Headphones" className="w-4 h-4 shrink-0 text-brand-400" strokeWidth={1.8} />
            如遇问题，请联系学校管理员或教师
          </span>
        </div>
      </GlassPanel>
    </div>
  )
}
