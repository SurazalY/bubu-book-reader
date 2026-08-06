// 学生会话数据。学生与班级从 classes.js 取，书目从 books.js 取，这里只放对话本身。
//
// 三类会话按拍板规则处理：
// - 普通：教师与学校管理员在授权范围内可直接看全文，系统自动留痕，不额外生成主题摘要
// - 私密：连自动生成的标题都不显示，统一「私密会话 #编号」，正文与片段全部隐藏
// - 安全：默认只展开「触发消息 + 前后各 2 条」，最多 5 条；继续看要填写用途

import { CLASSES, STUDENTS } from './classes.js'
import { BOOKS } from './books.js'

export const SESSION_KIND = {
  normal: { label: '普通', tone: 'brand', dot: '#3B66F5' },
  private: { label: '私密', tone: 'violet', dot: '#7C6BD8' },
  safety: { label: '安全', tone: 'danger', dot: '#C2453D' },
}

export const REQUEST_STATE = {
  none: { label: '未申请', tone: 'muted' },
  pending: { label: '等待学生同意', tone: 'warning' },
  approved: { label: '学生已同意', tone: 'success' },
  rejected: { label: '学生已拒绝', tone: 'danger' },
  timeout: { label: '超时默认同意', tone: 'brand' },
}

// 触发消息前后各 2 条 = 最多 5 条必要上下文
export const SAFETY_CONTEXT_SPAN = 2

const M = (role, at, text, extra = {}) => ({ role, at, text, ...extra })

