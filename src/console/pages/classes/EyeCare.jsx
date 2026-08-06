import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cx, Icon } from '../../../components/ui.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, Chip, EmptyState, IconBtn, SearchBox, Select, StatusTag, SubHead } from '../../components/Controls.jsx'
import { ConfirmModal, Modal } from '../../components/Overlay.jsx'
import { BarProgress } from '../../components/Progress.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import usePrivacyEyeCareData from '../../state/usePrivacyEyeCareData.js'

// 护眼管理：这一页只做「筛选 + 班级概况 + 学生列表 + 两个弹窗」。
// 点学生进已有的学生详情并定位到护眼区（?section=eye-care），
// 不再造第二个护眼详情页 —— 学生资料只能有一个事实来源。

const STATE_ORDER = ['over', 'warn', 'ok', 'idle']

const EYE_STATE = {
  over: { label: '强制休息', tone: 'danger' },
  warn: { label: '提示休息', tone: 'warning' },
  ok: { label: '正常', tone: 'success' },
  idle: { label: '暂无记录', tone: 'muted' },
}

function minutes(seconds) {
  const value = Number(seconds)
  return Number.isFinite(value) ? Math.round(value / 60) : 0
}

function configuredMinutes(seconds) {
  if (seconds === null || seconds === undefined || seconds === '') return null
  const value = Number(seconds)
  return Number.isFinite(value) ? Math.round(value / 60) : null
}

function hasConfiguredMinutes(value) {
  return Number.isFinite(value) && value > 0
}

function formatPolicyMinutes(value) {
  return hasConfiguredMinutes(value) ? `${value} 分钟` : '未配置'
}

function usagePercent(current, limit) {
  return hasConfiguredMinutes(limit) ? Math.min(100, Math.round((current / limit) * 100)) : 0
}

function usageTone(current, limit) {
  if (!hasConfiguredMinutes(limit)) return 'success'
  return current > limit ? 'danger' : current > limit * 0.8 ? 'warning' : 'success'
}

function stateKey(status) {
  return { forced_rest: 'over', reminder: 'warn', normal: 'ok' }[status] || 'idle'
}

