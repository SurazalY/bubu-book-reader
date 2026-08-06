import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RuntimeIcon as Icon } from '../../../shared/RuntimeIcon.jsx'
import { cx } from '../../../shared/cx.js'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, Chip, EmptyState, IconBtn, SearchBox, StatusTag, TableFooter } from '../../components/Controls.jsx'
import { Modal } from '../../components/Overlay.jsx'
import { BarProgress } from '../../components/Progress.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import useAssignmentsData from '../../state/useAssignmentsData.js'
import { ASSIGNMENT_STATUS, ASSIGNMENT_TYPES } from '../../../adapters/consoleAssignments.js'

// 阅读安排列表：类型胶囊筛选 + 列表 + 创建弹窗。
// 创建流程按交付说明分两步：先选书，再填班级、说明与起止时间——顺序不能反。

export default function ArrangeList() {
  const { workspace } = useConsole()
  const navigate = useNavigate()
  const resource = useAssignmentsData(workspace?.id)
  const all = resource.data?.arrangements || []
  const [type, setType] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [createOpen, setCreateOpen] = useState(false)

  const rows = useMemo(() => {
    const k = keyword.trim()
    return all.filter((a) => {
      if (type !== 'all' && a.type !== type) return false
      if (!k) return true
      return a.title.includes(k) || a.classNames.join('').includes(k) || a.owner.includes(k)
    })
  }, [all, type, keyword])

  const paged = rows.slice((page - 1) * pageSize, page * pageSize)

  return (
    <PagePanel
      title={`${workspace?.name || '当前工作空间'} · 阅读安排`}
      desc="安排决定学生端能读什么、什么时候读；暂停不清零进度，结束后才会生成班级阅读报告。"
      toolbar={
        <>
          <SearchBox value={keyword} onChange={(v) => (setKeyword(v), setPage(1))} placeholder="搜索书名或班级" />
          <Btn tone="primary" icon="CalendarPlus" disabled={resource.status !== 'ready'} onClick={() => setCreateOpen(true)}>
            创建安排
          </Btn>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <Chip active={type === 'all'} count={all.length} onClick={() => (setType('all'), setPage(1))}>
          全部类型
        </Chip>
        {ASSIGNMENT_TYPES.map((t) => (
          <Chip
            key={t.key}
            active={type === t.key}
            count={all.filter((a) => a.type === t.key).length}
            onClick={() => (setType(t.key), setPage(1))}
          >
            {t.label}
          </Chip>
        ))}
        <div className="flex-1" />
        <span className="text-[11.5px] text-ink-500">
          {ASSIGNMENT_TYPES.find((t) => t.key === type)?.desc || '三种类型的区别在于是否统一进度、是否由教师带读'}
        </span>
      </div>

      {resource.status === 'loading' ? (
        <EmptyState icon="Clock" title="正在读取阅读安排" desc="正在从当前工作空间加载真实安排、书籍版本与班级范围。" />
      ) : resource.status === 'error' ? (
        <EmptyState
          icon="CloudOff"
          title="阅读安排暂不可用"
          desc={`${resource.error?.code || 'DEPENDENCY_UNAVAILABLE'}：${resource.error?.message || '请求失败时不会回退到演示数据。'}`}
          action={<Btn icon="RotateCcw" onClick={resource.reload}>重新加载</Btn>}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="CalendarX"
          title="还没有阅读安排"
          desc="创建一个安排后，学生端才会出现对应的书目与起止时间；自由阅读只约束书目与时间，班级共读会统一进度。"
          action={
            <Btn tone="primary" icon="CalendarPlus" onClick={() => setCreateOpen(true)}>
              创建安排
            </Btn>
          }
        />
      ) : (
        <div className="rounded-xl border border-ink-150 overflow-hidden bg-white/60">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-ink-50/70 text-[11.5px] text-ink-500">
                <th className="px-3 py-2.5 font-medium">书目与范围</th>
                <th className="px-2 py-2.5 font-medium w-[92px]">类型</th>
                <th className="px-2 py-2.5 font-medium w-[152px]">起止时间</th>
                <th className="px-2 py-2.5 font-medium w-[92px]">参与</th>
                <th className="px-2 py-2.5 font-medium w-[136px]">进度</th>
                <th className="px-2 py-2.5 font-medium w-[88px]">状态</th>
                <th className="px-2 py-2.5 font-medium w-[76px] text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((a) => {
                const t = ASSIGNMENT_TYPES.find((x) => x.key === a.type) || ASSIGNMENT_TYPES[0]
                const st = ASSIGNMENT_STATUS[a.status] || ASSIGNMENT_STATUS.upcoming
                return (
                  <tr key={a.id} className="border-t border-ink-150/70 hover:bg-white/70 transition">
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => navigate(`/console/teaching/arrangements/${a.id}`)}
                        className="text-left group min-w-0"
                      >
                        <span className="flex items-baseline gap-1.5">
                          <span className="font-serif text-[13.5px] font-semibold text-ink-900 group-hover:text-brand-700 transition">
                            {a.title}
                          </span>
                          <span className="text-[12px] text-ink-600">{a.chapter}</span>
                        </span>
                        <span className="block text-[11.5px] text-ink-400 mt-0.5 truncate">
                          {[a.classNames.join('、'), a.owner].filter(Boolean).join(' · ') || '服务端未返回班级与创建人'}
                        </span>
                      </button>
                    </td>
                    <td className="px-2 py-2.5">
                      <StatusTag tone={t.tone === 'brand' ? 'brand' : t.tone === 'violet' ? 'accent' : 'success'}>
                        {t.label}
                      </StatusTag>
                    </td>
                    <td className="px-2 py-2.5 text-[11.5px] text-ink-600 tabular-nums">
                      {a.start ? a.start.slice(5) : '—'} → {a.end ? a.end.slice(5) : '—'}
                      <span className="block text-[11px] text-ink-400">{a.startTime ? `${a.startTime} 开始` : '时间未返回'}</span>
                    </td>
                    <td className="px-2 py-2.5 text-[12px] text-ink-700 tabular-nums">
                      {a.joined == null || a.total == null ? '—' : `${a.joined}/${a.total}`}
                    </td>
                    <td className="px-2 py-2.5">
                      {a.progress == null ? (
                        <span className="text-[11px] text-ink-400">服务端未返回</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <BarProgress
                              value={a.progress}
                              showValue={false}
                              size="sm"
                              tone={a.status === 'paused' ? 'warning' : a.progress === 100 ? 'success' : 'brand'}
                            />
                          </div>
                          <span className="text-[11px] text-ink-500 tabular-nums w-8 text-right">{a.progress}%</span>
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <StatusTag tone={st.tone} dot>
                        {st.label}
                      </StatusTag>
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center justify-end gap-0.5">
                        <IconBtn
                          icon="BookOpen"
                          title="用教师阅读器带读"
                          onClick={() => navigate(`/console/teaching/reader/${a.bookId}`)}
                        />
                        <IconBtn
                          icon="ChevronRight"
                          title="安排详情"
                          onClick={() => navigate(`/console/teaching/arrangements/${a.id}`)}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
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
            unit="个安排"
          />
        </div>
      )}

      <CreateArrangeModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        books={resource.data?.books || []}
        classes={resource.data?.classes || []}
        createState={resource.createState}
        onCreate={resource.createAssignment}
        onResetCreate={resource.resetCreateState}
      />
    </PagePanel>
  )
}

// 创建安排：第一步选书（书架式小卡），第二步填班级 / 类型 / 起止 / 说明
function CreateArrangeModal({ open, onClose, books, classes, createState, onCreate, onResetCreate }) {
  const [step, setStep] = useState(1)
  const [book, setBook] = useState(null)
  const [form, setForm] = useState(createInitialForm)

  const close = () => {
    onClose()
    onResetCreate()
    setStep(1)
    setBook(null)
    setForm(createInitialForm())
  }

  const toggleClass = (id) =>
    setForm((f) => ({
      ...f,
      classIds: f.classIds.includes(id) ? f.classIds.filter((x) => x !== id) : [...f.classIds, id],
    }))

  const canSubmit = book && form.classIds.length > 0 && form.chapter.trim() && createState.status !== 'loading'
  const submit = async () => {
    try {
      await onCreate({
        book,
        classIds: form.classIds,
        title: form.chapter,
        start: form.start,
        end: form.end,
        startTime: form.startTime,
      })
      close()
    } catch {
      return null
    }
    return null
  }

  return (
    <Modal
      open={open}
      onClose={close}
      icon="CalendarPlus"
      title={step === 1 ? '创建阅读安排 · 先选一本书' : '创建阅读安排 · 填写范围与时间'}
      desc={
        step === 1
          ? '只能选已上架的书；审核中与已下架的书不能用来建安排。'
          : `已选《${book?.title}》，接着选班级、填说明与起止时间。`
      }
      width="max-w-[640px]"
      footer={
        step === 1 ? (
          <>
            <Btn onClick={close}>取消</Btn>
            <Btn tone="primary" iconRight="ArrowRight" disabled={!book} onClick={() => setStep(2)}>
              下一步
            </Btn>
          </>
        ) : (
          <>
            <Btn icon="ArrowLeft" onClick={() => setStep(1)}>
              上一步
            </Btn>
            <Btn tone="ghost" onClick={close}>
              取消
            </Btn>
            <Btn tone="primary" disabled={!canSubmit} onClick={submit}>
              {createState.status === 'loading' ? '创建中…' : '创建'}
            </Btn>
          </>
        )
      }
    >
      {step === 1 ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
          {books.map((b) => {
            const on = book?.id === b.id
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setBook(b)}
                className={cx(
                  'text-left p-1.5 rounded-xl border transition',
                  on ? 'border-brand-400 bg-brand-50/70 ring-2 ring-brand-200' : 'border-ink-150 hover:border-ink-300',
                )}
              >
                <div
                  className="w-full aspect-[3/4] rounded-md shadow-e1 relative overflow-hidden"
                  style={{
                    backgroundImage: b.coverUrl ? `url("${b.coverUrl}")` : 'none',
                    backgroundPosition: 'center',
                    backgroundSize: 'cover',
                  }}
                >
                  <span className="absolute left-0 top-0 bottom-0 w-[5px] bg-black/12" aria-hidden="true" />
                  {on && (
                    <span className="absolute right-1 top-1 w-4 h-4 rounded-full bg-brand-600 text-white flex items-center justify-center">
                      <Icon name="Check" className="w-2.5 h-2.5" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <p className="text-[11.5px] font-medium text-ink-800 mt-1 truncate">{b.title}</p>
                <p className="text-[10.5px] text-ink-400 truncate">{b.author}</p>
              </button>
            )
          })}
          {books.length === 0 && <p className="col-span-full text-[11.5px] text-warning-700">当前工作空间没有可创建安排的真实书籍版本。</p>}
        </div>
      ) : (
        <div className="space-y-3.5">
          <div>
            <span className="block text-[12px] text-ink-600 mb-1.5">安排类型</span>
            <div className="flex flex-wrap gap-1.5">
              {ASSIGNMENT_TYPES.map((t) => (
                <Chip key={t.key} active={form.type === t.key} disabled={t.key !== 'class'} onClick={() => setForm((f) => ({ ...f, type: t.key }))}>
                  {t.label}
                </Chip>
              ))}
            </div>
            <p className="text-[11.5px] text-ink-500 mt-1.5">
              真实创建接口当前按班级共读写入；自由阅读与导读课需等服务端契约提供类型字段后启用。
            </p>
          </div>

          <div>
            <span className="block text-[12px] text-ink-600 mb-1.5">
              参与班级（已选 {form.classIds.length} 个）
            </span>
            <div className="flex flex-wrap gap-1.5">
              {classes.map((c) => (
                <Chip key={c.id} active={form.classIds.includes(c.id)} onClick={() => toggleClass(c.id)}>
                  {c.name}
                </Chip>
              ))}
            </div>
            {classes.length === 0 && (
              <p className="text-[11.5px] text-warning-700 mt-1.5">
                当前工作空间没有可选班级，需要先在班级管理里创建或恢复班级。
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[12px] text-ink-600 mb-1.5">读到哪里（必填）</span>
              <input
                value={form.chapter}
                onChange={(e) => setForm((f) => ({ ...f, chapter: e.target.value }))}
                placeholder="如 第 3 章 / 第 1-2 章 / 精读导读"
                className="console-input"
              />
            </label>
            <label className="block">
              <span className="block text-[12px] text-ink-600 mb-1.5">每日开始时间</span>
              <input
                type="time"
                value={form.startTime}
                onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                className="console-input"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[12px] text-ink-600 mb-1.5">开始日期</span>
              <input
                type="date"
                value={form.start}
                onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
                className="console-input"
              />
            </label>
            <label className="block">
              <span className="block text-[12px] text-ink-600 mb-1.5">结束日期</span>
              <input
                type="date"
                value={form.end}
                onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
                className="console-input"
              />
            </label>
          </div>

          <label className="block">
            <span className="block text-[12px] text-ink-600 mb-1.5">给学生的说明</span>
            <textarea
              value={form.note}
              disabled
              rows={3}
              placeholder="当前真实接口尚未提供独立说明字段，暂不接收这项内容"
              className="console-input resize-none"
            />
          </label>

          <p className="text-[11.5px] text-ink-500 flex items-start gap-1.5">
            <Icon name="Info" className="w-3.5 h-3.5 mt-px shrink-0 text-ink-400" />
            创建会写入当前工作空间的真实数据库，成功后列表会重新从接口读取；请求失败不会显示虚构安排。
          </p>
          {createState.status === 'error' && (
            <p className="text-[11.5px] text-danger-700">
              {createState.error?.code || 'DEPENDENCY_UNAVAILABLE'}：{createState.error?.message || '创建失败，请稍后重试'}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

function inputDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function createInitialForm() {
  const startsOn = new Date()
  const endsOn = new Date(startsOn)
  endsOn.setDate(endsOn.getDate() + 7)
  return {
    type: 'class',
    classIds: [],
    chapter: '',
    start: inputDate(startsOn),
    end: inputDate(endsOn),
    startTime: '09:00',
    note: '',
  }
}
