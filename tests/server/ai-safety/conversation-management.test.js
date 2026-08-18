import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { openSqliteDatabase } from '../../../server/db/database.js'
import { runMigrations } from '../../../server/db/migrate.js'
import {
  ConversationDomainError,
  createConversationDomain,
  generateConversationTitle,
} from '../../../server/domains/ai/conversations.js'

const migrationDirectory = fileURLToPath(new URL('../../../server/db/migrations/', import.meta.url))
const timestamp = '2026-08-06T05:30:00.000Z'

function createFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'bubu-conversations-'))
  const database = openSqliteDatabase(path.join(directory, 'domain.sqlite'))
  runMigrations(database, migrationDirectory, timestamp)
  let sequence = 0
  const audit = []
  for (const [id, name] of [['org-a', '甲校'], ['org-b', '乙校']]) {
    database.prepare("INSERT INTO organizations (id, name, school_code, status, created_at, updated_at, version) VALUES (?, ?, ?, 'active', ?, ?, 1)")
      .run(id, name, id, timestamp, timestamp)
  }
  for (const user of [
    ['student-a', 'org-a', 'student-a', '学生甲'],
    ['student-b', 'org-a', 'student-b', '学生乙'],
    ['teacher-a', 'org-a', 'teacher-a', '教师甲'],
    ['outsider-b', 'org-b', 'outsider-b', '外校教师'],
  ]) {
    database.prepare("INSERT INTO users (id, organization_id, username, display_name, status, created_at, updated_at, version, login_name, account_code) VALUES (?, ?, ?, ?, 'active', ?, ?, 1, ?, ?)")
      .run(...user, timestamp, timestamp, user[2], `A-${user[0]}`)
  }
  for (const workspace of [
    ['workspace-student-a', 'org-a', 'class-teacher', '学生空间', 'own', 'student-a'],
    ['workspace-class-a', 'org-a', 'class-teacher', '一班空间', 'class', 'class-a'],
    ['workspace-school-a', 'org-a', 'school-admin', '学校空间', 'school', 'org-a'],
    ['workspace-b', 'org-b', 'class-teacher', '外校空间', 'own', 'outsider-b'],
  ]) {
    database.prepare("INSERT INTO workspaces (id, organization_id, code, name, scope_type, scope_id, status, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1)")
      .run(...workspace, timestamp, timestamp)
  }
  for (const [index, membership] of [
    ['student-a', 'workspace-student-a'],
    ['teacher-a', 'workspace-class-a'],
    ['teacher-a', 'workspace-school-a'],
    ['outsider-b', 'workspace-b'],
  ].entries()) {
    database.prepare("INSERT INTO workspace_memberships (id, user_id, workspace_id, status, created_at, updated_at, version) VALUES (?, ?, ?, 'active', ?, ?, 1)")
      .run(`workspace-member-${index}`, ...membership, timestamp, timestamp)
  }
  database.prepare("INSERT INTO classes (id, organization_id, grade_id, name, status, created_at, updated_at, version) VALUES ('class-a', 'org-a', 'grade-a', '三年级一班', 'active', ?, ?, 1)")
    .run(timestamp, timestamp)
  for (const [index, membership] of [['student-a', 'student'], ['student-b', 'student'], ['teacher-a', 'teacher']].entries()) {
    database.prepare("INSERT INTO class_memberships (id, class_id, user_id, membership_role, status, created_at, updated_at, version) VALUES (?, 'class-a', ?, ?, 'active', ?, ?, 1)")
      .run(`class-member-${index}`, ...membership, timestamp, timestamp)
  }
  for (const book of [
    ['book-a', 'version-a', 'Alice'],
    ['book-b', 'version-b', 'Oz'],
  ]) {
    database.prepare("INSERT INTO books (id, organization_id_at_creation, actor_id_at_creation, title, status, created_at, updated_at, version) VALUES (?, 'org-a', 'teacher-a', ?, 'published', ?, ?, 1)")
      .run(book[0], book[2], timestamp, timestamp)
    database.prepare("INSERT INTO book_versions (id, book_id, organization_id_at_creation, actor_id_at_creation, label, source_format, page_count, created_at, updated_at, version) VALUES (?, ?, 'org-a', 'teacher-a', 'v1', 'pdf', 20, ?, ?, 1)")
      .run(book[1], book[0], timestamp, timestamp)
  }
  const domain = createConversationDomain({
    db: database,
    now: () => new Date(timestamp),
    idFactory: () => `conversation-object-${++sequence}`,
    authorize: async ({ permission }) => !permission.startsWith('deny.'),
    audit: async (event) => audit.push(event),
  })
  return {
    database,
    domain,
    audit,
    close() {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

function auth(userId, workspaceId, organizationId = 'org-a') {
  return { userId, workspaceId, organizationId }
}

test('标题自动生成并保留显式标题', () => {
  assert.equal(generateConversationTitle({ text: '  为什么 Alice 会跟着白兔跑？  ' }), '为什么 Alice 会跟着白兔跑？')
  assert.equal(generateConversationTitle({ selection: { text: '   一段被选中的原文   ' } }), '一段被选中的原文')
  assert.equal(generateConversationTitle({ title: ' 我的标题 ', text: '忽略此文本' }), '我的标题')
})

test('会话新建、上下文、重命名、私密切换、软删除与恢复均使用版本保护', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const authContext = auth('student-a', 'workspace-student-a')
  const created = await fixture.domain.createConversation({ authContext, input: {
    bookVersionId: 'version-a',
    pageNumber: 3,
    selection: { text: '白兔匆匆跑过', selectedBlockIds: ['block-1'] },
    citations: [{ pageNumber: 3, text: '白兔匆匆跑过' }],
    initialText: '为什么要跟着白兔？',
  } })
  assert.equal(created.title, '为什么要跟着白兔？')
  assert.equal(created.version, 1)
  assert.equal(created.context.pageNumber, 3)

  const renamed = await fixture.domain.renameConversation({ authContext, conversationId: created.id, title: '白兔的问题', expectedVersion: 1 })
  assert.equal(renamed.version, 2)
  await assert.rejects(
    fixture.domain.setPrivacyMode({ authContext, conversationId: created.id, privacyMode: 'private', expectedVersion: 1 }),
    (error) => error instanceof ConversationDomainError && error.code === 'VERSION_CONFLICT',
  )
  const privateConversation = await fixture.domain.setPrivacyMode({ authContext, conversationId: created.id, privacyMode: 'private', expectedVersion: 2 })
  assert.equal(privateConversation.privacyMode, 'private')
  const deleted = await fixture.domain.softDeleteConversation({ authContext, conversationId: created.id, expectedVersion: 3 })
  assert.equal(deleted.deleted, true)
  assert.equal((await fixture.domain.listOwnConversations({ authContext })).items.length, 0)
  assert.equal((await fixture.domain.listOwnConversations({ authContext, includeDeleted: true })).trash.length, 1)
  const restored = await fixture.domain.restoreConversation({ authContext, conversationId: created.id, expectedVersion: 4 })
  assert.equal(restored.deleted, false)
  const contextUpdated = await fixture.domain.updateConversationContext({
    authContext,
    conversationId: created.id,
    expectedVersion: 5,
    expectedContextVersion: 1,
    context: { pageNumber: 4, selection: { text: '新的选文' }, citations: [{ pageNumber: 4, text: '新的引用' }] },
  })
  assert.equal(contextUpdated.version, 6)
  assert.equal(contextUpdated.context.version, 2)
  assert.equal(contextUpdated.context.pageNumber, 4)
  assert.deepEqual(fixture.audit.map((entry) => entry.eventType), [
    'ai.conversation.created',
    'ai.conversation.renamed',
    'ai.conversation.privacy_changed',
    'ai.conversation.deleted',
    'ai.conversation.restored',
    'ai.conversation.context_updated',
  ])
})

test('跨租户和跨主体修改统一返回不存在，不能通过 conversationId 猜测资源', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const created = await fixture.domain.createConversation({
    authContext: auth('student-a', 'workspace-student-a'),
    input: { bookVersionId: 'version-a', initialText: '租户范围测试' },
  })
  await assert.rejects(
    fixture.domain.renameConversation({
      authContext: auth('outsider-b', 'workspace-b', 'org-b'),
      conversationId: created.id,
      title: '越界修改',
      expectedVersion: 1,
    }),
    (error) => error instanceof ConversationDomainError && error.code === 'RESOURCE_NOT_FOUND',
  )
})

