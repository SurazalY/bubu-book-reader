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

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function guardFixture() {
  const suffix = randomUUID().slice(0, 8)
  const id = (name) => `${name}-${suffix}`

  const organizationId = id('org-home')
  const foreignOrganizationId = id('org-foreign')
  const gradeOneId = id('grade-one')
  const gradeTwoId = id('grade-two')
  const foreignGradeId = id('grade-foreign')

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
    gradeLeadOne: { id: id('grade-lead-one'), displayName: '一年级组长' },
    gradeAdminTwo: { id: id('grade-admin-two'), displayName: '二年级主任' },
    admin: { id: id('school-admin'), displayName: '校长' },
    platformOperator: { id: id('platform-operator'), displayName: '平台运维' },
    foreignStudent: { id: id('foreign-student'), displayName: '外校学生' },
    foreignAdmin: { id: id('foreign-admin'), displayName: '外校校长' },
  }
  for (const [key, person] of Object.entries(people)) {
    person.username = `${key}-${suffix}`
    person.organizationId = key.startsWith('foreign') ? foreignOrganizationId : organizationId
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
        { id: organizationId, name: '守卫测试本校' },
        { id: foreignOrganizationId, name: '守卫测试外校' },
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
        { id: classAId, organizationId, gradeId: gradeOneId, name: '一年级 A 班' },
        { id: classBId, organizationId, gradeId: gradeOneId, name: '一年级 B 班' },
        { id: classCId, organizationId, gradeId: gradeTwoId, name: '二年级 C 班' },
        { id: classSpareId, organizationId, gradeId: gradeTwoId, name: '待删除空班' },
        // 触发器不允许「active 成员关系挂在 disabled 班级上」，所以停用班先建成 active，
        // 由需要它的用例在导入完成后自己改状态（模拟运行期解散班级）。
        { id: classFrozenId, organizationId, gradeId: gradeOneId, name: '待停用班' },
        { id: foreignClassId, organizationId: foreignOrganizationId, gradeId: foreignGradeId, name: '外校班级' },
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
        membership(people.admin.id, wsSchoolId),
        membership(people.platformOperator.id, wsPlatformId),
        membership(people.foreignStudent.id, wsForeignClassId),
        membership(people.foreignAdmin.id, wsForeignSchoolId),
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
        // 被停用的教师授权：必须 fail closed，不得让此人拿到管理角色待遇。
        role(people.studentDemoted.id, wsAId, 'class_teacher', 'class', classAId, 'disabled'),
        role(people.teacherA.id, wsAId, 'class_teacher', 'class', classAId),
        role(people.teacherB.id, wsBId, 'class_teacher', 'class', classBId),
        role(people.gradeLeadOne.id, wsGradeOneId, 'grade_group', 'grade', gradeOneId),
        role(people.gradeAdminTwo.id, wsGradeTwoId, 'grade_admin', 'grade', gradeTwoId),
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
    body: { username: person.username, password: fixture.password },
  })
  assert.equal(response.status, 200, JSON.stringify(response.payload))
  return jar
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
  const open = await harness.createBook({ title: '全组织可见的书' })

  const adminJar = await harness.login(fixture.people.admin)
  const applied = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, restricted.bookId, {
    scope: 'classes',
    classIds: [fixture.classBId],
  })
  assert.equal(applied.status, 200, JSON.stringify(applied.payload))

  // 攻击 A：studentGhost 同时是 wsA 与 wsB 的成员，且在两个空间都有 student 角色分配
  //（模拟转班后旧授权残留）。班级成员关系只有 A 班，按契约 5 换头不得让他读到 B 班的书。
  const ghostJar = await harness.login(fixture.people.studentGhost)
  assertInvisible(await probeAllEntries(baseUrl, ghostJar, fixture.wsAId, restricted), '双空间学生用本班头')
  assertInvisible(await probeAllEntries(baseUrl, ghostJar, fixture.wsBId, restricted), '双空间学生伪造 B 班头')
  assertVisible(await probeAllEntries(baseUrl, ghostJar, fixture.wsBId, open), '双空间学生用 B 班头读无 grants 书')

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
    const real = await request(baseUrl, studentAJar, `/books/${open.bookId}/pages/1`, { workspaceId })
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

test('【攻击面 1.3】孤儿学生（无任何 class_memberships）：无 grants 书可见，有 grants 书一律不可见', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl } = harness
  const restrictedToA = await harness.createBook({ title: '限定 A 班的书' })
  const open = await harness.createBook({ title: '无 grants 的书' })

  const teacherJar = await harness.login(fixture.people.teacherA)
  const applied = await setVisibility(baseUrl, teacherJar, fixture.wsAId, restrictedToA.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId],
  })
  assert.equal(applied.status, 200, JSON.stringify(applied.payload))

  // 孤儿账号的工作空间与 student 角色都指向 A 班，但没有 class_memberships 行。
  // 契约 5 要求班级只认 class_memberships，因此他不算 A 班学生。
  const orphanJar = await harness.login(fixture.people.studentOrphan)
  assertInvisible(await probeAllEntries(baseUrl, orphanJar, fixture.wsAId, restrictedToA), '孤儿学生读受限书')
  assertVisible(await probeAllEntries(baseUrl, orphanJar, fixture.wsAId, open), '孤儿学生读无 grants 书')

  // 真正在 A 班的学生仍然读得到，证明上面的拒绝不是「一刀切全挡」。
  const studentAJar = await harness.login(fixture.people.studentA)
  assertVisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, restrictedToA), 'A 班学生读受限书')
})

