import { useState } from 'react'
import { cx, Icon } from '../../../components/ui.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, StatusTag, SubHead } from '../../components/Controls.jsx'
import { Modal } from '../../components/Overlay.jsx'
import { ROLE_TEMPLATES } from '../../data/fixtures/classes.js'

// 权限配置（仅平台运营可见）：左侧模板列表，右侧这个模板的数据范围与可执行动作。
// 「样例表单」按交付说明只做展示与说明，不提供真实保存。

export default function RoleConfig() {
  const [active, setActive] = useState(ROLE_TEMPLATES[0].key)
  const [editOpen, setEditOpen] = useState(false)
  const tpl = ROLE_TEMPLATES.find((t) => t.key === active) || ROLE_TEMPLATES[0]

  return (
    <PagePanel
      title="全平台 · 权限配置"
      desc="权限由「数据范围 + 可执行动作」两部分组成；模板改动会影响所有使用该模板的账号，保存前会先给出影响面预览。"
      toolbar={
        <Btn tone="primary" icon="Plus" onClick={() => setEditOpen(true)}>
          新建模板
        </Btn>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[236px_1fr] gap-4">
        {/* 模板列表 */}
        <div className="space-y-2">
          {ROLE_TEMPLATES.map((t) => {
            const on = t.key === active
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActive(t.key)}
                className={cx(
                  'w-full text-left px-3 py-2.5 rounded-xl border transition duration-140',
                  on
                    ? 'border-brand-200 bg-brand-50/80 shadow-e1'
                    : 'border-ink-150 bg-white/60 hover:border-ink-200 hover:bg-white/80',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cx('text-[13px] font-semibold', on ? 'text-brand-800' : 'text-ink-800')}>
                    {t.name}
                  </span>
                  {!t.editable && <StatusTag tone="muted">内置</StatusTag>}
                </div>
                <p className="text-[11.5px] text-ink-500 mt-1">{t.scope}</p>
                <p className="text-[11px] text-ink-400 mt-1 tabular-nums">{t.accounts} 个账号在用</p>
              </button>
            )
          })}
        </div>

        {/* 模板详情 */}
        <div className="space-y-3.5">
          <GlassCard className="p-4">
            <div className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                <Icon name="ShieldCheck" className="w-[18px] h-[18px]" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-serif text-[17px] font-bold text-ink-900">{tpl.name}</h2>
                <p className="text-[12.5px] text-ink-500 mt-1">
                  数据范围：{tpl.scope} · 当前 {tpl.accounts} 个账号使用
                </p>
              </div>
              {tpl.editable ? (
                <Btn icon="Pencil" onClick={() => setEditOpen(true)}>
                  编辑模板
                </Btn>
              ) : (
                <StatusTag tone="muted">内置模板不可改</StatusTag>
              )}
            </div>
          </GlassCard>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <GlassCard className="p-3.5">
              <SubHead icon="Check" title="可执行动作" />
              <ul className="space-y-1.5">
                {tpl.can.map((c) => (
                  <li key={c} className="flex items-start gap-2 text-[12.5px] text-ink-700">
                    <Icon name="Check" className="w-3.5 h-3.5 mt-0.5 text-success-600 shrink-0" strokeWidth={2.4} />
                    {c}
                  </li>
                ))}
              </ul>
            </GlassCard>

            <GlassCard className="p-3.5">
              <SubHead icon="Ban" title="明确不允许" />
              <ul className="space-y-1.5">
                {tpl.cannot.map((c) => (
                  <li key={c} className="flex items-start gap-2 text-[12.5px] text-ink-600">
                    <Icon name="X" className="w-3.5 h-3.5 mt-0.5 text-danger-500 shrink-0" strokeWidth={2.4} />
                    {c}
                  </li>
                ))}
              </ul>
            </GlassCard>
          </div>

          <GlassCard className="p-3.5">
            <SubHead icon="Info" title="生效规则" />
            <ul className="space-y-1.5 text-[12.5px] text-ink-600">
              <li>· 同一账号可以持有多个模板，数据范围取并集，动作取并集。</li>
              <li>· 学生原始会话内容不因模板放开，必须逐次走隐私访问申请并留访问记录。</li>
              <li>· 模板改动即时生效，但已发起的审批流程按发起时的规则继续走完。</li>
            </ul>
          </GlassCard>
        </div>
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        icon="ShieldCheck"
        title="编辑权限模板"
        desc="演示环境不保存。真实环境保存前会显示受影响账号数与差异对比。"
        width="max-w-[560px]"
        footer={
          <>
            <Btn onClick={() => setEditOpen(false)}>取消</Btn>
            <Btn tone="primary" onClick={() => setEditOpen(false)}>
              保存
            </Btn>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="block text-[12px] text-ink-600 mb-1.5">模板名称</span>
            <input defaultValue={tpl.name} className="console-input" />
          </label>
          <label className="block">
            <span className="block text-[12px] text-ink-600 mb-1.5">数据范围</span>
            <select defaultValue={tpl.scope} className="console-input">
              {['本人任教班级', '本年级全部班级', '本校全部数据', '全平台（12 所学校）'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <div>
            <span className="block text-[12px] text-ink-600 mb-1.5">可执行动作</span>
            <div className="space-y-1.5">
              {tpl.can.map((c) => (
                <label key={c} className="flex items-center gap-2 text-[12.5px] text-ink-700">
                  <input type="checkbox" defaultChecked className="accent-brand-600" />
                  {c}
                </label>
              ))}
            </div>
          </div>
          <p className="text-[11.5px] text-ink-500 flex items-start gap-1.5">
            <Icon name="TriangleAlert" className="w-3.5 h-3.5 mt-px shrink-0 text-warning-500" />
            涉及学生原始内容的动作不能在模板里直接开放，只能通过隐私访问申请逐次授权。
          </p>
        </div>
      </Modal>
    </PagePanel>
  )
}
