import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, ArrowRight, ArrowUpRight, Calendar, User, Mail } from 'lucide-react'
import { Icon, Eyebrow, SectionHead, PrimaryButton, GhostButton, cx } from '../components/ui.jsx'

// 页面局部数据：项目动态 / 教研心得 / 书目推荐 / 试点纪实
// 真实文章由组员后续提供后在此替换即可，结构不变。

const categories = [
  { key: 'all', name: '全部', color: '#3B66F5', soft: '#EEF2FF' },
  { key: 'news', name: '项目动态', color: '#3B66F5', soft: '#EEF2FF' },
  { key: 'research', name: '教研心得', color: '#12B886', soft: '#E7F8F1' },
  { key: 'recommend', name: '书目推荐', color: '#7A5BFF', soft: '#F0ECFF' },
  { key: 'pilot', name: '试点纪实', color: '#FF9D42', soft: '#FFF1E2' },
]

const catMeta = Object.fromEntries(
  categories.filter((c) => c.key !== 'all').map((c) => [c.key, c]),
)

const posts = [
  {
    id: 'p1',
    cat: 'news',
    featured: true,
    title: '整书阅读平台 v1.0 正式发布：让每个孩子读完一本好书',
    date: '2026-06-12',
    author: '项目组',
    readTime: '6 分钟阅读',
    cover: ['#4C7DFF', '#5B5BF0'],
    icon: 'Rocket',
    excerpt:
      '历经半年打磨，整书阅读平台首个正式版本上线。我们把「读完一本、读懂一本」的理念落进产品：AI 学伴章节陪读、五维成长评估、教师赋能工作台三大模块全部就位。北京培新小学三、四年级两个班级率先接入，首周完整读完率超出预期。这是一个开始——我们想用科学的方式，陪孩子在屏幕时代重新爱上深度阅读。',
  },
  {
    id: 'p2',
    cat: 'research',
    title: '当 AI 学伴遇上《夏洛的网》：一次深度引导式陪读实录',
    date: '2026-06-05',
    author: '李文清 · 教研',
    readTime: '8 分钟阅读',
    cover: ['#12B886', '#0E9E73'],
    icon: 'MessageCircleHeart',
    excerpt:
      '在三年级的一次共读里，我们让 AI 学伴用「慢提问」代替「快答案」。当孩子读到夏洛织出第一个字时，学伴没有解释含义，而是反问「如果是你，你会替朋友做这件事吗」——课堂沉默了三秒，然后炸开了。记录下这次引导的完整设计与课堂反馈。',
  },
  {
    id: 'p3',
    cat: 'pilot',
    title: '培新小学试点首月数据周报：完整阅读率提升 38%',
    date: '2026-05-28',
    author: '数据组',
    readTime: '5 分钟阅读',
    cover: ['#FFB45A', '#F2851E'],
    icon: 'TrendingUp',
    excerpt:
      '试点第一个月，我们追踪了两个班级 64 名学生的阅读行为日志。与基线相比，整本书完整读完率从 41% 提升到 79%，平均单次专注阅读时长增加 11 分钟，「半途放弃」的书目数量下降近一半。背后是分级推荐与章节激励机制在起作用。',
  },
  {
    id: 'p4',
    cat: 'recommend',
    title: '夏日书单 · 8 本适合三到六年级的「读得下去」的好书',
    date: '2026-05-20',
    author: '选书组',
    readTime: '7 分钟阅读',
    cover: ['#8E72FF', '#6585FB'],
    icon: 'BookHeart',
    excerpt:
      '暑假是培养完整阅读习惯的黄金期。我们从「快乐读书吧」书单与世界经典里精挑了 8 本——从《安徒生童话》的温柔到《鲁滨逊漂流记》的孤勇，每一本都附了「为什么孩子读得下去」的导读理由与亲子共读建议。',
  },
  {
    id: 'p5',
    cat: 'research',
    title: '剧本式阅读怎么落地？我们在《西游记》里试了一节课',
    date: '2026-05-12',
    author: '王思雅 · 教研',
    readTime: '9 分钟阅读',
    cover: ['#F2553D', '#B22F1E'],
    icon: 'Drama',
    excerpt:
      '把课文变成剧本，让孩子分角色演「三打白骨精」——听上去热闹，做起来全是坑。如何分组、如何处理「人人都想演孙悟空」、如何把表演收束回文本理解，这篇复盘了完整的课堂流程设计与三个踩过的坑。',
  },
  {
    id: 'p6',
    cat: 'news',
    title: '教师赋能体系上线：三级认证路径，把「不会教」变成可落地流程',
    date: '2026-05-04',
    author: '项目组',
    readTime: '6 分钟阅读',
    cover: ['#3B66F5', '#2641B0'],
    icon: 'GraduationCap',
    excerpt:
      '很多老师认同整书阅读的价值，却卡在「不知道怎么教、怎么评」。我们把方法论拆成「整书阅读实施者 / 指导师 / 教研导师」三级认证，配套书前激活、边读边想、深度讨论、综合表达、评估反思五段式教学循环，让理念有抓手。',
  },
  {
    id: 'p7',
    cat: 'pilot',
    title: '一个不爱读书的男孩，和他读完的第一本书',
    date: '2026-04-26',
    author: '随行记录',
    readTime: '5 分钟阅读',
    cover: ['#15B8C4', '#0E9E9E'],
    icon: 'Heart',
    excerpt:
      '小宇是班里出了名「坐不住」的孩子，从没完整读过一本书。试点第三周，他抱着《十万个为什么》追着问 AI 学伴「真空里点火会怎样」。一个月后，他在读书笔记里写下：「原来书里也有我想知道的东西。」这是我们做这件事最想看见的瞬间。',
  },
  {
    id: 'p8',
    cat: 'recommend',
    title: '二语阅读怎么选书？给中高年级的英文分级读物指南',
    date: '2026-04-18',
    author: '选书组',
    readTime: '7 分钟阅读',
    cover: ['#7A5BFF', '#5B5BF0'],
    icon: 'Languages',
    excerpt:
      '英文阅读不是越早越难越好。我们对接国际阅读分级体系，按五、六年级的语言基础梳理了一份「跳一跳够得着」的英文读物清单，附选书三原则与亲子共读时的常见误区，帮孩子在跨文化阅读里既不挫败也不停滞。',
  },
]

