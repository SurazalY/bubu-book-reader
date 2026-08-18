import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { openSqliteDatabase } from '../../../server/db/database.js'
import { runMigrations } from '../../../server/db/migrate.js'
import { createEyeCareDomain, eyeCareWindowStart } from '../../../server/domains/reading/eyecare.js'
import { createPrivacyDomain } from '../../../server/domains/privacy/index.js'

const migrationDirectory = fileURLToPath(new URL('../../../server/db/migrations/', import.meta.url))

function createFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'bubu-eyecare-privacy-'))
  const database = openSqliteDatabase(path.join(directory, 'domain.sqlite'))
  runMigrations(database, migrationDirectory, '2026-08-06T05:00:00.000Z')
  let now = new Date('2026-08-06T05:20:00.000Z')
  let sequence = 0
  const audit = []
  const timestamp = '2026-08-06T05:00:00.000Z'

  for (const [id, name] of [['org-1', '一校'], ['org-2', '二校']]) {
    database.prepare('INSERT INTO organizations (id, name, school_code, status, created_at, updated_at, version) VALUES (?, ?, ?, \'active\', ?, ?, 1)')
      .run(id, name, id, timestamp, timestamp)
  }
  const users = [
    ['student-1', 'org-1', 'student-1', '学生甲'],
    ['student-2', 'org-1', 'student-2', '学生乙'],
    ['teacher-1', 'org-1', 'teacher-1', '教师甲'],
    ['teacher-implicated', 'org-1', 'teacher-implicated', '涉事教师'],
    ['school-admin-1', 'org-1', 'school-admin-1', '学校管理员'],
    ['outsider-1', 'org-2', 'outsider-1', '外校教师'],
  ]
  for (const user of users) {
    database.prepare(`INSERT INTO users
      (id, organization_id, username, display_name, status, created_at, updated_at, version, login_name, account_code)
      VALUES (?, ?, ?, ?, 'active', ?, ?, 1, ?, ?)`).run(...user, timestamp, timestamp, user[2], `A-${user[0]}`)
  }
  const workspaces = [
    ['workspace-class-1', 'org-1', 'class-teacher', '一班空间', 'class', 'class-1'],
    ['workspace-class-2', 'org-1', 'class-teacher', '二班空间', 'class', 'class-2'],
    ['workspace-school-1', 'org-1', 'school-admin', '一校管理', 'school', 'org-1'],
    ['workspace-other', 'org-2', 'class-teacher', '外校空间', 'class', 'class-other'],
  ]
  for (const workspace of workspaces) {
    database.prepare(`INSERT INTO workspaces
      (id, organization_id, code, name, scope_type, scope_id, status, created_at, updated_at, version)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1)`).run(...workspace, timestamp, timestamp)
  }
  const classes = [
    ['class-1', 'org-1', 'grade-1', '一班'],
    ['class-2', 'org-1', 'grade-1', '二班'],
    ['class-other', 'org-2', 'grade-other', '外校班'],
  ]
  for (const classRow of classes) {
    database.prepare(`INSERT INTO classes
      (id, organization_id, grade_id, name, status, created_at, updated_at, version)
      VALUES (?, ?, ?, ?, 'active', ?, ?, 1)`).run(...classRow, timestamp, timestamp)
  }
  const memberships = [
    ['member-student-1', 'class-1', 'student-1', 'student'],
    ['member-student-2', 'class-2', 'student-2', 'student'],
    ['member-teacher-1', 'class-1', 'teacher-1', 'teacher'],
    ['member-implicated', 'class-1', 'teacher-implicated', 'teacher'],
    ['member-outsider', 'class-other', 'outsider-1', 'teacher'],
  ]
  for (const membership of memberships) {
    database.prepare(`INSERT INTO class_memberships
      (id, class_id, user_id, membership_role, status, created_at, updated_at, version)
      VALUES (?, ?, ?, ?, 'active', ?, ?, 1)`).run(...membership, timestamp, timestamp)
  }

  const dependencies = {
    db: database,
    now: () => now,
    idFactory: () => `stage4-b-${++sequence}`,
    authorize: async () => true,
    audit: async (event) => audit.push(event),
  }
  return {
    database,
    audit,
    dependencies,
    setNow(value) { now = new Date(value) },
    close() {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

function auth(userId, workspaceId, organizationId = 'org-1') {
  return { userId, workspaceId, organizationId }
}

function insertEyeMetrics(fixture, { studentId = 'student-1', workspaceId = 'workspace-class-1', continuous = 0, day = 0, week = 0 } = {}) {
  const now = fixture.dependencies.now().toISOString()
  fixture.database.prepare(`INSERT INTO eye_care_states
      (actor_id, workspace_id, continuous_eye_seconds, last_active_at, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(actor_id, workspace_id) DO UPDATE SET continuous_eye_seconds = excluded.continuous_eye_seconds,
      last_active_at = excluded.last_active_at, updated_at = excluded.updated_at, version = version + 1`)
    .run(studentId, workspaceId, continuous, now, now, now)
  for (const [kind, seconds] of [['day', day], ['week', week]]) {
    const windowStart = eyeCareWindowStart(fixture.dependencies.now(), kind).toISOString()
    fixture.database.prepare(`INSERT INTO eye_care_usage
        (id, actor_id, workspace_id, window_start_at, window_kind, valid_eye_seconds, created_at, updated_at, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(actor_id, workspace_id, window_kind, window_start_at)
      DO UPDATE SET valid_eye_seconds = excluded.valid_eye_seconds, updated_at = excluded.updated_at, version = version + 1`)
      .run(`usage-${studentId}-${workspaceId}-${kind}`, studentId, workspaceId, windowStart, kind, seconds, now, now)
  }
}

function insertConversation(fixture, { id, owner = 'student-1', privacy = 'private', messageCount = 3 }) {
  const now = fixture.dependencies.now().toISOString()
  fixture.database.prepare(`INSERT INTO ai_conversations
      (id, organization_id, organization_id_at_creation, owner_user_id, actor_id_at_creation,
        book_version_id, title, privacy_mode, created_at, updated_at, version)
    VALUES (?, 'org-1', 'org-1', ?, ?, 'book-version-1', ?, ?, ?, ?, 1)`)
    .run(id, owner, owner, `会话 ${id}`, privacy, now, now)
  for (let index = 1; index <= messageCount; index += 1) {
    fixture.database.prepare(`INSERT INTO ai_messages
        (id, conversation_id, organization_id, organization_id_at_creation, actor_id_at_creation,
          role, content, privacy_json, danger_json, provider_attempts_json, created_at, updated_at, version)
      VALUES (?, ?, 'org-1', 'org-1', ?, ?, ?, '{}', '{}', '[]', ?, ?, 1)`)
      .run(`${id}-message-${index}`, id, owner, index % 2 ? 'user' : 'assistant', `第 ${index} 条内容`, now, now)
  }
}

function markSafetyConversation(fixture, conversationId) {
  const now = fixture.dependencies.now().toISOString()
  fixture.database.prepare(`INSERT INTO safety_review_tasks
      (id, organization_id, organization_id_at_creation, actor_id_at_creation, conversation_id,
        initial_message_id, evidence_message_ids_json, trigger_reasons_json, privacy_json, danger_json,
        candidate_user_ids_json, candidate_catalog_ids_json, policy_snapshot_json, status,
        review_attempts, created_at, updated_at, version)
    VALUES ('review-1', 'org-1', 'org-1', 'student-1', ?, ?, ?, '["danger"]', '{}', '{}',
      '["teacher-implicated"]', '[]', '{}', 'awaiting_human_acceptance', 1, ?, ?, 1)`)
    .run(conversationId, `${conversationId}-message-3`, JSON.stringify([`${conversationId}-message-2`, `${conversationId}-message-3`]), now, now)
  fixture.database.prepare(`INSERT INTO safety_review_evidence_state
      (review_task_id, organization_id, owner_user_id, conversation_id, evidence_generation,
        created_at, updated_at, version)
    VALUES ('review-1', 'org-1', 'student-1', ?, 0, ?, ?, 1)`).run(conversationId, now, now)
  for (const index of [2, 3]) {
    fixture.database.prepare(`INSERT INTO safety_review_evidence
        (review_task_id, ai_message_id, organization_id, owner_user_id, conversation_id,
          confidence, trigger, created_at, updated_at, version)
      VALUES ('review-1', ?, 'org-1', 'student-1', ?, 0.95, 'qualified_message_count', ?, ?, 1)`)
      .run(`${conversationId}-message-${index}`, conversationId, now, now)
  }
  fixture.database.prepare(`INSERT INTO safety_implicated_candidates
      (id, review_task_id, candidate_user_id, confidence, reason, excluded_from_notification,
        created_at, updated_at, version)
    VALUES ('candidate-1', 'review-1', 'teacher-implicated', 0.98, 'provider stable id candidate', 1, ?, ?, 1)`)
    .run(now, now)
}

test('护眼状态按真实聚合进入提醒、强制休息并在到时后自动恢复', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const eyeCare = createEyeCareDomain({
    ...fixture.dependencies,
    policy: { reminderSeconds: 60, forceRestSeconds: 120, restSeconds: 30, offlineGraceSeconds: 10 },
  })
  insertEyeMetrics(fixture, { continuous: 60, day: 600, week: 1800 })
  const reminder = await eyeCare.getStudentStatus({ authContext: auth('student-1', 'workspace-class-1') })
  assert.equal(reminder.enforcement.status, 'reminder')
  assert.equal(reminder.dailyValidEyeSeconds, 600)
  assert.equal(reminder.weeklyValidEyeSeconds, 1800)

  insertEyeMetrics(fixture, { continuous: 120, day: 660, week: 1860 })
  const forced = await eyeCare.getStudentStatus({ authContext: auth('student-1', 'workspace-class-1') })
  assert.equal(forced.enforcement.status, 'forced_rest')
  assert.equal(forced.enforcement.offline.failClosed, true)
  assert.equal(forced.enforcement.offline.graceSeconds, 10)

  fixture.setNow('2026-08-06T05:20:20.000Z')
  assert.equal((await eyeCare.getStudentStatus({ authContext: auth('student-1', 'workspace-class-1') })).enforcement.status, 'forced_rest')
  fixture.setNow('2026-08-06T05:20:31.000Z')
  const recovered = await eyeCare.getStudentStatus({ authContext: auth('student-1', 'workspace-class-1') })
  assert.equal(recovered.enforcement.status, 'normal')
  assert.equal(recovered.enforcement.recoverySource, 'timer')
  assert.equal(recovered.continuousEyeSeconds, 0)
  const stableRecovery = await eyeCare.getStudentStatus({ authContext: auth('student-1', 'workspace-class-1') })
  assert.equal(stableRecovery.enforcement.status, 'normal')
  assert.equal(stableRecovery.continuousEyeSeconds, 0)
})

test('教师与学校管理员只能读取真实范围并且只能按误判解除强制休息', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const eyeCare = createEyeCareDomain({
    ...fixture.dependencies,
    policy: { reminderSeconds: 60, forceRestSeconds: 120, restSeconds: 300, offlineGraceSeconds: 10 },
  })
  insertEyeMetrics(fixture, { studentId: 'student-1', workspaceId: 'workspace-class-1', continuous: 150, day: 900, week: 2400 })
  insertEyeMetrics(fixture, { studentId: 'student-2', workspaceId: 'workspace-class-2', continuous: 30, day: 300, week: 900 })

  const classRows = await eyeCare.listScopedStudents({ authContext: auth('teacher-1', 'workspace-class-1') })
  assert.deepEqual(classRows.items.map((item) => item.studentId), ['student-1'])
  const schoolRows = await eyeCare.listScopedStudents({ authContext: auth('school-admin-1', 'workspace-school-1') })
  assert.deepEqual(schoolRows.items.map((item) => item.studentId), ['student-1', 'student-2'])
  await assert.rejects(() => eyeCare.releaseFalsePositive({
    authContext: auth('teacher-1', 'workspace-class-1'), studentId: 'student-2', falsePositive: true, reason: '误把课堂投屏算作个人用眼',
  }), { code: 'RESOURCE_NOT_FOUND' })
  await assert.rejects(() => eyeCare.releaseFalsePositive({
    authContext: auth('teacher-1', 'workspace-class-1'), studentId: 'student-1', falsePositive: false, reason: '普通解除',
  }), { code: 'VALIDATION_FAILED' })
  await eyeCare.releaseFalsePositive({
    authContext: auth('teacher-1', 'workspace-class-1'), studentId: 'student-1', falsePositive: true, reason: '误把课堂投屏算作个人用眼',
  })
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM eye_care_release_records').get().count, 1)
  assert.equal(fixture.audit.some((event) => event.eventType === 'eyecare.false_positive_released'), true)
})