export default function EyeCare() {
  const { workspace } = useConsole()
  const navigate = useNavigate()
  const { status, data, error, actionState, releaseFalsePositive } = usePrivacyEyeCareData({
    workspaceId: workspace?.id,
  })
  const rows = useMemo(() => (data?.students || []).map((student) => {
    const policy = student.enforcement?.policy || {}
    const limit = {
      daily: configuredMinutes(policy.dailySeconds),
      single: configuredMinutes(policy.forceRestSeconds),
      rest: configuredMinutes(policy.restSeconds),
    }
    const currentState = stateKey(student.enforcement?.status)
    const releasable = ['over', 'warn'].includes(currentState)
    const todayMinutes = minutes(student.dailyValidEyeSeconds)
    return {
      id: student.studentId,
      name: student.studentDisplayName || student.studentId,
      no: student.studentId,
      classId: student.classId || '未分班',
      className: student.classDisplayName || student.classId || '未分班',
      eyecare: {
        state: currentState,
        todayMinutes,
        longest: minutes(student.continuousEyeSeconds),
        rests: student.enforcement?.status === 'forced_rest' ? 1 : 0,
      },
      limit,
      percent: usagePercent(todayMinutes, limit.daily),
      overSingle: hasConfiguredMinutes(limit.single) && minutes(student.continuousEyeSeconds) >= limit.single,
      suspect: releasable ? '当前提醒或强制休息可由授权人员核验是否误判' : '',
      forcedRestUntil: student.enforcement?.forcedRestUntil || null,
    }
  }), [data?.students])
  const groups = useMemo(() => {
    const byClass = new Map()
    for (const row of rows) {
      if (!byClass.has(row.classId)) byClass.set(row.classId, [])
      byClass.get(row.classId).push(row)
    }
    return [...byClass.entries()].map(([id, classRows]) => {
      const limit = classRows[0]?.limit || { daily: null, single: null, rest: null }
      return {
        klass: { id, name: classRows[0]?.className || id },
        rows: classRows,
        limit,
        avg: classRows.length ? Math.round(classRows.reduce((sum, row) => sum + row.eyecare.todayMinutes, 0) / classRows.length) : 0,
        counts: STATE_ORDER.reduce((result, key) => ({ ...result, [key]: classRows.filter((row) => row.eyecare.state === key).length }), {}),
        suspects: classRows.filter((row) => row.suspect).length,
      }
    })
  }, [rows])

  const [keyword, setKeyword] = useState('')
  const [state, setState] = useState('all')
  const [classId, setClassId] = useState('all')
  const [onlySuspect, setOnlySuspect] = useState(false)
  const [picked, setPicked] = useState([])
  const [ask, setAsk] = useState(null)
  const [limitTarget, setLimitTarget] = useState(null)

  const list = useMemo(() => {
    const k = keyword.trim()
    return rows
      .filter((s) => {
        if (state !== 'all' && s.eyecare.state !== state) return false
        if (classId !== 'all' && s.classId !== classId) return false
        if (onlySuspect && !s.suspect) return false
        if (!k) return true
        return s.name.includes(k) || s.no.includes(k) || s.className.includes(k)
      })
      .sort((a, b) => STATE_ORDER.indexOf(a.eyecare.state) - STATE_ORDER.indexOf(b.eyecare.state))
  }, [rows, keyword, state, classId, onlySuspect])

  const counts = STATE_ORDER.reduce((m, k) => ({ ...m, [k]: rows.filter((s) => s.eyecare.state === k).length }), {})
  const suspectCount = rows.filter((s) => s.suspect).length
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const selectedEligible = rows.filter((row) => picked.includes(row.id) && row.suspect)
  const releaseTargets = ask?.many ? rows.filter((row) => picked.includes(row.id) && row.suspect) : [ask?.target].filter(Boolean)
  const confirmRelease = async () => {
    for (const target of releaseTargets) await releaseFalsePositive(target.id, '教师核验为护眼误判')
    setAsk(null)
    setPicked([])
  }

  return (
    <PagePanel
      title={`${workspace?.scopeLabel || '权限范围'} · 护眼管理`}
      desc="连续使用与每日累计来自真实阅读事件；解除误判会由服务端校验权限、记录原因并写入审计。"
      toolbar={
        <>
          <SearchBox value={keyword} onChange={setKeyword} placeholder="搜索学生、学号或班级" />
          <Select
            value={state}
            onChange={setState}
            options={[
              { value: 'all', label: '全部状态' },
              ...STATE_ORDER.map((k) => ({ value: k, label: EYE_STATE[k].label })),
            ]}
          />
          <Select
            value={classId}
            onChange={setClassId}
            options={[{ value: 'all', label: '全部班级' }, ...groups.map((g) => ({ value: g.klass.id, label: g.klass.name }))]}
            width="w-[150px]"
          />
        </>
      }
    >
      {status === 'loading' && <p className="mb-3 text-[12px] text-ink-500">正在读取真实护眼状态…</p>}
      {status === 'error' && <p role="alert" className="mb-3 text-[12px] text-danger-600">护眼数据加载失败：{error?.message || '服务端拒绝了这次请求。'}</p>}
      {/* 状态概览：四类人数 + 疑似误判，点一下就是筛选 */}
      <div className="flex items-center gap-2 flex-wrap mb-3.5">
        <Chip
          active={state === 'all' && !onlySuspect}
          count={rows.length}
          onClick={() => (setState('all'), setOnlySuspect(false))}
        >
          全部
        </Chip>
        {STATE_ORDER.map((k) => (
          <Chip
            key={k}
            active={state === k}
            count={counts[k]}
            disabled={counts[k] === 0}
            onClick={() => (setState(k), setOnlySuspect(false))}
          >
            {EYE_STATE[k].label}
          </Chip>
        ))}
        <span className="w-px h-5 bg-ink-200 mx-1" />
        <Chip active={onlySuspect} count={suspectCount} disabled={suspectCount === 0} onClick={() => setOnlySuspect((v) => !v)}>
          疑似误判
        </Chip>
      </div>

      {/* 班级概况 */}
      <SubHead icon="Eye" title={`班级用眼概况（${groups.length}）`} />
      {/* 1440 就能一行放三张，早先写成 2xl 导致第三张单独换行留大片空白 */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-4">
        {groups.map((g) => (
          <GlassCard key={g.klass.id} className="p-3.5 rounded-xl min-w-0">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setClassId(g.klass.id)}
                className="text-[13px] font-semibold text-ink-900 hover:text-brand-600 transition truncate"
              >
                {g.klass.name}
              </button>
              <div className="flex-1" />
              <IconBtn
                icon="SlidersHorizontal"
                title="查看限制策略"
                onClick={() => setLimitTarget({ scope: 'class', name: g.klass.name, limit: g.limit })}
              />
            </div>
            <p className="text-[11.5px] text-ink-500 mt-1">
              每日 {formatPolicyMinutes(g.limit.daily)} · 单次 {formatPolicyMinutes(g.limit.single)} · 强制休息 {formatPolicyMinutes(g.limit.rest)}
            </p>
            <div className="mt-2.5">
              <BarProgress
                value={usagePercent(g.avg, g.limit.daily)}
                label="今日平均用眼"
                tone={usageTone(g.avg, g.limit.daily)}
                hint={hasConfiguredMinutes(g.limit.daily)
                  ? `${g.avg} / ${g.limit.daily} 分钟（只统计今天用过的学生）`
                  : `${g.avg} 分钟（服务端未返回每日上限）`}
              />
            </div>
            <div className="mt-2.5 pt-2.5 border-t border-ink-150/70 flex items-center gap-2 flex-wrap">
              {STATE_ORDER.filter((k) => g.counts[k] > 0).map((k) => (
                <StatusTag key={k} tone={EYE_STATE[k].tone} dot>
                  {EYE_STATE[k].label} {g.counts[k]}
                </StatusTag>
              ))}
              {g.suspects > 0 && <StatusTag tone="accent">疑似误判 {g.suspects}</StatusTag>}
            </div>
          </GlassCard>
        ))}
      </div>

      {picked.length > 0 && (
        <div className="mb-3 flex items-center gap-2.5 h-10 px-3 rounded-lg bg-brand-50/80 border border-brand-100">
          <Icon name="CheckCheck" className="w-4 h-4 text-brand-600" strokeWidth={1.9} />
          <span className="text-[12.5px] text-brand-800">
            已选择 <span className="font-semibold tabular-nums">{picked.length}</span> 名学生
          </span>
          <div className="flex-1" />
          <Btn size="sm" icon="ScanEye" disabled={selectedEligible.length === 0} onClick={() => setAsk({ kind: 'clear', many: true })}>
            批量解除误判
          </Btn>
          <Btn
            size="sm"
            icon="SlidersHorizontal"
            onClick={() => setLimitTarget({ scope: 'many', name: `${picked.length} 名学生`, limit: rows[0].limit })}
          >
            查看限制策略
          </Btn>
          <Btn size="sm" tone="ghost" onClick={() => setPicked([])}>
            取消选择
          </Btn>
        </div>
      )}

      {/* 学生列表 */}
      <SubHead
        icon="Users"
        title={`学生用眼明细（${list.length}）`}
        extra={<span className="text-[11.5px] text-ink-400">点学生进入学生详情的护眼区，不另开一套详情</span>}
      />
      {list.length === 0 ? (
        <EmptyState
          icon="Eye"
          title="没有符合条件的学生"
          desc="清掉上面的筛选条件，或换一个关键词。"
          action={
            <Btn
              tone="primary"
              onClick={() => {
                setState('all')
                setClassId('all')
                setOnlySuspect(false)
                setKeyword('')
              }}
            >
              清空筛选
            </Btn>
          }
        />
      ) : (
        <div className="rounded-xl border border-ink-150 overflow-hidden bg-white/60">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-ink-50/70 text-[11.5px] text-ink-500">
                <th className="px-3 py-2.5 font-medium w-[34px]" />
                <th className="px-2 py-2.5 font-medium">学生</th>
                <th className="px-2 py-2.5 font-medium w-[136px]">班级</th>
                <th className="px-2 py-2.5 font-medium w-[178px]">今日累计 / 上限</th>
                <th className="px-2 py-2.5 font-medium w-[112px]">最长连续</th>
                <th className="px-2 py-2.5 font-medium w-[84px]">休息</th>
                <th className="px-2 py-2.5 font-medium w-[106px]">状态</th>
                <th className="px-2 py-2.5 font-medium w-[124px] text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const st = EYE_STATE[s.eyecare.state]
                return (
                  <tr key={s.id} className="border-t border-ink-150/70 hover:bg-white/70 transition">
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={picked.includes(s.id)}
                        aria-label={`选择 ${s.name}`}
                        onClick={() => toggle(s.id)}
                        className={cx(
                          'w-4 h-4 rounded-[5px] border flex items-center justify-center transition',
                          picked.includes(s.id)
                            ? 'bg-brand-500 border-brand-500 text-white'
                            : 'bg-white/80 border-ink-300 hover:border-brand-300',
                        )}
                      >
                        {picked.includes(s.id) && <Icon name="Check" className="w-3 h-3" strokeWidth={3} />}
                      </button>
                    </td>
                    <td className="px-2 py-2.5">
                      <button
                        type="button"
                        onClick={() => navigate(`/console/accounts/students/${s.id}?section=eye-care`)}
                        className="text-[13px] font-medium text-ink-900 hover:text-brand-600 transition"
                      >
                        {s.name}
                      </button>
                      {s.suspect && (
                        <span
                          title={s.suspect}
                          className="ml-2 inline-flex items-center gap-1 text-[10.5px] text-accent-700 bg-accent-50 border border-accent-100 rounded-full px-1.5 h-[18px]"
                        >
                          <Icon name="ScanEye" className="w-3 h-3" strokeWidth={2} />
                          疑似误判
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-[12.5px] text-ink-700">{s.className}</td>
                    <td className="px-2 py-2.5">
                      <BarProgress
                        value={Math.min(100, s.percent)}
                        size="sm"
                        showValue={false}
                        tone={s.eyecare.state === 'over' ? 'danger' : s.eyecare.state === 'warn' ? 'warning' : 'success'}
                      />
                      <span className="text-[11px] text-ink-500 tabular-nums">
                        {s.eyecare.todayMinutes} 分钟 / {formatPolicyMinutes(s.limit.daily)}
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      <span
                        className={cx(
                          'text-[12.5px] tabular-nums',
                          s.overSingle ? 'text-danger-600 font-semibold' : 'text-ink-700',
                        )}
                      >
                        {s.eyecare.longest} 分钟
                      </span>
                      {s.overSingle && <p className="text-[10.5px] text-ink-400">超过单次 {formatPolicyMinutes(s.limit.single)}</p>}
                    </td>
                    <td className="px-2 py-2.5 text-[12.5px] text-ink-700 tabular-nums">{s.eyecare.rests} 次</td>
                    <td className="px-2 py-2.5">
                      <StatusTag tone={st.tone} dot>
                        {st.label}
                      </StatusTag>
                    </td>
                    <td className="px-2 py-2.5 text-right whitespace-nowrap">
                      <IconBtn
                        icon="ScanEye"
                        title={s.suspect ? '解除误判' : '没有待解除的误判'}
                        disabled={!s.suspect}
                        onClick={() => setAsk({ kind: 'clear', target: s })}
                      />
                      <IconBtn
                        icon="SlidersHorizontal"
                        title="查看限制策略"
                        onClick={() => setLimitTarget({ scope: 'student', name: s.name, limit: s.limit })}
                      />
                      <IconBtn
                        icon="ArrowRight"
                        title="进入学生详情的护眼区"
                        onClick={() => navigate(`/console/accounts/students/${s.id}?section=eye-care`)}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 操作记录 */}
      <div className="mt-4">
        <SubHead
          icon="History"
          title="最近的解除与调整"
          extra={<span className="text-[11.5px] text-ink-400">自动记录操作者、时间、对象与修改前后状态</span>}
        />
        <div className="rounded-xl border border-ink-150 overflow-hidden bg-white/60">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-ink-50/70 text-[11.5px] text-ink-500">
                <th className="px-3 py-2.5 font-medium w-[126px]">时间</th>
                <th className="px-2 py-2.5 font-medium w-[104px]">操作者</th>
                <th className="px-2 py-2.5 font-medium w-[136px]">对象</th>
                <th className="px-2 py-2.5 font-medium w-[112px]">动作</th>
                <th className="px-2 py-2.5 font-medium">修改前 → 修改后</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-ink-150/70">
                <td className="px-3 py-2.5 text-[12px] text-ink-500">—</td>
                <td className="px-2 py-2.5 text-[12.5px] text-ink-700">—</td>
                <td className="px-2 py-2.5 text-[12.5px] text-ink-700">—</td>
                <td className="px-2 py-2.5"><StatusTag tone="muted">暂无记录</StatusTag></td>
                <td className="px-2 py-2.5 text-[12px] text-ink-600">当前接口未返回护眼审计明细，真实解除操作仍会写入服务端审计。</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmModal
        open={!!ask}
        onClose={() => setAsk(null)}
        onConfirm={confirmRelease}
        tone="primary"
        confirmText="解除误判"
        title={ask?.many ? `解除 ${picked.length} 名学生的误判` : `解除 ${ask?.target?.name} 的用眼误判`}
        desc={
          ask?.target?.suspect
            ? `判定依据：${ask.target.suspect}。确认后调用真实服务端解除接口，并写入操作者、对象、原因与时间。`
            : '确认后只解除当前确实处于提醒或强制休息状态的学生，并由服务端记录审计。'
        }
      />

      {actionState.status === 'error' && <p role="alert" className="mt-3 text-[12px] text-danger-600">解除误判失败：{actionState.error?.message || '服务端拒绝了这次操作。'}</p>}

      <LimitModal target={limitTarget} onClose={() => setLimitTarget(null)} />
    </PagePanel>
  )
}

// 当前只读展示服务端策略；调整接口开放前不能把本地控件当成保存操作
function LimitModal({ target, onClose }) {
  const open = !!target
  const policies = [
    { label: '每日上限', value: target?.limit?.daily },
    { label: '单次上限', value: target?.limit?.single },
    { label: '强制休息', value: target?.limit?.rest },
  ]

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon="SlidersHorizontal"
      title={target ? `查看 ${target.name} 的用眼限制` : ''}
      desc="当前后端尚未开放策略调整写接口，本弹窗只展示服务端返回的现行策略，不会伪造保存成功。"
      width="max-w-[520px]"
      footer={
        <Btn onClick={onClose}>关闭</Btn>
      }
    >
      <div className="space-y-3.5">
        {policies.map((policy) => (
          <div key={policy.label} className="flex items-center gap-3">
            <span className="text-[12.5px] text-ink-600 w-[132px] shrink-0">{policy.label}</span>
            <span className="flex-1 h-px bg-ink-150" aria-hidden="true" />
            <span className="text-[13px] font-semibold text-ink-800 tabular-nums text-right">{formatPolicyMinutes(policy.value)}</span>
          </div>
        ))}
      </div>
      <p className="text-[11.5px] text-ink-400 mt-3.5 leading-relaxed">
        需要调整时应由后端新增正式策略接口并记录操作者、对象、旧值与新值；当前页面仅展示服务端返回的真实策略。
      </p>
    </Modal>
  )
}
