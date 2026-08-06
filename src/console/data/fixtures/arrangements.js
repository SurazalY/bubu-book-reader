// 阅读安排：列表、详情与创建弹窗共用。三种类型对应首页的标签色。

export const ARRANGE_TYPES = [
  { key: 'class', label: '班级共读', tone: 'brand', desc: '全班同一进度，教师可开课堂同步' },
  { key: 'free', label: '自由阅读', tone: 'violet', desc: '学生自选时间，只约束起止与书目' },
  { key: 'guide', label: '导读课', tone: 'cyan', desc: '教师带读，配合章节讲解与提问' },
]

export const ARRANGE_STATUS = {
  running: { label: '进行中', tone: 'success' },
  upcoming: { label: '未开始', tone: 'brand' },
  done: { label: '已结束', tone: 'muted' },
  paused: { label: '已暂停', tone: 'warning' },
}

export const ARRANGEMENTS = [
  {
    id: 'a-1',
    bookId: 'b-caofangzi',
    title: '草房子',
    chapter: '第 3 章',
    type: 'class',
    status: 'running',
    classIds: ['c3-1'],
    classNames: ['三年级（1）班'],
    owner: '林老师',
    start: '2026-05-18',
    end: '2026-05-25',
    startTime: '09:00',
    createdAt: '2026-05-15',
    joined: 30,
    total: 32,
    progress: 62,
    note: '读到第 3 章结束，课上讨论「秃鹤为什么要跑」。',
    milestones: [
      { at: '5月18日', text: '安排开始，30 人已加入' },
      { at: '5月20日', text: '课堂同步一次，持续 38 分钟' },
      { at: '5月22日', text: '18 人完成第 3 章' },
    ],
    classProgress: [{ classId: 'c3-1', name: '三年级（1）班', done: 18, total: 32, percent: 62 }],
  },
  {
    id: 'a-2',
    bookId: 'b-xialuo',
    title: '夏洛的网',
    chapter: '第 1-2 章',
    type: 'free',
    status: 'running',
    classIds: ['c3-2'],
    classNames: ['三年级（2）班'],
    owner: '林老师',
    start: '2026-05-19',
    end: '2026-05-26',
    startTime: '10:00',
    createdAt: '2026-05-16',
    joined: 28,
    total: 31,
    progress: 44,
    note: '自由阅读，读完在社区写一句最喜欢的话。',
    milestones: [
      { at: '5月19日', text: '安排开始，28 人已加入' },
      { at: '5月21日', text: '社区收到 12 条分享，其中 1 条待审核' },
    ],
    classProgress: [{ classId: 'c3-2', name: '三年级（2）班', done: 14, total: 31, percent: 44 }],
  },
  {
    id: 'a-3',
    bookId: 'b-kunchongji',
    title: '昆虫记',
    chapter: '精读导读',
    type: 'guide',
    status: 'upcoming',
    classIds: ['c3-3'],
    classNames: ['三年级（3）班'],
    owner: '周老师',
    start: '2026-05-25',
    end: '2026-06-01',
    startTime: '14:00',
    createdAt: '2026-05-17',
    joined: 26,
    total: 30,
    progress: 0,
    note: '导读课，重点讲观察方法；课前不要求预读。',
    milestones: [{ at: '5月17日', text: '安排创建，等待开始' }],
    classProgress: [{ classId: 'c3-3', name: '三年级（3）班', done: 0, total: 30, percent: 0 }],
  },
  {
    id: 'a-4',
    bookId: 'b-xiyouji',
    title: '西游记（少年版）',
    chapter: '片段赏析',
    type: 'class',
    status: 'running',
    classIds: ['c6-1', 'c6-2'],
    classNames: ['六年级（1）班', '六年级（2）班'],
    owner: '陈老师',
    start: '2026-05-15',
    end: '2026-05-29',
    startTime: '09:00',
    createdAt: '2026-05-12',
    joined: 64,
    total: 69,
    progress: 71,
    note: '两个班共用一套安排，（2）班进度慢一周属正常。',
    milestones: [
      { at: '5月15日', text: '安排开始，两个班共 64 人加入' },
      { at: '5月19日', text: '（1）班课堂同步 2 次' },
      { at: '5月22日', text: '（1）班 82%，（2）班 58%' },
    ],
    classProgress: [
      { classId: 'c6-1', name: '六年级（1）班', done: 29, total: 35, percent: 82 },
      { classId: 'c6-2', name: '六年级（2）班', done: 20, total: 34, percent: 58 },
    ],
  },
  {
    id: 'a-5',
    bookId: 'b-anshengtonghua',
    title: '安徒生童话',
    chapter: '每周一篇',
    type: 'free',
    status: 'done',
    classIds: ['c3-1'],
    classNames: ['三年级（1）班'],
    owner: '林老师',
    start: '2026-04-06',
    end: '2026-05-11',
    startTime: '08:40',
    createdAt: '2026-04-02',
    joined: 31,
    total: 32,
    progress: 100,
    note: '已结束，报告已生成并发送给家长。',
    milestones: [
      { at: '4月6日', text: '安排开始' },
      { at: '5月11日', text: '安排结束，31 人完成' },
      { at: '5月12日', text: '生成班级阅读报告 1 份' },
    ],
    classProgress: [{ classId: 'c3-1', name: '三年级（1）班', done: 31, total: 32, percent: 100 }],
  },
  {
    id: 'a-6',
    bookId: 'b-jianai',
    title: '简·爱（节选）',
    chapter: '第 5 章',
    type: 'guide',
    status: 'paused',
    classIds: ['c6-3'],
    classNames: ['六年级（3）班'],
    owner: '孙老师',
    start: '2026-05-11',
    end: '2026-05-18',
    startTime: '15:20',
    createdAt: '2026-05-08',
    joined: 29,
    total: 33,
    progress: 35,
    note: '因期末复习临时暂停，恢复后进度不清零。',
    pauseNote: '2026-05-16 由孙老师暂停，原因：期末复习周',
    milestones: [
      { at: '5月11日', text: '安排开始' },
      { at: '5月16日', text: '安排暂停，进度保留在 35%' },
    ],
    classProgress: [{ classId: 'c6-3', name: '六年级（3）班', done: 11, total: 33, percent: 35 }],
  },
]

const ARRANGE_SCOPE = {
  'class-teacher': ['a-1', 'a-2', 'a-3', 'a-5'],
  'grade-group': ['a-4', 'a-6'],
  'grade-admin': ['a-4', 'a-6'],
  'school-admin': ARRANGEMENTS.map((a) => a.id),
  'platform-ops': ARRANGEMENTS.map((a) => a.id),
}

export function getArrangements(workspaceId) {
  const ids = ARRANGE_SCOPE[workspaceId] || ARRANGE_SCOPE['class-teacher']
  return ARRANGEMENTS.filter((a) => ids.includes(a.id))
}

export function getArrangement(planId) {
  return ARRANGEMENTS.find((a) => a.id === planId) || null
}

// 教师阅读器的课堂同步：三种状态 + 参与人数构成
export const SYNC_STATES = {
  off: { label: '未开始同步', tone: 'muted' },
  locked: { label: '已锁定书籍', tone: 'brand' },
  syncing: { label: '正在同步页面', tone: 'danger' },
}

export const SYNC_SAMPLE = {
  normal: 26,
  abnormal: 3,
  offline: 1,
  duration: '00:38:12',
  page: 12,
  note: '同步中学生端只能停在教师当前页；异常多为切到后台，掉线会在 30 秒后自动重连。',
}
