import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import HTMLFlipBook from 'react-pageflip'
import { cx } from '../../shared/cx.js'
import { RuntimeIcon as Icon } from '../../shared/RuntimeIcon.jsx'
import { GlassPanel } from '../components/Glass.jsx'
import BookPage from '../components/BookPage.jsx'
import PdfBookPage, { useProtectedPdfDocument } from '../components/PdfBookPage.jsx'
import { applyPdfZoom } from '../pdf-page-design.js'
import {
  NoteComposer,
  ReaderToast,
  SelectionHandles,
  SelectionToolbar,
  SelectionTray,
} from '../components/ReaderOverlays.jsx'
import AiPanel from '../components/AiPanel.jsx'
import MascotDock from '../components/MascotDock.jsx'
import { ClassroomAura, ClassroomBar } from '../components/ClassroomLayer.jsx'
import { createStudentApi } from '../../api/student.js'
import { useStudent } from '../state/StudentContext.jsx'
import useReaderGesture from '../hooks/useReaderGesture.js'
import useStudentReaderPages from '../state/useStudentReaderPages.js'
import useReadingTelemetry from '../state/useReadingTelemetry.js'
import useReadingLibrary from '../state/useReadingLibrary.js'
import useClassroomRuntime from '../state/useClassroomRuntime.js'
import {
  createStableView,
  movement as assertMovementSource,
  readerPageForResolvedLocation,
  reconcileFlipBootstrap,
  resolveReaderLocation,
} from '../reading-monitor/index.js'

const PAGE_DESIGN = Object.freeze({ width: 468, height: 636, padX: 36, padY: 42 })
const AI_NAME = '竹娃'
// D-03：三维翻页已隐藏。保持 false，使 HTMLFlipBook / api.flip() 运行时不可达；
// JSX 与标识保留，以免冻结扫描测试失败。残留 flipStyle === 'curl' 也走平移。
const STUDENT_CURL_FLIP_ENABLED = false

// 横屏整书阅读器（规格 §6 全段）。
//
// 三条硬约束一直贯穿这个文件：
//   1. 书页固定排版：翻页对象是一整页，窗口变化只等比缩放，绝不重新流式排版（§6.1 + Codex 第 85 轮）。
//   2. 手势自己接管：短拖翻页、长按进选文，两者不能互相误触（§6.2、§15.2）。
//   3. 阅读器以正文为中心，不显示一级导航；界面默认安静，只在翻页与状态变化时动（§2.1、§12）。
//
// Stage 4 在同一页上继续接了三样东西，都不改上面三条约束：
//   - 竹娃素材槽（收叠／探出／待机／退回／看向选区）与完整对话面板
//   - AI 六种受控状态：正常、生成中可停止、网络中断、AI 不可用、额度用完、该书还在建索引
//   - 课堂共读：蓝色锁书／紫色同步页边缘光 + 文字状态 + 教师广播强制展开面板

// 外层壳：先确定书籍存在，再挂载阅读器主体。
// 这样「书打不开」这条分支不会插在一堆 Hook 中间（条件式 Hook 会直接崩），
// 换书或换版本时用 key 重挂，页码、托盘与选区都干净重置。
// 同一本书内换页（含 URL ?pageNo=）绝不能进 key，否则会拆掉阅读监测会话。
export default function Reader() {
  const { bookId } = useParams()
  const location = useLocation()
  const { runtime } = useStudent()
  const resolution = useMemo(() => resolveReaderLocation({
    pathBookId: bookId,
    search: location.search,
    books: runtime.data?.books || [],
  }), [bookId, location.search, runtime.data?.books])
  const book = resolution.ok ? resolution.book : null
  const locationKey = resolution.ok
    ? `${bookId}:${resolution.bookVersionId}:${location.search}`
    : null
  const [savedPosition, setSavedPosition] = useState({ locationKey: null, pageNo: 1 })
  const pageNo = readerPageForResolvedLocation({ resolution, locationKey, savedPosition })
  const setPageNo = useCallback((nextPageNo) => {
    setSavedPosition({ locationKey, pageNo: nextPageNo })
  }, [locationKey])

  const pageResource = useStudentReaderPages(book, pageNo, runtime.data?.workspaceId)

  if (!resolution.ok) {
    const loading = runtime.status === 'loading' || runtime.status === 'idle'
    const error = runtime.status === 'error' ? runtime.error : loading ? null : resolution.error
    return <ReaderMissing loading={loading} error={error} onRetry={runtime.reload} />
  }
  return (
    <ReaderView
      key={`${bookId}:${resolution.bookVersionId}`}
      book={book}
      bookId={bookId}
      pageNo={pageNo}
      setPageNo={setPageNo}
      pageResource={pageResource}
      workspaceId={runtime.data?.workspaceId}
      initialMovementSource={resolution.movementSource}
    />
  )
}

function ReaderMissing({ loading = false, error = null, onRetry }) {
  return (
    <div className="student-reader-missing">
      <GlassPanel tone="solid" className="student-enter rounded-2xl px-8 py-10 text-center">
        <h1 className="font-serif text-h1 font-bold text-ink-900">{loading ? '正在打开这本书' : '这本书暂时打不开'}</h1>
        <p className="mt-2 text-caption text-ink-500">
          {loading ? '正在向服务端读取书架与阅读权限。' : error ? `${error.code || 'DEPENDENCY_UNAVAILABLE'}：${error.message || '服务端暂不可用'}` : '服务端没有返回这本书，回书架看看现在可以读哪些书。'}
        </p>
        {error && onRetry && (
          <button type="button" onClick={onRetry} className="student-reader-btn mt-4">
            <Icon name="RotateCcw" className="h-4 w-4" />
            重试
          </button>
        )}
        <Link
          to="/student/shelf"
          className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/80 px-4 py-2.5 text-caption font-semibold text-ink-700 transition hover:bg-white"
        >
          <Icon name="ArrowLeft" className="h-4 w-4" />
          返回书架
        </Link>
      </GlassPanel>
    </div>
  )
}

