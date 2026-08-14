import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createReadingMonitorApiPorts,
  resolveReadingMonitorScope,
} from '../../src/student/reading-monitor/apiPorts.js'

test('真实监测端口按I签名调用且不把scope/device送入API输入', async () => {
  const calls = []
  const api = {
    async acquireReadingLease(input, options) {
      calls.push(['acquire', input, options])
      return { data: { leaseId: 'lease-1', deviceId: 'device-1', expiresAt: '2026-08-10T08:10:00.000Z' } }
    },
    async renewReadingLease(leaseId, input, options) {
      calls.push(['renew', leaseId, input, options])
      return { data: { leaseId, expiresAt: '2026-08-10T08:11:00.000Z' } }
    },
    async submitReadingSessionSummary(input, options) {
      calls.push(['summary', input, options])
      return { data: { result: 'accepted' } }
    },
  }
  const ports = createReadingMonitorApiPorts({ api, workspaceId: 'workspace-1' })
  const scope = { organizationId: 'org-1', studentId: 'student-1', workspaceId: 'workspace-1', deviceId: 'device-1' }
  const summary = { sessionId: 'session-1', revision: 1 }

  await ports.acquireLease({ schemaVersion: 1, bookVersionId: 'version-1', scope, deviceId: 'device-1', idempotencyKey: 'acquire-1' })
  await ports.renewLease({ schemaVersion: 1, leaseId: 'lease-1', bookVersionId: 'version-1', scope, deviceId: 'device-1', idempotencyKey: 'renew-1' })
  await ports.submitSummary({ summary, scope, deviceId: 'device-1', idempotencyKey: 'summary-1' })

  assert.deepEqual(calls, [
    ['acquire', { bookVersionId: 'version-1' }, { workspaceId: 'workspace-1', idempotencyKey: 'acquire-1' }],
    ['renew', 'lease-1', { schemaVersion: 1, bookVersionId: 'version-1' }, { workspaceId: 'workspace-1', idempotencyKey: 'renew-1' }],
    ['summary', { summary }, { workspaceId: 'workspace-1', idempotencyKey: 'summary-1' }],
  ])
  assert.equal(JSON.stringify(calls).includes('device-1'), false)
  assert.equal(JSON.stringify(calls).includes('organizationId'), false)
  assert.equal(JSON.stringify(calls).includes('studentId'), false)
})

test('监测范围从服务端会话解析组织/学生/工作空间且拒绝跨身份', async () => {
  const api = {
    async getSession() {
      return {
        data: {
          user: { id: 'student-1', organizationId: 'org-1' },
          workspaces: [{ id: 'workspace-1', organizationId: 'org-1' }],
        },
      }
    },
  }
  assert.deepEqual(
    await resolveReadingMonitorScope({ api, studentId: 'student-1', workspaceId: 'workspace-1' }),
    { organizationId: 'org-1', studentId: 'student-1', workspaceId: 'workspace-1' },
  )
  await assert.rejects(
    () => resolveReadingMonitorScope({ api, studentId: 'student-2', workspaceId: 'workspace-1' }),
    { code: 'READING_SCOPE_INVALID' },
  )
  await assert.rejects(
    () => resolveReadingMonitorScope({ api, studentId: 'student-1', workspaceId: 'workspace-2' }),
    { code: 'READING_SCOPE_INVALID' },
  )
})

test('Reader稳定memoized monitor配置并由同一新租约启动旧护眼序号', async () => {
  const { readFile } = await import('node:fs/promises')
  const [reader, telemetry] = await Promise.all([
    readFile(new URL('../../src/student/pages/Reader.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/student/state/useReadingTelemetry.js', import.meta.url), 'utf8'),
  ])
  assert.match(reader, /const monitor = useMemo\(/)
  assert.match(reader, /monitor,\s*\n\s*\}\)/)
  assert.equal((telemetry.match(/\.acquireReadingLease\(/g) || []).length, 0)
  assert.match(telemetry, /sequence\.current = initialOfflineSequence\(state\.lease\)/)
  assert.match(telemetry, /createReadingMonitorApiPorts/)
})
