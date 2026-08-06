// 用量与额度数据。学生名单、额度基数、护眼状态一律从 classes.js 取，
// 这里只补「用量页才需要」的东西：重置时间、AI 状态、触限历史、额度调整记录、
// 范围分布与异常提醒。绝不在这里复制一份学生资料，否则两处会慢慢不一致。

import { CLASSES, STUDENTS, getClasses } from './classes.js'

// 演示阈值：页面上必须写明是演示值，不是产品结论
export const DEMO_THRESHOLDS = {
  nearPercent: 85, // 已用 ≥85% 算「即将耗尽」
  growthPercent: 60, // 周环比 ≥+60% 算「异常增长」
}

export const QUOTA_STATE = {
  normal: { label: '正常', tone: 'success', desc: '额度充足，AI 可用' },
  near: { label: '即将耗尽', tone: 'warning', desc: `已用超过 ${DEMO_THRESHOLDS.nearPercent}%` },
  over: { label: '已触限', tone: 'danger', desc: '额度用尽，AI 已停用到下次重置' },
  paused: { label: '已暂停', tone: 'muted', desc: '教师手动暂停，可随时恢复' },
}

// 只放用量页额外需要的字段；没列到的学生走默认值
const QUOTA_EXTRA = {
  's-3101': { resetAt: '6 天 15 小时后', growth: 12, weekCalls: 34, paused: false },
  's-3102': { resetAt: '6 天 15 小时后', growth: 74, weekCalls: 61, paused: false },
  's-3103': { resetAt: '6 天 15 小时后', growth: -8, weekCalls: 19, paused: false },
  's-3104': { resetAt: '6 天 15 小时后', growth: 0, weekCalls: 5, paused: false },
  's-3105': { resetAt: '6 天 15 小时后', growth: 96, weekCalls: 72, paused: false },
  's-3106': { resetAt: '6 天 15 小时后', growth: 21, weekCalls: 28, paused: false },
  's-3201': { resetAt: '6 天 15 小时后', growth: 33, weekCalls: 41, paused: false },
  's-3202': { resetAt: '6 天 15 小时后', growth: 4, weekCalls: 9, paused: true },
  's-3301': { resetAt: '6 天 15 小时后', growth: 68, weekCalls: 55, paused: false },
  's-6101': { resetAt: '4 天 3 小时后', growth: 18, weekCalls: 88, paused: false },
  's-6102': { resetAt: '4 天 3 小时后', growth: 81, weekCalls: 113, paused: false },
  's-6201': { resetAt: '4 天 3 小时后', growth: 26, weekCalls: 67, paused: false },
  's-6301': { resetAt: '4 天 3 小时后', growth: -12, weekCalls: 44, paused: false },
}

const DEFAULT_EXTRA = { resetAt: '本周结束后', growth: 0, weekCalls: 0, paused: false }

export function quotaPercent(student) {
  const { used, total } = student.quota
  return total ? Math.round((used / total) * 100) : 0
}

export function quotaStateOf(student) {
  const extra = QUOTA_EXTRA[student.id] || DEFAULT_EXTRA
  if (extra.paused) return 'paused'
  const pct = quotaPercent(student)
  if (pct >= 100) return 'over'
  if (pct >= DEMO_THRESHOLDS.nearPercent) return 'near'
  return 'normal'
}

// 额度页用的学生行：学生资料 + 班级名 + 派生状态
export function getQuotaStudents(workspaceId) {
  const classIds = getClasses(workspaceId).map((c) => c.id)
  return STUDENTS.filter((s) => classIds.includes(s.classId)).map((s) => {
    const extra = QUOTA_EXTRA[s.id] || DEFAULT_EXTRA
    return {
      ...s,
      className: CLASSES.find((c) => c.id === s.classId)?.name || '未分班',
      percent: quotaPercent(s),
      state: quotaStateOf(s),
      resetAt: extra.resetAt,
      growth: extra.growth,
      weekCalls: extra.weekCalls,
    }
  })
}

