import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { cx, Icon } from '../../../components/ui.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, EmptyState, Field, StatusTag, SubHead } from '../../components/Controls.jsx'
import { BarProgress } from '../../components/Progress.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import useAssignmentsData from '../../state/useAssignmentsData.js'
import { ASSIGNMENT_STATUS, ASSIGNMENT_TYPES } from '../../../adapters/consoleAssignments.js'

function numberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null
}

function remainDays(plan) {
  if (plan.status === 'done') return 0
  const end = Date.parse(plan.end)
  if (!Number.isFinite(end)) return null
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000))
}

export default function ArrangeDetail() {
  const { planId } = useParams()
  const navigate = useNavigate()
  const { workspace } = useConsole()
  const resource = useAssignmentsData(workspace?.id)
  const plan = resource.data?.arrangements.find((item) => item.id === planId) || null
  const book = plan ? resource.data?.books.find((item) => item.id === plan.bookId) || null : null
  const type = ASSIGNMENT_TYPES.find((item) => item.key === plan?.type) || ASSIGNMENT_TYPES[0]
  const status = ASSIGNMENT_STATUS[plan?.status] || ASSIGNMENT_STATUS.running
  const progress = numberOrNull(plan?.progress)
  const classProgress = useMemo(
    () => (plan?.classIds || []).map((classId, index) => ({
      classId,
      name: plan.classNames?.[index] || classId,
    })),
    [plan?.classIds, plan?.classNames],
  )

  if (resource.status === 'loading') {
    return (
      <PagePanel title="正在读取阅读安排" desc="安排资料只从后端真实接口读取。">
        <EmptyState icon="CalendarClock" title="正在读取安排详情" desc="请稍候，读取完成后会保留当前页面结构。" />
      </PagePanel>
    )
  }

  if (resource.status === 'error') {
    return (
      <PagePanel title="阅读安排暂时不可用" desc="安排详情请求失败，未回退任何演示数据。">
        <EmptyState icon="CloudOff" title="无法读取安排详情" desc={resource.error?.message || '请返回列表后重试。'} action={<Btn tone="primary" icon="ArrowLeft" onClick={() => navigate('/console/teaching/arrangements')}>回到安排列表</Btn>} />
      </PagePanel>
    )
  }

  if (!plan) {
    return (
      <PagePanel title="安排不存在" desc="这个阅读安排可能已被删除，或不在当前工作空间的可见范围内。">
        <EmptyState icon="CalendarX" title="找不到这个阅读安排" desc="请回到安排列表重新选择；跨班安排只有对应范围可见。" action={<Btn tone="primary" icon="ArrowLeft" onClick={() => navigate('/console/teaching/arrangements')}>回到安排列表</Btn>} />
      </PagePanel>
    )
  }

  return (
    <PagePanel
      title={`${plan.title} · ${plan.chapter || '阅读安排'}`}
      desc={`${type.label} · ${plan.classNames?.join('、') || '服务端未返回班级'} · 负责人 ${plan.owner || '服务端未返回'} · 创建于 ${plan.start || '服务端未返回'}`}
      toolbar={
        <>
          <Btn icon="ArrowLeft" onClick={() => navigate('/console/teaching/arrangements')}>返回列表</Btn>
          <Btn tone="primary" icon="BookOpen" disabled={!plan.bookId} onClick={() => navigate(`/console/teaching/reader/${plan.bookId}`)}>带读这一章</Btn>
        </>
      }
    >
      {plan.status === 'paused' && (
        <div className="mb-3.5 flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-warning-50/80 border border-warning-100">
          <Icon name="PauseCircle" className="w-4 h-4 mt-px text-warning-600 shrink-0" strokeWidth={1.9} />
          <p className="text-[12.5px] text-ink-700"><span className="font-medium">已暂停：</span>当前状态由服务端返回，恢复接口尚未开放。</p>
        </div>
      )}

      <div className="flex items-start gap-4">
        <button type="button" disabled={!book?.id} onClick={() => book?.id && navigate(`/console/teaching/reader/${book.id}`)} className="shrink-0 w-[92px] group disabled:opacity-50">
          <div className="w-full aspect-[3/4] rounded-lg shadow-e2 relative overflow-hidden bg-ink-100">
            {book?.coverUrl ? <img src={book.coverUrl} alt={book.title} className="absolute inset-0 h-full w-full object-cover" /> : <span className="absolute inset-0 grid place-items-center px-2 text-center text-[11px] text-ink-500">{book?.title || '服务端未返回封面'}</span>}
          </div>
          <span className="block text-[11.5px] text-ink-500 group-hover:text-brand-600 transition mt-1 text-center">进入带读</span>
        </button>

        <div className="min-w-0 flex-1 grid grid-cols-1 lg:grid-cols-2 gap-x-8">
          <div>
            <Field label="类型"><span>{type.label}</span><StatusTag tone={status.tone} dot className="ml-2">{status.label}</StatusTag></Field>
            <Field label="参与班级">{plan.classNames?.join('、') || '服务端未返回'}</Field>
            <Field label="参与人数"><span className="tabular-nums">{plan.joined ?? '—'} / {plan.total ?? '—'} 人已加入</span></Field>
          </div>
          <div>
            <Field label="起止时间"><span className="tabular-nums">{plan.start || '—'} → {plan.end || '—'}</span></Field>
            <Field label="每日开始">{plan.startTime || '服务端未返回'}</Field>
            <Field label="给学生的说明">{plan.chapter || '服务端未返回'}</Field>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-3.5 border-t border-ink-150/70 flex items-center gap-2 flex-wrap">
        <Btn icon="Pencil" disabled title="编辑安排接口尚未接入">编辑安排</Btn>
        <Btn icon={plan.status === 'paused' ? 'Play' : 'Pause'} disabled title="暂停/恢复安排接口尚未接入">{plan.status === 'paused' ? '恢复安排' : '暂停安排'}</Btn>
        <Btn icon="FileText" onClick={() => navigate('/console/reports')}>查看班级报告</Btn>
        <div className="flex-1" />
        <Btn tone="danger" icon="Trash2" disabled title="删除安排接口尚未接入">删除安排</Btn>
      </div>
      <p className="mt-2 text-[11.5px] text-ink-400">编辑、暂停、恢复和删除会在后端接口接入后开放；当前不会伪造本地保存结果。</p>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        <GlassCard className="p-3.5 lg:col-span-2">
          <SubHead icon="Gauge" title="整体进度" />
          {progress == null ? <p className="mt-3 text-[12.5px] text-ink-500">服务端尚未返回整体进度，页面不会用演示数字补齐。</p> : <BarProgress value={progress} size="lg" label="全部参与学生的平均进度" tone={plan.status === 'paused' ? 'warning' : progress === 100 ? 'success' : 'brand'} hint="整体进度由服务端返回。" />}
        </GlassCard>
        <GlassCard className="p-3.5">
          <SubHead icon="Users" title="参与情况" />
          <div className="grid grid-cols-2 gap-y-2.5">
            <Metric label="已加入" value={plan.joined} unit="人" />
            <Metric label="目标人数" value={plan.total} unit="人" />
            <Metric label="班级数" value={plan.classIds?.length} unit="个" />
            <Metric label="剩余天数" value={remainDays(plan)} unit="天" />
          </div>
        </GlassCard>
      </div>

      <div className="mt-3.5"><GlassCard className="p-3.5"><SubHead icon="ChartNoAxesColumn" title={`参与班级（${classProgress.length}）`} />
        {classProgress.length ? <ul className="mt-3 space-y-2">{classProgress.map((item) => <li key={item.classId} className="flex items-center justify-between rounded-lg bg-white/55 px-3 py-2"><span className="text-[12.5px] font-medium text-ink-800">{item.name}</span><span className="text-[11.5px] text-ink-500">服务端未返回分班进度</span></li>)}</ul> : <p className="mt-3 text-[12.5px] text-ink-500">服务端尚未返回参与班级。</p>}
      </GlassCard></div>

      <div className="mt-3.5"><GlassCard className="p-3.5"><SubHead icon="History" title="安排时间线" />
        <ol className="relative mt-3 pl-4"><span className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-ink-200" aria-hidden="true" />
          {[{ at: plan.start || '—', text: '安排起始时间由服务端返回。' }, { at: plan.end || '—', text: '安排结束时间由服务端返回。' }].map((item, index) => <li key={`${item.at}-${index}`} className="relative pb-2.5 last:pb-0"><span className={cx('absolute -left-4 top-1 w-[9px] h-[9px] rounded-full border-2 border-white', index === 1 ? 'bg-brand-500' : 'bg-ink-300')} aria-hidden="true" /><div className="flex items-baseline gap-2"><span className="text-[11.5px] text-ink-400 tabular-nums shrink-0 w-[52px]">{item.at}</span><span className="text-[12.5px] text-ink-700">{item.text}</span></div></li>)}
        </ol>
      </GlassCard></div>
    </PagePanel>
  )
}

function Metric({ label, value, unit }) {
  return <div><div className="text-[11.5px] text-ink-400">{label}</div><div className="mt-0.5 flex items-baseline gap-1"><span className="text-[19px] font-semibold text-ink-900 tabular-nums leading-none">{value ?? '—'}</span>{unit && <span className="text-[11px] text-ink-500">{unit}</span>}</div></div>
}
