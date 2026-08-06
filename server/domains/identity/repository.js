function toUser(record) {
  if (!record) {
    return null
  }
  return {
    id: record.id,
    organizationId: record.organization_id,
    username: record.username,
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

function activeWorkspaceQuery(whereClause) {
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

export function findCredentialByUsername(database, username) {
  const record = database
    .prepare(`
      SELECT
        users.id,
        users.organization_id,
        users.username,
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
      WHERE users.username = ?
    `)
    .get(username)

  if (!record) {
    return null
  }
  return {
    user: toUser(record),
    organizationStatus: record.organization_status,
    passwordHash: record.password_hash,
  }
}

export function findUserById(database, userId) {
  return toUser(
    database
      .prepare(`
        SELECT id, organization_id, username, display_name, status, version, created_at, updated_at
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
        SELECT id, organization_id, username, display_name, status, version, created_at, updated_at
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
        id, organization_id, grade_id, name, status, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, 1)
    `)
    .run(record.classId, record.organizationId, record.gradeId, record.name, record.now, record.now)
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

export function listWorkspacesForUser(database, userId) {
  const records = database
    .prepare(`${activeWorkspaceQuery('')} ORDER BY workspaces.code, workspaces.name`)
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
