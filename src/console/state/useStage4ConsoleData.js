import { useCallback, useMemo } from 'react'

import { createStage4ConsoleApi } from '../../api/stage4.js'
import { useApiResource } from '../../api/useApiResource.js'

export const STAGE4_CONSOLE_SURFACES = Object.freeze({
  studentList: {
    route: '/console/accounts/students',
    routePath: 'accounts/students',
    page: 'src/console/pages/accounts/StudentDirectory.jsx',
    apiStatus: 'ready',
  },
  safetyList: {
    route: '/console/safety',
    routePath: 'safety',
    page: 'src/console/pages/safety/SafetyList.jsx',
    apiStatus: 'ready',
  },
  classList: {
    route: '/console/accounts/classes',
    routePath: 'accounts/classes',
    page: 'src/console/pages/accounts/ClassList.jsx',
    apiStatus: 'ready',
  },
  classDetail: {
    route: '/console/accounts/classes/:classId',
    routePath: 'accounts/classes/:classId',
    page: 'src/console/pages/accounts/ClassDetail.jsx',
    apiStatus: 'ready',
  },
  studentDetail: {
    route: '/console/accounts/students/:studentId',
    routePath: 'accounts/students/:studentId',
    page: 'src/console/pages/accounts/StudentDetail.jsx',
    apiStatus: 'ready',
  },
  classOverview: {
    route: '/console/classes/overview',
    routePath: 'classes/overview',
    page: 'src/console/pages/ClassOverview.jsx',
    apiStatus: 'ready',
  },
  bookLibrary: {
    route: '/console/teaching/books',
    routePath: 'teaching/books',
    page: 'src/console/pages/teaching/BookLibrary.jsx',
    apiStatus: 'ready',
  },
  bookDetail: {
    route: '/console/teaching/books/:bookId',
    routePath: 'teaching/books/:bookId',
    page: 'src/console/pages/teaching/BookDetail.jsx',
    apiStatus: 'ready',
  },
  eyeCare: {
    route: '/console/classes/eyecare',
    routePath: 'classes/eyecare',
    page: 'src/console/pages/classes/EyeCare.jsx',
    apiStatus: 'unavailable',
  },
  sessions: {
    route: '/console/usage/sessions',
    routePath: 'usage/sessions',
    page: 'src/console/pages/usage/Sessions.jsx',
    apiStatus: 'unavailable',
  },
  privacy: {
    route: '/console/usage/privacy',
    routePath: 'usage/privacy',
    page: 'src/console/pages/usage/Privacy.jsx',
    apiStatus: 'unavailable',
  },
})

export async function resolveStage4ConsoleData({ api, surface, workspaceId, resourceId, query, signal }) {
  const state = await api.loadSurface(surface, { workspaceId, resourceId, query, signal })
  return { data: state, meta: state.meta || {} }
}

export default function useStage4ConsoleData(surface, { workspaceId, resourceId, query } = {}) {
  const api = useMemo(() => createStage4ConsoleApi(), [])
  const load = useCallback(
    () => resolveStage4ConsoleData({ api, surface, workspaceId, resourceId, query }),
    [api, query, resourceId, surface, workspaceId],
  )
  const resource = useApiResource(load)

  if (resource.status !== 'ready') return resource
  const state = resource.data
  return {
    ...resource,
    status: state?.status || 'empty',
    data: state?.data ?? null,
    error: null,
    reason: state?.reason || null,
    meta: state?.meta || resource.meta || {},
  }
}
