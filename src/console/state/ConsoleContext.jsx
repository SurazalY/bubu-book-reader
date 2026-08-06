import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import useConsoleRuntime from './useConsoleRuntime.js'
import { canAccessConsolePath } from './consoleAccess.js'

const ConsoleContext = createContext(null)

const NAV_ITEMS = [
  { key: 'home', label: '首页', icon: 'House', path: '/console/home' },
  { key: 'teaching', label: '教学与管理', icon: 'GraduationCap', groups: [{ key: 'teaching.live', label: '阅读教学', icon: 'CalendarCheck', items: [{ key: 'teaching.arrangements', label: '阅读安排', path: '/console/teaching/arrangements' }] }] },
  { key: 'classes', label: '班级与学生', icon: 'UsersRound', groups: [{ key: 'classes.live', label: '真实数据', icon: 'ChartNoAxesColumn', items: [{ key: 'classes.overview', label: '阅读统计', path: '/console/classes/overview' }, { key: 'classes.eyecare', label: '护眼管理', path: '/console/classes/eyecare' }] }] },
  { key: 'usage', label: '用量与对话', icon: 'MessageSquareText', groups: [{ key: 'usage.live', label: '对话与隐私', icon: 'MessagesSquare', items: [{ key: 'usage.sessions', label: '学生会话', path: '/console/usage/sessions' }, { key: 'usage.privacy', label: '隐私访问', path: '/console/usage/privacy' }] }] },
  { key: 'community', label: '社区管理', icon: 'Sparkles', path: '/console/community' },
  { key: 'reports', label: '报告中心', icon: 'FileText', groups: [{ key: 'reports.live', label: '报告', icon: 'ClipboardList', items: [{ key: 'reports.center', label: '全部报告', path: '/console/reports' }, { key: 'reports.parents', label: '家长发送', path: '/console/reports/parents' }] }] },
  { key: 'safety', label: '安全事件', icon: 'ShieldCheck', path: '/console/safety' },
]

const PLATFORM_NAV_ITEMS = [
  { key: 'platform-audit', label: '平台审计', icon: 'ShieldCheck', path: '/console/platform/audit' },
]

export function ConsoleProvider({ children }) {
  const runtime = useConsoleRuntime()
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(null)
  const [prefs, setPrefs] = useState({ sidebarCollapsed: false, reduceMotion: false, theme: 'light' })
  const workspaces = runtime.data?.workspaces || []

  useEffect(() => {
    const currentId = runtime.data?.workspace?.id
    if (!currentId) return
    setSelectedWorkspaceId((previous) => {
      if (previous && workspaces.some((workspace) => workspace.id === previous)) return previous
      return currentId
    })
  }, [runtime.data?.workspace?.id, workspaces])

  const workspace = useMemo(
    () => workspaces.find((item) => item.id === selectedWorkspaceId) || runtime.data?.workspace || null,
    [runtime.data?.workspace, selectedWorkspaceId, workspaces],
  )
  const switchWorkspace = useCallback((workspaceId) => {
    if (workspaces.some((item) => item.id === workspaceId)) setSelectedWorkspaceId(workspaceId)
  }, [workspaces])
  const canAccessPath = useCallback((pathname) => canAccessConsolePath(workspace, pathname), [workspace])
  const setPref = useCallback((key, value) => setPrefs((previous) => ({ ...previous, [key]: value })), [])
  const togglePref = useCallback((key) => setPrefs((previous) => ({ ...previous, [key]: !previous[key] })), [])
  const value = useMemo(
    () => ({
      operator: runtime.data?.operator || null,
      workspace,
      workspaces,
      runtime,
      nav: workspace?.scopeType === 'platform' ? PLATFORM_NAV_ITEMS : NAV_ITEMS,
      prefs,
      setPref,
      togglePref,
      switchWorkspace,
      canAccessPath,
    }),
    [canAccessPath, prefs, runtime, setPref, switchWorkspace, togglePref, workspace, workspaces],
  )

  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>
}

export function useConsole() {
  const context = useContext(ConsoleContext)
  if (!context) throw new Error('useConsole 必须在 ConsoleProvider 内使用')
  return context
}