test('【攻击面 1.4·现状记录】班级被停用后，该班 grants 与该班学生的实际可见性', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const restrictedToA = await harness.createBook({ title: '限定 A 班后停用班级的书' })
  const open = await harness.createBook({ title: '停用班也该看到的无 grants 书' })

  const adminJar = await harness.login(fixture.people.admin)
  const applied = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, restrictedToA.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId],
  })
  assert.equal(applied.status, 200, JSON.stringify(applied.payload))

  const studentAJar = await harness.login(fixture.people.studentA)
  assertVisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, restrictedToA), '停用前 A 班学生')

  // 停用班级（业务上「班级解散」），grants 行保持不动。
  database.prepare("UPDATE classes SET status = 'disabled' WHERE id = ?").run(fixture.classAId)
  assert.equal(grantRows(database, restrictedToA.bookId).length, 1, 'grants 行不应被班级停用连带删除')

  // 现状记录（契约未写明，交主控裁决）：停用班的成员关系不再被 findUserScope 认可，
  // 该班学生因此失去这本书；无 grants 的书仍然可见。
  assertInvisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, restrictedToA), '停用班学生读本班受限书')
  assertVisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, open), '停用班学生读无 grants 书')

  // 契约要求教师/管理角色不受 grants 过滤影响。
  const adminList = await request(baseUrl, adminJar, '/books', { workspaceId: fixture.wsSchoolId })
  assert.ok(
    adminList.payload.data.items.some((item) => item.id === restrictedToA.bookId),
    '管理角色必须仍能看到这本书',
  )

  // 现状记录：GET visibility 仍把已停用班级列在授权名单里；GET /classes 不再列出它；
  // 再次授权给这个已停用班会被判为超出授权范围。
  const snapshot = await request(baseUrl, adminJar, `/books/${restrictedToA.bookId}/visibility`, {
    workspaceId: fixture.wsSchoolId,
  })
  assert.equal(snapshot.status, 200, JSON.stringify(snapshot.payload))
  assert.deepEqual(snapshot.payload.data.classIds, [fixture.classAId])
  const classes = await request(baseUrl, adminJar, '/classes', { workspaceId: fixture.wsSchoolId })
  assert.equal(
    classes.payload.data.items.some((entry) => entry.id === fixture.classAId),
    false,
    'GET /classes 只列 active 班级',
  )
  const regrant = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, restrictedToA.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId],
  })
  assert.equal(regrant.status, 403, JSON.stringify(regrant.payload))
  assert.equal(regrant.payload.error.code, 'PERMISSION_DENIED')

  // 恢复全组织可见这条逃生通道必须仍然可用，否则书会永久锁死。
  const reopened = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, restrictedToA.bookId, {
    scope: 'organization',
  })
  assert.equal(reopened.status, 200, JSON.stringify(reopened.payload))
  assert.equal(grantRows(database, restrictedToA.bookId).length, 0)
  assertVisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, restrictedToA), '恢复全组织可见后')
})

test('【攻击面 1.4·现状记录】学生本身就在停用班里时的待遇', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const restrictedToFrozen = await harness.createBook({ title: '限定停用班的书' })
  const open = await harness.createBook({ title: '无 grants 的书' })

  // 运行期解散这个班：班级行置为 disabled，成员关系仍然是 active。
  database.prepare("UPDATE classes SET status = 'disabled' WHERE id = ?").run(fixture.classFrozenId)

  // 停用班无法通过 HTTP 被授权（listAuthorizedClasses 只认 active 班），
  // 因此这里直连领域夹具写 grants，纯粹为了把「grants 指向停用班」这个状态造出来。
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
      bookId: restrictedToFrozen.bookId,
      scope: 'classes',
      classIds: [fixture.classFrozenId],
    }),
    (error) => error.code === 'PERMISSION_DENIED',
    '即便绕过 HTTP，领域层也不接受把书授权给已停用班级',
  )

  // 现状记录：停用班学生等价于孤儿学生——无 grants 的书可见，任何有 grants 的书都不可见。
  const frozenJar = await harness.login(fixture.people.studentFrozen)
  assertVisible(await probeAllEntries(baseUrl, frozenJar, fixture.wsFrozenId, open), '停用班学生读无 grants 书')

  const adminJar = await harness.login(fixture.people.admin)
  const applied = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, restrictedToFrozen.bookId, {
    scope: 'classes',
    classIds: [fixture.classBId],
  })
  assert.equal(applied.status, 200, JSON.stringify(applied.payload))
  assertInvisible(
    await probeAllEntries(baseUrl, frozenJar, fixture.wsFrozenId, restrictedToFrozen),
    '停用班学生读受限书',
  )
})

