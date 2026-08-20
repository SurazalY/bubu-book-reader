import { useCallback, useEffect, useRef, useState } from 'react'
import { createConsoleApi } from '../../../api/console.js'
import { useApiResource } from '../../../api/useApiResource.js'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, EmptyState, StatusTag, SubHead } from '../../components/Controls.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import { createIdentityConsoleApi } from './identityApi.js'
import {
  canIssueStudentPasswordReset,
  canIssueTeacherAccountSupport,
  canManageRegistration,
  GRADE_MANAGER_SCOPE_NOTE,
  mergeIssuedCredentialRow,
  REGISTRATION_PAGE_PATH,
  registrationRoleLabel,
  revealedRegistrationToken,
  unwrapList,
} from './identityUi.js'

const consoleApi = createConsoleApi()
const identityApi = createIdentityConsoleApi()

async function copyPlainText(text) {
  if (typeof navigator?.clipboard?.writeText !== 'function') {
    throw new Error('当前浏览器无法复制')
  }
  await navigator.clipboard.writeText(text)
}

function studentAliasValues(student) {
  return [student?.loginName, student?.login_name, student?.username, student?.displayName]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim())
}

function resolveStudentUserId(input, students) {
  const needle = String(input || '').trim()
  if (!needle || !Array.isArray(students)) return null
  const lower = needle.toLowerCase()
  const exactId = students.find((student) => student?.id === needle)
  if (exactId?.id) return exactId.id
  const aliasMatches = students.filter((student) => (
    studentAliasValues(student).some((value) => value.toLowerCase() === lower)
  ))
  if (aliasMatches.length === 1 && aliasMatches[0]?.id) return aliasMatches[0].id
  return null
}

function renderTempPasswordStatus(record, onCopy) {
  if (!record) {
    return <span className="text-[12px] text-ink-400">读取中…</span>
  }
  if (record.readFailed) {
    return <span className="text-[12px] text-danger-600">状态读取失败</span>
  }
  if (record.status === 'available') {
    return (
      <div className="text-[12px] text-ink-700">
        <p>
          当前临时密码：
          <span className="font-mono">{record.password}</span>
        </p>
        {record.password ? (
          <Btn size="sm" tone="primary" className="mt-1.5" onClick={() => onCopy(record.password, '已复制新密码')}>
            复制
          </Btn>
        ) : null}
      </div>
    )
  }
  if (record.status === 'cleared') {
    return <span className="text-[12px] text-ink-600">学生已自行修改</span>
  }
  if (record.status === 'none') {
    return <span className="text-[12px] text-ink-400">未重置过</span>
  }
  return <span className="text-[12px] text-danger-600">状态读取失败</span>
}

