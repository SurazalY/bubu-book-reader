// 个人主页、书单、设置的演示数据（前端壳专用，**不是真实业务数据**）。
//
// 三条口径写在最前面：
//   1. 所有阅读数字都必须和 data/library.js 的 READING_SUMMARY 对得上，
//      周 ≤ 月 ≤ 年 = 累计总量，否则学生在两个页面会看到互相矛盾的数字。
//   2. 学生端不出现 Token、模型价格、费用；额度只讲剩余次数、用量比例与恢复时间（红线 9）。
//   3. 安全事件对学生完全不可见：教师交互只有通知、书目安排、审核结果、访问申请与访问记录，
//      没有任何报警、风险等级、上报字样（红线 8）。
import { READING_SUMMARY } from './library.js'

// ——— 阅读足迹：周／月／年三个周期 ———
// 年的总量刻意等于 READING_SUMMARY.totalMinutes（1789 分钟），
// 月是年的其中一段，周又是月的其中一段，三级之间不许出现「周比月还多」这种矛盾。
export const FOOTPRINT = {
  week: {
    key: 'week',
    label: '本周',
    minutes: 312,
    days: READING_SUMMARY.recentDays,
    finished: 0,
    unit: '天',
    note: '本周从周一算起，只统计有效阅读。',
    bars: [
      { label: '一', minutes: 62 },
      { label: '二', minutes: 21 },
      { label: '三', minutes: 55 },
      { label: '四', minutes: 74 },
      { label: '五', minutes: 38 },
      { label: '六', minutes: 62 },
      { label: '日', minutes: 0 },
    ],
  },
  month: {
    key: 'month',
    label: '本月',
    minutes: 1043,
    days: 19,
    finished: 1,
    unit: '天',
    note: '五月共读期内的阅读都算在这里。',
    bars: [
      { label: '第 1 周', minutes: 236 },
      { label: '第 2 周', minutes: 198 },
      { label: '第 3 周', minutes: 174 },
      { label: '第 4 周', minutes: 123 },
      { label: '本周', minutes: 312 },
    ],
  },
  year: {
    key: 'year',
    label: '今年',
    minutes: READING_SUMMARY.totalMinutes,
    days: 47,
    finished: READING_SUMMARY.finishedBooks,
    unit: '天',
    note: '今年以来的全部有效阅读，等于你的累计阅读时间。',
    bars: [
      { label: '1 月', minutes: 132 },
      { label: '2 月', minutes: 96 },
      { label: '3 月', minutes: 246 },
      { label: '4 月', minutes: 272 },
      { label: '5 月', minutes: 1043 },
      { label: '6 月', minutes: 0 },
    ],
  },
}

export const FOOTPRINT_PERIODS = ['week', 'month', 'year']

// 有效阅读与护眼是两套口径，页面上必须分开解释，不能混成一个数字
export const READING_GLOSSARY = [
  {
    term: '有效阅读时间',
    desc: '真实翻页与停留才计入。打开书放着不读、快速划过都不算。',
    icon: 'BookOpenCheck',
  },
  {
    term: '护眼时长',
    desc: '只要屏幕上开着书就在计时，用来提醒你休息，和有效阅读是两回事。',
    icon: 'Eye',
  },
]

// ——— 护眼与连续使用（规格 §11：本次连续、最大连续、今日累计、每日限制、下次恢复）———
export const EYE_CARE = {
  current: 26, // 本次已连续阅读分钟
  maxStreak: 45, // 学校设定的单次最长连续阅读
  today: 82, // 今日累计屏幕时长
  dailyLimit: 150, // 每日上限
  restMinutes: 10, // 需要休息多久
  nextRecoverAt: '明天早上 6:00',
  note: '到达单次上限后会请你休息一下，休息结束就能继续读。书签、摘录和批注都不会丢。',
}

