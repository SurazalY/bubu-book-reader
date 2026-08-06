// 共读社区演示数据（前端壳专用，**不是真实业务数据**）。
//
// 口径来源：规格 §9（S-07）、第二轮 §7、UI 清单 S-07，以及 Codex 第 109 轮 Q3／Q4：
// - Q3：学生只看到「等待老师审核／老师已通过／已退回修改」这类说法，**不提 AI 扫描**。
//   规格里的「驳回」在学生侧一律说成「已退回修改」，并且必须给可理解的原因。
// - Q4：**不下载任何外部图片**。有图帖的图片一律用 `public/covers/` 里已有的真实书封，
//   并在卡片与详情里注明「这张图是书的封面（演示素材）」，绝不冒充学生拍的照片。
// - 互动只有点赞、收藏与少量固定友好表情：**没有评论、回复、关注、私聊、点踩、人气榜**。
//
// 身份差异（规格 §9.1）：班级社区显示真实姓名；学校社区用学校认可的阅读昵称 + 必要班级信息。
// 同一个学生在两个范围里显示的名字不同，所以作者表同时存真名与昵称，由页面按范围取。

import { BOOK_MAP } from './library.js'
import { DEMO_STUDENT } from './demoStudent.js'

// —— 帖子状态：学生视角的措辞，不出现审核后台术语 ——
export const POST_STATUS = {
  draft: {
    label: '草稿',
    tone: 'muted',
    icon: 'FileEdit',
    hint: '只有你能看到，写完再决定要不要发出去',
  },
  pending: {
    label: '等待老师审核',
    tone: 'warning',
    icon: 'Clock',
    hint: '老师看过之后才会出现在社区里，这段时间你还可以改或者撤回',
  },
  published: {
    label: '老师已通过',
    tone: 'success',
    icon: 'CheckCircle2',
    hint: '同学们已经能看到了；改完会重新等老师看一次',
  },
  returned: {
    label: '已退回修改',
    tone: 'accent',
    icon: 'Undo2',
    hint: '老师写了要改的地方，改好再发一次就行',
  },
  offline: {
    label: '已下架',
    tone: 'muted',
    icon: 'ArchiveX',
    hint: '暂时不展示了，你可以按说明改好再发一次',
  },
}

// —— 固定友好表情（规格 §9.4：只留少量友好或中性反应）——
// 用图标 + 名称，不用纯颜色也不用纯 emoji：状态必须同时有文字（红线 12）。
// 刻意没有任何负面／攻击性选项，也不做「最多人点」的排行。
export const REACTIONS = [
  { key: 'clap', icon: 'Sparkles', label: '写得好' },
  { key: 'same', icon: 'Leaf', label: '我也这么想' },
  { key: 'learn', icon: 'Lightbulb', label: '学到了' },
  { key: 'warm', icon: 'Sun', label: '很温暖' },
]
export const REACTION_MAP = new Map(REACTIONS.map((r) => [r.key, r]))

// —— 文字封面配色：无图帖把引文或正文排版成封面（规格 §9.2）——
// 底色刻意都是低饱和纸感，白字压得住；不使用业务语义色（绿／粉／蓝／紫另有含义）。
const COVERS = {
  paper: ['#E7DCC4', '#CBBB98'],
  dusk: ['#EFD0B8', '#D3A283'],
  leaf: ['#CFE0C9', '#9FBD99'],
  ink: ['#D6DAE4', '#AFB6C7'],
  night: ['#4A5675', '#2C3853'],
}
export function coverColors(post) {
  return COVERS[post.cover?.tone] || COVERS.paper
}

