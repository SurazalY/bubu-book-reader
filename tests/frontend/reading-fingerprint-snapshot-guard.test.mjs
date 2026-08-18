/**
 * T5.1 独立守卫：冻住前端阅读摘要指纹字段。
 * 只读 src/student/reading-monitor/summary.js，不改实现。
 *
 * 主控口误写成「16 个」；列出的名字与当前源码都是这 15 个、这个顺序。
 * 缺字段 / 改名 / 改序 → 红。往指纹里加 readerMode 也会红。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const FROZEN_FINGERPRINT_FIELDS = Object.freeze([
  'schemaVersion',
  'sessionId',
  'revision',
  'leaseId',
  'bookVersionId',
  'statDate',
  'startedAt',
  'measuredThroughAt',
  'cumulativeEffectiveMs',
  'hadSkip',
  'hadReread',
  'lastPageNo',
  'pageCoverage',
  'endedAt',
  'endReason',
])

function extractFrozenStringArray(source, constName) {
  const matched = source.match(new RegExp(`const ${constName} = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`))
  assert.ok(matched, `找不到 ${constName} = Object.freeze([...])`)
  return [...matched[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
}

test('FINGERPRINT_FIELDS 仍是冻结的 15 个字段且顺序不变', async () => {
  const source = await readFile(new URL('../../src/student/reading-monitor/summary.js', import.meta.url), 'utf8')
  assert.deepEqual(extractFrozenStringArray(source, 'FINGERPRINT_FIELDS'), [...FROZEN_FINGERPRINT_FIELDS])
  assert.doesNotMatch(source, /readerMode|reader_mode/)
})