export const SESSIONS = [
  {
    id: 'sess-0416',
    no: 'C-20260731-0416',
    kind: 'normal',
    title: '草房子里桑桑为什么要把碗柜拆了',
    studentId: 's-3101',
    bookId: 'b-caofangzi',
    lastAt: '今天 15:12',
    day: '2026年7月31日',
    messages: [
      M('stu', '15:02', '他为什么宁愿被爸爸打也要拆碗柜呀？我觉得他有点傻。', {
        quote: { page: 47, chapter: '第二章', text: '桑桑把家里的碗柜拆了，钉成了一个鸽笼。他觉得鸽子住得比人还讲究一些，才对得起它们飞那么远的路。' },
      }),
      M(
        'ai',
        '15:02',
        '这个「傻」里面其实藏着桑桑最要紧的东西。你注意到他说的是「对得起它们飞那么远的路」吗——他不是想要鸽子，而是想给鸽子一个配得上它们的家。你自己有没有为了一件别人觉得不值的事，挨过说？',
        { cite: { page: 47, text: '鸽子住得比人还讲究一些' } },
      ),
      M('stu', '15:09', '有！我把奶奶给的糖全给了同学，我妈说我傻。可是我就是想给。'),
      M(
        'ai',
        '15:10',
        '那你和桑桑是一路人呢。把这件事记下来吧，等你读到第五章，桑桑还会做一件更「傻」的事，到时候你再回头看看今天写的这句。',
      ),
    ],
  },
  {
    id: 'sess-0402',
    no: 'C-20260729-0402',
    kind: 'private',
    // 私密会话的自动标题不进前端：这里刻意不放 title 字段，页面统一显示「私密会话 #编号」
    studentId: 's-3101',
    bookId: 'b-caofangzi',
    lastAt: '7月29日 20:41',
    hiddenCount: 9,
    request: 'none',
  },
  {
    id: 'sess-0388',
    no: 'C-20260727-0388',
    kind: 'normal',
    title: '纸月为什么总是低着头',
    studentId: 's-3103',
    bookId: 'b-caofangzi',
    lastAt: '7月27日 19:05',
    day: '2026年7月27日',
    messages: [
      M('stu', '18:58', '纸月说话声音那么小，是不是因为怕别人笑她？', {
        quote: { page: 88, chapter: '第四章', text: '纸月总是低着头走路，好像地上有什么她非看不可的东西。' },
      }),
      M(
        'ai',
        '18:59',
        '书里没有直接说原因，但给了两条线索：她的作业本永远最干净，她也永远最后一个走出教室。你觉得这两件事说明她在意什么？',
      ),
      M('stu', '19:04', '她在意别人怎么看她。她想做好，又怕被看见。'),
    ],
  },
  {
    id: 'sess-0431',
    no: 'C-20260803-0431',
    kind: 'safety',
    title: '夏洛的网结局那里我有点难过',
    studentId: 's-3105',
    bookId: 'b-xialuo',
    lastAt: '8月3日 21:41',
    day: '2026年8月3日',
    eventId: 'SE-20260803-0007',
    risk: '中风险',
    eventState: '处理中',
    hiddenBefore: 7,
    hiddenAfter: 1,
    messages: [
      M('stu', '21:34', '夏洛最后真的没人陪它吗？它做了那么多事，最后就自己待在那里。'),
      M(
        'ai',
        '21:35',
        '你看得很准。书里没有安排人去陪它，但它的网、它的字、它的 514 个孩子都留下了。你觉得那算不算有人陪它？',
      ),
      M('stu', '21:38', '我最近老是睡不着，就想着要是我不在了会不会没人发现。', { trigger: true }),
      M(
        'ai',
        '21:38',
        '你能把这句话说出来，我很在意。这不是小事，我想先陪你把它说清楚——最近是从什么时候开始睡不好的？',
      ),
      M('stu', '21:41', '开学那阵吧。算了，你别跟我妈说。'),
    ],
  },
  {
    id: 'sess-0425',
    no: 'C-20260802-0425',
    kind: 'normal',
    title: '蜘蛛真的会织出字来吗',
    studentId: 's-3105',
    bookId: 'b-xialuo',
    lastAt: '8月2日 16:20',
    day: '2026年8月2日',
    messages: [
      M('stu', '16:12', '现实里的蜘蛛能织字吗？我觉得不能。'),
      M(
        'ai',
        '16:13',
        '不能，蜘蛛织网靠的是固定的几步动作，没法拼字。作者让夏洛做到这件事，是想让你相信「一只小虫子也能改变一头猪的命运」。你更喜欢真实的蜘蛛，还是会写字的夏洛？',
      ),
      M('stu', '16:19', '会写字的。虽然假，但是我希望是真的。'),
    ],
  },
  {
    // 赵星禾同时读过《草房子》与《夏洛的网》：书目约束的「与」需要有交集样例，
    // 否则演示时切到「与」永远是空列表，看起来像功能坏了。
    id: 'sess-0419',
    no: 'C-20260801-0419',
    kind: 'normal',
    title: '桑桑和杜小康谁更难过',
    studentId: 's-3105',
    bookId: 'b-caofangzi',
    lastAt: '8月1日 19:48',
    day: '2026年8月1日',
    messages: [
      M('stu', '19:42', '桑桑生病那段和杜小康家破产那段，哪个更难受？', {
        quote: { page: 203, chapter: '第七章', text: '桑桑忽然觉得，自己好像要离开这个地方了。' },
      }),
      M(
        'ai',
        '19:43',
        '书里给的分量不一样：桑桑的难过是突然砸下来的，杜小康的是一天一天磨出来的。你自己更怕哪一种？',
      ),
      M('stu', '19:47', '我更怕一天一天磨的那种。突然的哭一场就好了。'),
    ],
  },
  {
    id: 'sess-0410',
    no: 'C-20260730-0410',
    kind: 'normal',
    title: '昆虫记里的蟋蟀为什么要挖那么长的洞',
    studentId: 's-3102',
    bookId: 'b-kunchongji',
    lastAt: '7月30日 20:16',
    day: '2026年7月30日',
    messages: [
      M('stu', '20:10', '蟋蟀挖洞挖那么久，不累吗？', {
        quote: { page: 132, chapter: '蟋蟀的住宅', text: '它用前足挖土，用钳子搬掉较大的土块，再用后足踏地。' },
      }),
      M(
        'ai',
        '20:11',
        '法布尔特意记了它「一点一点、随做随改」。书里说别的昆虫是找现成的洞，只有蟋蟀自己挖。你觉得这说明蟋蟀更看重什么？',
      ),
      M('stu', '20:15', '它更看重是自己的家吧。'),
    ],
  },
  {
    id: 'sess-0398',
    no: 'C-20260728-0398',
    kind: 'normal',
    title: '秃鹤的帽子被抢了那段我没看懂',
    studentId: 's-3104',
    bookId: 'b-caofangzi',
    lastAt: '7月28日 10:32',
    day: '2026年7月28日',
    messages: [
      M('stu', '10:30', '大家为什么要抢他的帽子？'),
      M('ai', '10:31', '因为帽子挡住的是他最不想被看见的地方。你觉得他生气的是被抢帽子，还是被看见？'),
    ],
  },
  {
    id: 'sess-0377',
    no: 'C-20260726-0377',
    kind: 'normal',
    title: '孙悟空为什么要拜师学艺',
    studentId: 's-3106',
    bookId: 'b-xiyouji',
    lastAt: '7月26日 15:48',
    day: '2026年7月26日',
    messages: [
      M('stu', '15:44', '他都会翻筋斗了，还学什么？'),
      M(
        'ai',
        '15:45',
        '他去学的不是本事，是「不死」。书里他看见老猴子死掉才动了念头。你觉得一个怕死的猴王，和后来敢闹天宫的孙悟空，是同一个人吗？',
      ),
      M('stu', '15:47', '是同一个，但他后来不怕了。'),
    ],
  },
  {
    id: 'sess-0364',
    no: 'C-20260725-0364',
    kind: 'normal',
    title: '螳螂为什么要吃掉自己的同伴',
    studentId: 's-3201',
    bookId: 'b-kunchongji',
    lastAt: '7月25日 19:22',
    day: '2026年7月25日',
    messages: [
      M('stu', '19:18', '这个太残忍了，我不想读了。'),
      M(
        'ai',
        '19:19',
        '法布尔写的时候也犹豫过，他说自己「几乎不忍心记下来」。书里没有夸它凶，只是把看到的写下来。你愿意先跳过这一节，等心情好一点再回来看吗？',
      ),
    ],
  },
  {
    id: 'sess-0352',
    no: 'C-20260724-0352',
    kind: 'private',
    studentId: 's-3202',
    bookId: 'b-anshengtonghua',
    lastAt: '7月24日 21:03',
    hiddenCount: 14,
    request: 'pending',
  },
  {
    id: 'sess-0341',
    no: 'C-20260723-0341',
    kind: 'normal',
    title: '桑桑和杜小康算朋友吗',
    studentId: 's-3301',
    bookId: 'b-caofangzi',
    lastAt: '7月23日 16:40',
    day: '2026年7月23日',
    messages: [
      M('stu', '16:35', '他们又打架又一起玩，到底算朋友吗？'),
      M(
        'ai',
        '16:36',
        '书里有一处很关键：杜小康家出事之后，桑桑是唯一还去找他的人。打架和朋友并不矛盾，你觉得真正让他们成为朋友的是哪一件事？',
      ),
      M('stu', '16:39', '是桑桑还去找他那次。'),
    ],
  },
  {
    id: 'sess-0512',
    no: 'C-20260802-0512',
    kind: 'private',
    studentId: 's-6101',
    bookId: 'b-jianai',
    lastAt: '8月2日 22:15',
    hiddenCount: 21,
    request: 'timeout',
  },
  {
    id: 'sess-0508',
    no: 'C-20260801-0508',
    kind: 'safety',
    title: '简·爱在学校被罚站那段',
    studentId: 's-6102',
    bookId: 'b-jianai',
    lastAt: '8月1日 23:12',
    day: '2026年8月1日',
    eventId: 'SE-20260801-0004',
    risk: '低风险',
    eventState: '待复核',
    hiddenBefore: 11,
    hiddenAfter: 2,
    messages: [
      M('stu', '23:02', '简·爱被罚站的时候没有一个人替她说话，为什么？'),
      M('ai', '23:03', '因为在那所学校里，替她说话的人也会被罚。你觉得海伦后来做的那件小事，算不算替她说话？'),
      M('stu', '23:06', '我们班也有人被这样对，我什么都没做。我觉得我挺没用的。', { trigger: true }),
      M(
        'ai',
        '23:07',
        '你能说出来，已经不是「什么都没做」了。当时不出声，很多时候是因为怕，这不等于你认同。我们可以想想有没有别的、更安全的帮法。',
      ),
      M('stu', '23:12', '嗯。我明天试试跟她说句话。'),
    ],
  },
  {
    id: 'sess-0496',
    no: 'C-20260731-0496',
    kind: 'normal',
    title: '三打白骨精里唐僧为什么不信孙悟空',
    studentId: 's-6201',
    bookId: 'b-xiyouji',
    lastAt: '7月31日 20:05',
    day: '2026年7月31日',
    messages: [
      M('stu', '20:01', '明明是妖怪，唐僧为什么就是不信？'),
      M(
        'ai',
        '20:02',
        '因为唐僧只能看见「一个老婆婆被打死了」。孙悟空看的是本质，唐僧看的是眼前。你觉得如果孙悟空先解释再打，结果会不一样吗？',
      ),
      M('stu', '20:04', '不会，唐僧还是不信。'),
    ],
  },
  {
    id: 'sess-0480',
    no: 'C-20260729-0480',
    kind: 'normal',
    title: '蝉在地下待那么多年值得吗',
    studentId: 's-6301',
    bookId: 'b-kunchongji',
    lastAt: '7月29日 18:36',
    day: '2026年7月29日',
    messages: [
      M('stu', '18:30', '四年在地下，五个星期在阳光里，太不划算了。'),
      M(
        'ai',
        '18:31',
        '法布尔也算过这笔账，他说那五个星期是「对四年黑暗的补偿」。如果换成你，你愿意用四年换五个星期吗？',
      ),
      M('stu', '18:35', '我不愿意。但是蝉好像挺高兴的。'),
    ],
  },
]

