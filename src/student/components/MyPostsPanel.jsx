import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../../components/ui.jsx'
import { GlassPanel } from './Glass.jsx'
import { StatusChip } from './Reactions.jsx'
import { POST_STATUS, postBook } from '../community/presentation.js'
import { useStudentCommunity } from '../community/CommunityRuntimeContext.jsx'

const REVIEW_STATES = ['pending', 'published', 'returned']

export default function MyPostsPanel() {
  const { community } = useStudentCommunity()
  const navigate = useNavigate()
  const counts = useMemo(() => ({
    pending: community.mine.filter((p) => p.status === 'pending').length,
    published: community.mine.filter((p) => p.status === 'published').length,
    returned: community.mine.filter((p) => p.status === 'returned' || p.status === 'offline').length,
  }), [community.mine])
  const groups = useMemo(() => {
    const order = ['returned', 'offline', 'pending', 'draft', 'published']
    return order
      .map((status) => ({ status, list: community.mine.filter((p) => p.status === status) }))
      .filter((g) => g.list.length > 0)
  }, [community.mine])

  const saved = community.savedPosts
  const writeNew = () => {
    community.startDraft({ scope: 'class' })
    navigate('/student/community/compose')
  }

  if (!community.mine.length) {
    return (
      <GlassPanel
        tone="card"
        className="student-enter flex flex-1 flex-col items-center justify-center rounded-xl px-6 py-12 text-center"
      >
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white/70 text-ink-300">
          <Icon name="PenLine" className="h-6 w-6" strokeWidth={1.8} />
        </span>
        <p className="mt-3 text-title font-semibold text-ink-800">你还没有写过</p>
        <p className="mt-1.5 text-caption text-ink-500">选一本书，写下标题和正文，交给本班老师看。</p>
        <button
          type="button"
          onClick={writeNew}
          className="student-primary-btn mt-4"
        >
          <Icon name="Plus" className="h-4 w-4" strokeWidth={2.4} />
          写一篇
        </button>
      </GlassPanel>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      <GlassPanel
        tone="card"
        className="student-enter flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl px-4 py-3"
      >
        {REVIEW_STATES.map((status) => (
          <span key={status} className="inline-flex items-center gap-1.5 text-caption text-ink-600">
            <StatusChip status={status} />
            <span className="font-semibold text-ink-800 tabular-nums">{counts[status]}</span>
            篇
          </span>
        ))}
        <button type="button" onClick={writeNew} className="student-mini-btn ml-auto">
          <Icon name="PenLine" className="h-3.5 w-3.5" strokeWidth={2} />
          重新写一篇
        </button>
      </GlassPanel>

      {groups.map((g) => (
        <GlassPanel key={g.status} tone="card" className="student-enter rounded-xl p-4">
          <div className="flex items-center gap-2.5">
            <StatusChip status={g.status} />
            <span className="text-micro text-ink-500">{POST_STATUS[g.status].hint}</span>
            <span className="ml-auto text-micro text-ink-400 tabular-nums">{g.list.length} 篇</span>
          </div>
          <ul className="mt-3 space-y-2">
            {g.list.map((p) => (
              <MyPostRow key={p.id} post={p} />
            ))}
          </ul>
        </GlassPanel>
      ))}

      <GlassPanel tone="card" className="student-enter rounded-xl p-4">
        <div className="flex items-center gap-2.5">
          <Icon name="Bookmark" className="h-[18px] w-[18px] text-[#3B77E8]" strokeWidth={2} />
          <h2 className="font-serif text-h3 font-bold text-ink-900">我的收藏</h2>
          <span className="ml-auto text-micro text-ink-400 tabular-nums">{saved.length} 篇</span>
        </div>
        {saved.length ? (
          <ul className="mt-3 space-y-2">
            {saved.map((p) => (
              <li key={p.id}>
                <Link to={`/student/community/${p.id}`} className="student-myrow">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-caption font-semibold text-ink-800">{p.title}</span>
                    <span className="mt-0.5 block truncate text-micro text-ink-500">
                      《{postBook(p)?.title}》<span className="mx-1.5 text-ink-300">·</span>
                      {p.at}
                    </span>
                  </span>
                  <Icon name="ChevronRight" className="h-4 w-4 shrink-0 text-ink-300" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-xl bg-white/55 px-3.5 py-3 text-caption text-ink-500">
            还没有收藏。看到想再读一遍的内容，点收藏就会留在这里。
          </p>
        )}
      </GlassPanel>
    </div>
  )
}

function MyPostRow({ post }) {
  const { community } = useStudentCommunity()
  const navigate = useNavigate()
  const book = postBook(post)
  const canWithdraw = post.status === 'pending'

  return (
    <li className="student-myrow student-myrow--block">
      <div className="flex min-w-0 items-start gap-3">
        <span className="min-w-0 flex-1">
          <Link
            to={`/student/community/${post.id}`}
            className="block truncate text-caption font-semibold text-ink-800 hover:underline"
          >
            {post.title || '（还没写标题）'}
          </Link>
          <span className="mt-0.5 block truncate text-micro text-ink-500">
            《{book?.title || '未选择书籍'}》
            <span className="mx-1.5 text-ink-300">·</span>
            {post.scope === 'school' ? '学校社区' : '班级社区'}
            <span className="mx-1.5 text-ink-300">·</span>
            {post.at}
          </span>
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              community.startDraft({ scope: post.scope })
              navigate('/student/community/compose')
            }}
            className="student-mini-btn"
          >
            <Icon name="PenLine" className="h-3.5 w-3.5" strokeWidth={2} />
            重新写一篇
          </button>
          {canWithdraw && (
            <button type="button" onClick={() => community.withdrawPost(post.id)} className="student-mini-btn">
              <Icon name="Undo2" className="h-3.5 w-3.5" strokeWidth={2} />
              撤回
            </button>
          )}
        </div>
      </div>

      {post.review && (
        <p className="student-review">
          <Icon name="MessageSquareQuote" className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span className="min-w-0">
            <span className="font-semibold">
              {post.review.who} · {post.review.at}
            </span>
            <span className="mt-0.5 block leading-relaxed">{post.review.reason}</span>
          </span>
        </p>
      )}
    </li>
  )
}
