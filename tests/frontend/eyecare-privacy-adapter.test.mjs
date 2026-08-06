import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  createStudentEyeCarePrivacyApi,
  deriveOfflineEyeCareState,
} from '../../src/student/state/useEyeCarePrivacy.js'
import { createConsolePrivacyEyeCareApi } from '../../src/console/state/usePrivacyEyeCareData.js'

test('学生适配器只调用真实护眼与隐私 API，并为决定写入提供幂等键', async () => {
  const calls = []
  const client = {
    get(path, options) { calls.push({ method: 'GET', path, options }); return Promise.resolve({ data: {}, meta: {} }) },
    post(path, options) { calls.push({ method: 'POST', path, options }); return Promise.resolve({ data: {}, meta: {} }) },
  }
  const api = createStudentEyeCarePrivacyApi(client)
  await api.getStatus({ workspaceId: 'workspace-class-1' })
  await api.listRequests({ workspaceId: 'workspace-class-1' })
  await api.listAccessHistory({ workspaceId: 'workspace-class-1' })
  await api.resolveRequest('request-1', 'approved', {
    workspaceId: 'workspace-class-1', idempotencyKey: 'privacy:decision:request-1:approved',
  })
  assert.deepEqual(calls.map(({ method, path }) => [method, path]), [
    ['GET', '/eyecare/status'],
    ['GET', '/privacy/access-requests'],
    ['GET', '/privacy/access-history'],
    ['POST', '/privacy/access-requests/request-1/decision'],
  ])
  assert.equal(calls[3].options.body.decision, 'approved')
  assert.equal(calls[3].options.idempotencyKey, 'privacy:decision:request-1:approved')
})

test('断网后沿用最后一次强制休息截止时间，到时自动恢复但不伪造新服务端数据', () => {
  const lastGood = {
    continuousEyeSeconds: 120,
    enforcement: {
      status: 'forced_rest',
      forcedRestUntil: '2026-08-06T05:20:30.000Z',
      offline: { failClosed: true, graceSeconds: 10 },
    },
  }
  const offlineLocked = deriveOfflineEyeCareState({
    lastGood,
    error: new Error('network unavailable'),
    now: new Date('2026-08-06T05:20:20.000Z'),
  })
  assert.equal(offlineLocked.enforcement.status, 'forced_rest')
  assert.equal(offlineLocked.offline, true)
  const expired = deriveOfflineEyeCareState({
    lastGood,
    error: new Error('network unavailable'),
    now: new Date('2026-08-06T05:20:31.000Z'),
  })
  assert.equal(expired.enforcement.status, 'normal')
  assert.equal(expired.stale, true)

  const reminder = deriveOfflineEyeCareState({
    lastGood: { enforcement: { status: 'reminder', forcedRestUntil: null } },
    error: new Error('network unavailable'),
    now: new Date('2026-08-06T05:20:20.000Z'),
  })
  assert.equal(reminder.enforcement.status, 'reminder')
})

test('权限端适配器保留范围、用途、误判语义和幂等写入', async () => {
  const calls = []
  const client = {
    get(path, options) { calls.push({ method: 'GET', path, options }); return Promise.resolve({ data: {}, meta: {} }) },
    post(path, options) { calls.push({ method: 'POST', path, options }); return Promise.resolve({ data: {}, meta: {} }) },
  }
  const api = createConsolePrivacyEyeCareApi(client)
  await api.listStudents({ workspaceId: 'workspace-school-1', query: { classId: 'class-1' } })
  await api.releaseFalsePositive('student-1', '误把课堂投屏算作个人用眼', {
    workspaceId: 'workspace-school-1', idempotencyKey: 'eyecare:release:student-1',
  })
  await api.createAccessRequest('conversation-1', '了解阅读困惑', {
    workspaceId: 'workspace-class-1', idempotencyKey: 'privacy:request:conversation-1',
  })
  await api.viewConversation('conversation-1', '了解阅读困惑', {
    workspaceId: 'workspace-class-1', idempotencyKey: 'privacy:view:conversation-1',
  })
  assert.deepEqual(calls.map(({ method, path }) => [method, path]), [
    ['GET', '/eyecare/students'],
    ['POST', '/eyecare/students/student-1/release-false-positive'],
    ['POST', '/privacy/access-requests'],
    ['POST', '/privacy/conversations/conversation-1/access'],
  ])
  assert.equal(calls[1].options.body.falsePositive, true)
  assert.equal(calls[2].options.body.purpose, '了解阅读困惑')
  assert.equal(calls[3].options.body.purpose, '了解阅读困惑')
})

test('B 线生产状态模块不导入 fixture、mock 或 localStorage 业务真相', async () => {
  const sources = await Promise.all([
    readFile(new URL('../../src/student/state/useEyeCarePrivacy.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/console/state/usePrivacyEyeCareData.js', import.meta.url), 'utf8'),
  ])
  for (const source of sources) {
    assert.doesNotMatch(source, /(?:data\/fixtures|data\/me|\bMOOC\b|\bmock\b|localStorage)/i)
  }
})
