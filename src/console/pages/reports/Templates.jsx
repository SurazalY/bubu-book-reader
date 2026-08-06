import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cx, Icon } from '../../../components/ui.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, Chip, Field, StatusTag, SubHead } from '../../components/Controls.jsx'
import { Modal } from '../../components/Overlay.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import { FLOW_RULES, TEMPLATES, TEMPLATE_RULES } from '../../data/fixtures/reports.js'

// 模板与规则（仅校级管理与平台运营）：只读展示四类模板 + 当前审批流程 + 定时规则
// + 家长触达渠道 + AI 免责声明。本轮不做模板编辑器，未定细节明确标注「待后续设计」。
//
// 这一页是报告详情里那个「流程演示」切换器的正主：真正改学校规则的地方在这里。

const TONE = {
  brand: 'bg-brand-50 text-brand-600',
  cyan: 'bg-[#E4F5F2] text-[#2E8C86]',
  violet: 'bg-[#F0ECFB] text-[#7C6BD8]',
  accent: 'bg-accent-50 text-accent-600',
}

export default function Templates() {
  const { workspace } = useConsole()
  const navigate = useNavigate()
  const isOps = workspace?.scopeType === 'platform'
  const [rule, setRule] = useState(TEMPLATE_RULES.flow)
  const [ask, setAsk] = useState(false)

  return (
    <PagePanel
      title={`${workspace?.scopeLabel || '当前工作空间'} · 模板与规则`}
      desc={
        isOps
          ? '运营可跨学校查看与维护模板、审批流程与触达渠道；改动会影响该校全部报告，请与学校确认后再改。'
          : '这里的设置对全校报告生效。本轮只展示配置状态，不提供模板正文编辑器。'
      }
      toolbar={
        <>
          <Btn icon="ArrowLeft" onClick={() => navigate('/console/reports')}>
            返回报告中心
          </Btn>
          <Btn icon="Send" onClick={() => navigate('/console/reports/parents')}>
            家长发送
          </Btn>
        </>
      }
    >
      {/* 四类模板 */}
      <SubHead icon="LayoutTemplate" title="报告模板（4 类，本轮固定）" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {TEMPLATES.map((t) => (
          <GlassCard key={t.key} className="console-enter p-4 rounded-xl">
            <div className="flex items-start gap-2.5">
              <span className={cx('w-8 h-8 rounded-xl flex items-center justify-center shrink-0', TONE[t.tone])}>
                <Icon name={t.icon} className="w-4 h-4" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[13.5px] font-semibold text-ink-900">{t.title}</h3>
                <p className="text-[11.5px] text-ink-500 mt-0.5">{t.scope}</p>
              </div>
              <StatusTag tone="success" dot>
                已启用
              </StatusTag>
            </div>

            <div className="mt-3 pt-2.5 border-t border-ink-150/70">
              <p className="text-[11.5px] text-ink-400 mb-1.5">正文区块（含内容来源）</p>
              <ol className="space-y-1.5">
                {t.blocks.map((b, i) => (
                  <li key={b} className="flex items-start gap-2 text-[12px] text-ink-700">
                    <span className="w-[17px] h-[17px] rounded-md bg-ink-100 text-ink-500 text-[10.5px] flex items-center justify-center shrink-0 tabular-nums mt-px">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{b}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="mt-2.5 pt-2.5 border-t border-ink-150/70">
              <Field label="可见对象" labelWidth="w-[82px]">
                {t.receivers}
              </Field>
              <Field label="待后续设计" labelWidth="w-[82px]">
                <span className="text-ink-500">{t.pending}</span>
              </Field>
            </div>
          </GlassCard>
        ))}
      </div>

      {/* 审批流程 + 定时规则 */}
      <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-3.5">
        <GlassCard className="p-4 rounded-xl">
          <SubHead
            icon="GitBranch"
            title="审批流程"
            extra={<span className="text-[11.5px] text-ink-400">对全校报告生效</span>}
          />
          <p className="text-[11.5px] text-ink-500 leading-relaxed">{TEMPLATE_RULES.flowNote}</p>
          {/* Plan_2 P8：上一行是本校配置，这一行才是产品出厂口径，不得混在一句里 */}
          <p className="mt-1.5 text-[11.5px] text-ink-500 leading-relaxed flex items-start gap-1.5">
            <Icon name="Package" className="w-3.5 h-3.5 mt-0.5 shrink-0 text-ink-400" strokeWidth={1.9} />
            {TEMPLATE_RULES.flowDefaultNote}
          </p>
          <div className="mt-2.5 flex items-center gap-1.5">
            {Object.values(FLOW_RULES).map((f) => (
              <Chip key={f.key} active={rule === f.key} onClick={() => setRule(f.key)}>
                {f.label}
              </Chip>
            ))}
          </div>
          <div className="mt-3 rounded-lg border border-ink-150 overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-ink-50/70 text-[11px] text-ink-500">
                  <th className="px-2.5 py-2 font-medium w-[80px]">身份</th>
                  <th className="px-2.5 py-2 font-medium">可执行动作</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-ink-150/70">
                  <td className="px-2.5 py-2 text-[12px] text-ink-700">教师侧</td>
                  <td className="px-2.5 py-2 text-[12px] text-ink-600">{FLOW_RULES[rule].teacher.join(' · ')}</td>
                </tr>
                <tr className="border-t border-ink-150/70">
                  <td className="px-2.5 py-2 text-[12px] text-ink-700">管理员侧</td>
                  <td className="px-2.5 py-2 text-[12px] text-ink-600">{FLOW_RULES[rule].admin.join(' · ')}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Btn tone="primary" icon="Save" onClick={() => setAsk(true)}>
              保存为学校规则
            </Btn>
            <span className="text-[11.5px] text-ink-400">
              {rule === TEMPLATE_RULES.flow ? '与当前学校规则一致' : '与当前学校规则不同，保存后立即生效'}
            </span>
          </div>
        </GlassCard>

        <GlassCard className="p-4 rounded-xl">
          <SubHead icon="CalendarClock" title="定时发送规则" />
          <p className="text-[11.5px] text-ink-500 leading-relaxed mb-2">{TEMPLATE_RULES.scheduleNote}</p>
          <div className="rounded-lg border border-ink-150 overflow-hidden">
            <table className="w-full text-left">
              <tbody>
                {TEMPLATE_RULES.schedule.map(([k, v], i) => (
                  <tr key={k} className={cx(i > 0 && 'border-t border-ink-150/70')}>
                    <td className="px-3 py-2 text-[12.5px] text-ink-600 w-[124px]">{k}</td>
                    <td className="px-3 py-2 text-[12.5px] text-ink-900 font-medium">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SubHead icon="Radio" title="家长触达渠道" className="mt-3.5" />
          <p className="text-[11.5px] text-ink-500 leading-relaxed mb-2">{TEMPLATE_RULES.channelNote}</p>
          <ul className="space-y-1.5">
            {TEMPLATE_RULES.channels.map((c) => (
              <li key={c} className="flex items-start gap-1.5 text-[12px] text-ink-700 leading-relaxed">
                <Icon name="Check" className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#3E9E8F]" strokeWidth={2.4} />
                {c}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] text-ink-500 leading-relaxed">
            纯短信只能拿到运营商送达结果，不记录打开与阅读；渠道能力差别在家长发送页会如实显示。
          </p>
        </GlassCard>
      </div>

      {/* AI 免责 + 待后续设计 */}
      <div className="mt-3.5 grid grid-cols-1 xl:grid-cols-[1.1fr_1fr] gap-3.5">
        <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-accent-50/70 border border-accent-100">
          <Icon name="Sparkles" className="w-4 h-4 text-accent-600 mt-px shrink-0" strokeWidth={1.9} />
          <div>
            <p className="text-[12.5px] font-semibold text-accent-700">AI 生成内容声明</p>
            <p className="text-[12px] text-ink-700 leading-relaxed mt-1">{TEMPLATE_RULES.disclaimer}</p>
          </div>
        </div>

        <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-ink-50 border border-ink-150">
          <Icon name="PenTool" className="w-4 h-4 text-ink-400 mt-px shrink-0" strokeWidth={1.9} />
          <div>
            <p className="text-[12.5px] font-semibold text-ink-700">待后续设计</p>
            <ul className="mt-1 space-y-1">
              {TEMPLATE_RULES.pending.map((p) => (
                <li key={p} className="text-[12px] text-ink-600 leading-relaxed">
                  · {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <Modal
        open={ask}
        onClose={() => setAsk(false)}
        icon="TriangleAlert"
        title="修改学校审批流程？"
        desc="这一步会影响全校所有报告"
        width="max-w-[460px]"
        footer={
          <>
            <Btn onClick={() => setAsk(false)}>取消</Btn>
            <Btn tone="primary" onClick={() => setAsk(false)}>
              我明白，保存
            </Btn>
          </>
        }
      >
        <p className="text-[13px] text-ink-700 leading-relaxed">
          切换为「{FLOW_RULES[rule].label}」后：{FLOW_RULES[rule].desc}
        </p>
        <p className="text-[12.5px] text-ink-500 leading-relaxed mt-2.5">
          已在流程中的报告保持原流程走完，新生成的报告按新规则执行。演示环境不会真正保存。
        </p>
      </Modal>
    </PagePanel>
  )
}
