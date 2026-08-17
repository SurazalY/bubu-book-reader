import { forwardRef } from 'react'
import { cx } from '../../shared/cx.js'
import { RuntimeIcon as Icon } from '../../shared/RuntimeIcon.jsx'
import PageArt from './PageArt.jsx'

const PAGE_DESIGN = Object.freeze({ width: 468, height: 636, padX: 36, padY: 42 })

// 一张固定排版书页。
//
// 「固定排版」的实现方式（规格 §6.1 + Codex 第 85 轮）：
//   正文按 PAGE_DESIGN 的设计尺寸排一次版就定死，窗口变化只对整页做 transform: scale(k)，
//   所以行数、断行位置、插图位置永远不变，**不存在重新流式排版**。
//   同时正文仍然是真实的文字节点，长按选文、高亮、批注、页内坐标映射都能照常工作
//   （这也是 Codex 明令「不得把正文渲染成 PNG」的原因）。
//
// 缩放由父级算好后通过 scale 传进来；react-pageflip 那边拿到的是缩放后的像素宽高，
// 所以翻页几何与页面视觉严格对齐。

// 把一段文字按「当前选区／学生摘录／教师选文／学生批注」四层标记切片。
//
// 「当前选区」为什么也要自己画，不能只靠浏览器的 ::selection：
//   抬手完成选文后会出工具栏并入托盘，Reader 重渲染，react-pageflip 会把整张书页的 DOM 换掉
//   （实测：抬手后 body／段落／文本节点全部变成新对象），原生选区会静默消失，
//   变成「工具栏在、可是看不出自己选了哪段」。自己画就不依赖原生选区能不能活下来，
//   翻页走一圈再回来也还标在那里。
// 用逐字打标再合并同类连续段的做法，重叠区间天然正确：
// 规格 §6.5 要求双方选中同一段时**保留学生底色并叠加教师标记**，逐字打标正好满足。
function buildSegments(text, { student = [], teacher = [], notes = [], live = [], focus = [] }) {
  const n = text.length
  const flags = Array.from({ length: n }, () => ({ s: false, t: false, n: false, l: false, f: false, note: '', who: '' }))
  const paint = (needle, apply) => {
    if (!needle) return
    let from = 0
    for (;;) {
      const idx = text.indexOf(needle, from)
      if (idx === -1) break
      for (let i = idx; i < idx + needle.length; i += 1) apply(flags[i])
      from = idx + needle.length
    }
  }
  student.forEach((m) => paint(typeof m === 'string' ? m : m.text, (f) => (f.s = true)))
  teacher.forEach((m) =>
    paint(m.text, (f) => {
      f.t = true
      f.who = m.teacher || '教师'
    }),
  )
  notes.forEach((m) =>
    paint(m.text, (f) => {
      f.n = true
      f.note = m.note || ''
    }),
  )
  live.forEach((m) => paint(typeof m === 'string' ? m : m.text, (f) => (f.l = true)))
  // focus = 刚选完的那一段。它要多带一个 data-sel-now，
  // 阅读器靠量这个元素的真实位置来放工具栏与首尾控制点（不能用抬手时的旧坐标）。
  focus.forEach((m) => paint(typeof m === 'string' ? m : m.text, (f) => (f.f = true)))

  const segs = []
  for (let i = 0; i < n; i += 1) {
    const f = flags[i]
    const last = segs[segs.length - 1]
    const same =
      last &&
      last.s === f.s &&
      last.t === f.t &&
      last.n === f.n &&
      last.l === f.l &&
      last.f === f.f &&
      last.note === f.note &&
      last.who === f.who
    if (same) last.t2 += text[i]
    else segs.push({ t2: text[i], s: f.s, t: f.t, n: f.n, l: f.l, f: f.f, note: f.note, who: f.who })
  }
  // 教师标记的最后一段挂一个小教师图标：规格要求「避免只靠颜色区分」
  segs.forEach((seg, i) => {
    if (seg.t && (!segs[i + 1] || !segs[i + 1].t)) seg.teacherEnd = true
  })
  return segs
}

