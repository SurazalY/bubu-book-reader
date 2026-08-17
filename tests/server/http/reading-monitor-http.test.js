import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { hashPassword } from '../../../server/auth/password.js'
import { createReadmateApplication } from '../../../server/app.js'
import { createReadingDomain } from '../../../server/domains/reading/catalog.js'
import {
  canonicalReadingSummaryFingerprint,
  readingStatDateFor,
} from '../../../server/domains/reading/monitoring.js'

function identityFixture() {
  const suffix = randomUUID()
  const organizationId = `organization-${suffix}`
  const foreignOrganizationId = `foreign-organization-${suffix}`
  const classId = `class-${suffix}`
  const emptyClassId = `empty-class-${suffix}`
  const unauthorizedClassId = `unauthorized-class-${suffix}`
  const foreignClassId = `foreign-class-${suffix}`
  const gradeId = `grade-${suffix}`
  const workspaceId = `workspace-${suffix}`
  const schoolWorkspaceId = `school-workspace-${suffix}`
  const studentId = `student-${suffix}`
  const teacherId = `teacher-${suffix}`
  const adminId = `admin-${suffix}`
  const password = randomBytes(24).toString('base64url')
  const passwordHash = hashPassword(password)
  const users = [
    { id: studentId, username: `student-${suffix}`, displayName: '监测联调学生', roleCode: 'student', membershipRole: 'student' },
    { id: teacherId, username: `teacher-${suffix}`, displayName: '监测联调教师', roleCode: 'teacher', membershipRole: 'teacher' },
    { id: adminId, username: `admin-${suffix}`, displayName: '监测联调管理员', roleCode: 'school_admin', membershipRole: null },
  ]
  return {
    organizationId,
    foreignOrganizationId,
    classId,
    emptyClassId,
    unauthorizedClassId,
    foreignClassId,
    workspaceId,
    schoolWorkspaceId,
    studentId,
    teacherId,
    adminId,
    password,
    users,
    seed: {
      organizations: [
        { id: organizationId, name: '阅读监测联调学校' },
        { id: foreignOrganizationId, name: '外部组织学校' },
      ],
      users: users.map(({ id, username, displayName }) => ({ id, organizationId, username, displayName })),
      workspaces: [
        {
          id: workspaceId,
          organizationId,
          code: 'class-teacher',
          name: '阅读监测联调班级',
          scopeType: 'class',
          scopeId: classId,
        },
        {
          id: schoolWorkspaceId,
          organizationId,
          code: 'school-admin',
          name: '阅读监测联调学校管理',
          scopeType: 'school',
          scopeId: organizationId,
        },
      ],
      workspaceMemberships: [
        ...users.map(({ id }) => ({ id: randomUUID(), userId: id, workspaceId })),
        { id: randomUUID(), userId: adminId, workspaceId: schoolWorkspaceId },
      ],
      roleAssignments: [
        ...users.map(({ id, roleCode }) => ({
          id: randomUUID(),
          organizationId,
          userId: id,
          workspaceId,
          roleCode,
          scopeType: 'class',
          scopeId: classId,
        })),
        {
          id: randomUUID(),
          organizationId,
          userId: adminId,
          workspaceId: schoolWorkspaceId,
          roleCode: 'school_admin',
          scopeType: 'school',
          scopeId: organizationId,
        },
      ],
      classes: [
        { id: classId, organizationId, gradeId, name: '监测联调一班' },
        { id: emptyClassId, organizationId, gradeId, name: '空班级' },
        { id: unauthorizedClassId, organizationId, gradeId, name: '同组织越权班级' },
        { id: foreignClassId, organizationId: foreignOrganizationId, gradeId: `foreign-${gradeId}`, name: '外部组织班级' },
      ],
      classMemberships: users.filter(({ membershipRole }) => membershipRole).map(({ id, membershipRole }) => ({
        id: randomUUID(),
        classId,
        userId: id,
        membershipRole,
      })),
      credentials: users.map(({ id }) => ({ id: randomUUID(), userId: id, passwordHash })),
    },
  }
}

