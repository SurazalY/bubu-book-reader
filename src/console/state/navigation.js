export const SCHOOL_NAV_ITEMS = [
  { key: 'home', label: '首页', icon: 'House', path: '/console/home' },
  { key: 'accounts', label: '账号管理', icon: 'UserRound', groups: [{ key: 'accounts.live', label: '班级与成员', icon: 'Users', items: [{ key: 'accounts.students', label: '学生目录', path: '/console/accounts/students' }] }] },
  { key: 'teaching', label: '教学与管理', icon: 'GraduationCap', groups: [{ key: 'teaching.live', label: '阅读教学', icon: 'CalendarCheck', items: [{ key: 'teaching.arrangements', label: '阅读安排', path: '/console/teaching/arrangements' }, { key: 'teaching.books', label: '书库', path: '/console/teaching/books' }] }] },
  { key: 'classes', label: '班级与学生', icon: 'UsersRound', groups: [{ key: 'classes.live', label: '真实数据', icon: 'ChartNoAxesColumn', items: [{ key: 'classes.overview', label: '阅读统计', path: '/console/classes/overview' }, { key: 'classes.eyecare', label: '护眼管理', path: '/console/classes/eyecare' }] }] },
  { key: 'usage', label: '用量与对话', icon: 'MessageSquareText', groups: [{ key: 'usage.summary', label: '用量', icon: 'Gauge', items: [{ key: 'usage.overview', label: '用量概览', path: '/console/usage/overview' }] }, { key: 'usage.live', label: '对话与隐私', icon: 'MessagesSquare', items: [{ key: 'usage.sessions', label: '学生会话', path: '/console/usage/sessions' }, { key: 'usage.privacy', label: '隐私访问', path: '/console/usage/privacy' }] }] },
  { key: 'community', label: '社区管理', icon: 'Sparkles', groups: [{ key: 'community.live', label: '社区内容', icon: 'Sparkles', items: [{ key: 'community.review', label: '社区审核', path: '/console/community' }] }] },
  { key: 'reports', label: '报告中心', icon: 'FileText', groups: [{ key: 'reports.live', label: '报告', icon: 'ClipboardList', items: [{ key: 'reports.center', label: '全部报告', path: '/console/reports' }, { key: 'reports.parents', label: '家长发送', path: '/console/reports/parents' }, { key: 'reports.templates', label: '模板与规则', path: '/console/reports/templates' }] }] },
  { key: 'safety', label: '安全事件', icon: 'ShieldCheck', groups: [{ key: 'safety.live', label: '安全管理', icon: 'ShieldCheck', items: [{ key: 'safety.events', label: '安全事件', path: '/console/safety' }] }] },
]

export const PLATFORM_NAV_ITEMS = [
  { key: 'platform-audit', label: '平台审计', icon: 'ShieldCheck', groups: [{ key: 'platform.live', label: '平台运维', icon: 'ShieldCheck', items: [{ key: 'platform.audit', label: '审计记录', path: '/console/platform/audit' }] }] },
]
