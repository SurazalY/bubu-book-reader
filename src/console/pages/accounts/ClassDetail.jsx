import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { cx, Icon } from '../../../components/ui.jsx'
import { GlassCard } from '../../components/Glass.jsx'
import { PagePanel } from '../../components/PagePanel.jsx'
import { Btn, EmptyState, Field, IconBtn, SearchBox, StatusTag, SubHead } from '../../components/Controls.jsx'
import { ConfirmModal } from '../../components/Overlay.jsx'
import { BarProgress } from '../../components/Progress.jsx'
import { useConsole } from '../../state/ConsoleContext.jsx'
import { getClass, getClasses, getStudents } from '../../data/fixtures/classes.js'
import { getArrangements } from '../../data/fixtures/arrangements.js'

// 班级详情（母版做法）：左上一个班级图标，右侧是资料，下面一行操作，
// 再往下才是学生列表。学生行点进去是学生详情，不在这里塞第二层表格。

const ICON_TONE = {
  brand: 'bg-brand-50 text-brand-600',
  cyan: 'bg-[#E4F5F2] text-[#2E8C86]',
  violet: 'bg-[#F0ECFB] text-[#7C6BD8]',
  accent: 'bg-accent-50 text-accent-600',
  muted: 'bg-ink-100 text-ink-500',
}

const EYE_STATE = {
  ok: { label: '正常', tone: 'success' },
  warn: { label: '接近上限', tone: 'warning' },
  over: { label: '已超时', tone: 'danger' },
  idle: { label: '今日未使用', tone: 'muted' },
}

