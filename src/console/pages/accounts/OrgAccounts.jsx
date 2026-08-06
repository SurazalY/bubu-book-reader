import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cx, Icon } from '../../../components/ui.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, SearchBox, StatusTag, SubHead } from '../../components/Controls.jsx'
import { ConfirmModal } from '../../components/Overlay.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import { getClasses, getOrgGroups } from '../../data/fixtures/classes.js'

// 组织账号管理：按「学生 / 教师 / 管理员 / 班级关系」四类分组，
// 每组给出数量、约束说明与可执行动作；班级关系单独一块，强调删除前要先迁移。

const TONE = {
  brand: 'bg-brand-50 text-brand-600',
  cyan: 'bg-[#E4F5F2] text-[#2E8C86]',
  violet: 'bg-[#F0ECFB] text-[#7C6BD8]',
  accent: 'bg-accent-50 text-accent-600',
}

export default function OrgAccounts() {
  const { workspace, canAccessPath } = useConsole()
  const navigate = useNavigate()
  const groups = useMemo(() => getOrgGroups(workspace.id), [workspace.id])
  const classes = useMemo(() => getClasses(workspace.id), [workspace.id])
  const [keyword, setKeyword] = useState('')
  const [ask, setAsk] = useState(null)

  const rows = classes.filter((c) => !keyword.trim() || c.name.includes(keyword) || c.headTeacher.includes(keyword))
  // 班级详情由「范围内可查看／管理班级」能力或班级列表叶子授权，
  // 校长／书记没有班级列表入口也能从这里下钻
  const classDetailAllowed = rows.length > 0 && canAccessPath(`/console/accounts/classes/${rows[0].id}`)

  return (
    <PagePanel
      title={`${workspace.scopeLabel} · 账号总览`}
      desc="账号分四类管理：学生由班级关系派生，教师按任教班级叠加权限，管理员变更留审计，班级关系是三者的连接点。"
      toolbar={
        <>
          <Btn icon="Upload" onClick={() => setAsk('import')}>
            批量导入
          </Btn>
          <Btn tone="primary" icon="UserPlus" onClick={() => setAsk('create')}>
            新增账号
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5">
        {groups.map((g) => (
          <GlassCard key={g.key} className="p-3.5 flex flex-col">
            <div className="flex items-center gap-2.5">
              <span className={cx('w-8 h-8 rounded-xl flex items-center justify-center shrink-0', TONE[g.tone])}>
                <Icon name={g.icon} className="w-4 h-4" strokeWidth={1.9} />
              </span>
              <span className="text-[13px] font-semibold text-ink-800">{g.label}</span>
            </div>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="font-serif text-[30px] leading-none font-bold text-ink-900 tabular-nums">{g.count}</span>
              <span className="text-[11.5px] text-ink-500">个</span>
            </div>
            <p className="text-[11.5px] text-ink-500 leading-relaxed mt-2 flex-1">{g.note}</p>
            <div className="mt-3 pt-2.5 border-t border-ink-150/70 flex flex-wrap gap-1.5">
              {g.actions.map((a) => (
                <Btn key={a} size="sm" tone="ghost" onClick={() => setAsk(a)}>
                  {a}
                </Btn>
              ))}
            </div>
          </GlassCard>
        ))}
      </div>

      <div className="mt-4">
        <div className="flex items-center gap-3 mb-2.5">
          <SubHead icon="Network" title={`班级关系（${classes.length}）`} className="mb-0" />
          <div className="flex-1" />
          <SearchBox value={keyword} onChange={setKeyword} placeholder="搜索班级或班主任" width="w-[190px]" />
        </div>

        <div className="rounded-xl border border-ink-150 overflow-hidden bg-white/60">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-ink-50/70 text-[11.5px] text-ink-500">
                <th className="px-3 py-2.5 font-medium">班级</th>
                <th className="px-2 py-2.5 font-medium w-[150px]">任教教师</th>
                <th className="px-2 py-2.5 font-medium w-[92px]">学生</th>
                <th className="px-2 py-2.5 font-medium w-[104px]">建班时间</th>
                <th className="px-2 py-2.5 font-medium w-[88px]">状态</th>
                <th className="px-2 py-2.5 font-medium w-[168px] text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-ink-150/70 hover:bg-white/70 transition">
                  <td className="px-3 py-2.5 text-[13px] font-medium text-ink-900">{c.name}</td>
                  <td className="px-2 py-2.5 text-[12.5px] text-ink-700">{c.teachers.join('、')}</td>
                  <td className="px-2 py-2.5 text-[12.5px] text-ink-700 tabular-nums">{c.students} 人</td>
                  <td className="px-2 py-2.5 text-[12px] text-ink-500 tabular-nums">{c.createdAt}</td>
                  <td className="px-2 py-2.5">
                    <StatusTag tone={c.status === 'active' ? 'success' : 'muted'} dot>
                      {c.status === 'active' ? '进行中' : '已删除'}
                    </StatusTag>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <Btn size="sm" tone="ghost" onClick={() => setAsk('调整关系')}>
                        调整关系
                      </Btn>
                      {/* 先问权限再渲染：不允许出现点了被弹回首页的死入口（Plan_2 P1） */}
                      {classDetailAllowed && (
                        <Btn size="sm" tone="ghost" onClick={() => navigate(`/console/accounts/classes/${c.id}`)}>
                          查看班级
                        </Btn>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[11.5px] text-ink-500 mt-2.5 flex items-start gap-1.5">
          <Icon name="Info" className="w-3.5 h-3.5 mt-px shrink-0 text-ink-400" />
          删除班级只解除班级关系，不会停用学生账号；建议先把学生转入新班级，否则他们会暂时没有归属班级。已删除的班级历史数据保留，恢复后关系自动生效。
        </p>
      </div>

      <ConfirmModal
        open={!!ask}
        onClose={() => setAsk(null)}
        onConfirm={() => setAsk(null)}
        title={typeof ask === 'string' ? ask : '账号操作'}
        desc="演示环境不写入任何账号数据。真实环境这一步会校验学号／手机号重复、给出导入预检报告，并记录一条变更审计。"
        confirmText="知道了"
        tone="primary"
      />
    </PagePanel>
  )
}
