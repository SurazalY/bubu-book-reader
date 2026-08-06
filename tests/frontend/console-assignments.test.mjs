import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createConsoleApi } from '../../src/api/console.js'

test('阅读安排页面保留原壳结构且生产入口不再导入 fixture', async () => {
  const [page, app] = await Promise.all([
    readFile(new URL('../../src/console/pages/teaching/ArrangeList.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/console/ConsoleApp.jsx', import.meta.url), 'utf8'),
  ])

  assert.match(page, /<PagePanel\b/)
  assert.match(page, /<Modal\b/)
  assert.match(page, /<table\b/)
  assert.match(page, /<thead>/)
  assert.match(page, /<tbody>/)
  assert.match(page, /step === 1/)
  assert.doesNotMatch(page, /data\/fixtures\/(?:arrangements|classes|books)\.js/)
  assert.doesNotMatch(page, /localStorage|sessionStorage/)
  assert.match(page, /import \{ cx \} from '\.\.\/\.\.\/\.\.\/shared\/cx\.js'/)
  assert.match(app, /path="teaching\/arrangements"\s+element={<ArrangeList\s*\/>}/)
})

test('阅读安排适配器使用真实书籍版本与当前 class 工作空间', async () => {
  const { toAssignmentCreateBody, toAssignmentsDto } = await import('../../src/adapters/consoleAssignments.js')
  const dto = toAssignmentsDto({
    workspaceId: 'workspace-class-a',
    workspaces: {
      items: [
        {
          id: 'workspace-class-a',
          organizationId: 'organization-a',
          name: '三年级一班',
          scopeType: 'class',
          scopeId: 'class-a',
        },
      ],
    },
    books: {
      items: [
        {
          id: 'book-a',
          versionId: 'book-version-a',
          title: '真实书目',
          author: '真实作者',
          cover: { url: '/books/real-cover.jpg' },
        },
      ],
    },
    assignments: {
      items: [
        {
          id: 'assignment-a',
          title: '第一章',
          book: { id: 'book-version-a', title: '真实书目' },
          class: { id: 'class-a', name: '三年级一班' },
          startsAt: '2026-08-06T09:00:00+08:00',
          endsAt: '2026-08-12T23:59:00+08:00',
          status: 'scheduled',
        },
      ],
    },
  })

  assert.deepEqual(dto.classes, [{ id: 'class-a', name: '三年级一班' }])
  assert.equal(dto.books[0].id, 'book-a')
  assert.equal(dto.books[0].versionId, 'book-version-a')
  assert.equal(dto.books[0].coverUrl, '/books/real-cover.jpg')
  assert.equal(dto.arrangements[0].bookVersionId, 'book-version-a')

  const body = toAssignmentCreateBody({
    book: dto.books[0],
    classIds: ['class-a'],
    title: '第一章',
    start: '2026-08-06',
    end: '2026-08-12',
    startTime: '09:00',
  })
  assert.deepEqual(body, {
    bookVersionId: 'book-version-a',
    classIds: ['class-a'],
    title: '第一章',
    startsAt: '2026-08-06T09:00:00+08:00',
    endsAt: '2026-08-12T23:59:00+08:00',
  })
})

test('权限端 API 用真实幂等写请求创建安排', async () => {
  const calls = []
  const api = createConsoleApi({
    get(path, options) {
      calls.push({ method: 'GET', path, options })
      return Promise.resolve({ data: { items: [] }, meta: {} })
    },
    post(path, options) {
      calls.push({ method: 'POST', path, options })
      return Promise.resolve({ data: { assignmentId: 'assignment-a' }, meta: {} })
    },
  })

  await api.listBooks({ workspaceId: 'workspace-class-a' })
  await api.createAssignment(
    {
      bookVersionId: 'book-version-a',
      classIds: ['class-a'],
      title: '第一章',
      startsAt: '2026-08-06T09:00:00+08:00',
      endsAt: '2026-08-12T23:59:00+08:00',
    },
    { workspaceId: 'workspace-class-a', idempotencyKey: 'assignment:create:test' },
  )

  assert.deepEqual(calls[0], {
    method: 'GET',
    path: '/books',
    options: { workspaceId: 'workspace-class-a', query: { limit: 100 } },
  })
  assert.equal(calls[1].method, 'POST')
  assert.equal(calls[1].path, '/assignments')
  assert.equal(calls[1].options.idempotencyKey, 'assignment:create:test')
  assert.equal(calls[1].options.body.bookVersionId, 'book-version-a')
})
