// 导入时标记的空白页（无正文 block、normalized 文本为空）。
// 不要把 Reader 合成的 loading / error / 「接口没返回页」当成空白页——
// 那些页都会带一段说明性 block，本谓词看到有正文即否。

function blockHasText(block) {
  if (typeof block === 'string') return block.trim() !== ''
  if (!block || typeof block !== 'object') return false
  const text = block.t || block.text || block.normalizedText || block.content
  return typeof text === 'string' && text.trim() !== ''
}

export function isImportedBlankPage(page) {
  if (!page || typeof page !== 'object') return false
  if (page.kind === 'blank' || page.pageKind === 'blank' || page.blank === true) return true
  const declaredText = [page.normalizedText, page.text, page.rawText]
    .find((value) => typeof value === 'string')
  const hasNormalizedText = typeof declaredText === 'string' && declaredText.trim() !== ''
  const blocks = Array.isArray(page.blocks) ? page.blocks : []
  const hasBlockText = blocks.some(blockHasText)
  return !hasBlockText && !hasNormalizedText
}
