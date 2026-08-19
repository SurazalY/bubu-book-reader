/**
 * T4-3a 守卫 G4-18～G4-21：校长阅读统计范围切换器。
 * 只扫描源码，不写实现。classOptions 必须恰好 { classId, displayName }，年级另出 gradeOptions。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

function readSource(relativePath) {
  return readFileSync(join(projectRoot, relativePath), 'utf8')
}

function extractBalanced(source, openIndex, openChar, closeChar) {
  assert.ok(openIndex >= 0 && source[openIndex] === openChar, '截取起点必须是开括号')
  let depth = 0
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === openChar) depth += 1
    else if (source[i] === closeChar) {
      depth -= 1
      if (depth === 0) return source.slice(openIndex, i + 1)
    }
  }
  assert.fail('无法匹配括号')
}

function extractFunction(source, name) {
  const needles = [`export default function ${name}`, `export function ${name}`, `function ${name}`]
  let start = -1
  let used = ''
  for (const needle of needles) {
    start = source.indexOf(needle)
    if (start >= 0) {
      used = needle
      break
    }
  }
  assert.ok(start >= 0, `找不到 ${name}`)
  const paren = source.indexOf('(', start + used.length)
  assert.ok(paren >= 0, `${name} 必须有参数列表`)
  const params = extractBalanced(source, paren, '(', ')')
  const afterParams = paren + params.length
  let i = afterParams
  while (i < source.length && /\s/.test(source[i])) i += 1
  assert.equal(source[i], '{', `${name} 必须有函数体`)
  return extractBalanced(source, i, '{', '}')
}

function extractBindingObject(source, name) {
  const start = ['const ', 'let '].reduce((found, prefix) => {
    if (found >= 0) return found
    return source.indexOf(`${prefix}${name} =`)
  }, -1)
  assert.ok(start >= 0, `找不到 ${name} 绑定`)
  const open = source.indexOf('{', start)
  assert.ok(open >= 0, `${name} 必须是对象绑定`)
  return extractBalanced(source, open, '{', '}')
}

function extractConstFunction(source, name) {
  const needle = `const ${name} =`
  const start = source.indexOf(needle)
  assert.ok(start >= 0, `找不到 const ${name}`)
  const arrow = source.indexOf('=>', start)
  assert.ok(arrow >= 0, `${name} 必须是箭头函数`)
  let i = arrow + 2
  while (i < source.length && /\s/.test(source[i])) i += 1
  assert.equal(source[i], '{', `${name} 必须有函数体`)
  return extractBalanced(source, i, '{', '}')
}

function extractToolbarCall(overview) {
  const start = overview.indexOf('<ReadingStatisticsToolbar')
  assert.ok(start >= 0, 'ClassOverview 必须仍把 ReadingStatisticsToolbar 传给页面')
  const end = overview.indexOf('/>', start)
  assert.ok(end > start, '找不到 ReadingStatisticsToolbar 的闭合')
  return overview.slice(start, end + 2)
}

function extractToolbarJsx(view) {
  const fn = extractFunction(view, 'ReadingStatisticsToolbar')
  const ret = fn.indexOf('return (')
  assert.ok(ret >= 0, 'ReadingStatisticsToolbar 必须有 return (')
  return extractBalanced(fn, fn.indexOf('(', ret), '(', ')')
}

test('G4-18 ClassOverview 仅 school 工作空间启用三档切换器并传给 toolbar', () => {
  const overview = readSource('src/console/pages/ClassOverview.jsx')
  assert.match(overview, /const \{ workspace \} = useConsole\(\)/)
  assert.match(overview, /workspace\.scopeType/, '必须读取 workspace.scopeType')
  assert.match(
    overview,
    /scopeType\s*===\s*['"]school['"]/,
    '切换器启用条件必须是 scopeType === \'school\'，不能用 !== class 把年级主任也包括进去',
  )

  const toolbarCall = extractToolbarCall(overview)
  assert.match(
    toolbarCall,
    /showScopeSwitcher=|enableScopeSwitcher=|scopeSwitcherEnabled=|scopeType=\{/,
    '必须把「仅 school 启用」传给 toolbar，而不是在页面里无条件渲染切换器',
  )
  assert.match(toolbarCall, /scopeLevel=/, '必须把 scopeLevel 传给 toolbar')
  assert.match(toolbarCall, /selectedGrade=/, '必须把 selectedGrade 传给 toolbar')
  assert.match(toolbarCall, /gradeOptions=/, '必须把 gradeOptions 传给 toolbar')
})

test('G4-19 ReadingStatisticsView toolbar 必须在班级下拉之前插入档位切换与年级下拉', () => {
  const view = readSource('src/console/components/reading-monitor/ReadingStatisticsView.jsx')
  const toolbarFn = extractFunction(view, 'ReadingStatisticsToolbar')
  const jsx = extractToolbarJsx(view)

  assert.match(toolbarFn, /scopeLevel/, 'toolbar 必须接收档位')
  assert.match(toolbarFn, /selectedGrade|gradeOptions/, 'toolbar 必须接收年级下拉数据')
  assert.match(jsx, /全校/, '档位切换必须含「全校」')
  assert.match(jsx, /年级/, '档位切换必须含「年级」')
  assert.match(jsx, /班级/, '档位切换必须含「班级」')

  const classSelectAt = jsx.search(/value=\{selectedClassId\}|<Select[\s\S]{0,180}selectedClassId/)
  assert.ok(classSelectAt >= 0, 'toolbar 必须仍保留班级下拉')
  const beforeClass = jsx.slice(0, classSelectAt)
  assert.match(beforeClass, /全校/, '档位切换必须插在班级下拉之前')
  assert.match(
    beforeClass,
    /gradeOptions|selectedGrade|选择年级/,
    '年级下拉必须插在班级下拉之前',
  )
})

test('G4-20 useReadingStatistics 必须有 scopeLevel / selectedGrade，refresh 按档组装 query', () => {
  const stats = readSource('src/console/state/useReadingStatistics.js')
  const hook = extractFunction(stats, 'useReadingStatistics')
  const stateInit = extractBindingObject(stats, 'state')
  const refresh = extractConstFunction(stats, 'refresh')
  const getSummaryFactory = extractFunction(stats, 'createConsoleReadingStatisticsApi')
  const api = readSource('src/api/console.js')

  assert.match(stateInit, /scopeLevel/, 'controller state 必须有 scopeLevel')
  assert.match(stateInit, /selectedGrade/, 'controller state 必须有 selectedGrade')
  assert.match(stateInit, /gradeOptions/, '年级信息必须另出 gradeOptions，不得塞进 classOptions')
  assert.match(hook, /scopeLevel:\s*snapshot\.scopeLevel|scopeLevel,/, 'hook 必须暴露 scopeLevel')
  assert.match(hook, /selectedGrade:\s*snapshot\.selectedGrade|selectedGrade,/, 'hook 必须暴露 selectedGrade')
  assert.match(hook, /gradeOptions:\s*snapshot\.gradeOptions|gradeOptions,/, 'hook 必须暴露 gradeOptions')

  assert.match(refresh, /scopeLevel/, 'refresh 必须按档位组装 query')
  assert.match(
    refresh,
    /scopeLevel:\s*['"]grade['"]|scopeLevel\s*===\s*['"]grade['"]/,
    'grade 档必须带 scopeLevel=grade',
  )
  assert.match(
    refresh,
    /grade:\s*state\.selectedGrade|grade:\s*selectedGrade|query\.grade/,
    'grade 档必须带 grade',
  )
  assert.match(
    refresh,
    /scopeLevel:\s*['"]school['"]|scopeLevel\s*===\s*['"]school['"]/,
    'school 档必须带 scopeLevel=school',
  )
  assert.match(refresh, /`grade:\$\{|['"]grade:['"]/, '多班档一致性检查必须按合成值 grade:N 比较')
  assert.match(refresh, /['"]school['"]/, '全校档一致性检查必须按合成值 school 比较')

  assert.match(getSummaryFactory, /scopeLevel/, 'getSummary 必须把档位传给阅读统计接口')
  assert.match(getSummaryFactory, /\bgrade\b/, 'getSummary 必须能传 grade')
  assert.match(
    api,
    /scopeLevel:\s*input\.scopeLevel|input\.scopeLevel/,
    'src/api/console.js 必须把 scopeLevel 转发进 query，不能只在 state 里组装后被接口层丢掉',
  )
})

test('G4-20 classOptions 必须恰好两字段，档位记忆用独立 localStorage key', () => {
  const stats = readSource('src/console/state/useReadingStatistics.js')
  const loadClasses = extractConstFunction(stats, 'loadClasses')

  assert.match(stats, /gradeOptions/, '年级信息必须另出 gradeOptions')
  assert.match(stats, /\.currentGrade\b|currentGrade/, 'gradeOptions 必须取接口 currentGrade，不得自行推算')
  assert.ok(
    [...stats.matchAll(/['"]readmate:console:[^'"]+['"]/g)].some((item) => !item[0].includes('last_class')),
    '档位记忆必须使用独立 localStorage key，不得与 last_class 混用',
  )
  assert.doesNotMatch(
    stats,
    /CLASS_STORAGE_KEY_PREFIX[\s\S]{0,120}scopeLevel|scopeLevel[\s\S]{0,120}CLASS_STORAGE_KEY_PREFIX/,
    'scopeLevel 不得写入 last_class key',
  )
  assert.match(loadClasses, /gradeOptions/, 'loadClasses 必须产出 gradeOptions')
})

test('G4-20 class 档 query 仍发 classId/statDate（既有不变式）', () => {
  const stats = readSource('src/console/state/useReadingStatistics.js')
  const api = readSource('src/api/console.js')
  assert.match(
    stats,
    /classId,\s*statDate|statDate,\s*classId/,
    'class 档仍须组装 classId 与 statDate',
  )
  assert.match(api, /getReadingStatisticsScope/)
  assert.match(api, /classId:\s*input\.classId/)
  assert.match(api, /statDate:\s*input\.statDate/)
  assert.match(
    stats,
    /CLASS_FIELDS = Object\.freeze\(\['classId', 'displayName', 'activeStudentCount'\]\)/,
    '响应 class 对象必须仍恰好三字段，不得加第四字段',
  )
  assert.ok(
    stats.includes('readmate:console:last_class:'),
    '不得删除现有 readmate:console:last_class: key',
  )
  const buildFn = extractFunction(stats, 'buildReadingClassOptions')
  assert.doesNotMatch(
    buildFn,
    /classId,\s*displayName,\s*currentGrade|currentGrade,\s*classId/,
    '不得把 currentGrade 做成 classOptions 的第四个字段',
  )
})

test('G4-21 教师工作空间不得渲染范围切换器；启用条件必须绑 scopeType === school，不能只靠 CSS 隐藏', () => {
  const overview = readSource('src/console/pages/ClassOverview.jsx')
  const view = readSource('src/console/components/reading-monitor/ReadingStatisticsView.jsx')
  const combined = `${overview}\n${view}`
  const hasSwitcher = combined.includes('全校') && /scopeLevel/.test(combined)

  if (!hasSwitcher) {
    assert.equal(combined.includes('全校'), false, '教师端当前看不到切换器（实现前既有不变式）')
    return
  }

  assert.match(
    overview,
    /scopeType\s*===\s*['"]school['"]/,
    '切换器启用条件必须绑定 scopeType === \'school\'',
  )
  const toolbarCall = extractToolbarCall(overview)
  assert.match(
    toolbarCall,
    /showScopeSwitcher=|enableScopeSwitcher=|scopeSwitcherEnabled=|scopeType=\{/,
    '必须把 school 判定结果传给 toolbar，教师（class）工作空间不得渲染切换器',
  )
  const jsx = extractToolbarJsx(view)
  assert.match(
    jsx,
    /(showScopeSwitcher|enableScopeSwitcher|scopeSwitcherEnabled)\s*&&|scopeType\s*===\s*['"]school['"]/,
    'toolbar 必须按布尔条件渲染切换器，不能无条件输出后再用 CSS 藏',
  )
  const switcherChunk = jsx.slice(0, jsx.search(/value=\{selectedClassId\}/) >= 0
    ? jsx.search(/value=\{selectedClassId\}/)
    : jsx.length)
  assert.doesNotMatch(
    switcherChunk,
    /className=\{?["'`][^"'`]*(?:\bhidden\b|sr-only|invisible)/,
    '不得只靠 hidden / sr-only / invisible 对教师隐藏切换器',
  )
})