// 强制休息演示态（Stage 4 让位到本 Stage）：不是报错，是一次温和的中断
export const REST_NOTICE = {
  title: '先休息 10 分钟吧',
  desc: '你已经连续读了 45 分钟，到了学校设置的单次上限。看看远处，等一会儿就能接着读。',
  stillCan: '休息期间你的阅读位置、书签和摘录都保留着，回来就在原处。',
  resumeAt: '10 分钟后可以继续',
}

// ——— 阅读等级与非竞争徽章 ———
// 等级只表达自己的成长：没有同学排行、没有签到、没有付费特权（规格 §10）。
export const LEVELS = [
  { value: 5, title: '常读者', at: 900 },
  { value: 6, title: '书友', at: 1300 },
  { value: 7, title: '爱书人', at: 1700 },
  { value: 8, title: '深读者', at: 2200 },
  { value: 9, title: '书海旅人', at: 2900 },
]

export const LEVEL_NOTE = '等级只看你自己的有效阅读时间，不和任何同学比较，也不会因为等级得到额外权限。'

export const BADGES = [
  {
    id: 'first-finish',
    name: '读完第一本',
    icon: 'BookCheck',
    got: true,
    at: '4 月 21 日',
    desc: '把一本书从头读到最后一页。',
  },
  {
    id: 'quiet-hour',
    name: '安静的一小时',
    icon: 'Hourglass',
    got: true,
    at: '5 月 6 日',
    desc: '一次连续有效阅读满 60 分钟。',
  },
  {
    id: 'ten-marks',
    name: '摘录十句',
    icon: 'Highlighter',
    got: true,
    at: '5 月 12 日',
    desc: '收藏满 10 条自己喜欢的原文。',
  },
  {
    id: 'class-together',
    name: '一起读完',
    icon: 'Users',
    got: true,
    at: '4 月 30 日',
    desc: '完整参与一次班级共读。',
  },
  {
    id: 'own-words',
    name: '写下自己的话',
    icon: 'PenLine',
    got: false,
    need: '把一篇心得投稿到共读社区并通过老师查看',
    desc: '心得被老师通过后就会点亮。',
  },
  {
    id: 'wide-reader',
    name: '走得更远',
    icon: 'Compass',
    got: false,
    need: '读完 3 种不同体裁的书（现在 2 种）',
    desc: '故事、科普、国学各读完一本。',
  },
]

export const BADGE_NOTE = '徽章只记录你做过的事，不排名、不比较，也不会因为没拿到就少什么。'

// ——— 教师交互（通知、书目安排、审核结果、隐私访问申请、访问记录）———
// 红线 8：这里不出现任何安全事件、报警或风险等级。
export const TEACHER_NOTICES = [
  {
    id: 'n-01',
    kind: 'plan',
    icon: 'CalendarDays',
    from: '林老师',
    title: '《草房子》共读读到第 150 页',
    body: '这周把「桑桑的夏天」这一章读完，下周三课上一起说说你最记得的一句话。',
    at: '今天 08:12',
    unread: true,
    to: '/student/books/caofangzi',
    toLabel: '去看这本书',
  },
  {
    id: 'n-02',
    kind: 'review',
    icon: 'BadgeCheck',
    from: '林老师',
    title: '你的心得已经通过',
    body: '《草房子》那篇「灯不一定要照路」写得很好，已经放到班级社区了。',
    at: '今天 07:40',
    unread: true,
    to: '/student/me/posts',
    toLabel: '看我的发布',
  },
  {
    id: 'n-03',
    kind: 'review',
    icon: 'Undo2',
    from: '周老师',
    title: '有一篇需要你再改改',
    body: '《稻草人》那篇里有一段不是书里的原话，把引用改成你自己摘录过的句子就可以再交一次。',
    at: '昨天 16:05',
    unread: true,
    to: '/student/me/posts',
    toLabel: '去修改',
  },
  {
    id: 'n-04',
    kind: 'class',
    icon: 'Radio',
    from: '周老师',
    title: '课堂共读已经结束',
    body: '周三那节《稻草人》共读结束了，你现在可以自由翻这本书的任何一页。',
    at: '前天 10:30',
    unread: false,
    to: '/student/books/daocaoren',
    toLabel: '去看这本书',
  },
  {
    id: 'n-05',
    kind: 'plan',
    icon: 'CalendarDays',
    from: '林老师',
    title: '下个月的共读书目',
    body: '六月我们读《青铜葵花》，可以先把书加到自己的书单里。',
    at: '5 月 15 日',
    unread: false,
    to: '/student/books/qingtong-kuihua',
    toLabel: '去看这本书',
  },
]