// 触限历史与调整记录：详情侧栏用，写死几条有代表性的
export const QUOTA_HISTORY = {
  's-3105': [
    { at: '今天 16:02', text: '本周额度用尽，AI 自动停用', tone: 'danger' },
    { at: '8月2日 20:14', text: '当日提问 26 次，接近上限', tone: 'warning' },
    { at: '7月29日 15:40', text: '林老师把本周上限从 100 调到 120', tone: 'brand' },
  ],
  's-6102': [
    { at: '今天 11:02', text: '本周额度用尽，AI 自动停用', tone: 'danger' },
    { at: '8月1日 09:20', text: '陈老师恢复 AI 使用', tone: 'brand' },
    { at: '7月30日 21:05', text: '连续用眼超时，AI 暂停 1 天', tone: 'warning' },
  ],
  's-3202': [
    { at: '8月3日 10:12', text: '林老师手动暂停 AI，原因记录在班级备注', tone: 'muted' },
  ],
}

export function getQuotaHistory(studentId) {
  return QUOTA_HISTORY[studentId] || [{ at: '本周', text: '暂无触限与调整记录', tone: 'muted' }]
}

// ── 用量概览 ─────────────────────────────────────────────
// 按「总量 → 趋势 → 范围分布 → 异常」组织，普通教师只看自己的班，
// 运营额外拿到 Token、延迟与实际费用。

const TREND = {
  day: {
    labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00'],
    data: [2, 1, 18, 46, 71, 39, 6],
  },
  week: {
    labels: ['7/29', '7/30', '7/31', '8/1', '8/2', '8/3', '8/4'],
    data: [96, 112, 104, 58, 121, 138, 147],
  },
  month: {
    labels: ['3月', '4月', '5月', '6月', '7月', '8月'],
    data: [1420, 1680, 1910, 2240, 2680, 2960],
  },
}

// 运营口径的趋势换成请求量级，避免把「次」和「请求」混成一张图
const TREND_OPS = {
  day: { labels: TREND.day.labels, data: [140, 96, 880, 2160, 3120, 1740, 320] },
  week: { labels: TREND.week.labels, data: [7100, 7620, 7280, 4180, 8460, 9120, 9740] },
  month: { labels: TREND.month.labels, data: [96000, 112000, 128000, 151000, 178000, 196000] },
}

// 分布用同一族的蓝青深浅，不用紫色 —— 紫色已经被「私密会话」占了语义
const DIST_COLORS = ['#3B66F5', '#2FB6A8', '#5B8DEF', '#7BC5BC', '#8FA6E8', '#A9CFC9']

// 运营口径的分布按学校，与学生级数据不同量级，继续用合成值
const OPS_DISTRIBUTION = [
  { key: 'peixin', label: '培新小学', value: 2380 },
  { key: 'chunfeng', label: '春风中学', value: 1960 },
  { key: 'wenhui', label: '文汇实验小学', value: 1420 },
  { key: 'nanhu', label: '南湖二小', value: 1105 },
  { key: 'other', label: '其余 8 所', value: 2870 },
]

// 范围分布必须和 KPI 对得上：班级／年级空间按班聚合，校级按年级聚合，
// 全部从同一批学生的 weekCalls 算出来，不再写两套合成数字（否则总数对不上）。
function distributionOf(workspaceId, rows) {
  if (workspaceId === 'platform-ops') return OPS_DISTRIBUTION
  const classes = getClasses(workspaceId)
  const sum = (list) => list.reduce((n, s) => n + s.weekCalls, 0)

  if (workspaceId === 'school-admin') {
    // 只列出演示数据里真实存在学生的年级，不造零值条
    const grades = Array.from(new Set(classes.map((c) => c.grade)))
    return grades
      .map((g) => {
        const ids = classes.filter((c) => c.grade === g).map((c) => c.id)
        return { key: `g-${g}`, label: g, value: sum(rows.filter((s) => ids.includes(s.classId))) }
      })
      .filter((d) => d.value > 0)
  }

  return classes
    .map((c) => ({ key: c.id, label: c.name, value: sum(rows.filter((s) => s.classId === c.id)) }))
    .filter((d) => d.value > 0)
}