export default function ClassDetail() {
  const { classId } = useParams()
  const { workspace, canAccessPath } = useConsole()
  const navigate = useNavigate()
  const found = getClass(classId)
  // 数据范围校验（Plan_2 P1）：能进这个页面不等于能看任意班级。
  // 教研组敲 URL 看三年级班级要被拦，写法对齐学生详情。
  const inScope = found ? getClasses(workspace.id).some((c) => c.id === found.id) : false
  const data = inScope ? found : null
  // 校长／书记没有班级列表入口，退路改成班级学生总览，不能把人送回被拦的路由
  const backPath = canAccessPath('/console/accounts/classes')
    ? '/console/accounts/classes'
    : '/console/classes/overview'
  const backLabel = backPath === '/console/accounts/classes' ? '回到班级列表' : '回到班级学生总览'
  const students = useMemo(() => getStudents(classId), [classId])
  const plans = useMemo(
    () => getArrangements(workspace.id).filter((a) => a.classIds.includes(classId)),
    [workspace.id, classId],
  )
  const [keyword, setKeyword] = useState('')
  const [confirm, setConfirm] = useState(null)

  if (!data) {
    return (
      <PagePanel
        title={found ? '这个班级不在你的数据范围内' : '班级不存在'}
        desc={
          found
            ? `${workspace.scopeLabel}只能看到自己范围内的班级；如需查看请切换到对应的工作空间。`
            : '这个班级可能已被删除。'
        }
      >
        <EmptyState
          icon={found ? 'ShieldX' : 'SearchX'}
          title={found ? '无权查看这个班级' : '找不到这个班级'}
          desc={
            found
              ? '班级资料、学生名单与阅读数据只对授权范围开放；直接打开链接也不会绕过这个限制。'
              : '请重新选择一个班级；班级删除后学生账号仍在，可以在组织账号里查。'
          }
          action={
            <Btn tone="primary" icon="ArrowLeft" onClick={() => navigate(backPath)}>
              {backLabel}
            </Btn>
          }
        />
      </PagePanel>
    )
  }

  const rows = students.filter((s) => !keyword.trim() || s.name.includes(keyword) || s.no.includes(keyword))
  const removed = data.status !== 'active'
  // 操作行里的跳转先问权限：教研组能进班级详情，却没有护眼与家长发送叶子（Plan_2 P1 同类死入口）
  const canEyeCare = canAccessPath('/console/classes/eyecare')
  const canParentSend = canAccessPath('/console/reports/parents')
  const canArrange = canAccessPath('/console/teaching/arrangements')

  return (
    <PagePanel
      title={`${data.name} · 班级详情`}
      desc={`${data.grade} · ${data.subject} · 班主任 ${data.headTeacher} · 建于 ${data.createdAt}`}
      toolbar={
        <Btn icon="ArrowLeft" onClick={() => navigate(backPath)}>
          {backPath === '/console/accounts/classes' ? '返回列表' : '返回总览'}
        </Btn>
      }
    >
      {/* 资料区：左图标 + 右资料两列 */}
      <div className="flex items-start gap-4">
        <span
          className={cx(
            'w-[76px] h-[76px] rounded-2xl flex items-center justify-center shrink-0 shadow-e1',
            ICON_TONE[data.tone],
          )}
        >
          <Icon name={data.icon} className="w-8 h-8" strokeWidth={1.7} />
        </span>

        <div className="min-w-0 flex-1 grid grid-cols-1 lg:grid-cols-2 gap-x-8">
          <div>
            <Field label="班级名称">
              <span className="font-medium">{data.name}</span>
              <StatusTag tone={removed ? 'muted' : 'success'} dot className="ml-2">
                {removed ? '已删除' : '进行中'}
              </StatusTag>
            </Field>
            <Field label="任教教师">{data.teachers.join('、')}</Field>
            <Field label="学生人数">
              <span className="tabular-nums">
                {data.active} 人在读 / 共 {data.students} 人
              </span>
            </Field>
          </div>
          <div>
            <Field label="班级说明">{data.note}</Field>
            {removed && <Field label="删除时间">{data.deletedAt}</Field>}
            <Field label="数据范围">
              本班学生的阅读、用量、社区与报告数据；跨班数据需要更高一级工作空间
            </Field>
          </div>
        </div>
      </div>

      {/* 操作行 */}
      <div className="mt-4 pt-3.5 border-t border-ink-150/70 flex items-center gap-2 flex-wrap">
        {canArrange && (
          <Btn tone="primary" icon="CalendarPlus" onClick={() => navigate('/console/teaching/arrangements')}>
            新建阅读安排
          </Btn>
        )}
        <Btn icon="UserPlus" onClick={() => setConfirm('add')}>
          添加学生
        </Btn>
        {canParentSend && (
          <Btn icon="Send" onClick={() => navigate('/console/reports/parents')}>
            发送班级报告
          </Btn>
        )}
        {canEyeCare && (
          <Btn icon="Eye" onClick={() => navigate('/console/classes/eyecare')}>
            护眼管理
          </Btn>
        )}
        <div className="flex-1" />
        {removed ? (
          <Btn icon="RotateCcw" onClick={() => setConfirm('restore')}>
            恢复班级
          </Btn>
        ) : (
          <Btn tone="danger" icon="Trash2" onClick={() => setConfirm('delete')}>
            删除班级
          </Btn>
        )}
      </div>

      {/* 三条进度 + 关联安排 */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        <GlassCard className="p-3.5 lg:col-span-1">
          <SubHead icon="Gauge" title="班级整体" />
          <div className="space-y-2.5">
            <BarProgress label="阅读进度" value={data.progress.reading} size="sm" />
            <BarProgress label="额度使用" value={data.progress.quota} tone="warning" size="sm" />
            <BarProgress label="报告完成" value={data.progress.report} tone="success" size="sm" />
          </div>
        </GlassCard>

        <GlassCard className="p-3.5 lg:col-span-2">
          <SubHead
            icon="CalendarDays"
            title="本班阅读安排"
            extra={
              <button
                type="button"
                onClick={() => navigate('/console/teaching/arrangements')}
                className="text-[11.5px] text-ink-400 hover:text-brand-600 transition inline-flex items-center gap-0.5"
              >
                全部安排
                <Icon name="ChevronRight" className="w-3 h-3" />
              </button>
            }
          />
          {plans.length === 0 ? (
            <p className="text-[12.5px] text-ink-500 py-3">这个班当前没有阅读安排，可以从上面的「新建阅读安排」开始。</p>
          ) : (
            <ul className="space-y-2">
              {plans.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/console/teaching/arrangements/${p.id}`)}
                    className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-white/70 transition text-left"
                  >
                    <span className="font-serif text-[13px] font-semibold text-ink-900 truncate max-w-[180px]">
                      {p.title}
                    </span>
                    <span className="text-[12px] text-ink-600 shrink-0">{p.chapter}</span>
                    <div className="flex-1 min-w-[80px]">
                      <BarProgress value={p.progress} showValue={false} size="sm" />
                    </div>
                    <span className="text-[11.5px] text-ink-700 font-medium tabular-nums shrink-0 w-9 text-right">
                      {p.progress}%
                    </span>
                    <span className="text-[11.5px] text-ink-500 tabular-nums shrink-0 w-[78px] text-right">
                      {p.start.slice(5)} 起
                    </span>
                    <Icon name="ChevronRight" className="w-4 h-4 text-ink-300 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      </div>

      {/* 学生列表 */}
      <div className="mt-4">
        <div className="flex items-center gap-3 mb-2.5">
          {/* 演示数据只造了几名学生，标题要写清楚，别和资料区「共 32 人」自相矛盾 */}
          <SubHead
            icon="Users"
            title={`学生列表（演示数据 ${students.length} 名 / 共 ${data.students} 人）`}
            className="mb-0"
          />
          <div className="flex-1" />
          <SearchBox value={keyword} onChange={setKeyword} placeholder="搜索姓名或学号" width="w-[180px]" />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon="UserSearch"
            title="没有匹配的学生"
            desc="换个关键词试试；学生账号由班级关系派生，不能脱离班级单独存在。"
          />
        ) : (
          <div className="rounded-xl border border-ink-150 overflow-hidden bg-white/60">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-ink-50/70 text-[11.5px] text-ink-500">
                  <th className="px-3 py-2.5 font-medium">学生</th>
                  <th className="px-2 py-2.5 font-medium w-[118px]">学号</th>
                  <th className="px-2 py-2.5 font-medium w-[104px]">本周阅读</th>
                  <th className="px-2 py-2.5 font-medium w-[132px]">额度使用</th>
                  <th className="px-2 py-2.5 font-medium w-[100px]">护眼状态</th>
                  <th className="px-2 py-2.5 font-medium w-[92px]">最近活动</th>
                  <th className="px-2 py-2.5 font-medium w-[64px] text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const eye = EYE_STATE[s.eyecare.state]
                  const quotaPercent = Math.round((s.quota.used / s.quota.total) * 100)
                  return (
                    <tr key={s.id} className="border-t border-ink-150/70 hover:bg-white/70 transition">
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => navigate(`/console/accounts/students/${s.id}`)}
                          className="flex items-center gap-2.5 group text-left"
                        >
                          <span className="console-avatar w-7 h-7 rounded-full flex items-center justify-center text-[11.5px] font-semibold text-white shrink-0">
                            {s.name.slice(0, 1)}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13px] font-medium text-ink-900 group-hover:text-brand-700 transition">
                              {s.name}
                            </span>
                            <span className="block text-[11px] text-ink-400">
                              {s.gender} · {s.status === 'active' ? '在读' : '已暂停'}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="px-2 py-2.5 text-[12px] text-ink-600 tabular-nums">{s.no}</td>
                      <td className="px-2 py-2.5 text-[12.5px] text-ink-700 tabular-nums">{s.reading.minutes} 分钟</td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <BarProgress
                              value={quotaPercent}
                              showValue={false}
                              size="sm"
                              tone={quotaPercent >= 90 ? 'danger' : quotaPercent >= 70 ? 'warning' : 'brand'}
                            />
                          </div>
                          <span className="text-[11px] text-ink-500 tabular-nums shrink-0">
                            {s.quota.used}/{s.quota.total}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5">
                        <StatusTag tone={eye.tone} dot>
                          {eye.label}
                        </StatusTag>
                      </td>
                      <td className="px-2 py-2.5 text-[11.5px] text-ink-500">{s.reading.lastAt}</td>
                      <td className="px-2 py-2.5 text-right">
                        <IconBtn
                          icon="ChevronRight"
                          title="查看学生详情"
                          onClick={() => navigate(`/console/accounts/students/${s.id}`)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => setConfirm(null)}
        title={confirm === 'delete' ? '删除班级' : confirm === 'restore' ? '恢复班级' : '添加学生'}
        desc={
          confirm === 'delete'
            ? `删除的是 ${data.name} 的班级关系：不再出现在进行中列表，也不能再建新的阅读安排；学生账号不停用，可以转到其他班级，已有阅读记录与报告保留，之后可以恢复。演示环境不会真正删除。`
            : confirm === 'restore'
              ? `${data.name} 恢复后班级关系重新生效；学生账号、历史阅读记录与报告本来就没动过。演示环境不会真正恢复。`
              : '真实环境支持单个添加与名单批量导入，导入前会先校验学号重复。演示环境不写入数据。'
        }
        confirmText={confirm === 'delete' ? '删除' : '知道了'}
        tone={confirm === 'delete' ? 'danger' : 'primary'}
      />
    </PagePanel>
  )
}