// 每个班的会话按学生分组；没有班级关系的工作空间（教研组、校长）也能按范围看到
const SCOPE = {
  'class-teacher': ['c3-1', 'c3-2', 'c3-3'],
  'grade-group': ['c6-1', 'c6-2', 'c6-3'],
  'grade-admin': ['c6-1', 'c6-2', 'c6-3', 'c6-4'],
  'school-admin': CLASSES.map((c) => c.id),
  'platform-ops': CLASSES.map((c) => c.id),
}

export function getSession(sessionId) {
  return SESSIONS.find((s) => s.id === sessionId) || null
}

export function sessionStudent(session) {
  return STUDENTS.find((s) => s.id === session.studentId) || null
}

export function sessionBook(session) {
  return BOOKS.find((b) => b.id === session.bookId) || null
}

export function sessionClass(session) {
  const stu = sessionStudent(session)
  return stu ? CLASSES.find((c) => c.id === stu.classId) || null : null
}

// 私密会话不返回标题，页面只能显示「私密会话 #编号」
export function sessionTitle(session) {
  if (session.kind === 'private') return `私密会话 #${session.no.slice(-4)}`
  return session.title
}

export function sessionCount(session) {
  return session.kind === 'private' ? session.hiddenCount : session.messages.length
}

// 安全会话可见范围：触发消息 + 前后各 2 条，其余折叠成计数
export function safetyWindow(session) {
  const idx = session.messages.findIndex((m) => m.trigger)
  if (idx < 0) return { list: session.messages, before: 0, after: 0 }
  const from = Math.max(0, idx - SAFETY_CONTEXT_SPAN)
  const to = Math.min(session.messages.length, idx + SAFETY_CONTEXT_SPAN + 1)
  return {
    list: session.messages.slice(from, to),
    before: (session.hiddenBefore || 0) + from,
    after: (session.hiddenAfter || 0) + (session.messages.length - to),
  }
}