test('权限端按班级学生形成三级索引，并支持模糊搜索与书籍 AND 或 OR 约束', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const studentAuth = auth('student-a', 'workspace-student-a')
  await fixture.domain.createConversation({ authContext: studentAuth, input: { bookVersionId: 'version-a', title: '白兔为什么迟到' } })
  await fixture.domain.createConversation({ authContext: studentAuth, input: { bookVersionId: 'version-b', title: '翡翠城在哪里' } })
  const teacherAuth = auth('teacher-a', 'workspace-class-a')
  const fuzzy = await fixture.domain.searchScopedConversationIndex({ authContext: teacherAuth, query: { text: '白兔' } })
  assert.equal(fuzzy.classes[0].students[0].conversations[0].title, '白兔为什么迟到')
  const orResult = await fixture.domain.searchScopedConversationIndex({ authContext: teacherAuth, query: { bookVersionIds: ['version-a', 'version-b'], bookMode: 'OR' } })
  assert.equal(orResult.classes[0].students[0].conversations.length, 2)
  const andResult = await fixture.domain.searchScopedConversationIndex({ authContext: teacherAuth, query: { bookVersionIds: ['version-a', 'version-b'], bookMode: 'AND' } })
  assert.equal(andResult.classes[0].students[0].conversations.length, 2)
})

