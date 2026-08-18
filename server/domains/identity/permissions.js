const roleActions = {
  platform_ops: [
    'workspace.read',
    'account.read',
    'account.manage',
    'book.read',
    'book.import',
    'book.publish',
    'book.archive',
    'book.catalog.import',
    'book.catalog.publish',
    'book.catalog.unpublish',
    'book.catalog.archive',
    'policy.manage',
    'model.manage',
    'audit.read_platform',
    'school_admin.assignment.assign',
    'school_admin.assignment.remove',
    'registration.teacher.issue',
    'registration.teacher.revoke',
    'password_reset.teacher.issue',
    'password_reset.teacher.revoke',
    'password_reset.school_admin.issue',
    'password_reset.school_admin.revoke',
  ],
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
    'class.read',
    'student.enrollment.read_self',
  ],
  teacher: [
    'workspace.read',
    'account.read',
    'account.manage',
    'class.read',
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
    'teacher.affiliation.join_self',
    'teacher.affiliation.leave_self',
    'student.account.disable',
    'student.account.restore',
    'student.enrollment.review',
    'password_reset.student.issue',
    'password_reset.student.revoke',
    'book.shelf.read',
    'book.shelf.grant',
    'book.shelf.revoke',
  ],
  grade_manager: [
    'workspace.read',
    'account.read',
    'account.manage',
    'class.read',
    'class.directory.read',
    'class.create',
    'class.update',
    'class.disable',
    'class.restore',
    'book.read',
    'assignment.read',
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
    'teacher.affiliation.force_assign',
    'teacher.affiliation.force_remove',
    'student.account.disable',
    'student.account.restore',
    'student.enrollment.review',
    'student.affiliation.correct',
    'registration.student.issue',
    'registration.student.revoke',
    'password_reset.student.issue',
    'password_reset.student.revoke',
  ],
  school_admin: [
    'workspace.read',
    'account.read',
    'account.manage',
    'class.read',
    'class.directory.read',
    'class.create',
    'class.update',
    'class.disable',
    'class.restore',
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
    'safety.review',
    'safety.accept',
    'safety.transfer',
    'safety.close',
    'community.moderate',
    'community.review.school',
    'report.generate',
    'report.review',
    'report.send',
    'grade_manager.assignment.assign',
    'grade_manager.assignment.remove',
    'teacher.affiliation.force_assign',
    'teacher.affiliation.force_remove',
    'teacher.account.disable',
    'teacher.account.restore',
    'student.account.disable',
    'student.account.restore',
    'student.enrollment.review',
    'student.affiliation.correct',
    'registration.student.issue',
    'registration.student.revoke',
    'registration.teacher.issue',
    'registration.teacher.revoke',
    'password_reset.student.issue',
    'password_reset.student.revoke',
    'password_reset.teacher.issue',
    'password_reset.teacher.revoke',
  ],
}

const roleAliases = {
  class_teacher: 'teacher',
  grade_admin: 'grade_manager',
  platform_operator: 'platform_ops',
}

export function normalizeRoleCode(roleCode) {
  return roleAliases[roleCode] ?? roleCode
}

function hasAction(policy, roleCode, action) {
  return (policy[normalizeRoleCode(roleCode)] ?? []).includes(action)
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
