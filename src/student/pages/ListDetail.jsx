import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BookCover, cx, Icon } from '../../components/ui.jsx'
import { GlassPanel } from '../components/Glass.jsx'
import BookCard from '../components/BookCard.jsx'
import PageHead from '../components/PageHead.jsx'
import { useStudent } from '../state/StudentContext.jsx'
import usePersonalReadingAdapter from '../state/usePersonalReadingAdapter.js'

// 书单详情（规格 §5.2）：
// - 系统书单只读，页面上直接说明它是怎么自动来的；
// - 自定义书单可以批量加书（搜索 + 学科分类 + 勾选）、单本移出、改名、删除；
// - 同一本书可以在好几个书单里，加书面板会把「已经在别的书单里」也标出来。
const SUBJECTS = ['全部', '语文', '科学', '道德与法治']

export default function ListDetail() {
  const { listId } = useParams()
  const { runtime } = useStudent()
  const { books: shelfBooks, bookMap, library, me, systemLists, systemListBooks } = usePersonalReadingAdapter({
    workspaceId: runtime.data?.workspaceId,
    books: runtime.data?.books || [],
  })
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const [subject, setSubject] = useState('全部')
  const [checked, setChecked] = useState(() => new Set())

  const system = systemLists.find((list) => list.id === listId)
  const custom = me.getCustomList(listId)

  // 「我喜欢的书」要读学生现在的爱心状态，不能读书库里那份初始值
  const books = useMemo(() => {
    if (system) return systemListBooks(system)
    if (custom) return custom.bookIds.map((bookId) => bookMap.get(bookId)).filter(Boolean)
    return []
  }, [bookMap, custom, system, systemListBooks])

  const candidates = useMemo(() => {
    const inList = new Set(custom?.bookIds || [])
    const k = query.trim().toLowerCase()
    return shelfBooks.filter((book) => !inList.has(book.id))
      .filter((b) => subject === '全部' || b.subject === subject)
      .filter((b) => !k || b.title.toLowerCase().includes(k) || b.author.toLowerCase().includes(k))
  }, [custom, query, shelfBooks, subject])

  if (!system && !custom) {
    return (
      <div className="flex-1 space-y-4">
        <PageHead back="/student/lists" backLabel="返回全部书单" title="找不到这个书单" desc="它可能已经被删掉了。" />
        <GlassPanel tone="solid" className="student-enter rounded-2xl px-6 py-12 text-center">
          <p className="text-title font-semibold text-ink-800">这个书单不在了</p>
          <p className="mt-1.5 text-caption text-ink-500">删除会同步到真实书单；书籍和阅读记录不会受影响。</p>
          <Link
            to="/student/lists"
            className="mt-4 inline-block rounded-full border border-white/70 bg-white/75 px-4 py-2 text-caption font-semibold text-ink-700 transition hover:bg-white"
          >
            回到全部书单
          </Link>
        </GlassPanel>
      </div>
    )
  }

  const name = system ? system.name : custom.name
  const toggleCheck = (id) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex-1 space-y-4">
      <PageHead
        back="/student/lists"
        backLabel="返回全部书单"
        title={name}
        desc={
          system
            ? system.id === 'liked'
              ? '点过爱心的书会自动进来，取消爱心就会离开。这个书单删不掉。'
              : system.id === 'recent'
                ? '产生过有效阅读的书会自动排进来，不用自己整理。这个书单删不掉。'
                : '书架中的可读书籍会自动列在这里，不能手动删掉。'
            : '这里的书可以同时在别的书单里；把书移出书单不会删掉书，也不影响阅读记录。'
        }
      >
        {!system && (
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            className="student-btn-primary inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-caption font-semibold"
          >
            <Icon name={picking ? 'X' : 'Plus'} className="h-4 w-4" strokeWidth={2.4} />
            {picking ? '收起挑书' : '批量加书'}
          </button>
        )}
      </PageHead>

      <GlassPanel tone="solid" className="student-enter flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl px-6 py-4">
        <span className="text-caption text-ink-600 tabular-nums">
          共 <b className="text-ink-900">{books.length}</b> 本
        </span>
        <span className="ml-auto text-micro text-ink-400">
          {system ? '系统书单，内容自动更新' : '自己建的书单，顺序按加入先后'}
        </span>
      </GlassPanel>

      {/* 批量加书：搜索 + 学科分类 + 勾选 */}
      {picking && custom && (
        <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="student-search flex min-w-[240px] flex-1 items-center gap-2 rounded-full px-4 py-2.5">
              <Icon name="Search" className="h-4 w-4 shrink-0 text-ink-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜书名或作者"
                aria-label="搜索要加进书单的书"
                className="min-w-0 flex-1 bg-transparent text-caption text-ink-900 outline-none placeholder:text-ink-300"
              />
            </div>
            <div className="student-segment inline-flex rounded-full p-1">
              {SUBJECTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSubject(s)}
                  aria-pressed={subject === s}
                  className={cx(
                    'rounded-full px-3.5 py-1.5 text-micro transition',
                    subject === s ? 'student-segment--on font-semibold text-ink-900' : 'text-ink-500 hover:text-ink-800',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {candidates.length ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {candidates.map((b) => {
                const on = checked.has(b.id)
                const others = me.listsOfBook(b.id)
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => toggleCheck(b.id)}
                    aria-pressed={on}
                    className={cx('student-pickbook flex items-center gap-3', on && 'student-pickbook--on')}
                  >
                    <BookCover book={b} className="w-[38px] shrink-0 rounded shadow-e1" />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-caption font-semibold text-ink-900">{b.title}</span>
                      <span className="mt-0.5 block truncate text-micro text-ink-400">
                        {b.author}
                        {others.length > 0 && ` · 已在 ${others.length} 个书单里`}
                      </span>
                    </span>
                    {/* 勾选状态同时给图标与文字，不只靠底色 */}
                    <span className={cx('shrink-0 text-micro font-semibold', on ? 'text-[#2C8B76]' : 'text-ink-300')}>
                      {on ? '已选' : '选它'}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="mt-4 rounded-xl bg-white/58 px-4 py-6 text-center text-caption text-ink-500">
              没有符合条件的书。换个词或者把学科切回「全部」看看。
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-caption text-ink-500 tabular-nums">已经选了 {checked.size} 本</span>
            <div className="ml-auto flex gap-2.5">
              <button
                type="button"
                onClick={() => setChecked(new Set())}
                disabled={!checked.size}
                className="rounded-full border border-white/70 bg-white/72 px-5 py-2 text-caption font-semibold text-ink-700 transition hover:bg-white disabled:opacity-55"
              >
                清空选择
              </button>
              <button
                type="button"
                onClick={async () => {
                  const added = await me.addBooksToList(custom.id, [...checked])
                  if (added !== null) {
                    setChecked(new Set())
                    setPicking(false)
                  }
                }}
                disabled={!checked.size || library.saving}
                className="student-btn-primary rounded-full px-5 py-2 text-caption font-semibold"
              >
                加入这 {checked.size} 本
              </button>
            </div>
          </div>
        </GlassPanel>
      )}

      {books.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {books.map((b, i) => (
            // h-full + mt-auto：有班级共读的卡更高，不贴底的话同一行的「移出」会高低不齐
            <div key={b.id} className="student-stagger flex h-full flex-col gap-2" style={{ '--i': i }}>
              <BookCard book={b} />
              {/* 「移出」放卡片下面，不叠在封面的收藏与下载状态上。 */}
              {custom && (
                <button
                  type="button"
                  onClick={() => void me.toggleInList(custom.id, b.id)}
                  disabled={library.saving}
                  title={`把《${b.title}》移出这个书单`}
                  className="mt-auto inline-flex items-center justify-center gap-1 rounded-full border border-white/70 bg-white/72 px-3 py-1.5 text-micro font-semibold text-ink-600 transition hover:bg-white hover:text-ink-900"
                >
                  <Icon name="Minus" className="h-3 w-3" strokeWidth={2.4} />
                  移出这个书单
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <GlassPanel tone="solid" className="student-enter flex flex-1 flex-col items-center justify-center rounded-2xl px-6 py-14 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-white/72 text-ink-300">
            <Icon name="BookPlus" className="h-6 w-6" strokeWidth={1.8} />
          </span>
          <p className="mt-3 text-title font-semibold text-ink-800">这个书单还是空的</p>
          <p className="mt-1.5 text-caption text-ink-500">
            {system ? '等你读过或下载过书，它就会自己填满。' : '点右上角「批量加书」，一次挑好几本进来。'}
          </p>
          <Link
            to="/student/shelf"
            className="mt-4 rounded-full border border-white/70 bg-white/75 px-4 py-2 text-caption font-semibold text-ink-700 transition hover:bg-white"
          >
            去书架看看
          </Link>
        </GlassPanel>
      )}
    </div>
  )
}
