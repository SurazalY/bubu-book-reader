// 隐私访问：待处理申请 / 我的申请 / 访问历史。
// 会话与学生一律引用 sessions.js 与 classes.js，标题统一走 sessionTitle()，
// 保证私密会话在任何一个列表里都只显示「私密会话 #编号」。

export const APPLY_KIND = {
  view: { label: '查看私密会话', icon: 'Lock', tone: 'violet' },
  extend: { label: '展开安全事件上下文', icon: 'ShieldAlert', tone: 'danger' },
  revoke: { label: '学生申请撤回授权', icon: 'Undo2', tone: 'muted' },
}

export const APPLY_STATE = {
  pending: { label: '等待处理', tone: 'warning' },
  approved: { label: '已同意', tone: 'success' },
  rejected: { label: '已拒绝', tone: 'danger' },
  timeout: { label: '超时默认同意', tone: 'brand' },
  withdrawn: { label: '已撤回', tone: 'muted' },
}

// 需要当前账号处理的申请。学校把「私密会话查看」配成需要管理员复核时，
// 教师的申请会先落在这里；学生主动要求撤回授权也在这里处理。
export const PENDING = [
  {
    id: 'ap-1',
    kind: 'view',
    applicant: '周老师',
    applicantRole: '三年级（3）班 语文',
    studentId: 's-3301',
    sessionId: null,
    purpose: '家长反馈孩子最近情绪低落，想确认是否与共读内容有关。',
    at: '今天 09:12',
    deadline: '还剩 1 天 6 小时',
  },
  {
    id: 'ap-2',
    kind: 'view',
    applicant: '赵老师',
    applicantRole: '三年级（1）班 数学',
    // 会话与学生必须对得上：sess-0402 是陈嘉言的私密会话
    studentId: 's-3101',
    sessionId: 'sess-0402',
    purpose: '学生在作文里提到「不敢跟人说的事」，想核对是否需要转介心理老师。',
    at: '今天 08:40',
    deadline: '还剩 1 天 5 小时',
  },
  {
    id: 'ap-3',
    kind: 'extend',
    applicant: '孙老师',
    applicantRole: '安全事件处理人',
    studentId: 's-3105',
    sessionId: 'sess-0431',
    purpose: '需要确认触发消息之前是否已有类似表述，用于判断风险等级。',
    at: '昨天 21:50',
    deadline: '还剩 3 小时',
  },
  {
    id: 'ap-4',
    kind: 'revoke',
    applicant: '陈嘉言（学生）',
    applicantRole: '三年级（1）班',
    studentId: 's-3101',
    sessionId: 'sess-0402',
    purpose: '学生希望撤回上次同意的查看授权。',
    at: '昨天 19:05',
    deadline: '还剩 2 天',
  },
  {
    id: 'ap-5',
    kind: 'view',
    applicant: '吴老师',
    applicantRole: '六年级（2）班 语文',
    studentId: 's-6201',
    sessionId: null,
    purpose: '核对学生反复提问同一章节是否遇到阅读困难。',
    at: '8月3日 16:20',
    deadline: '已超时，按学校配置默认同意',
  },
]

// 我发起的申请
export const MINE = [
  {
    id: 'my-1',
    kind: 'view',
    studentId: 's-3101',
    sessionId: 'sess-0402',
    purpose: '学生连续三天在私密会话里提问，想确认是否需要介入。',
    at: '今天 10:02',
    state: 'pending',
    respondedAt: null,
  },
  {
    id: 'my-2',
    kind: 'view',
    studentId: 's-3202',
    sessionId: 'sess-0352',
    purpose: '家长会前想了解孩子的阅读困惑。',
    at: '7月30日 14:20',
    state: 'rejected',
    respondedAt: '7月30日 20:41',
  },
  {
    id: 'my-3',
    kind: 'view',
    studentId: 's-6101',
    sessionId: 'sess-0512',
    purpose: '学生主动提出想聊《简·爱》，先了解上下文再谈。',
    at: '7月28日 09:15',
    state: 'timeout',
    respondedAt: '7月30日 09:15',
  },
  {
    id: 'my-4',
    kind: 'extend',
    studentId: 's-6102',
    sessionId: 'sess-0508',
    purpose: '判断是否属于长期状态，需要看触发消息之前的两周记录。',
    at: '8月1日 23:30',
    state: 'approved',
    respondedAt: '8月2日 08:10',
  },
]

// 访问历史：谁在什么时候看了谁的哪段会话、用途是什么。
// 普通会话不需要申请但同样留痕，这条是交付说明明确要求的。
export const HISTORY = [
  {
    id: 'h-1',
    viewer: '林老师',
    role: '班级教师',
    studentId: 's-3101',
    sessionId: 'sess-0416',
    need: '无需申请（授权范围内普通会话）',
    purpose: '备课参考，确认学生对第二章的理解程度。',
    at: '今天 15:20',
  },
  {
    id: 'h-2',
    viewer: '孙老师',
    role: '安全事件处理人',
    studentId: 's-3105',
    sessionId: 'sess-0431',
    need: '填写用途后查看（安全规则优先）',
    purpose: '事件 SE-20260803-0007 初判，仅查看最小必要上下文。',
    at: '今天 08:05',
  },
  {
    id: 'h-3',
    viewer: '林老师',
    role: '班级教师',
    studentId: 's-3103',
    sessionId: 'sess-0388',
    need: '无需申请（授权范围内普通会话）',
    purpose: '整理共读课上的典型提问。',
    at: '昨天 19:12',
  },
  {
    id: 'h-4',
    viewer: '校长',
    role: '校级管理',
    studentId: 's-6102',
    sessionId: 'sess-0508',
    need: '学生同意后查看',
    purpose: '复核低风险事件的处理是否恰当。',
    at: '8月2日 10:40',
  },
  {
    id: 'h-5',
    viewer: '平台运营',
    role: '平台运营',
    studentId: 's-6201',
    sessionId: 'sess-0496',
    need: '授权范围内直接查看（自动记录）',
    purpose: '排查一次模型回复截断的线上问题。',
    at: '7月31日 20:30',
  },
]

// 各工作空间能看到的条数不同：范围越大，待处理与历史越多
const SCOPE_COUNT = {
  'class-teacher': { pending: 2, mine: 4, history: 3 },
  'grade-group': { pending: 0, mine: 0, history: 0 },
  'grade-admin': { pending: 3, mine: 4, history: 4 },
  'school-admin': { pending: 5, mine: 4, history: 5 },
  'platform-ops': { pending: 1, mine: 2, history: 5 },
}

export function getPrivacyData(workspaceId) {
  const n = SCOPE_COUNT[workspaceId] || SCOPE_COUNT['class-teacher']
  return {
    pending: PENDING.slice(0, n.pending),
    mine: MINE.slice(0, n.mine),
    history: HISTORY.slice(0, n.history),
  }
}
