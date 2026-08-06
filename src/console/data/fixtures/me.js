// 个人主页数据（交付说明 §5.1）：头像姓名联系方式资料 +
// 密码管理 / 可信辅助账号 / 个性化 / 通知偏好 / 帮助与反馈五组。
//
// 「可信辅助账号」的权威定义（Codex 第 78 轮）：
// 忘记密码时可以请求其确认身份并放行「一次性登录」的预设可信人员；
// 不拥有代操作权限，也看不到密码。关系持续到主动移除、离校或账号停用，不设复杂有效期。

export const PROFILE = {
  name: '林老师',
  fullName: '林亦晨',
  account: 'lin.yc@peixin.edu',
  phone: '138****4402',
  school: '培新小学',
  duty: '三年级（1）班班主任 · 语文',
  joinedAt: '2021-09-01',
  lastLogin: '今天 08:12 · Windows · 校内网络',
  workspaceCount: 5,
}

export const SECURITY = {
  passwordChangedAt: '2026-06-18',
  passwordAge: '47 天前修改',
  strength: { label: '中等', tone: 'warning', note: '建议加入符号，或改用 12 位以上口令' },
  loginRecords: [
    { at: '今天 08:12', device: 'Windows · Chrome', place: '校内网络', state: 'ok' },
    { at: '8月3日 20:40', device: 'Android 平板 · 教师端', place: '家庭网络', state: 'ok' },
    { at: '8月1日 07:55', device: 'Windows · Chrome', place: '校内网络', state: 'ok' },
  ],
  assistLogins: [{ at: '7月12日 09:20', by: '周老师', device: 'Windows · Chrome', note: '忘记密码，辅助登录一次' }],
}

// 状态三档：待确认（对方还没同意）／有效／已停用（离校或账号停用）
export const TRUSTED_STATE = {
  pending: { label: '待确认', tone: 'warning', note: '对方尚未确认，暂时不能用于辅助登录' },
  active: { label: '有效', tone: 'success', note: '可在忘记密码时请求其放行一次性登录' },
  disabled: { label: '已停用', tone: 'muted', note: '对方已离校或账号停用，关系自动失效' },
}

export const TRUSTED = [
  {
    id: 'ta-1',
    name: '周老师',
    initial: '周',
    tone: 'brand',
    duty: '三年级（3）班班主任 · 语文',
    school: '培新小学 · 三年级组',
    state: 'active',
    addedAt: '2025-09-10',
    lastAssist: '7月12日 09:20',
  },
  {
    id: 'ta-2',
    name: '王主任',
    initial: '王',
    tone: 'cyan',
    duty: '教务处主任',
    school: '培新小学 · 教务处',
    state: 'active',
    addedAt: '2025-09-10',
    lastAssist: '——',
  },
  {
    id: 'ta-3',
    name: '张年级组长',
    initial: '张',
    tone: 'violet',
    duty: '三年级年级组长',
    school: '培新小学 · 三年级组',
    state: 'pending',
    addedAt: '今天 08:30',
    lastAssist: '——',
  },
  {
    id: 'ta-4',
    name: '孙老师',
    initial: '孙',
    tone: 'muted',
    duty: '六年级（3）班班主任',
    school: '培新小学 · 六年级组',
    state: 'disabled',
    addedAt: '2024-09-05',
    lastAssist: '2025年3月11日',
    disabledNote: '该教师已调离本校，关系自动失效',
  },
]

// ── 收到的辅助请求（Plan_2 P3，Codex 第 82 轮）──────────────────────
// 被请求的教师登录后要收到全局小窗，可以就地同意或拒绝；个人主页保留完整列表。
// 四种状态：待确认 / 已同意 / 已拒绝 / 已超时。**超时即失败，绝不自动同意。**
export const ASSIST_TIMEOUT_LABEL = '10 分钟内未确认自动失效'
// 演示用倒计时秒数：真实环境是 10 分钟，壳里缩短到 90 秒方便验收看到超时态
export const ASSIST_DEMO_COUNTDOWN = 90

export const ASSIST_REQUEST_STATE = {
  pending: { label: '待确认', tone: 'warning' },
  approved: { label: '已同意', tone: 'success' },
  rejected: { label: '已拒绝', tone: 'danger' },
  expired: { label: '已超时失效', tone: 'muted' },
}

