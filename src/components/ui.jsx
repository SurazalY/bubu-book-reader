import { Link } from 'react-router-dom'
import * as Lucide from 'lucide-react'

import { useProtectedAssetUrl, resolveCoverAssetUrl } from '../shared/useProtectedAssetUrl.js'
import { useOptionalStudent } from '../student/state/StudentContext.jsx'

const genreMeta = {
  故事: { color: '#FF8A3D', soft: '#FFF1E6' },
  经典名著: { color: '#3B66F5', soft: '#EEF2FF' },
  科普: { color: '#2FA38C', soft: '#EAF7F4' },
  '国学·传统': { color: '#8B5CF6', soft: '#F3EEFF' },
  '红色·人物': { color: '#E25555', soft: '#FFF0F0' },
}

export const cx = (...a) => a.filter(Boolean).join(' ')

// 动态 lucide 图标
export function Icon({ name, className, ...props }) {
  const C = Lucide[name] || Lucide.Circle
  return <C className={className} {...props} />
}

// eyebrow 小标签（全大写 + 字间距）
export function Eyebrow({ children, className }) {
  return <span className={cx('eyebrow text-brand-600', className)}>{children}</span>
}

// 体裁色标签
export function GenreTag({ genre, className }) {
  const m = genreMeta[genre] || { color: '#3B66F5', soft: '#EEF2FF' }
  return (
    <span
      className={cx('inline-flex items-center px-2.5 py-1 rounded-full text-micro font-semibold', className)}
      style={{ color: m.color, background: m.soft }}
    >
      {genre}
    </span>
  )
}

// 通用节标题
export function SectionHead({ eyebrow, title, desc, center, className }) {
  return (
    <div className={cx('max-w-2xl', center && 'mx-auto text-center', className)}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="font-serif text-h1 sm:text-display font-bold text-ink-900 mt-3 tracking-tightish">{title}</h2>
      {desc && <p className="text-ink-500 text-base sm:text-title mt-4 leading-relaxed">{desc}</p>}
    </div>
  )
}

// 书封：受保护封面走共享 hook 的 fetch + blob；失败时露出渐变文字封。
export function BookCover({ book, className }) {
  const student = useOptionalStudent()
  const [c1, c2] = Array.isArray(book?.cover) ? book.cover : ['#4C7DFF', '#3B66F5']
  const { objectUrl, failed } = useProtectedAssetUrl(resolveCoverAssetUrl(book), student?.runtime?.data?.workspaceId)
  const available = Boolean(objectUrl) && !failed
  return (
    <div
      className={cx('relative aspect-[3/4] rounded-xl overflow-hidden shadow-e2', className)}
      style={{ backgroundImage: `linear-gradient(150deg, ${c1}, ${c2})` }}
    >
      {/* 渐变文字封：封面图未到位 / 加载失败时兜底，永远美观 */}
      <div className="absolute inset-0 bg-hero-sheen opacity-70" />
      <div className="absolute left-0 inset-y-0 w-1.5 bg-white/25" />
      <div className="absolute inset-0 p-4 flex flex-col">
        <span className="text-[11px] font-semibold text-white/90 tracking-widest">{book?.genre}</span>
        <div className="mt-auto">
          <h3 className="font-serif text-white text-xl leading-tight font-bold drop-shadow-sm">{book?.title}</h3>
          <p className="text-white/85 text-xs mt-1.5">{book?.author}</p>
        </div>
      </div>
      {available && (
        <img
          src={objectUrl}
          alt={book?.title}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
    </div>
  )
}

// 书目卡（封面 + 信息），统一先进入书籍详情页。
export function BookCard({ book }) {
  return (
    <Link to={`/student/books/${book.id}`} className="group block">
      <BookCover book={book} className="transition-shadow duration-220 group-hover:shadow-e3" />
      <div className="mt-3 px-0.5">
        <h3 className="font-serif text-title font-bold text-ink-900 transition-colors group-hover:text-brand-600">
          {book.title}
        </h3>
        <p className="text-caption text-ink-500 mt-1">
          {book.author} · {book.grade}
        </p>
      </div>
    </Link>
  )
}

// 按钮
export function PrimaryButton({ to, children, className, ...props }) {
  const cls = cx(
    'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-brand-grad text-white text-title font-semibold shadow-glow transition hover:brightness-105 active:scale-[0.98]',
    className,
  )
  return to ? <Link to={to} className={cls} {...props}>{children}</Link> : <button className={cls} {...props}>{children}</button>
}

export function GhostButton({ to, children, className, ...props }) {
  const cls = cx(
    'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-surface text-ink-700 text-title font-semibold border border-ink-150 shadow-e1 transition hover:border-brand-300 hover:text-brand-600',
    className,
  )
  return to ? <Link to={to} className={cls} {...props}>{children}</Link> : <button className={cls} {...props}>{children}</button>
}
