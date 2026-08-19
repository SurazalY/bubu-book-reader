/**
 * T4-3a 守卫 G4-12～G4-17：注册页 / 选班页年级二级筛选。
 * 只扫描源码，不写实现。年级一律指接口字段 currentGrade，不是 grade_id。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

const GRADE_LABELS = Object.freeze(['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'])
const GRADE_CONTROL = /选择年级|aria-label=["']选择年级["']|aria-label=["']年级["']|placeholder=["']请选择年级["']/
const SELECTED_GRADE_GATE =
  /\b(selectedGrade|selectedCurrentGrade|gradeFilter|pickedGrade|chosenGrade|selectedGradeNumber|gradeValue)\b|\bgrade\s*(&&|\?|!==|!=)/

const GRADE_SCAN_FILES = Object.freeze([
  'src/student/pages/Register.jsx',
  'src/console/pages/SelectClass.jsx',
  'src/console/state/useReadingStatistics.js',
  'src/console/pages/ClassOverview.jsx',
  'src/console/components/reading-monitor/ReadingStatisticsView.jsx',
])

function readSource(relativePath) {
  return readFileSync(join(projectRoot, relativePath), 'utf8')
}

function extractNamedCallback(source, name) {
  const needle = `${name} = useCallback`
  const start = source.indexOf(needle)
  assert.ok(start >= 0, `${name} 必须仍存在`)
  const open = source.indexOf('{', start)
  assert.ok(open >= 0, `${name} 必须有函数体`)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  assert.fail(`无法截取 ${name} 函数体`)
}

function extractStudentRegisterUi(register) {
  const start = register.indexOf("expectedRole === 'student' ? (")
  assert.ok(start >= 0, 'Register.jsx 必须仍有学生路径 JSX')
  const end = register.indexOf("expectedRole === 'teacher' ? (", start + 1)
  assert.ok(end > start, 'Register.jsx 必须仍有教师路径 JSX')
  return register.slice(start, end)
}

function extractTeacherRegisterUi(register) {
  const start = register.indexOf("expectedRole === 'teacher' ? (")
  assert.ok(start >= 0, 'Register.jsx 必须仍有教师路径 JSX')
  const end = register.indexOf(': null}', start)
  assert.ok(end > start, 'Register.jsx 教师路径必须以 : null 收束')
  return register.slice(start, end)
}

function withDirectRelativeImports(relativePath) {
  const source = readSource(relativePath)
  const dir = dirname(relativePath)
  const extras = []
  const importRe = /from ['"](\.[^'"]+)['"]/g
  let match
  while ((match = importRe.exec(source))) {
    const spec = match[1]
    if (!spec.endsWith('.js') && !spec.endsWith('.jsx')) continue
    extras.push(readFileSync(join(projectRoot, dir, spec), 'utf8'))
  }
  return `${source}\n${extras.join('\n')}`
}

function assertGradeThenClass(branch, { role, classMarker }) {
  assert.match(branch, GRADE_CONTROL, `${role} 必须有年级下拉`)
  assert.match(branch, classMarker, `${role} 必须保留班级选择`)
  const gradeAt = branch.search(GRADE_CONTROL)
  const classAt = branch.search(classMarker)
  assert.ok(gradeAt >= 0 && classAt >= 0 && gradeAt < classAt, `${role} 必须先选年级再出现班级控件`)
  const beforeClass = branch.slice(0, classAt)
  assert.match(
    beforeClass,
    SELECTED_GRADE_GATE,
    `${role} 年级未选时不得渲染班级列表/下拉（必须用已选年级状态做出现条件）`,
  )
  assert.match(branch, /\.currentGrade\b/, `${role} 必须用接口字段 currentGrade 筛选班级，不得绑 grade_id`)
  assert.doesNotMatch(branch, /全部年级/, `${role} 不提供「全部年级」选项`)
}

test('G4-12 学生路径必须先选年级才出现班级下拉，年级未选时不渲染班级', () => {
  const register = readSource('src/student/pages/Register.jsx')
  const student = extractStudentRegisterUi(register)
  assertGradeThenClass(student, { role: '学生注册', classMarker: /选择班级|<select[\s\S]*classId|aria-label=["']选择班级["']/ })
  assert.match(
    student,
    /选择年级[\s\S]{0,500}<select|选择年级[\s\S]{0,500}<Select|<select[\s\S]{0,400}选择年级/,
    '学生路径年级控件必须是下拉',
  )
})

test('G4-12 注册页不提供「全部年级」选项（既有不变式）', () => {
  const register = readSource('src/student/pages/Register.jsx')
  assert.doesNotMatch(register, /全部年级/)
})

test('G4-13 教师路径必须是年级下拉 + 该年级班级多选，年级未选时不显示多选', () => {
  const register = readSource('src/student/pages/Register.jsx')
  const teacher = extractTeacherRegisterUi(register)
  assertGradeThenClass(teacher, { role: '教师注册', classMarker: /type=["']checkbox["']|toggleTeacherClass|teacherClassIds/ })
})

test('G4-14 注册页与选班页年级展示文案必须是「一年级」～「六年级」', () => {
  const registerBundle = withDirectRelativeImports('src/student/pages/Register.jsx')
  const selectBundle = withDirectRelativeImports('src/console/pages/SelectClass.jsx')
  for (const label of GRADE_LABELS) {
    assert.ok(registerBundle.includes(label), `注册页（或其直接依赖）必须能展示「${label}」`)
    assert.ok(selectBundle.includes(label), `选班页（或其直接依赖）必须能展示「${label}」`)
  }
})

test('G4-15 指定前端文件不得自行推算年级（既有不变式）', () => {
  for (const relativePath of GRADE_SCAN_FILES) {
    const source = readSource(relativePath)
    assert.equal(source.includes('academicStartYear'), false, `${relativePath} 不得出现 academicStartYear`)
    assert.equal(source.includes('academicStartYearAt'), false, `${relativePath} 不得出现 academicStartYearAt`)
    assert.equal(source.includes('computeClassLifecycle'), false, `${relativePath} 不得复刻 computeClassLifecycle`)
    assert.equal(/9\s*月\s*1/.test(source), false, `${relativePath} 不得内联 9 月 1 日规则`)
    assert.equal(/September\s*1/i.test(source), false, `${relativePath} 不得内联 September 1 规则`)
    assert.equal(/Asia\/Shanghai/.test(source), false, `${relativePath} 不得复刻上海时区学年切割`)
    assert.equal(/\w+\s*-\s*(parsed)?[Ee]ntryYear\s*\+\s*1/.test(source), false, `${relativePath} 不得用入学年自行推算年级`)
  }
})

test('G4-15 注册页与选班页必须读取 currentGrade 并用于筛选，不得绑 grade_id', () => {
  const register = readSource('src/student/pages/Register.jsx')
  const selectClass = readSource('src/console/pages/SelectClass.jsx')
  const student = extractStudentRegisterUi(register)
  const teacher = extractTeacherRegisterUi(register)

  assert.ok(register.includes('currentGrade'), 'Register.jsx 必须读取 classes[].currentGrade')
  assert.match(student, /currentGrade\s*===|===\s*[^\n]*currentGrade|\.currentGrade\b/, '学生路径必须用 currentGrade 筛选班级')
  assert.match(teacher, /currentGrade\s*===|===\s*[^\n]*currentGrade|\.currentGrade\b/, '教师路径必须用 currentGrade 筛选班级')
  assert.match(selectClass, /\.currentGrade\b/, 'SelectClass.jsx 必须读取 classDto.currentGrade')
  assert.match(
    selectClass,
    /currentGrade\s*===|===\s*[^\n]*currentGrade|\.currentGrade\b/,
    'SelectClass 必须用 currentGrade 做年级筛选',
  )

  assert.doesNotMatch(register, /grade_id\b/)
  assert.doesNotMatch(selectClass, /grade_id\b/)
  assert.doesNotMatch(student, /klass\.gradeId|class\.gradeId/)
  assert.doesNotMatch(teacher, /klass\.gradeId|class\.gradeId/)
  assert.doesNotMatch(selectClass, /klass\.gradeId|class\.gradeId/)
})

test('G4-16 SelectClass 必须有年级筛选控件，先选年级再看该年级班级', () => {
  const selectClass = readSource('src/console/pages/SelectClass.jsx')
  assert.match(selectClass, GRADE_CONTROL, '选班页必须有年级筛选控件')
  assert.match(
    selectClass,
    /选择年级[\s\S]{0,600}<select|选择年级[\s\S]{0,600}<Select|<select[\s\S]{0,500}选择年级|<Select[\s\S]{0,500}选择年级/,
    '选班页年级筛选必须是下拉',
  )
  const listAt = selectClass.search(/<ul[\s\S]{0,80}visible\.map|visible\.map\s*\(/)
  assert.ok(listAt >= 0, '选班页必须仍渲染可加入班级列表')
  const beforeList = selectClass.slice(0, listAt)
  assert.match(beforeList, SELECTED_GRADE_GATE, '选班页必须先选年级才渲染该年级班级列表')
  assert.match(selectClass, /\.currentGrade\b/, '选班筛选必须读取 currentGrade')
  assert.match(
    selectClass,
    /(selectedGrade|selectedCurrentGrade|gradeFilter|pickedGrade|chosenGrade|gradeValue)\s*(&&|\?|!==|!=)/,
    '选班页年级未选时不得渲染班级列表',
  )
})

test('G4-17 选班年级筛选不得收窄教师可加入范围（既有不变式）', () => {
  const selectClass = readSource('src/console/pages/SelectClass.jsx')
  const identityApi = readSource('src/console/pages/accounts/identityApi.js')
  const load = extractNamedCallback(selectClass, 'load')

  assert.match(selectClass, /getTeacherClassDirectory\(/, '目录仍须走 GET /teacher/class-directory')
  assert.match(identityApi, /getTeacherClassDirectory:[\s\S]{0,160}\/teacher\/class-directory/)
  assert.doesNotMatch(load, /currentGrade|scopeLevel|\bgrade\b/, '目录请求不得改成只拉本年级')
  assert.doesNotMatch(selectClass, /getTeacherClassDirectory\([\s\S]{0,120}grade/)
  assert.doesNotMatch(selectClass, /listAuthorizedClasses/, '不得改用 listAuthorizedClasses 当目录')

  assert.match(selectClass, /joinTeacherClass\(\s*klass\.id/)
  assert.match(selectClass, /leaveTeacherClass\(\s*klass\.id/)
  assert.doesNotMatch(selectClass, /joinTeacherClass\([^)]*grade/)
  assert.doesNotMatch(selectClass, /leaveTeacherClass\([^)]*grade/)
  assert.doesNotMatch(selectClass, /只能加入|仅能加入|只(能|许|可)加入本年级/)
  assert.doesNotMatch(selectClass, /全部年级/)

  const joinFn = identityApi.slice(
    identityApi.indexOf('joinTeacherClass:'),
    identityApi.indexOf('leaveTeacherClass:'),
  )
  assert.doesNotMatch(joinFn, /\bgrade\b|\bcurrentGrade\b/, '加入请求不得附加年级限制')
})
