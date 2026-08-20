import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  DAILY_ENCOURAGEMENT_COPY,
  buildDailyReadingBriefViewModel,
  formatReadingMonitorTimestamp,
  validateDailyReadingBrief,
} from '../../src/student/components/reading-monitor/dailyReadingBriefModel.js'

function makeDailyBrief(overrides = {}) {
  return {
    generatedAt: '2026-08-10T09:00:00.000Z',
    dataUpdatedAt: '2026-08-10T08:58:10.000Z',
    statDate: '2026-08-10',
    todayEffectiveReadingSeconds: 720,
    checkIn: { checked: true, thresholdSeconds: 300, remainingSeconds: 0 },
    streakDays: 6,
    comparisonState: 'more',
    lastReading: {
      bookId: 'book-1',
      bookVersionId: 'version-1',
      title: '真实书籍',
      lastPageNo: 86,
      totalPages: 300,
      lastReadAt: '2026-08-10T08:58:10.000Z',
    },
    ...overrides,
  }
}

test('学生简报固定使用四种中性鼓励文案', () => {
  assert.deepEqual(DAILY_ENCOURAGEMENT_COPY, {
    more: '今天的阅读积累很不错，继续保持！',
    close: '今天也在稳定积累，保持这个节奏吧。',
    growth_space: '今天已经完成了一些阅读，再读一会儿会更充实。',
    no_baseline: '每一次阅读都在积累，今天也继续吧。',
  })

  for (const state of Object.keys(DAILY_ENCOURAGEMENT_COPY)) {
    const view = buildDailyReadingBriefViewModel(makeDailyBrief({ comparisonState: state }))
    assert.equal(view.valid, true)
    assert.equal(view.encouragement, DAILY_ENCOURAGEMENT_COPY[state])
  }
})

test('五分钟边界信任服务端 checked 与 remaining，299/300 不被页面重算', () => {
  const at299 = buildDailyReadingBriefViewModel(makeDailyBrief({
    todayEffectiveReadingSeconds: 299,
    checkIn: { checked: false, thresholdSeconds: 300, remainingSeconds: 1 },
  }))
  const at300 = buildDailyReadingBriefViewModel(makeDailyBrief({
    todayEffectiveReadingSeconds: 300,
    checkIn: { checked: true, thresholdSeconds: 300, remainingSeconds: 0 },
  }))

  assert.equal(at299.checked, false)
  assert.equal(at299.todayDuration, '4 分 59 秒')
  assert.ok(at299.progressPercent < 100)
  assert.equal(at299.progressAriaValue, 99)
  assert.match(at299.progressLabel, /1 秒/)
  assert.equal(at300.checked, true)
  assert.equal(at300.todayDuration, '5 分钟')
  assert.equal(at300.progressPercent, 100)
  assert.equal(at300.progressAriaValue, 100)
})

test('0 秒、0 streak、null 更新时间与 null 最近阅读都是显式空值', () => {
  const view = buildDailyReadingBriefViewModel(makeDailyBrief({
    dataUpdatedAt: null,
    todayEffectiveReadingSeconds: 0,
    checkIn: { checked: false, thresholdSeconds: 300, remainingSeconds: 300 },
    streakDays: 0,
    comparisonState: 'no_baseline',
    lastReading: null,
  }))

  assert.equal(view.valid, true)
  assert.equal(view.todayDuration, '0 分钟')
  assert.equal(view.streakLabel, '尚未形成连续记录')
  assert.doesNotMatch(view.streakLabel, /连续\s*0\s*天/)
  assert.equal(view.updateLabel, '暂无汇总更新时间')
  assert.equal(view.lastReading, null)
  assert.equal(formatReadingMonitorTimestamp(null), '暂无汇总更新时间')
})

