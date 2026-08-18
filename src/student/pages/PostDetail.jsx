import { Link, useNavigate, useParams } from 'react-router-dom'
import { BookCover, cx, Icon } from '../../components/ui.jsx'
import { useProtectedAssetUrl } from '../../shared/useProtectedAssetUrl.js'
import { GlassPanel } from '../components/Glass.jsx'
import { ReactionRow, StatusChip } from '../components/Reactions.jsx'
import { canJumpToPage, POST_STATUS, authorLabel, coverColors, postBook, scopeLabel } from '../community/presentation.js'
import { useStudentCommunity } from '../community/CommunityRuntimeContext.jsx'
import { useStudent } from '../state/StudentContext.jsx'

// 帖子详情（规格 §9.5，参考图 student_round1/07）：
// 横屏左侧主要内容、右侧作者与互动分栏。
// **没有评论区、没有关注、没有私聊**——参考图里那一整列评论是刻意删掉的。
export default function PostDetail({ community: injectedCommunity } = {}) {
  const { postId } = useParams()
  const navigate = useNavigate()
  const { community: contextCommunity } = useStudentCommunity()
  const community = injectedCommunity ?? contextCommunity
  const post = community.getPost(postId)

  if (!post) {
    return (
      <GlassPanel tone="solid" className="student-enter flex-1 rounded-2xl px-8 py-10">
        <h1 className="font-serif text-h1 font-bold text-ink-900">这篇内容现在看不到了</h1>
        <p className="mt-2 text-caption text-ink-500">
          它可能被作者撤回，或者已经下架。回社区看看现在有哪些同学写的内容。
        </p>
        <Link
          to="/student/community"
          className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/75 px-4 py-2.5 text-caption font-semibold text-ink-700 transition hover:bg-white"
        >
          <Icon name="ArrowLeft" className="h-4 w-4" />
          返回共读社区
        </Link>
      </GlassPanel>
    )
  }

  const book = postBook(post)
  const who = authorLabel(post)
  const mine = post.authorId === 'me'

  return (
    <div className="flex-1 space-y-4">
      <div className="student-enter flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/student/community')}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/72 px-4 py-2 text-caption font-semibold text-ink-600 transition hover:bg-white/90 hover:text-ink-900"
        >
          <Icon name="ArrowLeft" className="h-4 w-4" />
          返回共读社区
        </button>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 text-micro text-ink-600">
          <Icon name={post.scope === 'school' ? 'School' : 'Users'} className="h-4 w-4 text-ink-400" strokeWidth={1.9} />
          {scopeLabel(post.scope)}
        </span>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* 左：内容主体 */}
        <div className="min-w-0 flex-1 space-y-4">
          <GlassPanel tone="solid" className="student-enter overflow-hidden rounded-2xl">
            <Media post={post} book={book} />
            <div className="px-6 pb-6 pt-5">
              <h1 className="font-serif text-h1 font-bold leading-snug text-ink-900">{post.title}</h1>
              <p className="mt-1.5 text-micro text-ink-400">{post.at}</p>
              <p className="mt-4 whitespace-pre-wrap text-base leading-[1.9] text-ink-800">{post.text}</p>
            </div>
          </GlassPanel>

          {/* 引文：保留书名、页码与原文，并能回到原文那一页（规格 §9.5 第三条）。
              无图帖的顶部封面已经把这句原文摊成大字，此时这张卡只负责「它在哪一页」与跳转，
              不再把同一句话抄第二遍（自检抓到）。 */}
          {post.quote && book && (
            <QuoteCard post={post} book={book} dup={post.cover?.type !== 'image'} />
          )}
        </div>

        {/* 右：作者、书籍、互动 */}
        <aside className="w-full shrink-0 space-y-4 lg:w-[300px]">
          <GlassPanel tone="card" className="student-enter rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <span className="student-post-avatar student-post-avatar--lg" aria-hidden="true">
                {who.primary.slice(0, 1)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-caption font-semibold text-ink-900">
                  {who.primary}
                  {mine && <span className="ml-1.5 text-micro font-normal text-[#2FA38C]">我</span>}
                </span>
                <span className="mt-0.5 block truncate text-micro text-ink-500">{who.secondary}</span>
              </span>
            </div>
            <p className="mt-3 flex items-start gap-1.5 text-micro leading-relaxed text-ink-500">
              <Icon name="IdCard" className="mt-px h-3.5 w-3.5 shrink-0 text-ink-400" strokeWidth={1.9} />
              <span className="min-w-0">
                {who.real
                  ? '班级社区里显示真实姓名。'
                  : '学校社区里只显示阅读昵称和班级；老师和学校管理员仍然可以查到是谁写的。'}
              </span>
            </p>
          </GlassPanel>

          {book && (
            <GlassPanel tone="card" className="student-enter rounded-2xl p-4">
              <h2 className="text-caption font-semibold text-ink-700">这篇写的是</h2>
              <Link to={`/student/books/${book.id}`} className="mt-2.5 flex items-center gap-3 rounded-xl p-1 transition hover:bg-white/70">
                <BookCover book={book} className="w-[54px] shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate text-caption font-semibold text-ink-900">《{book.title}》</span>
                  <span className="mt-0.5 block truncate text-micro text-ink-500">{book.author}</span>
                  <span className="mt-1 inline-flex items-center gap-1 text-micro text-[#2FA38C]">
                    去看这本书
                    <Icon name="ChevronRight" className="h-3.5 w-3.5" />
                  </span>
                </span>
              </Link>
            </GlassPanel>
          )}

          {/* 互动：点赞、收藏、固定友好表情。没有点踩，也没有「谁点的」名单 */}
          <GlassPanel tone="card" className="student-enter rounded-2xl p-4">
            <h2 className="text-caption font-semibold text-ink-700">读完想说一句</h2>
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => community.toggleLike(post.id)}
                aria-pressed={!!post.liked}
                className={cx('student-act', post.liked && 'student-act--on')}
              >
                <Icon name="ThumbsUp" className="h-4 w-4" strokeWidth={2} />
                赞
                <span className="tabular-nums">{post.likes}</span>
              </button>
              <button
                type="button"
                onClick={() => community.toggleSave(post.id)}
                aria-pressed={community.isSaved(post.id)}
                className={cx('student-act', community.isSaved(post.id) && 'student-act--on')}
              >
                <Icon name={community.isSaved(post.id) ? 'BookmarkCheck' : 'Bookmark'} className="h-4 w-4" strokeWidth={2} />
                {community.isSaved(post.id) ? '已收藏' : '收藏'}
              </button>
            </div>
            <p className="mt-3 text-micro text-ink-500">选一个想说的：</p>
            <div className="mt-2">
              <ReactionRow post={post} size="sm" onToggle={(key) => community.toggleReaction(post.id, key)} />
            </div>
          </GlassPanel>

          {/* 自己的帖子：状态、原因与下一步 */}
          {mine && (
            <GlassPanel tone="card" className="student-enter rounded-2xl p-4">
              <div className="flex items-center gap-2">
                <StatusChip status={post.status} />
              </div>
              <p className="mt-2 text-micro leading-relaxed text-ink-500">{POST_STATUS[post.status].hint}</p>
              {post.review && (
                <p className="student-review mt-2.5">
                  <Icon name="MessageSquareQuote" className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                  <span className="min-w-0">
                    <span className="font-semibold">
                      {post.review.who} · {post.review.at}
                    </span>
                    <span className="mt-0.5 block leading-relaxed">{post.review.reason}</span>
                  </span>
                </p>
              )}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    community.editPost(post.id)
                    navigate('/student/community/compose')
                  }}
                  className="student-mini-btn"
                >
                  <Icon name="Pencil" className="h-3.5 w-3.5" strokeWidth={2} />
                  修改
                </button>
                {post.status === 'pending' && (
                  <button
                    type="button"
                    onClick={() => {
                      community.withdrawPost(post.id)
                      navigate('/student/community')
                    }}
                    className="student-mini-btn"
                  >
                    <Icon name="Undo2" className="h-3.5 w-3.5" strokeWidth={2} />
                    撤回
                  </button>
                )}
              </div>
            </GlassPanel>
          )}

        </aside>
      </div>
    </div>
  )
}

