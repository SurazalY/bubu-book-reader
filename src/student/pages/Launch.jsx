import { useNavigate, useSearchParams } from 'react-router-dom'
import { Icon, cx } from '../../components/ui.jsx'
import { GlassPanel } from '../components/Glass.jsx'
import { BrandMark } from '../components/BrandMark.jsx'
import { DEMO_LAUNCH } from '../data/demoStudent.js'

// 电子书包唤起落地页：电子书包携带免登录凭证、书籍标识与页面位置唤起学生端。
// 规格红线：凭证无效、书籍不可用或版本不一致时必须显示**可恢复说明**，不能是空白页；
// 学生返回后继续电子书包原有课堂流程，所以每种状态都保留「返回电子书包」。
// 真实凭证校验、唤起参数与返回协议属后端／跨端专项，这里只做前端状态壳。

const STATES = {
  ok: {
    tone: 'ok',
    icon: 'BookOpenCheck',
    title: `正在打开《${DEMO_LAUNCH.bookTitle}》`,
    desc: `来自${DEMO_LAUNCH.from}，将直接跳到第 ${DEMO_LAUNCH.page} 页，不需要重新登录。`,
    hint: '如果一直停在这里，先返回电子书包重新点开这本书就行。',
    primary: { label: '继续阅读', to: `/student/reader/demo` },
  },
  invalid: {
    tone: 'warn',
    icon: 'ShieldAlert',
    title: '这个入口暂时用不了',
    desc: '电子书包给的免登录凭证已经过期或不完整，所以没法直接确认你的身份。',
    hint: '回电子书包重新点一次；还不行就用自己的账号登录，一样能读。',
    primary: { label: '用账号登录', to: '/student/login' },
  },
  unavailable: {
    tone: 'warn',
    icon: 'BookX',
    title: '这本书现在不能打开',
    desc: '学校暂时收起了这本书的正文，所以课堂链接打不开它。',
    hint: '阅读时间、书签、摘录和心得都还在阅读足迹里，不会丢。',
    primary: { label: '去书架看看', to: '/student/shelf' },
  },
  version: {
    tone: 'warn',
    icon: 'RefreshCw',
    title: '书的版本和课堂里的不一样',
    desc: '老师课堂上用的是新版本，你这台平板上是旧版本，页码可能对不上。',
    hint: '更新后就能和老师同一页，书签会自动对到新位置。',
    primary: { label: '更新后进入', to: '/student/launch?state=ok' },
  },
}

const TONE = {
  ok: { ring: 'border-[#9BDCC8]/70', icon: 'text-[#2FA38C]', chip: 'bg-[#E6F6F1] text-[#2F8375]' },
  warn: { ring: 'border-[#F4D9A8]/80', icon: 'text-[#D2922F]', chip: 'bg-[#FCF1DE] text-[#A8721E]' },
}

export default function Launch() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const key = STATES[params.get('state')] ? params.get('state') : 'ok'
  const s = STATES[key]
  const tone = TONE[s.tone]

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-10">
      <GlassPanel tone="solid" sheen className="student-enter w-[640px] max-w-full rounded-[32px] px-11 py-10">
        <div className="flex items-center justify-between">
          <BrandMark size={26} textClass="text-h3" />
          <span className={cx('rounded-full px-3 py-1 text-micro font-semibold', tone.chip)}>
            {s.tone === 'ok' ? '课堂链接' : '需要处理'}
          </span>
        </div>

        <div className={cx('mt-8 flex items-start gap-4 rounded-2xl border bg-white/60 px-6 py-5', tone.ring)}>
          <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/85">
            <Icon name={s.icon} className={cx('h-5 w-5', tone.icon)} />
          </span>
          <div>
            <h1 className="font-serif text-h2 font-bold text-ink-900">{s.title}</h1>
            <p className="mt-2 text-base leading-relaxed text-ink-600">{s.desc}</p>
          </div>
        </div>

        <p className="mt-4 flex items-start gap-2 rounded-2xl bg-white/50 px-6 py-4 text-caption leading-relaxed text-ink-500">
          <Icon name="Info" className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
          {s.hint}
        </p>

        <div className="mt-8 flex items-center gap-3">
          <button
            type="button"
            onClick={() => nav(s.primary.to)}
            className="student-primary-btn flex-1 rounded-[20px] py-3.5 text-title font-semibold text-white"
          >
            {s.primary.label}
          </button>
          <button
            type="button"
            onClick={() => nav('/student/login')}
            className="inline-flex items-center gap-2 rounded-[20px] border border-white/70 bg-white/60 px-6 py-3.5 text-title font-semibold text-ink-700 transition hover:bg-white/80"
          >
            <Icon name="Undo2" className="h-4 w-4" />
            返回电子书包
          </button>
        </div>
      </GlassPanel>

      {/* 壳状态样例切换器：只为评审复现四种状态，正式版本不保留 */}
      <div className="fixed bottom-5 right-6 flex items-center gap-1 rounded-full border border-white/70 bg-white/75 px-3 py-2 text-micro text-ink-500 backdrop-blur">
        <span className="pr-1">唤起状态</span>
        {[
          ['ok', '成功'],
          ['invalid', '凭证无效'],
          ['unavailable', '书不可用'],
          ['version', '版本不一致'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setParams({ state: value })}
            className={cx(
              'rounded-full px-2.5 py-1 font-semibold transition',
              key === value ? 'bg-[#3B66F5] text-white' : 'text-ink-600 hover:bg-white',
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
