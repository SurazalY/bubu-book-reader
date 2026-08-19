import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { cx, Icon } from '../../components/ui.jsx'
import { GlassPanel } from '../components/Glass.jsx'
import PostCard from '../components/PostCard.jsx'
import MyPostsPanel from '../components/MyPostsPanel.jsx'
import { SCOPE_NOTES, SORTS, TIME_RANGES, authorLabel, postBook } from '../community/presentation.js'
import { useStudentCommunity } from '../community/CommunityRuntimeContext.jsx'

// 共读社区（规格 §9，UI 清单 S-07）。
//
// 三个视图共用一个页面：班级社区 / 学校社区 / 我的发布。
// 前两个是分段滑块（参考图 student_round1/05：白色药丸在灰轨里滑），
// 「我的发布」不放进滑块——它不是一个「范围」，而是我自己的内容与审核状态。
//
// 这一页坚决没有：评论、回复、关注、私聊、点踩、人气排行榜（规格 §9.4）。
export default function Community({ community: injectedCommunity, student: injectedStudent } = {}) {
  const { community: contextCommunity, student: contextStudent } = useStudentCommunity()
  const community = injectedCommunity ?? contextCommunity
  const student = injectedStudent ?? contextStudent
  const navigate = useNavigate()
  const [scope, setScope] = useState('class')
  const [view, setView] = useState('feed') // feed | mine
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('latest')
  const [range, setRange] = useState('all')

  const feed = community.getFeed(scope, { query, sort, range })
  const mine = community.mine
  const pending = mine.filter((p) => p.status === 'pending').length
  const needFix = mine.filter((p) => p.status === 'returned' || p.status === 'offline').length
  const drafts = mine.filter((p) => p.status === 'draft').length
  const activeSort = SORTS.find((s) => s.key === sort) || SORTS[0]
  const filtered = query.trim() || range !== 'all' || sort !== 'latest'

  // 写新的一篇：必须先开一份空草稿，否则上一次没写完的内容会被带进新帖子
  const writeNew = () => {
    community.startDraft({ scope })
    navigate('/student/community/compose')
  }

  return (
    <div className="flex min-h-full flex-1 flex-col gap-3 pb-2">
      {/* 发布结果提示：发出去之后必须明确告诉学生「现在在哪一步」 */}
      {community.flash && (
        <GlassPanel
          tone="float"
          className={cx('student-enter flex items-center gap-2.5 rounded-xl px-4 py-3', 'student-flash', `student-flash--${community.flash.tone}`)}
        >
          <Icon name="Info" className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
          <p className="min-w-0 flex-1 text-caption font-semibold">{community.flash.text}</p>
          <button
            type="button"
            onClick={community.dismissFlash}
            className="shrink-0 rounded-full px-2 py-1 text-micro text-ink-500 transition hover:bg-white/70"
          >
            知道了
          </button>
        </GlassPanel>
      )}

      {/* 顶部：范围滑块 + 我的发布 + 发布入口 */}
      <GlassPanel tone="card" className="student-enter rounded-xl px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="student-seg" role="tablist" aria-label="社区范围">
            {[
              { key: 'class', label: '班级社区' },
              { key: 'school', label: '学校社区' },
            ].map((s) => (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={view === 'feed' && scope === s.key}
                onClick={() => {
                  setScope(s.key)
                  setView('feed')
                }}
                className={cx('student-seg-btn', view === 'feed' && scope === s.key && 'student-seg-btn--on')}
              >
                {s.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setView('mine')}
            aria-selected={view === 'mine'}
            title={`草稿 ${drafts} 篇 · 等老师看 ${pending} 篇 · 要改 ${needFix} 篇`}
            className={cx('student-mine-btn', view === 'mine' && 'student-mine-btn--on')}
          >
            <Icon name="PenLine" className="h-4 w-4" strokeWidth={2} />
            我的发布
            <span className="tabular-nums opacity-70">{mine.length}</span>
            {(pending > 0 || needFix > 0) && <span className="student-dot" aria-hidden="true" />}
          </button>

          <button type="button" onClick={writeNew} className="student-primary-btn ml-auto">
            <Icon name="Plus" className="h-4 w-4" strokeWidth={2.4} />
            写一篇
          </button>
        </div>

        {/* 身份说明：学校社区显示昵称这件事必须让学生事先知道（规格 §9.1） */}
        {view === 'feed' && (
          <p className="mt-2.5 flex items-start gap-1.5 text-micro leading-relaxed text-ink-500">
            <Icon name="IdCard" className="mt-px h-3.5 w-3.5 shrink-0 text-ink-400" strokeWidth={1.9} />
            <span className="min-w-0">{SCOPE_NOTES[scope]}</span>
          </p>
        )}
      </GlassPanel>

      {view === 'feed' ? (
        <>
          {/* 搜索、排序、时间范围 */}
          <GlassPanel tone="card" className="student-enter flex flex-wrap items-center gap-2.5 rounded-xl px-3.5 py-3">
            <label className="student-search flex min-w-[200px] flex-1 items-center gap-2.5 rounded-full px-3.5 py-2">
              <Icon name="Search" className="h-[17px] w-[17px] shrink-0 text-ink-400" strokeWidth={2} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜标题或内容"
                aria-label="搜索社区内容"
                className="min-w-0 flex-1 bg-transparent text-caption text-ink-800 placeholder:text-ink-300 focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="清空搜索"
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
                >
                  <Icon name="X" className="h-3.5 w-3.5" strokeWidth={2.4} />
                </button>
              )}
            </label>

            <div className="student-chips" role="group" aria-label="排序方式">
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  title={s.note}
                  onClick={() => setSort(s.key)}
                  className={cx('student-chip', sort === s.key && 'student-chip--on')}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <label className="student-select">
              <Icon name="CalendarRange" className="h-4 w-4 shrink-0 text-ink-400" strokeWidth={1.9} />
              <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="时间范围">
                {TIME_RANGES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>

            <p className="shrink-0 text-micro text-ink-500">
              <span className="font-semibold text-ink-800 tabular-nums">{feed.length}</span> 篇
            </p>
          </GlassPanel>

          {/* 排序口径说明：学生要能看懂「本周友善互动多」不是永久排行 */}
          {sort !== 'latest' && (
            <p className="student-enter -mt-1 px-1 text-micro text-ink-500">
              <Icon name="Info" className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-ink-400" strokeWidth={1.9} />
              {activeSort.note}
            </p>
          )}

          {feed.length > 0 ? (
            <>
              <div key={`${scope}-${sort}-${range}`} className="student-masonry">
                {feed.map((p, i) => (
                  <PostCard key={p.id} post={p} index={i} onToggleReaction={community.toggleLike} />
                ))}
              </div>
              {feed.length < 5 && (
                <GlassPanel tone="card" className="student-enter flex items-center gap-3 rounded-xl px-4 py-3.5">
                  <Icon name="Info" className="h-[18px] w-[18px] shrink-0 text-ink-400" strokeWidth={1.9} />
                  <p className="min-w-0 text-caption text-ink-500">
                    这样筛下来只有 {feed.length} 篇，换个条件能看到更多同学写的内容。
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('')
                      setSort('latest')
                      setRange('all')
                    }}
                    className="ml-auto shrink-0 rounded-full border border-white/70 bg-white/75 px-3.5 py-2 text-caption font-semibold text-ink-700 transition hover:bg-white"
                  >
                    看全部
                  </button>
                </GlassPanel>
              )}
              {/* 筛到只剩两三篇时，多列瀑布流只填得满第一列，右边与下方会空一大片（自检抓到）。
                  补一块真能点的「同学最近还写了」把版面撑住，而不是塞装饰。 */}
              {feed.length < 3 && <MoreFromFeed scope={scope} exclude={feed} community={community} />}
            </>
          ) : (
            <GlassPanel tone="card" className="student-enter flex flex-1 flex-col items-center justify-center rounded-xl px-6 py-12 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white/70 text-ink-300">
                <Icon name={filtered ? 'SearchX' : 'MessagesSquare'} className="h-6 w-6" strokeWidth={1.8} />
              </span>
              <p className="mt-3 text-title font-semibold text-ink-800">
                {filtered ? '这些条件下暂时没有内容' : '这里还没有同学发布内容'}
              </p>
              <p className="mt-1.5 text-caption text-ink-500">
                {filtered ? '换个词或者把时间范围放宽一点试试。' : '你可以写下第一篇，老师看过就会出现在这里。'}
              </p>
              <div className="mt-4 flex items-center gap-2.5">
                {filtered && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('')
                      setSort('latest')
                      setRange('all')
                    }}
                    className="rounded-full border border-white/70 bg-white/75 px-4 py-2 text-caption font-semibold text-ink-700 transition hover:bg-white"
                  >
                    看全部
                  </button>
                )}
                <button type="button" onClick={writeNew} className="student-primary-btn">
                  <Icon name="Plus" className="h-4 w-4" strokeWidth={2.4} />
                  写一篇
                </button>
              </div>
              {filtered && (
                <div className="mt-7 w-full text-left">
                  <MoreFromFeed scope={scope} exclude={[]} bare community={community} />
                </div>
              )}
            </GlassPanel>
          )}
        </>
      ) : (
        // 「我的发布」在组件层，个人主页的 #/student/me/posts 用的是同一块
        <MyPostsPanel />
      )}
    </div>
  )
}

