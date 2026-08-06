import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createConsoleApi } from '../../src/api/console.js'
import { createStudentApi } from '../../src/api/student.js'

test('教师阅读器保留原壳并通过真实课堂 hook 接线', async () => {
  const [page, studentReader, app, runtime, bookFlip] = await Promise.all([
    readFile(new URL('../../src/console/pages/teaching/TeacherReader.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/student/pages/Reader.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/console/ConsoleApp.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/console/state/useTeacherReaderRuntime.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/console/components/BookFlip.jsx', import.meta.url), 'utf8'),
  ])
  for (const marker of ['<BookFlip', '<SyncControl', '<PeopleStat', '<ConfirmModal', 'console-enter flex flex-col']) assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(page, /data\/fixtures|localStorage|sessionStorage/)
  assert.match(page, /useTeacherReaderRuntime/)
  assert.match(page, /if \(runtime\.classroom\?\.mode !== 'sync'\) return/)
  assert.match(page, /setPage\(syncedPage\)/)
  assert.match(app, /path="teaching\/reader\/:bookId"\s+element={<TeacherReader\s*\/>}/)
  assert.match(runtime, /startClassroom/)
  assert.match(runtime, /getClassroomState\(book\.classReading\.id/)
  assert.match(runtime, /claimClassroomControl/)
  assert.match(runtime, /lockClassroomBook/)
  assert.match(runtime, /syncClassroomPage/)
  assert.match(runtime, /endClassroom/)
  assert.match(runtime, /if \(current\.classroom\?\.id && current\.classroom\.status !== 'ended'\)[\s\S]*claimClassroomControl\(current\.classroom\.id/)
  assert.match(bookFlip, /const targetIsVisible = current === target \|\| \(!portrait && current \+ 1 === target\)/)
  assert.match(bookFlip, /if \(!targetIsVisible\) api\.turnToPage\(target\)/)
  assert.match(studentReader, /broadcastReceiptPending/)
  assert.match(studentReader, /if \(!session\.broadcast\.received && broadcastReceiptPending\.current !== session\.broadcast\.id\)/)
})

test('课堂 API 覆盖教师控制与学生接收回执', async () => {
  const calls = []
  const client = {
    get(path, options) { calls.push({ method: 'GET', path, options }); return Promise.resolve({ data: {} }) },
    post(path, options) { calls.push({ method: 'POST', path, options }); return Promise.resolve({ data: {} }) },
    patch(path, options) { calls.push({ method: 'PATCH', path, options }); return Promise.resolve({ data: {} }) },
  }
  const consoleApi = createConsoleApi(client)
  const studentApi = createStudentApi(client)
  await consoleApi.startClassroom({ assignmentId: 'assignment-1' }, { workspaceId: 'workspace-1', idempotencyKey: 'start-1' })
  await consoleApi.lockClassroomBook('session-1', { bookVersionId: 'version-1' }, { workspaceId: 'workspace-1', idempotencyKey: 'lock-1' })
  await consoleApi.syncClassroomPage('session-1', { pageNo: 3 }, { workspaceId: 'workspace-1', idempotencyKey: 'page-1' })
  await studentApi.joinClassroom('session-1', { workspaceId: 'workspace-1', idempotencyKey: 'join-1' })
  await studentApi.acknowledgeClassroomBroadcast('session-1', 'broadcast-1', { workspaceId: 'workspace-1', idempotencyKey: 'receive-1' })
  assert.deepEqual(calls.map(({ method, path }) => ({ method, path })), [
    { method: 'POST', path: '/classroom/sessions' },
    { method: 'PATCH', path: '/classroom/sessions/session-1/book-lock' },
    { method: 'PATCH', path: '/classroom/sessions/session-1/page' },
    { method: 'POST', path: '/classroom/sessions/session-1/join' },
    { method: 'POST', path: '/classroom/sessions/session-1/broadcasts/broadcast-1/received' },
  ])
})
