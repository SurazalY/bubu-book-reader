import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createApiClient } from '../../src/api/client.js'
import { createAuthApi } from '../../src/api/auth.js'
import { createConsoleApi } from '../../src/api/console.js'
import { createStudentApi } from '../../src/api/student.js'
import { toConsoleRuntimeDto } from '../../src/adapters/console.js'
import { toConsoleHomeDto } from '../../src/adapters/consoleHome.js'
import { loadConsoleHomeData } from '../../src/console/state/useConsoleHomeData.js'
import { ApiError, unwrapApiEnvelope } from '../../src/api/envelope.js'
import { toSafetyDetailDto } from '../../src/adapters/safety.js'
import { toReaderPageDto, toStudentAiDto, toStudentRuntimeDto } from '../../src/adapters/student.js'
import { inspectFinalRouteSurfaces, scanFinalRuntimeGraphs } from './runtime-import-scan.mjs'

function response({ status = 200, payload, requestId = 'req-test' }) {
  return {
    status,
    headers: {
      get(name) {
        if (name.toLowerCase() === 'content-type') return 'application/json'
        if (name.toLowerCase() === 'x-request-id') return requestId
        return null
      },
    },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }
}

test('统一成功信封保留 data 与 meta', () => {
  const result = unwrapApiEnvelope({ data: { id: 'book-1' }, meta: { requestId: 'req-1' } })
  assert.deepEqual(result, { data: { id: 'book-1' }, meta: { requestId: 'req-1' } })
})

test('统一失败信封暴露服务端错误码与请求标识', () => {
  assert.throws(
    () => unwrapApiEnvelope({ error: { code: 'PERMISSION_DENIED', message: '无权访问', requestId: 'req-2' } }, { status: 403 }),
    (error) => error instanceof ApiError && error.code === 'PERMISSION_DENIED' && error.requestId === 'req-2',
  )
})

test('客户端发送真实工作空间上下文且保留 Cookie 会话', async () => {
  let received = null
  const client = createApiClient({
    baseUrl: '/api/v1',
    fetchImpl: async (url, options) => {
      received = { url, options }
      return response({ payload: { data: { ok: true }, meta: {} } })
    },
  })

  const result = await client.get('/safety/events/event-1', { workspaceId: 'workspace-1' })
  assert.equal(result.data.ok, true)
  assert.equal(received.url, '/api/v1/safety/events/event-1')
  assert.equal(received.options.headers['X-Workspace-Id'], 'workspace-1')
  assert.equal(received.options.credentials, 'include')
})

test('写请求拒绝缺少 Idempotency-Key 的本地伪提交', async () => {
  const client = createApiClient({ fetchImpl: async () => response({ payload: { data: {}, meta: {} } }) })
  await assert.rejects(
    () => client.post('/reading/events/batch', { body: { events: [] } }),
    (error) => error instanceof ApiError && error.code === 'VALIDATION_FAILED',
  )
})

test('安全事件关闭适配器保留工作空间、幂等键和人工说明', async () => {
  const calls = []
  const api = createConsoleApi({
    post(path, options) {
      calls.push({ path, options })
      return Promise.resolve({ data: { status: 'closed' }, meta: {} })
    },
  })
  await api.closeSafetyEvent(
    'event-1',
    { outcome: 'closed', note: '已完成线下联系。' },
    { workspaceId: 'school-workspace', idempotencyKey: 'safety-close:event-1' },
  )
  assert.deepEqual(calls, [{
    path: '/safety/events/event-1/close',
    options: {
      workspaceId: 'school-workspace',
      idempotencyKey: 'safety-close:event-1',
      body: { outcome: 'closed', note: '已完成线下联系。' },
    },
  }])
})

test('登录适配器只提交 schoolCode+loginName+password 并使用真实幂等写请求', async () => {
  const calls = []
  const api = createAuthApi({
    post(path, options) {
      calls.push({ path, options })
      return Promise.resolve({ data: { navigation: { defaultPath: '/student/home' } }, meta: {} })
    },
  })

  const response = await api.login({
    schoolCode: 'demo-school',
    loginName: 'student-1',
    password: 'secret-value',
  }, { idempotencyKey: 'auth-login-test' })
  assert.equal(response.data.navigation.defaultPath, '/student/home')
  assert.deepEqual(calls, [{
    path: '/auth/login',
    options: {
      idempotencyKey: 'auth-login-test',
      body: { schoolCode: 'demo-school', loginName: 'student-1', password: 'secret-value' },
    },
  }])
})

