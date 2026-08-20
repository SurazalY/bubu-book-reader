/**
 * T5-1a 守卫 G5-1～G5-5：培新校徽落位前端契约（源码扫描）。
 * 只扫源码，不写实现。Login / BrandMark / index.html 尚未引用新资产时必须红，不得 skip。
 *
 * 资产已在 public/brand/（不要测「文件是否存在」）。本守卫盯产品代码是否引用、怎么引用。
 * 静态资源路径沿用 Backdrop：`${import.meta.env.BASE_URL}bg/reading-scene.png`，禁止 import PNG 进 bundle。
 *
 * 品牌区锚点是「欢迎回来」之前；不扫描、不要求改忘记密码相关行或 ForgotPassword.jsx。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

const STUDENT_LOGIN = 'src/student/pages/Login.jsx'
const CONSOLE_LOGIN = 'src/console/pages/Login.jsx'
const STUDENT_BRAND = 'src/student/components/BrandMark.jsx'
const CONSOLE_BRAND = 'src/console/components/BrandMark.jsx'
const INDEX_HTML = 'index.html'

const LOCKUP_720 = 'brand/peixin-lockup@720.png'
const LOCKUP_2X = 'brand/peixin-lockup.png'
const MARK_128 = 'brand/peixin-mark@128.png'
const WORDMARK = 'brand/peixin-wordmark.png'
const FAVICON = 'brand/peixin-favicon.png'

const TITLE = '整书阅读 · 让每个孩子读完一本好书'
const OLD_MARK_PATH = 'M23 15.5C19.6 11.4'

const LOCKUP_WIDTH_MIN = 220
const LOCKUP_WIDTH_MAX = 280
const WORDMARK_HEIGHT_MIN = 20
const WORDMARK_HEIGHT_MAX = 32
const CONSOLE_MARK_SIZES = new Set([32, 40])

const TAILWIND_PX = new Map([
  ['w-5', 20],
  ['h-5', 20],
  ['w-6', 24],
  ['h-6', 24],
  ['w-7', 28],
  ['h-7', 28],
  ['w-8', 32],
  ['h-8', 32],
  ['w-10', 40],
  ['h-10', 40],
])

function readSource(relativePath) {
  return readFileSync(join(projectRoot, relativePath), 'utf8')
}

function loginBrandWindow(source, fileLabel) {
  const start = source.indexOf('return (')
  const heading = source.indexOf('欢迎回来')
  assert.ok(start >= 0, `${fileLabel} 必须有 return (`)
  assert.ok(
    heading > start,
    `${fileLabel} 必须仍有「欢迎回来」标题（本守卫只用它定位顶部品牌区，不检查忘记密码）`,
  )
  return source.slice(start, heading)
}

function extractImgTags(source) {
  return [...source.matchAll(/<img\b[\s\S]*?>/gi)].map((match) => match[0])
}

function getAttrRaw(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(\\{[^}]*\\}|"[^"]*"|'[^']*')`)
  const match = tag.match(re)
  return match ? match[1] : null
}

function assignedLiteral(source, ident) {
  const re = new RegExp(`(?:const|let|var)\\s+${ident}\\s*=\\s*([\\s\\S]*?)\\n`)
  const match = source.match(re)
  return match ? match[1].trim() : ''
}

function resolveAttrText(source, tag, name) {
  const raw = getAttrRaw(tag, name)
  if (!raw) return ''
  if (raw.startsWith('{')) {
    const expr = raw.slice(1, -1).trim()
    const ident = expr.match(/^[A-Za-z_$][\w$]*$/)
    if (ident) return assignedLiteral(source, ident[0])
    return expr
  }
  return raw
}

function imgReferences(source, tag, filename) {
  if (tag.includes(filename)) return true
  for (const attr of ['src', 'srcSet', 'srcset']) {
    if (resolveAttrText(source, tag, attr).includes(filename)) return true
  }
  return false
}

function findAssetImg(source, filename, scope = source) {
  return extractImgTags(scope).find((tag) => imgReferences(source, tag, filename)) || null
}

function usesBaseUrlPublicAsset(source, publicRelativePath) {
  const escaped = publicRelativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`import\\.meta\\.env\\.BASE_URL\\s*\\}\\s*${escaped}`).test(source)) return true
  if (new RegExp(`import\\.meta\\.env\\.BASE_URL\\s*\\+\\s*['"\`]${escaped}`).test(source)) return true
  const aliases = [
    ...source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*import\.meta\.env\.BASE_URL/g),
  ].map((match) => match[1])
  for (const name of aliases) {
    if (new RegExp(`\\$\\{\\s*${name}\\s*\\}\\s*${escaped}`).test(source)) return true
    if (new RegExp(`${name}\\s*\\+\\s*['"\`]${escaped}`).test(source)) return true
  }
  return false
}

function importsStaticPng(source) {
  return (
    /(?:import|export)\s+[\s\S]{0,160}?from\s+['"][^'"]+\.png['"]/.test(source) ||
    /import\s*\(\s*['"][^'"]+\.png['"]\s*\)/.test(source) ||
    /\.png['"]\s*,\s*import\.meta\.url/.test(source)
  )
}

function backgroundImageMentions(source, filename) {
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(String.raw`background(?:-image|Image)\s*[:=][\s\S]{0,240}${escaped}`, 'i').test(
    source,
  )
}

function classTokens(tag) {
  const raw = `${getAttrRaw(tag, 'className') || ''} ${getAttrRaw(tag, 'class') || ''}`
  return raw.replace(/[`"'{}]/g, ' ').split(/\s+/).filter(Boolean)
}

function boxFromClass(tag, prefix) {
  for (const token of classTokens(tag)) {
    const arbitrary = token.match(new RegExp(`^${prefix}-\\[(\\d+)px\\]$`))
    if (arbitrary) return Number(arbitrary[1])
    const mapped = TAILWIND_PX.get(token)
    if (mapped && token.startsWith(`${prefix}-`)) return mapped
  }
  return null
}

function numericFromAttr(source, tag, name) {
  const raw = getAttrRaw(tag, name)
  if (!raw) return null
  if (raw.startsWith('{')) {
    const expr = raw.slice(1, -1).trim()
    if (/^\d+(\.\d+)?$/.test(expr)) return Number(expr)
    const ident = expr.match(/^[A-Za-z_$][\w$]*$/)
    if (!ident) return null
    const assigned = assignedLiteral(source, ident[0]).match(/^(\d+)/)
    return assigned ? Number(assigned[1]) : null
  }
  const value = Number(String(raw).replace(/['"]/g, '').replace(/px$/i, ''))
  return Number.isFinite(value) ? value : null
}

function numericFromStyle(tag, prop) {
  const style = getAttrRaw(tag, 'style') || ''
  const match = style.match(new RegExp(`${prop}\\s*:\\s*['"]?(\\d+)`))
  return match ? Number(match[1]) : null
}

function readBox(source, tag) {
  const width =
    numericFromAttr(source, tag, 'width') ?? numericFromStyle(tag, 'width') ?? boxFromClass(tag, 'w')
  const height =
    numericFromAttr(source, tag, 'height') ??
    numericFromStyle(tag, 'height') ??
    boxFromClass(tag, 'h')
  return {
    width,
    height,
    hasWidthAttr: /\bwidth\s*=/.test(tag) || boxFromClass(tag, 'w') != null || numericFromStyle(tag, 'width') != null,
    hasHeightAttr:
      /\bheight\s*=/.test(tag) || boxFromClass(tag, 'h') != null || numericFromStyle(tag, 'height') != null,
    aspect: /aspect-\[|aspectRatio|\baspect-/.test(tag),
  }
}

function hasExplicitDimensions(source, tag) {
  const box = readBox(source, tag)
  if (box.width != null && box.height != null) return true
  if (box.hasWidthAttr && box.hasHeightAttr) return true
  if ((box.width != null || box.hasWidthAttr) && box.aspect) return true
  return false
}

function readAlt(source, tag) {
  const raw = getAttrRaw(tag, 'alt')
  if (raw == null) return { missing: true, value: null }
  if (raw.startsWith('{')) {
    const expr = raw.slice(1, -1).trim()
    const quoted = expr.match(/^['"]([\s\S]*)['"]$/) || expr.match(/^`([\s\S]*)`$/)
    if (quoted) return { missing: false, value: quoted[1] }
    const ident = expr.match(/^[A-Za-z_$][\w$]*$/)
    if (ident) {
      const assigned = assignedLiteral(source, ident[0])
      const assignedQuoted = assigned.match(/^['"]([\s\S]*)['"]$/) || assigned.match(/^`([\s\S]*)`$/)
      if (assignedQuoted) return { missing: false, value: assignedQuoted[1] }
      return { missing: false, value: assigned.replace(/^['"`]|['"`]$/g, '') }
    }
    return { missing: false, value: expr }
  }
  return { missing: false, value: raw.replace(/^['"]|['"]$/g, '') }
}

function altProblems(source, tag, label) {
  const problems = []
  const alt = readAlt(source, tag)
  if (alt.missing || alt.value == null) {
    problems.push(`${label} 必须有 alt`)
    return problems
  }
  const trimmed = String(alt.value).trim()
  if (!trimmed) {
    problems.push(`${label} alt 不得为空`)
  } else if (/^(logo|img|image|icon|brand)$/i.test(trimmed)) {
    problems.push(`${label} alt 不得为「logo」等无意义词，须为「培新教育」这类品牌名`)
  } else if (!trimmed.includes('培新')) {
    problems.push(`${label} alt 必须含「培新」（例如「培新教育」）`)
  }
  return problems
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function displaysDubanBrandName(source) {
  const code = stripComments(source)
  return />\s*读伴\s*</.test(code) || /['"`]读伴['"`]/.test(code)
}

function hasShowTextProp(source) {
  const signature = source.match(/export function BrandMark\s*\((\{[\s\S]*?\})\)/)
  return Boolean(signature && /\bshowText\b/.test(signature[1]))
}

function wordmarkGatedByShowText(source, wordmarkImg) {
  const index = source.indexOf(wordmarkImg)
  if (index < 0) return false
  const before = source.slice(Math.max(0, index - 520), index)
  return /\bshowText\s*&&/.test(before) || /\bshowText\s*\?/.test(before)
}

function collectLockupProblems(source, brandWindow, fileLabel) {
  const problems = []
  if (importsStaticPng(source)) {
    problems.push(`${fileLabel} 不得 import / 动态 import PNG 进 bundle，须用 import.meta.env.BASE_URL 拼接 public 路径`)
  }
  if (/<BrandMark\b/.test(brandWindow)) {
    problems.push(`${fileLabel} 顶部品牌区必须改用横版 lockup <img>，不得再渲染 <BrandMark>`)
  }
  if (backgroundImageMentions(source, 'peixin-lockup')) {
    problems.push(`${fileLabel} lockup 必须用 <img>，禁止 CSS background-image`)
  }
  if (!usesBaseUrlPublicAsset(source, LOCKUP_720)) {
    problems.push(
      `${fileLabel} 必须按 Backdrop 惯例写 \`\${import.meta.env.BASE_URL}${LOCKUP_720}\`（禁止 import 图片）`,
    )
  }
  if (!usesBaseUrlPublicAsset(source, LOCKUP_2X)) {
    problems.push(
      `${fileLabel} 高分屏 srcset 必须指向 \`\${import.meta.env.BASE_URL}${LOCKUP_2X}\``,
    )
  }

  const img = findAssetImg(source, 'peixin-lockup@720.png', brandWindow)
  if (!img) {
    problems.push(`${fileLabel} 顶部品牌区（「欢迎回来」之前）必须有引用 peixin-lockup@720.png 的 <img>`)
    return problems
  }

  const srcSetRaw = getAttrRaw(img, 'srcSet') || getAttrRaw(img, 'srcset')
  const srcSetText = `${srcSetRaw || ''} ${resolveAttrText(source, img, 'srcSet')} ${resolveAttrText(source, img, 'srcset')}`
  const srcSetHasFullRes = /peixin-lockup\.png/.test(srcSetText.replace(/peixin-lockup@720\.png/g, ''))
  if (!srcSetRaw) {
    problems.push(`${fileLabel} lockup <img> 必须带 srcSet/srcset，指向 ${LOCKUP_2X}`)
  } else if (!srcSetHasFullRes) {
    problems.push(`${fileLabel} lockup srcset 必须指向 peixin-lockup.png（全分辨率）；可同时列出 @720 作为 1x`)
  }

  const box = readBox(source, img)
  if (box.width == null || box.width < LOCKUP_WIDTH_MIN || box.width > LOCKUP_WIDTH_MAX) {
    problems.push(
      `${fileLabel} lockup 显示宽度必须是 ${LOCKUP_WIDTH_MIN}–${LOCKUP_WIDTH_MAX}px 的明确值（width 属性或 w-[Npx]），当前=${box.width ?? '无'}`,
    )
  }
  if (!hasExplicitDimensions(source, img)) {
    problems.push(`${fileLabel} lockup <img> 必须显式 width/height，或 width + 固定 aspect-ratio，防止首屏跳动`)
  }

  problems.push(...altProblems(source, img, `${fileLabel} lockup <img>`))
  return problems
}

function collectBrandMarkProblems(source, fileLabel, { consoleMarkSize = false } = {}) {
  const problems = []
  if (importsStaticPng(source)) {
    problems.push(`${fileLabel} 不得 import PNG 进 bundle`)
  }
  if (backgroundImageMentions(source, 'peixin-mark') || backgroundImageMentions(source, 'peixin-wordmark')) {
    problems.push(`${fileLabel} 徽标与字标必须用 <img>，禁止 CSS background-image`)
  }
  if (source.includes(OLD_MARK_PATH)) {
    problems.push(`${fileLabel} 必须拿掉旧的内联书页 SVG（出现 ${OLD_MARK_PATH}），改为 PNG <img>`)
  }
  if (!usesBaseUrlPublicAsset(source, MARK_128)) {
    problems.push(`${fileLabel} 图标必须按 BASE_URL 惯例引用 ${MARK_128}`)
  }
  if (!usesBaseUrlPublicAsset(source, WORDMARK)) {
    problems.push(`${fileLabel} 文字必须改用字标图，按 BASE_URL 惯例引用 ${WORDMARK}`)
  }
  if (displaysDubanBrandName(source)) {
    problems.push(`${fileLabel} 品牌位不得再展示「读伴」文字，须换成字标图片`)
  }
  if (!hasShowTextProp(source)) {
    problems.push(`${fileLabel} 必须保留现有 showText prop（收起态协议，不得改成 collapsed/compact 新 API）`)
  }

  const markImg = findAssetImg(source, 'peixin-mark@128.png')
  const wordImg = findAssetImg(source, 'peixin-wordmark.png')
  if (!markImg) {
    problems.push(`${fileLabel} 必须有引用 peixin-mark@128.png 的 <img>`)
  } else {
    if (!hasExplicitDimensions(source, markImg)) {
      problems.push(`${fileLabel} 徽标 <img> 必须显式宽高（或宽 + 固定宽高比）`)
    }
    problems.push(...altProblems(source, markImg, `${fileLabel} 徽标 <img>`))
    if (consoleMarkSize) {
      const box = readBox(source, markImg)
      const size = box.width ?? box.height
      const squareOk =
        box.width != null &&
        box.height != null &&
        CONSOLE_MARK_SIZES.has(box.width) &&
        box.width === box.height
      const oneOk = size != null && CONSOLE_MARK_SIZES.has(size) && (box.width == null || box.height == null)
      if (!squareOk && !oneOk) {
        problems.push(
          `${fileLabel} 侧栏徽标渲染尺寸必须钉死为 32 或 40px（字面量 / w-8 / w-10），不得继续吃调用方 size={30}；当前 width=${box.width ?? '无'} height=${box.height ?? '无'}`,
        )
      }
    }
  }

  if (!wordImg) {
    problems.push(`${fileLabel} 必须有引用 peixin-wordmark.png 的 <img>`)
  } else {
    if (!hasExplicitDimensions(source, wordImg)) {
      problems.push(`${fileLabel} 字标 <img> 必须显式宽高（或宽 + 固定宽高比）`)
    }
    const box = readBox(source, wordImg)
    if (
      box.height == null ||
      box.height < WORDMARK_HEIGHT_MIN ||
      box.height > WORDMARK_HEIGHT_MAX
    ) {
      problems.push(
        `${fileLabel} 字标高度须与原「读伴」文字相当，钉在 ${WORDMARK_HEIGHT_MIN}–${WORDMARK_HEIGHT_MAX}px（建议 24）；当前=${box.height ?? '无'}`,
      )
    }
    problems.push(...altProblems(source, wordImg, `${fileLabel} 字标 <img>`))
    if (hasShowTextProp(source) && !wordmarkGatedByShowText(source, wordImg)) {
      problems.push(`${fileLabel} 字标 <img> 必须由现有 showText 控制（showText && / 三元），收起态只留方形徽标`)
    }
  }

  return problems
}

test('G5-1 学生端 Login 顶部品牌区使用 peixin-lockup@720.png 的 <img>', () => {
  const source = readSource(STUDENT_LOGIN)
  const brandWindow = loginBrandWindow(source, STUDENT_LOGIN)
  const problems = collectLockupProblems(source, brandWindow, STUDENT_LOGIN)
  assert.deepEqual(problems, [], `G5-1 未满足：${problems.join('；')}`)
})

test('G5-2 控制台 Login 顶部品牌区使用 peixin-lockup@720.png 的 <img>', () => {
  const source = readSource(CONSOLE_LOGIN)
  const brandWindow = loginBrandWindow(source, CONSOLE_LOGIN)
  const problems = collectLockupProblems(source, brandWindow, CONSOLE_LOGIN)
  assert.deepEqual(problems, [], `G5-2 未满足：${problems.join('；')}`)
})

test('G5-3 学生端 BrandMark 改用 mark@128 + wordmark <img>，不再展示「读伴」', () => {
  const source = readSource(STUDENT_BRAND)
  const problems = collectBrandMarkProblems(source, STUDENT_BRAND)
  assert.deepEqual(problems, [], `G5-3 未满足：${problems.join('；')}`)
})

test('G5-4 控制台 BrandMark 同上，徽标 32/40px，showText 收起态只留方形徽标', () => {
  const source = readSource(CONSOLE_BRAND)
  const problems = collectBrandMarkProblems(source, CONSOLE_BRAND, { consoleMarkSize: true })
  assert.deepEqual(problems, [], `G5-4 未满足：${problems.join('；')}`)
})

test('G5-5 index.html 的 rel=icon 改为 peixin-favicon.png，title 保持不变', () => {
  const html = readSource(INDEX_HTML)
  const problems = []
  const links = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => /\brel\s*=\s*["']icon["']/.test(tag))

  const faviconLink = links.find((tag) => tag.includes('peixin-favicon.png'))
  if (!faviconLink) {
    problems.push(`${INDEX_HTML} 的 <link rel="icon"> 必须改为 ${FAVICON}（type="image/png"）`)
  } else {
    if (!/\btype\s*=\s*["']image\/png["']/.test(faviconLink)) {
      problems.push(`${INDEX_HTML} favicon 的 type 必须是 image/png`)
    }
    if (!/href\s*=\s*["'][^"']*brand\/peixin-favicon\.png["']/.test(faviconLink)) {
      problems.push(`${INDEX_HTML} favicon href 必须指向 /brand/peixin-favicon.png（或同路径）`)
    }
  }
  if (links.some((tag) => /logo\.svg/.test(tag))) {
    problems.push(`${INDEX_HTML} rel=icon 不得再指向 /logo.svg`)
  }
  if (!html.includes(`<title>${TITLE}</title>`)) {
    problems.push(`${INDEX_HTML} <title> 必须仍是「${TITLE}」`)
  }
  assert.deepEqual(problems, [], `G5-5 未满足：${problems.join('；')}`)
})