// 「同学最近还写了」：筛选条件太窄（<3 篇）或者搜不到东西时，
// 给几条真实可点的最新内容，让学生有下一步可走，同时把空掉的版面填住。
// 刻意用细列表而不是再放一排卡片——它是补充，不能盖过当前筛选结果。
function MoreFromFeed({ scope, exclude = [], bare = false, community: injectedCommunity }) {
  const { community: contextCommunity } = useStudentCommunity()
  const community = injectedCommunity ?? contextCommunity
  const skip = new Set(exclude.map((p) => p.id))
  const list = community
    .getFeed(scope, { query: '', sort: 'latest', range: 'all' })
    .filter((p) => !skip.has(p.id))
    .slice(0, 4)
  if (!list.length) return null

  const body = (
    <>
      <div className="flex items-center gap-2.5">
        <Icon name="Sparkles" className="h-[18px] w-[18px] text-[#2FA38C]" strokeWidth={2} />
        <h2 className="font-serif text-h3 font-bold text-ink-900">同学最近还写了</h2>
        <span className="ml-auto text-micro text-ink-400">不受上面的筛选影响</span>
      </div>
      <ul className="mt-3 space-y-2">
        {list.map((p) => {
          const who = authorLabel(p)
          return (
            <li key={p.id}>
              <Link to={`/student/community/${p.id}`} className="student-myrow">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-caption font-semibold text-ink-800">{p.title}</span>
                  <span className="mt-0.5 block truncate text-micro text-ink-500">
                    {who.primary}
                    <span className="mx-1.5 text-ink-300">·</span>
                    《{postBook(p)?.title || '这本书'}》<span className="mx-1.5 text-ink-300">·</span>
                    {p.at}
                  </span>
                </span>
                <Icon name="ChevronRight" className="h-4 w-4 shrink-0 text-ink-300" />
              </Link>
            </li>
          )
        })}
      </ul>
    </>
  )

  if (bare) return body
  return (
    <GlassPanel tone="card" className="student-enter rounded-xl p-4">
      {body}
    </GlassPanel>
  )
}
