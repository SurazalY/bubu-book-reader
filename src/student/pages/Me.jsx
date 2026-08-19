import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createAuthApi } from '../../api/auth.js'
import { cx, Icon } from '../../components/ui.jsx'
import { GlassCard, GlassPanel } from '../components/Glass.jsx'
import Avatar from '../components/Avatar.jsx'
import { useStudent } from '../state/StudentContext.jsx'
import useReadingLibrary from '../state/useReadingLibrary.js'
import useReadingStatistics from '../state/useReadingStatistics.js'
import useEyeCarePrivacy from '../state/useEyeCarePrivacy.js'
import { useStudentCommunity } from '../community/CommunityRuntimeContext.jsx'

const authApi = createAuthApi()

function formatMinutes(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '暂未返回'
  const minutes = Math.max(0, Math.round(value))
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

// 个人主页（规格 §10.1）：左身份卡 + 右四组内容。
// 红线：
//   - 教师交互入口只显示未读数量，不把通知内容摊在这一页；
//   - 安全事件完全不出现；
//   - 不显示 Token 与费用，AI 用量只给剩余次数与恢复时间；
//   - 竹娃不在这一页（它只在阅读器）。
export default function Me() {
  const navigate = useNavigate()
  const { student: studentValue, prefs, runtime } = useStudent()
  const { community } = useStudentCommunity()
  const [logoutError, setLogoutError] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)
  const workspaceId = runtime.data?.workspaceId
  const statistics = useReadingStatistics(workspaceId)
  const library = useReadingLibrary({ workspaceId })
  const privacy = useEyeCarePrivacy({ workspaceId })
  const student = studentValue || { name: '正在读取', className: '', level: {} }
  const levelValue = Number(student.level?.value)
  const level = {
    value: Number.isFinite(levelValue) ? levelValue : null,
    title: student.level?.title || '等级正在读取',
    progressPercent: student.level?.progressPercent,
  }
  const todayMinutes = statistics.data ? statistics.data.todayEffectiveReadingSeconds / 60 : null
  const todayEyeSeconds = privacy.eyeCare?.dailyValidEyeSeconds
  const todayEyeMinutes = Number.isFinite(todayEyeSeconds) ? Math.round(todayEyeSeconds / 60) : null
  const levelProgress = Number(level.progressPercent)
  const levelPercent = Number.isFinite(levelProgress) ? Math.max(0, Math.min(100, levelProgress)) : null
  const highlightCount = library.excerpts.length
  const bookmarkCount = library.bookmarks.length
  const noteCount = library.annotations.length
  const teacherBadge = (privacy.data?.requests || []).filter((request) => request.status === 'pending').length
  const mineCount = Array.isArray(community.mine) ? community.mine.length : 0
  const savedCount = Array.isArray(community.savedPosts) ? community.savedPosts.length : 0

  async function logout() {
    if (loggingOut) return
    setLogoutError('')
    setLoggingOut(true)
    try {
      await authApi.logout()
      navigate('/student/login', { replace: true })
    } catch (error) {
      setLogoutError(error?.message || '退出登录失败，请稍后重试')
      setLoggingOut(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* 左：身份卡。真名、学校、班级由学校下发，学生改不了，这一点要写在卡里 */}
      <GlassPanel tone="solid" sheen className="student-enter w-full shrink-0 rounded-2xl p-6 lg:w-[318px]">
        <div className="flex items-center gap-4">
          <Avatar preset={prefs.avatarPreset} name={student.name} size={64} />
          <div className="min-w-0">
            <h1 className="truncate font-serif text-h2 font-bold text-ink-900">{student.name}</h1>
            <p className="mt-1 truncate text-caption text-ink-500">{student.school}</p>
            <p className="truncate text-caption text-ink-500">{student.className}</p>
          </div>
        </div>

        <Link
          to="/student/me/level"
          className="student-level-card mt-5 block rounded-xl bg-white/62 px-4 py-3.5 transition hover:bg-white/88"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-serif text-title font-bold text-ink-900">
              {level.value === null ? '等级暂未返回' : `Lv.${level.value} · ${level.title}`}
            </span>
            <span className="text-micro text-ink-400">看徽章</span>
          </div>
          {levelPercent !== null && (
            <div className="student-meter-track mt-2.5 h-2 w-full overflow-hidden rounded-full">
              <div className="student-level-fill h-full rounded-full" style={{ width: `${levelPercent}%` }} />
            </div>
          )}
          <p className="mt-2 text-micro text-ink-500 tabular-nums">
            {Number.isFinite(levelProgress) ? '当前等级与进度由服务端阅读数据计算' : '当前等级已由服务端下发，进度阈值暂未开放'}
          </p>
        </Link>

        <p className="mt-4 rounded-xl bg-white/52 px-3.5 py-3 text-micro leading-relaxed text-ink-500">
          学校和班级由学校下发，不能自己改。
        </p>

        <Link
          to="/student/me/settings"
          className="mt-4 flex items-center justify-center gap-1.5 rounded-full border border-white/70 bg-white/72 px-4 py-2.5 text-caption font-semibold text-ink-700 transition hover:bg-white"
        >
          <Icon name="Settings" className="h-4 w-4" />
          设置
        </Link>

        <button
          type="button"
          onClick={logout}
          disabled={loggingOut}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full border border-white/70 bg-white/72 px-4 py-2.5 text-caption font-semibold text-ink-700 transition hover:bg-white disabled:opacity-60"
        >
          <Icon name="LogOut" className="h-4 w-4" />
          {loggingOut ? '正在退出…' : '退出登录'}
        </button>
        {logoutError ? (
          <p className="mt-2 text-center text-micro text-[#D0492F]">{logoutError}</p>
        ) : null}
      </GlassPanel>

      {/* 右：阅读数据 → 常用入口 → 我的内容 → 工具与设置 */}
      <div className="min-w-0 flex-1 space-y-4">
        <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-serif text-h3 font-bold text-ink-900">我的阅读</h2>
            <Link to="/student/me/footprint" className="text-caption font-semibold text-ink-500 hover:text-ink-900">
              看完整足迹
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="今日有效阅读" value={formatMinutes(todayMinutes)} note={statistics.data?.statDate || '统计日读取中'} icon="Clock" />
            <Stat label="今日打卡" value={statistics.data ? (statistics.data.checkIn.checked ? '已打卡' : '未打卡') : '暂未返回'} note="固定 5 分钟阈值" icon="CalendarCheck" />
            <Stat label="连续打卡" value={statistics.data ? `${statistics.data.streakDays} 天` : '暂未返回'} note="只统计自己的记录" icon="CalendarDays" />
            <Stat label="最近阅读" value={statistics.data?.lastReading?.title || '暂无记录'} note={statistics.data?.lastReading ? `第 ${statistics.data.lastReading.lastPageNo} 页` : '页码不表示完成度'} icon="BookOpen" />
          </div>
          <p className="mt-3 text-micro text-ink-400">仅统计前台、亮屏且有交互的有效阅读时间，重叠设备区间不会重复累计。</p>
        </GlassPanel>

        <Section title="常用入口">
          <Entry
            to="/student/me/footprint"
            icon="TrendingUp"
            tone="mint"
            title="阅读足迹"
            desc={statistics.status === 'ready' ? `今天 ${formatMinutes(todayMinutes)}，连续打卡 ${statistics.data.streakDays} 天` : '今日阅读记录正在读取'}
          />
          <Entry
            to="/student/me/level"
            icon="Award"
            tone="apricot"
            title="阅读等级与徽章"
            desc={level.value === null ? '等级数据尚未下发' : `Lv.${level.value} ${level.title} · 徽章数据尚未下发`}
          />
          <Entry
            to="/student/me/usage"
            icon="Gauge"
            tone="sky"
            title="用量与护眼"
            desc={todayEyeMinutes === null ? '护眼状态正在读取' : `今日有效用眼 ${todayEyeMinutes} 分钟 · ${privacy.eyeCare?.enforcement?.status || '状态读取中'}`}
          />
          {/* 红线：只显示未读数量，不显示通知内容，更不显示任何安全事件 */}
          <Entry
            to="/student/me/teacher"
            icon="GraduationCap"
            tone="violet"
            title="教师交互"
            desc={teacherBadge ? '老师的通知、书目安排与访问申请' : '暂时没有新的消息'}
            badge={teacherBadge}
          />
        </Section>

        <Section title="我的内容">
          <Entry
            to="/student/me/notes"
            icon="PenLine"
            tone="mint"
            title="我的心得"
            desc={`${noteCount} 条真实批注，可以在阅读器中继续整理`}
          />
          <Entry
            to="/student/me/highlights"
            icon="Highlighter"
            tone="apricot"
            title="我的摘录与书签"
            desc={`摘录 ${highlightCount} 条 · 批注 ${noteCount} 条 · 书签 ${bookmarkCount} 个`}
          />
          <Entry
            to="/student/me/posts"
            icon="Send"
            tone="sky"
            title="我的发布与收藏"
            desc={`发布 ${mineCount} 篇 · 收藏 ${savedCount} 篇`}
          />
          <Entry
            to="/student/lists"
            icon="ListMusic"
            tone="violet"
            title="我的书单"
            desc={`${library.lists.length} 个自定义书单`}
          />
        </Section>

        <Section title="工具与设置">
          <Entry
            to="/student/me/settings"
            icon="Settings"
            tone="mint"
            title="设置"
            desc="修改密码、显示名，或退出登录"
          />
          <Entry
            unavailable
            icon="LifeBuoy"
            tone="sky"
            title="帮助与关于"
            desc="帮助内容服务端接入中，当前不展示旧演示文案"
          />
        </Section>
      </div>
    </div>
  )
}

function Stat({ label, value, note, icon }) {
  return (
    <GlassCard className="px-3.5 py-3">
      <span className="flex items-center gap-1.5 text-micro text-ink-500">
        <Icon name={icon} className="h-3.5 w-3.5" />
        {label}
      </span>
      <p className="mt-1.5 font-serif text-h3 font-bold text-ink-900 tabular-nums">{value}</p>
      <p className="mt-0.5 text-micro text-ink-400">{note}</p>
    </GlassCard>
  )
}

function Section({ title, children }) {
  return (
    <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
      <h2 className="font-serif text-h3 font-bold text-ink-900">{title}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{children}</div>
    </GlassPanel>
  )
}

const tones = {
  mint: 'bg-[#DFF3EC] text-[#2C8B76]',
  sky: 'bg-[#DEEAFA] text-[#3B6FBF]',
  apricot: 'bg-[#FBE7CF] text-[#B8752A]',
  violet: 'bg-[#E7E2FA] text-[#6A5AC0]',
}

function Entry({ to, icon, tone, title, desc, badge, unavailable = false }) {
  const content = (
    <>
      <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-full', tones[tone] || tones.mint)}>
        <Icon name={icon} className="h-5 w-5" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-title font-semibold text-ink-900">{title}</span>
          {badge ? (
            <span className="student-badge shrink-0 tabular-nums">{badge} 条待处理</span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-micro text-ink-500">{desc}</span>
      </span>
    </>
  )
  if (unavailable) {
    return (
      <div className="group flex items-center gap-3.5 rounded-xl bg-white/62 px-4 py-3.5" aria-disabled="true">
        {content}
        <span className="shrink-0 text-micro text-ink-400">暂未开放</span>
      </div>
    )
  }
  return (
    <Link
      to={to}
      className="group flex items-center gap-3.5 rounded-xl bg-white/62 px-4 py-3.5 transition hover:bg-white/90"
    >
      {content}
      <Icon
        name="ChevronRight"
        className="h-4 w-4 shrink-0 text-ink-300 transition group-hover:translate-x-0.5"
      />
    </Link>
  )
}
