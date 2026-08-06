import { appendAuditEvent } from '../db/reliability.js'

export function workspaceResourceScope(workspace, ownerId) {
  const scope = {
    type: workspace.scopeType,
    id: workspace.scopeId,
    scopeType: workspace.scopeType,
    scopeId: workspace.scopeId,
    organizationId: workspace.organizationId,
    ownerId,
  }
  if (workspace.scopeType === 'class') scope.classId = workspace.scopeId
  if (workspace.scopeType === 'grade') scope.gradeId = workspace.scopeId
  return scope
}

export function studentResourceScope(database, organizationId, studentId) {
  const student = database.prepare(`
    SELECT id, organization_id
    FROM users
    WHERE id = ? AND organization_id = ? AND status = 'active'
  `).get(studentId, organizationId)
  if (!student) return null
  const classes = database.prepare(`
    SELECT classes.id, classes.grade_id
    FROM class_memberships
    JOIN classes ON classes.id = class_memberships.class_id
    WHERE class_memberships.user_id = ?
      AND class_memberships.status = 'active'
      AND classes.organization_id = ?
      AND classes.status = 'active'
  `).all(studentId, organizationId)
  return {
    type: 'own',
    id: studentId,
    organizationId,
    ownerId: studentId,
    classIds: classes.map((row) => row.id),
    gradeIds: [...new Set(classes.map((row) => row.grade_id).filter(Boolean))],
  }
}

export function createRequestDomainDependencies({ database, identityService, req }) {
  const user = req.identitySession.user
  const workspace = req.workspace
  const authorize = ({ action, resource = {} }) => {
    const definedResource = Object.fromEntries(
      Object.entries(resource).filter(([, value]) => value !== null && value !== undefined),
    )
    return identityService.authorize({
      actor: user,
      workspace,
      action,
      resourceScope: {
        ...workspaceResourceScope(workspace, user.id),
        ...definedResource,
        organizationId: workspace.organizationId,
      },
    })
  }
  const actor = {
    ...user,
    can: (action) => authorize({ action }),
  }
  const domainWorkspace = {
    ...workspace,
    organizationSnapshot: { id: workspace.organizationId },
    snapshot: { id: workspace.id, scopeType: workspace.scopeType, scopeId: workspace.scopeId },
    canAccessStudent: (studentId) => {
      const resourceScope = studentResourceScope(database, workspace.organizationId, studentId)
      return Boolean(resourceScope) && identityService.authorize({
        actor: user,
        workspace,
        action: 'account.read',
        resourceScope,
      })
    },
  }
  return {
    db: database,
    actor,
    workspace: domainWorkspace,
    authorize,
    audit: (event) => appendAuditEvent(database, {
      eventType: event.eventType,
      actorUserId: user.id,
      workspaceId: workspace.id,
      requestId: req.requestId,
      idempotencyKey: req.get('Idempotency-Key') || null,
      resourceType: event.resourceType || null,
      resourceId: event.resourceId || null,
      outcome: 'succeeded',
      scopeSnapshot: workspaceResourceScope(workspace, user.id),
    }),
  }
}
