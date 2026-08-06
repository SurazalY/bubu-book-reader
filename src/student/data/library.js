// 学生端演示书库（前端壳专用，**不是真实业务数据**）。
//
// 书目本体沿用旧站 `src/data/books.js` 的 21 本真实书单与 `public/covers/` 真封面，
// 这里只叠加「学生自己的那一层」：阅读进度、书签、有效阅读时间、下载状态、
// 喜欢标记、班级共读安排。真实数值由后端有效阅读算法产出，本文件只做演示。
//
// 口径约定（规格 §4.2／§5.2）：
// - 有效阅读时间：只统计真实翻页与停留产生的有效阅读，打开书籍不计入。
// - 「已参与阅读」：学生至少产生一次有效阅读记录才算，仅打开不计。
// - 进度条：已读绿荧光段 + 未读淡粉段同带内，书签是轨道内蓝色细线（见 Progress.jsx）。
import { books as baseBooks } from '../../data/books.js'

// 体裁 → 学校课程学科（书架筛选的「学科」维度）
const SUBJECT_BY_GENRE = {
  故事: '语文',
  经典名著: '语文',
  '国学·传统': '语文',
  科普: '科学',
  '红色·人物': '道德与法治',
}

// 学生自己那一层：只给读过／安排过的书写覆盖项，其余保持全新未读
// minutes = 有效阅读分钟数；bookmarks 的 at 是轨道百分比，page 是实际页码
const READER_OVERLAY = {
  caofangzi: {
    minutes: 372,
    percent: 56,
    page: 132,
    totalPages: 236,
    bookmarks: [
      { at: 22, page: 52 },
      // 56% 这个书签刻意落在阅读器示例内页覆盖的第 128～135 页内，
      // 这样进阅读器就能看到「页角书签已标记」的真实状态，不用现场点一个出来
      { at: 56, page: 133 },
      { at: 74, page: 175 },
    ],
    liked: true,
    downloaded: true,
    lastReadAt: '今天 12:40',
    notes: 2,
    highlights: 6,
    classReading: {
      state: 'current',
      teacher: '林老师',
      range: '5 月 6 日 — 5 月 31 日',
      teacherPage: 150,
      goal: '读到第 150 页，准备「桑桑的夏天」讨论',
      joined: 34,
      classSize: 41,
    },
  },
  'qingtong-kuihua': {
    minutes: 268,
    percent: 34,
    page: 78,
    totalPages: 228,
    bookmarks: [{ at: 15, page: 34 }],
    liked: true,
    downloaded: true,
    lastReadAt: '昨天 20:15',
    notes: 1,
    highlights: 3,
  },
  daocaoren: {
    minutes: 205,
    percent: 72,
    page: 96,
    totalPages: 134,
    bookmarks: [
      { at: 40, page: 54 },
      { at: 66, page: 88 },
      { at: 69, page: 92 },
    ],
    liked: true,
    lastReadAt: '今天 08:05',
    highlights: 4,
    classReading: {
      state: 'current',
      teacher: '周老师',
      range: '5 月 12 日 — 6 月 6 日',
      teacherPage: 100,
      goal: '读完前四篇，写一句最难忘的话',
      joined: 29,
      classSize: 41,
    },
  },
  andersen: {
    minutes: 430,
    percent: 100,
    page: 208,
    totalPages: 208,
    bookmarks: [{ at: 92, page: 191 }],
    liked: true,
    downloaded: true,
    lastReadAt: '5 月 14 日',
    notes: 1,
    highlights: 9,
  },
  'gelin-tonghua': {
    minutes: 176,
    percent: 48,
    page: 88,
    totalPages: 183,
    bookmarks: [{ at: 30, page: 55 }],
    liked: true,
    lastReadAt: '前天 19:02',
    highlights: 2,
  },
  'shiwange-weishenme': {
    minutes: 47,
    percent: 12,
    page: 26,
    totalPages: 216,
    lastReadAt: '5 月 11 日',
  },
  sanzijing: {
    minutes: 96,
    percent: 88,
    page: 61,
    totalPages: 69,
    lastReadAt: '4 月 28 日',
    classReading: {
      state: 'history',
      teacher: '林老师',
      range: '3 月 4 日 — 4 月 30 日',
      teacherPage: 69,
      goal: '通读全篇，会背前三段',
      joined: 38,
      classSize: 41,
    },
  },
  'zhongguo-gudai-yuyan': {
    minutes: 78,
    percent: 26,
    page: 33,
    totalPages: 126,
    lastReadAt: '5 月 9 日',
  },
  'shenbi-maliang': {
    minutes: 62,
    percent: 100,
    page: 48,
    totalPages: 48,
    liked: true,
    lastReadAt: '4 月 21 日',
    highlights: 1,
  },
  'xiyouji-shaoer': {
    minutes: 34,
    percent: 6,
    page: 18,
    totalPages: 302,
    downloaded: true,
    lastReadAt: '5 月 18 日',
  },
  'xijun-shijie': {
    minutes: 0,
    percent: 0,
    totalPages: 158,
    downloaded: true,
  },
  qisehua: {
    minutes: 21,
    percent: 18,
    page: 9,
    totalPages: 52,
    lastReadAt: '5 月 3 日',
  },
}

