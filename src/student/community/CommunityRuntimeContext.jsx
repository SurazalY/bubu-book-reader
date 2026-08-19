import { createContext, useContext, useMemo } from 'react'

import { useStudent } from '../state/StudentContext.jsx'
import useCommunity from '../state/useCommunity.js'

const CommunityRuntimeContext = createContext(null)
const EMPTY_BOOKS = Object.freeze([])

export function StudentCommunityProvider({ children }) {
  const { runtime, student } = useStudent()
  const books = runtime.data?.books || EMPTY_BOOKS
  const community = useCommunity({
    workspaceId: runtime.data?.workspaceId,
    studentId: student?.id,
    books,
  })
  const value = useMemo(() => ({ community, student, books }), [books, community, student])

  return <CommunityRuntimeContext.Provider value={value}>{children}</CommunityRuntimeContext.Provider>
}

export function useStudentCommunity() {
  const context = useContext(CommunityRuntimeContext)
  if (!context) throw new Error('useStudentCommunity 必须在 StudentCommunityProvider 内使用')
  return context
}
