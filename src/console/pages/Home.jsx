import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { cx } from '../../shared/cx.js'
import { RuntimeIcon as Icon } from '../../shared/RuntimeIcon.jsx'
import { useProtectedAssetUrl } from '../../shared/useProtectedAssetUrl.js'
import { GlassCard } from '../components/Glass.jsx'
import MiniChart from '../components/MiniChart.jsx'
import { useConsole } from '../state/ConsoleContext.jsx'
import useConsoleHomeData from '../state/useConsoleHomeData.js'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function greetOf(hour) {
  if (hour < 5) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 13) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

const TONE_CHIP = {
  brand: 'bg-brand-50 text-brand-600',
  violet: 'bg-[#F0ECFB] text-[#7C6BD8]',
  cyan: 'bg-[#E4F5F2] text-[#2E8C86]',
  accent: 'bg-accent-50 text-accent-600',
  danger: 'bg-danger-50 text-danger-600',
}

const TAG_TONE = {
  brand: 'bg-brand-50 text-brand-600',
  violet: 'bg-[#F0ECFB] text-[#7C6BD8]',
  cyan: 'bg-[#E4F5F2] text-[#2E8C86]',
  accent: 'bg-accent-50 text-accent-600',
  danger: 'bg-danger-50 text-danger-600',
}

const DASHBOARD_BLOCKS = [
  { key: 'classes', label: '参与班级', unit: '个', icon: 'UsersRound', tone: 'brand', to: '/console/classes' },
  { key: 'reading', label: '今日有效阅读', unit: '次', icon: 'BookOpenCheck', tone: 'violet', to: '/console/usage' },
  { key: 'active', label: '正在阅读学生', unit: '人', icon: 'UserRoundCheck', tone: 'cyan', to: '/console/classes' },
  { key: 'safety', label: '待处理安全事件', unit: '项', icon: 'ShieldAlert', tone: 'danger', to: '/console/safety' },
]

