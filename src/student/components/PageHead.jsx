import { Link } from 'react-router-dom'
import { Icon } from '../../components/ui.jsx'
import { GlassPanel } from './Glass.jsx'

// Stage 6 的九个二级页共用页头：返回胶囊 + 标题 + 一句口径说明 + 右侧操作位。
// 抽出来是因为二级页没有底栏，返回入口必须每页都在同一个位置，
// 否则学生每进一个页面都要重新找「怎么回去」。
export default function PageHead({ back = '/student/me', backLabel = '返回个人主页', title, desc, children }) {
  return (
    <>
      <div className="student-enter flex items-center gap-3">
        <Link
          to={back}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/72 px-4 py-2 text-caption font-semibold text-ink-600 transition hover:bg-white/90 hover:text-ink-900"
        >
          <Icon name="ArrowLeft" className="h-4 w-4" />
          {backLabel}
        </Link>
      </div>
      <GlassPanel tone="solid" sheen className="student-enter rounded-2xl px-6 py-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-serif text-h1 font-bold text-ink-900">{title}</h1>
            {desc ? <p className="mt-1.5 max-w-[62ch] text-caption text-ink-500">{desc}</p> : null}
          </div>
          {children}
        </div>
      </GlassPanel>
    </>
  )
}
