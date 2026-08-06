import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BookCover, cx, Icon } from '../../components/ui.jsx'
import { GlassCard, GlassPanel } from '../components/Glass.jsx'
import PageHead from '../components/PageHead.jsx'
import { useStudent } from '../state/StudentContext.jsx'
import usePersonalReadingAdapter, { formatMinutes } from '../state/usePersonalReadingAdapter.js'

// 全部书单（规格 §5.2）：
// - 三个系统书单「我喜欢的书／最近阅读／本地下载」由系统自动维护，不能删也不能手动加书；
// - 自定义书单可以建、改名、调顺序、删除，删掉的进「最近删除」还能恢复；
// - 删书单不会删掉书，也不会影响阅读进度、书签和摘录。
export default function Lists() {
  const { runtime } = useStudent()
  const { bookMap, library, me, systemLists, systemListBooks } = usePersonalReadingAdapter({
    workspaceId: runtime.data?.workspaceId,
    books: runtime.data?.books || [],
  })
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState('')
  const [renameText, setRenameText] = useState('')
  const [confirmDel, setConfirmDel] = useState(null)

  const submitCreate = async () => {
    if (!name.trim()) return
    const created = await me.createList(name)
    if (created) {
      setName('')
      setCreating(false)
    }
  }

  return (
    <div className="flex-1 space-y-4">
      <PageHead title="我的书单" desc="书可以同时放进好几个书单；删掉书单不会删掉书，阅读记录也都还在。">
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="student-btn-primary inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-caption font-semibold"
        >
          <Icon name="Plus" className="h-4 w-4" strokeWidth={2.4} />
          新建书单
        </button>
      </PageHead>

      {me.flash && (
        <div className="student-enter flex items-center justify-between gap-3 rounded-xl bg-white/82 px-4 py-3">
          <span className="flex items-center gap-2 text-caption text-ink-700">
            <Icon name={me.flash.tone === 'error' ? 'AlertCircle' : 'Check'} className="h-4 w-4 text-[#2C8B76]" />
            {me.flash.text}
          </span>
          <button type="button" onClick={me.dismissFlash} className="text-micro text-ink-400 hover:text-ink-700">
            知道了
          </button>
        </div>
      )}

      {creating && (
        <GlassPanel tone="solid" className="student-enter rounded-2xl p-5">
          <label className="text-caption font-semibold text-ink-700" htmlFor="new-list">
            给新书单起个名字
          </label>
          <div className="mt-2.5 flex flex-wrap gap-2.5">
            <input
              id="new-list"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitCreate()}
              placeholder="比如「想读给妹妹听」"
              className="min-w-[220px] flex-1 rounded-full border border-white/70 bg-white/86 px-4 py-2.5 text-caption text-ink-900 outline-none placeholder:text-ink-300"
            />
            <button
              type="button"
              onClick={submitCreate}
              disabled={!name.trim()}
              className="student-btn-primary rounded-full px-5 py-2.5 text-caption font-semibold"
            >
              建好了
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-full border border-white/70 bg-white/72 px-5 py-2.5 text-caption font-semibold text-ink-700 transition hover:bg-white"
            >
              取消
            </button>
          </div>
        </GlassPanel>
      )}

      {/* 系统书单：只读，说明它们是自动维护的 */}
      <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-serif text-h3 font-bold text-ink-900">系统书单</h2>
          <span className="text-micro text-ink-400">这三个由系统自动整理，不能删也不用自己加书</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {systemLists.map((l, i) => {
            const books = systemListBooks(l)
            return (
              <Link key={l.id} to={`/student/lists/${l.id}`} className="student-stagger" style={{ '--i': i }}>
                <GlassCard className="student-list-tile flex h-full flex-col px-4 py-3.5">
                  <span className="flex items-center gap-2">
                    <Icon name={l.icon} className="h-4 w-4 text-ink-500" strokeWidth={1.9} />
                    <span className="font-serif text-title font-bold text-ink-900">{l.name}</span>
                    <span className="ml-auto text-micro text-ink-400 tabular-nums">{books.length} 本</span>
                  </span>
                  <Covers books={books} />
                </GlassCard>
              </Link>
            )
          })}
        </div>
      </GlassPanel>

      {/* 自定义书单 */}
      <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-serif text-h3 font-bold text-ink-900">我自己建的</h2>
          <span className="text-micro text-ink-400 tabular-nums">{me.lists.length} 个，顺序可以自己调</span>
        </div>

        {me.lists.length ? (
          <ul className="mt-4 space-y-2.5">
            {me.lists.map((l, i) => {
              const books = l.bookIds.map((bookId) => bookMap.get(bookId)).filter(Boolean)
              const minutes = books.reduce((s, b) => s + b.minutes, 0)
              return (
                <li key={l.id} className="student-stagger" style={{ '--i': i }}>
                  <div className="rounded-xl bg-white/62 px-4 py-3.5">
                    {renaming === l.id ? (
                      <div className="flex flex-wrap gap-2.5">
                        <input
                          value={renameText}
                          onChange={(e) => setRenameText(e.target.value)}
                          aria-label="书单新名字"
                          className="min-w-[200px] flex-1 rounded-full border border-white/70 bg-white/90 px-4 py-2 text-caption text-ink-900 outline-none"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            const renamed = await me.renameList(l.id, renameText)
                            if (renamed) setRenaming('')
                          }}
                          className="student-btn-primary rounded-full px-4 py-2 text-caption font-semibold"
                        >
                          改好了
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenaming('')}
                          className="rounded-full px-4 py-2 text-caption text-ink-500 hover:text-ink-900"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-3">
                        <Link to={`/student/lists/${l.id}`} className="min-w-0 flex-1">
                          <span className="block truncate font-serif text-title font-bold text-ink-900">{l.name}</span>
                          <span className="mt-0.5 block text-micro text-ink-400 tabular-nums">
                            {books.length} 本
                            <span className="mx-1.5 text-ink-300">·</span>
                            已读 {formatMinutes(minutes, { zero: '0 分钟' })}
                          </span>
                        </Link>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <IconBtn
                            title="往上移"
                            icon="ChevronUp"
                            disabled={i === 0}
                            onClick={() => void me.moveList(l.id, -1)}
                          />
                          <IconBtn
                            title="往下移"
                            icon="ChevronDown"
                            disabled={i === me.lists.length - 1}
                            onClick={() => void me.moveList(l.id, 1)}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setRenaming(l.id)
                              setRenameText(l.name)
                            }}
                            className="student-mini-btn"
                          >
                            <Icon name="Pencil" className="h-3.5 w-3.5" strokeWidth={2} />
                            改名
                          </button>
                          <button type="button" onClick={() => setConfirmDel(l)} className="student-mini-btn">
                            <Icon name="Trash2" className="h-3.5 w-3.5" strokeWidth={2} />
                            删除
                          </button>
                          <Link to={`/student/lists/${l.id}`} className="student-mini-btn">
                            <Icon name="Plus" className="h-3.5 w-3.5" strokeWidth={2} />
                            加书
                          </Link>
                        </div>
                      </div>
                    )}
                    <Covers books={books} />
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="mt-4 rounded-xl bg-white/58 px-6 py-10 text-center">
            <p className="text-title font-semibold text-ink-800">还没有自己建的书单</p>
            <p className="mt-1.5 text-caption text-ink-500">想把几本书放一起的时候，新建一个就好。</p>
          </div>
        )}
      </GlassPanel>

      {/* 最近删除：删掉的书单还能拿回来 */}
      {me.trash.length > 0 && (
        <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
          <h2 className="font-serif text-h3 font-bold text-ink-900">最近删除</h2>
          <p className="mt-1.5 text-caption text-ink-500">删掉的书单先放在这里，点一下就能拿回来。书本身从来没被删过。</p>
          <ul className="mt-3.5 space-y-2">
            {me.trash.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-white/58 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-caption font-semibold text-ink-800">{l.name}</span>
                  <span className="mt-0.5 block text-micro text-ink-400 tabular-nums">
                    {l.bookIds.length} 本 · 删除于 {l.deletedAt}
                  </span>
                </span>
                <button type="button" onClick={() => me.restoreList(l.id)} className="student-mini-btn">
                  <Icon name="Undo2" className="h-3.5 w-3.5" strokeWidth={2} />
                  恢复
                </button>
              </li>
            ))}
          </ul>
        </GlassPanel>
      )}

      {confirmDel && (
        <div className="student-modal-mask fixed inset-0 z-40 grid place-items-center bg-ink-900/24 px-6">
          <GlassPanel tone="float" className="student-modal student-dialog w-full max-w-[460px] rounded-2xl p-6">
            <h2 className="font-serif text-h3 font-bold text-ink-900">删掉书单「{confirmDel.name}」？</h2>
            <p className="mt-2 text-caption leading-relaxed text-ink-600">
              里面的 {confirmDel.bookIds.length} 本书不会被删，你的阅读进度、书签和摘录也都在。
              删除会立即同步到你的真实书单；书籍、阅读进度、书签和摘录都不会受影响。
            </p>
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDel(null)}
                className="rounded-full border border-white/70 bg-white/72 px-5 py-2 text-caption font-semibold text-ink-700 transition hover:bg-white"
              >
                不删了
              </button>
              <button
                type="button"
                onClick={async () => {
                  const deleted = await me.deleteList(confirmDel.id)
                  if (deleted) setConfirmDel(null)
                }}
                disabled={library.saving}
                className="student-btn-primary rounded-full px-5 py-2 text-caption font-semibold"
              >
                删除书单
              </button>
            </div>
          </GlassPanel>
        </div>
      )}
    </div>
  )
}

function Covers({ books }) {
  if (!books.length) {
    return <p className="mt-3 text-micro text-ink-400">还没有书，点「加书」挑几本进来。</p>
  }
  return (
    <span className="mt-3 flex items-center">
      {books.slice(0, 5).map((b, i) => (
        <BookCover
          key={b.id}
          book={b}
          className={cx('w-[34px] shrink-0 rounded shadow-e1', i > 0 && '-ml-[14px]')}
        />
      ))}
      {books.length > 5 && <span className="ml-2.5 text-micro text-ink-400 tabular-nums">还有 {books.length - 5} 本</span>}
    </span>
  )
}

function IconBtn({ title, icon, onClick, disabled }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="grid h-7 w-7 place-items-center rounded-full border border-white/70 bg-white/72 text-ink-500 transition hover:bg-white hover:text-ink-900 disabled:opacity-40"
    >
      <Icon name={icon} className="h-3.5 w-3.5" strokeWidth={2} />
    </button>
  )
}
