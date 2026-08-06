// 运营维护数据（仅平台运营工作空间可见）。
//
// 拍板要点（Codex 第 78 轮）：五区 = 多学校运行 / 失败任务及重试 / 审计与原文访问 /
// 系统异常 / 反馈与跨学校内容异常；「模型与成本」在这里只放摘要卡，点击跳
// #/console/usage/models，不在本页重复实现那张技术表。

// 五区（模型与成本不算一区，只在顶部放摘要卡跳 #/console/usage/models）
export const OPS_SECTIONS = [
  { key: 'schools', label: '多学校运行', icon: 'Building2' },
  { key: 'tasks', label: '失败任务与重试', icon: 'RefreshCcwDot' },
  { key: 'audit', label: '审计与原文访问', icon: 'FileSearch' },
  { key: 'incidents', label: '系统异常', icon: 'ServerCrash' },
  { key: 'feedback', label: '反馈与跨校内容异常', icon: 'MessageSquareWarning' },
]

// 注意：每一项都要能在下面的表里数出来，或者在 note 里把差额说清楚
// （Stage 4 自检最常抛错的就是「KPI 与列表两套数字」）
export const OPS_KPIS = [
  { key: 'schools', label: '接入学校', value: '12', unit: '所', note: '9 所已开学使用；下表只列主要 5 所' },
  { key: 'students', label: '活跃学生', value: '1,842', unit: '人', note: '近 7 天有阅读记录，含未列出的学校' },
  { key: 'tasks', label: '待处理失败任务', value: '4', unit: '个', note: '2 个可直接重试，1 个重试中，1 个需人工' },
  { key: 'incidents', label: '未关闭系统异常', value: '2', unit: '件', note: '1 件处理中（P2）、1 件观察中（P3）' },
]

export const SCHOOLS = [
  {
    id: 'peixin',
    name: '培新小学',
    students: 486,
    classes: 14,
    monthMinutes: 29140,
    state: 'normal',
    contact: '教务处 · 王主任',
    note: '主试点校，8 月 10 日进校真实设备测试',
  },
  {
    id: 'shiyan',
    name: '第二实验小学',
    students: 372,
    classes: 11,
    monthMinutes: 21480,
    state: 'normal',
    contact: '信息中心 · 刘老师',
    note: '仅三、四年级开放',
  },
  {
    id: 'wenhui',
    name: '文汇小学',
    students: 254,
    classes: 8,
    monthMinutes: 9620,
    state: 'warn',
    contact: '教务处 · 陈老师',
    note: '短信通道被本地运营商限流，家长触达成功率 82%',
  },
  {
    id: 'chengnan',
    name: '城南小学',
    students: 198,
    classes: 6,
    monthMinutes: 7310,
    state: 'normal',
    contact: '德育处 · 赵老师',
    note: '尚未启用家长小程序',
  },
  {
    id: 'yuquan',
    name: '玉泉小学',
    students: 132,
    classes: 5,
    monthMinutes: 0,
    state: 'idle',
    contact: '校办 · 周老师',
    note: '账号已开通，等 9 月开学导入班级',
  },
]

export const SCHOOL_STATE = {
  normal: { label: '运行正常', tone: 'success' },
  warn: { label: '需关注', tone: 'warning' },
  idle: { label: '未启用', tone: 'muted' },
}

// 模型与成本只放摘要，明细在 #/console/usage/models
export const MODEL_SUMMARY = {
  providers: [
    { name: '豆包', state: 'ok', note: '主用，回复正常' },
    { name: 'DeepSeek', state: 'ok', note: '备用，自动切换' },
    { name: 'GPT', state: 'degraded', note: '延迟偏高，已降权' },
  ],
  cost: { value: '4,182', unit: '元', note: '本月已用 / 预算 6,800 元', percent: 61 },
  fail: { value: '0.42', unit: '%', note: '近 7 天调用失败率，已自动重试成功 96%' },
}

export const PROVIDER_STATE = {
  ok: { label: '正常', tone: 'success' },
  degraded: { label: '降级', tone: 'warning' },
  down: { label: '不可用', tone: 'danger' },
}

export const FAILED_TASKS = [
  {
    id: 'tk-9921',
    type: '家长报告发送',
    target: '培新小学 · 三年级（1）班 · 李知远',
    at: '8月3日 10:05',
    reason: '运营商拒收（疑似空号），已自动重试 2 次',
    retries: 2,
    state: 'failed',
    canRetry: true,
    fix: '需要教师先在学生资料里更正监护人号码，否则重试仍会失败',
  },
  {
    id: 'tk-9918',
    type: '短信通道投递',
    target: '文汇小学 · 批量周报 38 条',
    at: '8月3日 08:12',
    reason: '本地运营商限流，超出每分钟条数',
    retries: 1,
    state: 'retrying',
    canRetry: false,
    fix: '已自动降速排队，预计 30 分钟内补发完成',
  },
  {
    id: 'tk-9903',
    type: '报告生成',
    target: '六年级（1）班 · 许听澜 · 第 31 周',
    at: '8月3日 06:12',
    reason: '取数超时（阅读明细表锁等待）',
    retries: 0,
    state: 'failed',
    canRetry: true,
    fix: '直接重试即可，重试会重新取数而不是复用旧结果',
  },
  {
    id: 'tk-9887',
    type: '书目导入解析',
    target: '第二实验小学 · 《小王子》EPUB',
    at: '8月2日 15:40',
    reason: '目录结构缺失，无法自动分章',
    retries: 3,
    state: 'blocked',
    canRetry: false,
    fix: '需要管理员改用纯文本导入并手动确认分章方式',
  },
]

