import { useCallback, useMemo } from 'react'

import { createStudentApi } from '../../api/student.js'
import { useApiResource } from '../../api/useApiResource.js'
import { toReaderPageDto } from '../../adapters/student.js'

export function validateReaderPageResponse(response, { bookId, bookVersionId, pageNo }) {
  const data = response?.data
  if (!data || data.bookVersionId !== bookVersionId) {
    const error = new Error('服务端返回的正文版本与请求不一致')
    error.code = 'VERSION_RESPONSE_MISMATCH'
    throw error
  }
  if (data.bookId != null && data.bookId !== bookId) {
    const error = new Error('服务端返回的正文不属于当前书籍')
    error.code = 'BOOK_RESPONSE_MISMATCH'
    throw error
  }
  if (Number(data.pageNo) !== pageNo || !Number.isSafeInteger(Number(data.pageNo))) {
    const error = new Error('服务端返回的页码与请求不一致')
    error.code = 'PAGE_RESPONSE_MISMATCH'
    throw error
  }
  return data
}

export default function useStudentReaderPages(book, pageNo, workspaceId) {
  const api = useMemo(() => createStudentApi(), [])
  const load = useCallback(async () => {
    if (!book?.id) return { data: { pages: [] }, meta: {} }
    const totalPages = book.progress?.totalPages
    const nextPage = totalPages && pageNo + 1 > totalPages ? null : pageNo + 1
    const requestedPages = [pageNo, nextPage].filter(Boolean)
    const responses = await Promise.all([
      api.getBookPage(book.id, pageNo, { workspaceId, query: book.versionId ? { versionId: book.versionId } : undefined }),
      nextPage ? api.getBookPage(book.id, nextPage, { workspaceId, query: book.versionId ? { versionId: book.versionId } : undefined }) : null,
    ])
    return {
      data: {
        pages: responses
          .filter(Boolean)
          .map((response, index) => toReaderPageDto(validateReaderPageResponse(response, {
            bookId: book.id,
            bookVersionId: book.versionId,
            pageNo: requestedPages[index],
          }))),
      },
      meta: responses[0]?.meta || {},
    }
  }, [api, book?.id, book?.progress?.totalPages, book?.versionId, pageNo, workspaceId])

  return useApiResource(load)
}
