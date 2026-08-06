import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { cx } from '../../../shared/cx.js'
import { RuntimeIcon as Icon } from '../../../shared/RuntimeIcon.jsx'

// 二级功能栏（母版 01）：
// - 独立一列，从一级栏右侧自然展开，不覆盖一级栏也不浮在主内容文字上。
// - 顶部显示当前一级功能名称与当前数据范围。
// - 分组标题带图标与折叠箭头，叶子项选中时是浅青玻璃底 + 青绿文字。
// - 自身独立滚动，主内容区滚动互不影响。
// activeLeafKey 由外壳统一算（含详情页归属与回落），比 NavLink 的路径前缀匹配可靠：
// 校长看班级详情时归属回落到「班级学生总览」，路径前缀是对不上的。
export default function SecondaryRail({ top, scopeLabel, activeLeafKey }) {
  const [closed, setClosed] = useState({})

  // 换一级功能时把折叠状态清空，避免上一栏的折叠状态串到新栏
  useEffect(() => setClosed({}), [top?.key])

  if (!top?.groups?.length) return null

  return (
    <aside
      className="console-subrail relative z-10 shrink-0 w-[180px] flex flex-col console-enter"
      aria-label={`${top.label}二级功能栏`}
    >
      <div className="shrink-0 px-4 pt-6 pb-3">
        <div className="flex items-center gap-2">
          <Icon name={top.icon} className="w-4 h-4 text-ink-500 shrink-0" strokeWidth={1.7} />
          <span className="text-[13.5px] font-semibold text-ink-800 truncate">{top.label}</span>
        </div>
        {/* 标签与值各占一行：长工作空间名（如「六年级语文教研组」）在 180px 里
            挤一行会折成孤字（Stage 2 已为短名加宽过一次，这次按长名定稿） */}
        {scopeLabel && (
          <div className="mt-1.5">
            <p className="text-[10.5px] text-ink-400 leading-none">当前范围</p>
            <p className="text-[11.5px] text-ink-600 font-medium leading-snug mt-0.5 break-words" title={scopeLabel}>
              {scopeLabel}
            </p>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto console-scroll px-3 pb-4 space-y-1.5">
        {top.groups.map((g) => {
          const open = !closed[g.key]
          return (
            <div key={g.key}>
              <button
                type="button"
                onClick={() => setClosed((m) => ({ ...m, [g.key]: open }))}
                className="w-full flex items-center gap-2 h-8 px-2 rounded-lg text-ink-600 hover:bg-white/50 transition"
                aria-expanded={open}
              >
                <Icon name={g.icon} className="w-[15px] h-[15px] text-[#3E9E8F] shrink-0" strokeWidth={1.8} />
                <span className="text-[12.5px] font-medium truncate flex-1 text-left">{g.label}</span>
                <Icon
                  name="ChevronUp"
                  className={cx('w-3.5 h-3.5 text-ink-300 transition-transform duration-220 ease-soft', !open && 'rotate-180')}
                />
              </button>
              {open && (
                <ul className="mt-0.5 space-y-0.5">
                  {g.items.map((it) => (
                    <li key={it.key}>
                      <NavLink
                        to={it.path}
                        end={it.path === '/console/reports'}
                        className={({ isActive }) =>
                          cx(
                            'flex items-center h-9 pl-8 pr-2 rounded-lg text-[12.5px] transition duration-140 ease-soft',
                            (activeLeafKey ? it.key === activeLeafKey : isActive)
                              ? 'console-subrail-item--on font-semibold text-[#1F6F6A]'
                              : 'text-ink-500 hover:text-ink-700 hover:bg-white/45',
                          )
                        }
                      >
                        <span className="truncate flex-1">{it.label}</span>
                        {it.badge > 0 && <span className="console-badge">{it.badge}</span>}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
