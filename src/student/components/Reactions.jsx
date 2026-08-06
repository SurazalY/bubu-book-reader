import { cx, Icon } from '../../components/ui.jsx'
import { POST_STATUS, REACTIONS, REACTION_MAP, reactionTotal } from '../community/presentation.js'

// 固定友好表情（规格 §9.4，参考图 community/01、02）：
// 聚合成一行胶囊，每个胶囊 = 图标 + 名称 + 次数，自己点过的高亮。
// 刻意的边界：没有点踩、没有攻击性表情、没有「谁点的」名单，也不排名。
export function ReactionRow({ post, onToggle, size = 'md', showAll = true }) {
  const list = showAll ? REACTIONS : REACTIONS.filter((x) => (post.reactions?.[x.key] || 0) > 0).slice(0, 2)
  const small = size === 'sm'
  return (
    <div className={cx('flex flex-wrap items-center', small ? 'gap-1.5' : 'gap-2')}>
      {list.map((x) => {
        const count = post.reactions?.[x.key] || 0
        const on = (post.mine || []).includes(x.key)
        return (
          <button
            key={x.key}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              onToggle?.(x.key)
            }}
            aria-pressed={on}
            title={on ? `取消「${x.label}」` : `给这篇加「${x.label}」`}
            className={cx('student-react', small && 'student-react--sm', on && 'student-react--on')}
          >
            <Icon name={x.icon} className={small ? 'h-3.5 w-3.5' : 'h-4 w-4'} strokeWidth={2} />
            <span>{x.label}</span>
            {count > 0 && <span className="tabular-nums opacity-75">{count}</span>}
          </button>
        )
      })}
    </div>
  )
}

// 卡片上的静态聚合：只显示总次数与出现过的前两种，点进详情才展开全部
export function ReactionSummary({ post }) {
  const total = reactionTotal(post)
  const top = REACTIONS.filter((x) => (post.reactions?.[x.key] || 0) > 0)
    .sort((a, b) => post.reactions[b.key] - post.reactions[a.key])
    .slice(0, 2)
  if (!total) return <span className="text-micro text-ink-300">还没有人回应</span>
  return (
    <span className="inline-flex items-center gap-1.5 text-micro text-ink-500">
      {top.map((x) => (
        <Icon key={x.key} name={REACTION_MAP.get(x.key).icon} className="h-3.5 w-3.5 text-[#2FA38C]" strokeWidth={2} />
      ))}
      <span className="tabular-nums">{total}</span>
      <span>次回应</span>
    </span>
  )
}

// 审核状态标签：颜色之外必须同时有图标与文字（红线 12）
export function StatusChip({ status, className }) {
  const st = POST_STATUS[status]
  if (!st) return null
  return (
    <span className={cx('student-poststatus', `student-poststatus--${st.tone}`, className)}>
      <Icon name={st.icon} className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      {st.label}
    </span>
  )
}
