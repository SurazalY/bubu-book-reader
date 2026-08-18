import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cx } from '../../../components/ui.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Chip, EmptyState, IconBtn, SearchBox, StatusTag, SubHead, ViewToggle } from '../../components/Controls.jsx'
import { ConfirmModal } from '../../components/Overlay.jsx'
import { useProtectedAssetUrl } from '../../../shared/useProtectedAssetUrl.js'
import { useConsole } from '../../state/ConsoleContext.jsx'
import useBookVisibility from '../../state/useBookVisibility.js'
import useBookWriteActions from '../../state/useBookWriteActions.js'
import useStage4ConsoleData from '../../state/useStage4ConsoleData.js'
import {
  LIBRARY_GRADE_FILTERS,
  bookGradeValue,
  bookPublishStatus,
  countLibraryBooks,
  filterLibraryBooks,
} from './bookLibraryFilters.js'
import {
  CLASS_SHELF_EMPTY_MESSAGE,
  canManageClassShelf,
  classIdOfWorkspace,
  formatBookWriteError,
  isBookOnClassShelf,
} from './bookManagement.js'
import { ClassShelfEmptyHint, ClassTeacherCountBanner } from './BookVisibilityPanel.jsx'

function text(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function pageCount(book) {
  const value = Number(book?.progress?.totalPages)
  return Number.isFinite(value) && value > 0 ? value : null
}

export default function BookLibrary() {
  const { workspace, prefs, setPref } = useConsole()
  const navigate = useNavigate()
  const booksResource = useStage4ConsoleData('bookLibrary', { workspaceId: workspace?.id })
  const classId = classIdOfWorkspace(workspace)
  const manageShelf = canManageClassShelf(workspace)
  const shelf = useBookVisibility(workspace?.id, classId)
  const writes = useBookWriteActions(workspace?.id)
  const [keyword, setKeyword] = useState('')
  const [grade, setGrade] = useState('all')
  const [ask, setAsk] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const view = prefs.viewMode || 'card'
  const all = Array.isArray(booksResource.data?.items) ? booksResource.data.items : []
  const published = useMemo(
    () => all.filter((book) => bookPublishStatus(book) === 'published'),
    [all],
  )

  const rows = useMemo(
    () => filterLibraryBooks(published, { grade, status: 'published', query: keyword }),
    [grade, keyword, published],
  )
  const shelfItems = shelf.data?.items || []
  const teacherCount = writes.teacherCount ?? shelf.data?.teacherCount

  const runShelfAction = async () => {
    if (!ask?.book?.id || !classId) return
    try {
      if (ask.action === 'revoke') {
        const result = await writes.deleteClassShelfBook(classId, ask.book.id)
        writes.applyTeacherCount(result?.teacherCount)
        setFeedback({ tone: 'success', message: `《${text(ask.book.title, '这本书')}》已从本班撤下。其他班级不受影响。` })
      } else {
        const result = await writes.putClassShelfBook(classId, ask.book.id)
        writes.applyTeacherCount(result?.teacherCount)
        setFeedback({ tone: 'success', message: `《${text(ask.book.title, '这本书')}》已投放到本班。` })
      }
      setAsk(null)
      shelf.reload()
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

  if (booksResource.status !== 'ready' && booksResource.status !== 'empty') {
    return (
      <PagePanel title={`${workspace?.scopeLabel || '当前范围'} · 书库`} desc="书库展示当前工作空间有权管理的真实书目。">
        <EmptyState
          icon="CloudOff"
          title="书库暂时无法读取"
          desc={booksResource.error?.message || booksResource.reason?.message || '请检查当前工作空间权限或稍后重试。'}
        />
      </PagePanel>
    )
  }

  const emptyCatalog = published.length === 0
  const emptyShelf = manageShelf && shelf.status === 'ready' && shelfItems.length === 0

  return (
    <PagePanel
      title={`${workspace?.scopeLabel || '当前范围'} · 书库`}
      desc={
        manageShelf
          ? `共 ${published.length} 本已发布书目，可投放到本班。投放只影响本班。`
          : '当前工作空间不能管理班级书架或全局书库。'
      }
      toolbar={
        <>
          <SearchBox value={keyword} onChange={setKeyword} placeholder="搜索书名或作者" />
          <ViewToggle value={view} onChange={(value) => setPref('viewMode', value)} />
        </>
      }
    >
      {manageShelf && (
        <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
          <ClassTeacherCountBanner teacherCount={teacherCount} />
          {shelf.status === 'error' && (
            <p role="alert" className="text-[12.5px] text-danger-700">
              {shelf.error?.message || '本班书架暂时无法读取。'}
              <button type="button" className="ml-2 underline" onClick={shelf.reload}>重试</button>
            </p>
          )}
        </div>
      )}

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
            <button type="button" className="ml-2 underline" onClick={runShelfAction}>
              重试
            </button>
          )}
        </p>
      )}

      {(emptyCatalog || emptyShelf) && (
        <div className="mb-3">
          <ClassShelfEmptyHint className="py-8" />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_198px] gap-4">
        <div className="min-w-0">
          {rows.length === 0 && !emptyCatalog ? (
            <EmptyState
              icon="BookX"
              title="没有符合条件的书目"
              desc="换一个书名、作者或年级再试。"
            />
          ) : rows.length === 0 ? null : view === 'card' ? (
            <div className="grid grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
              {rows.map((book) => (
                <BookCard
                  key={book.id}
                  data={book}
                  onShelf={isBookOnClassShelf(shelfItems, book.id)}
                  canManage={manageShelf}
                  busy={writes.actionState.status === 'loading' && writes.actionState.bookId === book.id}
                  onOpen={() => navigate(`/console/teaching/books/${book.id}`)}
                  onRead={() => navigate(`/console/teaching/reader/${book.id}`)}
                  onRevoke={() => setAsk({ action: 'revoke', book })}
                  onGrant={() => setAsk({ action: 'grant', book })}
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
                    const gradeValue = bookGradeValue(book)
                    const busy = writes.actionState.status === 'loading' && writes.actionState.bookId === book.id
                    const onShelf = isBookOnClassShelf(shelfItems, book.id)
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
                              {manageShelf && (
                                <StatusTag tone={onShelf ? 'success' : 'warning'} dot>
                                  {onShelf ? '已投放本班' : '未投放本班'}
                                </StatusTag>
                              )}
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
                            <IconBtn icon="BookOpen" title="教师阅读器" onClick={() => navigate(`/console/teaching/reader/${book.id}`)} />
                            <IconBtn icon="Info" title="书目详情" onClick={() => navigate(`/console/teaching/books/${book.id}`)} />
                            {manageShelf && (onShelf ? (
                              <IconBtn icon="Archive" title="从本班撤下" tone="danger" disabled={busy} onClick={() => setAsk({ action: 'revoke', book })} />
                            ) : (
                              <IconBtn icon="Upload" title="投放本班" disabled={busy} onClick={() => setAsk({ action: 'grant', book })} />
                            ))}
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
          <p className="text-[12px] text-ink-600 leading-relaxed mb-2">按适用年级筛选</p>
          <div className="flex flex-wrap gap-1.5">
            {LIBRARY_GRADE_FILTERS.filter((item) => (
              item.key !== 'unspecified'
              || countLibraryBooks(published, (book) => bookGradeValue(book) === null) > 0
            )).map((item) => (
              <Chip
                key={item.key}
                active={grade === item.key}
                count={
                  item.key === 'all'
                    ? published.length
                    : item.key === 'unspecified'
                      ? countLibraryBooks(published, (book) => bookGradeValue(book) === null)
                      : countLibraryBooks(published, (book) => bookGradeValue(book) === Number(item.key))
                }
                onClick={() => setGrade(item.key)}
              >
                {item.label}
              </Chip>
            ))}
          </div>
          <p className="text-[11.5px] text-ink-500 leading-relaxed mt-4 pt-3 border-t border-ink-150/70">
            年级来自书目投影的 grade 字段（1–6）。没有年级的书只出现在「全部年级」和「未标注年级」。教师只能把已发布图书投放到本班或从本班撤下。
          </p>
        </aside>
      </div>

      <ConfirmModal
        open={Boolean(ask)}
        onClose={() => writes.actionState.status !== 'loading' && setAsk(null)}
        onConfirm={runShelfAction}
        title={ask?.action === 'revoke' ? '确认从本班撤下' : '确认投放到本班'}
        desc={
          ask?.action === 'revoke'
            ? `撤下后，本班学生将无法新打开《${text(ask?.book?.title, '这本书')}》。其他班级不受影响。阅读安排不会被删除。`
            : `投放后，本班学生可以看到《${text(ask?.book?.title, '这本书')}》。只影响本班，不会改变书库发布状态。`
        }
        confirmText={
          writes.actionState.status === 'loading'
            ? '处理中…'
            : ask?.action === 'revoke' ? '确认撤下' : '确认投放'
        }
        tone={ask?.action === 'revoke' ? 'danger' : 'primary'}
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

function BookCard({ data, onShelf, canManage, busy, onOpen, onRead, onRevoke, onGrant }) {
  const pages = pageCount(data)
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
        {canManage && (
          <StatusTag tone={onShelf ? 'success' : 'warning'} dot>{onShelf ? '已投放本班' : '未投放本班'}</StatusTag>
        )}
        <span className="text-[11px] text-ink-400 tabular-nums">{pages === null ? '页数未返回' : `${pages} 页`}</span>
        {gradeValue !== null && (
          <span className="text-[11px] text-ink-400">{gradeValue} 年级</span>
        )}
      </div>
      <div className="mt-2.5 pt-2 border-t border-ink-150/70 flex items-center gap-0.5">
        <IconBtn icon="BookOpen" title="教师阅读器" onClick={onRead} />
        <IconBtn icon="Info" title="书目详情" onClick={onOpen} />
        <div className="flex-1" />
        {canManage && (onShelf ? (
          <IconBtn icon="Archive" title="从本班撤下" tone="danger" disabled={busy} onClick={onRevoke} />
        ) : (
          <IconBtn icon="Upload" title="投放本班" disabled={busy} onClick={onGrant} />
        ))}
      </div>
    </GlassCard>
  )
}