test('安全详情只映射服务端阈值、符合条数与复核结论', () => {
  const event = toSafetyDetailDto({
    id: 'event-1',
    status: 'pending_human_confirmation',
    risk_level: 'high',
    threshold: 0.8,
    qualifying_message_count: 3,
    review_result: 'uncertain',
    source: 'manual_demo_test',
    displayLabel: '演示测试事件',
    student: { id: 'student-1', displayName: '测试学生' },
    notificationTargets: [
      { userId: 'staff-1', displayName: '测试管理员', deliveryStatus: 'planned', plannedAt: '2026-08-05T21:00:00.000Z' },
    ],
    dispatchedNotifications: [],
    deliveredNotifications: [],
  })

  assert.equal(event.threshold, 0.8)
  assert.equal(event.qualifyingMessageCount, 3)
  assert.equal(event.reviewResult, 'uncertain')
  assert.equal(event.source, 'manual_demo_test')
  assert.equal(event.displayLabel, '演示测试事件')
  assert.equal(event.student.name, '测试学生')
  assert.equal(event.context.length, 0)
  assert.deepEqual(event.notificationTargets, [{
    id: 'staff-1',
    name: '测试管理员',
    role: null,
    at: '2026-08-05T21:00:00.000Z',
    state: 'planned',
  }])
  assert.equal(event.notified.length, 0)
  assert.equal(event.delivered.length, 0)
})

test('学生端运行时 DTO 只保留真实 API 数据，不携带过渡壳标记', () => {
  const runtime = toStudentRuntimeDto({
    session: { user: { id: 'student-1', displayName: '测试学生' } },
    books: { items: [] },
    progress: { items: [] },
    eyeCare: {},
  })

  assert.equal(runtime.student.id, 'student-1')
  assert.equal(Object.hasOwn(runtime, 'shellReady'), false)
  assert.equal(Object.hasOwn(runtime, 'transitionalSources'), false)
})

test('四条真实路由保留 Claude 页面组件树，并具备成功与失败分支', async () => {
  const surfaces = inspectFinalRouteSurfaces()
  assert.deepEqual(surfaces.map((surface) => surface.route), [
    '/student/home',
    '/student/reader/:bookId',
    '/console/home',
    '/console/safety/:eventId',
  ])
  for (const surface of surfaces) {
    assert.equal(surface.routePresent, true, `${surface.route} route`)
    assert.equal(surface.successPathPresent, true, `${surface.route} ready path`)
    assert.equal(surface.failurePathPresent, true, `${surface.route} failure path`)
    assert.equal(surface.runtimeGatePresent, false, `${surface.route} must not use RuntimeGate`)
  }

  const files = await Promise.all([
    'StudentApp.jsx',
    'components/StudentShell.jsx',
    'components/BottomNav.jsx',
    'components/BookCard.jsx',
    'components/BookPage.jsx',
    'pages/Home.jsx',
    'pages/Reader.jsx',
  ].map((file) => readFile(new URL(`../../src/student/${file}`, import.meta.url), 'utf8')))
  const [app, shell, navigation, card, page, home, reader] = files

  assert.match(app, /<Backdrop\s*\/>/)
  assert.match(app, /<Route\s+element={<StudentShell\s*\/>}/)
  assert.match(shell, /student-scroll min-h-0 flex-1 overflow-y-auto/)
  assert.match(navigation, /student-navbar/)
  assert.match(card, /student-book-card student-stagger group flex cursor-pointer flex-col p-3 text-left/)
  assert.match(card, /<BookCover\s+book={book}\s+className="student-cover"/)
  assert.match(page, /student-page-frame/)
  assert.match(page, /student-page-inner/)
  assert.match(home, /<Clock\s+className="student-enter px-1 pt-1"/)
  assert.match(home, /<BookCard\s+key={book.id}/)
  assert.match(reader, /student-reader-stage/)
  assert.match(reader, /<BookPage/)
  assert.match(reader, /<SelectionToolbar/)
  assert.match(reader, /<SelectionTray/)
})

