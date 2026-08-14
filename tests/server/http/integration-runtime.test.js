import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { hashPassword } from '../../../server/auth/password.js'
import { createReadmateApplication } from '../../../server/app.js'
import { bootstrapInternalDemo } from '../../../server/db/bootstrap-internal-demo.js'
import { createReadingDomain } from '../../../server/domains/reading/catalog.js'
import {
  canonicalReadingSummaryFingerprint,
  readingStatDateFor,
} from '../../../server/domains/reading/monitoring.js'

function identityFixture() {
  const suffix = randomUUID()
  const organizationId = `organization-${suffix}`
  const classId = `class-${suffix}`
  const gradeId = `grade-${suffix}`
  const workspaceId = `workspace-${suffix}`
  const schoolWorkspaceId = `school-workspace-${suffix}`
  const studentId = `student-${suffix}`
  const teacherId = `teacher-${suffix}`
  const adminId = `admin-${suffix}`
  const opsId = `ops-${suffix}`
  const platformWorkspaceId = `platform-workspace-${suffix}`
  const password = randomBytes(24).toString('base64url')
  const passwordHash = hashPassword(password)
  const users = [
    { id: studentId, username: `student-${suffix}`, displayName: '联调学生', roleCode: 'student', scopeType: 'class', scopeId: classId },
    { id: teacherId, username: `teacher-${suffix}`, displayName: '联调教师', roleCode: 'teacher', scopeType: 'class', scopeId: classId },
    { id: adminId, username: `admin-${suffix}`, displayName: '联调管理员', roleCode: 'school_admin', scopeType: 'class', scopeId: classId },
    { id: opsId, username: `ops-${suffix}`, displayName: '联调运营管理员', roleCode: 'platform_ops', scopeType: 'platform', scopeId: 'readmate-platform' },
  ]
  return {
    organizationId,
    classId,
    gradeId,
    workspaceId,
    schoolWorkspaceId,
    studentId,
    teacherId,
    adminId,
    opsId,
    platformWorkspaceId,
    password,
    users,
    seed: {
      organizations: [{ id: organizationId, name: '读伴真实联调学校' }],
      users: users.map(({ id, username, displayName }) => ({ id, organizationId, username, displayName })),
      workspaces: [
        {
          id: workspaceId,
          organizationId,
          code: 'class-teacher',
          name: '读伴真实联调班级',
          scopeType: 'class',
          scopeId: classId,
        },
        {
          id: schoolWorkspaceId,
          organizationId,
          code: 'school-admin',
          name: '读伴真实联调学校管理',
          scopeType: 'school',
          scopeId: organizationId,
        },
        {
          id: platformWorkspaceId,
          organizationId,
          code: 'platform-ops',
          name: '读伴平台运营',
          scopeType: 'platform',
          scopeId: 'readmate-platform',
        },
      ],
      workspaceMemberships: [
        ...users.filter(({ id }) => id !== opsId).map(({ id }) => ({ id: randomUUID(), userId: id, workspaceId })),
        { id: randomUUID(), userId: adminId, workspaceId: schoolWorkspaceId },
        { id: randomUUID(), userId: opsId, workspaceId: platformWorkspaceId },
      ],
      roleAssignments: [
        ...users.filter(({ id }) => id !== opsId).map(({ id, roleCode, scopeType, scopeId }) => ({
          id: randomUUID(),
          organizationId,
          userId: id,
          workspaceId,
          roleCode,
          scopeType,
          scopeId,
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
        {
          id: randomUUID(),
          organizationId,
          userId: opsId,
          workspaceId: platformWorkspaceId,
          roleCode: 'platform_ops',
          scopeType: 'platform',
          scopeId: 'readmate-platform',
        },
      ],
      classes: [{ id: classId, organizationId, gradeId, name: '联调一班' }],
      classMemberships: [
        { id: randomUUID(), classId, userId: studentId, membershipRole: 'student' },
        { id: randomUUID(), classId, userId: teacherId, membershipRole: 'teacher' },
      ],
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
  const payload = await response.json()
  return { status: response.status, payload }
}

async function login(baseUrl, fixture, user) {
  const jar = new Map()
  const response = await requestJson(baseUrl, jar, '/auth/login', {
    method: 'POST',
    idempotencyKey: `login-${user.id}`,
    body: { username: user.username, password: fixture.password },
  })
  assert.equal(response.status, 200, JSON.stringify(response.payload))
  jar.loginResponse = response.payload
  return jar
}

async function createPublishedBook(application, fixture) {
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
    title: '爱丽丝漫游奇境（公共领域内部联调节选）',
    label: 'internal-test-v1',
    sourceFormat: 'text',
    pages: [
      {
        pageNo: 1,
        width: 1024,
        height: 768,
        textContent: '爱丽丝坐在姐姐身旁，开始好奇地望向那只白兔。',
        blocks: [{
          blockKey: 'page-1-paragraph-1',
          paragraphId: 'paragraph-1',
          textContent: '爱丽丝坐在姐姐身旁，开始好奇地望向那只白兔。',
          charStart: 0,
          charEnd: 24,
          x: 80,
          y: 100,
          width: 760,
          height: 120,
        }],
      },
      {
        pageNo: 2,
        width: 1024,
        height: 768,
        textContent: '白兔匆匆跑过，爱丽丝决定跟上去看看。',
        blocks: [{
          blockKey: 'page-2-paragraph-1',
          paragraphId: 'paragraph-2',
          textContent: '白兔匆匆跑过，爱丽丝决定跟上去看看。',
          charStart: 0,
          charEnd: 20,
          x: 80,
          y: 100,
          width: 760,
          height: 120,
        }],
      },
    ],
  })
  await reading.publishBook(created.bookId)
  return created
}

async function startHarness(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-integration-http-'))
  const databasePath = join(directory, 'integration.sqlite')
  const fixture = identityFixture()
  const application = createReadmateApplication({
    databasePath,
    sessionSecret: randomBytes(48).toString('base64url'),
    cookieSecure: false,
    serveStatic: false,
    modelProvider: options.modelProvider,
    reviewProvider: options.reviewProvider,
    deliveryAdapter: options.deliveryAdapter,
    summaryLinkSigningKey: options.summaryLinkSigningKey,
    miniProgramReceiptVerifier: options.miniProgramReceiptVerifier,
  })
  application.identity.service.importSeed(fixture.seed)
  const book = await createPublishedBook(application, fixture)
  const now = new Date().toISOString()
  application.database.prepare(`
    INSERT INTO safety_handlers (
      id, organization_id, organization_id_at_creation, actor_id_at_creation,
      user_id, scope_type, scope_id, handler_level, active, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, 'school', ?, 1, 1, ?, ?, 1)
  `).run(randomUUID(), fixture.organizationId, fixture.organizationId, fixture.adminId, fixture.adminId, fixture.organizationId, now, now)
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
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
  }
}

async function startInternalDemoSafetyHarness(t, { internalDemoMode }) {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-internal-demo-safety-http-'))
  const databasePath = join(directory, 'integration.sqlite')
  const password = randomBytes(24).toString('base64url')
  const fixture = {
    organizationId: 'internal-demo-organization',
    classId: 'internal-demo-class',
    gradeId: 'internal-demo-grade',
    workspaceId: 'internal-demo-workspace',
    schoolWorkspaceId: 'internal-demo-school-workspace',
    platformWorkspaceId: 'internal-demo-platform-workspace',
    studentId: 'internal-demo-student',
    teacherId: 'internal-teacher-li',
    backupTeacherId: 'internal-teacher-wang',
    adminId: 'internal-principal',
    opsId: 'internal-ops-admin',
    password,
    users: [
      { id: 'internal-demo-student', username: 'internal-student', displayName: '林小竹' },
      { id: 'internal-teacher-li', username: 'internal-teacher-li', displayName: '李老师' },
      { id: 'internal-teacher-wang', username: 'internal-teacher-wang', displayName: '王老师' },
      { id: 'internal-principal', username: 'internal-principal', displayName: '陈校长' },
      { id: 'internal-ops-admin', username: 'internal-ops-admin', displayName: '内部联调运营管理员' },
    ],
  }
  await bootstrapInternalDemo({
    databasePath,
    manifestPath: join(directory, 'unused-manifest.json'),
    publicRoot: join(directory, 'public'),
    password,
    catalogImporter: async () => ({ imported: [], unchanged: [], publicRoot: join(directory, 'public') }),
  })
  const reviewProvider = {
    review: async ({ context }) => ({
      review_result: 'confirmed',
      risk_level: 'high',
      evidence_message_ids: context.evidenceMessageIds,
      summary_for_staff: '演示测试事件：三条受控证据已完成二次复核，等待校内人员接手。',
      implicated_candidates: [{
        candidate_user_id: fixture.teacherId,
        confidence: 0.96,
        reason: '受控演示复核确认涉事候选，需要由后端排除',
      }],
      unknown_implicated_person: false,
      requires_human_review: false,
    }),
  }
  const application = createReadmateApplication({
    databasePath,
    sessionSecret: randomBytes(48).toString('base64url'),
    cookieSecure: false,
    serveStatic: false,
    internalDemoMode,
    reviewProvider,
  })
  const book = await createPublishedBook(application, fixture)
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
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
  }
}

test('真实 HTTP 链路持久化阅读、社区、报告和 outbox，并允许相关角色刷新读取', async (t) => {
  const harness = await startHarness(t)
  const { application, baseUrl, book, fixture } = harness
  const student = fixture.users.find((user) => user.id === fixture.studentId)
  const teacher = fixture.users.find((user) => user.id === fixture.teacherId)
  const admin = fixture.users.find((user) => user.id === fixture.adminId)
  const studentJar = await login(baseUrl, fixture, student)
  const teacherJar = await login(baseUrl, fixture, teacher)
  const adminJar = await login(baseUrl, fixture, admin)

  const session = await requestJson(baseUrl, studentJar, '/session')
  assert.equal(session.payload.data.activeWorkspaceId, fixture.workspaceId)
  const books = await requestJson(baseUrl, studentJar, '/books', { workspaceId: fixture.workspaceId })
  assert.equal(books.status, 200)
  assert.equal(books.payload.data.items[0].id, book.bookId)
  assert.equal(books.payload.data.items[0].progress.currentPage, null)
  assert.equal(Object.hasOwn(books.payload.data.items[0].progress, 'percent'), false)
  assert.equal(Object.hasOwn(books.payload.data.items[0].progress, 'effectiveMinutes'), false)
  assert.equal(Object.hasOwn(books.payload.data.items[0], 'finished'), false)
  const page = await requestJson(baseUrl, studentJar, `/books/${book.bookId}/pages/1`, { workspaceId: fixture.workspaceId })
  assert.equal(page.payload.data.blocks[0].text.includes('爱丽丝'), true)

  const lease = await requestJson(baseUrl, studentJar, '/reading/lease', {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'reading-lease-1',
    body: { bookVersionId: book.versionId },
  })
  assert.equal(lease.status, 200, JSON.stringify(lease.payload))
  const occurredAt = new Date().toISOString()
  const readingWrite = await requestJson(baseUrl, studentJar, '/reading/events/batch', {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'reading-events-1',
    body: {
      events: [{
        id: 'reading-event-1',
        schemaVersion: 1,
        deviceId: 'ignored-client-device',
        bookVersionId: book.versionId,
        pageNo: 1,
        eventType: 'page_stay',
        clientOccurredAt: occurredAt,
        durationMs: 60_000,
        foreground: true,
        screenOn: true,
        offlineSequence: 1,
        classSessionId: null,
        payload: {},
      }],
    },
  })
  assert.equal(readingWrite.status, 200, JSON.stringify(readingWrite.payload))
  const libraryAfterLegacyEvent = await requestJson(baseUrl, studentJar, '/reading/library', { workspaceId: fixture.workspaceId })
  assert.equal(libraryAfterLegacyEvent.status, 200, JSON.stringify(libraryAfterLegacyEvent.payload))
  assert.equal(Object.hasOwn(libraryAfterLegacyEvent.payload.data, 'footprints'), false)
  application.database.prepare(`UPDATE reading_events SET valid_reading_seconds = 86400 WHERE id = 'reading-event-1'`).run()
  const legacyOnlyProgress = await requestJson(baseUrl, studentJar, '/reading/progress', { workspaceId: fixture.workspaceId })
  assert.deepEqual(legacyOnlyProgress.payload.data.items, [])
  const legacyOnlyUsage = await requestJson(baseUrl, teacherJar, '/usage/summary', { workspaceId: fixture.workspaceId })
  assert.equal(legacyOnlyUsage.payload.data.metrics.activeReaders, 0)

  const leaseHistory = application.database.prepare(`SELECT valid_from, valid_until
    FROM reading_device_lease_history WHERE lease_id = ? ORDER BY valid_from DESC LIMIT 1`)
    .get(lease.payload.data.leaseId)
  const summary = {
    schemaVersion: 1,
    sessionId: 'integration-reading-summary-1',
    revision: 1,
    leaseId: lease.payload.data.leaseId,
    bookVersionId: book.versionId,
    statDate: readingStatDateFor(leaseHistory.valid_from),
    startedAt: leaseHistory.valid_from,
    measuredThroughAt: new Date(Date.parse(leaseHistory.valid_from) + 60_000).toISOString(),
    cumulativeEffectiveMs: 60_000,
    hadSkip: false,
    hadReread: false,
    lastPageNo: 2,
    endedAt: null,
    endReason: null,
    fingerprint: '',
  }
  assert.ok(summary.measuredThroughAt <= leaseHistory.valid_until)
  summary.fingerprint = canonicalReadingSummaryFingerprint(summary)
  const summaryWrite = await requestJson(baseUrl, studentJar, '/reading/session-summaries', {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'integration-reading-summary-1',
    body: summary,
  })
  assert.equal(summaryWrite.status, 200, JSON.stringify(summaryWrite.payload))
  application.database.prepare(`UPDATE reading_progress SET valid_reading_seconds = 86400
    WHERE actor_id = ? AND workspace_id = ? AND book_version_id = ?`)
    .run(fixture.studentId, fixture.workspaceId, book.versionId)
  const progressAfterRefresh = await requestJson(baseUrl, studentJar, '/reading/progress', { workspaceId: fixture.workspaceId })
  assert.equal(progressAfterRefresh.payload.data.items[0].effectiveMinutes, 1)
  assert.equal(progressAfterRefresh.payload.data.items[0].currentPage, 2)
  assert.equal(Object.hasOwn(progressAfterRefresh.payload.data.items[0], 'percent'), false)
  assert.equal(Object.hasOwn(progressAfterRefresh.payload.data.items[0], 'readRangeVersion'), false)
  assert.equal(Object.hasOwn(progressAfterRefresh.payload.data, 'startedBookCount'), false)
  const booksAtLastPage = await requestJson(baseUrl, studentJar, '/books', { workspaceId: fixture.workspaceId })
  assert.equal(booksAtLastPage.payload.data.items[0].progress.currentPage, 2)
  assert.equal(booksAtLastPage.payload.data.items[0].progress.effectiveMinutes, 1)
  assert.equal(Object.hasOwn(booksAtLastPage.payload.data.items[0].progress, 'percent'), false)
  assert.equal(Object.hasOwn(booksAtLastPage.payload.data.items[0], 'finished'), false)
  const teacherUsage = await requestJson(baseUrl, teacherJar, '/usage/summary', { workspaceId: fixture.workspaceId })
  assert.equal(teacherUsage.payload.data.metrics.activeReaders, 1)

  const submitted = await requestJson(baseUrl, studentJar, '/community/posts', {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'community-submit-1',
    body: {
      scope: 'class',
      title: '真实读书心得',
      body: '我注意到了白兔出现前后的变化。',
      quote: { bookId: book.bookId, page: 1, text: '爱丽丝坐在姐姐身旁，开始好奇地望向那只白兔。' },
    },
  })
  assert.equal(submitted.status, 201, JSON.stringify(submitted.payload))
  const postId = submitted.payload.data.id

  const skippedClassReview = await requestJson(baseUrl, adminJar, `/community/posts/${postId}/review`, {
    method: 'POST',
    workspaceId: fixture.schoolWorkspaceId,
    idempotencyKey: 'community-school-skipped-class-review-1',
    body: { decision: 'approved', reason: '不能跳过班级教师一审' },
  })
  assert.equal(skippedClassReview.status, 403, JSON.stringify(skippedClassReview.payload))
  const reviewed = await requestJson(baseUrl, teacherJar, `/community/posts/${postId}/review`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'community-review-1',
    body: { decision: 'approved', reason: '教师人工审核通过' },
  })
  assert.equal(reviewed.payload.data.status, 'approved')
  const studentFeedAfterRefresh = await requestJson(baseUrl, studentJar, '/community/posts', { workspaceId: fixture.workspaceId })
  assert.equal(studentFeedAfterRefresh.payload.data.items.some((item) => item.id === postId), true)

  const generated = await requestJson(baseUrl, teacherJar, '/reports', {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'report-generate-1',
    body: { studentId: fixture.studentId },
  })
  assert.equal(generated.status, 201, JSON.stringify(generated.payload))
  assert.equal(generated.payload.data.versions[0].content.effectiveMinutes, 1)
  assert.equal(Object.hasOwn(generated.payload.data.versions[0].content, 'startedBookCount'), false)
  assert.equal(Object.hasOwn(generated.payload.data.versions[0].content, 'startedBooks'), false)
  assert.equal(Object.hasOwn(generated.payload.data.versions[0].content, 'pagesRead'), false)
  assert.equal(generated.payload.data.versions[0].content.highlights.some((item) => item.includes('读到第')), false)
  assert.equal(generated.payload.data.versions[0].ai_generated, false)
  const reportId = generated.payload.data.id
  const reviewedReport = await requestJson(baseUrl, teacherJar, `/reports/${reportId}/review`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'report-review-1',
    body: { versionId: generated.payload.data.current_version_id },
  })
  assert.equal(reviewedReport.payload.data.status, 'reviewed')
  const contact = await requestJson(baseUrl, adminJar, '/parent-contacts', {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'parent-contact-1',
    body: { studentId: fixture.studentId, displayName: '脱敏家长', destination: 'internal-test-destination', channel: 'sms' },
  })
  assert.equal(contact.status, 201, JSON.stringify(contact.payload))
  const delivery = await requestJson(baseUrl, adminJar, `/reports/${reportId}/deliveries`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'report-delivery-1',
    body: { reportVersionId: reviewedReport.payload.data.current_version_id, parentContactId: contact.payload.data.id },
  })
  assert.equal(delivery.payload.data.status, 'queued')
  const reportAfterRefresh = await requestJson(baseUrl, teacherJar, `/reports/${reportId}`, { workspaceId: fixture.workspaceId })
  assert.equal(reportAfterRefresh.payload.data.status, 'reviewed')

  assert.equal(application.database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'reading.events.ingested'").get().count, 1)
  assert.equal(application.database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type IN ('community.post.submitted', 'community.post.reviewed')").get().count, 2)
  assert.equal(application.database.prepare("SELECT COUNT(*) AS count FROM community_posts WHERE id = ? AND status = 'approved'").get(postId).count, 1)
  assert.equal(application.database.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE topic = 'community.post_reviewed'").get().count, 1)
  assert.equal(application.database.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE topic = 'report.delivery_queued'").get().count, 1)
})

test('受保护 manual_demo_test 走正式安全复核并执行涉事教师回避', async (t) => {
  const disabledHarness = await startInternalDemoSafetyHarness(t, { internalDemoMode: false })
  const disabledStudent = disabledHarness.fixture.users.find((user) => user.id === disabledHarness.fixture.studentId)
  const disabledStudentJar = await login(disabledHarness.baseUrl, disabledHarness.fixture, disabledStudent)
  const disabled = await requestJson(disabledHarness.baseUrl, disabledStudentJar, '/internal-demo/manual-safety/evidence', {
    method: 'POST',
    workspaceId: disabledHarness.fixture.workspaceId,
    idempotencyKey: 'manual-demo-disabled',
    body: { stage: 1, bookId: disabledHarness.book.bookId, currentPageNo: 1 },
  })
  assert.equal(disabled.status, 403, JSON.stringify(disabled.payload))

  const harness = await startInternalDemoSafetyHarness(t, { internalDemoMode: true })
  const { application, baseUrl, book, fixture } = harness
  const jars = {}
  for (const user of fixture.users) jars[user.id] = await login(baseUrl, fixture, user)

  let conversationId = null
  let eventId = null
  for (let stage = 1; stage <= 3; stage += 1) {
    const response = await requestJson(baseUrl, jars[fixture.studentId], '/internal-demo/manual-safety/evidence', {
      method: 'POST',
      workspaceId: fixture.workspaceId,
      idempotencyKey: `manual-demo-stage-${stage}`,
      body: {
        stage,
        conversationId,
        bookId: book.bookId,
        currentPageNo: 1,
        implicatedStableAccountIds: [fixture.teacherId],
      },
    })
    assert.equal(response.status, 200, JSON.stringify(response.payload))
    conversationId = response.payload.data.conversationId
    if (stage < 3) {
      assert.equal(response.payload.data.reviewTaskId, null)
      assert.equal(response.payload.data.safetyEvent, null)
    } else {
      assert.equal(response.payload.data.qualifyingMessageCount, 3)
      assert.equal(response.payload.data.threshold, 0.8)
      assert.equal(response.payload.data.requiredQualifiedMessages, 3)
      assert.equal(response.payload.data.source, 'manual_demo_test')
      eventId = response.payload.data.safetyEvent.id
    }
  }

  const liDetail = await requestJson(baseUrl, jars[fixture.teacherId], `/safety/events/${eventId}`, {
    workspaceId: fixture.workspaceId,
  })
  assert.equal(liDetail.status, 403, JSON.stringify(liDetail.payload))
  const wangDetail = await requestJson(baseUrl, jars[fixture.backupTeacherId], `/safety/events/${eventId}`, {
    workspaceId: fixture.workspaceId,
  })
  assert.equal(wangDetail.status, 200, JSON.stringify(wangDetail.payload))
  const principalDetail = await requestJson(baseUrl, jars[fixture.adminId], `/safety/events/${eventId}`, {
    workspaceId: fixture.schoolWorkspaceId,
  })
  assert.equal(principalDetail.status, 200, JSON.stringify(principalDetail.payload))
  const opsDetail = await requestJson(baseUrl, jars[fixture.opsId], `/safety/events/${eventId}`, {
    workspaceId: fixture.platformWorkspaceId,
  })
  assert.equal(opsDetail.status, 403, JSON.stringify(opsDetail.payload))

  assert.equal(principalDetail.payload.data.displayLabel, '演示测试事件')
  assert.deepEqual(principalDetail.payload.data.implicatedCandidates.map((candidate) => candidate.id), [fixture.teacherId])
  assert.deepEqual(
    principalDetail.payload.data.notificationTargets.map((recipient) => recipient.userId).sort(),
    [fixture.backupTeacherId, fixture.adminId].sort(),
  )
  assert.deepEqual(principalDetail.payload.data.notificationTargets.map((recipient) => recipient.displayName).sort(), ['王老师', '陈校长'].sort())
  assert.deepEqual(
    principalDetail.payload.data.dispatchedNotifications.map((recipient) => recipient.userId).sort(),
    [fixture.backupTeacherId, fixture.adminId].sort(),
  )

  const stored = application.database.prepare(`
    SELECT task.trigger_reasons_json, event.notification_chain_json,
      (SELECT COUNT(*) FROM safety_review_evidence WHERE review_task_id = task.id) AS evidence_count,
      (SELECT COUNT(*) FROM outbox_events WHERE aggregate_type = 'safety_event' AND aggregate_id = event.id) AS outbox_count,
      (SELECT COUNT(*) FROM audit_events WHERE resource_type = 'safety_event' AND resource_id = event.id) AS audit_count
    FROM safety_review_tasks AS task
    JOIN safety_events AS event ON event.review_task_id = task.id
    WHERE event.id = ?
  `).get(eventId)
  assert.equal(stored.evidence_count, 3)
  assert.equal(JSON.parse(stored.trigger_reasons_json).some((reason) => reason.source === 'manual_demo_test'), true)
  assert.deepEqual(JSON.parse(stored.notification_chain_json).map((handler) => handler.userId), [fixture.backupTeacherId, fixture.adminId])
  assert.equal(stored.outbox_count >= 2, true)
  assert.equal(stored.audit_count >= 1, true)
})

test('学校社区必须经过班级教师一审和学校管理员二审，且真实 SQLite 状态、审计与 outbox 一致', async (t) => {
  const { application, baseUrl, book, fixture } = await startHarness(t)
  assert.equal(application.database instanceof DatabaseSync, true)

  const student = fixture.users.find((user) => user.id === fixture.studentId)
  const teacher = fixture.users.find((user) => user.id === fixture.teacherId)
  const admin = fixture.users.find((user) => user.id === fixture.adminId)
  const studentJar = await login(baseUrl, fixture, student)
  const teacherJar = await login(baseUrl, fixture, teacher)
  const adminJar = await login(baseUrl, fixture, admin)

  const submitted = await requestJson(baseUrl, studentJar, '/community/posts', {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'community-school-submit-1',
    body: {
      scope: 'school',
      title: '白兔出现前后的变化',
      body: '我注意到白兔出现前后，爱丽丝对未知世界的态度发生了变化。',
      quote: {
        bookId: book.bookId,
        page: 1,
        text: '爱丽丝坐在姐姐身旁，开始好奇地望向那只白兔。',
      },
    },
  })
  assert.equal(submitted.status, 201, JSON.stringify(submitted.payload))
  const postId = submitted.payload.data.id

  const classReview = await requestJson(baseUrl, teacherJar, `/community/posts/${postId}/review`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'community-school-class-review-1',
    body: { decision: 'approved', reason: '班级教师人工审核通过' },
  })
  assert.equal(classReview.status, 200, JSON.stringify(classReview.payload))
  assert.equal(classReview.payload.data.status, 'class_approved')

  const wrongReviewWorkspace = await requestJson(baseUrl, adminJar, `/community/posts/${postId}/review`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'community-school-wrong-workspace-review-1',
    body: { decision: 'approved', reason: '学校管理员不能在班级工作空间二审' },
  })
  assert.equal(wrongReviewWorkspace.status, 403, JSON.stringify(wrongReviewWorkspace.payload))

  const studentBeforeSchoolReview = await requestJson(baseUrl, studentJar, '/community/posts?scope=school', {
    workspaceId: fixture.workspaceId,
  })
  assert.equal(studentBeforeSchoolReview.payload.data.items.some((item) => item.id === postId), false)

  const schoolReview = await requestJson(baseUrl, adminJar, `/community/posts/${postId}/review`, {
    method: 'POST',
    workspaceId: fixture.schoolWorkspaceId,
    idempotencyKey: 'community-school-admin-review-1',
    body: { decision: 'approved', reason: '学校管理员二审通过' },
  })
  assert.equal(schoolReview.status, 200, JSON.stringify(schoolReview.payload))
  assert.equal(schoolReview.payload.data.status, 'approved')

  const studentAfterSchoolReview = await requestJson(baseUrl, studentJar, '/community/posts?scope=school', {
    workspaceId: fixture.workspaceId,
  })
  assert.equal(studentAfterSchoolReview.payload.data.items.some((item) => item.id === postId), true)

  const reaction = await requestJson(baseUrl, studentJar, `/community/posts/${postId}/reactions`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'community-school-reaction-1',
    body: { reactionType: 'appreciate' },
  })
  assert.equal(reaction.status, 201, JSON.stringify(reaction.payload))

  const negativeReaction = await requestJson(baseUrl, studentJar, `/community/posts/${postId}/reactions`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'community-school-negative-reaction-1',
    body: { reactionType: 'downvote' },
  })
  assert.equal(negativeReaction.status, 422, JSON.stringify(negativeReaction.payload))

  const stored = application.database.prepare(`
    SELECT scope, class_id_at_creation, quote_book_id, quote_page, quote_text, status
    FROM community_posts WHERE id = ?
  `).get(postId)
  assert.deepEqual({ ...stored }, {
    scope: 'school',
    class_id_at_creation: fixture.classId,
    quote_book_id: book.bookId,
    quote_page: 1,
    quote_text: '爱丽丝坐在姐姐身旁，开始好奇地望向那只白兔。',
    status: 'approved',
  })
  assert.equal(application.database.prepare("SELECT COUNT(*) AS count FROM post_reviews WHERE post_id = ? AND review_stage IN ('class', 'school')").get(postId).count, 2)
  assert.equal(application.database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE resource_id = ? AND event_type IN ('community.post.submitted', 'community.post.reviewed', 'community.post.reacted')").get(postId).count, 4)
  assert.equal(application.database.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE aggregate_id = ? AND topic IN ('community.post_submitted', 'community.post_reviewed', 'community.post_reacted')").get(postId).count, 4)
})

