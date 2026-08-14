import { MOVEMENT_SOURCES, assertEnum } from './constants.js'

function positivePage(value, label = '页码') {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label}必须是正安全整数`)
  return value
}

export function createStableView({ pageNos, layout = 'single' }) {
  if (!['single', 'double'].includes(layout)) throw new TypeError('阅读视图布局只能是single或double')
  if (!Array.isArray(pageNos)) throw new TypeError('阅读视图必须提供可见页码')
  const normalized = [...new Set(pageNos.map((pageNo) => positivePage(pageNo)))].sort((left, right) => left - right)
  const expectedCount = layout === 'single' ? 1 : 2
  if (normalized.length < 1 || normalized.length > expectedCount) throw new TypeError('可见页数与单双页布局不匹配')
  if (layout === 'single' && normalized.length !== 1) throw new TypeError('单页视图只能包含一页')
  if (normalized.length === 2 && normalized[1] !== normalized[0] + 1) throw new TypeError('双页视图必须是连续页')
  return Object.freeze({
    layout,
    pageNos: Object.freeze(normalized),
    mainPageNo: normalized[0],
    key: `${layout}:${normalized.join(',')}`,
  })
}

export function areAdjacentViews(fromView, toView) {
  if (!fromView || !toView) return false
  const fromFirst = fromView.pageNos[0]
  const fromLast = fromView.pageNos.at(-1)
  const toFirst = toView.pageNos[0]
  const toLast = toView.pageNos.at(-1)
  return fromLast + 1 === toFirst || toLast + 1 === fromFirst
}

export function movement(source) {
  return assertEnum(source, MOVEMENT_SOURCES, '位置变化来源')
}

function queryValues(params, key) {
  const values = params.getAll(key)
  if (values.length > 1) return { error: `${key}不能重复` }
  return { present: values.length === 1, value: values[0] }
}

function locationError(code, message) {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message }) })
}

function readable(book) {
  return book && book.access?.readable !== false
}

export function resolveReaderLocation({ pathBookId, search = '', books = [] }) {
  if (typeof pathBookId !== 'string' || !pathBookId) return locationError('INVALID_BOOK_ID', '阅读路由缺少书籍标识')
  const candidates = Array.isArray(books) ? books.filter(Boolean) : []
  const pathBook = candidates.find((book) => book.id === pathBookId) || null
  if (!readable(pathBook)) return locationError('BOOK_NOT_ACCESSIBLE', '这本书不存在或当前账号不可访问')

  const params = new URLSearchParams(String(search).replace(/^\?/, ''))
  const versionQuery = queryValues(params, 'versionId')
  const pageQuery = queryValues(params, 'pageNo')
  if (versionQuery.error || pageQuery.error) return locationError('INVALID_READER_QUERY', versionQuery.error || pageQuery.error)

  let book = pathBook
  if (versionQuery.present) {
    if (!versionQuery.value) return locationError('INVALID_VERSION_ID', 'versionId不能为空')
    const versionBook = candidates.find((item) => item.versionId === versionQuery.value) || null
    if (!versionBook) return locationError('VERSION_NOT_ACCESSIBLE', '指定的书籍版本不存在或不可访问')
    if (versionBook.id !== pathBookId) return locationError('VERSION_BOOK_MISMATCH', '指定版本不属于当前路由中的书籍')
    if (!readable(versionBook)) return locationError('VERSION_NOT_ACCESSIBLE', '指定的书籍版本当前不可访问')
    book = versionBook
  }

  if (typeof book.versionId !== 'string' || !book.versionId) {
    return locationError('VERSION_NOT_ACCESSIBLE', '当前书籍没有可访问的版本')
  }
  const totalPages = Number(book.progress?.totalPages)
  if (!Number.isSafeInteger(totalPages) || totalPages < 1) {
    return locationError('VERSION_PAGE_RANGE_UNAVAILABLE', '当前书籍版本没有可验证的页码范围')
  }

  let pageNo
  if (pageQuery.present) {
    if (!/^[1-9]\d*$/.test(pageQuery.value || '')) return locationError('INVALID_PAGE_NO', 'pageNo必须是不带符号的正整数')
    pageNo = Number(pageQuery.value)
    if (!Number.isSafeInteger(pageNo) || pageNo > totalPages) return locationError('PAGE_OUT_OF_RANGE', `pageNo必须位于1到${totalPages}之间`)
  } else {
    const restored = Number(book.progress?.currentPage)
    pageNo = Number.isSafeInteger(restored) && restored >= 1 && restored <= totalPages ? restored : 1
  }

  return Object.freeze({
    ok: true,
    book,
    bookVersionId: book.versionId,
    pageNo,
    totalPages,
    movementSource: pageQuery.present || versionQuery.present || pageNo !== 1 ? 'restore_position' : 'system_restore',
  })
}
