import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'

import { RuntimeIcon as Icon } from '../../../shared/RuntimeIcon.jsx'
import { cx } from '../../../shared/cx.js'
import { Btn, EmptyState, SearchBox, Select, StatusTag, SubHead } from '../Controls.jsx'
import { GlassCard, GlassPanel } from '../Glass.jsx'
import {
  STUDENT_READING_FILTERS,
  buildReadingStatisticsViewModel,
  describeTeacherComparison,
  formatBasisPoints,
  formatMonitorDuration,
  formatMonitorTimestamp,
} from './readingStatisticsViewModel.js'

function StatusSurface({ icon, title, description, action }) {
  return (
    <GlassCard className="mt-1">
      <EmptyState icon={icon} title={title} desc={description} action={action} />
    </GlassCard>
  )
}

export function ReadingStatisticsToolbar({
  classOptions,
  selectedClassId,
  statDate,
  onClassChange,
  onStatDateChange,
  onRefresh,
  refreshDisabled = false,
}) {
  const options = classOptions.length > 0
    ? classOptions.map((item) => ({ value: item.classId, label: item.displayName }))
    : [{ value: '', label: '选择班级' }]

  return (
    <div className="grid w-full min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
      <label className="min-w-0">
        <span className="sr-only">班级</span>
        <Select
          value={selectedClassId}
          onChange={onClassChange || (() => {})}
          options={options}
          width="w-full"
        />
      </label>
      <label className="sr-only" htmlFor="reading-monitor-stat-date">统计日期</label>
      <input
        id="reading-monitor-stat-date"
        type="date"
        value={statDate}
        onChange={(event) => onStatDateChange?.(event.target.value)}
        disabled={!onStatDateChange}
        className="h-8 min-w-0 rounded-lg border border-ink-200 bg-white/85 px-2.5 text-[12.5px] text-ink-800 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100 disabled:opacity-55"
      />
      <Btn
        icon="RefreshCw"
        onClick={onRefresh}
        disabled={refreshDisabled || !onRefresh}
        title={onRefresh ? '刷新阅读统计' : '待真实状态接线后开放刷新'}
      >
        刷新
      </Btn>
    </div>
  )
}

function LoadingSurface() {
  return (
    <div className="space-y-4" aria-label="正在加载班级阅读统计">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="console-glass h-[112px] animate-pulse rounded-xl border border-white/70 bg-white/70" />
        ))}
      </div>
      <div className="grid gap-3.5 lg:grid-cols-2">
        {[0, 1].map((item) => (
          <div key={item} className="console-glass h-[250px] animate-pulse rounded-xl border border-white/70 bg-white/70" />
        ))}
      </div>
      <div className="console-glass h-[320px] animate-pulse rounded-xl border border-white/70 bg-white/70" />
    </div>
  )
}

function OverviewCard({ icon, tone, label, value, note }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-700',
    cyan: 'bg-[#E4F5F2] text-[#2E8C86]',
    violet: 'bg-[#F0ECFB] text-[#6F60B8]',
    accent: 'bg-accent-50 text-accent-700',
  }
  return (
    <GlassCard className="min-w-0 p-4">
      <div className="flex items-center gap-2.5">
        <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-lg', tones[tone])}>
          <Icon name={icon} className="h-4 w-4" strokeWidth={1.9} />
        </span>
        <span className="whitespace-nowrap text-[12.5px] font-medium text-ink-600">{label}</span>
      </div>
      <p className="mt-3 whitespace-nowrap font-serif text-[27px] font-bold leading-none text-ink-900 tabular-nums">{value}</p>
      <p className="mt-2 min-h-4 break-keep text-[11.5px] text-ink-500">{note}</p>
    </GlassCard>
  )
}

function OverviewCards({ data }) {
  const { summary, class: classInfo } = data
  const emptyClass = classInfo.activeStudentCount === 0
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      <OverviewCard
        icon="CalendarCheck2"
        tone="brand"
        label="今日打卡率"
        value={formatBasisPoints(summary.checkInRateBasisPoints)}
        note={emptyClass
          ? '当前班级没有有效学生'
          : `${summary.checkedInStudentCount}/${classInfo.activeStudentCount} 人达到 5 分钟`}
      />
      <OverviewCard
        icon="Timer"
        tone="cyan"
        label="今日人均有效阅读"
        value={summary.perCapitaEffectiveReadingSeconds === null ? '—' : formatMonitorDuration(summary.perCapitaEffectiveReadingSeconds)}
        note={emptyClass ? '空班级不展示 0 分钟' : '零时长学生也进入分母'}
      />
      <OverviewCard
        icon="Forward"
        tone="violet"
        label="今日有跳读"
        value={`${summary.skipStudentCount} 人`}
        note="仅表示今日是否记录到跳读"
      />
      <OverviewCard
        icon="Undo2"
        tone="accent"
        label="今日有回读"
        value={`${summary.rereadStudentCount} 人`}
        note="仅表示今日是否记录到回读"
      />
    </div>
  )
}

