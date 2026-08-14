import { Link } from 'react-router-dom'

import { Icon } from '../../components/ui.jsx'
import { GlassCard, GlassPanel } from '../components/Glass.jsx'
import PageHead from '../components/PageHead.jsx'
import { useStudent } from '../state/StudentContext.jsx'
import useReadingStatistics from '../state/useReadingStatistics.js'

function formatSeconds(seconds) {
  if (!Number.isSafeInteger(seconds) || seconds < 0) return null
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

export default function Footprint() {
  const { runtime } = useStudent()
  const statistics = useReadingStatistics(runtime.data?.workspaceId)
  const resource = statistics.resource
  const data = resource.data

  return (
    <div className="flex-1 space-y-4">
      <PageHead title="阅读足迹" desc="当前轻量统计只展示今天的有效阅读事实，不按页码推断完成情况。" />

      {resource.status === 'loading' && (
        <GlassPanel tone="solid" className="student-enter rounded-2xl px-6 py-12 text-center text-caption text-ink-500">
          正在读取今日阅读记录…
        </GlassPanel>
      )}

      {['error', 'forbidden'].includes(resource.status) && (
        <GlassPanel tone="solid" className="student-enter rounded-2xl px-6 py-12 text-center">
          <p className="text-title font-semibold text-ink-800">今日阅读记录暂不可用</p>
          <p className="mt-1.5 text-caption text-ink-500">{resource.error?.message || '当前账号没有读取权限。'}</p>
          <button type="button" onClick={() => void statistics.retry()} className="mt-4 rounded-full bg-white/75 px-4 py-2 text-caption font-semibold text-ink-700">
            重新读取
          </button>
        </GlassPanel>
      )}

      {data && ['ready', 'stale'].includes(resource.status) && (
        <>
          {resource.status === 'stale' && (
            <p className="rounded-xl bg-white/65 px-4 py-3 text-caption text-ink-600">数据刷新失败，下面保留上次成功读取的内容。</p>
          )}
          <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="今日有效阅读" value={formatSeconds(data.todayEffectiveReadingSeconds)} note={`统计日 ${data.statDate}`} icon="Clock" />
              <Stat label="今日打卡" value={data.checkIn.checked ? '已打卡' : `还需 ${formatSeconds(data.checkIn.remainingSeconds)}`} note="固定阈值 5 分钟" icon="CalendarCheck" />
              <Stat label="连续打卡" value={`${data.streakDays} 天`} note="只统计自己的记录" icon="CalendarDays" />
            </div>
          </GlassPanel>

          <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
            <h2 className="font-serif text-h3 font-bold text-ink-900">最近阅读</h2>
            {data.lastReading ? (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-white/60 px-4 py-4">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-white/80 text-[#2C8B76]"><Icon name="BookOpen" className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-title font-semibold text-ink-900">{data.lastReading.title}</span>
                  <span className="mt-0.5 block text-micro text-ink-500 tabular-nums">最近位置：第 {data.lastReading.lastPageNo} 页</span>
                </span>
                <Link to={statistics.continueReadingUrl} className="rounded-full bg-white/80 px-4 py-2 text-caption font-semibold text-ink-700">继续打开</Link>
              </div>
            ) : (
              <p className="mt-4 rounded-xl bg-white/55 px-4 py-6 text-center text-caption text-ink-500">今天还没有可继续打开的阅读记录。</p>
            )}
            <p className="mt-3 text-micro text-ink-400">最近页码是恢复位置，不表示阅读百分比或已经读完。</p>
          </GlassPanel>
        </>
      )}

      <GlassPanel tone="solid" className="student-enter rounded-2xl p-6">
        <h2 className="font-serif text-h3 font-bold text-ink-900">历史周期统计</h2>
        <p className="mt-2 text-caption leading-relaxed text-ink-500">当前严格接口没有提供周、月、年趋势和读完书目，本页不会用旧事件或页码补出这些数字。</p>
        <Link to="/student/me/usage" className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/75 px-4 py-2 text-caption font-semibold text-ink-700">
          查看护眼状态 <Icon name="ChevronRight" className="h-4 w-4" />
        </Link>
      </GlassPanel>
    </div>
  )
}

function Stat({ label, value, note, icon }) {
  return (
    <GlassCard className="px-4 py-3.5">
      <span className="flex items-center gap-1.5 text-micro text-ink-500"><Icon name={icon} className="h-3.5 w-3.5" />{label}</span>
      <p className="mt-1.5 font-serif text-h2 font-bold text-ink-900 tabular-nums">{value}</p>
      <p className="mt-1 text-micro text-ink-400">{note}</p>
    </GlassCard>
  )
}
