import { useEffect, useRef, useState } from 'react'
import { cx } from '../../shared/cx.js'
import { RuntimeIcon as Icon } from '../../shared/RuntimeIcon.jsx'
import MascotFrame from './MascotFrame.jsx'

const AI_NAME = '竹娃'

// 竹娃对话的消息层次（规格 §7.3）：
//   学生消息 = 紧凑半透明卡片；竹娃回复 = 不套卡片的宽正文区（长回答要好读）。
//   课堂广播的教师提问与课堂 AI 回复额外带教师标识（§8.3），颜色用淡紫，与学生自己的淡青蓝区分。
//
// 「逐字呈现」不是流式：文本早就完整拿到并校验过了（见 state/useAiChats.js 的说明），
// 这里只负责把已显示部分画出来，末尾补一个闪烁光标。

export function MessageList({ messages, studentName, onJumpPage, onRetry, onFeedback }) {
  const endRef = useRef(null)
  // 新消息与逐字过程中都保持贴底，否则学生要一直手动往下滑
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  return (
    <div className="student-ai-list" role="log" aria-label={`与${AI_NAME}的对话`}>
      {messages.map((m) => (
        <Message
          key={m.id}
          m={m}
          studentName={studentName}
          onJumpPage={onJumpPage}
          onRetry={onRetry}
          onFeedback={onFeedback}
        />
      ))}
      <span ref={endRef} aria-hidden="true" />
    </div>
  )
}

function Message({ m, studentName, onJumpPage, onRetry, onFeedback }) {
  if (m.role === 'student') return <StudentMessage m={m} studentName={studentName} onJumpPage={onJumpPage} onRetry={onRetry} />
  if (m.role === 'teacher') return <TeacherMessage m={m} onJumpPage={onJumpPage} />
  return <AiMessage m={m} onJumpPage={onJumpPage} onRetry={onRetry} onFeedback={onFeedback} />
}