function kpisOf(workspaceId, rows) {
  const limited = rows.filter((s) => s.state === 'over').length
  const near = rows.filter((s) => s.state === 'near').length
  const calls = rows.reduce((n, s) => n + s.weekCalls, 0)
  const people = rows.length || 1

  if (workspaceId === 'platform-ops') {
    return [
      { key: 'req', label: '本周请求', value: '9.74', unit: '万次', note: '较上周 +6.8%', tone: 'brand' },
      { key: 'token', label: '输入 / 输出 Token', value: '2.4 / 1.1', unit: '亿', note: '缓存命中 38%', tone: 'violet' },
      { key: 'cost', label: '本周实际费用', value: '￥4,182', unit: '', note: '预算用量 61%', tone: 'accent' },
      { key: 'fail', label: '失败率', value: '0.42', unit: '%', note: 'P95 延迟 2.4 秒', tone: 'cyan' },
    ]
  }
  return [
    { key: 'calls', label: '本周使用次数', value: String(calls), unit: '次', note: '较上周 +9.4%', tone: 'brand' },
    { key: 'limited', label: '已触限人数', value: String(limited), unit: '人', note: '额度用尽后 AI 自动停用', tone: 'accent' },
    { key: 'near', label: '即将耗尽', value: String(near), unit: '人', note: `已用 ≥${DEMO_THRESHOLDS.nearPercent}%`, tone: 'violet' },
    {
      key: 'avg',
      label: '人均使用次数',
      value: (calls / people).toFixed(1),
      unit: '次',
      note: `覆盖 ${people} 名有记录的学生`,
      tone: 'cyan',
    },
  ]
}

export function getUsageOverview(workspaceId) {
  const rows = getQuotaStudents(workspaceId)
  const isOps = workspaceId === 'platform-ops'
  // 每段分布都带下钻地址：班级按 classId，年级按 grade，学校按名称
  const dist = distributionOf(workspaceId, rows).map((d, i) => ({
    ...d,
    color: DIST_COLORS[i % DIST_COLORS.length],
    to: d.key.startsWith('c-') || /^c\d/.test(d.key)
      ? `/console/usage/quota?class=${d.key}`
      : d.key.startsWith('g-')
        ? `/console/usage/quota?grade=${encodeURIComponent(d.label)}`
        : `/console/usage/quota?school=${encodeURIComponent(d.label)}`,
  }))
  const near = rows.filter((s) => s.state === 'near')
  const over = rows.filter((s) => s.state === 'over')
  const growth = rows.filter((s) => s.growth >= DEMO_THRESHOLDS.growthPercent)

  const anomalies = [
    {
      key: 'over',
      icon: 'BatteryWarning',
      tone: 'danger',
      title: `${over.length} 人额度已用尽`,
      desc:
        over.length > 0
          ? `${over.map((s) => s.name).join('、')} 的 AI 已停用，等待下次重置或教师提额。`
          : '本范围内暂时没有触限的学生。',
      to: '/console/usage/quota?state=over',
      actionLabel: '查看这些学生',
    },
    {
      key: 'near',
      icon: 'TrendingUp',
      tone: 'warning',
      title: `${near.length} 人额度即将耗尽`,
      desc: `已用比例超过演示阈值 ${DEMO_THRESHOLDS.nearPercent}%，建议先看是不是同一本书集中提问。`,
      to: '/console/usage/quota?state=near',
      actionLabel: '查看这些学生',
    },
    {
      key: 'growth',
      icon: 'ChartNoAxesColumnIncreasing',
      tone: 'accent',
      title: `${growth.length} 人用量异常增长`,
      desc: `周环比涨幅超过演示阈值 +${DEMO_THRESHOLDS.growthPercent}%，可能是新安排刚开始，也可能是重复提问。`,
      to: '/console/usage/quota?state=growth',
      actionLabel: '查看这些学生',
    },
    isOps
      ? {
          key: 'fail',
          icon: 'ServerCrash',
          tone: 'muted',
          title: '模型调用失败 41 次',
          desc: '集中在 08:20—08:40 的一次供应商抖动，已自动重试成功 37 次。',
          to: '/console/usage/models',
          actionLabel: '去模型与成本',
        }
      : {
          key: 'fail',
          icon: 'ServerCrash',
          tone: 'muted',
          title: '模型调用失败 3 次',
          desc: '已自动重试成功，学生端无需重新提问；持续失败会由平台运营处理。',
          to: null,
          actionLabel: null,
        },
  ]

  return {
    ranges: [
      { key: 'day', label: '今日' },
      { key: 'week', label: '近 7 天' },
      { key: 'month', label: '近 6 个月' },
    ],
    kpis: kpisOf(workspaceId, rows),
    trend: isOps ? TREND_OPS : TREND,
    trendUnit: isOps ? '请求数' : '使用次数',
    distribution: dist,
    distributionTitle: isOps ? '按学校分布' : workspaceId === 'school-admin' ? '按年级分布' : '按班级分布',
    distributionUnit: isOps ? '次请求' : '次',
    trendNote: isOps ? '含全部模型请求，含自动重试' : '含学生提问与追问，不含系统自动提示',
    anomalies,
  }
}

