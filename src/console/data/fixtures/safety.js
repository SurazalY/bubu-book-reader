// 安全事件数据。学生与班级来自 classes.js，能对上的会话来自 sessions.js。
//
// 拍板要点（Codex 第 78 轮）：
// - 状态五种：待处理 → 处理中 → 待复核 → 已关闭；「误报」是另一种终止结果，不进正常处理链
// - 「涉事人员被跳过」不是状态，而是升级链里的回避标记（灰色删除线 + 「涉事回避，已跳过」）
// - 处理链由学校管理员配置，最终责任人为校长／书记层级，不再向上无限套娃
// - 详情顺序固定：风险摘要 → 触发消息与最小必要上下文 → 通知与排除人员 → 处理时间线 → 线下记录与结果
// - 上下文默认只给触发消息 + 前后各 2 条；查看更多要填写用途

import { getClass, getStudent } from './classes.js'
import { getSession } from './sessions.js'

export const RISK_LEVELS = {
  high: { label: '高风险', tone: 'danger', dot: '#C2453D', desc: '涉及自伤、他伤或明确求救信号，需要当日处理' },
  mid: { label: '中风险', tone: 'warning', dot: '#D98324', desc: '情绪持续低落或反复回避，需要教师主动介入' },
  low: { label: '低风险', tone: 'brand', dot: '#3B66F5', desc: '单次负面表达，先观察并记录' },
}

// 四个流转状态 + 一个终止结果。误报单独一档，颜色用灰不用绿，避免看起来像「处理得好」
export const EVENT_STATUS = {
  pending: { label: '待处理', tone: 'danger', icon: 'CircleAlert', flow: true },
  working: { label: '处理中', tone: 'warning', icon: 'UserRoundCheck', flow: true },
  review: { label: '待复核', tone: 'accent', icon: 'ClipboardCheck', flow: true },
  closed: { label: '已关闭', tone: 'success', icon: 'CircleCheck', flow: true },
  false: { label: '误报', tone: 'muted', icon: 'CircleSlash', flow: false },
}

// 升级链每一环的状态。skipped 就是「涉事回避」，必须画成灰色删除线
export const CHAIN_STATE = {
  done: { label: '已处理', tone: 'success' },
  current: { label: '当前责任人', tone: 'warning' },
  waiting: { label: '等待升级', tone: 'muted' },
  skipped: { label: '涉事回避，已跳过', tone: 'muted' },
}

const M = (role, at, text, extra = {}) => ({ role, at, text, ...extra })

