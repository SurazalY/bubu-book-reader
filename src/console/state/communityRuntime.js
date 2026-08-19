const displayStatus = {
  submitted: 'pending',
  class_approved: 'pending',
  approved: 'published',
  rejected: 'rejected',
  delisted: 'offline',
}

function formatAt(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (date.toDateString() === now.toDateString()) return `今天 ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}

function reviewHistory(reviews) {
  return (Array.isArray(reviews) ? reviews : []).map((review) => ({
    who: review.stage === 'school' ? '学校管理员' : '班级教师',
    action: review.decision === 'approved' ? '通过审核' : '未通过审核',
    at: formatAt(review.createdAt),
    note: review.reason || '',
  }))
}

export function toConsoleCommunityPost(source, { booksById = new Map(), className = '' } = {}) {
  const quote = source?.quote && typeof source.quote === 'object' ? source.quote : null
  const bookId = source?.bookId || null
  const reactions = Array.isArray(source?.reactions) ? source.reactions : []
  const history = reviewHistory(source?.reviews)
  return {
    id: source?.id || null,
    title: source?.title || '',
    text: source?.body || '',
    status: displayStatus[source?.status] || 'pending',
    serverStatus: source?.status || 'submitted',
    scope: source?.scope === 'school' ? 'school' : 'class',
    classId: source?.classId || null,
    bookId,
    quote,
    cover: { type: 'text', tone: 'paper' },
    author: {
      id: source?.author?.id || null,
      name: source?.author?.displayName || source?.author?.name || '学生',
    },
    class: source?.classId ? { id: source.classId, name: className || '当前班级' } : null,
    book: booksById.get(bookId) || null,
    kudos: reactions.reduce((total, reaction) => total + (Number(reaction?.count) || 0), 0),
    pinned: false,
    featured: false,
    history,
    at: formatAt(source?.createdAt),
    createdAt: source?.createdAt || null,
  }
}

export function partitionConsoleCommunityPosts(posts) {
  return {
    pending: posts.filter((post) => post.status === 'pending'),
    class: posts.filter((post) => post.scope === 'class'),
    school: posts.filter((post) => post.scope === 'school'),
  }
}

export function mapCommunityReviewAction(action) {
  if (action === 'approve') return { decision: 'approved', reason: '人工审核通过' }
  if (action === 'reject' || action === 'revise') return { decision: 'rejected', reason: action === 'revise' ? '请按审核意见修改后重新提交' : '内容未通过人工审核' }
  return null
}
