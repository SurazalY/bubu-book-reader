import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../../shared/cx.js'
import { RuntimeIcon as Icon } from '../../shared/RuntimeIcon.jsx'
import { Btn, IconBtn } from './Controls.jsx'

// 弹窗与侧栏：按交付说明「不做全屏重模态」——遮罩只轻微压暗并柔化后景，
// 弹窗本体是略实的玻璃，Esc 与点击遮罩都能关，焦点回到触发元素由调用方负责。

function useEscape(open, onClose) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
}

export function Modal({ open, onClose, title, desc, icon, footer, width = 'max-w-[620px]', children }) {
  const boxRef = useRef(null)
  useEscape(open, onClose)

  useEffect(() => {
    if (open) boxRef.current?.focus()
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center px-6 py-[7vh]">
      <div className="console-scrim absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={boxRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'console-float console-pop relative w-full rounded-2xl outline-none flex flex-col max-h-[86vh]',
          width,
        )}
      >
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-ink-150/70">
          {icon && (
            <span className="w-8 h-8 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
              <Icon name={icon} className="w-4 h-4" strokeWidth={1.9} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-[16px] font-bold text-ink-900">{title}</h2>
            {desc && <p className="text-[12px] text-ink-500 mt-1">{desc}</p>}
          </div>
          <IconBtn icon="X" title="关闭" onClick={onClose} />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto console-scroll px-5 py-4">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-ink-150/70">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  )
}

// 确认框：删除/下架/驳回这类动作统一用它，必须说清影响与可否恢复
export function ConfirmModal({ open, onClose, onConfirm, title, desc, confirmText = '确认', tone = 'danger' }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      icon={tone === 'danger' ? 'TriangleAlert' : 'CircleHelp'}
      width="max-w-[440px]"
      footer={
        <>
          <Btn onClick={onClose}>取消</Btn>
          <Btn tone={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmText}
          </Btn>
        </>
      }
    >
      <p className="text-[13px] text-ink-700 leading-relaxed">{desc}</p>
    </Modal>
  )
}

// 右侧抽屉：学生详情、额度详情这类「看一眼就回列表」的场景，不打断列表位置
export function SideSheet({ open, onClose, title, desc, footer, width = 'w-[420px]', children }) {
  useEscape(open, onClose)
  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="console-scrim absolute inset-0" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx('console-float console-slide-in relative h-full flex flex-col shadow-e4', width)}
      >
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-ink-150/70">
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-[16px] font-bold text-ink-900 truncate">{title}</h2>
            {desc && <p className="text-[12px] text-ink-500 mt-1 truncate">{desc}</p>}
          </div>
          <IconBtn icon="X" title="关闭" onClick={onClose} />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto console-scroll px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-ink-150/70">{footer}</div>
        )}
      </aside>
    </div>,
    document.body,
  )
}
