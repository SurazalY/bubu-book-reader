import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PDF_ZOOM_SCALE,
  applyPdfZoom,
  pdfCanvasOutputScale,
  pickPdfPageDesign,
  samplePdfDesignPageNumbers,
} from '../../src/student/pdf-page-design.js'

test('四页仅第 1 页超大时设计尺寸等于正文中位数，不等于封面', () => {
  const design = pickPdfPageDesign([
    { width: 1947, height: 2733 },
    { width: 472, height: 672 },
    { width: 470, height: 670 },
    { width: 468, height: 668 },
  ])

  assert.deepEqual(design, { width: 470, height: 670 })
  assert.notEqual(design.width, 1947)
  assert.notEqual(design.height, 2733)
  assert.ok(design.width < 500)
  assert.ok(design.height < 800)
})

test('四页宽度接近 460–480 时设计尺寸仍是正文量级', () => {
  const design = pickPdfPageDesign([
    { width: 460, height: 660 },
    { width: 468, height: 668 },
    { width: 472, height: 672 },
    { width: 480, height: 680 },
  ])

  assert.deepEqual(design, { width: 468, height: 668 })
  assert.ok(design.width >= 460 && design.width <= 480)
  assert.ok(design.width < 1900)
  assert.ok(design.height < 800)
})

test('单页书直接使用该页尺寸', () => {
  assert.deepEqual(pickPdfPageDesign([{ width: 472, height: 672 }]), { width: 472, height: 672 })
})

test('空数组与非法输入拒绝回退到封面', () => {
  assert.throws(() => pickPdfPageDesign([]), /空|拒绝|封面/)
  assert.throws(() => pickPdfPageDesign(null), /空|拒绝|封面/)
  assert.throws(() => pickPdfPageDesign([{ width: 0, height: 672 }]), /非法/)
  assert.throws(() => pickPdfPageDesign([{ width: 472, height: Number.NaN }]), /非法/)
})

test('抽样页号为第 1、2、中间、末页且去重', () => {
  assert.deepEqual(samplePdfDesignPageNumbers(1), [1])
  assert.deepEqual(samplePdfDesignPageNumbers(2), [1, 2])
  assert.deepEqual(samplePdfDesignPageNumbers(3), [1, 2, 3])
  assert.deepEqual(samplePdfDesignPageNumbers(4), [1, 2, 4])
  assert.deepEqual(samplePdfDesignPageNumbers(98), [1, 2, 49, 98])
})

test('PDF_ZOOM_SCALE 落在「汉字够 12–14 设备像素」且不超出扫描件解析度的区间', () => {
  // 依据（D-19 实测）：这批扫描件正文字身 8.7–9.9pt，内页扫描图宽约 1141px、页宽约 472pt。
  const bodyGlyphPt = 8.69
  const scanPixelWidth = 1141
  const pagePointWidth = 472.14

  assert.ok(bodyGlyphPt * PDF_ZOOM_SCALE >= 12, '放大后汉字必须至少 12 设备像素，否则还是糊')
  assert.ok(pagePointWidth * PDF_ZOOM_SCALE <= scanPixelWidth, '放大倍率不得超过扫描件本身的像素，超了就只是插值')
})

test('applyPdfZoom 放大不小于铺满、不超出舞台宽度', () => {
  // 1080p 全屏实测：铺满倍率 1.263，舞台宽度允许到 3.99 倍 → 取 PDF_ZOOM_SCALE
  assert.equal(applyPdfZoom(1.263, 3.99), PDF_ZOOM_SCALE)
  // 窗口很窄时宽度先到顶，此时只能放到宽度允许的倍率，且仍不小于铺满
  assert.equal(applyPdfZoom(1.1, 1.35), 1.35)
  // 铺满本身已经比放大档更大（竖屏／超高窗口）时不得反而缩小
  assert.equal(applyPdfZoom(1.9, 3.2), 1.9)
  assert.ok(applyPdfZoom(1.9, 3.2) >= 1.9)
})

test('applyPdfZoom 拒绝非法倍率而不是静默返回 NaN', () => {
  assert.throws(() => applyPdfZoom(Number.NaN, 2), /非法/)
  assert.throws(() => applyPdfZoom(1.2, 0), /非法/)
  assert.throws(() => applyPdfZoom(null, 2), /非法/)
  assert.throws(() => applyPdfZoom(1.2, undefined), /非法/)
})

test('pdfCanvasOutputScale 至少为 2 且至少是 dpr 的两倍', () => {
  assert.equal(pdfCanvasOutputScale(1), 2)
  assert.equal(pdfCanvasOutputScale(1.5), 3)
  assert.equal(pdfCanvasOutputScale(2), 4)
  assert.equal(pdfCanvasOutputScale(3), 6)
  assert.equal(pdfCanvasOutputScale(undefined), 2)
  assert.equal(pdfCanvasOutputScale(null), 2)
  assert.equal(pdfCanvasOutputScale(0), 2)
  assert.equal(pdfCanvasOutputScale(-1), 2)
  assert.equal(pdfCanvasOutputScale(Number.NaN), 2)
  assert.equal(pdfCanvasOutputScale(0.5), 2)
})
