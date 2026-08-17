import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readerUrl = new URL('../../src/student/pages/Reader.jsx', import.meta.url)
const bookPageUrl = new URL('../../src/student/components/BookPage.jsx', import.meta.url)
const pdfPageUrl = new URL('../../src/student/components/PdfBookPage.jsx', import.meta.url)

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
  assert.doesNotMatch(pdfPage, /textLayer|TextLayer/)
})

test('OCR 文字模式只输出可选择 DOM，不再在页图上叠 OCR 层', async () => {
  const bookPage = await readFile(bookPageUrl, 'utf8')

  assert.match(bookPage, /data-block-id=\{blockId\}/)
  assert.doesNotMatch(bookPage, /student-page-image-layer|pageImage|<img/)
})
