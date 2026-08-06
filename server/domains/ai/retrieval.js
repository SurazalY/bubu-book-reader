const TOKEN_PATTERN = /[\p{Script=Han}]|[\p{L}\p{N}_-]+/gu

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function stableId(value) {
  const normalized = text(value)
  return normalized || null
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(stableId).filter(Boolean))]
}

function tokenSet(value) {
  return new Set((text(value).toLocaleLowerCase('zh-CN').match(TOKEN_PATTERN) || []).filter((token) => token.length > 0))
}

function overlapScore(left, right) {
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) {
    if (right.has(token)) shared += 1
  }
  return shared
}

function normalizeEvidenceBlock(block, bookVersionId, readablePageIds) {
  const id = stableId(block?.id)
  const pageId = stableId(block?.pageId)
  const content = text(block?.content)
  const pageNumber = Number(block?.pageNumber)

  if (!id || !pageId || !content || !Number.isInteger(pageNumber) || pageNumber < 1) return null
  if (block.bookVersionId !== bookVersionId || !readablePageIds.has(pageId)) return null

  return {
    sourceType: 'evidence_block',
    evidenceId: id,
    pageId,
    pageNumber,
    blockId: id,
    content,
    coordinates: block.coordinates || null,
    stableOrder: Number(block.sequence ?? Number.MAX_SAFE_INTEGER),
  }
}

function evidenceScore(source, queryTokens, selectionTokens, currentPageId, selectedBlockIds) {
  const contentTokens = tokenSet(source.content)
  let score = overlapScore(contentTokens, queryTokens) * 4 + overlapScore(contentTokens, selectionTokens) * 6
  if (source.pageId === currentPageId) score += 3
  if (selectedBlockIds.has(source.blockId)) score += 8
  return score
}

function memoryScore(card, queryTokens, currentPageId) {
  const contentTokens = tokenSet(card.content)
  let score = overlapScore(contentTokens, queryTokens) * 3
  if (card.sourcePageIds.includes(currentPageId)) score += 2
  return score
}

function byScore(left, right) {
  if (right.score !== left.score) return right.score - left.score
  if (left.stableOrder !== right.stableOrder) return left.stableOrder - right.stableOrder
  return left.evidenceId.localeCompare(right.evidenceId)
}

