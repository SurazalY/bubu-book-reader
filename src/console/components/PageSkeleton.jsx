import { cx } from '../../components/ui.jsx'
import { GlassPanel } from './Glass.jsx'

// 懒加载占位骨架（Plan_2 P9）。
// 拍板要求：fallback 必须用玻璃卡片骨架，**不许白屏闪烁**。
// 所以这里刻意复用 PagePanel 那套外框（tone="solid" + rounded-[26px] + min-h-full），
// 分块尺寸也照着真实页面的「标题 21px / 说明 12.5px / 内容行」来，
// 页面切进来时外框不跳、不闪、不改变滚动区高度。
//
// 动效：外框走 console-enter（reduce-motion 下自动降为 0.12s 淡入），
// 占位块走 console-skeleton-bar 的极轻脉动（reduce-motion 下 animation: none）。
// rows 默认 6：最初写 3 行，实测 1440x900 下只填到内容区约 1/3，
// 下半屏空一大片，看着像「这页内容很少」而不是「正在加载」。
// 6 行按真实列表行高（86px + 12px 间距）大致填满 desktop，tablet 刚好填满。
export default function PageSkeleton({ rows = 6, className }) {
  return (
    <GlassPanel
      tone="solid"
      className={cx('console-page console-enter rounded-[26px] overflow-hidden min-h-full flex flex-col', className)}
      aria-busy="true"
      aria-live="polite"
    >
      {/* 头部：一条标题条 + 一条说明条，右侧留出工具区的两个按钮位 */}
      <div className="flex items-start gap-4 px-6 pt-5 pb-4">
        <div className="min-w-0 flex-1">
          <Bar className="h-[21px] w-[220px] rounded-md" />
          <Bar className="h-[12.5px] w-[min(420px,72%)] rounded mt-2.5" />
        </div>
        <div className="flex items-center gap-2.5 shrink-0 pt-0.5">
          <Bar className="h-8 w-[92px] rounded-lg" />
          <Bar className="h-8 w-[92px] rounded-lg" />
        </div>
      </div>

      {/* 内容区：等高占位行，宽度按 3 个一组循环变化，看着像列表又不像某一页 */}
      <div className="flex-1 min-h-0 px-6 pb-6 space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="rounded-xl border border-ink-150/70 bg-white/45 p-3.5">
            <div className="flex items-center gap-2.5">
              <Bar className="h-7 w-7 rounded-lg shrink-0" />
              <Bar className="h-[13px] rounded" style={{ width: `${150 - (i % 3) * 22}px` }} />
              <div className="flex-1" />
              <Bar className="h-[20px] w-[64px] rounded-full" />
            </div>
            <Bar className="h-[11.5px] w-full rounded mt-3" />
            <Bar className="h-[11.5px] rounded mt-2" style={{ width: `${86 - (i % 3) * 12}%` }} />
          </div>
        ))}
      </div>

      {/* 读屏软件只读这一句，不去念一堆空占位块 */}
      <span className="sr-only">页面正在加载</span>
    </GlassPanel>
  )
}

function Bar({ className, style }) {
  return <div className={cx('console-skeleton-bar', className)} style={style} />
}
