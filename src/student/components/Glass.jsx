import { forwardRef } from 'react'
import { cx } from '../../shared/cx.js'

// 玻璃分档（母版层级：主内容最实 → 卡片 → 底栏最透 → 浮层略实且后景轻微柔化）。
// 面板之间留缝隙露出背景，这是「背景始终可感知」的关键，不要把整页铺成一块白板。
const tones = {
  solid: 'bg-white/92 border-white/70', // 主内容区、书页容器
  card: 'bg-white/86 border-white/68', // 书架卡、书单卡、数据卡
  nav: 'bg-white/70 border-white/62', // 底部一级导航
  float: 'bg-white/94 border-white/88', // 浮层 / 弹窗 / 选文工具栏
  // 登录框那种极轻玻璃：内部几乎全透，只靠一条 2px 白描边加内高光成立，不带投影
  crystal: 'bg-white/16 border-2 border-white/60',
}

export function GlassPanel({ tone = 'solid', sheen = false, className, children, ...props }) {
  const crystal = tone === 'crystal'
  return (
    <div
      className={cx(
        'relative border backdrop-blur-xl',
        crystal ? 'student-crystal' : 'student-glass',
        tones[tone] || tones.solid,
        sheen && 'student-sheen',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

// 内容卡：比面板更轻，用于书籍卡、书单卡、数据分块。
// 转发 ref 是为了让页面能把某张卡滚到可见区（后续 Stage 的锚点定位要用）。
export const GlassCard = forwardRef(function GlassCard({ className, sheen = false, children, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cx(
        'student-glass relative rounded-xl border border-white/68 bg-white/86 backdrop-blur-md',
        sheen && 'student-sheen',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
})
