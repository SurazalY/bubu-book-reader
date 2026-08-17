import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readerUrl = new URL('../../src/student/pages/Reader.jsx', import.meta.url)
const bookPageUrl = new URL('../../src/student/components/BookPage.jsx', import.meta.url)
const pdfPageUrl = new URL('../../src/student/components/PdfBookPage.jsx', import.meta.url)
const pdfDesignUrl = new URL('../../src/student/pdf-page-design.js', import.meta.url)

test('双模式共用物理页，原版 PDF 只渲染近页且禁用文字选择', async () => {
  const reader = await readFile(readerUrl, 'utf8')

  assert.match(reader, /const \[readerMode, setReaderMode\] = useState\(sourcePdf \? 'original' : 'text'\)/)
  assert.match(reader, /selectionEnabled: readerMode === 'text'/)
  assert.match(reader, /active=\{Math\.abs\(p\.no - currentPage\) <= 2\}/)
  assert.match(reader, /\{ key: 'original', label: '原版 PDF' \}/)
  assert.match(reader, /\{ key: 'text', label: 'OCR 文字' \}/)
  assert.doesNotMatch(reader, /setReaderMode\('text'\)[\s\S]{0,120}(PDF_LOAD_FAILED|PDF_PAGE_COUNT_MISMATCH)/)
  assert.doesNotMatch(reader, /confirmInteraction\('selection'/)
})

test('原版模式从受保护资产用 PDF.js 加载，页数不一致显式失败', async () => {
  const pdfPage = await readFile(pdfPageUrl, 'utf8')

  assert.match(pdfPage, /getDocument\(\{/)
  assert.match(pdfPage, /'X-Workspace-Id': workspaceId/)
  assert.match(pdfPage, /withCredentials: true/)
  assert.match(pdfPage, /PDF_PAGE_COUNT_MISMATCH/)
  assert.match(pdfPage, /GlobalWorkerOptions\.workerSrc/)
  assert.match(pdfPage, /from 'pdfjs-dist\/legacy\/build\/pdf\.mjs'/)
  assert.match(pdfPage, /pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs/)
  assert.doesNotMatch(pdfPage, /pdfjs-dist\/build\/pdf(?:\.worker)?(?:\.min)?\.mjs/)
  assert.doesNotMatch(pdfPage, /textLayer|TextLayer/)
})

test('浏览器侧 pdfjs 只允许 legacy 构建，防止现代构建在无 getOrInsertComputed 的浏览器里炸掉', async () => {
  const pdfPage = await readFile(pdfPageUrl, 'utf8')
  const importMatches = [...pdfPage.matchAll(/['"]pdfjs-dist\/[^'"]+['"]/g)].map((match) => match[0])

  assert.ok(importMatches.length >= 2, 'PdfBookPage 必须同时声明模块与 worker')
  for (const specifier of importMatches) {
    assert.match(specifier, /pdfjs-dist\/legacy\/build\//)
    assert.doesNotMatch(specifier, /pdfjs-dist\/build\//)
  }
})

test('useProtectedPdfDocument 抽样多页经 pickPdfPageDesign 定尺，不得只靠 getPage(1)', async () => {
  const [pdfPage, design, reader] = await Promise.all([
    readFile(pdfPageUrl, 'utf8'),
    readFile(pdfDesignUrl, 'utf8'),
    readFile(readerUrl, 'utf8'),
  ])

  assert.match(pdfPage, /from '\.\.\/pdf-page-design\.js'/)
  assert.match(pdfPage, /samplePdfDesignPageNumbers\(document\.numPages\)/)
  assert.match(pdfPage, /pickPdfPageDesign\(sizes\)/)
  assert.doesNotMatch(pdfPage, /const firstPage = await document\.getPage\(1\)/)
  assert.doesNotMatch(pdfPage, /getPage\(1\)[\s\S]{0,240}width:\s*viewport\.width/)
  assert.match(design, /export function pickPdfPageDesign/)
  assert.match(design, /export function samplePdfDesignPageNumbers/)
  assert.match(design, /\[1, 2, middle, numPages\]/)
  assert.match(reader, /readerMode === 'original' && pdf\.width > 0 && pdf\.height > 0/)
  assert.match(reader, /Math\.max\(0\.4, Math\.min\(k, 2\)\)/)
  assert.match(reader, /const PAGE_DESIGN = Object\.freeze\(\{ width: 468, height: 636/)
})

test('PdfBookPage 用 pdfCanvasOutputScale 提高 backing，不再只乘 1×dpr', async () => {
  const [pdfPage, design] = await Promise.all([
    readFile(pdfPageUrl, 'utf8'),
    readFile(pdfDesignUrl, 'utf8'),
  ])

  assert.match(design, /export function pdfCanvasOutputScale/)
  assert.match(pdfPage, /pdfCanvasOutputScale\(/)
  assert.match(pdfPage, /cssScale \* outputScale/)
  assert.doesNotMatch(pdfPage, /Math\.max\(\s*1\s*,\s*window\.devicePixelRatio/)
  assert.doesNotMatch(pdfPage, /transform:\s*ratio\s*===\s*1\s*\?\s*null/)
})

test('D-19：canvas 的 CSS 尺寸必须取整，且高度按本页自身宽高比推，不得用 designHeight', async () => {
  const pdfPage = await readFile(pdfPageUrl, 'utf8')

  // 小数 CSS 尺寸会让 canvas 落在半像素上，合成器要带亚像素相位重采样整张纹理
  assert.match(pdfPage, /const cssWidth = Math\.round\(designWidth \* scale\)/)
  assert.match(pdfPage, /const cssHeight = Math\.round\(base\.height \* cssScale\)/)
  assert.match(pdfPage, /canvas\.style\.width = `\$\{cssWidth\}px`/)
  assert.match(pdfPage, /canvas\.style\.height = `\$\{cssHeight\}px`/)
  // 用 designHeight 推高度会把那 8 本的大封面（宽高比与内页差 1.4%）拉变形
  assert.doesNotMatch(pdfPage, /cssHeight = Math\.round\(designHeight/)
})

test('D-19：原版 PDF 放大档只在原版模式生效，且必须走 applyPdfZoom', async () => {
  const [reader, design] = await Promise.all([
    readFile(readerUrl, 'utf8'),
    readFile(pdfDesignUrl, 'utf8'),
  ])

  assert.match(design, /export const PDF_ZOOM_SCALE/)
  assert.match(design, /export function applyPdfZoom/)
  assert.match(reader, /const pdfZoomed = readerMode === 'original' && !spread/)
  assert.match(reader, /if \(pdfZoomed\) return applyPdfZoom\(fit, widthLimit\)/)
  // 放大不得靠把 clamp 下限托回去、用封面当尺子——那种尺寸用户读不了（D-18）
  assert.match(reader, /Math\.max\(0\.4, Math\.min\(k, 2\)\)/)
  // 文字模式是矢量字，没有清晰度问题，不许把放大档牵进去动折行契约
  assert.doesNotMatch(reader, /readerMode === 'text'[\s\S]{0,80}applyPdfZoom/)
})

test('D-19：顶栏底栏收起时必须真的退出 flex 流，否则舞台不会变高', async () => {
  const css = await readFile(new URL('../../src/index.css', import.meta.url), 'utf8')
  const offBlock = css.match(/\.student-reader-bar--off,\n\.student-reader-foot--off \{[^}]*\}/)

  assert.ok(offBlock, '两条栏的收起态必须合并声明，便于一处保证脱流')
  assert.match(offBlock[0], /position: absolute/)
  assert.match(offBlock[0], /pointer-events: none/)
  // 放大档的滚动视口只允许挂在 --zoom 上：基类若带 overflow，
  // 未放大时会把书页投影裁掉，等于改了默认观感
  const zoomBlock = css.match(/\.student-stage-viewport--zoom \{[^}]*\}/)
  assert.ok(zoomBlock, '放大档必须有独立的滚动视口规则')
  assert.match(zoomBlock[0], /overflow-y: auto/)
  // 翻页动画的 translateX(14px) 会短暂撑出横向溢出，横向必须钉死
  assert.match(zoomBlock[0], /overflow-x: hidden/)
  // 内容高于视口时 align-items:center 会把顶部推到滚不到的负方向
  assert.match(zoomBlock[0], /align-items: flex-start/)
  assert.doesNotMatch(css, /\.student-stage-viewport \{/)
})

test('D-05 / D-11 / D-17 的三处结构不得被后续改动带走', async () => {
  const reader = await readFile(readerUrl, 'utf8')

  // 页码进 ReaderView 的 key 会让翻页自触发重挂、租约冲突、时长与页码归零
  assert.match(reader, /key=\{`\$\{bookId\}:\$\{resolution\.bookVersionId\}`\}/)
  assert.doesNotMatch(reader, /key=\{`\$\{bookId\}:\$\{resolution\.bookVersionId\}:\$\{[^}]*page/i)
  // 返回详情必须在 finally 里导航，提交队列堵塞时返回键才不会变成死键
  assert.match(reader, /try \{\s*await telemetry\.closeAndWait\('reader_close'\)\s*\} finally \{\s*navigate\(/)
})

test('OCR 文字模式只输出可选择 DOM，不再在页图上叠 OCR 层', async () => {
  const bookPage = await readFile(bookPageUrl, 'utf8')

  assert.match(bookPage, /data-block-id=\{blockId\}/)
  assert.doesNotMatch(bookPage, /student-page-image-layer|pageImage|<img/)
})
