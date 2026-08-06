// 护眼管理。学生的用眼数据本来就在 classes.js 的 eyecare 字段里，
// 这里只补护眼页需要的东西：疑似误判标记、班级限制配置、调整记录。
// 学生详情不另做一套 —— 点学生跳 accounts/students/:id?section=eye-care。

import { CLASSES, STUDENTS, getClasses } from './classes.js'

export const EYE_STATE = {
  ok: { label: '正常', tone: 'success', desc: '未接近上限' },
  warn: { label: '接近上限', tone: 'warning', desc: '今日累计接近每日上限' },
  over: { label: '已超时', tone: 'danger', desc: '超过每日上限，已提示休息' },
  idle: { label: '今日未使用', tone: 'muted', desc: '今天没有阅读记录' },
}

// 疑似误判：设备一直亮着但人没在看，学生或教师可以申请解除
export const SUSPECT = {
  's-3105': '连续 52 分钟无翻页与无点击，疑似离开设备但未息屏',
  's-6102': '同一页停留 41 分钟，期间无任何交互',
}

// 限制配置按班级走，年级越高上限越宽
export const EYE_LIMITS = {
  'c3-1': { daily: 60, single: 25, rest: 10 },
  'c3-2': { daily: 60, single: 25, rest: 10 },
  'c3-3': { daily: 60, single: 20, rest: 10 },
  'c6-1': { daily: 90, single: 35, rest: 10 },
  'c6-2': { daily: 90, single: 35, rest: 10 },
  'c6-3': { daily: 90, single: 30, rest: 15 },
  'c6-4': { daily: 90, single: 30, rest: 15 },
}

const DEFAULT_LIMIT = { daily: 60, single: 25, rest: 10 }

export function getEyeLimit(classId) {
  return EYE_LIMITS[classId] || DEFAULT_LIMIT
}

// 调整记录：普通操作不要求填原因，但操作者、时间、对象与修改前后状态必须留下
export const EYE_LOG = [
  {
    id: 'el-1',
    at: '今天 16:20',
    operator: '林老师',
    target: '赵星禾',
    action: '解除误判',
    before: '已超时 88 分钟',
    after: '按 46 分钟重新计算',
  },
  {
    id: 'el-2',
    at: '今天 09:05',
    operator: '林老师',
    target: '三年级（3）班',
    action: '调整限制',
    before: '单次 25 分钟',
    after: '单次 20 分钟',
  },
  {
    id: 'el-3',
    at: '昨天 20:40',
    operator: '陈老师',
    target: '沈屿',
    action: '调整限制',
    before: '每日 90 分钟',
    after: '每日 75 分钟',
  },
  {
    id: 'el-4',
    at: '8月2日 18:12',
    operator: '系统',
    target: '李知远',
    action: '自动提示休息',
    before: '连续 41 分钟',
    after: '强制休息 10 分钟',
  },
]

export function getEyeRows(workspaceId) {
  const classIds = getClasses(workspaceId).map((c) => c.id)
  return STUDENTS.filter((s) => classIds.includes(s.classId)).map((s) => {
    const limit = getEyeLimit(s.classId)
    return {
      ...s,
      className: CLASSES.find((c) => c.id === s.classId)?.name || '未分班',
      limit,
      percent: Math.min(200, Math.round((s.eyecare.todayMinutes / limit.daily) * 100)),
      overSingle: s.eyecare.longest > limit.single,
      suspect: SUSPECT[s.id] || null,
    }
  })
}

// 班级概况：每班一张卡，给出四类人数与平均用眼
export function getEyeClasses(workspaceId) {
  const rows = getEyeRows(workspaceId)
  return getClasses(workspaceId).map((c) => {
    const mine = rows.filter((s) => s.classId === c.id)
    const used = mine.filter((s) => s.eyecare.state !== 'idle')
    const avg = used.length
      ? Math.round(used.reduce((n, s) => n + s.eyecare.todayMinutes, 0) / used.length)
      : 0
    return {
      klass: c,
      limit: getEyeLimit(c.id),
      total: mine.length,
      avg,
      counts: {
        ok: mine.filter((s) => s.eyecare.state === 'ok').length,
        warn: mine.filter((s) => s.eyecare.state === 'warn').length,
        over: mine.filter((s) => s.eyecare.state === 'over').length,
        idle: mine.filter((s) => s.eyecare.state === 'idle').length,
      },
      suspects: mine.filter((s) => s.suspect).length,
    }
  })
}