test('【攻击面 1.5/1.6】别名 role_code 均被识别为管理角色；被停用的教师授权 fail closed 降级为学生', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl } = harness
  const restricted = await harness.createBook({ title: '只给 B 班的书' })
  const draft = await harness.createBook({ title: '草稿书', published: false })

  const adminJar = await harness.login(fixture.people.admin)
  const applied = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, restricted.bookId, {
    scope: 'classes',
    classIds: [fixture.classBId],
  })
  assert.equal(applied.status, 200, JSON.stringify(applied.payload))

  // 契约 3：teacher / grade_manager / school_admin / platform_ops 及其四个别名
  // 都必须被识别为管理角色——不受 grants 过滤，也不受发布状态过滤。
  const managers = [
    ['class_teacher 别名', fixture.people.teacherA, fixture.wsAId],
    ['grade_group 别名', fixture.people.gradeLeadOne, fixture.wsGradeOneId],
    ['grade_admin 别名', fixture.people.gradeAdminTwo, fixture.wsGradeTwoId],
    ['school_admin', fixture.people.admin, fixture.wsSchoolId],
    ['platform_operator 别名', fixture.people.platformOperator, fixture.wsPlatformId],
  ]
  for (const [label, person, workspaceId] of managers) {
    const jar = await harness.login(person)
    const list = await request(baseUrl, jar, '/books', { workspaceId })
    assert.equal(list.status, 200, `${label}：${JSON.stringify(list.payload)}`)
    assert.ok(
      list.payload.data.items.some((item) => item.id === restricted.bookId),
      `${label} 必须看到只授权给别班的书`,
    )
    const drafts = await request(baseUrl, jar, '/books?status=draft', { workspaceId })
    assert.equal(drafts.status, 200, `${label} 列草稿：${JSON.stringify(drafts.payload)}`)
    assert.ok(
      drafts.payload.data.items.some((item) => item.id === draft.bookId),
      `${label} 的 ?status=draft 必须生效`,
    )
    const visibility = await request(baseUrl, jar, `/books/${restricted.bookId}/visibility`, { workspaceId })
    assert.equal(visibility.status, 200, `${label} 读可见范围：${JSON.stringify(visibility.payload)}`)
    assert.equal(visibility.payload.data.scope, 'classes')
    assert.deepEqual(visibility.payload.data.classIds, [fixture.classBId])
    // 资产放宽：管理角色可取本组织任意状态书的资产。
    const draftAsset = await request(baseUrl, jar, `/books/assets/${draft.assetId}`, { workspaceId })
    assert.equal(draftAsset.status, 200, `${label} 必须能取草稿书资产：${JSON.stringify(draftAsset.payload)}`)
    // 但 getPage 不放宽：草稿书对所有角色都是 404。
    const draftPage = await request(baseUrl, jar, `/books/${draft.bookId}/pages/1`, { workspaceId })
    assert.equal(draftPage.status, 404, `${label} 取草稿书页必须 404`)
  }

  // 契约 4：查不到「active 的管理角色」就按学生处理。
  // studentDemoted 的 class_teacher 授权是 disabled，但 student 授权仍 active。
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
  assert.equal(demotedWrite.status, 403, JSON.stringify(demotedWrite.payload))
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

  const adminJar = await harness.login(fixture.people.admin)
  const applied = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classBId],
  })
  assert.equal(applied.status, 200, JSON.stringify(applied.payload))
  assert.equal(applied.payload.data.bookVersionId, book.versionId)

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
  assertInvisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, book), 'A 班学生读新增版本后的受限书')
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

test('【攻击面 3.10/3.11】跨组织在全部入口互不可见；外组织 classId 与不存在 classId 同码同文案', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const homeBook = await harness.createBook({ title: '本校书' })
  const foreignBook = await harness.createBook({
    title: '外校书',
    organizationId: fixture.foreignOrganizationId,
    actorId: fixture.people.foreignAdmin.id,
    workspaceId: fixture.wsForeignSchoolId,
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
    '外校学生读本校书',
  )

  // 本校校长对外校书的写路径必须是 404（书不在本组织）。
  const adminJar = await harness.login(fixture.people.admin)
  const foreignWrite = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, foreignBook.bookId, {
    scope: 'organization',
  })
  assert.equal(foreignWrite.status, 404, JSON.stringify(foreignWrite.payload))
  assert.equal(foreignWrite.payload.error.code, 'RESOURCE_NOT_FOUND')

  // 契约 11：外组织 classId 与压根不存在的 classId 必须同码同文案，
  // 不能借错误差异探测「该班在别的组织是否真实存在」。
  const foreignClass = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, homeBook.bookId, {
    scope: 'classes',
    classIds: [fixture.foreignClassId],
  })
  const ghostClass = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, homeBook.bookId, {
    scope: 'classes',
    classIds: [`class-never-existed-${randomUUID()}`],
  })
  assert.equal(foreignClass.status, 403, JSON.stringify(foreignClass.payload))
  assert.equal(ghostClass.status, 403, JSON.stringify(ghostClass.payload))
  assert.equal(foreignClass.payload.error.code, 'PERMISSION_DENIED')
  assert.equal(foreignClass.payload.error.code, ghostClass.payload.error.code)
  assert.equal(
    foreignClass.payload.error.message,
    ghostClass.payload.error.message,
    '外组织班级与不存在的班级必须同文案',
  )
  assert.equal(grantRows(database, homeBook.bookId).length, 0, '被拒的请求不得落任何 grants 行')

  // GET /classes 绝不返回外组织班级。
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