test('真实 HTTP 管理员创建班级和学生后，学生重新登录并在新工作空间读取书目', async (t) => {
  const { application, baseUrl, book, fixture } = await startHarness(t)
  const admin = fixture.users.find((user) => user.id === fixture.adminId)
  const teacher = fixture.users.find((user) => user.id === fixture.teacherId)
  const adminJar = await login(baseUrl, fixture, admin)
  const teacherJar = await login(baseUrl, fixture, teacher)

  const createdClass = await requestJson(baseUrl, adminJar, '/classes', {
    method: 'POST',
    workspaceId: fixture.schoolWorkspaceId,
    idempotencyKey: 'identity-create-class-1',
    body: { name: '真实新建一班', gradeId: fixture.gradeId },
  })
  assert.equal(createdClass.status, 201, JSON.stringify(createdClass.payload))
  assert.equal(createdClass.payload.data.organizationId, fixture.organizationId)
  assert.equal(createdClass.payload.data.status, 'active')
  assert.ok(createdClass.payload.data.workspaceId)

  const studentPassword = randomBytes(24).toString('base64url')
  const studentUsername = `new-student-${randomUUID()}`
  const denied = await requestJson(baseUrl, teacherJar, '/students', {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'identity-cross-class-student-1',
    body: {
      classId: createdClass.payload.data.id,
      username: studentUsername,
      displayName: '不应创建的学生',
      password: studentPassword,
    },
  })
  assert.equal(denied.status, 403, JSON.stringify(denied.payload))

  const createdStudent = await requestJson(baseUrl, adminJar, '/students', {
    method: 'POST',
    workspaceId: fixture.schoolWorkspaceId,
    idempotencyKey: 'identity-create-student-1',
    body: {
      classId: createdClass.payload.data.id,
      username: studentUsername,
      displayName: '真实新建学生',
      password: studentPassword,
    },
  })
  assert.equal(createdStudent.status, 201, JSON.stringify(createdStudent.payload))
  assert.equal(createdStudent.payload.data.classId, createdClass.payload.data.id)
  assert.equal(createdStudent.payload.data.workspaceId, createdClass.payload.data.workspaceId)
  assert.equal(createdStudent.payload.data.user.username, studentUsername)
  assert.equal('password' in createdStudent.payload.data, false)

  const assignment = await requestJson(baseUrl, adminJar, '/assignments', {
    method: 'POST',
    workspaceId: fixture.schoolWorkspaceId,
    idempotencyKey: 'identity-new-class-assignment-1',
    body: {
      bookVersionId: book.versionId,
      classIds: [createdClass.payload.data.id],
      title: '新班级真实阅读安排',
    },
  })
  assert.equal(assignment.status, 201, JSON.stringify(assignment.payload))

  const studentJar = await login(baseUrl, { password: studentPassword }, createdStudent.payload.data.user)
  const session = await requestJson(baseUrl, studentJar, '/session')
  assert.equal(session.status, 200)
  assert.equal(session.payload.data.activeWorkspaceId, createdClass.payload.data.workspaceId)
  const books = await requestJson(baseUrl, studentJar, '/books', {
    workspaceId: createdClass.payload.data.workspaceId,
  })
  assert.equal(books.status, 200, JSON.stringify(books.payload))
  assert.ok(books.payload.data.items.some((item) => item.id === book.bookId))

  const persisted = application.database.prepare(`
    SELECT
      users.id AS user_id,
      classes.id AS class_id,
      workspaces.id AS workspace_id,
      role_assignments.role_code,
      class_memberships.membership_role
    FROM users
    JOIN class_memberships ON class_memberships.user_id = users.id
    JOIN classes ON classes.id = class_memberships.class_id
    JOIN workspaces
      ON workspaces.organization_id = users.organization_id
      AND workspaces.scope_type = 'class'
      AND workspaces.scope_id = classes.id
    JOIN workspace_memberships
      ON workspace_memberships.user_id = users.id
      AND workspace_memberships.workspace_id = workspaces.id
    JOIN role_assignments
      ON role_assignments.user_id = users.id
      AND role_assignments.workspace_id = workspaces.id
      AND role_assignments.organization_id = users.organization_id
    WHERE users.username = ?
  `).get(studentUsername)
  assert.equal(persisted.class_id, createdClass.payload.data.id)
  assert.equal(persisted.workspace_id, createdClass.payload.data.workspaceId)
  assert.equal(persisted.role_code, 'student')
  assert.equal(persisted.membership_role, 'student')
  assert.equal(application.database.prepare(`
    SELECT COUNT(*) AS count
    FROM assignment_classes
    WHERE assignment_id = ? AND class_id = ?
  `).get(assignment.payload.data.assignmentId, createdClass.payload.data.id).count, 1)
  assert.equal(application.database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type IN ('identity.class.created', 'identity.student.created')").get().count, 2)
  assert.equal(application.database.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE topic IN ('identity.class.created', 'identity.student.created')").get().count, 2)
})

test('真实 HTTP 教学链创建安排、控制课堂、同步页面并只广播一次', async (t) => {
  const { application, baseUrl, book, fixture } = await startHarness(t)
  const teacher = fixture.users.find((user) => user.id === fixture.teacherId)
  const student = fixture.users.find((user) => user.id === fixture.studentId)
  const teacherJar = await login(baseUrl, fixture, teacher)
  const studentJar = await login(baseUrl, fixture, student)

  const assignment = await requestJson(baseUrl, teacherJar, '/assignments', {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'teaching-assignment-1',
    body: {
      bookVersionId: book.versionId,
      classIds: [fixture.classId],
      title: '课堂共读安排',
    },
  })
  assert.equal(assignment.status, 201, JSON.stringify(assignment.payload))

  const assignmentsAfterRefresh = await requestJson(baseUrl, teacherJar, '/assignments', { workspaceId: fixture.workspaceId })
  assert.equal(assignmentsAfterRefresh.payload.data.items.some((item) => item.id === assignment.payload.data.assignmentId), true)
  const studentBooksAfterRefresh = await requestJson(baseUrl, studentJar, '/books', { workspaceId: fixture.workspaceId })
  assert.equal(studentBooksAfterRefresh.payload.data.items.some((item) => item.id === book.bookId), true)

  const classroom = await requestJson(baseUrl, teacherJar, '/classroom/sessions', {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'classroom-session-1',
    body: { assignmentId: assignment.payload.data.assignmentId, pageNo: 1 },
  })
  assert.equal(classroom.status, 201, JSON.stringify(classroom.payload))
  const sessionId = classroom.payload.data.sessionId

  const control = await requestJson(baseUrl, teacherJar, `/classroom/sessions/${sessionId}/control`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'classroom-control-1',
    body: { ttlSeconds: 90 },
  })
  assert.equal(control.status, 200, JSON.stringify(control.payload))

  const locked = await requestJson(baseUrl, teacherJar, `/classroom/sessions/${sessionId}/book-lock`, {
    method: 'PATCH',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'classroom-lock-1',
    body: { bookVersionId: book.versionId },
  })
  assert.equal(locked.status, 200, JSON.stringify(locked.payload))
  const joined = await requestJson(baseUrl, studentJar, `/classroom/sessions/${sessionId}/join`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'classroom-student-join-1',
    body: {},
  })
  assert.equal(joined.status, 200, JSON.stringify(joined.payload))
  assert.equal(joined.payload.data.mode, 'lock')
  assert.equal(joined.payload.data.connected, true)

  const synchronized = await requestJson(baseUrl, teacherJar, `/classroom/sessions/${sessionId}/page`, {
    method: 'PATCH',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'classroom-page-1',
    body: { pageNo: 2 },
  })
  assert.equal(synchronized.payload.data.pageNo, 2)

  const broadcast = await requestJson(baseUrl, teacherJar, `/classroom/sessions/${sessionId}/broadcasts`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'classroom-broadcast-1',
    body: { sourceRequestId: 'completed-ai-request-1', message: { text: '请留意白兔出现前后的变化。' } },
  })
  assert.equal(broadcast.status, 201, JSON.stringify(broadcast.payload))
  const replayedBroadcast = await requestJson(baseUrl, teacherJar, `/classroom/sessions/${sessionId}/broadcasts`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'classroom-broadcast-1',
    body: { sourceRequestId: 'completed-ai-request-1', message: { text: '请留意白兔出现前后的变化。' } },
  })
  assert.equal(replayedBroadcast.payload.meta.replayed, true)

  const studentClassroomAfterRefresh = await requestJson(baseUrl, studentJar, `/classroom/sessions/${sessionId}`, { workspaceId: fixture.workspaceId })
  assert.equal(studentClassroomAfterRefresh.status, 200, JSON.stringify(studentClassroomAfterRefresh.payload))
  assert.equal(studentClassroomAfterRefresh.payload.data.mode, 'sync')
  assert.equal(studentClassroomAfterRefresh.payload.data.page, 2)
  assert.equal(studentClassroomAfterRefresh.payload.data.broadcast.id, broadcast.payload.data.broadcastId)
  assert.equal(studentClassroomAfterRefresh.payload.data.broadcast.message.text, '请留意白兔出现前后的变化。')

  const received = await requestJson(baseUrl, studentJar, `/classroom/sessions/${sessionId}/broadcasts/${broadcast.payload.data.broadcastId}/received`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'classroom-broadcast-received-1',
    body: {},
  })
  assert.equal(received.status, 200, JSON.stringify(received.payload))

  const ended = await requestJson(baseUrl, teacherJar, `/classroom/sessions/${sessionId}/end`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'classroom-end-1',
    body: {},
  })
  assert.equal(ended.status, 200, JSON.stringify(ended.payload))
  const endedForStudent = await requestJson(baseUrl, studentJar, `/classroom/sessions/${sessionId}`, { workspaceId: fixture.workspaceId })
  assert.equal(endedForStudent.payload.data.mode, 'ended')

  const classroomAfterRefresh = await requestJson(baseUrl, teacherJar, `/classroom/sessions/${sessionId}`, { workspaceId: fixture.workspaceId })
  assert.equal(classroomAfterRefresh.payload.data.synced_page_no, 2)
  assert.equal(application.database.prepare('SELECT COUNT(*) AS count FROM class_broadcasts WHERE class_session_id = ?').get(sessionId).count, 1)
  assert.equal(application.database.prepare('SELECT COUNT(*) AS count FROM class_broadcast_outbox').get().count, 1)
  assert.equal(application.database.prepare('SELECT COUNT(*) AS count FROM class_session_participants WHERE class_session_id = ? AND actor_id = ?').get(sessionId, fixture.studentId).count, 1)
  assert.equal(application.database.prepare('SELECT COUNT(*) AS count FROM class_broadcast_receipts WHERE class_broadcast_id = ? AND actor_id = ?').get(broadcast.payload.data.broadcastId, fixture.studentId).count, 1)
  for (const eventType of ['reading.assignment.created', 'classroom.control.claimed', 'classroom.book.locked', 'classroom.page.synced', 'classroom.ai.broadcast.enqueued', 'classroom.participant.joined', 'classroom.broadcast.received', 'classroom.session.ended']) {
    assert.equal(application.database.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE event_type = ?').get(eventType).count, 1, eventType)
  }
})

