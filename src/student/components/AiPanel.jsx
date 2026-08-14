import { useEffect, useRef, useState } from 'react'
import { cx } from '../../shared/cx.js'
import { RuntimeIcon as Icon } from '../../shared/RuntimeIcon.jsx'
import { GlassPanel } from './Glass.jsx'
import MascotFrame from './MascotFrame.jsx'
import { MessageList, QuoteCards } from './AiMessages.jsx'
import AiHistory from './AiHistory.jsx'
import { useStudent } from '../state/StudentContext.jsx'

const AI_NAME = '竹娃'

// 竹娃对话面板（规格 §7.3／§7.4，Plan_6 §5）。
//
// 面板是「浮层」层级：比书页略实、后景轻微虚化，但正文仍然看得见——
// 学生问问题时不该失去阅读上下文（视觉母版三层玻璃）。
//
// 红线在这个文件里体现为三件事：
//   1. 输入区只有文字与语音转文字，**没有任何图片／文件上传入口**（红线 7）。
//   2. 额度只显示剩余提问次数、用量百分比与恢复时间，不出现 Token、价格与费用（红线 9）。
//   3. 任何异常态下仍然能继续阅读、翻历史对话、批注与加书签，面板不会把人锁死（§7.4）。

export default function AiPanel({ open, onClose, book, bookId, currentPageNo, blocker, safeMode, onJumpPage, onConfirmedInteraction, classroom }) {
  const { student, aiQuotes, clearAiQuotes, removeAiQuote, ai } = useStudent()
  const [draft, setDraft] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [voice] = useState('idle')
  const inputRef = useRef(null)

  const chat = ai.active
  const generating = !!ai.pending
  // offline 只是「这条发不出去、可以重试」，不该把输入框也锁掉；其余异常态才停用输入
  const hardBlock = ai.status === 'loading' || (blocker && blocker.key !== 'offline')

  useEffect(() => {
    if (open) ai.clearUnread()
  }, [open, ai.clearUnread])

  // 面板一打开就把光标放进输入框；带着引文进来时更需要直接开始打字
  useEffect(() => {
    if (open && !hardBlock) inputRef.current?.focus()
  }, [open, hardBlock])

  if (!open) return null

  const submit = () => {
    if (hardBlock) return
    if (!draft.trim() && !aiQuotes.length) return
    ai.send({
      text: draft,
      quotes: aiQuotes,
      bookId,
      currentPageNo,
      blocker: blocker?.key === 'offline' ? 'offline' : null,
      safe: safeMode,
      visible: true,
    })
    onConfirmedInteraction?.()
    setDraft('')
    clearAiQuotes()
  }

  return (
    <GlassPanel tone="float" className="student-ai-panel" role="dialog" aria-label={`${AI_NAME}对话`} data-reader-ui="">
      {/* 顶部：竹娃身份 + 当前对话名 + 重命名 + 历史 + 新建 */}
      <header className="student-ai-bar">
        {/* 素材本身四周留白多，所以放进一个裁切盒里再上移，
            绝不能直接给负 margin —— 那样精灵图会顶到面板外面去，
            历史对话浮层盖不住它，猫耳朵会飘在浮层上层（第一轮自检抓到的问题）。 */}
        <span className="student-ai-hero-box">
          <MascotFrame state={generating ? 'waiting' : 'idle'} size={96} animate className="student-ai-hero" />
        </span>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                const title = new FormData(e.currentTarget).get('title')
                if (chat?.id && typeof title === 'string') ai.renameChat(chat.id, title)
                setRenaming(false)
              }}
            >
              <input
                autoFocus
                name="title"
                defaultValue={chat?.title}
                onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
                maxLength={24}
                aria-label="对话名称"
                className="student-ai-rename"
              />
              <button type="submit" className="student-ai-mini" data-reader-ui="">
                好了
              </button>
            </form>
          ) : (
            <div className="flex min-w-0 items-center gap-1.5">
              <h2 className="truncate font-serif text-title font-bold text-ink-900" title={chat?.title || '新的对话'}>
                {chat?.title || '新的对话'}
              </h2>
              {chat?.private && (
                <span className="student-ai-badge student-ai-badge--lock shrink-0">
                  <Icon name="Lock" className="h-3 w-3" strokeWidth={2.2} />
                  私密
                </span>
              )}
              {chat?.classroom && (
                <span className="student-ai-badge student-ai-badge--teacher shrink-0">
                  <Icon name="Users" className="h-3 w-3" strokeWidth={2.2} />
                  课堂
                </span>
              )}
              {chat && (
                <button
                  type="button"
                  onClick={() => setRenaming(true)}
                  className="student-icon-btn shrink-0"
                  aria-label="重命名这个对话"
                  title="重命名"
                  data-reader-ui=""
                >
                  <Icon name="PenLine" className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          <p className="truncate text-micro text-ink-400" title="竹娃只看这本书、你选中的段落和你已经读过的部分">
            正在读《{book.title || '服务端未返回书名'}》 · 只聊这本书里的事
          </p>
        </div>

        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          aria-expanded={historyOpen}
          className="student-reader-btn"
          title="历史对话、私密会话与最近删除"
          data-reader-ui=""
        >
          <Icon name="History" className="h-4 w-4" />
          历史
        </button>
        <button
          type="button"
          onClick={() => {
            clearAiQuotes()
            ai.newChat(bookId)
            setHistoryOpen(false)
          }}
          className="student-reader-btn"
          title="新建一个对话，上下文各自独立"
          data-reader-ui=""
        >
          <Icon name="Plus" className="h-4 w-4" />
          新对话
        </button>
        <button type="button" onClick={onClose} className="student-icon-btn" aria-label={`收起${AI_NAME}`} data-reader-ui="">
          <Icon name="X" className="h-4 w-4" />
        </button>
      </header>

      {/* 额度：剩余提问次数 + 今日用量百分比 + 恢复时间，三件事同时给（Plan_6 §5） */}
      <div className="student-ai-quota" title="额度与恢复时间只展示服务端返回值">
        <span className="student-ai-quota-chip">
          <Icon name="MessageCircle" className="h-3.5 w-3.5" strokeWidth={2} />
          今天还能问 <b className="tabular-nums">{ai.quota.remaining ?? '服务端未返回'}</b>{ai.quota.remaining != null ? ' 次' : ''}
        </span>
        <span className="student-ai-quota-chip">
          <Icon name="Gauge" className="h-3.5 w-3.5" strokeWidth={2} />
          今日用量 <b className="tabular-nums">{ai.quota.usagePercent != null ? `${ai.quota.usagePercent}%` : '服务端未返回'}</b>
        </span>
        <span className="student-ai-quota-chip">
          <Icon name="Clock" className="h-3.5 w-3.5" strokeWidth={2} />
          {ai.quota.resetAt ? `${ai.quota.resetAt} 恢复` : '恢复时间未返回'}
        </span>
        {/* 进度条单占一行：跟 chip 挤在同一行时它只剩一小截，看起来像装饰 */}
        <span className="student-ai-quota-track" aria-hidden="true">
          <span className="student-ai-quota-fill" style={{ width: `${Number.isFinite(ai.quota.usagePercent) ? ai.quota.usagePercent : 0}%` }} />
        </span>
      </div>

      {/* 消息区 */}
      {chat && chat.messages.length > 0 ? (
        <MessageList
          messages={chat.messages}
          studentName={student.name}
          onJumpPage={onJumpPage}
          onRetry={ai.retry}
          onFeedback={ai.feedback}
        />
      ) : (
        <EmptyChat book={book} classroom={classroom} />
      )}

      {/* 异常与受控状态：说清发生了什么 + 现在还能做什么，绝不只写一句「不可用」 */}
      {blocker && <BlockerCard blocker={blocker} />}

      {/* 输入区：文字 + 语音转文字 + 发送／停止。没有图片与文件上传入口（红线 7） */}
      <div className="student-ai-compose">
        {aiQuotes.length > 0 && (
          <div className="student-ai-pending">
            <div className="flex items-center gap-1.5">
              <span className="text-micro font-semibold text-ink-600">
                带上 {aiQuotes.length} 段原文一起问
              </span>
              <button type="button" onClick={clearAiQuotes} className="student-ai-mini ml-auto" data-reader-ui="">
                全部去掉
              </button>
            </div>
            <QuoteCards quotes={aiQuotes} onJumpPage={onJumpPage} onRemove={removeAiQuote} />
          </div>
        )}

        <div className="student-ai-inputrow">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            rows={2}
            maxLength={300}
            disabled={hardBlock}
            placeholder={hardBlock ? '现在先专心读书，等一下再问' : `问问${AI_NAME}这一页里的事，回车发送`}
            aria-label={`问${AI_NAME}`}
            className="student-ai-input"
          />
          <div className="flex shrink-0 flex-col gap-1.5">
            <button
              type="button"
              disabled
              aria-pressed={voice === 'listening'}
              className={cx('student-ai-iconbtn', voice === 'listening' && 'student-ai-iconbtn--on')}
              title="语音转文字接口尚未接入，未生成演示识别内容"
              data-reader-ui=""
            >
              <Icon name={voice === 'listening' ? 'Square' : 'Mic'} className="h-4 w-4" strokeWidth={2} />
            </button>
            {generating ? (
              <button
                type="button"
                disabled
                title="回答正在由服务端完整生成并校验引用，暂不支持中途停止"
                className="student-ai-sendbtn student-ai-sendbtn--stop cursor-not-allowed opacity-65"
                data-reader-ui=""
              >
                <Icon name="LoaderCircle" className="h-4 w-4 animate-spin" strokeWidth={2.1} />
                生成中
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={hardBlock || (!draft.trim() && !aiQuotes.length)}
                className="student-ai-sendbtn"
                data-reader-ui=""
              >
                <Icon name="Send" className="h-4 w-4" strokeWidth={2.2} />
                发送
              </button>
            )}
          </div>
        </div>
        <p className="student-ai-foot">
          书页和选中的原文由系统直接引用，不用你上传图片或文件。语音只会变成文字保存。
        </p>
      </div>

      {historyOpen && (
        <AiHistory
          chats={ai.chats}
          trash={ai.trash}
          activeId={ai.activeId}
          onSelect={(id) => {
            ai.selectChat(id)
            setHistoryOpen(false)
          }}
          onRename={ai.renameChat}
          onTogglePrivate={ai.togglePrivate}
          onDelete={ai.deleteChat}
          onRestore={ai.restoreChat}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </GlassPanel>
  )
}

// 空会话引导（UI 清单 S-05：AI 面板标题区与空会话引导）。
// 引导语给的是「能问什么」，不是营销话术，也不出现开发字样。
function EmptyChat({ book, classroom }) {
  const tips = [
    '长按正文选一段，再点「问竹娃」，它就知道你说的是哪一句',
    '可以问「这句话是什么意思」「他为什么这么做」',
    '也可以让它帮你把刚读过的这一章理一遍',
  ]
  return (
    <div className="student-ai-empty">
      <MascotFrame state="waving" size={192} animate />
      <p className="student-ai-empty-title">
        我在读《{book.title || '服务端未返回书名'}》，读到你现在这一页
      </p>
      <p className="student-ai-empty-desc">
        我只知道你已经读过的部分，后面的内容不会提前告诉你。
      </p>
      <ul className="student-ai-empty-tips">
        {tips.map((t) => (
          <li key={t}>
            <Icon name="Sparkles" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#2FA38C]" strokeWidth={2} />
            <span>{t}</span>
          </li>
        ))}
      </ul>
      {classroom?.mode === 'sync' && (
        <p className="student-ai-empty-note">现在是课堂同步，老师提问的回答也会出现在这里。</p>
      )}
    </div>
  )
}

// 异常态卡片
function BlockerCard({ blocker }) {
  return (
    <div className={cx('student-ai-blocker', `student-ai-blocker--${blocker.tone}`)} role="status">
      <MascotFrame state={blocker.key === 'indexing' ? 'review' : 'failed'} size={48} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="student-ai-blocker-title">
          <Icon name={blocker.icon} className="h-4 w-4 shrink-0" strokeWidth={2.1} />
          {blocker.title}
        </p>
        <p className="student-ai-blocker-desc">{blocker.desc}</p>
        <p className="student-ai-blocker-can">
          <Icon name="Check" className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} />
          {blocker.stillCan}
        </p>
      </div>
    </div>
  )
}