export const ASSIST_REQUESTS = [
  {
    id: 'ar-1',
    name: '陈老师',
    initial: '陈',
    tone: 'cyan',
    account: 'chen.ry@peixin.edu',
    duty: '三年级（2）班班主任 · 语文',
    device: 'Android 平板 · 教师端',
    at: '刚刚',
    state: 'pending',
    reason: '忘记密码，希望放行一次登录',
  },
  {
    id: 'ar-2',
    name: '吴老师',
    initial: '吴',
    tone: 'brand',
    account: 'wu.jm@peixin.edu',
    duty: '四年级（1）班班主任 · 语文',
    device: 'Windows · Chrome',
    at: '8月2日 14:20',
    state: 'approved',
    handledAt: '8月2日 14:22',
    reason: '换新电脑后忘记密码',
  },
  {
    id: 'ar-3',
    name: '未知设备',
    initial: '？',
    tone: 'muted',
    account: 'lin.yc@peixin.edu',
    duty: '申请账号与你相同，但设备不是你的常用设备',
    device: 'iOS · Safari（陌生设备）',
    at: '7月28日 23:41',
    state: 'rejected',
    handledAt: '7月28日 23:42',
    reason: '深夜陌生设备发起，已拒绝并已提醒学校管理员',
  },
  {
    id: 'ar-4',
    name: '郑老师',
    initial: '郑',
    tone: 'violet',
    account: 'zheng.hl@peixin.edu',
    duty: '五年级（4）班班主任',
    device: 'Windows · Edge',
    at: '7月20日 09:05',
    state: 'expired',
    handledAt: '7月20日 09:15',
    reason: '10 分钟内没有人确认，请求自动失效（不会自动放行）',
  },
]

export const TRUSTED_RULES = [
  '可信辅助账号只能在你忘记密码时放行一次登录，不能代替你操作，也看不到你的密码。',
  '放行时对方会看到申请账号、设备和时间，必须明确确认才会签发一次性凭证。',
  '只能从本校账号里添加；学生端的候选教师由班级师生关系自动产生，学生不能自己添加陌生教师。',
  '关系不设有效期，持续到主动移除、离校或账号停用为止。',
]

// 通知偏好：站内必发（安全相关不允许关闭），短信可选
export const NOTIFY_PREFS = [
  {
    key: 'safety',
    label: '安全事件',
    desc: '你是责任人或被通知人时立即提醒，涉事回避的事件不会通知你',
    inApp: true,
    sms: true,
    locked: true,
    lockNote: '安全相关通知不可关闭',
  },
  {
    key: 'privacy',
    label: '隐私访问申请',
    desc: '学生私密会话的查看申请、超时默认同意提醒',
    inApp: true,
    sms: false,
    locked: false,
  },
  {
    key: 'community',
    label: '社区待审核',
    desc: '本班学生提交的心得进入待审核队列时提醒',
    inApp: true,
    sms: false,
    locked: false,
  },
  {
    key: 'report',
    label: '报告待确认与发送失败',
    desc: '周报生成完成、需要确认发送，或家长触达失败',
    inApp: true,
    sms: true,
    locked: false,
  },
  {
    key: 'eyecare',
    label: '护眼超限',
    desc: '本班学生当日用眼超过上限时汇总提醒（每天最多一条）',
    inApp: true,
    sms: false,
    locked: false,
  },
  {
    key: 'quota',
    label: '对话额度触限',
    desc: '本班学生额度用尽，AI 自动停用到下次重置',
    inApp: false,
    sms: false,
    locked: false,
  },
]

export const HELP_LINKS = [
  { key: 'guide', icon: 'BookOpenCheck', label: '教师使用指引', desc: '共读安排、课堂同步与报告确认的操作说明' },
  { key: 'privacy', icon: 'ShieldCheck', label: '隐私与安全说明', desc: '哪些数据你能看、看了会留下什么记录' },
  { key: 'feedback', icon: 'MessageSquarePlus', label: '提交产品反馈', desc: '反馈会进入运营维护的反馈列表' },
  { key: 'contact', icon: 'LifeBuoy', label: '联系学校管理员', desc: '账号、班级与权限问题先找学校管理员' },
]