test('【攻击面 4.12/4.13/4.14】授权范围逐层校验：class 不能跨班、grade 不能跨年级、school/platform 可覆盖本组织', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const book = await harness.createBook({ title: '授权范围校验书' })

  // class 范围的班主任：只能授权自己那一个班。
  const teacherAJar = await harness.login(fixture.people.teacherA)
  const own = await setVisibility(baseUrl, teacherAJar, fixture.wsAId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId],
  })
  assert.equal(own.status, 200, JSON.stringify(own.payload))
  for (const [label, classIds] of [
    ['同年级别班', [fixture.classBId]],
    ['别年级班', [fixture.classCId]],
    ['自己班 + 同年级别班', [fixture.classAId, fixture.classBId]],
    ['自己班 + 别年级班', [fixture.classAId, fixture.classCId]],
  ]) {
    const rejected = await setVisibility(baseUrl, teacherAJar, fixture.wsAId, book.bookId, {
      scope: 'classes',
      classIds,
    })
    assert.equal(rejected.status, 403, `class 范围教师授权${label}必须 403：${JSON.stringify(rejected.payload)}`)
    assert.equal(rejected.payload.error.code, 'PERMISSION_DENIED')
  }
  // 被拒的部分集合不得「部分成功」：仍然只有最初那一行。
  assert.deepEqual(grantRows(database, book.bookId).map((row) => row.granteeId), [fixture.classAId])

  // grade 范围：本年级两个班都可以，跨年级不行。
  const gradeOneJar = await harness.login(fixture.people.gradeLeadOne)
  const gradeOk = await setVisibility(baseUrl, gradeOneJar, fixture.wsGradeOneId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId, fixture.classBId],
  })
  assert.equal(gradeOk.status, 200, JSON.stringify(gradeOk.payload))
  const gradeCross = await setVisibility(baseUrl, gradeOneJar, fixture.wsGradeOneId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classCId],
  })
  assert.equal(gradeCross.status, 403, `年级组长不得跨年级：${JSON.stringify(gradeCross.payload)}`)

  // F-1 收紧后，跨授权范围移除会被 403 拦下。此处先由校级操作者把一年级留下的 grants 归零，
  // 以便单独检验 grade 范围的正向授权能力。
  const schoolResetJar = await harness.login(fixture.people.admin)
  const schoolReset = await setVisibility(baseUrl, schoolResetJar, fixture.wsSchoolId, book.bookId, {
    scope: 'organization',
  })
  assert.equal(schoolReset.status, 200, `校级操作者归零 grants 必须 200：${JSON.stringify(schoolReset.payload)}`)

  const gradeTwoJar = await harness.login(fixture.people.gradeAdminTwo)
  const gradeTwoOwn = await setVisibility(baseUrl, gradeTwoJar, fixture.wsGradeTwoId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classCId],
  })
  assert.equal(gradeTwoOwn.status, 200, `二年级主任应能授权本年级班：${JSON.stringify(gradeTwoOwn.payload)}`)

  // school 与 platform 范围：本组织任意班。
  const adminJar = await harness.login(fixture.people.admin)
  const schoolWide = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId, fixture.classBId, fixture.classCId, fixture.classSpareId],
  })
  assert.equal(schoolWide.status, 200, JSON.stringify(schoolWide.payload))
  const platformJar = await harness.login(fixture.people.platformOperator)
  const platformWide = await setVisibility(baseUrl, platformJar, fixture.wsPlatformId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classCId],
  })
  assert.equal(platformWide.status, 200, `平台运维应能授权本组织任意班：${JSON.stringify(platformWide.payload)}`)

  // 别班的班主任不能给自己开门（B 班班主任把书授权给 B 班是合法的；这里验证他不能碰 A 班）。
  const teacherBJar = await harness.login(fixture.people.teacherB)
  const crossTeacher = await setVisibility(baseUrl, teacherBJar, fixture.wsBId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId],
  })
  assert.equal(crossTeacher.status, 403, `B 班班主任不得授权给 A 班：${JSON.stringify(crossTeacher.payload)}`)

  // GET /classes 的动态解析必须与写路径的授权集合一致。
  const teacherClasses = await request(baseUrl, teacherAJar, '/classes', { workspaceId: fixture.wsAId })
  assert.deepEqual(teacherClasses.payload.data.items.map((entry) => entry.id), [fixture.classAId])
  const gradeClasses = await request(baseUrl, gradeOneJar, '/classes', { workspaceId: fixture.wsGradeOneId })
  assert.deepEqual(
    gradeClasses.payload.data.items.map((entry) => entry.id).sort(),
    [fixture.classAId, fixture.classBId, fixture.classFrozenId].sort(),
    '年级范围应列出本年级全部 active 班级',
  )
})

test('【攻击面 4.15】学生打管理接口时，存在的书与不存在的书必须同码同文案（不泄露存在性）', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl } = harness
  const visible = await harness.createBook({ title: '对该学生可见的书' })
  const invisible = await harness.createBook({ title: '对该学生不可见的书' })
  const draft = await harness.createBook({ title: '草稿书', published: false })

  const adminJar = await harness.login(fixture.people.admin)
  const applied = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, invisible.bookId, {
    scope: 'classes',
    classIds: [fixture.classBId],
  })
  assert.equal(applied.status, 200, JSON.stringify(applied.payload))

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

  // PUT visibility / publish / unpublish：学生一律 403，且不因书是否存在而变化。
  const writes = {}
  for (const [label, bookId] of [
    ['可见书', visible.bookId],
    ['不可见书', invisible.bookId],
    ['草稿书', draft.bookId],
    ['不存在的书', missingBookId],
  ]) {
    writes[label] = await setVisibility(baseUrl, studentJar, fixture.wsAId, bookId, { scope: 'organization' })
    assert.equal(writes[label].status, 403, `学生写${label}的可见范围必须 403：${JSON.stringify(writes[label].payload)}`)
    assert.equal(writes[label].payload.error.code, 'PERMISSION_DENIED')
  }
  assert.equal(
    new Set(Object.values(writes).map((entry) => entry.payload.error.message)).size,
    1,
    '学生写可见范围的文案必须唯一，否则泄露书是否存在',
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

test('【攻击面 5.16】学生的 ?status 参数被静默锁死为 published；资产放宽只对管理角色生效', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl } = harness
  const published = await harness.createBook({ title: '已发布书' })
  const draft = await harness.createBook({ title: '草稿书', published: false })
  const archived = await harness.createBook({ title: '归档书', archived: true })

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

  // 教师侧：?status 生效、任意状态资产可取、但 getPage 不放宽。
  const teacherJar = await harness.login(fixture.people.teacherA)
  const teacherDrafts = await request(baseUrl, teacherJar, '/books?status=draft', { workspaceId: fixture.wsAId })
  assert.deepEqual(teacherDrafts.payload.data.items.map((item) => item.id), [draft.bookId])
  const teacherArchived = await request(baseUrl, teacherJar, '/books?status=archived', { workspaceId: fixture.wsAId })
  assert.deepEqual(teacherArchived.payload.data.items.map((item) => item.id), [archived.bookId])
  for (const [label, book] of [['草稿书', draft], ['归档书', archived]]) {
    const asset = await request(baseUrl, teacherJar, `/books/assets/${book.assetId}`, { workspaceId: fixture.wsAId })
    assert.equal(asset.status, 200, `教师取${label}资产应 200：${JSON.stringify(asset.payload)}`)
    const page = await request(baseUrl, teacherJar, `/books/${book.bookId}/pages/1`, { workspaceId: fixture.wsAId })
    assert.equal(page.status, 404, `getPage 对${label}不放宽，教师也必须 404`)
  }
})

