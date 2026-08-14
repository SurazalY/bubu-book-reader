import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildReadingStatisticsViewModel,
  describeTeacherComparison,
  filterAndSortStudents,
  formatBasisPoints,
  validateReadingStatisticsData,
} from '../../src/console/components/reading-monitor/readingStatisticsViewModel.js'

const dates = ['2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10']

function makeStudent(overrides = {}) {
  return {
    studentId: 'student-1',
    displayName: '安安',
    todayEffectiveReadingSeconds: 720,
    checkedIn: true,
    streakDays: 6,
    hadSkip: false,
    hadReread: true,
    lastReadAt: '2026-08-10T08:58:10.000Z',
    lastWeek: {
      totalEffectiveReadingSeconds: 5400,
      dailyAverageEffectiveReadingSeconds: 771,
      todayDeltaSeconds: -51,
      comparisonState: 'close',
    },
    recentDays: dates.map((statDate, index) => ({
      statDate,
      effectiveReadingSeconds: index * 120,
      checkedIn: index >= 3,
    })),
    lastReading: {
      bookId: 'book-1',
      bookVersionId: 'version-1',
      title: '真实书籍',
      lastPageNo: 86,
      totalPages: 300,
    },
    ...overrides,
  }
}

function makeScope(overrides = {}) {
  return {
    generatedAt: '2026-08-10T09:00:00.000Z',
    dataUpdatedAt: '2026-08-10T08:58:10.000Z',
    statDate: '2026-08-10',
    class: { classId: 'class-1', displayName: '五年级一班', activeStudentCount: 50 },
    summary: {
      checkedInStudentCount: 37,
      checkInRateBasisPoints: 7400,
      totalEffectiveReadingSeconds: 54000,
      perCapitaEffectiveReadingSeconds: 1080,
      skipStudentCount: 4,
      rereadStudentCount: 8,
    },
    trend: dates.map((statDate, index) => ({
      statDate,
      checkedInStudentCount: 31 + index,
      activeStudentCount: 50,
      checkInRateBasisPoints: 6200 + index * 200,
      perCapitaEffectiveReadingSeconds: 900 + index * 30,
    })),
    students: [makeStudent()],
    ...overrides,
  }
}

test('教师总览使用服务端口径显示 37/50=74%，不在视图模型重算', () => {
  const view = buildReadingStatisticsViewModel(makeScope())
  assert.equal(view.valid, true)
  assert.equal(view.checkInRateLabel, '74%')
  assert.equal(view.data.summary.checkedInStudentCount, 37)
  assert.equal(view.data.class.activeStudentCount, 50)
  assert.equal(formatBasisPoints(7400), '74%')
})

test('空班级 rate/perCapita 保持 null 空态，七日数组仍然恰好 7 项', () => {
  const empty = makeScope({
    dataUpdatedAt: null,
    class: { classId: 'class-empty', displayName: '空班级', activeStudentCount: 0 },
    summary: {
      checkedInStudentCount: 0,
      checkInRateBasisPoints: null,
      totalEffectiveReadingSeconds: 0,
      perCapitaEffectiveReadingSeconds: null,
      skipStudentCount: 0,
      rereadStudentCount: 0,
    },
    trend: dates.map((statDate) => ({
      statDate,
      checkedInStudentCount: 0,
      activeStudentCount: 0,
      checkInRateBasisPoints: null,
      perCapitaEffectiveReadingSeconds: null,
    })),
    students: [],
  })
  const view = buildReadingStatisticsViewModel(empty)
  assert.equal(view.valid, true)
  assert.equal(view.emptyClass, true)
  assert.equal(view.checkInRateLabel, '—')
  assert.equal(view.perCapitaLabel, '—')
  assert.equal(view.data.trend.length, 7)

  assert.ok(validateReadingStatisticsData({ ...empty, trend: empty.trend.slice(0, 6) }).includes('trend'))
})

test('未打卡筛选包含 0～299 秒，只信任 checkedIn 布尔值', () => {
  const students = [
    makeStudent({ studentId: 's-0', displayName: '零秒', todayEffectiveReadingSeconds: 0, checkedIn: false }),
    makeStudent({ studentId: 's-299', displayName: '二百九十九秒', todayEffectiveReadingSeconds: 299, checkedIn: false }),
    makeStudent({ studentId: 's-300', displayName: '三百秒', todayEffectiveReadingSeconds: 300, checkedIn: true }),
  ]
  assert.deepEqual(
    filterAndSortStudents(students, { filter: 'unchecked' }).map((student) => student.studentId).sort(),
    ['s-0', 's-299'],
  )
  assert.deepEqual(filterAndSortStudents(students, { filter: 'checked' }).map((student) => student.studentId), ['s-300'])
})

