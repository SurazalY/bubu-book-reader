// 报告与家长触达数据。学生、班级、书目全部从已有 fixtures 取，这里只放报告本身。
//
// 拍板要点（Codex 第 78 轮）：
// - 报告详情负责「发起发送 / 定时发送 / 提交审核」，家长发送页负责「规则概览 / 历史记录 / 失败重试 / 触达结果」
// - 发送状态与触达状态是两个字段，「重试」是失败记录上的按钮而不是状态
// - 纯文本短信只能拿到运营商送达结果，拿不到「打开」与「已读」→ reach 必须为 null，不许伪造能力
// - 报告正文三种来源必须能分辨：系统固定评价 / 教师手写 / AI 草稿（AI 段带免责声明）

import { CLASSES, getClass, getStudent } from './classes.js'
import { BOOKS } from './books.js'

export const REPORT_TYPES = {
  student: { label: '学生个人阅读总结', icon: 'UserRound', tone: 'brand' },
  class: { label: '班级／阅读安排报告', icon: 'Users', tone: 'cyan' },
  school: { label: '学校范围汇总', icon: 'Building2', tone: 'violet' },
  parent: { label: '家长阅读报告', icon: 'Heart', tone: 'accent' },
}

// 六种状态（信息架构 §9.1）。生成中与已撤回都用灰，但图标不同，避免只靠颜色区分
export const REPORT_STATUS = {
  generating: { label: '生成中', tone: 'muted', icon: 'LoaderCircle' },
  confirm: { label: '待确认', tone: 'warning', icon: 'CircleUser' },
  review: { label: '待审核', tone: 'accent', icon: 'ClipboardCheck' },
  published: { label: '已发布', tone: 'success', icon: 'CircleCheck' },
  failed: { label: '发送失败', tone: 'danger', icon: 'CircleX' },
  withdrawn: { label: '已撤回', tone: 'muted', icon: 'Undo2' },
}

// 学校规则：报告页只读取学校已设置的流程，真正的规则切换在「模板与规则」里。
// 详情页的切换器只是流程演示，界面上必须写明这一点。
export const FLOW_RULES = {
  confirm: {
    key: 'confirm',
    label: '教师确认后发送',
    desc: '教师确认即可发送，学校管理员只查看记录。',
    teacher: ['编辑', '确认发送', '定时发送'],
    admin: ['查看记录'],
  },
  review: {
    key: 'review',
    label: '管理员审核后发送',
    desc: '教师提交审核，由学校管理员通过并发送或退回修改。',
    teacher: ['编辑', '提交审核'],
    admin: ['通过并发送', '退回修改'],
  },
}

// 三种触达通道。canTrack 决定能不能有「打开 / 已确认阅读」——纯短信拿不到
export const CHANNELS = {
  sms: {
    label: '纯短信',
    icon: 'MessageSquare',
    tone: 'muted',
    canTrack: false,
    note: '只有运营商送达结果，看不到家长是否打开，也不会有阅读回执。',
  },
  link: {
    label: '短信摘要 + 安全链接',
    icon: 'Link2',
    tone: 'brand',
    canTrack: true,
    note: '短信里是摘要，链接需要手机号后四位校验；能记录打开与确认阅读。',
  },
  miniapp: {
    label: '小程序报告',
    icon: 'Smartphone',
    tone: 'cyan',
    canTrack: true,
    note: '已绑定小程序的家长直接在小程序内查看，能记录打开与确认阅读。',
  },
}