// 私密会话访问申请：申请人、用途、时间、涉及会话与超时规则都要写清楚
export const PRIVACY_REQUESTS = [
  {
    id: 'r-01',
    teacher: '林老师',
    role: '班主任',
    purpose: '想看看你在《草房子》里问竹娃的那段，课上一起讲讲',
    chatTitle: '桑桑为什么把碗摔了',
    at: '今天 09:15',
    expireAt: '5 月 22 日 09:15',
    expireRule: '48 小时内没有处理，这次申请就自动失效，老师看不到。',
    state: 'pending',
  },
  {
    id: 'r-02',
    teacher: '周老师',
    role: '语文老师',
    purpose: '准备下周的共读讨论，想看你对稻草人结局的想法',
    chatTitle: '稻草人最后怎么了',
    at: '昨天 15:02',
    expireAt: '5 月 21 日 15:02',
    expireRule: '48 小时内没有处理，这次申请就自动失效，老师看不到。',
    state: 'pending',
  },
]

export const PRIVACY_HISTORY = [
  {
    id: 'h-01',
    teacher: '林老师',
    purpose: '课堂讨论准备',
    chatTitle: '草房子里的纸月是谁',
    at: '5 月 12 日 14:20',
    state: 'agreed',
    viewedAt: '5 月 12 日 14:26',
  },
  {
    id: 'h-02',
    teacher: '周老师',
    purpose: '想了解你读稻草人时的疑问',
    chatTitle: '私密对话 · 稻草人',
    at: '5 月 8 日 11:00',
    state: 'refused',
  },
  {
    id: 'h-03',
    teacher: '林老师',
    purpose: '共读总结整理',
    chatTitle: '三字经背不下来怎么办',
    at: '4 月 29 日 09:40',
    state: 'expired',
  },
]

export const PRIVACY_RULES = [
  '老师默认看不到你设为私密的对话。',
  '老师要看必须先申请并写清用途，你可以同意或拒绝。',
  '同意之后老师什么时候看过，都会记在下面的访问记录里。',
  '一直没处理的申请会按学校的超时规则自动失效。',
]

// ——— 我的心得（可持续编辑，投稿要二次确认并选书）———
export const SEED_NOTES = [
  {
    id: 'note-01',
    title: '灯不一定要照路',
    bookId: 'caofangzi',
    text:
      '桑桑把灯挂在河边的时候，我以为他是怕别人看不见路。后来才明白，他只是想让河上的人知道岸上有人在看着。\n有人在看着，好像就没那么怕了。',
    updatedAt: '今天 12:52',
    words: 78,
    posted: true,
    aiAssisted: false,
  },
  {
    id: 'note-02',
    title: '稻草人为什么不能动',
    bookId: 'daocaoren',
    text:
      '稻草人什么都看得见，可是什么都做不了。我一开始觉得它没用，读到后面又觉得它很难受。\n看得见却帮不上，比什么都看不见还难。',
    updatedAt: '昨天 20:30',
    words: 64,
    posted: false,
    aiAssisted: false,
  },
  {
    id: 'note-03',
    title: '安徒生里我最喜欢的三篇',
    bookId: 'andersen',
    text:
      '《海的女儿》《丑小鸭》《卖火柴的小女孩》。\n这三篇都有一点难过，但难过完又想再读一遍。竹娃帮我把三篇的相同点理成了一句话，我照着改了改：它们讲的都是「等待被看见」。',
    updatedAt: '5 月 14 日',
    words: 92,
    posted: false,
    aiAssisted: true, // AI 参与生成的内容必须标注（UI 清单 S-08）
  },
]

