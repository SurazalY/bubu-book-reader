// 社区内容。学生端还没开工，按「谁先开工谁负责主体设计」的约定，
// 这里先把帖子的统一数据结构定下来，卡片组件是可替换的 CommunityPostCard；
// 两侧合并时再比一比选一个成为共享组件，现在不跨 worktree 强行复用。
//
// 学生社区不提供评论、私聊与点踩，所以互动只有一个「友善互动」计数。

import { BOOKS } from './books.js'
import { CLASSES, STUDENTS } from './classes.js'

export const POST_STATUS = {
  pending: { label: '待审核', tone: 'warning' },
  published: { label: '已发布', tone: 'success' },
  rejected: { label: '已驳回', tone: 'danger' },
  revise: { label: '退回修改', tone: 'accent' },
  offline: { label: '已下架', tone: 'muted' },
}

// 七种审核操作：与交付说明一致，都是状态切换，不做真实落库
export const REVIEW_ACTIONS = {
  approve: { label: '通过', icon: 'Check', tone: 'primary', to: 'published' },
  reject: { label: '驳回', icon: 'X', tone: 'danger', to: 'rejected' },
  revise: { label: '退回修改', icon: 'Undo2', tone: 'plain', to: 'revise' },
  offline: { label: '下架', icon: 'ArchiveX', tone: 'plain', to: 'offline' },
  restore: { label: '恢复', icon: 'RotateCcw', tone: 'plain', to: 'published' },
  feature: { label: '精选', icon: 'Star', tone: 'plain', to: null },
  pin: { label: '置顶', icon: 'Pin', tone: 'plain', to: null },
}

// 封面：图片帖用渐变占位（正式素材未交付，不自绘品牌资产），文本帖用引文当封面
const COVERS = {
  paper: ['#EADFC8', '#CFC0A0'],
  night: ['#3D4A6B', '#26314A'],
  leaf: ['#CFE3CB', '#A6C6A0'],
  dusk: ['#F0D2BC', '#D8A98C'],
  ink: ['#D8DCE6', '#B3BACB'],
}

