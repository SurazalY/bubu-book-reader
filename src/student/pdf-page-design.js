/**
 * 原版 PDF 演示选尺与 canvas 输出倍率：只根据已有页的 scale=1 viewport 选一把共用尺子。
 * 不依赖 React / pdf.js / window，也不重渲染 PDF。
 */

function requirePositiveSize(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`PDF 设计尺寸抽样含非法${label}`)
  }
  return value
}

/**
 * 对宽、高分别取中位数。
 * 偶数个样本取下中位数（排序后中间两个里偏小的那个），不取平均：
 * 封面/封底 MediaBox 常比正文大一个数量级，平均会把尺子拉向封面；
 * 「1 个超大 + 3 个正文」时中间两个都是正文，下中位数落在正文，不会落到封面。
 */
function medianTowardBody(values) {
  const sorted = values.slice().sort((left, right) => left - right)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

export function samplePdfDesignPageNumbers(numPages) {
  if (!Number.isInteger(numPages) || numPages < 1) {
    throw new Error('PDF 页数无效，无法抽样设计尺寸')
  }
  const middle = Math.floor((numPages + 1) / 2)
  const unique = new Set()
  for (const pageNo of [1, 2, middle, numPages]) {
    if (pageNo >= 1 && pageNo <= numPages) unique.add(pageNo)
  }
  return [...unique]
}

export function pickPdfPageDesign(sizes) {
  if (!Array.isArray(sizes) || sizes.length === 0) {
    throw new Error('PDF 设计尺寸抽样为空，拒绝回退到封面页框')
  }
  const widths = []
  const heights = []
  for (const size of sizes) {
    widths.push(requirePositiveSize(size?.width, '宽'))
    heights.push(requirePositiveSize(size?.height, '高'))
  }
  return {
    width: medianTowardBody(widths),
    height: medianTowardBody(heights),
  }
}

/**
 * 扫描页在 CSS 约 500–700px 时，1×dpr backing 会把约 1141px 的内页图画稀。
 * 非法 / 缺失 / 非正有限 dpr 当作 1；倍率至少为 2，且至少是 dpr 的 2 倍。
 */
export function pdfCanvasOutputScale(devicePixelRatio) {
  const dpr = typeof devicePixelRatio === 'number' && Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1
  return Math.max(1, dpr) * 2
}

/**
 * 原版 PDF 的「放大」档倍率。
 *
 * D-19 实测依据（不是拍的数）：这批扫描件正文汉字字身只有 8.7–9.9 pt，而
 *   汉字设备像素高 = 字身pt × scale × dpr = 字身pt × 舞台物理像素高 ÷ 页高pt
 * dpr 在这条恒等式里被约掉，所以 canvas backing 倍率、dpr、对开还是单页、
 * 浏览器缩放全都改不动它。1080p 屏按窗口高度铺满时 scale ≈ 1.26，汉字只有约
 * 11 设备像素，低于汉字可读的 12–14 下沿，于是无论怎么渲染都发糊。
 *
 * 1.6 把汉字推到约 14 设备像素（8.7 × 1.6 = 13.9），刚好到下沿；同时
 * 472pt × 1.6 = 755pt 仍在扫描图 1141px 的解析度余量之内，是真放大而非插值。
 * 再大只是让一页要滚更多屏。
 */
export const PDF_ZOOM_SCALE = 1.6

/**
 * 放大档的最终倍率：至少不小于铺满窗口的倍率（放大不该反而变小），
 * 至多不超过舞台宽度允许的倍率（否则横向也要滚，那就没法读了）。
 */
export function applyPdfZoom(fitScale, widthLimitScale) {
  for (const [value, label] of [[fitScale, '铺满倍率'], [widthLimitScale, '宽度上限倍率']]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`PDF 放大倍率输入含非法${label}`)
    }
  }
  return Math.min(Math.max(fitScale, PDF_ZOOM_SCALE), widthLimitScale)
}
