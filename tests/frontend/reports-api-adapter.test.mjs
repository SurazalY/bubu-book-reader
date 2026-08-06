import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createReportsApi } from '../../src/api/reports.js'

const reportPages = [
  'ReportCenter.jsx',
  'ReportDetail.jsx',
  'ParentSend.jsx',
]

async function readSource(relativePath) {
  return readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8')
}

test('报告页面不得从 fixture 或浏览器存储读取业务数据', async () => {
  const sources = await Promise.all(reportPages.map((page) => readSource(`src/console/pages/reports/${page}`)))

  for (let index = 0; index < reportPages.length; index += 1) {
    assert.doesNotMatch(sources[index], /data\/fixtures|localStorage|sessionStorage|indexedDB/, reportPages[index])
  }
  assert.doesNotMatch(sources[0], /snapshotKey:\s*['"]current['"]|请根据当前学生阅读快照生成报告/)
  assert.match(sources[0], /createReport\(\{ studentId \}\)/)
})

test('报告 API 覆盖学生、报告、审核、联系人与发送处理契约', async () => {
  const source = await readSource('src/api/reports.js')

  for (const endpoint of [
    "client.get('/students'",
    "client.get('/reports'",
    "client.post('/reports'",
    "client.post(`/reports/${encodeURIComponent(reportId)}/review`",
    "client.post('/parent-contacts'",
    "client.post(`/reports/${encodeURIComponent(reportId)}/deliveries`",
    "client.post(`/deliveries/${encodeURIComponent(deliveryId)}/process`",
    "client.get(`/deliveries/${encodeURIComponent(deliveryId)}`",
  ]) {
    assert.ok(source.includes(endpoint), endpoint)
  }
})

test('报告 API 把读写请求交给真实端点并保留调用方的写入选项', async () => {
  const calls = []
  const api = createReportsApi({
    get(path, options) {
      calls.push({ method: 'GET', path, options })
      return Promise.resolve({ data: { items: [] }, meta: {} })
    },
    post(path, options) {
      calls.push({ method: 'POST', path, options })
      return Promise.resolve({ data: {}, meta: {} })
    },
  })
  const options = { workspaceId: 'workspace-1', idempotencyKey: 'report-test' }

  await api.listStudents(options)
  await api.listReports(options)
  await api.createReport({ studentId: 'student-1', snapshotKey: 'snapshot-1', content: '正文' }, options)
  await api.reviewReport('report-1', 'version-1', options)
  await api.createParentContact({ studentId: 'student-1', channel: 'summary_link' }, options)
  await api.createDelivery('report-1', { reportVersionId: 'version-1', parentContactId: 'contact-1' }, options)
  await api.processDelivery('delivery-1', options)
  await api.getDelivery('delivery-1', options)

  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ['GET', '/students'],
    ['GET', '/reports'],
    ['POST', '/reports'],
    ['POST', '/reports/report-1/review'],
    ['POST', '/parent-contacts'],
    ['POST', '/reports/report-1/deliveries'],
    ['POST', '/deliveries/delivery-1/process'],
    ['GET', '/deliveries/delivery-1'],
  ])
  assert.deepEqual(calls[3].options.body, { versionId: 'version-1' })
  assert.deepEqual(calls[5].options.body, { reportVersionId: 'version-1', parentContactId: 'contact-1' })
  assert.deepEqual(calls[6].options.body, {})
})

test('报告状态 hook 只从 API 组织加载、生成、审核与发送状态', async () => {
  const source = await readSource('src/console/state/useReportsData.js')

  assert.match(source, /useApiResource/)
  assert.match(source, /createReportsApi/)
  assert.match(source, /createReport/)
  assert.match(source, /reviewReport/)
  assert.match(source, /createParentContact/)
  assert.match(source, /createDelivery/)
  assert.match(source, /processDelivery/)
  assert.doesNotMatch(source, /data\/fixtures|localStorage|sessionStorage|indexedDB/)
})