export const POSTS = [
  {
    id: 'p-1',
    scope: 'class',
    status: 'pending',
    authorId: 's-3101',
    bookId: 'b-caofangzi',
    cover: { type: 'text', tone: 'paper' },
    title: '桑桑拆碗柜那天',
    text: '我一开始觉得他傻，后来想明白了：他不是要养鸽子，是想给鸽子一个配得上它们的家。我把奶奶给的糖全分给同学的时候，好像也是这种心情。',
    quote: { page: 47, text: '鸽子住得比人还讲究一些' },
    at: '今天 15:40',
    kudos: 12,
    featured: false,
    pinned: false,
    history: [{ at: '今天 15:40', who: '陈嘉言', action: '提交', note: '首次提交，等待班级教师审核' }],
  },
  {
    id: 'p-2',
    scope: 'class',
    status: 'pending',
    authorId: 's-3105',
    bookId: 'b-xialuo',
    cover: { type: 'image', tone: 'leaf' },
    title: '我给夏洛画了一张网',
    text: '网上写的不是「王牌猪」，是「别怕」。我觉得夏洛最想说的其实是这两个字。',
    quote: { page: 121, text: '你救了我，夏洛。' },
    at: '今天 14:12',
    kudos: 21,
    featured: false,
    pinned: false,
    history: [{ at: '今天 14:12', who: '赵星禾', action: '提交', note: '含一张手绘图片' }],
  },
  {
    id: 'p-3',
    scope: 'class',
    status: 'revise',
    authorId: 's-3102',
    bookId: 'b-kunchongji',
    cover: { type: 'text', tone: 'leaf' },
    title: '蟋蟀盖房子比我认真',
    text: '它一点一点挖，还随时改。我搭乐高搭到一半就不想搭了。',
    quote: { page: 132, text: '它用前足挖土，用钳子搬掉较大的土块。' },
    at: '昨天 20:30',
    kudos: 6,
    featured: false,
    pinned: false,
    history: [
      { at: '昨天 20:30', who: '李知远', action: '提交', note: '' },
      { at: '昨天 21:02', who: '林老师', action: '退回修改', note: '最后一句和书里内容关系不大，建议补一句你自己的想法' },
    ],
  },
  {
    id: 'p-4',
    scope: 'class',
    status: 'published',
    authorId: 's-3103',
    bookId: 'b-caofangzi',
    cover: { type: 'text', tone: 'dusk' },
    title: '纸月的作业本',
    text: '她的本子永远最干净，可她永远最后一个走出教室。我猜她是想做好，又怕被看见。',
    quote: { page: 88, text: '纸月总是低着头走路。' },
    at: '7月27日 19:20',
    kudos: 34,
    featured: true,
    pinned: false,
    history: [
      { at: '7月27日 19:20', who: '周语宁', action: '提交', note: '' },
      { at: '7月27日 20:05', who: '林老师', action: '通过', note: '' },
      { at: '7月28日 08:30', who: '林老师', action: '设为精选', note: '视角很细' },
    ],
  },
  {
    id: 'p-5',
    scope: 'class',
    status: 'published',
    authorId: 's-3106',
    bookId: 'b-xiyouji',
    cover: { type: 'image', tone: 'dusk' },
    title: '孙悟空学艺前的那一晚',
    text: '他看见老猴子死了才想去学不死。我觉得那一晚他一定没睡着。',
    quote: { page: 26, text: '猴王闻说，满眼堕泪。' },
    at: '7月26日 16:10',
    kudos: 18,
    featured: false,
    pinned: false,
    history: [
      { at: '7月26日 16:10', who: '孙沐白', action: '提交', note: '' },
      { at: '7月26日 17:40', who: '林老师', action: '通过', note: '' },
    ],
  },
  {
    id: 'p-6',
    scope: 'class',
    status: 'rejected',
    authorId: 's-3104',
    bookId: 'b-caofangzi',
    cover: { type: 'text', tone: 'ink' },
    title: '秃鹤',
    text: '（只有书名和一个称呼，没有正文）',
    quote: null,
    at: '7月25日 10:05',
    kudos: 0,
    featured: false,
    pinned: false,
    history: [
      { at: '7月25日 10:05', who: '吴亦然', action: '提交', note: '' },
      { at: '7月25日 11:20', who: '林老师', action: '驳回', note: '用外号称呼同学式的书中人物容易被模仿，先改成书里的原名' },
    ],
  },
  {
    id: 'p-7',
    scope: 'school',
    status: 'pending',
    authorId: 's-6102',
    bookId: 'b-jianai',
    cover: { type: 'text', tone: 'night' },
    title: '海伦替简·爱说的那句话',
    text: '全校只有她敢开口。我在想，如果换成我们班，会不会也只有一个人开口。',
    quote: { page: 96, text: '你想得太多了，简。' },
    at: '今天 11:20',
    kudos: 9,
    featured: false,
    pinned: false,
    history: [
      { at: '今天 11:20', who: '沈屿', action: '提交', note: '投向学校社区' },
      { at: '今天 11:52', who: '陈老师', action: '一审通过', note: '等学校管理员二审' },
    ],
  },
  {
    id: 'p-8',
    scope: 'school',
    status: 'published',
    authorId: 's-6101',
    bookId: 'b-jianai',
    cover: { type: 'image', tone: 'night' },
    title: '给简·爱写的一封回信',
    text: '你说宁愿孤独也不愿被看轻。我抄下来了，贴在书桌上。',
    quote: { page: 214, text: '我贫穷、卑微、不美丽，但当我们的灵魂穿过坟墓站在上帝面前，我们是平等的。' },
    at: '8月1日 21:05',
    kudos: 76,
    featured: true,
    pinned: true,
    history: [
      { at: '8月1日 21:05', who: '许听澜', action: '提交', note: '' },
      { at: '8月1日 22:10', who: '陈老师', action: '一审通过', note: '' },
      { at: '8月2日 09:00', who: '校长', action: '二审通过', note: '' },
      { at: '8月2日 09:02', who: '校长', action: '置顶', note: '本月共读展示' },
    ],
  },
  {
    id: 'p-9',
    scope: 'school',
    status: 'published',
    authorId: 's-6201',
    bookId: 'b-xiyouji',
    cover: { type: 'text', tone: 'paper' },
    title: '唐僧不是不信孙悟空',
    text: '他只是只能看见眼前那个被打死的老婆婆。看见和相信不是一回事。',
    quote: { page: 178, text: '师父，那是妖精！' },
    at: '7月31日 20:20',
    kudos: 41,
    featured: false,
    pinned: false,
    history: [
      { at: '7月31日 20:20', who: '曾未', action: '提交', note: '' },
      { at: '7月31日 21:00', who: '吴老师', action: '一审通过', note: '' },
      { at: '8月1日 08:40', who: '校长', action: '二审通过', note: '' },
    ],
  },
  {
    id: 'p-10',
    scope: 'school',
    status: 'offline',
    authorId: 's-6301',
    bookId: 'b-kunchongji',
    cover: { type: 'text', tone: 'ink' },
    title: '蝉的四年',
    text: '（原文提到了一个校外链接）',
    quote: null,
    at: '7月29日 18:50',
    kudos: 14,
    featured: false,
    pinned: false,
    history: [
      { at: '7月29日 18:50', who: '罗听', action: '提交', note: '' },
      { at: '7月29日 19:30', who: '孙老师', action: '一审通过', note: '' },
      { at: '8月2日 15:10', who: '校长', action: '下架', note: '正文含校外链接，按学校规定下架；作者可修改后重新提交' },
    ],
  },
  {
    id: 'p-11',
    scope: 'school',
    status: 'pending',
    authorId: 's-3301',
    bookId: 'b-caofangzi',
    cover: { type: 'text', tone: 'leaf' },
    title: '杜小康家出事以后',
    text: '只有桑桑还去找他。我觉得这才叫朋友。',
    quote: { page: 156, text: '桑桑站在他家门口，喊了一声杜小康。' },
    at: '7月23日 17:00',
    kudos: 7,
    featured: false,
    pinned: false,
    history: [{ at: '7月23日 17:00', who: '冯清越', action: '提交', note: '投向学校社区，等待一审' }],
  },
  {
    id: 'p-12',
    scope: 'class',
    status: 'published',
    authorId: 's-3201',
    bookId: 'b-kunchongji',
    cover: { type: 'text', tone: 'paper' },
    title: '我跳过了螳螂那一节',
    text: '老师说法布尔自己写的时候也不忍心。我等心情好一点再回来看。',
    quote: null,
    at: '7月25日 19:30',
    kudos: 11,
    featured: false,
    pinned: false,
    history: [
      { at: '7月25日 19:30', who: '何予安', action: '提交', note: '' },
      { at: '7月25日 20:10', who: '林老师', action: '通过', note: '' },
    ],
  },
]

