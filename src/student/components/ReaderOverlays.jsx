import { useEffect, useRef, useState } from 'react'
import { cx } from '../../shared/cx.js'
import { RuntimeIcon as Icon } from '../../shared/RuntimeIcon.jsx'
import { GlassPanel } from './Glass.jsx'

// 选文工具栏（规格 §6.3）：固定四项「问竹娃｜收藏摘录｜添加批注｜取消」，
// 顺序与文案都不许改，也不许在这里塞书签——书签只标整页，放在页角。
// 定位贴近选区：默认在选区上方，离视口顶太近时翻到下方。
export function SelectionToolbar({ rect, onAsk, onSave, onNote, onCancel, saved }) {
  if (!rect) return null
  const cx2 = rect.left + rect.width / 2
  // rect 是「相对舞台」的坐标（浮层的实际定位基准就是舞台，见 Reader 里的 selRect 说明）。
  // 工具栏连间距约 54px 高，选区离舞台顶不够这么多就翻到选区下方，避免压住顶栏。
  const above = rect.top > 58
  const style = above
    ? { left: cx2, top: rect.top - 12, transform: 'translate(-50%, -100%)' }
    : { left: cx2, top: rect.bottom + 12, transform: 'translate(-50%, 0)' }
  return (
    <div className="student-sel-toolbar" style={style} role="toolbar" aria-label="选中文字后的操作" data-reader-ui="">
      <ToolBtn icon="Sparkles" label="问竹娃" onClick={onAsk} tone="mint" />
      <span className="student-sel-sep" />
      <ToolBtn icon={saved ? 'Check' : 'Highlighter'} label={saved ? '已收藏' : '收藏摘录'} onClick={onSave} />
      <span className="student-sel-sep" />
      <ToolBtn icon="PenLine" label="添加批注" onClick={onNote} />
      <span className="student-sel-sep" />
      <ToolBtn icon="X" label="取消" onClick={onCancel} />
    </div>
  )
}

function ToolBtn({ icon, label, onClick, tone }) {
  return (
    <button
      type="button"
      className={cx('student-sel-btn', tone === 'mint' && 'student-sel-btn--mint')}
      // 按下时不要让浏览器先清掉选区，否则点到按钮时选中的文字已经没了
      onPointerDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={onClick}
    >
      <Icon name={icon} className="h-3.5 w-3.5 shrink-0" strokeWidth={2.1} />
      {label}
    </button>
  )
}

// 首尾控制点（规格 §6.2 第 4 条：抬手后显示首尾控制点）。
// 前端壳里它是选区两端的视觉锚点，说明「这段是我选的、从哪到哪」，不做二次拖拽微调。
export function SelectionHandles({ rect }) {
  if (!rect) return null
  return (
    <>
      <span className="student-sel-handle" style={{ left: rect.left, top: rect.top }} aria-hidden="true" />
      <span className="student-sel-handle student-sel-handle--end" style={{ left: rect.right, top: rect.bottom }} aria-hidden="true" />
    </>
  )
}

// 跨页多段选文托盘（规格 §6.4）：
//   「已选 3 段，共 428 字」+ 页码标签回跳 + 单段移除 + 统一发送／收藏／批注。
// 关键点：翻页不清空托盘，学生可以边翻边攒段落。
export function SelectionTray({ items, onJump, onRemove, onAskAll, onSaveAll, onNoteAll, onClear }) {
  if (!items.length) return null
  const chars = items.reduce((n, it) => n + it.text.length, 0)
  return (
    <GlassPanel tone="float" className="student-tray" role="region" aria-label="跨页选文托盘">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className="shrink-0 text-caption font-semibold text-ink-800 tabular-nums">
          已选 {items.length} 段，共 {chars} 字
        </span>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {items.map((it) => (
            <span key={it.key} className="student-tray-chip">
              <button
                type="button"
                onClick={() => onJump(it.pages[0])}
                title={`回到第 ${it.pages.join('、')} 页看原文：${it.text.slice(0, 24)}…`}
                className="student-tray-chip-page"
              >
                第 {it.pages.join('、')} 页
              </button>
              <button
                type="button"
                onClick={() => onRemove(it.key)}
                aria-label={`移除第 ${it.pages.join('、')} 页这一段`}
                className="student-tray-chip-x"
              >
                <Icon name="X" className="h-3 w-3" strokeWidth={2.6} />
              </button>
            </span>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={onSaveAll} className="student-tray-btn">
          <Icon name="Highlighter" className="h-3.5 w-3.5" strokeWidth={2.1} />
          全部收藏
        </button>
        <button type="button" onClick={onNoteAll} className="student-tray-btn">
          <Icon name="PenLine" className="h-3.5 w-3.5" strokeWidth={2.1} />
          一起批注
        </button>
        <button type="button" onClick={onAskAll} className="student-tray-btn student-tray-btn--mint">
          <Icon name="Sparkles" className="h-3.5 w-3.5" strokeWidth={2.1} />
          问竹娃
        </button>
        <button type="button" onClick={onClear} className="student-tray-btn student-tray-btn--ghost" aria-label="清空托盘">
          清空
        </button>
      </div>
    </GlassPanel>
  )
}

// 批注编写弹层：规格只要求「允许学生写个人内容」，所以保持极简——
// 引文 + 一个输入框 + 保存／取消，不做富文本、不做标签分类。
export function NoteComposer({ quote, initial = '', onSave, onCancel }) {
  const [text, setText] = useState(initial)
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <div className="student-modal-mask" onClick={onCancel}>
      <GlassPanel
        tone="float"
        className="student-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="添加批注"
      >
        <h2 className="font-serif text-h3 font-bold text-ink-900">添加批注</h2>
        <blockquote className="student-note-quote">{quote}</blockquote>
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          maxLength={300}
          placeholder="写下你读到这里想到的事"
          className="student-note-input"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-micro text-ink-400 tabular-nums">{text.length} / 300</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onCancel} className="student-tray-btn student-tray-btn--ghost">
              取消
            </button>
            <button
              type="button"
              disabled={!text.trim()}
              onClick={() => onSave(text.trim())}
              className="student-primary-btn rounded-full px-5 py-2 text-caption font-semibold text-ink-900 disabled:opacity-45"
            >
              保存批注
            </button>
          </div>
        </div>
      </GlassPanel>
    </div>
  )
}

// 轻量提示条：收藏成功、已加入竹娃引文这类一次性反馈。
// 只出现两秒、不挡正文、不做「操作成功」这种空话，都写清楚落到哪里了。
export function ReaderToast({ toast }) {
  if (!toast) return null
  return (
    <div className="student-toast" role="status">
      <Icon name={toast.icon || 'Check'} className="h-4 w-4 shrink-0 text-[#2FA38C]" strokeWidth={2.4} />
      {toast.text}
    </div>
  )
}
