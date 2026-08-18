import { Link } from 'react-router-dom'
import { cx, Icon } from '../../components/ui.jsx'
import { useProtectedAssetUrl } from '../../shared/useProtectedAssetUrl.js'
import { GlassCard } from './Glass.jsx'
import { ReactionSummary, StatusChip } from './Reactions.jsx'
import { authorLabel, coverColors, postBook } from '../community/presentation.js'
import { useStudent } from '../state/StudentContext.jsx'

// 社区内容卡（规格 §9.2，参考图 student_round1/06）。
// 视觉骨架与权限端 `CommunityPostCard` 对齐：封面 → 标题 → 摘要 → 身份行 → 书名 → 底部一行，
// 但**去掉了审核管理按钮**（勾选框、置顶、精选那些都是教师权限，学生端不能出现）。
//
// 封面两种（规格 §9.2）：
// - 有图帖：封面取书目投影的 coverUrl，经共享 hook 带头 fetch；卡上明写「书封图」，不冒充学生拍的照片。
// - 无图帖：把引文或正文排版成文字封面，字大、行少、留白足，本身就是内容；
//   此时下方**不再重复正文摘要**，否则同一段话在一张卡上出现两遍。
export default function PostCard({ post, index = 0, onToggleReaction, showStatus = false }) {
  const { runtime } = useStudent()
  const book = postBook(post)
  const who = authorLabel(post)
  const [c1, c2] = coverColors(post)
  const wantImage = post.cover?.type === 'image' && Boolean(book)
  const { objectUrl, failed } = useProtectedAssetUrl(wantImage ? book?.coverUrl : null, runtime.data?.workspaceId)
  const isImage = wantImage && Boolean(objectUrl) && !failed
  const dim = post.status === 'offline' || post.status === 'returned'

  return (
    <GlassCard
      className="student-post student-stagger overflow-hidden p-0"
      style={{ '--i': Math.min(index, 10) }}
    >
      <Link to={`/student/community/${post.id}`} className="block" aria-label={`打开《${post.title}》`}>
        {/* 封面 */}
        <div
          className={cx('student-post-cover', dim && 'student-post-cover--dim')}
          style={{ backgroundImage: `linear-gradient(150deg, ${c1}, ${c2})` }}
        >
          {isImage ? (
            <>
              <img
                src={objectUrl}
                alt={`《${book.title}》的封面`}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <span className="student-post-imgtag">
                <Icon name="BookImage" className="h-3 w-3" strokeWidth={2} />
                书封图
              </span>
            </>
          ) : (
            <div className="student-post-textcover">
              {post.quote ? (
                <>
                  <p className="student-post-quote">「{post.quote.text}」</p>
                  <p className="student-post-quotefoot">
                    《{book?.title || '这本书'}》第 {post.quote.page} 页
                  </p>
                </>
              ) : (
                <p className="student-post-plain">{post.text}</p>
              )}
            </div>
          )}
          {post.picked && (
            <span className="student-post-pick">
              <Icon name="Star" className="h-3 w-3" strokeWidth={2.4} />
              老师精选
            </span>
          )}
        </div>

        {/* 文字区 */}
        <div className="px-3.5 pb-3 pt-3">
          <h3 className="student-post-title">{post.title}</h3>
          {/* 纯文字封面摊的就是正文，这里再写一遍等于同一段话在卡上出现两次（自检抓到），
              所以摘要只在「封面是图片或引文」时才出现。 */}
          {(isImage || post.quote) && <p className="student-post-text">{post.text}</p>}

          <p className="mt-2.5 flex min-w-0 items-center gap-1.5 text-micro text-ink-500">
            <span className="student-post-avatar" aria-hidden="true">
              {who.primary.slice(0, 1)}
            </span>
            <span className="truncate font-semibold text-ink-700">{who.primary}</span>
            {post.scope === 'school' && <span className="shrink-0 truncate text-ink-400">{who.secondary}</span>}
            <span className="ml-auto shrink-0 whitespace-nowrap text-ink-400">{post.at}</span>
          </p>
          {book && (
            <p className="mt-1 truncate text-micro text-ink-400">
              <Icon name="BookOpen" className="mr-1 inline h-3 w-3 -translate-y-px" strokeWidth={1.9} />
              《{book.title}》
            </p>
          )}
        </div>
      </Link>

      {/* 底部一行：状态（只有自己的帖子才显示）／点赞／表情总数 */}
      <div className="mt-auto flex items-center gap-2 border-t border-white/70 px-3.5 py-2.5">
        {showStatus && post.status !== 'published' ? (
          <StatusChip status={post.status} />
        ) : (
          <ReactionSummary post={post} />
        )}
        <button
          type="button"
          onClick={() => onToggleReaction?.(post.id)}
          aria-pressed={!!post.liked}
          title={post.liked ? '取消点赞' : '点赞'}
          className={cx('student-like ml-auto', post.liked && 'student-like--on')}
        >
          <Icon name="ThumbsUp" className="h-3.5 w-3.5" strokeWidth={2} />
          <span className="tabular-nums">{post.likes}</span>
        </button>
      </div>
    </GlassCard>
  )
}
