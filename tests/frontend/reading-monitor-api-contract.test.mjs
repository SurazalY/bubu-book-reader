import assert from 'node:assert/strict'
import test from 'node:test'

import { createConsoleApi } from '../../src/api/console.js'
import { createStudentApi } from '../../src/api/student.js'

function recordingClient() {
  const calls = []
  return {
    calls,
    client: {
      get(path, options) {
        calls.push({ method: 'GET', path, options })
        return Promise.resolve({ data: {}, meta: { requestId: 'request-test' } })
      },
      post(path, options) {
        calls.push({ method: 'POST', path, options })
        return Promise.resolve({ data: {}, meta: { requestId: 'request-test' } })
      },
    },
  }
}

test('阅读监测租约 API 只把协议字段放入 body，范围只进入工作空间 header 上下文', async () => {
  const recorder = recordingClient()
  const api = createStudentApi(recorder.client)
  const scope = {
    organizationId: 'organization-a',
    studentId: 'student-a',
    workspaceId: 'workspace-a',
    deviceId: 'untrusted-device',
  }

  await api.acquireReadingLease({
    schemaVersion: 2,
    bookVersionId: 'version/a',
    takeover: false,
    scope,
    deviceId: 'untrusted-device',
  }, { workspaceId: scope.workspaceId, idempotencyKey: 'acquire-1' })
  await api.renewReadingLease('lease/a', {
    schemaVersion: 1,
    bookVersionId: 'version/a',
    scope,
    deviceId: 'untrusted-device',
    ttlSeconds: 300,
  }, { workspaceId: scope.workspaceId, idempotencyKey: 'renew-1' })

  assert.deepEqual(recorder.calls, [
    {
      method: 'POST',
      path: '/reading/lease',
      options: {
        workspaceId: 'workspace-a',
        idempotencyKey: 'acquire-1',
        body: { bookVersionId: 'version/a' },
      },
    },
    {
      method: 'POST',
      path: '/reading/lease/lease%2Fa/renew',
      options: {
        workspaceId: 'workspace-a',
        idempotencyKey: 'renew-1',
        body: { schemaVersion: 1, bookVersionId: 'version/a' },
      },
    },
  ])
})

test('阅读摘要 API 可直接适配 C 端口输入且不泄漏 scope/device/未知字段', async () => {
  const recorder = recordingClient()
  const api = createStudentApi(recorder.client)
  const summary = {
    schemaVersion: 2,
    sessionId: 'session-1',
    revision: 1,
    leaseId: 'lease-1',
    bookVersionId: 'version-1',
    statDate: '2026-08-10',
    startedAt: '2026-08-10T00:00:00.000Z',
    measuredThroughAt: '2026-08-10T00:00:30.000Z',
    cumulativeEffectiveMs: 30_000,
    hadSkip: false,
    hadReread: true,
    lastPageNo: 2,
    pageCoverage: [{ pageNo: 2, effectiveOriginalMs: 0, effectiveTextMs: 30_000, confirmedInteractions: 1 }],
    endedAt: null,
    endReason: null,
    fingerprint: 'a'.repeat(64),
    deviceId: 'untrusted-device',
    organizationId: 'organization-a',
    workspaceId: 'workspace-a',
    unknown: 'must-not-leak',
  }

  await api.submitReadingSessionSummary({
    summary,
    scope: { organizationId: 'organization-a', workspaceId: 'workspace-a', deviceId: 'untrusted-device' },
    deviceId: 'untrusted-device',
  }, { workspaceId: 'workspace-a', idempotencyKey: 'summary-1' })

  assert.equal(recorder.calls.length, 1)
  assert.equal(recorder.calls[0].path, '/reading/session-summaries')
  assert.deepEqual(recorder.calls[0].options, {
    workspaceId: 'workspace-a',
    idempotencyKey: 'summary-1',
    body: {
      schemaVersion: 2,
      sessionId: 'session-1',
      revision: 1,
      leaseId: 'lease-1',
      bookVersionId: 'version-1',
      statDate: '2026-08-10',
      startedAt: '2026-08-10T00:00:00.000Z',
      measuredThroughAt: '2026-08-10T00:00:30.000Z',
      cumulativeEffectiveMs: 30_000,
      hadSkip: false,
      hadReread: true,
      lastPageNo: 2,
      pageCoverage: [{ pageNo: 2, effectiveOriginalMs: 0, effectiveTextMs: 30_000, confirmedInteractions: 1 }],
      endedAt: null,
      endReason: null,
      fingerprint: 'a'.repeat(64),
    },
  })
  assert.equal(JSON.stringify(recorder.calls[0].options.body).includes('device'), false)
  assert.equal(JSON.stringify(recorder.calls[0].options.body).includes('scope'), false)
})

test('self/scope API 只发送冻结查询，scope 搜索筛选和身份字段不会进入 query', async () => {
  const studentRecorder = recordingClient()
  const consoleRecorder = recordingClient()
  const studentApi = createStudentApi(studentRecorder.client)
  const consoleApi = createConsoleApi(consoleRecorder.client)

  await studentApi.getReadingStatisticsSelf({ workspaceId: 'workspace-a' })
  await consoleApi.getReadingStatisticsScope({
    classId: 'class-a',
    statDate: '2026-08-10',
    scopeLevel: 'grade',
    grade: 3,
    studentId: 'student-a',
    search: 'name',
    organizationId: 'organization-a',
    deviceId: 'untrusted-device',
  }, { workspaceId: 'workspace-a' })

  assert.deepEqual(studentRecorder.calls, [{
    method: 'GET',
    path: '/reading/statistics/self',
    options: { workspaceId: 'workspace-a' },
  }])
  assert.deepEqual(consoleRecorder.calls, [{
    method: 'GET',
    path: '/reading/statistics/scope',
    options: {
      workspaceId: 'workspace-a',
      query: {
        classId: 'class-a',
        statDate: '2026-08-10',
        scopeLevel: 'grade',
        grade: 3,
      },
    },
  }])
})
