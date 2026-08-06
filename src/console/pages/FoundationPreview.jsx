import { Link } from 'react-router-dom'
import { Icon, cx } from '../../components/ui.jsx'
import { GlassPanel, GlassCard } from '../components/Glass.jsx'
import { BarProgress, RingProgress } from '../components/Progress.jsx'
import { useConsole } from '../state/ConsoleContext.jsx'

// Stage 1 临时页：验收视觉地基（玻璃三档实感、条状/环状进度、条内标记线、减少动态效果开关）。
// Stage 2 交付景观首页后，本页会被真正的 #/console/home 取代。
export default function FoundationPreview() {
  const { prefs, togglePref } = useConsole()

  return (
    <div className="relative z-10 min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <div className="console-enter flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="eyebrow text-brand-600">STAGE 1 · 视觉地基</span>
            <h1 className="font-serif text-display font-bold text-ink-900 mt-2 tracking-tightish">
              书香玻璃底座已就位
            </h1>
            <p className="text-ink-500 text-base mt-3 max-w-xl leading-relaxed">
              景观首页、一级栏与二级栏在 Stage 2 交付。本页只用于确认背景分层、玻璃实感档位、进度条与
              「减少动态效果」是否符合母版要求。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/console/login"
              className="inline-flex items-center gap-2 rounded-xl border border-ink-150 bg-white/80 px-4 py-2.5 text-caption font-semibold text-ink-700 backdrop-blur-md transition hover:border-brand-300 hover:text-brand-600"
            >
              <Icon name="LogIn" className="w-4 h-4" />
              回到登录页
            </Link>
            <button
              type="button"
              onClick={() => togglePref('reduceMotion')}
              className={cx(
                'inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-caption font-semibold transition',
                prefs.reduceMotion
                  ? 'bg-brand-500 text-white shadow-glow'
                  : 'border border-ink-150 bg-white/80 text-ink-700 backdrop-blur-md hover:border-brand-300 hover:text-brand-600',
              )}
            >
              <Icon name={prefs.reduceMotion ? 'ZapOff' : 'Zap'} className="w-4 h-4" />
              减少动态效果{prefs.reduceMotion ? '：开' : '：关'}
            </button>
          </div>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-3">
          {[
            ['solid', '主内容区', '白 92%，信息密度最高，文字对比最强'],
            ['rail', '一级功能栏', '白 80%，稳定不重做，背景仍可感知'],
            ['sub', '二级功能栏', '白 68%，比主内容更透，层级向后退'],
          ].map(([tone, title, desc]) => (
            <GlassPanel key={tone} tone={tone} sheen className="console-enter rounded-xl p-5">
              <div className="flex items-center gap-2">
                <Icon name="Layers" className="w-4 h-4 text-brand-500" />
                <h2 className="text-title font-semibold text-ink-900">{title}</h2>
              </div>
              <p className="text-caption text-ink-500 mt-2 leading-relaxed">{desc}</p>
            </GlassPanel>
          ))}
        </div>

        <GlassPanel tone="solid" className="console-enter mt-6 rounded-2xl p-6 sm:p-7">
          <h2 className="font-serif text-h2 font-bold text-ink-900">进度表达</h2>
          <p className="text-caption text-ink-500 mt-2">
            同一组额度数据支持条状与环状切换；时间趋势仍用折线或面积图，不强行都画成环。高光只扫过已填充部分，
            空轨道不发光。
          </p>
          <div className="mt-6 grid gap-7 lg:grid-cols-[1.4fr_1fr]">
            <div className="space-y-5">
              <BarProgress label="三年级一班 · 本周 AI 额度" value={63} hint="6 天 15 小时后重置" />
              <BarProgress label="《牧羊少年奇幻之旅》阅读进度" value={72} tone="success" hint="蓝色标记线是教师建议位置与书签，必须落在进度条内" markers={[{ at: 45, title: '教师建议位置', color: '#2E51DB' }, { at: 88, title: '我的书签', color: '#F2851E' }]} />
              <BarProgress label="额度即将耗尽" value={92} tone="warning" size="lg" hint="触限 8 人，点击可下钻到额度管理" />
            </div>
            <div className="flex flex-wrap items-start justify-center gap-8">
              <RingProgress value={63} label="班级额度" sub="剩余" />
              <RingProgress value={28} label="触限占比" sub="8/32 人" tone="warning" />
            </div>
          </div>
        </GlassPanel>

        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['BookOpen', '在读书目', '12', '本周 +2'],
            ['Users', '活跃学生', '28', '占全班 88%'],
            ['MessageSquare', 'AI 对话', '146', '较上周 +12%'],
            ['ShieldAlert', '待处理安全事件', '1', '剩余 4 小时'],
          ].map(([icon, label, value, note]) => (
            <GlassCard key={label} className="console-enter p-4">
              <div className="flex items-center gap-2 text-ink-500">
                <Icon name={icon} className="w-4 h-4 text-brand-500" />
                <span className="text-caption">{label}</span>
              </div>
              <p className="text-display font-bold text-ink-900 mt-2 tabular-nums leading-none">{value}</p>
              <p className="text-micro text-ink-400 mt-2">{note}</p>
            </GlassCard>
          ))}
        </div>
      </div>
    </div>
  )
}
