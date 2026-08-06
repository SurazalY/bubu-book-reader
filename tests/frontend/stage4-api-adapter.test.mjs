import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { ApiError } from '../../src/api/envelope.js'
import { createStage4ConsoleApi } from '../../src/api/stage4.js'
import {
  STAGE4_CONSOLE_SURFACES,
  resolveStage4ConsoleData,
} from '../../src/console/state/useStage4ConsoleData.js'

function response(data, meta = {}) {
  return Promise.resolve({ data, meta })
}

test('安全事件列表只请求真实工作空间 API', async () => {
  const calls = []
  const api = createStage4ConsoleApi({
    get(path, options) {
      calls.push({ path, options })
      return response({ items: [{ id: 'safety-1' }] }, { requestId: 'req-safety' })
    },
  })

  const result = await api.loadSurface('safetyList', { workspaceId: 'school-1', query: { status: 'open' } })
  assert.equal(result.status, 'ready')
  assert.deepEqual(result.data.items, [{ id: 'safety-1' }])
  assert.deepEqual(calls, [{
    path: '/safety/events',
    options: { workspaceId: 'school-1', query: { limit: 100, status: 'open' } },
  }])
})

test('班级列表由真实学生名单聚合且详情保持同一资源范围', async () => {
  const calls = []
  const api = createStage4ConsoleApi({
    get(path, options) {
      calls.push({ path, options })
      return response({ items: [
        { id: 'student-2', displayName: '学生乙', classId: 'class-1', className: '一班' },
        { id: 'student-1', displayName: '学生甲', classId: 'class-1', className: '一班' },
        { id: 'student-3', displayName: '学生丙', classId: 'class-2', className: '二班' },
      ] })
    },
  })

  const list = await api.loadSurface('classList', { workspaceId: 'school-1' })
  assert.equal(list.status, 'ready')
  assert.deepEqual(list.data.items.map((item) => [item.id, item.studentCount]), [
    ['class-1', 2],
    ['class-2', 1],
  ])

  const detail = await api.loadSurface('classDetail', { workspaceId: 'school-1', resourceId: 'class-1' })
  assert.equal(detail.status, 'ready')
  assert.equal(detail.data.id, 'class-1')
  assert.deepEqual(detail.data.students.map((student) => student.id), ['student-1', 'student-2'])
  assert.equal(calls.every((call) => call.path === '/students' && call.options.workspaceId === 'school-1'), true)
})

test('书目详情从真实书目列表选择，不生成演示兜底', async () => {
  const api = createStage4ConsoleApi({
    get(path, options) {
      assert.equal(path, '/books')
      assert.equal(options.workspaceId, 'school-1')
      return response({ items: [{ id: 'book-1', title: '真实书目' }] })
    },
  })

  const hit = await api.loadSurface('bookDetail', { workspaceId: 'school-1', resourceId: 'book-1' })
  assert.equal(hit.status, 'ready')
  assert.equal(hit.data.title, '真实书目')

  const missing = await api.loadSurface('bookDetail', { workspaceId: 'school-1', resourceId: 'book-missing' })
  assert.equal(missing.status, 'empty')
  assert.equal(missing.data, null)
})

test('缺少教师护眼与隐私 HTTP 契约时返回 unavailable 且不发伪请求', async () => {
  let called = false
  const api = createStage4ConsoleApi({
    get() {
      called = true
      throw new Error('不应调用')
    },
  })

  for (const surface of ['eyeCare', 'sessions', 'privacy']) {
    const result = await api.loadSurface(surface, { workspaceId: 'school-1' })
    assert.equal(result.status, 'unavailable')
    assert.equal(result.data, null)
    assert.match(result.reason.message, /真实 API/)
  }
  assert.equal(called, false)
})

test('真实接口错误保持 error，不降级为空数据或 fixture', async () => {
  const api = createStage4ConsoleApi({
    get() {
      throw new ApiError({ code: 'DEPENDENCY_UNAVAILABLE', message: '服务暂不可用', retryable: true })
    },
  })

  await assert.rejects(
    () => resolveStage4ConsoleData({ api, surface: 'safetyList', workspaceId: 'school-1' }),
    (error) => error instanceof ApiError && error.code === 'DEPENDENCY_UNAVAILABLE',
  )
})

test('Stage 4 生产适配层不引用 fixture、mock、demo 或本地业务存储', async () => {
  const sources = await Promise.all([
    readFile(new URL('../../src/api/stage4.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/console/state/useStage4ConsoleData.js', import.meta.url), 'utf8'),
  ])
  for (const source of sources) {
    assert.doesNotMatch(source, /data\/fixtures|\bmocks?\b|\bfixtures?\b|localStorage|sessionStorage|indexedDB/i)
  }
  assert.equal(Object.keys(STAGE4_CONSOLE_SURFACES).length, 10)
})