test('缺失 DTO 字段时拒绝补 0', () => {
  const incomplete = makeDailyBrief()
  delete incomplete.todayEffectiveReadingSeconds
  delete incomplete.lastReading
  const invalid = validateDailyReadingBrief(incomplete)
  assert.ok(invalid.includes('todayEffectiveReadingSeconds'))
  assert.ok(invalid.includes('lastReading'))
  assert.equal(buildDailyReadingBriefViewModel(incomplete).valid, false)

  const inconsistent = makeDailyBrief({ checkIn: { checked: true, thresholdSeconds: 300, remainingSeconds: 1 } })
  assert.ok(validateDailyReadingBrief(inconsistent).includes('checkIn.checked.remaining'))

  const outOfRange = makeDailyBrief({
    lastReading: { ...makeDailyBrief().lastReading, lastPageNo: 301, totalPages: 300 },
  })
  assert.ok(validateDailyReadingBrief(outOfRange).includes('lastReading.lastPageNo.range'))
})

test('Home 接入真实 self resource，继续阅读只使用 hook 的精确 URL', async () => {
  const [component, home, reader, hook, app, bottomNav, documentHtml] = await Promise.all([
    readFile(new URL('../../src/student/components/reading-monitor/DailyReadingBrief.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/student/pages/Home.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/student/pages/Reader.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/student/state/useReadingStatistics.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/student/StudentApp.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/student/components/BottomNav.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../index.html', import.meta.url), 'utf8'),
  ])

  assert.match(component, /onContinueReading\?\.\(view\.lastReading\)/)
  assert.match(component, /onOpenShelf\?\.\(\)/)
  assert.match(component, /resource\.status === 'loading'/)
  assert.match(component, /resource\.status === 'forbidden'/)
  assert.match(component, /resource\.status === 'error'/)
  assert.match(component, /aria-valuenow=\{view\.progressAriaValue\}/)
  assert.match(component, /aria-valuetext=\{view\.progressLabel\}/)
  assert.doesNotMatch(component, /Math\.round\(view\.progressPercent\)/)
  assert.match(component, /\['ready', 'stale'\]\.includes\(resource\.status\)/)
  assert.match(component, /当前显示上一次成功读取的简报/)
  assert.doesNotMatch(component, /\/student\/reader\//)
  assert.match(home, /useReadingStatistics\(runtime\.data\?\.workspaceId\)/)
  assert.match(home, /readingStatistics\.dailyReadingBriefResource/)
  assert.match(home, /readingStatistics\.buildContinueReadingUrl\(lastReading\)/)
  assert.match(home, /target === readingStatistics\.continueReadingUrl\) navigate\(target\)/)
  assert.match(home, /<DailyReadingBrief/)
  assert.match(home, /onRetry=\{readingStatistics\.retry\}/)
  assert.match(home, /onOpenShelf=\{handleOpenShelf\}/)
  assert.match(home, /grid-cols-2[^\n]*max-\[479px\]:grid-cols-1/)
  assert.doesNotMatch(home, /startedBookCount|effectiveMinutes|\/student\/home\/ranking|setTimeout/)
  assert.doesNotMatch(home, /briefResource\.data[^\n]*\|\|\s*0/)
  assert.match(reader, /await telemetry\.closeAndWait\('reader_close'\)[\s\S]*navigate\(`/)
  assert.doesNotMatch(reader.match(/await telemetry\.closeAndWait\('reader_close'\)[\s\S]{0,200}/)?.[0] || '', /setTimeout/)
  assert.match(app, /path="home" element=\{<Home \/>\}/)
  assert.match(hook, /useEffect\(\(\) => \{\s*controller\.start\(\)/)
  assert.match(hook, /start\(\) \{[\s\S]*void refresh\(\)/)
  assert.match(bottomNav, /px-3[^\n]*sm:px-8/)
  assert.match(bottomNav, /min-w-0[^\n]*gap-1[^\n]*sm:gap-2\.5/)
  assert.match(bottomNav, /whitespace-nowrap[^\n]*text-\[11px\]/)
  assert.match(documentHtml, /<link rel="icon" type="image\/png" href="\/brand\/peixin-favicon\.png" \/>/)
})
