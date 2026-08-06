import { cx, Icon } from '../../components/ui.jsx'

const AVATAR_PRESETS = [
  { id: 'leaf', name: '新叶', icon: 'Leaf', tone: '#CFE0C9' },
  { id: 'star', name: '星光', icon: 'Star', tone: '#F4D8A8' },
  { id: 'book', name: '书页', icon: 'BookOpen', tone: '#D8DCE6' },
  { id: 'cloud', name: '云朵', icon: 'Cloud', tone: '#D5E3F4' },
]

// 头像：只能从学校预设里选（规格 §12，不允许上传图片）。
// 正式素材到位前用「预设配色 + 不同图案」表示。
// 一开始画的是姓名末字，结果六个预设除了颜色完全一样（逐张自检抓到），
// 换成图案后才真的能「选一个」。配色不承载业务语义，
// 所以不会和绿＝已读、粉＝未读、蓝＝锁定书、紫＝同步页撞车。
export default function Avatar({ preset, name = '', size = 48, className }) {
  const p = AVATAR_PRESETS.find((x) => x.id === preset) || AVATAR_PRESETS[0]
  return (
    <span
      className={cx('grid shrink-0 place-items-center rounded-full border border-white/80 shadow-e1', className)}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${p.tone} 0%, rgba(255,255,255,.86) 130%)`,
      }}
      title={`${name ? `${name} · ` : ''}学校预设头像「${p.name}」`}
      aria-label={`学校预设头像：${p.name}`}
    >
      <Icon name={p.icon} className="text-ink-800" style={{ width: size * 0.46, height: size * 0.46 }} strokeWidth={1.8} />
    </span>
  )
}
