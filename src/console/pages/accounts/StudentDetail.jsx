import { useEffect, useRef } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { cx, Icon } from '../../../components/ui.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, EmptyState, Field, StatusTag, SubHead } from '../../components/Controls.jsx'
import { BarProgress } from '../../components/Progress.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import usePrivacyEyeCareData from '../../state/usePrivacyEyeCareData.js'
import useReadingStatistics from '../../state/useReadingStatistics.js'
import useStage4ConsoleData from '../../state/useStage4ConsoleData.js'

const EYE_STATE = {
  normal: { label: '正常', tone: 'success', note: '当前有效用眼时长仍在服务端策略允许范围内。' },
  reminder: { label: '休息提醒', tone: 'warning', note: '系统已根据真实连续用眼记录提醒学生休息。' },
  forced_rest: { label: '强制休息', tone: 'danger', note: '学生阅读器处于真实强制休息状态，会在到期后自动恢复。' },
  unknown: { label: '未返回', tone: 'muted', note: '当前工作空间没有返回这名学生的护眼状态。' },
}

function text(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function minutes(value) {
  const seconds = numberOrNull(value)
  return seconds === null ? null : Math.floor(seconds / 60)
}

export default function StudentDetail() {
  const { studentId } = useParams()
  const [searchParams] = useSearchParams()
  const anchorEyeCare = searchParams.get('section') === 'eye-care'
  const eyeRef = useRef(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { workspace, canAccessPath } = useConsole()
  const requestedReturnPath = location.state?.from
  const returnPath = typeof requestedReturnPath === 'string' && requestedReturnPath.startsWith('/console/') && canAccessPath(requestedReturnPath)
    ? requestedReturnPath
    : '/console/classes/overview'
  const returnLabel = returnPath === '/console/accounts/students'
    ? '学生目录'
    : returnPath === '/console/classes/eyecare'
      ? '护眼管理'
      : returnPath === '/console/usage/privacy'
        ? '隐私访问'
        : returnPath.startsWith('/console/reports/')
          ? '报告详情'
          : returnPath.startsWith('/console/safety/')
            ? '安全事件'
            : '学生总览'
  const studentResource = useStage4ConsoleData('studentDetail', { workspaceId: workspace?.id, resourceId: studentId })
  const eyeCareResource = usePrivacyEyeCareData({ workspaceId: workspace?.id, studentId })
  const readingResource = useReadingStatistics(workspace?.id, { studentId })

  useEffect(() => {
    if (anchorEyeCare && eyeRef.current) eyeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [anchorEyeCare, studentId])

  if (studentResource.status === 'loading') {
    return (
      <PagePanel title="学生详情" desc="正在读取当前工作空间有权查看的学生资料。">
        <EmptyState icon="LoaderCircle" title="正在读取学生详情" desc="不会从前端演示档案回退。" />
      </PagePanel>
    )
  }

  if (studentResource.status !== 'ready' || !studentResource.data) {
    return (
      <PagePanel title="学生详情" desc="学生资料、阅读和护眼数据都受当前工作空间权限约束。">
        <EmptyState
          icon={studentResource.status === 'empty' ? 'UserSearch' : 'ShieldX'}
          title={studentResource.status === 'empty' ? '找不到这名学生' : '暂时无法查看这名学生'}
          desc={studentResource.error?.message || studentResource.reason?.message || '请回到班级学生总览重新选择，或切换到有权限的工作空间。'}
          action={<Btn tone="primary" icon="ArrowLeft" onClick={() => navigate(returnPath)}>回到{returnLabel}</Btn>}
        />
      </PagePanel>
    )
  }

  const student = studentResource.data
  const eyeData = eyeCareResource.status === 'ready'
    ? (eyeCareResource.data?.students || []).find((item) => item.studentId === student.id) || null
    : null
  const eye = EYE_STATE[eyeData?.enforcement?.status] || EYE_STATE.unknown
  const policy = eyeData?.enforcement?.policy || null
  const dailySeconds = numberOrNull(policy?.dailySeconds)
  const dailyUsedSeconds = numberOrNull(eyeData?.dailyValidEyeSeconds)
  const dailyPercent = dailySeconds && dailyUsedSeconds !== null
    ? Math.min(100, Math.round((dailyUsedSeconds / dailySeconds) * 100))
    : null
  const readingMinutes = minutes(readingResource.data?.effectiveReadingSeconds)
  const readingBookCount = readingResource.status === 'ready' ? readingResource.data?.byBook?.length : null

  return (
    <PagePanel
      title={`${text(student.displayName, student.id)} · 学生详情`}
      desc={`稳定账号 ${student.id} · 当前状态 ${student.status === 'active' ? '在读' : text(student.status, '服务端未返回')}`}
      toolbar={
        <>
          <Btn icon="ArrowLeft" onClick={() => navigate(returnPath)}>返回{returnLabel}</Btn>
          <Btn icon="MessageSquare" onClick={() => navigate(`/console/usage/sessions?student=${encodeURIComponent(student.id)}`)}>查看会话</Btn>
          <Btn tone="primary" icon="Send" onClick={() => navigate('/console/reports/parents')}>发送报告</Btn>
        </>
      }
    >
      <div className="flex items-start gap-4">
        <span className="console-avatar w-[68px] h-[68px] rounded-2xl flex items-center justify-center text-[24px] font-semibold text-white shrink-0 shadow-e1">
          {text(student.displayName, student.id).slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1 grid grid-cols-1 lg:grid-cols-2 gap-x-8">
          <div>
            <Field label="姓名">
              <span className="font-medium">{text(student.displayName, '服务端未返回')}</span>
              <StatusTag tone={student.status === 'active' ? 'success' : 'warning'} dot className="ml-2">
                {student.status === 'active' ? '在读' : text(student.status, '状态未返回')}
              </StatusTag>
            </Field>
            <Field label="所在班级">{text(eyeData?.classId, '服务端未返回')}</Field>
            <Field label="组织范围">{text(student.organizationId, '服务端未返回')}</Field>
          </div>
          <div>
            <Field label="稳定账号">{student.id}</Field>
            <Field label="最近有效阅读">{text(eyeData?.lastActiveAt, '暂无有效阅读活动')}</Field>
            <Field label="资料版本">{numberOrNull(student.version) ?? '服务端未返回'}</Field>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        <GlassCard className="p-3.5">
          <SubHead icon="BookOpen" title="阅读" />
          <div className="grid grid-cols-2 gap-y-2.5">
            <Metric label="有效阅读" value={readingMinutes} unit="分钟" />
            <Metric label="阅读书目" value={readingBookCount} unit="本" />
            <Metric label="异常停留" value={readingResource.status === 'ready' ? readingResource.data?.anomalousStays?.length : null} unit="条" />
            <Metric label="统计参与者" value={readingResource.status === 'ready' ? readingResource.data?.participantCount : null} unit="人" />
          </div>
          {readingResource.status !== 'ready' && (
            <p className="text-[11.5px] text-ink-500 leading-relaxed mt-2.5">{readingResource.status === 'loading' ? '正在读取真实阅读统计。' : readingResource.error?.message || '当前账号无法读取这名学生的阅读统计。'}</p>
          )}
        </GlassCard>

        <GlassCard
          ref={eyeRef}
          className={cx('p-3.5 transition', anchorEyeCare && 'ring-2 ring-[#4FBFB0] ring-offset-2 ring-offset-white/40')}
        >
          <SubHead icon="Eye" title="护眼" extra={<StatusTag tone={eye.tone} dot>{eye.label}</StatusTag>} />
          {anchorEyeCare && <p className="text-[11px] text-[#2E8C86] bg-[#E4F5F2] border border-[#CDEBE6] rounded-lg px-2 py-1 mb-2">从护眼管理进入：这里展示同一名学生的真实护眼状态。</p>}
          {eyeData && dailyPercent !== null ? (
            <div className="space-y-2.5">
              <BarProgress
                label={`今日有效用眼 ${minutes(dailyUsedSeconds)} / ${minutes(dailySeconds)} 分钟`}
                value={dailyPercent}
                tone={eyeData.enforcement?.status === 'forced_rest' ? 'danger' : eyeData.enforcement?.status === 'reminder' ? 'warning' : 'success'}
                size="sm"
                showValue={false}
              />
              <div className="flex items-center gap-4 text-[12px] text-ink-600">
                <span>连续用眼 <span className="font-semibold text-ink-800 tabular-nums">{minutes(eyeData.continuousEyeSeconds) ?? '—'}</span> 分钟</span>
                <span>每周有效 <span className="font-semibold text-ink-800 tabular-nums">{minutes(eyeData.weeklyValidEyeSeconds) ?? '—'}</span> 分钟</span>
              </div>
              <p className="text-[11.5px] text-ink-500 leading-relaxed">{eye.note}{eyeData.enforcement?.forcedRestUntil ? ` 强制休息至 ${eyeData.enforcement.forcedRestUntil}。` : ''}</p>
            </div>
          ) : (
            <p className="text-[11.5px] text-ink-500 leading-relaxed py-2">{eyeCareResource.status === 'loading' ? '正在读取真实护眼状态。' : eyeCareResource.error?.message || '当前范围没有返回可用护眼数据。'}</p>
          )}
        </GlassCard>

        <GlassCard className="p-3.5">
          <SubHead icon="Gauge" title="对话额度" />
          <p className="text-[12px] text-ink-600 leading-relaxed py-3">当前没有已接入的逐学生额度读取接口，因此不显示样例次数或百分比。</p>
          <p className="text-[11.5px] text-ink-500 leading-relaxed">可在「用量与对话」中查看已接入的会话与隐私访问记录。</p>
        </GlassCard>
      </div>

      <div className="mt-3.5 grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <GlassCard className="p-3.5">
          <SubHead
            icon="Sparkles"
            title="社区"
            extra={<button type="button" onClick={() => navigate('/console/community')} className="text-[11.5px] text-ink-400 hover:text-brand-600 transition">去社区管理</button>}
          />
          <p className="text-[12px] text-ink-600 leading-relaxed py-3">当前没有逐学生社区摘要接口，不显示静态发布数、精选数或待审核数。</p>
        </GlassCard>

        <GlassCard className="p-3.5">
          <SubHead
            icon="FileText"
            title="报告"
            extra={<button type="button" onClick={() => navigate('/console/reports')} className="text-[11.5px] text-ink-400 hover:text-brand-600 transition">去报告中心</button>}
          />
          <p className="text-[12px] text-ink-600 leading-relaxed py-3">当前没有逐学生报告摘要接口，不显示静态累计数、发送数或失败数。</p>
        </GlassCard>
      </div>

      <div className="mt-3.5">
        <GlassCard className="p-3.5">
          <SubHead
            icon="Users"
            title="家长关系"
            extra={<span title="家长绑定写入接口暂未接入"><Btn size="sm" icon="UserPlus" disabled>添加家长</Btn></span>}
          />
          <p className="text-[12px] text-ink-600 leading-relaxed py-3">当前页面没有逐学生家长绑定读取与写入契约，因此不展示前端样例联系人，也不伪造主要接收人切换。</p>
          <p className="text-[11.5px] text-ink-500 flex items-start gap-1.5">
            <Icon name="Info" className="w-3.5 h-3.5 mt-px shrink-0 text-ink-400" />
            阅读报告、护眼提醒与普通通知的实际发送记录，请在「报告中心 → 家长发送」中查看。
          </p>
        </GlassCard>
      </div>
    </PagePanel>
  )
}

function Metric({ label, value, unit, tone = 'ink' }) {
  const number = numberOrNull(value)
  return (
    <div>
      <div className="text-[11.5px] text-ink-400">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className={cx('text-[19px] font-semibold tabular-nums leading-none', tone === 'danger' ? 'text-danger-600' : 'text-ink-900')}>
          {number === null ? '—' : number}
        </span>
        {unit && number !== null && <span className="text-[11px] text-ink-500">{unit}</span>}
      </div>
    </div>
  )
}
