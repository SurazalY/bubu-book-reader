import { Link } from 'react-router-dom'
import { Sparkles, ArrowRight, Cpu } from 'lucide-react'
import { Icon, Eyebrow, SectionHead, PrimaryButton, GhostButton } from '../components/ui.jsx'
import { site, heroIntro, heroStats, ideas, boards, modes, missions, evalDims, evalPhases } from '../data/site.js'

function HeroArt() {
  return (
    <div className="relative h-[440px] hidden lg:block animate-fade-in" aria-hidden="true">
      <DecorativeBook className="absolute -right-2 top-2 w-56 rotate-3 animate-float" tone="sun" />
      <DecorativeBook className="absolute left-0 top-24 w-48 -rotate-6 shadow-e3" tone="ink" />
      <DecorativeBook className="absolute right-24 bottom-2 w-44 -rotate-2" tone="sea" />
      <div className="absolute right-8 bottom-24 inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-surface shadow-e3 border border-hair animate-float" style={{ animationDelay: '1s' }}>
        <span className="grid place-items-center w-6 h-6 rounded-full bg-accent-grad text-white"><Sparkles className="w-3.5 h-3.5" /></span>
        <span className="text-caption font-semibold text-ink-700">AI 学伴陪读</span>
      </div>
    </div>
  )
}

function DecorativeBook({ className, tone }) {
  const tones = {
    sun: 'from-[#FFB45A] to-[#FF8A3D]',
    ink: 'from-[#3B66F5] to-[#2641B0]',
    sea: 'from-[#19C0CC] to-[#127E9B]',
  }
  return (
    <div className={`${className} aspect-[3/4] rounded-xl bg-gradient-to-br ${tones[tone]} shadow-e4 p-5`}>
      <div className="h-full rounded-lg border border-white/30 bg-white/10 p-3">
        <span className="block h-2 w-12 rounded-full bg-white/80" />
        <span className="mt-3 block h-1.5 w-full rounded-full bg-white/35" />
        <span className="mt-2 block h-1.5 w-4/5 rounded-full bg-white/35" />
        <span className="mt-2 block h-1.5 w-3/5 rounded-full bg-white/35" />
      </div>
    </div>
  )
}