function FeaturedCard({ post }) {
  const m = catMeta[post.cat]
  const [c1, c2] = post.cover
  return (
    <article className="group grid lg:grid-cols-[1.05fr_1fr] rounded-3xl bg-surface border border-hair shadow-e2 overflow-hidden transition hover:shadow-e4 animate-fade-up">
      {/* 渐变封面 */}
      <div
        className="relative min-h-[260px] lg:min-h-[380px] overflow-hidden"
        style={{ backgroundImage: `linear-gradient(140deg, ${c1}, ${c2})` }}
      >
        <div className="absolute inset-0 bg-hero-sheen opacity-80" />
        <div className="absolute inset-0 p-8 sm:p-10 flex flex-col">
          <span className="inline-flex items-center gap-1.5 self-start px-3 py-1.5 rounded-full bg-white/20 backdrop-blur-sm text-white text-micro font-bold tracking-widest uppercase">
            <Sparkles className="w-3.5 h-3.5" /> 置顶
          </span>
          <Icon
            name={post.icon}
            className="w-20 h-20 sm:w-28 sm:h-28 text-white/30 mt-auto transition-transform duration-460 group-hover:scale-110 group-hover:-rotate-3"
          />
        </div>
      </div>
      {/* 文字区 */}
      <div className="p-8 sm:p-10 flex flex-col">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center px-2.5 py-1 rounded-full text-micro font-semibold"
            style={{ color: m.color, background: m.soft }}
          >
            {m.name}
          </span>
          <span className="eyebrow text-ink-400">{post.readTime}</span>
        </div>
        <h2 className="font-serif text-h1 sm:text-display font-bold text-ink-900 mt-4 leading-[1.18] tracking-tightish transition-colors group-hover:text-brand-600">
          {post.title}
        </h2>
        <p className="text-ink-500 text-base sm:text-title mt-4 leading-relaxed">{post.excerpt}</p>
        <div className="mt-auto pt-7 flex items-center justify-between">
          <div className="flex items-center gap-4 text-caption text-ink-500">
            <span className="inline-flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" /> {post.author}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> {post.date}
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 text-brand-600 font-semibold text-title shrink-0 transition-all group-hover:gap-2.5">
            阅读全文 <ArrowRight className="w-4.5 h-4.5" />
          </span>
        </div>
      </div>
    </article>
  )
}

function PostRow({ post, index }) {
  const m = catMeta[post.cat]
  const [c1, c2] = post.cover
  return (
    <article
      className="group grid sm:grid-cols-[200px_1fr] lg:grid-cols-[240px_1fr] gap-5 sm:gap-7 rounded-2xl bg-surface border border-hair p-4 sm:p-5 shadow-e1 transition hover:shadow-e3 hover:-translate-y-0.5 animate-fade-up"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* 缩略渐变色块 */}
      <div
        className="relative h-44 sm:h-full sm:min-h-[150px] rounded-xl overflow-hidden shrink-0"
        style={{ backgroundImage: `linear-gradient(145deg, ${c1}, ${c2})` }}
      >
        <div className="absolute inset-0 bg-hero-sheen opacity-70" />
        <div className="absolute left-0 inset-y-0 w-1.5 bg-white/25" />
        <div className="absolute inset-0 grid place-items-center">
          <Icon
            name={post.icon}
            className="w-14 h-14 text-white/85 transition-transform duration-320 group-hover:scale-110"
          />
        </div>
        <span className="absolute top-3 left-3 inline-flex items-center px-2 py-0.5 rounded-full bg-white/25 backdrop-blur-sm text-white text-[11px] font-bold tracking-wide">
          {m.name}
        </span>
      </div>
      {/* 文字 */}
      <div className="flex flex-col py-1 pr-1 sm:pr-3">
        <div className="flex items-center gap-3 text-caption text-ink-400">
          <span className="eyebrow" style={{ color: m.color }}>{post.date}</span>
          <span className="w-1 h-1 rounded-full bg-ink-200" />
          <span className="eyebrow text-ink-400">{post.author}</span>
        </div>
        <h3 className="font-serif text-h2 font-bold text-ink-900 mt-2.5 leading-snug tracking-tightish transition-colors group-hover:text-brand-600">
          {post.title}
        </h3>
        <p className="text-ink-500 text-sm mt-2.5 leading-relaxed line-clamp-2 sm:line-clamp-3">
          {post.excerpt}
        </p>
        <div className="mt-auto pt-4 flex items-center justify-between">
          <span className="text-caption text-ink-400">{post.readTime}</span>
          <span className="inline-flex items-center gap-1 text-brand-600 font-semibold text-sm transition-all group-hover:gap-2">
            阅读全文 <ArrowUpRight className="w-4 h-4" />
          </span>
        </div>
      </div>
    </article>
  )
}

