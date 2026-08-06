import { useCallback, useMemo } from 'react'

import { createStudentApi } from '../../api/student.js'
import { useApiResource } from '../../api/useApiResource.js'
import { toReaderPageDto } from '../../adapters/student.js'

export default function useStudentReaderPages(book, pageNo, workspaceId) {
  const api = useMemo(() => createStudentApi(), [])
  const load = useCallback(async () => {
    if (!book?.id) return { data: { pages: [] }, meta: {} }
    const totalPages = book.progress?.totalPages
    const nextPage = totalPages && pageNo + 1 > totalPages ? null : pageNo + 1
    const responses = await Promise.all([
      api.getBookPage(book.id, pageNo, { workspaceId, query: book.versionId ? { versionId: book.versionId } : undefined }),
      nextPage ? api.getBookPage(book.id, nextPage, { workspaceId, query: book.versionId ? { versionId: book.versionId } : undefined }) : null,
    ])
    return {
      data: {
        pages: responses
          .filter(Boolean)
          .map((response, index) => toReaderPageDto({ ...response.data, pageNo: response.data?.pageNo ?? pageNo + index })),
      },
      meta: responses[0]?.meta || {},
    }
  }, [api, book?.id, book?.progress?.totalPages, book?.versionId, pageNo, workspaceId])

  return useApiResource(load)
}