// —— 作者：真名给班级社区，昵称 + 班级给学校社区 ——
const AUTHORS = {
  me: { id: 'stu-demo-01', name: DEMO_STUDENT.name, nickname: '小竹的书房', className: DEMO_STUDENT.className, me: true },
  'a-chenmo': { id: 'a-chenmo', name: '陈默', nickname: '默默读三行', className: '三年级（1）班' },
  'a-suyi': { id: 'a-suyi', name: '苏怡', nickname: '苏三页', className: '三年级（1）班' },
  'a-xuyinuo': { id: 'a-xuyinuo', name: '许一诺', nickname: '一诺半页', className: '三年级（1）班' },
  'a-zhouyuning': { id: 'a-zhouyuning', name: '周语宁', nickname: '语宁在读', className: '三年级（1）班' },
  'a-hexiaoyu': { id: 'a-hexiaoyu', name: '何小雨', nickname: '雨天读书', className: '三年级（1）班' },
  'a-linzhiyuan': { id: 'a-linzhiyuan', name: '林知远', nickname: '知远', className: '三年级（1）班' },
  'a-tangke': { id: 'a-tangke', name: '唐可', nickname: '可可爱读', className: '三年级（1）班' },
  'a-gaoyang': { id: 'a-gaoyang', name: '高扬', nickname: '扬帆', className: '三年级（2）班' },
  'a-shenyu': { id: 'a-shenyu', name: '沈屿', nickname: '屿上有灯', className: '五年级（2）班' },
  'a-xutinglan': { id: 'a-xutinglan', name: '许听澜', nickname: '听澜', className: '六年级（1）班' },
  'a-zengwei': { id: 'a-zengwei', name: '曾未', nickname: '未读完', className: '六年级（2）班' },
  'a-luoting': { id: 'a-luoting', name: '罗听', nickname: '听蝉', className: '四年级（3）班' },
  'a-fengqingyue': { id: 'a-fengqingyue', name: '冯清越', nickname: '清越', className: '三年级（3）班' },
  'a-jiangnian': { id: 'a-jiangnian', name: '姜念', nickname: '念念有词', className: '二年级（1）班' },
}

export function postAuthor(post) {
  return AUTHORS[post.authorId] || AUTHORS.me
}

// 显示名：班级社区真名，学校社区昵称 + 班级（规格 §9.1）
export function authorLabel(post) {
  const a = postAuthor(post)
  if (post.scope === 'school') return { primary: a.nickname, secondary: a.className, real: false }
  return { primary: a.name, secondary: a.className, real: true }
}

export function postBook(post) {
  return BOOK_MAP.get(post.bookId) || null
}

// —— 时间筛选（规格 §9.2：提供搜索、排序与时间范围）——
// days 是「几天前」，用来做时间筛选与排序，at 是界面上给学生看的说法。
export const TIME_RANGES = [
  { key: 'all', label: '不限时间', match: () => true },
  { key: 'today', label: '今天', match: (p) => p.days === 0 },
  { key: 'week', label: '最近一周', match: (p) => p.days <= 7 },
  { key: 'month', label: '最近一个月', match: (p) => p.days <= 30 },
]

// 排序：最新 / 本周友善互动多（**限定本周**，不是永久人气榜，规格 §9.4）/ 老师精选
export const SORTS = [
  { key: 'latest', label: '最新', note: '按发布时间从近到远' },
  { key: 'warm', label: '本周友善互动多', note: '只看最近一周，不做永久排行' },
  { key: 'picked', label: '老师精选', note: '老师标记过的内容排在前面' },
]

// reactions 只记次数，mine 是「我点过哪几个」——自己点过的胶囊要高亮（参考图 community/01、02）
const r = (clap = 0, same = 0, learn = 0, warm = 0) => ({ clap, same, learn, warm })

