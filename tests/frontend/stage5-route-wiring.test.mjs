import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

test('阅读器返回的书籍详情路由挂载真实 BookDetail，不回落统一 unavailable 页', async () => {
  const app = await source('../../src/student/StudentApp.jsx')
  const detail = await source('../../src/student/pages/BookDetail.jsx')
  assert.match(app, /import BookDetail from '\.\/pages\/BookDetail\.jsx'/)
  assert.match(app, /path="books\/:bookId" element={<FullPage><BookDetail \/><\/FullPage>}/)
  assert.doesNotMatch(detail, /\.\.\/data\//)
})

test('安排详情路由挂载真实数据页，未实现写操作不得保留演示确认文案', async () => {
  const app = await source('../../src/console/ConsoleApp.jsx')
  const detail = await source('../../src/console/pages/teaching/ArrangeDetail.jsx')
  assert.match(app, /import ArrangeDetail from '\.\/pages\/teaching\/ArrangeDetail\.jsx'/)
  assert.match(app, /path="teaching\/arrangements\/:planId" element={<ArrangeDetail \/>}/)
  assert.match(detail, /useAssignmentsData/)
  assert.doesNotMatch(detail, /data\/fixtures|演示环境不会/)
})

test('ConsoleShell 将深路由计算结果传给二级导航高亮', async () => {
  const shell = await source('../../src/console/components/shell/ConsoleShell.jsx')
  assert.match(shell, /resolveConsoleNavigation/)
  assert.match(shell, /activeLeafKey={activeNavigation\.leafKey}/)
})

test('学生个人入口挂载真实页面，页面不再导入静态演示数据', async () => {
  const app = await source('../../src/student/StudentApp.jsx')
  const pages = await Promise.all([
    'Footprint.jsx', 'Highlights.jsx', 'Notes.jsx', 'Lists.jsx', 'ListDetail.jsx', 'Level.jsx',
    'Usage.jsx', 'TeacherHub.jsx', 'MyPosts.jsx',
  ].map((name) => source(`../../src/student/pages/${name}`)))

  for (const route of ['me/footprint', 'me/highlights', 'me/notes', 'me/level', 'me/usage', 'me/teacher', 'me/posts', 'lists', 'lists/:listId']) {
    assert.match(app, new RegExp(`path="${route.replace('/', '\\/')}"`))
  }
  for (const page of pages) assert.doesNotMatch(page, /from ['"]\.\.\/data\//)
})

test('没有服务端设置契约时，个人主页保留原卡片内的诚实状态而不跳转静态设置页', async () => {
  const app = await source('../../src/student/StudentApp.jsx')
  const me = await source('../../src/student/pages/Me.jsx')
  const level = await source('../../src/student/pages/Level.jsx')

  assert.doesNotMatch(app, /import Settings/)
  assert.doesNotMatch(me, /to="\/student\/settings"/)
  assert.match(me, /设置服务端接入中/)
  assert.match(level, /useReadingStatistics/)
  assert.doesNotMatch(level, /\.\.\/data\//)
})

test('阅读器和个人内容写入走正式阅读对象接口，不再声明收藏或批注不可用', async () => {
  const reader = await source('../../src/student/pages/Reader.jsx')
  const detail = await source('../../src/student/pages/BookDetail.jsx')
  const adapter = await source('../../src/student/state/usePersonalReadingAdapter.js')

  assert.match(reader, /useReadingLibrary/)
  assert.match(reader, /library\.createExcerpt/)
  assert.match(reader, /library\.createAnnotation/)
  assert.match(reader, /library\.createBookmark/)
  assert.match(reader, /library\.deleteBookmark/)
  assert.doesNotMatch(reader, /unavailable\('收藏摘录'\)|unavailable\('添加批注'\)/)
  assert.match(detail, /library\.createFavorite/)
  assert.match(detail, /library\.deleteFavorite/)
  assert.match(adapter, /Number\.isFinite\(statisticsMinutes\)/)
})

test('主站可见书籍入口先进入真实详情，AI 向导不再推荐旧壳静态书目', async () => {
  const [app, home, layout, card] = await Promise.all([
    source('../../src/App.jsx'),
    source('../../src/pages/Home.jsx'),
    source('../../src/components/Layout.jsx'),
    source('../../src/components/ui.jsx'),
  ])

  assert.match(app, /Navigate to="\/student\/shelf"/)
  assert.match(app, /Navigate to=\{`\/student\/books\/\$\{bookId\}`\}/)
  assert.match(layout, /to="\/student\/shelf"/)
  assert.match(layout, /进入真实书架/)
  assert.doesNotMatch(layout, /from '\.\.\/data\/books\.js'/)
  assert.doesNotMatch(layout, /to=\{`\/reader\//)
  assert.doesNotMatch(home, /from '\.\.\/data\/books\.js'/)
  assert.match(home, /to="\/student\/shelf"/)
  assert.match(home, /书目由学校真实书库提供/)
  assert.match(card, /to=\{`\/student\/books\/\$\{book\.id\}`\}/)
  assert.doesNotMatch(card, /to=\{`\/reader\//)
})

test('可达的无后端控件必须明确禁用，不能留下看似可点击的假动作', async () => {
  const [layout, blog, topBar, aiPanel, aiMessages] = await Promise.all([
    source('../../src/components/Layout.jsx'),
    source('../../src/pages/Blog.jsx'),
    source('../../src/console/components/shell/TopBar.jsx'),
    source('../../src/student/components/AiPanel.jsx'),
    source('../../src/student/components/AiMessages.jsx'),
  ])

  assert.match(layout, /disabled\s+title="搜索暂未开放"/)
  assert.doesNotMatch(layout, /cursor-pointer/)
  assert.match(blog, /type="email"\s+disabled\s+title="订阅服务暂未开放/)
  assert.match(blog, /type="button"\s+disabled\s+title="订阅服务暂未开放/)
  assert.match(blog, /订阅服务暂未开放，当前不会收集邮箱/)
  assert.match(topBar, /label="帮助与反馈"\s+disabled\s+title="帮助与反馈服务暂未开放"/)
  assert.match(topBar, /disabled=\{disabled\}/)
  assert.match(topBar, /暗色主题暂未接入/)
  assert.match(aiPanel, /disabled\s+title="回答正在由服务端完整生成并校验引用，暂不支持中途停止"/)
  assert.doesNotMatch(aiPanel, /onClick=\{ai\.stop\}/)
  assert.match(aiMessages, /disabled\s+className="student-ai-mini cursor-not-allowed opacity-55"\s+title="重新回答暂未开放/)
  assert.doesNotMatch(aiMessages, /onClick=\{\(\) => onFeedback/)
  assert.match(aiMessages, /回答反馈暂未开放，不会伪造保存结果/)
})

test('学生和书目详情挂到真实权限端路由，旧详情 fixture 不得回流生产入口', async () => {
  const [app, context, access, studentDetail, library, bookDetail, overview] = await Promise.all([
    source('../../src/console/ConsoleApp.jsx'),
    source('../../src/console/state/ConsoleContext.jsx'),
    source('../../src/console/state/consoleAccess.js'),
    source('../../src/console/pages/accounts/StudentDetail.jsx'),
    source('../../src/console/pages/teaching/BookLibrary.jsx'),
    source('../../src/console/pages/teaching/BookDetail.jsx'),
    source('../../src/console/pages/ClassOverview.jsx'),
  ])

  assert.match(app, /path="accounts\/students\/:studentId" element={<StudentDetail \/>}/)
  assert.match(app, /path="teaching\/books" element={<BookLibrary \/>}/)
  assert.match(app, /path="teaching\/books\/:bookId" element={<BookDetail \/>}/)
  assert.match(context, /canAccessConsolePath/)
  assert.match(access, /accounts\\\/students\\\/\[\^\/\]\+/)
  assert.match(access, /books\\\/\[\^\/\]\+/)
  for (const page of [studentDetail, library, bookDetail]) {
    assert.doesNotMatch(page, /data\/fixtures|演示环境不会|演示用虚构书目/)
  }
  assert.match(studentDetail, /useStage4ConsoleData\('studentDetail'/)
  assert.match(library, /useStage4ConsoleData\('bookLibrary'/)
  assert.match(bookDetail, /useStage4ConsoleData\('bookDetail'/)
  assert.match(overview, /\/console\/teaching\/books\/\$\{c\.bookId\}/)
  assert.doesNotMatch(overview, /\/console\/library\/books/)
})

test('权限端只读或缺契约的动作必须局部禁用，不能弹出假成功确认框', async () => {
  const [privacy, sessions, eyeCare] = await Promise.all([
    source('../../src/console/pages/usage/Privacy.jsx'),
    source('../../src/console/pages/usage/Sessions.jsx'),
    source('../../src/console/pages/classes/EyeCare.jsx'),
  ])

  assert.doesNotMatch(privacy, /ConfirmModal/)
  assert.match(privacy, /由学生端处理/)
  assert.match(privacy, /私密会话申请只能由学生端同意或拒绝/)
  assert.match(sessions, /干预记录写入接口暂未开放/)
  assert.match(sessions, /navigate\(`\/console\/safety\/\$\{session\.eventId\}`\)/)
  assert.doesNotMatch(sessions, /演示环境不写入/)
  assert.doesNotMatch(eyeCare, /60 \* 60|30 \* 60|5 \* 60/)
  assert.match(eyeCare, /服务端未返回每日上限/)
  assert.match(eyeCare, /查看限制策略/)
})

test('被涉事回避的教师打开安全入口时显示真实权限边界，不回流安全列表 fixture', async () => {
  const app = await source('../../src/console/ConsoleApp.jsx')

  assert.match(app, /const permissionDenied = resource\.error\?\.code === 'PERMISSION_DENIED'/)
  assert.match(app, /当前身份无权查看安全事件/)
  assert.match(app, /该账号未进入当前事件通知链，或已因涉事回避被排除。/)
  assert.doesNotMatch(app, /import SafetyList/)
})

test('普通工作空间直达平台审计时显示前端权限空态，不依赖后端 403', async () => {
  const [app, context] = await Promise.all([
    source('../../src/console/ConsoleApp.jsx'),
    source('../../src/console/state/ConsoleContext.jsx'),
  ])

  assert.match(context, /canAccessConsolePath/)
  assert.match(app, /function PlatformAuditRoute/)
  assert.match(app, /canAccessPath\('\/console\/platform\/audit'\)/)
  assert.match(app, /当前工作空间无权访问平台审计/)
})

test('社区与报告只暴露已有真实写接口，其余动作明确留在对应真实页面', async () => {
  const [community, reportCenter, reportDetail] = await Promise.all([
    source('../../src/console/pages/Community.jsx'),
    source('../../src/console/pages/reports/ReportCenter.jsx'),
    source('../../src/console/pages/reports/ReportDetail.jsx'),
  ])

  assert.match(community, /const acts = post\.status === 'pending' \? \['approve', 'reject'\] : \[\]/)
  assert.match(community, /const saved = await reviewPost/)
  assert.doesNotMatch(community, /void reviewPost/)
  assert.match(reportCenter, /模板与规则的真实读取接口暂未开放/)
  assert.match(reportCenter, /<Btn icon="Settings2" disabled>/)
  assert.match(reportDetail, /await resource\.reviewReport/)
  assert.match(reportDetail, /家长发送任务仍需在家长发送页单独创建/)
  assert.doesNotMatch(reportDetail, /setRule\(|setChannel\(|setScope\(|setTiming\(/)
  assert.doesNotMatch(reportDetail, /\/console\/reports\/templates/)
})
