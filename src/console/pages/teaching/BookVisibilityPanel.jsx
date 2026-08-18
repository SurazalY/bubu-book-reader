import { useMemo, useState } from 'react'

import { GlassCard } from '../../components/Glass.jsx'
import { Btn, Chip, Field, StatusTag, SubHead } from '../../components/Controls.jsx'
import { ConfirmModal, Modal } from '../../components/Overlay.jsx'
import useBookVisibility from '../../state/useBookVisibility.js'
import useBookWriteActions from '../../state/useBookWriteActions.js'
import {
  classDisplayName,
  describeVisibilityImpact,
  describeVisibilitySaveResult,
  formatBookWriteError,
  previewVisibilityImpact,
} from './bookManagement.js'

function sameIdSet(left, right) {
  const a = new Set(left || [])
  const b = new Set(right || [])
  if (a.size !== b.size) return false
  for (const id of a) {
    if (!b.has(id)) return false
  }
  return true
}

function currentClassIds(visibility) {
  if (visibility?.scope === 'classes') return Array.isArray(visibility.classIds) ? visibility.classIds : []
  return []
}

export default function BookVisibilityPanel({ workspaceId, bookId, onSaved }) {
  const resource = useBookVisibility(workspaceId, bookId)
  const writes = useBookWriteActions(workspaceId)
  const visibility = resource.data?.visibility || null
  const classes = resource.data?.classes || []
  const classesError = resource.data?.classesError || null
  const [editorOpen, setEditorOpen] = useState(false)
  const [draftScope, setDraftScope] = useState('organization')
  const [draftClassIds, setDraftClassIds] = useState([])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [feedback, setFeedback] = useState(null)

  const authorizedIds = useMemo(() => new Set(classes.map((item) => item.id)), [classes])
  const unmanagedIds = useMemo(
    () => currentClassIds(visibility).filter((id) => !authorizedIds.has(id)),
    [authorizedIds, visibility],
  )

  const preview = useMemo(
    () => previewVisibilityImpact(visibility?.references, { scope: draftScope, classIds: draftClassIds }),
    [draftClassIds, draftScope, visibility?.references],
  )
  const arrangementTotal = visibility?.references?.arrangements?.length || 0
  const impactText = describeVisibilityImpact(preview, { arrangementTotal })

  const unchanged = visibility
    && draftScope === visibility.scope
    && (draftScope === 'organization' || sameIdSet(draftClassIds, currentClassIds(visibility)))

  const canSave = draftScope === 'organization' || draftClassIds.length > 0
  const busy = writes.actionState.status === 'loading' && writes.actionState.action === 'visibility'

  const openEditor = () => {
    setDraftScope(visibility?.scope === 'classes' ? 'classes' : 'organization')
    setDraftClassIds(currentClassIds(visibility).filter((id) => authorizedIds.has(id)))
    setConfirmOpen(false)
    setEditorOpen(true)
  }

  const toggleClass = (id) => {
    setDraftClassIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  const save = async () => {
    try {
      const result = await writes.setBookVisibility(bookId, { scope: draftScope, classIds: draftClassIds })
      setConfirmOpen(false)
      setEditorOpen(false)
      setFeedback({ tone: 'success', message: describeVisibilitySaveResult(result?.impact) })
      resource.reload()
      onSaved?.(result)
    } catch (error) {
      setFeedback({ tone: 'danger', message: formatBookWriteError(error, 'visibility') })
    }
  }

  return (
    <GlassCard className="p-3.5">
      <SubHead
        icon="Users"
        title="班级可见范围"
        extra={
          <Btn
            size="sm"
            icon="PenLine"
            disabled={resource.status !== 'ready' || !visibility || Boolean(classesError)}
            title={classesError ? '班级列表读取失败，暂时不能编辑' : undefined}
            onClick={openEditor}
          >
            编辑
          </Btn>
        }
      />

      {resource.status === 'loading' && (
        <p className="text-[12.5px] text-ink-500 py-2">正在读取当前可见范围和可选班级。</p>
      )}
      {resource.status === 'error' && (
        <p role="alert" className="text-[12.5px] text-danger-700 py-2">
          {resource.error?.message || '可见范围暂时无法读取。'}
          <Btn size="sm" className="ml-2" onClick={resource.reload}>重试</Btn>
        </p>
      )}
      {resource.status === 'ready' && visibility && (
        <div className="space-y-2">
          <Field label="当前范围">
            {visibility.scope === 'classes' ? (
              <div className="space-y-1.5">
                <span>限定到 {currentClassIds(visibility).length} 个班级</span>
                <div className="flex flex-wrap gap-1.5">
                  {(visibility.classes || []).map((item) => (
                    <StatusTag key={item.id} tone="brand">
                      {classDisplayName(item)}
                    </StatusTag>
                  ))}
                </div>
              </div>
            ) : (
              <span>全组织可见</span>
            )}
          </Field>
          {arrangementTotal > 0 && (
            <p className="text-[11.5px] text-ink-500">
              当前有 {arrangementTotal} 个阅读安排引用本书
              {visibility.references?.classroomSessions?.length
                ? `，以及 ${visibility.references.classroomSessions.length} 个课堂锁书`
                : ''}
              。收窄范围不会删除这些安排，但未入选班级的学生将无法打开。
            </p>
          )}
          {classesError && (
            <p role="alert" className="text-[12.5px] text-warning-700">
              班级列表读取失败，当前可见范围可以查看，但暂时不能编辑。
              <Btn size="sm" className="ml-2" onClick={resource.reload}>重试</Btn>
            </p>
          )}
        </div>
      )}

      {feedback && (
        <p
          role="alert"
          className={feedback.tone === 'success' ? 'mt-2 text-[12.5px] text-success-700' : 'mt-2 text-[12.5px] text-danger-700'}
        >
          {feedback.message}
          {feedback.tone === 'danger' && writes.actionState.action === 'visibility' && (
            <Btn size="sm" className="ml-2" onClick={() => { setEditorOpen(true); setConfirmOpen(true) }}>
              重试
            </Btn>
          )}
        </p>
      )}

      <Modal
        open={editorOpen}
        onClose={() => !busy && setEditorOpen(false)}
        icon="Users"
        title="设置班级可见范围"
        desc="全组织可见时全校学生都能看到；限定班级后，未授权班级的学生完全看不到这本书。"
        width="max-w-[560px]"
        footer={
          <>
            <Btn disabled={busy} onClick={() => setEditorOpen(false)}>取消</Btn>
            <Btn tone="primary" disabled={!canSave || unchanged || busy} onClick={() => setConfirmOpen(true)}>
              保存前确认影响
            </Btn>
          </>
        }
      >
        <div className="space-y-3.5">
          <div>
            <span className="block text-[12px] text-ink-600 mb-1.5">可见范围</span>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={draftScope === 'organization'} onClick={() => setDraftScope('organization')}>
                全组织可见
              </Chip>
              <Chip active={draftScope === 'classes'} onClick={() => setDraftScope('classes')}>
                限定班级
              </Chip>
            </div>
          </div>

          {draftScope === 'classes' && (
            <div>
              <span className="block text-[12px] text-ink-600 mb-1.5">
                选择班级（已选 {draftClassIds.length} 个，含空班）
              </span>
              <div className="flex flex-wrap gap-1.5">
                {classes.map((item) => (
                  <Chip key={item.id} active={draftClassIds.includes(item.id)} onClick={() => toggleClass(item.id)}>
                    {classDisplayName(item)}
                    {Number(item.studentCount) === 0 ? '（空班）' : ''}
                  </Chip>
                ))}
              </div>
              {classes.length === 0 && (
                <p className="text-[11.5px] text-warning-700 mt-1.5">当前授权范围内没有可选班级。</p>
              )}
              {draftClassIds.length === 0 && (
                <p className="text-[11.5px] text-warning-700 mt-1.5">限定班级时至少选择一个班。</p>
              )}
            </div>
          )}

          {unmanagedIds.length > 0 && draftScope === 'classes' && (
            <p className="text-[11.5px] text-warning-700">
              当前范围还包含 {unmanagedIds.length} 个你管理范围外的班级；保存后范围将变成你勾选的班级。
            </p>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={confirmOpen}
        onClose={() => !busy && setConfirmOpen(false)}
        onConfirm={save}
        title="确认更新可见范围"
        desc={impactText}
        confirmText={busy ? '保存中…' : '确认保存'}
        tone={preview.losingClasses.length ? 'danger' : 'primary'}
      />
    </GlassCard>
  )
}