const DEFAULT_PAGES = {
  低年级: 64,
  中年级: 148,
  高年级: 232,
}

function fallbackPages(grade) {
  const digits = String(grade).split(/[^0-9]+/).filter(Boolean).map(Number)
  const top = Math.max(...digits, 1)
  if (top <= 2) return DEFAULT_PAGES.低年级
  if (top <= 4) return DEFAULT_PAGES.中年级
  return DEFAULT_PAGES.高年级
}

// 演示用「班级共读的建议时间」文案里出现的教师，同时作为书架的教师筛选维度
export const LIBRARY = baseBooks.map((book) => {
  const extra = READER_OVERLAY[book.id] || {}
  const totalPages = extra.totalPages || fallbackPages(book.grade)
  return {
    ...book,
    subject: SUBJECT_BY_GENRE[book.genre] || '语文',
    totalPages,
    minutes: extra.minutes || 0,
    percent: extra.percent || 0,
    page: extra.page || 0,
    bookmarks: extra.bookmarks || [],
    liked: !!extra.liked,
    downloaded: !!extra.downloaded,
    lastReadAt: extra.lastReadAt || '',
    notes: extra.notes || 0,
    highlights: extra.highlights || 0,
    classReading: extra.classReading || null,
    finished: (extra.percent || 0) >= 100,
  }
})

export const BOOK_MAP = new Map(LIBRARY.map((b) => [b.id, b]))
export const getStudentBook = (id) => BOOK_MAP.get(id) || null

// —— 有效阅读时间格式化：主页与卡片统一口径，0 分钟显示「尚未开始」 ——
export function formatMinutes(min, { zero = '尚未开始' } = {}) {
  if (!min) return zero
  const h = Math.floor(min / 60)
  const m = min % 60
  if (!h) return `${m} 分钟`
  if (!m) return `${h} 小时`
  return `${h} 小时 ${m} 分`
}

// —— 汇总数据：全部从上面的书库算出来，避免页面之间数字自相矛盾 ——
const totalMinutes = LIBRARY.reduce((sum, b) => sum + b.minutes, 0)
export const READING_SUMMARY = {
  totalMinutes,
  totalLabel: formatMinutes(totalMinutes, { zero: '0 分钟' }),
  finishedBooks: LIBRARY.filter((b) => b.finished).length,
  startedBooks: LIBRARY.filter((b) => b.minutes > 0).length,
  downloadedBooks: LIBRARY.filter((b) => b.downloaded).length,
  recentDays: 6, // 近期阅读天数：后端按有效阅读日历计算，这里是演示值
  // 有效阅读口径说明，主页数字旁必须能看到
  effectiveNote: '有效阅读只统计真实翻页与停留，打开书籍不计入。',
}

// —— 读书排行：只比自己读过的不同书籍，绝不出现同学比较或百分位 ——
// （Codex 第 85 轮拍板：类似个人听歌排行，不显示班级百分位）
export const RANKING = {
  recent: LIBRARY.filter((b) => b.minutes > 0)
    .map((b) => ({ ...b, periodMinutes: Math.round(b.minutes * 0.42) }))
    .filter((b) => b.periodMinutes > 0)
    .sort((a, b) => b.periodMinutes - a.periodMinutes),
  total: LIBRARY.filter((b) => b.minutes > 0).sort((a, b) => b.minutes - a.minutes),
}

