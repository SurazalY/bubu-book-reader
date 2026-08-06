import { useEffect, useRef, useState } from 'react'
import { cx } from '../../shared/cx.js'
import { RuntimeIcon as Icon } from '../../shared/RuntimeIcon.jsx'

const TRASH_KEEP_NOTE = '最近删除内容与保留期限以服务端返回为准。'
const PRIVACY_RULES = ['私密状态只在服务端确认成功后生效。', '当前接口不可用时不会在本地伪造私密状态。']

// 历史对话面板（规格 §7.3 多对话切换 + §7.5 私密与最近删除）。
//
// 两条容易做错的地方，写在这里提醒后面的人：
//   1. 学生看**自己**的私密会话，标题与完整历史照常显示；只有未授权教师才只看到「私密会话 #编号」。
//      所以这里不做任何标题遮盖，只加一枚「私密」徽章。
//   2. 设为私密之前必须先让学生读到访问规则（§7.5 第 2 条），所以走一次确认卡，不是一个静默开关。
//
// 平板是触控设备，没有 hover，所以每项的操作按钮常驻显示，只压低对比度。

export default function AiHistory({
  chats,
  trash,
  activeId,
  onSelect,
  onRename,
  onTogglePrivate,
  onDelete,
  onRestore,
  onClose,
}) {
  const [tab, setTab] = useState('all')
  const [renaming, setRenaming] = useState(null)
  const [askPrivate, setAskPrivate] = useState(null)

  const list = tab === 'private' ? chats.filter((c) => c.private) : chats
  const target = chats.find((c) => c.id === askPrivate)

  return (
    <div className="student-ai-history" role="dialog" aria-label="历史对话" data-reader-ui="">
      <div className="flex items-center gap-2">
        <h3 className="font-serif text-title font-bold text-ink-900">历史对话</h3>
        <button type="button" onClick={onClose} className="ml-auto student-icon-btn" aria-label="关闭历史对话">
          <Icon name="X" className="h-4 w-4" />
        </button>
      </div>

      <div className="student-segment mt-2.5 inline-flex rounded-full p-1">
        {[
          { k: 'all', t: '全部', n: chats.length },
          { k: 'private', t: '私密', n: chats.filter((c) => c.private).length },
          { k: 'trash', t: '最近删除', n: trash.length },
        ].map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => setTab(t.k)}
            aria-pressed={tab === t.k}
            className={cx(
              'rounded-full px-3 py-1.5 text-micro transition',
              tab === t.k ? 'student-segment--on font-semibold text-ink-900' : 'text-ink-500 hover:text-ink-800',
            )}
          >
            {t.t}
            <span className="ml-1 tabular-nums opacity-60">{t.n}</span>
          </button>
        ))}
      </div>

      <div className="student-ai-history-body">
        {tab === 'trash' ? (
          trash.length ? (
            <>
              <p className="student-ai-history-note">{TRASH_KEEP_NOTE}</p>
              {trash.map((c) => (
                <div key={c.id} className="student-ai-conv">
                  <div className="min-w-0 flex-1">
                    <p className="student-ai-conv-title">{c.title}</p>
                    <p className="student-ai-conv-meta">
                      {c.deletedAt} · {c.messages.length} 条消息
                    </p>
                  </div>
                  <button type="button" onClick={() => onRestore(c.id)} className="student-ai-mini" data-reader-ui="">
                    <Icon name="RotateCcw" className="h-3.5 w-3.5" strokeWidth={2} />
                    恢复
                  </button>
                </div>
              ))}
            </>
          ) : (
            <p className="student-ai-history-empty">最近没有删除过对话。删掉的对话会先放在这里，可以恢复。</p>
          )
        ) : list.length ? (
          list.map((c) => (
            <div key={c.id} className={cx('student-ai-conv', c.id === activeId && 'student-ai-conv--on')}>
              {renaming === c.id ? (
                <RenameInput
                  initial={c.title}
                  onSave={(t) => {
                    onRename(c.id, t)
                    setRenaming(null)
                  }}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <>
                  <button type="button" onClick={() => onSelect(c.id)} className="min-w-0 flex-1 text-left" data-reader-ui="">
                    <p className="student-ai-conv-title">
                      {c.classroom && (
                        <span className="student-ai-badge student-ai-badge--teacher mr-1.5">
                          <Icon name="Users" className="h-3 w-3" strokeWidth={2.2} />
                          课堂
                        </span>
                      )}
                      {c.private && (
                        <span className="student-ai-badge student-ai-badge--lock mr-1.5">
                          <Icon name="Lock" className="h-3 w-3" strokeWidth={2.2} />
                          私密
                        </span>
                      )}
                      {c.title}
                    </p>
                    <p className="student-ai-conv-preview">
                      {c.messages[c.messages.length - 1]?.text || '还没有说话'}
                    </p>
                    <p className="student-ai-conv-meta">
                      {c.at} · {c.messages.length} 条消息
                    </p>
                  </button>
                  <div className="student-ai-conv-acts">
                    <button
                      type="button"
                      onClick={() => setRenaming(c.id)}
                      className="student-ai-conv-act"
                      aria-label={`重命名「${c.title}」`}
                      title="重命名"
                      data-reader-ui=""
                    >
                      <Icon name="PenLine" className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => (c.private ? onTogglePrivate(c.id) : setAskPrivate(c.id))}
                      className={cx('student-ai-conv-act', c.private && 'student-ai-conv-act--on')}
                      aria-label={c.private ? '改回普通会话' : '设为私密会话'}
                      title={c.private ? '改回普通会话' : '设为私密会话'}
                      data-reader-ui=""
                    >
                      <Icon name={c.private ? 'Lock' : 'Unlock'} className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(c.id)}
                      className="student-ai-conv-act student-ai-conv-act--danger"
                      aria-label={`删除「${c.title}」`}
                      title="删除（可在最近删除里恢复）"
                      data-reader-ui=""
                    >
                      <Icon name="Trash2" className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        ) : (
          <p className="student-ai-history-empty">还没有私密对话。想让某个对话只有自己看，在它右边点一下锁。</p>
        )}
      </div>

      {/* 会话少的时候列表下方会空一大片，所以固定给一条真有用的说明贴在底部，
          而不是让面板下半屏空着（Kimi 反例：内容只占上半屏） */}
      {tab !== 'trash' && !target && (
        <p className="student-ai-history-foot">
          每个对话各自记住自己聊过的内容，互不串。竹娃只看你已经读过的部分，所以换一本书最好新建一个对话。
        </p>
      )}

      {target && (
        <div className="student-ai-rules">
          <p className="student-ai-rules-title">
            <Icon name="Lock" className="h-4 w-4 shrink-0 text-[#6F5BD0]" strokeWidth={2.1} />
            把「{target.title}」设为私密之前，先看清这几条
          </p>
          <ul className="student-ai-rules-list">
            {PRIVACY_RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <div className="mt-2.5 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setAskPrivate(null)} className="student-tray-btn student-tray-btn--ghost" data-reader-ui="">
              先不设置
            </button>
            <button
              type="button"
              onClick={() => {
                onTogglePrivate(target.id)
                setAskPrivate(null)
              }}
              className="student-primary-btn rounded-full px-4 py-2 text-caption font-semibold text-ink-900"
              data-reader-ui=""
            >
              我知道了，设为私密
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function RenameInput({ initial, onSave, onCancel }) {
  const [text, setText] = useState(initial)
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(text)
      }}
    >
      <input
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        maxLength={24}
        aria-label="对话名称"
        className="student-ai-rename"
      />
      <button type="submit" className="student-ai-mini" data-reader-ui="">
        保存
      </button>
      <button type="button" onClick={onCancel} className="student-ai-mini" data-reader-ui="">
        取消
      </button>
    </form>
  )
}
