import { useEffect, useMemo } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { cx } from '../../../shared/cx.js'
import { useConsole } from '../../state/ConsoleContext.jsx'
import PrimaryRail from './PrimaryRail.jsx'
import SecondaryRail from './SecondaryRail.jsx'
import TopBar from './TopBar.jsx'
import { resolveConsoleNavigation } from './activeNavigation.js'

// 统一外壳：一级栏 + 二级栏 + 右上角浮层 + 主内容区。
// 所有工作空间共用这一套结构，页面骨架不因身份另做一套（交付说明 §4）。
export default function ConsoleShell() {
  const { nav, workspace, prefs, setPref } = useConsole()
  const location = useLocation()
  const navigate = useNavigate()

  // 横屏平板（1280 宽一档）首次进入自动收成图标栏，用户仍可手动展开。
  // 交付说明：不得同时保留三列窄导航挤压主内容。
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1320) setPref('sidebarCollapsed', true)
  }, [setPref])

  const activeNavigation = useMemo(() => resolveConsoleNavigation(nav, location.pathname), [location.pathname, nav])
  const activeTop = activeNavigation.top

  // 点一级项：进入该栏第一个可见叶子（或它自己的路由），不做只展开不跳转的空点击
  const pickTop = (item) => {
    const target = item.path || item.groups?.[0]?.items?.[0]?.path
    if (target && target !== location.pathname) navigate(target)
  }

  return (
    <div className="relative z-10 h-screen flex overflow-hidden">
      <PrimaryRail nav={nav} activeTopKey={activeTop?.key} onPick={pickTop} />
      <SecondaryRail top={activeTop} scopeLabel={workspace?.name} activeLeafKey={activeNavigation.leafKey} />

      <div className={cx('flex-1 min-w-0 flex flex-col', activeTop?.groups?.length ? 'pl-5' : 'pl-6')}>
        <header className="shrink-0 h-[72px] flex items-center justify-end pr-6">
          {workspace ? (
            <TopBar pendingTotal={0} />
          ) : (
            <div className="console-pill h-10 rounded-full px-3 flex items-center gap-2.5 text-[13.5px] text-ink-500">
              <span className="w-7 h-7 rounded-full bg-ink-100 animate-pulse" aria-hidden="true" />
              {prefs.reduceMotion ? '正在读取工作空间' : '正在连接工作空间'}
            </div>
          )}
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto console-scroll pr-6 pb-6">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
