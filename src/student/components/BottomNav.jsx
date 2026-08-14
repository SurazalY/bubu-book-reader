import { NavLink } from 'react-router-dom'
import { cx } from '../../shared/cx.js'
import { RuntimeIcon as Icon } from '../../shared/RuntimeIcon.jsx'

// 底部一级导航：四项固定「主页｜书架｜共读社区｜个人主页」。
// 规格红线：只在四个一级页面出现；进入书籍详情、阅读器、帖子详情、发布、
// 足迹、用量、护眼与设置后隐藏；阅读器始终不显示一级导航。
export const NAV_ITEMS = [
  { to: '/student/home', label: '主页', icon: 'Home' },
  { to: '/student/shelf', label: '书架', icon: 'Library' },
  { to: '/student/community', label: '共读社区', icon: 'Users' },
  { to: '/student/me', label: '个人主页', icon: 'User' },
]

export default function BottomNav() {
  return (
    <nav className="shrink-0 px-3 pb-5 pt-1 sm:px-8" aria-label="一级导航">
      <div className="student-navbar mx-auto flex max-w-[900px] items-center gap-0.5 rounded-full p-1.5 sm:gap-1.5 sm:p-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cx(
                'group flex min-w-0 flex-1 items-center justify-center gap-1 rounded-full px-1.5 py-2.5 transition-colors duration-140 sm:gap-2.5 sm:px-4',
                isActive ? 'student-nav-item--on' : 'hover:bg-white/55',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  name={item.icon}
                  className={cx('h-[17px] w-[17px] shrink-0 sm:h-[19px] sm:w-[19px]', isActive ? 'text-[#2FA38C]' : 'text-ink-400')}
                  strokeWidth={isActive ? 2.2 : 1.8}
                />
                {/* 状态不只靠颜色：选中项文字同时加粗并变深 */}
                <span className={cx('whitespace-nowrap text-[11px] leading-none sm:text-caption', isActive ? 'font-semibold text-ink-900' : 'text-ink-500')}>
                  {item.label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