function MarkedParagraph({ text, marks, className, blockId, style }) {
  const segs = buildSegments(text, marks)
  if (segs.length === 1 && !segs[0].s && !segs[0].t && !segs[0].n && !segs[0].l) {
    return <p className={className} style={style} data-block-id={blockId}>{text}</p>
  }
  return (
    <p className={className} style={style} data-block-id={blockId}>
      {segs.map((seg, i) => {
        if (!seg.s && !seg.t && !seg.n && !seg.l) return <span key={i}>{seg.t2}</span>
        const title = [
          seg.l ? '刚选中的原文' : '',
          seg.s ? '我的摘录' : '',
          seg.t ? `${seg.who}标记的原文` : '',
          seg.n ? `我的批注：${seg.note}` : '',
        ]
          .filter(Boolean)
          .join(' · ')
        return (
          <span
            key={i}
            title={title}
            data-sel-now={seg.f ? '' : undefined}
            className={cx(
              seg.l && 'student-mark-live',
              seg.s && 'student-mark-sel',
              seg.t && 'student-mark-teacher',
              seg.n && 'student-mark-note',
            )}
          >
            {seg.t2}
            {seg.teacherEnd && (
              <span className="student-mark-teacher-badge" aria-label={`${seg.who}标记`}>
                <Icon name="UserCheck" className="h-[11px] w-[11px]" strokeWidth={2.4} />
              </span>
            )}
          </span>
        )
      })}
    </p>
  )
}

const BookPage = forwardRef(function BookPage(
  { page, scale = 1, totalPages, bookmarked, onToggleBookmark, marks = {}, tone = 'warm', current = false },
  ref,
) {
  const { width, height, padX, padY } = PAGE_DESIGN
  const figure = page.figure || page.illustration
  return (
    <div className="student-book-page" ref={ref} data-density="soft">
      <div
        className={cx('student-page-frame', `student-page--${tone}`)}
        style={{ width: Math.round(width * scale), height: Math.round(height * scale) }}
      >
        <div
          className="student-page-inner"
          style={{
            width,
            height,
            padding: `${padY}px ${padX}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
            <div className="student-page-head">
              <span className="truncate">{page.chapter}</span>
            </div>

            {/* data-page 是页内坐标映射的最小实现：选区落在哪一页由它判定，
                Stage 4 的引文卡片与未来接真实 PDF 的坐标映射都复用这个锚点。 */}
            <div className="student-page-body" data-page={page.no}>
              {page.blocks.map((b, i) =>
                b.k === 'h' || b.kind === 'heading' || b.kind === 'h' ? (
                  <h2 key={i} className="student-page-h">
                    {b.t || b.text}
                  </h2>
                ) : (
                  <MarkedParagraph
                    key={b.blockId || b.id || i}
                    blockId={b.blockId || b.id}
                    text={b.t || b.text}
                    marks={marks}
                    className="student-page-p"
                  />
                ),
              )}
              {figure && (
                <figure className="student-page-figure">
                  <PageArt kind={figure.kind} src={figure.url} />
                  <figcaption>{figure.caption || '正文插图'}</figcaption>
                </figure>
              )}
            </div>

            <div className="student-page-foot">
              <span className="tabular-nums">第 {page.no} 页</span>
              {totalPages ? <span className="tabular-nums opacity-70">全书 {totalPages} 页</span> : null}
            </div>
        </div>

        {/* 页角书签：规格 §6.3「书签用于标记整页，放在页角或工具栏，不与摘录混用」。
            所以它只认整页，不接受选区，也不写进摘录列表。 */}
        <button
          type="button"
          data-reader-ui=""
          onClick={(e) => {
            e.stopPropagation()
            onToggleBookmark?.(page.no)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-pressed={!!bookmarked}
          aria-label={bookmarked ? `移除第 ${page.no} 页的书签` : `给第 ${page.no} 页加书签`}
          title={bookmarked ? `第 ${page.no} 页已加书签，点一下移除` : `给第 ${page.no} 页加书签`}
          className={cx('student-page-corner', bookmarked && 'student-page-corner--on', current && 'student-page-corner--live')}
        >
          <Icon
            name="Bookmark"
            className="h-[15px] w-[15px]"
            fill={bookmarked ? 'currentColor' : 'none'}
            strokeWidth={bookmarked ? 0 : 2}
          />
        </button>
      </div>
    </div>
  )
})

export default BookPage
