import { useState, useRef, useEffect } from 'react'
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom'
import { AlertCircle, Search, BookOpen, ArrowRight, Sparkles, X, Send, Compass } from 'lucide-react'
import { site, nav, footer } from '../data/site.js'
import { cx } from './ui.jsx'
import { useAIChat } from '../lib/useAIChat.js'

function TopBar({ aiOpen, onToggleAi }) {
  return (
    <header className="sticky top-0 z-40">
      <div className="brand-hairline" />
      <div className="bg-surface/85 backdrop-blur-md border-b border-hair">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center gap-7">
          <Link to="/" className="flex items-center gap-2.5 shrink-0">
            <span className="grid place-items-center w-9 h-9 rounded-xl bg-brand-grad text-white shadow-glow">
              <BookOpen className="w-5 h-5" />
            </span>
            <span className="font-serif text-h3 font-bold text-ink-900">{site.name}</span>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                className={({ isActive }) =>
                  cx(
                    'px-3.5 py-2 rounded-lg text-sm font-medium transition-colors',
                    isActive ? 'text-brand-600 bg-brand-50' : 'text-ink-600 hover:text-ink-900 hover:bg-ink-50',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled
              title="搜索暂未开放"
              aria-label="搜索暂未开放"
              className="grid place-items-center w-9 h-9 rounded-lg text-ink-500 transition-colors disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Search className="w-5 h-5" />
            </button>
            <button
              onClick={onToggleAi}
              className={cx(
                'hidden xl:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition',
                aiOpen ? 'bg-brand-50 text-brand-600' : 'text-ink-600 hover:bg-ink-50',
              )}
            >
              <Sparkles className="w-4 h-4" /> AI 向导
            </button>
            <Link
              to="/library"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-grad text-white text-sm font-semibold shadow-glow hover:brightness-105 transition"
            >
              进入书架 <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </header>
  )
}

// AI 向导按页面给不同的导览提示
const navHints = {
  '/': {
    sub: '逛逛网站 · 找本好书',
    welcome: '嗨！我是整书阅读的 AI 向导 ✨ 想先快速了解这个网站，还是直接找本书开始读？',
    chips: ['介绍这个网站', '帮我找书', '怎么开始阅读'],
  },
  '/library': {
    sub: '帮你找到对的那本书',
    welcome: '我可以按年级、体裁和兴趣帮你找书 📚 想给几年级的孩子、找什么类型的书呢？',
    chips: ['推荐三年级的书', '有哪些科普书', '经典名著'],
  },
  '/resources': {
    sub: '评估与资源导览',
    welcome: '这里是多维成长评估与资源体系 ✨ 想先看五维评估，还是教师赋能？',
    chips: ['五维评估怎么用', '前中后测', '成长报告'],
  },
  '/about': {
    sub: '了解项目',
    welcome: '想了解整书阅读项目的什么呢？项目使命、核心理念，还是背后的科学依据？',
    chips: ['项目使命', '政策背景', '脑科学依据'],
  },
  '/blog': {
    sub: '最新动态导览',
    welcome: '看看项目最近发生了什么？我可以带你快速浏览动态与书评 ✨',
    chips: ['最新动态', '教研心得', '书目推荐'],
  },
}

// pathname → 页面感知 context（page 归一化 + 中文页名）
function navContextOf(pathname) {
  const page = pathname.includes('/library') ? 'library' : pathname === '/' ? 'home' : 'other'
  const pageName = nav.find((n) => (n.to === '/' ? pathname === '/' : pathname.startsWith(n.to)))?.label || '首页'
  return { page, pageName }
}

function AINavSidebar({ onClose }) {
  const { pathname } = useLocation()
  const hint = navHints[pathname] || navHints['/']

  // 初始欢迎消息只提供真实书架入口，避免用旧壳书目冒充正式推荐。
  const { messages, loading, error, send } = useAIChat({
    initial: [{ role: 'assistant', kind: 'welcome', content: hint.welcome }],
    getContext: () => navContextOf(pathname),
  })

  const [input, setInput] = useState('')
  const scrollRef = useRef(null)

  // 新消息 / loading 变化时滚到底
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, loading, error])

  const submit = () => {
    if (!input.trim() || loading) return
    const t = input
    setInput('')
    send(t)
  }

  return (
    <aside className="hidden xl:flex flex-col fixed top-[67px] right-0 bottom-0 w-[360px] z-30 bg-surface border-l border-hair shadow-e3 animate-fade-in">
      {/* 标题栏 */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-hair bg-brand-grad-soft">
        <span className="grid place-items-center w-9 h-9 rounded-xl bg-brand-grad text-white shadow-glow shrink-0">
          <Compass className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-serif font-bold text-ink-900 text-sm leading-tight">AI 向导</p>
          <p className="text-[11px] text-ink-500 truncate">{hint.sub}</p>
        </div>
        <button
          onClick={onClose}
          className="grid place-items-center w-7 h-7 rounded-lg text-ink-400 hover:bg-white/70 hover:text-ink-700 transition"
          title="收起"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {/* 对话区 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5">
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="rounded-2xl rounded-tr-md bg-brand-grad text-white px-3.5 py-2.5 text-sm leading-relaxed max-w-[85%] shadow-glow whitespace-pre-wrap">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex gap-2.5">
              <span className="grid place-items-center w-7 h-7 rounded-lg bg-brand-50 text-brand-600 shrink-0 mt-0.5">
                <Sparkles className="w-4 h-4" />
              </span>
              <div className="rounded-2xl rounded-tl-md bg-surface-soft border border-hair px-3.5 py-2.5 text-sm text-ink-700 leading-relaxed whitespace-pre-wrap">
                {m.content}
                {/* 欢迎消息只提供真实书架入口，不渲染旧壳静态书目。 */}
                {m.kind === 'welcome' && (
                  <div className="mt-2.5 space-y-1.5">
                    <Link
                      to="/student/shelf"
                      className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl bg-surface border border-hair hover:border-brand-300 transition group"
                    >
                      <span className="grid h-8 w-6 place-items-center rounded bg-brand-50 text-brand-600 shrink-0">
                        <BookOpen className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold text-ink-800 group-hover:text-brand-600 truncate">进入真实书架</span>
                        <span className="block text-[11px] text-ink-400">从当前账号可阅读的书目中选择</span>
                      </span>
                    </Link>
                  </div>
                )}
              </div>
            </div>
          ),
        )}
        {/* 思考中 loading 态 */}
        {loading && (
          <div className="flex gap-2.5">
            <span className="grid place-items-center w-7 h-7 rounded-lg bg-brand-50 text-brand-600 shrink-0 mt-0.5">
              <Sparkles className="w-4 h-4" />
            </span>
            <div className="rounded-2xl rounded-tl-md bg-surface-soft border border-hair px-3.5 py-2.5 text-sm text-ink-500 leading-relaxed">
              <span className="inline-flex gap-1 items-center">
                思考中
                <span className="inline-flex gap-0.5">
                  <span className="w-1 h-1 rounded-full bg-ink-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-1 rounded-full bg-ink-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-1 rounded-full bg-ink-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              </span>
            </div>
          </div>
        )}
        {error && (
          <div className="flex gap-2.5" role="alert">
            <span className="grid place-items-center w-7 h-7 rounded-lg bg-amber-50 text-amber-700 shrink-0 mt-0.5">
              <AlertCircle className="w-4 h-4" />
            </span>
            <div className="rounded-2xl rounded-tl-md bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-sm text-amber-900 leading-relaxed">
              <p>{error.message}</p>
              {error.requestId && <p className="mt-1 text-[11px] text-amber-700">请求编号：{error.requestId}</p>}
            </div>
          </div>
        )}
      </div>
      {/* 输入区 */}
      <div className="border-t border-hair p-3 bg-surface">
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {hint.chips.map((c) => (
            <button
              key={c}
              onClick={() => send(c)}
              disabled={loading}
              className="px-2.5 py-1 rounded-full bg-ink-50 text-ink-600 text-[11px] font-medium hover:bg-brand-50 hover:text-brand-600 transition disabled:opacity-50"
            >
              {c}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-ink-150 bg-surface-soft px-3 py-2 focus-within:border-brand-300 transition">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            disabled={loading}
            className="flex-1 bg-transparent text-sm text-ink-700 placeholder:text-ink-400 outline-none disabled:opacity-60"
            placeholder={loading ? '思考中…' : '问我找书、逛网站…'}
          />
          <button
            onClick={submit}
            disabled={loading || !input.trim()}
            className="grid place-items-center w-8 h-8 rounded-xl bg-brand-grad text-white shadow-glow shrink-0 disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}

function Footer() {
  return (
    <footer className="bg-ink-900 text-ink-300">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid place-items-center w-9 h-9 rounded-xl bg-brand-grad text-white">
                <BookOpen className="w-5 h-5" />
              </span>
              <span className="font-serif text-h3 font-bold text-white">{site.name}</span>
            </div>
            <p className="text-sm leading-relaxed text-ink-400 mt-4 max-w-xs">{footer.about}</p>
          </div>
          {footer.cols.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-semibold text-white/90">{col.title}</h4>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l}>
                    <span className="text-sm text-ink-400">{l}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 pt-6 border-t border-white/10 text-caption text-ink-500">{footer.copyright}</div>
      </div>
    </footer>
  )
}

export default function Layout() {
  const [aiOpen, setAiOpen] = useState(true)
  return (
    <div className="min-h-screen flex flex-col bg-canvas">
      <TopBar aiOpen={aiOpen} onToggleAi={() => setAiOpen((v) => !v)} />
      <div className={cx('flex-1 flex flex-col transition-[margin] duration-320', aiOpen && 'xl:mr-[360px]')}>
        <main className="flex-1">
          <Outlet />
        </main>
        <Footer />
      </div>
      {aiOpen && <AINavSidebar onClose={() => setAiOpen(false)} />}
      {!aiOpen && (
        <button
          onClick={() => setAiOpen(true)}
          className="hidden xl:inline-flex items-center gap-2 fixed right-6 bottom-6 z-40 px-5 py-3 rounded-full bg-brand-grad text-white text-title font-semibold shadow-glow animate-float"
        >
          <Compass className="w-5 h-5" /> AI 向导
        </button>
      )}
    </div>
  )
}