function rememberCookies(jar, response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)
  for (const value of values) {
    const [pair] = value.split(';')
    const separator = pair.indexOf('=')
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1))
  }
}

async function requestJson(baseUrl, jar, path, options = {}) {
  const headers = new Headers(options.headers)
  if (jar.size) headers.set('Cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '))
  if (options.workspaceId) headers.set('X-Workspace-Id', options.workspaceId)
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  rememberCookies(jar, response)
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)
  return { status: response.status, payload: await response.json(), setCookies }
}

function assertRequestId(response) {
  const requestId = response.payload?.meta?.requestId ?? response.payload?.error?.requestId
  assert.equal(typeof requestId, 'string', JSON.stringify(response.payload))
  assert.notEqual(requestId, '')
}

async function login(baseUrl, fixture, userId) {
  const user = fixture.users.find((candidate) => candidate.id === userId)
  const jar = new Map()
  const response = await requestJson(baseUrl, jar, '/auth/login', {
    method: 'POST',
    idempotencyKey: `login-${user.id}`,
    body: { username: user.username, password: fixture.password },
  })
  assert.equal(response.status, 200, JSON.stringify(response.payload))
  assertRequestId(response)
  return jar
}

async function createPublishedBook(application, fixture, label) {
  const reading = createReadingDomain({
    db: application.database,
    actor: { id: fixture.adminId },
    workspace: { id: fixture.workspaceId, organizationId: fixture.organizationId },
    authorize: async () => true,
    audit: async () => undefined,
    idFactory: randomUUID,
    now: () => new Date(),
  })
  const created = await reading.createBookVersion({
    title: `阅读监测联调书籍 ${label}`,
    label: `reading-monitor-${label}`,
    sourceFormat: 'text',
    pages: [
      { pageNo: 1, width: 800, height: 1200, textContent: '第一页', blocks: [] },
      { pageNo: 2, width: 800, height: 1200, textContent: '第二页', blocks: [] },
    ],
  })
  await reading.publishBook(created.bookId)
  return created
}

async function startHarness(t) {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-reading-monitor-http-'))
  const fixture = identityFixture()
  const application = createReadmateApplication({
    databasePath: join(directory, 'integration.sqlite'),
    sessionSecret: randomBytes(48).toString('base64url'),
    cookieSecure: false,
    serveStatic: false,
  })
  application.identity.service.importSeed(fixture.seed)
  const book = await createPublishedBook(application, fixture, 'A')
  const otherBook = await createPublishedBook(application, fixture, 'B')
  const server = await new Promise((resolve) => {
    const listener = application.app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    application.close()
    if (existsSync(directory)) rmSync(directory, { recursive: true, force: true })
  })
  return {
    application,
    fixture,
    book,
    otherBook,
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
  }
}

async function acquireLease(harness, jar, key = randomUUID()) {
  const response = await requestJson(harness.baseUrl, jar, '/reading/lease', {
    method: 'POST',
    workspaceId: harness.fixture.workspaceId,
    idempotencyKey: key,
    body: { bookVersionId: harness.book.versionId },
  })
  assert.equal(response.status, 200, JSON.stringify(response.payload))
  assertRequestId(response)
  return response.payload.data
}

function summaryBody({ leaseId, bookVersionId, baseMs = Date.now(), ...overrides }) {
  const startedAt = new Date(baseMs).toISOString()
  const body = {
    schemaVersion: 2,
    sessionId: `session-${randomUUID()}`,
    revision: 1,
    leaseId,
    bookVersionId,
    statDate: readingStatDateFor(startedAt),
    startedAt,
    measuredThroughAt: new Date(baseMs + 1_000).toISOString(),
    cumulativeEffectiveMs: 1_000,
    hadSkip: false,
    hadReread: false,
    lastPageNo: 1,
    pageCoverage: [],
    endedAt: null,
    endReason: null,
    fingerprint: '',
    ...overrides,
  }
  body.fingerprint = canonicalReadingSummaryFingerprint(body)
  return body
}

