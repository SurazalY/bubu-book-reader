import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BookCover, cx, Icon } from '../../components/ui.jsx'
import { GlassCard, GlassPanel } from '../components/Glass.jsx'
import Avatar from '../components/Avatar.jsx'
import PageHead from '../components/PageHead.jsx'
import { AI_NAME, AI_QUOTA } from '../data/aiChat.js'
import { formatMinutes } from '../data/library.js'
import { ABOUT, AVATAR_PRESETS, EYE_CARE, HELP_LINKS, NOTICE_SWITCHES, PRIVACY_RULES, STORAGE } from '../data/me.js'
import { useStudent } from '../state/StudentContext.jsx'

// 设置（规格 §12）：左类别、右详情的横屏双栏，七个类别。
// 红线：
//   - 真实姓名、学校、班级由学校下发，这里只读；
//   - 头像只能选学校预设，没有上传入口；
//   - 主页背景也不允许上传，只能在预设纹理里选；
//   - 「减少动态效果」必须有，且立刻生效；
//   - 隐私那一类只讲教师访问，不出现任何安全事件。
const CATS = [
  { key: 'appearance', label: '外观与阅读偏好', icon: 'Palette' },
  { key: 'notice', label: '通知', icon: 'Bell' },
  { key: 'usage', label: '用量与护眼', icon: 'Gauge' },
  { key: 'storage', label: '下载与存储', icon: 'HardDrive' },
  { key: 'privacy', label: '隐私与教师访问', icon: 'ShieldCheck' },
  { key: 'account', label: '账号与登录', icon: 'UserRound' },
  { key: 'help', label: '帮助与关于', icon: 'LifeBuoy' },
]

const THEME_TINTS = [
  { k: 'mint', t: '淡青绿', c: '#8FD3C0' },
  { k: 'sky', t: '浅天蓝', c: '#A8CBEC' },
  { k: 'apricot', t: '奶油橙', c: '#F5CBA0' },
]
const TEXTURES = [
  { k: 'paper', t: '纸纹' },
  { k: 'plain', t: '不要纹理' },
]
const PAPER_TONES = [
  { k: 'warm', t: '暖白' },
  { k: 'cream', t: '米黄' },
  { k: 'gray', t: '浅灰' },
]
const FONT_SCALES = [
  { k: 'sm', t: '小' },
  { k: 'md', t: '中' },
  { k: 'lg', t: '大' },
]