// —— 学生消息 ——
function StudentMessage({ m, studentName, onJumpPage, onRetry }) {
  const failed = m.sendState === 'failed'
  return (
    <div className="student-ai-row student-ai-row--me">
      <div className={cx('student-ai-me', failed && 'student-ai-me--failed')}>
        <div className="student-ai-head">
          <span className="student-ai-who">{studentName}</span>
          <span className="student-ai-time tabular-nums">{m.at}</span>
        </div>
        {m.quotes?.length > 0 && <QuoteCards quotes={m.quotes} onJumpPage={onJumpPage} />}
        {m.text && <p className="student-ai-me-text">{m.text}</p>}
        {failed && (
          <div className="student-ai-failed">
            <Icon name="WifiOff" className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <span className="min-w-0 flex-1">没发出去，你写的字还在这里</span>
            <button
              type="button"
              disabled
              title="重新发送暂未开放；原问题仍保留在对话中"
              className="student-ai-mini cursor-not-allowed opacity-55"
              data-reader-ui=""
            >
              <Icon name="RotateCcw" className="h-3.5 w-3.5" strokeWidth={2} />
              重新发送
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// —— 教师课堂提问（广播）——
function TeacherMessage({ m, onJumpPage }) {
  return (
    <div className="student-ai-row">
      <div className="student-ai-teacher">
        <div className="student-ai-head">
          <span className="student-ai-badge student-ai-badge--teacher">
            <Icon name="UserCheck" className="h-3 w-3" strokeWidth={2.2} />
            教师提问
          </span>
          <span className="student-ai-who">{m.teacher}</span>
          <span className="student-ai-time tabular-nums">{m.at}</span>
        </div>
        {m.quotes?.length > 0 && <QuoteCards quotes={m.quotes} onJumpPage={onJumpPage} teacher />}
        <p className="student-ai-me-text">{m.text}</p>
      </div>
    </div>
  )
}

// —— 竹娃回复 / 课堂 AI 回复 ——
function AiMessage({ m, onJumpPage, onRetry, onFeedback }) {
  const isClass = m.role === 'classAi'
  const empty = !m.text && m.typing
  return (
    <div className={cx('student-ai-row student-ai-row--ai', isClass && 'student-ai-row--class')}>
      <MascotFrame state={m.typing ? 'review' : 'idle'} size={48} animate={m.typing} className="student-ai-avatar" />
      <div className="min-w-0 flex-1">
        <div className="student-ai-head">
          {isClass ? (
            <span className="student-ai-badge student-ai-badge--teacher">
              <Icon name="Users" className="h-3 w-3" strokeWidth={2.2} />
              课堂 AI 回复
            </span>
          ) : (
            <span className="student-ai-who">{AI_NAME}</span>
          )}
          <span className="student-ai-time tabular-nums">{m.at}</span>
          {isClass && <span className="student-ai-time">全班收到的是同一条回复</span>}
        </div>

        {empty ? (
          <p className="student-ai-thinking">
            {AI_NAME}正在把这一段再读一遍
            <span className="student-ai-caret" aria-hidden="true">
              ▊
            </span>
          </p>
        ) : (
          <div className="student-ai-body">
            {m.text.split('\n').map((line, i) =>
              line.trim() ? (
                <p key={i}>{line}</p>
              ) : (
                <span key={i} className="student-ai-gap" aria-hidden="true" />
              ),
            )}
            {m.typing && (
              <span className="student-ai-caret" aria-hidden="true">
                ▊
              </span>
            )}
          </div>
        )}

        {m.stopped && (
          <p className="student-ai-stopped">
            <Icon name="Square" className="h-3 w-3 shrink-0" strokeWidth={2.4} />
            你让它停下了，这条只写到一半
          </p>
        )}

        {/* AI 回答里的原文依据：真实页码 + 原文，默认折叠（Plan_6 §5）。
            页码不是模型自己填的，正式版由后端校验引用属于本书版本与已读范围后再映射。 */}
        {!m.typing && m.refs?.length > 0 && <RefsFold refs={m.refs} onJumpPage={onJumpPage} />}

        {!m.typing && (
          <div className="student-ai-acts">
            {/* 课堂广播是「教师问一次、系统生成一次、全班收到同一条」（§8.3），
                学生这边不能重新生成，否则就变成每人各自调一次 AI 了 */}
            {isClass ? (
              <span className="student-ai-fbnote">这条是全班一起收到的，不能单独重新生成</span>
            ) : (
              <button
                type="button"
                disabled
                className="student-ai-mini cursor-not-allowed opacity-55"
                title="重新回答暂未开放；可以在输入框继续追问"
                data-reader-ui=""
              >
                <Icon name="RotateCcw" className="h-3.5 w-3.5" strokeWidth={2} />
                重新回答
              </button>
            )}
            <span className="flex-1" />
            <button
              type="button"
              disabled
              aria-pressed={m.feedback === 'up'}
              className={cx('student-ai-mini cursor-not-allowed opacity-55', m.feedback === 'up' && 'student-ai-mini--on')}
              title="回答反馈暂未开放，不会伪造保存结果"
              data-reader-ui=""
            >
              <Icon name="ThumbsUp" className="h-3.5 w-3.5" strokeWidth={2} />
              有帮助
            </button>
            <button
              type="button"
              disabled
              aria-pressed={m.feedback === 'down'}
              className={cx('student-ai-mini cursor-not-allowed opacity-55', m.feedback === 'down' && 'student-ai-mini--off')}
              title="回答反馈暂未开放，不会伪造保存结果"
              data-reader-ui=""
            >
              <Icon name="ThumbsDown" className="h-3.5 w-3.5" strokeWidth={2} />
              没帮上
            </button>
          </div>
        )}
        {m.feedback && (
          <p className="student-ai-fbnote">
            {m.feedback === 'up' ? '谢谢，你的反馈会用来改进竹娃的回答。' : '已记下。你可以点「重新回答」再试一次。'}
          </p>
        )}
      </div>
    </div>
  )
}

// 学生发出的引文卡片：至少保留书籍、页码与原文范围（UI 清单 S-04）
export function QuoteCards({ quotes, onJumpPage, onRemove, teacher }) {
  return (
    <div className="student-ai-quotes">
      {quotes.map((q, i) => (
        <div key={q.key || `${q.page}-${i}`} className={cx('student-ai-quote', teacher && 'student-ai-quote--teacher')}>
          <div className="student-ai-quote-meta">
            <Icon name="BookOpen" className="h-3 w-3 shrink-0" strokeWidth={2} />
            <span className="truncate">{q.title || '这本书'}</span>
            <button
              type="button"
              onClick={() => onJumpPage?.(q.page)}
              className="student-ai-quote-page tabular-nums"
              title={`回到第 ${q.page} 页看原文`}
              data-reader-ui=""
            >
              第 {q.page} 页
            </button>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(q.key)}
                className="student-ai-quote-x"
                aria-label={`移除第 ${q.page} 页这段引文`}
                data-reader-ui=""
              >
                <Icon name="X" className="h-3 w-3" strokeWidth={2.6} />
              </button>
            )}
          </div>
          <p className="student-ai-quote-text">{q.text}</p>
        </div>
      ))}
    </div>
  )
}

// 原文依据折叠区
function RefsFold({ refs, onJumpPage }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="student-ai-refs">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="student-ai-refs-btn" data-reader-ui="">
        <Icon name={open ? 'ChevronDown' : 'ChevronRight'} className="h-3.5 w-3.5" strokeWidth={2.2} />
        它是根据这 {refs.length} 处原文说的
      </button>
      {open && (
        <div className="student-ai-refs-body">
          {refs.map((r, i) => (
            <button
              key={`${r.page}-${i}`}
              type="button"
              onClick={() => onJumpPage?.(r.page)}
              className="student-ai-ref"
              title={`回到第 ${r.page} 页`}
              data-reader-ui=""
            >
              <span className="student-ai-ref-page tabular-nums">第 {r.page} 页</span>
              <span className="student-mark-sel">{r.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
