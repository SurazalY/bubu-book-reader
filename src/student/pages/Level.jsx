import { Icon } from '../../components/ui.jsx'
import { GlassPanel } from '../components/Glass.jsx'
import PageHead from '../components/PageHead.jsx'
import { useStudent } from '../state/StudentContext.jsx'

// 阅读等级与徽章（规格 §10.4）：只表达自己的成长。
// 红线：没有同学排行、没有每日签到、没有付费特权，也不给任何诊断性标签。
export default function Level() {
  const { student: studentValue } = useStudent()
  const student = studentValue || { level: {} }
  const levelValue = Number(student.level?.value)
  const current = Number.isFinite(levelValue) ? levelValue : null
  const title = student.level?.title || '等级正在读取'

  return (
    <div className="flex-1 space-y-4">
      <PageHead title="阅读等级与徽章" desc="等级由服务端根据真实阅读数据计算；没有收到的数据不会在页面上猜测。" />

      <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-serif text-h3 font-bold text-ink-900">
            {current === null ? '当前等级暂未返回' : `现在是 Lv.${current} · ${title}`}
          </h2>
          <span className="text-caption text-ink-500">等级由学生资料接口下发</span>
        </div>

        {/* 等级阶梯：当前一级同时加粗、加深并写「现在在这里」，不只靠颜色区分 */}
        <ol className="mt-5 space-y-2.5">
          <li className="student-stagger student-level-now flex items-center gap-3.5 rounded-xl px-4 py-3.5" style={{ '--i': 0 }}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#DFF3EC] font-serif text-caption font-bold text-[#2C8B76]">
              {current ?? '—'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-2">
                <span className="text-title font-bold text-ink-900">{title}</span>
                <span className="student-badge">现在在这里</span>
              </span>
              <span className="mt-0.5 block text-micro text-ink-500 tabular-nums">
                当前接口没有下发等级阈值或累计阅读条件，本页不会自行推算。
              </span>
            </span>
          </li>
        </ol>
      </GlassPanel>

      <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-serif text-h3 font-bold text-ink-900">徽章</h2>
          <span className="text-caption text-ink-500 tabular-nums">
            徽章数据尚未由服务端下发
          </span>
        </div>
        <p className="mt-1.5 text-caption text-ink-500">为了不把旧演示徽章误当成真实成长记录，这里只会展示服务端实际下发的徽章。</p>
        <div className="mt-5 flex gap-3.5 rounded-xl bg-white/46 px-4 py-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/72 text-ink-300">
            <Icon name="Award" className="h-5 w-5" strokeWidth={1.9} />
          </span>
          <span className="min-w-0">
            <span className="block text-title font-semibold text-ink-700">暂时没有可展示的真实徽章</span>
            <span className="mt-1 block text-micro leading-relaxed text-ink-500">后端徽章契约开放后，会在这里显示实际达成时间和规则。</span>
          </span>
        </div>
      </GlassPanel>
    </div>
  )
}