// ── 模型与成本（仅运营） ─────────────────────────────────
export const MODEL_ROWS = [
  {
    id: 'm-main',
    vendor: '供应商 A',
    model: 'reader-pro-1',
    role: '主力对话',
    status: 'on',
    share: 68,
    tokenIn: '1.62 亿',
    tokenOut: '0.74 亿',
    cache: '41%',
    p95: '2.4 秒',
    fail: '0.31%',
    cost: '￥2,860',
  },
  {
    id: 'm-cheap',
    vendor: '供应商 A',
    model: 'reader-lite-1',
    role: '摘要与标题',
    status: 'on',
    share: 21,
    tokenIn: '0.58 亿',
    tokenOut: '0.21 亿',
    cache: '52%',
    p95: '1.1 秒',
    fail: '0.18%',
    cost: '￥612',
  },
  {
    id: 'm-safe',
    vendor: '供应商 B',
    model: 'guard-cls-2',
    role: '隐私与危险判定',
    status: 'on',
    share: 8,
    tokenIn: '0.19 亿',
    tokenOut: '0.02 亿',
    cache: '—',
    p95: '0.6 秒',
    fail: '0.09%',
    cost: '￥418',
  },
  {
    id: 'm-backup',
    vendor: '供应商 C',
    model: 'reader-fallback-0',
    role: '故障兜底',
    status: 'standby',
    share: 3,
    tokenIn: '0.04 亿',
    tokenOut: '0.01 亿',
    cache: '—',
    p95: '3.8 秒',
    fail: '1.24%',
    cost: '￥292',
  },
]

export const MODEL_BUDGET = { used: 4182, total: 6800, resetAt: '8月31日', tone: 'brand' }

export const MODEL_TASKS = [
  { id: 't-1', name: '家长周报生成', at: '今天 06:00', total: 156, failed: 2, state: 'retrying' },
  { id: 't-2', name: '班级报告汇总', at: '今天 05:30', total: 24, failed: 0, state: 'done' },
  { id: 't-3', name: '危险信号二次复核', at: '持续运行', total: 41, failed: 1, state: 'running' },
  { id: 't-4', name: '书目向量重建', at: '昨天 23:10', total: 8, failed: 3, state: 'failed' },
]
