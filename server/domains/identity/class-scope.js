import { normalizeRoleCode } from './permissions.js'
import { listActiveRoleAssignments } from './repository.js'

export { computeClassLifecycle, computeGradeId } from './lifecycle.js'

// 书库管理侧角色：控制台需要看到本组织全部书，并可设置书籍可见范围。
// 学生角色不在此集合内，判定因此是 fail closed：查不到管理角色即按学生处理。
export const BOOK_LIBRARY_MANAGEMENT_ROLES = new Set([
  'teacher',
  'grade_manager',
  'school_admin',
  'platform_ops',
])

export function listManagementRoleAssignments(database, { organizationId, userId, workspaceId }) {
  if (!organizationId || !userId || !workspaceId) return []
  return listActiveRoleAssignments(database, userId, workspaceId, organizationId)
    .filter((assignment) => BOOK_LIBRARY_MANAGEMENT_ROLES.has(normalizeRoleCode(assignment.roleCode)))
}

export function hasBookLibraryManagementRole(database, { organizationId, userId, workspaceId }) {
  return listManagementRoleAssignments(database, { organizationId, userId, workspaceId }).length > 0
}

// B-4：设置可见范围时只能选操作者授权范围内的班级。
// class 授权 → 该班；grade 授权 → 本年级全部班；school/platform 授权 → 本组织全部班。
export function listAuthorizedClasses(database, { organizationId, userId, workspaceId }) {
  const assignments = listManagementRoleAssignments(database, { organizationId, userId, workspaceId })
  if (assignments.length === 0) return []
  const classIds = new Set()
  const gradeIds = new Set()
  let wholeOrganization = false
  for (const assignment of assignments) {
    if (assignment.scopeType === 'class') classIds.add(assignment.scopeId)
    else if (assignment.scopeType === 'grade') gradeIds.add(assignment.scopeId)
    else if (assignment.scopeType === 'school' || assignment.scopeType === 'platform') wholeOrganization = true
  }
  if (!wholeOrganization && classIds.size === 0 && gradeIds.size === 0) return []
  return database.prepare(`
    SELECT classes.id, classes.name, classes.grade_id AS gradeId, (
      SELECT COUNT(*) FROM class_memberships AS membership
      WHERE membership.class_id = classes.id
        AND membership.status = 'active'
        AND membership.membership_role = 'student'
    ) AS studentCount
    FROM classes
    WHERE classes.organization_id = ?
      AND classes.status = 'active'
      AND (
        ? = 1
        OR classes.id IN (SELECT value FROM json_each(?))
        OR (classes.grade_id IS NOT NULL AND classes.grade_id IN (SELECT value FROM json_each(?)))
      )
    ORDER BY classes.grade_id, classes.name, classes.id
  `).all(
    organizationId,
    wholeOrganization ? 1 : 0,
    JSON.stringify([...classIds]),
    JSON.stringify([...gradeIds]),
  ).map((row) => ({
    id: row.id,
    name: row.name,
    gradeId: row.gradeId ?? null,
    studentCount: Number(row.studentCount || 0),
  }))
}

export function authorizedClassIdSet(database, scope) {
  return new Set(listAuthorizedClasses(database, scope).map((entry) => entry.id))
}
