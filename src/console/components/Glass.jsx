import { forwardRef } from 'react'
import { cx } from '../../shared/cx.js'

// 玻璃面板三档实感（母版层级：主内容最实 → 一级栏中等 → 二级栏最透 → 浮层略实且后景轻微柔化）。
// 面板之间留缝隙露出背景，这是 Levitate 那种「背景始终可感知」的关键。
const tones = {
  solid: 'bg-white/92 border-white/70', // 主内容区
  rail: 'bg-white/80 border-white/60', // 一级功能栏
  sub: 'bg-white/68 border-white/55', // 二级功能栏
  float: 'bg-white/88 border-white/85', // 浮层 / 弹窗
  // 登录框那种极轻玻璃：内部几乎全透，只靠一条 2px 白描边加内高光成立，不带投影
  crystal: 'bg-white/16 border-2 border-white/60',
}

export function GlassPanel({ tone = 'solid', sheen = false, className, children, ...props }) {
  const crystal = tone === 'crystal'
  return (
    <div
      className={cx(
        'relative border backdrop-blur-xl',
        crystal ? 'console-crystal' : 'console-glass',
        tones[tone] || tones.solid,
        sheen && 'console-sheen',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

// 内容卡：比面板更轻，用于 KPI、图表、列表项分块。
// 转发 ref 是为了让页面能把某一张卡滚到可见区（如护眼锚点）。
export const GlassCard = forwardRef(function GlassCard({ className, sheen = false, children, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cx(
        'console-glass relative rounded-xl border border-white/70 bg-white/88 backdrop-blur-md shadow-e1',
        sheen && 'console-sheen',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
})