test('生产构建的静态资源使用站点根路径，深链接不会请求嵌套路由下的 assets', async () => {
  const [config, entry] = await Promise.all([
    readFile(new URL('../../vite.config.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/main.jsx', import.meta.url), 'utf8'),
  ])
  assert.match(config, /base:\s*['"]\/['"]/)
  assert.doesNotMatch(config, /base:\s*['"]\.\/['"]/)
  assert.match(entry, /BrowserRouter/)
  assert.doesNotMatch(entry, /HashRouter/)
})

test('学生运行时上下文不初始化过渡业务数据或 localStorage', async () => {
  const source = await readFile(new URL('../../src/student/state/StudentContext.jsx', import.meta.url), 'utf8')

  assert.match(source, /useStudentRuntime/)
  assert.doesNotMatch(source, /localStorage|\.\.\/data\/|from '\.\/useAiChats|from '\.\/useCommunity|from '\.\/useMe/)
})

test('最终学生与权限入口模块图不带 fixture、演示数据或业务存储', () => {
  const results = scanFinalRuntimeGraphs()
  for (const result of results) {
    assert.deepEqual(result.forbiddenImports, [], result.entry)
    assert.deepEqual(result.storageReferences, [], result.entry)
  }
  const studentGraph = results.find((result) => result.entry === 'src/student/StudentApp.jsx')
  assert.ok(studentGraph.modules.includes('src/student/components/ReaderOverlays.jsx'))
  assert.deepEqual(studentGraph.allowedStorageReferences, ['src/student/reading-monitor/pendingStore.js'])
  const consoleGraph = results.find((result) => result.entry === 'src/console/ConsoleApp.jsx')
  assert.deepEqual(consoleGraph.allowedStorageReferences, [])
})

test('学生阅读器只把 API 分页正文映射为可渲染块', () => {
  const page = toReaderPageDto({ pageNo: 12, chapter: '第六章 河上的灯', blocks: [{ type: 'heading', text: '河上的灯' }, { text: '服务端返回的正文。' }] })
  assert.equal(page.no, 12)
  assert.deepEqual(page.blocks, [{ kind: 'heading', text: '河上的灯' }, { kind: 'paragraph', text: '服务端返回的正文。' }])
  const selectedPage = toReaderPageDto({ pageNo: 1, blocks: [{ blockId: 'evidence-1', text: '可以交给模型核验的原文。' }] })
  assert.deepEqual(selectedPage.blocks[0], {
    id: 'evidence-1',
    blockId: 'evidence-1',
    kind: 'paragraph',
    text: '可以交给模型核验的原文。',
  })

  const imagePage = toReaderPageDto({
    pageNo: 9,
    width: 1289,
    height: 1869,
    pageImage: { id: 'asset-page-9', kind: 'page_image', url: '/books/p9.png' },
    blocks: [{
      id: 'p0009-b001',
      text: '原书汉字',
      charStart: 0,
      charEnd: 4,
      coordinates: { x: 120, y: 240, width: 640, height: 96 },
    }],
  })
  assert.deepEqual(imagePage.pageImage, { id: 'asset-page-9', kind: 'page_image', url: '/books/p9.png' })
  assert.equal(imagePage.width, 1289)
  assert.equal(imagePage.height, 1869)
  assert.deepEqual(imagePage.blocks[0], {
    id: 'p0009-b001',
    blockId: 'p0009-b001',
    kind: 'paragraph',
    text: '原书汉字',
    bbox: { x: 120, y: 240, width: 640, height: 96 },
    charStart: 0,
    charEnd: 4,
  })
})

test('学生 AI 面板只消费服务端会话、额度并用真实写请求发送', async () => {
  const dto = toStudentAiDto({
    items: [{
      id: 'conversation-1',
      title: '关于第一章',
      messages: [{ id: 'message-1', role: 'user', text: '这句话是什么意思？', pageNo: 3 }],
    }],
    quota: { remaining: 4, usagePercent: 60, resetAt: '2026-08-07T00:00:00+08:00' },
  })
  assert.equal(dto.chats[0].messages[0].role, 'student')
  assert.equal(dto.quota.remaining, 4)
  assert.equal(dto.quota.usagePercent, 60)

  const calls = []
  const api = createStudentApi({
    post(path, options) {
      calls.push({ path, options })
      return Promise.resolve({ data: {}, meta: {} })
    },
  })
  await api.sendAiMessage(
    { bookId: 'book-1', text: '问题', quotes: [] },
    { idempotencyKey: 'student-ai:book-1:1:1' },
  )
  assert.deepEqual(calls[0], {
    path: '/ai/messages',
    options: {
      body: { bookId: 'book-1', text: '问题', quotes: [] },
      idempotencyKey: 'student-ai:book-1:1:1',
    },
  })

  const hook = await readFile(new URL('../../src/student/state/useStudentAiRuntime.js', import.meta.url), 'utf8')
  assert.match(hook, /api\.sendAiMessage/)
  assert.match(hook, /idempotencyKey/)
  assert.doesNotMatch(hook, /fixture|demo|mock|Math\.random|localStorage/)
})

test('权限首页仅从契约 API DTO 组装指标、安排和安全提醒', () => {
  const home = toConsoleHomeDto({
    usage: { metrics: { classCount: 6, effectiveReadingCount: 128, activeReaders: 34 }, series: { reading: { data: [3, 8, 13], labels: ['08:00', '12:00', '16:00'] } } },
    assignments: { items: [{ id: 'assignment-1', title: '草房子', className: '三年级（3）班' }] },
    safetyEvents: { items: [{ id: 'event-1', status: 'pending', summaryForStaff: '需要处理', pendingCount: 1 }] },
  })
  assert.equal(home.blocks[0].value, 6)
  assert.equal(home.blocks[1].value, 128)
  assert.equal(home.arrangements[0].id, 'assignment-1')
  assert.equal(home.todos[0].key, 'event-1')
  assert.equal(home.todos[0].count, 1)
})

test('权限首页在安全事件被拒绝时保留可读的统计和安排，并明确显示权限边界', async () => {
  const home = await loadConsoleHomeData({
    getUsageSummary: async () => ({ data: { metrics: { classCount: 1, effectiveReadingCount: 8, activeReaders: 2 } }, meta: { requestId: 'usage-1' } }),
    listAssignments: async () => ({ data: { items: [{ id: 'assignment-1', title: '真实安排' }] }, meta: {} }),
    listSafetyEvents: async () => {
      throw new ApiError({ code: 'PERMISSION_DENIED', message: '无权读取安全事件', status: 403 })
    },
  }, 'workspace-1')

  assert.equal(home.meta.requestId, 'usage-1')
  assert.equal(home.data.safetyStatus, 'forbidden')
  assert.equal(home.data.arrangements[0].id, 'assignment-1')
  assert.equal(home.data.todos.length, 0)
  assert.equal(home.data.blocks.find((block) => block.key === 'safety').unavailableReason, '当前身份无权查看安全事件')
})

test('书架 DTO 只保留后端 title、cover 与可用 assets', () => {
  const runtime = toStudentRuntimeDto({
    session: { user: { id: 'student-1' } },
    books: {
      items: [
        {
          id: 'alice-1',
          title: 'Alice 公共领域内部测试本',
          coverUrl: '  C:\\private\\alice-cover.png',
          assets: [
            { id: 'cover', kind: 'cover', url: '/api/v1/book-assets/alice-cover' },
            { id: 'source', kind: 'pdf', url: ' file:///C:/private/alice.pdf' },
          ],
        },
      ],
    },
    progress: { items: [] },
    eyeCare: {},
  })

  assert.equal(runtime.books[0].title, 'Alice 公共领域内部测试本')
  assert.equal(runtime.books[0].coverUrl, null)
  assert.deepEqual(runtime.books[0].assets, [{ id: 'cover', kind: 'cover', url: '/api/v1/book-assets/alice-cover' }])
})

test('权限端运行时 DTO 不从静态工作空间推导授权', () => {
  const runtime = toConsoleRuntimeDto({
    session: { user: { id: 'operator-1', displayName: '管理员' }, activeWorkspaceId: 'workspace-1' },
    workspaces: { items: [{ id: 'workspace-1', name: '真实工作空间', organizationId: 'school-1', scopeType: 'class', scopeId: 'class-1' }] },
  })

  assert.equal(runtime.workspace.id, 'workspace-1')
  assert.equal(runtime.workspace.organizationId, 'school-1')
  assert.equal(runtime.workspace.scopeType, 'class')
  assert.equal(runtime.workspace.scopeId, 'class-1')
  assert.equal(Object.hasOwn(runtime, 'shellReady'), false)
})
