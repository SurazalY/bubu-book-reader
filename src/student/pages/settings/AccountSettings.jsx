import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createAuthApi } from '../../../api/auth.js'
import { GlassPanel } from '../../components/Glass.jsx'
import PageHead from '../../components/PageHead.jsx'
import { useStudent } from '../../state/StudentContext.jsx'

const authApi = createAuthApi()

const MIN_PASSWORD_LENGTH = 6
const MAX_PASSWORD_LENGTH = 1024
const MIN_DISPLAY_NAME_LENGTH = 1
const MAX_DISPLAY_NAME_LENGTH = 100

const FIELD =
  'student-field h-12 w-full rounded-xl border border-white/70 bg-white/55 px-4 text-caption text-ink-800 placeholder:text-ink-400 outline-none transition focus:border-white/90 focus:bg-white/70'
const PRIMARY_BTN =
  'rounded-full bg-brand-600 px-4 py-2.5 text-caption font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60'
const PLAIN_BTN =
  'flex w-full items-center justify-center rounded-full border border-white/70 bg-white/72 px-4 py-2.5 text-caption font-semibold text-ink-700 transition hover:bg-white disabled:opacity-60'

export default function AccountSettings() {
  const navigate = useNavigate()
  const { student, runtime } = useStudent()
  const sessionName = typeof student?.name === 'string' ? student.name : ''

  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')

  const [displayName, setDisplayName] = useState(sessionName)
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileSuccess, setProfileSuccess] = useState('')

  const [logoutBusy, setLogoutBusy] = useState(false)
  const [logoutError, setLogoutError] = useState('')

  useEffect(() => {
    setDisplayName(sessionName)
  }, [sessionName])

  async function submitPassword(event) {
    event.preventDefault()
    setPasswordError('')
    setPasswordSuccess('')
    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的新密码不一致')
      return
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > MAX_PASSWORD_LENGTH) {
      setPasswordError(`新密码必须为 ${MIN_PASSWORD_LENGTH} 到 ${MAX_PASSWORD_LENGTH} 个字符`)
      return
    }
    setPasswordBusy(true)
    try {
      await authApi.changeOwnPassword({ oldPassword, newPassword })
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordSuccess('密码已修改，当前登录仍然有效。')
    } catch (error) {
      setPasswordError(error?.message || '修改密码失败，请稍后重试')
    } finally {
      setPasswordBusy(false)
    }
  }

  async function submitProfile(event) {
    event.preventDefault()
    setProfileError('')
    setProfileSuccess('')
    const nextName = displayName.trim()
    if (nextName.length < MIN_DISPLAY_NAME_LENGTH || nextName.length > MAX_DISPLAY_NAME_LENGTH) {
      setProfileError(`显示名必须为 ${MIN_DISPLAY_NAME_LENGTH} 到 ${MAX_DISPLAY_NAME_LENGTH} 个字符`)
      return
    }
    setProfileBusy(true)
    try {
      const response = await authApi.updateOwnProfile({ displayName: nextName })
      const savedName = typeof response.data?.displayName === 'string' ? response.data.displayName : nextName
      setDisplayName(savedName)
      setProfileSuccess('显示名已更新。')
      runtime.reload()
    } catch (error) {
      setProfileError(error?.message || '修改显示名失败，请稍后重试')
    } finally {
      setProfileBusy(false)
    }
  }

  async function logout() {
    if (logoutBusy) return
    setLogoutError('')
    setLogoutBusy(true)
    try {
      await authApi.logout()
      navigate('/student/login', { replace: true })
    } catch (error) {
      setLogoutError(error?.message || '退出登录失败，请稍后重试')
      setLogoutBusy(false)
    }
  }

  return (
    <div className="flex-1 space-y-4">
      <PageHead title="设置" desc="只包含已经接入服务端的账号操作。" />

      <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
        <h2 className="font-serif text-h3 font-bold text-ink-900">修改密码</h2>
        <p className="mt-1.5 text-caption text-ink-500">新密码长度为 {MIN_PASSWORD_LENGTH} 到 {MAX_PASSWORD_LENGTH} 个字符。修改成功后当前登录不会退出。</p>
        <form className="mt-4 space-y-3" onSubmit={submitPassword}>
          <label className="block">
            <span className="mb-1.5 block text-micro text-ink-500">旧密码</span>
            <input
              className={FIELD}
              type="password"
              autoComplete="current-password"
              value={oldPassword}
              onChange={(event) => setOldPassword(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-micro text-ink-500">新密码</span>
            <input
              className={FIELD}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-micro text-ink-500">确认新密码</span>
            <input
              className={FIELD}
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          {passwordError ? <p className="text-micro text-[#D0492F]">{passwordError}</p> : null}
          {passwordSuccess ? <p className="text-micro text-[#2C8B76]">{passwordSuccess}</p> : null}
          <button type="submit" disabled={passwordBusy} className={PRIMARY_BTN}>
            {passwordBusy ? '正在保存…' : '保存新密码'}
          </button>
        </form>
      </GlassPanel>

      <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
        <h2 className="font-serif text-h3 font-bold text-ink-900">修改显示名</h2>
        <p className="mt-1.5 text-caption text-ink-500">显示名长度为 {MIN_DISPLAY_NAME_LENGTH} 到 {MAX_DISPLAY_NAME_LENGTH} 个字符。</p>
        <form className="mt-4 space-y-3" onSubmit={submitProfile}>
          <label className="block">
            <span className="mb-1.5 block text-micro text-ink-500">显示名</span>
            <input
              className={FIELD}
              type="text"
              autoComplete="nickname"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          {profileError ? <p className="text-micro text-[#D0492F]">{profileError}</p> : null}
          {profileSuccess ? <p className="text-micro text-[#2C8B76]">{profileSuccess}</p> : null}
          <button type="submit" disabled={profileBusy} className={PRIMARY_BTN}>
            {profileBusy ? '正在保存…' : '保存显示名'}
          </button>
        </form>
      </GlassPanel>

      <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
        <h2 className="font-serif text-h3 font-bold text-ink-900">退出登录</h2>
        <p className="mt-1.5 text-caption text-ink-500">退出后需要重新输入账号和密码。</p>
        <button type="button" onClick={logout} disabled={logoutBusy} className={`${PLAIN_BTN} mt-4`}>
          {logoutBusy ? '正在退出…' : '退出登录'}
        </button>
        {logoutError ? <p className="mt-2 text-micro text-[#D0492F]">{logoutError}</p> : null}
      </GlassPanel>

      <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
        <h2 className="font-serif text-h3 font-bold text-ink-900">关于与版本</h2>
        <p className="mt-1.5 text-caption leading-relaxed text-ink-500">
          读伴是学校提供的阅读应用。账号由学校管理。当前没有由服务端下发的版本号，因此本页不展示版本。
        </p>
      </GlassPanel>
    </div>
  )
}