test('普通私密会话必须经学生授权，超时按已告知规则同意并保留水印与访问历史', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const privacy = createPrivacyDomain({ ...fixture.dependencies, requestTtlSeconds: 30, grantTtlSeconds: 120 })
  insertConversation(fixture, { id: 'conversation-private' })
  await assert.rejects(() => privacy.viewConversation({
    authContext: auth('teacher-1', 'workspace-class-1'), conversationId: 'conversation-private', purpose: '了解学生阅读困惑',
  }), { code: 'PRIVACY_CONSENT_REQUIRED' })

  const request = await privacy.createAccessRequest({
    authContext: auth('teacher-1', 'workspace-class-1'), conversationId: 'conversation-private', purpose: '了解学生阅读困惑',
  })
  const ownerRequests = await privacy.listOwnerRequests({ authContext: auth('student-1', 'workspace-class-1') })
  assert.deepEqual(ownerRequests.items.map((item) => item.id), [request.id])
  assert.equal('safetyFlagged' in ownerRequests.items[0], false)
  await privacy.resolveAccessRequest({
    authContext: auth('student-1', 'workspace-class-1'), requestId: request.id, decision: 'approved',
  })
  const viewed = await privacy.viewConversation({
    authContext: auth('teacher-1', 'workspace-class-1'), conversationId: 'conversation-private', purpose: '了解学生阅读困惑',
  })
  assert.equal(viewed.accessMode, 'student_approved')
  assert.equal(viewed.messages.length, 3)
  assert.match(viewed.watermark, /教师甲.*teacher-1/)
  const history = await privacy.listOwnerAccessHistory({ authContext: auth('student-1', 'workspace-class-1') })
  assert.equal(history.items.length, 1)
  assert.equal(history.items[0].viewerUserId, 'teacher-1')

  insertConversation(fixture, { id: 'conversation-denied' })
  const deniedRequest = await privacy.createAccessRequest({
    authContext: auth('teacher-1', 'workspace-class-1'), conversationId: 'conversation-denied', purpose: '了解阅读困惑',
  })
  await privacy.resolveAccessRequest({
    authContext: auth('student-1', 'workspace-class-1'), requestId: deniedRequest.id, decision: 'denied',
  })
  await assert.rejects(() => privacy.viewConversation({
    authContext: auth('teacher-1', 'workspace-class-1'), conversationId: 'conversation-denied', purpose: '了解阅读困惑',
  }), { code: 'PRIVACY_CONSENT_REQUIRED' })

  insertConversation(fixture, { id: 'conversation-timeout' })
  await privacy.createAccessRequest({
    authContext: auth('teacher-1', 'workspace-class-1'), conversationId: 'conversation-timeout', purpose: '课堂后续辅导', expiresInSeconds: 5,
  })
  fixture.setNow('2026-08-06T05:20:06.000Z')
  const timeoutView = await privacy.viewConversation({
    authContext: auth('teacher-1', 'workspace-class-1'), conversationId: 'conversation-timeout', purpose: '课堂后续辅导',
  })
  assert.equal(timeoutView.accessMode, 'timeout_auto_approved')
  assert.equal(fixture.database.prepare("SELECT status FROM privacy_access_requests WHERE conversation_id = 'conversation-timeout'").get().status, 'approved')
  assert.equal(fixture.database.prepare("SELECT decision_source FROM privacy_access_decisions WHERE conversation_id = 'conversation-timeout'").get().decision_source, 'timeout_auto_approved')
  assert.equal(fixture.audit.some((event) => event.eventType === 'privacy.access.requested'), true)
  assert.equal(fixture.audit.some((event) => event.eventType === 'privacy.access.approved'), true)
  assert.equal(fixture.audit.some((event) => event.eventType === 'privacy.access.denied'), true)
  assert.equal(fixture.audit.some((event) => event.eventType === 'privacy.access.timeout_approved'), true)
  assert.equal(fixture.audit.some((event) => event.eventType === 'privacy.conversation.viewed'), true)
})