export default function Home() {
  const { workspace, runtime } = useConsole()
  const navigate = useNavigate()
  const resource = useConsoleHomeData(workspace?.id)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 20_000)
    return () => window.clearInterval(timer)
  }, [])

  const sessionLoading = runtime.status === 'loading'
  const sessionError = runtime.status === 'error' ? runtime.error : null
  const dashboardLoading = runtime.status === 'ready' && !!workspace && resource.status === 'loading'
  const dashboardError = resource.status === 'error' ? resource.error : null
  const noWorkspace = runtime.status === 'ready' && !workspace
  const data = resource.data
  const safetyForbidden = data?.safetyStatus === 'forbidden'
  const loading = sessionLoading || dashboardLoading
  const error = sessionError || dashboardError
  const blocks = data?.blocks?.length ? data.blocks : DASHBOARD_BLOCKS
  const dateText = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAYS[now.getDay()]}`
  const timeText = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  return (
    <div className="console-enter pb-2">
      <div className="pt-1 pb-7">
        <h1 className="font-serif text-[38px] leading-[1.15] font-bold text-ink-900 tracking-tightish">
          {greetOf(now.getHours())}，{workspace?.person?.name || '当前会话'}
        </h1>
        <p className="text-[14px] text-ink-500 mt-2.5">{data?.greetSub || '正在读取当前工作空间的真实业务数据。'}</p>
        <div className="flex items-center gap-2 mt-4 text-[12.5px] text-ink-500">
          <Icon name="Clock" className="w-[15px] h-[15px] text-ink-400" strokeWidth={1.7} />
          <span>{dateText}</span>
          <span className="tabular-nums font-medium text-ink-700">{timeText}</span>
        </div>
        {error && <DashboardNotice error={error} onRetry={sessionError ? runtime.reload : resource.reload} />}
        {noWorkspace && <DashboardEmptyWorkspace />}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {blocks.map((block) => (
          <DashboardBlock key={block.key} block={block} loading={loading} error={Boolean(error || noWorkspace)} onOpen={() => navigate(block.to)} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <GlassCard className="rounded-xl overflow-hidden">
          <PanelHead icon="CalendarDays" title="近期阅读安排" more="全部安排" onMore={() => navigate('/console/teaching/arrangements')} />
          {loading ? (
            <ListLoading rows={3} />
          ) : data?.arrangements?.length ? (
            <ul className="divide-y divide-ink-150/60">
              {data.arrangements.map((arrangement) => (
                <li key={arrangement.id}>
                  <button type="button" onClick={() => navigate('/console/teaching/arrangements')} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/60 transition">
                    <div className="w-[54px] shrink-0">
                      <div className="text-[12.5px] font-semibold text-ink-800 leading-tight whitespace-nowrap">{arrangement.date || '日期未返回'}</div>
                      <div className="text-[11px] text-ink-400 mt-0.5">{arrangement.weekday || '—'}</div>
                    </div>
                    <span className="w-7 h-9 rounded-[3px] shrink-0 shadow-e1 overflow-hidden bg-gradient-to-br from-[#d2b47b] to-[#78929c]" aria-hidden="true">
                      <ArrangementCover coverUrl={arrangement.coverUrl} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <span className="font-serif text-[13.5px] font-semibold text-ink-900 truncate">{arrangement.title || '服务端未返回书名'}</span>
                        {arrangement.chapter && <span className="text-[12px] text-ink-600 shrink-0">{arrangement.chapter}</span>}
                      </div>
                      <div className="text-[11.5px] text-ink-400 mt-0.5 truncate">{arrangement.klass || '服务端未返回班级'}</div>
                    </div>
                    <span className={cx('shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium', TAG_TONE[arrangement.tagTone] || TAG_TONE.brand)}>{arrangement.tag || '状态未返回'}</span>
                    <div className="w-[68px] shrink-0 text-right">
                      <div className="text-[12px] text-ink-700 tabular-nums">{arrangement.time || '—'}</div>
                      <div className="text-[11px] text-ink-400 mt-0.5">{arrangement.joined || '—'}</div>
                    </div>
                    <Icon name="ChevronRight" className="w-4 h-4 text-ink-300 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyPanel icon={error ? 'CloudOff' : 'CalendarDays'} title={error ? '安排暂不可用' : '暂无近期阅读安排'} desc={error ? '请求失败时不会显示静态示例安排。' : '服务端在当前工作空间没有返回安排记录。'} />
          )}
          <button type="button" onClick={() => navigate('/console/teaching/arrangements')} className="w-full h-10 flex items-center justify-center gap-1 text-[12px] text-ink-500 hover:text-brand-600 border-t border-ink-150/60 transition">
            查看全部安排 <Icon name="ChevronDown" className="w-3.5 h-3.5" />
          </button>
        </GlassCard>

        <GlassCard className="rounded-xl overflow-hidden">
          <PanelHead icon="BellRing" title="待处理提醒" more="全部提醒" onMore={() => navigate('/console/safety')} />
          {loading ? (
            <ListLoading rows={3} />
          ) : data?.todos?.length ? (
            <ul className="divide-y divide-ink-150/60">
              {data.todos.map((todo) => (
                <li key={todo.key}>
                  <button type="button" onClick={() => navigate(todo.to)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/60 transition">
                    <span className={cx('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', TONE_CHIP[todo.tone] || TONE_CHIP.cyan)}>
                      <Icon name={todo.icon} className="w-4 h-4" strokeWidth={1.9} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-ink-900 truncate">{todo.title}</div>
                      <div className="text-[11.5px] text-ink-400 mt-0.5 truncate">{todo.sub}</div>
                    </div>
                    {todo.count != null && <span className="text-[12.5px] font-semibold text-danger-600 tabular-nums shrink-0">{todo.count}项</span>}
                    <Icon name="ChevronRight" className="w-4 h-4 text-ink-300 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyPanel
              icon={error ? 'CloudOff' : safetyForbidden ? 'ShieldOff' : 'CheckCheck'}
              title={error ? '提醒暂不可用' : safetyForbidden ? '无权查看安全提醒' : '暂无服务端待处理记录'}
              desc={error ? '请求失败时没有回退到静态安全事件。' : safetyForbidden ? '当前身份只能处理本职教学数据，不能读取安全事件。' : '安全事件接口未返回待处理项。'}
            />
          )}
        </GlassCard>
      </div>
    </div>
  )
}

function ArrangementCover({ coverUrl }) {
  const { workspace } = useConsole()
  const { objectUrl, failed } = useProtectedAssetUrl(coverUrl, workspace?.id)
  if (!objectUrl || failed) return null
  return <img src={objectUrl} alt="" className="h-full w-full object-cover" />
}

function DashboardBlock({ block, loading, error, onOpen }) {
  return (
    <GlassCard className="p-4 min-w-0 rounded-xl">
      <div className="flex items-center gap-2">
        <span className={cx('w-6 h-6 rounded-lg flex items-center justify-center shrink-0', TONE_CHIP[block.tone] || TONE_CHIP.brand)}>
          <Icon name={block.icon} className="w-[14px] h-[14px]" strokeWidth={2} />
        </span>
        <span className="text-[12.5px] font-medium text-ink-700 truncate flex-1">{block.label}</span>
        <button type="button" onClick={onOpen} className="inline-flex items-center gap-0.5 text-[11.5px] text-ink-400 hover:text-brand-600 transition shrink-0">详情<Icon name="ChevronRight" className="w-3 h-3" /></button>
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        {loading ? <span className="h-8 w-16 rounded bg-ink-100 animate-pulse" aria-label="正在读取指标" /> : <span className="font-serif text-[34px] leading-none font-bold text-ink-900 tabular-nums">{block.value ?? '—'}</span>}
        {!loading && block.value != null && <span className="text-[12px] text-ink-500">{block.unit}</span>}
      </div>
      <div className="mt-2 h-[18px] flex items-center gap-1.5"><span className="text-[11.5px] text-ink-400">{error ? '当前数据不可用' : block.unavailableReason || (block.value == null ? '服务端未返回此指标' : '按当前工作空间汇总')}</span></div>
      <div className="mt-2.5 h-[86px]">{block.chart ? <MiniChart chart={block.chart} tone={block.tone} /> : <div className="h-full flex items-center justify-center text-[11px] text-ink-300">{loading ? '正在读取趋势' : '暂无趋势数据'}</div>}</div>
    </GlassCard>
  )
}

function PanelHead({ icon, title, more, onMore }) {
  return <div className="flex items-center gap-2 px-4 h-12 border-b border-ink-150/60"><Icon name={icon} className="w-[15px] h-[15px] text-[#3E9E8F]" strokeWidth={1.9} /><span className="text-[13.5px] font-semibold text-ink-800 flex-1 truncate">{title}</span><button type="button" onClick={onMore} className="inline-flex items-center gap-0.5 text-[11.5px] text-ink-400 hover:text-brand-600 transition">{more}<Icon name="ChevronRight" className="w-3 h-3" /></button></div>
}

function DashboardNotice({ error, onRetry }) {
  const permission = error?.code === 'PERMISSION_DENIED'
  return <GlassCard className="mt-4 flex items-center gap-3 border border-warning-100 bg-warning-50/75 px-3.5 py-2.5"><Icon name={permission ? 'ShieldOff' : 'CloudOff'} className="w-4 h-4 shrink-0 text-warning-700" /><p className="min-w-0 flex-1 truncate text-[12px] text-warning-800">{permission ? '当前会话没有读取该工作空间首页数据的权限。' : `${error?.code || 'DEPENDENCY_UNAVAILABLE'}：${error?.message || '首页数据暂不可用'}`}</p><button type="button" onClick={onRetry} className="rounded-lg border border-white/90 bg-white px-2.5 py-1 text-[11.5px] font-medium text-ink-700">重试</button></GlassCard>
}

function DashboardEmptyWorkspace() {
  return <GlassCard className="mt-4 flex items-center gap-3 border border-ink-150 bg-white/75 px-3.5 py-2.5"><Icon name="FolderX" className="w-4 h-4 shrink-0 text-ink-400" /><p className="text-[12px] text-ink-600">当前会话没有可用工作空间，因此没有显示任何业务指标。</p></GlassCard>
}

function EmptyPanel({ icon, title, desc }) {
  return <div className="px-4 py-10 text-center"><Icon name={icon} className="w-7 h-7 text-ink-300 mx-auto" strokeWidth={1.6} /><p className="text-[13px] text-ink-600 mt-2.5">{title}</p><p className="text-[11.5px] text-ink-400 mt-1">{desc}</p></div>
}

function ListLoading({ rows }) {
  return <div className="divide-y divide-ink-150/60">{Array.from({ length: rows }, (_, index) => <div key={index} className="h-[60px] px-4 flex items-center"><span className="h-7 w-full rounded bg-ink-100/70 animate-pulse" /></div>)}</div>
}