test('G2-18 HTTP 续租要求幂等键和可信设备，并映射 lease/validation 错误', async (t) => {
  const harness = await startHarness(t)
  const studentJar = await login(harness.baseUrl, harness.fixture, harness.fixture.studentId)
  const lease = await acquireLease(harness, studentJar, 'g2-18-acquire-renew')
  const path = `/reading/lease/${encodeURIComponent(lease.leaseId)}/renew`
  const body = { schemaVersion: 1, bookVersionId: harness.book.versionId }

  const missingKey = await requestJson(harness.baseUrl, studentJar, path, {
    method: 'POST', workspaceId: harness.fixture.workspaceId, body,
  })
  assert.equal(missingKey.status, 400)
  assert.equal(missingKey.payload.error.code, 'VALIDATION_FAILED')
  assertRequestId(missingKey)

  const renewed = await requestJson(harness.baseUrl, studentJar, path, {
    method: 'POST', workspaceId: harness.fixture.workspaceId, idempotencyKey: 'g2-18-renew', body,
  })
  assert.equal(renewed.status, 200, JSON.stringify(renewed.payload))
  assert.deepEqual(Object.keys(renewed.payload.data).sort(), ['expiresAt', 'leaseId', 'renewedAt'])
  assert.equal(renewed.payload.data.leaseId, lease.leaseId)
  assert.equal(Date.parse(renewed.payload.data.expiresAt) - Date.parse(renewed.payload.data.renewedAt), 90_000)
  assertRequestId(renewed)

  const outerReplay = await requestJson(harness.baseUrl, studentJar, path, {
    method: 'POST', workspaceId: harness.fixture.workspaceId, idempotencyKey: 'g2-18-renew', body,
  })
  assert.equal(outerReplay.status, 200)
  assert.equal(outerReplay.payload.meta.replayed, true)
  assertRequestId(outerReplay)

  const unknownBody = await requestJson(harness.baseUrl, studentJar, path, {
    method: 'POST',
    workspaceId: harness.fixture.workspaceId,
    idempotencyKey: 'g2-18-renew-unknown',
    body: { ...body, ttlSeconds: 300 },
  })
  assert.equal(unknownBody.status, 422)
  assert.equal(unknownBody.payload.error.code, 'VALIDATION_FAILED')
  assert.deepEqual(unknownBody.payload.error.details.fields, ['ttlSeconds'])
  assertRequestId(unknownBody)

  const wrongBook = await requestJson(harness.baseUrl, studentJar, path, {
    method: 'POST',
    workspaceId: harness.fixture.workspaceId,
    idempotencyKey: 'g2-18-renew-wrong-book',
    body: { schemaVersion: 1, bookVersionId: harness.otherBook.versionId },
  })
  assert.equal(wrongBook.status, 409)
  assert.equal(wrongBook.payload.error.code, 'LEASE_CONFLICT')
  assertRequestId(wrongBook)

  const missingLease = await requestJson(harness.baseUrl, studentJar, '/reading/lease/missing/renew', {
    method: 'POST', workspaceId: harness.fixture.workspaceId, idempotencyKey: 'g2-18-renew-missing', body,
  })
  assert.equal(missingLease.status, 409)
  assert.equal(missingLease.payload.error.code, 'LEASE_REQUIRED')
  assertRequestId(missingLease)

  const activeLease = harness.application.database.prepare(`SELECT acquired_at
    FROM active_reading_leases WHERE id = ?`).get(lease.leaseId)
  const forcedExpiry = new Date(Date.parse(activeLease.acquired_at) + 1).toISOString()
  harness.application.database.prepare(`UPDATE active_reading_leases
    SET expires_at = ?, updated_at = ? WHERE id = ?`)
    .run(forcedExpiry, new Date().toISOString(), lease.leaseId)
  const expiredLease = await requestJson(harness.baseUrl, studentJar, path, {
    method: 'POST', workspaceId: harness.fixture.workspaceId, idempotencyKey: 'g2-18-renew-expired', body,
  })
  assert.equal(expiredLease.status, 409)
  assert.equal(expiredLease.payload.error.code, 'LEASE_REQUIRED')
  assertRequestId(expiredLease)

  const noDeviceJar = await login(harness.baseUrl, harness.fixture, harness.fixture.studentId)
  const noDevice = await requestJson(harness.baseUrl, noDeviceJar, path, {
    method: 'POST', workspaceId: harness.fixture.workspaceId, idempotencyKey: 'g2-18-renew-no-device', body,
  })
  assert.equal(noDevice.status, 409)
  assert.equal(noDevice.payload.error.code, 'LEASE_REQUIRED')
  assertRequestId(noDevice)
})

