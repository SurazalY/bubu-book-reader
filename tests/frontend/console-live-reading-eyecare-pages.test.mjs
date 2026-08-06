import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const eyeCarePage = new URL('../../src/console/pages/classes/EyeCare.jsx', import.meta.url)
const overviewPage = new URL('../../src/console/pages/ClassOverview.jsx', import.meta.url)

test('护眼与班级总览只接入真实护眼和阅读统计数据', async () => {
  const [eyeCare, overview] = await Promise.all([
    readFile(eyeCarePage, 'utf8'),
    readFile(overviewPage, 'utf8'),
  ])

  for (const source of [eyeCare, overview]) {
    assert.doesNotMatch(source, /data\/fixtures/i)
  }
  assert.match(eyeCare, /usePrivacyEyeCareData/)
  assert.match(eyeCare, /releaseFalsePositive/)
  assert.match(eyeCare, /status === 'loading'/)
  assert.match(eyeCare, /status === 'error'/)
  assert.match(overview, /useReadingStatistics/)
  assert.match(overview, /participantCount/)
  assert.match(overview, /effectiveReadingSeconds/)
  assert.match(overview, /byBook/)
  assert.match(overview, /anomalousStays/)
  assert.match(overview, /eyeCareStatuses/)
  assert.doesNotMatch(overview, /studentRanking/)
})
