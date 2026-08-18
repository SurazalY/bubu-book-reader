import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookCover, cx, Icon } from '../../components/ui.jsx'
import { GlassPanel } from '../components/Glass.jsx'
import PageHead from '../components/PageHead.jsx'
import { useStudent } from '../state/StudentContext.jsx'
import usePersonalReadingAdapter from '../state/usePersonalReadingAdapter.js'

// 我的摘录与书签（规格 §10.6）。
// 三类内容按书聚合，但**分开呈现**：
//   摘录 = 我从正文里收藏的原句（保留原文、书籍、页码）；
//   批注 = 我在某一句旁边写的话；
//   书签 = 整页标记。
// 它们不混成一个列表——学生找「我抄过的那句话」和找「我读到哪一页」是两件事。
const TABS = [
  { key: 'highlights', label: '摘录', icon: 'Highlighter' },
  { key: 'notes', label: '批注', icon: 'MessageSquareQuote' },
  { key: 'bookmarks', label: '书签', icon: 'Bookmark' },
]

export default function Highlights() {
  const { runtime } = useStudent()
  const { bookMap, library } = usePersonalReadingAdapter({
    workspaceId: runtime.data?.workspaceId,
    books: runtime.data?.books || [],
  })
  const [tab, setTab] = useState('highlights')

  const groups = useMemo(() => {
    const items = tab === 'highlights'
      ? library.excerpts
      : tab === 'notes'
        ? library.annotations
        : library.bookmarks
    const byBook = items.reduce((current, item) => {
      if (!item.bookId) return current
      const list = current.get(item.bookId) || []
      list.push(item)
      current.set(item.bookId, list)
      return current
    }, new Map())
    return [...byBook.entries()]
      .map(([bookId, list]) => ({
        book: bookMap.get(bookId) || { id: bookId, title: list[0]?.title || '服务端未返回书名', author: '服务端未返回作者', genre: '整书阅读' },
        bookId,
        list,
      }))
      .filter((g) => g.book && g.list.length)
  }, [bookMap, library.annotations, library.bookmarks, library.excerpts, tab])

  const counts = {
    highlights: library.excerpts.length,
    notes: library.annotations.length,
    bookmarks: library.bookmarks.length,
  }

  return (
    <div className="flex-1 space-y-4">
      <PageHead
        title="我的摘录与书签"
        desc="在阅读器里长按选中一段就能收藏摘录或写批注；点书页右上角折角就是加书签。"
      >
        <div className="student-segment inline-flex rounded-full p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={cx(
                'flex items-center gap-1.5 rounded-full px-4 py-2 text-caption transition',
                tab === t.key ? 'student-segment--on font-semibold text-ink-900' : 'text-ink-500 hover:text-ink-800',
              )}
            >
              <Icon name={t.icon} className="h-4 w-4" />
              {t.label}
              <span className="tabular-nums opacity-70">{counts[t.key]}</span>
            </button>
          ))}
        </div>
      </PageHead>

      {groups.length ? (
        groups.map((g, gi) => (
          <GlassPanel key={g.bookId} tone="solid" className="student-enter rounded-2xl p-6">
            <div className="flex items-center gap-3.5">
              <BookCover book={g.book} className="w-[44px] shrink-0 rounded-md shadow-e1" />
              <div className="min-w-0 flex-1">
                <Link
                  to={`/student/books/${g.bookId}`}
                  className="block truncate font-serif text-h3 font-bold text-ink-900 hover:underline"
                >
                  {g.book.title}
                </Link>
                <p className="mt-0.5 truncate text-micro text-ink-400">
                  {g.book.author}
                  <span className="mx-1.5 text-ink-300">·</span>
                  {tab === 'bookmarks' ? `${g.list.length} 个书签` : `${g.list.length} 条`}
                </p>
              </div>
              <Link
                to={`/student/reader/${g.bookId}`}
                className="shrink-0 rounded-full border border-white/70 bg-white/72 px-4 py-2 text-caption font-semibold text-ink-700 transition hover:bg-white"
              >
                继续读这本
              </Link>
            </div>

            {tab === 'bookmarks' ? (
              // 书签按书聚合成一排页码，点一下直接翻过去
              <div className="mt-4 flex flex-wrap gap-2">
                {[...g.list]
                  .sort((a, b) => a.pageNo - b.pageNo)
                  .map((item, i) => (
                    <Link
                      key={item.id}
                      to={`/student/reader/${g.bookId}?pageNo=${item.pageNo}`}
                      className="student-stagger inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3.5 py-2 text-caption text-ink-700 transition hover:bg-white"
                      style={{ '--i': i }}
                    >
                      <Icon name="Bookmark" className="h-3.5 w-3.5 text-[#3B77E8]" strokeWidth={2} />
                      <span className="tabular-nums">第 {item.pageNo} 页</span>
                    </Link>
                  ))}
              </div>
            ) : (
              <ul className="mt-4 space-y-2.5">
                {g.list.map((item, i) => (
                  <li
                    key={item.key || `${g.bookId}-${i}`}
                    className="student-stagger rounded-xl bg-white/62 px-4 py-3.5"
                    style={{ '--i': i }}
                  >
                    <p className="student-quote-text font-serif text-body leading-loose text-ink-900">
                      「{item.quoteText}」
                    </p>
                    {tab === 'notes' && item.body && (
                      <p className="mt-2 rounded-lg bg-white/72 px-3.5 py-2.5 text-caption leading-relaxed text-ink-700">
                        <Icon name="PenLine" className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px text-ink-400" />
                        {item.body}
                      </p>
                    )}
                    <div className="mt-2.5 flex flex-wrap items-center gap-3">
                      <span className="text-micro text-ink-400 tabular-nums">第 {item.pageNo} 页</span>
                      <Link
                        to={`/student/reader/${g.bookId}?pageNo=${item.pageNo}`}
                        className="text-micro font-semibold text-ink-600 hover:text-ink-900"
                      >
                        去看这一页
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>
        ))
      ) : (
        <GlassPanel tone="solid" className="student-enter flex flex-1 flex-col items-center justify-center rounded-2xl px-6 py-14 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-white/72 text-ink-300">
            <Icon name={TABS.find((t) => t.key === tab).icon} className="h-6 w-6" strokeWidth={1.8} />
          </span>
          <p className="mt-3 text-title font-semibold text-ink-800">
            {tab === 'highlights' ? '还没有收藏过原文' : tab === 'notes' ? '还没有写过批注' : '还没有加过书签'}
          </p>
          <p className="mt-1.5 max-w-[46ch] text-caption leading-relaxed text-ink-500">
            {tab === 'bookmarks'
              ? '在阅读器里点书页右上角的折角，就能把这一页记下来。'
              : '在阅读器里长按一段文字，工具栏里就能收藏摘录或者写批注。'}
          </p>
          <Link
            to="/student/shelf"
            className="mt-4 rounded-full border border-white/70 bg-white/75 px-4 py-2 text-caption font-semibold text-ink-700 transition hover:bg-white"
          >
            去书架挑一本
          </Link>
        </GlassPanel>
      )}
    </div>
  )
}