test('G2-18 HTTP 摘要返回 accepted/replayed/superseded，并冻结 revision 与未知字段错误', async (t) => {
  const harness = await startHarness(t)
  const studentJar = await login(harness.baseUrl, harness.fixture, harness.fixture.studentId)
  const lease = await acquireLease(harness, studentJar, 'g2-18-acquire-summary')
  const first = summaryBody({ leaseId: lease.leaseId, bookVersionId: harness.book.versionId })
  const submit = (body, idempotencyKey) => requestJson(harness.baseUrl, studentJar, '/reading/session-summaries', {
    method: 'POST', workspaceId: harness.fixture.workspaceId, idempotencyKey, body,
  })

  const missingKey = await requestJson(harness.baseUrl, studentJar, '/reading/session-summaries', {
    method: 'POST', workspaceId: harness.fixture.workspaceId, body: first,
  })
  assert.equal(missingKey.status, 400)
  assert.equal(missingKey.payload.error.code, 'VALIDATION_FAILED')
  assertRequestId(missingKey)

  const accepted = await submit(first, 'g2-18-summary-first')
  assert.equal(accepted.status, 200, JSON.stringify(accepted.payload))
  assert.equal(accepted.payload.data.result, 'accepted')
  assert.equal(accepted.payload.data.latestRevision, 1)
  assertRequestId(accepted)

  const outerReplay = await submit(first, 'g2-18-summary-first')
  assert.equal(outerReplay.status, 200)
  assert.equal(outerReplay.payload.data.result, 'accepted')
  assert.equal(outerReplay.payload.meta.replayed, true)
  assertRequestId(outerReplay)

  const domainReplay = await submit(first, 'g2-18-summary-domain-replay')
  assert.equal(domainReplay.status, 200)
  assert.equal(domainReplay.payload.data.result, 'replayed')
  assertRequestId(domainReplay)

  const second = summaryBody({
    ...first,
    leaseId: lease.leaseId,
    bookVersionId: harness.book.versionId,
    baseMs: Date.parse(first.startedAt),
    sessionId: first.sessionId,
    revision: 2,
    startedAt: first.startedAt,
    measuredThroughAt: new Date(Date.parse(first.measuredThroughAt) + 1_000).toISOString(),
    cumulativeEffectiveMs: 2_000,
    hadSkip: true,
    lastPageNo: 2,
  })
  const acceptedSecond = await submit(second, 'g2-18-summary-second')
  assert.equal(acceptedSecond.status, 200, JSON.stringify(acceptedSecond.payload))
  assert.equal(acceptedSecond.payload.data.result, 'accepted')
  assert.equal(acceptedSecond.payload.data.latestRevision, 2)
  assertRequestId(acceptedSecond)

  const superseded = await submit(first, 'g2-18-summary-superseded')
  assert.equal(superseded.status, 200)
  assert.equal(superseded.payload.data.result, 'superseded')
  assert.equal(superseded.payload.data.latestRevision, 2)
  assertRequestId(superseded)

  const conflictingFirst = summaryBody({
    ...first,
    leaseId: lease.leaseId,
    bookVersionId: harness.book.versionId,
    baseMs: Date.parse(first.startedAt),
    sessionId: first.sessionId,
    startedAt: first.startedAt,
    measuredThroughAt: first.measuredThroughAt,
    cumulativeEffectiveMs: first.cumulativeEffectiveMs,
    lastPageNo: 2,
  })
  const conflict = await submit(conflictingFirst, 'g2-18-summary-conflict')
  assert.equal(conflict.status, 409)
  assert.equal(conflict.payload.error.code, 'REVISION_CONFLICT')
  assertRequestId(conflict)

  const gap = summaryBody({
    ...second,
    leaseId: lease.leaseId,
    bookVersionId: harness.book.versionId,
    baseMs: Date.parse(first.startedAt),
    sessionId: first.sessionId,
    revision: 4,
    startedAt: first.startedAt,
    measuredThroughAt: new Date(Date.parse(first.measuredThroughAt) + 2_000).toISOString(),
    cumulativeEffectiveMs: 3_000,
  })
  const revisionGap = await submit(gap, 'g2-18-summary-gap')
  assert.equal(revisionGap.status, 409)
  assert.equal(revisionGap.payload.error.code, 'REVISION_GAP')
  assertRequestId(revisionGap)

  const unknown = await submit({ ...second, deviceId: 'untrusted-device' }, 'g2-18-summary-unknown')
  assert.equal(unknown.status, 422)
  assert.equal(unknown.payload.error.code, 'VALIDATION_FAILED')
  assert.deepEqual(unknown.payload.error.details.fields, ['deviceId'])
  assertRequestId(unknown)
})

