import { withTransaction } from './database.js'

const entityNames = [
  'organizations',
  'users',
  'workspaces',
  'workspaceMemberships',
  'classes',
  'classMemberships',
  'roleAssignments',
  'credentials',
]

export class SeedConflictError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SeedConflictError'
  }
}

export class SeedValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SeedValidationError'
  }
}

function asArray(value, name) {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new SeedValidationError(`${name} 必须是数组`)
  }
  return value
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SeedValidationError(`${label} 必须是非空字符串`)
  }
  return value
}

function requireId(record, type) {
  return requireText(record?.id, `${type}.id`)
}

function defaultSchoolCode(record) {
  if (typeof record.schoolCode === 'string' && record.schoolCode.trim().length > 0) {
    return record.schoolCode.trim()
  }
  if (record.id === 'internal-demo-organization') {
    return 'internal-demo'
  }
  return requireId(record, 'organization')
}

function defaultAccountCode(userId) {
  const compact = String(userId).replace(/-/g, '')
  if (/^[0-9a-fA-F]{12,}$/i.test(compact)) {
    return `U${compact.slice(0, 12).toUpperCase()}`
  }
  let hash = 2166136261
  for (let index = 0; index < compact.length; index += 1) {
    hash ^= compact.charCodeAt(index)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return `U${hash.toString(16).toUpperCase().padStart(12, '0')}`
}

function optionalText(value, label) {
  if (value === undefined || value === null) {
    return null
  }
  return requireText(value, label)
}

function status(value, label) {
  const resolved = value ?? 'active'
  if (resolved !== 'active' && resolved !== 'disabled') {
    throw new SeedValidationError(`${label} 必须是 active 或 disabled`)
  }
  return resolved
}

function scopeType(value, label) {
  const allowed = new Set(['own', 'class', 'grade', 'school', 'platform'])
  if (!allowed.has(value)) {
    throw new SeedValidationError(`${label} 必须是有效的 scopeType`)
  }
  return value
}

function membershipRole(value) {
  const allowed = new Set(['student', 'teacher', 'assistant'])
  if (!allowed.has(value)) {
    throw new SeedValidationError('classMembership.membershipRole 必须是 student、teacher 或 assistant')
  }
  return value
}

function passwordHash(value) {
  const parts = typeof value === 'string' ? value.split('$') : []
  if (
    parts.length !== 6 ||
    parts[0] !== 'scrypt' ||
    parts[1] !== '16384' ||
    parts[2] !== '8' ||
    parts[3] !== '1' ||
    !/^[A-Za-z0-9_-]+$/.test(parts[4] ?? '') ||
    !/^[A-Za-z0-9_-]+$/.test(parts[5] ?? '')
  ) {
    throw new SeedValidationError('credential.passwordHash 必须是当前支持的 scrypt 哈希，导入不接受明文密码')
  }
  return value
}

function fieldsEqual(record, values) {
  return Object.entries(values)
    .filter(([column, value]) => record[column] !== value)
    .map(([column]) => column)
}

function createSummary() {
  const entities = Object.fromEntries(entityNames.map((name) => [name, { inserted: 0, unchanged: 0 }]))
  return {
    inserted: 0,
    unchanged: 0,
    entities,
  }
}

function recordSeed(database, summary, definition, id, values, now) {
  const fields = Object.keys(values)
  const existing = database
    .prepare(`SELECT ${fields.join(', ')} FROM ${definition.table} WHERE id = ?`)
    .get(id)
  if (existing) {
    const conflictingFields = fieldsEqual(existing, values)
    if (conflictingFields.length > 0) {
      throw new SeedConflictError(`${definition.name} 稳定 ID 已存在，但字段不一致: ${conflictingFields.join(', ')}`)
    }
    summary.unchanged += 1
    summary.entities[definition.name].unchanged += 1
    return
  }

  const columns = ['id', ...fields, 'created_at', 'updated_at', 'version']
  const placeholders = columns.map(() => '?').join(', ')
  database
    .prepare(`INSERT INTO ${definition.table} (${columns.join(', ')}) VALUES (${placeholders})`)
    .run(id, ...fields.map((field) => values[field]), now, now, 1)
  summary.inserted += 1
  summary.entities[definition.name].inserted += 1
}

function importRecords(database, summary, records, definition, now) {
  for (const record of records) {
    const id = requireId(record, definition.label)
    recordSeed(database, summary, definition, id, definition.values(record), now)
  }
}

const definitions = {
  organizations: {
    name: 'organizations',
    label: 'organization',
    table: 'organizations',
    values: (record) => ({
      name: requireText(record.name, 'organization.name'),
      status: status(record.status, 'organization.status'),
      school_code: defaultSchoolCode(record),
    }),
  },
  users: {
    name: 'users',
    label: 'user',
    table: 'users',
    values: (record) => ({
      organization_id: requireText(record.organizationId, 'user.organizationId'),
      username: requireText(record.username, 'user.username'),
      display_name: requireText(record.displayName, 'user.displayName'),
      status: status(record.status, 'user.status'),
      login_name: requireText(record.loginName ?? record.username, 'user.loginName'),
      account_code: requireText(record.accountCode ?? defaultAccountCode(record.id), 'user.accountCode'),
    }),
  },
  workspaces: {
    name: 'workspaces',
    label: 'workspace',
    table: 'workspaces',
    values: (record) => ({
      organization_id: optionalText(record.organizationId, 'workspace.organizationId'),
      code: requireText(record.code, 'workspace.code'),
      name: requireText(record.name, 'workspace.name'),
      scope_type: scopeType(record.scopeType, 'workspace.scopeType'),
      scope_id: requireText(record.scopeId, 'workspace.scopeId'),
      status: status(record.status, 'workspace.status'),
    }),
  },
  workspaceMemberships: {
    name: 'workspaceMemberships',
    label: 'workspaceMembership',
    table: 'workspace_memberships',
    values: (record) => ({
      user_id: requireText(record.userId, 'workspaceMembership.userId'),
      workspace_id: requireText(record.workspaceId, 'workspaceMembership.workspaceId'),
      status: status(record.status, 'workspaceMembership.status'),
    }),
  },
  roleAssignments: {
    name: 'roleAssignments',
    label: 'roleAssignment',
    table: 'role_assignments',
    values: (record) => ({
      organization_id: requireText(record.organizationId, 'roleAssignment.organizationId'),
      user_id: requireText(record.userId, 'roleAssignment.userId'),
      workspace_id: requireText(record.workspaceId, 'roleAssignment.workspaceId'),
      role_code: requireText(record.roleCode, 'roleAssignment.roleCode'),
      scope_type: scopeType(record.scopeType, 'roleAssignment.scopeType'),
      scope_id: requireText(record.scopeId, 'roleAssignment.scopeId'),
      status: status(record.status, 'roleAssignment.status'),
    }),
  },
  classes: {
    name: 'classes',
    label: 'class',
    table: 'classes',
    values: (record) => {
      const values = {
        organization_id: requireText(record.organizationId, 'class.organizationId'),
        grade_id: optionalText(record.gradeId, 'class.gradeId'),
        name: requireText(record.name, 'class.name'),
        status: status(record.status, 'class.status'),
      }
      if (record.stage !== undefined) values.stage = record.stage
      if (record.entryYear !== undefined) values.entry_year = record.entryYear
      if (record.classNumber !== undefined) values.class_number = record.classNumber
      return values
    },
  },
  classMemberships: {
    name: 'classMemberships',
    label: 'classMembership',
    table: 'class_memberships',
    values: (record) => ({
      class_id: requireText(record.classId, 'classMembership.classId'),
      user_id: requireText(record.userId, 'classMembership.userId'),
      membership_role: membershipRole(record.membershipRole),
      status: status(record.status, 'classMembership.status'),
    }),
  },
  credentials: {
    name: 'credentials',
    label: 'credential',
    table: 'credentials',
    values: (record) => {
      const allowedFields = new Set(['id', 'userId', 'passwordHash'])
      const unsupportedFields = Object.keys(record ?? {}).filter((field) => !allowedFields.has(field))
      if (unsupportedFields.length > 0) {
        throw new SeedValidationError(`credential 只接受 id、userId 与 passwordHash，拒绝字段: ${unsupportedFields.join(', ')}`)
      }
      return {
        user_id: requireText(record.userId, 'credential.userId'),
        password_hash: passwordHash(record.passwordHash),
      }
    },
  },
}

export function importIdentitySeed(database, seed, now = new Date().toISOString()) {
  const records = {
    organizations: asArray(seed?.organizations, 'organizations'),
    users: asArray(seed?.users, 'users'),
    workspaces: asArray(seed?.workspaces, 'workspaces'),
    workspaceMemberships: asArray(seed?.workspaceMemberships, 'workspaceMemberships'),
    roleAssignments: asArray(seed?.roleAssignments, 'roleAssignments'),
    classes: asArray(seed?.classes, 'classes'),
    classMemberships: asArray(seed?.classMemberships, 'classMemberships'),
    credentials: asArray(seed?.credentials, 'credentials'),
  }
  const summary = createSummary()

  try {
    withTransaction(database, () => {
      for (const name of entityNames) {
        importRecords(database, summary, records[name], definitions[name], now)
      }
    })
  } catch (error) {
    if (error instanceof SeedConflictError || error instanceof SeedValidationError) {
      throw error
    }
    if (/UNIQUE constraint failed/i.test(error.message)) {
      throw new SeedConflictError('导入数据与现有唯一键冲突，请检查稳定 ID 与业务唯一字段')
    }
    throw error
  }

  return summary
}
