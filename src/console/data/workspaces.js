// 工作空间与权限矩阵（全部虚构演示数据，集中在此，页面里不写死任何判断）。
// 交付说明 §4.3 要求至少准备五种演示状态；切换后一级栏位置不变，
// 二级入口按 allow 增减，页面标题与数据范围跟着 scope 走。
//
// allow 里放的是 nav.js 的叶子 key；badges 只允许四类角标：
// 待处理隐私申请 / 待审核社区内容 / 安全事件 / 发送失败报告。
//
// 两个容易混的字段（Plan_2 P1，Codex 第 82 轮拍板）：
//   hasClassScope：有没有**自己的直属班级** —— 只用于「班级列表」入口、社区「班级」页签
//                  这类个人视角 UI；校长、书记为 false，不伪造个人班级入口。
//   classScope：**范围内可查看／管理班级**的能力与范围
//                  （none / own / grade / school / platform）—— 决定能不能从组织账号、
//                  班级学生总览下钻到班级详情与学生详情。具体可见班级名单仍由
//                  fixtures/classes.js 的 CLASS_SCOPE 给，这里只管能不能进。

import { getEvents } from './fixtures/safety.js'
import { getReports } from './fixtures/reports.js'

export const WORKSPACES = [
  {
    id: 'class-teacher',
    name: '我的教学',
    fullName: '三年级（1）班 · 语文',
    role: '班级教师',
    scopeNote: '班级管理 · 32人',
    scopeLabel: '三年级（1）班',
    person: { name: '林老师', account: 'lin.yc@peixin.edu', avatarTone: 'brand' },
    hasClassScope: true,
    classScope: 'own',
    allow: [
      'home',
      'accounts.classes',
      'teaching.books',
      'teaching.arrangements',
      'classes.overview',
      'classes.eyecare',
      'usage.overview',
      'usage.quota',
      'usage.sessions',
      'usage.privacy',
      'community',
      'reports.center',
      'reports.parents',
      'safety',
    ],
    badges: { 'usage.privacy': 5, community: 4, safety: 6, 'reports.center': 3 },
  },
  {
    id: 'grade-group',
    name: '六年级语文教研组',
    fullName: '六年级语文教研组',
    role: '教研协作',
    scopeNote: '教研协作 · 12人',
    scopeLabel: '六年级语文教研组',
    person: { name: '林老师', account: 'lin.yc@peixin.edu', avatarTone: 'brand' },
    hasClassScope: false,
    // 教研组没有直属班级，但按教研范围（六年级三个班）可以下钻
    classScope: 'grade',
    allow: [
      'home',
      'teaching.books',
      'teaching.arrangements',
      'classes.overview',
      'usage.overview',
      'community',
      'reports.center',
    ],
    badges: { community: 2 },
  },
  {
    id: 'grade-admin',
    name: '六年级管理',
    fullName: '培新小学 · 六年级',
    role: '年级管理',
    scopeNote: '年级管理 · 68人',
    scopeLabel: '六年级',
    person: { name: '林老师', account: 'lin.yc@peixin.edu', avatarTone: 'brand' },
    hasClassScope: true,
    classScope: 'grade',
    allow: [
      'home',
      'accounts.classes',
      'accounts.org',
      'teaching.books',
      'teaching.import',
      'teaching.arrangements',
      'classes.overview',
      'classes.eyecare',
      'usage.overview',
      'usage.quota',
      'usage.sessions',
      'usage.privacy',
      'community',
      'reports.center',
      'reports.parents',
      'safety',
    ],
    badges: { 'usage.privacy': 8, community: 6, safety: 4, 'reports.center': 2 },
  },
  {
    id: 'school-admin',
    name: '培新小学管理',
    fullName: '培新小学 · 校级管理',
    role: '学校管理',
    scopeNote: '学校管理 · 156人',
    scopeLabel: '全校',
    person: { name: '林老师', account: 'lin.yc@peixin.edu', avatarTone: 'brand' },
    // 校长／书记没有具体班级关系：社区管理隐藏「班级」页签，班级列表也不出现；
    // 但他们仍然要能从组织账号与班级学生总览进全校任一班级与学生详情
    hasClassScope: false,
    classScope: 'school',
    allow: [
      'home',
      'accounts.org',
      'teaching.books',
      'teaching.import',
      'teaching.arrangements',
      'classes.overview',
      'classes.eyecare',
      'usage.overview',
      'usage.quota',
      'usage.sessions',
      'usage.privacy',
      'community',
      'reports.center',
      'reports.parents',
      'reports.templates',
      'safety',
    ],
    badges: { 'usage.privacy': 12, community: 9, safety: 7, 'reports.center': 5 },
  },
  {
    id: 'platform-ops',
    name: '平台运营',
    fullName: '读伴平台 · 运营维护',
    role: '平台运营',
    scopeNote: '多校运营 · 12 所学校',
    scopeLabel: '全平台',
    person: { name: '林老师', account: 'lin.yc@duban.dev', avatarTone: 'ink' },
    hasClassScope: false,
    classScope: 'platform',
    allow: [
      'home',
      'accounts.org',
      'accounts.roles',
      'teaching.books',
      'teaching.import',
      'teaching.arrangements',
      'classes.overview',
      'classes.eyecare',
      'usage.overview',
      'usage.quota',
      'usage.sessions',
      'usage.privacy',
      'usage.models',
      'community',
      'reports.center',
      'reports.parents',
      'reports.templates',
      'safety',
      'ops',
    ],
    badges: { 'usage.privacy': 3, community: 14, safety: 11, 'reports.center': 8 },
  },
]

// 角标只允许四类：待处理隐私申请 / 待审核社区内容 / 安全事件 / 发送失败报告。
// 安全事件与报告的角标改为从 Stage 5 的数据实算，避免出现「角标 6、页面里只有 2 条」
// 这种对不上的情况（Stage 4 自检抓到过同类问题）。
const OPEN_EVENT = ['pending', 'working', 'review']

for (const w of WORKSPACES) {
  if (w.allow.includes('safety')) {
    w.badges.safety = getEvents(w.id).filter((e) => OPEN_EVENT.includes(e.status)).length
  }
  if (w.allow.includes('reports.center')) {
    // 只数「发送失败」，待确认与待审核不占角标
    w.badges['reports.center'] = getReports(w.id).filter((r) => r.status === 'failed').length
  }
  for (const k of Object.keys(w.badges)) {
    if (!w.badges[k]) delete w.badges[k]
  }
}

export const DEFAULT_WORKSPACE_ID = WORKSPACES[0].id

export function getWorkspace(id) {
  return WORKSPACES.find((w) => w.id === id) || WORKSPACES[0]
}
