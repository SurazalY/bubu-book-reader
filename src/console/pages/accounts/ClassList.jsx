import { useCallback, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { createConsoleApi } from '../../../api/console.js'
import { useApiResource } from '../../../api/useApiResource.js'
import { Icon } from '../../../components/ui.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, EmptyState, SearchBox, StatusTag } from '../../components/Controls.jsx'
import { Modal } from '../../components/Overlay.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import { createIdentityConsoleApi } from './identityApi.js'
import {
  buildCreateClassBody,
  canCreateClass,
  CLASS_STAGES,
  GRADE_MANAGER_SCOPE_NOTE,
  stageLabel,
  teacherCountLabel,
  unwrapList,
} from './identityUi.js'

const consoleApi = createConsoleApi()
const identityApi = createIdentityConsoleApi()

export default function ClassList() {
  const { workspace } = useConsole()
  const navigate = useNavigate()
  const workspaceId = workspace?.id
  const load = useCallback(async () => {
    const response = await consoleApi.listAuthorizedClasses({ workspaceId })
    return { data: unwrapList(response.data), meta: response.meta }
  }, [workspaceId])
  const resource = useApiResource(load)
  const [keyword, setKeyword] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ name: '', stage: 'primary', entryYear: new Date().getFullYear(), classNumber: 1 })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const rows = useMemo(() => {
    const query = keyword.trim()
    return (resource.data || []).filter((klass) => {
      if (!query) return true
      return [klass.name, klass.gradeId, String(klass.entryYear), String(klass.classNumber)]
        .filter(Boolean)
        .some((value) => String(value).includes(query))
    })
  }, [keyword, resource.data])

  if (workspace?.scopeType === 'class' && workspace.scopeId) {
    return <Navigate to={`/console/accounts/classes/${workspace.scopeId}`} replace />
  }

  async function createClass() {
    const body = buildCreateClassBody(form)
    setSaving(true)
    setFormError('')
    try {
      await identityApi.createClass(body, { workspaceId })
      setCreateOpen(false)
      resource.reload()
    } catch (cause) {
      setFormError(cause?.message || '创建班级失败')
    } finally {
      setSaving(false)
    }
  }

  const allowCreate = canCreateClass(workspace?.scopeType)

  return (
    <PagePanel
      title={`${workspace?.scopeLabel || '当前范围'} · 班级`}
      desc={workspace?.scopeType === 'grade' ? GRADE_MANAGER_SCOPE_NOTE : '校长可预制全校班级；列表来自正式班级目录。'}
      toolbar={
        <>
          <SearchBox value={keyword} onChange={setKeyword} placeholder="搜索班级或届别" />
          {allowCreate && (
            <Btn tone="primary" icon="Plus" onClick={() => setCreateOpen(true)}>
              创建班级
            </Btn>
          )}
        </>
      }
    >
      {resource.status === 'error' ? (
        <EmptyState icon="TriangleAlert" title="班级目录加载失败" desc={resource.error?.message || '教师不能打开全校班级目录，请从本班详情进入。'} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="Users"
          title={resource.status === 'loading' ? '正在读取班级' : '当前范围没有班级'}
          desc={resource.status === 'loading' ? '正在向班级目录请求数据。' : '可以先创建一个班级，再发放学生注册凭据。'}
          action={allowCreate ? <Btn tone="primary" icon="Plus" onClick={() => setCreateOpen(true)}>创建班级</Btn> : null}
        />
      ) : (
        <div className="rounded-xl border border-ink-150 overflow-hidden bg-white/60">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-ink-50/70 text-[11.5px] text-ink-500">
                <th className="px-3 py-2.5 font-medium">班级</th>
                <th className="px-2 py-2.5 font-medium w-[120px]">学段 / 届</th>
                <th className="px-2 py-2.5 font-medium w-[88px]">学生</th>
                <th className="px-2 py-2.5 font-medium w-[120px]">教师</th>
                <th className="px-2 py-2.5 font-medium w-[88px]">待审</th>
                <th className="px-2 py-2.5 font-medium w-[84px]">状态</th>
                <th className="px-2 py-2.5 font-medium w-[72px] text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((klass) => (
                <tr key={klass.id} className="border-t border-ink-150/70 hover:bg-white/70 transition">
                  <td className="px-3 py-2.5">
                    <button type="button" className="text-left" onClick={() => navigate(`/console/accounts/classes/${klass.id}`)}>
                      <span className="block text-[13px] font-medium text-ink-900">{klass.name}</span>
                      <span className="block text-[11px] text-ink-400">{klass.gradeId}</span>
                    </button>
                  </td>
                  <td className="px-2 py-2.5 text-[12.5px] text-ink-700">
                    {stageLabel(klass.stage)} · {klass.entryYear} / {klass.classNumber} 班
                  </td>
                  <td className="px-2 py-2.5 text-[12.5px] tabular-nums">{klass.studentCount ?? '—'}</td>
                  <td className="px-2 py-2.5 text-[12.5px]">{teacherCountLabel(klass.teacherCount)}</td>
                  <td className="px-2 py-2.5 text-[12.5px] tabular-nums">{klass.pendingStudentCount ?? 0}</td>
                  <td className="px-2 py-2.5">
                    <StatusTag tone={klass.status === 'active' ? 'success' : 'muted'} dot>
                      {klass.status === 'active' ? '进行中' : klass.status === 'disabled' ? '已停用' : klass.status}
                    </StatusTag>
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <Btn size="sm" tone="ghost" onClick={() => navigate(`/console/accounts/classes/${klass.id}`)}>查看</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        icon="Plus"
        title="创建班级"
        desc={workspace?.scopeType === 'grade' ? '只写入本届班级，学段与入学年份必须属于当前年级工作空间。' : '写入学段、入学年份和班号；年级由服务端计算。'}
        width="max-w-[520px]"
        footer={
          <>
            <Btn onClick={() => setCreateOpen(false)}>取消</Btn>
            <Btn tone="primary" disabled={saving} onClick={createClass}>{saving ? '创建中…' : '创建'}</Btn>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="block text-[12px] text-ink-600 mb-1.5">班级名称</span>
            <input className="console-input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="block text-[12px] text-ink-600 mb-1.5">学段</span>
              <select className="console-input" value={form.stage} onChange={(event) => setForm((current) => ({ ...current, stage: event.target.value }))}>
                {CLASS_STAGES.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-[12px] text-ink-600 mb-1.5">入学年份</span>
              <input className="console-input" type="number" min="2000" max="2100" value={form.entryYear} onChange={(event) => setForm((current) => ({ ...current, entryYear: event.target.value }))} />
            </label>
            <label className="block">
              <span className="block text-[12px] text-ink-600 mb-1.5">班号</span>
              <input className="console-input" type="number" min="1" max="99" value={form.classNumber} onChange={(event) => setForm((current) => ({ ...current, classNumber: event.target.value }))} />
            </label>
          </div>
          {workspace?.scopeType === 'grade' && (
            <p className="text-[11.5px] text-ink-500 flex items-start gap-1.5">
              <Icon name="Info" className="w-3.5 h-3.5 mt-px shrink-0" />
              {GRADE_MANAGER_SCOPE_NOTE}
            </p>
          )}
          {formError && <p className="text-[12.5px] text-danger-600">{formError}</p>}
        </div>
      </Modal>
    </PagePanel>
  )
}
