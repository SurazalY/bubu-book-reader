import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { createAuthApi } from '../../../api/auth.js'
import { cx } from '../../../shared/cx.js'
import { RuntimeIcon as Icon } from '../../../shared/RuntimeIcon.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'

const authApi = createAuthApi()

// 顶栏（母版 02/03）：右上角只有铃铛与工作空间胶囊，不做占满整行的大导航。
// 个人菜单与工作空间选择器是「同一个组合浮层系统」：
// 点开第二层时父菜单保持展开并整体左移，两层共享同一个头像锚点，
// 子层顶部与「切换工作空间」那一行对齐（母版 03 的关系），不做互不相关的两个模态。
export default function TopBar({ pendingTotal }) {
  const { workspace, workspaces, switchWorkspace, prefs, togglePref, setPref } = useConsole()
  const navigate = useNavigate()
  const location = useLocation()

  const [open, setOpen] = useState(false)
  const [subOpen, setSubOpen] = useState(false)
  const [subTop, setSubTop] = useState(0)
  const [logoutError, setLogoutError] = useState('')

  const anchorRef = useRef(null)
  const wrapRef = useRef(null)
  const menuRef = useRef(null)
  const wsRowRef = useRef(null)

  const close = useCallback(() => {
    setOpen(false)
    setSubOpen(false)
  }, [])

  // 点击外部与 Esc 关闭；关闭后焦点回到头像按钮
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) close()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        close()
        anchorRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  // 量出「切换工作空间」那一行相对菜单顶部的位置，让子浮层与它顶部对齐
  useLayoutEffect(() => {
    if (!subOpen || !wsRowRef.current || !menuRef.current) return
    const rowTop = wsRowRef.current.getBoundingClientRect().top
    const menuTop = menuRef.current.getBoundingClientRect().top
    setSubTop(Math.max(0, rowTop - menuTop - 8))
  }, [subOpen])

  const pickWorkspace = (id) => {
    const next = switchWorkspace(id, location.pathname)
    close()
    if (next && next !== location.pathname) navigate(next)
  }

  const logout = async () => {
    setLogoutError('')
    try {
      await authApi.logout()
      close()
      navigate('/console/login', { replace: true })
    } catch (error) {
      setLogoutError(error?.message || '退出登录失败，请稍后重试')
    }
  }

  return (
    <div ref={wrapRef} className="relative flex items-center gap-3 shrink-0">
      {/* 铃铛：有待处理事项时右上角一点红，不显示具体数字（数字在首页与二级栏） */}
      <button
        type="button"
        onClick={() => navigate('/console/reports')}
        className="console-topbtn relative w-10 h-10 rounded-full flex items-center justify-center text-ink-600 hover:text-ink-800 transition"
        aria-label={pendingTotal > 0 ? `通知，有 ${pendingTotal} 项待处理` : '通知'}
      >
        <Icon name="Bell" className="w-[18px] h-[18px]" strokeWidth={1.8} />
        {pendingTotal > 0 && <span className="absolute top-2 right-2.5 w-2 h-2 rounded-full bg-danger-500 ring-2 ring-white/80" />}
      </button>

      {/* 工作空间胶囊：头像 + 当前空间名 + 下拉箭头 */}
      <button
        ref={anchorRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        className="console-pill h-10 pl-1.5 pr-3 rounded-full flex items-center gap-2.5 max-w-[240px]"
      >
        <Avatar size={28} />
        <span className="text-[13.5px] font-medium text-ink-800 truncate">{workspace.name}</span>
        <Icon
          name="ChevronDown"
          className={cx('w-4 h-4 text-ink-400 shrink-0 transition-transform duration-220 ease-soft', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 flex items-start justify-end gap-2.5 z-40">
          {/* 第一层：个人菜单 */}
          <div ref={menuRef} className="console-float console-pop w-[212px] rounded-2xl py-2" role="menu">
            <div className="flex items-center gap-3 px-3.5 py-2.5">
              <Avatar size={38} />
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold text-ink-900 truncate">{workspace.person.name}</div>
                <button
                  type="button"
                  disabled
                  title="个人资料编辑接口尚未开放，当前只显示真实登录身份"
                  className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-ink-500 disabled:cursor-not-allowed"
                >
                  个人资料暂未开放
                  <Icon name="ExternalLink" className="w-3 h-3" />
                </button>
              </div>
            </div>

            <MenuDivider />

            <MenuRow
              ref={wsRowRef}
              label="切换工作空间"
              chevron
              active={subOpen}
              onClick={() => setSubOpen(true)}
              onMouseEnter={() => setSubOpen(true)}
            />
            <MenuRow
              icon="CircleHelp"
              label="帮助与反馈"
              disabled
              title="帮助与反馈服务暂未开放"
              onMouseEnter={() => setSubOpen(false)}
            />

            <MenuDivider />

            <MenuRow
              icon="LogOut"
              label="退出登录"
              onClick={logout}
            />
            {logoutError && <p className="px-3.5 pb-1 text-[11px] leading-relaxed text-danger-600">{logoutError}</p>}

            <MenuDivider />

            {/* 底部分段控件：主题占位 + 减少动态效果（Plan 里的参考图做法） */}
            <div className="px-3 pt-2 pb-1 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11.5px] text-ink-500">主题</span>
                <div className="console-seg">
                  {[
                    { k: 'light', icon: 'Sun' },
                    { k: 'dark', icon: 'Moon' },
                  ].map((t) => (
                    <button
                      key={t.k}
                      type="button"
                       disabled={t.k === 'dark'}
                       title={t.k === 'dark' ? '暗色主题暂未接入' : '当前使用亮色主题'}
                       onClick={() => t.k === 'light' && setPref('theme', t.k)}
                      className={cx('console-seg-btn', (prefs.theme || 'light') === t.k && 'console-seg-btn--on', t.k === 'dark' && 'cursor-not-allowed opacity-55')}
                      aria-label={t.k === 'light' ? '亮色主题' : '暗色主题（待接入）'}
                    >
                      <Icon name={t.icon} className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11.5px] text-ink-500">减少动态效果</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs.reduceMotion}
                  onClick={() => togglePref('reduceMotion')}
                  className={cx('console-switch', prefs.reduceMotion && 'console-switch--on')}
                >
                  <span className="console-switch-dot" />
                </button>
              </div>
            </div>
          </div>

          {/* 第二层：工作空间选择器，与上面那一行顶部对齐 */}
          {subOpen && (
            <div
              className="console-float console-pop w-[204px] rounded-2xl py-2"
              style={{ marginTop: subTop }}
              role="menu"
              aria-label="选择工作空间"
            >
              <div className="px-3.5 pb-1.5 pt-1 text-[11px] text-ink-400">选择工作空间</div>
              <ul>
                {workspaces.map((w) => {
                  const on = w.id === workspace.id
                  return (
                    <li key={w.id}>
                      <button
                        type="button"
                        onClick={() => pickWorkspace(w.id)}
                        className="w-full text-left px-3.5 py-2 flex items-start gap-2 hover:bg-white/70 transition"
                      >
                        <div className="min-w-0 flex-1">
                          <div className={cx('text-[13px] truncate', on ? 'font-semibold text-ink-900' : 'text-ink-700')}>
                            {w.name}
                          </div>
                          <div className="text-[11px] text-ink-400 truncate mt-0.5">{w.scopeNote}</div>
                        </div>
                        {on && <Icon name="Check" className="w-4 h-4 text-[#3E9E8F] shrink-0 mt-0.5" strokeWidth={2.4} />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MenuDivider() {
  return <div className="my-1.5 h-px bg-ink-150/70" />
}

// forwardRef：外层要量「切换工作空间」这一行的位置来对齐子浮层
const MenuRow = forwardRef(function MenuRow({ icon, label, chevron, active, onClick, onMouseEnter, disabled = false, title }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={disabled ? undefined : onMouseEnter}
      className={cx(
        'w-full h-9 px-3.5 flex items-center gap-2.5 text-[13px] transition',
        active ? 'bg-white/75 text-ink-900' : 'text-ink-700 hover:bg-white/65',
        disabled && 'cursor-not-allowed opacity-55',
      )}
    >
      {icon && <Icon name={icon} className="w-[15px] h-[15px] text-ink-500 shrink-0" strokeWidth={1.8} />}
      <span className={cx('truncate flex-1 text-left', !icon && 'pl-0')}>{label}</span>
      {chevron && <Icon name="ChevronRight" className="w-3.5 h-3.5 text-ink-400 shrink-0" />}
    </button>
  )
})

// 头像：前端壳阶段用渐变底 + 首字，正式素材到位后整体替换
export function Avatar({ size = 32 }) {
  const { workspace } = useConsole()
  const name = workspace?.person?.name || '当前会话'
  return (
    <span
      className="console-avatar shrink-0 inline-flex items-center justify-center rounded-full text-white font-semibold"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden="true"
    >
      {name.slice(0, 1)}
    </span>
  )
}