test('安全标记会话只返回证据最小上下文，涉事教师被后端拒绝且学生端不感知危险事件', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const privacy = createPrivacyDomain({ ...fixture.dependencies })
  insertConversation(fixture, { id: 'conversation-safety' })
  markSafetyConversation(fixture, 'conversation-safety')

  const direct = await privacy.viewConversation({
    authContext: auth('teacher-1', 'workspace-class-1'), conversationId: 'conversation-safety', purpose: '核实需线下关怀的最小上下文',
  })
  assert.equal(direct.accessMode, 'safety_minimum_context')
  assert.deepEqual(direct.messages.map((message) => message.id), ['conversation-safety-message-2', 'conversation-safety-message-3'])
  await assert.rejects(() => privacy.viewConversation({
    authContext: auth('teacher-implicated', 'workspace-class-1'), conversationId: 'conversation-safety', purpose: '查看安全事件',
  }), { code: 'IMPLICATED_VIEWER_EXCLUDED' })

  const requests = await privacy.listOwnerRequests({ authContext: auth('student-1', 'workspace-class-1') })
  const history = await privacy.listOwnerAccessHistory({ authContext: auth('student-1', 'workspace-class-1') })
  assert.deepEqual(requests.items, [])
  assert.deepEqual(history.items, [])
  assert.equal(fixture.database.prepare("SELECT COUNT(*) AS count FROM privacy_access_history WHERE access_mode = 'safety_minimum_context'").get().count, 1)
})

test('私密会话查询始终绑定认证组织和真实工作空间范围', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const privacy = createPrivacyDomain({ ...fixture.dependencies })
  insertConversation(fixture, { id: 'conversation-org-1' })
  await assert.rejects(() => privacy.createAccessRequest({
    authContext: auth('outsider-1', 'workspace-other', 'org-2'),
    conversationId: 'conversation-org-1',
    purpose: '跨校查看不应成功',
  }), { code: 'RESOURCE_NOT_FOUND' })
  await assert.rejects(() => privacy.createAccessRequest({
    authContext: auth('teacher-1', 'workspace-class-2'),
    conversationId: 'conversation-org-1',
    purpose: '跨班查看不应成功',
  }), { code: 'RESOURCE_NOT_FOUND' })
})
