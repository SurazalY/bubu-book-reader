import { useEffect, useRef, useState } from 'react'
import { cx } from '../../shared/cx.js'
import { RuntimeIcon as Icon } from '../../shared/RuntimeIcon.jsx'
import MascotFrame from './MascotFrame.jsx'
import { useStudent } from '../state/StudentContext.jsx'

const AI_NAME = '竹娃'

// 竹娃在阅读器里的收叠与唤出（规格 §7.2）：
//   - 收叠在阅读器就近的页面边缘（96px，一半藏在边缘外）
//   - 第一次点击探出并播放短时待机动作（192px，waving → idle）
//   - 再次点击打开完整对话面板
//   - 探出后无操作数秒内退回边缘
//   - 动作不能遮挡正文，也不能持续吸引注意力
//
// 「视线朝向」用素材第 9／10 行的 16 格方向表：学生选中某段时，竹娃看向那一段。
// 这是素材槽自带的能力，换成学校正式竹娃素材时只要方向表还在就继续生效。

const TUCK_MS = 4200 // 探出后多久没人理就退回边缘

export default function MascotDock({ onOpen, panelOpen, unread, quoteCount, lookDegrees, blockerKey }) {
  const { prefs, setPref } = useStudent()
  const [out, setOut] = useState(false)
  const [greeting, setGreeting] = useState(false)
  const timer = useRef(0)
  const greet = useRef(0)

  const armTuck = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOut(false), TUCK_MS)
  }

  useEffect(() => () => {
    window.clearTimeout(timer.current)
    window.clearTimeout(greet.current)
  }, [])

  // 新的引文进来（学生刚点了「问竹娃」）就探出一下，给一个「我收到了」的回应
  useEffect(() => {
    if (!quoteCount || panelOpen) return
    setOut(true)
    setGreeting(false)
    armTuck()
  }, [quoteCount, panelOpen])

  // 有没读的回答或课堂广播时保持探出，不然学生根本看不到提醒
  useEffect(() => {
    if (unread > 0 && !panelOpen) {
      setOut(true)
      window.clearTimeout(timer.current)
    }
  }, [unread, panelOpen])

  if (panelOpen) return null

  const click = () => {
    if (!prefs.mascotIntro) setPref('mascotIntro', true) // 引导只出现一次
    if (!out) {
      // 第一次点击：探出并打招呼，几秒不理就自己退回去
      setOut(true)
      setGreeting(true)
      window.clearTimeout(greet.current)
      greet.current = window.setTimeout(() => setGreeting(false), 900)
      armTuck()
      return
    }
    onOpen()
  }

  // 状态优先级：异常 > 有未读 > 刚探出打招呼 > 待机
  const state = blockerKey && blockerKey !== 'offline' ? 'failed' : unread > 0 ? 'jumping' : greeting ? 'waving' : 'idle'
  // 收叠时用中性朝向，探出后才跟着选区看
  const look = out && lookDegrees != null && state === 'idle' ? lookDegrees : null

  return (
    <div className={cx('student-mascot-dock', out && 'student-mascot-dock--out')} data-reader-ui="">
      {!out && !prefs.mascotIntro && (
        <span className="student-mascot-tip">
          点我一下，我陪你读
        </span>
      )}
      {out && (
        <span className="student-mascot-say">
          {unread > 0
            ? '我写好了，来看看'
            : quoteCount > 0
              ? `带着 ${quoteCount} 段原文，问我吧`
              : `再点一下就打开${AI_NAME}`}
        </span>
      )}
      <button
        type="button"
        onClick={click}
        onPointerEnter={() => out && armTuck()}
        className="student-mascot-btn"
        aria-label={out ? `打开${AI_NAME}对话` : `叫${AI_NAME}出来`}
        title={out ? `打开${AI_NAME}对话` : `叫${AI_NAME}出来`}
      >
        <MascotFrame state={state} size={out ? 192 : 96} lookDegrees={look} animate />
        {(unread > 0 || quoteCount > 0) && (
          <span className={cx('student-mascot-badge', unread > 0 && 'student-mascot-badge--new')}>
            {unread > 0 ? (
              <>
                <Icon name="Sparkles" className="h-3 w-3" strokeWidth={2.4} />
                {unread}
              </>
            ) : (
              <>
                <Icon name="Quote" className="h-3 w-3" strokeWidth={2.4} />
                {quoteCount}
              </>
            )}
          </span>
        )}
      </button>
    </div>
  )
}