export default function Blog() {
  const [active, setActive] = useState('all')
  const featured = posts.find((p) => p.featured)
  const rest = posts.filter((p) => !p.featured)
  const filtered = active === 'all' ? rest : rest.filter((p) => p.cat === active)

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-page-glow border-b border-hair">
        <div className="mx-auto max-w-6xl px-6 pt-16 pb-12 animate-fade-up">
          <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-brand-50 text-brand-600 text-caption font-semibold">
            <Sparkles className="w-3.5 h-3.5" /> 项目动态 · 教研日志
          </span>
          <h1 className="font-serif text-display sm:text-display-lg font-bold text-ink-900 mt-5 tracking-tightish leading-[1.14]">
            阅读这件事，<span className="text-brand-600">我们一直在路上</span>
          </h1>
          <p className="text-ink-500 text-title sm:text-h3 mt-5 leading-relaxed max-w-2xl">
            项目进展、教研心得、书目推荐与试点一线的真实记录。每一篇，都是我们陪孩子读完一本好书路上的脚印。
          </p>
        </div>
      </section>

      {/* 置顶大卡 */}
      {featured && (
        <section className="mx-auto max-w-6xl px-6 pt-12">
          <FeaturedCard post={featured} />
        </section>
      )}

      {/* 分类筛选 + 卡片流 */}
      <section className="mx-auto max-w-6xl px-6 py-14">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5">
          <SectionHead eyebrow="最新文章" title="持续更新的阅读手记" />
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => {
              const isActive = active === c.key
              return (
                <button
                  key={c.key}
                  onClick={() => setActive(c.key)}
                  className={cx(
                    'px-4 py-2 rounded-full text-sm font-semibold border transition',
                    isActive
                      ? 'bg-brand-grad text-white border-transparent shadow-glow'
                      : 'bg-surface text-ink-600 border-ink-150 hover:border-brand-300 hover:text-brand-600',
                  )}
                >
                  {c.name}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid gap-5 mt-10">
          {filtered.map((post, i) => (
            <PostRow key={post.id} post={post} index={i} />
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="rounded-2xl bg-surface-soft border border-hair p-12 text-center mt-10">
            <p className="text-ink-500">该分类下暂无文章，敬请期待 ~</p>
          </div>
        )}
      </section>

      {/* 订阅 CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="rounded-3xl bg-brand-grad p-10 sm:p-14 text-white shadow-e3 relative overflow-hidden">
          <div className="absolute inset-0 bg-hero-sheen" />
          <div className="relative grid lg:grid-cols-[1.3fr_1fr] gap-8 items-center">
            <div>
              <Eyebrow className="text-white/80">订阅更新</Eyebrow>
              <h2 className="font-serif text-h1 sm:text-display font-bold mt-3 tracking-tightish leading-tight">
                不错过每一篇教研心得
              </h2>
              <p className="text-white/85 mt-4 leading-relaxed max-w-xl">
                项目动态、试点数据、可直接复用的课堂设计——定期送达，陪你把整书阅读真正落进课堂。
              </p>
            </div>
            <div className="lg:justify-self-end w-full max-w-md">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex items-center gap-2.5 flex-1 px-4 py-3 rounded-xl bg-white/15 backdrop-blur-sm border border-white/25">
                  <Mail className="w-4.5 h-4.5 text-white/80 shrink-0" />
                    <input
                      type="email"
                      disabled
                      title="订阅服务暂未开放，当前不会收集邮箱"
                      placeholder="输入你的邮箱"
                      className="bg-transparent outline-none text-white placeholder:text-white/60 text-sm w-full disabled:cursor-not-allowed disabled:opacity-65"
                    />
                  </div>
                <button
                  type="button"
                  disabled
                  title="订阅服务暂未开放，当前不会收集邮箱"
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white text-brand-600 text-title font-semibold shadow-e2 shrink-0 disabled:cursor-not-allowed disabled:opacity-65"
                >
                  订阅 <ArrowRight className="w-4.5 h-4.5" />
                </button>
              </div>
              <p className="text-white/65 text-caption mt-3">订阅服务暂未开放，当前不会收集邮箱。</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