export function coverColors(post) {
  return COVERS[post.cover.tone] || COVERS.paper
}

export function postAuthor(post) {
  return STUDENTS.find((s) => s.id === post.authorId) || null
}

export function postClass(post) {
  const a = postAuthor(post)
  return a ? CLASSES.find((c) => c.id === a.classId) || null : null
}

export function postBook(post) {
  return BOOKS.find((b) => b.id === post.bookId) || null
}

// 可见范围：班级页只给有班级关系的工作空间；学校页给校级与运营；
// 待审核页是「当前账号需要处理的」，按范围取待审核内容。
const CLASS_SCOPE = {
  'class-teacher': ['c3-1', 'c3-2', 'c3-3'],
  'grade-group': ['c6-1', 'c6-2', 'c6-3'],
  'grade-admin': ['c6-1', 'c6-2', 'c6-3', 'c6-4'],
  'school-admin': [],
  'platform-ops': CLASSES.map((c) => c.id),
}

export function getPosts(workspaceId, tab) {
  const classIds = CLASS_SCOPE[workspaceId] || []
  const inClassScope = (p) => {
    const a = postAuthor(p)
    return a && classIds.includes(a.classId)
  }
  if (tab === 'class') return POSTS.filter((p) => p.scope === 'class' && inClassScope(p))
  if (tab === 'school') return POSTS.filter((p) => p.scope === 'school')
  // 待审核只能是「当前账号真能处理的」：
  // 有班级关系的账号只看自己班的学生（包括他们投到学校社区的帖）；
  // 没有班级关系的校级／运营才看全部待审学校帖。
  // 不能让班级教师去审另一个年级学生的内容——那是越权。
  const canReview = (p) => (classIds.length > 0 ? inClassScope(p) : true)
  return POSTS.filter((p) => p.status === 'pending' && canReview(p))
}
