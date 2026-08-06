// 书库、书目详情、导入预览与教师阅读器共用的虚构书目数据。
// 正文是为演示写的占位段落，不是任何真实作品原文；阅读器按 PAGE 拆页显示。

export const GENRES = [
  { key: 'all', label: '全部分类' },
  { key: 'story', label: '儿童文学' },
  { key: 'science', label: '科普百科' },
  { key: 'classic', label: '名著节选' },
  { key: 'poem', label: '诗歌散文' },
]

export const BOOK_STATUS = {
  online: { label: '已上架', tone: 'success' },
  review: { label: '审核中', tone: 'warning' },
  offline: { label: '已下架', tone: 'muted' },
}

export const BOOKS = [
  {
    id: 'b-caofangzi',
    title: '草房子',
    author: '曹文轩',
    cover: ['#E0B341', '#C98C2A'],
    genre: 'story',
    status: 'online',
    grades: ['三年级', '四年级'],
    pages: 268,
    chapters: 9,
    words: '约 12.4 万字',
    importedBy: '林老师',
    importedAt: '2025-09-12',
    updatedAt: '2026-05-18',
    version: 'v3',
    summary: '以油麻地小学为背景的成长故事，适合作为整本书共读的入门选择。',
    stats: { classes: 6, readers: 168, finishRate: 72, avgMinutes: 34, notes: 214 },
    versions: [
      { v: 'v3', at: '2026-05-18', by: '林老师', note: '修正第 3 章两处错别字，重排插图位置' },
      { v: 'v2', at: '2025-11-03', by: '年级管理', note: '补齐章节目录与朗读音频占位' },
      { v: 'v1', at: '2025-09-12', by: '林老师', note: '首次导入，含 9 章正文' },
    ],
  },
  {
    id: 'b-xialuo',
    title: '夏洛的网',
    author: 'E.B. 怀特',
    cover: ['#6E9BF0', '#4B72C8'],
    genre: 'story',
    status: 'online',
    grades: ['三年级'],
    pages: 214,
    chapters: 22,
    words: '约 8.6 万字',
    importedBy: '年级管理',
    importedAt: '2025-09-20',
    updatedAt: '2026-04-02',
    version: 'v2',
    summary: '关于友谊与承诺的经典童话，章节短、适合分段共读。',
    stats: { classes: 5, readers: 142, finishRate: 66, avgMinutes: 28, notes: 176 },
    versions: [
      { v: 'v2', at: '2026-04-02', by: '年级管理', note: '按班级反馈调整分页密度' },
      { v: 'v1', at: '2025-09-20', by: '年级管理', note: '首次导入' },
    ],
  },
  {
    id: 'b-kunchongji',
    title: '昆虫记',
    author: '法布尔',
    cover: ['#5FA87A', '#3E7F5C' ],
    genre: 'science',
    status: 'online',
    grades: ['三年级', '五年级'],
    pages: 302,
    chapters: 14,
    words: '约 15.2 万字',
    importedBy: '周老师',
    importedAt: '2025-10-08',
    updatedAt: '2026-03-11',
    version: 'v2',
    summary: '观察类科普长文，适合配合精读导读课使用。',
    stats: { classes: 4, readers: 96, finishRate: 48, avgMinutes: 22, notes: 132 },
    versions: [
      { v: 'v2', at: '2026-03-11', by: '周老师', note: '补充 6 张插图说明' },
      { v: 'v1', at: '2025-10-08', by: '周老师', note: '首次导入' },
    ],
  },
  {
    id: 'b-xiyouji',
    title: '西游记（少年版）',
    author: '吴承恩 / 改写',
    cover: ['#D96A4A', '#B44A32'],
    genre: 'classic',
    status: 'online',
    grades: ['四年级', '六年级'],
    pages: 386,
    chapters: 24,
    words: '约 19.8 万字',
    importedBy: '陈老师',
    importedAt: '2025-11-15',
    updatedAt: '2026-05-06',
    version: 'v4',
    summary: '名著改写本，六年级片段赏析与整本书导读都在用。',
    stats: { classes: 8, readers: 246, finishRate: 58, avgMinutes: 31, notes: 302 },
    versions: [
      { v: 'v4', at: '2026-05-06', by: '陈老师', note: '替换两章节选，避免与课本重复' },
      { v: 'v3', at: '2026-01-19', by: '陈老师', note: '补齐人物关系图占位' },
      { v: 'v2', at: '2025-12-02', by: '年级管理', note: '调整章节切分' },
      { v: 'v1', at: '2025-11-15', by: '陈老师', note: '首次导入' },
    ],
  },
  {
    id: 'b-shiwanwan',
    title: '十万个为什么',
    author: '编写组',
    cover: ['#3E9E8F', '#2E7D74'],
    genre: 'science',
    status: 'review',
    grades: ['五年级', '六年级'],
    pages: 240,
    chapters: 18,
    words: '约 11.0 万字',
    importedBy: '孙老师',
    importedAt: '2026-05-16',
    updatedAt: '2026-05-16',
    version: 'v1',
    summary: '新导入版本正在审核，审核期间不出现在学生端。',
    reviewNote: '待年级管理确认第 7、11 章配图版权说明',
    stats: { classes: 0, readers: 0, finishRate: 0, avgMinutes: 0, notes: 0 },
    versions: [{ v: 'v1', at: '2026-05-16', by: '孙老师', note: '首次导入，等待审核' }],
  },
  {
    id: 'b-anshengtonghua',
    title: '安徒生童话',
    author: '安徒生',
    cover: ['#9B87DE', '#7A66C4'],
    genre: 'story',
    status: 'online',
    grades: ['三年级'],
    pages: 196,
    chapters: 16,
    words: '约 7.8 万字',
    importedBy: '林老师',
    importedAt: '2025-09-28',
    updatedAt: '2026-02-20',
    version: 'v2',
    summary: '短篇集，适合每周一篇的自由阅读安排。',
    stats: { classes: 3, readers: 88, finishRate: 81, avgMinutes: 19, notes: 94 },
    versions: [
      { v: 'v2', at: '2026-02-20', by: '林老师', note: '调整两篇顺序' },
      { v: 'v1', at: '2025-09-28', by: '林老师', note: '首次导入' },
    ],
  },
  {
    id: 'b-shanhaijing',
    title: '山海经里的怪兽',
    author: '改写组',
    cover: ['#C4894F', '#9C6636'],
    genre: 'poem',
    status: 'offline',
    grades: ['四年级'],
    pages: 158,
    chapters: 12,
    words: '约 6.2 万字',
    importedBy: '年级管理',
    importedAt: '2025-10-30',
    updatedAt: '2026-04-28',
    version: 'v2',
    summary: '因插图授权到期已下架，历史阅读记录与笔记保留。',
    offlineNote: '2026-04-28 由年级管理下架，原因：插图授权到期',
    stats: { classes: 2, readers: 54, finishRate: 44, avgMinutes: 17, notes: 61 },
    versions: [
      { v: 'v2', at: '2026-04-28', by: '年级管理', note: '下架处理' },
      { v: 'v1', at: '2025-10-30', by: '年级管理', note: '首次导入' },
    ],
  },
  {
    id: 'b-jianai',
    title: '简·爱（节选）',
    author: '夏洛蒂·勃朗特',
    cover: ['#7E8AA6', '#5C6884'],
    genre: 'classic',
    status: 'online',
    grades: ['六年级'],
    pages: 132,
    chapters: 8,
    words: '约 5.4 万字',
    importedBy: '陈老师',
    importedAt: '2026-01-08',
    updatedAt: '2026-01-08',
    version: 'v1',
    summary: '名著节选，用于六年级片段赏析。',
    stats: { classes: 3, readers: 72, finishRate: 62, avgMinutes: 26, notes: 88 },
    versions: [{ v: 'v1', at: '2026-01-08', by: '陈老师', note: '首次导入' }],
  },
]