export const EVENTS = [
  {
    id: 'SE-20260804-0011',
    studentId: 's-3301',
    classId: 'c3-3',
    bookId: 'b-caofangzi',
    sessionId: null,
    risk: 'high',
    status: 'pending',
    triggerAt: '今天 07:42',
    remainMinutes: 72,
    slaHours: 4,
    owner: '张年级组长',
    ownerNote: '班主任周老师是本次事件涉事人员，已自动回避，责任人顺延到年级组长',
    summary:
      '学生在阅读《草房子》第八章后连续两次表达「不想去学校」，并提到前一天在课堂上被当众批评。触发词命中「不想活」的近义表达，二次复核判定为高风险。',
    aiNote: 'AI 判定：高置信度自伤倾向信号 1 条 + 中置信度情绪低落信号 3 条累计。判定仅供参考，处理以教师核实为准。',
    hiddenBefore: 14,
    hiddenAfter: 3,
    context: [
      M('stu', '07:36', '桑桑生病那段我读了三遍。他会死吗？'),
      M('ai', '07:37', '书里让他活下来了。你为什么这么在意这一段？'),
      M('stu', '07:39', '昨天上课我被点名说态度不好，全班都在看我。我今天不想去学校，也不想活着这么累。', {
        trigger: true,
      }),
      M('ai', '07:40', '你说的这句我听见了，也很在意。你现在是一个人吗？愿意先跟我说说昨天发生了什么吗？'),
      M('stu', '07:42', '就那样。你别告诉别人。'),
    ],
    notified: [
      { name: '张年级组长', role: '年级管理', at: '今天 07:43', state: 'read' },
      { name: '培新小学 · 心理教师', role: '心理', at: '今天 07:43', state: 'read' },
      { name: '冯校长', role: '校长', at: '今天 07:43', state: 'unread' },
    ],
    excluded: [{ name: '周老师', role: '三年级（3）班班主任', reason: '事件内容直接涉及该教师，按回避规则不通知、不可访问' }],
    chain: [
      { name: '周老师', role: '班主任', state: 'skipped', at: '——', note: '涉事回避' },
      { name: '张年级组长', role: '年级管理', state: 'current', at: '今天 07:43 接到通知', note: '4 小时内需接手' },
      { name: '李德育主任', role: '德育处', state: 'waiting', at: '——', note: '超时后自动升级' },
      { name: '冯校长', role: '校长（最终责任人）', state: 'waiting', at: '——', note: '再超时则由校长兜底' },
    ],
    timeline: [
      { at: '今天 07:42', actor: '系统', action: '二次复核判定高风险，生成事件', note: '触发消息与前后各 2 条已固定保存' },
      { at: '今天 07:43', actor: '系统', action: '按升级链通知责任人', note: '周老师被判定为涉事人员，自动跳过' },
    ],
    offline: null,
    result: null,
  },
  {
    id: 'SE-20260803-0007',
    studentId: 's-3105',
    classId: 'c3-1',
    bookId: 'b-xialuo',
    sessionId: 'sess-0431',
    risk: 'mid',
    status: 'working',
    triggerAt: '8月3日 21:38',
    remainMinutes: 305,
    slaHours: 12,
    owner: '林老师',
    summary:
      '学生在《夏洛的网》结局处提到「最近老是睡不着，想着要是我不在了会不会没人发现」，并要求不要告诉家长。判定为中风险，需教师当面核实并决定是否联系监护人。',
    aiNote: 'AI 判定：中置信度情绪低落 + 睡眠困扰信号。判定仅供参考，处理以教师核实为准。',
    hiddenBefore: 7,
    hiddenAfter: 1,
    context: null,
    notified: [
      { name: '林老师', role: '三年级（1）班班主任', at: '8月3日 21:39', state: 'read' },
      { name: '培新小学 · 心理教师', role: '心理', at: '8月3日 21:39', state: 'read' },
    ],
    excluded: [],
    chain: [
      { name: '林老师', role: '班主任', state: 'current', at: '8月3日 21:52 已接手', note: '正在处理' },
      { name: '张年级组长', role: '年级管理', state: 'waiting', at: '——', note: '超时后自动升级' },
      { name: '冯校长', role: '校长（最终责任人）', state: 'waiting', at: '——', note: '再超时则由校长兜底' },
    ],
    timeline: [
      { at: '8月3日 21:38', actor: '系统', action: '判定中风险，生成事件' },
      { at: '8月3日 21:52', actor: '林老师', action: '接手事件', note: '说明：本班学生，明早课前先单独聊一次' },
      { at: '8月4日 08:20', actor: '林老师', action: '查看扩展上下文', note: '用途：确认最近一周是否还有类似表达（已留痕）' },
    ],
    offline: {
      by: '林老师',
      at: '8月4日 08:55',
      text: '课前在办公室单独聊了 20 分钟。学生说主要是暑期作业压力和搬家，睡不好已有两周。已同意由老师联系母亲，暂不联系父亲。',
    },
    result: null,
  },
  {
    id: 'SE-20260801-0004',
    studentId: 's-6102',
    classId: 'c6-1',
    bookId: 'b-jianai',
    sessionId: 'sess-0508',
    risk: 'low',
    status: 'review',
    triggerAt: '8月1日 23:06',
    remainMinutes: 1440,
    slaHours: 48,
    owner: '陈老师',
    summary:
      '学生读到简·爱被罚站时提到「我们班也有人被这样对，我什么都没做，我觉得我挺没用的」。判定为低风险自我否定表达，同时含班级同学关系线索，需复核是否属于校园关系问题。',
    aiNote: 'AI 判定：低置信度自我否定表达 1 条。判定仅供参考，处理以教师核实为准。',
    hiddenBefore: 11,
    hiddenAfter: 2,
    context: null,
    notified: [{ name: '陈老师', role: '六年级（1）班班主任', at: '8月1日 23:07', state: 'read' }],
    excluded: [],
    chain: [
      { name: '陈老师', role: '班主任', state: 'done', at: '8月2日 09:10 已处理', note: '已提交复核' },
      { name: '李德育主任', role: '德育处', state: 'current', at: '8月2日 09:10 待复核', note: '需确认是否属校园关系问题' },
      { name: '冯校长', role: '校长（最终责任人）', state: 'waiting', at: '——', note: '仅在复核判定升级时介入' },
    ],
    timeline: [
      { at: '8月1日 23:06', actor: '系统', action: '判定低风险，生成事件' },
      { at: '8月2日 08:40', actor: '陈老师', action: '接手事件' },
      { at: '8月2日 09:10', actor: '陈老师', action: '提交复核', note: '说明：已单独沟通，学生情绪稳定；同学关系部分需德育处确认' },
    ],
    offline: {
      by: '陈老师',
      at: '8月2日 09:05',
      text: '与学生课间沟通。他说的是同班一位同学被起外号，自己没有站出来。已把这件事转给德育处，按班级关系问题另行处理。',
    },
    result: null,
  },
  {
    id: 'SE-20260728-0003',
    studentId: 's-3201',
    classId: 'c3-2',
    bookId: 'b-caofangzi',
    sessionId: null,
    risk: 'low',
    status: 'false',
    triggerAt: '7月28日 16:20',
    remainMinutes: 0,
    slaHours: 48,
    owner: '林老师',
    summary:
      '触发消息是学生复述《草房子》里秦大奶奶落水的情节，被判定为疑似自伤描述。教师核实后确认是书中内容转述，判为误报。',
    aiNote: 'AI 判定：中置信度自伤描述。误报原因：模型未能区分「书中人物」与「学生自述」。',
    hiddenBefore: 4,
    hiddenAfter: 2,
    context: [
      M('stu', '16:16', '秦大奶奶为什么要去救那个南瓜？'),
      M('ai', '16:17', '书里说她是为了学校的南瓜掉进水里的。你觉得她真的只是为了南瓜吗？'),
      M('stu', '16:19', '她掉到水里没人救，最后就死了。我觉得她其实是想让别人记住她。', { trigger: true }),
      M('ai', '16:19', '你读得很细。她一开始被大家讨厌，后来却被记住了——你觉得中间发生了什么变化？'),
      M('stu', '16:20', '她救了乔乔。'),
    ],
    notified: [{ name: '林老师', role: '三年级（2）班语文', at: '7月28日 16:21', state: 'read' }],
    excluded: [],
    chain: [
      { name: '林老师', role: '本班语文', state: 'done', at: '7月28日 16:44 判为误报', note: '已终止处理链' },
      { name: '张年级组长', role: '年级管理', state: 'waiting', at: '——', note: '误报终止，未升级' },
    ],
    timeline: [
      { at: '7月28日 16:20', actor: '系统', action: '判定中风险，生成事件' },
      { at: '7月28日 16:38', actor: '林老师', action: '接手事件' },
      {
        at: '7月28日 16:44',
        actor: '林老师',
        action: '标记误报并关闭',
        note: '说明：触发内容是《草房子》第六章秦大奶奶落水的情节转述，不是学生自身经历',
      },
    ],
    offline: null,
    result: {
      tone: 'muted',
      label: '误报已关闭',
      text: '误报记录会保留并回流用于改进判定规则；不计入学生任何评价，也不进入家长报告。',
    },
  },
  {
    id: 'SE-20260726-0002',
    studentId: 's-3102',
    classId: 'c3-1',
    bookId: 'b-caofangzi',
    sessionId: null,
    risk: 'mid',
    status: 'closed',
    triggerAt: '7月26日 20:11',
    remainMinutes: 0,
    slaHours: 12,
    owner: '林老师',
    summary:
      '学生连续三晚在 22 点后与 AI 讨论「爸爸妈妈总在吵架」，出现「我在家里像多出来的一个人」。判定为中风险家庭情绪问题。',
    aiNote: 'AI 判定：中置信度家庭关系压力信号 3 条累计。判定仅供参考，处理以教师核实为准。',
    hiddenBefore: 9,
    hiddenAfter: 4,
    context: [
      M('stu', '20:05', '桑桑爸爸后来对他好了，是因为他生病了才好的吗？'),
      M('ai', '20:06', '有一部分是。但你注意到吗，他爸爸一直都在，只是不会说。你想到自己家里了？'),
      M('stu', '20:09', '我爸妈总在吵架，我在家里像多出来的一个人。', { trigger: true }),
      M('ai', '20:10', '这句话听起来很孤单。你愿意告诉我，家里吵架的时候你一般在做什么吗？'),
      M('stu', '20:11', '关门看书。'),
    ],
    notified: [
      { name: '林老师', role: '三年级（1）班班主任', at: '7月26日 20:12', state: 'read' },
      { name: '培新小学 · 心理教师', role: '心理', at: '7月26日 20:12', state: 'read' },
    ],
    excluded: [],
    chain: [
      { name: '林老师', role: '班主任', state: 'done', at: '7月27日 10:30 已处理' },
      { name: '培新小学 · 心理教师', role: '心理', state: 'done', at: '7月28日 15:00 已复核' },
      { name: '张年级组长', role: '年级管理', state: 'waiting', at: '——', note: '未升级' },
    ],
    timeline: [
      { at: '7月26日 20:11', actor: '系统', action: '判定中风险，生成事件' },
      { at: '7月26日 20:30', actor: '林老师', action: '接手事件' },
      { at: '7月27日 10:30', actor: '林老师', action: '提交复核', note: '说明：已与学生沟通，并与母亲电话确认家庭情况' },
      { at: '7月28日 15:00', actor: '心理教师', action: '复核通过并关闭', note: '说明：建议持续观察两周，暂不需要转介' },
    ],
    offline: {
      by: '林老师',
      at: '7月27日 10:10',
      text: '学生资料里的号码打不通（后经确认已停机），改在放学时与母亲当面沟通 15 分钟。母亲承认近期争执较多，同意避免在孩子面前争吵，并答应补一个可用手机号。学生已加入班级读书小组，情绪较前一周好转。',
    },
    result: {
      tone: 'success',
      label: '已关闭 · 持续观察',
      text: '处理结果：已线下沟通并联系监护人，学生情绪好转，转入两周观察期。本事件未写入任何家长报告。',
    },
  },
  {
    id: 'SE-20260802-0006',
    studentId: 's-6301',
    classId: 'c6-3',
    bookId: 'b-xiyouji',
    sessionId: null,
    risk: 'mid',
    status: 'working',
    triggerAt: '8月2日 19:24',
    remainMinutes: -95,
    slaHours: 12,
    owner: '孙老师',
    summary:
      '学生反复提到「转学以后没有人跟我说话」，并在两天内三次询问「一个人待着是不是不正常」。判定为中风险社交孤立信号。',
    aiNote: 'AI 判定：中置信度社交孤立信号 3 条累计。判定仅供参考，处理以教师核实为准。',
    hiddenBefore: 12,
    hiddenAfter: 2,
    context: [
      M('stu', '19:18', '孙悟空被赶走那段，他自己回花果山的时候难过吗？'),
      M('ai', '19:19', '书里没写他哭，但写了他一路上没说话。你觉得沉默算不算难过？'),
      M('stu', '19:22', '算。我转学以后也没人跟我说话，一个人待着是不是不正常？', { trigger: true }),
      M('ai', '19:23', '一个人待着不是不正常，但你连着问了我三次这句话，说明你自己不太舒服。愿意跟我说说班里的情况吗？'),
      M('stu', '19:24', '算了，说了也没用。'),
    ],
    notified: [
      { name: '孙老师', role: '六年级（3）班班主任', at: '8月2日 19:25', state: 'read' },
      { name: '张年级组长', role: '年级管理', at: '8月3日 07:25', state: 'read' },
    ],
    excluded: [],
    chain: [
      { name: '孙老师', role: '班主任', state: 'current', at: '8月2日 21:40 已接手', note: '已超时 1 小时 35 分' },
      { name: '张年级组长', role: '年级管理', state: 'waiting', at: '8月3日 07:25 已收到超时提醒', note: '超时提醒已发出' },
      { name: '冯校长', role: '校长（最终责任人）', state: 'waiting', at: '——', note: '再超时则由校长兜底' },
    ],
    timeline: [
      { at: '8月2日 19:24', actor: '系统', action: '判定中风险，生成事件' },
      { at: '8月2日 21:40', actor: '孙老师', action: '接手事件', note: '说明：开学后第一周安排同桌轮换' },
      { at: '8月3日 07:25', actor: '系统', action: '处理超时，向上一级发送提醒', note: '责任人未在 12 小时内提交复核' },
    ],
    offline: null,
    result: null,
  },
]