test('G2-18 HTTP self/scope 严格返回新 DTO，并区分空态、权限、跨组织和未知 query', async (t) => {
  const harness = await startHarness(t)
  const studentJar = await login(harness.baseUrl, harness.fixture, harness.fixture.studentId)
  const teacherJar = await login(harness.baseUrl, harness.fixture, harness.fixture.teacherId)
  const adminJar = await login(harness.baseUrl, harness.fixture, harness.fixture.adminId)

  const self = await requestJson(harness.baseUrl, studentJar, '/reading/statistics/self', {
    workspaceId: harness.fixture.workspaceId,
  })
  assert.equal(self.status, 200, JSON.stringify(self.payload))
  assert.deepEqual(Object.keys(self.payload.data).sort(), [
    'checkIn', 'comparisonState', 'dataUpdatedAt', 'generatedAt', 'lastReading', 'statDate', 'streakDays', 'todayEffectiveReadingSeconds',
  ])
  assert.equal(self.payload.data.dataUpdatedAt, null)
  assert.equal(self.payload.data.todayEffectiveReadingSeconds, 0)
  assert.deepEqual(self.payload.data.checkIn, { checked: false, thresholdSeconds: 300, remainingSeconds: 300 })
  assert.equal(self.payload.data.streakDays, 0)
  assert.equal(self.payload.data.comparisonState, 'no_baseline')
  assert.equal(self.payload.data.lastReading, null)
  assert.equal(Object.hasOwn(self.payload.data, 'totalEffectiveReadingSeconds'), false)
  assertRequestId(self)

  const scopePath = `/reading/statistics/scope?classId=${encodeURIComponent(harness.fixture.classId)}&statDate=${encodeURIComponent(self.payload.data.statDate)}`
  const scope = await requestJson(harness.baseUrl, teacherJar, scopePath, {
    workspaceId: harness.fixture.workspaceId,
  })
  assert.equal(scope.status, 200, JSON.stringify(scope.payload))
  assert.deepEqual(Object.keys(scope.payload.data).sort(), [
    'class', 'dataUpdatedAt', 'generatedAt', 'statDate', 'students', 'summary', 'trend',
  ])
  assert.equal(scope.payload.data.class.activeStudentCount, 1)
  assert.equal(scope.payload.data.dataUpdatedAt, null)
  assert.equal(scope.payload.data.summary.checkedInStudentCount, 0)
  assert.equal(scope.payload.data.summary.checkInRateBasisPoints, 0)
  assert.equal(scope.payload.data.summary.perCapitaEffectiveReadingSeconds, 0)
  assert.equal(scope.payload.data.students.length, 1)
  assert.equal(scope.payload.data.trend.length, 7)
  assertRequestId(scope)

  const unknownQuery = await requestJson(harness.baseUrl, teacherJar, `${scopePath}&studentId=${encodeURIComponent(harness.fixture.studentId)}`, {
    workspaceId: harness.fixture.workspaceId,
  })
  assert.equal(unknownQuery.status, 422)
  assert.equal(unknownQuery.payload.error.code, 'VALIDATION_FAILED')
  assert.deepEqual(unknownQuery.payload.error.details.fields, ['studentId'])
  assertRequestId(unknownQuery)

  const studentScope = await requestJson(harness.baseUrl, studentJar, scopePath, {
    workspaceId: harness.fixture.workspaceId,
  })
  assert.equal(studentScope.status, 403)
  assert.equal(studentScope.payload.error.code, 'PERMISSION_DENIED')
  assertRequestId(studentScope)

  const unauthorized = await requestJson(
    harness.baseUrl,
    teacherJar,
    `/reading/statistics/scope?classId=${encodeURIComponent(harness.fixture.unauthorizedClassId)}&statDate=${encodeURIComponent(self.payload.data.statDate)}`,
    { workspaceId: harness.fixture.workspaceId },
  )
  assert.equal(unauthorized.status, 403)
  assert.equal(unauthorized.payload.error.code, 'PERMISSION_DENIED')
  assertRequestId(unauthorized)

  const crossOrganization = await requestJson(
    harness.baseUrl,
    teacherJar,
    `/reading/statistics/scope?classId=${encodeURIComponent(harness.fixture.foreignClassId)}&statDate=${encodeURIComponent(self.payload.data.statDate)}`,
    { workspaceId: harness.fixture.workspaceId },
  )
  assert.equal(crossOrganization.status, 404)
  assert.equal(crossOrganization.payload.error.code, 'RESOURCE_NOT_FOUND')
  assertRequestId(crossOrganization)

  const emptyClass = await requestJson(
    harness.baseUrl,
    adminJar,
    `/reading/statistics/scope?classId=${encodeURIComponent(harness.fixture.emptyClassId)}&statDate=${encodeURIComponent(self.payload.data.statDate)}`,
    { workspaceId: harness.fixture.schoolWorkspaceId },
  )
  assert.equal(emptyClass.status, 200, JSON.stringify(emptyClass.payload))
  assert.equal(emptyClass.payload.data.class.activeStudentCount, 0)
  assert.equal(emptyClass.payload.data.summary.checkInRateBasisPoints, null)
  assert.equal(emptyClass.payload.data.summary.perCapitaEffectiveReadingSeconds, null)
  assert.deepEqual(emptyClass.payload.data.students, [])
  assert.equal(emptyClass.payload.data.trend.length, 7)
  assertRequestId(emptyClass)
})