test('真实 HTTP 家长触达确定失败后重试成功并保存安全链接回执', async (t) => {
  let adapterCalls = 0
  const deliveryAdapter = {
    name: 'http-integration-local-adapter',
    async send({ providerIdempotencyKey }) {
      adapterCalls += 1
      if (adapterCalls === 1) {
        return { ok: false, failureCode: 'LOCAL_RETRY_TEST', providerReference: providerIdempotencyKey }
      }
      return { ok: true, providerReference: providerIdempotencyKey, providerMessageId: 'local-message-2' }
    },
  }
  const harness = await startHarness(t, {
    deliveryAdapter,
    summaryLinkSigningKey: randomBytes(48),
  })
  const { application, baseUrl, fixture } = harness
  const teacherJar = await login(baseUrl, fixture, fixture.users.find((user) => user.id === fixture.teacherId))
  const students = await requestJson(baseUrl, teacherJar, '/students', { workspaceId: fixture.workspaceId })
  assert.deepEqual(students.payload.data.items.map((student) => student.id), [fixture.studentId])

  const generated = await requestJson(baseUrl, teacherJar, '/reports', {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'delivery-report-generate-1',
    body: {
      studentId: fixture.studentId,
      snapshotKey: 'delivery-snapshot-1',
      content: {
        effectiveMinutes: 12,
        startedBookCount: 2,
        startedBooks: 3,
        booksStarted: 4,
        finishedBookCount: 5,
        pagesRead: 999,
        progressPercent: 100,
        finished: true,
      },
    },
  })
  assert.deepEqual(generated.payload.data.versions[0].content, { effectiveMinutes: 12 })
  const reportId = generated.payload.data.id
  const reviewed = await requestJson(baseUrl, teacherJar, `/reports/${reportId}/review`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'delivery-report-review-1',
    body: { versionId: generated.payload.data.current_version_id },
  })
  const reportsAfterRefresh = await requestJson(baseUrl, teacherJar, '/reports', { workspaceId: fixture.workspaceId })
  assert.equal(reportsAfterRefresh.payload.data.items.some((report) => report.id === reportId && report.status === 'reviewed'), true)
  const contact = await requestJson(baseUrl, teacherJar, '/parent-contacts', {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'delivery-contact-1',
    body: { studentId: fixture.studentId, displayName: '脱敏家长', destination: 'internal-summary-link', channel: 'summary_link' },
  })
  const contactsAfterRefresh = await requestJson(baseUrl, teacherJar, '/parent-contacts', { workspaceId: fixture.workspaceId })
  assert.equal(contactsAfterRefresh.payload.data.items.some((item) => item.id === contact.payload.data.id), true)
  const queued = await requestJson(baseUrl, teacherJar, `/reports/${reportId}/deliveries`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'delivery-queue-1',
    body: { reportVersionId: reviewed.payload.data.current_version_id, parentContactId: contact.payload.data.id, maxAttempts: 2 },
  })
  assert.equal(queued.payload.data.status, 'queued')
  assert.match(queued.payload.data.publicUrl, /^\/public\/summary-links\//)
  const deliveryId = queued.payload.data.id

  const firstAttempt = await requestJson(baseUrl, teacherJar, `/deliveries/${deliveryId}/process`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'delivery-process-1',
  })
  assert.equal(firstAttempt.payload.data.status, 'retry_scheduled')
  const secondAttempt = await requestJson(baseUrl, teacherJar, `/deliveries/${deliveryId}/process`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'delivery-process-2',
  })
  assert.equal(secondAttempt.payload.data.status, 'sent')
  assert.equal(adapterCalls, 2)

  const legacyArrayContent = [{
    percent: 64,
    percentage: 63,
    '阅读完成比例': '62%',
    note: '公开链接顶层数组普通文字',
    eyeCare: { restCompliancePercentage: 61 },
  }, {
    nested: [{ progressPercent: 60, label: '公开链接嵌套普通文字' }],
    classSummary: { attendancePercentage: 98 },
  }]
  application.database.prepare('UPDATE report_versions SET content_json = ? WHERE id = ?')
    .run(JSON.stringify(legacyArrayContent), reviewed.payload.data.current_version_id)
  const invalidOpen = await requestJson(baseUrl, new Map(), `${queued.payload.data.publicUrl.slice(0, -1)}x`)
  assert.equal(invalidOpen.status, 403)
  assert.equal(invalidOpen.payload.error.code, 'PERMISSION_DENIED')
  const receipt = await requestJson(baseUrl, new Map(), queued.payload.data.publicUrl)
  assert.equal(receipt.status, 200)
  assert.deepEqual(receipt.payload.data.report.content, [{
    note: '公开链接顶层数组普通文字',
    eyeCare: { restCompliancePercentage: 61 },
  }, {
    nested: [{ label: '公开链接嵌套普通文字' }],
    classSummary: { attendancePercentage: 98 },
  }])
  assert.equal(receipt.payload.data.student.displayName, '联调学生')
  const replayedOpen = await requestJson(baseUrl, new Map(), queued.payload.data.publicUrl)
  assert.equal(replayedOpen.status, 409)
  assert.equal(replayedOpen.payload.error.code, 'VERSION_CONFLICT')
  const deliveryAfterRefresh = await requestJson(baseUrl, teacherJar, `/deliveries/${deliveryId}`, { workspaceId: fixture.workspaceId })
  assert.equal(deliveryAfterRefresh.payload.data.status, 'sent')
  assert.equal(typeof deliveryAfterRefresh.payload.data.first_opened_at, 'string')
  const deliveriesAfterRefresh = await requestJson(baseUrl, teacherJar, '/deliveries', { workspaceId: fixture.workspaceId })
  const persistedDelivery = deliveriesAfterRefresh.payload.data.items.find((item) => item.id === deliveryId)
  assert.equal(persistedDelivery.status, 'sent')
  assert.equal(typeof persistedDelivery.firstOpenedAt, 'string')
  assert.equal('linkToken' in persistedDelivery, false)
  assert.equal('linkTokenHash' in persistedDelivery, false)
  assert.equal(application.database.prepare('SELECT COUNT(*) AS count FROM delivery_attempts WHERE delivery_id = ?').get(deliveryId).count, 2)
  assert.equal(application.database.prepare('SELECT COUNT(*) AS count FROM delivery_receipts WHERE delivery_id = ?').get(deliveryId).count, 1)
  assert.equal(application.database.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE aggregate_id = ? AND topic IN ('report.delivery_queued', 'report.delivery_failed', 'report.delivery_sent', 'report.delivery_receipt')").get(deliveryId).count, 4)
  assert.equal(application.database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type IN ('report.generated', 'report.reviewed', 'parent.contact.created', 'report.delivery.queued') AND actor_user_id = ?").get(fixture.teacherId).count, 4)
})

