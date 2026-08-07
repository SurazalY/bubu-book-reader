import { useNavigate } from 'react-router-dom'

import { cx, Icon } from '../../../components/ui.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { Btn, EmptyState, SubHead } from '../../components/Controls.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import useUsageSummary from '../../state/useUsageSummary.js'

const METRICS = [
  { key: 'classCount', label: '涉及班级', unit: '个', icon: 'Users', tone: 'brand' },
  { key: 'effectiveReadingCount', label: '有效阅读事件', unit: '次', icon: 'BookOpen', tone: 'cyan' },
  { key: 'activeReaders', label: '活跃阅读学生', unit: '人', icon: 'UserRoundCheck', tone: 'violet' },
  { key: 'pendingSafetyCount', label: '待处理安全事件', unit: '项', icon: 'ShieldAlert', tone: 'accent' },
]

const TONES = {
  brand: 'bg-brand-50 text-brand-600',
  cyan: 'bg-[#E4F5F2] text-[#2E8C86]',
  violet: 'bg-[#F0ECFB] text-[#7C6BD8]',
  accent: 'bg-accent-50 text-accent-600',
}

export default function UsageOverview() {
  const { workspace } = useConsole()
  const navigate = useNavigate()
  const resource = useUsageSummary(workspace?.id)
  const metrics = resource.data?.metrics || null

  return (
    <PagePanel
      title={`${workspace?.scopeLabel || '当前范围'} · 用量概览`}
      desc="这里展示服务端按当前工作空间汇总的班级、有效阅读、活跃学生和安全事件；接口尚未返回的模型成本与额度不会用估算值补齐。"
    >
      {resource.status === 'error' ? (
        <EmptyState icon="TriangleAlert" title="用量概览加载失败" desc={resource.error?.message || '服务端拒绝了这次请求。'} />
      ) : !metrics ? (
        <EmptyState icon="Gauge" title="正在读取真实用量" desc="正在向正式用量汇总接口请求当前工作空间数据。" />
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3.5">
            {METRICS.map((item) => (
              <GlassCard key={item.key} className="p-3.5 rounded-xl min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cx('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', TONES[item.tone])}>
                    <Icon name={item.icon} className="w-4 h-4" strokeWidth={1.9} />
                  </span>
                  <span className="text-[12.5px] font-medium text-ink-700 truncate">{item.label}</span>
                </div>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="font-serif text-[30px] leading-none font-bold text-ink-900 tabular-nums">{Number(metrics[item.key] || 0)}</span>
                  <span className="text-[12px] text-ink-500">{item.unit}</span>
                </div>
              </GlassCard>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-3.5">
            <GlassCard className="p-4 rounded-xl">
              <SubHead icon="MessagesSquare" title="对话与隐私" />
              <p className="text-[12px] text-ink-600 leading-relaxed">学生会话与隐私访问继续使用各自的正式权限接口；无权账号会看到局部权限说明，不会跳到通用未接入页。</p>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <Btn icon="MessagesSquare" onClick={() => navigate('/console/usage/sessions')}>学生会话</Btn>
                <Btn icon="ShieldCheck" onClick={() => navigate('/console/usage/privacy')}>隐私访问</Btn>
              </div>
            </GlassCard>
            <GlassCard className="p-4 rounded-xl">
              <SubHead icon="ChartNoAxesColumn" title="阅读与护眼" />
              <p className="text-[12px] text-ink-600 leading-relaxed">阅读统计和护眼状态来自真实阅读事件与护眼接口，可继续下钻到学生详情。</p>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <Btn icon="ChartNoAxesColumn" onClick={() => navigate('/console/classes/overview')}>阅读统计</Btn>
                <Btn icon="Eye" onClick={() => navigate('/console/classes/eyecare')}>护眼管理</Btn>
              </div>
            </GlassCard>
          </div>

          <div className="mt-3.5 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-ink-50 border border-ink-150">
            <Icon name="Info" className="w-4 h-4 text-ink-400 mt-px shrink-0" strokeWidth={1.9} />
            <p className="text-[12px] text-ink-600 leading-relaxed">当前后端没有学校额度调整、模型成本分摊或计费配置接口，因此这些入口不显示，也不会在浏览器本地伪造保存。</p>
          </div>
        </>
      )}
    </PagePanel>
  )
}
