import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RuntimeIcon as Icon } from '../../../shared/RuntimeIcon.jsx'
import { cx } from '../../../shared/cx.js'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, Chip, EmptyState, IconBtn, SearchBox, Select, StatusTag, TableFooter } from '../../components/Controls.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import useReportsData, { REPORT_STATUS, REPORT_TYPES } from '../../state/useReportsData.js'

// 报告中心：顶部类型胶囊 + 一行筛选（班级／书籍／时间／状态）+ 列表。
// 六种状态都要能在这一页看到：生成中／待确认／待审核／已发布／发送失败／已撤回。
// 点一行进详情，详情用独立路由，返回时筛选条件保留（筛选状态留在本页 state 里）。

const TIME_OPTIONS = [
  { value: 'all', label: '全部时间' },
  { value: 'week', label: '近 7 天' },
  { value: 'month', label: '本月' },
]

// 演示数据里的时间是手写文案，按「8月」「7月」这种前缀粗略归档即可
function inRange(report, range) {
  if (range === 'all') return true
  const t = report.updatedAt
  if (range === 'week') return t.startsWith('今天') || t.startsWith('8月')
  return t.startsWith('今天') || t.startsWith('8月')
}

export default function ReportCenter() {
  const { workspace, canAccessPath } = useConsole()
  const canParents = canAccessPath('/console/reports/parents')
  const navigate = useNavigate()
  const resource = useReportsData(workspace?.id)
  const { reports: all = [], classes = [], books = [], students = [] } = resource.data || {}

  const [type, setType] = useState('all')
  const [classId, setClassId] = useState('all')
  const [bookId, setBookId] = useState('all')
  const [time, setTime] = useState('all')
  const [status, setStatus] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [studentId, setStudentId] = useState('')

  const typeCounts = useMemo(() => {
    const m = { all: all.length }
    for (const k of Object.keys(REPORT_TYPES)) m[k] = all.filter((r) => r.type === k).length
    return m
  }, [all])

  const rows = useMemo(() => {
    const k = keyword.trim()
    return all.filter((r) => {
      if (type !== 'all' && r.type !== type) return false
      if (classId !== 'all' && r.classId !== classId) return false
      if (bookId !== 'all' && r.bookId !== bookId) return false
      if (status !== 'all' && r.status !== status) return false
      if (!inRange(r, time)) return false
      if (!k) return true
      return r.title.includes(k) || r.no.includes(k) || (r.student?.name || '').includes(k)
    })
  }, [all, type, classId, bookId, status, time, keyword])

  const dirty = type !== 'all' || classId !== 'all' || bookId !== 'all' || status !== 'all' || time !== 'all' || keyword
  const reset = () => {
    setType('all')
    setClassId('all')
    setBookId('all')
    setTime('all')
    setStatus('all')
    setKeyword('')
    setPage(1)
  }

  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize)
  const need = all.filter((r) => r.status === 'confirm' || r.status === 'review' || r.status === 'failed')
  const generateReport = async () => {
    if (!studentId) return
    try {
      await resource.createReport({ studentId })
      setStudentId('')
    } catch {}
  }

  return (
    <PagePanel
      title={`${workspace?.scopeLabel || '当前工作空间'} · 报告中心`}
      desc="报告分四类：学生个人总结、班级与阅读安排、学校汇总、家长阅读报告。AI 生成的段落在详情里单独标注，教师确认前不会发给家长。"
      toolbar={
        <>
          <SearchBox value={keyword} onChange={setKeyword} placeholder="搜索报告标题、编号或学生" width="w-[218px]" />
          <Select
            value={studentId}
            onChange={setStudentId}
            options={[{ value: '', label: '选择真实学生' }, ...students.map((student) => ({ value: student.id, label: student.name }))]}
            width="w-[154px]"
          />
          <Btn tone="primary" icon="Sparkles" disabled={!studentId || resource.mutationState.status === 'loading'} onClick={generateReport}>
            生成报告
          </Btn>
          <span title="模板与规则的真实读取接口暂未开放，当前不会跳转到静态页面。">
            <Btn icon="Settings2" disabled>
              模板与规则
            </Btn>
          </span>
          {canParents && (
            <Btn tone="primary" icon="Send" onClick={() => navigate('/console/reports/parents')}>
              家长发送
            </Btn>
          )}
        </>
      }
    >
      {resource.status === 'loading' && (
        <div className="console-enter mb-3.5 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-ink-50/70 border border-ink-150">
          <Icon name="LoaderCircle" className="w-4 h-4 text-ink-500 shrink-0" strokeWidth={1.9} />
          <p className="text-[12.5px] text-ink-600">正在读取真实学生与报告数据…</p>
        </div>
      )}
      {resource.status === 'error' && (
        <div className="console-enter mb-3.5 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-danger-50/70 border border-danger-100">
          <Icon name="CircleX" className="w-4 h-4 text-danger-600 shrink-0" strokeWidth={1.9} />
          <p className="text-[12.5px] text-danger-700">{resource.error.message}</p>
          <Btn size="sm" tone="plain" onClick={resource.reload}>重新读取</Btn>
        </div>
      )}
      {/* 需要我处理的：把六种状态里真正要动作的三种挑出来放在最前，不用用户自己筛 */}
      {need.length > 0 && (
        <div className="console-enter mb-3.5 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-warning-50/70 border border-warning-100">
          <Icon name="BellRing" className="w-4 h-4 text-warning-600 shrink-0" strokeWidth={1.9} />
          <p className="text-[12.5px] text-ink-700">
            有 <b className="tabular-nums">{need.length}</b> 份报告在等你：
            {need.map((r, i) => (
              <span key={r.id}>
                {i > 0 && '、'}
                <button
                  type="button"
                  onClick={() => navigate(`/console/reports/${r.id}`)}
                  className="text-brand-700 hover:underline"
                >
                  {r.title}
                </button>
                <span className="text-ink-500">（{REPORT_STATUS[r.status].label}）</span>
              </span>
            ))}
          </p>
        </div>
      )}

      {/* 类型胶囊：计数为 0 的禁用，避免点出空列表 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Chip active={type === 'all'} count={typeCounts.all} onClick={() => (setType('all'), setPage(1))}>
          全部
        </Chip>
        {Object.entries(REPORT_TYPES).map(([k, v]) => (
          <Chip
            key={k}
            active={type === k}
            count={typeCounts[k]}
            disabled={typeCounts[k] === 0}
            onClick={() => (setType(k), setPage(1))}
          >
            {v.label}
          </Chip>
        ))}
      </div>

      {/* 筛选行：右侧对齐重置（参考图的做法） */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <Select
          value={classId}
          onChange={(v) => (setClassId(v), setPage(1))}
          options={[{ value: 'all', label: '全部班级' }, ...classes.map((c) => ({ value: c.id, label: c.name }))]}
          width="w-[142px]"
        />
        <Select
          value={bookId}
          onChange={(v) => (setBookId(v), setPage(1))}
          options={[{ value: 'all', label: '全部书籍' }, ...books.map((b) => ({ value: b.id, label: b.title }))]}
          width="w-[150px]"
        />
        <Select value={time} onChange={(v) => (setTime(v), setPage(1))} options={TIME_OPTIONS} width="w-[112px]" />
        <Select
          value={status}
          onChange={(v) => (setStatus(v), setPage(1))}
          options={[
            { value: 'all', label: '全部状态' },
            ...Object.entries(REPORT_STATUS).map(([k, v]) => ({ value: k, label: v.label })),
          ]}
          width="w-[122px]"
        />
        <div className="flex-1" />
        <Btn tone="ghost" icon="RotateCcw" disabled={!dirty} onClick={reset}>
          重置筛选
        </Btn>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="FileSearch"
          title="没有符合条件的报告"
          desc="换一个类型或时间范围看看；生成中的报告完成后会自动出现在这里。"
          action={
            <Btn tone="primary" icon="RotateCcw" onClick={reset}>
              清空筛选
            </Btn>
          }
        />
      ) : (
        <div className="mt-3.5 flex-1 min-h-0 flex flex-col">
          <div className="rounded-xl border border-ink-150 overflow-hidden bg-white/60">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-ink-50/70 text-[11.5px] text-ink-500">
                  <th className="px-3 py-2.5 font-medium">报告</th>
                  <th className="px-2 py-2.5 font-medium w-[132px]">类型</th>
                  <th className="px-2 py-2.5 font-medium w-[150px]">范围</th>
                  <th className="px-2 py-2.5 font-medium w-[168px]">期间</th>
                  <th className="px-2 py-2.5 font-medium w-[104px]">状态</th>
                  <th className="px-2 py-2.5 font-medium w-[148px]">下一处理人</th>
                  <th className="px-2 py-2.5 font-medium w-[62px] text-right">打开</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const st = REPORT_STATUS[r.status]
                  const ty = REPORT_TYPES[r.type]
                  const klass = r.className ? { name: r.className } : null
                  const stu = r.student
                  return (
                    <tr
                      key={r.id}
                      onClick={() => navigate(`/console/reports/${r.id}`)}
                      className="border-t border-ink-150/70 hover:bg-white/80 transition cursor-pointer"
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={cx(
                              'w-6 h-6 rounded-lg flex items-center justify-center shrink-0',
                              TONE[ty.tone],
                            )}
                          >
                            <Icon name={ty.icon} className="w-[13px] h-[13px]" strokeWidth={2} />
                          </span>
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium text-ink-900 truncate">{r.title}</p>
                            <p className="text-[11px] text-ink-400 tabular-nums">
                              {r.no} · {r.version === '——' ? '暂无版本' : r.version}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-[12px] text-ink-600">{ty.label}</td>
                      <td className="px-2 py-2.5 text-[12.5px] text-ink-700 truncate">
                        {stu ? `${stu.name} · ${klass?.name || ''}` : klass?.name || '全校'}
                      </td>
                      <td className="px-2 py-2.5 text-[12px] text-ink-500">{r.period}</td>
                      <td className="px-2 py-2.5">
                        <StatusTag tone={st.tone} dot>
                          {st.label}
                        </StatusTag>
                      </td>
                      <td className="px-2 py-2.5 text-[12px] text-ink-600 truncate">{r.nextHandler}</td>
                      <td className="px-2 py-2.5 text-right">
                        <IconBtn icon="ChevronRight" title="查看报告详情" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <TableFooter
            total={rows.length}
            page={page}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={(n) => (setPageSize(n), setPage(1))}
            unit="份"
          />
        </div>
      )}
    </PagePanel>
  )
}

const TONE = {
  brand: 'bg-brand-50 text-brand-600',
  cyan: 'bg-[#E4F5F2] text-[#2E8C86]',
  violet: 'bg-[#F0ECFB] text-[#7C6BD8]',
  accent: 'bg-accent-50 text-accent-600',
}
