import { forwardRef, useEffect, useState } from 'react'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

import { cx } from '../../shared/cx.js'
import { RuntimeIcon as Icon } from '../../shared/RuntimeIcon.jsx'

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()

export function useProtectedPdfDocument({ asset, workspaceId, expectedPages, enabled }) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ status: 'idle', document: null, width: 0, height: 0, error: null })

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle', document: null, width: 0, height: 0, error: null })
      return undefined
    }
    if (!asset?.url || !workspaceId) {
      const error = new Error('原版模式缺少受保护的源 PDF 资产或工作空间')
      error.code = 'PDF_SOURCE_REQUIRED'
      setState({ status: 'error', document: null, width: 0, height: 0, error })
      return undefined
    }
    let cancelled = false
    const loadingTask = getDocument({
      url: asset.url,
      httpHeaders: { 'X-Workspace-Id': workspaceId },
      withCredentials: true,
    })
    setState({ status: 'loading', document: null, width: 0, height: 0, error: null })
    loadingTask.promise.then(async (document) => {
      if (document.numPages !== expectedPages) {
        const error = new Error(`源 PDF 共 ${document.numPages} 页，与书籍版本登记的 ${expectedPages} 页不一致`)
        error.code = 'PDF_PAGE_COUNT_MISMATCH'
        throw error
      }
      const firstPage = await document.getPage(1)
      const viewport = firstPage.getViewport({ scale: 1 })
      if (!cancelled) {
        setState({
          status: 'ready',
          document,
          width: viewport.width,
          height: viewport.height,
          error: null,
        })
      }
    }).catch((cause) => {
      if (cancelled) return
      const error = new Error(`源 PDF 加载失败：${cause?.message || '未知错误'}`)
      error.code = cause?.code || 'PDF_LOAD_FAILED'
      setState({ status: 'error', document: null, width: 0, height: 0, error })
    })
    return () => {
      cancelled = true
      loadingTask.destroy()
    }
  }, [asset?.url, attempt, enabled, expectedPages, workspaceId])

  return { ...state, reload: () => setAttempt((value) => value + 1) }
}

const PdfBookPage = forwardRef(function PdfBookPage({
  document,
  pageNo,
  scale,
  designWidth,
  designHeight,
  totalPages,
  active,
  bookmarked,
  onToggleBookmark,
  tone = 'warm',
  current = false,
  documentError = null,
}, ref) {
  const [canvas, setCanvas] = useState(null)
  const [renderState, setRenderState] = useState({ status: 'idle', error: null })

  useEffect(() => {
    if (!active || !document || !canvas) {
      setRenderState({ status: documentError ? 'error' : 'idle', error: documentError })
      return undefined
    }
    let cancelled = false
    let renderTask = null
    setRenderState({ status: 'loading', error: null })
    document.getPage(pageNo).then((pdfPage) => {
      if (cancelled) return null
      const base = pdfPage.getViewport({ scale: 1 })
      const viewport = pdfPage.getViewport({ scale: (designWidth * scale) / base.width })
      const ratio = Math.max(1, window.devicePixelRatio || 1)
      canvas.width = Math.ceil(viewport.width * ratio)
      canvas.height = Math.ceil(viewport.height * ratio)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      const canvasContext = canvas.getContext('2d', { alpha: false })
      renderTask = pdfPage.render({
        canvasContext,
        viewport,
        transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
      })
      return renderTask.promise
    }).then(() => {
      if (!cancelled) setRenderState({ status: 'ready', error: null })
    }).catch((cause) => {
      if (cancelled || cause?.name === 'RenderingCancelledException') return
      const error = new Error(`第 ${pageNo} 页 PDF 渲染失败：${cause?.message || '未知错误'}`)
      error.code = 'PDF_PAGE_RENDER_FAILED'
      setRenderState({ status: 'error', error })
    })
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [active, canvas, designWidth, document, documentError, pageNo, scale])

  return (
    <div className="student-book-page" ref={ref} data-density="soft">
      <div
        className={cx('student-page-frame', `student-page--${tone}`, 'student-pdf-page-frame')}
        style={{ width: Math.round(designWidth * scale), height: Math.round(designHeight * scale) }}
      >
        <div className="student-pdf-canvas-wrap" aria-label={`原版 PDF 第 ${pageNo} 页`}>
          <canvas ref={setCanvas} className="student-pdf-canvas" aria-hidden="true" />
          {active && renderState.status === 'loading' && (
            <span className="student-pdf-status"><Icon name="Loader" className="h-4 w-4 animate-spin" />正在渲染原版页</span>
          )}
          {active && renderState.status === 'error' && (
            <span className="student-pdf-status student-pdf-status--error" role="alert">
              <Icon name="FileWarning" className="h-4 w-4" />{renderState.error?.message}
            </span>
          )}
          {!active && <span className="student-pdf-page-placeholder">第 {pageNo} 页 / 共 {totalPages} 页</span>}
        </div>
        <button
          type="button"
          data-reader-ui=""
          onClick={(event) => {
            event.stopPropagation()
            onToggleBookmark?.(pageNo)
          }}
          onPointerDown={(event) => event.stopPropagation()}
          aria-pressed={Boolean(bookmarked)}
          aria-label={bookmarked ? `移除第 ${pageNo} 页的书签` : `给第 ${pageNo} 页加书签`}
          className={cx('student-page-corner', bookmarked && 'student-page-corner--on', current && 'student-page-corner--live')}
        >
          <Icon name="Bookmark" className="h-[15px] w-[15px]" fill={bookmarked ? 'currentColor' : 'none'} strokeWidth={bookmarked ? 0 : 2} />
        </button>
      </div>
    </div>
  )
})

export default PdfBookPage
