import { cx } from '../../shared/cx.js'
import { GlassPanel } from './Glass.jsx'

// 管理类页面的主内容面板（母版 01）：大圆角玻璃板，
// 头部左侧「页面标题 + 一行说明」，右侧放工具区，下面才是列表／详情。
// 页面标题必须带当前数据范围，工作空间一换标题就跟着换。
export function PagePanel({ title, desc, toolbar, children, className, bodyClassName }) {
  return (
    <GlassPanel
      tone="solid"
      className={cx('console-page rounded-[26px] overflow-hidden min-h-full flex flex-col', className)}
    >
      {(title || toolbar) && (
        <div className="flex items-start gap-4 px-6 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            {title && <h1 className="font-serif text-[21px] leading-tight font-bold text-ink-900">{title}</h1>}
            {desc && <p className="text-[12.5px] text-ink-500 mt-1.5">{desc}</p>}
          </div>
          {toolbar && <div className="flex items-center gap-2.5 shrink-0 pt-0.5">{toolbar}</div>}
        </div>
      )}
      <div className={cx('flex-1 min-h-0 px-6 pb-6 flex flex-col', bodyClassName)}>{children}</div>
    </GlassPanel>
  )
}
