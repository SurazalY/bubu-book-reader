import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { cx, Icon } from '../../../components/ui.jsx'
import { useProtectedAssetUrl } from '../../../shared/useProtectedAssetUrl.js'
import { GlassPanel } from '../../components/Glass.jsx'
import { Btn, EmptyState, IconBtn, StatusTag } from '../../components/Controls.jsx'
import { ConfirmModal } from '../../components/Overlay.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import BookFlip from '../../components/BookFlip.jsx'
import useTeacherReaderRuntime from '../../state/useTeacherReaderRuntime.js'

// 教师阅读器：沿用学生端翻页结构（react-pageflip），比管理页更安静——
// 除了翻页本身不放任何循环动效。右上角是课堂同步，三个状态依次是：
// 未开始 → 已锁定书籍 → 正在同步页面（红底白字「结束同步」+ 三类人数 + 持续时间）。

export default function TeacherReader() {
  const { bookId } = useParams()
  const navigate = useNavigate()
  const runtime = useTeacherReaderRuntime(bookId)
  const book = runtime.book
  const pages = runtime.pages
  const coverUrl = typeof book?.cover?.url === 'string' && book.cover.url ? book.cover.url : null
  const { objectUrl: coverObjectUrl, failed: coverFailed } = useProtectedAssetUrl(coverUrl, runtime.workspaceId)
  const coverAvailable = Boolean(coverObjectUrl) && !coverFailed
  const [page, setPage] = useState(1)
  const [sync, setSync] = useState('off')
  const [seconds, setSeconds] = useState(0)
  const [askEnd, setAskEnd] = useState(false)
  const [tocOpen, setTocOpen] = useState(true)

  // 同步计时：只在「正在同步」时走，结束即停并归零
  const timer = useRef(null)
  useEffect(() => {
    if (sync !== 'syncing') {
      clearInterval(timer.current)
      return undefined
    }
    timer.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer.current)
  }, [sync])

  useEffect(() => {
    if (!runtime.classroom || runtime.classroom.mode === 'ended') setSync('off')
    else if (runtime.classroom.mode === 'sync') setSync('syncing')
    else setSync('locked')
  }, [runtime.classroom])

  useEffect(() => {
    if (runtime.classroom?.mode !== 'sync') return
    const syncedPage = Number(runtime.classroom.page ?? runtime.classroom.synced_page_no)
    if (Number.isInteger(syncedPage) && syncedPage > 0) setPage(syncedPage)
  }, [runtime.classroom?.mode, runtime.classroom?.page, runtime.classroom?.synced_page_no])

  if (runtime.status === 'loading') {
    return (
      <PagePanel title="教师阅读器" desc="正在读取这本书的书页。">
        <EmptyState icon="LoaderCircle" title="正在打开教师阅读器" desc="书页会在读取完成后显示。" />
      </PagePanel>
    )
  }

  if (runtime.status === 'error' || (book && pages.length === 0)) {
    return (
      <PagePanel title="读不到书页" desc="教师阅读器现在打不开这本书的内容。">
        <EmptyState
          icon="FileWarning"
          title="读不到这本书的书页"
          desc="这本书当前不可读取。请回到书库确认它仍已发布，以及是否已投放到本班。"
          action={
            <Btn tone="primary" icon="ArrowLeft" onClick={() => navigate('/console/teaching/books')}>
              回到书库
            </Btn>
          }
        />
      </PagePanel>
    )
  }

  if (!book) {
    return (
      <PagePanel title="书目不存在" desc="这本书可能已被删除，或不在当前工作空间的可见范围内。">
        <EmptyState
          icon="BookX"
          title="找不到这本书"
          desc="请回到书库重新选择，再用「教师阅读器」打开。"
          action={
            <Btn tone="primary" icon="ArrowLeft" onClick={() => navigate('/console/teaching/books')}>
              回到书库
            </Btn>
          }
        />
      </PagePanel>
    )
  }

  const total = pages.length
  const chapters = pages.filter((p) => p.heading)

  const endSync = async () => {
    await runtime.end()
    setSync('off')
    setSeconds(0)
    setAskEnd(false)
  }

  const changePage = (nextPage) => {
    setPage(nextPage)
    if (sync === 'syncing') runtime.syncPage(nextPage).catch(() => undefined)
  }

  const participantStats = runtime.classroom?.participants || { connected: 0, abnormal: 0, offline: 0 }

  return (
    <div className="console-enter flex flex-col h-full min-h-[560px]">
      {/* 顶部条：书名 + 页码 + 课堂同步 */}
      <GlassPanel tone="solid" className="console-page rounded-2xl px-4 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <IconBtn icon="ArrowLeft" title="返回书库" onClick={() => navigate('/console/teaching/books')} />
          <span
            className="w-6 h-8 rounded-[3px] shrink-0 shadow-e1 overflow-hidden bg-ink-200 relative"
            aria-hidden="true"
          >
            {coverAvailable && <img src={coverObjectUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          </span>
          <div className="min-w-0">
            <h1 className="font-serif text-[16px] font-bold text-ink-900 truncate">{book.title}</h1>
            <p className="text-[11.5px] text-ink-500 truncate">
              {book.author} · 教师阅读器 · 第 {page} / {total} 页
            </p>
          </div>

          <div className="flex-1" />
          <SyncControl
            state={sync}
            seconds={seconds}
            page={page}
            onLock={() => runtime.lock().catch(() => undefined)}
            onStart={() => runtime.syncPage(page).catch(() => undefined)}
            onUnlock={() => runtime.end().catch(() => undefined)}
            onEnd={() => setAskEnd(true)}
          />
        </div>

        {/* 同步中把参与情况摊开：正常 / 异常 / 掉线 三类人数 + 持续时间 */}
        {sync === 'syncing' && (
          <div className="mt-3 pt-3 border-t border-ink-150/70 flex items-center gap-4 flex-wrap">
            <PeopleStat tone="success" icon="Check" label="正常" value={participantStats.connected} />
            <PeopleStat tone="warning" icon="TriangleAlert" label="异常" value={participantStats.abnormal} />
            <PeopleStat tone="danger" icon="WifiOff" label="掉线" value={participantStats.offline} />
            <span className="text-[12px] text-ink-500">
              持续 <span className="font-semibold text-ink-800 tabular-nums">{fmt(seconds)}</span>
            </span>
            <div className="flex-1" />
            <p className="text-[11.5px] text-ink-500">课堂人数来自服务端最近心跳。</p>
          </div>
        )}
      </GlassPanel>

      {/* 阅读区：左目录 + 右翻页书 */}
      <div className="flex-1 min-h-0 mt-3 flex gap-3">
        {tocOpen && (
          <GlassPanel tone="sub" className="rounded-2xl w-[168px] h-full shrink-0 flex flex-col p-2.5">
            <div className="flex items-center gap-1.5 px-1 pb-2 mb-1 border-b border-ink-150/70">
              <Icon name="List" className="w-3.5 h-3.5 text-ink-500" strokeWidth={1.9} />
              <span className="text-[12px] font-semibold text-ink-700 flex-1">目录</span>
              <IconBtn icon="PanelLeftClose" title="收起目录" onClick={() => setTocOpen(false)} />
            </div>
            <ul className="flex-1 overflow-y-auto console-scroll space-y-0.5">
              {chapters.map((c) => {
                const on = page === c.index || (page > c.index && page < c.index + 2)
                return (
                  <li key={c.index}>
                    <button
                      type="button"
                      onClick={() => changePage(c.index)}
                      className={cx(
                        'w-full text-left px-2 py-1.5 rounded-lg text-[12px] transition',
                        on ? 'bg-white/85 text-brand-700 font-medium' : 'text-ink-600 hover:bg-white/60',
                      )}
                    >
                      <span className="block truncate">{c.heading}</span>
                      <span className="block text-[10.5px] text-ink-400 tabular-nums">第 {c.index} 页</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {sync === 'syncing' && (
              <p className="text-[10.5px] text-danger-600 px-1 pt-2 mt-1 border-t border-ink-150/70">
                同步中跳章会把全班一起带过去
              </p>
            )}
          </GlassPanel>
        )}

        <GlassPanel tone="solid" className="console-page rounded-2xl flex-1 min-w-0 flex flex-col p-3">
          {!tocOpen && (
            <div className="shrink-0 pb-2">
              <Btn size="sm" icon="PanelLeftOpen" onClick={() => setTocOpen(true)}>
                目录
              </Btn>
            </div>
          )}

          <BookFlip pages={pages} page={page} onPageChange={changePage} className="flex-1" minHeight={300} />

          {/* 底部翻页条：比管理页安静，只有必要控件 */}
          <div className="shrink-0 flex items-center gap-2 pt-2.5 mt-1 border-t border-ink-150/70">
            <IconBtn icon="ChevronLeft" title="上一页" disabled={page <= 1} onClick={() => changePage(page - 1)} />
            <IconBtn icon="ChevronRight" title="下一页" disabled={page >= total} onClick={() => changePage(page + 1)} />
            <span className="text-[11.5px] text-ink-500 tabular-nums ml-1">
              {page} / {total}
            </span>
            <div className="flex-1" />
            {sync === 'syncing' ? (
              <span className="text-[11.5px] text-danger-600 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-danger-500" />
                学生端已锁在第 {page} 页
              </span>
            ) : sync === 'locked' ? (
              <span className="text-[11.5px] text-brand-700">已锁定书籍：学生只能翻这本书，页码仍可自己控制</span>
            ) : (
              <span className="text-[11.5px] text-ink-400">未开始同步：学生端不受影响</span>
            )}
          </div>
        </GlassPanel>
      </div>

      <ConfirmModal
        open={askEnd}
        onClose={() => setAskEnd(false)}
        onConfirm={endSync}
        title="结束课堂同步"
        desc={`结束后学生端解锁，可以自由翻页与提问；本次同步持续 ${fmt(seconds)}，会记入这堂课的课堂记录。`}
        confirmText="结束同步"
        tone="danger"
      />
    </div>
  )
}

// 课堂同步控件：三状态依次推进，红底白字只出现在「正在同步」这一档
function SyncControl({ state, seconds, page, onLock, onStart, onUnlock, onEnd }) {
  if (state === 'off') {
    return (
      <div className="flex items-center gap-2">
        <StatusTag tone="muted" dot>
          未开始同步
        </StatusTag>
        <Btn icon="Lock" onClick={onLock}>
          锁定书籍
        </Btn>
      </div>
    )
  }

  if (state === 'locked') {
    return (
      <div className="flex items-center gap-2">
        <StatusTag tone="brand" dot>
          已锁定书籍
        </StatusTag>
        <Btn icon="Unlock" onClick={onUnlock}>
          解除锁定
        </Btn>
        <Btn tone="primary" icon="MonitorPlay" onClick={onStart}>
          同步页面
        </Btn>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full bg-danger-50 border border-danger-100 text-[11.5px] font-medium text-danger-700">
        <span className="w-1.5 h-1.5 rounded-full bg-danger-500" />
        正在同步第 {page} 页
      </span>
      <span className="text-[12px] text-ink-600 tabular-nums">{fmt(seconds)}</span>
      <button
        type="button"
        onClick={onEnd}
        className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-danger-600 text-white text-[12.5px] font-medium shadow-e1 hover:bg-danger-700 transition"
      >
        <Icon name="Square" className="w-3.5 h-3.5" strokeWidth={2.4} />
        结束同步
      </button>
    </div>
  )
}

const PEOPLE_TONE = {
  success: 'bg-success-50 text-success-700 border-success-100',
  warning: 'bg-warning-50 text-warning-700 border-warning-100',
  danger: 'bg-danger-50 text-danger-700 border-danger-100',
}

function PeopleStat({ tone, icon, label, value }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[12px] font-medium',
        PEOPLE_TONE[tone],
      )}
    >
      <Icon name={icon} className="w-3.5 h-3.5" strokeWidth={2} />
      {label}
      <span className="tabular-nums">{value} 人</span>
    </span>
  )
}

function fmt(s) {
  const h = String(Math.floor(s / 3600)).padStart(2, '0')
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const sec = String(s % 60).padStart(2, '0')
  return `${h}:${m}:${sec}`
}
