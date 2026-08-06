import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { cx, Icon } from '../../../components/ui.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import {
  Btn,
  Chip,
  EmptyState,
  Field,
  IconBtn,
  SearchBox,
  Select,
  StatusTag,
  SubHead,
  TableFooter,
  ViewToggle,
} from '../../components/Controls.jsx'
import { ConfirmModal, SideSheet } from '../../components/Overlay.jsx'
import { BarProgress, RingProgress } from '../../components/Progress.jsx'
import MiniChart from '../../components/MiniChart.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import { getClasses } from '../../data/fixtures/classes.js'
import { DEMO_THRESHOLDS, QUOTA_STATE, getQuotaHistory, getQuotaStudents } from '../../data/fixtures/usage.js'

// 额度管理：顶部筛选 + 卡片／列表 + 点学生开右侧详情抽屉。
// 用量概览的下钻就落在这里，筛选条件通过地址栏参数传进来（可刷新、可分享），
// 页面上把生效的筛选显示成可移除的胶囊，不让人猜「为什么只剩这几个人」。

const STATE_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'normal', label: '正常' },
  { value: 'near', label: '即将耗尽' },
  { value: 'over', label: '已触限' },
  { value: 'paused', label: '已暂停' },
  { value: 'growth', label: '异常增长' },
]

const HISTORY_DOT = {
  danger: 'bg-danger-500',
  warning: 'bg-warning-500',
  brand: 'bg-brand-500',
  muted: 'bg-ink-300',
}

// 近 7 天调用次数：按学生本周总数摊出一条有起伏的曲线，只用于演示形状
function weekSeries(total) {
  const w = [0.09, 0.13, 0.11, 0.06, 0.18, 0.21, 0.22]
  return w.map((r) => Math.max(0, Math.round(total * r)))
}