// 顶部媒体：有图帖放这本书的真实封面（Codex Q4：不下载外部图），无图帖排版文字封面
function Media({ post, book }) {
  const { runtime } = useStudent()
  const [c1, c2] = coverColors(post)
  const wantImage = post.cover?.type === 'image' && Boolean(book)
  const { objectUrl, failed } = useProtectedAssetUrl(wantImage ? book?.coverUrl : null, runtime.data?.workspaceId)
  const showImage = wantImage && Boolean(objectUrl) && !failed
  return (
    <div className="student-detail-media" style={{ backgroundImage: `linear-gradient(150deg, ${c1}, ${c2})` }}>
      {showImage ? (
        <>
          <img
            src={objectUrl}
            alt={`《${book.title}》的封面`}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <span className="student-post-imgtag student-post-imgtag--lg">
            <Icon name="BookImage" className="h-3.5 w-3.5" strokeWidth={2} />
            这张图是《{book.title}》的封面
          </span>
        </>
      ) : (
        <div className="student-detail-textcover">
          {post.quote ? (
            <>
              <p className="student-detail-quote">「{post.quote.text}」</p>
              <p className="student-detail-quotefoot">
                《{book?.title || '这本书'}》第 {post.quote.page} 页
              </p>
            </>
          ) : (
            <p className="student-detail-quote student-detail-quote--plain">{post.title}</p>
          )}
        </div>
      )}
      {post.picked && (
        <span className="student-post-pick student-post-pick--lg">
          <Icon name="Star" className="h-3.5 w-3.5" strokeWidth={2.4} />
          老师精选
        </span>
      )}
    </div>
  )
}

