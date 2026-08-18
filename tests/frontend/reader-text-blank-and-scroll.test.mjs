import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { toReaderPageDto } from '../../src/adapters/student.js'
import { isImportedBlankPage } from '../../src/student/components/book-page-blank.js'

const bookPageUrl = new URL('../../src/student/components/BookPage.jsx', import.meta.url)
const readerUrl = new URL('../../src/student/pages/Reader.jsx', import.meta.url)
const cssUrl = new URL('../../src/index.css', import.meta.url)
const gestureUrl = new URL('../../src/student/hooks/useReaderGesture.js', import.meta.url)

test('空白页判定走 kind / blank / normalizedText / blocks 字段链', () => {
  assert.equal(isImportedBlankPage({ kind: 'blank' }), true)
  assert.equal(isImportedBlankPage({ pageKind: 'blank' }), true)
  assert.equal(isImportedBlankPage({ blank: true, blocks: [{ text: '不该出现' }] }), true)
  assert.equal(isImportedBlankPage({ no: 2, normalizedText: '', blocks: [] }), true)
  assert.equal(isImportedBlankPage({ no: 3, text: '', blocks: [] }), true)
  assert.equal(isImportedBlankPage({ no: 3, blocks: [] }), true)
  assert.equal(isImportedBlankPage({ no: 3, blocks: [{ kind: 'paragraph', text: '   ' }] }), true)

  assert.equal(isImportedBlankPage({ no: 1, normalizedText: '有正文', blocks: [] }), false)
  assert.equal(isImportedBlankPage({ no: 1, blocks: [{ kind: 'paragraph', text: '歌谣' }] }), false)
  assert.equal(isImportedBlankPage({
    no: 1,
    chapter: '正在加载正文',
    blocks: [{ kind: 'paragraph', text: '正在向服务端读取第 1 页。' }],
  }), false)
  assert.equal(isImportedBlankPage({
    no: 1,
    chapter: '这一页暂时无法读取',
    blocks: [{ kind: 'paragraph', text: 'DEPENDENCY_UNAVAILABLE：服务端暂不可用' }],
  }), false)
  assert.equal(isImportedBlankPage({
    no: 1,
    chapter: '这一页暂无正文',
    blocks: [{ kind: 'paragraph', text: '服务端返回了空页，没有使用本地演示正文补齐。' }],
  }), false)
})

test('API 空白页 DTO 保留空的 normalizedText，合成 loading/error 页不会被判成空白', () => {
  const importedBlank = toReaderPageDto({
    pageNo: 2,
    text: '',
    rawText: '',
    blocks: [],
    readRangeVersion: 'read-range-v2:demo',
  })
  assert.equal(importedBlank.no, 2)
  assert.equal(importedBlank.normalizedText, '')
  assert.deepEqual(importedBlank.blocks, [])
  assert.equal(isImportedBlankPage(importedBlank), true)

  const flagged = toReaderPageDto({ pageNo: 3, kind: 'blank', text: '', blocks: [] })
  assert.equal(flagged.blank, true)
  assert.equal(flagged.kind, 'blank')
  assert.equal(isImportedBlankPage(flagged), true)

  const withText = toReaderPageDto({
    pageNo: 1,
    text: '太阳出来了',
    blocks: [{ text: '太阳出来了' }],
  })
  assert.equal(withText.normalizedText, '太阳出来了')
  assert.equal(isImportedBlankPage(withText), false)
})

test('文字模式空白页是独立渲染分支，文案与 loading/error/接口空可区分', async () => {
  const [bookPage, reader] = await Promise.all([
    readFile(bookPageUrl, 'utf8'),
    readFile(readerUrl, 'utf8'),
  ])

  assert.match(bookPage, /isImportedBlankPage/)
  assert.match(bookPage, /data-page-blank=\{blank \? '' : undefined\}/)
  assert.match(bookPage, /className="student-page-blank"/)
  assert.match(bookPage, /本页为空白页/)
  assert.match(bookPage, /导入时这一页没有正文，不是读取失败/)
  assert.doesNotMatch(bookPage, /正在加载正文/)
  assert.doesNotMatch(bookPage, /这一页暂时无法读取/)
  assert.doesNotMatch(bookPage, /服务端返回了空页/)

  assert.match(reader, /heading: '正在加载正文'/)
  assert.match(reader, /heading: '这一页暂时无法读取'/)
  assert.match(reader, /服务端返回了空页，没有使用本地演示正文补齐。/)
  assert.doesNotMatch(reader, /本页为空白页/)
})

test('文字页正文容器可纵向滚动，且不回退 D-19 视口契约', async () => {
  const css = await readFile(cssUrl, 'utf8')
  const bodyBlock = css.match(/\.student-page-body \{[^}]*\}/)
  const blankBlock = css.match(/\.student-page-blank \{[^}]*\}/)
  const zoomBlock = css.match(/\.student-stage-viewport--zoom \{[^}]*\}/)
  const offBlock = css.match(/\.student-reader-bar--off,\n\.student-reader-foot--off \{[^}]*\}/)
  const pdfWrapBlock = css.match(/\.student-pdf-canvas-wrap \{[^}]*\}/)

  assert.ok(bodyBlock, '必须能定位 .student-page-body 规则')
  assert.match(bodyBlock[0], /overflow-y:\s*auto/)
  assert.match(bodyBlock[0], /overflow-x:\s*hidden/)
  assert.doesNotMatch(bodyBlock[0], /overflow:\s*hidden/)

  assert.ok(blankBlock, '空白页占位必须有独立样式')
  assert.doesNotMatch(blankBlock[0], /#9F342C/)
  assert.doesNotMatch(css, /\.student-page-blank[^{]*\{[^}]*#9F342C/)

  assert.ok(zoomBlock, 'D-19 放大档滚动视口必须仍在')
  assert.match(zoomBlock[0], /overflow-y: auto/)
  assert.match(zoomBlock[0], /overflow-x: hidden/)
  assert.match(zoomBlock[0], /align-items: flex-start/)
  assert.doesNotMatch(css, /\.student-stage-viewport \{/)

  assert.ok(offBlock, 'D-19 顶栏底栏脱流不得回退')
  assert.match(offBlock[0], /position: absolute/)

  assert.ok(pdfWrapBlock, '原版 PDF 画布裁切不得被这次改动带走')
  assert.match(pdfWrapBlock[0], /overflow: hidden/)
})

test('翻页手势没有 wheel 监听；翻页只认横向主导位移', async () => {
  const gesture = await readFile(gestureUrl, 'utf8')

  assert.doesNotMatch(gesture, /addEventListener\(\s*['"]wheel['"]/)
  assert.doesNotMatch(gesture, /onWheel/)
  assert.match(gesture, /Math\.abs\(dx\) > MOVE_TOL && Math\.abs\(dx\) > Math\.abs\(dy\)/)
  assert.match(gesture, /if \(dx >= FLIP_TOL\) cb\.current\.onFlipPrev/)
  assert.match(gesture, /else if \(dx <= -FLIP_TOL\) cb\.current\.onFlipNext/)
})