// 书目约束：一段会话只属于一本书，所以
// 「或」= 涉及任意一本所选书的会话；
// 「与」= 同时读过全部所选书的学生的会话（按学生求交集，不是按会话）。
function applyBookConstraint(list, bookIds, op) {
  if (!bookIds || bookIds.length === 0) return list
  if (bookIds.length === 1 || op === 'or') return list.filter((s) => bookIds.includes(s.bookId))
  const studentIds = STUDENTS.filter((stu) =>
    bookIds.every((bid) => list.some((s) => s.studentId === stu.id && s.bookId === bid)),
  ).map((s) => s.id)
  return list.filter((s) => studentIds.includes(s.studentId) && bookIds.includes(s.bookId))
}

// 右侧三级索引：班级 → 学生 → 对话，同一根栏内逐层展开
export function getSessionTree(workspaceId, { keyword = '', bookIds = [], bookOp = 'and' } = {}) {
  const classIds = SCOPE[workspaceId] || SCOPE['class-teacher']
  const k = keyword.trim()

  let list = SESSIONS.filter((s) => {
    const stu = sessionStudent(s)
    return stu && classIds.includes(stu.classId)
  })
  list = applyBookConstraint(list, bookIds, bookOp)

  if (k) {
    list = list.filter((s) => {
      const stu = sessionStudent(s)
      const cls = sessionClass(s)
      const book = sessionBook(s)
      return (
        sessionTitle(s).includes(k) ||
        s.no.includes(k) ||
        (stu && stu.name.includes(k)) ||
        (cls && cls.name.includes(k)) ||
        (book && book.title.includes(k))
      )
    })
  }

  return classIds
    .map((cid) => {
      const cls = CLASSES.find((c) => c.id === cid)
      const inClass = list.filter((s) => sessionStudent(s)?.classId === cid)
      const students = STUDENTS.filter((s) => s.classId === cid)
        .map((stu) => ({ student: stu, sessions: inClass.filter((s) => s.studentId === stu.id) }))
        .filter((g) => g.sessions.length > 0)
      return { klass: cls, students, total: inClass.length }
    })
    .filter((g) => g.klass && g.total > 0)
}