function compactDate(value) {
  const [, month = '', day = ''] = value.split('-')
  return `${month}/${day}`
}

function TrendChart({ title, description, points, valueOf, formatValue, minimumScale }) {
  const values = points.map(valueOf)
  const maximum = Math.max(minimumScale, ...values.filter((value) => Number.isFinite(value)))

  return (
    <GlassCard className="p-4">
      <SubHead icon="ChartNoAxesColumn" title={title} />
      <p className="mb-4 text-[11.5px] text-ink-500">{description}</p>
      <div className="grid h-[150px] grid-cols-7 items-end gap-1 sm:gap-2" aria-hidden="true">
        {points.map((point) => {
          const value = valueOf(point)
          const barHeight = value == null || value === 0 ? 2 : Math.max(8, (value / maximum) * 100)
          return (
            <div key={point.statDate} className="flex h-full min-w-0 flex-col items-center justify-end gap-1.5">
              <span className="max-w-full truncate text-[10px] text-ink-500 tabular-nums">{formatValue(value)}</span>
              <span
                className="w-full max-w-8 rounded-t-md bg-[#61AD9D]/75"
                style={{ height: `${barHeight}%` }}
              />
              <span className="text-[10px] text-ink-400 tabular-nums">{compactDate(point.statDate)}</span>
            </div>
          )
        })}
      </div>
      <table className="sr-only">
        <caption>{title}的文字数值</caption>
        <thead><tr><th>日期</th><th>数值</th></tr></thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.statDate}>
              <td>{point.statDate}</td>
              <td>{formatValue(valueOf(point))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </GlassCard>
  )
}

function TrendSection({ trend }) {
  return (
    <section aria-labelledby="reading-trend-title">
      <div className="mb-2.5 flex items-center gap-2">
        <Icon name="ChartLine" className="h-4 w-4 text-[#3E9E8F]" strokeWidth={1.9} />
        <h2 id="reading-trend-title" className="text-[13.5px] font-semibold text-ink-800">近 7 日趋势</h2>
      </div>
      <div className="grid gap-3.5 lg:grid-cols-2">
        <TrendChart
          title="打卡率"
          description="历史比率保留服务端原值，不使用当前班级人数重算。"
          points={trend}
          valueOf={(point) => point.checkInRateBasisPoints}
          formatValue={formatBasisPoints}
          minimumScale={10000}
        />
        <TrendChart
          title="人均有效阅读"
          description="每个日期都包含零时长学生，共展示 7 个数据点。"
          points={trend}
          valueOf={(point) => point.perCapitaEffectiveReadingSeconds}
          formatValue={formatMonitorDuration}
          minimumScale={1}
        />
      </div>
    </section>
  )
}

function ReadingFlags({ student, compact = false }) {
  const flags = []
  if (student.hadSkip) flags.push('跳读')
  if (student.hadReread) flags.push('回读')
  if (flags.length === 0) return <span className="text-[11.5px] text-ink-400">未记录这两类行为</span>
  return (
    <span className={cx('flex flex-wrap gap-1.5', compact && 'justify-end')}>
      {flags.map((flag) => <StatusTag key={flag} tone="violet">{flag}</StatusTag>)}
    </span>
  )
}

function LastReadAt({ value }) {
  return <>{value === null ? '今日暂无阅读记录' : formatMonitorTimestamp(value)}</>
}