export default function Settings() {
  const { prefs, setPref, togglePref, student, me, ai } = useStudent()
  const [params, setParams] = useSearchParams()
  const cat = CATS.some((c) => c.key === params.get('cat')) ? params.get('cat') : 'appearance'
  const [signOut, setSignOut] = useState(false)
  const [openHelp, setOpenHelp] = useState('')

  const pickCat = (key) => setParams(key === 'appearance' ? {} : { cat: key }, { replace: true })
  const noticeOn = (k) => prefs.notices?.[k] !== false
  const toggleNotice = (k) =>
    setPref('notices', { ...prefs.notices, [k]: !noticeOn(k) })

  return (
    <div className="flex-1 space-y-4">
      <PageHead title="设置" desc="改完马上生效，不用另外保存。" />

      <div className="flex flex-1 flex-col gap-4 lg:flex-row lg:items-start">
        {/* 左：类别 */}
        <GlassPanel tone="solid" className="student-enter w-full shrink-0 rounded-2xl p-3 lg:w-[248px]">
          <nav className="space-y-1">
            {CATS.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => pickCat(c.key)}
                aria-current={cat === c.key ? 'page' : undefined}
                className={cx('student-set-cat text-caption', cat === c.key && 'student-set-cat--on')}
              >
                <Icon name={c.icon} className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.key === 'privacy' && me.pendingRequests > 0 && (
                  <span className="student-badge tabular-nums">{me.pendingRequests}</span>
                )}
              </button>
            ))}
          </nav>
        </GlassPanel>

        {/* 右：详情 */}
        <div className="min-w-0 flex-1 space-y-4">
          {cat === 'appearance' && (
            <>
              <Block title="头像" desc="只能从学校预设里选，这里没有上传入口。">
                <div className="flex flex-wrap gap-3">
                  {AVATAR_PRESETS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setPref('avatarPreset', a.id)}
                      aria-pressed={prefs.avatarPreset === a.id}
                      className={cx(
                        'flex flex-col items-center gap-1.5 rounded-xl px-2.5 py-2 transition',
                        prefs.avatarPreset === a.id ? 'bg-white/95 shadow-e1' : 'hover:bg-white/70',
                      )}
                    >
                      <Avatar preset={a.id} name={student.name} size={46} />
                      <span
                        className={cx(
                          'text-micro',
                          prefs.avatarPreset === a.id ? 'font-semibold text-ink-900' : 'text-ink-500',
                        )}
                      >
                        {a.id === prefs.avatarPreset ? `${a.name} · 在用` : a.name}
                      </span>
                    </button>
                  ))}
                </div>
              </Block>

              <Block title="主题与主页" desc="主题色只影响装饰，不会盖掉进度条与课堂状态那些有含义的颜色。">
                <Choice label="主题色" value={prefs.themeTint} options={THEME_TINTS} onPick={(k) => setPref('themeTint', k)} swatch />
                <Choice label="主页纹理" value={prefs.homeTexture} options={TEXTURES} onPick={(k) => setPref('homeTexture', k)} />
                <p className="text-micro text-ink-400">主页背景是学校统一的那张画，不支持自己上传图片。</p>
              </Block>

              <Block title="阅读偏好" desc="这几项在阅读器里也能就地调，改的是同一份设置。">
                <Choice label="纸张颜色" value={prefs.paperTone} options={PAPER_TONES} onPick={(k) => setPref('paperTone', k)} />
                <Choice
                  label="字号"
                  value={prefs.fontScale}
                  options={FONT_SCALES}
                  onPick={(k) => setPref('fontScale', k)}
                  hint="选「大」时一次只显示一页，书页排版本身不会重新流动"
                />
              </Block>

              <Block title="减少动态效果" desc="关掉背景漂移、光晕、尘埃与各种入场动画，页面会立刻安静下来。">
                <Switch
                  label="减少动态效果"
                  desc={prefs.reduceMotion ? '现在是开着的：动画都停了' : '现在是关着的：保留轻微的动效'}
                  on={prefs.reduceMotion}
                  onToggle={() => togglePref('reduceMotion')}
                />
              </Block>
            </>
          )}

          {cat === 'notice' && (
            <Block title="通知" desc="关掉的通知不会再提醒你，但老师那边该发的还是会发。">
              {NOTICE_SWITCHES.map((n) => (
                <Switch
                  key={n.key}
                  label={n.label}
                  desc={n.locked ? `${n.desc}这一项不能关。` : n.desc}
                  on={n.locked ? true : noticeOn(n.key)}
                  locked={n.locked}
                  onToggle={() => !n.locked && toggleNotice(n.key)}
                />
              ))}
              <Link
                to="/student/me/teacher"
                className="inline-flex w-max items-center gap-1.5 rounded-full border border-white/70 bg-white/72 px-4 py-2 text-caption font-semibold text-ink-700 transition hover:bg-white"
              >
                看老师发来的通知
                <Icon name="ChevronRight" className="h-4 w-4" />
              </Link>
            </Block>
          )}

          {cat === 'usage' && (
            <Block title="用量与护眼" desc={`${AI_NAME}的提问次数和护眼时间都由学校设置，这里只能看，不能改。`}>
              <Row label={`今天还能问${AI_NAME}`} value={`${ai.quota.remaining} 次`} />
              <Row label="今日用量额度" value={`已用 ${ai.quota.usagePercent}%`} />
              <Row label="次数什么时候恢复" value={AI_QUOTA.resetAt} />
              <Row label="单次最长连续阅读" value={`${EYE_CARE.maxStreak} 分钟`} />
              <Row label="今天累计上限" value={`${EYE_CARE.dailyLimit} 分钟（已读 ${EYE_CARE.today} 分钟）`} />
              <p className="text-micro text-ink-400">这里不涉及任何费用，也不会显示消耗量或价格。</p>
              <Link
                to="/student/me/usage"
                className="inline-flex w-max items-center gap-1.5 rounded-full border border-white/70 bg-white/72 px-4 py-2 text-caption font-semibold text-ink-700 transition hover:bg-white"
              >
                看详细的用量与护眼
                <Icon name="ChevronRight" className="h-4 w-4" />
              </Link>
            </Block>
          )}

          {cat === 'storage' && (
            <Block title="下载与存储" desc={STORAGE.note}>
              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-caption text-ink-600">已经用掉</span>
                  <span className="text-caption font-semibold text-ink-900 tabular-nums">
                    {STORAGE.usedMB} MB / {STORAGE.quotaMB} MB
                  </span>
                </div>
                <div className="student-meter-track mt-2 h-2 w-full overflow-hidden rounded-full">
                  <div
                    className="student-usage-fill h-full rounded-full"
                    style={{ width: `${Math.round((STORAGE.usedMB / STORAGE.quotaMB) * 100)}%` }}
                  />
                </div>
              </div>

              <div>
                <h3 className="text-caption font-semibold text-ink-800 tabular-nums">
                  下载好的书（{me.downloadedBooks.length} 本）
                </h3>
                {me.downloadedBooks.length ? (
                  <ul className="mt-2.5 space-y-2">
                    {me.downloadedBooks.map((b) => (
                      <li key={b.id} className="flex items-center gap-3 rounded-xl bg-white/62 px-3.5 py-2.5">
                        <BookCover book={b} className="w-[34px] shrink-0 rounded shadow-e1" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-caption font-semibold text-ink-900">{b.title}</span>
                          <span className="mt-0.5 block text-micro text-ink-400 tabular-nums">
                            已读 {formatMinutes(b.minutes, { zero: '0 分钟' })} · {b.percent}%
                          </span>
                        </span>
                        <button type="button" onClick={() => me.removeDownload(b.id)} className="student-mini-btn shrink-0">
                          <Icon name="Trash2" className="h-3.5 w-3.5" strokeWidth={2} />
                          删除下载
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2.5 rounded-xl bg-white/58 px-4 py-4 text-caption text-ink-500">
                    还没有下载过书。在书籍详情页点「下载」就能离线读。
                  </p>
                )}
              </div>
              {me.flash && <p className="text-micro text-[#2C8B76]">{me.flash.text}</p>}
            </Block>
          )}

          {cat === 'privacy' && (
            <>
              <Block title="老师能看到什么" desc="下面这几条是学校统一定的规则，不能自己改。">
                <ul className="space-y-1.5">
                  {PRIVACY_RULES.map((t) => (
                    <li key={t} className="flex gap-2 text-caption leading-relaxed text-ink-600">
                      <Icon name="Dot" className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                      {t}
                    </li>
                  ))}
                </ul>
              </Block>
              <Block title="访问申请与记录" desc="老师申请看你的私密对话时会先问你，看过的记录也都留着。">
                <Row
                  label="现在等你处理的申请"
                  value={me.pendingRequests ? `${me.pendingRequests} 条` : '没有'}
                />
                <Link
                  to="/student/me/teacher"
                  className="inline-flex w-max items-center gap-1.5 rounded-full border border-white/70 bg-white/72 px-4 py-2 text-caption font-semibold text-ink-700 transition hover:bg-white"
                >
                  去教师交互里处理
                  <Icon name="ChevronRight" className="h-4 w-4" />
                </Link>
              </Block>
            </>
          )}

          {cat === 'account' && (
            <>
              <Block title="我的账号" desc="姓名、学校和班级由学校下发，这里只能看，不能自己改。">
                <div className="flex items-center gap-4">
                  <Avatar preset={prefs.avatarPreset} name={student.name} size={56} />
                  <div className="min-w-0">
                    <p className="font-serif text-h3 font-bold text-ink-900">{student.name}</p>
                    <p className="mt-0.5 text-caption text-ink-500">
                      {student.school} · {student.className}
                    </p>
                  </div>
                </div>
                <Row label="学号" value={student.studentNo} />
                <Row label="班主任" value={student.homeTeacher} />
                <Row label="阅读等级" value={`Lv.${student.level.value} ${student.level.title}`} />
                <p className="text-micro text-ink-400">要改姓名或班级，得请老师在学校那边改。</p>
              </Block>
              <Block title="退出登录" desc="退出以后要重新用学校账号登录，本机下载的书会保留。">
                <button
                  type="button"
                  onClick={() => setSignOut(true)}
                  className="w-max rounded-full border border-white/70 bg-white/72 px-5 py-2.5 text-caption font-semibold text-ink-700 transition hover:bg-white"
                >
                  退出登录
                </button>
              </Block>
            </>
          )}

          {cat === 'help' && (
            <>
              <Block title="帮助" desc="遇到不会用的地方，先看看这几条。">
                {/* 卡片看着能点就必须真的点得开，否则就是一排死入口（逐张自检抓到） */}
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {HELP_LINKS.map((h) => {
                    const open = openHelp === h.id
                    return (
                      <GlassCard key={h.id} className="overflow-hidden p-0">
                        <button
                          type="button"
                          onClick={() => setOpenHelp(open ? '' : h.id)}
                          aria-expanded={open}
                          className="student-help-item flex gap-3 px-4 py-3.5"
                        >
                          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/80 text-ink-500">
                            <Icon name={h.icon} className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-title font-semibold text-ink-900">{h.title}</span>
                            <span className="mt-0.5 block text-caption leading-relaxed text-ink-500">{h.desc}</span>
                          </span>
                          <Icon
                            name={open ? 'ChevronUp' : 'ChevronDown'}
                            className="mt-1 h-4 w-4 shrink-0 text-ink-400"
                          />
                        </button>
                        {open && (
                          <p className="border-t border-white/70 bg-white/72 px-4 py-3 text-caption leading-relaxed text-ink-700">
                            {h.body}
                          </p>
                        )}
                      </GlassCard>
                    )
                  })}
                </div>
              </Block>
              <Block title="关于读伴" desc={ABOUT.note}>
                <Row label="名称" value={ABOUT.appName} />
                <Row label="版本" value={ABOUT.version} />
                <Row label="授权学校" value={ABOUT.school} />
                <Row label="竹娃形象" value="当前为示意素材，等学校正式素材替换" />
              </Block>
            </>
          )}
        </div>
      </div>

      {signOut && (
        <div className="student-modal-mask fixed inset-0 z-40 grid place-items-center bg-ink-900/24 px-6">
          <GlassPanel tone="float" className="student-modal student-dialog w-full max-w-[440px] rounded-2xl p-6">
            <h2 className="font-serif text-h3 font-bold text-ink-900">要退出登录吗</h2>
            <p className="mt-2 text-caption leading-relaxed text-ink-600">
              退出以后要重新用学校账号登录。你的书签、摘录和心得都在学校那边存着，不会丢。
            </p>
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setSignOut(false)}
                className="rounded-full border border-white/70 bg-white/72 px-5 py-2 text-caption font-semibold text-ink-700 transition hover:bg-white"
              >
                先不退
              </button>
              <Link to="/student/login" className="student-btn-primary rounded-full px-5 py-2 text-caption font-semibold">
                退出登录
              </Link>
            </div>
          </GlassPanel>
        </div>
      )}
    </div>
  )
}

