import { useNavigate } from 'react-router-dom'

import { cx, Icon } from '../../../components/ui.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { Btn, StatusTag, SubHead } from '../../components/Controls.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import { CHANNELS, FLOW_RULES, REPORT_TYPES, SEND_DEFAULT_NOTE, SEND_RULES } from '../../state/useReportsData.js'

const TONES = {
  brand: 'bg-brand-50 text-brand-600',
  cyan: 'bg-[#E4F5F2] text-[#2E8C86]',
  violet: 'bg-[#F0ECFB] text-[#7C6BD8]',
  accent: 'bg-accent-50 text-accent-600',
}

export default function Templates() {
  const { workspace } = useConsole()
  const navigate = useNavigate()

  return (
    <PagePanel
      title={`${workspace?.scopeLabel || '当前范围'} · 模板与规则`}
      desc="本页只读展示当前代码实际执行的报告类型、人工审核流程和发送边界；后端尚无学校级模板编辑接口，因此不会出现假保存按钮。"
      toolbar={
        <>
          <Btn icon="ArrowLeft" onClick={() => navigate('/console/reports')}>返回报告中心</Btn>
          <Btn icon="Send" onClick={() => navigate('/console/reports/parents')}>家长发送</Btn>
        </>
      }
    >
      <SubHead icon="LayoutTemplate" title="当前报告类型" extra={<StatusTag tone="muted">只读</StatusTag>} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {Object.entries(REPORT_TYPES).map(([key, item]) => (
          <GlassCard key={key} className="p-4 rounded-xl">
            <div className="flex items-center gap-2.5">
              <span className={cx('w-8 h-8 rounded-xl flex items-center justify-center shrink-0', TONES[item.tone] || TONES.brand)}>
                <Icon name={item.icon} className="w-4 h-4" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[13.5px] font-semibold text-ink-900">{item.label}</h2>
                <p className="text-[11.5px] text-ink-500 mt-0.5">由真实报告接口返回后进入人工确认流程</p>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-3.5">
        <GlassCard className="p-4 rounded-xl">
          <SubHead icon="GitBranch" title="人工审核流程" />
          <div className="space-y-3">
            {Object.values(FLOW_RULES).map((flow) => (
              <div key={flow.key} className="rounded-xl border border-ink-150 bg-white/55 p-3">
                <div className="text-[12.5px] font-semibold text-ink-800">{flow.label}</div>
                <p className="text-[11.5px] text-ink-500 mt-1">教师：{flow.teacher.join(' · ')}</p>
                <p className="text-[11.5px] text-ink-500 mt-1">管理员：{flow.admin.join(' · ')}</p>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-4 rounded-xl">
          <SubHead icon="Radio" title="发送规则与渠道" />
          <p className="text-[12px] text-ink-600 leading-relaxed">{SEND_DEFAULT_NOTE}</p>
          <ul className="mt-3 space-y-2">
            {SEND_RULES.map((rule) => (
              <li key={rule.key} className="flex items-start gap-2">
                <Icon name={rule.icon} className="w-4 h-4 text-[#3E9E8F] mt-0.5 shrink-0" strokeWidth={1.9} />
                <div>
                  <p className="text-[12.5px] font-medium text-ink-800">{rule.title} · {rule.state}</p>
                  <p className="text-[11.5px] text-ink-500 mt-0.5">{rule.lines.join('；')}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 pt-3 border-t border-ink-150 flex flex-wrap gap-1.5">
            {Object.values(CHANNELS).map((channel) => <StatusTag key={channel.label} tone={channel.canTrack ? 'brand' : 'muted'}>{channel.label}</StatusTag>)}
          </div>
        </GlassCard>
      </div>

      <div className="mt-3.5 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-accent-50/70 border border-accent-100">
        <Icon name="Sparkles" className="w-4 h-4 text-accent-600 mt-px shrink-0" strokeWidth={1.9} />
        <p className="text-[12px] text-ink-700 leading-relaxed">AI 只生成草稿，不能绕过教师或管理员的人工审核；家长发送任务与报告审核是两个独立动作。</p>
      </div>
    </PagePanel>
  )
}