function ReaderView({ book, bookId, pageNo, setPageNo, pageResource, workspaceId, initialMovementSource }) {
  const navigate = useNavigate()
  const {
    student,
    prefs,
    setPref,
    aiQuotes,
    addAiQuotes,
    ai,
  } = useStudent()
  const library = useReadingLibrary({ workspaceId })
  const sourcePdf = useMemo(() => book.assets?.find((asset) => asset.kind === 'source_pdf') || null, [book.assets])
  const [readerMode, setReaderMode] = useState(sourcePdf ? 'original' : 'text')
  const studentApi = useMemo(() => createStudentApi(), [])
  const preferenceRestoredRef = useRef(false)

  useLayoutEffect(() => {
    if (preferenceRestoredRef.current) return
    const preferred = book.preferredReaderMode
    if (preferred !== 'original' && preferred !== 'text') return
    if (preferred === 'original' && !sourcePdf) return
    preferenceRestoredRef.current = true
    setReaderMode(preferred)
  }, [book.preferredReaderMode, sourcePdf])

  const reportReaderPreference = useCallback((mode) => {
    if (!workspaceId || !book.versionId) return
    if (mode !== 'original' && mode !== 'text') return
    studentApi.putReaderPreference(
      { bookVersionId: book.versionId, mode },
      { workspaceId },
    ).catch(() => undefined)
  }, [book.versionId, studentApi, workspaceId])

  // 字号偏好在固定排版里不能靠重排实现，所以走「放大就只看一页」：
  // 小／中字号 = 双页对开（像真的翻书），大字号 = 单页铺满（每个字都更大）。
  // 这是固定排版阅读器的常规做法，也守住了「正文绝不重新折行」。
  const spread = prefs.fontScale !== 'lg'
  const step = spread ? 2 : 1
  const loadedPages = pageResource.data?.pages || []
  const totalPages = book.progress?.totalPages || loadedPages.reduce((max, page) => Math.max(max, page.no || 0), 0) || pageNo
  const pageCount = Math.max(totalPages, pageNo, 1)
  const pdf = useProtectedPdfDocument({
    asset: sourcePdf,
    workspaceId,
    expectedPages: pageCount,
    enabled: readerMode === 'original',
  })
  const loadedByNumber = useMemo(() => new Map(loadedPages.map((page) => [page.no, page])), [loadedPages])
  const pageState = pageResource.status === 'loading'
    ? { heading: '正在加载正文', text: `正在向服务端读取第 ${pageNo} 页。` }
    : pageResource.status === 'error'
      ? { heading: '这一页暂时无法读取', text: `${pageResource.error?.code || 'DEPENDENCY_UNAVAILABLE'}：${pageResource.error?.message || '服务端暂不可用'}` }
      : loadedPages.length === 0
        ? { heading: '这一页暂无正文', text: '服务端返回了空页，没有使用本地演示正文补齐。' }
        : null
  const pages = useMemo(() => Array.from({ length: pageCount }, (_, index) => {
    const no = index + 1
    const loaded = loadedByNumber.get(no)
    if (loaded) return loaded
    const state = no === pageNo && pageState
      ? pageState
      : { heading: `第 ${no} 页`, text: '翻到这一页时会从服务端读取正文。' }
    return { no, chapter: state.heading, blocks: [{ kind: 'paragraph', text: state.text }] }
  }), [loadedByNumber, pageCount, pageNo, pageState])
  const chapters = loadedPages
    .filter((page) => page.chapter)
    .map((page) => ({ title: page.chapter, from: page.no, to: page.no }))
  const first = 1
  const last = totalPages
  const label = readerMode === 'original' ? '原版 PDF' : 'OCR 文字'
  const set = useMemo(() => ({ pages, chapters, first, last, label }), [chapters, first, label, last, pages])

  // 起始页优先使用服务端阅读进度，没有进度时从第一页开始
  const initialLeaf = useMemo(() => {
    const want = pageNo || book.progress?.currentPage || 1
    const idx = pages.findIndex((page) => page.no === want)
    const safe = idx < 0 ? 0 : idx
    return spread ? safe - (safe % 2) : safe
  }, [book.progress?.currentPage, pageNo, pages, spread])

  const [leaf, setLeaf] = useState(initialLeaf)
  const latestLeaf = useRef(leaf)
  latestLeaf.current = leaf
  const previousSpread = useRef(spread)
  const initialViewAligned = useRef(false)
  const pendingFlip = useRef(null)
  const [movementEvent, setMovementEvent] = useState({ sequence: 0, source: initialMovementSource || 'system_restore' })
  const [chrome, setChrome] = useState(true)
  const [toc, setToc] = useState(false)
  const [pane, setPane] = useState(false) // 阅读偏好小面板
  const [selection, setSelection] = useState(null)
  const [tray, setTray] = useState([])
  const [noteDraft, setNoteDraft] = useState(null)
  const [toast, setToast] = useState(null)
  const [jump, setJump] = useState('')
  const [minutes, setMinutes] = useState(0)
  const [aiOpen, setAiOpen] = useState(false)
  const [classHidden, setClassHidden] = useState(false) // 「课堂已结束」这条提示学生可以收起
  const broadcastSent = useRef(null)
  const broadcastReceiptPending = useRef(null)
  const classroom = useClassroomRuntime(book.classReading, workspaceId)

  const stageRef = useRef(null)
  const stageViewportRef = useRef(null)
  const flipRef = useRef(null)
  const traySeq = useRef(0)
  const [box, setBox] = useState({ w: 0, h: 0 })

  const visible = spread ? [leaf, leaf + 1].filter((i) => i < pages.length) : [leaf]
  const currentPage = pages[leaf]?.no || first
  const readRangeVersion = loadedByNumber.get(currentPage)?.readRangeVersion || null
  const visiblePageNos = visible.map((index) => pages[index]?.no).filter(Number.isSafeInteger)
  const stableView = useMemo(() => createStableView({
    layout: spread ? 'double' : 'single',
    pageNos: visiblePageNos,
  }), [spread, visiblePageNos.join(',')])
  const readPage = stableView.mainPageNo
  const readerReady = readerMode === 'original'
    ? pdf.status === 'ready'
    : pageResource.status === 'ready' && loadedPages.length > 0
  const monitor = useMemo(() => {
    if (!student?.id || !workspaceId) return null
    return {
      scope: {
        organizationId: student.organizationId || null,
        studentId: student.id,
        workspaceId,
      },
    }
  }, [student?.id, student?.organizationId, workspaceId])
  const telemetry = useReadingTelemetry({
    bookVersionId: book.versionId,
    stableView,
    movementEvent,
    workspaceId,
    readerMode,
    readerReady,
    monitor,
  })
  const session = classroom.data?.mode ? classroom.data : null
  const teacherMarks = Array.isArray(session?.teacherMarks) ? session.teacherMarks : []
  const excerptItems = library.excerpts.filter((item) => item.bookVersionId === book.versionId)
  const annotationItems = library.annotations.filter((item) => item.bookVersionId === book.versionId)
  const bookmarkItems = library.bookmarks.filter((item) => item.bookVersionId === book.versionId)
  const marksAll = {
    student: excerptItems.map((item) => ({ text: item.quoteText })),
    teacher: teacherMarks,
    notes: annotationItems.map((item) => ({ text: item.quoteText, note: item.body })),
    // 当前还在托盘里的选文由书页自己画成浅青蓝底色：
    // 抬手后 react-pageflip 会换掉整张书页的 DOM，浏览器原生选区会静默消失（已实测），
    // 不自己画就会变成「工具栏在、可是看不出选了哪段」；跨页多段也能同时标着。
    live: tray,
    // 刚选完的那一段额外带上 data-sel-now，供上面 selRect 量真实位置
    focus: selection ? [{ text: selection.text }] : [],
  }
  const bookmarks = bookmarkItems.map((item) => item.pageNo)

  // —— 课堂共读（规格 §8）——
  // 课堂状态只读取书架 DTO 中的服务端会话字段，不在前端切换或补造场景。
  const classBarOn = !!session && !(session.mode === 'ended' && classHidden)

  // —— 竹娃的受控状态（规格 §7.4 + Plan_6 §5 第六态）——
  // 优先级：这本书还在建索引 > 演示指定的异常 > 提问次数用完。
  // 任何一种状态下阅读、历史对话、批注与书签都照常，面板不会把人锁死。
  const safeMode = ai.safeMode
  const blocker = useMemo(() => {
    if (!readRangeVersion) return { key: 'page_scope_loading', tone: 'neutral', icon: 'Loader', title: '正在校验当前页', desc: '服务端正在返回当前页的已读范围版本。', stillCan: '等待期间仍可继续阅读、翻页和查看目录。' }
    if (ai.status === 'loading') return { key: 'loading', tone: 'neutral', icon: 'Loader', title: '正在加载 AI 会话', desc: '正在向服务端读取历史对话与额度。', stillCan: '等待期间仍可继续阅读、翻页、选文和查看目录。' }
    if (ai.status === 'error' || ai.error) return { key: 'offline', tone: 'warning', icon: 'WifiOff', title: 'AI 服务暂不可用', desc: ai.error?.message || '服务端没有返回对话数据。', stillCan: '仍可继续阅读、翻页、选文和查看目录。' }
    if (ai.quota.remaining === 0) return { key: 'quota', tone: 'warning', icon: 'Clock', title: '今天的提问次数已用完', desc: '恢复时间以服务端返回为准。', stillCan: '仍可继续阅读、翻页、选文和查看历史对话。' }
    return null
  }, [ai.error, ai.quota.remaining, ai.status, readRangeVersion])

  // —— 舞台测量与整页缩放 ——
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const r = e.contentRect
        setBox((p) => (Math.abs(p.w - r.width) > 1 || Math.abs(p.h - r.height) > 1 ? { w: r.width, h: r.height } : p))
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pageDesign = useMemo(() => readerMode === 'original' && pdf.width > 0 && pdf.height > 0
    ? { width: pdf.width, height: pdf.height }
    : PAGE_DESIGN, [pdf.height, pdf.width, readerMode])

  // 原版 PDF 的「大」档不是字号而是放大档：扫描件没有字号可调，
  // 而 D-19 证明按窗口高度铺满时汉字只有约 11 设备像素、低于可读下沿，
  // 唯一能真正变清的办法就是放大到超出舞台、纵向滚着读。
  // 文字模式是矢量字，不存在清晰度问题，所以不进这条分支，既有行为一字不改。
  const pdfZoomed = readerMode === 'original' && !spread

  const scale = useMemo(() => {
    if (box.w <= 0 || box.h <= 0) return 0
    const perPage = spread ? (box.w - 26) / 2 : box.w
    const widthLimit = perPage / pageDesign.width
    const k = Math.min(box.h / pageDesign.height, widthLimit)
    const fit = Math.max(0.4, Math.min(k, 2))
    if (pdfZoomed) return applyPdfZoom(fit, widthLimit)
    // 小字号故意留一点余白，视觉上更像手里捧着的书，不顶满屏
    const cap = prefs.fontScale === 'sm' ? 0.92 : 1
    return fit * cap
  }, [box, pageDesign, pdfZoomed, spread, prefs.fontScale])

  const pageW = Math.round(pageDesign.width * scale)
  const pageH = Math.round(pageDesign.height * scale)

  // 放大档翻页后必须回到页首，否则新的一页一上来就停在上一页的滚动位置。
  // 只动 scrollTop，不进 leaf/pageNo 链路，所以不影响计时与进度归属。
  useEffect(() => {
    const viewport = stageViewportRef.current
    if (viewport && viewport.scrollTop !== 0) viewport.scrollTop = 0
  }, [leaf])

  // —— 翻页 ——
  // 页数、尺寸、单双页变化都要给 HTMLFlipBook 换 key，否则库内部状态会错乱（旧站踩过）
  const flipKey = `srd-${bookId}-${readerMode}-${pageW}x${pageH}-${spread ? 'd' : 's'}-${prefs.flipStyle}`
  const curl = STUDENT_CURL_FLIP_ENABLED && prefs.flipStyle === 'curl' && !prefs.reduceMotion
  const flipBootstrap = useRef({ key: null, expectedLeaf: initialLeaf, pending: true })
  const bindFlipBook = useCallback((instance) => {
    if (!instance) {
      flipRef.current = null
      return
    }
    if (flipRef.current !== instance) {
      flipBootstrap.current = { key: flipKey, expectedLeaf: latestLeaf.current, pending: true }
    }
    flipRef.current = instance
  }, [flipKey])

  const commitLeaf = useCallback((nextLeaf, source) => {
    assertMovementSource(source)
    setLeaf(nextLeaf)
    setPageNo(pages[nextLeaf]?.no || nextLeaf + 1)
    setMovementEvent((current) => ({ sequence: current.sequence + 1, source }))
  }, [pages, setPageNo])

  useEffect(() => {
    if (initialViewAligned.current) return
    initialViewAligned.current = true
    const mainPageNo = pages[leaf]?.no || leaf + 1
    if (pageNo !== mainPageNo) commitLeaf(leaf, initialMovementSource || 'system_restore')
  }, [commitLeaf, initialMovementSource, leaf, pageNo, pages])

  // 换页不再重挂 ReaderView，URL ?pageNo= 只能通过 props 推进 leaf。
  const skipPagePropSync = useRef(true)
  useEffect(() => {
    if (skipPagePropSync.current) {
      skipPagePropSync.current = false
      return
    }
    const idx = pages.findIndex((page) => page.no === pageNo)
    if (idx < 0) return
    const aligned = spread ? idx - (idx % 2) : idx
    if (aligned === leaf) return
    commitLeaf(aligned, initialMovementSource || 'student_jump')
  }, [commitLeaf, initialMovementSource, leaf, pageNo, pages, spread])

  useEffect(() => {
    if (previousSpread.current === spread) return
    previousSpread.current = spread
    const currentNo = pages[leaf]?.no || pageNo
    const index = Math.max(0, pages.findIndex((page) => page.no === currentNo))
    const aligned = spread ? index - (index % 2) : index
    pendingFlip.current = null
    commitLeaf(aligned, 'layout_change')
  }, [commitLeaf, leaf, pageNo, pages, spread])

  const goTo = useCallback(
    (target, source) => {
      assertMovementSource(source)
      const max = pages.length - 1
      let t = Math.max(0, Math.min(max, target))
      if (spread) t -= t % 2
      if (t === leaf) return
      setSelection(null)
      window.getSelection?.()?.removeAllRanges()
      const api = flipRef.current?.pageFlip?.()
      if (curl && api) {
        try {
          pendingFlip.current = { target: t, source }
          api.flip(t)
          return
        } catch {
          /* 库内部状态异常时退回直接设页，绝不把学生卡在原地 */
        }
      }
      pendingFlip.current = null
      commitLeaf(t, source)
    },
    [commitLeaf, curl, leaf, pages, spread],
  )

  const prev = useCallback(() => goTo(leaf - step, 'student_adjacent'), [goTo, leaf, step])
  const next = useCallback(() => goTo(leaf + step, 'student_adjacent'), [goTo, leaf, step])
  const goPageNo = useCallback(
    (no, source) => {
      assertMovementSource(source)
      const idx = pages.findIndex((p) => p.no === Number(no))
      if (idx >= 0) goTo(idx, source)
    },
    [goTo, pages],
  )

  const canPrev = leaf > 0
  const canNext = leaf + step < pages.length

  // 课堂「同步页面」：进来先落到老师指定的那一页。
  // 之后不再每次翻页都拽回去——那样手一滑就被拉走，翻页会变得没法用；
  // 学生翻走了就在状态条上给一个「回到第 N 页」的按钮（规格只要求全班跟随教师翻页）。
  const syncPage = session?.mode === 'sync' && session.connected ? session.page : null
  useEffect(() => {
    if (syncPage) goPageNo(syncPage, 'teacher_sync')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncPage])

  // 教师课堂 AI 广播（规格 §8.3 第 5 条）：只广播同一条提问与同一条回复，
  // 到达时**强制展开**学生原有的竹娃面板，并在会话里标明教师身份。
  useEffect(() => {
    if (!session?.broadcast) return
    if (broadcastSent.current !== session.broadcast.id) {
      ai.pushBroadcast(session.broadcast, bookId)
      broadcastSent.current = session.broadcast.id
      setAiOpen(true)
      flash(`${session.teacher}向${AI_NAME}问了一个问题，回答已经发给全班`, 'Users')
    }
    if (!session.broadcast.received && broadcastReceiptPending.current !== session.broadcast.id) {
      broadcastReceiptPending.current = session.broadcast.id
      classroom.acknowledgeBroadcast(session.broadcast.id)
        .then(() => { broadcastReceiptPending.current = null })
        .catch(() => { broadcastReceiptPending.current = null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai, bookId, classroom, session])

  // 本次连续阅读时长：真实计时，不是假数字；口径说明挂在 title 上（§11.4）
  useEffect(() => {
    const t = window.setInterval(() => setMinutes((m) => m + 1), 60000)
    return () => window.clearInterval(t)
  }, [])

  // 键盘：左右翻页、Esc 退出选文与抽屉。桌面调试与无障碍都需要
  useEffect(() => {
    const onKey = (e) => {
      if (noteDraft) return
      // 面板打开时把左右键留给输入框，不然打字会一直翻页
      if (aiOpen) {
        if (e.key === 'Escape') setAiOpen(false)
        return
      }
      if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'Escape') {
        setSelection(null)
        setToc(false)
        setPane(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, noteDraft, aiOpen])

  const flash = useCallback((text, icon) => {
    setToast({ text, icon })
    window.setTimeout(() => setToast(null), 2200)
  }, [])
  const writingInput = (item, position) => {
    const range = item.selectionRange
    if (!range?.blockId || !Number.isInteger(range.startOffset) || !Number.isInteger(range.endOffset)) {
      throw new Error('当前选文跨段或缺少页内坐标，请只选同一段正文后再保存。')
    }
    return {
      bookVersionId: book.versionId,
      pageNo: item.page,
      blockId: range.blockId,
      charStart: range.startOffset,
      charEnd: range.endOffset,
      quoteText: item.text,
      position,
    }
  }

  // —— 手势：短拖翻页 / 长按进选文 / Ctrl+拖动（桌面调试）——
  const onSelectEnd = useCallback((sel) => {
    if (!sel) {
      setSelection(null)
      return
    }
    // 规格 §6.4：每完成一段选择就加入托盘并保留页码与原文，学生可以继续翻页再选
    traySeq.current += 1
    const item = {
      key: `t-${traySeq.current}`,
      text: sel.text,
      pages: sel.pages.length ? sel.pages : [],
      selections: sel.selections || [],
      selectedBlockIds: sel.selectedBlockIds || [],
      selectionRange: sel.selectionRange || null,
    }
    setTray((list) => (list.some((it) => it.text === item.text) ? list : [...list, item]))
    setSelection({ ...sel, key: item.key })
  }, [])

  const { mode } = useReaderGesture(stageRef, {
    onFlipPrev: prev,
    onFlipNext: next,
    onTap: () => {
      setSelection(null)
      setPane(false)
      setChrome((c) => !c)
    },
    onSelectStart: () => {
      setSelection(null)
      setPane(false)
    },
    onSelectEnd,
    // 批注弹层与竹娃面板打开时，手势整条让位：那两处都有输入框，
    // 长按状态机再插一脚会把输入体验搞坏（浮层控件本身另有 data-reader-ui 放行）
    enabled: readerReady && !noteDraft && !aiOpen,
    selectionEnabled: readerMode === 'text',
  })

  // 选文浮层（工具栏与首尾控制点）的位置：量正文里真实画出来的那一段（data-sel-now）。
  // 不能用抬手那一瞬的坐标：选文一完成托盘就从底部升上来，舞台变矮、整页重新缩放，
  // 旧坐标当场就过期（实测上下偏 19px、左右偏 35px，工具栏与控制点明显跑到其它行去了）。
  const [selRect, setSelRect] = useState(null)
  useLayoutEffect(() => {
    if (!selection) {
      setSelRect(null)
      return undefined
    }
    const stage = stageRef.current
    const measure = () => {
      const sr = stage?.getBoundingClientRect()
      if (!sr) return null
      // 只认落在舞台可视范围内的那份：react-pageflip 会在屏幕外留着书页副本，
      // 刚抬手那一帧往往只有副本在（实测量到 top≈2587，而真实那行在 top≈259），
      // 直接取最小值就会把浮层甩到屏幕外去。
      let l = Infinity
      let t = Infinity
      let r = -Infinity
      let b = -Infinity
      stage.querySelectorAll('[data-sel-now]').forEach((el) => {
        const q = el.getBoundingClientRect()
        if (q.bottom < sr.top - 8 || q.top > sr.bottom + 8) return
        if (q.right < sr.left - 8 || q.left > sr.right + 8) return
        l = Math.min(l, q.left)
        t = Math.min(t, q.top)
        r = Math.max(r, q.right)
        b = Math.max(b, q.bottom)
      })
      if (l === Infinity) return null
      // 浮层虽然写的是 position: fixed，但祖先带 backdrop-filter／翻页变换，
      // 它实际上是相对舞台定位的（实测 offsetParent 就是 .student-reader-stage），
      // 所以量到的视口坐标必须减掉舞台偏移，否则整体会往下偏一个顶栏高度。
      return {
        left: l - sr.left,
        top: t - sr.top,
        right: r - sr.left,
        bottom: b - sr.top,
        width: r - l,
        height: b - t,
      }
    }
    const toStage = (rect) => {
      const sr = stage?.getBoundingClientRect()
      if (!rect || !sr) return null
      return {
        left: rect.left - sr.left,
        top: rect.top - sr.top,
        right: rect.right - sr.left,
        bottom: rect.bottom - sr.top,
        width: rect.width,
        height: rect.height,
      }
    }

    // 书页 DOM 由 react-pageflip 重建、托盘升起又会让整页重新缩放，
    // 所以连续量几帧直到位置不再变，中途量不到就先沿用抬手时的坐标（跨页场景那页可能已翻走）。
    let raf = 0
    let tries = 0
    let prev = null
    const step = () => {
      const got = measure()
      if (got) {
        setSelRect(got)
        if (prev && Math.abs(got.top - prev.top) < 0.5 && Math.abs(got.left - prev.left) < 0.5) return
      } else if (!prev) {
        setSelRect(toStage(selection.rect))
      }
      prev = got
      tries += 1
      if (tries < 40) raf = window.requestAnimationFrame(step)
    }
    step()
    return () => window.cancelAnimationFrame(raf)
  }, [selection, tray.length, box.w, box.h, leaf, spread, chrome])

  // 竹娃的视线：素材第 9／10 行是 16 格方向表，这里把「选区中心相对竹娃站位」的角度算出来，
  // 让它真的看向学生选中的那一段。收叠状态用中性朝向（见 MascotDock）。
  const lookDegrees = useMemo(() => {
    if (!selRect || box.w <= 0) return null
    const dock = { x: box.w - 52, y: box.h * 0.6 } // 与 .student-mascot-dock 的站位一致
    const deg = (Math.atan2(selRect.top + selRect.height / 2 - dock.y, selRect.left + selRect.width / 2 - dock.x) * 180) / Math.PI
    return (deg + 360) % 360
  }, [selRect, box])

  // —— 选文工具栏四个动作（规格 §6.3）——
  const pageOfSel = (sel) => sel?.pages?.[0] || currentPage
  const clearSel = useCallback(
    (dropFromTray) => {
      if (dropFromTray && selection?.key) setTray((list) => list.filter((it) => it.key !== selection.key))
      setSelection(null)
      window.getSelection?.()?.removeAllRanges()
    },
    [selection],
  )

  // 单段「问竹娃」= 把这一段放进输入区并让竹娃探出（规格 §6.3：加入 AI 输入区）。
  // 刻意不直接弹面板：学生常常连选几段再一起问，这时候弹面板反而打断阅读。
  // 交出去之后要把它从托盘移除：不然同一段既躺在托盘里、又在输入区，
  // 托盘上的「问竹娃」还能把它再加一次（第一轮自检抓到）。
  const askOne = () => {
    if (!selection) return
    addAiQuotes([{
      bookId,
      title: book.title,
      page: pageOfSel(selection),
      text: selection.text,
      selections: selection.selections || [],
      selectedBlockIds: selection.selectedBlockIds || [],
      selectionRange: selection.selectionRange || null,
    }])
    flash(`已交给${AI_NAME} · 第 ${pageOfSel(selection)} 页`, 'Sparkles')
    clearSel(true)
  }
  const saveOne = async () => {
    if (!selection) return
    try {
      await library.createExcerpt(writingInput({
        page: pageOfSel(selection),
        text: selection.text,
        selectionRange: selection.selectionRange,
      }, excerptItems.length))
      telemetry.confirmInteraction('excerpt', [pageOfSel(selection)])
      flash(`已收藏摘录 · 第 ${pageOfSel(selection)} 页`, 'BookmarkCheck')
      clearSel(true)
    } catch (error) {
      flash(error?.message || '摘录没有保存成功，请稍后重试。', 'CloudOff')
    }
  }
  const noteOne = () => {
    if (!selection) return
    setNoteDraft({
      quote: selection.text,
      items: [{ page: pageOfSel(selection), text: selection.text, selectionRange: selection.selectionRange }],
      key: selection.key,
    })
  }

  // —— 托盘（跨页多段）——
  // 托盘上的「问竹娃」是学生已经攒够了、明确要问了，所以这里直接把面板打开
  const askAll = () => {
    if (!tray.length) return
    addAiQuotes(tray.map((it) => ({
      bookId,
      title: book.title,
      page: it.pages[0] || currentPage,
      text: it.text,
      selections: it.selections || [],
      selectedBlockIds: it.selectedBlockIds || [],
      selectionRange: it.selectionRange || null,
    })))
    flash(`已把 ${tray.length} 段带给${AI_NAME}`, 'Sparkles')
    setTray([])
    clearSel(false)
    setAiOpen(true)
  }
  const saveAll = async () => {
    if (!tray.length) return
    try {
      for (const [index, item] of tray.entries()) {
        await library.createExcerpt(writingInput({
          page: item.pages[0] || currentPage,
          text: item.text,
          selectionRange: item.selectionRange,
        }, excerptItems.length + index))
      }
      telemetry.confirmInteraction('excerpt', [...new Set(tray.flatMap((item) => item.pages))])
      flash(`已收藏 ${tray.length} 条摘录`, 'BookmarkCheck')
      setTray([])
      clearSel(false)
    } catch (error) {
      flash(error?.message || '摘录没有保存成功，请逐段重试。', 'CloudOff')
    }
  }
  const noteAll = () => {
    if (!tray.length) return
    setNoteDraft({
      quote: tray.map((it) => `第 ${it.pages.join('、')} 页：${it.text}`).join('\n'),
        items: tray.map((it) => ({ page: it.pages[0] || currentPage, text: it.text, selectionRange: it.selectionRange })),
      all: true,
    })
  }

  const saveNote = async (text) => {
    if (!text || !noteDraft?.items?.length) return
    try {
      for (const [index, item] of noteDraft.items.entries()) {
        const input = writingInput(item, annotationItems.length + index)
        await library.createAnnotation({ ...input, body: text, color: 'violet' })
      }
      telemetry.confirmInteraction('annotation', [...new Set(noteDraft.items.map((item) => item.page))])
      flash(`已保存 ${noteDraft.items.length} 条批注`, 'PenLine')
      setNoteDraft(null)
      setSelection(null)
      window.getSelection?.()?.removeAllRanges()
    } catch (error) {
      flash(error?.message || '批注没有保存成功，请稍后重试。', 'CloudOff')
    }
  }

  const toggleBookmark = async (no) => {
    const existing = bookmarkItems.find((item) => item.pageNo === no)
    try {
      if (existing) {
        await library.deleteBookmark(existing.id, existing.version)
        flash(`已移除第 ${no} 页书签`, 'BookmarkMinus')
      } else {
        await library.createBookmark({
          bookVersionId: book.versionId,
          pageNo: no,
          label: `第 ${no} 页`,
          position: bookmarkItems.length,
        })
        flash(`已添加第 ${no} 页书签`, 'BookmarkCheck')
      }
      telemetry.confirmInteraction('bookmark', [no])
    } catch (error) {
      flash(error?.message || '书签没有保存成功，请稍后重试。', 'CloudOff')
    }
  }

  const renderPage = (idx, live) => {
    const p = pages[idx]
    if (!p) return null
    if (readerMode === 'original') {
      return (
        <PdfBookPage
          key={`${book.versionId}-pdf-${p.no}`}
          document={pdf.document}
          documentError={pdf.error}
          pageNo={p.no}
          scale={scale}
          designWidth={pageDesign.width}
          designHeight={pageDesign.height}
          totalPages={totalPages}
          active={Math.abs(p.no - currentPage) <= 2}
          tone={prefs.paperTone}
          current={live}
          bookmarked={bookmarks.includes(p.no)}
          onToggleBookmark={toggleBookmark}
        />
      )
    }
    return (
      <BookPage
        key={`${book.versionId}-${p.no}`}
        page={p}
        scale={scale}
        totalPages={totalPages}
        tone={prefs.paperTone}
        current={live}
        bookmarked={bookmarks.includes(p.no)}
        onToggleBookmark={toggleBookmark}
        marks={marksAll}
      />
    )
  }

  return (
    <div
      className={cx(
        'student-reader',
        mode === 'select' && 'student-reader--selecting',
        // 面板不盖正文：让阅读器右侧留出面板宽度，舞台变窄后书页自己重新等比缩放，
        // 学生问问题的时候仍然看得见自己在读哪一页
        aiOpen && 'student-reader--ai',
        `student-reader--${readerMode}`,
      )}
    >
      {/* 课堂共读边缘光：蓝＝锁定书籍，紫＝同步页面，只在屏幕最外沿，不压正文（§8.1／§8.2） */}
      <ClassroomAura session={session} />

      {/* 顶栏：返回、书籍信息、正文范围、本次阅读时长、目录与阅读偏好。
          轻点正文可以整条收起，规格要求阅读器以正文为中心。 */}
      <header className={cx('student-reader-bar', !chrome && 'student-reader-bar--off')}>
        <button
          type="button"
          onClick={async () => {
            try {
              await telemetry.closeAndWait('reader_close')
            } finally {
              navigate(`/student/books/${bookId}`)
            }
          }}
          className="student-reader-btn"
          title="回到书籍详情"
        >
          <Icon name="ArrowLeft" className="h-4 w-4" />
          返回详情
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="truncate font-serif text-title font-bold text-ink-900">{book.title}</h1>
            <span className="shrink-0 text-micro text-ink-400">{book.author}</span>
          </div>
          <p className="truncate text-micro text-ink-400" title="正文、页码与章节均来自当前书籍版本的服务端接口">
            {label} · 覆盖第 {first}–{last} 页
          </p>
        </div>

        {sourcePdf && (
          <div className="student-reader-mode-switch" role="group" aria-label="阅读模式">
            {[
              { key: 'original', label: '原版 PDF' },
              { key: 'text', label: 'OCR 文字' },
            ].map((option) => (
              <button
                key={option.key}
                type="button"
                className={cx('student-reader-mode-button', readerMode === option.key && 'student-reader-mode-button--active')}
                aria-pressed={readerMode === option.key}
                onClick={() => {
                  if (readerMode === option.key) return
                  setSelection(null)
                  window.getSelection?.()?.removeAllRanges()
                  setReaderMode(option.key)
                  reportReaderPreference(option.key)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {readerMode === 'original' && pdf.status === 'error' && (
          <button type="button" onClick={pdf.reload} className="student-reader-btn" title="重新读取受保护的源 PDF">
            <Icon name="RotateCcw" className="h-4 w-4" />
            重试 PDF
          </button>
        )}

        {pageResource.status === 'error' && (
          <button type="button" onClick={pageResource.reload} className="student-reader-btn" title="重新读取当前正文页">
            <Icon name="RotateCcw" className="h-4 w-4" />
            重试正文
          </button>
        )}

        {telemetry.error && (
          <span className="student-reader-chip" role="alert" title={telemetry.error.message}>
            <Icon name="CloudOff" className="h-3.5 w-3.5" />
            {telemetry.error.code || '阅读记录待重试'}
          </span>
        )}

        <span
          className="student-reader-chip"
          title="本次连续阅读时长。长时间停在同一页且无操作不计入有效阅读。"
        >
          <Icon name="Timer" className="h-3.5 w-3.5 text-ink-400" strokeWidth={1.9} />
          {minutes > 0 ? `本次已读 ${minutes} 分钟` : '本次刚开始'}
        </span>

        {aiQuotes.length > 0 && (
          <button
            type="button"
            onClick={() => setAiOpen(true)}
            className="student-reader-chip student-reader-chip--mint"
            title={`已经放进输入区的原文，打开${AI_NAME}就会带上`}
            data-reader-ui=""
          >
            <Icon name="Sparkles" className="h-3.5 w-3.5" strokeWidth={2} />
            带着 {aiQuotes.length} 段问{AI_NAME}
          </button>
        )}

        <button type="button" onClick={() => setToc(true)} className="student-reader-btn" title="目录、书签、摘录与批注">
          <Icon name="List" className="h-4 w-4" />
          目录
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setPane((v) => !v)}
            aria-expanded={pane}
            className="student-reader-btn"
            title="纸张颜色与字号"
          >
            <Icon name="Settings2" className="h-4 w-4" />
            阅读偏好
          </button>
          {pane && <PrefPane prefs={prefs} setPref={setPref} onClose={() => setPane(false)} />}
        </div>
      </header>

      {/* 课堂状态条：颜色之外必须写清模式、控制教师与预计结束时间（§8.4、红线 12） */}
      {classBarOn && (
        <ClassroomBar
          session={session}
          teacherMark={session.mode === 'sync' ? teacherMarks.find((mark) => mark.page === session.page) : null}
          offPage={session.mode === 'sync' && !visible.some((i) => pages[i]?.no === session.page)}
          onBackToSyncPage={() => goPageNo(session.page, 'teacher_sync')}
          hasBroadcast={!!session.broadcast && !aiOpen}
          onOpenBroadcast={() => setAiOpen(true)}
          onJumpMark={(no) => goPageNo(no, 'student_jump')}
          onDismiss={() => setClassHidden(true)}
        />
      )}

      {/* 正文舞台 */}
      <div className="student-reader-stage" ref={stageRef}>
        {scale > 0 &&
          (curl ? (
            <div className="student-flip-shell" style={{ width: spread ? pageW * 2 : pageW, height: pageH }}>
              <HTMLFlipBook
                key={flipKey}
                ref={bindFlipBook}
                className="student-flip"
                width={pageW}
                height={pageH}
                size="fixed"
                minWidth={160}
                maxWidth={1400}
                minHeight={200}
                maxHeight={1800}
                maxShadowOpacity={0.36}
                drawShadow
                flippingTime={620}
                usePortrait={!spread}
                mobileScrollSupport={false}
                clickEventForward={false}
                // 手势完全由 useReaderGesture 接管，库不再自己猜拖拽，
                // 这是「翻页与长按选文不互相误触」的关键（§15.2 验收点）
                useMouseEvents={false}
                showCover={false}
                startPage={leaf}
                onInit={() => {
                  const bootstrap = flipBootstrap.current
                  const api = flipRef.current?.pageFlip?.()
                  if (api && api.getCurrentPageIndex() !== bootstrap.expectedLeaf) {
                    api.turnToPage(bootstrap.expectedLeaf)
                  }
                  bootstrap.pending = false
                }}
                onFlip={(e) => {
                  const nextLeaf = e?.data ?? 0
                  const bootstrap = flipBootstrap.current
                  const decision = reconcileFlipBootstrap({
                    expectedLeaf: bootstrap.expectedLeaf,
                    reportedLeaf: nextLeaf,
                    pending: bootstrap.pending,
                  })
                  if (!decision.accept) {
                    const api = flipRef.current?.pageFlip?.()
                    if (api && api.getCurrentPageIndex() !== decision.correctionLeaf) {
                      api.turnToPage(decision.correctionLeaf)
                    }
                    return
                  }
                  bootstrap.pending = decision.pending
                  const pending = pendingFlip.current
                  pendingFlip.current = null
                  commitLeaf(nextLeaf, pending?.target === nextLeaf ? pending.source : 'system_restore')
                }}
              >
                {pages.map((p, i) => renderPage(i, visible.includes(i)))}
              </HTMLFlipBook>
            </div>
          ) : (
            // 「平移」翻页偏好：同一套固定书页，只把过渡换成整页横向平移，
            // 减少动态效果开启时也走这条，不播三维翻页。
            // 外面那层滚动视口只在放大档生效（--zoom 才设 overflow），
            // 未放大时它没有任何 CSS，布局与页框尺寸与之前完全一致。
            <div
              ref={stageViewportRef}
              className={cx('student-stage-viewport', pdfZoomed && 'student-stage-viewport--zoom')}
            >
              <div className="student-slide-shell" style={{ width: spread ? pageW * 2 + 26 : pageW, height: pageH }}>
                {visible.map((i) => (
                  <div key={`${flipKey}-${i}`} className="student-slide-page">
                    {renderPage(i, true)}
                  </div>
                ))}
              </div>
            </div>
          ))}

        {/* 选文浮层：首尾控制点 + 四项工具栏（§6.2 第 4 条、§6.3） */}
        {readerMode === 'text' && <SelectionHandles rect={selRect} />}
        {readerMode === 'text' && (
          <SelectionToolbar
            rect={selRect}
            saved={!!selection && marksAll.student.some((h) => h.text === selection.text)}
            onAsk={askOne}
            onSave={saveOne}
            onNote={noteOne}
            onCancel={() => clearSel(true)}
          />
        )}

        {/* 竹娃收叠在书页边缘（§7.2）：点一下探出、再点打开面板、几秒不理自己退回。
            只在阅读器里出现，其它页面一律没有全局 AI 宠物（红线 6）。 */}
        <MascotDock
          onOpen={() => setAiOpen(true)}
          panelOpen={aiOpen}
          unread={ai.unread}
          quoteCount={aiQuotes.length}
          lookDegrees={lookDegrees}
          blockerKey={blocker?.key}
        />

        {/* 长按提示：只在还没有任何选区、也没攒托盘时露出，避免一直挂着干扰正文。
            出提示条（收藏成功、已交给竹娃…）时也让位——两者都是居中浮层，会互相压住。 */}
        {chrome && !selection && tray.length === 0 && !toast && (
          <div className={cx('student-reader-hint', mode === 'select' && 'student-reader-hint--on')}>
            <Icon name="Hand" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
            {mode === 'select'
              ? '移动手指扩展选区，抬手后选择要做什么'
              : readerMode === 'text'
                ? '横向拖动翻页 · 长按文字选段（电脑按住 Ctrl 拖动）'
                : '横向拖动翻页 · 原版模式保留 PDF 排版'}
          </div>
        )}
      </div>

      {/* 跨页多段选文托盘（§6.4） */}
      <div className={cx('student-tray-slot', !chrome && 'student-tray-slot--low')}>
        <SelectionTray
          items={tray}
          onJump={(no) => goPageNo(no, 'student_jump')}
          onRemove={(key) => {
            setTray((list) => list.filter((it) => it.key !== key))
            if (selection?.key === key) setSelection(null)
          }}
          onAskAll={askAll}
          onSaveAll={saveAll}
          onNoteAll={noteAll}
          onClear={() => {
            setTray([])
            clearSel(false)
          }}
        />
      </div>

      {/* 底栏只表达当前位置，不把最后停留页解释为完成度。 */}
      <footer className={cx('student-reader-foot', !chrome && 'student-reader-foot--off')}>
        <button type="button" onClick={prev} disabled={!canPrev} className="student-reader-btn">
          <Icon name="ChevronLeft" className="h-4 w-4" />
          上一页
        </button>

        <div className="min-w-0 flex-1 text-center text-caption font-semibold tabular-nums text-ink-600" aria-live="polite">
          第 {readPage} 页 / 共 {totalPages} 页
        </div>

        <form
          className="flex shrink-0 items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            const no = Number(jump)
            if (no >= first && no <= last) {
              goPageNo(no, 'student_jump')
              setJump('')
            } else {
              flash(`服务端页码范围为第 ${first}–${last} 页`, 'Info')
            }
          }}
        >
          <label className="text-micro text-ink-400" htmlFor="student-jump">
            跳到
          </label>
          <input
            id="student-jump"
            value={jump}
            onChange={(e) => setJump(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric"
            placeholder={`${first}`}
            className="student-jump-input tabular-nums"
            aria-label={`跳到指定页，可填 ${first} 到 ${last}`}
          />
          <button type="submit" className="student-reader-btn">
            去
          </button>
        </form>

        {/* 只在「上次读到的那一页不在眼前」时才提示回跳，
            否则正摊开着它还叫你回去，很奇怪 */}
        {book.progress?.currentPage > 0 && !visible.some((i) => pages[i]?.no === book.progress.currentPage) && pages.some((page) => page.no === book.progress.currentPage) && (
          <button type="button" onClick={() => goPageNo(book.progress.currentPage, 'restore_position')} className="student-reader-btn" title="回到上次读到的位置">
            <Icon name="RotateCcw" className="h-4 w-4" />
            上次第 {book.progress.currentPage} 页
          </button>
        )}

        <button type="button" onClick={next} disabled={!canNext} className="student-reader-btn">
          下一页
          <Icon name="ChevronRight" className="h-4 w-4" />
        </button>
      </footer>

      {toc && (
        <TocDrawer
          book={book}
          set={set}
          currentPage={currentPage}
          bookmarks={bookmarks}
          marks={marksAll}
          onGo={(no) => {
            goPageNo(no, 'student_jump')
            setToc(false)
          }}
          onClose={() => setToc(false)}
        />
      )}

      {/* 竹娃对话面板（§7.3／§7.4）：多会话、引文卡片、逐字呈现、额度与全部异常态 */}
      <AiPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        book={book}
        bookId={bookId}
        currentPageNo={currentPage}
        readRangeVersion={readRangeVersion}
        blocker={blocker}
        safeMode={safeMode}
        classroom={session}
        onConfirmedInteraction={(quotes) => telemetry.confirmInteraction('ai_submit', [...new Set([
          currentPage,
          ...quotes.flatMap((quote) => (quote.selections || []).map((item) => item.pageNo)),
        ])])}
        onJumpPage={(no) => {
          if (!pages.some((page) => page.no === Number(no))) {
            flash(`服务端页码范围为第 ${first}–${last} 页`, 'Info')
            return
          }
          goPageNo(no, 'student_jump')
        }}
      />

      {noteDraft && (
        <NoteComposer quote={noteDraft.quote} onSave={saveNote} onCancel={() => setNoteDraft(null)} />
      )}
      <ReaderToast toast={toast} />
    </div>
  )
}

// 阅读偏好小面板：规格 §11.6「阅读器字号、行距、纸张颜色作为独立阅读偏好保存」。
// 翻页效果（D-03）已隐藏：默认平移，curl 分支运行时不可达，只保留「减少动态效果」。
// 设置页在 Stage 6，但阅读器自己要能就地调，否则学生读到一半得跳出去改。
function PrefPane({ prefs, setPref, onClose }) {
  const rows = [
    {
      key: 'paperTone',
      label: '纸张颜色',
      hint: '护眼时选米黄，光线很强时选灰',
      options: [
        { k: 'warm', t: '暖白' },
        { k: 'cream', t: '米黄' },
        { k: 'gray', t: '浅灰' },
      ],
    },
    {
      key: 'fontScale',
      label: '字号',
      hint: '大字号只显示一页，页面排版本身固定不变',
      options: [
        { k: 'sm', t: '小' },
        { k: 'md', t: '中' },
        { k: 'lg', t: '大' },
      ],
    },
  ]
  return (
    <GlassPanel tone="float" className="student-pref-pane" role="dialog" aria-label="阅读偏好">
      <div className="flex items-center gap-2">
        <h2 className="font-serif text-title font-bold text-ink-900">阅读偏好</h2>
        <button type="button" onClick={onClose} className="ml-auto student-icon-btn" aria-label="关闭阅读偏好">
          <Icon name="X" className="h-4 w-4" />
        </button>
      </div>
      {rows.map((row) => (
        <div key={row.key} className="mt-3">
          <p className="text-caption font-semibold text-ink-700">{row.label}</p>
          <div className="student-segment mt-1.5 inline-flex rounded-full p-1">
            {row.options.map((o) => (
              <button
                key={o.k}
                type="button"
                onClick={() => setPref(row.key, o.k)}
                aria-pressed={prefs[row.key] === o.k}
                className={cx(
                  'rounded-full px-3 py-1.5 text-micro transition',
                  prefs[row.key] === o.k ? 'student-segment--on font-semibold text-ink-900' : 'text-ink-500 hover:text-ink-800',
                )}
              >
                {o.t}
              </button>
            ))}
          </div>
          <p className="mt-1 text-micro text-ink-400">{row.hint}</p>
        </div>
      ))}
      <label className="mt-4 flex items-center gap-2.5 border-t border-ink-100 pt-3">
        <input
          type="checkbox"
          checked={prefs.reduceMotion}
          onChange={() => setPref('reduceMotion', !prefs.reduceMotion)}
          className="h-4 w-4 accent-[#2FA38C]"
        />
        <span className="text-caption text-ink-700">减少动态效果</span>
      </label>
    </GlassPanel>
  )
}

// 目录抽屉：章节定位、服务端页码、我的书签、我的摘录与批注。
// 书签只标整页、摘录保留原文与页码，两者刻意分开列，不混成一个列表（§6.3）。
function TocDrawer({ book, set, currentPage, bookmarks, marks, onGo, onClose }) {
  const [tab, setTab] = useState('toc')
  const inRange = (no) => set.pages.some((p) => p.no === no)
  const tabs = [
    { k: 'toc', t: '目录', n: set.chapters.length },
    { k: 'mark', t: '书签', n: bookmarks.length },
    { k: 'hl', t: '摘录', n: marks.student.length },
    { k: 'note', t: '批注', n: marks.notes.length },
  ]
  return (
    <div className="student-modal-mask student-modal-mask--right" onClick={onClose}>
      <GlassPanel
        tone="float"
        className="student-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="目录与我的标记"
      >
        <div className="flex items-center gap-2">
          <h2 className="font-serif text-h3 font-bold text-ink-900">{book.title}</h2>
          <button type="button" onClick={onClose} className="ml-auto student-icon-btn" aria-label="关闭">
            <Icon name="X" className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-micro text-ink-400">
          {set.label} · 覆盖第 {set.first}–{set.last} 页，全书 {book.totalPages} 页
        </p>

        <div className="student-segment mt-3 inline-flex rounded-full p-1">
          {tabs.map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => setTab(t.k)}
              aria-pressed={tab === t.k}
              className={cx(
                'rounded-full px-3 py-1.5 text-micro transition',
                tab === t.k ? 'student-segment--on font-semibold text-ink-900' : 'text-ink-500 hover:text-ink-800',
              )}
            >
              {t.t}
              <span className="ml-1 tabular-nums opacity-60">{t.n}</span>
            </button>
          ))}
        </div>

        <div className="student-drawer-body">
          {tab === 'toc' && (
            <>
              {set.chapters.map((c) => (
                <button
                  key={c.title}
                  type="button"
                  onClick={() => onGo(c.from)}
                  className={cx('student-drawer-row', currentPage >= c.from && currentPage <= c.to && 'student-drawer-row--on')}
                >
                  <Icon name="BookOpen" className="h-4 w-4 shrink-0 text-ink-400" strokeWidth={1.9} />
                  <span className="min-w-0 flex-1 truncate text-left">{c.title}</span>
                  <span className="shrink-0 text-micro text-ink-400 tabular-nums">
                    {c.from}–{c.to} 页
                  </span>
                </button>
              ))}
              <p className="student-drawer-note">按页跳转</p>
              <div className="flex flex-wrap gap-1.5">
                {set.pages.map((p) => (
                  <button
                    key={p.no}
                    type="button"
                    onClick={() => onGo(p.no)}
                    className={cx('student-page-pill', p.no === currentPage && 'student-page-pill--on')}
                  >
                    {p.no}
                  </button>
                ))}
              </div>
            </>
          )}

          {tab === 'mark' &&
            (bookmarks.length ? (
              bookmarks.map((no) => (
                <button
                  key={no}
                  type="button"
                  disabled={!inRange(no)}
                  onClick={() => onGo(no)}
                  title={inRange(no) ? `跳到第 ${no} 页` : `第 ${no} 页不在当前服务端页码范围内`}
                  className={cx('student-drawer-row', no === currentPage && 'student-drawer-row--on')}
                >
                  <Icon name="Bookmark" className="h-4 w-4 shrink-0 text-[#3B77E8]" fill="currentColor" strokeWidth={0} />
                  <span className="min-w-0 flex-1 text-left tabular-nums">第 {no} 页</span>
                  {!inRange(no) && <span className="shrink-0 text-micro text-ink-400">不在当前页码范围内</span>}
                </button>
              ))
            ) : (
              <p className="student-drawer-empty">还没有书签。在书页右上角点一下折角，就能标记这一页。</p>
            ))}

          {tab === 'hl' &&
            (marks.student.length ? (
              marks.student.map((h) => (
                <button
                  key={h.key || h.text}
                  type="button"
                  disabled={!inRange(h.page)}
                  onClick={() => onGo(h.page)}
                  className="student-drawer-quote"
                >
                  <span className="student-drawer-quote-page tabular-nums">第 {h.page} 页</span>
                  <span className="student-mark-sel">{h.text}</span>
                </button>
              ))
            ) : (
              <p className="student-drawer-empty">还没有摘录。长按正文选一段，点「收藏摘录」就会出现在这里。</p>
            ))}

          {tab === 'note' &&
            (marks.notes.length ? (
              marks.notes.map((n) => (
                <button
                  key={n.key || n.text}
                  type="button"
                  disabled={!inRange(n.page)}
                  onClick={() => onGo(n.page)}
                  className="student-drawer-quote"
                >
                  <span className="student-drawer-quote-page tabular-nums">第 {n.page} 页</span>
                  <span className="student-mark-note">{n.text}</span>
                  <span className="mt-1 block text-caption text-ink-700">{n.note}</span>
                </button>
              ))
            ) : (
              <p className="student-drawer-empty">还没有批注。选一段文字点「添加批注」，可以写下自己想到的事。</p>
            ))}
        </div>

        {/* 教师标记单独说明：颜色之外必须有文字，学生要能分清哪段不是自己选的（§6.5） */}
        {marks.teacher.length > 0 && (
          <div className="student-drawer-teacher">
            <Icon name="UserCheck" className="h-4 w-4 shrink-0 text-[#8C7BE0]" strokeWidth={2.1} />
            <span>
              本书有 {marks.teacher.length} 处{marks.teacher[0].teacher}标记的原文，正文里用紫色上下线与教师图标显示。
            </span>
          </div>
        )}
      </GlassPanel>
    </div>
  )
}
