import { normalizeRoleCode } from './permissions.js'

function toUser(record) {
  if (!record) {
    return null
  }
  return {
    id: record.id,
    organizationId: record.organization_id,
    username: record.username,
    loginName: record.login_name ?? null,
    accountCode: record.account_code ?? null,
    displayName: record.display_name,
    status: record.status,
    version: record.version,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
}

function toWorkspace(record) {
  if (!record) {
    return null
  }
  return {
    id: record.id,
    organizationId: record.organization_id,
    code: record.code,
    name: record.name,
    scopeType: record.scope_type,
    scopeId: record.scope_id,
    status: record.status,
    version: record.version,
  }
}

function activeWorkspaceQuery(whereClause, joinClause = '') {
  return `
    SELECT
      workspaces.id,
      workspaces.organization_id,
      workspaces.code,
      workspaces.name,
      workspaces.scope_type,
      workspaces.scope_id,
      workspaces.status,
      workspaces.version
    FROM workspaces
    JOIN workspace_memberships ON workspace_memberships.workspace_id = workspaces.id
    JOIN users ON users.id = workspace_memberships.user_id
    JOIN organizations ON organizations.id = users.organization_id
    ${joinClause}
    WHERE workspace_memberships.user_id = ?
      AND workspace_memberships.status = 'active'
      AND users.status = 'active'
      AND organizations.status = 'active'
      AND workspaces.status = 'active'
      AND (
        (
          workspaces.scope_type = 'platform'
          AND (workspaces.organization_id IS NULL OR workspaces.organization_id = users.organization_id)
        )
        OR (
          workspaces.scope_type <> 'platform'
          AND workspaces.organization_id = users.organization_id
        )
      )
      ${whereClause}
  `
}

export function findUserById(database, userId) {
  return toUser(
    database
      .prepare(`
        SELECT id, organization_id, username, login_name, account_code, display_name, status, version, created_at, updated_at
        FROM users
        WHERE id = ?
      `)
      .get(userId),
  )
}

export function findUserByUsername(database, username) {
  return toUser(
    database
      .prepare(`
        SELECT id, organization_id, username, login_name, account_code, display_name, status, version, created_at, updated_at
        FROM users
        WHERE username = ?
      `)
      .get(username),
  )
}

export function findActiveClassScope(database, classId) {
  const record = database
    .prepare(`
      SELECT classes.id, classes.organization_id, classes.grade_id, classes.name, classes.status
      FROM classes
      JOIN organizations
        ON organizations.id = classes.organization_id
        AND organizations.status = 'active'
      WHERE classes.id = ?
        AND classes.status = 'active'
    `)
    .get(classId)
  if (!record) return null
  return {
    type: 'class',
    id: record.id,
    classId: record.id,
    gradeId: record.grade_id,
    organizationId: record.organization_id,
    name: record.name,
    status: record.status,
  }
}

export function createClassWithWorkspace(database, record) {
  database
    .prepare(`
      INSERT INTO classes (
        id, organization_id, grade_id, name, stage, entry_year, class_number,
        status, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 1)
    `)
    .run(
      record.classId,
      record.organizationId,
      record.gradeId,
      record.name,
      record.stage,
      record.entryYear,
      record.classNumber,
      record.now,
      record.now,
    )
  database
    .prepare(`
      INSERT INTO workspaces (
        id, organization_id, code, name, scope_type, scope_id,
        status, created_at, updated_at, version
      ) VALUES (?, ?, 'class-teacher', ?, 'class', ?, 'active', ?, ?, 1)
    `)
    .run(record.workspaceId, record.organizationId, record.name, record.classId, record.now, record.now)
  return {
    id: record.classId,
    organizationId: record.organizationId,
    gradeId: record.gradeId,
    name: record.name,
    stage: record.stage,
    entryYear: record.entryYear,
    classNumber: record.classNumber,
    status: 'active',
    version: 1,
    workspaceId: record.workspaceId,
  }
}

export function createStudentAccount(database, record) {
  database
    .prepare(`
      INSERT INTO users (
        id, organization_id, username, display_name, status, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, 1)
    `)
    .run(record.userId, record.organizationId, record.username, record.displayName, record.now, record.now)
  database
    .prepare(`
      INSERT INTO credentials (
        id, user_id, password_hash, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, 1)
    `)
    .run(record.credentialId, record.userId, record.passwordHash, record.now, record.now)
  database
    .prepare(`
      INSERT INTO class_memberships (
        id, class_id, user_id, membership_role, status, created_at, updated_at, version
      ) VALUES (?, ?, ?, 'student', 'active', ?, ?, 1)
    `)
    .run(record.classMembershipId, record.classId, record.userId, record.now, record.now)
  database
    .prepare(`
      INSERT INTO workspace_memberships (
        id, user_id, workspace_id, status, created_at, updated_at, version
      ) VALUES (?, ?, ?, 'active', ?, ?, 1)
    `)
    .run(record.workspaceMembershipId, record.userId, record.workspaceId, record.now, record.now)
  database
    .prepare(`
      INSERT INTO role_assignments (
        id, organization_id, user_id, workspace_id, role_code,
        scope_type, scope_id, status, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, 'student', 'class', ?, 'active', ?, ?, 1)
    `)
    .run(
      record.roleAssignmentId,
      record.organizationId,
      record.userId,
      record.workspaceId,
      record.classId,
      record.now,
      record.now,
    )
  return findUserById(database, record.userId)
}

export function findActiveClassWorkspace(database, classId, organizationId) {
  return toWorkspace(
    database
      .prepare(`
        SELECT id, organization_id, code, name, scope_type, scope_id, status, version
        FROM workspaces
        WHERE organization_id = ?
          AND scope_type = 'class'
          AND scope_id = ?
          AND status = 'active'
        ORDER BY id
        LIMIT 1
      `)
      .get(organizationId, classId),
  )
}

export function findUserScope(database, userId) {
  const user = database
    .prepare(`
      SELECT
        users.id,
        users.organization_id
      FROM users
      JOIN organizations ON organizations.id = users.organization_id
      WHERE users.id = ?
        AND users.status = 'active'
        AND organizations.status = 'active'
    `)
    .get(userId)
  if (!user) {
    return null
  }

  const resources = database
    .prepare(`
      SELECT classes.id AS class_id, classes.grade_id
      FROM class_memberships
      JOIN classes
        ON classes.id = class_memberships.class_id
        AND classes.organization_id = ?
        AND classes.status = 'active'
      JOIN organizations
        ON organizations.id = classes.organization_id
        AND organizations.status = 'active'
      WHERE class_memberships.user_id = ?
        AND class_memberships.status = 'active'
    `)
    .all(user.organization_id, user.id)

  return {
    ownerId: user.id,
    organizationId: user.organization_id,
    classIds: [...new Set(resources.map((record) => record.class_id))],
    gradeIds: [...new Set(resources.map((record) => record.grade_id).filter(Boolean))],
  }
}

export function updateUserDisplayName(database, userId, displayName, expectedVersion, now) {
  const result = database
    .prepare(`
      UPDATE users
      SET display_name = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND version = ?
    `)
    .run(displayName, now, userId, expectedVersion)

  return result.changes === 1 ? findUserById(database, userId) : null
}

export function updateOwnDisplayName(database, userId, displayName, now) {
  const result = database
    .prepare(`
      UPDATE users
      SET display_name = ?, updated_at = ?, version = version + 1
      WHERE id = ?
    `)
    .run(displayName, now, userId)

  return result.changes === 1 ? findUserById(database, userId) : null
}

export function listWorkspacesForUser(database, userId) {
  const records = database
    .prepare(`
      ${activeWorkspaceQuery('', `
        LEFT JOIN classes
          ON classes.id = workspaces.scope_id
          AND workspaces.scope_type = 'class'
      `)}
      ORDER BY workspaces.code, classes.entry_year, classes.class_number, workspaces.name
    `)
    .all(userId)
  return records.map(toWorkspace)
}

export function findWorkspaceForUser(database, userId, workspaceId) {
  const record = database
    .prepare(activeWorkspaceQuery('AND workspaces.id = ?'))
    .get(userId, workspaceId)
  return toWorkspace(record)
}

export function listActiveRoleAssignments(database, userId, workspaceId, organizationId) {
  return database
    .prepare(`
      SELECT
        assignments.organization_id,
        assignments.workspace_id,
        assignments.role_code,
        assignments.scope_type,
        assignments.scope_id
      FROM role_assignments AS assignments
      JOIN users AS actors
        ON actors.id = assignments.user_id
        AND actors.organization_id = assignments.organization_id
        AND actors.status = 'active'
      JOIN organizations
        ON organizations.id = assignments.organization_id
        AND organizations.status = 'active'
      JOIN workspaces
        ON workspaces.id = assignments.workspace_id
        AND workspaces.organization_id = assignments.organization_id
        AND workspaces.scope_type = assignments.scope_type
        AND workspaces.scope_id = assignments.scope_id
        AND workspaces.status = 'active'
      JOIN workspace_memberships AS memberships
        ON memberships.user_id = actors.id
        AND memberships.workspace_id = workspaces.id
        AND memberships.status = 'active'
      WHERE assignments.user_id = ?
        AND assignments.workspace_id = ?
        AND assignments.organization_id = ?
        AND assignments.status = 'active'
    `)
    .all(userId, workspaceId, organizationId)
    .map((record) => ({
      organizationId: record.organization_id,
      workspaceId: record.workspace_id,
      roleCode: record.role_code,
      scopeType: record.scope_type,
      scopeId: record.scope_id,
    }))
}

function toClass(record) {
  if (!record) return null
  return {
    id: record.id,
    organizationId: record.organization_id,
    name: record.name,
    stage: record.stage ?? null,
    entryYear: record.entry_year ?? null,
    classNumber: record.class_number ?? null,
    gradeId: record.grade_id ?? null,
    status: record.status,
    version: record.version,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
}

const CLASS_COLUMNS = `
  id, organization_id, name, stage, entry_year, class_number, grade_id, status, version, created_at, updated_at
`

export function findCredentialByLoginName(database, loginName) {
  const record = database
    .prepare(`
      SELECT
        users.id,
        users.organization_id,
        users.username,
        users.login_name,
        users.account_code,
        users.display_name,
        users.status,
        users.version,
        users.created_at,
        users.updated_at,
        organizations.status AS organization_status,
        credentials.password_hash
      FROM users
      JOIN organizations ON organizations.id = users.organization_id
      JOIN credentials ON credentials.user_id = users.id
      WHERE users.login_name = ? COLLATE NOCASE
    `)
    .get(loginName)

  if (!record) {
    return null
  }
  return {
    user: toUser(record),
    organizationStatus: record.organization_status,
    passwordHash: record.password_hash,
  }
}

export function findPasswordHashByUserId(database, userId) {
  const record = database.prepare('SELECT password_hash FROM credentials WHERE user_id = ?').get(userId)
  return record?.password_hash ?? null
}

export function findOrganizationById(database, organizationId) {
  const record = database
    .prepare('SELECT id, name, school_code, status, version FROM organizations WHERE id = ?')
    .get(organizationId)
  if (!record) return null
  return {
    id: record.id,
    name: record.name,
    schoolCode: record.school_code,
    status: record.status,
    version: record.version,
  }
}

export function findClassById(database, classId) {
  return toClass(database.prepare(`SELECT ${CLASS_COLUMNS} FROM classes WHERE id = ?`).get(classId))
}

export function findLoginName(database, loginName) {
  return toUser(
    database
      .prepare(`
        SELECT id, organization_id, username, login_name, account_code, display_name, status, version, created_at, updated_at
        FROM users
        WHERE login_name = ? COLLATE NOCASE
      `)
      .get(loginName),
  )
}

export function listLoginNamesInOrganization(database, organizationId) {
  return database
    .prepare('SELECT login_name AS loginName FROM users WHERE organization_id = ?')
    .all(organizationId)
    .map((row) => row.loginName)
}

export function accountCodeExists(database, organizationId, accountCode) {
  return Boolean(
    database
      .prepare('SELECT 1 AS ok FROM users WHERE organization_id = ? AND account_code = ? COLLATE NOCASE')
      .get(organizationId, accountCode),
  )
}

export function hasTeacherRegistrationUse(database, { userId, organizationId }) {
  return Boolean(
    database
      .prepare(`
        SELECT 1 AS ok FROM registration_credential_uses
        WHERE created_user_id = ? AND expected_role = 'teacher' AND organization_id = ?
      `)
      .get(userId, organizationId),
  )
}

export function hasStudentRegistrationUse(database, { userId, organizationId }) {
  return Boolean(
    database
      .prepare(`
        SELECT 1 AS ok FROM registration_credential_uses
        WHERE created_user_id = ? AND expected_role = 'student' AND organization_id = ?
      `)
      .get(userId, organizationId),
  )
}

export function listRoleAssignmentsForUser(database, { userId, organizationId }) {
  return database
    .prepare(`
      SELECT id, role_code, scope_type, scope_id, status, workspace_id
      FROM role_assignments
      WHERE user_id = ? AND organization_id = ?
    `)
    .all(userId, organizationId)
    .map((row) => ({
      id: row.id,
      roleCode: row.role_code,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      status: row.status,
      workspaceId: row.workspace_id,
    }))
}

export function hasTeacherRoleEvidence(database, { userId, organizationId }) {
  return listRoleAssignmentsForUser(database, { userId, organizationId }).some(
    (assignment) => normalizeRoleCode(assignment.roleCode) === 'teacher',
  )
}

export function hasStudentRoleEvidence(database, { userId, organizationId }) {
  return listRoleAssignmentsForUser(database, { userId, organizationId }).some(
    (assignment) => normalizeRoleCode(assignment.roleCode) === 'student',
  )
}

export function hasActiveGradeManagerAssignment(database, { userId, workspaceId, organizationId }) {
  return Boolean(
    database
      .prepare(`
        SELECT 1 AS ok
        FROM role_assignments
        JOIN workspace_memberships
          ON workspace_memberships.user_id = role_assignments.user_id
          AND workspace_memberships.workspace_id = role_assignments.workspace_id
          AND workspace_memberships.status = 'active'
        WHERE role_assignments.user_id = ?
          AND role_assignments.workspace_id = ?
          AND role_assignments.organization_id = ?
          AND role_assignments.status = 'active'
          AND role_assignments.role_code IN ('grade_manager', 'grade_admin')
      `)
      .get(userId, workspaceId, organizationId),
  )
}

export function listPendingEnrollmentRequestsForUser(database, userId) {
  return database
    .prepare(`
      SELECT id, organization_id, student_user_id, class_id, status, requested_at, version
      FROM student_enrollment_requests
      WHERE student_user_id = ?
      ORDER BY requested_at, id
    `)
    .all(userId)
}

export function findPendingEnrollmentForUser(database, userId) {
  const row = database
    .prepare(`
      SELECT id, organization_id, student_user_id, class_id, status, requested_at, version
      FROM student_enrollment_requests
      WHERE student_user_id = ? AND status = 'pending'
    `)
    .get(userId)
  return row
    ? {
        id: row.id,
        organizationId: row.organization_id,
        studentUserId: row.student_user_id,
        classId: row.class_id,
        status: row.status,
        requestedAt: row.requested_at,
        version: row.version,
      }
    : null
}

export function findEnrollmentRequestById(database, id) {
  const row = database
    .prepare(`
      SELECT id, organization_id, student_user_id, class_id, status, requested_at,
             decided_at, decided_by, decision_reason, created_at, updated_at, version
      FROM student_enrollment_requests
      WHERE id = ?
    `)
    .get(id)
  if (!row) return null
  return {
    id: row.id,
    organizationId: row.organization_id,
    studentUserId: row.student_user_id,
    classId: row.class_id,
    status: row.status,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    decisionReason: row.decision_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  }
}

export function findActiveStudentMembership(database, userId) {
  const row = database
    .prepare(`
      SELECT id, class_id, status, version
      FROM class_memberships
      WHERE user_id = ? AND membership_role = 'student' AND status = 'active'
    `)
    .get(userId)
  return row
    ? { id: row.id, classId: row.class_id, status: row.status, version: row.version }
    : null
}

export function countActiveTeacherClasses(database, userId) {
  return database
    .prepare(`
      SELECT COUNT(*) AS count
      FROM class_memberships
      WHERE user_id = ? AND membership_role = 'teacher' AND status = 'active'
    `)
    .get(userId).count
}

export function loadTeacherTriple(database, { userId, classId }) {
  return {
    memberships: database
      .prepare(`
        SELECT id, status, version FROM class_memberships
        WHERE user_id = ? AND class_id = ? AND membership_role = 'teacher'
        ORDER BY id
      `)
      .all(userId, classId),
    workspaceMemberships: database
      .prepare(`
        SELECT wm.id, wm.status, wm.version, wm.workspace_id
        FROM workspace_memberships wm
        JOIN workspaces w ON w.id = wm.workspace_id
        WHERE wm.user_id = ? AND w.scope_type = 'class' AND w.scope_id = ?
        ORDER BY wm.id
      `)
      .all(userId, classId),
    roleAssignments: database
      .prepare(`
        SELECT id, status, version, scope_type, scope_id, role_code, workspace_id
        FROM role_assignments
        WHERE user_id = ? AND scope_type = 'class' AND scope_id = ?
          AND role_code IN ('teacher', 'class_teacher')
        ORDER BY id
      `)
      .all(userId, classId),
  }
}

export function loadStudentTriple(database, { userId, classId }) {
  return {
    memberships: database
      .prepare(`
        SELECT id, status, version FROM class_memberships
        WHERE user_id = ? AND class_id = ? AND membership_role = 'student'
        ORDER BY id
      `)
      .all(userId, classId),
    workspaceMemberships: database
      .prepare(`
        SELECT wm.id, wm.status, wm.version, wm.workspace_id
        FROM workspace_memberships wm
        JOIN workspaces w ON w.id = wm.workspace_id
        WHERE wm.user_id = ? AND w.scope_type = 'class' AND w.scope_id = ?
        ORDER BY wm.id
      `)
      .all(userId, classId),
    roleAssignments: database
      .prepare(`
        SELECT id, status, version, scope_type, scope_id, role_code, workspace_id
        FROM role_assignments
        WHERE user_id = ? AND scope_type = 'class' AND scope_id = ?
          AND role_code = 'student'
        ORDER BY id
      `)
      .all(userId, classId),
  }
}

export function findClassWorkspace(database, { organizationId, classId, anyStatus = false }) {
  return toWorkspace(
    database
      .prepare(`
        SELECT id, organization_id, code, name, scope_type, scope_id, status, version
        FROM workspaces
        WHERE organization_id = ?
          AND scope_type = 'class'
          AND scope_id = ?
          ${anyStatus ? '' : "AND status = 'active'"}
        ORDER BY id
        LIMIT 1
      `)
      .get(organizationId, classId),
  )
}

export function findGradeWorkspace(database, { organizationId, gradeId, anyStatus = false }) {
  return toWorkspace(
    database
      .prepare(`
        SELECT id, organization_id, code, name, scope_type, scope_id, status, version
        FROM workspaces
        WHERE organization_id = ?
          AND scope_type = 'grade'
          AND scope_id = ?
          ${anyStatus ? '' : "AND status = 'active'"}
        ORDER BY id
        LIMIT 1
      `)
      .get(organizationId, gradeId),
  )
}

export function findSchoolWorkspace(database, { organizationId, anyStatus = false }) {
  return toWorkspace(
    database
      .prepare(`
        SELECT id, organization_id, code, name, scope_type, scope_id, status, version
        FROM workspaces
        WHERE organization_id = ?
          AND scope_type = 'school'
          AND scope_id = ?
          ${anyStatus ? '' : "AND status = 'active'"}
        ORDER BY id
        LIMIT 1
      `)
      .get(organizationId, organizationId),
  )
}

export function findPlatformWorkspace(database, { organizationId }) {
  return toWorkspace(
    database
      .prepare(`
        SELECT id, organization_id, code, name, scope_type, scope_id, status, version
        FROM workspaces
        WHERE organization_id = ?
          AND scope_type = 'platform'
          AND status = 'active'
        ORDER BY id
        LIMIT 1
      `)
      .get(organizationId),
  )
}

export function listOrganizationClasses(database, organizationId) {
  return database.prepare(`SELECT ${CLASS_COLUMNS} FROM classes WHERE organization_id = ? ORDER BY grade_id, class_number, id`).all(organizationId).map(toClass)
}

export function findRegistrationByHash(database, secretHash) {
  const row = database
    .prepare(`
      SELECT id, organization_id, secret_hash, expected_role, scope_type, scope_id,
             expires_at, max_uses, successful_use_count, revoked_at, created_by_user_id,
             created_workspace_id, created_at, updated_at, version
      FROM registration_credentials
      WHERE secret_hash = ?
    `)
    .get(secretHash)
  if (!row) return null
  return {
    id: row.id,
    organizationId: row.organization_id,
    secretHash: row.secret_hash,
    expectedRole: row.expected_role,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    successfulUseCount: row.successful_use_count,
    revokedAt: row.revoked_at,
    createdByUserId: row.created_by_user_id,
    createdWorkspaceId: row.created_workspace_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  }
}

export function findRegistrationById(database, id) {
  const row = database
    .prepare(`
      SELECT id, organization_id, secret_hash, expected_role, scope_type, scope_id,
             expires_at, max_uses, successful_use_count, revoked_at, revoked_by, revoked_reason,
             created_by_user_id, created_workspace_id, created_at, updated_at, version
      FROM registration_credentials
      WHERE id = ?
    `)
    .get(id)
  if (!row) return null
  return {
    id: row.id,
    organizationId: row.organization_id,
    secretHash: row.secret_hash,
    expectedRole: row.expected_role,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    successfulUseCount: row.successful_use_count,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    revokedReason: row.revoked_reason,
    createdByUserId: row.created_by_user_id,
    createdWorkspaceId: row.created_workspace_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  }
}

export function findPasswordResetByHash(database, secretHash) {
  const row = database
    .prepare(`
      SELECT id, organization_id, target_user_id, secret_hash, expires_at, used_at,
             revoked_at, created_by_user_id, created_workspace_id, created_at, updated_at, version
      FROM password_reset_credentials
      WHERE secret_hash = ?
    `)
    .get(secretHash)
  if (!row) return null
  return {
    id: row.id,
    organizationId: row.organization_id,
    targetUserId: row.target_user_id,
    secretHash: row.secret_hash,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    revokedAt: row.revoked_at,
    createdByUserId: row.created_by_user_id,
    createdWorkspaceId: row.created_workspace_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  }
}

export function listEnrollmentRequestsForClass(database, { classId, status }) {
  return database
    .prepare(`
      SELECT
        requests.id,
        requests.status,
        requests.version,
        requests.requested_at AS requestedAt,
        requests.class_id AS classId,
        users.id AS studentId,
        users.display_name AS studentDisplayName,
        users.account_code AS studentAccountCode
      FROM student_enrollment_requests AS requests
      JOIN users ON users.id = requests.student_user_id
      WHERE requests.class_id = ?
        AND requests.status = ?
      ORDER BY requests.requested_at ASC, requests.id ASC
    `)
    .all(classId, status)
}

export function listRegistrationCredentialMetadata(database, { organizationId, expectedRole, scopeType, scopeId }) {
  const scoped = Boolean(scopeType && scopeId)
  return database
    .prepare(`
      SELECT
        id,
        organization_id AS organizationId,
        expected_role AS expectedRole,
        scope_type AS scopeType,
        scope_id AS scopeId,
        expires_at AS expiresAt,
        max_uses AS maxUses,
        successful_use_count AS successfulUseCount,
        revoked_at AS revokedAt,
        created_by_user_id AS createdByUserId,
        created_at AS createdAt,
        version
      FROM registration_credentials
      WHERE organization_id = ?
        AND expected_role = ?
        ${scoped ? 'AND scope_type = ? AND scope_id = ?' : ''}
      ORDER BY created_at ASC, id ASC
    `)
    .all(...(scoped ? [organizationId, expectedRole, scopeType, scopeId] : [organizationId, expectedRole]))
}

export function listPasswordResetCredentialMetadata(database, { targetUserId, organizationId }) {
  return database
    .prepare(`
      SELECT
        id,
        expires_at AS expiresAt,
        used_at AS usedAt,
        revoked_at AS revokedAt,
        created_by_user_id AS createdByUserId,
        created_at AS createdAt,
        version
      FROM password_reset_credentials
      WHERE target_user_id = ?
        AND organization_id = ?
      ORDER BY created_at ASC, id ASC
    `)
    .all(targetUserId, organizationId)
}

export function revokeAllSessionsForUser(database, userId, now) {
  database
    .prepare(`
      UPDATE sessions
      SET revoked_at = ?, updated_at = ?, version = version + 1
      WHERE user_id = ? AND revoked_at IS NULL
    `)
    .run(now, now, userId)
}

export function revokeOtherSessionsForUser(database, userId, keepSessionId, now) {
  database
    .prepare(`
      UPDATE sessions
      SET revoked_at = ?, updated_at = ?, version = version + 1
      WHERE user_id = ? AND id != ? AND revoked_at IS NULL
    `)
    .run(now, now, userId, keepSessionId)
}

/**
 * T3-2 锚点：学生自助改密成功后清除 issued_temp_passwords 中该用户的明文行。
 * 表由迁移 053 创建；W2 不建表、不发 SQL。T3-2 将本函数体替换为 DELETE。
 */
export function clearIssuedTempPasswordForUser(database, userId) {
  void database
  void userId
}

export function updatePasswordHash(database, userId, passwordHash, now) {
  const result = database
    .prepare(`
      UPDATE credentials
      SET password_hash = ?, updated_at = ?, version = version + 1
      WHERE user_id = ?
    `)
    .run(passwordHash, now, userId)
  return result.changes === 1
}

