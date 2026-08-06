import { cx, Icon } from '../../components/ui.jsx'
import { GlassCard } from './Glass.jsx'
import { StatusTag } from './Controls.jsx'

const POST_STATUS = {
  pending: { label: '待审核', tone: 'warning' },
  published: { label: '已发布', tone: 'success' },
  rejected: { label: '已驳回', tone: 'danger' },
  revise: { label: '退回修改', tone: 'accent' },
  offline: { label: '已下架', tone: 'muted' },
}

const COVERS = {
  paper: ['#EADFC8', '#CFC0A0'],
  night: ['#3D4A6B', '#26314A'],
  leaf: ['#CFE3CB', '#A6C6A0'],
  dusk: ['#F0D2BC', '#D8A98C'],
  ink: ['#D8DCE6', '#B3BACB'],
}

const coverColors = (post) => COVERS[post.cover?.tone] || COVERS.paper
const postAuthor = (post) => post.author || null
const postBook = (post) => post.book || null
const postClass = (post) => post.class || null

// 社区内容卡。学生端尚未开工，本分支先做主体设计；
// 组件刻意只依赖「统一帖子结构」，合并时两侧比一比就能选一个成为共享组件。
//
// 卡片要素（交付说明 §5.7）：封面图或文本封面、作者、班级、关联书籍、引文、
// 发布时间、友善互动数量、当前审核状态。学生社区没有评论与点踩，所以只有一个互动数。
export default function CommunityPostCard({ post, checked, onCheck, onOpen, showScope = false }) {
  const st = POST_STATUS[post.status] || { label: post.status || '状态未知', tone: 'muted' }
  const author = postAuthor(post)
  const klass = postClass(post)
  const book = postBook(post)
  const [c1, c2] = coverColors(post)
  const dimmed = post.status === 'offline' || post.status === 'rejected'

  return (
    <GlassCard
      className={cx(
        'p-0 overflow-hidden rounded-xl min-w-0 flex flex-col transition',
        checked ? 'ring-2 ring-brand-300 border-brand-200' : 'hover:shadow-e2',
      )}
    >
      {/* 封面：图片帖用渐变占位（正式素材未交付），文本帖把引文印在封面上 */}
      <button
        type="button"
        onClick={onOpen}
        className="relative block w-full h-[104px] text-left"
        style={{ backgroundImage: `linear-gradient(140deg, ${c1}, ${c2})`, filter: dimmed ? 'saturate(45%)' : 'none' }}
        title="打开审核详情"
      >
        <span className="console-sheen absolute inset-0" aria-hidden="true" />
        {/* 底部压暗：浅米色封面上的白字没它根本读不清 */}
        <span
          className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/45 via-black/15 to-transparent"
          aria-hidden="true"
        />
        {post.cover?.type === 'image' ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-white/85">
            <Icon name="Image" className="w-5 h-5" strokeWidth={1.7} />
            <span className="text-[10.5px]">学生上传的图片</span>
          </span>
        ) : (
          post.quote && (
            <span className="absolute inset-x-3 bottom-2.5 text-white text-[11.5px] leading-snug line-clamp-2 drop-shadow">
              「{post.quote.text}」
            </span>
          )
        )}

        {onCheck && (
          <span
            role="checkbox"
            aria-checked={checked}
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onCheck()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                onCheck()
              }
            }}
            aria-label={`选择《${post.title}》`}
            className={cx(
              'absolute left-2.5 top-2.5 w-4 h-4 rounded-[5px] border flex items-center justify-center transition',
              checked ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white/85 border-white/90',
            )}
          >
            {checked && <Icon name="Check" className="w-3 h-3" strokeWidth={3} />}
          </span>
        )}

        <span className="absolute right-2.5 top-2.5 flex items-center gap-1.5">
          {post.pinned && (
            <span className="w-[18px] h-[18px] rounded-full bg-white/90 text-accent-600 flex items-center justify-center">
              <Icon name="Pin" className="w-3 h-3" strokeWidth={2.2} />
            </span>
          )}
          {post.featured && (
            <span className="w-[18px] h-[18px] rounded-full bg-white/90 text-warning-600 flex items-center justify-center">
              <Icon name="Star" className="w-3 h-3" strokeWidth={2.2} />
            </span>
          )}
        </span>
      </button>

      <div className="p-3 flex-1 flex flex-col min-w-0">
        <button type="button" onClick={onOpen} className="text-left min-w-0">
          <p className="text-[13.5px] font-semibold text-ink-900 truncate">{post.title}</p>
          <p className="text-[12px] text-ink-600 leading-relaxed mt-1 line-clamp-2">{post.text}</p>
        </button>

        <p className="text-[11.5px] text-ink-500 mt-2 truncate">
          {author?.name} · {klass?.name}
          {showScope && <span className="text-ink-400"> · {post.scope === 'school' ? '学校社区' : '班级社区'}</span>}
        </p>
        <p className="text-[11.5px] text-ink-400 truncate">《{book?.title}》</p>

        <div className="mt-2.5 pt-2.5 border-t border-ink-150/70 flex items-center gap-2">
          <StatusTag tone={st.tone} dot>
            {st.label}
          </StatusTag>
          <div className="flex-1" />
          <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-500">
            <Icon name="Heart" className="w-3.5 h-3.5 text-accent-500" strokeWidth={1.9} />
            <span className="tabular-nums">{post.kudos}</span>
          </span>
          <span className="text-[11px] text-ink-400 whitespace-nowrap">{post.at}</span>
        </div>
      </div>
    </GlassCard>
  )
}
