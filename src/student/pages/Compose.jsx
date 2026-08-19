import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookCover, cx, Icon } from '../../components/ui.jsx'
import { GlassPanel } from '../components/Glass.jsx'
import PostCard from '../components/PostCard.jsx'
import { SCOPE_NOTES } from '../community/presentation.js'
import { useStudentCommunity } from '../community/CommunityRuntimeContext.jsx'

// 发布内容：选定关联书籍、写标题与正文，交给本班老师审核。
const TONES = [
  { key: 'paper', label: '纸色' },
  { key: 'dusk', label: '暖橘' },
  { key: 'leaf', label: '草绿' },
  { key: 'ink', label: '墨灰' },
  { key: 'night', label: '夜蓝' },
]

export default function Compose({ community: injectedCommunity, student: injectedStudent, books: injectedBooks } = {}) {
  const navigate = useNavigate()
  const { community: contextCommunity, student: contextStudent, books: contextBooks } = useStudentCommunity()
  const community = injectedCommunity ?? contextCommunity
  const student = injectedStudent ?? contextStudent
  const books = injectedBooks ?? contextBooks
  const d = community.draft
  const book = d.bookId ? books.find((item) => item.id === d.bookId) || null : null
  const sortedBooks = useMemo(() => [...books].sort((a, b) => (b.minutes || 0) - (a.minutes || 0)), [books])

  const missing = []
  if (!d.bookId) missing.push('选一本书')
  if (!d.title.trim()) missing.push('写个标题')
  if (!d.text.trim()) missing.push('写几句你自己的话')
  const ready = missing.length === 0

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
        <h1 className="font-serif text-h2 font-bold text-ink-900">写一篇</h1>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 text-micro text-ink-600">
          <Icon name="CloudCheck" className="h-4 w-4 text-[#2FA38C]" strokeWidth={1.9} />
          {community.draftSavedAt ? `草稿已自动保存 · ${community.draftSavedAt}` : '写下第一个字就会自动存草稿'}
        </span>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          <GlassPanel tone="card" className="student-enter rounded-2xl p-5">
            <SectionTitle n="1" icon="BookOpen" title="这篇写的是哪本书" note="社区里的每一篇都要对应一本书，同学才知道你在说什么" />
            <div className="mt-3 flex items-center gap-3">
              <label className="student-select flex-1">
                <Icon name="Library" className="h-4 w-4 shrink-0 text-ink-400" strokeWidth={1.9} />
                <select value={d.bookId} onChange={(e) => community.patchDraft({ bookId: e.target.value })} aria-label="选择书籍">
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

          <GlassPanel tone="card" className="student-enter rounded-2xl p-5">
            <SectionTitle n="4" icon="Image" title="卡片封面" note="社区里是多列卡片，封面决定同学第一眼看到什么" />
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
                <span className="mt-1 block text-micro opacity-80">把标题或正文排在封面上</span>
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
              <li>1. 先交给本班老师看，这时同学还看不到</li>
              <li>2. 本班老师通过之后出现在{d.scope === 'school' ? '学校' : '班级'}社区</li>
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
