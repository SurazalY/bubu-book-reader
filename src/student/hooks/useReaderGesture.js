// 阅读器手势状态机（规格 §6.2 / 第一轮 §4.2）。
//
// 规格原文要求的分流：
//   1. 手指按下后立即发生明显横向移动 → 翻页
//   2. 手指在文字区域稳定停留达到阈值 → 轻震并进入选文
//   3. 进入选文后，同一根手指继续移动只扩展选区，不再翻页
//   4. 抬手后显示首尾控制点与选文工具栏
//   5. 退出选文后恢复单指翻页
//   并且「手势分流由阅读器自身统一接管，不依赖系统自动区分」。
//
// 所以这里**自己实现选区**，不指望浏览器的原生长按选字：
//   进入选文时用 caretRangeFromPoint 取锚点，手指移动时不断把 focus 端推到当前坐标，
//   这样才真正做到「同一根手指继续移动只扩展选区」，触屏与鼠标走同一套代码。
//   react-pageflip 那边把 useMouseEvents 关掉，翻页完全由本状态机调用 API 触发，
//   不会出现「库和我们同时猜手势」的互相误触（§15.2 验收点）。
//
// 为什么必须自己做，而不是「放手让浏览器原生拖选」（这一版返工的原因）：
//   进入选文态会通知页面（出工具栏、亮选区底色），React 随即重渲染书页，
//   正文的文本节点被整批替换。浏览器原生选区控制器在 mousedown 时抓的是**节点引用**，
//   节点一换它就失效，选区当场塌成一个空点，之后再怎么拖都扩不出字来
//   （实测：selectstart 正常触发也没被 preventDefault，但全程 selection 长度恒为 0）。
//   坐标锚点没有这个问题：固定排版下同一坐标永远对应同一个字，每帧重新解析反而最稳。
//   同时把正文区的 selectstart 拦掉，免得原生拖选和我们互相覆盖。
//
// 桌面调试：Ctrl + 拖动 = 直接进选文，普通拖动 = 翻页。

import { useEffect, useRef, useState } from 'react'

// 阈值都是设备调试参数，规格明确不在产品文档里固定数值，集中放这里方便平板上调
const LONG_PRESS_MS = 340 // 稳定停留多久算长按
const MOVE_TOL = 10 // 判定「明显移动」的位移
const FLIP_TOL = 48 // 抬手时横向位移超过这个值才真的翻页
const JITTER = 6 // 长按期间允许的手抖

function caretAt(x, y) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y)
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y)
    if (!pos) return null
    const r = document.createRange()
    r.setStart(pos.offsetNode, pos.offset)
    r.collapse(true)
    return r
  }
  return null
}

// 取坐标处的可选文字位置：caret 落在元素上时退回到内部文本节点
function pointAt(x, y) {
  const r = caretAt(x, y)
  return r ? textPoint(r.startContainer, r.startOffset) : null
}

// caret 有时会落在段落元素（行间空白处）而不是文字上，
// 这时拿到的 offset 是子节点下标，直接用会让选区漏掉一大截。退回取内部文本节点。
function textPoint(node, offset) {
  if (!node) return null
  if (node.nodeType === 3) return { node, offset }
  const kid = node.childNodes?.[Math.min(offset, (node.childNodes?.length || 1) - 1)] || node
  if (kid.nodeType === 3) return { node: kid, offset: offset > 0 ? kid.length : 0 }
  const walker = document.createTreeWalker(kid, NodeFilter.SHOW_TEXT)
  const first = walker.nextNode()
  return first ? { node: first, offset: 0 } : null
}

// 整句边界：中文句末标点 + 引号收口
const SENT_END = /[\u3002\uff01\uff1f\uff1b\u201d\n]/

// 正文段落里的文字会被摘录／教师标记切成多个 <span>，一个段落常常是好几段短文本节点
// （实测同一段被切成 4 / 14 / 23 字三节点）。所以「找整句」不能只在单个文本节点里找，
// 否则永远凑不满一句就放弃了。这里把整段拼成一条字符串，找完句子边界再映射回节点。
function blockPieces(node) {
  const el = node?.nodeType === 3 ? node.parentElement : node
  const block = el?.closest?.('p, li, blockquote, figcaption') || el?.closest?.('[data-page]')
  if (!block) return null
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  const pieces = []
  let at = 0
  let t
  while ((t = walker.nextNode())) {
    const len = t.nodeValue?.length || 0
    if (!len) continue
    pieces.push({ node: t, start: at, len })
    at += len
  }
  return pieces.length ? { pieces, text: pieces.map((p) => p.node.nodeValue).join('') } : null
}

