import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import useStudentAiRuntime from './useStudentAiRuntime.js'
import useStudentRuntime from './useStudentRuntime.js'

export const HOME_LIST_LIMIT = 3

const StudentContext = createContext(null)
const visualPreferenceDefaults = Object.freeze({
  paperTone: 'warm',
  fontScale: 'md',
  flipStyle: 'slide',
  reduceMotion: false,
  mascotIntro: false,
})

export function StudentProvider({ children }) {
  const runtime = useStudentRuntime()
  const ai = useStudentAiRuntime(runtime.data?.workspaceId, runtime.data?.books || [])
  const scrollPositions = useRef(new Map())
  const [prefs, setPrefs] = useState(visualPreferenceDefaults)
  const [shelfView, setShelfView] = useState({ group: 'all', option: 'all', query: '', railOpen: true })
  const [aiQuotes, setAiQuotes] = useState([])
  const rememberScroll = useCallback((path, scrollTop) => {
    scrollPositions.current.set(path, Number.isFinite(scrollTop) ? scrollTop : 0)
  }, [])
  const readScroll = useCallback((path) => scrollPositions.current.get(path) || 0, [])
  const setPref = useCallback((key, nextValue) => {
    if (!Object.prototype.hasOwnProperty.call(visualPreferenceDefaults, key)) return
    setPrefs((current) => ({ ...current, [key]: nextValue }))
  }, [])
  const patchShelfView = useCallback((patch) => setShelfView((current) => ({ ...current, ...patch })), [])
  const isLiked = useCallback(
    (bookId) => Boolean(runtime.data?.books?.find((book) => book.id === bookId)?.liked),
    [runtime.data?.books],
  )
  const addAiQuotes = useCallback((items) => {
    setAiQuotes((current) => {
      const next = [...current]
      items.forEach((item) => {
        if (!next.some((existing) => existing.key === item.key || (existing.page === item.page && existing.text === item.text))) next.push(item)
      })
      return next
    })
  }, [])
  const removeAiQuote = useCallback((key) => setAiQuotes((current) => current.filter((item) => item.key !== key)), [])
  const clearAiQuotes = useCallback(() => setAiQuotes([]), [])
  const value = useMemo(
    () => ({
      student: runtime.data?.student || null,
      runtime,
      ai,
      aiQuotes,
      addAiQuotes,
      removeAiQuote,
      clearAiQuotes,
      prefs,
      setPref,
      shelfView,
      patchShelfView,
      isLiked,
      rememberScroll,
      readScroll,
    }),
    [addAiQuotes, ai, aiQuotes, clearAiQuotes, isLiked, patchShelfView, prefs, readScroll, rememberScroll, removeAiQuote, runtime, setPref, shelfView],
  )

  return <StudentContext.Provider value={value}>{children}</StudentContext.Provider>
}

export function useOptionalStudent() {
  return useContext(StudentContext)
}

export function useStudent() {
  const context = useOptionalStudent()
  if (!context) throw new Error('useStudent 必须在 StudentProvider 内使用')
  return context
}