function StudentTable({ students, onOpenStudent }) {
  return (
    <div className="hidden overflow-x-auto rounded-xl border border-ink-150 bg-white/60 md:block">
      <table className="w-full min-w-[920px] text-left">
        <thead>
          <tr className="bg-ink-50/75 text-[11.5px] text-ink-500">
            <th className="px-3 py-2.5 font-medium">学生</th>
            <th className="px-2 py-2.5 font-medium">今日有效阅读</th>
            <th className="px-2 py-2.5 font-medium">打卡状态</th>
            <th className="px-2 py-2.5 font-medium">连续天数</th>
            <th className="px-2 py-2.5 font-medium">阅读行为</th>
            <th className="px-2 py-2.5 font-medium">最近阅读时间</th>
            <th className="px-3 py-2.5 text-right font-medium">详情</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100/80">
          {students.map((student) => (
            <tr key={student.studentId} className="text-[12.5px] text-ink-700 hover:bg-white/65">
              <td className="px-3 py-3 font-medium text-ink-900">{student.displayName}</td>
              <td className="px-2 py-3 tabular-nums">{formatMonitorDuration(student.todayEffectiveReadingSeconds)}</td>
              <td className="px-2 py-3">
                <StatusTag tone={student.checkedIn ? 'brand' : 'muted'}>{student.checkedIn ? '已打卡' : '未打卡'}</StatusTag>
              </td>
              <td className="px-2 py-3 tabular-nums">{student.streakDays} 天</td>
              <td className="px-2 py-3"><ReadingFlags student={student} /></td>
              <td className="px-2 py-3 text-[11.5px] text-ink-500"><LastReadAt value={student.lastReadAt} /></td>
              <td className="px-3 py-3 text-right">
                <button
                  type="button"
                  onClick={(event) => onOpenStudent(student, event.currentTarget)}
                  className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-brand-700 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
                >
                  查看
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StudentCards({ students, onOpenStudent }) {
  return (
    <div className="grid gap-2.5 md:hidden">
      {students.map((student) => (
        <button
          key={student.studentId}
          type="button"
          onClick={(event) => onOpenStudent(student, event.currentTarget)}
          className="rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
        >
          <GlassCard className="p-3.5">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-ink-900">{student.displayName}</p>
                <p className="mt-1 text-[11.5px] text-ink-500">{formatMonitorDuration(student.todayEffectiveReadingSeconds)} · {student.streakDays} 天</p>
              </div>
              <StatusTag tone={student.checkedIn ? 'brand' : 'muted'}>{student.checkedIn ? '已打卡' : '未打卡'}</StatusTag>
              <Icon name="ChevronRight" className="mt-1 h-4 w-4 shrink-0 text-ink-300" />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <ReadingFlags student={student} />
              <span className="text-[10.5px] text-ink-400"><LastReadAt value={student.lastReadAt} /></span>
            </div>
          </GlassCard>
        </button>
      ))}
    </div>
  )
}

function StudentList({ students, total, keyword, filter, onKeywordChange, onFilterChange, onOpenStudent }) {
  return (
    <section aria-labelledby="student-reading-list-title">
      <div className="mb-3 flex flex-col gap-2.5 lg:flex-row lg:items-center">
        <div>
          <h2 id="student-reading-list-title" className="text-[13.5px] font-semibold text-ink-800">学生阅读列表</h2>
          <p className="mt-1 text-[11.5px] text-ink-500">按姓名规范化后排序，同名时用学生 ID 稳定排序；当前显示 {students.length}/{total} 人。</p>
        </div>
        <div className="flex-1" />
        <div className="flex flex-col gap-2 sm:flex-row">
          <SearchBox
            value={keyword}
            onChange={onKeywordChange}
            placeholder="按学生姓名搜索"
            width="w-full sm:w-[210px]"
          />
          <Select
            value={filter}
            onChange={onFilterChange}
            options={STUDENT_READING_FILTERS}
            width="w-full sm:w-[142px]"
          />
        </div>
      </div>
      {students.length === 0 ? (
        <GlassCard>
          <EmptyState icon="SearchX" title="没有匹配的学生" desc="可以清空姓名搜索或切换单一状态筛选。" className="py-10" />
        </GlassCard>
      ) : (
        <>
          <StudentTable students={students} onOpenStudent={onOpenStudent} />
          <StudentCards students={students} onOpenStudent={onOpenStudent} />
        </>
      )}
    </section>
  )
}

function DetailRow({ label, children }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-ink-100/80 py-2.5 last:border-0 sm:grid-cols-[94px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-[11.5px] text-ink-400">{label}</dt>
      <dd className="min-w-0 text-[12.5px] text-ink-800">{children}</dd>
    </div>
  )
}

function RecentDays({ days }) {
  const maximum = Math.max(1, ...days.map((day) => day.effectiveReadingSeconds))
  return (
    <div>
      <div className="grid h-[96px] grid-cols-7 items-end gap-1.5" aria-hidden="true">
        {days.map((day) => (
          <div key={day.statDate} className="flex h-full flex-col items-center justify-end gap-1">
            <span
              className={cx('w-full max-w-6 rounded-t', day.checkedIn ? 'bg-[#4BAA92]' : 'bg-ink-200')}
              style={{ height: `${day.effectiveReadingSeconds === 0 ? 2 : Math.max(8, (day.effectiveReadingSeconds / maximum) * 100)}%` }}
            />
            <span className="text-[9.5px] text-ink-400">{compactDate(day.statDate)}</span>
          </div>
        ))}
      </div>
      <ol className="mt-2 space-y-1 text-[11px] text-ink-500">
        {days.map((day) => (
          <li key={day.statDate} className="flex justify-between gap-3">
            <span>{day.statDate}</span>
            <span>{formatMonitorDuration(day.effectiveReadingSeconds)} · {day.checkedIn ? '已打卡' : '未打卡'}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function StudentReadingDetailDrawer({ student, onClose, returnFocusRef }) {
  const panelRef = useRef(null)

  useEffect(() => {
    if (!student) return undefined
    const previousBodyOverflow = document.body.style.overflow
    const backgroundScrollers = [...document.querySelectorAll('.console-scroll')]
    const previousScrollerOverflow = backgroundScrollers.map((element) => element.style.overflow)
    document.body.style.overflow = 'hidden'
    backgroundScrollers.forEach((element) => {
      element.style.overflow = 'hidden'
    })
    const panel = panelRef.current
    const focusable = panel?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    focusable?.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose?.()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const items = [...panel.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      if (items.length === 0) return
      const first = items[0]
      const last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousBodyOverflow
      backgroundScrollers.forEach((element, index) => {
        element.style.overflow = previousScrollerOverflow[index]
      })
      returnFocusRef?.current?.focus()
    }
  }, [onClose, returnFocusRef, student])

  if (!student) return null
  const comparison = describeTeacherComparison(student.lastWeek)

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end overflow-hidden bg-ink-900/25 p-0 backdrop-blur-[2px] md:p-3"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose?.()
      }}
    >
      <GlassPanel
        tone="float"
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-reading-detail-title"
        aria-describedby="student-reading-detail-description"
        className="h-[100dvh] max-h-[100dvh] min-h-0 w-full overflow-y-auto overscroll-contain rounded-none shadow-e3 md:h-[calc(100dvh-1.5rem)] md:max-h-[calc(100dvh-1.5rem)] md:max-w-[520px] md:rounded-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div ref={panelRef} className="min-h-full">
          <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-white/80 bg-white/[0.88] px-5 py-4 backdrop-blur-xl">
          <div className="min-w-0 flex-1">
            <p className="text-[11.5px] text-ink-500">学生阅读详情</p>
            <h2 id="student-reading-detail-title" className="mt-0.5 truncate font-serif text-[20px] font-bold text-ink-900">{student.displayName}</h2>
            <p id="student-reading-detail-description" className="sr-only">展示这名学生的今日阅读、上周对比、阅读行为和近七日汇总。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭学生阅读详情"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-400 transition hover:bg-white hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
          >
            <Icon name="X" className="h-4 w-4" />
          </button>
          </div>

          <div className="space-y-5 px-4 py-5 sm:px-5">
          <section>
            <SubHead icon="BookOpenCheck" title="今日阅读" />
            <dl className="rounded-xl border border-white/75 bg-white/55 px-3.5">
              <DetailRow label="有效阅读">{formatMonitorDuration(student.todayEffectiveReadingSeconds)}</DetailRow>
              <DetailRow label="打卡状态">{student.checkedIn ? '已打卡' : '未打卡'}</DetailRow>
              <DetailRow label="连续天数">{student.streakDays} 天</DetailRow>
              <DetailRow label="最近阅读"><LastReadAt value={student.lastReadAt} /></DetailRow>
            </dl>
          </section>

          <section>
            <SubHead icon="CalendarRange" title="上周对比" />
            <dl className="rounded-xl border border-white/75 bg-white/55 px-3.5">
              <DetailRow label="上周总时长">{formatMonitorDuration(student.lastWeek.totalEffectiveReadingSeconds)}</DetailRow>
              <DetailRow label="上周日均">{formatMonitorDuration(student.lastWeek.dailyAverageEffectiveReadingSeconds)}</DetailRow>
              <DetailRow label="截至今日">{comparison}</DetailRow>
            </dl>
          </section>

          <section>
            <SubHead icon="Route" title="今日阅读行为" />
            <dl className="rounded-xl border border-white/75 bg-white/55 px-3.5">
              <DetailRow label="跳读">{student.hadSkip ? '今日记录到跳读' : '今日未记录到跳读'}</DetailRow>
              <DetailRow label="回读">{student.hadReread ? '今日记录到回读' : '今日未记录到回读'}</DetailRow>
            </dl>
          </section>

          <section>
            <SubHead icon="ChartNoAxesColumn" title="近 7 日" />
            <GlassCard className="p-3.5"><RecentDays days={student.recentDays} /></GlassCard>
          </section>

          <section>
            <SubHead icon="BookMarked" title="最近阅读书籍" />
            <GlassCard className="p-3.5 text-[12.5px] text-ink-700">
              {student.lastReading ? student.lastReading.title : '暂无可展示的最近阅读书籍'}
            </GlassCard>
          </section>
          </div>
        </div>
      </GlassPanel>
    </div>,
    document.body,
  )
}

export default function ReadingStatisticsView({
  resource,
  keyword,
  filter,
  onKeywordChange,
  onFilterChange,
  selectedStudentId,
  onOpenStudent,
  onCloseStudent,
  returnFocusRef,
  onRetry,
}) {
  const view = useMemo(
    () => (['ready', 'stale', 'empty'].includes(resource?.status) && resource?.data
      ? buildReadingStatisticsViewModel(resource.data, { keyword, filter })
      : null),
    [filter, keyword, resource?.data, resource?.status],
  )

  if (!resource) {
    return (
      <StatusSurface
        icon="Cable"
        title="阅读统计等待真实状态接入"
        description="纯展示组件已就绪，当前页面不会用演示数据代替班级统计。"
      />
    )
  }
  if (resource.status === 'loading') return <LoadingSurface />
  if (resource.status === 'forbidden') {
    return (
      <StatusSurface
        icon="ShieldX"
        title="无权查看该班级阅读统计"
        description="请检查当前权限范围，本页不会将权限失败显示成空数据。"
      />
    )
  }
  if (resource.status === 'error') {
    return (
      <StatusSurface
        icon="CloudOff"
        title="班级阅读统计加载失败"
        description={resource.error?.message || '服务暂时不可用，本页不会将失败显示成 0。'}
        action={onRetry ? <Btn icon="RefreshCw" onClick={onRetry}>重试</Btn> : null}
      />
    )
  }
  if (resource.status === 'empty') {
    if (!resource.data) return (
      <StatusSurface
        icon="Users"
        title="当前没有可展示的班级范围"
        description="请先选择一个当前账号可访问的班级。"
      />
    )
  }
  if (!['ready', 'stale', 'empty'].includes(resource.status)) {
    return <StatusSurface icon="CircleHelp" title="阅读统计状态无法识别" description="请刷新页面后重试。" />
  }

  if (!view.valid) {
    return (
      <StatusSurface
        icon="FileWarning"
        title="班级阅读统计响应不完整"
        description="缺失的字段没有被补成 0 或空列表，请重新读取。"
        action={onRetry ? <Btn icon="RefreshCw" onClick={onRetry}>重新读取</Btn> : null}
      />
    )
  }

  const selectedStudent = view.data.students.find((student) => student.studentId === selectedStudentId) || null

  return (
    <>
      {resource.status === 'stale' && (
        <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-ink-200 bg-white/65 px-3.5 py-3 text-[12px] text-ink-600" role="status">
          <Icon name="History" className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
          <span>当前显示的是上一次成功读取的统计，数据时间：{view.updateLabel}。可以手动刷新。</span>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11.5px] text-ink-500">
        <span className="font-medium text-ink-700">{view.data.class.displayName}</span>
        <span>统计日：{view.data.statDate}</span>
        <span>数据更新：{view.updateLabel}</span>
      </div>

      <div className="space-y-5">
        <OverviewCards data={view.data} />
        <TrendSection trend={view.data.trend} />
        {view.emptyClass && (
          <div className="rounded-xl border border-dashed border-ink-200 bg-white/45 px-4 py-5 text-center text-[12.5px] text-ink-500">
            当前班级没有有效学生，打卡率和人均有效阅读显示为“—”，不会伪装成 0%。
          </div>
        )}
        <StudentList
          students={view.students}
          total={view.data.students.length}
          keyword={keyword}
          filter={filter}
          onKeywordChange={onKeywordChange}
          onFilterChange={onFilterChange}
          onOpenStudent={onOpenStudent}
        />
      </div>

      <StudentReadingDetailDrawer
        student={selectedStudent}
        onClose={onCloseStudent}
        returnFocusRef={returnFocusRef}
      />
    </>
  )
}