export default function OrgAccounts() {
  const { workspace } = useConsole()
  const workspaceId = workspace?.id
  const scopeType = workspace?.scopeType
  const [expectedRole, setExpectedRole] = useState('student')
  const [maxUses, setMaxUses] = useState('')
  const [issued, setIssued] = useState(null)
  const [issueError, setIssueError] = useState('')
  const [issuing, setIssuing] = useState(false)
  const [resetUserId, setResetUserId] = useState('')
  const [resetIssued, setResetIssued] = useState(null)
  const [resetError, setResetError] = useState('')
  const [resetting, setResetting] = useState(false)
  const [tempByUserId, setTempByUserId] = useState({})
  const tempFetchSeq = useRef(0)
  const [revokeReason, setRevokeReason] = useState('定向撤销')
  const [copyNote, setCopyNote] = useState('')

  const loadStudents = useCallback(async () => {
    const response = await consoleApi.listStudents({ workspaceId })
    return { data: unwrapList(response.data), meta: response.meta }
  }, [workspaceId])
  const students = useApiResource(loadStudents)
  const studentList = Array.isArray(students.data) ? students.data : []
  const studentIdsKey = studentList.map((item) => item.id).join(',')

  useEffect(() => {
    if (!workspaceId || students.status !== 'ready') return undefined
    let cancelled = false
    const seq = tempFetchSeq.current + 1
    tempFetchSeq.current = seq
    const list = studentList
    ;(async () => {
      const entries = await Promise.all(list.map(async (student) => {
        try {
          const response = await identityApi.getTempPassword(student.id, { workspaceId })
          return [student.id, response.data]
        } catch {
          return [student.id, { readFailed: true }]
        }
      }))
      if (cancelled || seq !== tempFetchSeq.current) return
      setTempByUserId(Object.fromEntries(entries))
    })()
    return () => {
      cancelled = true
    }
  }, [studentIdsKey, students.status, workspaceId])

  const loadCredentials = useCallback(async () => {
    const response = await identityApi.listRegistrationCredentials({ workspaceId, expectedRole })
    return { data: unwrapList(response.data), meta: response.meta }
  }, [expectedRole, workspaceId])
  const credentials = useApiResource(loadCredentials)

  async function copyText(text, okMessage) {
    try {
      await copyPlainText(text)
      setCopyNote(okMessage)
    } catch {
      setCopyNote('浏览器未允许复制，请手动复制。')
    }
  }

  async function issueCredential() {
    setIssuing(true)
    setIssueError('')
    setIssued(null)
    setCopyNote('')
    try {
      const body = { expectedRole }
      if (maxUses.trim()) body.maxUses = Number(maxUses)
      const response = await identityApi.issueRegistrationCredential(body, { workspaceId })
      setIssued({
        ...response.data,
        expectedRole: response.data?.expectedRole || expectedRole,
      })
      credentials.reload()
    } catch (cause) {
      setIssueError(cause?.message || '签发失败')
    } finally {
      setIssuing(false)
    }
  }

  async function revokeCredential(item) {
    setIssueError('')
    try {
      await identityApi.revokeRegistrationCredential(item.id, { version: item.version, reason: revokeReason }, { workspaceId })
      credentials.reload()
    } catch (cause) {
      setIssueError(cause?.message || '撤销失败')
    }
  }

  async function issueReset(userId) {
    const rawTarget = String(userId || resetUserId).trim()
    if (!rawTarget) {
      setResetError('请选择或填写要重置的账号')
      return
    }
    const targetUserId = resolveStudentUserId(rawTarget, studentList)
    if (!targetUserId) {
      setResetError('找不到该学生')
      return
    }
    setResetting(true)
    setResetError('')
    setResetIssued(null)
    setCopyNote('')
    try {
      const response = await identityApi.issueTempPassword(targetUserId, { workspaceId })
      const newPassword = response.data?.newPassword
      const issuedAt = response.data?.issuedAt
      tempFetchSeq.current += 1
      setResetIssued({ userId: targetUserId, newPassword, issuedAt })
      setTempByUserId((current) => ({
        ...current,
        [targetUserId]: { status: 'available', password: newPassword, issuedAt },
      }))
    } catch (cause) {
      setResetError(cause?.message || '重置密码失败')
    } finally {
      setResetting(false)
    }
  }

  if (!canManageRegistration(scopeType) && !canIssueStudentPasswordReset(scopeType)) {
    return (
      <PagePanel title="凭据与重置" desc="当前工作空间没有账号凭据入口。">
        <EmptyState icon="ShieldX" title="无权管理凭据" desc="教师请在本班详情审批学生；凭据由校长或年级主任签发。" />
      </PagePanel>
    )
  }

  const credentialRows = mergeIssuedCredentialRow(credentials.data, issued, expectedRole)

  return (
    <PagePanel
      title={`${workspace?.scopeLabel || '当前范围'} · 凭据与重置`}
      desc={scopeType === 'grade' ? GRADE_MANAGER_SCOPE_NOTE : '列表只显示当前所选角色。注册码只在本次签发后能复制一次；此前签发的有效凭据仍能用，但不能再查看注册码，需要的话请重新签发。撤销只标记 revoked，不会删除记录。'}
    >
      {canManageRegistration(scopeType) && (
        <section>
          <SubHead icon="KeyRound" title="注册凭据" />
          <div className="flex flex-wrap items-end gap-2.5 mb-3">
            <label className="text-[12px] text-ink-600">
              角色
              <select className="console-input mt-1" value={expectedRole} onChange={(event) => setExpectedRole(event.target.value)}>
                <option value="student">学生</option>
                {canIssueTeacherAccountSupport(scopeType) && <option value="teacher">教师</option>}
              </select>
            </label>
            <label className="text-[12px] text-ink-600">
              人数上限（可空）
              <input className="console-input mt-1 w-[120px]" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} placeholder="学生默认不限" />
            </label>
            <label className="text-[12px] text-ink-600">
              撤销原因
              <input className="console-input mt-1 w-[160px]" value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} />
            </label>
            <Btn tone="primary" disabled={issuing} onClick={issueCredential}>{issuing ? '签发中…' : '签发凭据'}</Btn>
          </div>
          {scopeType === 'grade' && expectedRole === 'teacher' && (
            <p className="text-[11.5px] text-ink-500 mb-3">{GRADE_MANAGER_SCOPE_NOTE}</p>
          )}
          {copyNote && <p className="mb-3 text-[12.5px] text-ink-600">{copyNote}</p>}
          {issueError && <p className="mb-3 text-[12.5px] text-danger-600">{issueError}</p>}
          {credentials.error ? (
            <EmptyState icon="TriangleAlert" title="凭据列表读取失败" desc={credentials.error.message || '可以继续签发；历史列表需要服务端目录接口。'} />
          ) : (
            <div className="rounded-xl border border-ink-150 overflow-hidden bg-white/60">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-ink-50/70 text-[11.5px] text-ink-500">
                    <th className="px-3 py-2.5 font-medium">角色</th>
                    <th className="px-2 py-2.5 font-medium w-[120px]">使用</th>
                    <th className="px-2 py-2.5 font-medium w-[88px]">状态</th>
                    <th className="px-2 py-2.5 font-medium w-[88px] text-right">撤销</th>
                    <th className="px-2 py-2.5 font-medium w-[108px] text-right">编号</th>
                  </tr>
                </thead>
                <tbody>
                  {credentialRows.map((item) => {
                    const reveal = revealedRegistrationToken(issued, item.id)
                    return (
                      <tr key={item.id} className="border-t border-ink-150/70 align-top">
                        <td className="px-3 py-2.5 text-[12.5px]">
                          <div>{registrationRoleLabel(item.expectedRole)}</div>
                          {reveal && (
                            <div className="mt-2 rounded-lg border border-brand-100 bg-brand-50/70 px-2.5 py-2">
                              <p className="text-[12px] font-medium text-ink-800">
                                注册码 · {registrationRoleLabel(item.expectedRole)}
                              </p>
                              <p className="mt-1 font-mono break-all text-[12px] text-ink-800">{reveal}</p>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                <Btn size="sm" tone="primary" onClick={() => copyText(reveal, '已复制注册码')}>复制注册码</Btn>
                                <Btn size="sm" onClick={() => copyText(REGISTRATION_PAGE_PATH, '已复制注册页链接')}>复制注册页链接</Btn>
                              </div>
                              <p className="mt-1.5 text-[11px] text-ink-500">
                                请到 /student/register 粘贴注册码。不要把内部编号当成注册码。
                              </p>
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-[12.5px] tabular-nums">{item.successfulUseCount ?? 0}/{item.maxUses ?? '不限'}</td>
                        <td className="px-2 py-2.5">
                          <StatusTag tone={item.revokedAt ? 'muted' : 'success'} dot>{item.revokedAt ? '已撤销' : '有效'}</StatusTag>
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          {!item.revokedAt && <Btn size="sm" onClick={() => revokeCredential(item)}>撤销</Btn>}
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          <details className="text-[11px] text-ink-400">
                            <summary className="cursor-pointer select-none">内部编号</summary>
                            <p className="mt-1 text-[10.5px] leading-relaxed text-ink-400">内部编号，不是注册码</p>
                            <Btn
                              size="sm"
                              className="mt-1"
                              title="内部编号，不是注册码"
                              onClick={() => copyText(item.id, '已复制内部编号。这不是注册码。')}
                            >
                              复制编号
                            </Btn>
                          </details>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {credentialRows.length === 0 && (
                <p className="px-3 py-3 text-[12px] text-ink-500">还没有可展示的凭据元数据。</p>
              )}
            </div>
          )}
        </section>
      )}

      {canIssueStudentPasswordReset(scopeType) && (
        <section className="mt-6">
          <SubHead icon="KeyRound" title="重置密码" />
          <p className="text-[12px] text-ink-500 mb-3">
            重置后会生成 6 位新密码，可随时回来查看。学生自行修改后不再显示明文。
          </p>
          <div className="flex flex-wrap items-end gap-2.5 mb-3">
            <label className="text-[12px] text-ink-600">
              目标账号
              <input className="console-input mt-1 w-[240px]" value={resetUserId} onChange={(event) => setResetUserId(event.target.value)} placeholder="登录名" />
            </label>
            <Btn tone="primary" disabled={resetting} onClick={() => issueReset()}>{resetting ? '重置中…' : '重置密码'}</Btn>
          </div>
          {canIssueTeacherAccountSupport(scopeType) && scopeType === 'grade' && (
            <p className="text-[11.5px] text-ink-500 mb-3">可以重置本校教师密码，这不扩大到其他届别班级或书架。</p>
          )}
          {resetIssued?.newPassword && (
            <div className="mb-3 rounded-xl border border-brand-100 bg-brand-50/70 px-3 py-2.5 text-[12.5px] text-ink-800">
              <p>新密码已生成，请转告学生。</p>
              <p className="mt-1 font-mono break-all">{resetIssued.newPassword}</p>
              <Btn size="sm" tone="primary" className="mt-2" onClick={() => copyText(resetIssued.newPassword, '已复制新密码')}>复制</Btn>
            </div>
          )}
          {resetError && <p className="mb-3 text-[12.5px] text-danger-600">{resetError}</p>}
          {students.status === 'error' ? (
            <EmptyState icon="TriangleAlert" title="学生名单读取失败" desc={students.error?.message} />
          ) : (
            <div className="rounded-xl border border-ink-150 overflow-hidden bg-white/60">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-ink-50/70 text-[11.5px] text-ink-500">
                    <th className="px-3 py-2.5 font-medium">学生</th>
                    <th className="px-2 py-2.5 font-medium">展示名</th>
                    <th className="px-2 py-2.5 font-medium">班级</th>
                    <th className="px-2 py-2.5 font-medium">临时密码</th>
                    <th className="px-2 py-2.5 font-medium w-[108px] text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {studentList.map((student) => (
                    <tr key={student.id} className="border-t border-ink-150/70 align-top">
                      <td className="px-3 py-2.5 text-[13px]">{student.displayName || student.id}</td>
                      <td className="px-2 py-2.5 text-[13px]">{student.displayName || '—'}</td>
                      <td className="px-2 py-2.5 text-[12.5px] text-ink-600">{student.className || student.classId || '—'}</td>
                      <td className="px-2 py-2.5">
                        {renderTempPasswordStatus(tempByUserId[student.id], copyText)}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        <Btn size="sm" disabled={resetting} onClick={() => issueReset(student.id)}>重置密码</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {studentList.length === 0 && students.status !== 'loading' && (
                <p className="px-3 py-3 text-[12px] text-ink-500">当前范围没有可重置的学生。</p>
              )}
            </div>
          )}
        </section>
      )}
    </PagePanel>
  )
}
