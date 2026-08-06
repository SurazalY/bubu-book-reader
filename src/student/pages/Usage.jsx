import { Icon } from '../../components/ui.jsx'
import { GlassCard, GlassPanel } from '../components/Glass.jsx'
import { RingProgress } from '../components/Progress.jsx'
import PageHead from '../components/PageHead.jsx'
import { useStudent } from '../state/StudentContext.jsx'
import useEyeCarePrivacy from '../state/useEyeCarePrivacy.js'
import useReadingStatistics from '../state/useReadingStatistics.js'

const AI_NAME = '读伴 AI'
const READING_GLOSSARY = [
  { term: '有效阅读', icon: 'BookOpen', desc: '只计算前台、亮屏且持续有阅读交互的时间，重叠设备区间只算一次。' },
  { term: '强制休息', icon: 'Coffee', desc: '由服务端护眼策略触发；断网时会沿用最近一次仍有效的休息约束。' },
]

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function formatTime(value) {
  if (!value || Number.isNaN(Date.parse(value))) return '由服务端策略决定'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric',
  }).format(new Date(value))
}

// 用量与护眼（规格 §11）。
// 红线 9：不出现 Token、模型价格与费用，额度只讲「剩余次数 + 用量比例 + 恢复时间」。
// 强制休息提示也在这一页：`?rest=1` 是截图与验收用的演示态，产品里由连续时长自动触发。
export default function Usage() {
  const { ai, runtime } = useStudent()
  const workspaceId = runtime.data?.workspaceId
  const statistics = useReadingStatistics(workspaceId)
  const privacy = useEyeCarePrivacy({ workspaceId })
  const quota = ai?.quota || {}
  const remaining = numberOrNull(quota.remaining)
  const usagePercent = Math.min(100, numberOrNull(quota.usagePercent) ?? 0)
  const eyeCare = statistics.data?.eyeCare || {}
  const enforcement = privacy.eyeCare?.enforcement || {}
  const resting = enforcement.status === 'forced_rest' || eyeCare.status === 'forced_rest'
  const continuousMinutes = Math.round((numberOrNull(eyeCare.continuousEyeSeconds) || 0) / 60)
  const todayMinutes = Math.round((numberOrNull(eyeCare.todayValidEyeSeconds) || 0) / 60)
  const weekMinutes = Math.round((numberOrNull(eyeCare.weekValidEyeSeconds) || 0) / 60)
  const forcedRestUntil = enforcement.forcedRestUntil || eyeCare.forcedRestUntil

  return (
    <div className="flex-1 space-y-4">
      <PageHead
        title="用量与护眼"
        desc={`${AI_NAME}的可用次数和护眼状态都由服务端实时计算，护眼提醒不会阻止你继续看书。`}
      />

      {resting && (
        <GlassPanel tone="solid" className="student-enter student-rest rounded-2xl p-6">
          <div className="flex gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#FBE7CF] text-[#B8752A]">
              <Icon name="Coffee" className="h-6 w-6" strokeWidth={1.9} />
            </span>
            <div>
              <h2 className="font-serif text-h3 font-bold text-ink-900">先让眼睛休息一下</h2>
              <p className="mt-1.5 text-caption leading-relaxed text-ink-600">护眼策略已进入强制休息状态，倒计时结束后会自动恢复。</p>
              <p className="mt-1 text-caption leading-relaxed text-ink-500">你仍可以浏览书架和已保存的内容，阅读计时不会继续累计。</p>
              <p className="mt-2.5 text-micro font-semibold text-ink-700">预计恢复：{formatTime(forcedRestUntil)}</p>
            </div>
          </div>
        </GlassPanel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
          <h2 className="font-serif text-h3 font-bold text-ink-900">问{AI_NAME}的次数</h2>
          <div className="mt-4 flex flex-wrap items-center gap-6">
            {/* 环里的百分比说的是「剩余次数占每天上限」，
                和右边「今日用量额度已用 34%」不是一回事，所以标签必须把话说全，
                否则两个百分比摆在一起学生根本分不清（逐张自检抓到）。 */}
            <RingProgress
              value={Math.max(0, 100 - usagePercent)}
              label={remaining === null ? '正在读取可用次数' : `还能问 ${remaining} 次`}
              sub={quota.resetAt ? `恢复于 ${formatTime(quota.resetAt)}` : '由服务端额度策略控制'}
              tone="mint"
            />
            <div className="min-w-[180px] flex-1 space-y-2.5">
              <Row label="当前可用" value={remaining === null ? '服务端未返回' : `${remaining} 次`} />
              <Row label="今日用量额度" value={quota.usagePercent === null || quota.usagePercent === undefined ? '服务端未返回' : `已用 ${usagePercent}%`} />
              <Row label="什么时候恢复" value={formatTime(quota.resetAt)} />
            </div>
          </div>
          <div className="student-meter-track mt-4 h-2 w-full overflow-hidden rounded-full">
            <div className="student-usage-fill h-full rounded-full" style={{ width: `${usagePercent}%` }} />
          </div>
          <p className="mt-2 text-micro text-ink-400">可用次数、恢复时间和用量比例只使用服务端返回的数据，不在页面端猜测每日上限。</p>
        </GlassPanel>

        <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
          <h2 className="font-serif text-h3 font-bold text-ink-900">护眼</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Meter
              label="这次已经连续读了"
              value={`${continuousMinutes} 分钟`}
              percent={resting ? 100 : 0}
              note={resting ? `当前处于强制休息，预计 ${formatTime(forcedRestUntil)} 自动恢复` : '阈值由服务端策略执行，页面不自行推算。'}
            />
            <Meter
              label="今天累计"
              value={`${todayMinutes} 分钟`}
              percent={resting ? 100 : 0}
              note={`本周有效用眼 ${weekMinutes} 分钟，后台停留和无交互不会计入。`}
            />
          </div>
          <p className="mt-3.5 rounded-xl bg-white/58 px-4 py-3 text-micro leading-relaxed text-ink-500">
            当前状态：{resting ? '正在强制休息' : (eyeCare.status === 'normal' ? '正常' : '正在读取')}{privacy.eyeCare?.offline ? '；网络暂不可用时会沿用最近一次有效护眼状态。' : ''}
          </p>
        </GlassPanel>
      </div>

      <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
        <h2 className="font-serif text-h3 font-bold text-ink-900">这两个时间怎么算的</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {READING_GLOSSARY.map((g) => (
            <GlassCard key={g.term} className="flex gap-3 px-4 py-3.5">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/80 text-ink-500">
                <Icon name={g.icon} className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-title font-semibold text-ink-900">{g.term}</span>
                <span className="mt-0.5 block text-caption leading-relaxed text-ink-500">{g.desc}</span>
              </span>
            </GlassCard>
          ))}
        </div>
        <p className="mt-3 text-micro text-ink-400">
          次数和护眼时间都是学校设置的，不涉及任何付费；这里也不会出现价格或消耗量。
        </p>
      </GlassPanel>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/60 pb-1.5">
      <span className="text-caption text-ink-500">{label}</span>
      <span className="text-caption font-semibold text-ink-900 tabular-nums">{value}</span>
    </div>
  )
}

function Meter({ label, value, percent, note }) {
  return (
    <GlassCard className="px-4 py-3.5">
      <span className="text-micro text-ink-500">{label}</span>
      <p className="mt-1 font-serif text-h2 font-bold text-ink-900 tabular-nums">{value}</p>
      <div className="student-meter-track mt-2.5 h-2 w-full overflow-hidden rounded-full">
        <div className="student-eye-fill h-full rounded-full" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-2 text-micro leading-relaxed text-ink-400">{note}</p>
    </GlassCard>
  )
}
