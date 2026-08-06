import { useNavigate } from 'react-router-dom'
import { cx } from '../../../shared/cx.js'
import { RuntimeIcon as Icon } from '../../../shared/RuntimeIcon.jsx'
import { BrandMark } from '../BrandMark.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'

// 一级功能栏（母版 01/02/03）：
// - 位置、图标、顺序对所有工作空间固定，切换空间时不重排、不闪烁重载。
// - 选中态是「浅色圆角块 + 左侧一根短竖条」，不是厚重色块。
// - 底部固定「收起侧栏」；收起后只留图标，二级栏仍保留一列。
export default function PrimaryRail({ nav, activeTopKey, onPick }) {
  const { prefs, setPref } = useConsole()
  const collapsed = prefs.sidebarCollapsed
  const navigate = useNavigate()

  return (
    <nav
      className={cx(
        'console-rail relative z-20 shrink-0 flex flex-col transition-[width] duration-320 ease-soft',
        collapsed ? 'w-[76px]' : 'w-[188px]',
      )}
      aria-label="一级功能栏"
    >
      {/* 品牌区：与登录页共用 BrandMark，收起时只留图标 */}
      <button
        type="button"
        onClick={() => navigate('/console/home')}
        className={cx('flex items-center h-[74px] shrink-0', collapsed ? 'justify-center px-0' : 'pl-6')}
        aria-label="回到首页"
      >
        <BrandMark size={30} showText={!collapsed} textClass="text-[24px] leading-none tracking-[0.14em]" />
      </button>

      <ul className="flex-1 overflow-y-auto console-scroll px-3 pt-1 pb-3 space-y-0.5">
        {nav.map((item) => {
          const active = item.key === activeTopKey
          return (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onPick(item)}
                title={collapsed ? item.label : undefined}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'console-rail-item group relative w-full flex items-center rounded-xl transition duration-140 ease-soft',
                  collapsed ? 'justify-center h-11' : 'gap-3 h-11 pl-3.5 pr-2.5',
                  active ? 'console-rail-item--on' : 'hover:bg-white/55',
                )}
              >
                {active && !collapsed && <span className="console-rail-bar" aria-hidden="true" />}
                <Icon
                  name={item.icon}
                  className={cx('w-[18px] h-[18px] shrink-0', active ? 'text-[#2E8C86]' : 'text-ink-500')}
                  strokeWidth={active ? 2.1 : 1.7}
                />
                {!collapsed && (
                  <span
                    className={cx(
                      'text-[13.5px] truncate flex-1 text-left',
                      active ? 'font-semibold text-[#1F6F6A]' : 'text-ink-700',
                    )}
                  >
                    {item.label}
                  </span>
                )}
                {/* 角标只给待处理隐私申请、待审核社区内容、安全事件、发送失败报告 */}
                {item.badge > 0 &&
                  (collapsed ? (
                    <span className="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-danger-500" />
                  ) : (
                    <span className="console-badge">{item.badge}</span>
                  ))}
              </button>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        onClick={() => setPref('sidebarCollapsed', !collapsed)}
        className={cx(
          'shrink-0 flex items-center gap-2 h-[52px] text-[12.5px] text-ink-500 hover:text-ink-700 transition',
          collapsed ? 'justify-center' : 'pl-5',
        )}
      >
        <Icon
          name="ChevronLeft"
          className={cx('w-4 h-4 transition-transform duration-320 ease-soft', collapsed && 'rotate-180')}
        />
        {!collapsed && <span>收起侧栏</span>}
      </button>
    </nav>
  )
}