test('【攻击面 5.17/5.18】幂等：缺键 400、同键同体重放、同键异体 409，grants 与审计行数都不变', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const book = await harness.createBook({ title: '幂等守卫书' })
  const teacherJar = await harness.login(fixture.people.teacherA)

  const missingKey = await request(baseUrl, teacherJar, `/books/${book.bookId}/visibility`, {
    method: 'PUT',
    workspaceId: fixture.wsAId,
    body: { scope: 'classes', classIds: [fixture.classAId] },
  })
  assert.equal(missingKey.status, 400, JSON.stringify(missingKey.payload))
  assert.equal(missingKey.payload.error.code, 'VALIDATION_FAILED')
  assert.equal(grantRows(database, book.bookId).length, 0)

  const key = 'guard-fixed-key'
  const first = await setVisibility(baseUrl, teacherJar, fixture.wsAId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId],
  }, key)
  assert.equal(first.status, 200, JSON.stringify(first.payload))
  assert.equal(first.payload.meta?.replayed, undefined)
  assert.equal(grantRows(database, book.bookId).length, 1)
  assert.equal(auditCount(database, book.bookId), 1)

  const replay = await setVisibility(baseUrl, teacherJar, fixture.wsAId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId],
  }, key)
  assert.equal(replay.status, 200, JSON.stringify(replay.payload))
  assert.equal(replay.payload.meta.replayed, true)
  assert.equal(grantRows(database, book.bookId).length, 1, '重放不得产生第二行 grants')
  assert.equal(auditCount(database, book.bookId), 1, '重放不得产生第二条审计事件')

  // 同键异体：期望 409 IDEMPOTENCY_CONFLICT，且不得偷偷改写状态。
  const conflict = await setVisibility(baseUrl, teacherJar, fixture.wsAId, book.bookId, {
    scope: 'organization',
  }, key)
  assert.equal(conflict.status, 409, `同键异体必须 409：${JSON.stringify(conflict.payload)}`)
  assert.equal(conflict.payload.error.code, 'IDEMPOTENCY_CONFLICT')
  assert.deepEqual(grantRows(database, book.bookId).map((row) => row.granteeId), [fixture.classAId])
  assert.equal(auditCount(database, book.bookId), 1)

  // 学生在这期间的可见性没有被冲突请求带偏。
  const studentBJar = await harness.login(fixture.people.studentB)
  assertInvisible(await probeAllEntries(baseUrl, studentBJar, fixture.wsBId, book), '幂等冲突后 B 班学生')
  const studentAJar = await harness.login(fixture.people.studentA)
  assertVisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, book), '幂等冲突后 A 班学生')
})

test('【攻击面 5.19】organization → classes → organization 反复切换后状态干净、无残留 grants', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const book = await harness.createBook({ title: '反复切换书' })
  const adminJar = await harness.login(fixture.people.admin)
  const studentAJar = await harness.login(fixture.people.studentA)
  const studentBJar = await harness.login(fixture.people.studentB)

  const steps = [
    { body: { scope: 'organization' }, grants: [], aVisible: true, bVisible: true },
    { body: { scope: 'classes', classIds: [fixture.classAId] }, grants: [fixture.classAId], aVisible: true, bVisible: false },
    { body: { scope: 'organization' }, grants: [], aVisible: true, bVisible: true },
    { body: { scope: 'classes', classIds: [fixture.classBId] }, grants: [fixture.classBId], aVisible: false, bVisible: true },
    { body: { scope: 'classes', classIds: [fixture.classAId, fixture.classBId] }, grants: [fixture.classAId, fixture.classBId].sort(), aVisible: true, bVisible: true },
    { body: { scope: 'organization' }, grants: [], aVisible: true, bVisible: true },
  ]
  let expectedAudits = 0
  for (const [index, step] of steps.entries()) {
    const response = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, step.body)
    assert.equal(response.status, 200, `第 ${index + 1} 步：${JSON.stringify(response.payload)}`)
    expectedAudits += 1
    assert.deepEqual(
      grantRows(database, book.bookId).map((row) => row.granteeId),
      step.grants,
      `第 ${index + 1} 步 grants 行不符`,
    )
    assert.equal(
      response.payload.data.scope,
      step.grants.length > 0 ? 'classes' : 'organization',
      `第 ${index + 1} 步返回的 scope 不符`,
    )
    assert.deepEqual(response.payload.data.classIds, step.grants, `第 ${index + 1} 步返回的 classIds 不符`)
    assert.equal(auditCount(database, book.bookId), expectedAudits, `第 ${index + 1} 步审计条数不符`)

    const probeA = await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, book)
    if (step.aVisible) assertVisible(probeA, `第 ${index + 1} 步 A 班学生`)
    else assertInvisible(probeA, `第 ${index + 1} 步 A 班学生`)
    const probeB = await probeAllEntries(baseUrl, studentBJar, fixture.wsBId, book)
    if (step.bVisible) assertVisible(probeB, `第 ${index + 1} 步 B 班学生`)
    else assertInvisible(probeB, `第 ${index + 1} 步 B 班学生`)
  }
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM book_access_grants').get().count,
    0,
    '全流程结束后整张 book_access_grants 必须没有残留',
  )
})

// ===========================================================================
// 攻击面六：边界数据
// ===========================================================================