export function selectReadableSources({
  evidenceBlocks = [],
  memoryCards = [],
  bookVersionId,
  validReadPageIds = [],
  currentPageId,
  question,
  selectionText = '',
  selectedBlockIds = [],
  limit = 8,
}) {
  const normalizedBookVersionId = stableId(bookVersionId)
  const normalizedCurrentPageId = stableId(currentPageId)
  if (!normalizedBookVersionId || !normalizedCurrentPageId) {
    throw new TypeError('bookVersionId and currentPageId are required')
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError('limit must be a positive integer')
  }

  const readablePageIds = new Set([...uniqueIds(validReadPageIds), normalizedCurrentPageId])
  const queryTokens = tokenSet(question)
  const selectionTokens = tokenSet(selectionText)
  const selectedBlocks = new Set(uniqueIds(selectedBlockIds))
  const readableBlocks = evidenceBlocks
    .map((block) => normalizeEvidenceBlock(block, normalizedBookVersionId, readablePageIds))
    .filter(Boolean)
    .map((block) => ({
      ...block,
      score: evidenceScore(block, queryTokens, selectionTokens, normalizedCurrentPageId, selectedBlocks),
    }))
    .sort(byScore)

  const evidenceLimit = Math.max(1, Math.ceil(limit * 0.75))
  const selectedEvidence = readableBlocks.slice(0, evidenceLimit)
  const readableBlockIds = new Set(readableBlocks.map((source) => source.evidenceId))
  const readableBlockById = new Map(readableBlocks.map((source) => [source.evidenceId, source]))
  const readableCards = memoryCards
    .map((card) => {
      const id = stableId(card?.id)
      const content = text(card?.content)
      const sourceEvidenceIds = uniqueIds(card?.sourceEvidenceIds)
      const sourcePageIds = uniqueIds(card?.sourcePageIds)
      if (!id || !content || card.bookVersionId !== normalizedBookVersionId) return null
      if (sourceEvidenceIds.length === 0 || sourcePageIds.length === 0) return null
      if (!sourceEvidenceIds.every((sourceId) => readableBlockIds.has(sourceId))) return null
      if (!sourcePageIds.every((pageId) => readablePageIds.has(pageId))) return null
      const normalized = {
        sourceType: 'memory_card',
        evidenceId: id,
        memoryCardId: id,
        content,
        sourceEvidenceIds,
        sourcePageIds,
        pageRangeStart: Number.isInteger(Number(card.pageRangeStart)) ? Number(card.pageRangeStart) : null,
        pageRangeEnd: Number.isInteger(Number(card.pageRangeEnd)) ? Number(card.pageRangeEnd) : null,
        stableOrder: Number(card.sequence ?? Number.MAX_SAFE_INTEGER),
      }
      return {
        ...normalized,
        score: memoryScore(normalized, queryTokens, normalizedCurrentPageId),
      }
    })
    .filter(Boolean)
    .sort(byScore)

  const selectedCards = readableCards.slice(0, Math.max(0, limit - selectedEvidence.length))
  const selectedEvidenceIds = new Set(selectedEvidence.map((source) => source.evidenceId))
  const cardSourceEvidence = []
  for (const card of selectedCards) {
    for (const sourceEvidenceId of card.sourceEvidenceIds) {
      if (selectedEvidenceIds.has(sourceEvidenceId)) continue
      const source = readableBlockById.get(sourceEvidenceId)
      if (!source) continue
      selectedEvidenceIds.add(sourceEvidenceId)
      cardSourceEvidence.push(source)
    }
  }

  return [...selectedEvidence, ...cardSourceEvidence, ...selectedCards]
}

export function toModelSources(sources) {
  return sources.map((source) => {
    if (source.sourceType === 'evidence_block') {
      return {
        type: 'evidence_block',
        evidenceId: source.evidenceId,
        pageNumber: source.pageNumber,
        content: source.content,
      }
    }
    return {
      type: 'memory_card',
      memoryCardId: source.memoryCardId,
      sourceEvidenceIds: source.sourceEvidenceIds,
      pageRangeStart: source.pageRangeStart,
      pageRangeEnd: source.pageRangeEnd,
      content: source.content,
    }
  })
}

export function validateCitations({ citations, sources, bookVersionId, validReadPageIds, responseType }) {
  if (!Array.isArray(citations)) {
    return { valid: false, reason: 'citations_not_array', citations: [] }
  }

  const evidenceById = new Map(
    sources
      .filter((source) => source.sourceType === 'evidence_block')
      .map((source) => [source.evidenceId, source]),
  )
  const readablePageIds = new Set(uniqueIds(validReadPageIds))
  const requiresCitation = responseType === 'answer'

  if (requiresCitation && citations.length === 0) {
    return { valid: false, reason: 'citation_required', citations: [] }
  }

  const normalized = []
  for (const citation of citations) {
    const evidenceId = stableId(citation?.evidenceId)
    const source = evidenceById.get(evidenceId)
    if (!source || !readablePageIds.has(source.pageId)) {
      return { valid: false, reason: 'citation_outside_read_scope', citations: [] }
    }
    if (citation?.bookVersionId && citation.bookVersionId !== bookVersionId) {
      return { valid: false, reason: 'citation_book_version_mismatch', citations: [] }
    }
    if (citation?.pageNumber !== undefined && Number(citation.pageNumber) !== source.pageNumber) {
      return { valid: false, reason: 'citation_page_mismatch', citations: [] }
    }
    normalized.push({
      evidenceId: source.evidenceId,
      pageId: source.pageId,
      pageNumber: source.pageNumber,
      coordinates: source.coordinates,
    })
  }

  return { valid: true, reason: null, citations: normalized }
}