export const NOTE_RULES = [
  '心得写完只存在你自己这里，不会自动公开。',
  '投稿要选一本关联的书，交给老师看过才会出现在社区。',
  '竹娃帮忙写过的部分要留着标记，让老师知道哪一段有 AI 参与。',
]

// ——— 下载与存储（设置里的「下载与存储」用）———
export const STORAGE = {
  usedMB: 486,
  quotaMB: 2048,
  note: '下载后的书离线也能读；删除下载不会影响你的进度、书签和摘录。',
}

// ——— 学校预设头像：学生只能在这里面选，不能上传（规格 §12）———
// 每个预设配一个不同的图案：只换颜色的话六个头像长得几乎一样，选不出来。
export const AVATAR_PRESETS = [
  { id: 'bamboo-01', name: '青竹', tone: '#8FD3C0', icon: 'Leaf' },
  { id: 'bamboo-02', name: '小笋', tone: '#F2C7D4', icon: 'Sprout' },
  { id: 'bamboo-03', name: '纸鸢', tone: '#A8CBEC', icon: 'Bird' },
  { id: 'bamboo-04', name: '暖阳', tone: '#F5CBA0', icon: 'Sun' },
  { id: 'bamboo-05', name: '墨笔', tone: '#B9B4D8', icon: 'Feather' },
  { id: 'bamboo-06', name: '晴野', tone: '#C7DFA6', icon: 'Mountain' },
]

// ——— 通知开关（设置 · 通知）———
export const NOTICE_SWITCHES = [
  { key: 'teacherNotice', label: '老师的通知与书目安排', desc: '课堂共读、读到第几页这类安排。', locked: false },
  { key: 'reviewResult', label: '投稿的审核结果', desc: '老师通过或退回你的心得时提醒你。', locked: false },
  { key: 'privacyRequest', label: '私密对话的访问申请', desc: '老师申请查看你的私密对话时会提醒你。', locked: true },
  { key: 'restReminder', label: '休息提醒', desc: '连续读太久时提醒你歇一会儿。', locked: false },
]

// ——— 帮助与关于 ———
// 每条都带展开后的正文：卡片看着像能点，就必须真的点得开，不能是死卡片。
export const HELP_LINKS = [
  {
    id: 'guide',
    icon: 'Compass',
    title: '怎么用这个阅读器',
    desc: '翻页、选文、加书签、问竹娃的简单说明。',
    body: '横向拖一下就翻页；按住一段文字不动，会进入选文，松手后可以收藏摘录、写批注或者交给竹娃；点书页右上角的折角就是加书签。',
  },
  {
    id: 'feedback',
    icon: 'MessageSquareWarning',
    title: '竹娃回答得不对',
    desc: '在回答下面点「不太对」就会记给老师看。',
    body: '每条回答下面都有「很有用」和「不太对」。选「不太对」之后老师会看到这一条，你不用另外找人说。重新问一次不会扣提问次数。',
  },
  {
    id: 'privacy',
    icon: 'ShieldCheck',
    title: '隐私说明',
    desc: '哪些内容老师能看到、哪些要先申请。',
    body: '普通对话老师可以看；设为私密的对话老师默认看不到，要看必须先申请并写清用途，同不同意由你决定。同意之后老师什么时候看过都记在访问记录里。',
  },
  {
    id: 'about',
    icon: 'Info',
    title: '关于读伴',
    desc: '版本、学校授权与素材说明。',
    body: '当前是给学校看的界面演示，书目与数据都是示例，正式版本会接学校的真实书库。竹娃形象目前也是示意素材，等学校的正式形象到位后替换。',
  },
]

export const ABOUT = {
  appName: '读伴',
  version: '前端演示版',
  school: '培新小学',
  note: '当前是给学校看的界面演示，书目与数据都是示例，正式版本会接学校的真实书库。',
}
