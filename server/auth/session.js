import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000
export const MIN_SESSION_TTL_MS = 5 * 60 * 1000
export const MAX_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function validateSessionTtlMs(value = DEFAULT_SESSION_TTL_MS) {
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_SESSION_TTL_MS ||
    value > MAX_SESSION_TTL_MS
  ) {
    throw new Error(
      `sessionTtlMs 必须为 ${MIN_SESSION_TTL_MS} 到 ${MAX_SESSION_TTL_MS} 之间的整数毫秒数`,
    )
  }
  return value
}

export function assertSessionSecret(sessionSecret) {
  if (typeof sessionSecret !== 'string' || Buffer.byteLength(sessionSecret) < 32) {
    throw new Error('SESSION_TOKEN_SECRET 必须至少包含 32 个字节，且只能由运行时环境注入')
  }
}

function signatureFor(encodedSessionId, sessionSecret) {
  return createHmac('sha256', sessionSecret).update(encodedSessionId, 'utf8').digest('base64url')
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export function createSessionToken(sessionId, sessionSecret) {
  assertSessionSecret(sessionSecret)
  const encodedSessionId = Buffer.from(sessionId, 'utf8').toString('base64url')
  return `${encodedSessionId}.${signatureFor(encodedSessionId, sessionSecret)}`
}

export function readSessionIdFromToken(token, sessionSecret) {
  if (typeof token !== 'string') {
    return null
  }
  const [encodedSessionId, providedSignature, extra] = token.split('.')
  if (!encodedSessionId || !providedSignature || extra) {
    return null
  }

  const expectedSignature = signatureFor(encodedSessionId, sessionSecret)
  if (!safeEqual(providedSignature, expectedSignature)) {
    return null
  }

  const sessionId = Buffer.from(encodedSessionId, 'base64url').toString('utf8')
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)
    ? sessionId
    : null
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function createServerSession(database, options) {
  const now = options.now ?? new Date().toISOString()
  const ttlMs = validateSessionTtlMs(options.ttlMs)
  const issuedAt = new Date(now)
  const expiresAt = new Date(issuedAt.getTime() + ttlMs).toISOString()
  const id = randomUUID()
  const token = createSessionToken(id, options.sessionSecret)
  database
    .prepare(`
      INSERT INTO sessions (
        id, user_id, token_hash, expires_at, revoked_at, last_seen_at, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 1)
    `)
    .run(id, options.userId, hashSessionToken(token), expiresAt, now, now, now)
  return { id, token, expiresAt }
}

export function inspectServerSession(database, token, sessionSecret, now = new Date().toISOString()) {
  const sessionId = readSessionIdFromToken(token, sessionSecret)
  if (!sessionId) {
    return { state: 'missing', sessionId: null }
  }

  const record = database
    .prepare(`
      SELECT
        sessions.id AS session_id,
        sessions.user_id,
        sessions.token_hash,
        sessions.expires_at,
        sessions.revoked_at,
        users.username,
        users.display_name,
        users.organization_id,
        users.status AS user_status,
        organizations.status AS organization_status
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      JOIN organizations ON organizations.id = users.organization_id
      WHERE sessions.id = ?
    `)
    .get(sessionId)

  if (!record || !safeEqual(record.token_hash, hashSessionToken(token))) {
    return { state: 'missing', sessionId }
  }
  if (record.revoked_at || record.expires_at <= now) {
    return { state: 'expired', sessionId }
  }
  if (record.user_status !== 'active' || record.organization_status !== 'active') {
    return { state: 'disabled', sessionId }
  }

  return {
    state: 'active',
    sessionId,
    session: {
      id: record.session_id,
      user: {
        id: record.user_id,
        username: record.username,
        displayName: record.display_name,
        organizationId: record.organization_id,
        status: record.user_status,
      },
    },
  }
}

export function revokeServerSession(database, sessionId, now = new Date().toISOString()) {
  const result = database
    .prepare(`
      UPDATE sessions
      SET revoked_at = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND revoked_at IS NULL
    `)
    .run(now, now, sessionId)
  return result.changes === 1
}

export function reissueSessionToken(database, sessionId, sessionSecret, now = new Date().toISOString()) {
  const record = database
    .prepare(`
      SELECT sessions.expires_at, sessions.revoked_at, users.status AS user_status, organizations.status AS organization_status
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      JOIN organizations ON organizations.id = users.organization_id
      WHERE sessions.id = ?
    `)
    .get(sessionId)
  if (
    !record ||
    record.revoked_at ||
    record.expires_at <= now ||
    record.user_status !== 'active' ||
    record.organization_status !== 'active'
  ) {
    return null
  }
  return createSessionToken(sessionId, sessionSecret)
}
