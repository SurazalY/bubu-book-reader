import assert from 'node:assert/strict'
import test from 'node:test'

import { renderPublicSummaryPage, sanitizePublicSummary } from '../../../server/http/public-summary-page.js'

test('公开报告页不渲染页数、开始书目、进度或完成度，仅展示合法指标', () => {
  const html = renderPublicSummaryPage({
    student: { displayName: '测试学生' },
    report: {
      aiNotice: '',
      content: {
        effectiveMinutes: 12,
        startedBookCount: 2,
        startedBooks: 3,
        booksStarted: 4,
        finishedBookCount: 5,
        pagesRead: 999,
        reading_progress: '100%',
        percent: 100,
        percentage: 100,
        '阅读完成比例': '100%',
        finished: true,
        完成度: '全部完成',
        legacyReading: {
          percent: 100,
          progressPercent: 100,
          note: '可保留的普通文字',
        },
        eyeCare: { restCompliancePercentage: 75 },
      },
    },
  })

  assert.match(html, /有效阅读时长/)
  assert.match(html, /12 分钟/)
  const metrics = html.match(/<section class="grid">([\s\S]*?)<\/section>/)?.[1] || ''
  assert.doesNotMatch(metrics, /开始阅读书目|startedBookCount|startedBooks|booksStarted|finishedBookCount|阅读页数|阅读完成比例|pagesRead|reading_progress|progressPercent|percent|percentage|finished|完成度|999|100%/)
  assert.match(metrics, /可保留的普通文字/)
  assert.match(metrics, /restCompliancePercentage/)
})

test('公开报告 JSON 投影同样删除开始书目、旧页数和完成度字段', () => {
  const sanitized = sanitizePublicSummary({
    student: { displayName: '测试学生' },
    report: {
      content: {
        effectiveMinutes: 12,
        startedBookCount: 2,
        startedBooks: 3,
        booksStarted: 4,
        finishedBookCount: 5,
        pagesRead: 999,
        progressPercent: 100,
        percent: 100,
        percentage: 100,
        '阅读完成比例': '100%',
        finished: true,
        legacyReading: {
          percent: 100,
          progressPercent: 100,
          note: '可保留的普通文字',
        },
        eyeCare: { restCompliancePercentage: 75 },
        classSummary: { attendancePercentage: 98 },
      },
    },
  })
  assert.deepEqual(sanitized.report.content, {
    effectiveMinutes: 12,
    legacyReading: { note: '可保留的普通文字' },
    eyeCare: { restCompliancePercentage: 75 },
    classSummary: { attendancePercentage: 98 },
  })
})

test('公开报告顶层数组不能绕过 JSON 与 HTML 递归净化', () => {
  const input = {
    student: { displayName: '测试学生' },
    report: {
      aiNotice: '',
      content: [{
        percent: 64,
        percentage: 63,
        '阅读完成比例': '62%',
        note: '顶层数组历史普通文字',
        eyeCare: { restCompliancePercentage: 61 },
      }, {
        nested: [{ progressPercent: 60, label: '嵌套普通文字' }],
        classSummary: { attendancePercentage: 98 },
      }],
    },
  }
  const expected = [{
    note: '顶层数组历史普通文字',
    eyeCare: { restCompliancePercentage: 61 },
  }, {
    nested: [{ label: '嵌套普通文字' }],
    classSummary: { attendancePercentage: 98 },
  }]

  assert.deepEqual(sanitizePublicSummary(input).report.content, expected)
  const html = renderPublicSummaryPage(input)
  const metrics = html.match(/<section class="grid">([\s\S]*?)<\/section>/)?.[1] || ''
  assert.doesNotMatch(metrics, /percent|percentage|阅读完成比例|progressPercent|64|63|62%|60/)
  assert.match(metrics, /顶层数组历史普通文字/)
  assert.match(metrics, /嵌套普通文字/)
  assert.match(metrics, /restCompliancePercentage/)
  assert.match(metrics, /attendancePercentage/)
})
