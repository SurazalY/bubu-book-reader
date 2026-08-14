import assert from 'node:assert/strict'
import test from 'node:test'

import { createClock, nextStatDateBoundary, statDateFor } from '../../src/student/reading-monitor/clock.js'
import { createStableView, resolveReaderLocation } from '../../src/student/reading-monitor/view.js'
import { validateReaderPageResponse } from '../../src/student/state/useStudentReaderPages.js'

test('北京时间04:00精确切换统计日，时钟可注入', () => {
  const before = Date.parse('2026-08-09T19:59:59.999Z')
  const boundary = Date.parse('2026-08-09T20:00:00.000Z')
  assert.equal(statDateFor(before), '2026-08-09')
  assert.equal(statDateFor(boundary), '2026-08-10')
  assert.equal(nextStatDateBoundary(before), boundary)
  assert.equal(nextStatDateBoundary(boundary), Date.parse('2026-08-10T20:00:00.000Z'))

  let wallMs = boundary
  let monotonicMs = 17
  const clock = createClock({ wallNow: () => wallMs, monotonicNow: () => monotonicMs })
  assert.deepEqual(clock.now(), {
    wallMs: boundary,
    monotonicMs: 17,
    iso: '2026-08-09T20:00:00.000Z',
    statDate: '2026-08-10',
  })
  wallMs += 1_000
  monotonicMs += 1_000
  assert.equal(clock.now().monotonicMs, 1_017)
})

test('稳定单双页视图统一使用最小可见页作主页', () => {
  assert.deepEqual(createStableView({ layout: 'single', pageNos: [7] }).mainPageNo, 7)
  const spread = createStableView({ layout: 'double', pageNos: [8, 7] })
  assert.equal(spread.mainPageNo, 7)
  assert.deepEqual(spread.pageNos, [7, 8])
  assert.throws(() => createStableView({ layout: 'double', pageNos: [7, 9] }), /连续页/)
})

const books = [
  { id: 'book-a', versionId: 'version-a', access: { readable: true }, progress: { currentPage: 12, totalPages: 100 } },
  { id: 'book-b', versionId: 'version-b', access: { readable: true }, progress: { currentPage: 3, totalPages: 30 } },
  { id: 'book-c', versionId: 'version-c', access: { readable: false }, progress: { currentPage: 1, totalPages: 10 } },
]

test('继续阅读query严格打开指定版本和页码', () => {
  const result = resolveReaderLocation({ pathBookId: 'book-a', search: '?versionId=version-a&pageNo=86', books })
  assert.equal(result.ok, true)
  assert.equal(result.bookVersionId, 'version-a')
  assert.equal(result.pageNo, 86)
  assert.equal(result.movementSource, 'restore_position')

  const fallback = resolveReaderLocation({ pathBookId: 'book-a', books })
  assert.equal(fallback.ok, true)
  assert.equal(fallback.pageNo, 12)
})

test('错误版本、跨书版本、不可访问与非整数/越界页码都明确失败', () => {
  const cases = [
    ['?versionId=missing&pageNo=1', 'VERSION_NOT_ACCESSIBLE'],
    ['?versionId=version-b&pageNo=1', 'VERSION_BOOK_MISMATCH'],
    ['?versionId=version-a&pageNo=1.0', 'INVALID_PAGE_NO'],
    ['?versionId=version-a&pageNo=01', 'INVALID_PAGE_NO'],
    ['?versionId=version-a&pageNo=-1', 'INVALID_PAGE_NO'],
    ['?versionId=version-a&pageNo=101', 'PAGE_OUT_OF_RANGE'],
    ['?versionId=version-a&pageNo=1&pageNo=2', 'INVALID_READER_QUERY'],
  ]
  cases.forEach(([search, code]) => {
    const result = resolveReaderLocation({ pathBookId: 'book-a', search, books })
    assert.equal(result.ok, false, search)
    assert.equal(result.error.code, code, search)
  })
  assert.equal(resolveReaderLocation({ pathBookId: 'book-c', books }).error.code, 'BOOK_NOT_ACCESSIBLE')
})

test('正文响应不得静默换版本、跨书或换页', () => {
  const expected = { bookId: 'book-a', bookVersionId: 'version-a', pageNo: 8 }
  assert.equal(validateReaderPageResponse({ data: { ...expected, text: '正文' } }, expected).text, '正文')
  assert.throws(() => validateReaderPageResponse({ data: { ...expected, bookVersionId: 'version-b' } }, expected), (error) => error.code === 'VERSION_RESPONSE_MISMATCH')
  assert.throws(() => validateReaderPageResponse({ data: { ...expected, bookId: 'book-b' } }, expected), (error) => error.code === 'BOOK_RESPONSE_MISMATCH')
  assert.throws(() => validateReaderPageResponse({ data: { ...expected, pageNo: 9 } }, expected), (error) => error.code === 'PAGE_RESPONSE_MISMATCH')
})
