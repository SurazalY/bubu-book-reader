import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import useConsoleRuntime from './useConsoleRuntime.js'
import { canAccessConsolePath } from './consoleAccess.js'
import { PLATFORM_NAV_ITEMS, SCHOOL_NAV_ITEMS } from './navigation.js'

const ConsoleContext = createContext(null)

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
      nav: workspace?.scopeType === 'platform' ? PLATFORM_NAV_ITEMS : SCHOOL_NAV_ITEMS,
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