export const TASK_STATE = {
  failed: { label: '失败待处理', tone: 'danger' },
  retrying: { label: '重试中', tone: 'warning' },
  blocked: { label: '需人工介入', tone: 'muted' },
}

// 审计：普通操作自动记录修改前后；原文访问与彻底清除属极高风险，必须填用途
export const AUDITS = [
  {
    at: '8月4日 08:20',
    actor: '林老师',
    role: '班级教师',
    action: '查看安全事件扩展上下文',
    target: '赵星禾 · SE-20260803-0007',
    purpose: '确认最近一周是否还有类似表达',
    level: 'high',
  },
  {
    at: '8月3日 14:02',
    actor: '培新小学 · 学校管理员',
    role: '学校管理',
    action: '查看私密会话原文',
    target: '陈嘉言 · 私密会话 #0402',
    purpose: '安全事件关联复核，已通知学生监护人',
    level: 'high',
  },
  {
    at: '8月3日 11:20',
    actor: '平台运营 · 林',
    role: '平台运营',
    action: '调整学校短信通道限速',
    target: '文汇小学',
    purpose: '——',
    level: 'normal',
    diff: '每分钟 60 条 → 20 条',
  },
  {
    at: '8月2日 19:50',
    actor: '教务处 · 王主任',
    role: '学校管理',
    action: '撤回班级报告',
    target: '六年级（2）班 · 第 30 周班级报告',
    purpose: '——',
    level: 'normal',
    diff: '状态 待审核 → 已撤回',
  },
  {
    at: '7月30日 09:15',
    actor: '平台运营 · 林',
    role: '平台运营',
    action: '彻底清除书目历史版本',
    target: '《山海经里的怪兽》v1（版权方要求）',
    purpose: '版权方书面要求下架并清除旧版本，影响 3 条历史引用',
    level: 'high',
  },
]

export const AUDIT_LEVEL = {
  high: { label: '极高风险', tone: 'danger' },
  normal: { label: '常规', tone: 'muted' },
}

export const INCIDENTS = [
  {
    id: 'inc-0231',
    level: 'P2',
    tone: 'warning',
    title: '文汇小学短信触达成功率下降至 82%',
    at: '8月3日 07:40',
    impact: '影响 1 所学校的家长周报，学生端与教师端不受影响',
    state: 'open',
    action: '已降速排队并联系运营商，等待白名单审批',
  },
  {
    id: 'inc-0229',
    level: 'P3',
    tone: 'muted',
    title: 'GPT 通道 P95 延迟由 1.4s 升至 3.2s',
    at: '8月2日 21:10',
    impact: '已自动降权到备用模型，学生端无感知',
    state: 'watching',
    action: '观察 24 小时，若未恢复则暂时停用该通道',
  },
  {
    id: 'inc-0224',
    level: 'P1',
    tone: 'danger',
    title: '阅读明细写库延迟导致 3 份周报生成超时',
    at: '8月1日 06:12',
    impact: '3 份学生周报延迟 40 分钟生成，无数据丢失',
    state: 'closed',
    action: '已扩容写库连接池并给报告生成加重试；8月1日 07:02 恢复',
  },
]

export const INCIDENT_STATE = {
  open: { label: '处理中', tone: 'warning' },
  watching: { label: '观察中', tone: 'brand' },
  closed: { label: '已关闭', tone: 'success' },
}

export const FEEDBACK = [
  {
    id: 'fb-118',
    kind: '跨校内容异常',
    from: '第二实验小学 · 刘老师',
    at: '8月3日 16:20',
    text: '学校社区里有一条心得把《西游记》的情节写成了另一本书的内容，怀疑是学生复制了别校的分享。',
    state: 'checking',
    note: '已定位到同一条文本在两所学校出现，正在核对来源',
  },
  {
    id: 'fb-115',
    kind: '产品反馈',
    from: '培新小学 · 林老师',
    at: '8月2日 09:05',
    text: '希望班级报告能一次导出全班，现在只能一份一份看。',
    state: 'planned',
    note: '导出能力本轮前端壳未实现；批量导出涉及隐私规则，需要先定边界',
  },
  {
    id: 'fb-109',
    kind: '产品反馈',
    from: '城南小学 · 赵老师',
    at: '7月30日 14:40',
    text: '护眼提醒对低年级来说间隔太长，建议 20 分钟就提醒一次。',
    state: 'done',
    note: '已支持按班级调整限制，7月31日上线',
  },
]

export const FEEDBACK_STATE = {
  checking: { label: '核查中', tone: 'warning' },
  planned: { label: '已排期', tone: 'brand' },
  done: { label: '已处理', tone: 'success' },
}
