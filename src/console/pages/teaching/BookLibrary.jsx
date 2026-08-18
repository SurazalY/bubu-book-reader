import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cx } from '../../../components/ui.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Chip, EmptyState, IconBtn, SearchBox, StatusTag, SubHead, ViewToggle } from '../../components/Controls.jsx'
import { ConfirmModal } from '../../components/Overlay.jsx'
import { useProtectedAssetUrl } from '../../../shared/useProtectedAssetUrl.js'
import { useConsole } from '../../state/ConsoleContext.jsx'
import useBookWriteActions from '../../state/useBookWriteActions.js'
import useStage4ConsoleData from '../../state/useStage4ConsoleData.js'
import {
  LIBRARY_GRADE_FILTERS,
  LIBRARY_STATUS_FILTERS,
  bookGradeValue,
  bookPublishStatus,
  countLibraryBooks,
  filterLibraryBooks,
  DRAFT_BOOK_READER_HINT,
} from './bookLibraryFilters.js'
import { formatBookWriteError } from './bookManagement.js'

function text(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function pageCount(book) {
  const value = Number(book?.progress?.totalPages)
  return Number.isFinite(value) && value > 0 ? value : null
}

function statusMeta(book) {
  return bookPublishStatus(book) === 'draft'
    ? { label: '草稿', tone: 'warning' }
    : { label: '已发布', tone: 'success' }
}

export default function BookLibrary() {
  const { workspace, prefs, setPref } = useConsole()
  const navigate = useNavigate()
  const booksResource = useStage4ConsoleData('bookLibrary', { workspaceId: workspace?.id })
  const writes = useBookWriteActions(workspace?.id)
  const [keyword, setKeyword] = useState('')
  const [grade, setGrade] = useState('all')
  const [status, setStatus] = useState('all')
  const [ask, setAsk] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const view = prefs.viewMode || 'card'
  const all = Array.isArray(booksResource.data?.items) ? booksResource.data.items : []

  const rows = useMemo(
    () => filterLibraryBooks(all, { grade, status, query: keyword }),
    [all, grade, keyword, status],
  )

  const runPublishAction = async () => {
    if (!ask?.book?.id) return
    try {
      if (ask.action === 'unpublish') {
        await writes.unpublishBook(ask.book.id)
        setFeedback({ tone: 'success', message: `《${text(ask.book.title, '这本书')}》已下架，学生现在看不到。` })
      } else {
        await writes.publishBook(ask.book.id)
        setFeedback({ tone: 'success', message: `《${text(ask.book.title, '这本书')}》已重新发布。` })
      }
      setAsk(null)
      booksResource.reload()
    } catch (error) {
      setFeedback({ tone: 'danger', message: formatBookWriteError(error, ask.action) })
    }
  }

  if (booksResource.status === 'loading') {
    return (
      <PagePanel title={`${workspace?.scopeLabel || '当前范围'} · 书库`} desc="正在从真实书目接口读取当前可管理书籍。">
        <EmptyState icon="LoaderCircle" title="正在读取书库" desc="书目、封面和页数不会从前端演示数据回退。" />
      </PagePanel>
    )
  }

  if (booksResource.status !== 'ready') {
    return (
      <PagePanel title={`${workspace?.scopeLabel || '当前范围'} · 书库`} desc="书库展示当前工作空间有权管理的真实书目。">
        <EmptyState
          icon={booksResource.status === 'empty' ? 'BookX' : 'CloudOff'}
          title={booksResource.status === 'empty' ? '当前范围没有可管理书目' : '书库暂时无法读取'}
          desc={booksResource.error?.message || booksResource.reason?.message || '请检查当前工作空间权限或稍后重试。'}
        />
      </PagePanel>
    )
  }

  return (
    <PagePanel
      title={`${workspace?.scopeLabel || '当前范围'} · 书库`}
      desc={`共 ${all.length} 本可管理书目（含已发布与草稿），内容只来自真实 books API。`}
      toolbar={
        <>
          <SearchBox value={keyword} onChange={setKeyword} placeholder="搜索书名或作者" />
          <ViewToggle value={view} onChange={(value) => setPref('viewMode', value)} />
        </>
      }
    >
      {feedback && (
        <p
          role="alert"
          className={cx(
            'mb-3 text-[12.5px]',
            feedback.tone === 'success' ? 'text-success-700' : 'text-danger-700',
          )}
        >
          {feedback.message}
          {feedback.tone === 'danger' && ask && (
            <button type="button" className="ml-2 underline" onClick={runPublishAction}>
              重试
            </button>
          )}
        </p>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_198px] gap-4">
        <div className="min-w-0">
          {rows.length === 0 ? (
            <EmptyState
              icon="BookX"
              title="没有符合条件的书目"
              desc={all.length ? '换一个书名、作者、年级或发布状态再试。' : '当前工作空间还没有可管理的书目。'}
            />
          ) : view === 'card' ? (
            <div className="grid grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
              {rows.map((book) => (
                <BookCard
                  key={book.id}
                  data={book}
                  busy={writes.actionState.status === 'loading' && writes.actionState.bookId === book.id}
                  onOpen={() => navigate(`/console/teaching/books/${book.id}`)}
                  onRead={() => navigate(`/console/teaching/reader/${book.id}`)}
                  onUnpublish={() => setAsk({ action: 'unpublish', book })}
                  onPublish={() => setAsk({ action: 'publish', book })}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-ink-150 overflow-hidden bg-white/60">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-ink-50/70 text-[11.5px] text-ink-500">
                    <th className="px-3 py-2.5 font-medium">书目</th>
                    <th className="px-2 py-2.5 font-medium w-[132px]">作者</th>
                    <th className="px-2 py-2.5 font-medium w-[72px]">年级</th>
                    <th className="px-2 py-2.5 font-medium w-[88px]">页数</th>
                    <th className="px-2 py-2.5 font-medium w-[112px]">素材用途</th>
                    <th className="px-2 py-2.5 font-medium w-[108px] text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((book) => {
                    const pages = pageCount(book)
                    const publish = statusMeta(book)
                    const gradeValue = bookGradeValue(book)
                    const busy = writes.actionState.status === 'loading' && writes.actionState.bookId === book.id
                    return (
                      <tr key={book.id} className="border-t border-ink-150/70 hover:bg-white/70 transition">
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => navigate(`/console/teaching/books/${book.id}`)}
                            className="flex items-center gap-2.5 text-left group"
                          >
                            <Cover data={book} compact />
                            <span className="min-w-0">
                              <span className="block font-serif text-[13px] font-semibold text-ink-900 group-hover:text-brand-700 transition truncate">
                                {text(book.title, '服务端未返回书名')}
                              </span>
                              <StatusTag tone={publish.tone} dot>{publish.label}</StatusTag>
                            </span>
                          </button>
                        </td>
                        <td className="px-2 py-2.5 text-[12px] text-ink-600 truncate">{text(book.author, '服务端未返回作者')}</td>
                        <td className="px-2 py-2.5 text-[12px] text-ink-600 tabular-nums">
                          {gradeValue === null ? '未标注' : `${gradeValue} 年级`}
                        </td>
                        <td className="px-2 py-2.5 text-[12px] text-ink-600 tabular-nums">{pages === null ? '—' : `${pages} 页`}</td>
                        <td className="px-2 py-2.5 text-[11.5px] text-ink-500 truncate">{text(book.usageLabel, '服务端未返回')}</td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center justify-end gap-0.5">
                            <TeacherReaderButton book={book} onRead={() => navigate(`/console/teaching/reader/${book.id}`)} />
                            <IconBtn icon="Info" title="书目详情" onClick={() => navigate(`/console/teaching/books/${book.id}`)} />
                            {bookPublishStatus(book) === 'published' ? (
                              <IconBtn icon="Archive" title="下架" tone="danger" disabled={busy} onClick={() => setAsk({ action: 'unpublish', book })} />
                            ) : (
                              <IconBtn icon="Upload" title="重新发布" disabled={busy} onClick={() => setAsk({ action: 'publish', book })} />
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="xl:border-l xl:border-ink-150/70 xl:pl-4">
          <SubHead icon="Filter" title="筛选" />
          <p className="text-[12px] text-ink-600 leading-relaxed mb-2">按发布状态筛选</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {LIBRARY_STATUS_FILTERS.map((item) => (
              <Chip
                key={item.key}
                active={status === item.key}
                count={item.key === 'all' ? all.length : countLibraryBooks(all, (book) => bookPublishStatus(book) === item.key)}
                onClick={() => setStatus(item.key)}
              >
                {item.label}
              </Chip>
            ))}
          </div>
          <p className="text-[12px] text-ink-600 leading-relaxed mb-2">按适用年级筛选</p>
          <div className="flex flex-wrap gap-1.5">
            {LIBRARY_GRADE_FILTERS.filter((item) => (
              item.key !== 'unspecified'
              || countLibraryBooks(all, (book) => bookGradeValue(book) === null) > 0
            )).map((item) => (
              <Chip
                key={item.key}
                active={grade === item.key}
                count={
                  item.key === 'all'
                    ? all.length
                    : item.key === 'unspecified'
                      ? countLibraryBooks(all, (book) => bookGradeValue(book) === null)
                      : countLibraryBooks(all, (book) => bookGradeValue(book) === Number(item.key))
                }
                onClick={() => setGrade(item.key)}
              >
                {item.label}
              </Chip>
            ))}
          </div>
          <p className="text-[11.5px] text-ink-500 leading-relaxed mt-4 pt-3 border-t border-ink-150/70">
            年级来自书目投影的 grade 字段（1–6）。没有年级的书只出现在「全部年级」和「未标注年级」。下架与可见范围在卡片操作或书目详情里处理。
          </p>
        </aside>
      </div>

      <ConfirmModal
        open={Boolean(ask)}
        onClose={() => writes.actionState.status !== 'loading' && setAsk(null)}
        onConfirm={runPublishAction}
        title={ask?.action === 'unpublish' ? '确认下架这本书' : '确认重新发布'}
        desc={
          ask?.action === 'unpublish'
            ? `下架后，学生会立刻看不到《${text(ask?.book?.title, '这本书')}》。阅读安排不会被删除，但学生无法打开。之后可以重新发布。`
            : `重新发布后，当前可见范围内的学生将能看到《${text(ask?.book?.title, '这本书')}》。若质量闸门未通过，需要人工复核后才能发布。`
        }
        confirmText={
          writes.actionState.status === 'loading'
            ? '处理中…'
            : ask?.action === 'unpublish' ? '确认下架' : '确认发布'
        }
        tone={ask?.action === 'unpublish' ? 'danger' : 'primary'}
      />
    </PagePanel>
  )
}

function Cover({ data, compact = false }) {
  const { workspace } = useConsole()
  const url = typeof data?.cover?.url === 'string' && data.cover.url ? data.cover.url : null
  const { objectUrl, failed } = useProtectedAssetUrl(url, workspace?.id)
  const available = Boolean(objectUrl) && !failed
  const classes = compact
    ? 'w-6 h-8 rounded-[3px] shrink-0 shadow-e1 bg-ink-300 overflow-hidden relative'
    : 'w-full aspect-[3/4] rounded-lg shadow-e2 relative overflow-hidden bg-ink-300'
  if (compact) {
    return (
      <span className={classes} aria-hidden="true">
        {available && <img src={objectUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      </span>
    )
  }
  return (
    <div className={classes}>
      {available && <img src={objectUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      <span className="console-sheen absolute inset-0" aria-hidden="true" />
      <span className="absolute left-0 top-0 bottom-0 w-[6px] bg-black/12" aria-hidden="true" />
      {(!url || failed) && (
        <span className="absolute inset-x-2.5 top-4 text-white font-serif text-[13px] font-bold leading-snug text-center drop-shadow-sm">
          {text(data?.title, '服务端未返回书名')}
        </span>
      )}
    </div>
  )
}

function TeacherReaderButton({ book, onRead }) {
  if (bookPublishStatus(book) === 'published') {
    return <IconBtn icon="BookOpen" title="教师阅读器" onClick={onRead} />
  }
  return (
    <span title={DRAFT_BOOK_READER_HINT}>
      <IconBtn icon="BookOpen" title={DRAFT_BOOK_READER_HINT} disabled />
    </span>
  )
}

function BookCard({ data, busy, onOpen, onRead, onUnpublish, onPublish }) {
  const pages = pageCount(data)
  const publish = statusMeta(data)
  const gradeValue = bookGradeValue(data)
  return (
    <GlassCard className="p-3 flex flex-col hover:shadow-e2 transition duration-140">
      <button type="button" onClick={onOpen} className="text-left group">
        <div className="relative">
          <Cover data={data} />
          <span className="block h-1.5 mt-1 rounded-full bg-gradient-to-b from-ink-200/70 to-transparent" aria-hidden="true" />
        </div>
        <p className="text-[11.5px] text-ink-600 group-hover:text-brand-700 transition truncate mt-1.5">
          {text(data.author, '服务端未返回作者')}
        </p>
      </button>

      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
        <StatusTag tone={publish.tone} dot>{publish.label}</StatusTag>
        <span className="text-[11px] text-ink-400 tabular-nums">{pages === null ? '页数未返回' : `${pages} 页`}</span>
        {gradeValue !== null && (
          <span className="text-[11px] text-ink-400">{gradeValue} 年级</span>
        )}
      </div>
      <div className="mt-2.5 pt-2 border-t border-ink-150/70 flex items-center gap-0.5">
        <TeacherReaderButton book={data} onRead={onRead} />
        <IconBtn icon="Info" title="书目详情" onClick={onOpen} />
        <div className="flex-1" />
        {bookPublishStatus(data) === 'published' ? (
          <IconBtn icon="Archive" title="下架" tone="danger" disabled={busy} onClick={onUnpublish} />
        ) : (
          <IconBtn icon="Upload" title="重新发布" disabled={busy} onClick={onPublish} />
        )}
      </div>
    </GlassCard>
  )
}
