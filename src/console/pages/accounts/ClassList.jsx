import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cx, Icon } from '../../../components/ui.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, EmptyState, IconBtn, SearchBox, Select, StatusTag, TableFooter, ViewToggle } from '../../components/Controls.jsx'
import { ConfirmModal, Modal } from '../../components/Overlay.jsx'
import { BarProgress } from '../../components/Progress.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import { getClasses } from '../../data/fixtures/classes.js'

// 班级与成员管理：工具栏（搜索 / 状态 / 视图切换 / 创建）+ 卡片或列表 + 底部分页。
// 演示壳不落库：创建、编辑、删除、恢复都只弹确认并给出「演示环境不写入」的说明。

const ICON_TONE = {
  brand: 'bg-brand-50 text-brand-600',
  cyan: 'bg-[#E4F5F2] text-[#2E8C86]',
  violet: 'bg-[#F0ECFB] text-[#7C6BD8]',
  accent: 'bg-accent-50 text-accent-600',
  muted: 'bg-ink-100 text-ink-500',
}

// 两档状态（Plan_2 P6）：进行中 / 已删除（可恢复）。不再出现「归档」。
const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'active', label: '进行中' },
  { value: 'deleted', label: '已删除' },
]

export default function ClassList() {
  const { workspace, prefs, setPref } = useConsole()
  const navigate = useNavigate()

  const all = useMemo(() => getClasses(workspace.id), [workspace.id])
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [picked, setPicked] = useState([])
  const [createOpen, setCreateOpen] = useState(false)
  const [confirm, setConfirm] = useState(null)

  const view = prefs.viewMode || 'card'

  const rows = useMemo(() => {
    const k = keyword.trim()
    return all.filter((c) => {
      if (status !== 'all' && c.status !== status) return false
      if (!k) return true
      return c.name.includes(k) || c.headTeacher.includes(k) || c.grade.includes(k)
    })
  }, [all, keyword, status])

  const paged = rows.slice((page - 1) * pageSize, page * pageSize)
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  return (
    <PagePanel
      title={`${workspace.scopeLabel} · 班级与成员`}
      desc={`共 ${all.length} 个班级；删除班级只解除班级关系，学生账号与历史数据都保留，可以随时恢复。`}
      toolbar={
        <>
          <SearchBox value={keyword} onChange={(v) => (setKeyword(v), setPage(1))} placeholder="搜索班级或教师" />
          <Select value={status} onChange={(v) => (setStatus(v), setPage(1))} options={STATUS_OPTIONS} />
          <ViewToggle value={view} onChange={(v) => setPref('viewMode', v)} />
          <Btn tone="primary" icon="Plus" onClick={() => setCreateOpen(true)}>
            创建班级
          </Btn>
        </>
      }
    >
      {picked.length > 0 && (
        <div className="mb-3 flex items-center gap-2.5 h-10 px-3 rounded-lg bg-brand-50/80 border border-brand-100">
          <Icon name="CheckCheck" className="w-4 h-4 text-brand-600" strokeWidth={1.9} />
          <span className="text-[12.5px] text-brand-800">
            已选择 <span className="font-semibold tabular-nums">{picked.length}</span> 个班级
          </span>
          <div className="flex-1" />
          <Btn size="sm" icon="Trash2" onClick={() => setConfirm({ kind: 'deleteMany', many: true })}>
            批量删除
          </Btn>
          <Btn size="sm" tone="ghost" onClick={() => setPicked([])}>
            取消选择
          </Btn>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon="Users"
          title="没有符合条件的班级"
          desc="换一个关键词或把状态改回「全部状态」；如果确实还没有班级，可以先创建一个再导入学生名单。"
          action={
            <Btn tone="primary" icon="Plus" onClick={() => setCreateOpen(true)}>
              创建班级
            </Btn>
          }
        />
      ) : view === 'card' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {paged.map((c) => (
            <ClassCard
              key={c.id}
              data={c}
              checked={picked.includes(c.id)}
              onCheck={() => toggle(c.id)}
              onOpen={() => navigate(`/console/accounts/classes/${c.id}`)}
              onAction={(kind) => setConfirm({ kind, target: c })}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-ink-150 overflow-hidden bg-white/60">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-ink-50/70 text-[11.5px] text-ink-500">
                <th className="w-10 px-3 py-2.5" />
                <th className="px-2 py-2.5 font-medium">班级</th>
                <th className="px-2 py-2.5 font-medium w-[92px]">班主任</th>
                <th className="px-2 py-2.5 font-medium w-[88px]">学生</th>
                <th className="px-2 py-2.5 font-medium w-[150px]">阅读进度</th>
                <th className="px-2 py-2.5 font-medium w-[84px]">状态</th>
                <th className="px-2 py-2.5 font-medium w-[104px] text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((c) => (
                <tr key={c.id} className="border-t border-ink-150/70 hover:bg-white/70 transition">
                  <td className="px-3 py-2.5">
                    <Check checked={picked.includes(c.id)} onChange={() => toggle(c.id)} label={`选择 ${c.name}`} />
                  </td>
                  <td className="px-2 py-2.5">
                    <button
                      type="button"
                      onClick={() => navigate(`/console/accounts/classes/${c.id}`)}
                      className="flex items-center gap-2.5 text-left group"
                    >
                      <span className={cx('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', ICON_TONE[c.tone])}>
                        <Icon name={c.icon} className="w-4 h-4" strokeWidth={1.9} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-ink-900 group-hover:text-brand-700 transition truncate">
                          {c.name}
                        </span>
                        <span className="block text-[11px] text-ink-400 truncate">{c.subject} · 建于 {c.createdAt}</span>
                      </span>
                    </button>
                  </td>
                  <td className="px-2 py-2.5 text-[12.5px] text-ink-700">{c.headTeacher}</td>
                  <td className="px-2 py-2.5 text-[12.5px] text-ink-700 tabular-nums">
                    {c.active}/{c.students}
                  </td>
                  <td className="px-2 py-2.5">
                    <BarProgress value={c.progress.reading} showValue={false} size="sm" />
                  </td>
                  <td className="px-2 py-2.5">
                    <StatusTag tone={c.status === 'active' ? 'success' : 'muted'} dot>
                      {c.status === 'active' ? '进行中' : '已删除'}
                    </StatusTag>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center justify-end gap-0.5">
                      <IconBtn icon="Pencil" title="编辑班级" onClick={() => setConfirm({ kind: 'edit', target: c })} />
                      {c.status === 'active' ? (
                        <IconBtn
                          icon="Trash2"
                          title="删除班级"
                          tone="danger"
                          onClick={() => setConfirm({ kind: 'delete', target: c })}
                        />
                      ) : (
                        <IconBtn icon="RotateCcw" title="恢复班级" onClick={() => setConfirm({ kind: 'restore', target: c })} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-auto pt-2">
          <TableFooter
            total={rows.length}
            page={page}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={(n) => (setPageSize(n), setPage(1))}
            unit="个班级"
          />
        </div>
      )}

      <CreateClassModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <ActionConfirm data={confirm} onClose={() => setConfirm(null)} />
    </PagePanel>
  )
}

function Check({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cx(
        'w-4 h-4 rounded-[5px] border flex items-center justify-center transition',
        checked ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-ink-300 hover:border-brand-400',
      )}
    >
      {checked && <Icon name="Check" className="w-3 h-3" strokeWidth={3} />}
    </button>
  )
}

// 卡片：参考图里的「复选框 + 多进度条 + 底部图标操作行 + 选中蓝边」
function ClassCard({ data, checked, onCheck, onOpen, onAction }) {
  const removed = data.status !== 'active'
  return (
    <GlassCard
      className={cx(
        'p-3.5 transition duration-140',
        checked ? 'ring-2 ring-brand-400 border-brand-200' : 'hover:shadow-e2',
        removed && 'opacity-90',
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="pt-0.5">
          <Check checked={checked} onChange={onCheck} label={`选择 ${data.name}`} />
        </div>
        <span className={cx('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', ICON_TONE[data.tone])}>
          <Icon name={data.icon} className="w-[18px] h-[18px]" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onOpen} className="block text-left group">
            <span className="font-serif text-[15px] font-bold text-ink-900 group-hover:text-brand-700 transition">
              {data.name}
            </span>
          </button>
          <p className="text-[11.5px] text-ink-400 mt-0.5">
            {data.subject} · 班主任 {data.headTeacher}
          </p>
        </div>
        <StatusTag tone={removed ? 'muted' : 'success'} dot>
          {removed ? '已删除' : '进行中'}
        </StatusTag>
      </div>

      <div className="mt-3 flex items-center gap-4">
        <Stat label="学生" value={`${data.active}/${data.students}`} />
        <Stat label="教师" value={data.teachers.length} />
        <Stat label="建班" value={data.createdAt.slice(0, 7)} />
      </div>

      <div className="mt-3 space-y-2">
        <LabeledBar label="阅读进度" value={data.progress.reading} tone="brand" />
        <LabeledBar label="额度使用" value={data.progress.quota} tone="warning" />
        <LabeledBar label="报告完成" value={data.progress.report} tone="success" />
      </div>

      <p className="mt-3 text-[11.5px] text-ink-500 leading-relaxed line-clamp-2">
        {removed ? data.deletedAt && `${data.deletedAt} 删除 · ${data.note}` : data.note}
      </p>

      <div className="mt-3 pt-2.5 border-t border-ink-150/70 flex items-center gap-0.5">
        <IconBtn icon="Users" title="查看学生" onClick={onOpen} />
        <IconBtn icon="Pencil" title="编辑班级" onClick={() => onAction('edit')} />
        <IconBtn icon="Send" title="发送班级报告" onClick={() => onAction('report')} />
        <div className="flex-1" />
        {removed ? (
          <Btn size="sm" icon="RotateCcw" onClick={() => onAction('restore')}>
            恢复
          </Btn>
        ) : (
          <IconBtn icon="Trash2" title="删除班级" tone="danger" onClick={() => onAction('delete')} />
        )}
      </div>
    </GlassCard>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-[11px] text-ink-400">{label}</div>
      <div className="text-[13px] font-semibold text-ink-800 tabular-nums mt-0.5">{value}</div>
    </div>
  )
}

function LabeledBar({ label, value, tone }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-ink-500">{label}</span>
        <span className="text-ink-700 font-medium tabular-nums">{value}%</span>
      </div>
      <BarProgress value={value} tone={tone} showValue={false} size="sm" />
    </div>
  )
}

function CreateClassModal({ open, onClose }) {
  const [form, setForm] = useState({ grade: '三年级', name: '', subject: '语文', teacher: '林老师', note: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon="Plus"
      title="创建班级"
      desc="演示环境不会真正写入数据；真实环境创建后需要再导入学生名单。"
      width="max-w-[520px]"
      footer={
        <>
          <Btn onClick={onClose}>取消</Btn>
          <Btn tone="primary" onClick={onClose}>
            创建
          </Btn>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormRow label="年级">
            <select value={form.grade} onChange={set('grade')} className="console-input">
              {['三年级', '四年级', '五年级', '六年级'].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </FormRow>
          <FormRow label="班号">
            <input value={form.name} onChange={set('name')} placeholder="如 4" className="console-input" />
          </FormRow>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormRow label="学科">
            <input value={form.subject} onChange={set('subject')} className="console-input" />
          </FormRow>
          <FormRow label="班主任">
            <input value={form.teacher} onChange={set('teacher')} className="console-input" />
          </FormRow>
        </div>
        <FormRow label="班级说明">
          <textarea
            value={form.note}
            onChange={set('note')}
            rows={3}
            placeholder="这个班的共读节奏、注意事项等"
            className="console-input resize-none"
          />
        </FormRow>
        <p className="text-[11.5px] text-ink-500 flex items-start gap-1.5">
          <Icon name="Info" className="w-3.5 h-3.5 mt-px shrink-0 text-ink-400" />
          学生账号不能脱离班级单独存在，创建班级后再从「组织账号管理」导入名单。
        </p>
      </div>
    </Modal>
  )
}

function FormRow({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[12px] text-ink-600 mb-1.5">{label}</span>
      {children}
    </label>
  )
}

const ACTION_TEXT = {
  delete: {
    title: '删除班级',
    desc: '删除的是班级关系：这个班不再出现在进行中列表，也不能再建新的阅读安排；学生账号不会停用，可以转到其他班级，已有阅读记录、笔记与报告全部保留。在列表里筛选「已删除」可以随时恢复。演示环境不会真正删除。',
    confirmText: '删除',
    tone: 'danger',
  },
  restore: {
    title: '恢复班级',
    desc: '恢复后班级关系重新生效，回到进行中；学生账号、历史阅读记录与报告本来就没动过。演示环境不会真正恢复。',
    confirmText: '恢复',
    tone: 'primary',
  },
  deleteMany: {
    title: '批量删除班级',
    desc: '选中的班级关系一起解除：不再能建新的阅读安排，但学生账号不停用，已有报告与笔记保留，之后可以逐个恢复。演示环境不会真正删除。',
    confirmText: '删除',
    tone: 'danger',
  },
  edit: {
    title: '编辑班级',
    desc: '演示环境不提供真实编辑；真实环境会打开与创建相同的表单，并记录一条变更审计。',
    confirmText: '知道了',
    tone: 'primary',
  },
  report: {
    title: '发送班级报告',
    desc: '会跳到「报告中心 → 家长发送」，按班级选择接收人范围与发送通道。演示环境不会真正发送。',
    confirmText: '知道了',
    tone: 'primary',
  },
}

function ActionConfirm({ data, onClose }) {
  const cfg = data ? ACTION_TEXT[data.kind] : null
  return (
    <ConfirmModal
      open={!!data}
      onClose={onClose}
      onConfirm={onClose}
      title={cfg?.title || ''}
      desc={
        data?.target ? `${data.target.name}：${cfg?.desc || ''}` : data?.many ? cfg?.desc : cfg?.desc || ''
      }
      confirmText={cfg?.confirmText}
      tone={cfg?.tone}
    />
  )
}