test('READING_LEASE_HELD 409 仍下发持久 readmate_device Cookie', async (t) => {
  const harness = await startHarness(t)
  const deviceAJar = await login(harness.baseUrl, harness.fixture, harness.fixture.studentId)
  await acquireLease(harness, deviceAJar, 'lease-held-device-a')

  const deviceBJar = await login(harness.baseUrl, harness.fixture, harness.fixture.studentId)
  const conflict = await requestJson(harness.baseUrl, deviceBJar, '/reading/lease', {
    method: 'POST',
    workspaceId: harness.fixture.workspaceId,
    idempotencyKey: 'lease-held-device-b',
    body: { bookVersionId: harness.book.versionId },
  })
  assert.equal(conflict.status, 409, JSON.stringify(conflict.payload))
  assert.equal(conflict.payload.error.code, 'READING_LEASE_HELD')
  assertRequestId(conflict)
  assert.ok(conflict.setCookies.some((value) => value.startsWith('readmate_device=')), conflict.setCookies.join('; '))
  assert.ok(conflict.setCookies.some((value) => /Max-Age=\d+/i.test(value)), conflict.setCookies.join('; '))
})

test('HTTP 过期租约残留 open 会话时新设备 acquire 成功', async (t) => {
  const harness = await startHarness(t)
  const deviceAJar = await login(harness.baseUrl, harness.fixture, harness.fixture.studentId)
  const lease = await acquireLease(harness, deviceAJar, 'expired-leftover-device-a')
  const activeLease = harness.application.database.prepare('SELECT acquired_at FROM active_reading_leases WHERE id = ?').get(lease.leaseId)
  const acquiredMs = Date.parse(activeLease.acquired_at)
  const startedAt = new Date(acquiredMs + 100).toISOString()
  const measuredThroughAt = new Date(acquiredMs + 200).toISOString()
  const leftover = summaryBody({
    leaseId: lease.leaseId,
    bookVersionId: harness.book.versionId,
    sessionId: 'session-http-expired-leftover',
    startedAt,
    measuredThroughAt,
    statDate: readingStatDateFor(startedAt),
    cumulativeEffectiveMs: 100,
  })
  leftover.fingerprint = canonicalReadingSummaryFingerprint(leftover)
  const accepted = await requestJson(harness.baseUrl, deviceAJar, '/reading/session-summaries', {
    method: 'POST',
    workspaceId: harness.fixture.workspaceId,
    idempotencyKey: 'expired-leftover-summary',
    body: leftover,
  })
  assert.equal(accepted.status, 200, JSON.stringify(accepted.payload))

  const sessionRow = harness.application.database.prepare(`SELECT measured_through_at
    FROM reading_summary_sessions WHERE id = 'session-http-expired-leftover'`).get()
  const measuredThroughMs = Date.parse(sessionRow.measured_through_at)
  while (Date.now() <= measuredThroughMs) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  const expiredAt = sessionRow.measured_through_at
  harness.application.database.prepare(`UPDATE active_reading_leases
    SET expires_at = ?, updated_at = ? WHERE id = ?`).run(expiredAt, expiredAt, lease.leaseId)

  const deviceBJar = await login(harness.baseUrl, harness.fixture, harness.fixture.studentId)
  const acquired = await requestJson(harness.baseUrl, deviceBJar, '/reading/lease', {
    method: 'POST',
    workspaceId: harness.fixture.workspaceId,
    idempotencyKey: 'expired-leftover-device-b',
    body: { bookVersionId: harness.book.versionId },
  })
  assert.equal(acquired.status, 200, JSON.stringify(acquired.payload))
  assert.notEqual(acquired.payload.data.leaseId, lease.leaseId)

  const leftoverRow = harness.application.database.prepare(`SELECT status, end_reason, cumulative_effective_ms, latest_revision
    FROM reading_summary_sessions WHERE id = 'session-http-expired-leftover'`).get()
  assert.equal(leftoverRow.status, 'closed')
  assert.equal(leftoverRow.end_reason, 'lease_ended')
  assert.equal(Number(leftoverRow.cumulative_effective_ms), 100)
  assert.equal(Number(leftoverRow.latest_revision), 1)
})