function Block({ title, desc, children }) {
  return (
    <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
      <h2 className="font-serif text-h3 font-bold text-ink-900">{title}</h2>
      {desc && <p className="mt-1.5 max-w-[64ch] text-caption leading-relaxed text-ink-500">{desc}</p>}
      <div className="mt-4 flex flex-col gap-3.5">{children}</div>
    </GlassPanel>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/60 pb-2">
      <span className="text-caption text-ink-500">{label}</span>
      <span className="text-caption font-semibold text-ink-900">{value}</span>
    </div>
  )
}

function Choice({ label, value, options, onPick, hint, swatch }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-[76px] text-caption text-ink-600">{label}</span>
        <div className="student-segment inline-flex rounded-full p-1">
          {options.map((o) => (
            <button
              key={o.k}
              type="button"
              onClick={() => onPick(o.k)}
              aria-pressed={value === o.k}
              className={cx(
                'flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-caption transition',
                value === o.k ? 'student-segment--on font-semibold text-ink-900' : 'text-ink-500 hover:text-ink-800',
              )}
            >
              {swatch && (
                <span className="h-3 w-3 rounded-full border border-white/80" style={{ background: o.c }} />
              )}
              {o.t}
            </button>
          ))}
        </div>
        {/* 当前选中项另外用文字写一遍，不让学生只靠「哪个白一点」判断 */}
        <span className="text-micro text-ink-400">
          现在是「{options.find((o) => o.k === value)?.t}」
        </span>
      </div>
      {hint && <p className="mt-1.5 text-micro text-ink-400">{hint}</p>}
    </div>
  )
}

function Switch({ label, desc, on, onToggle, locked }) {
  return (
    <div className="flex items-start gap-3.5 rounded-xl bg-white/58 px-4 py-3.5">
      <span className="min-w-0 flex-1">
        <span className="block text-title font-semibold text-ink-900">{label}</span>
        <span className="mt-0.5 block text-caption leading-relaxed text-ink-500">{desc}</span>
      </span>
      {/* 开关状态旁边永远写着「开／关」，不只靠滑块位置与颜色（红线 12） */}
      <span className="flex shrink-0 items-center gap-2">
        <span className={cx('text-micro font-semibold', on ? 'text-[#2C8B76]' : 'text-ink-400')}>
          {on ? '开' : '关'}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={label}
          disabled={locked}
          onClick={onToggle}
          className={cx('student-switch', on && 'student-switch--on')}
        />
      </span>
    </div>
  )
}
