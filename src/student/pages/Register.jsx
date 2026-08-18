import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { createStudentApi } from '../../api/student.js'
import { useApiResource } from '../../api/useApiResource.js'
import { RuntimeIcon as Icon } from '../../shared/RuntimeIcon.jsx'
import { cx } from '../../shared/cx.js'
import { GlassPanel } from '../components/Glass.jsx'
import { BrandMark, DiamondRule } from '../components/BrandMark.jsx'
import { stageLabel } from '../../console/pages/accounts/identityUi.js'

const FIELD =
  'student-field h-16 w-full rounded-[24px] border border-white/70 bg-white/55 px-6 text-title text-ink-800 placeholder:text-ink-400 outline-none transition focus:border-white/90 focus:bg-white/70'

const studentApi = createStudentApi()

export default function Register() {
  const { token: pathToken } = useParams()
  const trimmedPath = typeof pathToken === 'string' ? pathToken.trim() : ''
  const hasPathToken = Boolean(trimmedPath)
  const [draftToken, setDraftToken] = useState(trimmedPath)
  const [activeToken, setActiveToken] = useState(trimmedPath)
  const [tokenError, setTokenError] = useState('')
  const [form, setForm] = useState({ loginName: '', displayName: '', password: '', classId: '' })
  const [teacherClassIds, setTeacherClassIds] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [created, setCreated] = useState(null)

  useEffect(() => {
    if (!trimmedPath) return
    setDraftToken(trimmedPath)
    setActiveToken(trimmedPath)
  }, [trimmedPath])

  const load = useCallback(async () => {
    if (!activeToken) {
      return { data: null, meta: {} }
    }
    const response = await studentApi.getRegistration(activeToken)
    return { data: response.data, meta: response.meta }
  }, [activeToken])
  const resource = useApiResource(load)

  const expectedRole = resource.data?.expectedRole
  const classes = useMemo(() => resource.data?.classes || [], [resource.data])

  function setField(key) {
    return (event) => {
      setForm((current) => ({ ...current, [key]: event.target.value }))
      setError('')
    }
  }

  function toggleTeacherClass(classId) {
    setTeacherClassIds((current) => (
      current.includes(classId) ? current.filter((id) => id !== classId) : [...current, classId]
    ))
  }

  function confirmToken(event) {
    event.preventDefault()
    const next = draftToken.trim()
    if (!next) {
      setTokenError('请粘贴校长签发的注册码，不要填写凭据编号')
      return
    }
    setTokenError('')
    setError('')
    setCreated(null)
    setActiveToken(next)
  }

  function resetToken() {
    setActiveToken('')
    setDraftToken('')
    setTokenError('')
    setError('')
    setCreated(null)
  }

  async function submit(event) {
    event.preventDefault()
    const loginName = form.loginName.trim()
    const displayName = form.displayName.trim()
    if (!loginName || !displayName || !form.password) {
      setError('请填写登录名、展示名和密码')
      return
    }
    if (expectedRole === 'student' && !form.classId) {
      setError('学生注册必须选择一个预制班级')
      return
    }
    setSubmitting(true)
    setError('')
    setSuggestions([])
    try {
      const body = {
        loginName,
        displayName,
        password: form.password,
        ...(expectedRole === 'student' ? { classId: form.classId } : { classIds: teacherClassIds }),
      }
      const response = await studentApi.registerWithToken(activeToken, body)
      setCreated(response.data)
    } catch (cause) {
      setError(cause?.message || '注册失败')
      const next = cause?.details?.suggestions
      setSuggestions(Array.isArray(next) ? next : [])
    } finally {
      setSubmitting(false)
    }
  }

  if (!activeToken) {
    return (
      <Shell>
        <p className="mt-6 text-center text-caption leading-relaxed text-ink-600">
          学生登录页和教师登录页都可以来这里。请粘贴校长签发的注册码，不要把凭据编号当注册码。
        </p>
        <form className="mt-8 space-y-4" onSubmit={confirmToken}>
          <input
            className={FIELD}
            placeholder="注册码"
            aria-label="注册码"
            value={draftToken}
            onChange={(event) => {
              setDraftToken(event.target.value)
              setTokenError('')
            }}
            autoComplete="off"
          />
          {tokenError && (
            <p className="flex items-center gap-2 pl-2 text-caption text-[#D0492F]">
              <Icon name="CircleAlert" className="h-4 w-4" />
              {tokenError}
            </p>
          )}
          <button type="submit" className="student-primary-btn h-16 w-full rounded-[24px] text-title font-semibold text-white">
            确认注册码
          </button>
        </form>
        <p className="mt-5 text-center text-caption text-ink-500">
          <Link to="/student/login" className="text-[#3E9E8F]">学生登录</Link>
          <span className="mx-2 text-ink-300">·</span>
          <Link to="/console/login" className="text-[#3E9E8F]">教师登录</Link>
        </p>
      </Shell>
    )
  }

  if (resource.status === 'error') {
    return (
      <Shell>
        <p className="mt-8 text-center text-caption text-[#D0492F]">{resource.error?.message || '注册链接不可用'}</p>
        {!hasPathToken && (
          <button type="button" onClick={resetToken} className="mt-6 block w-full text-center text-caption text-[#3E9E8F]">
            更换注册码
          </button>
        )}
        <Link to="/student/login" className="mt-6 block text-center text-caption text-[#3E9E8F]">返回登录</Link>
      </Shell>
    )
  }

  if (created) {
    const loginPath = expectedRole === 'teacher' ? '/console/login' : '/student/login'
    return (
      <Shell>
        <p className="mt-8 text-center text-caption text-ink-600">
          {expectedRole === 'student' ? '账号已创建，正在等待老师审批入班。' : '教师账号已创建，登录后可自选任教班级。'}
        </p>
        <Link to={loginPath} className="student-primary-btn mt-6 flex h-16 w-full items-center justify-center rounded-[24px] text-title font-semibold text-white">
          去登录
        </Link>
      </Shell>
    )
  }

  return (
    <Shell schoolName={resource.data?.schoolName} expectedRole={expectedRole}>
      <form className="mt-8 space-y-4" onSubmit={submit}>
        <label className="block">
          <span className="mb-2 block pl-2 text-caption text-ink-500">注册码</span>
          <input className={FIELD} value={activeToken} readOnly aria-label="注册码" />
        </label>
        {!hasPathToken && (
          <button type="button" onClick={resetToken} className="pl-2 text-caption text-[#3E9E8F]">
            更换注册码
          </button>
        )}
        <input className={FIELD} placeholder="登录名" aria-label="登录名" value={form.loginName} onChange={setField('loginName')} autoComplete="username" />
        <input className={FIELD} placeholder="展示名" aria-label="展示名" value={form.displayName} onChange={setField('displayName')} autoComplete="nickname" />
        <input className={FIELD} type="password" placeholder="密码" aria-label="密码" value={form.password} onChange={setField('password')} autoComplete="new-password" />

        {expectedRole === 'student' ? (
          <label className="block">
            <span className="mb-2 block pl-2 text-caption text-ink-500">选择班级</span>
            <select className={FIELD} value={form.classId} onChange={setField('classId')} aria-label="选择班级">
              <option value="">请选择预制班级</option>
              {classes.map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name} · {stageLabel(klass.stage)} {klass.entryYear} 届 {klass.classNumber} 班
                </option>
              ))}
            </select>
          </label>
        ) : expectedRole === 'teacher' ? (
          <fieldset className="rounded-[24px] border border-white/70 bg-white/55 px-5 py-4">
            <legend className="px-1 text-caption text-ink-500">可先选任教班级，也可登录后再选</legend>
            {classes.length === 0 ? (
              <p className="text-caption text-ink-500">当前没有可选班级，登录后会进入选班页。</p>
            ) : classes.map((klass) => (
              <label key={klass.id} className="mt-2 flex items-center gap-2 text-caption text-ink-700">
                <input
                  type="checkbox"
                  checked={teacherClassIds.includes(klass.id)}
                  onChange={() => toggleTeacherClass(klass.id)}
                />
                {klass.name} · {stageLabel(klass.stage)} {klass.entryYear} 届
              </label>
            ))}
          </fieldset>
        ) : null}

        {error && (
          <p className="flex items-center gap-2 pl-2 text-caption text-[#D0492F]">
            <Icon name="CircleAlert" className="h-4 w-4" />
            {error}
          </p>
        )}
        {suggestions.length > 0 && (
          <p className="pl-2 text-caption text-ink-500">可尝试：{suggestions.join('、')}</p>
        )}

        <button type="submit" disabled={submitting || resource.status === 'loading'} className="student-primary-btn h-16 w-full rounded-[24px] text-title font-semibold text-white disabled:opacity-60">
          {submitting ? '正在注册…' : '注册'}
        </button>
      </form>
      <p className="mt-5 text-center text-caption text-ink-500">
        已有账号，
        <Link to="/student/login" className="text-[#3E9E8F]">去学生登录</Link>
        {' / '}
        <Link to="/console/login" className="text-[#3E9E8F]">去教师登录</Link>
      </p>
    </Shell>
  )
}

function Shell({ children, schoolName, expectedRole }) {
  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-10">
      <GlassPanel tone="crystal" sheen className="student-crystal-card student-enter w-[620px] max-w-full rounded-[40px] px-12 py-11">
        <div className="flex justify-center">
          <BrandMark size={30} textClass="text-h2" />
        </div>
        <h1 className="mt-7 text-center font-serif text-[36px] font-bold leading-tight text-ink-900 tracking-[0.12em]">
          加入学校
        </h1>
        <DiamondRule className="mt-4" />
        <p className={cx('mt-4 text-center text-caption text-ink-500')}>
          {schoolName || '学生和教师共用这一页，用校长签发的注册码'}
          {expectedRole === 'teacher' ? ' · 教师注册' : expectedRole === 'student' ? ' · 学生注册' : ''}
        </p>
        {children}
      </GlassPanel>
    </div>
  )
}