export default function QuotaManage() {
  const { workspace, prefs, setPref } = useConsole()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const all = useMemo(() => getQuotaStudents(workspace.id), [workspace.id])
  const classes = useMemo(() => getClasses(workspace.id), [workspace.id])

  const stateParam = params.get('state') || 'all'
  const classParam = params.get('class') || 'all'
  const gradeParam = params.get('grade') || ''
  const schoolParam = params.get('school') || ''

  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [picked, setPicked] = useState([])
  const [openId, setOpenId] = useState(null)
  const [ask, setAsk] = useState(null)
  const view = prefs.viewMode || 'card'

  const setParam = (k, v) => {
    const next = new URLSearchParams(params)
    if (!v || v === 'all') next.delete(k)
    else next.set(k, v)
    setParams(next, { replace: true })
    setPage(1)
  }

  const rows = useMemo(() => {
    const k = keyword.trim()
    return all.filter((s) => {
      if (stateParam === 'growth') {
        if (s.growth < DEMO_THRESHOLDS.growthPercent) return false
      } else if (stateParam !== 'all' && s.state !== stateParam) return false
      if (classParam !== 'all' && s.classId !== classParam) return false
      if (gradeParam) {
        const cls = classes.find((c) => c.id === s.classId)
        if (!cls || cls.grade !== gradeParam) return false
      }
      // 演示数据只包含培新小学，选其他学校会得到空状态 —— 这是真实的范围差异
      if (schoolParam && schoolParam !== '培新小学') return false
      if (!k) return true
      return s.name.includes(k) || s.no.includes(k) || s.className.includes(k)
    })
  }, [all, classes, keyword, stateParam, classParam, gradeParam, schoolParam])

  const paged = rows.slice((page - 1) * pageSize, page * pageSize)
  const opened = all.find((s) => s.id === openId) || null
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const activeFilters = [
    stateParam !== 'all' && {
      key: 'state',
      label: `状态：${STATE_OPTIONS.find((o) => o.value === stateParam)?.label || stateParam}`,
    },
    classParam !== 'all' && {
      key: 'class',
      label: `班级：${classes.find((c) => c.id === classParam)?.name || classParam}`,
    },
    gradeParam && { key: 'grade', label: `年级：${gradeParam}` },
    schoolParam && { key: 'school', label: `学校：${schoolParam}` },
  ].filter(Boolean)

  return (
    <PagePanel
      title={`${workspace.scopeLabel} · 额度管理`}
      desc={`共 ${all.length} 名学生有 AI 使用记录；教师只能在学校上限内降低或恢复额度，提高上限需要更高一级工作空间。`}
      toolbar={
        <>
          <SearchBox
            value={keyword}
            onChange={(v) => (setKeyword(v), setPage(1))}
            placeholder="搜索学生、学号或班级"
          />
          <Select value={stateParam} onChange={(v) => setParam('state', v)} options={STATE_OPTIONS} />
          <Select
            value={classParam}
            onChange={(v) => setParam('class', v)}
            options={[{ value: 'all', label: '全部班级' }, ...classes.map((c) => ({ value: c.id, label: c.name }))]}
            width="w-[150px]"
          />
          <ViewToggle value={view} onChange={(v) => setPref('viewMode', v)} />
        </>
      }
    >
      {activeFilters.length > 0 && (
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <span className="text-[12px] text-ink-500">来自用量概览的下钻：</span>
          {activeFilters.map((f) => (
            <span
              key={f.key}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-brand-50 border border-brand-200 text-[12px] text-brand-700"
            >
              {f.label}
              <button
                type="button"
                onClick={() => setParam(f.key, null)}
                aria-label={`移除 ${f.label}`}
                className="w-3.5 h-3.5 rounded-full bg-brand-200 text-white flex items-center justify-center hover:bg-brand-500 transition"
              >
                <Icon name="X" className="w-2.5 h-2.5" strokeWidth={3} />
              </button>
            </span>
          ))}
          <Btn size="sm" tone="ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            全部清除
          </Btn>
        </div>
      )}

      {picked.length > 0 && (
        <div className="mb-3 flex items-center gap-2.5 h-10 px-3 rounded-lg bg-brand-50/80 border border-brand-100">
          <Icon name="CheckCheck" className="w-4 h-4 text-brand-600" strokeWidth={1.9} />
          <span className="text-[12.5px] text-brand-800">
            已选择 <span className="font-semibold tabular-nums">{picked.length}</span> 名学生
          </span>
          <div className="flex-1" />
          <Btn size="sm" icon="BatteryCharging" onClick={() => setAsk({ kind: 'restore', many: true })}>
            批量恢复 AI
          </Btn>
          <Btn size="sm" icon="Minus" onClick={() => setAsk({ kind: 'lower', many: true })}>
            批量降低上限
          </Btn>
          <Btn size="sm" tone="ghost" onClick={() => setPicked([])}>
            取消选择
          </Btn>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon="Gauge"
          title="没有符合条件的学生"
          desc={
            schoolParam && schoolParam !== '培新小学'
              ? `演示数据只包含培新小学，${schoolParam} 暂无可展示的学生额度。`
              : '试着清掉上面的筛选条件，或换一个关键词。'
          }
          action={
            <Btn tone="primary" onClick={() => (setParams(new URLSearchParams(), { replace: true }), setKeyword(''))}>
              清空筛选
            </Btn>
          }
        />
      ) : view === 'card' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {paged.map((s) => (
            <QuotaCard
              key={s.id}
              data={s}
              ring={prefs.chartStyle === 'ring'}
              checked={picked.includes(s.id)}
              onCheck={() => toggle(s.id)}
              onOpen={() => setOpenId(s.id)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-ink-150 overflow-hidden bg-white/60">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-ink-50/70 text-[11.5px] text-ink-500">
                <th className="px-3 py-2.5 font-medium">学生</th>
                <th className="px-2 py-2.5 font-medium w-[136px]">班级</th>
                <th className="px-2 py-2.5 font-medium w-[190px]">已用 / 上限</th>
                <th className="px-2 py-2.5 font-medium w-[84px]">剩余</th>
                <th className="px-2 py-2.5 font-medium w-[112px]">重置时间</th>
                <th className="px-2 py-2.5 font-medium w-[96px]">AI 状态</th>
                <th className="px-2 py-2.5 font-medium w-[64px] text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((s) => {
                const st = QUOTA_STATE[s.state]
                return (
                  <tr key={s.id} className="border-t border-ink-150/70 hover:bg-white/70 transition">
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => setOpenId(s.id)}
                        className="text-[13px] font-medium text-ink-900 hover:text-brand-600 transition"
                      >
                        {s.name}
                      </button>
                      <span className="text-[11.5px] text-ink-400 ml-2 tabular-nums">{s.no}</span>
                    </td>
                    <td className="px-2 py-2.5 text-[12.5px] text-ink-700">{s.className}</td>
                    <td className="px-2 py-2.5">
                      <BarProgress
                        value={s.percent}
                        size="sm"
                        showValue={false}
                        tone={s.state === 'over' ? 'danger' : s.state === 'near' ? 'warning' : 'brand'}
                      />
                      <span className="text-[11px] text-ink-500 tabular-nums">
                        {s.quota.used} / {s.quota.total} 次 · {s.percent}%
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-[12.5px] text-ink-700 tabular-nums">
                      {Math.max(0, s.quota.total - s.quota.used)} 次
                    </td>
                    <td className="px-2 py-2.5 text-[12px] text-ink-500">{s.resetAt}</td>
                    <td className="px-2 py-2.5">
                      <StatusTag tone={st.tone} dot>
                        {st.label}
                      </StatusTag>
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <IconBtn icon="PanelRight" title="打开额度详情" onClick={() => setOpenId(s.id)} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <TableFooter
          total={rows.length}
          page={page}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(n) => (setPageSize(n), setPage(1))}
          unit="人"
        />
      )}

      {/* 学生额度详情：抽屉而不是新页面，看完就回列表，列表位置不丢 */}
      <SideSheet
        open={!!opened}
        onClose={() => setOpenId(null)}
        title={opened ? `${opened.name} · 额度详情` : ''}
        desc={opened ? `${opened.className} · 学号 ${opened.no}` : ''}
        width="w-[440px]"
        footer={
          <>
            <Btn onClick={() => setAsk({ kind: 'lower', target: opened })}>降低上限</Btn>
            <Btn tone="primary" icon="BatteryCharging" onClick={() => setAsk({ kind: 'restore', target: opened })}>
              恢复 AI 使用
            </Btn>
          </>
        }
      >
        {opened && (
          <>
            <div className="flex items-start gap-4">
              {prefs.chartStyle === 'ring' ? (
                <RingProgress
                  value={opened.percent}
                  size={86}
                  sub="已用"
                  tone={opened.state === 'over' ? 'danger' : opened.state === 'near' ? 'warning' : 'brand'}
                />
              ) : (
                <div className="flex-1">
                  <BarProgress
                    value={opened.percent}
                    label="本周额度"
                    size="lg"
                    tone={opened.state === 'over' ? 'danger' : opened.state === 'near' ? 'warning' : 'brand'}
                    hint={`${opened.quota.used} / ${opened.quota.total} 次 · ${opened.resetAt}重置`}
                  />
                </div>
              )}
              {prefs.chartStyle === 'ring' && (
                <div className="min-w-0 flex-1 pt-1">
                  <p className="text-[12.5px] text-ink-700">
                    {opened.quota.used} / {opened.quota.total} 次
                  </p>
                  <p className="text-[11.5px] text-ink-400 mt-1">{opened.resetAt}重置</p>
                </div>
              )}
            </div>

            <div className="mt-3">
              <StatusTag tone={QUOTA_STATE[opened.state].tone} dot>
                {QUOTA_STATE[opened.state].label}
              </StatusTag>
              <span className="text-[12px] text-ink-500 ml-2">{QUOTA_STATE[opened.state].desc}</span>
            </div>

            <div className="mt-4">
              <SubHead icon="ChartColumn" title="近 7 天使用次数" />
              <MiniChart
                chart={{
                  type: 'bar',
                  data: weekSeries(opened.weekCalls),
                  labels: ['7/29', '7/30', '7/31', '8/1', '8/2', '8/3', '8/4'],
                }}
                tone="cyan"
                height={96}
              />
              <p className="text-[11.5px] text-ink-400 mt-2">
                本周共 {opened.weekCalls} 次，周环比{' '}
                <span
                  className={cx(
                    'font-semibold tabular-nums',
                    opened.growth >= DEMO_THRESHOLDS.growthPercent ? 'text-danger-600' : 'text-ink-600',
                  )}
                >
                  {opened.growth > 0 ? '+' : ''}
                  {opened.growth}%
                </span>
                {opened.growth >= DEMO_THRESHOLDS.growthPercent && '（超过演示阈值，已计入异常增长）'}
              </p>
            </div>

            <div className="mt-4 pt-3.5 border-t border-ink-150/70">
              <SubHead icon="History" title="触限与调整记录" />
              <ol className="space-y-2.5">
                {getQuotaHistory(opened.id).map((h, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className={cx('w-1.5 h-1.5 rounded-full mt-[6px] shrink-0', HISTORY_DOT[h.tone])} />
                    <div className="min-w-0">
                      <p className="text-[12.5px] text-ink-700">{h.text}</p>
                      <p className="text-[11px] text-ink-400 mt-0.5">{h.at}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="mt-4 pt-3.5 border-t border-ink-150/70">
              <Field label="用眼状态">
                <span>
                  今天 {opened.eyecare.todayMinutes} 分钟 · 最长连续 {opened.eyecare.longest} 分钟
                </span>
              </Field>
              <Field label="相关页面">
                <div className="flex flex-wrap gap-2">
                  <Btn size="sm" icon="User" onClick={() => navigate(`/console/accounts/students/${opened.id}`)}>
                    学生详情
                  </Btn>
                  <Btn
                    size="sm"
                    icon="MessagesSquare"
                    onClick={() => navigate(`/console/usage/sessions?student=${opened.id}`)}
                  >
                    这名学生的会话
                  </Btn>
                </div>
              </Field>
            </div>
          </>
        )}
      </SideSheet>

      <ConfirmModal
        open={!!ask}
        onClose={() => setAsk(null)}
        onConfirm={() => (setAsk(null), setPicked([]))}
        tone={ask?.kind === 'lower' ? 'primary' : 'primary'}
        confirmText={ask?.kind === 'lower' ? '降低上限' : '恢复使用'}
        title={
          ask?.kind === 'lower'
            ? ask?.many
              ? `降低 ${picked.length} 名学生的额度上限`
              : `降低 ${ask?.target?.name} 的额度上限`
            : ask?.many
              ? `恢复 ${picked.length} 名学生的 AI 使用`
              : `恢复 ${ask?.target?.name} 的 AI 使用`
        }
        desc={
          ask?.kind === 'lower'
            ? '只能在学校上限内降低；降低后本周剩余次数按新上限重新计算，学生端会立即看到提示。演示环境不写入。'
            : '恢复后学生立即可以继续提问，本周已用次数不清零。演示环境不写入。'
        }
      />
    </PagePanel>
  )
}

// 额度卡片：复选框 + 姓名班级 + 进度 + 状态 + 重置时间，点卡片开抽屉
function QuotaCard({ data, ring, checked, onCheck, onOpen }) {
  const st = QUOTA_STATE[data.state]
  const tone = data.state === 'over' ? 'danger' : data.state === 'near' ? 'warning' : 'brand'
  return (
    <GlassCard
      className={cx(
        'p-3.5 rounded-xl min-w-0 transition',
        checked ? 'ring-2 ring-brand-300 border-brand-200' : 'hover:shadow-e2',
      )}
    >
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          onClick={onCheck}
          aria-label={`选择 ${data.name}`}
          className={cx(
            'w-4 h-4 rounded-[5px] border shrink-0 mt-0.5 flex items-center justify-center transition',
            checked ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white/80 border-ink-300 hover:border-brand-300',
          )}
        >
          {checked && <Icon name="Check" className="w-3 h-3" strokeWidth={3} />}
        </button>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className="text-[13.5px] font-semibold text-ink-900 truncate">{data.name}</p>
          <p className="text-[11.5px] text-ink-500 truncate mt-0.5">
            {data.className} · {data.no}
          </p>
        </button>
        <StatusTag tone={st.tone} dot className="shrink-0">
          {st.label}
        </StatusTag>
      </div>

      <button type="button" onClick={onOpen} className="w-full text-left mt-3">
        {ring ? (
          <div className="flex items-center gap-3.5">
            <RingProgress value={data.percent} size={68} stroke={8} tone={tone} />
            <div className="min-w-0">
              <p className="text-[12.5px] text-ink-700 tabular-nums">
                {data.quota.used} / {data.quota.total} 次
              </p>
              <p className="text-[11.5px] text-ink-400 mt-1">剩余 {Math.max(0, data.quota.total - data.quota.used)} 次</p>
            </div>
          </div>
        ) : (
          <BarProgress
            value={data.percent}
            tone={tone}
            hint={`${data.quota.used} / ${data.quota.total} 次 · 剩余 ${Math.max(0, data.quota.total - data.quota.used)} 次`}
          />
        )}
      </button>

      <div className="mt-3 pt-2.5 border-t border-ink-150/70 flex items-center gap-2 text-[11.5px] text-ink-500">
        <Icon name="RotateCcw" className="w-3.5 h-3.5 text-ink-400" strokeWidth={1.9} />
        <span>{data.resetAt}重置</span>
        <div className="flex-1" />
        {data.growth >= DEMO_THRESHOLDS.growthPercent && (
          <span className="text-danger-600 font-semibold tabular-nums">+{data.growth}%</span>
        )}
      </div>
    </GlassCard>
  )
}