test('HTTP 关联 open 会话停滞超阈值时续期返回 LEASE_REQUIRED', async (t) => {
  const harness = await startHarness(t)
  const studentJar = await login(harness.baseUrl, harness.fixture, harness.fixture.studentId)
  const lease = await acquireLease(harness, studentJar, 'http-stale-open-acquire')
  const baseMs = Date.now() - 500_000
  const acquiredAt = new Date(baseMs).toISOString()
  const futureExpiry = new Date(Date.now() + 90_000).toISOString()
  harness.application.database.prepare(`UPDATE active_reading_leases
    SET acquired_at = ?, created_at = ?, expires_at = ?, updated_at = ? WHERE id = ?`)
    .run(acquiredAt, acquiredAt, futureExpiry, new Date().toISOString(), lease.leaseId)
  harness.application.database.prepare(`UPDATE reading_device_lease_history
    SET valid_from = ?, valid_until = ?, updated_at = ? WHERE lease_id = ?`)
    .run(acquiredAt, futureExpiry, new Date().toISOString(), lease.leaseId)
  const summary = summaryBody({
    leaseId: lease.leaseId,
    bookVersionId: harness.book.versionId,
    baseMs,
    measuredThroughAt: new Date(baseMs + 1_000).toISOString(),
    cumulativeEffectiveMs: 1_000,
  })
  const accepted = await requestJson(harness.baseUrl, studentJar, '/reading/session-summaries', {
    method: 'POST',
    workspaceId: harness.fixture.workspaceId,
    idempotencyKey: 'http-stale-open-summary',
    body: summary,
  })
  assert.equal(accepted.status, 200, JSON.stringify(accepted.payload))

  const rejected = await requestJson(harness.baseUrl, studentJar, `/reading/lease/${encodeURIComponent(lease.leaseId)}/renew`, {
    method: 'POST',
    workspaceId: harness.fixture.workspaceId,
    idempotencyKey: 'http-stale-open-renew',
    body: { schemaVersion: 1, bookVersionId: harness.book.versionId },
  })
  assert.equal(rejected.status, 409, JSON.stringify(rejected.payload))
  assert.equal(rejected.payload.error.code, 'LEASE_REQUIRED')
  assertRequestId(rejected)
})

