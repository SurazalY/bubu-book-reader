import { useLayoutEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import BottomNav from './BottomNav.jsx'
import { useStudent } from '../state/StudentContext.jsx'

// 四个一级页面共用的外壳：内容区 + 底部一级导航。
// 规格要求「返回一级页面时恢复原有导航项、筛选条件和滚动位置」——
// 滚动位置在这里统一处理（按路径记忆，离开时存、回来时还原），
// 筛选条件由各页面自己在 Stage 2／5 用同一套 useStudent 记忆机制补。
export default function StudentShell() {
  const scroller = useRef(null)
  const { pathname } = useLocation()
  const { rememberScroll, readScroll } = useStudent()

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return undefined
    el.scrollTop = readScroll(pathname)
    return () => rememberScroll(pathname, el.scrollTop)
  }, [pathname, rememberScroll, readScroll])

  return (
    <div className="relative z-10 flex h-screen flex-col">
      {/* 内边距放在内层，这样子面板的 min-h-full 能真正撑满可视区，
          不会像 Kimi 原型一样内容只占上半屏、下方露大片背景 */}
      <main ref={scroller} className="student-scroll min-h-0 flex-1 overflow-y-auto px-8 pt-7">
        <div className="mx-auto flex min-h-full max-w-[1180px] flex-col pb-4">
          <Outlet />
        </div>
      </main>
      <BottomNav />
    </div>
  )
}