test('搜索规范化全角与空白，排序使用规范化姓名 + studentId 稳定打破同名', () => {
  const students = [
    makeStudent({ studentId: 'student-2', displayName: 'Ａ　安' }),
    makeStudent({ studentId: 'student-3', displayName: '安安' }),
    makeStudent({ studentId: 'student-1', displayName: '安安' }),
  ]
  assert.deepEqual(
    filterAndSortStudents(students).map((student) => student.studentId),
    ['student-1', 'student-3', 'student-2'],
  )
  assert.deepEqual(
    filterAndSortStudents(students, { keyword: ' a  安 ' }).map((student) => student.studentId),
    ['student-2'],
  )
})

test('教师对比只展示中性事实，no_baseline 不伪装成持平', () => {
  assert.equal(describeTeacherComparison({ comparisonState: 'no_baseline', todayDeltaSeconds: null }), '暂无可比较的上周基线')
  assert.match(describeTeacherComparison({ comparisonState: 'more', todayDeltaSeconds: 120 }), /多 2 分钟/)
  assert.match(describeTeacherComparison({ comparisonState: 'growth_space', todayDeltaSeconds: -51 }), /少 51 秒/)
})

test('ClassOverview 接入真实 scope state，展示所有状态、双趋势与抽屉焦点边界', async () => {
  const [page, component] = await Promise.all([
    readFile(new URL('../../src/console/pages/ClassOverview.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/console/components/reading-monitor/ReadingStatisticsView.jsx', import.meta.url), 'utf8'),
  ])

  assert.match(page, /const \{ workspace \} = useConsole\(\)/)
  assert.match(page, /useReadingStatistics\(workspace\?\.id\)/)
  assert.match(page, /resource=\{statistics\.scopeResource\}/)
  assert.match(page, /classOptions=\{statistics\.classOptions\}/)
  assert.match(page, /selectedClassId=\{statistics\.selectedClassId\}/)
  assert.match(page, /statDate=\{statistics\.statDate\}/)
  assert.match(page, /onRefresh=\{statistics\.onRefresh\}/)
  assert.match(page, /onRetry=\{statistics\.onRetry\}/)
  assert.match(page, /statistics\.onClassChange\(classId\)/)
  assert.match(page, /statistics\.onStatDateChange\(nextDate\)/)
  assert.match(page, /max-md:fixed[^\n]*max-md:left-\[76px\]/)
  assert.doesNotMatch(page, /resource = null|data\/fixtures/)
  for (const status of ['loading', 'forbidden', 'error', 'empty', 'ready', 'stale']) {
    assert.match(component, new RegExp(`['"]${status}['"]`), `缺少 ${status} 状态`)
  }
  assert.equal((component.match(/<TrendChart/g) || []).length, 2)
  assert.match(component, /<table className="sr-only">/)
  assert.match(component, /role="dialog"/)
  assert.match(component, /import \{ createPortal \} from 'react-dom'/)
  assert.match(component, /return createPortal\(/)
  assert.match(component, /document\.querySelectorAll\('\.console-scroll'\)/)
  assert.match(component, /h-\[100dvh\][^\n]*overflow-y-auto[^\n]*overscroll-contain/)
  assert.match(component, /sticky top-0[^\n]*bg-white\/\[0\.88\][^\n]*backdrop-blur-xl/)
  assert.match(component, /event\.key === 'Escape'/)
  assert.match(component, /document\.body\.style\.overflow = 'hidden'/)
  assert.match(component, /aria-describedby="student-reading-detail-description"/)
  assert.match(component, /returnFocusRef\?\.current\?\.focus\(\)/)
  assert.match(component, /md:hidden/)
  assert.match(component, /hidden overflow-x-auto[^\n]*md:block/)
  assert.match(component, /grid-cols-1[^\n]*sm:grid-cols-2[^\n]*xl:grid-cols-4/)
  assert.match(component, /whitespace-nowrap text-\[12\.5px\]/)
  assert.match(component, /min-h-4 break-keep/)
  assert.match(component, /\['ready', 'stale', 'empty'\]\.includes\(resource\?\.status\)/)
  assert.doesNotMatch(component, /anomalousStays|eyeCareStatuses|studentRanking|pagesRead|readingSpeed/)
})

test('最近阅读页码超出总页数时拒绝展示', () => {
  const invalid = makeScope({
    students: [makeStudent({
      lastReading: { ...makeStudent().lastReading, lastPageNo: 301, totalPages: 300 },
    })],
  })
  assert.ok(validateReadingStatisticsData(invalid).includes('students[0].lastReading.lastPageNo.range'))
})
