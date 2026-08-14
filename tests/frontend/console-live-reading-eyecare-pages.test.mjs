import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const eyeCarePage = new URL('../../src/console/pages/classes/EyeCare.jsx', import.meta.url)
const overviewPage = new URL('../../src/console/pages/ClassOverview.jsx', import.meta.url)
const readingStatisticsView = new URL('../../src/console/components/reading-monitor/ReadingStatisticsView.jsx', import.meta.url)
const readingStatisticsModel = new URL('../../src/console/components/reading-monitor/readingStatisticsViewModel.js', import.meta.url)

test('护眼页保留真实接线，班级阅读统计使用独立真实 scope state', async () => {
  const [eyeCare, overview, statisticsView, statisticsModel] = await Promise.all([
    readFile(eyeCarePage, 'utf8'),
    readFile(overviewPage, 'utf8'),
    readFile(readingStatisticsView, 'utf8'),
    readFile(readingStatisticsModel, 'utf8'),
  ])

  for (const source of [eyeCare, overview, statisticsView, statisticsModel]) {
    assert.doesNotMatch(source, /data\/fixtures/i)
  }
  assert.match(eyeCare, /usePrivacyEyeCareData/)
  assert.match(eyeCare, /releaseFalsePositive/)
  assert.match(eyeCare, /status === 'loading'/)
  assert.match(eyeCare, /status === 'error'/)
  assert.match(overview, /<ReadingStatisticsView/)
  assert.match(overview, /useReadingStatistics\(workspace\?\.id\)/)
  assert.match(overview, /resource=\{statistics\.scopeResource\}/)
  assert.match(overview, /onRefresh=\{statistics\.onRefresh\}/)
  assert.doesNotMatch(overview, /resource = null|data\/fixtures/)
  assert.match(statisticsView, /resource\.status === 'loading'/)
  assert.match(statisticsView, /resource\.status === 'forbidden'/)
  assert.match(statisticsView, /resource\.status === 'error'/)
  assert.match(statisticsView, /resource\.status === 'empty'/)
  assert.match(statisticsView, /resource\.status === 'stale'/)
  assert.match(statisticsModel, /checkInRateBasisPoints/)
  assert.match(statisticsModel, /perCapitaEffectiveReadingSeconds/)
  assert.doesNotMatch(statisticsView, /anomalousStays|eyeCareStatuses|studentRanking/)
})
