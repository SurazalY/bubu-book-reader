import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookCover, cx, Icon } from '../../components/ui.jsx'
import { GlassPanel } from '../components/Glass.jsx'
import PostCard from '../components/PostCard.jsx'
import { canJumpToPage, SCOPE_NOTES } from '../community/presentation.js'
import { useStudentCommunity } from '../community/CommunityRuntimeContext.jsx'

// 发布内容（规格 §9.3）：草稿自动保存、发布前选定关联书籍、发布后进入审核。
//
// 三条边界：
// - 学生端**没有**「直接发布」的路径，任何一次发布都是「交给老师看」。
// - 引文只能从**自己在阅读器里的摘录**里挑，不让学生手打一段冒充原文。
// - 图片只能用这本书的封面（Codex 第 109 轮 Q4：不引入任何外部图片），并且卡上明写是书封。
const TONES = [
  { key: 'paper', label: '纸色' },
  { key: 'dusk', label: '暖橘' },
  { key: 'leaf', label: '草绿' },
  { key: 'ink', label: '墨灰' },
  { key: 'night', label: '夜蓝' },
]

export default function Compose({ community: injectedCommunity, reader: injectedReader, student: injectedStudent, books: injectedBooks } = {}) {
  const navigate = useNavigate()
  const { community: contextCommunity, reader: contextReader, student: contextStudent, books: contextBooks } = useStudentCommunity()
  const community = injectedCommunity ?? contextCommunity
  const reader = injectedReader ?? contextReader
  const student = injectedStudent ?? contextStudent
  const books = injectedBooks ?? contextBooks
  const d = community.draft
  const book = d.bookId ? books.find((item) => item.id === d.bookId) || null : null

  // 可选引文 = 我在这本书里的摘录（Stage 3 存在 reader.highlights）
  const quotes = useMemo(() => (d.bookId ? reader.highlights[d.bookId] || [] : []), [d.bookId, reader.highlights])
  // 只读过的书才排在前面：学生一般写自己在读的书
  const sortedBooks = useMemo(() => [...books].sort((a, b) => (b.minutes || 0) - (a.minutes || 0)), [books])

  const missing = []
  if (!d.bookId) missing.push('选一本书')
  if (!d.quote) missing.push('选一条书中引文')
  if (!d.title.trim()) missing.push('写个标题')
  if (!d.text.trim()) missing.push('写几句你自己的话')
  const ready = missing.length === 0

  // 预览用的假帖子对象：让学生发布前就看到卡片长什么样
  const preview = {
    ...d,
    id: 'preview',
    authorId: 'me',
    status: 'draft',
    at: '现在',
    days: 0,
    likes: 0,
    reactions: {},
    mine: [],
  }

  const publish = async () => {
    if (await community.publishDraft()) navigate('/student/community')
  }

  return (
    <div className="flex-1 space-y-4">
      <div className="student-enter flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/student/community')}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/72 px-4 py-2 text-caption font-semibold text-ink-600 transition hover:bg-white/90 hover:text-ink-900"
        >
          <Icon name="ArrowLeft" className="h-4 w-4" />
          返回共读社区
        </button>
        <h1 className="font-serif text-h2 font-bold text-ink-900">
          {d.id ? '继续写' : '写一篇'}
        </h1>
        {/* 草稿自动保存：必须让学生看得见「已经存了」，否则不敢离开页面 */}
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 text-micro text-ink-600">
          <Icon name="CloudCheck" className="h-4 w-4 text-[#2FA38C]" strokeWidth={1.9} />
          {community.draftSavedAt ? `草稿已自动保存 · ${community.draftSavedAt}` : '写下第一个字就会自动存草稿'}
        </span>
      </div>

      {/* 从「已退回修改／已下架」进来时，先把老师的原因摆在最上面 */}
      {(d.from === 'returned' || d.from === 'offline') && (
        <GlassPanel tone="card" className="student-enter rounded-xl px-4 py-3.5">
          <p className="student-review">
            <Icon name="MessageSquareQuote" className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <span className="min-w-0">
              <span className="font-semibold">老师写了要改的地方</span>
              <span className="mt-0.5 block leading-relaxed">
                {community.getPost(d.id)?.review?.reason || '按老师的说明改好，就可以再发一次。'}
              </span>
            </span>
          </p>
        </GlassPanel>
      )}
      {d.from === 'published' && (
        <GlassPanel tone="card" className="student-enter flex items-center gap-2.5 rounded-xl px-4 py-3">
          <Icon name="Info" className="h-[18px] w-[18px] shrink-0 text-ink-400" strokeWidth={1.9} />
          <p className="text-caption text-ink-600">
            这一篇同学们已经看到了。改完之后要老师再看一次，这段时间大家看到的还是原来那一篇。
          </p>
        </GlassPanel>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* 左：编辑 */}
        <div className="min-w-0 flex-1 space-y-4">
          {/* 1. 关联书籍 */}
          <GlassPanel tone="card" className="student-enter rounded-2xl p-5">
            <SectionTitle n="1" icon="BookOpen" title="这篇写的是哪本书" note="社区里的每一篇都要对应一本书，同学才知道你在说什么" />
            <div className="mt-3 flex items-center gap-3">
              <label className="student-select flex-1">
                <Icon name="Library" className="h-4 w-4 shrink-0 text-ink-400" strokeWidth={1.9} />
                <select value={d.bookId} onChange={(e) => community.patchDraft({ bookId: e.target.value, quote: null })} aria-label="选择书籍">
                  <option value="">还没有选书</option>
                  {sortedBooks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                      {b.minutes > 0 ? '（在读）' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {book && <BookCover book={book} className="w-[44px] shrink-0" />}
            </div>
          </GlassPanel>

          {/* 2. 发到哪里 */}
          <GlassPanel tone="card" className="student-enter rounded-2xl p-5">
            <SectionTitle n="2" icon="Users" title="发到哪个社区" note="两个社区的可见范围与显示的名字不一样" />
            <div className="mt-3 flex flex-wrap gap-2.5">
              {[
                { key: 'class', label: '班级社区', desc: student.className ? `${student.className}的同学` : '本班同学' },
                { key: 'school', label: '学校社区', desc: '全校同学' },
              ].map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => community.patchDraft({ scope: s.key })}
                  aria-pressed={d.scope === s.key}
                  className={cx('student-pickcard', d.scope === s.key && 'student-pickcard--on')}
                >
                  <span className="flex items-center gap-1.5 text-caption font-semibold">
                    <Icon name={s.key === 'school' ? 'School' : 'Users'} className="h-4 w-4" strokeWidth={2} />
                    {s.label}
                  </span>
                  <span className="mt-1 block text-micro opacity-80">{s.desc}</span>
                </button>
              ))}
            </div>
            <p className="mt-2.5 flex items-start gap-1.5 text-micro leading-relaxed text-ink-500">
              <Icon name="IdCard" className="mt-px h-3.5 w-3.5 shrink-0 text-ink-400" strokeWidth={1.9} />
              <span className="min-w-0">{SCOPE_NOTES[d.scope]}</span>
            </p>
          </GlassPanel>

          {/* 3. 标题与正文 */}
          <GlassPanel tone="card" className="student-enter rounded-2xl p-5">
            <SectionTitle n="3" icon="PenLine" title="写下你想说的" note="写你自己的想法就好，不用像作文" />
            <input
              value={d.title}
              onChange={(e) => community.patchDraft({ title: e.target.value.slice(0, 30) })}
              placeholder="一句话标题，比如「稻草人那一夜」"
              aria-label="标题"
              className="student-input mt-3"
            />
            <div className="mt-1 flex justify-end text-micro text-ink-400 tabular-nums">{d.title.length} / 30</div>
            <textarea
              value={d.text}
              onChange={(e) => community.patchDraft({ text: e.target.value.slice(0, 600) })}
              placeholder="你读到哪里停了下来？它让你想起什么？"
              aria-label="正文"
              rows={6}
              className="student-input student-input--area mt-1"
            />
            <div className="mt-1 flex justify-end text-micro text-ink-400 tabular-nums">{d.text.length} / 600</div>
          </GlassPanel>

          {/* 4. 引文（可选） */}
          <GlassPanel tone="card" className="student-enter rounded-2xl p-5">
            <SectionTitle n="4" icon="Quote" title="带一段书里的原文（可以不带）" note="只能从你在阅读器里收藏的摘录里挑，页码和原文会一起带上" />
            {!d.bookId ? (
              <p className="mt-3 rounded-xl bg-white/55 px-3.5 py-3 text-caption text-ink-500">先在上面选一本书，这里会列出你在那本书里的摘录。</p>
            ) : quotes.length === 0 ? (
              <p className="mt-3 flex items-center gap-2.5 rounded-xl bg-white/55 px-3.5 py-3 text-caption text-ink-500">
                <span className="min-w-0 flex-1">你在《{book?.title}》里还没有收藏摘录。在阅读器里长按一段文字就能收藏。</span>
                <Link to={`/student/reader/${d.bookId}`} className="student-mini-btn shrink-0">
                  <Icon name="BookOpen" className="h-3.5 w-3.5" strokeWidth={2} />
                  去读这本书
                </Link>
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {quotes.map((q) => {
                  const on = d.quote?.text === q.text && d.quote?.page === q.page
                  return (
                    <li key={q.key}>
                      <button
                        type="button"
                        onClick={() => community.patchDraft({ quote: on ? null : { page: q.page, text: q.text } })}
                        aria-pressed={on}
                        className={cx('student-quote-pick', on && 'student-quote-pick--on')}
                      >
                        <Icon name={on ? 'CheckCircle2' : 'Circle'} className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block text-caption leading-relaxed text-ink-800">「{q.text}」</span>
                          <span className="mt-0.5 block text-micro text-ink-500">第 {q.page} 页</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {d.quote && !canJumpToPage(book, d.quote.page) && (
              <p className="mt-2 text-micro text-ink-400">这一段的页码不在这本书已下载的内页里，同学看到时只显示页码，不能直接跳过去。</p>
            )}
          </GlassPanel>

          {/* 5. 封面 */}
          <GlassPanel tone="card" className="student-enter rounded-2xl p-5">
            <SectionTitle n="5" icon="Image" title="卡片封面" note="社区里是多列卡片，封面决定同学第一眼看到什么" />
            <div className="mt-3 flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => community.patchDraft({ cover: { ...d.cover, type: 'text' } })}
                aria-pressed={d.cover.type === 'text'}
                className={cx('student-pickcard', d.cover.type === 'text' && 'student-pickcard--on')}
              >
                <span className="flex items-center gap-1.5 text-caption font-semibold">
                  <Icon name="Type" className="h-4 w-4" strokeWidth={2} />
                  文字封面
                </span>
                <span className="mt-1 block text-micro opacity-80">把引文或标题排在封面上</span>
              </button>
              <button
                type="button"
                onClick={() => community.patchDraft({ cover: { ...d.cover, type: 'image' } })}
                aria-pressed={d.cover.type === 'image'}
                disabled={!d.bookId}
                className={cx('student-pickcard', d.cover.type === 'image' && 'student-pickcard--on', !d.bookId && 'opacity-50')}
              >
                <span className="flex items-center gap-1.5 text-caption font-semibold">
                  <Icon name="BookImage" className="h-4 w-4" strokeWidth={2} />
                  用这本书的封面
                </span>
                <span className="mt-1 block text-micro opacity-80">卡片上会写明这是书封</span>
              </button>
            </div>
            {d.cover.type === 'text' && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-micro text-ink-500">底色</span>
                {TONES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => community.patchDraft({ cover: { ...d.cover, tone: t.key } })}
                    aria-pressed={d.cover.tone === t.key}
                    className={cx('student-chip', d.cover.tone === t.key && 'student-chip--on')}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-3 text-micro leading-relaxed text-ink-400">
              这一版还不能上传自己的照片，图片只能用书的封面。
            </p>
          </GlassPanel>
        </div>

        {/* 右：预览与发布。
            跟随滚动：编辑区有五步，滚到下面时「发给老师看」不能跑出屏幕（自检抓到）。 */}
        <aside className="w-full shrink-0 space-y-4 lg:sticky lg:top-0 lg:w-[300px] lg:self-start">
          <GlassPanel tone="card" className="student-enter rounded-2xl p-4">
            <h2 className="text-caption font-semibold text-ink-700">同学会看到这样一张卡片</h2>
            <div className="mt-3">
              {d.title.trim() || d.text.trim() ? (
                <PostCard post={preview} />
              ) : (
                <p className="rounded-xl bg-white/55 px-3.5 py-6 text-center text-caption text-ink-400">写点什么，这里就会出现预览</p>
              )}
            </div>
          </GlassPanel>

          <GlassPanel tone="card" className="student-enter rounded-2xl p-4">
            <h2 className="text-caption font-semibold text-ink-700">发出去之后</h2>
            <ol className="mt-2 space-y-1.5 text-micro leading-relaxed text-ink-600">
              <li>1. 先给老师看，这时同学还看不到</li>
              <li>2. 老师通过之后出现在{d.scope === 'school' ? '学校' : '班级'}社区</li>
              <li>3. 等老师看的这段时间，你还可以改或者撤回</li>
            </ol>

            {!ready && (
              <p className="mt-3 flex items-start gap-1.5 text-micro leading-relaxed text-ink-500">
                <Icon name="Info" className="mt-px h-3.5 w-3.5 shrink-0 text-ink-400" strokeWidth={1.9} />
                <span className="min-w-0">还差：{missing.join('、')}</span>
              </p>
            )}

            <div className="mt-3 space-y-2">
              <button type="button" onClick={publish} disabled={!ready} className={cx('student-primary-btn w-full justify-center', !ready && 'opacity-45')}>
                <Icon name="Send" className="h-4 w-4" strokeWidth={2} />
                发给老师看
              </button>
              <button
                type="button"
                onClick={() => {
                  community.saveDraft()
                  navigate('/student/community')
                }}
                className="student-mini-btn w-full justify-center"
              >
                <Icon name="Save" className="h-3.5 w-3.5" strokeWidth={2} />
                只存草稿
              </button>
              <button
                type="button"
                onClick={() => {
                  community.clearDraft()
                  navigate('/student/community')
                }}
                className="w-full rounded-full px-3 py-2 text-micro text-ink-500 transition hover:bg-white/70"
              >
                不写了，先离开
              </button>
            </div>
          </GlassPanel>
        </aside>
      </div>
    </div>
  )
}

function SectionTitle({ n, icon, title, note }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="student-step" aria-hidden="true">
        {n}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 font-serif text-h3 font-bold text-ink-900">
          <Icon name={icon} className="h-[17px] w-[17px] text-[#2FA38C]" strokeWidth={2} />
          {title}
        </span>
        <span className="mt-0.5 block text-micro text-ink-500">{note}</span>
      </span>
    </div>
  )
}