export const SEND_STATES = {
  queued: { label: '待发送', tone: 'muted' },
  sending: { label: '发送中', tone: 'brand' },
  success: { label: '成功', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
}

export const REACH_STATES = {
  unopened: { label: '未打开', tone: 'muted' },
  opened: { label: '已打开', tone: 'brand' },
  read: { label: '已确认阅读', tone: 'success' },
}

export const RECIPIENT_SCOPES = {
  primary: { label: '主要接收人', desc: '只发给学生资料里设为主要接收人的那一位' },
  all: { label: '全部接收人', desc: '发给学生资料里所有监护人' },
  custom: { label: '指定监护人', desc: '本次单独选择接收人，不改学生资料' },
}

export const SEND_MODES = {
  manual: { label: '手动发送', icon: 'Send' },
  weekly: { label: '定时周报', icon: 'CalendarClock' },
  stage: { label: '阶段报告', icon: 'Flag' },
}

// ── 报告正文（A4 预览用）。三种来源必须能分辨 ────────────────────
const SRC = {
  fixed: { label: '系统固定评价', tone: 'muted', note: '由阅读数据直接生成，口径固定，不经模型。' },
  teacher: { label: '教师手写', tone: 'brand', note: '教师本人撰写，学校对内容负责。' },
  ai: { label: 'AI 草稿', tone: 'accent', note: 'AI 生成，仅供参考；发布前需教师确认。' },
}

export const SOURCE_META = SRC

export const REPORTS = [
  {
    id: 'rp-2026w31-3105',
    no: 'R-20260803-1042',
    type: 'student',
    title: '赵星禾 · 第 31 周阅读总结',
    studentId: 's-3105',
    classId: 'c3-1',
    bookId: 'b-caofangzi',
    period: '2026年7月27日 — 8月2日',
    status: 'confirm',
    flowRule: 'confirm',
    createdAt: '8月3日 06:10',
    updatedAt: '8月3日 09:24',
    version: 'v3',
    aiRatio: 1,
    nextHandler: '林老师（本班语文）',
    nextAction: '确认发送',
    versions: [
      { v: 'v3', at: '8月3日 09:24', by: '林老师', note: '改写教师评价第二段，删掉「注意力不集中」这种评判性说法' },
      { v: 'v2', at: '8月3日 07:02', by: '系统', note: '重新生成 AI 草稿（上一版把《夏洛的网》的情节写进了《草房子》）' },
      { v: 'v1', at: '8月3日 06:10', by: '系统', note: '按周报模板首次生成' },
    ],
    metrics: [
      { label: '本周阅读', value: '312', unit: '分钟' },
      { label: '读完', value: '2', unit: '本' },
      { label: '与竹娃对话', value: '46', unit: '次' },
      { label: '连续阅读', value: '21', unit: '天' },
    ],
    sections: [
      {
        source: 'fixed',
        title: '阅读数据摘要',
        paragraphs: [
          '本周累计阅读 312 分钟，较上周增加 41 分钟，为班级第 1 位；读完《草房子》《夏洛的网》两本，正在读《昆虫记》第三章。',
          '本周与 AI 阅读伙伴对话 46 次，其中 38 次围绕书中人物动机，8 次为词语解释；对话额度已用满 120 次，8 月 4 日 00:00 重置。',
        ],
      },
      {
        source: 'teacher',
        title: '教师评价',
        paragraphs: [
          '星禾这周在共读课上主动讲了桑桑拆碗柜那一段，她说「他不是傻，是想给鸽子一个配得上它们的家」，全班安静了几秒——这是本学期我听到最好的一句发言。',
          '需要一起注意的是用眼时间：本周有三天单次阅读超过 50 分钟。已经在班里约定「读完一章就抬头看看窗外」，也请家里在睡前提醒她合上平板。',
        ],
      },
      {
        source: 'ai',
        title: '阅读倾向观察（AI 草稿）',
        paragraphs: [
          '本周提问集中在「人物为什么这样做」，很少问情节走向；在《夏洛的网》结局处停留时间最长，反复回看了两次同一段。',
          '可以尝试的下一本：《昆虫记》已在读，但它偏观察记录；读完后可以再找一本以人物为主的成长故事，让她继续在「人物动机」这条线上往深处走。',
        ],
      },
    ],
    sendSummary: { channel: 'link', scope: 'primary', mode: 'manual', hint: '尚未发送，等待教师确认' },
  },
  {
    id: 'rp-2026w31-3102',
    no: 'R-20260803-1043',
    type: 'student',
    title: '李知远 · 第 31 周阅读总结',
    studentId: 's-3102',
    classId: 'c3-1',
    bookId: 'b-caofangzi',
    period: '2026年7月27日 — 8月2日',
    status: 'failed',
    flowRule: 'confirm',
    createdAt: '8月3日 06:10',
    updatedAt: '8月3日 10:05',
    version: 'v2',
    aiRatio: 1,
    nextHandler: '林老师（本班语文）',
    nextAction: '重试发送',
    failNote: '接收号码 137****5561 被运营商拒收（疑似空号），已重试 2 次仍失败。',
    versions: [
      { v: 'v2', at: '8月3日 09:50', by: '林老师', note: '补一句家长关心的护眼情况' },
      { v: 'v1', at: '8月3日 06:10', by: '系统', note: '按周报模板首次生成' },
    ],
    metrics: [
      { label: '本周阅读', value: '186', unit: '分钟' },
      { label: '读完', value: '1', unit: '本' },
      { label: '与竹娃对话', value: '31', unit: '次' },
      { label: '连续阅读', value: '8', unit: '天' },
    ],
    sections: [
      {
        source: 'fixed',
        title: '阅读数据摘要',
        paragraphs: [
          '本周累计阅读 186 分钟，与上周基本持平；读完《草房子》，对话额度已用 104 / 120 次。',
          '本周有一次单次连续阅读 41 分钟，触发过一次休息提醒，学生按提醒休息后继续阅读。',
        ],
      },
      {
        source: 'teacher',
        title: '教师评价',
        paragraphs: [
          '知远这周开始愿意在小组里讲自己的看法了，虽然还是很短，但已经不是只点头。下周共读课我会点他先说。',
        ],
      },
      {
        source: 'ai',
        title: '阅读倾向观察（AI 草稿）',
        paragraphs: ['提问以词语与句子含义为主，说明他更在意「读懂字面」；可以先鼓励复述整章内容，再往人物动机上引。'],
      },
    ],
    sendSummary: { channel: 'sms', scope: 'primary', mode: 'weekly', hint: '定时周报发送失败，可在家长发送页重试' },
  },
  {
    id: 'rp-c31-arrange',
    no: 'R-20260802-0977',
    type: 'class',
    title: '三年级（1）班 · 《草房子》共读安排结题报告',
    classId: 'c3-1',
    bookId: 'b-caofangzi',
    period: '2026年5月23日 — 8月2日',
    status: 'published',
    flowRule: 'confirm',
    createdAt: '8月2日 18:00',
    updatedAt: '8月2日 20:41',
    version: 'v1',
    aiRatio: 0,
    nextHandler: '——',
    nextAction: '已完成',
    publishedAt: '8月2日 20:41',
    versions: [{ v: 'v1', at: '8月2日 18:00', by: '系统', note: '阅读安排结束自动生成' }],
    metrics: [
      { label: '参与学生', value: '30', unit: '人' },
      { label: '读完全书', value: '23', unit: '人' },
      { label: '班级平均进度', value: '78', unit: '%' },
      { label: '社区心得', value: '41', unit: '篇' },
    ],
    sections: [
      {
        source: 'fixed',
        title: '安排完成情况',
        paragraphs: [
          '本次共读安排覆盖 30 名在读学生，23 人读完全书，5 人进度在 60% 以上，2 人因账号暂停未参与。',
          '教师建议位置为第 62%（第五章末），全班有 21 人达到或超过该位置。',
        ],
      },
      {
        source: 'teacher',
        title: '教学小结',
        paragraphs: [
          '这本书最好的部分是孩子们自己吵起来的那两次：一次为桑桑该不该拆碗柜，一次为纸月要不要留在油麻地。下一轮共读我会把「争论点」提前设计进导读单。',
        ],
      },
    ],
    sendSummary: { channel: 'miniapp', scope: 'all', mode: 'stage', hint: '已发布并推送到 28 位家长' },
  },
  {
    id: 'rp-school-07',
    no: 'R-20260801-0910',
    type: 'school',
    title: '培新小学 · 7 月整书阅读月度汇总',
    classId: null,
    bookId: null,
    period: '2026年7月',
    status: 'review',
    flowRule: 'review',
    createdAt: '8月1日 08:00',
    updatedAt: '8月1日 15:12',
    version: 'v2',
    aiRatio: 1,
    nextHandler: '培新小学 · 学校管理员',
    nextAction: '通过并发送',
    versions: [
      { v: 'v2', at: '8月1日 15:12', by: '教务处', note: '补充六年级毕业班的收尾说明' },
      { v: 'v1', at: '8月1日 08:00', by: '系统', note: '按月度汇总模板生成' },
    ],
    metrics: [
      { label: '参与班级', value: '6', unit: '个' },
      { label: '活跃学生', value: '177', unit: '人' },
      { label: '累计阅读', value: '2.9', unit: '万分钟' },
      { label: '安全事件', value: '3', unit: '件' },
    ],
    sections: [
      {
        source: 'fixed',
        title: '全校数据摘要',
        paragraphs: [
          '7 月全校 6 个进行中班级、177 名活跃学生，累计阅读 29,140 分钟，人均 164 分钟；三年级组阅读时长高于六年级组约 18%。',
          '本月产生安全事件 3 件，其中 2 件已关闭、1 件在处理中；无未按时升级的事件。',
        ],
      },
      {
        source: 'ai',
        title: '趋势观察（AI 草稿）',
        paragraphs: [
          '三年级组增长主要来自《草房子》共读安排；六年级组因期末收尾，自由阅读比例上升、共读参与下降。',
          '建议在 9 月开学前为六年级重新安排一次短周期共读，避免长假后阅读习惯断档。',
        ],
      },
    ],
    sendSummary: { channel: null, scope: null, mode: null, hint: '学校汇总报告不发家长，仅在学校内部留档' },
  },
  {
    id: 'rp-parent-3101',
    no: 'R-20260731-0864',
    type: 'parent',
    title: '陈嘉言 · 家长阅读报告（7 月）',
    studentId: 's-3101',
    classId: 'c3-1',
    bookId: 'b-caofangzi',
    period: '2026年7月',
    status: 'published',
    flowRule: 'confirm',
    createdAt: '7月31日 19:00',
    updatedAt: '7月31日 20:15',
    version: 'v1',
    aiRatio: 1,
    nextHandler: '——',
    nextAction: '已完成',
    publishedAt: '7月31日 20:15',
    versions: [{ v: 'v1', at: '7月31日 19:00', by: '系统', note: '按家长触达摘要模板生成' }],
    metrics: [
      { label: '本月阅读', value: '712', unit: '分钟' },
      { label: '读完', value: '3', unit: '本' },
      { label: '护眼状态', value: '正常', unit: '' },
      { label: '心得分享', value: '6', unit: '篇' },
    ],
    sections: [
      {
        source: 'fixed',
        title: '这个月孩子读了什么',
        paragraphs: [
          '7 月共阅读 712 分钟，读完《草房子》《夏洛的网》《昆虫记》三本；每天平均 23 分钟，用眼时间全月未超限。',
        ],
      },
      {
        source: 'teacher',
        title: '老师想对家长说',
        paragraphs: ['嘉言这个月最大的变化是愿意写长一点的心得了。家里如果方便，可以让她讲给你们听，讲比写更能让她记住。'],
      },
      {
        source: 'ai',
        title: '亲子共读建议（AI 草稿）',
        paragraphs: ['她偏爱有具体生活细节的故事。睡前可以只问一句「今天读到谁做了让你意外的事」，不用追问情节。'],
      },
    ],
    sendSummary: { channel: 'link', scope: 'primary', mode: 'manual', hint: '已发送，家长已确认阅读' },
  },
  {
    id: 'rp-2026w31-6101',
    no: 'R-20260803-1051',
    type: 'student',
    title: '许听澜 · 第 31 周阅读总结',
    studentId: 's-6101',
    classId: 'c6-1',
    bookId: 'b-jianai',
    period: '2026年7月27日 — 8月2日',
    status: 'generating',
    flowRule: 'review',
    createdAt: '8月3日 06:10',
    updatedAt: '8月3日 06:10',
    version: '——',
    aiRatio: 1,
    nextHandler: '系统',
    nextAction: '生成中',
    generatingNote: '正在汇总本周阅读与对话数据，预计 2 分钟内完成；生成期间不可编辑。',
    versions: [],
    metrics: [],
    sections: [],
    sendSummary: { channel: null, scope: null, mode: null, hint: '生成完成后进入待审核' },
  },
  {
    id: 'rp-c62-week',
    no: 'R-20260727-0802',
    type: 'class',
    title: '六年级（2）班 · 第 30 周班级报告',
    classId: 'c6-2',
    bookId: 'b-jianai',
    period: '2026年7月20日 — 7月26日',
    status: 'withdrawn',
    flowRule: 'review',
    createdAt: '7月27日 08:00',
    updatedAt: '7月27日 11:30',
    version: 'v1',
    aiRatio: 0,
    nextHandler: '吴老师（本班语文）',
    nextAction: '修改后重新提交',
    withdrawNote: '撤回原因：报告里的班级平均进度取到了上一周的数据，已由教务处撤回，等待重新生成。',
    versions: [{ v: 'v1', at: '7月27日 08:00', by: '系统', note: '按周报模板生成' }],
    metrics: [
      { label: '参与学生', value: '31', unit: '人' },
      { label: '班级平均进度', value: '74', unit: '%' },
      { label: '社区心得', value: '18', unit: '篇' },
      { label: '触限学生', value: '2', unit: '人' },
    ],
    sections: [
      {
        source: 'fixed',
        title: '阅读数据摘要',
        paragraphs: ['本周 31 名学生参与，班级平均进度 74%，与（1）班相差约一周；2 名学生对话额度触限。'],
      },
    ],
    sendSummary: { channel: null, scope: null, mode: null, hint: '已撤回，不会发送' },
  },
  {
    id: 'rp-parent-3301',
    no: 'R-20260726-0788',
    type: 'parent',
    title: '冯清越 · 家长阅读报告（7 月上）',
    studentId: 's-3301',
    classId: 'c3-3',
    bookId: 'b-caofangzi',
    period: '2026年7月1日 — 7月15日',
    status: 'published',
    flowRule: 'confirm',
    createdAt: '7月26日 09:00',
    updatedAt: '7月26日 10:20',
    version: 'v2',
    aiRatio: 1,
    nextHandler: '——',
    nextAction: '已完成',
    publishedAt: '7月26日 10:20',
    versions: [
      { v: 'v2', at: '7月26日 10:20', by: '周老师', note: '把护眼提醒写得更具体' },
      { v: 'v1', at: '7月26日 09:00', by: '系统', note: '按家长触达摘要模板生成' },
    ],
    metrics: [
      { label: '本期阅读', value: '298', unit: '分钟' },
      { label: '读完', value: '1', unit: '本' },
      { label: '护眼状态', value: '需注意', unit: '' },
      { label: '心得分享', value: '2', unit: '篇' },
    ],
    sections: [
      {
        source: 'fixed',
        title: '这半个月孩子读了什么',
        paragraphs: ['本期阅读 298 分钟，读完《草房子》；有 4 天单日用眼接近 60 分钟上限，其中 1 天触发过休息提醒。'],
      },
      {
        source: 'teacher',
        title: '老师想对家长说',
        paragraphs: ['清越很投入，但一读就停不下来。我们在班里约定了每读完一章就抛下平板看看窗外，也请家里帮忙一起看着。'],
      },
    ],
    sendSummary: { channel: 'sms', scope: 'primary', mode: 'manual', hint: '已发送，纯短信无法获知是否打开' },
  },
]

// 报告可见范围：跟其它页面一样按班级范围裁剪；学校汇总只给校级与运营
const SCHOOL_SCOPES = ['school-admin', 'platform-ops']

export function getReports(workspaceId) {
  const classIds = classScope(workspaceId)
  return REPORTS.filter((r) => {
    if (r.type === 'school') return SCHOOL_SCOPES.includes(workspaceId)
    return r.classId ? classIds.includes(r.classId) : true
  })
}

function classScope(workspaceId) {
  const map = {
    'class-teacher': ['c3-1', 'c3-2', 'c3-3'],
    'grade-admin': ['c6-1', 'c6-2', 'c6-3', 'c6-4'],
    'grade-group': ['c6-1', 'c6-2', 'c6-3'],
  }
  return map[workspaceId] || CLASSES.map((c) => c.id)
}

export function getReport(reportId) {
  return REPORTS.find((r) => r.id === reportId)
}

export function reportStudent(report) {
  return report.studentId ? getStudent(report.studentId) : null
}

export function reportClass(report) {
  return report.classId ? getClass(report.classId) : null
}

export function reportBook(report) {
  return report.bookId ? BOOKS.find((b) => b.id === report.bookId) : null
}

// ── 家长发送：规则概览 + 发送记录 ────────────────────────────────
// reach 为 null 表示这个通道拿不到触达结果（纯短信），页面上要显示成「不可获知」而不是「未打开」

// Plan_2 P8：这一屏最容易被误读成「产品就是这样的」。
// 产品出厂口径是**任何报告都不自动发给家长**，定时发送必须由学校显式开启；
// 卡片上显示的「已开启」只是培新小学这一所学校的当前配置。
// 因此每张卡都带 source（产品内置 / 本校配置）+ productDefault（出厂口径），
// source==='school' 的卡另给 off 关闭态壳子，用于演示关掉之后这块版面长什么样。
export const SEND_DEFAULT_NOTE =
  '产品默认不向家长自动发送任何报告：新开通的学校处于全部关闭状态，定时发送要由学校管理员显式开启，且每一封都需要人确认。下面标「本校配置」的卡片是培新小学当前的设置，不是产品行为。'

export const SEND_RULES = [
  {
    key: 'weekly',
    icon: 'CalendarClock',
    title: '定时周报',
    source: 'school',
    productDefault: '出厂关闭，需学校开启',
    state: '本校已开启',
    tone: 'success',
    lines: [
      '每周一 08:00 生成上周报告，教师确认后当日 18:00 前发送',
      '本校通道：短信摘要 + 安全链接；未绑定小程序的家长自动降级为纯短信',
      '接收人：跟随学生资料设置的主要接收人',
    ],
    off: {
      state: '本校未开启',
      tone: 'muted',
      lines: [
        '不再自动生成周报，也不会有任何定时发送',
        '教师仍可在报告详情页手动生成并发起发送',
        '已生成的历史报告与发送记录保留，不受开关影响',
      ],
    },
  },
  {
    key: 'stage',
    icon: 'Flag',
    title: '阶段报告',
    source: 'school',
    productDefault: '出厂关闭，需学校开启',
    state: '本校已开启',
    tone: 'success',
    lines: [
      '阅读安排结束后次日生成结题报告',
      '班级报告发给全班家长，学生个人总结分别发给各自接收人',
      '通道跟随本校默认设置，可在发送前逐条改',
    ],
    off: {
      state: '本校未开启',
      tone: 'muted',
      lines: [
        '阅读安排结束后只在校内生成结题报告，不自动发给家长',
        '需要发时由教师在报告详情页逐条发起',
        '班级报告与个人总结的生成本身不受影响',
      ],
    },
  },
  {
    key: 'manual',
    icon: 'Send',
    title: '手动发送',
    source: 'product',
    productDefault: '出厂常开，不可关闭',
    state: '始终可用',
    tone: 'brand',
    lines: [
      '在报告详情页发起，可选通道、接收人范围与发送时间',
      '手动发送同样受本校审批流程约束，不绕过学校规则',
      '定时发送关闭时，这仍是唯一的对家长发送方式',
    ],
  },
  {
    key: 'guard',
    icon: 'ShieldCheck',
    title: '内容边界',
    source: 'product',
    productDefault: '出厂强制，学校不能放宽',
    state: '强制',
    tone: 'muted',
    lines: [
      '不发送学生原始对话，只发数据摘要与评价',
      '未经学校确认的安全事件不进入任何家长报告',
      '导出与打印本轮前端壳未实现',
    ],
  },
]

export const SEND_RECORDS = [
  {
    id: 'sd-1042',
    reportId: 'rp-parent-3101',
    studentId: 's-3101',
    channel: 'link',
    recipient: { name: '陈父', relation: '父亲', phone: '138****2210' },
    scope: 'primary',
    mode: 'manual',
    sendState: 'success',
    reach: 'read',
    at: '7月31日 20:15',
    trace: '短信 20:15 送达 · 链接 20:41 打开 · 21:02 确认阅读',
    retries: 0,
  },
  {
    id: 'sd-1043',
    reportId: 'rp-2026w31-3102',
    studentId: 's-3102',
    channel: 'sms',
    recipient: { name: '李母', relation: '母亲', phone: '137****5561' },
    scope: 'primary',
    mode: 'weekly',
    sendState: 'failed',
    reach: null,
    at: '8月3日 10:05',
    fail: '运营商拒收（疑似空号）',
    trace: '08:00 提交 · 08:01 失败 · 09:30 自动重试失败 · 10:05 手动重试失败',
    retries: 2,
  },
  {
    id: 'sd-1039',
    reportId: 'rp-c31-arrange',
    studentId: 's-3105',
    channel: 'miniapp',
    recipient: { name: '赵母', relation: '母亲', phone: '188****3312' },
    scope: 'all',
    mode: 'stage',
    sendState: 'success',
    reach: 'opened',
    at: '8月2日 20:41',
    trace: '小程序 20:41 推送 · 21:10 打开，未点「我已看完」',
    retries: 0,
  },
  {
    id: 'sd-1038',
    reportId: 'rp-parent-3301',
    studentId: 's-3301',
    channel: 'sms',
    recipient: { name: '冯母', relation: '母亲', phone: '187****9034' },
    scope: 'primary',
    mode: 'manual',
    sendState: 'success',
    reach: null,
    at: '7月26日 10:20',
    trace: '10:20 提交 · 10:20 运营商回执「已送达」',
    retries: 0,
  },
  {
    id: 'sd-1044',
    reportId: 'rp-2026w31-3105',
    studentId: 's-3105',
    channel: 'link',
    recipient: { name: '赵母', relation: '母亲', phone: '188****3312' },
    scope: 'primary',
    mode: 'weekly',
    sendState: 'queued',
    reach: null,
    at: '预计 8月4日 18:00',
    trace: '等待教师确认后进入发送队列',
    retries: 0,
  },
  {
    id: 'sd-1045',
    reportId: 'rp-c31-arrange',
    studentId: 's-3103',
    channel: 'link',
    recipient: { name: '周父', relation: '父亲', phone: '135****7723' },
    scope: 'primary',
    mode: 'stage',
    sendState: 'sending',
    reach: null,
    at: '刚刚',
    trace: '已提交网关，等待送达回执',
    retries: 0,
  },
  {
    id: 'sd-1031',
    reportId: 'rp-parent-3101',
    studentId: 's-3101',
    channel: 'link',
    recipient: { name: '李母', relation: '母亲', phone: '139****8842' },
    scope: 'all',
    mode: 'manual',
    sendState: 'success',
    reach: 'unopened',
    at: '7月31日 20:15',
    trace: '短信 20:15 送达 · 链接至今未打开',
    retries: 0,
  },
]

export function getSendRecords(workspaceId) {
  const ids = classScope(workspaceId)
  return SEND_RECORDS.filter((r) => {
    const stu = getStudent(r.studentId)
    return stu && ids.includes(stu.classId)
  })
}

export function recordStudent(record) {
  return getStudent(record.studentId)
}

// ── 模板与规则（只读，仅校级与运营）────────────────────────────
// 首版固定四类模板，不做模板编辑器；未定细节明确标注「待后续设计」

export const TEMPLATES = [
  {
    key: 'student',
    title: '学生个人阅读报告',
    icon: 'UserRound',
    tone: 'brand',
    scope: '每周一自动生成上周数据',
    blocks: ['阅读数据摘要（系统固定）', '教师评价（手写）', '阅读倾向观察（AI 草稿）'],
    receivers: '教师查看，确认后可发家长',
    pending: '个性化指标选择与自定义分段',
  },
  {
    key: 'class',
    title: '班级阅读报告',
    icon: 'Users',
    tone: 'cyan',
    scope: '阅读安排结束或每周生成',
    blocks: ['安排完成情况（系统固定）', '教学小结（手写）'],
    receivers: '教师与学校管理员',
    pending: '跨班对比区块的取数口径',
  },
  {
    key: 'school',
    title: '年级／学校汇总报告',
    icon: 'Building2',
    tone: 'violet',
    scope: '每月 1 日生成上月数据',
    blocks: ['全校数据摘要（系统固定）', '趋势观察（AI 草稿）'],
    receivers: '学校管理员，不发家长',
    pending: '是否向教育局导出汇总口径',
  },
  {
    key: 'parent',
    title: '家长触达摘要',
    icon: 'Heart',
    tone: 'accent',
    scope: '跟随学生个人报告或手动发起',
    blocks: ['这段时间读了什么（系统固定）', '老师想对家长说（手写）', '亲子共读建议（AI 草稿）'],
    receivers: '监护人，按接收人范围发送',
    pending: '小程序版式与多子女家长的合并推送',
  },
]

// Plan_2 P8：审批流程、定时时刻、通道全是**本校配置**，不是产品默认。
// 产品默认口径单独写在 productDefault 里，页面上要与本校配置分开显示。
export const TEMPLATE_RULES = {
  flow: 'confirm',
  productDefaultFlow: 'confirm',
  flowNote:
    '培新小学当前规则：教师确认后发送。切换规则会影响全校所有报告，只有学校管理员与平台运营可以改。',
  flowDefaultNote: '产品默认同样是「教师确认后发送」，且不提供「生成即自动发送家长」这种选项。',
  scheduleNote: '以下时刻表是培新小学的配置；产品默认全部关闭，新学校开通后不会自动跑任何定时任务。',
  schedule: [
    ['周报生成', '每周一 08:00'],
    ['周报发送', '教师确认后当日 18:00 前'],
    ['阶段报告', '阅读安排结束次日 09:00'],
    ['月度汇总', '每月 1 日 08:00'],
  ],
  channelNote: '通道由学校启用；产品不预设任何一条对家长的通道，未启用时报告只在校内可见。',
  channels: ['短信摘要 + 安全链接（本校默认）', '小程序报告（已绑定家长）', '纯短信（降级通道）'],
  disclaimer: 'AI 生成内容仅供参考，不作为学生评价依据；教师确认前不会发送给家长。',
  pending: ['模板正文可视化编辑', '按学校自定义指标口径', '家长端阅读回执的统计维度'],
}