test('普通会话按范围可读，私密会话需要授权，安全会话只返回证据最小上下文', async (t) => {
  const fixture = createFixture()
  t.after(() => fixture.close())
  const studentAuth = auth('student-a', 'workspace-student-a')
  const teacherAuth = auth('teacher-a', 'workspace-class-a')
  const normal = await fixture.domain.createConversation({ authContext: studentAuth, input: { bookVersionId: 'version-a', title: '普通会话' } })
  const now = timestamp
  for (const [id, role, content] of [['message-1', 'user', '第一条'], ['message-2', 'assistant', '第二条'], ['message-3', 'user', '第三条']]) {
    fixture.database.prepare(`INSERT INTO ai_messages
      (id, conversation_id, organization_id, organization_id_at_creation, actor_id_at_creation,
        role, content, privacy_json, danger_json, provider_attempts_json, created_at, updated_at, version)
      VALUES (?, ?, 'org-a', 'org-a', 'student-a', ?, ?, '{}', '{}', '[]', ?, ?, 1)`)
      .run(id, normal.id, role, content, now, now)
  }
  assert.equal((await fixture.domain.getConversation({ authContext: teacherAuth, ownerUserId: 'student-a', conversationId: normal.id, purpose: '教学跟进' })).messages.length, 3)
  await fixture.domain.setPrivacyMode({ authContext: studentAuth, conversationId: normal.id, privacyMode: 'private', expectedVersion: 1 })
  await assert.rejects(
    fixture.domain.getConversation({ authContext: teacherAuth, ownerUserId: 'student-a', conversationId: normal.id, purpose: '教学跟进' }),
    (error) => error.code === 'PRIVACY_CONSENT_REQUIRED',
  )

  fixture.database.prepare(`INSERT INTO safety_review_tasks
    (id, organization_id, organization_id_at_creation, actor_id_at_creation, conversation_id,
      initial_message_id, evidence_message_ids_json, trigger_reasons_json, privacy_json, danger_json,
      candidate_user_ids_json, candidate_catalog_ids_json, policy_snapshot_json, status,
      review_attempts, created_at, updated_at, version)
    VALUES ('review-1', 'org-a', 'org-a', 'student-a', ?, 'message-3', '["message-2"]', '[]', '{}', '{}', '[]', '[]', '{}', 'awaiting_human_acceptance', 1, ?, ?, 1)`)
    .run(normal.id, now, now)
  fixture.database.prepare(`INSERT INTO safety_review_evidence_state
    (review_task_id, organization_id, owner_user_id, conversation_id, evidence_generation, created_at, updated_at, version)
    VALUES ('review-1', 'org-a', 'student-a', ?, 0, ?, ?, 1)`)
    .run(normal.id, now, now)
  fixture.database.prepare(`INSERT INTO safety_review_evidence
    (review_task_id, ai_message_id, organization_id, owner_user_id, conversation_id, confidence, trigger, created_at, updated_at, version)
    VALUES ('review-1', 'message-2', 'org-a', 'student-a', ?, 0.9, 'qualified_message_count', ?, ?, 1)`)
    .run(normal.id, now, now)
  const minimum = await fixture.domain.getConversation({ authContext: teacherAuth, ownerUserId: 'student-a', conversationId: normal.id, purpose: '安全处置' })
  assert.equal(minimum.accessMode, 'safety_minimum_context')
  assert.deepEqual(minimum.messages.map((message) => message.id), ['message-2'])
})