// 全局偏移 → (文本节点, 节点内偏移)
function locate(pieces, offset) {
  for (const p of pieces) {
    if (offset <= p.start + p.len) return { node: p.node, offset: Math.max(0, offset - p.start) }
  }
  const last = pieces[pieces.length - 1]
  return { node: last.node, offset: last.len }
}

function pageOf(node) {
  const el = node?.nodeType === 3 ? node.parentElement : node
  const holder = el?.closest?.('[data-page]')
  return holder ? Number(holder.getAttribute('data-page')) : null
}

function selectionEvidence(sel, stage) {
  if (!sel?.rangeCount) return { selectedBlockIds: [], selectionRange: null }
  const range = sel.getRangeAt(0)
  const blocks = [...stage.querySelectorAll('[data-block-id]')].filter((block) => {
    try {
      return range.intersectsNode(block)
    } catch {
      return false
    }
  })
  const selectedBlockIds = [...new Set(blocks.map((block) => block.dataset.blockId).filter(Boolean))]
  if (blocks.length !== 1 || selectedBlockIds.length !== 1) {
    return { selectedBlockIds, selectionRange: null }
  }
  const block = blocks[0]
  const startElement = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer
  const endElement = range.endContainer.nodeType === 3 ? range.endContainer.parentElement : range.endContainer
  if (!block.contains(startElement) || !block.contains(endElement)) {
    return { selectedBlockIds, selectionRange: null }
  }
  const beforeStart = document.createRange()
  beforeStart.selectNodeContents(block)
  beforeStart.setEnd(range.startContainer, range.startOffset)
  const beforeEnd = document.createRange()
  beforeEnd.selectNodeContents(block)
  beforeEnd.setEnd(range.endContainer, range.endOffset)
  const rawText = sel.toString()
  const leadingWhitespace = rawText.length - rawText.trimStart().length
  const trailingWhitespace = rawText.length - rawText.trimEnd().length
  const startOffset = beforeStart.toString().length + leadingWhitespace
  const endOffset = beforeEnd.toString().length - trailingWhitespace
  return {
    selectedBlockIds,
    selectionRange: endOffset > startOffset
      ? { blockId: selectedBlockIds[0], startOffset, endOffset }
      : null,
  }
}

