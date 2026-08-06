// 权限端导航树（唯一来源）。一级栏位置与顺序对所有工作空间固定，
// 工作空间只决定「哪些二级入口出现」，绝不重排也不换图标 —— 母版 03 明确要求
// 「一级栏保持原位，避免造成进入另一套产品的错觉」。
//
// 结构：一级项 → 分组（二级栏里的小标题，可折叠）→ 叶子（真实路由）。
// 叶子 key 就是权限矩阵里的授权单位，见 workspaces.js。

export const NAV = [
  {
    key: 'home',
    label: '首页',
    icon: 'Home',
    path: '/console/home',
  },
  {
    key: 'accounts',
    label: '账号管理',
    icon: 'UserRound',
    groups: [
      {
        key: 'accounts.members',
        label: '班级与成员',
        icon: 'Users',
        items: [{ key: 'accounts.classes', label: '班级列表', path: '/console/accounts/classes' }],
      },
      {
        key: 'accounts.orgGroup',
        label: '组织账号',
        icon: 'Building2',
        items: [
          { key: 'accounts.org', label: '账号总览', path: '/console/accounts/org' },
          { key: 'accounts.roles', label: '权限配置', path: '/console/accounts/roles' },
        ],
      },
    ],
  },
  {
    key: 'teaching',
    label: '教学与管理',
    icon: 'GraduationCap',
    groups: [
      {
        key: 'teaching.libraryGroup',
        label: '书库',
        icon: 'Library',
        items: [
          { key: 'teaching.books', label: '全部书目', path: '/console/teaching/books' },
          { key: 'teaching.import', label: '书目导入', path: '/console/teaching/books/import' },
        ],
      },
      {
        key: 'teaching.planGroup',
        label: '阅读安排',
        icon: 'CalendarCheck',
        items: [
          { key: 'teaching.arrangements', label: '全部安排', path: '/console/teaching/arrangements' },
        ],
      },
    ],
  },
  {
    key: 'classes',
    label: '班级与学生',
    icon: 'Users',
    groups: [
      {
        key: 'classes.dataGroup',
        label: '班级数据',
        icon: 'ChartNoAxesColumn',
        items: [{ key: 'classes.overview', label: '班级学生总览', path: '/console/classes/overview' }],
      },
      {
        key: 'classes.careGroup',
        label: '用眼健康',
        icon: 'Eye',
        items: [{ key: 'classes.eyecare', label: '护眼管理', path: '/console/classes/eyecare' }],
      },
    ],
  },
  {
    key: 'usage',
    label: '用量与对话',
    icon: 'MessageSquareText',
    groups: [
      {
        key: 'usage.quotaGroup',
        label: '用量',
        icon: 'Gauge',
        items: [
          { key: 'usage.overview', label: '用量概览', path: '/console/usage/overview' },
          { key: 'usage.quota', label: '额度管理', path: '/console/usage/quota' },
        ],
      },
      {
        key: 'usage.talkGroup',
        label: '对话',
        icon: 'MessagesSquare',
        items: [
          { key: 'usage.sessions', label: '学生会话', path: '/console/usage/sessions' },
          { key: 'usage.privacy', label: '隐私访问', path: '/console/usage/privacy' },
        ],
      },
      {
        key: 'usage.platformGroup',
        label: '平台',
        icon: 'Cpu',
        items: [{ key: 'usage.models', label: '模型与成本', path: '/console/usage/models' }],
      },
    ],
  },
  {
    key: 'community',
    label: '社区管理',
    icon: 'Sparkles',
    path: '/console/community',
  },
  {
    key: 'reports',
    label: '报告中心',
    icon: 'FileText',
    groups: [
      {
        key: 'reports.group',
        label: '报告',
        icon: 'ClipboardList',
        items: [
          { key: 'reports.center', label: '全部报告', path: '/console/reports' },
          { key: 'reports.parents', label: '家长发送', path: '/console/reports/parents' },
          // 模板与规则只给校级管理与平台运营（Stage 5 拍板）
          { key: 'reports.templates', label: '模板与规则', path: '/console/reports/templates' },
        ],
      },
    ],
  },
  {
    key: 'safety',
    label: '安全事件',
    icon: 'ShieldCheck',
    path: '/console/safety',
  },
  {
    key: 'ops',
    label: '运营维护',
    icon: 'Wrench',
    path: '/console/ops',
  },
]

// 叶子 key ←→ 路由 的双向索引，用于越权拦截和「路由反查所属栏目」
export const LEAF_BY_KEY = {}
export const LEAF_BY_PATH = {}

for (const top of NAV) {
  if (top.path) {
    const leaf = { key: top.key, label: top.label, path: top.path, topKey: top.key }
    LEAF_BY_KEY[top.key] = leaf
    LEAF_BY_PATH[top.path] = leaf
  }
  for (const g of top.groups || []) {
    for (const it of g.items) {
      const leaf = { ...it, topKey: top.key, groupKey: g.key }
      LEAF_BY_KEY[it.key] = leaf
      LEAF_BY_PATH[it.path] = leaf
    }
  }
}

