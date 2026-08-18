const GRADE_OPTIONS = [1, 2, 3, 4, 5, 6]

export function matchesBookGrade(book, grade) {
  const value = Number(book?.grade)
  return Number.isInteger(value) && value === grade
}

export const SHELF_FILTERS = [
  { key: 'all', label: '全部书籍', icon: 'Library', options: [{ key: 'all', label: '全部', match: () => true }] },
  {
    key: 'state',
    label: '书架状态',
    icon: 'BookOpen',
    options: [
      { key: 'liked', label: '我喜欢', match: (book) => book.liked },
      { key: 'downloaded', label: '已下载', match: (book) => book.downloaded },
    ],
  },
  {
    key: 'grade',
    label: '年级',
    icon: 'GraduationCap',
    options: GRADE_OPTIONS.map((grade) => ({
      key: String(grade),
      label: `${grade} 年级`,
      match: (book) => matchesBookGrade(book, grade),
    })),
  },
]

export function findFilterOption(group, option) {
  const selectedGroup = SHELF_FILTERS.find((item) => item.key === group) || SHELF_FILTERS[0]
  return { group: selectedGroup, option: selectedGroup.options.find((item) => item.key === option) || selectedGroup.options[0] }
}

export function filterShelfBooks(books, { group, option, query } = {}) {
  const source = Array.isArray(books) ? books : []
  const { option: active } = findFilterOption(group, option)
  const key = String(query || '').trim().toLowerCase()
  return source.filter((book) => active.match(book)).filter((book) => (
    !key
      ? true
      : [book.title, book.author].some((field) => String(field || '').toLowerCase().includes(key))
  ))
}
