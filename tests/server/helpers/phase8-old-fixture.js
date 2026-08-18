import { randomUUID } from 'node:crypto'

import { resolveCurrentBookVersionId } from '../../../server/domains/reading/visibility.js'

export function loginBody(fixture, user) {
  return {
    schoolCode: fixture.schoolCode || user.schoolCode || fixture.organizationId,
    loginName: user.loginName || user.username,
    password: fixture.password,
  }
}

export function grantBookToClass(db, {
  bookId,
  classId,
  organizationId,
  actorId = 'phase8-old-fixture',
  now = new Date().toISOString(),
  bookVersionId,
}) {
  const versionId = bookVersionId || resolveCurrentBookVersionId(db, { bookId, organizationId })
  if (!versionId) {
    throw new Error(`grantBookToClass: missing current version for ${bookId}`)
  }
  db.prepare(`
    INSERT INTO book_access_grants (
      id, book_version_id, grantee_type, grantee_id,
      organization_id_at_creation, actor_id_at_creation, created_at, updated_at, version
    ) VALUES (?, ?, 'class', ?, ?, ?, ?, ?, 1)
  `).run(`grant-${randomUUID()}`, versionId, classId, organizationId, actorId, now, now)
  return versionId
}
