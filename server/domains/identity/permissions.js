const roleActions = {
  student: [
    'identity.read_self',
    'workspace.read',
    'book.read',
    'assignment.read',
    'classroom.read',
    'integration.launch',
    'integration.return',
    'reading.read_self',
    'eyecare.read_self',
    'ai.conversation.create',
    'ai.conversation.read_self',
    'ai.conversation.rename_self',
    'ai.conversation.privacy_self',
    'ai.conversation.context_self',
    'ai.conversation.delete_self',
    'ai.conversation.restore_self',
    'community.submit',
    'privacy.request',
    'privacy.requests.read_self',
    'privacy.request.resolve_self',
    'privacy.history.read_self',
  ],
  teacher: [
    'workspace.read',
    'account.read',
    'account.manage',
    'class.read',
    'class.manage',
    'book.read',
    'assignment.read',
    'assignment.manage',
    'classroom.read',
    'classroom.control',
    'reading.read_scope',
    'conversation.read',
    'eyecare.read_scoped',
    'eyecare.release_false_positive',
    'ai.conversation.read_scoped',
    'ai.conversation.search_scoped',
    'privacy.request',
    'privacy.requests.read_scoped',
    'privacy.conversation.view',
    'privacy.history.read_scoped',
    'community.moderate',
    'community.review.class',
    'report.generate',
    'report.review',
    'report.send',
  ],
  grade_manager: [
    'workspace.read',
    'account.read',
    'account.manage',
    'class.read',
    'class.manage',
    'book.read',
    'assignment.read',
    'book.import',
    'assignment.manage',
    'classroom.read',
    'reading.read_scope',
    'conversation.read',
    'eyecare.read_scoped',
    'eyecare.release_false_positive',
    'ai.conversation.read_scoped',
    'ai.conversation.search_scoped',
    'privacy.request',
    'privacy.requests.read_scoped',
    'privacy.conversation.view',
    'privacy.history.read_scoped',
    'community.moderate',
    'community.review.class',
    'report.generate',
    'report.review',
    'report.send',
  ],
  school_admin: [
    'workspace.read',
    'account.read',
    'account.manage',
    'class.read',
    'class.manage',
    'book.read',
    'assignment.read',
    'book.import',
    'book.publish',
    'book.archive',
    'assignment.manage',
    'classroom.read',
    'classroom.control',
    'reading.read_scope',
    'conversation.read',
    'eyecare.read_scoped',
    'eyecare.release_false_positive',
    'ai.conversation.read_scoped',
    'ai.conversation.search_scoped',
    'privacy.request',
    'privacy.requests.read_scoped',
    'privacy.conversation.view',
    'privacy.history.read_scoped',
    'safety.review',
    'safety.accept',
    'safety.transfer',
    'safety.close',
    'community.moderate',
    'community.review.school',
    'report.generate',
    'report.review',
    'report.send',
  ],
  platform_ops: [
    'workspace.read',
    'account.read',
    'account.manage',
    'book.read',
    'book.import',
    'book.publish',
    'book.archive',
    'policy.manage',
    'model.manage',
    'audit.read_platform',
  ],
}

const roleAliases = {
  class_teacher: 'teacher',
  grade_group: 'grade_manager',
  grade_admin: 'grade_manager',
  platform_operator: 'platform_ops',
}

function hasAction(policy, roleCode, action) {
  const normalizedRole = roleAliases[roleCode] ?? roleCode
  return (policy[normalizedRole] ?? []).includes(action)
}

function collectScopeIds(resourceScope, pluralName, singularName) {
  const identifiers = new Set(resourceScope?.[pluralName] ?? [])
  if (resourceScope?.[singularName]) {
    identifiers.add(resourceScope[singularName])
  }
  if (resourceScope?.type === singularName && resourceScope.id) {
    identifiers.add(resourceScope.id)
  }
  if (resourceScope?.scopeType === singularName && resourceScope.scopeId) {
    identifiers.add(resourceScope.scopeId)
  }
  return identifiers
}

function scopeAllows(grant, resourceScope, actorUserId, authContext) {
  if (
    !resourceScope ||
    !authContext ||
    grant.workspaceId !== authContext.workspaceId ||
    grant.organizationId !== authContext.organizationId
  ) {
    return false
  }
  if (grant.scopeType === 'platform') {
    return true
  }
  if (resourceScope.type === 'platform' || resourceScope.scopeType === 'platform') {
    return false
  }
  if (resourceScope.organizationId !== grant.organizationId) {
    return false
  }
  if (grant.scopeType === 'own') {
    return resourceScope.ownerId === actorUserId && grant.scopeId === actorUserId
  }
  if (grant.scopeType === 'school') {
    return resourceScope.organizationId === grant.scopeId || (resourceScope.type === 'school' && resourceScope.id === grant.scopeId)
  }
  if (grant.scopeType === 'grade') {
    return collectScopeIds(resourceScope, 'gradeIds', 'gradeId').has(grant.scopeId)
  }
  if (grant.scopeType === 'class') {
    return collectScopeIds(resourceScope, 'classIds', 'classId').has(grant.scopeId)
  }
  return false
}

export function createPermissionEvaluator(overrides = {}) {
  const policy = { ...roleActions }
  for (const [roleCode, actions] of Object.entries(overrides)) {
    policy[roleCode] = [...new Set(actions)]
  }

  return ({ assignments, action, resourceScope, actorUserId, authContext }) =>
    assignments.some(
      (assignment) =>
        hasAction(policy, assignment.roleCode, action) &&
        scopeAllows(assignment, resourceScope, actorUserId, authContext),
    )
}
