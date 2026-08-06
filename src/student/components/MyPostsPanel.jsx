import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../../components/ui.jsx'
import { GlassPanel } from './Glass.jsx'
import { StatusChip } from './Reactions.jsx'
import { POST_STATUS, postBook } from '../community/presentation.js'
import { useStudentCommunity } from '../community/CommunityRuntimeContext.jsx'

// 我的发布与收藏：草稿、等待审核、已通过、退回修改、已下架都在这里，
// 每一条都要给「现在在哪一步」和「我能做什么」（规格 §9.3）。
//
// 这一块被两个地方用：共读社区的「我的发布」视图，和个人主页的 `#/student/me/posts`。
// 所以它在 Stage 6 从 Community.jsx 里搬到组件层——同一份数据（community.mine /
// community.savedPosts）配同一份界面，两处永远不会长得不一样。
export default function MyPostsPanel() {
  const { community } = useStudentCommunity()
  const navigate = useNavigate()
  const groups = useMemo(() => {
    const order = ['returned', 'offline', 'pending', 'draft', 'published']
    return order
      .map((status) => ({ status, list: community.mine.filter((p) => p.status === status) }))
      .filter((g) => g.list.length > 0)
  }, [community.mine])

  const saved = community.savedPosts

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
        <p className="mt-1.5 text-caption text-ink-500">读到想说的地方就写一篇，可以带上书里的原文。</p>
        <button
          type="button"
          onClick={() => {
            community.startDraft({ scope: 'class' })
            navigate('/student/community/compose')
          }}
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
      {/* 概览：分组多的时候页面很长，先用一行告诉学生「哪些事在等我」（Stage 5 自检抓到）。 */}
      <GlassPanel
        tone="card"
        className="student-enter flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl px-4 py-3"
      >
        {groups.map((g) => (
          <span key={g.status} className="inline-flex items-center gap-1.5 text-caption text-ink-600">
            <StatusChip status={g.status} />
            <span className="font-semibold text-ink-800 tabular-nums">{g.list.length}</span>
            篇
          </span>
        ))}
        <span className="ml-auto text-micro text-ink-400">
          共 {community.mine.length} 篇，收藏 {saved.length} 篇
        </span>
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
              community.editPost(post.id)
              navigate('/student/community/compose')
            }}
            className="student-mini-btn"
          >
            <Icon name="Pencil" className="h-3.5 w-3.5" strokeWidth={2} />
            {post.status === 'published' ? '修改' : '继续写'}
          </button>
          {canWithdraw && (
            <button type="button" onClick={() => community.withdrawPost(post.id)} className="student-mini-btn">
              <Icon name="Undo2" className="h-3.5 w-3.5" strokeWidth={2} />
              撤回
            </button>
          )}
        </div>
      </div>

      {/* 退回与下架必须给可理解的原因，并写清下一步怎么做 */}
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
      {post.status === 'published' && (
        <p className="mt-1.5 text-micro text-ink-400">
          修改已发布的内容会重新等老师看一次，这段时间同学们看到的还是原来那一篇。
        </p>
      )}
    </li>
  )
}