export default function Home() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-page-glow">
        <div className="mx-auto max-w-6xl px-6 pt-16 pb-20 grid lg:grid-cols-[1.08fr_0.92fr] gap-10 items-center">
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-brand-50 text-brand-600 text-caption font-semibold">
              <Sparkles className="w-3.5 h-3.5" /> {site.badge}
            </span>
            <h1 className="font-serif text-display sm:text-display-lg lg:text-display-xl font-bold text-ink-900 mt-5 tracking-tightish leading-[1.12]">
              让每个孩子<br />读完<span className="text-brand-600">一本好书</span>
            </h1>
            <p className="text-ink-500 text-title sm:text-h3 mt-6 leading-relaxed max-w-xl">{heroIntro}</p>
            <div className="flex flex-wrap gap-3 mt-8">
            <PrimaryButton to="/student/shelf">进入书架 <ArrowRight className="w-4.5 h-4.5" /></PrimaryButton>
              <GhostButton to="/about">了解项目</GhostButton>
            </div>
            <div className="grid grid-cols-4 gap-4 mt-12 max-w-lg">
              {heroStats.map((s) => (
                <div key={s.label}>
                  <div className="font-serif text-h1 font-bold text-ink-900">{s.value}</div>
                  <div className="text-caption text-ink-500 mt-1">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
          <HeroArt />
        </div>
      </section>

      {/* 核心理念 reverse 卡 */}
      <section className="mx-auto max-w-6xl px-6 py-6">
        <div className="rounded-3xl bg-brand-grad p-10 sm:p-14 text-white shadow-e3 relative overflow-hidden">
          <div className="absolute inset-0 bg-hero-sheen" />
          <div className="relative">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-white/80" />
              <Eyebrow className="text-white/80">核心理念</Eyebrow>
            </div>
            <div className="grid md:grid-cols-2 gap-10 mt-6">
              {ideas.map((i) => (
                <div key={i.key}>
                  <h3 className="font-serif text-h2 font-bold">{i.title}</h3>
                  <p className="text-white/85 mt-3 leading-relaxed">{i.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 三大阅读板块 + 五大呈现 */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <SectionHead eyebrow="三大阅读内容板块" title="读什么：整书 · 视频 · 二语" desc="以整本好书为核心，主题视频与二语阅读为两翼，构成完整的多模态阅读内容矩阵。" center />
        <div className="grid md:grid-cols-3 gap-6 mt-12">
          {boards.map((b) => (
            <div key={b.key} className="rounded-2xl bg-surface border border-hair p-7 shadow-e1 transition hover:shadow-e3 hover:-translate-y-0.5">
              <span className="grid place-items-center w-12 h-12 rounded-xl text-white shadow-e2" style={{ backgroundColor: b.color }}>
                <Icon name={b.icon} className="w-6 h-6" />
              </span>
              <h3 className="font-serif text-h2 font-bold text-ink-900 mt-5">{b.name}</h3>
              <p className="eyebrow text-ink-400 mt-1.5">{b.en}</p>
              <p className="text-ink-500 mt-3 leading-relaxed">{b.desc}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-center gap-3 mt-10">
          {modes.map((m) => (
            <div key={m.key} className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-surface border border-hair shadow-e1">
              <Icon name={m.icon} className="w-4 h-4 text-brand-500" />
              <span className="text-sm font-medium text-ink-700">{m.name}</span>
              <span className="text-caption text-ink-400">{m.desc}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 精选书架预览 */}
      <section className="bg-surface-soft border-y border-hair">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="flex items-end justify-between gap-4">
            <SectionHead eyebrow="精选书架" title="读完一本，遇见更大的世界" />
            <Link to="/student/shelf" className="hidden sm:inline-flex items-center gap-1.5 text-brand-600 font-semibold shrink-0 hover:gap-2.5 transition-all">
              进入真实书架 <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="mt-10 rounded-3xl border border-hair bg-page-glow px-8 py-10 text-center shadow-e1">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600">
              <Icon name="BookOpen" className="h-6 w-6" />
            </span>
            <p className="mt-4 font-serif text-h2 font-bold text-ink-900">书目由学校真实书库提供</p>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-ink-500">
              登录后会按当前账号的班级与阅读安排读取可阅读书目，不在主站用静态书单冒充可打开的图书。
            </p>
            <div className="mt-5 flex justify-center">
              <PrimaryButton to="/student/shelf">进入真实书架 <ArrowRight className="w-4.5 h-4.5" /></PrimaryButton>
            </div>
          </div>
        </div>
      </section>

      {/* 五维评估 */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <SectionHead eyebrow="多维成长评估" title="不止于分数，看见完整的成长" desc="以「前测—中测—后测」三段式时间轴，覆盖阅读行为、能力、动力、心理与综合素质五个维度。" center />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mt-12">
          {evalDims.map((d, i) => (
            <div key={d.key} className="rounded-2xl bg-surface border border-hair p-6 shadow-e1">
              <div className="font-serif text-display font-bold text-brand-500/15 leading-none">0{i + 1}</div>
              <h3 className="font-bold text-ink-900 mt-1">{d.title}</h3>
              <p className="text-caption text-ink-500 mt-2 leading-relaxed">{d.desc}</p>
            </div>
          ))}
        </div>
        <div className="grid md:grid-cols-3 gap-5 mt-6">
          {evalPhases.map((p) => (
            <div key={p.key} className="rounded-2xl bg-brand-grad-soft border border-brand-100 p-6">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-full bg-brand-500 text-white text-micro font-bold">{p.name}</span>
                <span className="text-caption text-ink-500">{p.when}</span>
              </div>
              <p className="text-sm text-ink-600 mt-3 leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 五大使命 */}
      <section className="bg-surface-soft border-y border-hair">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <SectionHead eyebrow="核心使命" title="阅读，连接五种成长" center />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-5 mt-12">
            {missions.map((m) => (
              <div key={m.key} className="rounded-2xl bg-surface border border-hair p-6 shadow-e1 text-center">
                <span className="inline-grid place-items-center w-12 h-12 rounded-2xl bg-brand-50 text-brand-600 mx-auto">
                  <Icon name={m.icon} className="w-6 h-6" />
                </span>
                <h3 className="font-serif text-h3 font-bold text-ink-900 mt-4">{m.title}</h3>
                <p className="text-caption text-ink-500 mt-2 leading-relaxed">{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 收尾 CTA */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="rounded-3xl bg-ink-900 p-12 sm:p-16 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-page-glow" />
          <div className="relative">
            <h2 className="font-serif text-display font-bold text-white">开始一段完整的阅读旅程</h2>
            <p className="text-ink-300 mt-4 max-w-xl mx-auto leading-relaxed">
              从一本书开始，让孩子在屏幕时代依然拥有沉静、深度、完整的阅读体验。
            </p>
            <div className="mt-8 flex justify-center">
              <PrimaryButton to="/student/shelf">进入书架 <ArrowRight className="w-4.5 h-4.5" /></PrimaryButton>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
