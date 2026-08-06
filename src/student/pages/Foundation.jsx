import { Link } from 'react-router-dom'
import { Icon, cx } from '../../components/ui.jsx'
import { GlassCard, GlassPanel } from '../components/Glass.jsx'
import { BookProgress, RingProgress } from '../components/Progress.jsx'
import { BrandMark, DiamondRule } from '../components/BrandMark.jsx'
import MascotFrame from '../components/MascotFrame.jsx'
import { useStudent } from '../state/StudentContext.jsx'

// 视觉地基自检页（#/student/foundation，不进导航）：
// 把学生端所有基元摆在一起，方便逐块与母版比对，也让后面几个 Stage 有统一参照。
export default function Foundation() {
  const { prefs, togglePref } = useStudent()

  return (
    <div className="relative z-10 min-h-screen overflow-y-auto px-8 py-8">
      <div className="mx-auto max-w-[1180px] space-y-5">
        <GlassPanel tone="solid" sheen className="student-enter rounded-2xl px-8 py-6">
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-5">
              <BrandMark size={34} textClass="text-h1" />
              <span className="h-9 w-px bg-ink-150" />
              <div>
                <h1 className="font-serif text-h2 font-bold text-ink-900">学生端视觉地基</h1>
                <p className="mt-1 text-caption text-ink-500">
                  奶油白、浅天蓝、淡青绿；背景可感知，玻璃分四档，动效只在出现时播一次。
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => togglePref('reduceMotion')}
                className="inline-flex items-center gap-2.5 rounded-full border border-white/70 bg-white/70 px-4 py-2.5 text-caption font-semibold text-ink-700 transition hover:bg-white/85"
              >
                <span className={cx('student-switch-shell relative h-5 w-9 rounded-full transition', prefs.reduceMotion ? 'bg-[#3E9E8F]' : 'bg-ink-200')}>
                  <span
                    className={cx(
                      'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                      prefs.reduceMotion && 'translate-x-4',
                    )}
                  />
                </span>
                减少动态效果{prefs.reduceMotion ? '已开' : '已关'}
              </button>
              <Link
                to="/student/login"
                className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/70 px-4 py-2.5 text-caption font-semibold text-ink-600 transition hover:text-ink-900"
              >
                <Icon name="ArrowLeft" className="h-4 w-4" />
                返回登录
              </Link>
            </div>
          </div>
        </GlassPanel>

        {/* 这一节故意不包在实心面板里：透明度堆在白底上会把分档差异压平，
            必须直接铺在背景上，才能看出「底栏最透、浮层略实」的真实关系 */}
        <Section bare title="玻璃分档" desc="主内容最实 → 卡片 → 底栏最透 → 浮层略实；面板之间留缝隙露出背景。">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
            {[
              ['solid', '主内容 92%', '书页容器、页面主面板'],
              ['card', '卡片 86%', '书籍卡、书单卡、数据卡'],
              ['nav', '底栏 70%', '底部一级导航'],
              ['float', '浮层 94%', '选文工具栏、弹窗、菜单'],
              ['crystal', '极轻 16%', '登录卡片，只靠白描边成立'],
            ].map(([tone, name, use]) => (
              <GlassPanel key={tone} tone={tone} className={cx('rounded-xl px-4 py-5', tone === 'crystal' && 'student-crystal-card')}>
                <p className="text-title font-semibold text-ink-900">{name}</p>
                <p className="mt-1.5 text-micro leading-relaxed text-ink-500">{use}</p>
              </GlassPanel>
            ))}
          </div>
        </Section>

        {/* 进度条 */}
        <Section
          title="阅读进度与书签"
          desc="已读绿荧光段与未读淡粉段在同一条带内；书签是轨道内部的蓝色细线，位置相近时聚合；完全未读不画进度条。"
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: '常规进度', percent: 56, page: 132, totalPages: 236, bookmarks: [{ at: 22, page: 52 }, { at: 74, page: 175 }] },
              { label: '书签聚合（5 个）', percent: 68, page: 160, totalPages: 236, bookmarks: [18, 20, 21, 62, 88].map((at, i) => ({ at, page: 40 + i * 12 })) },
              { label: '刚读完', percent: 100, page: 236, totalPages: 236, bookmarks: [{ at: 96, page: 228 }] },
              { label: '尚未开始', percent: 0, page: 0, totalPages: 236, bookmarks: [] },
            ].map((row) => (
              <GlassCard key={row.label} className="px-5 py-4">
                <p className="mb-3 text-caption font-semibold text-ink-700">{row.label}</p>
                <BookProgress {...row} />
              </GlassCard>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-8">
            <RingProgress value={64} label="今日 AI 剩余额度" sub="剩 9 轮" tone="mint" />
            <RingProgress value={38} label="今日护眼余量" sub="还可 22 分钟" tone="sky" />
            <div className="flex-1 rounded-xl bg-white/50 px-5 py-4 text-caption leading-relaxed text-ink-500">
              环形只给「总量固定」的数据（额度、护眼余量）；周期趋势用折线或柱状，不强行画成环。
              学生侧永远不显示 Token、模型价格与实际费用。
            </div>
          </div>
        </Section>

        {/* 控件 */}
        <Section title="基础控件" desc="大容器舒展圆角，输入与按钮更紧，胶囊只给状态、筛选与短操作。">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="student-primary-btn rounded-[18px] px-7 py-3 text-title font-semibold text-white">
              主按钮
            </button>
            <button type="button" className="rounded-[18px] border border-white/75 bg-white/70 px-7 py-3 text-title font-semibold text-ink-700 transition hover:bg-white/85">
              次按钮
            </button>
            <span className="rounded-full bg-[#E6F6F1] px-3.5 py-1.5 text-caption font-semibold text-[#2F8375]">班级共读</span>
            <span className="rounded-full bg-[#EDF3FE] px-3.5 py-1.5 text-caption font-semibold text-[#3765C4]">已下载</span>
            <span className="rounded-full bg-[#FCF1DE] px-3.5 py-1.5 text-caption font-semibold text-[#A8721E]">审核中</span>
            <span className="rounded-full bg-ink-100 px-3.5 py-1.5 text-caption font-semibold text-ink-400">已结束</span>
            <div className="relative">
              <Icon name="Search" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input className="student-field h-11 w-64 rounded-full border border-white/70 bg-white/60 pl-11 pr-4 text-base text-ink-800 placeholder:text-ink-400 outline-none" placeholder="搜索书名或作者" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-4">
            <GlassCard className="flex flex-1 flex-col items-center gap-2 px-6 py-8">
              <Icon name="BookOpen" className="h-7 w-7 text-ink-300" />
              <p className="text-title font-semibold text-ink-700">这里还没有书</p>
              <p className="text-caption text-ink-500">老师安排新的共读后，书会出现在这里。</p>
            </GlassCard>
            <GlassPanel tone="float" className="flex-1 rounded-2xl px-6 py-5">
              <p className="text-title font-semibold text-ink-900">浮层示例</p>
              <p className="mt-1.5 text-caption leading-relaxed text-ink-500">
                浮层比所在页面略实，出现时轻微上浮淡入，后景只做轻微虚化，不做全屏重模态。
              </p>
            </GlassPanel>
          </div>
        </Section>

        {/* 业务语义色 */}
        <Section title="业务语义色（主题不得覆盖）" desc="所有重要状态同时给文字或图标，不能只依赖颜色。">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[
              ['学生选区', '淡青蓝半透明底', 'linear-gradient(90deg, rgba(150,214,235,0.55), rgba(150,214,235,0.35))'],
              ['教师选区', '淡紫上下粗线 + 教师图标', 'linear-gradient(180deg, #C9B8F2 0 3px, transparent 3px calc(100% - 3px), #C9B8F2 calc(100% - 3px) 100%)'],
              ['锁定书籍', '蓝色柔和边缘光', 'radial-gradient(circle at 50% 120%, rgba(107,168,255,0.75), rgba(107,168,255,0.08))'],
              ['同步页面', '紫色柔和边缘光', 'radial-gradient(circle at 50% 120%, rgba(180,171,233,0.85), rgba(180,171,233,0.08))'],
              ['已读进度', '绿色荧光', 'linear-gradient(90deg, #6FE0AE, #35C58F)'],
              ['书签位置', '进度条内部蓝细线', 'linear-gradient(90deg, transparent 46%, #3B77E8 46%, #3B77E8 54%, transparent 54%)'],
            ].map(([name, desc, bg]) => (
              <GlassCard key={name} className="flex items-center gap-4 px-5 py-4">
                <span className="h-10 w-16 shrink-0 rounded-lg border border-white/70" style={{ backgroundImage: bg }} />
                <div>
                  <p className="text-title font-semibold text-ink-900">{name}</p>
                  <p className="mt-0.5 text-micro text-ink-500">{desc}</p>
                </div>
              </GlassCard>
            ))}
          </div>
        </Section>

        {/* 竹娃素材槽 */}
        <Section
          title="AI 阅读伙伴素材槽"
          desc="精灵图按单元格取帧，只按整数倍缩放（192 / 96）并关闭平滑插值；换成学校正式素材时只替换图片与 mascot.json，页面结构不动。"
        >
          <div className="flex flex-wrap items-end gap-6">
            {[
              ['idle', '边缘收叠待机'],
              ['waving', '探出打招呼'],
              ['waiting', '等待回复'],
              ['review', '正在读这一页'],
              ['failed', '暂时用不了'],
            ].map(([state, label]) => (
              <GlassCard key={state} className="flex flex-col items-center gap-2 px-5 pb-4 pt-3">
                <MascotFrame state={state} size={96} animate />
                <p className="text-caption font-semibold text-ink-700">{label}</p>
              </GlassCard>
            ))}
            <GlassCard className="flex flex-col items-center gap-2 px-5 pb-4 pt-3">
              <MascotFrame state="idle" lookDegrees={45} size={96} />
              <p className="text-caption font-semibold text-ink-700">视线 45°（共 16 向）</p>
            </GlassCard>
          </div>
        </Section>

        <DiamondRule className="py-4" />
      </div>
    </div>
  )
}

function Section({ title, desc, children, bare = false }) {
  const head = (
    <>
      <h2 className="font-serif text-h2 font-bold text-ink-900">{title}</h2>
      {desc && <p className="mt-1.5 max-w-3xl text-caption leading-relaxed text-ink-600">{desc}</p>}
      <div className="mt-5">{children}</div>
    </>
  )
  if (bare) return <section className="student-enter px-2 py-2">{head}</section>
  return (
    <GlassPanel tone="solid" className="student-enter rounded-2xl px-8 py-6">
      {head}
    </GlassPanel>
  )
}