test('真实 HTTP AI 与安全链返回引用、阈值、累计数和复核状态并持久化', async (t) => {
  const providerRequests = []
  let implicatedUserId = null
  const modelProvider = {
    listCandidates: async () => [{ id: 'integration-model' }],
    generate: async ({ request }) => {
      providerRequests.push(request)
      return {
        answer: '这段文字写出了爱丽丝追随白兔时的好奇与行动。',
        responseType: 'answer',
        citations: [{ evidenceId: request.sources[0].evidenceId, pageNumber: request.sources[0].pageNumber }],
        privacy: { detected: false, confidence: 0, category: 'none', urgency: 'none' },
        danger: { detected: true, confidence: 0.91, category: 'self_harm', urgency: 'high' },
        implicatedCandidates: implicatedUserId
          ? [{ candidate_user_id: implicatedUserId, confidence: 0.92, reason: '模型候选，等待独立复核' }]
          : [],
        usage: { inputTokens: 20, outputTokens: 12, cachedTokens: 0, costMicros: 32 },
        spoilerRisk: false,
      }
    },
  }
  const reviewProvider = {
    review: async ({ context }) => ({
      review_result: 'confirmed',
      risk_level: 'high',
      evidence_message_ids: context.evidenceMessageIds,
      summary_for_staff: '三条达到阈值的消息已由独立模型复核，等待人工接手。',
      implicated_candidates: implicatedUserId
        ? [{ candidate_user_id: implicatedUserId, confidence: 0.94, reason: '独立复核确认需要回避' }]
        : [],
      unknown_implicated_person: false,
      requires_human_review: false,
    }),
  }
  const harness = await startHarness(t, { modelProvider, reviewProvider })
  const { application, baseUrl, book, fixture } = harness
  implicatedUserId = fixture.teacherId
  const studentJar = await login(baseUrl, fixture, fixture.users.find((user) => user.id === fixture.studentId))
  const adminJar = await login(baseUrl, fixture, fixture.users.find((user) => user.id === fixture.adminId))
  const opsJar = await login(baseUrl, fixture, fixture.users.find((user) => user.id === fixture.opsId))
  assert.equal(opsJar.loginResponse.data.navigation.defaultPath, '/console/home')
  assert.deepEqual(opsJar.loginResponse.data.navigation.entries, [
    { kind: 'console', path: '/console/home', workspaceId: fixture.platformWorkspaceId },
  ])
  const handlerCreatedAt = new Date().toISOString()
  application.database.prepare(`
    INSERT INTO safety_handlers (
      id, organization_id, organization_id_at_creation, actor_id_at_creation,
      user_id, scope_type, scope_id, handler_level, active, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, 'school', ?, 1, 1, ?, ?, 1)
  `).run(
    randomUUID(),
    fixture.organizationId,
    fixture.organizationId,
    fixture.adminId,
    fixture.teacherId,
    fixture.organizationId,
    handlerCreatedAt,
    handlerCreatedAt,
  )
  const unrelatedClassId = `unrelated-class-${randomUUID()}`
  application.database.prepare(`
    INSERT INTO classes (
      id, organization_id, grade_id, name, status, created_at, updated_at, version
    ) VALUES (?, ?, ?, '联调别班', 'active', ?, ?, 1)
  `).run(unrelatedClassId, fixture.organizationId, fixture.gradeId, handlerCreatedAt, handlerCreatedAt)
  application.database.prepare(`
    INSERT INTO safety_handlers (
      id, organization_id, organization_id_at_creation, actor_id_at_creation,
      user_id, scope_type, scope_id, handler_level, active, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, 'class', ?, 2, 1, ?, ?, 1)
  `).run(
    randomUUID(),
    fixture.organizationId,
    fixture.organizationId,
    fixture.adminId,
    fixture.adminId,
    unrelatedClassId,
    handlerCreatedAt,
    handlerCreatedAt,
  )
  const selectedBlock = application.database.prepare(`
    SELECT block.id, block.text_content
    FROM book_blocks AS block
    JOIN book_pages AS page ON page.id = block.page_id
    WHERE page.book_version_id = ? AND page.page_no = 1
    ORDER BY block.char_start, block.id
    LIMIT 1
  `).get(book.versionId)
  const unreadPage = application.database.prepare(`
    SELECT page_no FROM book_pages
    WHERE book_version_id = ? AND page_no > 1
    ORDER BY page_no
    LIMIT 1
  `).get(book.versionId)
  assert.ok(unreadPage)
  const explicitCurrentPage = await requestJson(baseUrl, studentJar, '/ai/messages', {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'ai-message-forged-unread-page',
    body: {
      bookId: book.bookId,
      currentPageNo: unreadPage.page_no,
      text: '请说明还没有读到的页面内容。',
      safeMode: true,
    },
  })
  assert.equal(explicitCurrentPage.status, 200, JSON.stringify(explicitCurrentPage.payload))
  assert.equal(providerRequests.length, 1)
  assert.equal(providerRequests[0].sources.every((source) => source.pageNumber === unreadPage.page_no), true)
  const positionAtLastPageAt = new Date().toISOString()
  application.database.prepare(`INSERT INTO reading_progress (
      id, actor_id, workspace_id, book_version_id, last_page_no, valid_reading_seconds,
      updated_from_event_at, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, 2, 86400, ?, ?, ?, 1)`)
    .run(randomUUID(), fixture.studentId, fixture.workspaceId, book.versionId,
      positionAtLastPageAt, positionAtLastPageAt, positionAtLastPageAt)
  let conversationId = null
  let lastAnswer
  for (let index = 1; index <= 3; index += 1) {
    lastAnswer = await requestJson(baseUrl, studentJar, '/ai/messages', {
      method: 'POST',
      workspaceId: fixture.workspaceId,
      idempotencyKey: `ai-message-${index}`,
      body: {
        conversationId,
        bookId: book.bookId,
        currentPageNo: 1,
        text: `第 ${index} 次真实联调问题`,
        safeMode: true,
        ...(index === 1 ? {
          selectedBlockIds: [selectedBlock.id],
          selectionRange: { blockId: selectedBlock.id, startOffset: 0, endOffset: 6 },
        } : {}),
      },
    })
    assert.equal(lastAnswer.status, 200, JSON.stringify(lastAnswer.payload))
    conversationId = lastAnswer.payload.data.conversationId
  }
  assert.equal(lastAnswer.payload.data.citations.length, 1)
  assert.deepEqual(providerRequests[1].selectionRange, { blockId: selectedBlock.id, startOffset: 0, endOffset: 6 })
  assert.equal(providerRequests[1].sources[0].evidenceId, selectedBlock.id)
  assert.equal(providerRequests[1].sources.every((source) => source.pageNumber === 1), true)
  assert.equal(lastAnswer.payload.data.safety.threshold, 0.8)
  assert.equal(lastAnswer.payload.data.safety.qualifyingMessageCount, 3)
  assert.equal(lastAnswer.payload.data.safety.requiredQualifiedMessages, 3)
  assert.equal(lastAnswer.payload.data.safety.reviewStatus, 'awaiting_human_acceptance')
  assert.equal(lastAnswer.payload.data.safety.evidenceMessages.length, 3)

  const conversationsAfterRefresh = await requestJson(baseUrl, studentJar, '/ai/conversations', { workspaceId: fixture.workspaceId })
  assert.equal(conversationsAfterRefresh.payload.data.items[0].messages.length, 6)
  assert.equal(conversationsAfterRefresh.payload.data.items[0].messages.filter((message) => message.refs.length > 0).length, 3)
  assert.equal(
    conversationsAfterRefresh.payload.data.items[0].messages.find((message) => message.refs.length > 0).refs[0].text,
    selectedBlock.text_content,
  )
  const eventId = lastAnswer.payload.data.safety.id
  const staffDetail = await requestJson(baseUrl, adminJar, `/safety/events/${eventId}`, { workspaceId: fixture.workspaceId })
  assert.equal(staffDetail.status, 200, JSON.stringify(staffDetail.payload))
  assert.equal(staffDetail.payload.data.qualifyingMessageCount, 3)
  assert.equal(staffDetail.payload.data.evidenceMessages.length, 3)
  assert.deepEqual(staffDetail.payload.data.implicatedCandidates.map((candidate) => candidate.id), [fixture.teacherId])
  assert.deepEqual(staffDetail.payload.data.chain.map((handler) => handler.userId), [fixture.adminId])
  assert.deepEqual(staffDetail.payload.data.chain.map((handler) => handler.displayName), ['联调管理员'])
  assert.deepEqual(staffDetail.payload.data.notificationTargets.map((recipient) => recipient.userId), [fixture.adminId])
  assert.deepEqual(staffDetail.payload.data.dispatchedNotifications.map((recipient) => recipient.userId), [fixture.adminId])
  assert.deepEqual(staffDetail.payload.data.deliveredNotifications, [])
  assert.deepEqual(staffDetail.payload.data.notified.map((recipient) => recipient.userId), [fixture.adminId])
  assert.equal(staffDetail.payload.data.chain[0].deliveryStatus, 'dispatched')
  assert.deepEqual(staffDetail.payload.data.availableActions, ['take'])
  const accepted = await requestJson(baseUrl, adminJar, `/safety/events/${eventId}/accept`, {
    method: 'POST',
    workspaceId: fixture.schoolWorkspaceId,
    idempotencyKey: `safety-accept-${eventId}`,
    body: {},
  })
  assert.equal(accepted.status, 200, JSON.stringify(accepted.payload))
  assert.equal(accepted.payload.data.status, 'working')
  assert.deepEqual(accepted.payload.data.availableActions, ['close', 'false'])

  const opsCannotClose = await requestJson(baseUrl, opsJar, `/safety/events/${eventId}/close`, {
    method: 'POST',
    workspaceId: fixture.platformWorkspaceId,
    idempotencyKey: `ops-safety-close-${eventId}`,
    body: { outcome: 'closed', note: '运营账号不得代替学校处理。' },
  })
  assert.equal(opsCannotClose.status, 403, JSON.stringify(opsCannotClose.payload))
  const opsCannotReadSafety = await requestJson(baseUrl, opsJar, `/safety/events/${eventId}`, {
    workspaceId: fixture.platformWorkspaceId,
  })
  assert.equal(opsCannotReadSafety.status, 403, JSON.stringify(opsCannotReadSafety.payload))

  const closed = await requestJson(baseUrl, adminJar, `/safety/events/${eventId}/close`, {
    method: 'POST',
    workspaceId: fixture.schoolWorkspaceId,
    idempotencyKey: `safety-close-${eventId}`,
    body: { outcome: 'closed', note: '已完成线下联系与后续跟进安排。' },
  })
  assert.equal(closed.status, 200, JSON.stringify(closed.payload))
  assert.equal(closed.payload.data.status, 'closed')
  assert.equal(closed.payload.data.result.summary, '已完成线下联系与后续跟进安排。')
  assert.deepEqual(closed.payload.data.availableActions, [])

  const schoolCannotReadPlatformAudit = await requestJson(baseUrl, adminJar, '/audit/events', {
    workspaceId: fixture.schoolWorkspaceId,
  })
  assert.equal(schoolCannotReadPlatformAudit.status, 403, JSON.stringify(schoolCannotReadPlatformAudit.payload))
  const platformAudit = await requestJson(baseUrl, opsJar, `/audit/events?resourceId=${encodeURIComponent(eventId)}`, {
    workspaceId: fixture.platformWorkspaceId,
  })
  assert.equal(platformAudit.status, 200, JSON.stringify(platformAudit.payload))
  assert.deepEqual(
    platformAudit.payload.data.items.map((item) => item.eventType),
    ['safety.event.closed', 'safety.event.accepted'],
  )
  const staffEvents = await requestJson(baseUrl, adminJar, '/safety/events', { workspaceId: fixture.workspaceId })
  assert.equal(staffEvents.status, 200, JSON.stringify(staffEvents.payload))
  assert.equal(staffEvents.payload.data.items.length, 1)
  assert.equal(staffEvents.payload.data.items[0].pendingCount, 1)
  assert.equal(application.database.prepare('SELECT COUNT(*) AS count FROM ai_usage_ledger').get().count, 4)
  assert.equal(application.database.prepare('SELECT COUNT(*) AS count FROM safety_events').get().count, 1)
  assert.deepEqual(
    application.database.prepare(`
      SELECT user_id, status, delivered_at, read_at
      FROM safety_notification_recipients
      WHERE safety_event_id = ?
      ORDER BY user_id
    `).all(eventId).map((row) => ({ ...row })),
    [{ user_id: fixture.adminId, status: 'dispatched', delivered_at: null, read_at: null }],
  )
  assert.equal(application.database.prepare(`
    SELECT COUNT(*) AS count
    FROM outbox_events
    WHERE aggregate_id = ? AND topic = 'safety.notification.dispatch' AND status = 'delivered'
  `).get(eventId).count, 1)
  assert.equal(application.database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'ai.message.completed'").get().count, 4)
  assert.equal(application.database.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE topic = 'ai.message.completed'").get().count, 4)
  assert.deepEqual(
    { ...application.database.prepare(`
      SELECT status, resolution_note, closed_by_user_id, closed_at
      FROM safety_events WHERE id = ?
    `).get(eventId) },
    {
      status: 'closed',
      resolution_note: '已完成线下联系与后续跟进安排。',
      closed_by_user_id: fixture.adminId,
      closed_at: closed.payload.data.closedAt,
    },
  )
  assert.equal(application.database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE resource_id = ? AND event_type IN ('safety.event.accepted', 'safety.event.closed')").get(eventId).count, 2)
  assert.equal(application.database.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE aggregate_id = ? AND topic IN ('safety.event.accepted', 'safety.event.closed')").get(eventId).count, 2)
})

test('Stage 4 真实 HTTP 多会话、私密申请、护眼与阅读统计刷新后仍由 SQLite 驱动', async (t) => {
  const { application, fixture, book, baseUrl } = await startHarness(t)
  const student = fixture.users.find((user) => user.id === fixture.studentId)
  const teacher = fixture.users.find((user) => user.id === fixture.teacherId)
  const studentJar = await login(baseUrl, fixture, student)
  const teacherJar = await login(baseUrl, fixture, teacher)
  const studentActor = application.identity.service.getUser(fixture.studentId)
  const studentWorkspace = application.identity.service.resolveWorkspace(fixture.studentId, fixture.workspaceId)
  assert.equal(application.identity.service.authorize({
    actor: studentActor,
    workspace: studentWorkspace,
    action: 'ai.conversation.create',
    resourceScope: {
      type: 'class', id: fixture.classId, scopeType: 'class', scopeId: fixture.classId,
      organizationId: fixture.organizationId, ownerId: fixture.studentId, classId: fixture.classId,
    },
  }), true)

  const created = await requestJson(baseUrl, studentJar, '/ai/conversations', {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'stage4-conversation-create',
    body: {
      bookVersionId: book.versionId,
      initialText: '白兔为什么这么匆忙？',
      pageNumber: 1,
      selection: { text: '白兔匆匆跑过', pageNumber: 2 },
      citations: [],
    },
  })
  assert.equal(created.status, 201, JSON.stringify(created.payload))
  const conversationId = created.payload.data.id

  const renamed = await requestJson(baseUrl, studentJar, `/ai/conversations/${conversationId}`, {
    method: 'PATCH',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'stage4-conversation-rename',
    body: { action: 'rename', title: '白兔为什么匆忙', expectedVersion: created.payload.data.version },
  })
  assert.equal(renamed.status, 200, JSON.stringify(renamed.payload))

  const privateConversation = await requestJson(baseUrl, studentJar, `/ai/conversations/${conversationId}`, {
    method: 'PATCH',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'stage4-conversation-private',
    body: { action: 'set_privacy', privacyMode: 'private', expectedVersion: renamed.payload.data.version },
  })
  assert.equal(privateConversation.status, 200, JSON.stringify(privateConversation.payload))

  const refreshed = await requestJson(baseUrl, studentJar, '/ai/conversations?includeDeleted=true', {
    workspaceId: fixture.workspaceId,
  })
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.payload))
  assert.equal(refreshed.payload.data.items.find((item) => item.id === conversationId)?.title, '白兔为什么匆忙')
  assert.equal(refreshed.payload.data.items.find((item) => item.id === conversationId)?.privacyMode, 'private')

  const scopedIndex = await requestJson(baseUrl, teacherJar, '/console/conversations?text=%E7%99%BD%E5%85%94', {
    workspaceId: fixture.workspaceId,
  })
  assert.equal(scopedIndex.status, 200, JSON.stringify(scopedIndex.payload))
  assert.equal(scopedIndex.payload.data.classes[0].students[0].conversations[0].id, conversationId)

  const deniedBeforeConsent = await requestJson(baseUrl, teacherJar, `/console/conversations/${fixture.studentId}/${conversationId}?purpose=%E9%98%85%E8%AF%BB%E6%8C%87%E5%AF%BC`, {
    workspaceId: fixture.workspaceId,
  })
  assert.equal(deniedBeforeConsent.status, 403)
  assert.equal(deniedBeforeConsent.payload.error.code, 'PRIVACY_CONSENT_REQUIRED')

  const accessRequest = await requestJson(baseUrl, teacherJar, '/privacy/access-requests', {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'stage4-privacy-request',
    body: { conversationId, purpose: '阅读指导复盘' },
  })
  assert.equal(accessRequest.status, 201, JSON.stringify(accessRequest.payload))

  const ownerRequests = await requestJson(baseUrl, studentJar, '/privacy/access-requests', {
    workspaceId: fixture.workspaceId,
  })
  assert.equal(ownerRequests.status, 200, JSON.stringify(ownerRequests.payload))
  assert.equal(ownerRequests.payload.data.items[0].id, accessRequest.payload.data.id)

  const approved = await requestJson(baseUrl, studentJar, `/privacy/access-requests/${accessRequest.payload.data.id}/decision`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'stage4-privacy-approve',
    body: { decision: 'approved' },
  })
  assert.equal(approved.status, 200, JSON.stringify(approved.payload))

  const viewed = await requestJson(baseUrl, teacherJar, `/privacy/conversations/${conversationId}/access`, {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'stage4-privacy-view',
    body: { purpose: '阅读指导复盘' },
  })
  assert.equal(viewed.status, 200, JSON.stringify(viewed.payload))
  assert.equal(viewed.payload.data.accessMode, 'student_approved')
  assert.match(viewed.payload.data.watermark, /联调教师/)

  const firstLease = await requestJson(baseUrl, studentJar, '/reading/lease', {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'stage4-reading-lease-first',
    body: { bookVersionId: book.versionId },
  })
  assert.equal(firstLease.status, 200, JSON.stringify(firstLease.payload))
  assert.equal(firstLease.payload.data.nextOfflineSequence, 1)

  const firstReadingWrite = await requestJson(baseUrl, studentJar, '/reading/events/batch', {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'stage4-reading-event-first',
    body: {
      events: [{
        id: 'stage4-reading-event-first',
        schemaVersion: 1,
        deviceId: 'ignored-client-device',
        bookVersionId: book.versionId,
        pageNo: 1,
        eventType: 'page_stay',
        clientOccurredAt: new Date().toISOString(),
        durationMs: 60_000,
        foreground: true,
        screenOn: true,
        offlineSequence: firstLease.payload.data.nextOfflineSequence,
        classSessionId: null,
        payload: {},
      }],
    },
  })
  assert.equal(firstReadingWrite.status, 200, JSON.stringify(firstReadingWrite.payload))

  const refreshedLease = await requestJson(baseUrl, studentJar, '/reading/lease', {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'stage4-reading-lease-after-refresh',
    body: { bookVersionId: book.versionId },
  })
  assert.equal(refreshedLease.status, 200, JSON.stringify(refreshedLease.payload))
  assert.equal(refreshedLease.payload.data.nextOfflineSequence, 2)

  const readingWriteAfterRefresh = await requestJson(baseUrl, studentJar, '/reading/events/batch', {
    method: 'POST',
    workspaceId: fixture.workspaceId,
    idempotencyKey: 'stage4-reading-event-after-refresh',
    body: {
      events: [{
        id: 'stage4-reading-event-after-refresh',
        schemaVersion: 1,
        deviceId: 'ignored-client-device',
        bookVersionId: book.versionId,
        pageNo: 2,
        eventType: 'page_turn',
        clientOccurredAt: new Date().toISOString(),
        durationMs: 0,
        foreground: true,
        screenOn: true,
        offlineSequence: refreshedLease.payload.data.nextOfflineSequence,
        classSessionId: null,
        payload: { fromPageNo: 1, direction: 'next' },
      }],
    },
  })
  assert.equal(readingWriteAfterRefresh.status, 200, JSON.stringify(readingWriteAfterRefresh.payload))
  await new Promise((resolve) => setTimeout(resolve, 1_100))

  const selfStatistics = await requestJson(baseUrl, studentJar, '/reading/statistics/self', {
    workspaceId: fixture.workspaceId,
  })
  assert.equal(selfStatistics.status, 200, JSON.stringify(selfStatistics.payload))
  assert.equal(selfStatistics.payload.data.todayEffectiveReadingSeconds, 0)
  assert.deepEqual(selfStatistics.payload.data.checkIn, {
    checked: false,
    thresholdSeconds: 300,
    remainingSeconds: 300,
  })
  assert.equal(selfStatistics.payload.data.lastReading, null)
  assert.equal(Object.hasOwn(selfStatistics.payload.data, 'totalEffectiveReadingSeconds'), false)

  const scopedStatistics = await requestJson(baseUrl, teacherJar, `/reading/statistics/scope?classId=${encodeURIComponent(fixture.classId)}&statDate=${encodeURIComponent(selfStatistics.payload.data.statDate)}`, {
    workspaceId: fixture.workspaceId,
  })
  assert.equal(scopedStatistics.status, 200, JSON.stringify(scopedStatistics.payload))
  assert.equal(scopedStatistics.payload.data.class.activeStudentCount, 1)
  assert.equal(scopedStatistics.payload.data.summary.checkedInStudentCount, 0)
  assert.equal(scopedStatistics.payload.data.summary.totalEffectiveReadingSeconds, 0)
  assert.equal(scopedStatistics.payload.data.students.length, 1)

  const studentEyeCare = await requestJson(baseUrl, studentJar, '/eyecare/status', {
    workspaceId: fixture.workspaceId,
  })
  assert.equal(studentEyeCare.status, 200, JSON.stringify(studentEyeCare.payload))
  assert.equal(studentEyeCare.payload.data.studentId, fixture.studentId)

  const teacherEyeCare = await requestJson(baseUrl, teacherJar, '/eyecare/students', {
    workspaceId: fixture.workspaceId,
  })
  assert.equal(teacherEyeCare.status, 200, JSON.stringify(teacherEyeCare.payload))
  assert.equal(teacherEyeCare.payload.data.items.some((item) => item.studentId === fixture.studentId), true)

  const persisted = application.database.prepare(`
    SELECT conversation.title, conversation.privacy_mode, request.status, history.access_mode
    FROM ai_conversations AS conversation
    JOIN privacy_access_requests AS request ON request.conversation_id = conversation.id
    JOIN privacy_access_history AS history ON history.conversation_id = conversation.id
    WHERE conversation.organization_id = ? AND conversation.owner_user_id = ? AND conversation.id = ?
  `).get(fixture.organizationId, fixture.studentId, conversationId)
  assert.deepEqual({ ...persisted }, {
    title: '白兔为什么匆忙',
    privacy_mode: 'private',
    status: 'approved',
    access_mode: 'student_approved',
  })
  assert.equal(application.database.prepare(`
    SELECT COUNT(*) AS count FROM audit_events
    WHERE resource_id = ? AND event_type IN (
      'ai.conversation.created', 'ai.conversation.renamed', 'ai.conversation.privacy_changed',
      'privacy.access.requested', 'privacy.access.resolved', 'privacy.conversation.viewed'
    )
  `).get(conversationId).count >= 4, true)
})

test('Stage 5 真实 HTTP 学生阅读对象路由持久化喜欢、书单、书签、摘录和批注', async (t) => {
  const { application, fixture, book, baseUrl } = await startHarness(t)
  const student = fixture.users.find((user) => user.id === fixture.studentId)
  const teacher = fixture.users.find((user) => user.id === fixture.teacherId)
  const studentJar = await login(baseUrl, fixture, student)
  const requestLibrary = (path, options = {}) => requestJson(baseUrl, studentJar, path, {
    ...options,
    workspaceId: fixture.workspaceId,
  })

  const initial = await requestLibrary('/reading/library')
  assert.equal(initial.status, 200, JSON.stringify(initial.payload))
  assert.equal(Array.isArray(initial.payload.data.shelf), true)
  assert.equal(Object.hasOwn(initial.payload.data, 'footprints'), false)
  const readerPage = await requestLibrary(`/books/${encodeURIComponent(book.bookId)}/pages/1`)
  assert.equal(readerPage.status, 200, JSON.stringify(readerPage.payload))
  const anchorBlock = readerPage.payload.data.blocks.find((block) => typeof block.text === 'string' && block.text.trim().length >= 4)
  assert.ok(anchorBlock)
  const anchorQuote = anchorBlock.text.trim().slice(0, 4)
  const anchorStart = anchorBlock.text.indexOf(anchorQuote)
  assert.ok(anchorStart >= 0)

  const favoriteCreated = await requestLibrary('/reading/library/favorites', {
    method: 'POST',
    idempotencyKey: 'stage5-library-favorite-create',
    body: { bookVersionId: book.versionId, position: 0 },
  })
  assert.equal(favoriteCreated.status, 201, JSON.stringify(favoriteCreated.payload))
  const favoriteReplay = await requestLibrary('/reading/library/favorites', {
    method: 'POST',
    idempotencyKey: 'stage5-library-favorite-create',
    body: { bookVersionId: book.versionId, position: 0 },
  })
  assert.equal(favoriteReplay.status, 201, JSON.stringify(favoriteReplay.payload))
  assert.equal(favoriteReplay.payload.data.id, favoriteCreated.payload.data.id)
  const favoriteUpdated = await requestLibrary(`/reading/library/favorites/${encodeURIComponent(favoriteCreated.payload.data.id)}`, {
    method: 'PATCH',
    idempotencyKey: 'stage5-library-favorite-update',
    body: { expectedVersion: favoriteCreated.payload.data.version, position: 1 },
  })
  assert.equal(favoriteUpdated.status, 200, JSON.stringify(favoriteUpdated.payload))

  const listCreated = await requestLibrary('/reading/library/lists', {
    method: 'POST',
    idempotencyKey: 'stage5-library-list-create',
    body: { name: '真实持久化书单', position: 0 },
  })
  assert.equal(listCreated.status, 201, JSON.stringify(listCreated.payload))
  const listUpdated = await requestLibrary(`/reading/library/lists/${encodeURIComponent(listCreated.payload.data.id)}`, {
    method: 'PATCH',
    idempotencyKey: 'stage5-library-list-update',
    body: { expectedVersion: listCreated.payload.data.version, name: '更新后的真实书单', position: 1 },
  })
  assert.equal(listUpdated.status, 200, JSON.stringify(listUpdated.payload))
  const listItemCreated = await requestLibrary(`/reading/library/lists/${encodeURIComponent(listCreated.payload.data.id)}/items`, {
    method: 'POST',
    idempotencyKey: 'stage5-library-list-item-create',
    body: { bookVersionId: book.versionId, position: 0 },
  })
  assert.equal(listItemCreated.status, 201, JSON.stringify(listItemCreated.payload))
  const listItemUpdated = await requestLibrary(`/reading/library/list-items/${encodeURIComponent(listItemCreated.payload.data.id)}`, {
    method: 'PATCH',
    idempotencyKey: 'stage5-library-list-item-update',
    body: { expectedVersion: listItemCreated.payload.data.version, position: 2 },
  })
  assert.equal(listItemUpdated.status, 200, JSON.stringify(listItemUpdated.payload))

  const bookmarkCreated = await requestLibrary('/reading/library/bookmarks', {
    method: 'POST',
    idempotencyKey: 'stage5-library-bookmark-create',
    body: { bookVersionId: book.versionId, pageNo: 1, label: '真实书签', position: 0 },
  })
  assert.equal(bookmarkCreated.status, 201, JSON.stringify(bookmarkCreated.payload))
  const bookmarkUpdated = await requestLibrary(`/reading/library/bookmarks/${encodeURIComponent(bookmarkCreated.payload.data.id)}`, {
    method: 'PATCH',
    idempotencyKey: 'stage5-library-bookmark-update',
    body: { expectedVersion: bookmarkCreated.payload.data.version, label: '更新后的真实书签', position: 2 },
  })
  assert.equal(bookmarkUpdated.status, 200, JSON.stringify(bookmarkUpdated.payload))

  const excerptCreated = await requestLibrary('/reading/library/excerpts', {
    method: 'POST',
    idempotencyKey: 'stage5-library-excerpt-create',
    body: {
      bookVersionId: book.versionId,
      pageNo: 1,
      quoteText: '爱丽丝坐在姐姐身旁',
      note: '真实摘录',
      position: 0,
    },
  })
  assert.equal(excerptCreated.status, 201, JSON.stringify(excerptCreated.payload))
  const missingBlockAnchor = await requestLibrary('/reading/library/excerpts', {
    method: 'POST',
    idempotencyKey: 'stage5-library-excerpt-missing-block-anchor',
    body: {
      bookVersionId: book.versionId,
      pageNo: 1,
      blockId: 'missing-stage5-anchor-block',
      charStart: anchorStart,
      charEnd: anchorStart + anchorQuote.length,
      quoteText: anchorQuote,
      note: '页内原文不能绑定不存在的块',
      position: 1,
    },
  })
  assert.equal(missingBlockAnchor.status, 422, JSON.stringify(missingBlockAnchor.payload))
  const invalidOffsetAnchor = await requestLibrary('/reading/library/annotations', {
    method: 'POST',
    idempotencyKey: 'stage5-library-annotation-invalid-offset-anchor',
    body: {
      bookVersionId: book.versionId,
      pageNo: 1,
      blockId: anchorBlock.id,
      charStart: anchorStart + 1,
      charEnd: anchorStart + anchorQuote.length,
      quoteText: anchorQuote,
      body: '页内原文但块内偏移不匹配',
      color: 'violet',
      position: 1,
    },
  })
  assert.equal(invalidOffsetAnchor.status, 422, JSON.stringify(invalidOffsetAnchor.payload))
  const excerptUpdated = await requestLibrary(`/reading/library/excerpts/${encodeURIComponent(excerptCreated.payload.data.id)}`, {
    method: 'PATCH',
    idempotencyKey: 'stage5-library-excerpt-update',
    body: { expectedVersion: excerptCreated.payload.data.version, note: '更新后的真实摘录', position: 2 },
  })
  assert.equal(excerptUpdated.status, 200, JSON.stringify(excerptUpdated.payload))

  const annotationCreated = await requestLibrary('/reading/library/annotations', {
    method: 'POST',
    idempotencyKey: 'stage5-library-annotation-create',
    body: {
      bookVersionId: book.versionId,
      pageNo: 1,
      blockId: anchorBlock.id,
      charStart: anchorStart,
      charEnd: anchorStart + anchorQuote.length,
      quoteText: anchorQuote,
      body: '真实批注',
      color: 'violet',
      position: 0,
    },
  })
  assert.equal(annotationCreated.status, 201, JSON.stringify(annotationCreated.payload))
  const annotationUpdated = await requestLibrary(`/reading/library/annotations/${encodeURIComponent(annotationCreated.payload.data.id)}`, {
    method: 'PATCH',
    idempotencyKey: 'stage5-library-annotation-update',
    body: { expectedVersion: annotationCreated.payload.data.version, body: '更新后的真实批注', color: 'green', position: 2 },
  })
  assert.equal(annotationUpdated.status, 200, JSON.stringify(annotationUpdated.payload))

  const refreshed = await requestLibrary('/reading/library')
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.payload))
  assert.equal(refreshed.payload.data.favorites.length, 1)
  assert.equal(refreshed.payload.data.lists.length, 1)
  assert.equal(refreshed.payload.data.lists[0].items.length, 1)
  assert.equal(refreshed.payload.data.bookmarks.length, 1)
  assert.equal(refreshed.payload.data.excerpts.length, 1)
  assert.equal(refreshed.payload.data.annotations.length, 1)
  assert.equal(Object.hasOwn(refreshed.payload.data, 'footprints'), false)

  const teacherJar = await login(baseUrl, fixture, teacher)
  const teacherRead = await requestJson(baseUrl, teacherJar, '/reading/library', { workspaceId: fixture.workspaceId })
  assert.equal(teacherRead.status, 403, JSON.stringify(teacherRead.payload))

  const deleteFavorite = await requestLibrary(`/reading/library/favorites/${encodeURIComponent(favoriteUpdated.payload.data.id)}`, {
    method: 'DELETE',
    idempotencyKey: 'stage5-library-favorite-delete',
    body: { expectedVersion: favoriteUpdated.payload.data.version },
  })
  assert.equal(deleteFavorite.status, 200, JSON.stringify(deleteFavorite.payload))
  const deleteListItem = await requestLibrary(`/reading/library/list-items/${encodeURIComponent(listItemUpdated.payload.data.id)}`, {
    method: 'DELETE',
    idempotencyKey: 'stage5-library-list-item-delete',
    body: { expectedVersion: listItemUpdated.payload.data.version },
  })
  assert.equal(deleteListItem.status, 200, JSON.stringify(deleteListItem.payload))
  const deleteList = await requestLibrary(`/reading/library/lists/${encodeURIComponent(listUpdated.payload.data.id)}`, {
    method: 'DELETE',
    idempotencyKey: 'stage5-library-list-delete',
    body: { expectedVersion: listUpdated.payload.data.version },
  })
  assert.equal(deleteList.status, 200, JSON.stringify(deleteList.payload))
  const deleteBookmark = await requestLibrary(`/reading/library/bookmarks/${encodeURIComponent(bookmarkUpdated.payload.data.id)}`, {
    method: 'DELETE',
    idempotencyKey: 'stage5-library-bookmark-delete',
    body: { expectedVersion: bookmarkUpdated.payload.data.version },
  })
  assert.equal(deleteBookmark.status, 200, JSON.stringify(deleteBookmark.payload))
  const deleteExcerpt = await requestLibrary(`/reading/library/excerpts/${encodeURIComponent(excerptUpdated.payload.data.id)}`, {
    method: 'DELETE',
    idempotencyKey: 'stage5-library-excerpt-delete',
    body: { expectedVersion: excerptUpdated.payload.data.version },
  })
  assert.equal(deleteExcerpt.status, 200, JSON.stringify(deleteExcerpt.payload))
  const deleteAnnotation = await requestLibrary(`/reading/library/annotations/${encodeURIComponent(annotationUpdated.payload.data.id)}`, {
    method: 'DELETE',
    idempotencyKey: 'stage5-library-annotation-delete',
    body: { expectedVersion: annotationUpdated.payload.data.version },
  })
  assert.equal(deleteAnnotation.status, 200, JSON.stringify(deleteAnnotation.payload))

  const finalSnapshot = await requestLibrary('/reading/library')
  assert.equal(finalSnapshot.status, 200, JSON.stringify(finalSnapshot.payload))
  assert.equal(finalSnapshot.payload.data.favorites.length, 0)
  assert.equal(finalSnapshot.payload.data.lists.length, 0)
  assert.equal(finalSnapshot.payload.data.bookmarks.length, 0)
  assert.equal(finalSnapshot.payload.data.excerpts.length, 0)
  assert.equal(finalSnapshot.payload.data.annotations.length, 0)
  assert.equal(application.database.prepare(`
    SELECT COUNT(*) AS count FROM audit_events
    WHERE actor_user_id = ? AND event_type LIKE 'reading.%'
  `).get(fixture.studentId).count >= 18, true)
})
