const GRADE_VALUES = [1, 2, 3, 4, 5, 6]

export const LIBRARY_GRADE_FILTERS = [
  { key: 'all', label: '全部年级' },
  ...GRADE_VALUES.map((grade) => ({ key: String(grade), label: `${grade} 年级` })),
  { key: 'unspecified', label: '未标注年级' },
]

export const LIBRARY_STATUS_FILTERS = [
  { key: 'all', label: '全部状态' },
  { key: 'published', label: '已发布' },
  { key: 'draft', label: '草稿' },
]

export const DRAFT_BOOK_READER_HINT = '这本书当前是草稿，重新发布后才能在阅读器里打开。'

export function bookGradeValue(book) {
  const value = Number(book?.grade)
  return Number.isInteger(value) && value >= 1 && value <= 6 ? value : null
}

export function bookPublishStatus(book) {
  return book?.status === 'draft' ? 'draft' : 'published'
}

export function filterLibraryBooks(books, { grade = 'all', status = 'all', query = '' } = {}) {
  const source = Array.isArray(books) ? books : []
  const key = String(query || '').trim().toLocaleLowerCase()
  return source.filter((book) => {
    if (status === 'published' && bookPublishStatus(book) !== 'published') return false
    if (status === 'draft' && bookPublishStatus(book) !== 'draft') return false
    const bookGrade = bookGradeValue(book)
    if (grade === 'unspecified') {
      if (bookGrade !== null) return false
    } else if (grade && grade !== 'all' && bookGrade !== Number(grade)) {
      return false
    }
    if (!key) return true
    const title = String(book?.title || '').toLocaleLowerCase()
    const author = String(book?.author || '').toLocaleLowerCase()
    return title.includes(key) || author.includes(key)
  })
}

export function countLibraryBooks(books, predicate) {
  return (Array.isArray(books) ? books : []).filter(predicate).length
}
