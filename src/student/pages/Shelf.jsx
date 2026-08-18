import { useMemo, useState } from 'react'
import { cx, Icon } from '../../components/ui.jsx'
import { GlassPanel } from '../components/Glass.jsx'
import BookCard from '../components/BookCard.jsx'
import { useStudent } from '../state/StudentContext.jsx'
import useRefreshStudentRuntimeOnMount from '../state/useRefreshStudentRuntimeOnMount.js'
import { SHELF_FILTERS, filterShelfBooks, findFilterOption } from './shelfFilters.js'

// 书架（规格 §5.1）：保留底部一级导航，内容区左侧可折叠筛选，右侧书籍与搜索。
// 学生能在书架看到的书都可以阅读，未开放的书根本不出现在数据里（不做「无权限」灰卡）。
// 切换筛选时右侧用交错出现 + 位置过渡，不整页生硬刷新。
export default function Shelf() {
  useRefreshStudentRuntimeOnMount()
  const { shelfView, patchShelfView, runtime } = useStudent()
  const books = runtime.data?.books || []
  const { group, option, query, railOpen } = shelfView
  const [openGroups, setOpenGroups] = useState(() => ({ class: true, grade: true, subject: false, teacher: false }))

  const { option: active } = findFilterOption(group, option)

  const result = useMemo(
    () => filterShelfBooks(books, { group, option, query }),
    [books, group, option, query],
  )

  return (
    <div className="flex min-h-full flex-1 gap-4 pb-2">
      {/* 左侧折叠筛选 */}
      <aside
        className={cx(
          'student-rail-panel shrink-0 transition-[width] duration-220',
          railOpen ? 'w-[210px]' : 'w-[58px]',
        )}
      >
        <GlassPanel tone="card" className="student-enter sticky top-0 rounded-xl p-2.5">
          <button
            type="button"
            onClick={() => patchShelfView({ railOpen: !railOpen })}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-caption font-semibold text-ink-600 transition hover:bg-white/70"
            aria-expanded={railOpen}
          >
            <Icon name={railOpen ? 'PanelLeftClose' : 'PanelLeftOpen'} className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} />
            {railOpen && <span>筛选</span>}
          </button>

          <div className="mt-1 space-y-0.5">
            {SHELF_FILTERS.map((g) => {
              const single = g.options.length === 1
              const isOn = group === g.key
              const expanded = single ? false : openGroups[g.key]
              return (
                <div key={g.key}>
                  <button
                    type="button"
                    title={!railOpen ? g.label : undefined}
                    onClick={() => {
                      if (single) {
                        patchShelfView({ group: g.key, option: g.options[0].key })
                        return
                      }
                      if (!railOpen) patchShelfView({ railOpen: true })
                      setOpenGroups((s) => ({ ...s, [g.key]: !s[g.key] }))
                    }}
                    className={cx(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-caption transition',
                      isOn && single ? 'student-filter--on font-semibold text-ink-900' : 'text-ink-600 hover:bg-white/70',
                    )}
                  >
                    <Icon name={g.icon} className="h-[17px] w-[17px] shrink-0 text-ink-400" strokeWidth={1.9} />
                    {railOpen && (
                      <>
                        <span className="truncate">{g.label}</span>
                        {!single && (
                          <Icon
                            name="ChevronDown"
                            className={cx('ml-auto h-4 w-4 shrink-0 text-ink-300 transition', expanded && 'rotate-180')}
                          />
                        )}
                        {isOn && single && <Icon name="Check" className="ml-auto h-4 w-4 text-[#2FA38C]" strokeWidth={2.4} />}
                      </>
                    )}
                  </button>

                  {railOpen && expanded && (
                    <div className="mb-1 mt-0.5 space-y-0.5 pl-[27px]">
                      {g.options.map((o) => {
                        const on = group === g.key && option === o.key
                        const count = books.filter(o.match).length
                        return (
                          <button
                            key={o.key}
                            type="button"
                            onClick={() => patchShelfView({ group: g.key, option: o.key })}
                            className={cx(
                              'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-caption transition',
                              on ? 'student-filter--on font-semibold text-ink-900' : 'text-ink-500 hover:bg-white/70',
                            )}
                          >
                            <span className="truncate">{o.label}</span>
                            <span className="ml-auto text-micro text-ink-300 tabular-nums">{count}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </GlassPanel>
      </aside>

      {/* 右侧书籍 */}
      <section className="flex min-w-0 flex-1 flex-col">
        <GlassPanel tone="card" className="student-enter flex items-center gap-3 rounded-xl px-3.5 py-3">
          <label className="student-search flex min-w-0 flex-1 items-center gap-2.5 rounded-full px-3.5 py-2">
            <Icon name="Search" className="h-[17px] w-[17px] shrink-0 text-ink-400" strokeWidth={2} />
            <input
              value={query}
              onChange={(e) => patchShelfView({ query: e.target.value })}
              placeholder="搜书名、作者或学科"
              className="min-w-0 flex-1 bg-transparent text-caption text-ink-800 placeholder:text-ink-300 focus:outline-none"
              aria-label="搜索书架"
            />
            {query && (
              <button
                type="button"
                onClick={() => patchShelfView({ query: '' })}
                aria-label="清空搜索"
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
              >
                <Icon name="X" className="h-3.5 w-3.5" strokeWidth={2.4} />
              </button>
            )}
          </label>
          <p className="shrink-0 text-micro text-ink-500">
            <span className="font-semibold text-ink-800 tabular-nums">{result.length}</span> 本 · {active.label}
          </p>
        </GlassPanel>

        {result.length > 0 ? (
          <>
            <div
              key={`${group}-${option}`}
              className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
            >
              {result.map((book, i) => (
                <BookCard key={book.id} book={book} index={i} />
              ))}
            </div>
            {/* 筛到只剩几本时，右侧下方会露出大片背景（Kimi 反例），
                给一条真实信息的尾巴把版面收住，并给一个回到全部的去处 */}
            {result.length < 5 && (
              <GlassPanel
                tone="card"
                className="student-enter mt-3 flex items-center gap-3 rounded-xl px-4 py-3.5"
              >
                <Icon name="Info" className="h-[18px] w-[18px] shrink-0 text-ink-400" strokeWidth={1.9} />
                <p className="min-w-0 text-caption text-ink-500">
                  {active.label}目前只有 {result.length} 本，老师安排新的书之后会出现在这里。
                </p>
                <button
                  type="button"
                  onClick={() => patchShelfView({ group: 'all', option: 'all', query: '' })}
                  className="ml-auto shrink-0 rounded-full border border-white/70 bg-white/75 px-3.5 py-2 text-caption font-semibold text-ink-700 transition hover:bg-white"
                >
                  看全部 {books.length} 本
                </button>
              </GlassPanel>
            )}
          </>
        ) : (
          <GlassPanel tone="card" className="student-enter mt-3 flex flex-1 flex-col items-center justify-center rounded-xl px-6 py-12 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white/70 text-ink-300">
              <Icon name="SearchX" className="h-6 w-6" strokeWidth={1.8} />
            </span>
            <p className="mt-3 text-title font-semibold text-ink-800">
              {query ? `没有找到和「${query.trim()}」有关的书` : '这个分类下暂时没有书'}
            </p>
            <p className="mt-1.5 text-caption text-ink-500">
              {query ? '换个书名或作者试试，也可以清空搜索看全部。' : '老师安排新的书之后会出现在这里。'}
            </p>
            {(query || group !== 'all') && (
              <button
                type="button"
                onClick={() => patchShelfView({ group: 'all', option: 'all', query: '' })}
                className="mt-4 rounded-full border border-white/70 bg-white/75 px-4 py-2 text-caption font-semibold text-ink-700 transition hover:bg-white"
              >
                看全部书籍
              </button>
            )}
          </GlassPanel>
        )}
      </section>
    </div>
  )
}
