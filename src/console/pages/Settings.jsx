import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createAuthApi } from '../../api/auth.js'
import { Btn, SubHead } from '../components/Controls.jsx'
import { PagePanel } from '../components/PagePanel.jsx'
import { useConsole } from '../state/ConsoleContext.jsx'

const authApi = createAuthApi()

const MIN_PASSWORD_LENGTH = 6
const MAX_PASSWORD_LENGTH = 1024
const MIN_DISPLAY_NAME_LENGTH = 1
const MAX_DISPLAY_NAME_LENGTH = 100

const FIELD = 'console-input mt-1 w-full max-w-[360px]'

export default function Settings() {
  const navigate = useNavigate()
  const { operator, runtime } = useConsole()
  const sessionName = typeof operator?.name === 'string' ? operator.name : ''

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
      navigate('/console/login', { replace: true })
    } catch (error) {
      setLogoutError(error?.message || '退出登录失败，请稍后重试')
      setLogoutBusy(false)
    }
  }

  return (
    <PagePanel title="设置" desc="只包含已经接入服务端的账号操作。">
      <div className="space-y-8">
        <section>
          <SubHead icon="KeyRound" title="修改密码" />
          <p className="text-[12.5px] text-ink-500">
            新密码长度为 {MIN_PASSWORD_LENGTH} 到 {MAX_PASSWORD_LENGTH} 个字符。修改成功后当前登录不会退出。
          </p>
          <form className="mt-3 space-y-3" onSubmit={submitPassword}>
            <label className="block text-[12.5px] text-ink-500">
              旧密码
              <input
                className={FIELD}
                type="password"
                autoComplete="current-password"
                value={oldPassword}
                onChange={(event) => setOldPassword(event.target.value)}
              />
            </label>
            <label className="block text-[12.5px] text-ink-500">
              新密码
              <input
                className={FIELD}
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label className="block text-[12.5px] text-ink-500">
              确认新密码
              <input
                className={FIELD}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            {passwordError ? <p className="text-[12px] text-danger-600">{passwordError}</p> : null}
            {passwordSuccess ? <p className="text-[12px] text-[#2C8B76]">{passwordSuccess}</p> : null}
            <Btn type="submit" tone="primary" disabled={passwordBusy}>
              {passwordBusy ? '正在保存…' : '保存新密码'}
            </Btn>
          </form>
        </section>

        <section>
          <SubHead icon="UserRound" title="修改显示名" />
          <p className="text-[12.5px] text-ink-500">
            显示名长度为 {MIN_DISPLAY_NAME_LENGTH} 到 {MAX_DISPLAY_NAME_LENGTH} 个字符。
          </p>
          <form className="mt-3 space-y-3" onSubmit={submitProfile}>
            <label className="block text-[12.5px] text-ink-500">
              显示名
              <input
                className={FIELD}
                type="text"
                autoComplete="nickname"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            {profileError ? <p className="text-[12px] text-danger-600">{profileError}</p> : null}
            {profileSuccess ? <p className="text-[12px] text-[#2C8B76]">{profileSuccess}</p> : null}
            <Btn type="submit" tone="primary" disabled={profileBusy}>
              {profileBusy ? '正在保存…' : '保存显示名'}
            </Btn>
          </form>
        </section>

        <section>
          <SubHead icon="LogOut" title="退出登录" />
          <p className="text-[12.5px] text-ink-500">退出后需要重新输入账号和密码。</p>
          <div className="mt-3">
            <Btn type="button" tone="danger" disabled={logoutBusy} onClick={logout}>
              {logoutBusy ? '正在退出…' : '退出登录'}
            </Btn>
          </div>
          {logoutError ? <p className="mt-2 text-[12px] text-danger-600">{logoutError}</p> : null}
        </section>

        <section>
          <SubHead icon="Info" title="关于与版本" />
          <p className="text-[12.5px] leading-relaxed text-ink-500">
            读伴是学校提供的阅读应用。账号由学校管理。当前没有由服务端下发的版本号，因此本页不展示版本。
          </p>
        </section>
      </div>
    </PagePanel>
  )
}
