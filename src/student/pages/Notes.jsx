import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cx, Icon } from '../../components/ui.jsx'
import { GlassPanel } from '../components/Glass.jsx'
import PageHead from '../components/PageHead.jsx'
import { useStudent } from '../state/StudentContext.jsx'
import { useStudentCommunity } from '../community/CommunityRuntimeContext.jsx'
import usePersonalReadingAdapter from '../state/usePersonalReadingAdapter.js'

const NOTE_RULES = [
  '批注只属于你自己的阅读记录，默认不会公开给同学。',
  '要投稿时会先到发布页确认，并按班级社区的审核流程处理。',
  '新批注必须从阅读器里选中真实正文后创建，不能在这里伪造书页位置。',
]

function formatUpdatedAt(value) {
  const time = Date.parse(value || '')
  if (!Number.isFinite(time)) return '刚刚保存'
  const date = new Date(time)
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// 我的心得（规格 §10.6、UI 清单 S-08）：
// - 自己写、可以一直改；
// - 投稿到社区要二次确认并选一本关联的书；
// - 竹娃参与过的部分必须留标记，让老师知道哪一段有 AI 参与；
// - 心得不会自动公开，投稿之后仍然要老师看过。
export default function Notes() {
  const { runtime } = useStudent()
  const { community } = useStudentCommunity()
  const { bookMap, books, library } = usePersonalReadingAdapter({
    workspaceId: runtime.data?.workspaceId,
    books: runtime.data?.books || [],
  })
  const navigate = useNavigate()
  const notes = useMemo(() => library.annotations.map((item) => ({
    ...item,
    title: `${item.title || bookMap.get(item.bookId)?.title || '服务端未返回书名'} · 第 ${item.pageNo} 页`,
    text: item.body || '',
    updatedAtLabel: formatUpdatedAt(item.updatedAt),
  })), [bookMap, library.annotations])
  const [activeId, setActiveId] = useState('')
  const active = notes.find((note) => note.id === activeId) || null
  const [draft, setDraft] = useState({ title: '', text: '', bookId: '' })
  const [dirty, setDirty] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [pickBook, setPickBook] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!notes.length) {
      if (activeId) setActiveId('')
      return
    }
    if (!notes.some((note) => note.id === activeId)) setActiveId(notes[0].id)
  }, [activeId, notes])

  // 切换心得时把编辑区同步过去；没保存的改动只在当前这一篇里
  useEffect(() => {
    if (!active) return
    setDraft({ title: active.title, text: active.text, bookId: active.bookId || '' })
    setDirty(false)
  }, [activeId, active?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (p) => {
    setDraft((d) => ({ ...d, ...p }))
    setDirty(true)
  }

  const save = async () => {
    if (!active) return null
    try {
      const updated = await library.updateAnnotation(active.id, {
        body: draft.text,
        color: active.color || 'violet',
        position: active.position,
        expectedVersion: active.version,
      })
      setDirty(false)
      setNotice('批注已保存到真实阅读记录。')
      return updated
    } catch (error) {
      setNotice(error?.message || '批注没有保存成功，请稍后重试。')
      return null
    }
  }

  const startNew = () => {
    const firstBook = books.find((book) => book?.id)
    navigate(firstBook ? `/student/reader/${firstBook.id}` : '/student/shelf')
  }

  const submit = async () => {
    if (!active) return
    const bookId = active.bookId
    if (!bookId) return
    if (dirty && !await save()) return
    community.startDraft({
      scope: 'class',
      title: draft.title || active.title,
      text: draft.text,
      bookId,
    })
    setConfirming(false)
    navigate('/student/community/compose')
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHead
        title="我的心得"
        desc="写下来的都只在你自己这里。想让同学看到，就选一本书投稿给老师。"
      >
        <button
          type="button"
          onClick={startNew}
          className="student-btn-primary inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-caption font-semibold"
        >
          <Icon name="Plus" className="h-4 w-4" strokeWidth={2.4} />
          去阅读器新建
        </button>
      </PageHead>

      <div className="flex flex-1 flex-col gap-4 lg:flex-row lg:items-start">
        {/* 左：心得列表 */}
        <GlassPanel tone="solid" className="student-enter w-full shrink-0 rounded-2xl p-4 lg:w-[280px]">
          <h2 className="px-1 text-caption font-semibold text-ink-500 tabular-nums">共 {notes.length} 条批注</h2>
          <ul className="mt-2.5 space-y-1.5">
            {notes.map((n, i) => {
              const book = bookMap.get(n.bookId)
              return (
                <li key={n.id} className="student-stagger" style={{ '--i': i }}>
                  <button
                    type="button"
                    onClick={() => setActiveId(n.id)}
                    aria-pressed={n.id === activeId}
                    className={cx(
                      'w-full rounded-xl px-3.5 py-3 text-left transition',
                      n.id === activeId ? 'bg-white/95 shadow-e1' : 'bg-white/56 hover:bg-white/80',
                    )}
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-caption font-semibold text-ink-900">
                        {n.title || '（还没写标题）'}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-micro text-ink-500">
                      {book ? `《${book.title}》` : '还没选书'}
                      <span className="mx-1.5 text-ink-300">·</span>
                      {n.updatedAtLabel}
                    </span>
                    <span className="mt-0.5 block text-micro text-ink-400">
                      只属于你的阅读批注
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </GlassPanel>

        {/* 右：编辑区 */}
        <div className="min-w-0 flex-1 space-y-4">
          {active ? (
            <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
              <input
                value={draft.title}
                readOnly
                title="批注标题由关联书籍和页码确定"
                placeholder="给这篇心得起个名字"
                aria-label="心得标题"
                className="w-full rounded-xl bg-white/62 px-4 py-3 font-serif text-h3 font-bold text-ink-900 outline-none placeholder:font-sans placeholder:text-body placeholder:font-normal placeholder:text-ink-300 focus:bg-white/90"
              />

              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <label className="text-caption text-ink-500" htmlFor="note-book">
                  关联的书
                </label>
                <select
                  id="note-book"
                  value={draft.bookId}
                  disabled
                  className="rounded-full border border-white/70 bg-white/78 px-3.5 py-2 text-caption text-ink-800 outline-none"
                >
                  <option value="">先不选</option>
                  {books.filter((book) => book.id === active.bookId).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
                </select>
              </div>

              <textarea
                value={draft.text}
                onChange={(e) => patch({ text: e.target.value })}
                rows={12}
                placeholder="读到哪一段最有感觉？把想说的写下来就好。"
                aria-label="心得正文"
                className="mt-3 w-full resize-y rounded-xl bg-white/62 px-4 py-3.5 text-body leading-loose text-ink-800 outline-none placeholder:text-ink-300 focus:bg-white/90"
              />

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="text-micro text-ink-400 tabular-nums">
                  {draft.text.replace(/\s/g, '').length} 字
                  <span className="mx-1.5 text-ink-300">·</span>
                  {dirty ? '还没保存' : `上次保存 ${active.updatedAtLabel}`}
                </span>
                <div className="ml-auto flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    onClick={save}
                    disabled={!dirty}
                    className="rounded-full border border-white/70 bg-white/72 px-5 py-2 text-caption font-semibold text-ink-700 transition hover:bg-white disabled:opacity-55"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPickBook(active.bookId)
                      setConfirming(true)
                    }}
                    disabled={!draft.text.trim()}
                    className="student-btn-primary rounded-full px-5 py-2 text-caption font-semibold"
                  >
                    投稿到共读社区
                  </button>
                </div>
              </div>
              {notice && (
                <p className="mt-3 rounded-xl bg-white/58 px-4 py-3 text-micro leading-relaxed text-ink-500">
                  {notice}
                </p>
              )}
            </GlassPanel>
          ) : (
            <GlassPanel tone="solid" className="student-enter rounded-2xl px-6 py-12 text-center">
              <p className="text-title font-semibold text-ink-800">还没有写过心得</p>
              <p className="mt-1.5 text-caption text-ink-500">读到想说的地方，写一篇留着自己看也很好。</p>
            </GlassPanel>
          )}

          <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
            <h2 className="font-serif text-h3 font-bold text-ink-900">投稿之前先知道这几件事</h2>
            <ul className="mt-3 space-y-1.5">
              {NOTE_RULES.map((t) => (
                <li key={t} className="flex gap-2 text-caption leading-relaxed text-ink-600">
                  <Icon name="Dot" className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                  {t}
                </li>
              ))}
            </ul>
          </GlassPanel>
        </div>
      </div>

      {/* 投稿二次确认：必须选一本书才能继续 */}
      {confirming && (
        <div className="student-modal-mask fixed inset-0 z-40 grid place-items-center bg-ink-900/24 px-6">
          <GlassPanel tone="float" className="student-modal student-dialog w-full max-w-[520px] rounded-2xl p-6">
            <h2 className="font-serif text-h3 font-bold text-ink-900">要把这篇交给老师看吗</h2>
            <p className="mt-2 text-caption leading-relaxed text-ink-600">
              交上去之后老师会先看一遍，通过了同学才能在共读社区里看到。你随时可以撤回或者继续改。
            </p>

            <label className="mt-4 block text-caption font-semibold text-ink-700" htmlFor="submit-book">
              这篇写的是哪一本书
            </label>
            <select
              id="submit-book"
              value={pickBook}
              disabled
              className="mt-2 w-full rounded-xl border border-white/70 bg-white/86 px-4 py-2.5 text-caption text-ink-800 outline-none"
            >
              <option value="">请选择一本书</option>
              {books.filter((book) => book.id === active?.bookId).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
            {!pickBook && <p className="mt-1.5 text-micro text-ink-400">要选一本书才能投稿。</p>}


            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-full border border-white/70 bg-white/72 px-5 py-2 text-caption font-semibold text-ink-700 transition hover:bg-white"
              >
                再想想
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!pickBook}
                className="student-btn-primary rounded-full px-5 py-2 text-caption font-semibold"
              >
                去发布页确认
              </button>
            </div>
          </GlassPanel>
        </div>
      )}
    </div>
  )
}
