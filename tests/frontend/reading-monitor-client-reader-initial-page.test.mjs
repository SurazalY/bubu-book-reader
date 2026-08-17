import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  readerPageForResolvedLocation,
  reconcileFlipBootstrap,
} from '../../src/student/reading-monitor/viewModel.js'

test('runtime晚到时显式pageNo=4同步覆盖旧的初始1，后续同URL保留当前主页', () => {
  const resolution = { ok: true, bookVersionId: 'version-1', pageNo: 4 }
  const locationKey = 'book-1:version-1:?versionId=version-1&pageNo=4'

  assert.equal(readerPageForResolvedLocation({
    resolution,
    locationKey,
    savedPosition: { locationKey: null, pageNo: 1 },
  }), 4)
  assert.equal(readerPageForResolvedLocation({
    resolution,
    locationKey,
    savedPosition: { locationKey, pageNo: 3 },
  }), 3)
})

test('三维组件首次错误onFlip=0不能覆盖显式末页leaf=2', () => {
  assert.deepEqual(reconcileFlipBootstrap({
    expectedLeaf: 2,
    reportedLeaf: 0,
    pending: true,
  }), {
    accept: false,
    correctionLeaf: 2,
    pending: true,
  })
  assert.deepEqual(reconcileFlipBootstrap({
    expectedLeaf: 2,
    reportedLeaf: 2,
    pending: true,
  }), {
    accept: true,
    correctionLeaf: null,
    pending: false,
  })
})

test('Reader末页双页初始化不制造幽灵页，且仍不显示完成度语义', async () => {
  const source = await readFile(new URL('../../src/student/pages/Reader.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /pageNo \+ \(spread \? 1 : 0\)/)
  assert.match(source, /startPage=\{leaf\}/)
  assert.match(source, /onInit=/)
  assert.match(source, /reconcileFlipBootstrap/)
  assert.doesNotMatch(source, /BookProgress|\bpercent\s*=|\bfinished\b/)
  assert.match(source, /第 \{readPage\} 页 \/ 共 \{totalPages\} 页/)
})

test('同一本书换页不把pageNo或查询串写进ReaderView的key', async () => {
  const source = await readFile(new URL('../../src/student/pages/Reader.jsx', import.meta.url), 'utf8')
  assert.match(source, /key=\{`\$\{bookId\}:\$\{resolution\.bookVersionId\}`\}/)
  assert.doesNotMatch(source, /key=\{`\$\{bookId\}:\$\{resolution\.bookVersionId\}:\$\{resolution\.pageNo\}/)
  assert.doesNotMatch(source, /key=\{`\$\{bookId\}:\$\{resolution\.bookVersionId\}:\$\{resolution\.pageNo\}:\$\{location\.search\}`\}/)
})
