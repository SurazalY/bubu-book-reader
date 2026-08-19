// 独立验证方（非实现方）的对抗式守卫测试。
//
// 纪律：
// 1. 断言只来自主控给出的契约，不迁就实现；实现与契约不符时让测试红，不弱化断言。
// 2. 全部走真实 HTTP：app.listen(0) + 真实登录 Cookie + 真实 X-Workspace-Id。
//    绝不注入假的 authorize（server/domains/reading/sql.js:13 的默认值返回 true，
//    直接调领域函数等于什么都没测）。authorize: () => true 只出现在“造书”这类夹具搭建里，
//    不出现在任何被断言的读写路径上。
// 3. 契约没写清楚的行为（停用班、孤儿学生、非 class grantee 等）用“现状记录”用例把
//    真实行为固定下来并在报告里请主控裁决，不自行判定对错。
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { hashPassword } from '../../../server/auth/password.js'
import { createReadmateApplication } from '../../../server/app.js'
import { createReadingDomain } from '../../../server/domains/reading/catalog.js'
import { resolveCurrentBookVersionId } from '../../../server/domains/reading/visibility.js'

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function guardFixture() {
  const suffix = randomUUID().slice(0, 8)
  const id = (name) => `${name}-${suffix}`

  const organizationId = id('org-home')
  const foreignOrganizationId = id('org-foreign')
  const schoolCode = `home${suffix}`
  const foreignSchoolCode = `frgn${suffix}`
  const gradeOneId = 'primary:2023'
  const gradeTwoId = 'primary:2024'
  const foreignGradeId = 'primary:2023'

  const classAId = id('class-a')
  const classBId = id('class-b')
  const classCId = id('class-c')
  const classSpareId = id('class-spare')
  const classFrozenId = id('class-frozen')
  const foreignClassId = id('class-foreign')

  const wsAId = id('ws-class-a')
  const wsBId = id('ws-class-b')
  const wsCId = id('ws-class-c')
  const wsFrozenId = id('ws-class-frozen')
  const wsGradeOneId = id('ws-grade-one')
  const wsGradeTwoId = id('ws-grade-two')
  const wsSchoolId = id('ws-school')
  const wsPlatformId = id('ws-platform')
  const platformScopeId = id('platform-scope')
  const wsForeignClassId = id('ws-foreign-class')
  const wsForeignSchoolId = id('ws-foreign-school')

  const password = randomBytes(24).toString('base64url')
  const passwordHash = hashPassword(password)

  // 每个账号都用最小必要授权造出来，好让「谁应该被当成学生」这件事一眼可查。
  const people = {
    studentA: { id: id('student-a'), displayName: 'A 班学生' },
    studentB: { id: id('student-b'), displayName: 'B 班学生' },
    // 转班后旧工作空间授权残留：同时是 wsA / wsB 的成员，但班级成员关系只有 A 班。
    studentGhost: { id: id('student-ghost'), displayName: '双工作空间学生' },
    // 孤儿账号：有工作空间与 student 角色，但没有任何 class_memberships。
    studentOrphan: { id: id('student-orphan'), displayName: '无班级学生' },
    // 只被塞进校务工作空间当成员，但没有该空间内的任何角色分配。
    studentSchoolMember: { id: id('student-school-member'), displayName: '误入校务空间的学生' },
    // 停用班学生。
    studentFrozen: { id: id('student-frozen'), displayName: '停用班学生' },
    // 教师角色分配被 disable，同时保留 student 角色分配。
    studentDemoted: { id: id('student-demoted'), displayName: '被停权的班主任' },
    teacherA: { id: id('teacher-a'), displayName: 'A 班班主任' },
    teacherB: { id: id('teacher-b'), displayName: 'B 班班主任' },
    zeroWsTeacher: { id: id('teacher-zero'), displayName: '零班教师' },
    gradeLeadOne: { id: id('grade-lead-one'), displayName: '2023 届年级主任' },
    gradeAdminTwo: { id: id('grade-admin-two'), displayName: '2024 届年级主任' },
    gradeGroupLegacy: { id: id('grade-group-legacy'), displayName: '历史 grade_group 别名' },
    admin: { id: id('school-admin'), displayName: '校长' },
    platformOperator: { id: id('platform-operator'), displayName: '平台运维' },
    foreignStudent: { id: id('foreign-student'), displayName: '外校学生' },
    foreignAdmin: { id: id('foreign-admin'), displayName: '外校校长' },
    foreignTeacher: { id: id('foreign-teacher'), displayName: '外校教师' },
  }
  for (const [key, person] of Object.entries(people)) {
    person.username = `${key}-${suffix}`
    person.loginName = person.username
    person.organizationId = key.startsWith('foreign') ? foreignOrganizationId : organizationId
    person.schoolCode = key.startsWith('foreign') ? foreignSchoolCode : schoolCode
  }

  const membership = (userId, workspaceId, status = 'active') => ({
    id: randomUUID(), userId, workspaceId, status,
  })
  const role = (userId, workspaceId, roleCode, scopeType, scopeId, status = 'active') => ({
    id: randomUUID(),
    organizationId: userId.startsWith('foreign') || userId.includes('foreign') ? foreignOrganizationId : organizationId,
    userId,
    workspaceId,
    roleCode,
    scopeType,
    scopeId,
    status,
  })
  const classMember = (classId, userId, membershipRole = 'student') => ({
    id: randomUUID(), classId, userId, membershipRole,
  })

  return {
    suffix,
    password,
    people,
    schoolCode,
    foreignSchoolCode,
    organizationId,
    foreignOrganizationId,
    gradeOneId,
    gradeTwoId,
    classAId,
    classBId,
    classCId,
    classSpareId,
    classFrozenId,
    foreignClassId,
    wsAId,
    wsBId,
    wsCId,
    wsFrozenId,
    wsGradeOneId,
    wsGradeTwoId,
    wsSchoolId,
    wsPlatformId,
    wsForeignClassId,
    wsForeignSchoolId,
    seed: {
      organizations: [
        { id: organizationId, name: '守卫测试本校', schoolCode },
        { id: foreignOrganizationId, name: '守卫测试外校', schoolCode: foreignSchoolCode },
      ],
      users: Object.values(people).map(({ id: userId, organizationId: org, username, displayName }) => ({
        id: userId, organizationId: org, username, displayName,
      })),
      workspaces: [
        { id: wsAId, organizationId, code: 'class-teacher', name: 'A 班', scopeType: 'class', scopeId: classAId },
        { id: wsBId, organizationId, code: 'class-teacher', name: 'B 班', scopeType: 'class', scopeId: classBId },
        { id: wsCId, organizationId, code: 'class-teacher', name: 'C 班', scopeType: 'class', scopeId: classCId },
        { id: wsFrozenId, organizationId, code: 'class-teacher', name: '停用班', scopeType: 'class', scopeId: classFrozenId },
        { id: wsGradeOneId, organizationId, code: 'grade-group', name: '一年级组', scopeType: 'grade', scopeId: gradeOneId },
        { id: wsGradeTwoId, organizationId, code: 'grade-group', name: '二年级组', scopeType: 'grade', scopeId: gradeTwoId },
        { id: wsSchoolId, organizationId, code: 'school-admin', name: '校务', scopeType: 'school', scopeId: organizationId },
        { id: wsPlatformId, organizationId, code: 'platform-ops', name: '平台', scopeType: 'platform', scopeId: platformScopeId },
        { id: wsForeignClassId, organizationId: foreignOrganizationId, code: 'class-teacher', name: '外校班', scopeType: 'class', scopeId: foreignClassId },
        { id: wsForeignSchoolId, organizationId: foreignOrganizationId, code: 'school-admin', name: '外校校务', scopeType: 'school', scopeId: foreignOrganizationId },
      ],
      classes: [
        { id: classAId, organizationId, gradeId: gradeOneId, name: '一年级 A 班', stage: 'primary', entryYear: 2023, classNumber: 1 },
        { id: classBId, organizationId, gradeId: gradeOneId, name: '一年级 B 班', stage: 'primary', entryYear: 2023, classNumber: 2 },
        { id: classCId, organizationId, gradeId: gradeTwoId, name: '二年级 C 班', stage: 'primary', entryYear: 2024, classNumber: 1 },
        { id: classSpareId, organizationId, gradeId: gradeTwoId, name: '待删除空班', stage: 'primary', entryYear: 2024, classNumber: 2 },
        // 触发器不允许「active 成员关系挂在 disabled 班级上」，所以停用班先建成 active，
        // 由需要它的用例在导入完成后自己改状态（模拟运行期解散班级）。
        { id: classFrozenId, organizationId, gradeId: gradeOneId, name: '待停用班', stage: 'primary', entryYear: 2023, classNumber: 3 },
        { id: foreignClassId, organizationId: foreignOrganizationId, gradeId: foreignGradeId, name: '外校班级', stage: 'primary', entryYear: 2023, classNumber: 1 },
      ],
      workspaceMemberships: [
        membership(people.studentA.id, wsAId),
        membership(people.studentB.id, wsBId),
        membership(people.studentGhost.id, wsAId),
        membership(people.studentGhost.id, wsBId),
        membership(people.studentOrphan.id, wsAId),
        membership(people.studentSchoolMember.id, wsAId),
        membership(people.studentSchoolMember.id, wsSchoolId),
        membership(people.studentFrozen.id, wsFrozenId),
        membership(people.studentDemoted.id, wsAId),
        membership(people.teacherA.id, wsAId),
        membership(people.teacherB.id, wsBId),
        membership(people.gradeLeadOne.id, wsGradeOneId),
        membership(people.gradeAdminTwo.id, wsGradeTwoId),
        membership(people.gradeGroupLegacy.id, wsGradeOneId),
        membership(people.admin.id, wsSchoolId),
        membership(people.platformOperator.id, wsPlatformId),
        membership(people.foreignStudent.id, wsForeignClassId),
        membership(people.foreignAdmin.id, wsForeignSchoolId),
        membership(people.foreignTeacher.id, wsForeignClassId),
      ],
      classMemberships: [
        classMember(classAId, people.studentA.id),
        classMember(classBId, people.studentB.id),
        classMember(classAId, people.studentGhost.id),
        classMember(classAId, people.studentSchoolMember.id),
        classMember(classFrozenId, people.studentFrozen.id),
        classMember(classAId, people.studentDemoted.id),
        classMember(classAId, people.teacherA.id, 'teacher'),
        classMember(classBId, people.teacherB.id, 'teacher'),
        classMember(foreignClassId, people.foreignStudent.id),
        classMember(foreignClassId, people.foreignTeacher.id, 'teacher'),
      ],
      roleAssignments: [
        role(people.studentA.id, wsAId, 'student', 'class', classAId),
        role(people.studentB.id, wsBId, 'student', 'class', classBId),
        role(people.studentGhost.id, wsAId, 'student', 'class', classAId),
        role(people.studentGhost.id, wsBId, 'student', 'class', classBId),
        role(people.studentOrphan.id, wsAId, 'student', 'class', classAId),
        role(people.studentSchoolMember.id, wsAId, 'student', 'class', classAId),
        role(people.studentFrozen.id, wsFrozenId, 'student', 'class', classFrozenId),
        role(people.studentDemoted.id, wsAId, 'student', 'class', classAId),
        // 停权后只保留学生身份。不得留下残缺 teacher 角色行，否则 GET /classes 的 teacherCount 会 500。
        role(people.teacherA.id, wsAId, 'class_teacher', 'class', classAId),
        role(people.teacherB.id, wsBId, 'class_teacher', 'class', classBId),
        role(people.gradeLeadOne.id, wsGradeOneId, 'grade_manager', 'grade', gradeOneId),
        role(people.gradeAdminTwo.id, wsGradeTwoId, 'grade_admin', 'grade', gradeTwoId),
        role(people.gradeGroupLegacy.id, wsGradeOneId, 'grade_group', 'grade', gradeOneId),
        role(people.admin.id, wsSchoolId, 'school_admin', 'school', organizationId),
        role(people.platformOperator.id, wsPlatformId, 'platform_operator', 'platform', platformScopeId),
        {
          id: randomUUID(),
          organizationId: foreignOrganizationId,
          userId: people.foreignStudent.id,
          workspaceId: wsForeignClassId,
          roleCode: 'student',
          scopeType: 'class',
          scopeId: foreignClassId,
          status: 'active',
        },
        {
          id: randomUUID(),
          organizationId: foreignOrganizationId,
          userId: people.foreignAdmin.id,
          workspaceId: wsForeignSchoolId,
          roleCode: 'school_admin',
          scopeType: 'school',
          scopeId: foreignOrganizationId,
          status: 'active',
        },
        {
          id: randomUUID(),
          organizationId: foreignOrganizationId,
          userId: people.foreignTeacher.id,
          workspaceId: wsForeignClassId,
          roleCode: 'teacher',
          scopeType: 'class',
          scopeId: foreignClassId,
          status: 'active',
        },
      ],
      credentials: Object.values(people).map(({ id: userId }) => ({
        id: randomUUID(), userId, passwordHash,
      })),
    },
  }
}

