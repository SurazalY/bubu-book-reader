import { useState } from 'react'

import { GlassCard } from '../../components/Glass.jsx'
import { Btn, EmptyState, StatusTag, SubHead } from '../../components/Controls.jsx'
import { ConfirmModal } from '../../components/Overlay.jsx'
import useBookVisibility from '../../state/useBookVisibility.js'
import useBookWriteActions from '../../state/useBookWriteActions.js'
import {
  CLASS_SHELF_EMPTY_MESSAGE,
  canManageClassShelf,
  classIdOfWorkspace,
  formatBookWriteError,
  formatClassTeacherCount,
  isBookOnClassShelf,
} from './bookManagement.js'

export function ClassTeacherCountBanner({ teacherCount }) {
  return (
    <p role="status" className="text-[12.5px] text-ink-600">
      {formatClassTeacherCount(teacherCount)}
    </p>
  )
}

export function ClassShelfEmptyHint({ className }) {
  return (
    <EmptyState
      icon="Library"
      title="本班书架是空的"
      desc={CLASS_SHELF_EMPTY_MESSAGE}
      className={className}
    />
  )
}

export default function BookVisibilityPanel({ workspace, bookId, onSaved }) {
  const classId = classIdOfWorkspace(workspace)
  const manage = canManageClassShelf(workspace)
  const resource = useBookVisibility(workspace?.id, classId)
  const writes = useBookWriteActions(workspace?.id)
  const [askRevoke, setAskRevoke] = useState(false)
  const [feedback, setFeedback] = useState(null)

  if (!manage) return null

  const items = resource.data?.items || []
  const onShelf = isBookOnClassShelf(items, bookId)
  const teacherCount = writes.teacherCount ?? resource.data?.teacherCount
  const busy = writes.actionState.status === 'loading' && writes.actionState.bookId === bookId

  const runGrant = async () => {
    try {
      const result = await writes.putClassShelfBook(classId, bookId)
      writes.applyTeacherCount(result?.teacherCount)
      setFeedback({ tone: 'success', message: '已投放到本班。只影响本班学生可见范围。' })
      resource.reload()
      onSaved?.(result)
    } catch (error) {
      setFeedback({ tone: 'danger', message: formatBookWriteError(error, 'grant') })
    }
  }

  const runRevoke = async () => {
    try {
      const result = await writes.deleteClassShelfBook(classId, bookId)
      writes.applyTeacherCount(result?.teacherCount)
      setAskRevoke(false)
      setFeedback({ tone: 'success', message: '已从本班撤下。其他班级不受影响。' })
      resource.reload()
      onSaved?.(result)
    } catch (error) {
      setFeedback({ tone: 'danger', message: formatBookWriteError(error, 'revoke') })
    }
  }

  return (
    <GlassCard className="p-3.5">
      <SubHead
        icon="Library"
        title="本班书架"
        extra={<ClassTeacherCountBanner teacherCount={teacherCount} />}
      />

      {resource.status === 'loading' && (
        <p className="text-[12.5px] text-ink-500 py-2">正在读取本班已投放图书。</p>
      )}
      {resource.status === 'error' && (
        <p role="alert" className="text-[12.5px] text-danger-700 py-2">
          {resource.error?.message || '本班书架暂时无法读取。'}
          <Btn size="sm" className="ml-2" onClick={resource.reload}>重试</Btn>
        </p>
      )}
      {resource.status === 'ready' && items.length === 0 && (
        <p className="text-[12.5px] text-ink-600 py-2">{CLASS_SHELF_EMPTY_MESSAGE}</p>
      )}
      {resource.status === 'ready' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusTag tone={onShelf ? 'success' : 'warning'} dot>
              {onShelf ? '已投放本班' : '未投放本班'}
            </StatusTag>
            <span className="text-[11.5px] text-ink-500">投放或撤下只改变本班，不影响书库和其他班级。</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {onShelf ? (
              <Btn tone="danger" icon="Archive" disabled={busy} onClick={() => setAskRevoke(true)}>
                从本班撤下
              </Btn>
            ) : (
              <Btn tone="primary" icon="Upload" disabled={busy} onClick={runGrant}>
                投放本班
              </Btn>
            )}
          </div>
        </div>
      )}

      {feedback && (
        <p
          role="alert"
          className={feedback.tone === 'success' ? 'mt-2 text-[12.5px] text-success-700' : 'mt-2 text-[12.5px] text-danger-700'}
        >
          {feedback.message}
          {feedback.tone === 'danger' && writes.actionState.action === 'revoke' && (
            <Btn size="sm" className="ml-2" onClick={() => setAskRevoke(true)}>重试</Btn>
          )}
          {feedback.tone === 'danger' && writes.actionState.action === 'grant' && (
            <Btn size="sm" className="ml-2" onClick={runGrant}>重试</Btn>
          )}
        </p>
      )}

      <ConfirmModal
        open={askRevoke}
        onClose={() => !busy && setAskRevoke(false)}
        onConfirm={runRevoke}
        title="确认从本班撤下"
        desc="撤下后，本班学生将无法新打开这本书。其他班级不受影响。阅读安排不会被删除。"
        confirmText={busy ? '处理中…' : '确认撤下'}
        tone="danger"
      />
    </GlassCard>
  )
}