test('【攻击面 6.21】classIds 边界：重复值、空串、非字符串、超长数组、organization + classIds', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const book = await harness.createBook({ title: '参数边界书' })
  const adminJar = await harness.login(fixture.people.admin)

  // 重复值：去重成一行，不得写出重复 grants。
  const duplicated = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId, fixture.classAId, fixture.classAId],
  })
  assert.equal(duplicated.status, 200, JSON.stringify(duplicated.payload))
  assert.deepEqual(duplicated.payload.data.classIds, [fixture.classAId])
  assert.equal(grantRows(database, book.bookId).length, 1)

  // 422 家族：scope 非法、classes 但空、非字符串元素、空串元素、classIds 非数组。
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
  ]) {
    const response = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, body)
    assert.equal(response.status, 422, `${label} 必须 422：${response.status} ${JSON.stringify(response.payload)}`)
    assert.equal(response.payload.error.code, 'VALIDATION_FAILED', `${label} 错误码`)
  }
  // 参数校验失败不得改动既有状态。
  assert.deepEqual(grantRows(database, book.bookId).map((row) => row.granteeId), [fixture.classAId])

  // scope=organization 带空数组：等价于不带（无 classIds），应当被接受。
  const emptyArray = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, {
    scope: 'organization',
    classIds: [],
  })
  assert.equal(emptyArray.status, 200, `organization + 空数组：${JSON.stringify(emptyArray.payload)}`)
  assert.equal(grantRows(database, book.bookId).length, 0)

  // 超长数组：夹带一个合法班级 + 大量伪造班级，必须整体 403 且一行不落。
  const flood = [fixture.classAId, ...Array.from({ length: 400 }, (_, index) => `flood-class-${index}-${randomUUID()}`)]
  const flooded = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, {
    scope: 'classes',
    classIds: flood,
  })
  assert.equal(flooded.status, 403, `超长伪造数组必须 403：${flooded.status} ${JSON.stringify(flooded.payload)}`)
  assert.equal(flooded.payload.error.code, 'PERMISSION_DENIED')
  assert.equal(grantRows(database, book.bookId).length, 0, '被拒的批量请求不得部分写入')

  // 全部合法的超长数组（重复 400 次同一个班）仍然只写一行。
  const repeated = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, {
    scope: 'classes',
    classIds: Array.from({ length: 400 }, () => fixture.classAId),
  })
  assert.equal(repeated.status, 200, JSON.stringify(repeated.payload))
  assert.equal(grantRows(database, book.bookId).length, 1)

  // 前后空白应被归一化到同一个班级，不得写出两行。
  const padded = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId, ` ${fixture.classAId} `],
  })
  assert.equal(padded.status, 200, JSON.stringify(padded.payload))
  assert.equal(grantRows(database, book.bookId).length, 1)
})

test('【攻击面 6.20/6.22】grants 指向已删除班级；draft + grants 组合下教师与学生的表现', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const orphanGrant = await harness.createBook({ title: 'grants 指向已删除班级的书' })
  const draftRestricted = await harness.createBook({ title: '草稿且限定 B 班的书', published: false })

  const adminJar = await harness.login(fixture.people.admin)
  const teacherBJar = await harness.login(fixture.people.teacherB)
  const studentAJar = await harness.login(fixture.people.studentA)
  const studentBJar = await harness.login(fixture.people.studentB)

  // 6.20：授权给一个空班，然后把班级行删掉，grants 变成悬空引用。
  const granted = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, orphanGrant.bookId, {
    scope: 'classes',
    classIds: [fixture.classSpareId],
  })
  assert.equal(granted.status, 200, JSON.stringify(granted.payload))
  database.prepare('DELETE FROM classes WHERE id = ?').run(fixture.classSpareId)
  assert.equal(grantRows(database, orphanGrant.bookId).length, 1, 'grants 行不随班级删除而消失')

  // 现状记录：悬空 grants 让这本书对所有学生不可见（谁都不在这个班里），管理角色仍可见。
  assertInvisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, orphanGrant), '悬空 grants 对 A 班学生')
  assertInvisible(await probeAllEntries(baseUrl, studentBJar, fixture.wsBId, orphanGrant), '悬空 grants 对 B 班学生')
  const orphanSnapshot = await request(baseUrl, adminJar, `/books/${orphanGrant.bookId}/visibility`, {
    workspaceId: fixture.wsSchoolId,
  })
  assert.equal(orphanSnapshot.status, 200, JSON.stringify(orphanSnapshot.payload))
  assert.equal(orphanSnapshot.payload.data.scope, 'classes')
  assert.deepEqual(orphanSnapshot.payload.data.classIds, [fixture.classSpareId])
  assert.deepEqual(orphanSnapshot.payload.data.classes, [{ id: fixture.classSpareId, name: null, gradeId: null }])
  // 逃生通道：恢复全组织可见必须能清掉悬空 grants。
  const cleared = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, orphanGrant.bookId, {
    scope: 'organization',
  })
  assert.equal(cleared.status, 200, JSON.stringify(cleared.payload))
  assert.equal(grantRows(database, orphanGrant.bookId).length, 0)
  assertVisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, orphanGrant), '清掉悬空 grants 后')

  // 6.22：draft + grants 同时成立。被授权班的学生也必须什么都看不到（published 约束优先）。
  const draftApplied = await setVisibility(baseUrl, teacherBJar, fixture.wsBId, draftRestricted.bookId, {
    scope: 'classes',
    classIds: [fixture.classBId],
  })
  assert.equal(draftApplied.status, 200, `草稿书也应能设置可见范围：${JSON.stringify(draftApplied.payload)}`)
  assertInvisible(
    await probeAllEntries(baseUrl, studentBJar, fixture.wsBId, draftRestricted),
    '草稿 + 被授权班学生',
  )
  assertInvisible(
    await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, draftRestricted),
    '草稿 + 未授权班学生',
  )
  // 教师侧：草稿列表里能看到、能读可见范围、能取资产，但读不到页。
  const draftList = await request(baseUrl, teacherBJar, '/books?status=draft', { workspaceId: fixture.wsBId })
  assert.ok(draftList.payload.data.items.some((item) => item.id === draftRestricted.bookId))
  const draftVisibility = await request(baseUrl, teacherBJar, `/books/${draftRestricted.bookId}/visibility`, {
    workspaceId: fixture.wsBId,
  })
  assert.equal(draftVisibility.status, 200, JSON.stringify(draftVisibility.payload))
  assert.deepEqual(draftVisibility.payload.data.classIds, [fixture.classBId])
  const draftAsset = await request(baseUrl, teacherBJar, `/books/assets/${draftRestricted.assetId}`, {
    workspaceId: fixture.wsBId,
  })
  assert.equal(draftAsset.status, 200, `教师取草稿书资产应 200：${JSON.stringify(draftAsset.payload)}`)
  const draftPage = await request(baseUrl, teacherBJar, `/books/${draftRestricted.bookId}/pages/1`, {
    workspaceId: fixture.wsBId,
  })
  assert.equal(draftPage.status, 404, 'getPage 的 published 约束对教师也不放宽')

  // 发布之后，被授权班学生立刻可见，未授权班仍不可见。
  const publishedNow = await request(baseUrl, teacherBJar, `/books/${draftRestricted.bookId}/publish`, {
    method: 'POST',
    workspaceId: fixture.wsBId,
    idempotencyKey: `guard-publish-${randomUUID()}`,
    body: {},
  })
  assert.equal(publishedNow.status, 200, JSON.stringify(publishedNow.payload))
  assertVisible(await probeAllEntries(baseUrl, studentBJar, fixture.wsBId, draftRestricted), '发布后被授权班学生')
  assertInvisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, draftRestricted), '发布后未授权班学生')
})

