function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function listFrom(value) {
  const source = asRecord(value)
  return asArray(source.items || source.results || value)
}

function toActor(raw) {
  const source = asRecord(raw)
  const profile = asRecord(source.profile)
  return {
    id: source.id || source.userId || null,
    name: source.displayName || source.name || profile.displayName || null,
    role: source.role || profile.role || null,
  }
}

function toWorkspace(raw) {
  const source = asRecord(raw)
  return {
    id: source.id || source.workspaceId || null,
    name: source.name || source.displayName || null,
    kind: source.kind || source.type || source.scopeType || null,
    organizationId: source.organizationId || null,
    scopeType: source.scopeType || null,
    scopeId: source.scopeId || null,
    scopeLabel: source.scopeLabel || source.name || source.displayName || null,
    person: toActor(source.person || source.owner),
  }
}

export function toConsoleRuntimeDto({ session, workspaces }) {
  const sessionData = asRecord(session)
  const workspaceItems = listFrom(workspaces).map(toWorkspace).filter((workspace) => workspace.id)
  const activeWorkspaceId = sessionData.workspaceId || sessionData.activeWorkspaceId || null

  return {
    operator: toActor(sessionData.user || sessionData.actor || sessionData),
    workspace: workspaceItems.find((workspace) => workspace.id === activeWorkspaceId) || null,
    workspaces: workspaceItems,
  }
}