export const RANKING_PERIODS = [
  { key: 'recent', label: '最近一周', note: '按本周有效阅读时间排序' },
  { key: 'total', label: '累计', note: '按开始阅读以来的有效阅读时间排序' },
]

// —— 书单：三个系统书单不可删除，自定义书单可增删改排（管理放 Stage 6）——
export const SYSTEM_LISTS = [
  { id: 'liked', name: '我喜欢的书', system: true, icon: 'Heart', pick: (b) => b.liked },
  { id: 'recent', name: '最近阅读', system: true, icon: 'Clock', pick: (b) => b.minutes > 0 },
  { id: 'downloaded', name: '本地下载', system: true, icon: 'Download', pick: (b) => b.downloaded },
]

export const CUSTOM_LISTS = [
  { id: 'growing-light', name: '成长路上的光', bookIds: ['caofangzi', 'qingtong-kuihua', 'daocaoren', 'shenbi-maliang', 'qisehua'] },
  { id: 'history-echo', name: '历史的回响', bookIds: ['sanzijing', 'dizigui', 'zhonghua-meide', 'shaonian-yingxiong'] },
  { id: 'healing', name: '心灵治愈站', bookIds: ['andersen', 'gelin-tonghua', 'yeye-yiding-you-banfa', 'qisehua', 'gudu-xiaopangxie', 'tongyao'] },
  { id: 'why-world', name: '为什么星球', bookIds: ['shiwange-weishenme', 'xijun-shijie'] },
  { id: 'read-aloud', name: '想读给妹妹听', bookIds: ['tongyao', 'xiaobutou', 'meitounao'] },
]

export function listBooks(list) {
  if (!list) return []
  if (list.system) return LIBRARY.filter(list.pick)
  return list.bookIds.map((id) => BOOK_MAP.get(id)).filter(Boolean)
}

export function getList(id) {
  return SYSTEM_LISTS.find((l) => l.id === id) || CUSTOM_LISTS.find((l) => l.id === id) || null
}

// —— 书架筛选维度（规格 §4.1：全部／班级共读／年级／学科／教师）——
const GRADES = ['1', '2', '3', '4', '5', '6']

export const SHELF_FILTERS = [
  {
    key: 'all',
    label: '全部',
    icon: 'LayoutGrid',
    options: [{ key: 'all', label: '全部书籍', match: () => true }],
  },
  {
    key: 'class',
    label: '班级共读',
    icon: 'Users',
    options: [
      { key: 'current', label: '当前共读', match: (b) => b.classReading?.state === 'current' },
      { key: 'history', label: '历史共读', match: (b) => b.classReading?.state === 'history' },
    ],
  },
  {
    key: 'grade',
    label: '年级',
    icon: 'GraduationCap',
    options: GRADES.map((g) => ({
      key: g,
      label: `${g} 年级`,
      match: (b) => String(b.grade).split(/[^0-9]+/).filter(Boolean).includes(g),
    })),
  },
  {
    key: 'subject',
    label: '学科',
    icon: 'BookMarked',
    options: ['语文', '科学', '道德与法治'].map((s) => ({
      key: s,
      label: s,
      match: (b) => b.subject === s,
    })),
  },
  {
    key: 'teacher',
    label: '教师',
    icon: 'UserCheck',
    options: ['林老师', '周老师'].map((t) => ({
      key: t,
      label: t,
      match: (b) => b.classReading?.teacher === t,
    })),
  },
]

export function findFilterOption(groupKey, optionKey) {
  const group = SHELF_FILTERS.find((g) => g.key === groupKey) || SHELF_FILTERS[0]
  const option = group.options.find((o) => o.key === optionKey) || group.options[0]
  return { group, option }
}

// —— 与本书相关的共读社区内容 ——
// Stage 2 曾在这里写过一份 RELATED_POSTS 假数据；Stage 5 社区落地后已删除：
// 书籍详情页改成直接读 `state/useCommunity.js` 的 `getBookPosts(bookId)`，
// 两处共用同一份帖子，避免「详情页列的那篇点进去是另一篇」这种自相矛盾。