// 引文卡：书名 + 页码 + 原文 + 回原文那一页。
// 页码只有落在这本书已有内页里才给「去看这一页」，不给一个跳过去看不到的按钮。
function QuoteCard({ post, book, dup = false }) {
  const canJump = canJumpToPage(book, post.quote.page)
  return (
    <GlassPanel tone="card" className="student-enter rounded-2xl p-5">
      <div className="flex items-center gap-2.5">
        <Icon name="Quote" className="h-[18px] w-[18px] text-[#2FA38C]" strokeWidth={2} />
        <h2 className="font-serif text-h3 font-bold text-ink-900">
          {dup ? '这句话在书里的位置' : '书里的原文'}
        </h2>
        <span className="ml-auto text-micro text-ink-500">
          《{book.title}》第 {post.quote.page} 页
        </span>
      </div>
      {dup ? (
        <p className="mt-2.5 text-caption leading-relaxed text-ink-500">
          上面那句话出自《{book.title}》第 {post.quote.page} 页。
          {canJump ? '想看看前后写了什么，就直接翻到那一页。' : '这本书的这一页现在还没有内页，可以先去书的页面看看。'}
        </p>
      ) : (
        <blockquote className="student-quote-block">{post.quote.text}</blockquote>
      )}
      {canJump ? (
        <Link to={`/student/reader/${book.id}?pageNo=${post.quote.page}`} className="student-primary-btn mt-3.5">
          <Icon name="BookOpen" className="h-4 w-4" strokeWidth={2} />
          去看这一页
        </Link>
      ) : (
        <Link to={`/student/books/${book.id}`} className="student-mini-btn mt-3.5">
          <Icon name="BookOpen" className="h-3.5 w-3.5" strokeWidth={2} />
          去看这本书
        </Link>
      )}
    </GlassPanel>
  )
}