// ===========================================================================
// 现状记录：契约没覆盖的相邻入口。这些用例按实际行为断言，交主控裁决是否收口。
// ===========================================================================

test('【现状记录·待裁决】阅读安排与阅读租约两个相邻入口未过班级可见范围', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl } = harness
  const book = await harness.createBook({ title: '先布置后收窄的书' })

  // A 班班主任在 A 班工作空间里给 A 班布置这本书。
  const teacherAJar = await harness.login(fixture.people.teacherA)
  const assignment = await request(baseUrl, teacherAJar, '/assignments', {
    method: 'POST',
    workspaceId: fixture.wsAId,
    idempotencyKey: `guard-assignment-${randomUUID()}`,
    body: { bookVersionId: book.versionId, title: 'A 班共读', classIds: [fixture.classAId] },
  })
  assert.equal(assignment.status, 201, JSON.stringify(assignment.payload))

  // 校长随后把这本书收窄到 B 班，A 班就此失去访问权（impact 里会明确报出来）。
  const adminJar = await harness.login(fixture.people.admin)
  const narrowed = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classBId],
  })
  assert.equal(narrowed.status, 200, JSON.stringify(narrowed.payload))
  assert.equal(narrowed.payload.data.impact.affectedArrangementCount, 1)

  const studentAJar = await harness.login(fixture.people.studentA)
  assertInvisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, book), '收窄后 A 班学生的五个契约入口')

  // 现状记录 1：GET /assignments 未过可见范围，A 班学生仍能拿到这本书的书名与 bookVersionId。
  const assignments = await request(baseUrl, studentAJar, '/assignments', { workspaceId: fixture.wsAId })
  assert.equal(assignments.status, 200, JSON.stringify(assignments.payload))
  const leaked = assignments.payload.data.items.find((item) => item.book?.id === book.versionId)
  assert.ok(leaked, '现状：阅读安排仍然把不可见书的版本 id 返回给未授权班学生')
  assert.equal(leaked.book.title, book.title, '现状：阅读安排连书名一起返回')

  // 现状记录 2：POST /reading/lease 只校验「本组织存在该版本」，不过 grants，也不过发布状态。
  const lease = await request(baseUrl, studentAJar, '/reading/lease', {
    method: 'POST',
    workspaceId: fixture.wsAId,
    idempotencyKey: `guard-lease-${randomUUID()}`,
    body: { bookVersionId: book.versionId },
  })
  assert.equal(
    lease.status,
    200,
    `现状：不可见书仍可获取阅读租约（若此处变成 404，说明实现已收口，请更新本记录）：${JSON.stringify(lease.payload)}`,
  )

  const draft = await harness.createBook({ title: '草稿书', published: false })
  const draftLease = await request(baseUrl, studentAJar, '/reading/lease', {
    method: 'POST',
    workspaceId: fixture.wsAId,
    idempotencyKey: `guard-lease-draft-${randomUUID()}`,
    body: { bookVersionId: draft.versionId, takeover: true },
  })
  assert.equal(
    draftLease.status,
    200,
    `现状：草稿书版本也能被学生取到租约：${JSON.stringify(draftLease.payload)}`,
  )
})

