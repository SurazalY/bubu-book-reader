import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import HTMLFlipBook from 'react-pageflip'
import { cx } from '../../components/ui.jsx'

// 教师端翻页书：沿用学生端 Reader 的 react-pageflip 结构与 .flip-* 纸张样式，
// 不做通用 PDF 查看器（硬边界）。页面内容由调用方给好（books.js 的 getPages），
// 这里只负责测量尺寸、双页/单页切换与受控跳页。

const PAGE_RATIO = 1.34
const PAD_X = 30
const PAD_Y = 32

const FlipPage = forwardRef(function FlipPage({ page, total }, ref) {
  return (
    <div className="flip-page" ref={ref} data-density="soft">
      <div className="flip-page-inner" style={{ padding: `${PAD_Y}px ${PAD_X}px` }}>
        <div className="prose-reader flip-page-body">
          {page.heading && (
            <h3 className="font-serif text-[15px] font-bold text-ink-900 mb-2.5 leading-snug">{page.heading}</h3>
          )}
          {page.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        <div className="flip-page-foot">
          {page.index} / {total}
        </div>
      </div>
    </div>
  )
})

export default function BookFlip({ pages, page = 1, onPageChange, className, minHeight = 320 }) {
  const stageRef = useRef(null)
  const flipRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const cr = e.contentRect
        setSize((prev) =>
          Math.abs(prev.w - cr.width) > 1 || Math.abs(prev.h - cr.height) > 1 ? { w: cr.width, h: cr.height } : prev,
        )
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 可用宽度不足时走单页，避免两页并排把版面压成细条
  const portrait = size.w > 0 && size.w < 620

  const { pageW, pageH } = useMemo(() => {
    if (size.w <= 0 || size.h <= 0) return { pageW: 0, pageH: 0 }
    let h = size.h
    let w = h / PAGE_RATIO
    const maxW = portrait ? size.w : size.w / 2
    if (w > maxW) {
      w = maxW
      h = w * PAGE_RATIO
    }
    return { pageW: Math.floor(w), pageH: Math.floor(h) }
  }, [size, portrait])

  const total = pages.length
  // 尺寸/页数变化必须换 key，否则 page-flip 内部状态会错乱（学生端踩过）
  const flipKey = `cflip-${total}-${pageW}x${pageH}-${portrait ? 'p' : 'l'}`

  // 受控跳页：外部改 page（目录跳转、页码输入）时直接翻到那一页
  useEffect(() => {
    const api = flipRef.current?.pageFlip?.()
    if (!api) return
    const target = Math.max(0, Math.min(total - 1, page - 1))
    const current = api.getCurrentPageIndex()
    const targetIsVisible = current === target || (!portrait && current + 1 === target)
    if (!targetIsVisible) api.turnToPage(target)
  }, [page, total, flipKey, portrait])

  return (
    <div
      ref={stageRef}
      className={cx('relative w-full flex items-center justify-center', className)}
      style={{ minHeight }}
    >
      {pageW > 0 && (
        <div className="flip-book-shell" style={{ width: portrait ? pageW : pageW * 2, height: pageH }}>
          <HTMLFlipBook
            key={flipKey}
            ref={flipRef}
            className="flip-book"
            width={pageW}
            height={pageH}
            size="fixed"
            minWidth={120}
            maxWidth={2000}
            minHeight={160}
            maxHeight={2600}
            maxShadowOpacity={0.4}
            drawShadow
            flippingTime={620}
            usePortrait={portrait}
            mobileScrollSupport={false}
            clickEventForward={false}
            useMouseEvents
            showCover={false}
            showPageCorners
            startPage={Math.max(0, Math.min(total - 1, page - 1))}
            onFlip={(e) => onPageChange?.(Math.min(total, (e?.data ?? 0) + 1))}
          >
            {pages.map((p) => (
              <FlipPage key={p.index} page={p} total={total} />
            ))}
          </HTMLFlipBook>
        </div>
      )}
    </div>
  )
}
