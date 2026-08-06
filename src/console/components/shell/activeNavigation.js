function matchesPath(pathname, path) {
  return pathname === path || pathname.startsWith(`${path}/`)
}

export function resolveConsoleNavigation(nav, pathname) {
  const candidates = []
  for (const top of nav || []) {
    if (top.path && matchesPath(pathname, top.path)) {
      candidates.push({ top, leafKey: null, path: top.path })
    }
    for (const group of top.groups || []) {
      for (const item of group.items || []) {
        if (item.path && matchesPath(pathname, item.path)) {
          candidates.push({ top, leafKey: item.key, path: item.path })
        }
      }
    }
  }
  candidates.sort((left, right) => right.path.length - left.path.length)
  return candidates[0] || { top: nav?.[0] || null, leafKey: null, path: null }
}