// 主控已裁决收口 F-1。本用例原先断言「攻击成功、返回 200」，现改为断言整条利用链被 403 挡住，
// 覆盖范围不变：显式授权别班被拒 → 改用 organization → 现在也应被拒 → 校长的 grants 行未被破坏。
test('【F-1 已收口】class 范围教师既不能用 scope=organization 绕过班级授权范围，也不能撤销校长设置的别班授权', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const book = await harness.createBook({ title: '校长限定给 C 班的书' })

  // 校长把书限定给 C 班（C 班在二年级，完全在 A 班班主任的授权范围之外）。
  const adminJar = await harness.login(fixture.people.admin)
  const restricted = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classCId],
  })
  assert.equal(restricted.status, 200, JSON.stringify(restricted.payload))

  const studentBJar = await harness.login(fixture.people.studentB)
  assertInvisible(await probeAllEntries(baseUrl, studentBJar, fixture.wsBId, book), '校长收窄后 B 班学生')

  // 利用链第一步：A 班班主任显式授权给 B 班 —— 被正确拦住（新增侧校验，收口前就有）。
  const teacherAJar = await harness.login(fixture.people.teacherA)
  const explicit = await setVisibility(baseUrl, teacherAJar, fixture.wsAId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classBId],
  })
  assert.equal(explicit.status, 403, `显式授权别班必须 403：${JSON.stringify(explicit.payload)}`)
  assert.equal(explicit.payload.error.code, 'PERMISSION_DENIED')

  // 利用链第二步：同一个班主任改用 scope=organization。这是「授权给全部班」，
  // 是上一步刚被 403 拒掉的请求的超集，因此必须同样被拒 —— 收口前这里返回 200。
  const widened = await setVisibility(baseUrl, teacherAJar, fixture.wsAId, book.bookId, { scope: 'organization' })
  assert.equal(widened.status, 403, `放开到全组织必须 403：${JSON.stringify(widened.payload)}`)
  assert.equal(widened.payload.error.code, 'PERMISSION_DENIED')
  assert.deepEqual(
    widened.payload.error.details.classIds,
    [fixture.classCId],
    'details.classIds 必须给出被拒的班级：要移除、却不在操作者授权范围内的 C 班',
  )
  // 校长的 grants 行必须完好无损，B 班学生也没有拿到第一步刚被拒绝授予的那份访问权。
  assert.deepEqual(
    grantRows(database, book.bookId).map((row) => row.granteeId),
    [fixture.classCId],
    '被拒的 organization 请求不得删掉校长设置的 grants 行',
  )
  assertInvisible(
    await probeAllEntries(baseUrl, studentBJar, fixture.wsBId, book),
    'organization 被拒后 B 班学生仍然读不到这本书',
  )

  // 利用链第三步：改成收窄到自己班，等价于删掉校长给 C 班的授权 —— 同样必须被拒。
  const hijacked = await setVisibility(baseUrl, teacherAJar, fixture.wsAId, book.bookId, {
    scope: 'classes',
    classIds: [fixture.classAId],
  })
  assert.equal(hijacked.status, 403, `覆盖校长的别班授权必须 403：${JSON.stringify(hijacked.payload)}`)
  assert.equal(hijacked.payload.error.code, 'PERMISSION_DENIED')
  assert.deepEqual(hijacked.payload.error.details.classIds, [fixture.classCId])
  assert.deepEqual(
    grantRows(database, book.bookId).map((row) => row.granteeId),
    [fixture.classCId],
    '校长给 C 班的授权不得被 A 班班主任的写入覆盖',
  )

  // 同一个班主任仍然能下架任意本组织书籍，让全校都看不到（发布权按工作空间判定，不按书判定）。
  // 这条与 F-1 无关，属于更大的权限模型问题，仍按实际行为记录，交主控裁决。
  const unpublished = await request(baseUrl, teacherAJar, `/books/${book.bookId}/unpublish`, {
    method: 'POST',
    workspaceId: fixture.wsAId,
    idempotencyKey: `guard-unpublish-${randomUUID()}`,
    body: {},
  })
  assert.equal(
    unpublished.status,
    200,
    `现状：class 范围教师可下架任意本组织书籍：${JSON.stringify(unpublished.payload)}`,
  )
  const studentAJar = await harness.login(fixture.people.studentA)
  assertInvisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, book), '被下架后连本班学生也看不到')
})

test('GET /classes 权限矩阵：多种学生人格一律 403；platform_ops 缺 class.read 的实际表现', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl } = harness

  // 契约：学生 403 PERMISSION_DENIED。三种学生人格都验一遍。
  for (const [label, person, workspaceId] of [
    ['普通学生', fixture.people.studentA, fixture.wsAId],
    ['孤儿学生', fixture.people.studentOrphan, fixture.wsAId],
    ['被塞进校务空间的学生', fixture.people.studentSchoolMember, fixture.wsSchoolId],
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

test('【F-4 已收口】非 class 类型的 grants 行不再让「恢复全组织可见」失效，但 GET visibility 仍谎报 organization', async (t) => {
  const harness = await startHarness(t)
  const { fixture, baseUrl, database } = harness
  const book = await harness.createBook({ title: '被非 class grants 卡住的书' })
  const adminJar = await harness.login(fixture.people.admin)
  const studentAJar = await harness.login(fixture.people.studentA)

  assertVisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, book), '插入前')

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

  // 现状：一行 grantee_type='user' 就让这本书对所有学生消失。
  assertInvisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, book), '插入非 class grants 后')

  // 现状：GET visibility 只统计 class grants，因此报告 scope='organization'——与学生实际看到的相反。
  const snapshot = await request(baseUrl, adminJar, `/books/${book.bookId}/visibility`, {
    workspaceId: fixture.wsSchoolId,
  })
  assert.equal(snapshot.status, 200, JSON.stringify(snapshot.payload))
  assert.equal(snapshot.payload.data.scope, 'organization', '现状：管理端读到的 scope 与学生实际可见性不一致')
  assert.deepEqual(snapshot.payload.data.classIds, [])

  // F-4 已收口：scope=organization 会清掉全部 grants 行，书恢复全组织可见。
  const reopened = await setVisibility(baseUrl, adminJar, fixture.wsSchoolId, book.bookId, { scope: 'organization' })
  assert.equal(reopened.status, 200, JSON.stringify(reopened.payload))
  assert.equal(
    grantRows(database, book.bookId).length,
    0,
    'F-4：scope=organization 必须清掉任何 grantee_type 的 grants 行',
  )
  assertVisible(await probeAllEntries(baseUrl, studentAJar, fixture.wsAId, book), '恢复全组织可见之后应可见')
})