export function useReaderGesture(
  stageRef,
  { onFlipPrev, onFlipNext, onTap, onSelectStart, onSelectEnd, enabled = true, maxLen = 600 } = {},
) {
  // 'idle' | 'pending' | 'flip' | 'select'
  const [mode, setMode] = useState('idle')
  const st = useRef({ mode: 'idle', x: 0, y: 0, t: 0, dx: 0, anchor: null, id: null })
  // 回调放 ref，避免父组件每次渲染都重新绑定原生监听器（重绑会丢掉进行中的手势）
  const cb = useRef({})
  cb.current = { onFlipPrev, onFlipNext, onTap, onSelectStart, onSelectEnd, enabled, maxLen }

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    let timer = 0

    const setMode2 = (m) => {
      st.current.mode = m
      setMode(m)
    }
    const clearTimer = () => {
      if (timer) window.clearTimeout(timer)
      timer = 0
    }

    const enterSelect = (x, y) => {
      const range = caretAt(x, y)
      // 锚点只存屏幕坐标，不存 DOM 节点：
      // 进入选文会通知页面（React 重渲染），书页里的文本节点会被整批替掉，
      // 存节点引用下一帧就失效，选区会塌成一个空点。
      // 固定排版下同一坐标永远对应同一个字，所以每帧重新解析反而最稳。
      st.current.anchor = range ? { x, y, page: pageOf(range.startContainer) } : null
      setMode2('select')
      // 轻震：规格要求「达到阈值后轻震并进入选文」，桌面没有振动器就自然跳过
      navigator.vibrate?.(12)
      cb.current.onSelectStart?.()
    }

    // 按坐标把选区从锚点拉到当前点（选文态每一帧都做）
    const extendTo = (x, y) => {
      const a = st.current.anchor
      if (!a) return
      const from = pointAt(a.x, a.y)
      const to = pointAt(x, y)
      if (!from || !to) return
      const sel = window.getSelection?.()
      if (!sel) return
      try {
        sel.setBaseAndExtent(from.node, from.offset, to.node, to.offset)
      } catch {
        /* 跨越不可选节点时跳过这一帧，下一帧还会再试 */
      }
    }

    // 把选区撑成所在句：以锚点为中心，在整段文字里向两侧找句末标点
    const selectSentence = (sel, anchor) => {
      const ra = anchor ? caretAt(anchor.x, anchor.y) : null
      const p = ra ? textPoint(ra.startContainer, ra.startOffset) : textPoint(sel.anchorNode, sel.anchorOffset || 0)
      if (!p) return
      const blk = blockPieces(p.node)
      if (!blk) return
      const { pieces, text: s } = blk
      const base = pieces.find((it) => it.node === p.node)
      if (!base || !s) return
      let a = Math.min(base.start + p.offset, s.length - 1)
      let b = a
      while (a > 0 && !SENT_END.test(s[a - 1])) a -= 1
      while (b < s.length && !SENT_END.test(s[b])) b += 1
      if (b < s.length) b += 1 // 把句末标点也包进来
      if (b - a < 2) return
      const from = locate(pieces, a)
      const to = locate(pieces, b)
      try {
        sel.setBaseAndExtent(from.node, from.offset, to.node, to.offset)
      } catch {
        /* 节点已被重渲染就算了，不能因为兼容兼容不了就把阅读卡住 */
      }
    }

    const onDown = (e) => {
      if (!cb.current.enabled) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      // 浮层控件（选文工具栏、页角书签…）直接放行。
      // 本监听器挂在舞台的捕获阶段，比控件自己的 stopPropagation 更早执行；
      // 不在这里放行的话，点工具栏会先被当成「轻点正文」——选区被清掉、面板被收起。
      if (e.target?.closest?.('[data-reader-ui]')) return
      st.current = { mode: 'pending', x: e.clientX, y: e.clientY, t: Date.now(), dx: 0, anchor: null, id: e.pointerId }
      setMode2('pending')
      window.getSelection?.()?.removeAllRanges()
      if (e.ctrlKey) {
        // 桌面调试通道：Ctrl + 拖动直接选文，不等长按
        clearTimer()
        enterSelect(e.clientX, e.clientY)
        return
      }
      clearTimer()
      timer = window.setTimeout(() => {
        if (st.current.mode === 'pending') enterSelect(st.current.x, st.current.y)
      }, LONG_PRESS_MS)
    }

    const onMove = (e) => {
      const s = st.current
      if (s.mode === 'idle' || e.pointerId !== s.id) return
      const dx = e.clientX - s.x
      const dy = e.clientY - s.y
      if (s.mode === 'pending') {
        if (Math.abs(dx) > MOVE_TOL && Math.abs(dx) > Math.abs(dy)) {
          // 明显横向移动 → 翻页手势；顺手清掉可能刚开始的原生选区
          clearTimer()
          setMode2('flip')
          window.getSelection?.()?.removeAllRanges()
        } else if (Math.abs(dx) > JITTER || Math.abs(dy) > JITTER) {
          // 手抖超过容差就不算「稳定停留」：锚点跟着手走并重新起一次计时，
          // 否则手一直漂着也会在原定时间点进选文，选区起点还跟手不一致
          s.x = e.clientX
          s.y = e.clientY
          s.t = Date.now()
          clearTimer()
          timer = window.setTimeout(() => {
            if (st.current.mode === 'pending') enterSelect(st.current.x, st.current.y)
          }, LONG_PRESS_MS)
        }
      }
      if (s.mode === 'flip') {
        // 翻页中拦住默认行为并持续清选区，否则拖着翻页会顺手把文字刷亮
        s.dx = dx
        e.preventDefault()
        window.getSelection?.()?.removeAllRanges()
      } else if (s.mode === 'select') {
        // 同一根手指继续移动只扩展选区，不再翻页（规格 §6.2 第 3 条）。
        // 锚点是坐标，每帧重新解析，所以书页被 React 重渲染也不会把选区弄丢。
        s.dx = dx
        e.preventDefault()
        extendTo(e.clientX, e.clientY)
      }
    }

    const finish = (e) => {
      const s = st.current
      if (s.mode === 'idle' || (e && e.pointerId !== s.id)) return
      clearTimer()
      const elapsed = Date.now() - s.t
      const mode0 = s.mode
      const dx = s.dx
      st.current = { ...s, mode: 'idle', anchor: mode0 === 'select' ? s.anchor : null, id: null }
      setMode2('idle')

      if (mode0 === 'flip') {
        if (dx >= FLIP_TOL) cb.current.onFlipPrev?.()
        else if (dx <= -FLIP_TOL) cb.current.onFlipNext?.()
        return
      }
      if (mode0 === 'pending') {
        // 又短又没动 = 轻点：交给页面决定（我们用来切换工具栏显隐）
        if (elapsed < LONG_PRESS_MS && Math.abs(dx) < MOVE_TOL) cb.current.onTap?.()
        return
      }
      if (mode0 === 'select') {
        const sel = window.getSelection?.()
        // 长按后没拖动（或只框到一个字）是真机上最常见的动作，
        // 只选中一个字没有意义，所以自动撑到所在的一整句。
        if (sel && (sel.toString() || '').trim().length < 2) selectSentence(sel, s.anchor)
        const text = (sel?.toString() || '').trim()
        if (!text) {
          cb.current.onSelectEnd?.(null)
          return
        }
        let rect = null
        try {
          rect = sel.getRangeAt(0).getBoundingClientRect()
        } catch {
          rect = null
        }
        const pages = [...new Set([s.anchor?.page, pageOf(sel.focusNode), pageOf(sel.anchorNode)].filter((p) => p != null))].sort(
          (a, b) => a - b,
        )
        const evidence = selectionEvidence(sel, stage)
        cb.current.onSelectEnd?.({
          text: text.slice(0, cb.current.maxLen),
          rect: rect
            ? { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
            : null,
          pages,
          ...evidence,
        })
      }
    }

    // 正文区的原生拖选一律掐掉：选区由本状态机独占，两边同时改只会互相覆盖。
    // 只拦书页范围内的，输入框（跳页、批注）与浮层控件照常可以选自己的文字。
    const onSelectStart = (e) => {
      const el = e.target?.nodeType === 3 ? e.target.parentElement : e.target
      if (!el?.closest) return
      if (el.closest('input, textarea, [contenteditable="true"], [data-reader-ui]')) return
      if (el.closest('[data-page]')) e.preventDefault()
    }

    // 按住已选中的文字再移动，浏览器会当成「拖拽这段文字」并发 dragstart，
    // 紧接着一个 pointercancel 把手势整条接管走，选区也一起没。
    // 这是之前「拖选永远选不到字」的真正原因（实测：SET len=19 后 3ms 就来 pointercancel）。
    // 阅读器里没有任何需要 HTML5 拖拽的东西，直接禁掉。
    const onDragStart = (e) => e.preventDefault()

    // 捕获阶段接管：书页内部任何元素都不会先拿到手势
    stage.addEventListener('dragstart', onDragStart, { capture: true })
    document.addEventListener('selectstart', onSelectStart, true)
    stage.addEventListener('pointerdown', onDown, { capture: true })
    window.addEventListener('pointermove', onMove, { capture: true, passive: false })
    window.addEventListener('pointerup', finish, true)
    window.addEventListener('pointercancel', finish, true)
    return () => {
      clearTimer()
      stage.removeEventListener('dragstart', onDragStart, { capture: true })
      document.removeEventListener('selectstart', onSelectStart, true)
      stage.removeEventListener('pointerdown', onDown, { capture: true })
      window.removeEventListener('pointermove', onMove, { capture: true })
      window.removeEventListener('pointerup', finish, true)
      window.removeEventListener('pointercancel', finish, true)
    }
  }, [stageRef])

  return { mode }
}

export default useReaderGesture