test('HTTP re-acquire 关闭 open 会话后 measured_through_at 停滞时续期返回 LEASE_REQUIRED', async (t) => {
  const harness = await startHarness(t)
  const studentJar = await login(harness.baseUrl, harness.fixture, harness.fixture.studentId)
  const lease = await acquireLease(harness, studentJar, 'http-stale-closed-acquire')
  const baseMs = Date.now() - 500_000
  const acquiredAt = new Date(baseMs).toISOString()
  const futureExpiry = new Date(Date.now() + 90_000).toISOString()
  harness.application.database.prepare(`UPDATE active_reading_leases
    SET acquired_at = ?, created_at = ?, expires_at = ?, updated_at = ? WHERE id = ?`)
    .run(acquiredAt, acquiredAt, futureExpiry, new Date().toISOString(), lease.leaseId)
  harness.application.database.prepare(`UPDATE reading_device_lease_history
    SET valid_from = ?, valid_until = ?, updated_at = ? WHERE lease_id = ?`)
    .run(acquiredAt, futureExpiry, new Date().toISOString(), lease.leaseId)
  const summary = summaryBody({
    leaseId: lease.leaseId,
    bookVersionId: harness.book.versionId,
    baseMs,
    measuredThroughAt: new Date(baseMs + 1_000).toISOString(),
    cumulativeEffectiveMs: 1_000,
  })
  const accepted = await requestJson(harness.baseUrl, studentJar, '/reading/session-summaries', {
    method: 'POST',
    workspaceId: harness.fixture.workspaceId,
    idempotencyKey: 'http-stale-closed-summary',
    body: summary,
  })
  assert.equal(accepted.status, 200, JSON.stringify(accepted.payload))

  const reacquired = await acquireLease(harness, studentJar, 'http-stale-closed-reacquire')
  assert.equal(reacquired.leaseId, lease.leaseId)
  const closedRow = harness.application.database.prepare(`SELECT status, end_reason, measured_through_at
    FROM reading_summary_sessions WHERE lease_id_at_start = ?`).get(lease.leaseId)
  assert.equal(closedRow.status, 'closed')
  assert.equal(closedRow.end_reason, 'lease_taken_over')
  assert.equal(closedRow.measured_through_at, summary.measuredThroughAt)

  const rejected = await requestJson(harness.baseUrl, studentJar, `/reading/lease/${encodeURIComponent(lease.leaseId)}/renew`, {
    method: 'POST',
    workspaceId: harness.fixture.workspaceId,
    idempotencyKey: 'http-stale-closed-renew',
    body: { schemaVersion: 1, bookVersionId: harness.book.versionId },
  })
  assert.equal(rejected.status, 409, JSON.stringify(rejected.payload))
  assert.equal(rejected.payload.error.code, 'LEASE_REQUIRED')
  assertRequestId(rejected)
})
