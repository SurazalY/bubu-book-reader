import { randomUUID } from 'node:crypto'

import { enqueueOutboxEvent } from '../../db/reliability.js'

export class DomainError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.details = details
  }
}

export function nowIso(clock) {
  return (clock ? clock() : new Date()).toISOString()
}

export function makeId(idGenerator = randomUUID) {
  return idGenerator()
}

export function requireText(value, field, maxLength = 20000) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new DomainError('VALIDATION_FAILED', `${field} 无效`, { field })
  }
  return value.trim()
}

export function optionalText(value, field, maxLength = 20000) {
  if (value === undefined || value === null) return null
  return requireText(value, field, maxLength)
}

export function resolveContext({ actor, workspace }) {
  const resolvedActor = typeof actor === 'function' ? actor() : actor
  const resolvedWorkspace = typeof workspace === 'function' ? workspace() : workspace
  if (!resolvedActor?.id) throw new DomainError('AUTH_REQUIRED', '缺少已认证操作者')
  if (!resolvedWorkspace?.id || !resolvedWorkspace?.organizationId) {
    throw new DomainError('PERMISSION_DENIED', '当前工作空间不可用')
  }
  return { actor: resolvedActor, workspace: resolvedWorkspace }
}

export function requirePermission(context, permission) {
  const { actor, workspace } = context
  const allowed = typeof actor.can === 'function'
    ? actor.can(permission, workspace)
    : Array.isArray(actor.permissions) && actor.permissions.includes(permission)
  if (allowed !== true) throw new DomainError('PERMISSION_DENIED', '当前工作空间无权执行此操作', { permission })
}

export function assertWorkspace(row, workspace) {
  if (!row || row.workspace_id_at_creation !== workspace.id || row.organization_id_at_creation !== workspace.organizationId) {
    throw new DomainError('RESOURCE_NOT_FOUND', '资源不存在或不在当前工作空间')
  }
  return row
}

export function emit(database, outbox, type, payload, options) {
  const event = {
    type,
    payload,
    topic: type,
    aggregateType: options.aggregateType,
    aggregateId: options.aggregateId,
    dedupeKey: options.dedupeKey,
    createdAt: options.createdAt
  }
  if (typeof outbox?.enqueue === 'function') {
    const result = outbox.enqueue(event)
    if (result && typeof result.then === 'function') {
      throw new TypeError('领域写入事务中的 outbox.enqueue 必须是同步数据库操作')
    }
    return result
  }
  return enqueueOutboxEvent(database, event)
}

export function json(value) {
  return JSON.stringify(value)
}

export function parseJson(value) {
  return JSON.parse(value)
}