export function getBooks(workspaceId) {
  // 只有能导入书目的空间才看得到「审核中」和「已下架」的书
  const canSeeAll = workspaceId !== 'class-teacher' && workspaceId !== 'grade-group'
  return canSeeAll ? BOOKS : BOOKS.filter((b) => b.status === 'online')
}

export function getBook(bookId) {
  return BOOKS.find((b) => b.id === bookId) || null
}

// 阅读器与导入预览的页面文本：演示占位段落，按页给出标题与两段正文
const PARAGRAPHS = [
  '午后的风从河面上过来，带着水草和泥土的气息。孩子们把课本合上，抬头看见窗外那片被晒得发白的芦苇荡。',
  '他忽然明白，有些话不必说出来，只要一起走过那条长长的堤岸，彼此就都知道了。',
  '油麻地的秋天来得很慢，先是稻子黄了一半，接着是屋檐下的燕子少了几只，最后才是清早那层薄薄的霜。',
  '她把那本书翻到折过角的一页，用铅笔在旁边写下一行小字，又轻轻擦掉，只留下一点浅浅的痕迹。',
  '夜里下过雨，操场边的泥地上留着几行深浅不一的脚印，从教室门口一直通到那棵老槐树下。',
  '老师说，读一本书就像走进一间陌生的屋子，你要先安静下来，才能听见屋里原本就有的声音。',
  '他数了数手里的纸船，一共七只，够全班每个小组分一只，还剩下一只留给自己。',
  '远处传来放学的铃声，几个孩子把书包甩到背上，笑着跑过木桥，桥板吱呀吱呀地响。',
]

export function getPages(book, count) {
  const total = count || Math.min(12, book?.chapters || 10)
  return Array.from({ length: total }, (_, i) => ({
    index: i + 1,
    chapter: `第 ${Math.floor(i / 2) + 1} 章`,
    heading: i % 2 === 0 ? `第 ${Math.floor(i / 2) + 1} 章 · ${['河边', '芦苇荡', '纸船', '老槐树', '秋天', '铃声'][Math.floor(i / 2) % 6]}` : null,
    paragraphs: [PARAGRAPHS[i % PARAGRAPHS.length], PARAGRAPHS[(i + 3) % PARAGRAPHS.length]],
  }))
}

// 导入预览：待导入文件的解析结果（虚构），纯文本会走「先编辑再预览」分支
export const IMPORT_CANDIDATES = [
  {
    id: 'f-1',
    name: '城南旧事.epub',
    kind: 'epub',
    size: '2.4 MB',
    parsed: { title: '城南旧事', author: '林海音', chapters: 12, pages: 226, words: '约 9.1 万字' },
    needEdit: false,
    warnings: [],
  },
  {
    id: 'f-2',
    name: '寄小读者.txt',
    kind: 'txt',
    size: '186 KB',
    parsed: { title: '寄小读者', author: '（未识别）', chapters: 0, pages: 0, words: '约 4.2 万字' },
    needEdit: true,
    warnings: ['纯文本没有章节结构，需要先在编辑页确认书名、作者与分章方式'],
  },
  {
    id: 'f-3',
    name: '自然笔记合集.pdf',
    kind: 'pdf',
    size: '18.6 MB',
    parsed: { title: '自然笔记合集', author: '编写组', chapters: 9, pages: 184, words: '约 6.8 万字' },
    needEdit: false,
    warnings: ['有 3 页为整页扫描图，学生端无法选中文字'],
  },
]