const CLASS_SCOPE = {
  'class-teacher': ['c3-1', 'c3-2', 'c3-3'],
  'grade-admin': ['c6-1', 'c6-2', 'c6-3', 'c6-4'],
  'grade-group': ['c6-1', 'c6-2', 'c6-3'],
}

// 事件可见范围跟班级范围一致；教研组没有安全事件权限（allow 里就没给），
// 这里仍按范围裁剪，避免以后开权限时漏改。
export function getEvents(workspaceId) {
  const ids = CLASS_SCOPE[workspaceId]
  return ids ? EVENTS.filter((e) => ids.includes(e.classId)) : EVENTS
}

export function getEvent(eventId) {
  return EVENTS.find((e) => e.id === eventId)
}

export function eventStudent(event) {
  return getStudent(event.studentId)
}

export function eventClass(event) {
  return getClass(event.classId)
}

// 上下文来源：能对上会话的直接用会话里那 5 条（同一份事实），否则用事件自带的 context
export function eventContext(event) {
  if (event.context) return event.context
  const s = event.sessionId ? getSession(event.sessionId) : null
  return s?.messages || []
}

// 剩余处理时间：负数表示已超时。列表与详情共用同一套文案，避免两处算法不一致
export function remainText(event) {
  if (!EVENT_STATUS[event.status].flow || event.status === 'closed' || event.status === 'false') {
    return { text: '已终止计时', tone: 'muted' }
  }
  const m = event.remainMinutes
  if (m < 0) {
    const abs = Math.abs(m)
    return { text: `已超时 ${Math.floor(abs / 60)} 小时 ${abs % 60} 分`, tone: 'danger' }
  }
  if (m < 120) return { text: `剩余 ${Math.floor(m / 60)} 小时 ${m % 60} 分`, tone: 'warning' }
  if (m < 1440) return { text: `剩余 ${Math.floor(m / 60)} 小时`, tone: 'brand' }
  return { text: `剩余 ${Math.round(m / 1440)} 天`, tone: 'muted' }
}

// 升级链配置（学校管理员配置，运营只读）。默认链就是详情里那四级，
// 最终责任人固定为校长／书记层级，不再向上。
export const ESCALATION_CONFIG = {
  owner: '培新小学 · 学校管理员',
  updatedAt: '2026-07-20',
  levels: [
    { name: '班主任', desc: '本班学生的第一责任人', sla: '高风险 4 小时 / 中风险 12 小时 / 低风险 48 小时' },
    { name: '年级组长', desc: '班主任超时或涉事回避时接手', sla: '同上，重新计时' },
    { name: '德育处主任', desc: '涉及校园关系问题或需要跨班处理时接手', sla: '同上，重新计时' },
    { name: '校长 / 书记', desc: '最终责任人，不再向上升级', sla: '兜底，不再计时' },
  ],
  rules: [
    '链路中被判定为涉事人员的责任人自动跳过，不通知也不可访问事件详情',
    '到期未提交复核时向下一级升级，并保留上一级的未处理记录',
    '未经学校确认的事件不会进入任何家长报告',
    '心理教师与保密岗位始终收到通知，但不占用责任人顺位',
  ],
  pending: '按事件类型配置不同链路（如校园关系问题直接给德育处）待后续设计',
}
