import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cx, Icon } from '../../components/ui.jsx'
import { GlassCard } from '../components/Glass.jsx'
import { PagePanel } from '../components/PagePanel.jsx'
import { Btn, EmptyState, SearchBox, Select, StatusTag, SubHead } from '../components/Controls.jsx'
import { BarProgress } from '../components/Progress.jsx'
import { useConsole } from '../state/ConsoleContext.jsx'
import useReadingStatistics from '../state/useReadingStatistics.js'

// 班级与学生总览：跨班横向对比，一屏看完「哪个班落后、哪些学生需要关注」。
// 需要关注的学生按三条明确规则挑出来，不做模糊的「综合评分」。

const SORTS = [
  { value: 'reading', label: '按有效阅读' },
  { value: 'students', label: '按参与人数' },
  { value: 'anomalies', label: '按异常停留' },
]

function minutes(seconds) {
  const value = Number(seconds)
  return Number.isFinite(value) ? Math.round(value / 60) : 0
}

function eyeCareReason(item) {
  if (item.status === 'forced_rest') return { tone: 'danger', text: '当前处于强制休息' }
  if (item.status === 'reminder') return { tone: 'warning', text: '当前需要休息提醒' }
  return null
}

export default function ClassOverview() {
  const { workspace } = useConsole()
  const navigate = useNavigate()
  const { status: resourceStatus, data, error } = useReadingStatistics(workspace?.id)
  const maximumMinutes = Math.max(1, ...(data?.byBook || []).map((book) => minutes(book.effectiveReadingSeconds)))
  const maximumParticipants = Math.max(1, ...(data?.byBook || []).map((book) => Number(book.participantCount || 0)))
  const classes = useMemo(() => (data?.byBook || []).map((book) => {
    const effectiveMinutes = minutes(book.effectiveReadingSeconds)
    const anomalies = (data?.anomalousStays || []).filter((item) => item.bookVersionId === book.bookVersionId).length
    return {
      id: book.bookVersionId || book.bookId,
      bookId: book.bookId,
      name: book.title || book.bookId || '未命名书籍',
      subject: book.bookVersionId || '未返回版本号',
      headTeacher: `${book.participantCount} 人`,
      students: book.participantCount,
      active: book.participantCount,
      effectiveMinutes,
      anomalies,
      progress: {
        reading: Math.round((effectiveMinutes / maximumMinutes) * 100),
        quota: Math.round((Number(book.participantCount || 0) / maximumParticipants) * 100),
        report: anomalies,
      },
    }
  }), [data?.anomalousStays, data?.byBook, maximumMinutes, maximumParticipants])
  const [keyword, setKeyword] = useState('')
  const [sort, setSort] = useState('reading')

  const rows = useMemo(() => {
    const k = keyword.trim()
    const list = classes.filter((c) => !k || c.name.includes(k) || c.subject.includes(k))
    return [...list].sort((a, b) =>
      sort === 'students' ? b.students - a.students : sort === 'anomalies' ? b.anomalies - a.anomalies : b.effectiveMinutes - a.effectiveMinutes,
    )
  }, [classes, keyword, sort])

  // 需要关注：只展示服务端返回的异常停留与当前护眼状态，不生成竞争性学生排行。
  const watch = useMemo(() => {
    const people = new Map()
    for (const item of data?.anomalousStays || []) {
      if (!people.has(item.studentId)) people.set(item.studentId, { student: { id: item.studentId, name: item.studentDisplayName || item.studentId, classId: item.classId, className: item.classId }, reasons: [] })
      people.get(item.studentId).reasons.push({ tone: 'warning', text: `异常停留 ${minutes(item.observedSeconds)} 分钟` })
    }
    for (const item of data?.eyeCareStatuses || []) {
      const reason = eyeCareReason(item)
      if (!reason) continue
      if (!people.has(item.studentId)) people.set(item.studentId, { student: { id: item.studentId, name: item.studentDisplayName || item.studentId, classId: item.classId, className: item.classId }, reasons: [] })
      people.get(item.studentId).reasons.push(reason)
    }
    return [...people.values()].slice(0, 6)
  }, [data?.anomalousStays, data?.eyeCareStatuses])

  const total = data?.participantCount || 0
  const active = minutes(data?.effectiveReadingSeconds)
  const avg = classes.length ? Math.round(active / classes.length) : 0

  return (
    <PagePanel
      title={`${workspace?.scopeLabel || '权限范围'} · 班级与学生总览`}
      desc="按真实阅读事件汇总参与人数、有效阅读、异常停留与护眼状态；重叠设备时段由后端去重，不生成竞争性学生排行。"
      toolbar={
        <>
          <SearchBox value={keyword} onChange={setKeyword} placeholder="搜索书籍或版本" />
          <Select value={sort} onChange={setSort} options={SORTS} width="w-[140px]" />
        </>
      }
    >
      {resourceStatus === 'error' ? (
        <EmptyState icon="TriangleAlert" title="阅读统计加载失败" desc={error?.message || '服务端拒绝了这次请求。'} />
      ) : classes.length === 0 ? (
        <EmptyState
          icon="Users"
          title={resourceStatus === 'loading' ? '正在加载真实阅读统计' : '当前范围暂无有效阅读数据'}
          desc={resourceStatus === 'loading' ? '正在向服务端读取数据。' : '完成真实阅读后刷新页面即可看到统计，不会用演示数据填充。'}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <SumCard icon="Users" tone="brand" label="参与学生" value={total} unit="人" />
            <SumCard icon="GraduationCap" tone="cyan" label="涉及书籍" value={classes.length} unit="本" />
            <SumCard
              icon="BookOpen"
              tone="violet"
              label="有效阅读"
              value={active}
              unit="分钟"
              note="区间并集去重"
            />
            <SumCard icon="Gauge" tone="accent" label="每书平均" value={avg} unit="分钟" />
          </div>

          <div className="mt-4">
            <SubHead icon="ChartNoAxesColumn" title={`按书统计（${rows.length}）`} />
            <div className="rounded-xl border border-ink-150 overflow-hidden bg-white/60">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-ink-50/70 text-[11.5px] text-ink-500">
                    <th className="px-3 py-2.5 font-medium">书籍</th>
                    <th className="px-2 py-2.5 font-medium w-[92px]">参与人数</th>
                    <th className="px-2 py-2.5 font-medium w-[88px]">有效分钟</th>
                    <th className="px-2 py-2.5 font-medium w-[168px]">阅读占比</th>
                    <th className="px-2 py-2.5 font-medium w-[168px]">参与占比</th>
                    <th className="px-2 py-2.5 font-medium w-[96px]">异常停留</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className="border-t border-ink-150/70 hover:bg-white/70 transition">
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => navigate(`/console/teaching/books/${c.bookId}`)}
                          className="text-[13px] font-medium text-ink-900 hover:text-brand-700 transition"
                        >
                          {c.name}
                        </button>
                        <span className="block text-[11px] text-ink-400">{c.subject}</span>
                      </td>
                      <td className="px-2 py-2.5 text-[12.5px] text-ink-700">{c.headTeacher}</td>
                      <td className="px-2 py-2.5 text-[12.5px] text-ink-700 tabular-nums">
                        {c.effectiveMinutes}
                      </td>
                      <td className="px-2 py-2.5">
                        <Cell value={c.progress.reading} tone={c.progress.reading < avg ? 'warning' : 'brand'} />
                      </td>
                      <td className="px-2 py-2.5">
                        <Cell
                          value={c.progress.quota}
                          tone={c.progress.quota >= 80 ? 'danger' : c.progress.quota >= 60 ? 'warning' : 'brand'}
                        />
                      </td>
                      <td className="px-2 py-2.5">
                        <StatusTag tone={c.progress.report === 0 ? 'muted' : 'warning'}>
                          {c.progress.report} 条
                        </StatusTag>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11.5px] text-ink-500 mt-2">
              有效阅读使用真实事件区间并集计算，同账号多设备重叠时间不会重复累计；异常停留只作复核提示。
            </p>
          </div>

          <div className="mt-4">
            <SubHead
              icon="BellRing"
              title={`需要关注的真实状态（${watch.length}）`}
              extra={
                <button
                  type="button"
                  onClick={() => navigate('/console/classes/eyecare')}
                  className="text-[11.5px] text-ink-400 hover:text-brand-600 transition"
                >
                  去护眼管理
                </button>
              }
            />
            {watch.length === 0 ? (
              <div className="rounded-xl border border-dashed border-ink-200 bg-white/50 py-8 text-center">
                <Icon name="CheckCheck" className="w-6 h-6 text-ink-300 mx-auto" strokeWidth={1.6} />
                <p className="text-[13px] text-ink-600 mt-2">当前范围没有异常停留或护眼提醒</p>
                <p className="text-[11.5px] text-ink-400 mt-1">这里只展示服务端返回的真实状态，不生成学生竞争排行</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {watch.map(({ student, reasons }) => (
                  <button
                    key={student.id}
                    type="button"
                    onClick={() => navigate(`/console/accounts/students/${student.id}`, { state: { from: '/console/classes/overview' } })}
                    className="text-left"
                  >
                    <GlassCard className="p-3 hover:shadow-e2 transition h-full">
                      <div className="flex items-center gap-2.5">
                        <span className="console-avatar w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold text-white shrink-0">
                          {student.name.slice(0, 1)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-ink-900 truncate">{student.name}</div>
                          <div className="text-[11px] text-ink-400 truncate">
                            {student.className || student.classId || '未返回班级名称'}
                          </div>
                        </div>
                        <Icon name="ChevronRight" className="w-4 h-4 text-ink-300 shrink-0" />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {reasons.map((r) => (
                          <StatusTag key={r.text} tone={r.tone} dot>
                            {r.text}
                          </StatusTag>
                        ))}
                      </div>
                    </GlassCard>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </PagePanel>
  )
}

const SUM_TONE = {
  brand: 'bg-brand-50 text-brand-600',
  cyan: 'bg-[#E4F5F2] text-[#2E8C86]',
  violet: 'bg-[#F0ECFB] text-[#7C6BD8]',
  accent: 'bg-accent-50 text-accent-600',
}

function SumCard({ icon, tone, label, value, unit, note }) {
  return (
    <GlassCard className="p-3.5">
      <div className="flex items-center gap-2">
        <span className={cx('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', SUM_TONE[tone])}>
          <Icon name={icon} className="w-4 h-4" strokeWidth={1.9} />
        </span>
        <span className="text-[12.5px] font-medium text-ink-700">{label}</span>
      </div>
      <div className="mt-2.5 flex items-baseline gap-1.5">
        <span className="font-serif text-[28px] leading-none font-bold text-ink-900 tabular-nums">{value}</span>
        <span className="text-[11.5px] text-ink-500">{unit}</span>
        {note && <span className="text-[11px] text-ink-400 ml-1">{note}</span>}
      </div>
    </GlassCard>
  )
}

function Cell({ value, tone }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        <BarProgress value={value} showValue={false} size="sm" tone={tone} />
      </div>
      <span className="text-[11.5px] text-ink-600 tabular-nums w-8 text-right">{value}%</span>
    </div>
  )
}
