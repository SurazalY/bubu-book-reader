/**
 * T3-1a 守卫 G3-11～G3-16：重置密码前端契约（源码扫描）。
 * 只扫源码，不写实现。新页 / 新接口未就位时必须红，不得 skip。
 *
 * 病根：教师端签发重置码、学生端「忘记密码」只 setFeedback，消费接口前端零调用。
 * 本轮废掉学生侧重置码输入，改为老师看到 6 位临时密码并转告。
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

const FORGOT_PASSWORD_PAGE = 'src/student/pages/ForgotPassword.jsx'
const STUDENT_APP = 'src/student/StudentApp.jsx'
const STUDENT_LOGIN = 'src/student/pages/Login.jsx'
const CONSOLE_LOGIN = 'src/console/pages/Login.jsx'
const ORG_ACCOUNTS = 'src/console/pages/accounts/OrgAccounts.jsx'
const IDENTITY_API_CONTRACT_PATH = 'src/console/state/identityApi.js'
const IDENTITY_API_ACTUAL_PATH = 'src/console/pages/accounts/identityApi.js'

const FORGOT_PATH = '/student/forgot-password'
const HELP_COPY = '请找班主任重置密码，老师会把新密码告诉你'

function readSource(relativePath) {
  return readFileSync(join(projectRoot, relativePath), 'utf8')
}

function fileExists(relativePath) {
  return existsSync(join(projectRoot, relativePath))
}

function toPosixRelative(absolutePath) {
  return relative(projectRoot, absolutePath).replaceAll('\\', '/')
}

function collectSrcFiles(directory = join(projectRoot, 'src'), files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      collectSrcFiles(fullPath, files)
      continue
    }
    if (entry.name.endsWith('.js') || entry.name.endsWith('.jsx')) files.push(fullPath)
  }
  return files
}

function extractStudentAppOuterRoutes(studentApp) {
  const start = studentApp.indexOf('export default function StudentApp')
  const runtime = studentApp.indexOf('function StudentRuntime')
  assert.ok(start >= 0, 'StudentApp.jsx 必须仍导出 StudentApp')
  assert.ok(runtime > start, 'StudentApp.jsx 必须仍有 StudentRuntime（用于确认忘记密码挂在未登录路由）')
  return studentApp.slice(start, runtime)
}

function forgotPasswordEntryWindow(loginSource) {
  const at = loginSource.indexOf('忘记密码')
  assert.ok(at >= 0, `${STUDENT_LOGIN} 必须仍有「忘记密码」入口`)
  return loginSource.slice(Math.max(0, at - 480), Math.min(loginSource.length, at + 160))
}

function hasRouteJump(entry) {
  return (
    /<Link\b/.test(entry) ||
    /\bto\s*=/.test(entry) ||
    /\bnavigate\s*\(/.test(entry) ||
    /\bnav\s*\(/.test(entry)
  )
}

function hasResetCodeInput(source) {
  const inputish = [...source.matchAll(/<(input|textarea)\b[\s\S]*?>/gi)].map((match) => match[0])
  const labels = [...source.matchAll(/<label\b[\s\S]*?<\/label>/gi)].map((match) => match[0])
  const hint =
    /重置码|验证码|\bresetToken\b|\bresetCode\b|\brawToken\b|\bpasswordResetToken\b|(?:name|placeholder|aria-label|id)\s*=\s*['"{]*\s*(?:token|resetToken|resetCode|verifyCode|verificationCode)/i
  return inputish.some((block) => hint.test(block)) || labels.some((block) => hint.test(block))
}

function methodNamesNear(source, snippetRe) {
  const names = []
  const re = new RegExp(snippetRe, 'g')
  let match = re.exec(source)
  while (match) {
    const before = source.slice(Math.max(0, match.index - 280), match.index)
    const keys = [...before.matchAll(/(\w+)\s*:\s*(?:async\s*)?\(/g)]
    if (keys.length) names.push(keys[keys.length - 1][1])
    const assigns = [...before.matchAll(/(?:const|let|var|function|async function)\s+(\w+)/g)]
    if (assigns.length) names.push(assigns[assigns.length - 1][1])
    match = re.exec(source)
  }
  return [...new Set(names)]
}

function pageCallsNamed(pageSource, names) {
  return names.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(pageSource))
}

function hasNewPasswordResetPost(source) {
  return /(?:\bpost|\.post)\s*\(\s*[\s\S]{0,160}\/users\/[^\s`'"]{0,160}password-reset(?!-credentials)/i.test(
    source,
  )
}

function hasTempPasswordGet(source) {
  return /(?:\bget|\.get)\s*\(\s*[\s\S]{0,160}\/users\/[^\s`'"]{0,160}temp-password/i.test(source)
}

function identityApiPaths() {
  return [IDENTITY_API_CONTRACT_PATH, IDENTITY_API_ACTUAL_PATH].filter((relativePath) =>
    fileExists(relativePath),
  )
}

function findTempPasswordPersistence(source) {
  const hits = []
  const patterns = [
    [
      'storage',
      /(?:localStorage|sessionStorage)\.setItem\s*\(\s*[^)]*(?:newPassword|tempPassword|temp-password|临时密码|plaintext)|(?:localStorage|sessionStorage)\.setItem\s*\(\s*[^,]+,\s*(?:newPassword|tempPassword|password|plaintext)\b/gi,
    ],
    [
      'storage-key',
      /(?:localStorage|sessionStorage)(?:\.setItem\s*\(\s*['"`]|\[)\s*['"`][^'"`]*(?:tempPassword|temp-password|newPassword|临时密码)/gi,
    ],
    [
      'route-state',
      /(?:navigate|nav)\s*\(\s*[\s\S]{0,240}state\s*:\s*\{[\s\S]{0,300}?\b(?:password|newPassword|tempPassword|temp_password)\b/g,
    ],
    ['url', /[?&#](?:password|newPassword|tempPassword|temp_password)=/gi],
    [
      'searchParams',
      /(?:searchParams|URLSearchParams)[\s\S]{0,120}(?:\.set|\.append)\s*\(\s*['"`](?:password|newPassword|tempPassword|temp-password)['"`]/gi,
    ],
    ['hash', /location\.hash[\s\S]{0,80}(?:password|newPassword|tempPassword|临时密码)/gi],
  ]
  for (const [kind, re] of patterns) {
    re.lastIndex = 0
    let match = re.exec(source)
    while (match) {
      hits.push(`${kind}:${match[0].replace(/\s+/g, ' ').slice(0, 120)}`)
      match = re.exec(source)
    }
  }
  return hits
}

test('G3-11 ForgotPassword.jsx 存在且 StudentApp 挂 /student/forgot-password，页内不得有重置码/token/验证码输入框', () => {
  const problems = []
  if (!fileExists(FORGOT_PASSWORD_PAGE)) {
    problems.push(`缺少 ${FORGOT_PASSWORD_PAGE}`)
  } else if (hasResetCodeInput(readSource(FORGOT_PASSWORD_PAGE))) {
    problems.push(`${FORGOT_PASSWORD_PAGE} 不得出现重置码 / token / 验证码输入框（input/textarea 的 name、placeholder、label 都算）`)
  }

  const studentApp = readSource(STUDENT_APP)
  const outer = extractStudentAppOuterRoutes(studentApp)
  const imported = studentApp.match(
    /import\s+(\w+)\s+from\s+['"]\.\/pages\/ForgotPassword\.jsx['"]/,
  )
  if (!imported) {
    problems.push(`${STUDENT_APP} 未 import ./pages/ForgotPassword.jsx`)
  }
  if (!/path=["']forgot-password["']/.test(outer) && !outer.includes(FORGOT_PATH)) {
    problems.push(
      `${STUDENT_APP} 未在与 login 同级的未登录 Routes 挂 path="forgot-password"（即 ${FORGOT_PATH}）；不得只挂在 StudentRuntime 内`,
    )
  }
  if (imported && outer && !new RegExp(`<${imported[1]}\\b`).test(outer)) {
    problems.push(`${STUDENT_APP} 未登录路由未渲染 <${imported[1]}`)
  }
  assert.deepEqual(problems, [], `G3-11 未满足：${problems.join('；')}`)
})

test('G3-12 学生 Login「忘记密码」必须跳转 /student/forgot-password，不得再 setFeedback', () => {
  const login = readSource(STUDENT_LOGIN)
  const entry = forgotPasswordEntryWindow(login)
  const problems = []
  if (!login.includes(FORGOT_PATH)) {
    problems.push(`${STUDENT_LOGIN} 必须出现跳转目标 ${FORGOT_PATH}`)
  }
  if (!hasRouteJump(entry)) {
    problems.push('「忘记密码」必须是 Link / navigate / to= 路由跳转，不能只是按钮 onClick')
  }
  if (/setFeedback\s*\(/.test(entry)) {
    problems.push('「忘记密码」不得再就地把 feedback 设成一行文案')
  }
  assert.deepEqual(problems, [], `G3-12 未满足：${problems.join('；')}`)
})

test('G3-13 identityApi 中不再存在 revokePasswordResetCredential', () => {
  const hits = []
  const known = identityApiPaths()
  if (fileExists(IDENTITY_API_CONTRACT_PATH) || fileExists(IDENTITY_API_ACTUAL_PATH)) {
    for (const relativePath of known) {
      if (readSource(relativePath).includes('revokePasswordResetCredential')) {
        hits.push(relativePath)
      }
    }
  }
  for (const absolute of collectSrcFiles()) {
    const relativePath = toPosixRelative(absolute)
    if (known.includes(relativePath)) continue
    const source = readFileSync(absolute, 'utf8')
    if (source.includes('revokePasswordResetCredential')) hits.push(relativePath)
  }
  assert.deepEqual(
    hits,
    [],
    `revokePasswordResetCredential 调用的后端路由不存在，必须从前端删除；仍出现在：${hits.join('、') || '(identityApi 文件缺失且全 src 未扫到，若实现方尚未建封装则应删除该标识符而非改名躲扫描)'}`,
  )
})

test('G3-14 OrgAccounts 必须调用新签发/查询接口，并对 available / cleared / none 三态分别渲染', () => {
  const problems = []
  if (!fileExists(ORG_ACCOUNTS)) {
    problems.push(`缺少 ${ORG_ACCOUNTS}`)
    assert.deepEqual(problems, [], `G3-14 未满足：${problems.join('；')}`)
    return
  }

  const page = readSource(ORG_ACCOUNTS)
  const apiPath = fileExists(IDENTITY_API_ACTUAL_PATH)
    ? IDENTITY_API_ACTUAL_PATH
    : IDENTITY_API_CONTRACT_PATH
  const api = fileExists(apiPath) ? readSource(apiPath) : ''
  const combined = `${page}\n${api}`

  if (!hasNewPasswordResetPost(combined)) {
    problems.push(
      '必须 POST /users/:userId/password-reset 签发临时密码；不得把旧路径 password-reset-credentials 当成新接口',
    )
  }
  if (!hasTempPasswordGet(combined)) {
    problems.push('必须 GET /users/:userId/temp-password 查询当前临时密码')
  }

  const postNames = methodNamesNear(
    combined,
    /\/users\/[^\s`'"]{0,160}password-reset(?!-credentials)/,
  )
  const getNames = methodNamesNear(combined, /\/users\/[^\s`'"]{0,160}temp-password/)
  const pageHasPostPath = hasNewPasswordResetPost(page)
  const pageHasGetPath = hasTempPasswordGet(page)
  if (!pageHasPostPath && !pageCallsNamed(page, postNames)) {
    problems.push('OrgAccounts.jsx 必须实际调用新的 password-reset 签发封装（或页面内直写该路径）')
  }
  if (!pageHasGetPath && !pageCallsNamed(page, getNames)) {
    problems.push('OrgAccounts.jsx 必须实际调用 temp-password 查询封装（或页面内直写该路径）')
  }

  if (!page.includes('重置密码')) {
    problems.push('「签发重置码」必须改为「重置密码」')
  }
  if (page.includes('签发重置码')) {
    problems.push('不得再保留「签发重置码」按钮文案')
  }
  if (page.includes('重置码')) {
    problems.push('OrgAccounts.jsx 不得再出现「重置码」字样（旧重置码 UI 必须换成临时密码）')
  }
  if (/\brawToken\b/.test(page)) {
    problems.push('不得再展示 rawToken；签发响应应使用 newPassword')
  }
  if (!/\bnewPassword\b/.test(combined)) {
    problems.push('必须读取签发响应字段 newPassword 并展示')
  }

  if (!page.includes('当前临时密码')) {
    problems.push('有可用临时密码时必须渲染「当前临时密码」')
  }
  if (!page.includes('学生已自行修改')) {
    problems.push('学生已改密时必须渲染「学生已自行修改」')
  }

  const hasAvailable = /['"]available['"]/.test(combined)
  const hasCleared = /['"]cleared['"]/.test(combined)
  const hasNone = /['"]none['"]/.test(combined)
  if (!hasAvailable) problems.push("必须出现 status === 'available'（或字面量 'available'）渲染分支")
  if (!hasCleared) problems.push("必须出现 status === 'cleared' 渲染分支")
  if (!hasNone) {
    problems.push("必须出现从未重置过的空态分支（status: 'none'）")
  }

  assert.deepEqual(problems, [], `G3-14 未满足：${problems.join('；')}`)
})

test('G3-15 前端不得把临时密码写入 localStorage / sessionStorage / URL query / 路由 state', () => {
  const problems = []
  for (const absolute of collectSrcFiles()) {
    const relativePath = toPosixRelative(absolute)
    const source = readFileSync(absolute, 'utf8')
    const hits = findTempPasswordPersistence(source)
    if (!hits.length) continue
    problems.push(`${relativePath} → ${hits.join(' | ')}`)
  }
  assert.deepEqual(
    problems,
    [],
    `临时密码只允许内存渲染与剪贴板复制，不得写入 storage / search / hash / react-router state：${problems.join('；')}`,
  )
})

test('G3-16 两端登录页与忘记密码页不得出现「重置码」，措辞须与新流程一致', () => {
  const problems = []
  const loginFiles = [STUDENT_LOGIN, CONSOLE_LOGIN]
  for (const relativePath of loginFiles) {
    const source = readSource(relativePath)
    if (source.includes('重置码')) {
      problems.push(`${relativePath} 不得出现「重置码」（「重置密码」四字可以）`)
    }
  }

  if (!fileExists(FORGOT_PASSWORD_PAGE)) {
    problems.push(`缺少 ${FORGOT_PASSWORD_PAGE}，无法核对说明文案`)
  } else {
    const forgot = readSource(FORGOT_PASSWORD_PAGE)
    if (forgot.includes('重置码')) {
      problems.push(`${FORGOT_PASSWORD_PAGE} 不得出现「重置码」`)
    }
    if (!forgot.includes(HELP_COPY)) {
      problems.push(`${FORGOT_PASSWORD_PAGE} 必须含契约原文：「${HELP_COPY}」`)
    }
    if (!forgot.includes('返回登录')) {
      problems.push(`${FORGOT_PASSWORD_PAGE} 必须提供「返回登录」`)
    }
  }

  assert.deepEqual(problems, [], `G3-16 未满足：${problems.join('；')}`)
})
