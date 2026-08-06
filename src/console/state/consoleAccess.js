export function isMountedConsolePath(pathname) {
  if (['/console/home', '/console/platform/audit', '/console/community', '/console/classes/overview', '/console/classes/eyecare', '/console/usage/sessions', '/console/usage/privacy', '/console/reports', '/console/reports/parents', '/console/safety', '/console/teaching/books'].includes(pathname)) return true
  if (/^\/console\/teaching\/(arrangements\/[^/]+|books\/[^/]+|reader\/[^/]+)$/.test(pathname)) return true
  if (/^\/console\/accounts\/students\/[^/]+$/.test(pathname)) return true
  if (/^\/console\/reports\/[^/]+$/.test(pathname) && pathname !== '/console/reports/templates') return true
  return /^\/console\/safety\/[^/]+$/.test(pathname)
}

export function canAccessConsolePath(workspace, pathname) {
  if (!workspace || typeof pathname !== 'string' || !pathname.startsWith('/console/')) return false
  if (!isMountedConsolePath(pathname)) return false
  if (pathname === '/console/platform/audit') return workspace.scopeType === 'platform'
  if (workspace.scopeType === 'platform') return false
  if (pathname === '/console/reports/parents') {
    return ['class', 'grade', 'school'].includes(workspace.scopeType)
  }
  return true
}
