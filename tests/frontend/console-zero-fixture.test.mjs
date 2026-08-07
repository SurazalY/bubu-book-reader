import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { STAGE4_CONSOLE_SURFACES } from '../../src/console/state/useStage4ConsoleData.js'
import { scanRuntimeGraph } from './runtime-import-scan.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const fixtureImportPattern = /(?:import|export)\s+(?:[^;'"`]*?\s+from\s+)?['"]([^'"]*\/data\/fixtures\/[^'"]+)['"]/g

const EXPECTED_FIXTURE_IMPORTS = {
  studentList: [],
  safetyList: [
    '../../data/fixtures/classes.js',
    '../../data/fixtures/safety.js',
  ],
  classList: ['../../data/fixtures/classes.js'],
  classDetail: [
    '../../data/fixtures/arrangements.js',
    '../../data/fixtures/classes.js',
  ],
  studentDetail: [],
  classOverview: [],
  bookLibrary: [],
  bookDetail: [],
  eyeCare: [],
  sessions: [],
  privacy: [],
}

const LEGACY_FIXTURE_MODULES = [
  'src/console/components/AssistRequestToast.jsx',
  'src/console/data/nav.js',
  'src/console/pages/Me.jsx',
  'src/console/pages/accounts/ClassDetail.jsx',
  'src/console/pages/accounts/ClassList.jsx',
  'src/console/pages/accounts/OrgAccounts.jsx',
  'src/console/pages/accounts/RoleConfig.jsx',
  'src/console/pages/auth/AuthViews.jsx',
  'src/console/pages/ops/Ops.jsx',
  'src/console/pages/safety/SafetyList.jsx',
  'src/console/pages/teaching/BookImport.jsx',
  'src/console/pages/usage/Models.jsx',
  'src/console/pages/usage/QuotaManage.jsx',
]

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8')
}

function fixtureImports(relativePath) {
  const source = readProjectFile(relativePath)
  fixtureImportPattern.lastIndex = 0
  const imports = []
  let match = fixtureImportPattern.exec(source)
  while (match) {
    imports.push(match[1])
    match = fixtureImportPattern.exec(source)
  }
  return imports.sort()
}

function routeIsReachable(consoleAppSource, routePath, page) {
  const component = page.split('/').at(-1).replace(/\.jsx$/, '')
  return consoleAppSource.includes(`path="${routePath}"`) && consoleAppSource.includes(`<${component}`)
}

export function inspectStage4ConsoleFixtureDebt() {
  const consoleAppSource = readProjectFile('src/console/ConsoleApp.jsx')
  return Object.entries(STAGE4_CONSOLE_SURFACES).map(([key, surface]) => ({
    key,
    route: surface.route,
    page: surface.page,
    reachable: routeIsReachable(consoleAppSource, surface.routePath, surface.page),
    fixtureImports: fixtureImports(surface.page),
    apiStatus: surface.apiStatus,
  }))
}

test('权限端生产入口模块图不加载 fixture、mock 或本地业务存储', () => {
  const graph = scanRuntimeGraph('src/console/ConsoleApp.jsx')
  assert.deepEqual(graph.forbiddenImports, [])
  assert.deepEqual(graph.storageReferences, [])
})

test('学生端生产入口模块图不加载 fixture、mock 或本地业务存储', () => {
  const graph = scanRuntimeGraph('src/student/StudentApp.jsx')
  assert.deepEqual(graph.forbiddenImports, [])
  assert.deepEqual(graph.storageReferences, [])
})

test('历史 fixture 页面和旧导航不在三个生产入口的可达模块图内', () => {
  const reachableModules = new Set([
    ...scanRuntimeGraph('src/App.jsx').modules,
    ...scanRuntimeGraph('src/student/StudentApp.jsx').modules,
    ...scanRuntimeGraph('src/console/ConsoleApp.jsx').modules,
  ])
  const reachableLegacyModules = LEGACY_FIXTURE_MODULES.filter((file) => reachableModules.has(file))
  assert.deepEqual(reachableLegacyModules, [])
})

test('家长发送页不保留只改本地状态的模拟开关', () => {
  const source = readProjectFile('src/console/pages/reports/ParentSend.jsx')
  assert.doesNotMatch(source, /scheduledOff|模拟产品默认|setScheduledOff/)
  assert.match(source, /产品默认：定时发送关闭/)
  assert.match(source, /当前发送规则以服务端返回为准/)
})

test('真实登录页不导入旧找回壳，也不展示固定邮箱', () => {
  const studentLogin = readProjectFile('src/student/pages/Login.jsx')
  const consoleLogin = readProjectFile('src/console/pages/Login.jsx')
  const legacyAuth = readProjectFile('src/console/pages/auth/AuthViews.jsx')
  const fixedEmail = /wang\.zr@peixin\.edu/i

  assert.doesNotMatch(studentLogin, fixedEmail)
  assert.doesNotMatch(consoleLogin, fixedEmail)
  assert.doesNotMatch(legacyAuth, fixedEmail)
})

test('权限端目标页面的 fixture 缺口清单完整且没有被可达路由静默加载', () => {
  const inventory = inspectStage4ConsoleFixtureDebt()
  assert.deepEqual(
    Object.fromEntries(inventory.map((item) => [item.key, item.fixtureImports])),
    EXPECTED_FIXTURE_IMPORTS,
  )

  const unsafeReachable = inventory.filter((item) => item.reachable && item.fixtureImports.length > 0)
  assert.deepEqual(unsafeReachable, [], '演示可达路由不得加载仍含 fixture 的页面')
})

test('未接入的冻结页面继续走诚实的 unavailable 页面而不是删除导航', () => {
  const source = readProjectFile('src/console/ConsoleApp.jsx')
  assert.match(source, /<Route path="\*" element={<ConsoleUnavailablePage\s*\/>}\s*\/>/)
  assert.match(source, /页面尚未接入/)
  assert.match(source, /暂不展示过渡业务内容/)
})