// ---------------------------------------------------------------------------
// HTTP 客户端
// ---------------------------------------------------------------------------

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

async function request(baseUrl, jar, path, options = {}) {
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
  const raw = await response.text()
  let payload = null
  try {
    payload = raw ? JSON.parse(raw) : null
  } catch {
    payload = { raw }
  }
  return { status: response.status, payload }
}

async function login(baseUrl, fixture, person) {
  const jar = new Map()
  const response = await request(baseUrl, jar, '/auth/login', {
    method: 'POST',
    idempotencyKey: `login-${person.id}-${randomUUID()}`,
    body: {
      loginName: person.loginName ?? person.username,
      password: fixture.password,
    },
  })
  assert.equal(response.status, 200, JSON.stringify(response.payload))
  return jar
}

function grantCurrentBookToClass(database, {
  bookId,
  classId,
  organizationId,
  actorId,
  granteeType = 'class',
}) {
  if (!bookId || !classId || !organizationId || !actorId) {
    throw new Error('grantCurrentBookToClass 不得推断组织/班级，必须显式传入 bookId/classId/organizationId/actorId')
  }
  const bookVersionId = resolveCurrentBookVersionId(database, { bookId, organizationId })
  assert.ok(bookVersionId, `grantCurrentBookToClass 需要当前版本：bookId=${bookId}`)
  const now = new Date().toISOString()
  try {
    database.prepare(`
      INSERT INTO book_access_grants (
        id, book_version_id, grantee_type, grantee_id,
        organization_id_at_creation, actor_id_at_creation, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(randomUUID(), bookVersionId, granteeType, classId, organizationId, actorId, now, now)
  } catch (error) {
    if (/UNIQUE/i.test(error.message)) throw error
    throw error
  }
  return bookVersionId
}

function createVerifiedTeacherInClass(application, {
  organizationId,
  classId,
  workspaceId,
  passwordHash,
  suffix = randomUUID().slice(0, 8),
}) {
  if (!organizationId || !classId || !workspaceId || !passwordHash) {
    throw new Error('createVerifiedTeacherInClass 不得推断组织/班级，必须显式传入')
  }
  const userId = `teacher-extra-${suffix}`
  const username = `textra${suffix}`
  application.identity.service.importSeed({
    users: [{ id: userId, organizationId, username, loginName: username, displayName: '补齐三元组教师' }],
    credentials: [{ id: randomUUID(), userId, passwordHash }],
    classMemberships: [{ id: randomUUID(), classId, userId, membershipRole: 'teacher' }],
    workspaceMemberships: [{ id: randomUUID(), userId, workspaceId }],
    roleAssignments: [{
      id: randomUUID(),
      organizationId,
      userId,
      workspaceId,
      roleCode: 'teacher',
      scopeType: 'class',
      scopeId: classId,
    }],
  })
  return { id: userId, username, loginName: username, organizationId }
}

function createPendingStudentRegistration(database, {
  organizationId,
  expectedRole = 'student',
  scopeType,
  scopeId,
  createdByUserId,
  createdWorkspaceId,
  rawToken = randomBytes(32).toString('base64url'),
}) {
  if (!organizationId || !scopeType || !scopeId || !createdByUserId || !createdWorkspaceId) {
    throw new Error('createPendingStudentRegistration 不得推断组织/班级')
  }
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const secretHash = createHash('sha256').update(rawToken, 'utf8').digest('hex')
  const id = randomUUID()
  database.prepare(`
    INSERT INTO registration_credentials (
      id, organization_id, secret_hash, expected_role, scope_type, scope_id,
      expires_at, max_uses, successful_use_count, revoked_at, revoked_by, revoked_reason,
      created_by_user_id, created_workspace_id, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, NULL, NULL, NULL, ?, ?, ?, ?, 1)
  `).run(
    id, organizationId, secretHash, expectedRole, scopeType, scopeId,
    expiresAt, createdByUserId, createdWorkspaceId, now, now,
  )
  return { id, rawToken, secretHash }
}

function seedZeroWsTeacherEvidence(database, fixture) {
  const week = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const now = new Date().toISOString()
  const credential = createPendingStudentRegistration(database, {
    organizationId: fixture.organizationId,
    expectedRole: 'teacher',
    scopeType: 'school',
    scopeId: fixture.organizationId,
    createdByUserId: fixture.people.admin.id,
    createdWorkspaceId: fixture.wsSchoolId,
  })
  database.prepare(`
    UPDATE registration_credentials
    SET successful_use_count = 1, expires_at = ?, updated_at = ?
    WHERE id = ?
  `).run(week, now, credential.id)
  database.prepare(`
    INSERT INTO registration_credential_uses (
      id, credential_id, organization_id, expected_role, created_user_id, request_id, used_at
    ) VALUES (?, ?, ?, 'teacher', ?, ?, ?)
  `).run(
    randomUUID(),
    credential.id,
    fixture.organizationId,
    fixture.people.zeroWsTeacher.id,
    `t87-${randomUUID()}`,
    now,
  )
  return credential
}

// ---------------------------------------------------------------------------
// 造书夹具（authorize: () => true 只用于搭台，不用于任何被断言的路径）
// ---------------------------------------------------------------------------

function pages(prefix) {
  return [1, 2].map((pageNo) => ({
    pageNo,
    width: 1024,
    height: 768,
    textContent: `${prefix} 第 ${pageNo} 页正文`,
    blocks: [{
      blockKey: `page-${pageNo}-paragraph-1`,
      paragraphId: `paragraph-${pageNo}`,
      textContent: `${prefix} 第 ${pageNo} 页正文`,
      charStart: 0,
      charEnd: 10,
      x: 80,
      y: 100,
      width: 760,
      height: 120,
    }],
  }))
}

async function createBook(application, fixture, asset, {
  title,
  published = true,
  archived = false,
  organizationId = fixture.organizationId,
  actorId = fixture.people.admin.id,
  workspaceId = fixture.wsSchoolId,
}) {
  const reading = createReadingDomain({
    db: application.database,
    actor: { id: actorId },
    workspace: { id: workspaceId, organizationId },
    authorize: async () => true,
    audit: async () => undefined,
    assetMetadataVerifier: async ({ storageKey }) => {
      if (storageKey !== asset.storageKey) throw new Error('未登记的测试资产键')
      return asset
    },
    idFactory: randomUUID,
    now: () => new Date(),
  })
  const created = await reading.createBookVersion({
    title,
    label: `guard-${randomUUID()}`,
    sourceFormat: 'text',
    assets: [{ ...asset, assetType: 'source_text' }],
    pages: pages(title),
  })
  if (published || archived) await reading.publishBook(created.bookId)
  if (archived) await reading.archiveBook(created.bookId)
  const assetRow = application.database.prepare(
    "SELECT id FROM book_assets WHERE book_version_id = ? AND asset_type = 'source_text'",
  ).get(created.versionId)
  return { ...created, assetId: assetRow.id, title }
}

// 直接插一个更晚创建的版本 + 页 + 资产，制造「旧版本 / 当前版本」分叉。
function appendLaterVersion(database, asset, { bookId, organizationId, actorId, offsetMs = 60_000 }) {
  const versionId = `later-version-${randomUUID()}`
  const at = new Date(Date.now() + offsetMs).toISOString()
  database.prepare(`
    INSERT INTO book_versions (
      id, book_id, organization_id_at_creation, actor_id_at_creation, label, source_format,
      page_count, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, 'text', 2, ?, ?, 1)
  `).run(versionId, bookId, organizationId, actorId, `later-${randomUUID()}`, at, at)
  for (const pageNo of [1, 2]) {
    const pageId = randomUUID()
    const text = `新版本第 ${pageNo} 页`
    database.prepare(`
      INSERT INTO book_pages (
        id, book_version_id, page_no, text_content, width, height, raw_text, normalized_text,
        created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, 1024, 768, ?, ?, ?, ?, 1)
    `).run(pageId, versionId, pageNo, text, text, text, at, at)
    // AI 入口的证据块来自 book_blocks；不插块的话模型请求的 sources 会是空数组，
    // 断言就会被「模型不可用」这类噪声掩盖掉真正要测的可见性行为。
    database.prepare(`
      INSERT INTO book_blocks (
        id, page_id, block_key, paragraph_id, text_content, char_start, char_end,
        x, y, width, height, raw_text, normalized_text,
        created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, 0, ?, 80, 100, 760, 120, ?, ?, ?, ?, 1)
    `).run(
      randomUUID(), pageId, `page-${pageNo}-paragraph-1`, `paragraph-${pageNo}`,
      text, text.length, text, text, at, at,
    )
  }
  const assetId = randomUUID()
  database.prepare(`
    INSERT INTO book_assets (
      id, book_version_id, page_id, asset_type, storage_key, usage_label, mime_type,
      size_bytes, sha256, created_at, updated_at, version
    ) VALUES (?, ?, NULL, 'source_text', ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(assetId, versionId, asset.storageKey, asset.usageLabel, asset.mimeType, asset.sizeBytes, asset.sha256, at, at)
  return { versionId, assetId }
}

function stubModelProvider() {
  const requests = []
  return {
    requests,
    provider: {
      listCandidates: async () => [{ id: 'guard-model' }],
      generate: async ({ request: modelRequest }) => {
        requests.push(modelRequest)
        return {
          answer: '这段正文讲了测试书的内容。',
          responseType: 'answer',
          citations: [{
            evidenceId: modelRequest.sources[0].evidenceId,
            pageNumber: modelRequest.sources[0].pageNumber,
          }],
          privacy: { detected: false, confidence: 0, category: 'none', urgency: 'none' },
          danger: { detected: false, confidence: 0, category: 'none', urgency: 'none' },
          implicatedCandidates: [],
          usage: { inputTokens: 12, outputTokens: 8, cachedTokens: 0, costMicros: 16 },
          spoilerRisk: false,
        }
      },
    },
  }
}

async function startHarness(t) {
  const directory = mkdtempSync(join(tmpdir(), 'readmate-visibility-guard-'))
  const databasePath = join(directory, 'guard.sqlite')
  const publicAssetDirectory = join(directory, 'public')
  const asset = {
    storageKey: 'books/guard/source.txt',
    usageLabel: 'INTERNAL PILOT ONLY',
    mimeType: 'text/plain',
    bytes: Buffer.from('班级可见范围守卫测试用书籍源资产', 'utf8'),
  }
  asset.sizeBytes = asset.bytes.length
  asset.sha256 = createHash('sha256').update(asset.bytes).digest('hex')
  mkdirSync(join(publicAssetDirectory, 'books', 'guard'), { recursive: true })
  writeFileSync(join(publicAssetDirectory, asset.storageKey), asset.bytes)

  const fixture = guardFixture()
  const model = stubModelProvider()
  const application = createReadmateApplication({
    databasePath,
    sessionSecret: randomBytes(48).toString('base64url'),
    cookieSecure: false,
    serveStatic: false,
    publicAssetDirectory,
    modelProvider: model.provider,
  })
  application.identity.service.importSeed(fixture.seed)
  seedZeroWsTeacherEvidence(application.database, fixture)
  const server = await new Promise((resolve) => {
    const listener = application.app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    application.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`
  return {
    application,
    database: application.database,
    fixture,
    asset,
    model,
    baseUrl,
    createBook: (options) => createBook(application, fixture, asset, options),
    appendLaterVersion: (options) => appendLaterVersion(application.database, asset, options),
    login: (person) => login(baseUrl, fixture, person),
    get: (jar, path, workspaceId) => request(baseUrl, jar, path, { workspaceId }),
    grantCurrentBookToClass: (options) => grantCurrentBookToClass(application.database, options),
    putShelf: (jar, workspaceId, classId, bookId, key) => putShelf(baseUrl, jar, workspaceId, classId, bookId, key),
    deleteShelf: (jar, workspaceId, classId, bookId, key) => deleteShelf(baseUrl, jar, workspaceId, classId, bookId, key),
    createVerifiedTeacherInClass: (options) => createVerifiedTeacherInClass(application, {
      passwordHash: hashPassword(fixture.password),
      ...options,
    }),
  }
}

// ---------------------------------------------------------------------------
// 共用探针
// ---------------------------------------------------------------------------

// 契约表里学生必须表现为「书不存在」的五个入口。
async function probeAllEntries(baseUrl, jar, workspaceId, book) {
  const list = await request(baseUrl, jar, '/books', { workspaceId })
  const page = await request(baseUrl, jar, `/books/${book.bookId}/pages/1`, { workspaceId })
  const asset = await request(baseUrl, jar, `/books/assets/${book.assetId}`, { workspaceId })
  const ai = await request(baseUrl, jar, '/ai/messages', {
    method: 'POST',
    workspaceId,
    idempotencyKey: `ai-${book.bookId}-${randomUUID()}`,
    body: {
      bookId: book.bookId,
      currentPageNo: 1,
      readRangeVersion: page.payload?.data?.readRangeVersion ?? 'read-range-v2:unavailable',
      text: '这一页讲了什么？',
      safeMode: true,
    },
  })
  const library = await request(baseUrl, jar, '/reading/library', { workspaceId })
  return {
    list,
    page,
    asset,
    ai,
    library,
    listed: (list.payload?.data?.items ?? []).some((item) => item.id === book.bookId),
    shelved: (library.payload?.data?.shelf ?? []).some((entry) => entry.bookId === book.bookId),
  }
}

// 契约核心：不可见一律表现为「书不存在」——404 RESOURCE_NOT_FOUND，绝不 403，也不得出现在任何列表里。
function assertInvisible(probe, label) {
  assert.equal(probe.listed, false, `${label}：不可见书不得出现在 GET /books 列表`)
  assert.equal(probe.page.status, 404, `${label}：书页必须 404，实际 ${probe.page.status} ${JSON.stringify(probe.page.payload)}`)
  assert.equal(probe.page.payload.error.code, 'RESOURCE_NOT_FOUND', `${label}：书页错误码`)
  assert.equal(probe.asset.status, 404, `${label}：资产必须 404，实际 ${probe.asset.status} ${JSON.stringify(probe.asset.payload)}`)
  assert.equal(probe.asset.payload.error.code, 'RESOURCE_NOT_FOUND', `${label}：资产错误码`)
  assert.equal(probe.ai.status, 404, `${label}：AI 引用必须 404，实际 ${probe.ai.status} ${JSON.stringify(probe.ai.payload)}`)
  assert.equal(probe.ai.payload.error.code, 'RESOURCE_NOT_FOUND', `${label}：AI 错误码`)
  assert.equal(probe.library.status, 200, `${label}：书架接口本身应正常返回`)
  assert.equal(probe.shelved, false, `${label}：不可见书不得带着书名与封面出现在书架上`)
}

function assertVisible(probe, label) {
  assert.equal(probe.listed, true, `${label}：可见书必须出现在 GET /books 列表`)
  assert.equal(probe.page.status, 200, `${label}：书页应 200，实际 ${probe.page.status} ${JSON.stringify(probe.page.payload)}`)
  assert.equal(probe.asset.status, 200, `${label}：资产应 200，实际 ${probe.asset.status} ${JSON.stringify(probe.asset.payload)}`)
  assert.equal(probe.ai.status, 200, `${label}：AI 引用应 200，实际 ${probe.ai.status} ${JSON.stringify(probe.ai.payload)}`)
  assert.equal(probe.shelved, true, `${label}：可见书必须在书架上`)
}

async function setVisibility(baseUrl, jar, workspaceId, bookId, body, key = randomUUID()) {
  return request(baseUrl, jar, `/books/${bookId}/visibility`, {
    method: 'PUT',
    workspaceId,
    idempotencyKey: `guard-visibility-${bookId}-${key}`,
    body,
  })
}

async function putShelf(baseUrl, jar, workspaceId, classId, bookId, key = randomUUID()) {
  return request(baseUrl, jar, `/classes/${classId}/shelf/${bookId}`, {
    method: 'PUT',
    workspaceId,
    idempotencyKey: `guard-shelf-put-${bookId}-${key}`,
    body: {},
  })
}

async function deleteShelf(baseUrl, jar, workspaceId, classId, bookId, key = randomUUID()) {
  return request(baseUrl, jar, `/classes/${classId}/shelf/${bookId}`, {
    method: 'DELETE',
    workspaceId,
    idempotencyKey: `guard-shelf-del-${bookId}-${key}`,
  })
}

function shelfGrantAuditCount(database, bookId) {
  return database.prepare(
    "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'book.shelf.granted' AND resource_id = ?",
  ).get(bookId).count
}

function grantRows(database, bookId) {
  return database.prepare(`
    SELECT grant_row.grantee_type AS granteeType, grant_row.grantee_id AS granteeId,
      grant_row.book_version_id AS bookVersionId
    FROM book_access_grants AS grant_row
    JOIN book_versions AS version ON version.id = grant_row.book_version_id
    WHERE version.book_id = ?
    ORDER BY grant_row.grantee_id
  `).all(bookId)
}

function auditCount(database, bookId) {
  return database.prepare(
    "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'book.visibility.updated' AND resource_id = ?",
  ).get(bookId).count
}

// ===========================================================================
// 攻击面一：身份与作用域伪造
// ===========================================================================

test('【攻击面 1.1/1.2】学生伪造 X-Workspace-Id 不能改变班级可见范围，且换头失败时不泄露书是否存在', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl } = harness
  const restricted = await harness.createBook({ title: '只给 B 班的书' })
  const ungranted = await harness.createBook({ title: '无 grant 的书' })
  const grantedToA = await harness.createBook({ title: '显式投放 A 班的书' })

  harness.grantCurrentBookToClass({
    bookId: restricted.bookId,
    classId: fixture.classBId,
    organizationId: fixture.organizationId,
    actorId: fixture.people.teacherB.id,
  })
  harness.grantCurrentBookToClass({
    bookId: grantedToA.bookId,
    classId: fixture.classAId,
    organizationId: fixture.organizationId,
    actorId: fixture.people.teacherA.id,
  })

  // 攻击 A：studentGhost 同时是 wsA 与 wsB 的成员，且在两个空间都有 student 角色分配
  //（模拟转班后旧授权残留）。班级成员关系只有 A 班，换头不得让他读到只 grant 他班的书。
  const ghostJar = await harness.login(fixture.people.studentGhost)
  assertInvisible(await probeAllEntries(baseUrl, ghostJar, fixture.wsAId, restricted), '双空间学生用本班头读只 grant 他班的书')
  assertInvisible(await probeAllEntries(baseUrl, ghostJar, fixture.wsBId, restricted), '双空间学生伪造 B 班头读只 grant 他班的书')
  assertInvisible(await probeAllEntries(baseUrl, ghostJar, fixture.wsBId, ungranted), '双空间学生读无 grant 书（原因：无 grant）')
  assertVisible(await probeAllEntries(baseUrl, ghostJar, fixture.wsBId, grantedToA), '双空间学生用 B 班头仍只能读本班 grant')

  // 攻击 B：换到自己不是成员的工作空间（别班 / 校务 / 平台）——必须挡在工作空间解析处，
  // 且对「存在的书」与「不存在的书」给出完全一致的响应，不能借错误码差异探测存在性。
  const studentAJar = await harness.login(fixture.people.studentA)
  for (const [label, workspaceId] of [
    ['别班工作空间', fixture.wsBId],
    ['校务工作空间', fixture.wsSchoolId],
    ['平台工作空间', fixture.wsPlatformId],
    ['外校工作空间', fixture.wsForeignClassId],
    ['伪造的工作空间 id', `not-a-workspace-${randomUUID()}`],
  ]) {
    const real = await request(baseUrl, studentAJar, `/books/${grantedToA.bookId}/pages/1`, { workspaceId })
    const fake = await request(baseUrl, studentAJar, `/books/missing-${randomUUID()}/pages/1`, { workspaceId })
    assert.equal(real.status, fake.status, `${label}：真实书与不存在的书状态码必须一致`)
    assert.equal(
      real.payload.error.code,
      fake.payload.error.code,
      `${label}：真实书与不存在的书错误码必须一致`,
    )
    assert.equal(real.payload.error.message, fake.payload.error.message, `${label}：文案也必须一致`)
    // 记录实际口径：换到非本人成员的工作空间时，请求在 requireWorkspace 处就被拒（403
    // PERMISSION_DENIED），根本没走到书籍查询。这与「学生在自己工作空间里读不可见书必须 404」
    // 是两类失败：前者是工作空间访问被拒，且对存在/不存在的书完全同码同文案，不构成存在性泄露。
    assert.equal(real.status, 403, `${label}：期望在工作空间解析处被拒，实际 ${real.status}`)
    assert.equal(real.payload.error.code, 'PERMISSION_DENIED', `${label}：错误码`)
  }

  // 攻击 C：被塞进校务工作空间当成员、但该空间内没有任何角色分配的学生，
  // 不得因此拿到管理角色的「看全部书」待遇。
  const schoolMemberJar = await harness.login(fixture.people.studentSchoolMember)
  const escalated = await request(baseUrl, schoolMemberJar, '/books', { workspaceId: fixture.wsSchoolId })
  const escalatedIds = (escalated.payload?.data?.items ?? []).map((item) => item.id)
  assert.equal(
    escalatedIds.includes(restricted.bookId),
    false,
    `仅有工作空间成员关系、无角色分配的学生不得看到受限书（实际 ${escalated.status} ${JSON.stringify(escalated.payload)}）`,
  )
  // 用自己班的工作空间读同一本受限书，仍然必须是「书不存在」。
  assertInvisible(await probeAllEntries(baseUrl, schoolMemberJar, fixture.wsAId, restricted), '校务空间成员学生回到本班')
})

test('【攻击面 1.3】孤儿学生（无任何 class_memberships）：无 grant 不可见；只 grant 本班仍不可见（原因：无 class_memberships）', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl } = harness
  const restrictedToA = await harness.createBook({ title: '限定 A 班的书' })
  const ungranted = await harness.createBook({ title: '无 grant 的书' })

  const teacherJar = await harness.login(fixture.people.teacherA)
  const applied = await harness.putShelf(teacherJar, fixture.wsAId, fixture.classAId, restrictedToA.bookId)
  assert.equal(applied.status, 200, JSON.stringify(applied.payload))

  // 孤儿账号的工作空间与 student 角色都指向 A 班，但没有 class_memberships 行。
  // 班级只认 class_memberships，因此他不算 A 班学生。
  const orphanJar = await harness.login(fixture.people.studentOrphan)
  assertInvisible(await probeAllEntries(baseUrl, orphanJar, fixture.wsAId, ungranted), '孤儿学生读无 grant 书（原因：无 grant）')
  assertInvisible(await probeAllEntries(baseUrl, orphanJar, fixture.wsAId, restrictedToA), '孤儿学生读本班 grant 书（原因：无 class_memberships）')

  const studentAJar = await harness.login(fixture.people.studentA)
  assertVisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, restrictedToA), 'A 班学生读本班 grant 书')
})

test('【攻击面 1.4·现状记录】班级被停用后，该班 grant 仍在但学生不可见（原因：班级已停用）', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const restrictedToA = await harness.createBook({ title: '限定 A 班后停用班级的书' })
  const ungranted = await harness.createBook({ title: '无 grant 的书' })

  const teacherJar = await harness.login(fixture.people.teacherA)
  const applied = await harness.putShelf(teacherJar, fixture.wsAId, fixture.classAId, restrictedToA.bookId)
  assert.equal(applied.status, 200, JSON.stringify(applied.payload))

  const studentAJar = await harness.login(fixture.people.studentA)
  assertVisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, restrictedToA), '停用前 A 班学生')

  database.prepare("UPDATE classes SET status = 'disabled' WHERE id = ?").run(fixture.classAId)
  assert.equal(grantRows(database, restrictedToA.bookId).length, 1, 'grants 行不应被班级停用连带删除')

  assertInvisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, restrictedToA), '停用班学生读本班 grant 书（原因：班级已停用）')
  assertInvisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, ungranted), '停用班学生读无 grant 书（原因：无 grant）')

  const adminJar = await harness.login(fixture.people.admin)
  const adminList = await request(baseUrl, adminJar, '/books', { workspaceId: fixture.wsSchoolId })
  assert.equal(adminList.status, 200, JSON.stringify(adminList.payload))
  assert.equal(
    (adminList.payload.data.items ?? []).some((item) => item.id === restrictedToA.bookId),
    false,
    '校长不再作为书库管理正例，不得因 school_admin 看到该书',
  )

  const snapshot = await request(baseUrl, adminJar, `/books/${restrictedToA.bookId}/visibility`, {
    workspaceId: fixture.wsSchoolId,
  })
  assert.equal(snapshot.status, 404, JSON.stringify(snapshot.payload))
  assert.equal(snapshot.payload.error.code, 'RESOURCE_NOT_FOUND')
  const classes = await request(baseUrl, adminJar, '/classes', { workspaceId: fixture.wsSchoolId })
  assert.equal(classes.status, 200, JSON.stringify(classes.payload))
  const disabledClass = (classes.payload.data.items ?? []).find((entry) => entry.id === fixture.classAId)
  assert.ok(disabledClass, '校长必须仍能看到停用班，才能走恢复（14.2 班级生命周期）')
  assert.equal(disabledClass.status, 'disabled')
  const regrant = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, restrictedToA.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId],
  })
  assert.equal(regrant.status, 404, JSON.stringify(regrant.payload))
  assert.equal(regrant.payload.error.code, 'RESOURCE_NOT_FOUND')
  assert.equal(grantRows(database, restrictedToA.bookId).length, 1, '旧 visibility 不得清掉停用班 grant')

  const reopened = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, restrictedToA.bookId, {
    scope: 'organization',
  })
  assert.equal(reopened.status, 404, JSON.stringify(reopened.payload))
  assert.equal(grantRows(database, restrictedToA.bookId).length, 1, '旧 organization 逃生通道已废止，不得清空 grants')
  assertInvisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, restrictedToA), 'organization 404 后学生仍不可见')
})

test('【攻击面 1.4·现状记录】学生本身就在停用班里：无 grant 不可见；只 grant 他班也不可见', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const restrictedToB = await harness.createBook({ title: '只 grant B 班的书' })
  const ungranted = await harness.createBook({ title: '无 grant 的书' })

  database.prepare("UPDATE classes SET status = 'disabled' WHERE id = ?").run(fixture.classFrozenId)

  const seedGrants = createReadingDomain({
    db: database,
    actor: { id: fixture.people.admin.id },
    workspace: { id: fixture.wsSchoolId, organizationId: fixture.organizationId },
    authorize: async () => true,
    audit: async () => undefined,
    idFactory: randomUUID,
    now: () => new Date(),
  })
  await assert.rejects(
    seedGrants.setBookVisibility({
      bookId: restrictedToB.bookId,
      scope: 'classes',
      classIds: [fixture.classFrozenId],
    }),
    (error) => error.code === 'VALIDATION_FAILED' || error.code === 'PERMISSION_DENIED',
    '全量 setBookVisibility 已废止，不得再写停用班 grants',
  )

  const frozenJar = await harness.login(fixture.people.studentFrozen)
  assertInvisible(await probeAllEntries(baseUrl, frozenJar, fixture.wsFrozenId, ungranted), '停用班学生读无 grant 书（原因：无 grant）')

  harness.grantCurrentBookToClass({
    bookId: restrictedToB.bookId,
    classId: fixture.classBId,
    organizationId: fixture.organizationId,
    actorId: fixture.people.teacherB.id,
  })
  assertInvisible(
    await probeAllEntries(baseUrl, frozenJar, fixture.wsFrozenId, restrictedToB),
    '停用班学生读只 grant 他班的书（原因：只 grant 他班）',
  )
})

test('【攻击面 1.5/1.6】教师三元组可绕过 class grant 但不能看 draft；校长/年级主任/grade_group 不是书库正例；停权教师 fail closed', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl } = harness
  const restricted = await harness.createBook({ title: '只给 B 班的书' })
  const draft = await harness.createBook({ title: '草稿书', published: false })

  harness.grantCurrentBookToClass({
    bookId: restricted.bookId,
    classId: fixture.classBId,
    organizationId: fixture.organizationId,
    actorId: fixture.people.teacherB.id,
  })

  const teacherJar = await harness.login(fixture.people.teacherA)
  const teacherList = await request(baseUrl, teacherJar, '/books', { workspaceId: fixture.wsAId })
  assert.equal(teacherList.status, 200, JSON.stringify(teacherList.payload))
  assert.ok(
    teacherList.payload.data.items.some((item) => item.id === restricted.bookId),
    '完整教师三元组必须看到 published 且只 grant 他班的书（bypassClassGrants）',
  )
  const teacherDrafts = await request(baseUrl, teacherJar, '/books?status=draft', { workspaceId: fixture.wsAId })
  assert.equal(teacherDrafts.status, 200, JSON.stringify(teacherDrafts.payload))
  assert.equal(
    teacherDrafts.payload.data.items.some((item) => item.id === draft.bookId),
    false,
    '教师 allowUnpublished=false，不得列 draft',
  )
  const teacherDraftAsset = await request(baseUrl, teacherJar, `/books/assets/${draft.assetId}`, { workspaceId: fixture.wsAId })
  assert.equal(teacherDraftAsset.status, 404, '教师不得取草稿资产')
  const teacherDraftPage = await request(baseUrl, teacherJar, `/books/${draft.bookId}/pages/1`, { workspaceId: fixture.wsAId })
  assert.equal(teacherDraftPage.status, 404, 'getPage 对草稿不放宽')
  const teacherVisibility = await request(baseUrl, teacherJar, `/books/${restricted.bookId}/visibility`, { workspaceId: fixture.wsAId })
  assert.equal(teacherVisibility.status, 404, '旧 GET visibility 已删除')

  const platformJar = await harness.login(fixture.people.platformOperator)
  const platformDrafts = await request(baseUrl, platformJar, '/books?status=draft', { workspaceId: fixture.wsPlatformId })
  assert.equal(platformDrafts.status, 200, JSON.stringify(platformDrafts.payload))
  assert.ok(
    platformDrafts.payload.data.items.some((item) => item.id === draft.bookId),
    'platform 的 draft 正例必须有 platform 角色',
  )
  const platformDraftAsset = await request(baseUrl, platformJar, `/books/assets/${draft.assetId}`, { workspaceId: fixture.wsPlatformId })
  assert.equal(platformDraftAsset.status, 200, `platform 必须能取草稿资产：${JSON.stringify(platformDraftAsset.payload)}`)

  for (const [label, person, workspaceId] of [
    ['校长', fixture.people.admin, fixture.wsSchoolId],
    ['年级主任', fixture.people.gradeLeadOne, fixture.wsGradeOneId],
    ['grade_admin 别名年级主任', fixture.people.gradeAdminTwo, fixture.wsGradeTwoId],
  ]) {
    const jar = await harness.login(person)
    const list = await request(baseUrl, jar, '/books', { workspaceId })
    assert.equal(list.status, 200, `${label}：${JSON.stringify(list.payload)}`)
    assert.equal(
      list.payload.data.items.some((item) => item.id === restricted.bookId),
      false,
      `${label} 不得再作为书库管理正例看到只 grant 他班的书`,
    )
    const drafts = await request(baseUrl, jar, '/books?status=draft', { workspaceId })
    assert.equal(
      drafts.payload.data.items.some((item) => item.id === draft.bookId),
      false,
      `${label} 不得列 draft`,
    )
  }

  const legacyJar = await harness.login(fixture.people.gradeGroupLegacy)
  const legacyList = await request(baseUrl, legacyJar, '/books', { workspaceId: fixture.wsGradeOneId })
  assert.equal(legacyList.status, 403, `历史 grade_group 无动作表，不得当书库正例：${JSON.stringify(legacyList.payload)}`)
  assert.equal(legacyList.payload.error.code, 'PERMISSION_DENIED')

  // 停权后只剩学生身份：查不到 active 管理角色就按学生处理。
  const demotedJar = await harness.login(fixture.people.studentDemoted)
  assertInvisible(await probeAllEntries(baseUrl, demotedJar, fixture.wsAId, restricted), '停权教师读受限书')
  const demotedDrafts = await request(baseUrl, demotedJar, '/books?status=draft', { workspaceId: fixture.wsAId })
  assert.equal(demotedDrafts.status, 200, JSON.stringify(demotedDrafts.payload))
  assert.equal(
    demotedDrafts.payload.data.items.some((item) => item.id === draft.bookId),
    false,
    '停权教师不得通过 ?status=draft 列出草稿',
  )
  const demotedDraftAsset = await request(baseUrl, demotedJar, `/books/assets/${draft.assetId}`, {
    workspaceId: fixture.wsAId,
  })
  assert.equal(demotedDraftAsset.status, 404, '资产放宽不得对降级后的账号生效')
  const demotedVisibility = await request(baseUrl, demotedJar, `/books/${restricted.bookId}/visibility`, {
    workspaceId: fixture.wsAId,
  })
  assert.equal(demotedVisibility.status, 404, '可见范围详情是管理端专用，学生一律 404')
  const demotedClasses = await request(baseUrl, demotedJar, '/classes', { workspaceId: fixture.wsAId })
  assert.equal(demotedClasses.status, 403, JSON.stringify(demotedClasses.payload))
  assert.equal(demotedClasses.payload.error.code, 'PERMISSION_DENIED')
  const demotedWrite = await setVisibility(baseUrl, demotedJar, fixture.wsAId, restricted.bookId, {
    scope: 'organization',
  })
  assert.equal(demotedWrite.status, 404, JSON.stringify(demotedWrite.payload))
  assert.equal(demotedWrite.payload.error.code, 'RESOURCE_NOT_FOUND')
  const demotedPublish = await request(baseUrl, demotedJar, `/books/${draft.bookId}/publish`, {
    method: 'POST',
    workspaceId: fixture.wsAId,
    idempotencyKey: `demoted-publish-${randomUUID()}`,
    body: {},
  })
  assert.equal(demotedPublish.status, 403, JSON.stringify(demotedPublish.payload))
  assert.equal(demotedPublish.payload.error.code, 'PERMISSION_DENIED')
})

// ===========================================================================
// 攻击面二：版本号绕过
// ===========================================================================

test('【攻击面 2.7/2.8/2.9】收窄后新增版本：未授权班仍读不到旧版本页/旧资产，被授权班不被误伤', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const book = await harness.createBook({ title: '多版本受限书' })

  const grantedVersionId = harness.grantCurrentBookToClass({
    bookId: book.bookId,
    classId: fixture.classBId,
    organizationId: fixture.organizationId,
    actorId: fixture.people.teacherB.id,
  })
  assert.equal(grantedVersionId, book.versionId)

  // P4-17 的核心：先收窄，再新增一个版本。grants 只挂在旧版本上，
  // 但判定按「书」聚合，所以 A 班仍然不可见、B 班仍然可见。
  const later = harness.appendLaterVersion({
    bookId: book.bookId,
    organizationId: fixture.organizationId,
    actorId: fixture.people.admin.id,
  })
  assert.deepEqual(
    grantRows(database, book.bookId).map((row) => row.bookVersionId),
    [book.versionId],
    'grants 仍然只在旧版本上',
  )

  const studentAJar = await harness.login(fixture.people.studentA)
  assertInvisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, book), 'A 班学生读只 grant 他班的书（原因：只 grant 他班）')
  // 旧版本 assetId 直取。
  const oldAsset = await request(baseUrl, studentAJar, `/books/assets/${book.assetId}`, { workspaceId: fixture.wsAId })
  assert.equal(oldAsset.status, 404, `旧版本 assetId 不得绕过：${JSON.stringify(oldAsset.payload)}`)
  // 新版本 assetId 直取。
  const newAsset = await request(baseUrl, studentAJar, `/books/assets/${later.assetId}`, { workspaceId: fixture.wsAId })
  assert.equal(newAsset.status, 404, `新版本 assetId 不得绕过：${JSON.stringify(newAsset.payload)}`)
  // 显式指定版本读页：旧版本、新版本都不行。
  for (const [label, versionId] of [['旧版本', book.versionId], ['新版本', later.versionId]]) {
    const page = await request(
      baseUrl,
      studentAJar,
      `/books/${book.bookId}/pages/1?versionId=${encodeURIComponent(versionId)}`,
      { workspaceId: fixture.wsAId },
    )
    assert.equal(page.status, 404, `${label} ?versionId 不得绕过班级可见范围`)
    assert.equal(page.payload.error.code, 'RESOURCE_NOT_FOUND')
  }
  // 用别的书的 versionId 冒充也不行。
  const other = await harness.createBook({ title: '另一本无关的书' })
  const crossVersion = await request(
    baseUrl,
    studentAJar,
    `/books/${book.bookId}/pages/1?versionId=${encodeURIComponent(other.versionId)}`,
    { workspaceId: fixture.wsAId },
  )
  assert.equal(crossVersion.status, 404, '拿别的书的 versionId 冒充也不得读到受限书')

  // 反向：B 班学生的正常路径不能被 P4-17 的收紧破坏（含旧版本与新版本资产）。
  const studentBJar = await harness.login(fixture.people.studentB)
  assertVisible(await probeAllEntries(baseUrl, studentBJar, fixture.wsBId, book), 'B 班学生读受限书')
  const bOldAsset = await request(baseUrl, studentBJar, `/books/assets/${book.assetId}`, { workspaceId: fixture.wsBId })
  assert.equal(bOldAsset.status, 200, '被授权班取旧版本资产应正常')
  const bOldPage = await request(
    baseUrl,
    studentBJar,
    `/books/${book.bookId}/pages/1?versionId=${encodeURIComponent(book.versionId)}`,
    { workspaceId: fixture.wsBId },
  )
  assert.equal(bOldPage.status, 200, '被授权班显式读旧版本页应正常')
})

// ===========================================================================
// 攻击面三：跨组织
// ===========================================================================

test('【攻击面 3.10/3.11】跨组织显式两组织两班各自 grant 后仍互不可见；外组织 classId 与不存在 classId 同码同文案', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const homeBook = await harness.createBook({ title: '本校书' })
  const foreignBook = await harness.createBook({
    title: '外校书',
    organizationId: fixture.foreignOrganizationId,
    actorId: fixture.people.foreignTeacher.id,
    workspaceId: fixture.wsForeignClassId,
  })
  harness.grantCurrentBookToClass({
    bookId: homeBook.bookId,
    classId: fixture.classAId,
    organizationId: fixture.organizationId,
    actorId: fixture.people.teacherA.id,
  })
  harness.grantCurrentBookToClass({
    bookId: foreignBook.bookId,
    classId: fixture.foreignClassId,
    organizationId: fixture.foreignOrganizationId,
    actorId: fixture.people.foreignTeacher.id,
  })

  // 本校三种身份都碰不到外校的书。
  for (const [label, person, workspaceId] of [
    ['本校学生', fixture.people.studentA, fixture.wsAId],
    ['本校班主任', fixture.people.teacherA, fixture.wsAId],
    ['本校校长', fixture.people.admin, fixture.wsSchoolId],
  ]) {
    const jar = await harness.login(person)
    const list = await request(baseUrl, jar, '/books', { workspaceId })
    assert.equal(
      list.payload.data.items.some((item) => item.id === foreignBook.bookId),
      false,
      `${label} 不得在列表里看到外校书`,
    )
    const page = await request(baseUrl, jar, `/books/${foreignBook.bookId}/pages/1`, { workspaceId })
    assert.equal(page.status, 404, `${label} 读外校书页：${JSON.stringify(page.payload)}`)
    const asset = await request(baseUrl, jar, `/books/assets/${foreignBook.assetId}`, { workspaceId })
    assert.equal(asset.status, 404, `${label} 取外校资产：${JSON.stringify(asset.payload)}`)
    const visibility = await request(baseUrl, jar, `/books/${foreignBook.bookId}/visibility`, { workspaceId })
    assert.equal(visibility.status, 404, `${label} 读外校书可见范围：${JSON.stringify(visibility.payload)}`)
  }

  // 外校学生也碰不到本校书。
  const foreignStudentJar = await harness.login(fixture.people.foreignStudent)
  assertInvisible(
    await probeAllEntries(baseUrl, foreignStudentJar, fixture.wsForeignClassId, homeBook),
    '外校学生读本校书（原因：跨组织）',
  )

  const adminJar = await harness.login(fixture.people.admin)
  const foreignWrite = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, foreignBook.bookId, {
    scope: 'organization',
  })
  assert.equal(foreignWrite.status, 404, JSON.stringify(foreignWrite.payload))
  assert.equal(foreignWrite.payload.error.code, 'RESOURCE_NOT_FOUND')

  const teacherJar = await harness.login(fixture.people.teacherA)
  const missingClassId = `class-never-existed-${randomUUID()}`
  const foreignClass = await harness.putShelf(teacherJar, fixture.wsAId, fixture.foreignClassId, homeBook.bookId)
  const ghostClass = await harness.putShelf(teacherJar, fixture.wsAId, missingClassId, homeBook.bookId)
  assert.equal(foreignClass.status, 404, JSON.stringify(foreignClass.payload))
  assert.equal(ghostClass.status, 404, JSON.stringify(ghostClass.payload))
  assert.equal(foreignClass.payload.error.code, 'RESOURCE_NOT_FOUND')
  assert.equal(foreignClass.payload.error.code, ghostClass.payload.error.code)
  assert.equal(
    foreignClass.payload.error.message,
    ghostClass.payload.error.message,
    '外组织班级与不存在的班级必须同文案',
  )
  assert.deepEqual(
    grantRows(database, homeBook.bookId).map((row) => row.granteeId),
    [fixture.classAId],
    '被拒的跨组织书架请求不得改本校 grant',
  )

  const teacherClasses = await request(baseUrl, teacherJar, '/classes', { workspaceId: fixture.wsAId })
  assert.equal(teacherClasses.status, 403, JSON.stringify(teacherClasses.payload))
  assert.equal(teacherClasses.payload.error.code, 'PERMISSION_DENIED')

  const classes = await request(baseUrl, adminJar, '/classes', { workspaceId: fixture.wsSchoolId })
  assert.equal(classes.status, 200, JSON.stringify(classes.payload))
  const classIds = classes.payload.data.items.map((entry) => entry.id)
  assert.equal(classIds.includes(fixture.foreignClassId), false, '不得列出外校班级')
  assert.deepEqual(
    classIds.slice().sort(),
    [fixture.classAId, fixture.classBId, fixture.classCId, fixture.classSpareId, fixture.classFrozenId].sort(),
    '校级范围应列出本组织全部 active 班级（含空班）',
  )
  const spare = classes.payload.data.items.find((entry) => entry.id === fixture.classSpareId)
  assert.equal(spare.studentCount, 0, '空班必须被列出且人数为 0')
  const classA = classes.payload.data.items.find((entry) => entry.id === fixture.classAId)
  assert.equal(classA.gradeId, fixture.gradeOneId)
  // studentA / studentGhost / studentSchoolMember / studentDemoted 是 A 班 student，teacherA 是 teacher。
  assert.equal(classA.studentCount, 4, 'studentCount 只数 membership_role=student 的在册成员')

  // 外校校长只能看到外校的班。
  const foreignAdminJar = await harness.login(fixture.people.foreignAdmin)
  const foreignClasses = await request(baseUrl, foreignAdminJar, '/classes', { workspaceId: fixture.wsForeignSchoolId })
  assert.equal(foreignClasses.status, 200, JSON.stringify(foreignClasses.payload))
  assert.deepEqual(foreignClasses.payload.data.items.map((entry) => entry.id), [fixture.foreignClassId])
})

// ===========================================================================
// 攻击面四：授权范围越界
// ===========================================================================

test('【攻击面 4.12/4.13/4.14】书架只认当前 class workspace：教师不能跨班；年级主任/校长/平台无书架', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const book = await harness.createBook({ title: '授权范围校验书' })

  const teacherAJar = await harness.login(fixture.people.teacherA)
  const own = await harness.putShelf(teacherAJar, fixture.wsAId, fixture.classAId, book.bookId)
  assert.equal(own.status, 200, JSON.stringify(own.payload))
  for (const [label, classId] of [
    ['同年级别班', fixture.classBId],
    ['别年级班', fixture.classCId],
  ]) {
    const rejected = await harness.putShelf(teacherAJar, fixture.wsAId, classId, book.bookId)
    assert.equal(rejected.status, 403, `class 范围教师授权${label}必须 403：${JSON.stringify(rejected.payload)}`)
    assert.equal(rejected.payload.error.code, 'PERMISSION_DENIED')
  }
  assert.deepEqual(grantRows(database, book.bookId).map((row) => row.granteeId), [fixture.classAId])

  const gradeOneJar = await harness.login(fixture.people.gradeLeadOne)
  const gradeOwn = await harness.putShelf(gradeOneJar, fixture.wsGradeOneId, fixture.classAId, book.bookId)
  assert.equal(gradeOwn.status, 403, `年级主任不得改本届书架：${JSON.stringify(gradeOwn.payload)}`)
  const gradeCross = await harness.putShelf(gradeOneJar, fixture.wsGradeOneId, fixture.classCId, book.bookId)
  assert.equal(gradeCross.status, 403, `年级主任不得改跨届书架：${JSON.stringify(gradeCross.payload)}`)

  const schoolReset = await setVisibility(baseUrl, (await harness.login(fixture.people.admin)), fixture.wsSchoolId, book.bookId, {
    scope: 'organization',
  })
  assert.equal(schoolReset.status, 404, `旧 organization 清空必须 404：${JSON.stringify(schoolReset.payload)}`)
  assert.deepEqual(grantRows(database, book.bookId).map((row) => row.granteeId), [fixture.classAId])

  const gradeTwoJar = await harness.login(fixture.people.gradeAdminTwo)
  const gradeTwoOwn = await harness.putShelf(gradeTwoJar, fixture.wsGradeTwoId, fixture.classCId, book.bookId)
  assert.equal(gradeTwoOwn.status, 403, `二年级主任也无书架权：${JSON.stringify(gradeTwoOwn.payload)}`)

  const adminJar = await harness.login(fixture.people.admin)
  const schoolWide = await harness.putShelf(adminJar, fixture.wsSchoolId, fixture.classAId, book.bookId)
  assert.equal(schoolWide.status, 403, `校长无 C workspace 不得改书架：${JSON.stringify(schoolWide.payload)}`)
  const platformJar = await harness.login(fixture.people.platformOperator)
  const platformWide = await harness.putShelf(platformJar, fixture.wsPlatformId, fixture.classCId, book.bookId)
  assert.equal(platformWide.status, 403, `平台运维不得改班级书架：${JSON.stringify(platformWide.payload)}`)

  const teacherBJar = await harness.login(fixture.people.teacherB)
  const crossTeacher = await harness.putShelf(teacherBJar, fixture.wsBId, fixture.classAId, book.bookId)
  assert.equal(crossTeacher.status, 403, `B 班班主任不得授权给 A 班：${JSON.stringify(crossTeacher.payload)}`)

  const teacherClasses = await request(baseUrl, teacherAJar, '/classes', { workspaceId: fixture.wsAId })
  assert.equal(teacherClasses.status, 403, '教师不得走 GET /classes')
  const gradeClasses = await request(baseUrl, gradeOneJar, '/classes', { workspaceId: fixture.wsGradeOneId })
  assert.equal(gradeClasses.status, 200, JSON.stringify(gradeClasses.payload))
  assert.deepEqual(
    gradeClasses.payload.data.items.map((entry) => entry.id).sort(),
    [fixture.classAId, fixture.classBId, fixture.classFrozenId].sort(),
    '年级范围应列出本届全部 active 班级',
  )
})

test('【攻击面 4.15】学生打管理接口时，存在的书与不存在的书必须同码同文案（不泄露存在性）', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl } = harness
  const visible = await harness.createBook({ title: '对该学生可见的书' })
  const invisible = await harness.createBook({ title: '对该学生不可见的书（只 grant 他班）' })
  const draft = await harness.createBook({ title: '草稿书', published: false })

  harness.grantCurrentBookToClass({
    bookId: visible.bookId,
    classId: fixture.classAId,
    organizationId: fixture.organizationId,
    actorId: fixture.people.teacherA.id,
  })
  harness.grantCurrentBookToClass({
    bookId: invisible.bookId,
    classId: fixture.classBId,
    organizationId: fixture.organizationId,
    actorId: fixture.people.teacherB.id,
  })
  harness.grantCurrentBookToClass({
    bookId: draft.bookId,
    classId: fixture.classAId,
    organizationId: fixture.organizationId,
    actorId: fixture.people.teacherA.id,
  })

  const studentJar = await harness.login(fixture.people.studentA)
  const missingBookId = `book-never-existed-${randomUUID()}`

  // GET visibility：契约 P4-18，学生一律 404，四种书（可见/不可见/草稿/不存在）响应必须完全一致。
  const reads = {}
  for (const [label, bookId] of [
    ['可见书', visible.bookId],
    ['不可见书', invisible.bookId],
    ['草稿书', draft.bookId],
    ['不存在的书', missingBookId],
  ]) {
    reads[label] = await request(baseUrl, studentJar, `/books/${bookId}/visibility`, { workspaceId: fixture.wsAId })
    assert.equal(reads[label].status, 404, `学生读${label}的可见范围必须 404：${JSON.stringify(reads[label].payload)}`)
  }
  const readCodes = new Set(Object.values(reads).map((entry) => entry.payload.error.code))
  const readMessages = new Set(Object.values(reads).map((entry) => entry.payload.error.message))
  assert.deepEqual([...readCodes], ['RESOURCE_NOT_FOUND'], '学生读可见范围的错误码必须唯一')
  assert.equal(readMessages.size, 1, `学生读可见范围的文案必须唯一，实际 ${JSON.stringify([...readMessages])}`)

  const writes = {}
  for (const [label, bookId] of [
    ['可见书', visible.bookId],
    ['不可见书', invisible.bookId],
    ['草稿书', draft.bookId],
    ['不存在的书', missingBookId],
  ]) {
    writes[label] = await setVisibility(baseUrl, studentJar, fixture.wsAId, bookId, { scope: 'organization' })
    assert.equal(writes[label].status, 404, `学生写${label}的旧可见范围必须 404：${JSON.stringify(writes[label].payload)}`)
    assert.equal(writes[label].payload.error.code, 'RESOURCE_NOT_FOUND')
  }
  assert.equal(
    new Set(Object.values(writes).map((entry) => entry.payload.error.message)).size,
    1,
    '学生写旧可见范围的文案必须唯一，否则泄露书是否存在',
  )

  const shelfWrites = {}
  for (const [label, bookId] of [
    ['可见书', visible.bookId],
    ['不存在的书', missingBookId],
  ]) {
    shelfWrites[label] = await harness.putShelf(studentJar, fixture.wsAId, fixture.classAId, bookId)
    assert.equal(shelfWrites[label].status, 403, `学生写${label}书架必须 403：${JSON.stringify(shelfWrites[label].payload)}`)
    assert.equal(shelfWrites[label].payload.error.code, 'PERMISSION_DENIED')
  }
  assert.equal(
    new Set(Object.values(shelfWrites).map((entry) => entry.payload.error.message)).size,
    1,
    '学生写书架的拒绝文案必须唯一',
  )

  for (const action of ['publish', 'unpublish']) {
    const responses = []
    for (const bookId of [visible.bookId, draft.bookId, missingBookId]) {
      const response = await request(baseUrl, studentJar, `/books/${bookId}/${action}`, {
        method: 'POST',
        workspaceId: fixture.wsAId,
        idempotencyKey: `student-${action}-${randomUUID()}`,
        body: {},
      })
      assert.equal(response.status, 403, `学生调 ${action} 必须 403：${JSON.stringify(response.payload)}`)
      assert.equal(response.payload.error.code, 'PERMISSION_DENIED')
      responses.push(response.payload.error.message)
    }
    assert.equal(new Set(responses).size, 1, `${action} 的拒绝文案必须唯一`)
  }
})

// ===========================================================================
// 攻击面五：状态与幂等
// ===========================================================================

test('【攻击面 5.16】学生的 ?status 参数被静默锁死为 published；教师不得看 draft 资产；platform 才是 draft 正例', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl } = harness
  const published = await harness.createBook({ title: '已发布书' })
  const draft = await harness.createBook({ title: '草稿书', published: false })
  const archived = await harness.createBook({ title: '归档书', archived: true })
  harness.grantCurrentBookToClass({
    bookId: published.bookId,
    classId: fixture.classAId,
    organizationId: fixture.organizationId,
    actorId: fixture.people.teacherA.id,
  })

  const studentJar = await harness.login(fixture.people.studentA)
  for (const status of ['draft', 'archived', 'published']) {
    const list = await request(baseUrl, studentJar, `/books?status=${status}`, { workspaceId: fixture.wsAId })
    assert.equal(list.status, 200, `学生 ?status=${status}：${JSON.stringify(list.payload)}`)
    const ids = list.payload.data.items.map((item) => item.id)
    assert.equal(ids.includes(published.bookId), true, `?status=${status} 仍应返回已发布书`)
    assert.equal(ids.includes(draft.bookId), false, `?status=${status} 不得返回草稿书`)
    assert.equal(ids.includes(archived.bookId), false, `?status=${status} 不得返回归档书`)
  }
  // 非法状态值：学生也不该因此拿到别的状态。
  const bogus = await request(baseUrl, studentJar, '/books?status=all', { workspaceId: fixture.wsAId })
  assert.ok(
    bogus.status === 422 || (bogus.status === 200 && !bogus.payload.data.items.some((item) => item.id === draft.bookId)),
    `非法 status 只能是 422 或按 published 处理，实际 ${bogus.status} ${JSON.stringify(bogus.payload)}`,
  )

  // 学生取草稿/归档书资产必须仍是 404（防「放宽被写成对所有角色生效」）。
  for (const [label, book] of [['草稿书', draft], ['归档书', archived]]) {
    const asset = await request(baseUrl, studentJar, `/books/assets/${book.assetId}`, { workspaceId: fixture.wsAId })
    assert.equal(asset.status, 404, `学生取${label}资产必须 404：${JSON.stringify(asset.payload)}`)
    assert.equal(asset.payload.error.code, 'RESOURCE_NOT_FOUND')
    const page = await request(baseUrl, studentJar, `/books/${book.bookId}/pages/1`, { workspaceId: fixture.wsAId })
    assert.equal(page.status, 404, `学生取${label}页必须 404`)
  }

  const teacherJar = await harness.login(fixture.people.teacherA)
  const teacherDrafts = await request(baseUrl, teacherJar, '/books?status=draft', { workspaceId: fixture.wsAId })
  assert.equal(
    teacherDrafts.payload.data.items.some((item) => item.id === draft.bookId),
    false,
    '教师不得列 draft',
  )
  const teacherArchived = await request(baseUrl, teacherJar, '/books?status=archived', { workspaceId: fixture.wsAId })
  assert.equal(
    teacherArchived.payload.data.items.some((item) => item.id === archived.bookId),
    false,
    '教师不得列 archived',
  )
  for (const [label, book] of [['草稿书', draft], ['归档书', archived]]) {
    const asset = await request(baseUrl, teacherJar, `/books/assets/${book.assetId}`, { workspaceId: fixture.wsAId })
    assert.equal(asset.status, 404, `教师取${label}资产必须 404：${JSON.stringify(asset.payload)}`)
    const page = await request(baseUrl, teacherJar, `/books/${book.bookId}/pages/1`, { workspaceId: fixture.wsAId })
    assert.equal(page.status, 404, `getPage 对${label}不放宽，教师也必须 404`)
  }

  const platformJar = await harness.login(fixture.people.platformOperator)
  const platformDrafts = await request(baseUrl, platformJar, '/books?status=draft', { workspaceId: fixture.wsPlatformId })
  assert.ok(platformDrafts.payload.data.items.some((item) => item.id === draft.bookId), 'platform 必须能列 draft')
  const platformDraftAsset = await request(baseUrl, platformJar, `/books/assets/${draft.assetId}`, { workspaceId: fixture.wsPlatformId })
  assert.equal(platformDraftAsset.status, 200, `platform 取草稿资产应 200：${JSON.stringify(platformDraftAsset.payload)}`)
})

test('【攻击面 5.17/5.18】书架幂等：缺键 400、同键重放不增行/审计；旧 visibility 同键异体 404 且不得改 grants', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const book = await harness.createBook({ title: '幂等守卫书' })
  const teacherJar = await harness.login(fixture.people.teacherA)

  const oldMissing = await request(baseUrl, teacherJar, `/books/${book.bookId}/visibility`, {
    method: 'PUT',
    workspaceId: fixture.wsAId,
    body: { scope: 'classes', classIds: [fixture.classAId] },
  })
  assert.equal(oldMissing.status, 404, JSON.stringify(oldMissing.payload))
  assert.equal(oldMissing.payload.error.code, 'RESOURCE_NOT_FOUND')
  assert.equal(grantRows(database, book.bookId).length, 0)

  const missingKey = await request(baseUrl, teacherJar, `/classes/${fixture.classAId}/shelf/${book.bookId}`, {
    method: 'PUT',
    workspaceId: fixture.wsAId,
    body: {},
  })
  assert.equal(missingKey.status, 400, JSON.stringify(missingKey.payload))
  assert.equal(missingKey.payload.error.code, 'VALIDATION_FAILED')
  assert.equal(grantRows(database, book.bookId).length, 0)

  const key = 'guard-fixed-key'
  const first = await harness.putShelf(teacherJar, fixture.wsAId, fixture.classAId, book.bookId, key)
  assert.equal(first.status, 200, JSON.stringify(first.payload))
  assert.equal(first.payload.meta?.replayed, undefined)
  assert.equal(grantRows(database, book.bookId).length, 1)
  assert.equal(shelfGrantAuditCount(database, book.bookId), 1)

  const replay = await harness.putShelf(teacherJar, fixture.wsAId, fixture.classAId, book.bookId, key)
  assert.equal(replay.status, 200, JSON.stringify(replay.payload))
  assert.equal(replay.payload.meta.replayed, true)
  assert.equal(grantRows(database, book.bookId).length, 1, '重放不得产生第二行 grants')
  assert.equal(shelfGrantAuditCount(database, book.bookId), 1, '重放不得产生第二条审计事件')

  const conflict = await setVisibility(baseUrl, teacherJar, fixture.wsAId, book.bookId, {
    scope: 'organization',
  }, key)
  assert.equal(conflict.status, 404, `旧 visibility 同键异体必须 404：${JSON.stringify(conflict.payload)}`)
  assert.equal(conflict.payload.error.code, 'RESOURCE_NOT_FOUND')
  assert.deepEqual(grantRows(database, book.bookId).map((row) => row.granteeId), [fixture.classAId])
  assert.equal(shelfGrantAuditCount(database, book.bookId), 1)

  const studentBJar = await harness.login(fixture.people.studentB)
  assertInvisible(await probeAllEntries(baseUrl, studentBJar, fixture.wsBId, book), '幂等冲突后 B 班学生（原因：只 grant 他班）')
  const studentAJar = await harness.login(fixture.people.studentA)
  assertVisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, book), '幂等冲突后 A 班学生')
})

test('【攻击面 5.19】本班投放/撤下反复切换后状态干净；不得再用 organization 全开', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const book = await harness.createBook({ title: '反复切换书' })
  const teacherAJar = await harness.login(fixture.people.teacherA)
  const teacherBJar = await harness.login(fixture.people.teacherB)
  const studentAJar = await harness.login(fixture.people.studentA)
  const studentBJar = await harness.login(fixture.people.studentB)

  const steps = [
    { action: 'none', grants: [], aVisible: false, bVisible: false },
    { action: 'putA', grants: [fixture.classAId], aVisible: true, bVisible: false },
    { action: 'delA', grants: [], aVisible: false, bVisible: false },
    { action: 'putB', grants: [fixture.classBId], aVisible: false, bVisible: true },
    { action: 'putA', grants: [fixture.classAId, fixture.classBId].sort(), aVisible: true, bVisible: true },
    { action: 'delA', grants: [fixture.classBId], aVisible: false, bVisible: true },
    { action: 'delB', grants: [], aVisible: false, bVisible: false },
  ]
  for (const [index, step] of steps.entries()) {
    if (step.action === 'putA') {
      const response = await harness.putShelf(teacherAJar, fixture.wsAId, fixture.classAId, book.bookId)
      assert.equal(response.status, 200, `第 ${index + 1} 步 PUT A：${JSON.stringify(response.payload)}`)
    } else if (step.action === 'delA') {
      const response = await harness.deleteShelf(teacherAJar, fixture.wsAId, fixture.classAId, book.bookId)
      assert.equal(response.status, 200, `第 ${index + 1} 步 DELETE A：${JSON.stringify(response.payload)}`)
    } else if (step.action === 'putB') {
      const response = await harness.putShelf(teacherBJar, fixture.wsBId, fixture.classBId, book.bookId)
      assert.equal(response.status, 200, `第 ${index + 1} 步 PUT B：${JSON.stringify(response.payload)}`)
    } else if (step.action === 'delB') {
      const response = await harness.deleteShelf(teacherBJar, fixture.wsBId, fixture.classBId, book.bookId)
      assert.equal(response.status, 200, `第 ${index + 1} 步 DELETE B：${JSON.stringify(response.payload)}`)
    }
    assert.deepEqual(
      grantRows(database, book.bookId).map((row) => row.granteeId),
      step.grants,
      `第 ${index + 1} 步 grants 行不符`,
    )
    const probeA = await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, book)
    if (step.aVisible) assertVisible(probeA, `第 ${index + 1} 步 A 班学生`)
    else assertInvisible(probeA, `第 ${index + 1} 步 A 班学生`)
    const probeB = await probeAllEntries(baseUrl, studentBJar, fixture.wsBId, book)
    if (step.bVisible) assertVisible(probeB, `第 ${index + 1} 步 B 班学生`)
    else assertInvisible(probeB, `第 ${index + 1} 步 B 班学生`)
  }

  const reopen = await setVisibility(baseUrl, teacherAJar, fixture.wsAId, book.bookId, { scope: 'organization' })
  assert.equal(reopen.status, 404, JSON.stringify(reopen.payload))
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM book_access_grants').get().count,
    0,
    '全流程结束后整张 book_access_grants 必须没有残留',
  )
})

// ===========================================================================
// 攻击面六：边界数据
// ===========================================================================

test('【攻击面 6.21】旧 visibility 参数边界一律 404，不得再写 grants', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const book = await harness.createBook({ title: '参数边界书' })
  const adminJar = await harness.login(fixture.people.admin)
  const teacherJar = await harness.login(fixture.people.teacherA)

  const duplicated = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId, fixture.classAId, fixture.classAId],
  })
  assert.equal(duplicated.status, 404, JSON.stringify(duplicated.payload))
  assert.equal(grantRows(database, book.bookId).length, 0)

  for (const [label, body] of [
    ['scope 缺失', {}],
    ['scope 非法', { scope: 'grade' }],
    ['scope 为 null', { scope: null }],
    ['classes 但 classIds 空数组', { scope: 'classes', classIds: [] }],
    ['classes 但 classIds 缺失', { scope: 'classes' }],
    ['classIds 非数组', { scope: 'classes', classIds: fixture.classAId }],
    ['classIds 含数字', { scope: 'classes', classIds: [fixture.classAId, 42] }],
    ['classIds 含 null', { scope: 'classes', classIds: [fixture.classAId, null] }],
    ['classIds 含对象', { scope: 'classes', classIds: [{ id: fixture.classAId }] }],
    ['classIds 含空串', { scope: 'classes', classIds: [fixture.classAId, ''] }],
    ['classIds 含纯空白串', { scope: 'classes', classIds: [fixture.classAId, '   '] }],
    ['scope=organization 同时带 classIds', { scope: 'organization', classIds: [fixture.classAId] }],
    ['scope=organization 带空数组', { scope: 'organization', classIds: [] }],
  ]) {
    const response = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, body)
    assert.equal(response.status, 404, `${label} 必须 404：${response.status} ${JSON.stringify(response.payload)}`)
    assert.equal(response.payload.error.code, 'RESOURCE_NOT_FOUND', `${label} 错误码`)
  }
  assert.equal(grantRows(database, book.bookId).length, 0, '旧 visibility 参数校验路径不得落 grants')

  const flood = [fixture.classAId, ...Array.from({ length: 400 }, (_, index) => `flood-class-${index}-${randomUUID()}`)]
  const flooded = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, {
    scope: 'classes',
    classIds: flood,
  })
  assert.equal(flooded.status, 404, `超长伪造数组必须 404：${flooded.status} ${JSON.stringify(flooded.payload)}`)
  assert.equal(grantRows(database, book.bookId).length, 0, '被拒的批量请求不得部分写入')

  const putOwn = await harness.putShelf(teacherJar, fixture.wsAId, fixture.classAId, book.bookId)
  assert.equal(putOwn.status, 200, JSON.stringify(putOwn.payload))
  assert.equal(grantRows(database, book.bookId).length, 1)
  const putAgain = await harness.putShelf(teacherJar, fixture.wsAId, fixture.classAId, book.bookId)
  assert.equal(putAgain.status, 200, JSON.stringify(putAgain.payload))
  assert.equal(grantRows(database, book.bookId).length, 1, '本班重复投放不得写出第二行')
})

test('【攻击面 6.20/6.22】悬空 grant 对学生不可见（原因：学生不在该班）；draft 门先 grant 后仍不可见', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const orphanGrant = await harness.createBook({ title: 'grants 指向已删除班级的书' })
  const draftRestricted = await harness.createBook({ title: '草稿且已 grant B 班的书', published: false })

  const adminJar = await harness.login(fixture.people.admin)
  const teacherBJar = await harness.login(fixture.people.teacherB)
  const studentAJar = await harness.login(fixture.people.studentA)
  const studentBJar = await harness.login(fixture.people.studentB)

  harness.grantCurrentBookToClass({
    bookId: orphanGrant.bookId,
    classId: fixture.classSpareId,
    organizationId: fixture.organizationId,
    actorId: fixture.people.admin.id,
  })
  database.prepare('DELETE FROM classes WHERE id = ?').run(fixture.classSpareId)
  assert.equal(grantRows(database, orphanGrant.bookId).length, 1, 'grants 行不随班级删除而消失')

  assertInvisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, orphanGrant), '悬空 grant 对 A 班学生（原因：学生不在该班）')
  assertInvisible(await probeAllEntries(baseUrl, studentBJar, fixture.wsBId, orphanGrant), '悬空 grant 对 B 班学生（原因：学生不在该班）')
  const orphanSnapshot = await request(baseUrl, adminJar, `/books/${orphanGrant.bookId}/visibility`, {
    workspaceId: fixture.wsSchoolId,
  })
  assert.equal(orphanSnapshot.status, 404, JSON.stringify(orphanSnapshot.payload))
  const cleared = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, orphanGrant.bookId, {
    scope: 'organization',
  })
  assert.equal(cleared.status, 404, JSON.stringify(cleared.payload))
  assert.equal(grantRows(database, orphanGrant.bookId).length, 1, '旧 organization 不得清悬空 grants')

  harness.grantCurrentBookToClass({
    bookId: draftRestricted.bookId,
    classId: fixture.classBId,
    organizationId: fixture.organizationId,
    actorId: fixture.people.teacherB.id,
  })
  assertInvisible(
    await probeAllEntries(baseUrl, studentBJar, fixture.wsBId, draftRestricted),
    '草稿 + 本班 grant 学生（原因：draft）',
  )

  const draftList = await request(baseUrl, teacherBJar, '/books?status=draft', { workspaceId: fixture.wsBId })
  assert.equal(draftList.payload.data.items.some((item) => item.id === draftRestricted.bookId), false, '教师不得列 draft')
  const draftAsset = await request(baseUrl, teacherBJar, `/books/assets/${draftRestricted.assetId}`, {
    workspaceId: fixture.wsBId,
  })
  assert.equal(draftAsset.status, 404, `教师取草稿书资产必须 404：${JSON.stringify(draftAsset.payload)}`)
  const draftPage = await request(baseUrl, teacherBJar, `/books/${draftRestricted.bookId}/pages/1`, {
    workspaceId: fixture.wsBId,
  })
  assert.equal(draftPage.status, 404, 'getPage 的 published 约束对教师也不放宽')

  const teacherPublish = await request(baseUrl, teacherBJar, `/books/${draftRestricted.bookId}/publish`, {
    method: 'POST',
    workspaceId: fixture.wsBId,
    idempotencyKey: `guard-publish-${randomUUID()}`,
    body: {},
  })
  assert.equal(teacherPublish.status, 403, JSON.stringify(teacherPublish.payload))

  const platformJar = await harness.login(fixture.people.platformOperator)
  const publishedNow = await request(baseUrl, platformJar, `/books/${draftRestricted.bookId}/publish`, {
    method: 'POST',
    workspaceId: fixture.wsPlatformId,
    idempotencyKey: `guard-publish-ops-${randomUUID()}`,
    body: {},
  })
  assert.equal(publishedNow.status, 200, JSON.stringify(publishedNow.payload))
  assertVisible(await probeAllEntries(baseUrl, studentBJar, fixture.wsBId, draftRestricted), '发布后被授权班学生')
  assertInvisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, draftRestricted), '发布后未授权班学生（原因：只 grant 他班）')
})

// ===========================================================================
// 现状记录：契约没覆盖的相邻入口。这些用例按实际行为断言，交主控裁决是否收口。
// ===========================================================================

test('【D-22/D-23】安排整项省略；租约 published+本班 grant 200，无 grant/draft/外组织 404', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl } = harness
  const book = await harness.createBook({ title: '先布置后投放的书' })
  const foreignBook = await harness.createBook({
    title: '外校书',
    organizationId: fixture.foreignOrganizationId,
    actorId: fixture.people.foreignTeacher.id,
    workspaceId: fixture.wsForeignClassId,
  })

  const teacherAJar = await harness.login(fixture.people.teacherA)
  const assignment = await request(baseUrl, teacherAJar, '/assignments', {
    method: 'POST',
    workspaceId: fixture.wsAId,
    idempotencyKey: `guard-assignment-${randomUUID()}`,
    body: { bookVersionId: book.versionId, title: 'A 班共读', classIds: [fixture.classAId] },
  })
  assert.equal(assignment.status, 201, JSON.stringify(assignment.payload))

  const studentAJar = await harness.login(fixture.people.studentA)
  assertInvisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, book), '无 grant 时五个入口（原因：无 grant）')
  const assignmentsBefore = await request(baseUrl, studentAJar, '/assignments', { workspaceId: fixture.wsAId })
  assert.equal(assignmentsBefore.status, 200, JSON.stringify(assignmentsBefore.payload))
  assert.equal(
    (assignmentsBefore.payload.data.items ?? []).some((item) => item.book?.id === book.versionId || item.bookId === book.bookId),
    false,
    'D-22：无 grant 时安排必须整项省略',
  )

  const noGrantLease = await request(baseUrl, studentAJar, '/reading/lease', {
    method: 'POST',
    workspaceId: fixture.wsAId,
    idempotencyKey: `guard-lease-nogrant-${randomUUID()}`,
    body: { bookVersionId: book.versionId },
  })
  assert.equal(noGrantLease.status, 404, `D-23 无 grant 必须 404：${JSON.stringify(noGrantLease.payload)}`)
  assert.equal(noGrantLease.payload.error.code, 'RESOURCE_NOT_FOUND')
  assert.equal(noGrantLease.payload.error.message, '书籍不存在或当前不可读取')

  const putA = await harness.putShelf(teacherAJar, fixture.wsAId, fixture.classAId, book.bookId)
  assert.equal(putA.status, 200, JSON.stringify(putA.payload))
  assertVisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, book), '本班 grant 后五个入口')
  const assignmentsGranted = await request(baseUrl, studentAJar, '/assignments', { workspaceId: fixture.wsAId })
  assert.ok(
    (assignmentsGranted.payload.data.items ?? []).some((item) => item.book?.id === book.versionId),
    'D-22：published+本班 grant 必须返回安排',
  )
  const okLease = await request(baseUrl, studentAJar, '/reading/lease', {
    method: 'POST',
    workspaceId: fixture.wsAId,
    idempotencyKey: `guard-lease-ok-${randomUUID()}`,
    body: { bookVersionId: book.versionId },
  })
  assert.equal(okLease.status, 200, JSON.stringify(okLease.payload))

  const delA = await harness.deleteShelf(teacherAJar, fixture.wsAId, fixture.classAId, book.bookId)
  assert.equal(delA.status, 200, JSON.stringify(delA.payload))
  const stillOpen = harness.database.prepare(
    'SELECT released_at FROM active_reading_leases WHERE id = ?',
  ).get(okLease.payload.data.leaseId)
  assert.equal(stillOpen?.released_at ?? null, null, '撤下不得强制踢出已有 lease')

  const afterRevoke = await request(baseUrl, studentAJar, '/assignments', { workspaceId: fixture.wsAId })
  assert.equal(
    (afterRevoke.payload.data.items ?? []).some((item) => item.book?.id === book.versionId),
    false,
    'D-22：撤下后安排必须消失',
  )

  const draft = await harness.createBook({ title: '草稿书', published: false })
  harness.grantCurrentBookToClass({
    bookId: draft.bookId,
    classId: fixture.classAId,
    organizationId: fixture.organizationId,
    actorId: fixture.people.teacherA.id,
  })
  const draftLease = await request(baseUrl, studentAJar, '/reading/lease', {
    method: 'POST',
    workspaceId: fixture.wsAId,
    idempotencyKey: `guard-lease-draft-${randomUUID()}`,
    body: { bookVersionId: draft.versionId, takeover: true },
  })
  assert.equal(draftLease.status, 404, `D-23 draft+本班 grant 必须 404：${JSON.stringify(draftLease.payload)}`)
  assert.equal(draftLease.payload.error.code, 'RESOURCE_NOT_FOUND')
  assert.equal(draftLease.payload.error.message, noGrantLease.payload.error.message)

  harness.grantCurrentBookToClass({
    bookId: foreignBook.bookId,
    classId: fixture.foreignClassId,
    organizationId: fixture.foreignOrganizationId,
    actorId: fixture.people.foreignTeacher.id,
  })
  const foreignLease = await request(baseUrl, studentAJar, '/reading/lease', {
    method: 'POST',
    workspaceId: fixture.wsAId,
    idempotencyKey: `guard-lease-foreign-${randomUUID()}`,
    body: { bookVersionId: foreignBook.versionId },
  })
  assert.equal(foreignLease.status, 404, `D-23 外组织必须 404：${JSON.stringify(foreignLease.payload)}`)
  assert.equal(foreignLease.payload.error.message, noGrantLease.payload.error.message)
})

// 主控已裁决收口 F-1。本用例原先断言「攻击成功、返回 200」，现改为断言整条利用链被 403 挡住，
// 覆盖范围不变：显式授权别班被拒 → 改用 organization → 现在也应被拒 → 校长的 grants 行未被破坏。
test('【F-1 已收口】教师不能用旧 organization/visibility 清掉他班 grant，也不能全局 unpublish', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const book = await harness.createBook({ title: '已投放 C 班的书' })

  harness.grantCurrentBookToClass({
    bookId: book.bookId,
    classId: fixture.classCId,
    organizationId: fixture.organizationId,
    actorId: fixture.people.admin.id,
  })

  const studentBJar = await harness.login(fixture.people.studentB)
  assertInvisible(await probeAllEntries(baseUrl, studentBJar, fixture.wsBId, book), '只 grant C 班后 B 班学生（原因：只 grant 他班）')

  const teacherAJar = await harness.login(fixture.people.teacherA)
  const explicit = await harness.putShelf(teacherAJar, fixture.wsAId, fixture.classBId, book.bookId)
  assert.equal(explicit.status, 403, `显式授权别班必须 403：${JSON.stringify(explicit.payload)}`)
  assert.equal(explicit.payload.error.code, 'PERMISSION_DENIED')

  const widened = await setVisibility(baseUrl, teacherAJar, fixture.wsAId, book.bookId, { scope: 'organization' })
  assert.equal(widened.status, 404, `放开到全组织必须 404：${JSON.stringify(widened.payload)}`)
  assert.equal(widened.payload.error.code, 'RESOURCE_NOT_FOUND')
  assert.deepEqual(
    grantRows(database, book.bookId).map((row) => row.granteeId),
    [fixture.classCId],
    '被拒的 organization 请求不得删掉 C 班 grants 行',
  )
  assertInvisible(
    await probeAllEntries(baseUrl, studentBJar, fixture.wsBId, book),
    'organization 被拒后 B 班学生仍然读不到这本书',
  )

  const hijacked = await harness.deleteShelf(teacherAJar, fixture.wsAId, fixture.classCId, book.bookId)
  assert.equal(hijacked.status, 403, `撤他班书架必须 403：${JSON.stringify(hijacked.payload)}`)
  assert.deepEqual(
    grantRows(database, book.bookId).map((row) => row.granteeId),
    [fixture.classCId],
    'C 班 grant 不得被 A 班教师 DELETE 掉',
  )

  const unpublished = await request(baseUrl, teacherAJar, `/books/${book.bookId}/unpublish`, {
    method: 'POST',
    workspaceId: fixture.wsAId,
    idempotencyKey: `guard-unpublish-${randomUUID()}`,
    body: {},
  })
  assert.equal(unpublished.status, 403, `教师全局 unpublish 必须 403：${JSON.stringify(unpublished.payload)}`)
  assert.equal(unpublished.payload.error.code, 'PERMISSION_DENIED')
  assert.equal(
    harness.database.prepare('SELECT status FROM books WHERE id = ?').get(book.bookId).status,
    'published',
  )
})

test('GET /classes 权限矩阵：多种学生人格一律 403；platform_ops 缺 class.read 的实际表现', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl } = harness

  // 契约：学生 403 PERMISSION_DENIED。三种学生人格都验一遍。
  for (const [label, person, workspaceId] of [
    ['普通学生', fixture.people.studentA, fixture.wsAId],
    ['孤儿学生', fixture.people.studentOrphan, fixture.wsAId],
    ['被塞进校务空间的学生', fixture.people.studentSchoolMember, fixture.wsSchoolId],
    ['本班教师', fixture.people.teacherA, fixture.wsAId],
  ]) {
    const jar = await harness.login(person)
    const response = await request(baseUrl, jar, '/classes', { workspaceId })
    assert.equal(response.status, 403, `${label} 调 GET /classes 必须 403：${JSON.stringify(response.payload)}`)
    assert.equal(response.payload.error.code, 'PERMISSION_DENIED', `${label} 错误码`)
  }

  // 现状记录：platform_ops 的动作表里没有 class.read，所以契约里
  //「platform → 本组织全部班」这条分支在 HTTP 上走不到（写路径仍然走得到，见授权范围用例）。
  const platformJar = await harness.login(fixture.people.platformOperator)
  const platformClasses = await request(baseUrl, platformJar, '/classes', { workspaceId: fixture.wsPlatformId })
  assert.equal(
    platformClasses.status,
    403,
    `现状：平台运维读 GET /classes 被 class.read 挡住：${JSON.stringify(platformClasses.payload)}`,
  )
  assert.equal(platformClasses.payload.error.code, 'PERMISSION_DENIED')
})

test('【F-4 已收口】非 class 类型 grant 不得当可见；旧 organization 不得再清空', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const book = await harness.createBook({ title: '被非 class grants 卡住的书' })
  const adminJar = await harness.login(fixture.people.admin)
  const studentAJar = await harness.login(fixture.people.studentA)

  assertInvisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, book), '插入前（原因：无 grant）')

  // book_access_grants.grantee_type 没有 CHECK 约束。当前只有 setBookVisibility 会写这张表
  // （固定 'class'），所以这行只能由测试直接造出来 —— 可见性谓词的「有没有 grants」
  // 不看 grantee_type；F-4 收口后 scope=organization 的 DELETE 会清掉全部 grants 行。
  // GET visibility 仍只统计 class grants，因此会继续报告 scope='organization'。
  database.prepare(`
    INSERT INTO book_access_grants (
      id, book_version_id, grantee_type, grantee_id,
      organization_id_at_creation, actor_id_at_creation, created_at, updated_at, version
    ) VALUES (?, ?, 'user', ?, ?, ?, ?, ?, 1)
  `).run(
    randomUUID(),
    book.versionId,
    fixture.people.studentB.id,
    fixture.organizationId,
    fixture.people.admin.id,
    new Date().toISOString(),
    new Date().toISOString(),
  )

  assertInvisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, book), '插入非 class grants 后（原因：未知 grantee_type 不得当可见）')

  const snapshot = await request(baseUrl, adminJar, `/books/${book.bookId}/visibility`, {
    workspaceId: fixture.wsSchoolId,
  })
  assert.equal(snapshot.status, 404, JSON.stringify(snapshot.payload))

  const reopened = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, { scope: 'organization' })
  assert.equal(reopened.status, 404, JSON.stringify(reopened.payload))
  assert.equal(grantRows(database, book.bookId).length, 1, '旧 organization 不得清掉非 class grants')
  assertInvisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, book), 'organization 404 后仍不可见')

  harness.grantCurrentBookToClass({
    bookId: book.bookId,
    classId: fixture.classAId,
    organizationId: fixture.organizationId,
    actorId: fixture.people.teacherA.id,
  })
  assertVisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, book), '补上 class grant 后可见')
})
