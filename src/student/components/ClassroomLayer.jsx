import { cx } from '../../shared/cx.js'
import { RuntimeIcon as Icon } from '../../shared/RuntimeIcon.jsx'

// 课堂共读的状态表达（规格 §8，Codex 第 109 轮 Q7 定的颜色语义）：
//
//   蓝色柔和边缘光 = 锁定书籍：必须留在这本书，但可以自己翻页、选文、批注、问竹娃
//   紫色柔和边缘光 = 同步页面：全班跟随教师指定页面，教师选文以紫色标记同步过来
//
// 两条硬规则：
//   1. 光必须柔和、持续但**不闪烁**，而且只在屏幕最外沿，不能压住正文。
//   2. 颜色之外必须同时给文字状态与控制教师（红线 12），学生不能只靠颜色分辨自己被控成什么样。
//
// 主题色不允许覆盖这两种颜色（Plan_1 §3.4 业务语义色）。

export function ClassroomAura({ session }) {
  if (!session || session.mode === 'ended') return null
  return (
    <div
      className={cx('student-aura', `student-aura--${session.tone}`, session.connected === false && 'student-aura--lost')}
      aria-hidden="true"
    />
  )
}

export function ClassroomBar({
  session,
  hasBroadcast,
  onOpenBroadcast,
  onDismiss,
  onBackToSyncPage,
  offPage,
  teacherMark,
  onJumpMark,
}) {
  if (!session) return null
  const ended = session.mode === 'ended'
  const icon = ended ? 'CircleCheck' : session.mode === 'lock' ? 'BookLock' : 'MonitorPlay'

  return (
    <div className={cx('student-class-bar', `student-class-bar--${session.tone}`)} role="status" data-reader-ui="">
      <span className="student-class-dot" aria-hidden="true" />
      <Icon name={icon} className="h-4 w-4 shrink-0" strokeWidth={2.1} />

      <div className="min-w-0 flex-1">
        <p className="student-class-title">
          {session.label}
          {session.connected === false && (
            <span className="student-class-retry">
              <Icon name="Loader" className="h-3 w-3 shrink-0" strokeWidth={2.4} />
              正在重连
            </span>
          )}
        </p>
        <p className="student-class-desc">
          {session.teacher} 在带这节课
          {session.mode === 'sync' && session.page ? ` · 当前第 ${session.page} 页` : ''}
          {session.endAt ? ` · ${session.endAt}` : ''}
          {' · '}
          {session.desc}
        </p>
      </div>

      {/* 教师选文同步（§8.2）：正文里已经用淡紫上下粗线画出来了，
          这里再给一个「老师标了这句」的入口，颜色之外还有文字与位置 */}
      {teacherMark && (
        <button
          type="button"
          onClick={() => onJumpMark?.(teacherMark.page)}
          className="student-class-btn"
          title={`${teacherMark.teacher}在第 ${teacherMark.page} 页标了：${teacherMark.text}`}
          data-reader-ui=""
        >
          <Icon name="Highlighter" className="h-3.5 w-3.5" strokeWidth={2.1} />
          老师标了这句
        </button>
      )}

      {/* 学生自己翻走了：不硬拉回去，给一个「回到老师那一页」的按钮，
          否则手一滑就被拽回来，翻页会变得很难受 */}
      {session.mode === 'sync' && session.connected && offPage && (
        <button type="button" onClick={onBackToSyncPage} className="student-class-btn" data-reader-ui="">
          <Icon name="CornerUpLeft" className="h-3.5 w-3.5" strokeWidth={2.1} />
          回到第 {session.page} 页
        </button>
      )}

      {hasBroadcast && (
        <button type="button" onClick={onOpenBroadcast} className="student-class-btn student-class-btn--strong" data-reader-ui="">
          <Icon name="Sparkles" className="h-3.5 w-3.5" strokeWidth={2.1} />
          看老师的提问
        </button>
      )}

      {ended && (
        <button type="button" onClick={onDismiss} className="student-icon-btn" aria-label="知道了，收起这条提示" data-reader-ui="">
          <Icon name="X" className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
