import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import useConsoleRuntime from './useConsoleRuntime.js'
import { canAccessConsolePath } from './consoleAccess.js'
import { PLATFORM_NAV_ITEMS, SCHOOL_NAV_ITEMS } from './navigation.js'

export const WORKSPACE_STORAGE_KEY = 'readmate:console:last_workspace'

export function createSafeStorage(customStorage) {
  if (customStorage) return customStorage
  return {
    getItem(key) {
      if (!key) return null
      try {
        if (typeof window !== 'undefined' && window?.localStorage) {
          return window.localStorage.getItem(key)
        }
        if (typeof globalThis !== 'undefined' && globalThis?.localStorage) {
          return globalThis.localStorage.getItem(key)
        }
      } catch {}
      return null
    },
    setItem(key, value) {
      if (!key || typeof value !== 'string') return
      try {
        if (typeof window !== 'undefined' && window?.localStorage) {
          window.localStorage.setItem(key, value)
          return
        }
        if (typeof globalThis !== 'undefined' && globalThis?.localStorage) {
          globalThis.localStorage.setItem(key, value)
        }
      } catch {}
    },
    removeItem(key) {
      if (!key) return
      try {
        if (typeof window !== 'undefined' && window?.localStorage) {
          window.localStorage.removeItem(key)
          return
        }
        if (typeof globalThis !== 'undefined' && globalThis?.localStorage) {
          globalThis.localStorage.removeItem(key)
        }
      } catch {}
    },
  }
}

const ConsoleContext = createContext(null)

export function ConsoleProvider({ children, storage: customStorage }) {
  const runtime = useConsoleRuntime()
  const storage = useMemo(() => createSafeStorage(customStorage), [customStorage])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(() => storage.getItem(WORKSPACE_STORAGE_KEY) || null)
  const [prefs, setPrefs] = useState({ sidebarCollapsed: false, reduceMotion: false, theme: 'light' })
  const workspaces = runtime.data?.workspaces || []

  useEffect(() => {
    const currentId = runtime.data?.workspace?.id
    if (!currentId) return
    const storedId = storage.getItem(WORKSPACE_STORAGE_KEY)
    setSelectedWorkspaceId((previous) => {
      if (previous && workspaces.some((workspace) => workspace.id === previous)) return previous
      if (storedId && workspaces.some((workspace) => workspace.id === storedId)) return storedId
      return currentId
    })
  }, [runtime.data?.workspace?.id, storage, workspaces])

  const workspace = useMemo(
    () => workspaces.find((item) => item.id === selectedWorkspaceId) || runtime.data?.workspace || null,
    [runtime.data?.workspace, selectedWorkspaceId, workspaces],
  )
  const switchWorkspace = useCallback((workspaceId) => {
    if (workspaces.some((item) => item.id === workspaceId)) {
      setSelectedWorkspaceId(workspaceId)
      storage.setItem(WORKSPACE_STORAGE_KEY, workspaceId)
    }
  }, [storage, workspaces])
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

export function useOptionalConsole() {
  return useContext(ConsoleContext)
}

export function useConsole() {
  const context = useOptionalConsole()
  if (!context) throw new Error('useConsole 必须在 ConsoleProvider 内使用')
  return context
}
