export const POST_STATUS = {
  draft: { label: '草稿', tone: 'muted', icon: 'FileEdit', hint: '只有你能看到，写完再决定要不要发出去' },
  pending: { label: '已提交，等老师通过', tone: 'warning', icon: 'Clock', hint: '本班老师看过之后才会出现在社区里' },
  published: { label: '已通过', tone: 'success', icon: 'CheckCircle2', hint: '同学们已经能看到了' },
  returned: { label: '未通过', tone: 'accent', icon: 'Undo2', hint: '老师没有通过，可以按说明重新写一篇' },
  offline: { label: '已下架', tone: 'muted', icon: 'ArchiveX', hint: '暂时不展示了，你可以按说明重新写一篇' },
}

export const REACTIONS = [
  { key: 'clap', icon: 'Sparkles', label: '写得好' },
  { key: 'same', icon: 'Leaf', label: '我也这么想' },
  { key: 'learn', icon: 'Lightbulb', label: '学到了' },
  { key: 'warm', icon: 'Sun', label: '很温暖' },
]

export const REACTION_MAP = new Map(REACTIONS.map((reaction) => [reaction.key, reaction]))

const COVERS = {
  paper: ['#E7DCC4', '#CBBB98'],
  dusk: ['#EFD0B8', '#D3A283'],
  leaf: ['#CFE0C9', '#9FBD99'],
  ink: ['#D6DAE4', '#AFB6C7'],
  night: ['#4A5675', '#2C3853'],
}

export const TIME_RANGES = [
  { key: 'all', label: '不限时间' },
  { key: 'today', label: '今天' },
  { key: 'week', label: '最近一周' },
  { key: 'month', label: '最近一个月' },
]

export const SORTS = [
  { key: 'latest', label: '最新', note: '按发布时间从近到远' },
  { key: 'warm', label: '本周友善互动多', note: '只看最近一周，不做永久排行' },
  { key: 'picked', label: '老师精选', note: '老师标记过的内容排在前面' },
]

export const SCOPE_NOTES = {
  class: '本班同学都能看到，这里显示学校账号中的姓名。',
  school: '全校同学都能看到，这里只显示学校认可的阅读昵称和班级。老师和学校管理员仍然可以查到作者账号。',
}

export function coverColors(post) {
  return COVERS[post.cover?.tone] || COVERS.paper
}

export function authorLabel(post) {
  const author = post.author || {}
  const className = author.className || post.class?.name || ''
  const displayName = author.displayName || author.name || '同学'
  const nickname = author.nickname || displayName
  return post.scope === 'school'
    ? { primary: nickname, secondary: className, real: false }
    : { primary: displayName, secondary: className, real: true }
}

export function postBook(post) {
  return post.book || null
}

export function scopeLabel(scope) {
  return scope === 'school' ? '学校社区' : '班级社区'
}

export function reactionTotal(post) {
  return REACTIONS.reduce((sum, reaction) => sum + (post.reactions?.[reaction.key] || 0), 0)
}

export function canJumpToPage(book, page) {
  const pageNo = Number(page)
  const totalPages = Number(book?.totalPages)
  return Number.isInteger(pageNo) && pageNo > 0 && (!Number.isFinite(totalPages) || totalPages <= 0 || pageNo <= totalPages)
}