// 按 allow 裁剪导航树：一级项只要还剩一个可见叶子就保留，
// 一个叶子都不剩才整项隐藏（母版要求一级栏尽量稳定，不要频繁增减）。
export function buildVisibleNav(allow, badges = {}) {
  const ok = (k) => allow.includes(k)
  const out = []
  for (const top of NAV) {
    if (top.path) {
      if (ok(top.key)) out.push({ ...top, badge: badges[top.key] || 0 })
      continue
    }
    const groups = []
    let badge = 0
    for (const g of top.groups || []) {
      const items = g.items.filter((it) => ok(it.key)).map((it) => ({ ...it, badge: badges[it.key] || 0 }))
      if (items.length) {
        groups.push({ ...g, items })
        badge += items.reduce((s, it) => s + it.badge, 0)
      }
    }
    if (groups.length) out.push({ ...top, groups, badge })
  }
  return out
}

// ── 路由授权规则（Plan_2 P2：权限守卫改默认拒绝）───────────────────
//
// 原来的做法是「路由反查不到叶子就当成不受管辖，直接放行」，于是任何不在
// 导航前缀下的详情页（学生详情、教师阅读器）敲 URL 就能进；Stage 5 只手工
// 补了这两条，以后再加详情页还会重新暴露。现在改成：
//   1) 公共页面走显式白名单；
//   2) 详情类路由在 ROUTE_RULES 里显式声明授权来源（叶子 key 或能力）；
//   3) 其余按叶子最长前缀判定；
//   4) 三者都不命中 → 拒绝。
//
// 能力（caps）是为了把「有没有自己的直属班级」和「有没有权限查看管理范围内
// 的班级」分开：校长、书记没有直属班级，但必须能从组织账号和班级学生总览
// 下钻到范围内的班级与学生（Codex 第 82 轮拍板）。

export const PUBLIC_ROUTES = ['/console/login', '/console/me', '/console/foundation']

// owner 决定一级/二级栏高亮；leaves / caps 决定能不能进。
// 学生详情的 owner 用「班级学生总览」而不是「班级列表」：校长没有班级列表，
// 而护眼管理点学生就是跳学生详情，挂在班级列表下会把校长自己的入口拦掉。
const ROUTE_RULES = [
  {
    prefix: '/console/accounts/classes/',
    owner: 'accounts.classes',
    // 校长／书记看不到「班级列表」，高亮回落到他真正下钻的入口，不让二级栏一片不高亮
    fallbackOwner: 'classes.overview',
    leaves: ['accounts.classes'],
    caps: ['classScope'],
  },
  {
    prefix: '/console/accounts/students/',
    owner: 'classes.overview',
    leaves: ['accounts.classes', 'classes.overview'],
    caps: ['classScope'],
  },
  {
    prefix: '/console/teaching/reader/',
    owner: 'teaching.books',
    leaves: ['teaching.books'],
    caps: [],
  },
]

function normalize(pathname) {
  return pathname.replace(/\/+$/, '') || '/console/home'
}

// 只匹配 prefix 之下的**子路径**：列表页自身（如 /console/accounts/classes）仍然
// 只由它自己的叶子授权，否则校长会连「班级列表」页面本身都能进，与拍板相反。
function matchRule(p) {
  for (const r of ROUTE_RULES) {
    if (p.startsWith(r.prefix)) return r
  }
  return null
}

function matchLeafByPrefix(p) {
  // 最长前缀匹配，保证 /books/import 不会被 /books 抢走
  let best = null
  for (const path of Object.keys(LEAF_BY_PATH)) {
    if (p === path || p.startsWith(path + '/')) {
      if (!best || path.length > best.length) best = path
    }
  }
  return best ? LEAF_BY_PATH[best] : null
}

// 详情页归属：详情路由不出现在导航里，但要让一级/二级栏保持高亮
// （例：班级详情 /console/accounts/classes/c3-1 高亮「班级列表」）。
// 传 workspace 时，归属叶子对该空间不可见就改用 fallbackOwner。
export function matchLeaf(pathname, workspace) {
  const p = normalize(pathname)
  if (LEAF_BY_PATH[p]) return LEAF_BY_PATH[p]
  const rule = matchRule(p)
  if (rule) {
    const allow = workspace?.allow
    if (allow && rule.fallbackOwner && !allow.includes(rule.owner) && allow.includes(rule.fallbackOwner)) {
      return LEAF_BY_KEY[rule.fallbackOwner] || null
    }
    return LEAF_BY_KEY[rule.owner] || null
  }
  return matchLeafByPrefix(p)
}

// 授权判定的唯一入口。workspace 显式传进来，切换工作空间时可以拿目标空间预演。
export function canAccess(workspace, pathname) {
  const p = normalize(pathname)
  if (PUBLIC_ROUTES.includes(p)) return true
  const allow = workspace?.allow || []
  const rule = matchRule(p)
  if (rule) {
    if (rule.leaves.some((k) => allow.includes(k))) return true
    if (rule.caps.includes('classScope') && hasClassScopeAccess(workspace)) return true
    return false
  }
  const leaf = matchLeafByPrefix(p)
  if (leaf) return allow.includes(leaf.key)
  return false // 默认拒绝：新增业务路由必须先在这里登记归属
}

// 「范围内可查看／管理班级」能力：与 hasClassScope（有没有自己的直属班级）无关
function hasClassScopeAccess(workspace) {
  const scope = workspace?.classScope
  return !!scope && scope !== 'none'
}
