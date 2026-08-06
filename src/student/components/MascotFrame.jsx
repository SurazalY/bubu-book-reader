import { useEffect, useState } from 'react'
import { cx } from '../../shared/cx.js'
import { MASCOT, mascotCell, mascotLookCell } from './mascotPresentation.js'
import { useStudent } from '../state/StudentContext.jsx'

// 竹娃单帧／循环播放器。素材是精灵图，按单元格偏移显示，
// 只允许整数倍缩放（192 / 96）并 image-rendering: pixelated，否则像素图放大发虚。
// Stage 4 的收叠、探出、待机、退回与视线跟随都基于这个组件，换素材不改结构。
export default function MascotFrame({ state = 'idle', size = 192, lookDegrees, animate = false, className }) {
  const { prefs } = useStudent()
  const conf = MASCOT.states[state] || MASCOT.states.idle
  const [frame, setFrame] = useState(0)

  // 「减少动态效果」下不播帧动画，只停在第一帧
  useEffect(() => {
    if (!animate || prefs.reduceMotion) {
      setFrame(0)
      return undefined
    }
    const timer = setInterval(() => {
      setFrame((f) => (conf.loop ? (f + 1) % conf.frames : Math.min(f + 1, conf.frames - 1)))
    }, 1000 / (conf.fps || 6))
    return () => clearInterval(timer)
  }, [animate, prefs.reduceMotion, conf.frames, conf.fps, conf.loop, state])

  const cell = lookDegrees == null ? mascotCell(state, frame) : mascotLookCell(lookDegrees)
  const scale = size / MASCOT.cellWidth
  const h = Math.round(MASCOT.cellHeight * scale)
  const src = `${import.meta.env.BASE_URL}${MASCOT.sprite}`

  return (
    <span
      className={cx('student-mascot-sprite block shrink-0', className)}
      role="img"
      aria-label="AI 阅读伙伴"
      style={{
        width: size,
        height: h,
        backgroundImage: `url("${src}")`,
        backgroundSize: `${MASCOT.columns * size}px ${MASCOT.rows * h}px`,
        backgroundPosition: `-${cell.column * size}px -${cell.row * h}px`,
        backgroundRepeat: 'no-repeat',
      }}
    />
  )
}
