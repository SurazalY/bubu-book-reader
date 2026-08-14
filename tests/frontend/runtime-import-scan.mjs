import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const staticImportPattern = /(?:import|export)\s+(?:[^;'"`]*?\s+from\s+)?['"]([^'"]+)['"]/g
const dynamicImportPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const forbiddenSpecifierPattern = /(?:\/(?:data|fixtures?|demos?|mocks?)(?:\/|$)|(?:^|\/)demo[^/]*$)/i
const forbiddenStoragePattern = /\b(?:localStorage|sessionStorage)\b/
const indexedDbPattern = /\bindexedDB\b/
const allowedIndexedDbModule = 'src/student/reading-monitor/pendingStore.js'

export const FINAL_ROUTE_SURFACES = [
  {
    route: '/student/home',
    app: 'src/student/StudentApp.jsx',
    page: 'src/student/pages/Home.jsx',
    routePattern: /path="home"\s+element={<Home\s*\/>}/,
    readyPattern: /<BookCard\b/,
    failurePattern: /runtime\.reload/,
  },
  {
    route: '/student/reader/:bookId',
    app: 'src/student/StudentApp.jsx',
    page: 'src/student/pages/Reader.jsx',
    routePattern: /path="reader\/:bookId"\s+element={<Reader\s*\/>}/,
    readyPattern: /<BookPage\b/,
    failurePattern: /pageResource\.reload/,
  },
  {
    route: '/console/home',
    app: 'src/console/ConsoleApp.jsx',
    page: 'src/console/pages/Home.jsx',
    routePattern: /path="home"\s+element={<ConsoleHome\s*\/>}/,
    readyPattern: /<DashboardBlock\b/,
    failurePattern: /runtime\.reload|resource\.reload/,
  },
  {
    route: '/console/safety/:eventId',
    app: 'src/console/ConsoleApp.jsx',
    page: 'src/console/pages/safety/SafetyDetail.jsx',
    routePattern: /path="safety\/:eventId"\s+element={<SafetyDetail\s*\/>}/,
    readyPattern: /const event = resource\.data/,
    failurePattern: /resource\.reload/,
  },
]

function normalizePath(filePath) {
  return relative(projectRoot, filePath).replaceAll('\\', '/')
}

function resolveModule(parentPath, specifier) {
  const basePath = resolve(dirname(parentPath), specifier)
  const candidates = extname(basePath)
    ? [basePath]
    : [`${basePath}.js`, `${basePath}.jsx`, resolve(basePath, 'index.js'), resolve(basePath, 'index.jsx')]
  return candidates.find((candidate) => existsSync(candidate)) || null
}

function collectSpecifiers(source) {
  const specifiers = []
  for (const pattern of [staticImportPattern, dynamicImportPattern]) {
    pattern.lastIndex = 0
    let match = pattern.exec(source)
    while (match) {
      specifiers.push(match[1])
      match = pattern.exec(source)
    }
  }
  return specifiers
}

export function scanRuntimeGraph(entryRelativePath) {
  const pending = [resolve(projectRoot, entryRelativePath)]
  const visited = new Set()
  const forbiddenImports = []
  const storageReferences = []
  const allowedStorageReferences = []

  while (pending.length) {
    const currentPath = pending.pop()
    if (!currentPath || visited.has(currentPath)) continue
    visited.add(currentPath)

    const source = readFileSync(currentPath, 'utf8')
    const currentRelativePath = normalizePath(currentPath)
    if (forbiddenStoragePattern.test(source)) storageReferences.push(currentRelativePath)
    if (indexedDbPattern.test(source)) {
      if (currentRelativePath === allowedIndexedDbModule) allowedStorageReferences.push(currentRelativePath)
      else storageReferences.push(currentRelativePath)
    }

    for (const specifier of collectSpecifiers(source)) {
      if (forbiddenSpecifierPattern.test(specifier)) {
        forbiddenImports.push({ from: currentRelativePath, specifier })
        continue
      }
      if (!specifier.startsWith('.')) continue
      const targetPath = resolveModule(currentPath, specifier)
      if (!targetPath) throw new Error(`无法解析最终运行模块 ${specifier}，来源 ${currentRelativePath}`)
      pending.push(targetPath)
    }
  }

  return {
    entry: entryRelativePath,
    modules: [...visited].map(normalizePath).sort(),
    forbiddenImports,
    storageReferences: [...new Set(storageReferences)].sort(),
    allowedStorageReferences: [...new Set(allowedStorageReferences)].sort(),
  }
}

export function scanFinalRuntimeGraphs() {
  return ['src/student/StudentApp.jsx', 'src/console/ConsoleApp.jsx'].map(scanRuntimeGraph)
}

export function inspectFinalRouteSurfaces() {
  return FINAL_ROUTE_SURFACES.map((surface) => {
    const appSource = readFileSync(resolve(projectRoot, surface.app), 'utf8')
    const pageSource = readFileSync(resolve(projectRoot, surface.page), 'utf8')
    return {
      route: surface.route,
      app: surface.app,
      page: surface.page,
      routePresent: surface.routePattern.test(appSource),
      successPathPresent: surface.readyPattern.test(pageSource),
      failurePathPresent: surface.failurePattern.test(pageSource),
      runtimeGatePresent: /RuntimeGate/.test(appSource),
    }
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({ routes: inspectFinalRouteSurfaces(), graphs: scanFinalRuntimeGraphs() }, null, 2))
}
