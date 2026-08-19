/**
 * T6-3a 守卫 G6-12～G6-19：三端设置页前端契约。
 * 只扫源码，不写实现。新页面未就位时必须红，不得 skip。
 * 不扫描旧演示壳（src/student/pages/Settings.jsx、src/console/pages/Me.jsx）来假绿。
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  canAccessConsolePath,
  isMountedConsolePath,
} from '../../src/console/state/consoleAccess.js'

const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

const STUDENT_SETTINGS = 'src/student/pages/settings/AccountSettings.jsx'
const CONSOLE_SETTINGS = 'src/console/pages/Settings.jsx'
const STUDENT_DEMO_SHELL = 'src/student/pages/Settings.jsx'
const CONSOLE_DEMO_SHELL = 'src/console/pages/Me.jsx'

const staticImportPattern = /(?:import|export)\s+(?:[^;'"`]*?\s+from\s+)?['"]([^'"]+)['"]/g
const dynamicImportPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function readSource(relativePath) {
  return readFileSync(join(projectRoot, relativePath), 'utf8')
}

function fileExists(relativePath) {
  return existsSync(join(projectRoot, relativePath))
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

function forbiddenImportSpecifiers(source) {
  return collectSpecifiers(source).filter((specifier) => {
    const normalized = specifier.replaceAll('\\', '/')
    if (/(?:^|[./])data\//.test(normalized) || /\/data$/.test(normalized)) return true
    if (/(?:^|[./])fixtures?\//.test(normalized) || /\/fixtures?$/.test(normalized)) return true
    if (/(?:^|[./])demos?\//.test(normalized) || /(?:^|\/)demo[^/]*$/i.test(normalized)) return true
    if (/(?:^|[./])mocks?\//.test(normalized) || /\/mocks?$/i.test(normalized)) return true
    return false
  })
}

function resolveRelativeImport(parentRelativePath, specifier) {
  if (!(specifier.startsWith('./') || specifier.startsWith('../'))) return null
  const basePath = resolve(projectRoot, dirname(parentRelativePath), specifier)
  const candidates = extname(basePath)
    ? [basePath]
    : [`${basePath}.js`, `${basePath}.jsx`, join(basePath, 'index.js'), join(basePath, 'index.jsx')]
  return candidates.find((candidate) => existsSync(candidate)) || null
}

function oneHopImportedSources(pageRelativePath, pageSource) {
  const imported = []
  for (const specifier of collectSpecifiers(pageSource)) {
    const absolute = resolveRelativeImport(pageRelativePath, specifier)
    if (!absolute) continue
    imported.push({
      path: absolute,
      source: readFileSync(absolute, 'utf8'),
    })
  }
  return imported
}

function hasHttpCall(source, httpMethod, path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:\\b${httpMethod}|\\.${httpMethod})\\(\\s*['"\`]${escaped}['"\`]`).test(source)
}

function namesBoundToCall(source, httpMethod, path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const callRe = new RegExp(`(?:\\b${httpMethod}|\\.${httpMethod})\\(\\s*['"\`]${escaped}['"\`]`, 'g')
  const names = []
  let match = callRe.exec(source)
  while (match) {
    const windowStart = Math.max(0, match.index - 220)
    const before = source.slice(windowStart, match.index)
    const keys = [...before.matchAll(/(\w+)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/g)]
    if (keys.length) names.push(keys[keys.length - 1][1])
    const fns = [...before.matchAll(/(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{/g)]
    if (fns.length) names.push(fns[fns.length - 1][1])
    const assigns = [...before.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g)]
    if (assigns.length) names.push(assigns[assigns.length - 1][1])
    match = callRe.exec(source)
  }
  return [...new Set(names)]
}

function assertPageCallsEndpoint(pageRelativePath, pageSource, importedSources, httpMethod, path) {
  if (hasHttpCall(pageSource, httpMethod, path)) return
  const names = importedSources.flatMap((item) => namesBoundToCall(item.source, httpMethod, path))
  const called = names.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(pageSource))
  const wired = importedSources.some((item) => hasHttpCall(item.source, httpMethod, path))
  assert.ok(
    called && wired,
    `${pageRelativePath} 必须调用 ${httpMethod.toUpperCase()} ${path}（页面内直写 client.${httpMethod}，或调用封装了该路径的现有 api 方法；不得发明新客户端）`,
  )
}

function hasRealLogout(pageSource, importedSources) {
  const combined = [pageSource, ...importedSources.map((item) => item.source)].join('\n')
  const pageCallsLogout = /\.logout\s*\(/.test(pageSource) || /post\(\s*['"`]\/auth\/logout['"`]/.test(pageSource)
  const wired = /\/auth\/logout/.test(combined) || /createAuthApi\s*\(/.test(pageSource)
  return pageCallsLogout && wired
}

function extractSelfClosingTags(source, tagName) {
  const re = new RegExp(`<${tagName}\\b[\\s\\S]*?\\/>`, 'g')
  return [...source.matchAll(re)].map((match) => match[0])
}

function consoleShellBlock(consoleAppSource) {
  const shellStart = consoleAppSource.indexOf('<Route element={<ConsoleShell />}>')
  assert.ok(shellStart >= 0, 'ConsoleApp 必须把业务路由放在 ConsoleShell 之内')
  const catchAll = consoleAppSource.indexOf('path="*"', shellStart)
  assert.ok(catchAll > shellStart, 'ConsoleShell 内必须仍有 catch-all')
  return consoleAppSource.slice(shellStart, catchAll)
}

test('G6-12 StudentApp 挂载 /student/me/settings 且 AccountSettings 页面文件存在', () => {
  const studentApp = readSource('src/student/StudentApp.jsx')
  const problems = []
  if (!fileExists(STUDENT_SETTINGS)) {
    problems.push('缺少 src/student/pages/settings/AccountSettings.jsx')
  }
  const imported = studentApp.match(/import\s+(\w+)\s+from\s+['"]\.\/pages\/settings\/AccountSettings\.jsx['"]/)
  if (!imported) {
    problems.push('src/student/StudentApp.jsx 未 import ./pages/settings/AccountSettings.jsx')
  } else if (!new RegExp(`<${imported[1]}\\b`).test(studentApp)) {
    problems.push(`src/student/StudentApp.jsx 未渲染 <${imported[1]}`)
  }
  if (!/path="me\/settings"/.test(studentApp)) {
    problems.push('src/student/StudentApp.jsx 未挂载 path="me/settings"（即 /student/me/settings）')
  }
  assert.deepEqual(problems, [], `G6-12 未满足：${problems.join('；')}`)
})

test('G6-13 Me.jsx 设置入口不再 unavailable，且指向 /student/me/settings', () => {
  const me = readSource('src/student/pages/Me.jsx')
  const problems = []
  if (me.includes('设置服务端接入中')) {
    problems.push('仍出现「设置服务端接入中」')
  }
  if (me.includes('头像可以在设置里换')) {
    problems.push('仍出现「头像可以在设置里换」')
  }
  if (!/to=\{?\s*['"]\/student\/me\/settings['"]/.test(me)) {
    problems.push('设置入口未指向 /student/me/settings')
  }
  const settingsEntries = extractSelfClosingTags(me, 'Entry').filter((entry) => /title="设置"/.test(entry))
  for (const entry of settingsEntries) {
    if (/\bunavailable\b/.test(entry) && !/unavailable=\{\s*false\s*\}/.test(entry)) {
      problems.push('title="设置" 的 Entry 仍带 unavailable')
    }
    if (!/to=\{?\s*['"]\/student\/me\/settings['"]/.test(entry)) {
      problems.push('title="设置" 的 Entry 未指向 /student/me/settings')
    }
  }
  assert.deepEqual(problems, [], `G6-13 未满足：${problems.join('；')}`)
})

test('G6-14 学生端 Settings.jsx 与控制台 Me.jsx 演示壳必须已删除', () => {
  const leftover = []
  if (fileExists(STUDENT_DEMO_SHELL)) leftover.push(STUDENT_DEMO_SHELL)
  if (fileExists(CONSOLE_DEMO_SHELL)) leftover.push(CONSOLE_DEMO_SHELL)
  assert.deepEqual(leftover, [], `演示壳必须已删除，不得继续复用：${leftover.join('、')}`)
})

test('G6-15 两个新设置页均不 import data/fixtures/demo/mocks', () => {
  const problems = []
  for (const relativePath of [STUDENT_SETTINGS, CONSOLE_SETTINGS]) {
    if (!fileExists(relativePath)) {
      problems.push(`缺少 ${relativePath}`)
      continue
    }
    const bad = forbiddenImportSpecifiers(readSource(relativePath))
    if (bad.length) {
      problems.push(`${relativePath} 不得 import ${bad.join(', ')}`)
    }
  }
  assert.deepEqual(problems, [], `G6-15 未满足：${problems.join('；')}`)
})

test('G6-16 ConsoleApp 挂载 /console/settings 于 ConsoleShell 之内，且 isMountedConsolePath 已登记', () => {
  const consoleApp = readSource('src/console/ConsoleApp.jsx')
  const problems = []
  if (!fileExists(CONSOLE_SETTINGS)) {
    problems.push('缺少 src/console/pages/Settings.jsx')
  }
  const imported = consoleApp.match(/import\s+(\w+)\s+from\s+['"]\.\/pages\/Settings\.jsx['"]/)
  if (!imported) {
    problems.push('src/console/ConsoleApp.jsx 未 import ./pages/Settings.jsx')
  }
  let shellBlock = ''
  try {
    shellBlock = consoleShellBlock(consoleApp)
  } catch (error) {
    problems.push(error.message)
  }
  if (shellBlock && !/path="settings"/.test(shellBlock)) {
    problems.push('ConsoleShell 之内未挂载 path="settings"（即 /console/settings）')
  }
  if (imported && shellBlock && !new RegExp(`path="settings"[\\s\\S]{0,200}<${imported[1]}\\b`).test(shellBlock)) {
    problems.push(`ConsoleShell 内 path="settings" 未渲染 <${imported[1]}`)
  }
  if (!isMountedConsolePath('/console/settings')) {
    problems.push('isMountedConsolePath 未登记 /console/settings')
  }
  if (!canAccessConsolePath({ scopeType: 'class' }, '/console/settings')) {
    problems.push('教师 class 工作空间应可访问 /console/settings')
  }
  if (!canAccessConsolePath({ scopeType: 'grade' }, '/console/settings')) {
    problems.push('年级主任 grade 工作空间应可访问 /console/settings')
  }
  if (!canAccessConsolePath({ scopeType: 'school' }, '/console/settings')) {
    problems.push('校长 school 工作空间应可访问 /console/settings')
  }
  if (canAccessConsolePath({ scopeType: 'platform' }, '/console/settings')) {
    problems.push('platform 运维空间不可访问 /console/settings')
  }
  assert.deepEqual(problems, [], `G6-16 未满足：${problems.join('；')}`)
})

test('G6-17 TopBar 在「管理任教班级」与「帮助与反馈」之间新增设置菜单项，且帮助仍 disabled', () => {
  const topBar = readSource('src/console/components/shell/TopBar.jsx')
  const problems = []
  const rows = extractSelfClosingTags(topBar, 'MenuRow')
  const settingsRow = rows.find((row) => /label="设置"/.test(row))
  const helpRow = rows.find((row) => /label="帮助与反馈"/.test(row))
  const manageIdx = topBar.indexOf('label="管理任教班级"')
  const settingsLabelIdx = topBar.indexOf('label="设置"')
  const helpIdx = topBar.indexOf('label="帮助与反馈"')

  if (!settingsRow) {
    problems.push('TopBar 未新增 label="设置" 的 MenuRow')
  } else {
    if (/\bdisabled\b/.test(settingsRow) && !/disabled=\{\s*false\s*\}/.test(settingsRow)) {
      problems.push('设置菜单项不得 disabled')
    }
    if (!/\/console\/settings/.test(settingsRow) && !/navigate\(\s*['"`]\/console\/settings['"`]/.test(topBar)) {
      problems.push('设置菜单项必须指向 /console/settings')
    }
  }
  if (manageIdx < 0) problems.push('找不到「管理任教班级」菜单项')
  if (helpIdx < 0) problems.push('找不到「帮助与反馈」菜单项')
  if (settingsLabelIdx < 0) {
    problems.push('找不到 label="设置"')
  } else if (manageIdx >= 0 && helpIdx >= 0 && !(manageIdx < settingsLabelIdx && settingsLabelIdx < helpIdx)) {
    problems.push('设置菜单项必须插在「管理任教班级」与「帮助与反馈」之间')
  }
  if (!helpRow) {
    problems.push('TopBar 必须仍有「帮助与反馈」MenuRow')
  } else {
    if (!/\bdisabled\b/.test(helpRow)) {
      problems.push('「帮助与反馈」必须仍为 disabled，不得启用')
    }
    if (!/帮助与反馈服务暂未开放/.test(helpRow)) {
      problems.push('「帮助与反馈」必须仍标明服务暂未开放')
    }
  }
  assert.deepEqual(problems, [], `G6-17 未满足：${problems.join('；')}`)
})

test('G6-18 两个设置页必须调用 POST /me/password 与 PATCH /me/profile，真实 logout，且无假开关', () => {
  const problems = []
  for (const relativePath of [STUDENT_SETTINGS, CONSOLE_SETTINGS]) {
    if (!fileExists(relativePath)) {
      problems.push(`缺少 ${relativePath}`)
      continue
    }
    const pageSource = readSource(relativePath)
    const imported = oneHopImportedSources(relativePath, pageSource)
    try {
      assertPageCallsEndpoint(relativePath, pageSource, imported, 'post', '/me/password')
    } catch (error) {
      problems.push(error.message)
    }
    try {
      assertPageCallsEndpoint(relativePath, pageSource, imported, 'patch', '/me/profile')
    } catch (error) {
      problems.push(error.message)
    }
    if (!hasRealLogout(pageSource, imported)) {
      problems.push(`${relativePath} 退出登录必须调用真实 logout（authApi.logout 或 POST /auth/logout），不得只跳转登录页`)
    }
    if (/<Link\b[^>]*to=["']\/(?:student|console)\/login["']/.test(pageSource)) {
      problems.push(`${relativePath} 不得用 Link 到登录页冒充退出`)
    }
    if (/type\s*=\s*['"]checkbox['"]/.test(pageSource) || /type\s*=\s*\{\s*['"]checkbox['"]\s*\}/.test(pageSource)) {
      problems.push(`${relativePath} 不得出现 checkbox（本轮设置没有需对接接口的开关）`)
    }
    if (/role\s*=\s*['"]switch['"]/.test(pageSource) || /student-switch|console-switch/.test(pageSource)) {
      problems.push(`${relativePath} 不得出现开关类控件（role=switch / student-switch / console-switch）`)
    }
  }
  assert.deepEqual(problems, [], `G6-18 未满足：${problems.join('；')}`)
})

test('G6-19 两个设置页均不出现头像选择相关 UI', () => {
  const problems = []
  const avatarUi = /AVATAR_PRESETS|avatarPreset|换头像|选择头像|头像库|头像预设|只能从学校预设里选/
  for (const relativePath of [STUDENT_SETTINGS, CONSOLE_SETTINGS]) {
    if (!fileExists(relativePath)) {
      problems.push(`缺少 ${relativePath}`)
      continue
    }
    const source = readSource(relativePath)
    if (avatarUi.test(source) || source.includes('头像')) {
      problems.push(`${relativePath} 不得出现头像选择相关 UI（本轮不做头像库）`)
    }
  }
  assert.deepEqual(problems, [], `G6-19 未满足：${problems.join('；')}`)
})