export const SEED_POSTS = [
  // ——— 班级社区 ———
  {
    id: 'p-101', // 书籍详情页「这本书的共读内容」已经链到这个 id，两边必须是同一篇
    scope: 'class',
    status: 'published',
    authorId: 'a-chenmo',
    bookId: 'caofangzi',
    cover: { type: 'text', tone: 'paper' },
    title: '那根木桩是被握成那样的',
    text: '书里说它像一块被人握久了的木头。我摸过我家楼道的扶手，最上面那一段特别滑，也是被握久的。原来东西也会把人记住，只是不说话。',
    quote: { page: 130, text: '像一块被人握久了的木头' },
    at: '2 天前',
    days: 2,
    likes: 18,
    reactions: r(9, 5, 2, 4),
    mine: [],
    picked: true,
  },
  {
    id: 'p-102',
    scope: 'class',
    status: 'published',
    authorId: 'a-suyi',
    bookId: 'caofangzi',
    cover: { type: 'image', tone: 'paper' },
    title: '摘了一段河上的光（第 133 页）',
    text: '“每放开一次，河面就亮一次。”我把这句抄在本子第一页。晚上写作业的时候抬头，窗外路灯也是一下一下地亮。',
    quote: { page: 133, text: '每放开一次，河面就亮一次' },
    at: '4 天前',
    days: 4,
    likes: 11,
    reactions: r(6, 3, 1, 2),
    mine: ['same'],
  },
  {
    id: 'p-103', // 同上：稻草人这篇是书籍详情页链过来的那一篇
    scope: 'class',
    status: 'published',
    authorId: 'a-xuyinuo',
    bookId: 'daocaoren',
    cover: { type: 'text', tone: 'dusk' },
    title: '稻草人看着却帮不上，这段我读了三遍',
    text: '他有眼睛、有心，就是没有手。我读第三遍才明白，作者写的其实是“看见了却做不了”的那种难受。我上次看见有人被笑，也没敢站出来。',
    quote: { page: 98, text: '看得见，却帮不上，是这世上最难的一种站着' },
    at: '昨天',
    days: 1,
    likes: 9,
    reactions: r(4, 6, 1, 1),
    mine: [],
  },
  {
    id: 'p-202',
    scope: 'class',
    status: 'published',
    authorId: 'a-zhouyuning',
    bookId: 'qingtong-kuihua',
    cover: { type: 'image', tone: 'leaf' },
    title: '葵花把糖藏起来那一段',
    text: '她不是舍不得吃，是想留给青铜。我妹妹上次也把最后一块饼干放在我书包里，没说话。',
    quote: null,
    at: '3 天前',
    days: 3,
    likes: 27,
    reactions: r(12, 8, 2, 9),
    mine: ['clap', 'warm'],
    picked: true,
  },
  {
    id: 'p-203',
    scope: 'class',
    status: 'published',
    authorId: 'a-hexiaoyu',
    bookId: 'shiwange-weishenme',
    cover: { type: 'text', tone: 'ink' },
    title: '为什么天是蓝的，我查完更想不通了',
    text: '书上说光被空气散开了，蓝色散得最多。那为什么傍晚变红？我去问了竹娃，它让我把那一段再读一遍，我读完自己想明白了：太阳斜着走，光要走的路变长了。',
    quote: null,
    at: '今天 09:40',
    days: 0,
    likes: 14,
    reactions: r(5, 2, 9, 1),
    mine: ['learn'],
  },
  {
    id: 'p-204',
    scope: 'class',
    status: 'published',
    authorId: 'a-linzhiyuan',
    bookId: 'shenbi-maliang',
    cover: { type: 'text', tone: 'paper' },
    title: '如果我有神笔，第一笔画什么',
    text: '我原来想画一屋子玩具，读完发现马良第一笔画的是水车。他画的都是别人缺的东西。我改主意了，我想画一条路，通到我奶奶家。',
    quote: null,
    at: '今天 08:15',
    days: 0,
    likes: 31,
    reactions: r(15, 7, 3, 12),
    mine: [],
  },
  {
    id: 'p-205',
    scope: 'class',
    status: 'published',
    authorId: 'a-tangke',
    bookId: 'andersen',
    cover: { type: 'image', tone: 'dusk' },
    title: '提灯说它先亮着，不等人来',
    text: '雪笑它只能照一小圈，它说人走到这里能看清路就够了。我以前觉得做事要做得很大才算，读完这一页我改主意了。',
    quote: { page: 204, text: '我不用照亮半条街。有人走到我这里的时候，能看清路就够了。' },
    at: '5 天前',
    days: 5,
    likes: 22,
    reactions: r(11, 9, 4, 3),
    mine: ['same'],
  },
  {
    id: 'p-206',
    scope: 'class',
    status: 'published',
    authorId: 'a-gaoyang',
    bookId: 'yeye-yiding-you-banfa',
    cover: { type: 'text', tone: 'leaf' },
    title: '爷爷真的每次都有办法吗',
    text: '我数了一下，爷爷一共想了五次办法。前四次都是把旧东西改小一点，最后一次是把碎屑扫起来。我觉得他不是有办法，是舍不得扔。',
    quote: null,
    at: '6 天前',
    days: 6,
    likes: 8,
    reactions: r(3, 4, 2, 2),
    mine: [],
  },
  {
    id: 'p-207',
    scope: 'class',
    status: 'published',
    authorId: 'a-jiangnian',
    bookId: 'tongyao',
    cover: { type: 'text', tone: 'dusk' },
    title: '我给妹妹读了三首，她只记住了一首',
    text: '就是那首有月亮的。她现在每天晚上都要我读一遍，我现在会背了。',
    quote: null,
    at: '9 天前',
    days: 9,
    likes: 16,
    reactions: r(7, 2, 0, 8),
    mine: ['warm'],
  },
  // 我自己在班级社区的两篇：一篇通过、一篇等待审核
  {
    id: 'p-301',
    scope: 'class',
    status: 'published',
    authorId: 'me',
    bookId: 'caofangzi',
    cover: { type: 'text', tone: 'paper' },
    title: '那盏灯不是为了照路',
    text: '我一开始以为灯就是用来看路的。读到最后一页才知道，它只是让河上的人知道岸上有人。我妈晚上总把客厅那盏灯留着，大概也是这个意思。',
    quote: { page: 135, text: '它只是让河上的人知道，岸上有人在看着' },
    at: '前天 19:20',
    days: 2,
    likes: 12,
    reactions: r(6, 4, 1, 3),
    mine: [],
  },
  {
    id: 'p-302',
    scope: 'class',
    status: 'pending',
    authorId: 'me',
    bookId: 'daocaoren',
    cover: { type: 'text', tone: 'ink' },
    title: '稻草人的那一夜，我想给他一双手',
    text: '书里写它飘得很慢，慢得让人心里发急。如果稻草人有手，会不会反而更难受？能动的人，就不能只是看着了。',
    quote: { page: 96, text: '飘得很慢，慢得让人心里发急' },
    at: '今天 12:05',
    days: 0,
    likes: 0,
    reactions: r(),
    mine: [],
    submittedAt: '今天 12:05',
  },
  // ——— 学校社区 ———
  {
    id: 'p-104',
    scope: 'school',
    status: 'published',
    authorId: 'me',
    bookId: 'andersen',
    cover: { type: 'text', tone: 'night' },
    title: '她说今天什么也没有，只有火',
    text: '那个孩子每天经过那扇窗，每次只说一句里面有什么。最后一次她说只有灯。我读到这里停下来很久，因为她没有抱怨，只是在数。',
    quote: { page: 202, text: '今天什么也没有，只有灯。' },
    at: '上周',
    days: 8,
    likes: 23,
    reactions: r(11, 5, 2, 14),
    mine: [],
    picked: true,
  },
  {
    id: 'p-401',
    scope: 'school',
    status: 'published',
    authorId: 'a-xutinglan',
    bookId: 'zhonghua-meide',
    cover: { type: 'image', tone: 'night' },
    title: '抄下来贴在书桌上的一句',
    text: '“见善则迁，有过则改。”我把它写在便利贴上。这周我改了两件事：起床不再喊三遍，还有作业先写难的。',
    quote: null,
    at: '4 天前',
    days: 4,
    likes: 76,
    reactions: r(31, 18, 9, 22),
    mine: ['clap'],
    picked: true,
  },
  {
    id: 'p-402',
    scope: 'school',
    status: 'published',
    authorId: 'a-shenyu',
    bookId: 'shaonian-yingxiong',
    cover: { type: 'text', tone: 'ink' },
    title: '全班只有他先开口',
    text: '我在想，如果换成我们班，会不会也只有一个人开口。我大概是那个心里想开口、手举了一半的人。',
    quote: null,
    at: '今天 11:20',
    days: 0,
    likes: 19,
    reactions: r(8, 11, 1, 2),
    mine: [],
  },
  {
    id: 'p-403',
    scope: 'school',
    status: 'published',
    authorId: 'a-zengwei',
    bookId: 'sanzijing',
    cover: { type: 'text', tone: 'paper' },
    title: '背下来和读懂不是一回事',
    text: '我三年级就会背前面一整段，昨天才知道“窦燕山，有义方”讲的是一个爸爸怎么教五个孩子。会背的时候我以为我懂了。',
    quote: null,
    at: '2 天前',
    days: 2,
    likes: 41,
    reactions: r(17, 6, 15, 3),
    mine: ['learn'],
  },
  {
    id: 'p-404',
    scope: 'school',
    status: 'published',
    authorId: 'a-luoting',
    bookId: 'xijun-shijie',
    cover: { type: 'image', tone: 'leaf' },
    title: '洗手前后我各看了一次显微镜照片',
    text: '书上那张放大了几千倍。我们科学课也看了，老师说照片里那些不全是坏的，有的还帮我们消化。我以前以为细菌都要杀掉。',
    quote: null,
    at: '今天 10:05',
    days: 0,
    likes: 33,
    reactions: r(12, 4, 19, 2),
    mine: [],
  },
  {
    id: 'p-405',
    scope: 'school',
    status: 'published',
    authorId: 'a-fengqingyue',
    bookId: 'gudu-xiaopangxie',
    cover: { type: 'text', tone: 'dusk' },
    title: '小螃蟹一直在等人来',
    text: '它把家门口扫得很干净，可是没有人来。我读到中间有点难过，后来它自己出门了，我才松一口气。',
    quote: null,
    at: '3 天前',
    days: 3,
    likes: 28,
    reactions: r(9, 12, 1, 15),
    mine: ['warm'],
  },
  {
    id: 'p-406',
    scope: 'school',
    status: 'published',
    authorId: 'a-hexiaoyu',
    bookId: 'gelin-tonghua',
    cover: { type: 'text', tone: 'leaf' },
    title: '同一个故事，妈妈小时候听的版本不一样',
    text: '我问了妈妈，她说她听的结尾里狼没有被剖开。我们查了书，书上是有的。原来故事会被大人改。',
    quote: null,
    at: '7 天前',
    days: 7,
    likes: 24,
    reactions: r(10, 7, 6, 2),
    mine: [],
  },
  {
    id: 'p-407',
    scope: 'school',
    status: 'published',
    authorId: 'a-tangke',
    bookId: 'meitounao',
    cover: { type: 'text', tone: 'ink' },
    title: '“没头脑”像我，“不高兴”像我弟弟',
    text: '我们两个合起来就是那一整本书。看到他们演武松那段，我笑到被我妈说。',
    quote: null,
    at: '11 天前',
    days: 11,
    likes: 37,
    reactions: r(19, 8, 2, 9),
    mine: ['clap'],
  },
  // 我自己在学校社区的三篇：退回修改、已下架、草稿
  {
    id: 'p-501',
    scope: 'school',
    status: 'returned',
    authorId: 'me',
    bookId: 'xiaobutou',
    cover: { type: 'text', tone: 'paper' },
    title: '小布头到底算不算离家出走',
    text: '我觉得算，他自己跳下桌子的。',
    quote: null,
    at: '昨天 20:30',
    days: 1,
    likes: 0,
    reactions: r(),
    mine: [],
    review: {
      who: '林老师',
      at: '昨天 21:02',
      reason: '只写了一句结论，别人看不出你为什么这么想。补一句书里的原文，再写你自己的理由就可以发出来了。',
    },
  },
  {
    id: 'p-502',
    scope: 'school',
    status: 'offline',
    authorId: 'me',
    bookId: 'qisehua',
    cover: { type: 'text', tone: 'ink' },
    title: '七色花的第七个愿望',
    text: '我在正文里贴了一个校外网站的链接，想让大家去看动画片。',
    quote: null,
    at: '7 月 29 日',
    days: 7,
    likes: 14,
    reactions: r(6, 3, 1, 4),
    mine: [],
    review: {
      who: '学校管理员',
      at: '8 月 2 日 15:10',
      reason: '正文里有校外网站链接，按学校规定不能出现在社区里。删掉链接改成你自己的话，就可以重新发一次。',
    },
  },
  {
    id: 'p-503',
    scope: 'school',
    status: 'draft',
    authorId: 'me',
    bookId: 'qingtong-kuihua',
    cover: { type: 'text', tone: 'leaf' },
    title: '青铜不会说话，可他什么都懂',
    text: '他不说话的时候最像大人。我还没写完，想再读一遍第九章再接着写',
    quote: null,
    at: '草稿 · 今天 07:50',
    days: 0,
    likes: 0,
    reactions: r(),
    mine: [],
    savedAt: '今天 07:50',
  },
]

// 详情页与卡片都要用的「一句话身份」：学校社区不泄真名，班级社区不重复班级
export function scopeLabel(scope) {
  return scope === 'school' ? '学校社区' : '班级社区'
}

// 学校社区的身份说明：学生必须知道自己在这里是昵称出现的（规格 §9.1）
export const SCOPE_NOTES = {
  class: `${DEMO_STUDENT.className}的同学都能看到，这里显示真实姓名。`,
  school: '全校同学都能看到，这里只显示你的阅读昵称和班级，不显示真实姓名。老师和学校管理员仍然可以查到是谁写的。',
}

export const MY_NICKNAME = AUTHORS.me.nickname

// 表情总次数（卡片只显示一个总数 + 前两种，详情页显示全部）
export function reactionTotal(post) {
  return REACTIONS.reduce((sum, x) => sum + (post.reactions?.[x.key] || 0), 0)
}
