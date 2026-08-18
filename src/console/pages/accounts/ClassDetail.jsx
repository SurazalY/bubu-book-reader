import { useCallback, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, EmptyState, Field, StatusTag, SubHead } from '../../components/Controls.jsx'
import { ConfirmModal } from '../../components/Overlay.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import { useApiResource } from '../../../api/useApiResource.js'
import { createConsoleApi } from '../../../api/console.js'
import { createIdentityConsoleApi } from './identityApi.js'
import {
  accountCodeSuffix,
  canCreateClass,
  formatIsoTime,
  seedAvatarTone,
  stageLabel,
  teacherCountLabel,
  unwrapList,
} from './identityUi.js'

const consoleApi = createConsoleApi()
const identityApi = createIdentityConsoleApi()

async function readTeacherCount({ classId, workspace }) {
  if (workspace?.scopeType === 'class') {
    const directory = await identityApi.getTeacherClassDirectory()
    return unwrapList(directory.data).find((item) => item.id === classId)?.teacherCount
  }
  if (!workspace?.id) return undefined
  const list = await consoleApi.listAuthorizedClasses({ workspaceId: workspace.id })
  return unwrapList(list.data).find((item) => item.id === classId)?.teacherCount
}

export default function ClassDetail() {
  const { classId } = useParams()
  const { workspace } = useConsole()
  const navigate = useNavigate()
  const workspaceId = workspace?.id
  const load = useCallback(async () => {
    const [detail, queue, teacherCount] = await Promise.all([
      identityApi.getClass(classId, { workspaceId }),
      identityApi.listEnrollmentRequests(classId, { workspaceId }).catch((error) => ({ data: { items: [] }, error })),
      readTeacherCount({ classId, workspace }).catch(() => undefined),
    ])
    return {
      data: {
        klass: { ...detail.data, teacherCount: teacherCount ?? detail.data?.teacherCount },
        requests: unwrapList(queue.data),
        queueError: queue.error || null,
      },
      meta: detail.meta,
    }
  }, [classId, workspace, workspaceId])
  const resource = useApiResource(load)
  const [confirm, setConfirm] = useState(null)
  const [actingId, setActingId] = useState(null)
  const [actionError, setActionError] = useState('')

  const backPath = workspace?.scopeType === 'class' ? '/console/home' : '/console/accounts/classes'
  const klass = resource.data?.klass
  const requests = resource.data?.requests || []
  const queueError = resource.data?.queueError

  async function decide(request, decision) {
    setActingId(request.id)
    setActionError('')
    try {
      const body = { version: request.version }
      if (decision === 'approve') await identityApi.approveEnrollmentRequest(request.id, body, { workspaceId })
      else await identityApi.rejectEnrollmentRequest(request.id, body, { workspaceId })
      resource.reload()
    } catch (cause) {
      setActionError(cause?.message || '审批失败')
    } finally {
      setActingId(null)
    }
  }

  async function changeClassStatus(kind) {
    if (!klass) return
    setActionError('')
    try {
      const body = { version: klass.version }
      if (kind === 'disable') await identityApi.disableClass(classId, body, { workspaceId })
      else await identityApi.restoreClass(classId, body, { workspaceId })
      setConfirm(null)
      resource.reload()
    } catch (cause) {
      setActionError(cause?.message || '班级状态更新失败')
    }
  }

  if (resource.status === 'error' || !klass) {
    return (
      <PagePanel title={resource.status === 'loading' ? '正在读取班级' : '班级不可用'} desc={resource.error?.message || '这个班级不在当前工作空间范围内。'}>
        <EmptyState
          icon="SearchX"
          title={resource.status === 'loading' ? '正在读取班级详情' : '找不到这个班级'}
          desc={resource.error?.message || '请回到班级列表或切换工作空间。'}
          action={<Btn tone="primary" icon="ArrowLeft" onClick={() => navigate(backPath)}>返回</Btn>}
        />
      </PagePanel>
    )
  }

  const allowLifecycle = canCreateClass(workspace?.scopeType)

  return (
    <PagePanel
      title={`${klass.name} · 班级详情`}
      desc={[`${stageLabel(klass.stage)} · ${klass.entryYear} 届 ${klass.classNumber} 班`, teacherCountLabel(klass.teacherCount)].filter(Boolean).join(' · ')}
      toolbar={<Btn icon="ArrowLeft" onClick={() => navigate(backPath)}>返回</Btn>}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8">
        <Field label="班级名称">
          <span className="font-medium">{klass.name}</span>
          <StatusTag tone={klass.status === 'active' ? 'success' : 'muted'} dot className="ml-2">
            {klass.status === 'active' ? '进行中' : klass.status === 'disabled' ? '已停用' : klass.status}
          </StatusTag>
        </Field>
        <Field label="届别">{klass.gradeId} · 当前年级 {klass.currentGrade ?? '—'}</Field>
        <Field label="生命周期">{klass.lifecycle || '—'}</Field>
        <Field label="教师">{teacherCountLabel(klass.teacherCount) || '人数以班级目录为准'}</Field>
      </div>

      {allowLifecycle && (
        <div className="mt-4 pt-3.5 border-t border-ink-150/70 flex gap-2">
          {klass.status === 'active' ? (
            <Btn tone="danger" icon="Trash2" onClick={() => setConfirm('disable')}>停用班级</Btn>
          ) : (
            <Btn icon="RotateCcw" onClick={() => setConfirm('restore')}>恢复班级</Btn>
          )}
        </div>
      )}

      <div className="mt-5">
        <SubHead icon="UserPlus" title="学生入班审批" />
        <p className="text-[12px] text-ink-500 mb-3">展示名、头像种子、账号短编号尾 4 位和注册时间用于辨认，姓名不是身份键。</p>
        {queueError ? (
          <EmptyState icon="TriangleAlert" title="审批队列读取失败" desc={queueError.message || '服务端未返回入班申请列表。'} />
        ) : requests.length === 0 ? (
          <EmptyState icon="Users" title="当前没有待审学生" desc="学生通过注册凭据选班后会出现在这里。" />
        ) : (
          <div className="rounded-xl border border-ink-150 overflow-hidden bg-white/60">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-ink-50/70 text-[11.5px] text-ink-500">
                  <th className="px-3 py-2.5 font-medium">学生</th>
                  <th className="px-2 py-2.5 font-medium w-[88px]">尾号</th>
                  <th className="px-2 py-2.5 font-medium w-[160px]">注册时间</th>
                  <th className="px-2 py-2.5 font-medium w-[140px] text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => {
                  const student = request.student || {}
                  const suffix = accountCodeSuffix(student.accountCode, student.accountCodeSuffix)
                  const seed = student.avatarSeed || student.accountCode || suffix
                  return (
                    <tr key={request.id} className="border-t border-ink-150/70">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold text-white shrink-0"
                            style={{ background: seedAvatarTone(seed) }}
                          >
                            {(student.displayName || '?').slice(0, 1)}
                          </span>
                          <span className="text-[13px] font-medium text-ink-900">{student.displayName || '未返回姓名'}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-[12px] tabular-nums text-ink-600">{suffix}</td>
                      <td className="px-2 py-2.5 text-[11.5px] text-ink-500">{formatIsoTime(request.requestedAt)}</td>
                      <td className="px-2 py-2.5 text-right">
                        <div className="flex justify-end gap-1.5">
                          <Btn size="sm" tone="primary" disabled={actingId === request.id} onClick={() => decide(request, 'approve')}>批准</Btn>
                          <Btn size="sm" disabled={actingId === request.id} onClick={() => decide(request, 'reject')}>拒绝</Btn>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {actionError && <p className="mt-3 text-[12.5px] text-danger-600">{actionError}</p>}
      </div>

      <ConfirmModal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => changeClassStatus(confirm)}
        title={confirm === 'disable' ? '停用班级' : '恢复班级'}
        desc={confirm === 'disable' ? '停用后不再接受新的加入或审批，成员与书架保留。' : '恢复后原班级关系重新生效。'}
        confirmText={confirm === 'disable' ? '停用' : '恢复'}
        tone={confirm === 'disable' ? 'danger' : 'primary'}
      />
    </PagePanel>
  )
}
