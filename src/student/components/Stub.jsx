import { Link } from 'react-router-dom'
import { Icon } from '../../components/ui.jsx'
import { GlassPanel } from './Glass.jsx'

// 未开工页面的可达壳：路由必须通、页面必须能打开，不允许死入口。
// 面向内部评审，所以这里明确写「本页在第 N 阶段实现」，不装成已完成功能。
export default function Stub({ title, stage, points = [], back = '/student/home' }) {
  return (
    <GlassPanel tone="solid" sheen className="student-enter flex flex-1 flex-col rounded-2xl px-8 py-7">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="font-serif text-h1 font-bold text-ink-900">{title}</h1>
          <p className="mt-2 text-caption text-ink-500">本页将在{stage}完成，现在先把路由与外壳接通。</p>
        </div>
        <Link
          to={back}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/70 px-4 py-2 text-caption font-semibold text-ink-600 transition hover:text-ink-900"
        >
          <Icon name="ArrowLeft" className="h-4 w-4" />
          返回
        </Link>
      </div>
      {points.length > 0 && (
        <ul className="mt-6 grid content-start gap-2 sm:grid-cols-2">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-2 rounded-lg bg-white/55 px-3.5 py-2.5">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#7FD3BE]" />
              <span className="text-caption text-ink-600">{p}</span>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  )
}
