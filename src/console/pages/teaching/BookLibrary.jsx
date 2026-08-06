import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cx, Icon } from '../../../components/ui.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { EmptyState, IconBtn, SearchBox, StatusTag, SubHead, ViewToggle } from '../../components/Controls.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import useStage4ConsoleData from '../../state/useStage4ConsoleData.js'

function text(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function pageCount(book) {
  const value = Number(book?.progress?.totalPages)
  return Number.isFinite(value) && value > 0 ? value : null
}

function readingProgress(book) {
  const value = Number(book?.progress?.percent)
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null
}

export default function BookLibrary() {
  const { workspace, prefs, setPref } = useConsole()
  const navigate = useNavigate()
  const booksResource = useStage4ConsoleData('bookLibrary', { workspaceId: workspace?.id })
  const [keyword, setKeyword] = useState('')
  const view = prefs.viewMode || 'card'
  const all = Array.isArray(booksResource.data?.items) ? booksResource.data.items : []

  const rows = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase()
    if (!query) return all
    return all.filter((book) => {
      const title = text(book?.title, '').toLocaleLowerCase()
      const author = text(book?.author, '').toLocaleLowerCase()
      return title.includes(query) || author.includes(query)
    })
  }, [all, keyword])

  if (booksResource.status === 'loading') {
    return (
      <PagePanel title={`${workspace?.scopeLabel || '当前范围'} · 书库`} desc="正在从真实书目接口读取当前可见书籍。">
        <EmptyState icon="LoaderCircle" title="正在读取书库" desc="书目、封面和页数不会从前端演示数据回退。" />
      </PagePanel>
    )
  }

  if (booksResource.status !== 'ready') {
    return (
      <PagePanel title={`${workspace?.scopeLabel || '当前范围'} · 书库`} desc="书库仅展示当前工作空间有权读取的真实书目。">
        <EmptyState
          icon={booksResource.status === 'empty' ? 'BookX' : 'CloudOff'}
          title={booksResource.status === 'empty' ? '当前范围没有已发布书目' : '书库暂时无法读取'}
          desc={booksResource.error?.message || booksResource.reason?.message || '请检查当前工作空间权限或稍后重试。'}
        />
      </PagePanel>
    )
  }

  return (
    <PagePanel
      title={`${workspace?.scopeLabel || '当前范围'} · 书库`}
      desc={`共 ${all.length} 本当前可见的已发布书目，内容只来自真实 books API。`}
      toolbar={
        <>
          <SearchBox value={keyword} onChange={setKeyword} placeholder="搜索书名或作者" />
          <ViewToggle value={view} onChange={(value) => setPref('viewMode', value)} />
        </>
      }
    >
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_198px] gap-4">
        <div className="min-w-0">
          {rows.length === 0 ? (
            <EmptyState
              icon="BookX"
              title="没有符合条件的书目"
              desc={all.length ? '换一个书名或作者关键词再试。' : '当前工作空间还没有可阅读的已发布书目。'}
            />
          ) : view === 'card' ? (
            <div className="grid grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
              {rows.map((book) => (
                <BookCard
                  key={book.id}
                  data={book}
                  onOpen={() => navigate(`/console/teaching/books/${book.id}`)}
                  onRead={() => navigate(`/console/teaching/reader/${book.id}`)}
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
                    <th className="px-2 py-2.5 font-medium w-[88px]">页数</th>
                    <th className="px-2 py-2.5 font-medium w-[100px]">当前进度</th>
                    <th className="px-2 py-2.5 font-medium w-[112px]">素材用途</th>
                    <th className="px-2 py-2.5 font-medium w-[92px] text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((book) => {
                    const pages = pageCount(book)
                    const progress = readingProgress(book)
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
                              <span className="block text-[11px] text-ink-400 truncate">已发布</span>
                            </span>
                          </button>
                        </td>
                        <td className="px-2 py-2.5 text-[12px] text-ink-600 truncate">{text(book.author, '服务端未返回作者')}</td>
                        <td className="px-2 py-2.5 text-[12px] text-ink-600 tabular-nums">{pages === null ? '—' : `${pages} 页`}</td>
                        <td className="px-2 py-2.5 text-[12px] text-ink-600 tabular-nums">{progress === null ? '—' : `${progress}%`}</td>
                        <td className="px-2 py-2.5 text-[11.5px] text-ink-500 truncate">{text(book.usageLabel, '服务端未返回')}</td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center justify-end gap-0.5">
                            <IconBtn icon="BookOpen" title="教师阅读器" onClick={() => navigate(`/console/teaching/reader/${book.id}`)} />
                            <IconBtn icon="Info" title="书目详情" onClick={() => navigate(`/console/teaching/books/${book.id}`)} />
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
          <p className="text-[12px] text-ink-600 leading-relaxed">
            当前可按真实书名和作者搜索。分类、年级、导入管理与版本回滚没有已接入的服务端契约，因此不显示演示操作。
          </p>
          <p className="text-[11.5px] text-ink-500 leading-relaxed mt-4 pt-3 border-t border-ink-150/70">
            书目详情会展示服务端已返回的版本、页数、来源和用途信息；没有返回的字段保持为空，不用前端样例补齐。
          </p>
        </aside>
      </div>
    </PagePanel>
  )
}

function Cover({ data, compact = false }) {
  const url = typeof data?.cover?.url === 'string' && data.cover.url ? data.cover.url : null
  const style = url ? { backgroundImage: `url(${url})` } : undefined
  const classes = compact
    ? 'w-6 h-8 rounded-[3px] shrink-0 shadow-e1 bg-ink-300 bg-cover bg-center'
    : 'w-full aspect-[3/4] rounded-lg shadow-e2 relative overflow-hidden bg-ink-300 bg-cover bg-center'
  if (compact) return <span className={classes} style={style} aria-hidden="true" />
  return (
    <div className={classes} style={style}>
      <span className="console-sheen absolute inset-0" aria-hidden="true" />
      <span className="absolute left-0 top-0 bottom-0 w-[6px] bg-black/12" aria-hidden="true" />
      {!url && (
        <span className="absolute inset-x-2.5 top-4 text-white font-serif text-[13px] font-bold leading-snug text-center drop-shadow-sm">
          {text(data?.title, '服务端未返回书名')}
        </span>
      )}
    </div>
  )
}

function BookCard({ data, onOpen, onRead }) {
  const pages = pageCount(data)
  const progress = readingProgress(data)
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
        <StatusTag tone="success" dot>已发布</StatusTag>
        <span className="text-[11px] text-ink-400 tabular-nums">{pages === null ? '页数未返回' : `${pages} 页`}</span>
      </div>
      <p className="text-[11px] text-ink-400 tabular-nums mt-1">{progress === null ? '当前进度未返回' : `当前进度 ${progress}%`}</p>

      <div className="mt-2.5 pt-2 border-t border-ink-150/70 flex items-center gap-0.5">
        <IconBtn icon="BookOpen" title="教师阅读器" onClick={onRead} />
        <IconBtn icon="Info" title="书目详情" onClick={onOpen} />
        <div className="flex-1" />
        <Icon name="LockKeyhole" className="w-3.5 h-3.5 text-ink-300" aria-label="书目管理暂未开放" />
      </div>
    </GlassCard>
  )
}
